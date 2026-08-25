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
 * ## Why the router is deliberately absent
 *
 * `srrouter` emits its own end-to-end events, and including them would double every row: a routed
 * PT buy already shows up here as the `sr_deposit` and `swap` it actually performed. The router
 * composes existing calls rather than replacing them, so watching the contracts that hold the funds
 * captures everything with no duplicates. (It also uses a two-level topic layout —
 * `["router", "buy_pt", user]` — which this parser, which expects `[name, user]`, would misread.)
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
};

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
      body.py_amount ??
      body.principal ??
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
const fetchRpcEvents = async (): Promise<Activity[]> => {
  // Discover the oldest ledger the RPC still retains by deliberately asking for one
  // that's too old and reading the range out of the error.
  let startLedger = 1;
  try {
    await server.getEvents({
      startLedger: 1,
      filters: [{ type: 'contract', contractIds: ACTIVITY_CONTRACTS }],
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

  const out: Activity[] = [];
  let cursor: string | undefined;
  // Page through the whole window (each page ≤ 100 events). Bounded to avoid a
  // runaway loop if the RPC keeps handing back cursors.
  for (let page = 0; page < 20; page++) {
    let raw: Awaited<ReturnType<typeof server.getEvents>>;
    try {
      raw = await server.getEvents(
        cursor
          ? {
              filters: [{ type: 'contract', contractIds: ACTIVITY_CONTRACTS }],
              cursor,
              limit: 100,
            }
          : {
              startLedger,
              filters: [{ type: 'contract', contractIds: ACTIVITY_CONTRACTS }],
              limit: 100,
            },
      );
    } catch {
      break;
    }
    const events = raw.events ?? [];
    for (const ev of events) {
      const topics = ev.topic ?? [];
      if (topics.length === 0) continue;
      const kind = EVENT_NAME_TO_KIND[String(nativeOrEmpty(topics[0]) ?? '')];
      if (!kind) continue;
      const user = topics[1] ? String(nativeOrEmpty(topics[1]) ?? '') : '';
      const body = (nativeOrEmpty(ev.value) as Record<string, unknown>) ?? {};
      const { positionId, amount } = readBody(body);
      out.push({
        id: `${ev.txHash}-${out.length}`,
        kind,
        user,
        positionId,
        amount,
        explorerUrl: explorerTx(ev.txHash),
        ledger: ev.ledger,
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
const fetchExplorerEvents = async (limit: number): Promise<Activity[]> => {
  const network = NETWORK_KEY === 'mainnet' ? 'public' : 'testnet';
  let records: ExplorerEvent[] = [];
  try {
    const res = await fetch(
      `${BACKEND_URL}/activity?contract=${ACTIVITY_CONTRACTS.join(',')}` +
        `&network=${network}&limit=${Math.min(limit, 100)}`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { records?: ExplorerEvent[] };
    records = json.records ?? [];
  } catch {
    return [];
  }

  const out: Activity[] = [];
  for (const rec of records) {
    // Prefer the pre-decoded topics; fall back to decoding topicsXdr.
    const rawName = rec.topics?.[0] ?? (rec.topicsXdr?.[0] ? decodeXdrSym(rec.topicsXdr[0]) : '');
    const kind = EVENT_NAME_TO_KIND[rawName];
    if (!kind) continue;
    const user = rec.topics?.[1] ?? (rec.topicsXdr?.[1] ? decodeXdrAddr(rec.topicsXdr[1]) : '');

    let positionId = 0;
    let amount = 0n;
    if (rec.bodyXdr) {
      try {
        const body = (scValToNative(xdr.ScVal.fromXDR(rec.bodyXdr, 'base64')) as Record<
          string,
          unknown
        >) ?? {};
        ({ positionId, amount } = readBody(body));
      } catch {
        // Leave defaults; still show the row.
      }
    }

    out.push({
      id: rec.id,
      kind,
      user,
      positionId,
      amount,
      // Explorer events don't carry a tx hash here — link to the contract page.
      explorerUrl: explorerContract(ACTIVITY_CONTRACTS[0] ?? ''),
      // Use the timestamp as a monotonic sort key (newest-first).
      ledger: rec.ts,
    });
  }
  return out;
};

const decodeXdrSym = (b64: string): string => {
  try {
    return String(scValToNative(xdr.ScVal.fromXDR(b64, 'base64')) ?? '');
  } catch {
    return '';
  }
};

const decodeXdrAddr = (b64: string): string => {
  try {
    return String(scValToNative(xdr.ScVal.fromXDR(b64, 'base64')) ?? '');
  } catch {
    return '';
  }
};

export const getRecentActivity = async (limit = 25): Promise<Activity[]> => {
  // Prefer the RPC (authoritative, freshest). If it has nothing — the usual case
  // once a deployment is older than the RPC's retention window — fall back to the
  // full-history explorer index so real past transactions still show.
  const rpc = await fetchRpcEvents();
  const items = rpc.length > 0 ? rpc : await fetchExplorerEvents(limit);
  items.sort((a, b) => b.ledger - a.ledger);
  return items.slice(0, limit);
};
