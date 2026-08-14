/**
 * The current vault series — the single source of truth for every
 * number shown on the page.
 *
 * Everything here is ILLUSTRATIVE. These are worked examples chosen to
 * explain the mechanism, not quotes and not readings off the chain:
 * Spield is deployed on Stellar testnet and publishes no live figures
 * yet. So the page marks them wherever they surface (see
 * `components/Illustrative.tsx`) rather than dressing an invented
 * number up as a reading. Swap these for live protocol data later, and
 * drop the markers in the same commit.
 */

/**
 * What `amount` comes back as at maturity. Simple interest — the same
 * convention `lib/payoff.ts` strikes the published PT/YT prices on, so
 * every figure on the page comes off one formula.
 */
export const quote = (amount: number, ratePct: number, days: number) =>
  amount * (1 + (ratePct / 100) * (days / 365));

/* The three inputs the rest of the series is derived from. Held apart
   so `payout` can be computed rather than typed: the hand-written
   10,343.42 it replaces was 30 cents off its own rate, which is the
   kind of thing a page about exact payouts cannot afford. */
const RATE = 8.42;
const DEPOSIT = 10_000;
const DAYS = 149;

export const SERIES = {
  /** Fixed APY quoted by the vault, in percent */
  rate: RATE,
  /** Example deposit used across the page, in USDC */
  deposit: DEPOSIT,
  /** What that deposit redeems for at maturity, in USDC */
  payout: quote(DEPOSIT, RATE, DAYS),
  /** Human-readable maturity date */
  maturity: "31 Dec 2026",
  /** Days from today until maturity */
  days: DAYS,
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

/** Where the protocol actually runs today — stated, never implied. */
export const NETWORK = "Stellar testnet";

/**
 * The one sentence behind every `<Illustrative />` marker on the page.
 * Kept here so the marker, the footer disclosure and the FAQ answer
 * can never drift apart from each other.
 */
export const ILLUSTRATIVE_NOTE =
  `Illustrative example, not a live quote — Spield runs on ${NETWORK} and publishes no live rates yet.`;

export const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtInt = (n: number) => n.toLocaleString("en-US");
