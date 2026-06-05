import { scValToNative, xdr } from '@stellar/stellar-sdk';

import { CONTRACTS } from './config';
import { server } from './soroban';

/**
 * Read recent Spield wrapper events for the activity feed.
 *
 * The wrapper emits `Mint` / `Claim` / `RedeemPt` / `Combine` / `TransferPosition`
 * via `#[contractevent]`: topic[0] is the event-name symbol, the remaining topics
 * are the `#[topic]` fields (the `user` address), and the data map holds the rest
 * (position_id, amount, …). We decode the bits the UI needs.
 *
 * Testnet RPC only retains a window of ledgers, so we start the scan a bounded
 * number of ledgers back from the latest.
 */

export type ActivityKind = 'Mint' | 'Claim' | 'RedeemPt' | 'Combine' | 'TransferPosition';

/**
 * The `#[contractevent]` macro publishes topic[0] as the *snake_case* of the event
 * struct name (e.g. `Mint` → `mint`, `RedeemPt` → `redeem_pt`). Map those wire names
 * back to our PascalCase `ActivityKind`. Without this every event is dropped and the
 * feed renders empty — which is exactly the "activity tab loads nothing" bug.
 */
const EVENT_NAME_TO_KIND: Record<string, ActivityKind> = {
  mint: 'Mint',
  claim: 'Claim',
  redeem_pt: 'RedeemPt',
  combine: 'Combine',
  transfer_position: 'TransferPosition',
};

export type Activity = {
  id: string;
  kind: ActivityKind;
  /** The acting account (event topic). */
  user: string;
  positionId: number;
  /** Amount / payout in base units, when the event carries one. */
  amount: bigint;
  txHash: string;
  ledger: number;
};

/**
 * How far back to scan, in ledgers. The public testnet RPC only retains a bounded
 * window of event history and *silently returns no events* (rather than erroring)
 * when `startLedger` predates it — so an over-long lookback yields an empty feed.
 * We try the largest window first and fall back to shorter ones until events come
 * back. (Empirically ~16k is already past retention; ~9k works.)
 */
const LOOKBACK_TIERS = [9000, 4000, 1000];

const decodeSym = (val: xdr.ScVal): string => {
  try {
    return String(scValToNative(val));
  } catch {
    return '';
  }
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

export const getRecentActivity = async (limit = 25): Promise<Activity[]> => {
  let latestSeq: number;
  try {
    latestSeq = (await server.getLatestLedger()).sequence;
  } catch {
    return [];
  }

  // Walk the lookback tiers from widest to narrowest, stopping at the first that
  // returns events. A wider window is preferable (more history), but if it's past
  // RPC retention it comes back empty, so we step down rather than show nothing.
  let events: Awaited<ReturnType<typeof server.getEvents>>['events'] = [];
  for (const lookback of LOOKBACK_TIERS) {
    const startLedger = Math.max(1, latestSeq - lookback);
    try {
      const raw = await server.getEvents({
        startLedger,
        filters: [{ type: 'contract', contractIds: [CONTRACTS.wrapper] }],
        limit: 100,
      });
      events = raw.events ?? [];
      if (events.length > 0) break;
    } catch {
      // Start ledger outside retention (or transient RPC error): try a shorter window.
    }
  }

  const out: Activity[] = [];
  for (const ev of events) {
    const topics = ev.topic ?? [];
    if (topics.length === 0) continue;
    // topic[0] is the event name in snake_case (e.g. "mint", "redeem_pt").
    const kind = EVENT_NAME_TO_KIND[decodeSym(topics[0])];
    if (!kind) continue;

    // topic[1] is the #[topic] user (for transfers, the `from` address).
    let user = '';
    if (topics[1]) {
      try {
        user = String(scValToNative(topics[1]));
      } catch {
        user = '';
      }
    }

    // The event body is a struct map: { position_id, amount/payout, ... }.
    let body: Record<string, unknown>;
    try {
      body = (scValToNative(ev.value) as Record<string, unknown>) ?? {};
    } catch {
      body = {};
    }
    const positionId = Number(toBig(body.position_id));
    const amount = toBig(body.amount ?? body.payout);

    out.push({
      id: `${ev.txHash}-${out.length}`,
      kind,
      user,
      positionId,
      amount,
      txHash: ev.txHash,
      ledger: ev.ledger,
    });
  }

  // Most recent first.
  out.sort((a, b) => b.ledger - a.ledger);
  return out.slice(0, limit);
};
