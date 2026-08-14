import type { Article } from '../types';

export const article: Article = {
  slug: 'fixed-vs-variable-yield',
  title: 'Fixed vs Variable Yield in Crypto: Which Is Right for You?',
  seoTitle: 'Fixed vs Variable Yield in Crypto',
  description:
    'Fixed yield locks a known return; variable yield floats with the market. Compare the two, learn when each wins, and see how to lock a fixed rate on Stellar.',
  category: 'defi-basics',
  intent: 'informational',
  audience: 'beginner',
  primaryKeyword: 'fixed vs variable yield crypto',
  keywords: ['fixed vs variable yield crypto', 'fixed yield vs variable yield', 'fixed rate vs floating rate DeFi', 'is fixed yield better'],
  datePublished: '2026-07-05',
  dateModified: '2026-07-05',
  readingMinutes: 0,
  body: [
    {
      type: 'answerBox',
      question: 'What is the difference between fixed and variable yield in crypto?',
      answer:
        'Fixed yield locks in a known return for a set term, so you know exactly what you will earn regardless of market conditions. Variable yield floats with supply and demand, changing block by block — it can be higher when demand is strong but is unpredictable. Fixed yield trades upside for certainty; variable yield trades certainty for potential upside.',
    },
    {
      type: 'keyTakeaways',
      items: [
        '**Fixed yield** = certainty. You lock a rate and know your payout in advance.',
        '**Variable yield** = flexibility and potential upside, but no guarantees.',
        'Most DeFi yield is **variable** by default; fixed yield needs a tool like [yield tokenization](/learn/yield-tokenization).',
        'On Stellar you can hold variable ([Blend](/glossary/blend-capital)) or lock fixed (Spield).',
        'Neither is "better" — it depends on whether you value predictability or upside.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Fixed vs variable yield at a glance',
    },
    {
      type: 'table',
      caption: 'Fixed vs variable yield compared',
      headers: ['', 'Fixed yield', 'Variable yield'],
      rows: [
        ['Rate', 'Locked for the term', 'Changes continuously'],
        ['Predictability', 'You know your payout', 'Unknown until realized'],
        ['Upside', 'Capped at the locked rate', 'Can rise if demand spikes'],
        ['Effort', 'Set once and forget', 'May want to monitor and move'],
        ['Best when', 'You want to plan / de-risk', 'Rates are high and you want max yield'],
        ['On Stellar', 'Spield fixed-rate vault / buy [PT](/glossary/principal-token)', 'Lend on [Blend](/glossary/blend-capital)'],
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'When should you choose fixed yield?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Choose fixed yield when **certainty matters more than squeezing out the last basis point** — for example, if you are planning around a known payout, want to de-risk in a volatile market, or simply prefer set-and-forget. Locking a fixed rate is the on-chain equivalent of buying a bond or a certificate of deposit.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'When is variable yield the better choice?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Choose variable yield when **rates are high and you want to capture that upside**, or when you are comfortable actively managing your position. Variable yield can outperform fixed in strong markets, but you accept that the rate — and your return — can fall at any time.',
    },
    {
      type: 'callout',
      variant: 'tip',
      title: 'You can have both',
      text: 'With [yield tokenization](/learn/yield-tokenization), a single deposit becomes a fixed leg ([PT](/glossary/principal-token)) and a variable leg ([YT](/glossary/yield-token)). Sell the YT to go fully fixed, or buy more to lean into variable — you choose your exposure.',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Is fixed yield safer than variable yield?',
          a: 'Fixed yield removes rate uncertainty, so your return is predictable if held to maturity, but it does not remove smart-contract or market risk. Variable yield adds rate uncertainty on top of those same risks. Fixed is more predictable, not automatically "safer" in every sense.',
        },
        {
          q: 'How do I lock a fixed yield in crypto?',
          a: 'You lock a fixed yield by buying a Principal Token at a discount and holding it to maturity, or by depositing into a fixed-rate vault. On Stellar, Spield offers both, built on real Blend lending yield.',
        },
      ],
    },
  ],
  related: [
    { href: '/learn/yield-tokenization', label: 'Yield tokenization explained' },
    { href: '/learn/how-to-earn-yield-on-stellar', label: 'How to earn yield on Stellar' },
    { href: '/learn/fixed-income-on-stellar', label: 'Fixed income on Stellar' },
    { href: '/glossary/real-yield', label: 'Real yield' },
    { href: '/learn/what-is-a-fixed-rate-vault', label: 'What is a fixed-rate vault?' },
    { href: '/learn/usdc-yield-on-stellar', label: 'USDC yield on Stellar' },
  ],
};
