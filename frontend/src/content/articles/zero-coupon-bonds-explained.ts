import type { Article } from '../types';

export const article: Article = {
  slug: 'zero-coupon-bonds-explained',
  title: 'Zero-Coupon Bonds Explained: From T-Bills to Principal Tokens',
  seoTitle: 'Zero-Coupon Bonds Explained',
  description:
    'A zero-coupon bond pays no interest along the way: you buy below face value and collect the full amount at maturity. The same idea now powers PTs in DeFi.',
  category: 'fixed-income',
  intent: 'informational',
  audience: 'beginner',
  primaryKeyword: 'zero coupon bond crypto',
  keywords: [
    'zero coupon bond',
    'zero coupon bond crypto',
    'zero coupon bond explained',
    'how do zero coupon bonds work',
    'discount bond',
    'pull to par',
    'on-chain bond',
  ],
  datePublished: '2026-08-01',
  dateModified: '2026-08-01',
  readingMinutes: 0,
  body: [
    {
      type: 'answerBox',
      question: 'What is a zero-coupon bond?',
      answer:
        'A zero-coupon bond is a bond that pays no interest during its life. You buy it below its face value, wait, and collect the full face value at maturity — the discount at purchase is your entire return. US Treasury bills work this way, and so do Principal Tokens in DeFi.',
    },
    {
      type: 'keyTakeaways',
      items: [
        'No coupons, no payouts along the way. Your return is the **gap between price and face value**.',
        'The most familiar example is a **US Treasury bill**: buy at a discount, redeem at par.',
        'The price climbs toward face value as maturity nears; traders call it **pull to par**.',
        'A [Principal Token](/learn/what-is-a-principal-token) is a zero-coupon bond rebuilt on-chain.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'How does a bond pay you without paying interest?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'A zero-coupon bond pays you through its price, not through interest payments: you buy it for less than it will be worth at [maturity](/glossary/maturity), and the discount is the yield. Buy a bond with a 1,000 face value for 970, hold it a year, redeem it for 1,000, and you earned 30 — a shade over 3%. Nothing arrived in the meantime. That silence is the product.',
    },
    {
      type: 'paragraph',
      text: 'Regular bonds mail you interest twice a year, which sounds friendlier but complicates everything: you have to reinvest each payment, and your final return depends on the rates you reinvest at. A zero strips all of that away. One price in, one payment out, and the return is known to the cent the day you buy.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'Why does the price climb as maturity approaches?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'The price climbs because the waiting shrinks. A promise of 1,000 next year is worth less than a promise of 1,000 next week, so as the payout date approaches, the discount that compensated you for waiting steadily closes. The bond gets **pulled to par**, and at maturity, price and face value meet.',
    },
    {
      type: 'table',
      caption: 'Illustrative price path of a 1,000-face zero-coupon bond at a steady 3% rate',
      headers: ['Time to maturity', 'Price'],
      rows: [
        ['12 months', '≈ 970'],
        ['6 months', '≈ 985'],
        ['At maturity', '1,000 (par)'],
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Where do zero-coupon bonds show up in crypto?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'In DeFi, the zero-coupon bond reappears as the [Principal Token (PT)](/learn/what-is-a-principal-token). [Yield tokenization](/learn/yield-tokenization) splits a yield-bearing deposit into its principal and its income; the principal half trades below par exactly like a zero, then redeems 1:1 for the underlying at maturity. The SEC’s definition transfers cleanly:',
    },
    {
      type: 'quote',
      text: 'Zero coupon bonds are bonds that do not pay interest during the life of the bonds.',
      cite: 'US Securities and Exchange Commission, investor.gov',
    },
    {
      type: 'paragraph',
      text: 'A PT does not pay interest during its life either. Its yield went somewhere else — into a separate [Yield Token](/learn/what-is-a-yield-token) that someone else can own. What remains behaves like the [zero-coupon bond](/glossary/zero-coupon-bond) desks have traded for decades, except it settles on Stellar in minutes and the backing is verifiable on-chain.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'What are the risks of a zero-coupon bond?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Held to maturity, a zero delivers exactly what you paid for. The risk lives in the middle: if rates rise after you buy, the market price of your bond falls, and selling early can mean selling at a loss. Zeros actually swing harder than coupon bonds here, because every unit of value sits at the far end of the timeline.',
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'The on-chain version adds its own risk',
      text: 'A PT swaps the credit risk of a bond issuer for **smart-contract risk**. On Spield the redemption is enforced by an on-chain [solvency invariant](/glossary/solvency-invariant) rather than a promise, but the protocol is young and not yet audited — treat that the way you would treat any early bond issuer.',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Why would anyone buy a bond that pays no interest?',
          a: 'Because the return is locked in and there is nothing to manage. No payments to reinvest, no reinvestment-rate gamble. Buy at the discount, hold, redeem at face value.',
        },
        {
          q: 'Are Treasury bills zero-coupon bonds?',
          a: 'Yes, in structure. T-bills are sold at a discount to face value and pay no coupons, which makes them the shortest-dated and most widely held zeros in the world.',
        },
        {
          q: 'Is a Principal Token really a bond?',
          a: 'Functionally, yes: it trades at a discount, pays nothing along the way, and redeems at full value on a known date. Legally it is a token, not a registered security — the resemblance is in the mechanics, not the paperwork.',
        },
        {
          q: 'Can a zero-coupon bond lose money?',
          a: 'Yes, in two ways: selling before maturity after rates have risen, or the issuer failing to pay. The on-chain equivalent of issuer failure is a smart-contract exploit, which is why audits and on-chain backing matter.',
        },
      ],
    },
  ],
  related: [
    { href: '/glossary/zero-coupon-bond', label: 'Zero-coupon bond' },
    { href: '/glossary/maturity', label: 'Maturity' },
    { href: '/glossary/fixed-income', label: 'Fixed income' },
    { href: '/learn/what-is-a-principal-token', label: 'What is a Principal Token (PT)?' },
    { href: '/learn/what-is-a-yield-token', label: 'What is a Yield Token (YT)?' },
    { href: '/learn/tokenized-treasuries-explained', label: 'Tokenized treasuries explained' },
    { href: '/learn/fixed-income-on-stellar', label: 'Fixed income on Stellar' },
  ],
  sources: [
    { href: 'https://www.investor.gov/introduction-investing/investing-basics/glossary/zero-coupon-bond', label: 'SEC investor.gov — Zero-Coupon Bond' },
    { href: 'https://www.treasurydirect.gov/marketable-securities/strips/', label: 'TreasuryDirect — Treasury STRIPS' },
  ],
};
