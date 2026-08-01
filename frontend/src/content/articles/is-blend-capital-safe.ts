import type { Article } from '../types';

export const article: Article = {
  slug: 'is-blend-capital-safe',
  title: 'Is Blend Capital Safe? An Honest Risk Walkthrough',
  seoTitle: 'Is Blend Capital Safe?',
  description:
    'Blend Capital is audited, immutable, and insured by per-pool backstops, but no lending protocol is risk-free. What protects you, and what can still go wrong.',
  category: 'stellar',
  intent: 'informational',
  audience: 'beginner',
  primaryKeyword: 'is Blend Capital safe',
  keywords: [
    'is Blend Capital safe',
    'Blend Capital risk',
    'Blend Capital audit',
    'Blend backstop',
    'Stellar lending safety',
    'is Blend safe to use',
  ],
  datePublished: '2026-08-01',
  dateModified: '2026-08-01',
  readingMinutes: 0,
  body: [
    {
      type: 'answerBox',
      question: 'Is Blend Capital safe?',
      answer:
        'Blend Capital is among the safer venues in Stellar DeFi: its contracts are audited and immutable, every lending pool is isolated, and a mandatory backstop of first-loss capital absorbs bad debt before ordinary suppliers lose anything. “Safe” is still relative — smart-contract, market, and liquidity risk all remain.',
    },
    {
      type: 'keyTakeaways',
      items: [
        'Blend’s contracts are **audited and immutable**: the rules cannot be changed after deployment.',
        'Pools are **isolated**: trouble in one pool stays in that pool.',
        'Every pool carries a mandatory **backstop**: first-loss capital that absorbs bad debt ahead of suppliers.',
        'Risks that remain: **smart-contract bugs, bad debt beyond the backstop, and frozen-pool delays**.',
        'Spield supplies USDC into Blend, so [Spield inherits Blend’s risk](/learn/is-stellar-defi-safe), which is worth understanding either way.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'What protections does Blend actually have?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Blend’s safety case rests on four design choices, each one checkable rather than promised:',
    },
    {
      type: 'list',
      items: [
        '**Audited code.** Blend’s contracts have been professionally audited, a filter for bugs, though never a guarantee of their absence.',
        '**Immutable contracts.** Once deployed, the rules cannot be quietly upgraded out from under you. What you audited is what runs.',
        '**Isolated pools.** Each lending pool is its own risk container with its own parameters. A bad asset in one pool cannot drain another.',
        '**A mandatory [backstop](/learn/what-is-blend-capital).** Every pool has a fund of first-loss capital standing between bad debt and ordinary suppliers.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'How does the backstop protect your deposit?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'The backstop is a pool-specific insurance fund: depositors stake capital into it, earn a share of the interest borrowers pay, and in exchange agree to take losses first. When a liquidation comes too late and a borrower’s debt goes bad, that bad debt is charged to the backstop and covered by auctioning its deposits — before any ordinary supplier’s balance is touched. It works like an insurance deductible paid by someone who volunteered, and got compensated, to pay it.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'What can still go wrong?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Three things, mainly. First, a smart-contract bug: audits shrink this risk but cannot erase it, on Blend or anywhere else in DeFi. Second, bad debt bigger than the backstop: a violent enough crash in collateral prices could exhaust the first-loss fund, and losses past that point reach suppliers. Third, liquidity: your variable yield comes from lent-out funds, and in stressed moments a pool can have less idle cash than withdrawers want.',
    },
    {
      type: 'paragraph',
      text: 'A pool can also be frozen in an emergency, which delays withdrawals rather than losing them. It’s an uncommon state, but honesty requires the sentence: money in a lending pool is not a bank balance, and exits are fast in normal times, not guaranteed in all times.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'What does Blend’s risk mean if you use Spield?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Spield builds directly on Blend: deposited USDC is supplied into a Blend pool, and every Spield yield number is downstream of Blend’s real lending rate. That is the point (the yield is real), and it also means Blend’s risk list is Spield’s risk list, plus Spield’s own young, not-yet-audited contracts on top. No layer of fixed-rate engineering removes the risk of the source underneath it.',
    },
    {
      type: 'callout',
      variant: 'info',
      title: 'Supply-only, by design',
      text: 'Spield only ever supplies USDC to Blend — it never borrows against user funds, and there is no liquidation risk in a Spield position. If Blend has a bad day, Spield’s exposure is a supplier’s exposure, not a leveraged one.',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Has Blend Capital been audited?',
          a: 'Yes. Blend’s contracts have undergone professional audits, and the Stellar ecosystem funds ongoing audit work through the Soroban Security Audit Bank. Audits reduce risk; they cannot certify perfection.',
        },
        {
          q: 'Can you lose money supplying USDC to Blend?',
          a: 'Yes, in the tail scenarios: a contract exploit, or bad debt that exceeds the pool’s backstop. Neither has wiped out Blend suppliers to date, but both are real possibilities to size positions around.',
        },
        {
          q: 'What happens to Spield if a Blend pool freezes?',
          a: 'Spield’s payouts inherit the delay. Funds keep their on-chain backing, but withdrawals can take longer than normal until the pool resumes — a scenario Spield documents openly rather than hiding.',
        },
      ],
    },
  ],
  related: [
    { href: '/glossary/blend-capital', label: 'Blend Capital' },
    { href: '/glossary/btoken', label: 'bToken & bRate' },
    { href: '/learn/what-is-blend-capital', label: 'What is Blend Capital?' },
    { href: '/learn/is-stellar-defi-safe', label: 'Is Stellar DeFi safe?' },
    { href: '/learn/spield-protocol-facts', label: 'Spield protocol facts' },
  ],
  sources: [
    { href: 'https://docs.blend.capital/', label: 'Blend Documentation' },
    { href: 'https://docs.blend.capital/users/backstopping', label: 'Blend Docs — Backstopping' },
  ],
};
