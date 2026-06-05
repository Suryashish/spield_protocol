import { scValToNative } from '@stellar/stellar-sdk';

import { CONTRACTS } from './config';
import { server } from './soroban';

/**
 * Live PT-price / implied-APY history for the Markets chart.
 *
 * The Market contract only exposes the *current* `pt_price` / `implied_apy` (both SCALAR_12), with
 * no on-chain time series — so we build one the same honest way the realized-yield chart does
 * (see `lib/yield.ts`):
 *
 *   1. **Historical, from events.** Each `Swap` event carries `{ pt_in, amount_in, amount_out }`
 *      plus a real `ledgerClosedAt`, from which we derive the *executed* PT price at that ledger.
 *   2. **Live, from the pool mid.** On each load we append the current `pt_price` + `implied_apy`
 *      (passed in from `ProtocolContext.marketStats`, which is already refreshed after every write).
 *
 * Samples are merged, de-duplicated and stored in localStorage, so the series grows across visits.
 * Every point is a value the chain actually reported — never fabricated.
 *
 * **Precision:** prices/rates are kept as raw SCALAR_12 *bigint* end-to-end (storage, merge), and
 * only converted to a float at the display edge — the same discipline as `lib/yield.ts`, so tiny
 * deltas never collapse through a JSON float round-trip.
 *
 * Note: swap-derived prices are *executed* prices (they include the fee + price impact), so they
 * bracket the pool mid rather than equal it. We treat the live `pt_price` samples as the primary
 * series and use swap-derived points only to backfill history.
 */

const SCALE_12 = 10n ** 12n;

const LS_KEY = 'spield.marketHistory.v1';

/** Same lookback tiers as the activity / yield feeds — testnet RPC retains a bounded window. */
const LOOKBACK_TIERS = [9000, 4000, 1000];

/** A single observation of the market: PT price + implied APY, full SCALAR_12 integer precision. */
export type MarketSample = {
  /** Unix seconds. */
  t: number;
  /** PT price in USDC, SCALAR_12 (1.0 = par). */
  ptPrice: bigint;
  /** Implied APY fraction, SCALAR_12. `0n` for swap-derived rows (the event carries no APY). */
  impliedApy: bigint;
};

export type MarketHistory = {
  /** Time-ordered samples (oldest first). */
  samples: MarketSample[];
  /** Most recent sample, if any. */
  latest: MarketSample | null;
  /** Length of the observed window, in seconds. */
  windowSecs: number;
};

const decodeSym = (val: unknown): string => {
  try {
    return String(scValToNative(val as never));
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

// ---------------------------------------------------------------- persistence

type StoredSample = { t: number; ptPrice: string; impliedApy: string };

const loadStored = (): MarketSample[] => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredSample[];
    if (!Array.isArray(parsed)) return [];
    const out: MarketSample[] = [];
    for (const s of parsed) {
      if (!s || typeof s.t !== 'number') continue;
      try {
        const ptPrice = BigInt(s.ptPrice);
        const impliedApy = BigInt(s.impliedApy ?? '0');
        if (ptPrice > 0n) out.push({ t: s.t, ptPrice, impliedApy });
      } catch {
        // skip malformed entry
      }
    }
    return out;
  } catch {
    return [];
  }
};

const saveStored = (samples: MarketSample[]) => {
  try {
    const serializable: StoredSample[] = samples.map((s) => ({
      t: s.t,
      ptPrice: s.ptPrice.toString(),
      impliedApy: s.impliedApy.toString(),
    }));
    localStorage.setItem(LS_KEY, JSON.stringify(serializable));
  } catch {
    // Storage unavailable / quota — non-fatal; the chart still renders this session.
  }
};

/**
 * Merge new samples into existing ones: dedupe by timestamp (rounded to the minute), keep ordered,
 * and bound the series length. Price is *not* monotonic, so on a minute collision we prefer the row
 * with a non-zero `impliedApy` (a real live curve read) over a swap-derived backfill row, else keep
 * the later `t`.
 */
