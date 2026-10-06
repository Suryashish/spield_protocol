import { scValToNative, xdr } from '@stellar/stellar-sdk';

import {
  BACKEND_URL,
  NETWORK_KEY,
  SR_CONTRACTS,
  explorerContract,
  explorerTx,
} from './config';

/**
 * The contracts whose events make up the feed — the ones that actually hold or move user funds.
 *
 * Falls back to an empty list where the SR stack is not deployed, which makes every fetch below a
 * no-op rather than a crash, and the feed renders its empty state.
 */
const ACTIVITY_CONTRACTS: string[] = SR_CONTRACTS
  ? [SR_CONTRACTS.sr, SR_CONTRACTS.yieldEngine, SR_CONTRACTS.market, SR_CONTRACTS.vault].filter(
      (c): c is string => Boolean(c) && !c.startsWith('__'),
    )
  : [];

/**
 * Everything the feed READS: the fund-holding contracts above, plus the router.
 *
 * The router holds nothing, but it is the only contract that knows what a routed call was *for*: it
 * names the wallet behind it and states the amounts in USDC. The contracts underneath see only the
 * router and its SR. See {@link toActivities} for how the two are reconciled.
 *
 * Five ids, which is also the most one `getEvents` filter accepts. A sixth contract needs a second
 * filter, not a longer list.
 */
const EVENT_CONTRACTS: string[] =
  SR_CONTRACTS?.router && !SR_CONTRACTS.router.startsWith('__')
    ? [...ACTIVITY_CONTRACTS, SR_CONTRACTS.router]
    : ACTIVITY_CONTRACTS;
import { server } from './soroban';

/**
 * Read recent Spield wrapper events for the activity feed.
 *
 * The wrapper emits `Mint` / `Claim` / `RedeemPt` / `Combine` / `TransferPosition`
 * via `#[contractevent]`: topic[0] is the event-name symbol, the remaining topics
 * are the `#[topic]` fields (the acting address), and the data map holds the rest
 * (position_id, amount, …). We decode the bits the UI needs.
 *
 * TWO data sources, in order:
 *   1. Soroban RPC `getEvents` — fast, authoritative, but only retains a ROLLING
 *      ~7-day window of ledgers. Events older than that are silently gone.
 *   2. Our backend `/activity` proxy — server-side-fetches stellar.expert (which
 *      indexes FULL contract history but blocks cross-origin browser requests with
 *      a 403). Used as a fallback when the RPC returns nothing (the common case once
 *      a deployment is more than a week old). See website/server/index.js.
 */

export type ActivityKind =
  | 'Wrap'
  | 'Unwrap'
  | 'Mint'
  | 'RedeemPt'
  | 'Claim'
  | 'Swap'
  | 'YtTrade'
  | 'AddLiquidity'
  | 'RemoveLiquidity'
  | 'VaultDeposit'
  | 'VaultRedeem';

/**
 * The `#[contractevent]` macro publishes topic[0] as the *snake_case* of the event struct name
 * (`SrDeposit` → `sr_deposit`, `MintPy` → `mint_py`). Map those wire names back to our PascalCase
 * `ActivityKind`. Anything not in this map — `initialized`, fee-setting, governance — is
 * intentionally dropped: this is a user activity feed, not an audit log.
 *
 * ## Why the router is not in this map
 *
 * `srrouter` uses a two-level topic layout, `["router", "buy_pt", user]`, so it cannot be keyed by
 * topic[0] like everything else here. It is read separately and reconciled per transaction in
 * {@link toActivities}.
 */
const EVENT_NAME_TO_KIND: Record<string, ActivityKind> = {
  // SR wrapper
  sr_deposit: 'Wrap',
  sr_redeem: 'Unwrap',
  // PT/YT engine
  mint_py: 'Mint',
  redeem_py: 'RedeemPt',
  interest_paid: 'Claim',
  // PT/SR market
  swap: 'Swap',
  yt_trade: 'YtTrade',
  add_liquidity: 'AddLiquidity',
  remove_liquidity: 'RemoveLiquidity',
  // Fixed-Rate Vault
  deposited: 'VaultDeposit',
  redeemed: 'VaultRedeem',
};

/**
 * What a row needs to rebuild its share card later (`lib/shareCard`).
 *
 * Only deposits and payouts carry one, and only the facts the event itself recorded. Whatever else
 * a card needs — the maturity date, the principal of a receipt that has since closed — is read when
 * someone actually asks for the card, not for every row on every refresh.
 */
