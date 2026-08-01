import type { Article } from '../types';

export const article: Article = {
  slug: 'yield-tokenization',
  title: 'Yield Tokenization Explained: How PT and YT Work',
  seoTitle: 'Yield Tokenization Explained (PT & YT)',
  description:
    'Yield tokenization splits a yield-bearing asset into a Principal Token and a Yield Token, letting you lock a fixed rate or trade future yield. A clear guide.',
  category: 'yield-tokenization',
  intent: 'informational',
  audience: 'beginner',
  primaryKeyword: 'yield tokenization',
  keywords: [
    'yield tokenization',
    'yield tokenization explained',
    'yield stripping',
    'what is a principal token',
    'what is a yield token',
    'yield splitting crypto',
  ],
  datePublished: '2026-07-05',
  dateModified: '2026-07-05',
  readingMinutes: 0,
  pillar: true,
  body: [
    {
      type: 'answerBox',
      question: 'What is yield tokenization?',
      answer:
        'Yield tokenization is the process of splitting a yield-bearing asset into two separate tradable tokens: a Principal Token (PT) that redeems for the principal at maturity, and a Yield Token (YT) that captures all the yield until then. This lets you lock in a fixed rate by buying the PT, or speculate on yield by buying the YT. It is the on-chain version of bond stripping.',
    },
    {
      type: 'keyTakeaways',
      items: [
        'Yield tokenization = splitting a deposit into **principal** and **yield** as two tokens.',
        'The **[PT](/glossary/principal-token)** is a zero-coupon bond; the **[YT](/glossary/yield-token)** is the yield stream.',
        'Buy the PT at a discount → **lock a fixed rate**. Buy the YT → **bet yield rises**.',
        'PT value + YT value always equals the underlying — the split is lossless.',
        '**Spield brings yield tokenization to Stellar**, built on real on-chain Blend yield.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'How does yield tokenization work, step by step?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Yield tokenization works by taking a position that earns a variable yield and minting two tokens against it: one that owns the principal and one that owns the yield. You deposit an asset, receive a [PT](/glossary/principal-token) and a [YT](/glossary/yield-token) in equal measure, and from then on the two can be held, sold, or redeemed independently.',
    },
    {
      type: 'steps',
      name: 'How yield tokenization works',
      steps: [
        { title: 'Deposit a yield-bearing asset', text: 'You supply an asset that earns a variable yield — for Spield, USDC that gets supplied into [Blend](/glossary/blend-capital).' },
        { title: 'The position is split', text: 'The protocol mints a Principal Token (the principal claim) and a Yield Token (the yield claim) against your deposit.' },
        { title: 'Hold, trade, or redeem', text: 'Keep both to hold your original exposure, sell the YT to lock a fixed rate, or buy more YT to lever up on yield.' },
        { title: 'At maturity', text: 'The PT redeems 1:1 for the underlying; the YT has paid out all its yield and expires worthless.' },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Why is this the same as bond stripping?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'It is the same because **bond stripping** in traditional finance separates a bond’s principal from its coupons and sells them as independent instruments — a stripped principal (a zero-coupon bond) and stripped coupons. Yield tokenization does exactly this on-chain: the PT is the stripped principal, the YT is the stripped yield.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'How do you lock a fixed rate with yield tokenization?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'You lock a fixed rate by **buying a Principal Token at a discount and holding it to maturity**. If you pay 0.95 USDC for a PT that redeems for 1 USDC, you have locked a fixed return of about 5.3% for that term, regardless of what the variable rate does in between. The discount *is* your [fixed yield](/glossary/implied-apy).',
    },
    {
      type: 'callout',
      variant: 'info',
      title: 'The number to watch: implied APY',
      text: 'The [implied APY](/glossary/implied-apy) is the fixed rate the market is currently pricing, read from PT and YT prices. Buying the PT locks that rate; buying the YT is a bet that the actual (underlying) yield will beat it.',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'What is the point of yield tokenization?',
          a: 'It separates certainty from upside. Some users want a guaranteed fixed rate (they buy the Principal Token); others want leveraged exposure to yield (they buy the Yield Token). Yield tokenization lets a single position serve both, and creates a market that prices yield itself.',
        },
        {
          q: 'Is yield tokenization risky?',
          a: 'Principal Tokens held to maturity return principal plus the locked discount, so their main risk is smart-contract risk and pre-maturity price movement. Yield Tokens are higher risk because they can decay to zero if realized yield underperforms the implied APY.',
        },
        {
          q: 'Which protocols do yield tokenization?',
          a: 'On Stellar, Spield is the yield-tokenization protocol: depositing USDC mints a PT and a YT backed by real Blend lending yield. The technique itself originated on other chains, but Stellar had no native implementation before Spield.',
        },
      ],
    },
  ],
  related: [
    { href: '/glossary/principal-token', label: 'Principal Token (PT)' },
    { href: '/learn/what-is-a-yield-token', label: 'What is a Yield Token (YT)?' },
    { href: '/learn/pt-vs-yt', label: 'PT vs YT: which should you buy?' },
    { href: '/learn/time-decay-amms-explained', label: 'Time-decay AMMs explained' },
    { href: '/learn/fixed-income-on-stellar', label: 'Fixed income on Stellar' },
    { href: '/learn/implied-vs-underlying-apy', label: 'Implied vs underlying APY' },
  ],
  sources: [
    { href: 'https://chain.link/article/tokenized-yield-guide', label: 'Chainlink — Tokenized Yield' },
  ],
};
