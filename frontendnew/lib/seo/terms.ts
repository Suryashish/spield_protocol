/**
 * The vocabulary this page uses, defined.
 *
 * Emitted as a `DefinedTermSet` in the page's JSON-LD. Two reasons it
 * earns the bytes: `DefinedTerm` is under-published, so a correct one
 * lands in a thin citation pool rather than a crowded one; and a page
 * that says "PT" fourteen times without ever writing "a Principal Token
 * is…" gives an answer engine nothing to lift. The visible copy is
 * deliberately spare — the definitions belong somewhere, and this is it.
 *
 * Every definition is a copula sentence ("X is a …") because that is the
 * shape models extract most reliably, and every one is either generally
 * true of the concept or explicitly attributed to Spield. Nothing here
 * asserts a number: the figures on the page are worked examples, and a
 * definition is not the place to quietly promote one.
 */

export type Term = {
  term: string;
  /** other names the same thing goes by, for entity matching */
  aliases?: string[];
  definition: string;
};

export const TERMS: Term[] = [
  {
    term: "Fixed income",
    definition:
      "Fixed income is a class of investment that pays a predetermined return over a set period, so the payout is known when the position is opened rather than discovered when it closes.",
  },
  {
    term: "Principal Token (PT)",
    aliases: ["PT", "Principal Token"],
    definition:
      "A Principal Token (PT) is a token representing the principal of a yield-bearing deposit, which redeems 1:1 for the underlying asset at maturity. Because it can be bought below par and always redeems at par, buying a PT is how a fixed rate is locked.",
  },
  {
    term: "Yield Token (YT)",
    aliases: ["YT", "Yield Token"],
    definition:
      "A Yield Token (YT) is a token representing all the yield a deposit generates between now and maturity. It collects that yield as it accrues and is worth nothing once maturity passes.",
  },
  {
    term: "Yield tokenization",
    definition:
      "Yield tokenization is the process of splitting a yield-bearing position into two separate tradable tokens: a Principal Token that redeems for the principal at maturity, and a Yield Token that captures the yield until then. The two always sum to the value of the position they came from.",
  },
  {
    term: "Maturity",
    definition:
      "Maturity is the date a fixed-income position settles. At maturity a Principal Token redeems 1:1 for the underlying asset and a Yield Token stops accruing and is worth zero.",
  },
  {
    term: "Blend Capital",
    aliases: ["Blend"],
    definition:
      "Blend Capital is the primary decentralized lending market on Stellar, where suppliers deposit assets such as USDC and earn a variable rate funded by the interest borrowers pay. It is the yield source Spield builds on.",
  },
  {
    term: "Fixed-rate vault",
    definition:
      "A fixed-rate vault is a contract that accepts a deposit, quotes the exact amount it will return and the date it will return it before the deposit is made, and pays that amount at maturity regardless of where market yield drifts in between.",
  },
  {
    term: "Implied APY",
    definition:
      "Implied APY is the annualized fixed rate the market is currently pricing into a yield-tokenized position, derived from the price of its Principal Token relative to par. A Yield Token profits when realized yield comes in above the implied APY and decays toward zero below it.",
  },
  {
    term: "Time-decay AMM",
    definition:
      "A time-decay AMM is an automated market maker built for assets that expire, such as Principal Tokens, whose pricing curve shifts toward par as maturity approaches. A conventional constant-product AMM misprices these because it treats the passage of time as irrelevant.",
  },
  {
    term: "Real yield",
    definition:
      "Real yield is return funded by genuine economic activity — interest borrowers actually pay, or fees traders actually pay — rather than by newly minted protocol tokens.",
  },
  {
    term: "Solvency invariant",
    definition:
      "A solvency invariant is a rule enforced in a protocol's smart-contract code guaranteeing that the backing it holds is never less than the value of the tokens it has issued.",
  },
  {
    term: "Non-custodial",
    definition:
      "Non-custodial describes a protocol where users hold their own private keys and retain control of their assets, rather than depositing them with an operator who holds them on their behalf.",
  },
];

export const TERM_SET_NAME = "Spield glossary — fixed income, yield tokenization and Stellar DeFi";