export type ActivityShare =
  | { type: 'vaultLock'; principal: bigint; payout: bigint; rateBps: number }
  | { type: 'vaultRedeem'; receiptId: bigint }
  | { type: 'mint'; usdc: bigint }
  | { type: 'buyPt'; paid: bigint; pt: bigint }
  | { type: 'buyYt'; paid: bigint; yt: bigint }
  | { type: 'claim'; amount: bigint; unit: 'USDC' | 'SR' }
  | { type: 'redeemPar'; pt: bigint };

export type Activity = {
  id: string;
  kind: ActivityKind;
  /** The acting account (event topic). */
  user: string;
  positionId: number;
  /** Amount / payout in base units, when the event carries one. */
  amount: bigint;
  /** Explorer URL for this event's transaction/contract (source-dependent). */
  explorerUrl: string;
  /** Ledger (RPC events) or explorer paging id — used only to sort newest-first. */
  ledger: number;
  /** When it happened, unix seconds. `0` when the source did not say. */
  at: number;
  /** Present when this row is something worth posting. */
  share?: ActivityShare;
};

/** One contract event, in the shape both sources are normalised to before rows are built. */
type RawEvent = {
  id: string;
  /**
   * Groups the events of one transaction: the tx hash from the RPC, the operation id from the
   * explorer (the part of its paging token before the dash). Never shown, only compared.
   */
  tx: string;
  /** topic[0], the wire name. */
  name: string;
  /** The remaining topics, as strings. */
  topics: string[];
  body: Record<string, unknown>;
  at: number;
  ledger: number;
  explorerUrl: string;
};

/** Events worth carrying out of a fetch: the ones that become rows, and the router's. */
const isRelevant = (name: string): boolean => name === 'router' || name in EVENT_NAME_TO_KIND;

const toBig = (v: unknown): bigint => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string' && v !== '') {
    try {
      return BigInt(v);
    } catch {
      return 0n;
    }
  }
  return 0n;
};

const nativeOrEmpty = (val: xdr.ScVal): unknown => {
  try {
    return scValToNative(val);
  } catch {
    return undefined;
  }
};

/** Pull (positionId, amount) out of a decoded event body map. */
/**
 * Pull a displayable amount out of an event body.
 *
 * The v2 events carry different field names per contract — a wrap reports `underlying_in`, a mint
 * reports `py_amount`, a swap reports `sr_in`. The order below is "most meaningful to a user
 * first": what they put in or took out, before any internal share figure.
 *
 * `positionId` is retained at 0 because the `Activity` type still carries it, but v2 has no
 * positions — PT and YT are fungible bearer balances. Nothing may use it to address anything.
 */
const readBody = (body: Record<string, unknown>) => ({
  positionId: 0,
  amount: toBig(
    body.underlying_in ??
      body.underlying_out ??
      // `mint_py` and `redeem_py` publish the face as `py_out` / `py_in`. Without these two the
      // lookup fell through to `sr_in` / `sr_out` and printed a count of SR shares beside "USDC".
      body.py_out ??
      body.py_in ??
      body.py_amount ??
      body.principal ??
      // The vault's `redeemed` publishes `paid`. Without it a payout row showed no amount at all.
      body.paid ??
      body.payout ??
      body.net ??
      body.pt_amount ??
      body.yt_amount ??
      body.sr_in ??
      body.sr_out ??
      body.amount,
  ),
});

/**
 * Source 1 — Soroban RPC. Scans the RPC's *actual* retention window rather than a
 * guessed lookback. The RPC reveals its retained range in the error message it
 * returns when `startLedger` is out of range (`"startLedger must be within the
 * ledger range: <oldest> - <latest>"`), so we probe with `startLedger:1`, parse
 * the oldest retained ledger, and scan from there with pagination.
 */
