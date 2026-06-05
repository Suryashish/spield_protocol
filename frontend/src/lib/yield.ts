import { scValToNative } from '@stellar/stellar-sdk';

import { CONTRACTS } from './config';
import { server } from './soroban';
import { getCurrentRate } from './spield';

/**
 * Realized-yield history for the APY chart.
 *
 * Yield in Spield is *real*: it's the growth of Blend's `b_rate` (a monotonic
 * exchange rate, SCALAR_12) over time. There is no on-chain time series of that
 * rate — the contract only exposes the *current* value — so we build the series
 * from two honest sources and persist it so it grows across visits:
 *
 *   1. **Historical, from events.** Every `mint`/`claim` event carries the `b_rate`
 *      observed at that moment (`entry_rate` / `rate`) plus a real `ledgerClosedAt`
 *      timestamp. These are genuine past observations of the rate.
 *   2. **Live, from `current_rate()`.** A fresh sample at "now".
 *
 * Samples are merged, de-duplicated and stored in localStorage, so the longer the
 * dashboard is used the denser and longer the realized-yield history becomes. We
 * never fabricate points — every sample is a rate the chain actually reported.
 *
 * **Precision:** the rate moves in the 9th–11th decimal place hour-to-hour, so we
 * keep the *raw integer* `b_rate` (SCALAR_12) as a bigint end-to-end — storage,
 * merge, and growth math — and only convert to a floating ratio at the final step.
 * Dividing to a float early (e.g. 1.05575…) and then subtracting near-equal floats
 * silently collapses the tiny real delta to zero — that was the "shows 0.0006 then
 * 0" bug. bigint ratios preserve every digit.
 */

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

const LS_KEY = 'spield.rateHistory.v2';

/** Same lookback tiers as the activity feed — testnet RPC retains a bounded window. */
const LOOKBACK_TIERS = [9000, 4000, 1000];

/** A single observation of the Blend exchange rate, stored at full integer precision. */
export type RateSample = {
  /** Unix seconds. */
  t: number;
  /** Raw `b_rate` in SCALAR_12 fixed point (e.g. 1055750028382n). Monotonic non-decreasing. */
  rate: bigint;
};

export type YieldHistory = {
  /** Time-ordered rate samples (oldest first). */
  samples: RateSample[];
  /**
   * Annualized realized APY across the full observed window, as a fraction
   * (0.08 = 8%). Null until the window is long enough to annualize honestly
   * (see `MIN_APY_WINDOW_SECS`) — extrapolating a few hours to a year is noise.
   */
  apy: number | null;
  /** Cumulative yield since the first observation, as a fraction (always available with ≥2 pts). */
  cumulativeYield: number | null;
  /** Length of the observed window, in seconds. */
  windowSecs: number;
  /** True once the window is long enough for the annualized APY to be meaningful. */
  apyReliable: boolean;
  /** The most recent rate sample, if any. */
  latest: RateSample | null;
};

/**
 * Don't annualize a window shorter than this — Blend's testnet rate moves slowly and
 * extrapolating a handful of hours to a full year produces a meaningless headline.
 * Below it we show cumulative yield + "collecting data" instead of a fake APY.
 */
const MIN_APY_WINDOW_SECS = 24 * 60 * 60;

// ---------------------------------------------------------------- persistence

type StoredSample = { t: number; rate: string };

const loadStored = (): RateSample[] => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredSample[];
    if (!Array.isArray(parsed)) return [];
    const out: RateSample[] = [];
    for (const s of parsed) {
      if (!s || typeof s.t !== 'number' || typeof s.rate !== 'string') continue;
      try {
        const rate = BigInt(s.rate);
        if (rate > 0n) out.push({ t: s.t, rate });
      } catch {
        // skip malformed entry
      }
    }
    return out;
  } catch {
    return [];
  }
};

const saveStored = (samples: RateSample[]) => {
  try {
    const serializable: StoredSample[] = samples.map((s) => ({ t: s.t, rate: s.rate.toString() }));
    localStorage.setItem(LS_KEY, JSON.stringify(serializable));
  } catch {
    // Storage unavailable / quota — non-fatal; the chart still renders this session.
  }
};

/**
 * Merge new samples into existing ones: dedupe by timestamp (rounded to the minute
 * so repeated reads at "now" don't pile up), keep monotonic order, and bound the
 * series length so storage can't grow without limit.
 */
