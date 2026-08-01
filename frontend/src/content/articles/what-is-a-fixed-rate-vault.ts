import type { Article } from '../types';

export const article: Article = {
  slug: 'what-is-a-fixed-rate-vault',
  title: 'What Is a Fixed-Rate Vault? A Known Payout in a Floating World',
  seoTitle: 'What Is a Fixed-Rate Vault?',
  description:
    'A fixed-rate vault accepts your deposit, quotes a payout up front, and delivers it at maturity no matter where market yield drifts. Here is how that works.',
  category: 'fixed-income',
  intent: 'informational',
  audience: 'beginner',
  primaryKeyword: 'fixed-rate vault',
  keywords: [
    'fixed-rate vault',
    'fixed rate vault crypto',
    'fixed rate DeFi',
    'fixed yield vault',
    'lock crypto interest rate',
    'guaranteed yield DeFi',
    'USDC fixed rate',
  ],
  datePublished: '2026-08-01',
  dateModified: '2026-08-01',
  readingMinutes: 0,
  body: [
    {
      type: 'answerBox',
      question: 'What is a fixed-rate vault?',
      answer:
        'A fixed-rate vault is a DeFi product that accepts a deposit and commits to a specific payout at a set maturity date: principal plus a coupon quoted up front. The underlying yield source keeps floating in the background; the vault’s whole job is to make sure your payout does not depend on it.',
    },
    {
      type: 'keyTakeaways',
      items: [
        'You see the payout **before you deposit**. If the vault cannot back it, it declines the deposit.',
        'On Spield, every receipt is **backed 1:1 by [Principal Tokens](/glossary/principal-token)** the vault already holds.',
        'The yield behind it is **real [Blend](/glossary/blend-capital) lending yield**: supplied, never borrowed.',
        'Current testnet config: a **5% fixed APR**, with a hard ceiling of 20% coded into the contract.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'How can a vault pay a fixed rate from a variable source?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'A fixed-rate vault pays a fixed rate by owning assets whose value at maturity is already known. Spield’s vault keeps an inventory of PTs (each one redeems for exactly 1 USDC at [maturity](/glossary/maturity)) and matches every promised payout against that inventory, one to one. The floating rate can do whatever it likes in between; the redemption value cannot move.',
    },
    {
      type: 'paragraph',
      text: 'If that reminds you of a bank certificate of deposit, the comparison is fair on the surface: money in, known sum out, on a known date. The difference is what stands behind the promise. A CD leans on the bank’s balance sheet; the vault leans on tokens it verifiably holds, checked by a [solvency invariant](/glossary/solvency-invariant) on every transaction.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'What happens when you deposit?',
    },
    {
      type: 'steps',
      name: 'Lock a fixed rate in the Spield vault',
      steps: [
        {
          title: 'Get your quote',
          text: 'Enter an amount and the vault quotes a payout (principal plus fixed coupon) for the current maturity, at the configured rate.',
        },
        {
          title: 'Deposit and receive a receipt',
          text: 'Your USDC goes in, a receipt for the exact payout comes back, and the vault reserves matching PT inventory to it immediately.',
        },
        {
          title: 'Redeem at maturity',
          text: 'Present the receipt at maturity and collect the quoted amount. Nothing you did or didn’t do in between changes the number.',
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Where does the yield actually come from?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'The yield comes from Blend, Stellar’s lending market, where deposited USDC is supplied to earn interest paid by real borrowers. Spield only ever supplies, never borrows against user funds, and the rate it can afford to fix is grounded in what that lending actually produces. No points, no emissions, no invented index. If borrowers stop paying, there is no yield to restructure, and the vault’s math says so out loud.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'What if the vault can’t afford a new deposit?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Then it says no. The vault tracks its coupon capacity, the PT inventory not yet pledged to earlier receipts, and a deposit that would promise more than that capacity is rejected outright rather than diluted across everyone. Most yield products fail by over-promising in good times. This one is built to refuse the promise instead.',
    },
    {
      type: 'callout',
      variant: 'success',
      title: 'Your rate is locked the moment you deposit',
      text: 'Whatever happens to Blend’s variable rate afterwards — up, down, sideways — the payout on your receipt is already reserved in PT inventory. Later depositors get later quotes; yours is done moving.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'What are the real numbers today?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'On the current testnet configuration the vault offers a **5% fixed APR**, and the contract enforces a ceiling of 20% that no configuration can exceed. At 5%, a 1,000 USDC deposit held for a full year redeems for 1,050 USDC — quoted before you commit, not discovered after. Live rates always come from the app or the contract itself, never from a screenshot.',
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Fixed rate, not zero risk',
      text: 'The fixed payout is only as good as the system enforcing it. Spield runs on Stellar testnet today, has not yet been audited, and inherits the risk of its Blend yield source — a frozen lending pool, for example, can delay payouts. A fixed rate removes rate uncertainty; it does not remove DeFi risk.',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Can I withdraw from a fixed-rate vault early?',
          a: 'The receipt is designed to be redeemed at maturity — that is what makes the rate fixable. If you expect to need the money early, the more flexible route is holding PTs directly, which you can sell on the market at any time.',
        },
        {
          q: 'Is a fixed-rate vault better than variable lending?',
          a: 'Neither is better; they price different needs. Variable lending can out-earn the fixed rate when markets run hot, and underperform it when demand dries up. The vault sells certainty, and the discount to peak variable rates is the price of it.',
        },
        {
          q: 'What backs the fixed payout on Spield?',
          a: 'Principal Tokens held by the vault itself, reserved 1:1 against every outstanding receipt, with a solvency check re-run on every state-changing transaction. Backing is on-chain and readable by anyone.',
        },
      ],
    },
  ],
  related: [
    { href: '/glossary/principal-token', label: 'Principal Token (PT)' },
    { href: '/glossary/solvency-invariant', label: 'Solvency invariant' },
    { href: '/glossary/blend-capital', label: 'Blend Capital' },
    { href: '/learn/fixed-vs-variable-yield', label: 'Fixed vs variable yield' },
    { href: '/learn/what-is-blend-capital', label: 'What is Blend Capital?' },
    { href: '/learn/fixed-income-on-stellar', label: 'Fixed income on Stellar' },
    { href: '/learn/spield-protocol-facts', label: 'Spield protocol facts' },
  ],
  sources: [
    { href: 'https://docs.blend.capital/', label: 'Blend Documentation' },
  ],
};