const fetchRpcEvents = async (): Promise<RawEvent[]> => {
  // Discover the oldest ledger the RPC still retains by deliberately asking for one
  // that's too old and reading the range out of the error.
  let startLedger = 1;
  try {
    await server.getEvents({
      startLedger: 1,
      filters: [{ type: 'contract', contractIds: EVENT_CONTRACTS }],
      limit: 1,
    });
    // No error → ledger 1 is somehow in range (fresh network); start from 1.
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const m = msg.match(/ledger range:\s*(\d+)\s*-\s*(\d+)/i);
    if (m) {
      // Start a small margin inside the window so the boundary can't drift past us
      // between this call and the scan below.
      startLedger = Number(m[1]) + 5;
    } else {
      // Unparseable error — RPC is unavailable; let the caller fall back.
      return [];
    }
  }

  const out: RawEvent[] = [];
  let cursor: string | undefined;
  // Page through the whole window (each page ≤ 100 events). Bounded to avoid a
  // runaway loop if the RPC keeps handing back cursors.
  for (let page = 0; page < 20; page++) {
    let raw: Awaited<ReturnType<typeof server.getEvents>>;
    try {
      raw = await server.getEvents(
        cursor
          ? {
              filters: [{ type: 'contract', contractIds: EVENT_CONTRACTS }],
              cursor,
              limit: 100,
            }
          : {
              startLedger,
              filters: [{ type: 'contract', contractIds: EVENT_CONTRACTS }],
              limit: 100,
            },
      );
    } catch {
      break;
    }
    const events = raw.events ?? [];
    for (const ev of events) {
      const topics = (ev.topic ?? []).map((t) => String(nativeOrEmpty(t) ?? ''));
      const name = topics[0] ?? '';
      if (!isRelevant(name)) continue;
      out.push({
        id: ev.id,
        tx: ev.txHash,
        name,
        topics: topics.slice(1),
        body: (nativeOrEmpty(ev.value) as Record<string, unknown>) ?? {},
        at: Math.floor(Date.parse(ev.ledgerClosedAt) / 1000) || 0,
        ledger: ev.ledger,
        explorerUrl: explorerTx(ev.txHash),
      });
    }
    cursor = raw.cursor;
    if (!cursor || events.length === 0) break;
  }
  return out;
};

type ExplorerEvent = {
  id: string;
  ts: number;
  topics?: string[];
  topicsXdr?: string[];
  bodyXdr?: string;
};

/**
 * Source 2 — the backend `/activity` proxy (which fronts stellar.expert). Retains
 * full contract history, so it covers events the RPC has aged out. Topics come
 * pre-decoded (`topics`), while the struct body arrives as base64 XDR we decode
 * with the same `scValToNative`. The proxy exists because stellar.expert refuses
 * cross-origin browser requests (403); the server has no such constraint.
 */
