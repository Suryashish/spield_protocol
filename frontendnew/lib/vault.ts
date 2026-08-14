import { SERIES } from "./series";

/**
 * The Fixed-Rate Vault's series board.
 *
 * The vault is the front door: you pick an amount and a date, and it
 * quotes the exact number that comes back. Everything a quote needs is
 * here — including the one thing that makes the quote trustworthy,
 * which is the capacity it can actually be backed with.
 *
 * Rates rise with the term, as they do on any real curve, so the board
 * teaches the shape of the thing on the way past.
 *
 * ILLUSTRATIVE, like everything in `series.ts` — see the note there.
 */
export type Term = {
  /** the maturity, printed exactly as it is shown; never "in 5 months" */
  maturity: string;
  /** days from today to that date */
  days: number;
  /** the fixed rate the vault quotes for the term, in percent */
  rate: number;
  /**
   * USDC the series can still take. The vault only quotes what it
   * already holds the inventory to cover, so this is a hard edge: past
   * it the deposit is declined rather than promised.
   */
  capacity: number;
};

/* The near date is the page's series — the same rate, term and maturity
   the hero locks — so the vault and the hero can never disagree. The
   two further dates carry the same offsets from the same "today"
   (+90, +92) and more capacity, which is what makes "try a later date"
   an answer rather than a brush-off. */
export const TERMS: Term[] = [
  { maturity: SERIES.maturity, days: SERIES.days, rate: SERIES.rate, capacity: 120_000 },
  { maturity: "31 Mar 2027", days: SERIES.days + 90, rate: 8.94, capacity: 400_000 },
  { maturity: "30 Jun 2027", days: SERIES.days + 182, rate: 9.35, capacity: 900_000 },
];

/** Presets under the amount field — a decade apart, so one tap moves an order of magnitude. */
export const PRESETS = [1_000, SERIES.deposit, 100_000];

/** Nothing on this page pretends to price a deposit past this. */
export const MAX_INPUT = 999_999_999;
