import type { Article } from '../types';

export const article: Article = {
  slug: 'usdc-yield-on-stellar',
  title: 'USDC Yield on Stellar: What Your Stablecoins Can Earn',
  seoTitle: 'USDC Yield on Stellar: The Guide',
  description:
    'Every way USDC earns yield on Stellar (variable lending, fixed rates, and LP fees) plus how to tell real yield from token emissions before you deposit.',
  category: 'stellar',
  intent: 'informational',
  audience: 'beginner',
  primaryKeyword: 'USDC yield Stellar',
  keywords: [
    'USDC yield Stellar',
    'USDC interest Stellar',
    'earn on USDC Stellar',
    'Stellar stablecoin yield',
    'USDC APY Stellar',
    'lend USDC Stellar',
    'fixed rate USDC',
  ],
  datePublished: '2026-08-01',
  dateModified: '2026-08-01',
  readingMinutes: 0,
  body: [
    {
      type: 'answerBox',
      question: 'How does USDC earn yield on Stellar?',
      answer:
        'USDC on Stellar earns yield three main ways: supply it to Blend’s lending market for a variable rate, lock a fixed rate through Spield, or provide liquidity and earn trading fees. All three are non-custodial, settle in Stellar-native USDC, and pay from real economic activity rather than token emissions.',
    },
    {
      type: 'keyTakeaways',
      items: [
        'USDC is **natively issued by Circle on Stellar**: no bridging required to start earning.',
        'The **variable route** is [Blend](/glossary/blend-capital) lending; the rate floats with borrower demand.',
        'The **fixed route** is Spield: a [vault receipt](/learn/what-is-a-fixed-rate-vault) or a discounted [PT](/glossary/principal-token).',
        'The **LP route** earns swap fees on the PT/USDC market.',
        'Judge every rate by its source. **Real yield has a payer**; emissions have a countdown.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'What makes Stellar different for stablecoin yield?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Stellar’s edge for a USDC holder is the absence of friction: Circle issues USDC natively on the network, transactions cost fractions of a cent and settle in seconds, and none of the yield below requires bridging anything from anywhere. Your dollars arrive, earn, and leave on one set of rails. For stablecoins, where the whole point is calm, that short list of moving parts is the feature.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'The variable route: lending on Blend',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Supplying USDC to a [Blend](/learn/what-is-blend-capital) lending pool earns the network’s base rate: borrowers post collateral, draw loans, and their interest flows to suppliers block by block. The rate is honest and the rate is restless — it rises when borrowing demand runs hot and sags when it cools, and you find out what you earned after the fact. Flexibility is the compensation: supply and withdraw whenever you like.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'The fixed route: lock a rate with Spield',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Spield takes that same Blend yield and restructures it into certainty, two ways. The [Fixed-Rate Vault](/learn/what-is-a-fixed-rate-vault) is the simple one: deposit USDC, receive a receipt for a known payout at maturity, done. The market route is buying a PT below par — pay, say, 0.97 USDC for a token that redeems at 1.00, and the 3% gap is a fixed return you chose yourself (numbers illustrative).',
    },
    {
      type: 'paragraph',
      text: 'The two suit different temperaments. The vault asks nothing of you after deposit; the [PT](/learn/what-is-a-principal-token) can be sold early if plans change, at whatever price the market then offers. Both end at the same place: a return that was named before you committed.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'The LP route: earn the fees between traders',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Liquidity providers on Spield’s PT/USDC market earn a 0.30% fee on every swap between fixed-rate buyers and yield traders. It is the most active of the three routes: returns depend on trading volume, and mid-life price swings can cost an early-exiting LP some [impermanent loss](/glossary/impermanent-loss). But the pool’s [time-decay design](/learn/time-decay-amms-explained) means that loss trends toward zero for LPs who stay to maturity.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'How do you tell real yield from emissions?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Before any deposit, ask where the money comes from. All three routes above pass the [real-yield](/glossary/real-yield) test with named payers: borrowers pay the lending rate, and traders pay the swap fees. When a rate is instead funded by a protocol printing its own token, the yield is a marketing budget — real while it lasts, and it does not last.',
    },
    {
      type: 'table',
      caption: 'USDC yield routes on Stellar, compared by mechanism',
      headers: ['Route', 'Rate type', 'Who pays the yield', 'Main risk', 'Effort'],
      rows: [
        ['Blend lending', 'Variable', 'Borrowers', 'Rate drops; pool stress', 'Low'],
        ['Spield vault', 'Fixed', 'Borrowers (restructured)', 'Young, unaudited protocol', 'None after deposit'],
        ['Buying PT', 'Fixed (you pick entry)', 'Borrowers (restructured)', 'Price moves if sold early', 'Low'],
        ['PT/USDC LP', 'Fee income', 'Traders', 'Volume dries up; early-exit IL', 'Medium'],
      ],
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'No APY quotes here, on purpose',
      text: 'Every rate above floats with market conditions, so a number printed in an article is stale by the time you read it. Check live rates in the app or on-chain before depositing — and be suspicious of any site that promises otherwise. Spield is on Stellar testnet today and has not yet been audited; size positions like it.',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Do I need to bridge to earn USDC yield on Stellar?',
          a: 'No. USDC is issued natively on Stellar by Circle, so the whole earning loop happens on one network. A bridge only enters the picture if your funds start on another chain.',
        },
        {
          q: 'What is the minimum to start earning?',
          a: 'There is no meaningful minimum beyond your wallet’s XLM reserves (about 1.5 XLM for the account and a USDC trustline) and network fees of fractions of a cent. Start as small as you like; a test deposit is good practice.',
        },
        {
          q: 'Is fixed or variable USDC yield better?',
          a: 'It depends on what you want to be true in six months. Variable can out-earn fixed when borrowing demand surges; fixed pays exactly what it said when demand fades. Splitting between both is a legitimate answer.',
        },
      ],
    },
  ],
  related: [
    { href: '/glossary/real-yield', label: 'Real yield' },
    { href: '/learn/how-to-get-usdc-on-stellar', label: 'How to get USDC on Stellar' },
    { href: '/learn/what-is-a-fixed-rate-vault', label: 'What is a fixed-rate vault?' },
    { href: '/learn/is-blend-capital-safe', label: 'Is Blend Capital safe?' },
    { href: '/learn/fixed-vs-variable-yield', label: 'Fixed vs variable yield' },
    { href: '/learn/best-yield-on-stellar', label: 'Best DeFi yield on Stellar' },
  ],
  sources: [
    { href: 'https://www.circle.com/usdc', label: 'Circle — USDC' },
    { href: 'https://docs.blend.capital/', label: 'Blend Documentation' },
  ],
};