const fetchExplorerEvents = async (): Promise<RawEvent[]> => {
  const network = NETWORK_KEY === 'mainnet' ? 'public' : 'testnet';
  let records: ExplorerEvent[];
  try {
    // Always the proxy's maximum, whatever the feed goes on to show. One user action is several
    // events across several contracts, and a short page can cut a transaction in half — leaving its
    // plumbing on screen without the router event that explains it.
    const res = await fetch(
      `${BACKEND_URL}/activity?contract=${EVENT_CONTRACTS.join(',')}&network=${network}&limit=100`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { records?: ExplorerEvent[] };
    records = json.records ?? [];
  } catch {
    return [];
  }

  const out: RawEvent[] = [];
  for (const rec of records) {
    // Prefer the pre-decoded topics; fall back to decoding topicsXdr.
    const topics = rec.topics ?? (rec.topicsXdr ?? []).map(decodeXdrTopic);
    const name = topics[0] ?? '';
    if (!isRelevant(name)) continue;

    let body: Record<string, unknown> = {};
    if (rec.bodyXdr) {
      try {
        body =
          (scValToNative(xdr.ScVal.fromXDR(rec.bodyXdr, 'base64')) as Record<string, unknown>) ?? {};
      } catch {
        // Leave it empty; still show the row.
      }
    }

    out.push({
      id: rec.id,
      // The paging token is `<operation id>-<event index>`: everything before the dash is shared by
      // every event one transaction emitted.
      tx: rec.id.split('-')[0],
      name,
      topics: topics.slice(1),
      body,
      at: rec.ts,
      // Explorer events don't carry a tx hash here — link to the contract page.
      explorerUrl: explorerContract(ACTIVITY_CONTRACTS[0] ?? ''),
      // Use the timestamp as a monotonic sort key (newest-first).
      ledger: rec.ts,
    });
  }
  return out;
};

const decodeXdrTopic = (b64: string): string => {
  try {
    return String(scValToNative(xdr.ScVal.fromXDR(b64, 'base64')) ?? '');
  } catch {
    return '';
  }
};

const SCALE_12 = 10n ** 12n;

/**
 * What a routed call was, read off the router's own event: `["router", <action>, user]`.
 *
 * These are the only events that state a routed action in the user's terms — who it was for and
 * how much USDC went in or came out. Only the buys, the claim and a redemption at maturity are
 * shareable; a sale or an early exit is not something anyone posts.
 */
const routedRow = (
  action: string,
  b: Record<string, unknown>,
): Pick<Activity, 'kind' | 'amount' | 'share'> | null => {
  switch (action) {
    case 'buy_pt':
      return {
        kind: 'Swap',
        amount: toBig(b.usdc_in),
        share: { type: 'buyPt', paid: toBig(b.usdc_in), pt: toBig(b.pt_out) },
      };
    case 'sell_pt':
      return { kind: 'Swap', amount: toBig(b.usdc_out) };
    case 'buy_yt':
      return {
        kind: 'YtTrade',
        amount: toBig(b.usdc_spent),
        share: { type: 'buyYt', paid: toBig(b.usdc_spent), yt: toBig(b.yt_out) },
      };
    case 'sell_yt':
      return { kind: 'YtTrade', amount: toBig(b.usdc_out) };
    case 'redeem':
      return {
        kind: 'RedeemPt',
        amount: toBig(b.usdc_out),
        share: b.after_expiry === true ? { type: 'redeemPar', pt: toBig(b.py_in) } : undefined,
      };
    case 'claim':
      return {
        kind: 'Claim',
        amount: toBig(b.usdc_out),
        share: { type: 'claim', amount: toBig(b.usdc_out), unit: 'USDC' },
      };
    default:
      return null;
  }
};

/** The card facts for an event the user called directly, with no router in between. */
const directShare = (
  kind: ActivityKind,
  e: RawEvent,
  siblings: RawEvent[],
): ActivityShare | undefined => {
  const b = e.body;
  switch (kind) {
    case 'VaultDeposit':
      return {
        type: 'vaultLock',
        principal: toBig(b.principal),
        payout: toBig(b.payout),
        rateBps: Number(b.rate_bps ?? 0),
      };
    case 'VaultRedeem':
      return { type: 'vaultRedeem', receiptId: toBig(b.receipt_id) };
    case 'Mint':
      return { type: 'mint', usdc: toBig(b.py_out) };
    case 'Claim':
      // No router, so nothing was unwrapped: the claim was paid in SR and that is what it says.
      return { type: 'claim', amount: toBig(b.net_to_user), unit: 'SR' };
    case 'YtTrade': {
      if (b.is_buy !== true) return undefined;
      // The market states the cost in SR shares. Buying YT strips PT + YT inside the same
      // transaction, and that `mint_py` records the index it stripped at — which is the price of
      // one SR at that instant. So the USDC cost is exact, not an estimate at today's rate.
      const index = toBig(siblings.find((s) => s.name === 'mint_py')?.body.index);
      if (index <= 0n) return undefined;
      return {
        type: 'buyYt',
        paid: (toBig(b.sr_amount) * index) / SCALE_12,
        yt: toBig(b.yt_amount),
      };
    }
    default:
      return undefined;
  }
};

/**
 * Turn raw events into feed rows — one per thing a user did.
 *
 * ## A routed transaction is ONE row, taken from the router
 *
 * A PT bought through the app is a `sr_deposit` and a `swap`, both performed BY THE ROUTER: the
 * wallet that asked for them appears in neither, and the amounts are SR shares. Listed as they
 * come, that purchase is two rows attributed to a contract and — the reason this was rewritten —
 * no row at all under "Mine". Only the router's own event names the wallet and the USDC.
 *
 * So events are grouped by transaction. Where the router spoke, its event IS the row and the rest
 * of that transaction is plumbing, dropped; listing both is what would double every action. Where
 * it did not, the call went straight to a contract and each event stands as a row, as before.
 */
const toActivities = (raw: RawEvent[]): Activity[] => {
  const byTx = new Map<string, RawEvent[]>();
  for (const e of raw) {
    const group = byTx.get(e.tx);
    if (group) group.push(e);
    else byTx.set(e.tx, [e]);
  }

  const out: Activity[] = [];
  for (const group of byTx.values()) {
    const routed = group.filter((e) => e.name === 'router');
    if (routed.length > 0) {
      for (const e of routed) {
        const row = routedRow(e.topics[0] ?? '', e.body);
        if (!row) continue;
        out.push({
          id: e.id,
          user: e.topics[1] ?? '',
          positionId: 0,
          explorerUrl: e.explorerUrl,
          ledger: e.ledger,
          at: e.at,
          ...row,
        });
      }
      continue;
    }
    for (const e of group) {
      const kind = EVENT_NAME_TO_KIND[e.name];
      if (!kind) continue;
      out.push({
        id: e.id,
        kind,
        user: e.topics[0] ?? '',
        ...readBody(e.body),
        explorerUrl: e.explorerUrl,
        ledger: e.ledger,
        at: e.at,
        share: directShare(kind, e, group),
      });
    }
  }
  return out;
};

export const getRecentActivity = async (limit = 25): Promise<Activity[]> => {
  // Prefer the RPC (authoritative, freshest). If it has nothing — the usual case
  // once a deployment is older than the RPC's retention window — fall back to the
  // full-history explorer index so real past transactions still show.
  const rpc = await fetchRpcEvents();
  const items = toActivities(rpc.length > 0 ? rpc : await fetchExplorerEvents());
  items.sort((a, b) => b.ledger - a.ledger);
  return items.slice(0, limit);
};
