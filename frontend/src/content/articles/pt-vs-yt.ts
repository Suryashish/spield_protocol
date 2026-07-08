import type { Article } from '../types';

export const article: Article = {
  slug: 'pt-vs-yt',
  title: 'PT vs YT: Which Should You Buy?',
  seoTitle: 'PT vs YT: Which Should You Buy?',
  description:
    'PT vs YT explained as a decision guide: buy PT to lock a fixed rate, buy YT to bet yield rises. Learn which fits your goal, with examples.',
  category: 'yield-tokenization',
  intent: 'commercial',
  audience: 'beginner',
  primaryKeyword: 'PT vs YT',
  keywords: ['PT vs YT', 'PT vs YT which to buy', 'principal token vs yield token', 'should I buy PT or YT', 'fixed vs variable yield tokenization'],
  datePublished: '2026-07-05',
  dateModified: '2026-07-05',
  readingMinutes: 0,
  body: [
    {
      type: 'answerBox',
      question: 'Should you buy a PT or a YT?',
      answer:
        'Buy a Principal Token (PT) if you want a guaranteed fixed return — you buy it at a discount and redeem it at full value at maturity. Buy a Yield Token (YT) if you want leveraged exposure to yield and believe the actual yield will beat the market’s implied rate. PT is the conservative, fixed-income choice; YT is the higher-risk, higher-upside bet on rising yield.',
    },
    {
      type: 'keyTakeaways',
      items: [
        '**[PT](/glossary/principal-token) = fixed income.** Lock a known return; low risk if held to maturity.',
        '**[YT](/glossary/yield-token) = long yield.** Leveraged, higher risk, can decay to zero.',
        'The dividing line is the **[implied APY](/glossary/implied-apy)**: PT buyers accept it; YT buyers bet against it.',
        'Hold PT to maturity → your return is locked the moment you buy.',
        'Not sure? Holding **both** simply reconstructs your original variable position.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'PT vs YT at a glance',
    },
    {
      type: 'table',
      caption: 'Principal Token vs Yield Token',
      headers: ['', 'Principal Token (PT)', 'Yield Token (YT)'],
      rows: [
        ['Goal', 'Lock a fixed rate', 'Bet yield will rise'],
        ['Analogy', 'Zero-coupon bond', 'Leveraged yield position'],
        ['Risk', 'Low if held to maturity', 'High — can decay to zero'],
        ['Payoff', 'Discount → par at maturity', 'All yield until maturity'],
        ['You win if', 'You want certainty', 'Realized yield > implied APY'],
        ['You lose if', 'Rates rise sharply and you sell early', 'Realized yield < implied APY'],
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'When should you buy a PT?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Buy a PT when you want a **known, guaranteed return** and value certainty over upside. You purchase the PT below par (say 0.95 for a 1.00 redemption), hold to maturity, and collect the difference as fixed yield — unaffected by what the variable rate does in between. This is the on-chain equivalent of buying a bond.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'When should you buy a YT?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Buy a YT when you believe **actual yield will exceed the implied APY** and you want leveraged exposure to that view. Because a small amount of capital buys the yield stream of a much larger principal, YT amplifies returns if you are right — and can lose value, even reach zero, if realized yield disappoints.',
    },
    {
      type: 'callout',
      variant: 'tip',
      title: 'The break-even is the implied APY',
      text: 'Everything hinges on the [implied APY](/glossary/implied-apy). It is the fixed rate a PT buyer locks and the hurdle a YT buyer must clear. If you think future yield will be *higher*, YT is attractive; if you want to *avoid* that uncertainty, PT is your instrument.',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Is buying a PT the same as locking a fixed rate?',
          a: 'Yes. Buying a Principal Token at a discount and holding it to maturity locks in a fixed return equal to the gap between your purchase price and the redemption value, regardless of how the variable rate moves.',
        },
        {
          q: 'Can a Yield Token go to zero?',
          a: 'Yes. A Yield Token delivers yield only until maturity and then expires worthless by design, and it can lose value before then if realized yield underperforms the implied APY you paid.',
        },
        {
          q: 'What if I buy both PT and YT?',
          a: 'Holding both in equal amounts reconstructs your original variable-yield position — you own the principal and its yield again, just split into two tokens you could sell separately later.',
        },
      ],
    },
  ],
  related: [
    { href: '/glossary/principal-token', label: 'Principal Token (PT)' },
    { href: '/glossary/yield-token', label: 'Yield Token (YT)' },
    { href: '/glossary/implied-apy', label: 'Implied APY' },
    { href: '/learn/yield-tokenization', label: 'Yield tokenization explained' },
    { href: '/learn/fixed-income-on-stellar', label: 'Fixed income on Stellar' },
  ],
};
