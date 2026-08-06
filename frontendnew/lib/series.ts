/**
 * The current vault series — the single source of truth for every
 * number shown on the page. Swap these for live protocol data later.
 */
export const SERIES = {
  /** Fixed APY quoted by the vault, in percent */
  rate: 8.42,
  /** Example deposit used across the page, in USDC */
  deposit: 10_000,
  /** Guaranteed redemption for that deposit, in USDC */
  payout: 10_343.42,
  /** Human-readable maturity date */
  maturity: "31 Dec 2026",
  /** Days from today until maturity */
  days: 149,
  /** PT price implied by the fixed rate */
  ptPrice: 0.9668,
  /** YT price — the complement (ptPrice + ytPrice === 1) */
  ytPrice: 0.0332,
  /** Yield exposure per dollar of YT (≈ 1 / ytPrice) */
  ytLeverage: 30,
  /** Demo starting points for the live counters */
  ledgerStart: 60_842_117,
  backingStart: 4_821_337,
} as const;

export const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtInt = (n: number) => n.toLocaleString("en-US");