const merge = (existing: MarketSample[], incoming: MarketSample[]): MarketSample[] => {
  const byMinute = new Map<number, MarketSample>();
  for (const s of [...existing, ...incoming]) {
    const key = Math.floor(s.t / 60);
    const prev = byMinute.get(key);
    if (!prev) {
      byMinute.set(key, s);
      continue;
    }
    const prevIsLive = prev.impliedApy > 0n;
    const curIsLive = s.impliedApy > 0n;
    if (curIsLive && !prevIsLive) byMinute.set(key, s);
    else if (curIsLive === prevIsLive && s.t >= prev.t) byMinute.set(key, s);
  }
  const merged = [...byMinute.values()].sort((a, b) => a.t - b.t);
  return merged.length > 2000 ? merged.slice(merged.length - 2000) : merged;
};

// ---------------------------------------------------------------- fetch

/** Reconstruct executed PT prices from the market's `Swap` events. */
const sampleFromEvents = async (): Promise<MarketSample[]> => {
  let latestSeq: number;
  try {
    latestSeq = (await server.getLatestLedger()).sequence;
  } catch {
    return [];
  }

  let events: Awaited<ReturnType<typeof server.getEvents>>['events'] = [];
  for (const lookback of LOOKBACK_TIERS) {
    const startLedger = Math.max(1, latestSeq - lookback);
    try {
      const raw = await server.getEvents({
        startLedger,
        filters: [{ type: 'contract', contractIds: [CONTRACTS.market] }],
        limit: 100,
      });
      events = raw.events ?? [];
      if (events.length > 0) break;
    } catch {
      // try a shorter window
    }
  }

  const out: MarketSample[] = [];
  for (const ev of events) {
    const topics = ev.topic ?? [];
    if (topics.length === 0 || decodeSym(topics[0]) !== 'swap') continue;

    let body: Record<string, unknown>;
    try {
      body = (scValToNative(ev.value) as Record<string, unknown>) ?? {};
    } catch {
      continue;
    }
    const amountIn = toBig(body.amount_in);
    const amountOut = toBig(body.amount_out);
    const ptIn = Boolean(body.pt_in);
    if (amountIn <= 0n || amountOut <= 0n) continue;

    // Executed PT price (USDC per PT), SCALAR_12, integer-only.
    //   buy  (pt_in == false, USDC→PT): price = usdc_in / pt_out
    //   sell (pt_in == true,  PT→USDC): price = usdc_out / pt_in
    const ptPrice = ptIn
      ? (amountOut * SCALE_12) / amountIn
      : (amountIn * SCALE_12) / amountOut;
    if (ptPrice <= 0n) continue;

    const t = Math.floor(new Date(ev.ledgerClosedAt).getTime() / 1000);
    if (!Number.isFinite(t) || t <= 0) continue;
    out.push({ t, ptPrice, impliedApy: 0n });
  }
  return out;
};

/**
 * Build the market history: backfill executed prices from `Swap` events, append the live pool mid
 * (`pt_price` + `implied_apy`) at `nowSecs`, persist the merged union, and return the series.
 */
export const getMarketHistory = async (
  nowSecs: number,
  live: { ptPrice: bigint; impliedApy: bigint } | null,
): Promise<MarketHistory> => {
  const eventSamples = await sampleFromEvents();

  const fresh: MarketSample[] = [...eventSamples];
  if (live && live.ptPrice > 0n) {
    fresh.push({ t: nowSecs, ptPrice: live.ptPrice, impliedApy: live.impliedApy });
  }

  const samples = merge(loadStored(), fresh);
  saveStored(samples);

  const windowSecs = samples.length >= 2 ? samples[samples.length - 1].t - samples[0].t : 0;
  return {
    samples,
    latest: samples.length ? samples[samples.length - 1] : null,
    windowSecs,
  };
};
