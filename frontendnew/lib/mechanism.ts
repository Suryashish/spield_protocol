/**
 * The three beats of the mechanism, in words.
 *
 * The cards in `components/SplitSection.tsx` carry no visible text —
 * the footage tells the story — so these strings are the only place the
 * mechanism is actually written down. They are read twice: once into
 * the cards' screen-reader label, and once into the HowTo JSON-LD in
 * `app/page.tsx`. Keeping them here means the two can never disagree,
 * which is the same rule `lib/faq.ts` holds itself to.
 *
 * The visuals — tone, deal order, which reel plays — stay in the
 * component. This file is the copy, and nothing else.
 */

export type Beat = {
  /** the numeral engraved on the card */
  index: string;
  /** ordinal, spelled out, for the screen-reader label */
  ordinal: string;
  /** the beat's one-word name — "Deposit", "Split", "Choose" */
  name: string;
  /** what happens in it, in one sentence */
  text: string;
};

export const MECHANISM: Beat[] = [
  {
    index: "01",
    ordinal: "one",
    name: "Deposit",
    text: "Your USDC routes into Blend, Stellar's lending market, and earns the floating rate from the first ledger.",
  },
  {
    index: "02",
    ordinal: "two",
    name: "Split",
    text: "Spield separates the position into PT, the principal that comes back, and YT, every unit of yield it earns before maturity.",
  },
  {
    index: "03",
    ordinal: "three",
    name: "Choose",
    text: "Hold PT and redeem exactly 1.0000 at maturity, or hold YT and carry a full position's yield for a sliver of the capital.",
  },
];

/** The label the cards announce, assembled from the beat's own words. */
export const beatLabel = (b: Beat) => `Step ${b.ordinal} — ${b.name}. ${b.text}`;

/** Named for the schema and the section heading, which should agree. */
export const MECHANISM_TITLE = "How Spield turns a USDC deposit into a fixed rate on Stellar";
