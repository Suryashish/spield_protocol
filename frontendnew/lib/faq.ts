import { NETWORK, SERIES } from "./series";

/**
 * The questions the page provokes, answered in the order a first-time
 * reader actually asks them.
 *
 * Short on purpose — two or three sentences, no throat-clearing. A row
 * you can read without deciding to read it gets read; a paragraph gets
 * skipped, and an FAQ nobody opens answers nothing.
 *
 * `a` is a plain string. It is rendered verbatim as the visible answer
 * AND emitted verbatim inside the FAQPage JSON-LD in `app/page.tsx`,
 * and the two must be identical — schema that says something the page
 * does not is worse than no schema at all. Anything that wants to be a
 * link goes in `more`, which sits under the answer and stays out of the
 * structured data.
 *
 * Where the protocol is honestly not there yet — audits, live figures —
 * the answer says so rather than reaching for a softer word.
 */
export type FaqItem = {
  q: string;
  a: string;
  more?: { label: string; href: string };
};

export const FAQ_ITEMS: FaqItem[] = [
  {
    q: "What is Spield?",
    a: `Fixed income on Stellar. Deposit USDC and you get a quote for an exact payout on an exact date, backed by real lending yield. The vault handles the mechanics — you never have to touch them.`,
  },
  {
    q: "Are the numbers on this page real?",
    a: `No. Every figure here is an illustrative example, and marked as one where it appears. Spield runs on ${NETWORK}; real quotes come from the app, read from the contracts when you ask for them.`,
  },
  {
    q: "Where does the yield come from?",
    a: `Blend, a native Stellar lending market. It is interest borrowers actually pay, arriving on-chain as a rising rate. No invented index, no emissions, no bridged assets.`,
  },
  {
    q: "What are PT and YT?",
    a: `The two halves of a split deposit. PT redeems 1:1 at maturity, so buying it below par is how a fixed rate gets locked. YT collects all the yield until maturity, then is worth nothing. Together they always equal the deposit they came from.`,
  },
  {
    q: "How do I get a wallet and USDC on Stellar?",
    a: `Install Freighter, add the USDC trustline, then fund it — buy through a Stellar on-ramp, or bring USDC across from another chain. On testnet you skip that and fund the account free from Friendbot.`,
    more: { label: "Get Freighter", href: "https://www.freighter.app/" },
  },
  {
    q: "Is there a minimum or maximum deposit?",
    a: `No minimum beyond the network fee, which is a fraction of a cent. The maximum is whatever capacity the series has left: the vault declines a size it cannot already cover rather than promising it.`,
  },
  {
    q: "Can I get out before maturity?",
    a: `Yes — nothing is locked up, and you can sell at the market price any time. But the rate is only fixed if you hold: sell early and you get whatever rates say the position is worth that day.`,
  },
  {
    q: "Can I lose money?",
    a: `Yes. Held to maturity, PT pays back principal plus the return locked at purchase; sold early it moves with rates. YT decays toward zero if realized yield comes in under the priced rate — it can go to zero, but never be margin-called, since there is no leverage in the design. On top of that sits contract risk, in Spield and in Blend beneath it.`,
  },
  {
    q: "Is there any bridge or cross-chain risk?",
    a: `Not in the protocol — Spield is Stellar-native end to end. Bringing USDC over from another chain uses a third-party bridge and carries that bridge's risk, but nothing afterwards depends on it.`,
  },
  {
    q: "What happens at maturity?",
    a: `The series settles: PT redeems 1:1 for USDC, YT stops accruing and is worth zero. Redemption stays open afterwards, so nothing is force-closed and nothing expires out from under you.`,
  },
  {
    q: "What fees does Spield charge?",
    a: `A 0.30% swap fee on market trades, which pays the liquidity on the other side. Stellar's network fees are fractions of a cent. A vault deposit is quoted as a payout, so anything the protocol takes is already inside the number you see.`,
  },
  {
    q: "Is Spield live, and has it been audited?",
    a: `It runs on ${NETWORK}, not mainnet, and it has not been audited. Every contract is verifiable on-chain. Treat it as what it is — unaudited software worth exploring, not somewhere to put money you cannot afford to lose.`,
  },
];

/** Named for the schema and the section heading, which should agree. */
export const FAQ_TITLE = `Spield FAQ — fixed-rate yield on Stellar (${SERIES.maturity} series)`;
