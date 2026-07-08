import type { Article } from '../types';

export const article: Article = {
  slug: 'what-is-a-principal-token',
  title: 'What Is a Principal Token (PT)? A Beginner’s Guide',
  seoTitle: 'What Is a Principal Token (PT)?',
  description:
    'A Principal Token (PT) is an on-chain zero-coupon bond that redeems 1:1 at maturity. Learn what a PT is, how it locks a fixed rate, and how it works.',
  category: 'yield-tokenization',
  intent: 'informational',
  audience: 'beginner',
  primaryKeyword: 'what is a principal token',
  keywords: ['what is a principal token', 'principal token', 'PT token', 'principal token explained', 'PT crypto'],
  datePublished: '2026-07-05',
  dateModified: '2026-07-05',
  readingMinutes: 0,
  body: [
    {
      type: 'answerBox',
      question: 'What is a Principal Token (PT)?',
      answer:
        'A Principal Token (PT) is a token representing the principal of a yield-bearing deposit, which redeems 1:1 for the underlying asset at maturity. Because its yield has been stripped away into a separate Yield Token, a PT trades at a discount before maturity — and that discount is the fixed yield you lock in. A PT is effectively an on-chain zero-coupon bond.',
    },
    {
      type: 'keyTakeaways',
      items: [
        'A PT is the **principal half** of a [yield-tokenized](/learn/yield-tokenization) position.',
        'It redeems **1:1 for the underlying at maturity** — like a [zero-coupon bond](/glossary/zero-coupon-bond).',
        'It trades **below par** beforehand; the discount is your **fixed yield**.',
        'Buy PT + hold to maturity = lock a known return, regardless of rate moves.',
        'On Stellar, Spield mints PTs backed by real [Blend](/glossary/blend-capital) yield.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'How does a Principal Token work?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'A Principal Token works by **separating the principal from the yield** of a deposit. When you tokenize a yield-bearing position, you receive a PT (the principal claim) and a [Yield Token (YT)](/glossary/yield-token) (the yield claim). The PT can be redeemed for one full unit of the underlying once the position reaches [maturity](/glossary/maturity).',
    },
    {
      type: 'paragraph',
      text: 'Before maturity, since all the yield has moved to the YT, the PT is worth less than the underlying — so it trades at a discount. Buy 1 USDC of principal for 0.95 today, redeem for 1.00 at maturity, and the 0.05 is your locked-in return.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'Why is a PT like a zero-coupon bond?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'A PT is like a [zero-coupon bond](/glossary/zero-coupon-bond) because it pays no interest along the way and instead returns full face value at a fixed date. In both cases you buy at a discount and your entire return is the gap between the discounted price and the redemption value — a clean, predictable fixed yield.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'How do you use a PT to lock a fixed rate?',
    },
    {
      type: 'steps',
      name: 'Lock a fixed rate with a Principal Token',
      steps: [
        { title: 'Buy the PT at a discount', text: 'Purchase the PT below its par value on the market, or mint it by depositing the underlying.' },
        { title: 'Hold to maturity', text: 'The PT price converges toward par as maturity approaches; the fixed return you saw at purchase is locked in.' },
        { title: 'Redeem 1:1', text: 'At maturity, redeem each PT for one unit of the underlying asset — principal plus your locked yield.' },
      ],
    },
    {
      type: 'callout',
      variant: 'success',
      title: 'The fixed rate is set the moment you buy',
      text: 'Unlike variable lending, a PT’s return does not change with the market once you buy it. Whatever the [implied APY](/glossary/implied-apy) was at purchase is what you earn if you hold to maturity.',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Can I sell a Principal Token before maturity?',
          a: 'Yes. PTs are freely tradable, so you can sell before maturity on the market. Its price moves with interest rates like any bond, so you may realize a gain or loss depending on rate changes since you bought.',
        },
        {
          q: 'Is a Principal Token safe?',
          a: 'Held to maturity, a PT returns its principal plus the locked-in discount, so its main exposures are smart-contract risk and pre-maturity price movement if you sell early. It is the conservative, fixed-income side of yield tokenization.',
        },
        {
          q: 'Where can I get a Principal Token on Stellar?',
          a: 'On Spield, the fixed-income layer for Stellar. Depositing USDC mints a PT and a YT, and you can also buy PTs at a discount on the Spield market to lock a fixed yield.',
        },
      ],
    },
  ],
  related: [
    { href: '/glossary/principal-token', label: 'Principal Token (PT)' },
    { href: '/glossary/yield-token', label: 'Yield Token (YT)' },
    { href: '/glossary/zero-coupon-bond', label: 'Zero-coupon bond' },
    { href: '/learn/pt-vs-yt', label: 'PT vs YT: which should you buy?' },
    { href: '/learn/yield-tokenization', label: 'Yield tokenization explained' },
  ],
};
