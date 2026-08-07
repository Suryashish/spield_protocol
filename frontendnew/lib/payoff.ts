import { SERIES } from "./series";

/**
 * The payoff maths behind the yield market.
 *
 * One deposit splits into PT and YT. PT redeems exactly 1.0000 at
 * maturity whatever happens; YT collects whatever yield the position
 * actually earns over the term. So the two are a straight bet on the
 * same number — the realized rate — and they cross at exactly the rate
 * the market has already priced in.
 *
 * Simple interest throughout, which is the convention the published
 * prices were struck on.
 */

/** Fraction of a year left on the series. */
export const TERM = SERIES.days / 365;

/** Growth factor on 1.0000 of notional at the quoted rate over the term. */
const GROWTH = 1 + (SERIES.rate / 100) * TERM;

/* Prices are derived here rather than read off SERIES. The published
   0.9668 / 0.0332 are these same numbers rounded for print, and rounding
   before the maths drags the crossing point ~0.01pp off the quoted rate —
   visible in the readouts at the exact spot the story says the two are
   identical. SERIES keeps the display values; this keeps the exact ones. */

/** What one PT costs today, and what it is always worth at maturity. */
export const PT_COST = 1 / GROWTH;
export const PT_REDEEM = 1;
/** Fixed the moment you buy: the whole point of PT. */
export const PT_RETURN = GROWTH - 1;

/** What one YT costs today — the complement, because the two are one deposit. */
export const YT_COST = 1 - PT_COST;

/* SERIES is `as const`, so its members carry literal types — widened here
   because these are dragged, not fixed */
/** The rate already in the price. Above it YT wins, below it PT does. */
export const IMPLIED: number = SERIES.rate;

/** Widest realized rate the chart entertains — roughly 3x the implied. */
export const RATE_MAX = 24;

/** What one YT redeems for: the yield 1.0000 of notional throws off. */
export const ytRedeem = (apy: number) => (apy / 100) * TERM;

/** Return on YT, as a fraction. -1 at zero yield; unbounded above. */
export const ytReturn = (apy: number) => ytRedeem(apy) / YT_COST - 1;

/** Value at maturity per 1.0000 invested — the axis both instruments share. */
export const ytMultiple = (apy: number) => ytRedeem(apy) / YT_COST;
export const PT_MULTIPLE = PT_REDEEM / PT_COST;

/** Top of that axis, with headroom over YT's best case on the chart. */
export const MULT_MAX = 3;

/** Yield the position throws off per 1.0000 of YT bought — the leverage. */
export const LEVERAGE = 1 / YT_COST;

export const pct = (v: number, dp = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(dp)}%`;
