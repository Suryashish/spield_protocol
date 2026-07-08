import type { Article } from '../types';

export const article: Article = {
  slug: 'implied-vs-underlying-apy',
  title: 'Implied APY vs Underlying APY Explained',
  seoTitle: 'Implied APY vs Underlying APY Explained',
  description:
    'Implied APY is the fixed rate the market prices in; underlying APY is the yield actually earned. Learn the difference and how to use it.',
  category: 'yield-tokenization',
  intent: 'informational',
  audience: 'intermediate',
  primaryKeyword: 'implied APY vs underlying APY',
  keywords: ['implied APY vs underlying APY', 'implied APY', 'underlying APY', 'what is implied APY', 'fixed APY explained'],
  datePublished: '2026-07-05',
  dateModified: '2026-07-05',
  readingMinutes: 0,
  body: [
    {
      type: 'answerBox',
      question: 'What is the difference between implied APY and underlying APY?',
      answer:
        'Underlying APY is the actual, variable yield a deposit is currently earning from its yield source. Implied APY is the fixed rate the market is pricing in, derived from Principal Token and Yield Token prices. Buying the PT locks the implied APY; a Yield Token buyer profits only if the underlying APY ends up higher than the implied APY they paid.',
    },
    {
      type: 'keyTakeaways',
      items: [
        '**Underlying APY** = the real, floating rate being earned right now.',
        '**Implied APY** = the fixed rate the market expects, read from [PT](/glossary/principal-token)/[YT](/glossary/yield-token) prices.',
        'Buy the PT → you **lock the implied APY** as your fixed return.',
        'Buy the YT → you **bet underlying APY will beat implied APY**.',
        'The gap between the two is the whole game of yield trading.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'What is underlying APY?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: '[Underlying APY](/glossary/underlying-apy) is the annualized yield the source position is actually earning — for Spield, the rate USDC earns on [Blend](/glossary/blend-capital). It is usually shown as a recent moving average, and it moves up and down with borrowing demand in the lending market.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'What is implied APY?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: '[Implied APY](/glossary/implied-apy) is the market’s expectation, expressed as a fixed annual rate and read directly from token prices. When a PT trades at a discount, that discount implies a fixed return to maturity — that is the implied APY. Think of it as the "price" the market has put on future yield.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'How do you use the two together?',
    },
    {
      type: 'table',
      caption: 'Reading implied vs underlying APY',
      headers: ['If you think…', 'Then…', 'Because'],
      rows: [
        ['Future yield will fall or stay low', 'Buy the PT (lock the implied APY)', 'You secure a fixed rate above what you expect to float'],
        ['Future yield will rise above implied', 'Buy the YT', 'You capture the excess yield with leverage'],
        ['You have no strong view', 'Hold both / stay in the vault', 'You keep your original variable exposure'],
      ],
    },
    {
      type: 'callout',
      variant: 'info',
      title: 'The break-even rule',
      text: 'A YT buyer breaks even when realized underlying APY equals the implied APY they paid. Above it, they profit; below it, they lose. A PT buyer’s outcome is fixed the moment they buy.',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Is implied APY the same as fixed APY?',
          a: 'Effectively yes — the implied APY is the fixed rate you lock in by buying and holding a Principal Token to maturity. It is called "implied" because it is derived from market prices rather than quoted directly.',
        },
        {
          q: 'Why is underlying APY shown as an average?',
          a: 'Because the real rate fluctuates constantly, a moving average (such as a 7-day average) gives a more stable, representative picture of what the position is currently earning than a single instantaneous reading.',
        },
      ],
    },
  ],
  related: [
    { href: '/glossary/implied-apy', label: 'Implied APY' },
    { href: '/glossary/underlying-apy', label: 'Underlying APY' },
    { href: '/learn/pt-vs-yt', label: 'PT vs YT: which should you buy?' },
    { href: '/learn/yield-tokenization', label: 'Yield tokenization explained' },
  ],
};
