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

/** ~17,000 ledgers ≈ the recent RPC retention window on testnet. */
const LOOKBACK_LEDGERS = 16000;

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
  let startLedger: number;
  try {
    const latest = await server.getLatestLedger();
    startLedger = Math.max(1, latest.sequence - LOOKBACK_LEDGERS);
  } catch {
    return [];
  }

  let raw;
  try {
    raw = await server.getEvents({
      startLedger,
      filters: [{ type: 'contract', contractIds: [CONTRACTS.wrapper] }],
      limit: 100,
    });
  } catch {
    // RPC may reject the start ledger if it's outside retention; degrade gracefully.
    return [];
  }

  const out: Activity[] = [];
  for (const ev of raw.events ?? []) {
    const topics = ev.topic ?? [];
    if (topics.length === 0) continue;
    const kind = decodeSym(topics[0]) as ActivityKind;
    if (!['Mint', 'Claim', 'RedeemPt', 'Combine', 'TransferPosition'].includes(kind)) continue;

    // topic[1] is the #[topic] user/from address (when present).
    const user = topics[1] ? String(scValToNative(topics[1])) : '';

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