const merge = (existing: RateSample[], incoming: RateSample[]): RateSample[] => {
  const byMinute = new Map<number, RateSample>();
  for (const s of [...existing, ...incoming]) {
    const key = Math.floor(s.t / 60);
    const prev = byMinute.get(key);
    // Keep the higher rate for a given minute (b_rate is non-decreasing).
    if (!prev || s.rate >= prev.rate) byMinute.set(key, s);
  }
  const merged = [...byMinute.values()].sort((a, b) => a.t - b.t);
  // Cap at ~2000 points; drop the oldest if we somehow exceed it.
  return merged.length > 2000 ? merged.slice(merged.length - 2000) : merged;
};

// ---------------------------------------------------------------- fetch

/** Pull historical rate observations carried by wrapper events. */
const sampleFromEvents = async (): Promise<RateSample[]> => {
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
        filters: [{ type: 'contract', contractIds: [CONTRACTS.wrapper] }],
        limit: 100,
      });
      events = raw.events ?? [];
      if (events.length > 0) break;
    } catch {
      // try a shorter window
    }
  }

  const out: RateSample[] = [];
  for (const ev of events) {
    let body: Record<string, unknown>;
    try {
      body = (scValToNative(ev.value) as Record<string, unknown>) ?? {};
    } catch {
      continue;
    }
    // `mint` carries entry_rate; `claim` carries rate. Both are the b_rate at that ledger.
    const raw = body.entry_rate ?? body.rate;
    if (raw == null) continue;
    let rate: bigint;
    try {
      rate = typeof raw === 'bigint' ? raw : BigInt(String(raw));
    } catch {
      continue;
    }
    if (rate <= 0n) continue;
    const t = Math.floor(new Date(ev.ledgerClosedAt).getTime() / 1000);
    if (!Number.isFinite(t) || t <= 0) continue;
    out.push({ t, rate });
  }
  return out;
};

/**
 * Growth ratio (last / first) as a full-precision float, derived from the integer
 * rates so the tiny delta survives. Returns 1.0 if there's no movement.
 */
const growthRatio = (first: bigint, last: bigint): number => {
  if (first <= 0n) return 1;
  // Scale the numerator so integer division retains ~15 significant digits before
  // the float conversion. (last/first is ~1.0000000x; we need the trailing digits.)
  const SCALE = 10n ** 15n;
  const scaled = (last * SCALE) / first; // integer, ≈ 1e15 * ratio
  return Number(scaled) / 1e15;
};

/** Growth stats from the first to the last sample. */
const computeStats = (
  samples: RateSample[],
): {
  cumulativeYield: number | null;
  apy: number | null;
  windowSecs: number;
  apyReliable: boolean;
} => {
  if (samples.length < 2) {
    return { cumulativeYield: null, apy: null, windowSecs: 0, apyReliable: false };
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dt = last.t - first.t;
  if (dt <= 0 || first.rate <= 0n) {
    return { cumulativeYield: null, apy: null, windowSecs: Math.max(0, dt), apyReliable: false };
  }
  const ratio = growthRatio(first.rate, last.rate);
  const cumulativeYield = ratio - 1;
  const apyReliable = dt >= MIN_APY_WINDOW_SECS;
  // Only annualize once the window is long enough to be meaningful.
  const apyRaw = Math.pow(ratio, SECONDS_PER_YEAR / dt) - 1;
  const apy = apyReliable && Number.isFinite(apyRaw) ? apyRaw : null;
  return { cumulativeYield, apy, windowSecs: dt, apyReliable };
};

/**
 * Cumulative yield (fraction) of a sample relative to the series baseline — used to
 * plot the curve. Full-precision via the integer ratio.
 */
export const sampleYield = (baseline: bigint, rate: bigint): number => growthRatio(baseline, rate) - 1;

/**
 * Build the realized-yield history: load stored samples, fold in fresh observations
 * from events + a live `current_rate()` reading, persist the union, and return the
 * series plus the derived stats.
 */
export const getYieldHistory = async (nowSecs: number): Promise<YieldHistory> => {
  const [eventSamples, liveRate] = await Promise.all([sampleFromEvents(), getCurrentRate()]);

  const fresh: RateSample[] = [...eventSamples];
  if (liveRate != null && liveRate > 0n) {
    fresh.push({ t: nowSecs, rate: liveRate });
  }

  const samples = merge(loadStored(), fresh);
  saveStored(samples);

  const { cumulativeYield, apy, windowSecs, apyReliable } = computeStats(samples);
  return {
    samples,
    apy,
    cumulativeYield,
    windowSecs,
    apyReliable,
    latest: samples.length ? samples[samples.length - 1] : null,
  };
};
