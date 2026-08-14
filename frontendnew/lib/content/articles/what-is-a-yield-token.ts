import type { Article } from '../types';

export const article: Article = {
  slug: 'what-is-a-yield-token',
  title: 'What Is a Yield Token (YT)? The Yield, Sold Separately',
  seoTitle: 'What Is a Yield Token (YT)?',
  description:
    'A Yield Token (YT) pays you all the yield a deposit earns until maturity, then expires at zero. Learn how YTs work, why they decay, and when to buy one.',
  category: 'yield-tokenization',
  intent: 'informational',
  audience: 'beginner',
  primaryKeyword: 'what is a yield token',
  keywords: [
    'what is a yield token',
    'yield token',
    'YT token',
    'YT crypto',
    'yield token explained',
    'long yield',
    'buy yield token',
    'yield token decay',
  ],
  datePublished: '2026-08-01',
  dateModified: '2026-08-01',
  readingMinutes: 0,
  body: [
    {
      type: 'answerBox',
      question: 'What is a Yield Token (YT)?',
      answer:
        'A Yield Token (YT) gives you the income of a deposit without the deposit itself: all the yield it earns until maturity, none of the principal. YTs trade for a fraction of the underlying’s price, so gains and losses are amplified — and at maturity the token expires worthless by design.',
    },
    {
      type: 'keyTakeaways',
      items: [
        'A YT is the **yield half** of a [tokenized](/learn/yield-tokenization) deposit: all the income until [maturity](/glossary/maturity), none of the principal.',
        'It **expires at zero by design**. Every day that passes is one less day of yield left to collect.',
        'A small outlay controls the yield of a much larger principal: leveraged exposure with **no margin and no liquidation**.',
        'You profit when realized yield beats the [implied APY](/glossary/implied-apy) you paid for.',
        'On Stellar, Spield YTs collect real [Blend](/glossary/blend-capital) yield in USDC, claimable anytime.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'What do you actually own when you hold a YT?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'When you hold a Yield Token, you own **every unit of yield a deposit will earn between now and maturity** — and nothing else. Tokenizing a yield-bearing deposit splits it into two claims: a [Principal Token (PT)](/learn/what-is-a-principal-token) that returns the original capital, and a YT that collects the income along the way.',
    },
    {
      type: 'paragraph',
      text: 'Bond desks have done this for decades: the US Treasury lets dealers strip a bond’s coupon payments and sell them apart from the principal. A YT is that idea minted on-chain: the interest, sold separately. The difference is that DeFi yield floats, so nobody knows in advance exactly how much a YT will collect. That uncertainty is the whole game.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'Why does a YT lose value over time?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'A YT loses value over time because it earns yield only until [maturity](/glossary/maturity), so each passing day removes one day of income from what it can still collect. This decay is not a malfunction, and it is not a crash. At maturity the token has collected everything it ever will. Then it’s worth zero.',
    },
    {
      type: 'paragraph',
      text: 'Say a pool yields a steady 4% a year and a YT has three months left. The numbers below are illustrative, not a quote:',
    },
    {
      type: 'table',
      caption: 'Illustrative: yield a YT can still collect per 1 USDC of principal, at a constant 4% APY',
      headers: ['Days to maturity', 'Yield left to collect'],
      rows: [
        ['90', '≈ 0.010 USDC'],
        ['45', '≈ 0.005 USDC'],
        ['0', '0 (the YT has expired)'],
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Why would anyone buy a decaying token?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'People buy YTs because a small outlay controls the yield of a much larger principal. A token priced at a few cents collects the full income of one whole unit of the underlying, so when yield comes in higher than the market expected, the payoff on those few cents is outsized.',
    },
    {
      type: 'paragraph',
      text: 'It is also a way to act on a view. If you think rates on [Blend](/learn/what-is-blend-capital) are about to climb, holding the deposit itself barely moves your return — a YT turns that small move into a large one. Traders call this going **long yield**.',
    },
    {
      type: 'callout',
      variant: 'info',
      title: 'Claiming never burns your YT',
      text: 'On Spield you can claim the USDC yield your YT has accrued at any moment. Claiming settles what you’re owed and leaves the token in your wallet, still collecting, right up to maturity.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'One YT, two endings: a worked example',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Here is the whole trade in miniature, with round, illustrative numbers. Suppose the market prices three months of remaining yield at 1% of principal (an implied APY of about 4%), so one YT costs 0.010 USDC.',
    },
    {
      type: 'paragraph',
      text: 'If yield actually averages 6%, the YT collects about 0.015 USDC and you are up roughly 50%. If it averages 2%, it collects about 0.005 and you are down 50%. Notice what happened: the rate moved two points, your position moved fifty. And the number you had to beat was never the headline rate — it was the [implied APY](/learn/implied-vs-underlying-apy) baked into your purchase price.',
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'A YT is not a savings product',
      text: 'A Yield Token can lose most or all of its value, and every YT ends at zero. Size it like the speculative position it is, and remember that Spield itself is a young protocol that has not yet been audited. Start small.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'How do you get a YT on Stellar?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'On Stellar, you get a YT from Spield in one of two ways. Deposit USDC and the protocol mints a PT and a YT together, each backed by a real supply position in Blend, Stellar’s lending market. Keep both and you have simply kept your variable yield — the interesting move is holding one side only.',
    },
    {
      type: 'paragraph',
      text: 'That is what the market’s one-click **Long Yield** flow is for: it mints PT and YT from your USDC, sells the PT back into the pool, and leaves you holding only YTs: maximum yield exposure for the money. From there you claim accrued USDC whenever you like, and decide when, or whether, to sell. Still weighing the two halves against each other? That decision has its own guide: [PT vs YT](/learn/pt-vs-yt).',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Do I have to claim my YT’s yield manually?',
          a: 'Yes, on Spield you claim when you choose, and each claim pays out in USDC. You can claim as often as you like; claiming never burns the token, so it keeps collecting until maturity.',
        },
        {
          q: 'Is buying a YT the same as trading with leverage?',
          a: 'Not quite. A YT gives leveraged exposure to yield, but there is no margin account, no funding rate, and no liquidation. The most you can lose is what you paid for the token.',
        },
        {
          q: 'Can I sell a YT before maturity?',
          a: 'Yes. YTs trade on Spield’s market like any other token, and the price you get reflects how much yield the market thinks the token can still collect before it expires.',
        },
      ],
    },
  ],
  related: [
    { href: '/glossary/yield-token', label: 'Yield Token (YT)' },
    { href: '/glossary/implied-apy', label: 'Implied APY' },
    { href: '/glossary/maturity', label: 'Maturity' },
    { href: '/learn/what-is-a-principal-token', label: 'What is a Principal Token (PT)?' },
    { href: '/learn/pt-vs-yt', label: 'PT vs YT: which should you buy?' },
    { href: '/learn/yield-tokenization', label: 'Yield tokenization explained' },
    { href: '/learn/implied-vs-underlying-apy', label: 'Implied vs underlying APY' },
  ],
  sources: [
    { href: 'https://www.treasurydirect.gov/marketable-securities/strips/', label: 'TreasuryDirect — Treasury STRIPS' },
    { href: 'https://docs.blend.capital/', label: 'Blend Documentation' },
  ],
};
