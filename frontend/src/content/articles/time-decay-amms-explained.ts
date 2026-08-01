import type { Article } from '../types';

export const article: Article = {
  slug: 'time-decay-amms-explained',
  title: 'Time-Decay AMMs: How to Price a Token with an Expiry Date',
  seoTitle: 'Time-Decay AMMs Explained',
  description:
    'A time-decay AMM prices assets that expire, like PTs, by shifting its curve toward par as maturity nears. Why normal AMMs fail at this, and how it works.',
  category: 'yield-tokenization',
  intent: 'informational',
  audience: 'intermediate',
  primaryKeyword: 'time decay AMM',
  keywords: [
    'time decay AMM',
    'time-decay AMM explained',
    'PT AMM',
    'yield AMM',
    'AMM for expiring assets',
    'implied APY AMM',
    'PT USDC pool',
  ],
  datePublished: '2026-08-01',
  dateModified: '2026-08-01',
  readingMinutes: 0,
  body: [
    {
      type: 'answerBox',
      question: 'What is a time-decay AMM?',
      answer:
        'A time-decay AMM is an automated market maker built for assets with a maturity date. Its pricing curve shifts as time passes, steering a Principal Token’s price toward full redemption value by maturity. A standard constant-product AMM cannot do this: it prices only supply and demand, and time never enters the formula.',
    },
    {
      type: 'keyTakeaways',
      items: [
        'Ordinary AMMs price **supply and demand**. A PT also needs its price to reflect **time remaining**.',
        'A [PT](/glossary/principal-token) has a known destination: **par at [maturity](/glossary/maturity)**. The curve walks it there.',
        'What the pool really quotes is an **[implied APY](/glossary/implied-apy)**, not just a price.',
        'LPs earn swap fees with **near-zero [impermanent loss](/glossary/impermanent-loss)** if they stay to maturity.',
        'Spield runs one PT/USDC pool of this kind **per maturity**, with a 0.30% swap fee.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Why can’t a normal AMM price a PT?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'A normal AMM fails on a PT because it has no concept of time, and a PT is mostly made of time. The classic constant-product pool sets price purely from the ratio of tokens in the pool, which works for assets with no schedule. But a PT is a claim on 1 USDC at a fixed date — its fair price must drift upward every single day, even if nobody trades.',
    },
    {
      type: 'paragraph',
      text: 'Put a PT in a time-blind pool and the pool quotes yesterday’s price until an arbitrageur shows up to correct it, at the liquidity providers’ expense. Day after day, the pool leaks value to whoever corrects it first. The fix is not better liquidity. The fix is a curve that knows what day it is.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'What does “time decay” actually change?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Time decay re-anchors the pricing curve continuously, so the same pool balances produce a higher PT price as maturity approaches. The pool effectively quotes yield, not price: it asks “what annual rate does this discount imply over the time left?” and moves its quote so that the rate, not the raw number, is what stays consistent.',
    },
    {
      type: 'paragraph',
      text: 'A concrete pair of quotes shows the difference (the figures are illustrative). A PT trading at 0.975 with six months left implies roughly a 5% annual rate. The same 0.975 with three months left implies roughly 10%, because the same discount now closes in half the time.',
    },
    {
      type: 'paragraph',
      text: 'So when traders look at a time-decay pool, the number they compare is the implied APY. Price is just the packaging. If the implied rate looks generous against what the underlying is really earning, they buy the PT and lock it in; if it looks stingy, they stay away, and the quote drifts until someone disagrees.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'What happens to liquidity providers in a pool like this?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'LPs in a time-decay pool collect the swap fee — 0.30% per trade on Spield — while holding a pair whose relative price converges on a known endpoint. That convergence is the interesting part: because a PT finishes at par by design, an LP who stays until maturity ends up with two assets of equal value, which is why impermanent loss trends toward zero over the pool’s life.',
    },
    {
      type: 'callout',
      variant: 'tip',
      title: 'The maturity backstop for LPs',
      text: 'Mid-life, PT prices can still swing with rates, so an LP who exits early may realize some [impermanent loss](/glossary/impermanent-loss). Staying to maturity is the natural hedge: the curve finishes the journey to par whether or not the market cooperated along the way.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'How does Spield’s market use this design?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Spield runs a PT/USDC time-decay market on Stellar, one pool per maturity, and wraps the curve in two plain-English actions instead of exposing raw swap math:',
    },
    {
      type: 'list',
      items: [
        '**Earn Fixed**: buy PT below par and hold to maturity; the discount is your locked rate.',
        '**Long Yield**: one click mints PT and YT from your USDC and sells the PT back, leaving leveraged [YT](/learn/what-is-a-yield-token) exposure.',
        '**Provide liquidity**: deposit PT and USDC, earn the 0.30% fee on every trade in between.',
      ],
    },
    {
      type: 'paragraph',
      text: 'Every quote comes from the on-chain curve, and the pool’s implied APY is readable directly from the contract — no dashboard has to be trusted to report it honestly.',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Does a time-decay AMM guarantee the implied APY?',
          a: 'Only for a buyer who holds the PT to maturity. The implied APY you lock is set by your own entry price; the pool’s quoted rate keeps moving afterwards as others trade.',
        },
        {
          q: 'Why does one pool exist per maturity?',
          a: 'Because time-to-maturity is an input to the curve itself. Two PTs with different end dates are different instruments with different fair prices, so mixing them in one pool would make both quotes wrong.',
        },
        {
          q: 'Do LPs in a PT/USDC pool face impermanent loss?',
          a: 'Some, if they withdraw mid-life after a large rate move. Held to maturity, the PT converges to par, so the classic impermanent-loss gap largely closes on its own.',
        },
      ],
    },
  ],
  related: [
    { href: '/glossary/time-decay-amm', label: 'Time-decay AMM' },
    { href: '/glossary/implied-apy', label: 'Implied APY' },
    { href: '/glossary/impermanent-loss', label: 'Impermanent loss' },
    { href: '/learn/yield-tokenization', label: 'Yield tokenization explained' },
    { href: '/learn/what-is-a-principal-token', label: 'What is a Principal Token (PT)?' },
    { href: '/learn/what-is-a-yield-token', label: 'What is a Yield Token (YT)?' },
    { href: '/learn/implied-vs-underlying-apy', label: 'Implied vs underlying APY' },
  ],
};
