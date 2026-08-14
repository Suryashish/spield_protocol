import type { Article } from '../types';

export const article: Article = {
  slug: 'what-is-blend-capital',
  title: 'What Is Blend Capital? Stellar’s Lending Protocol Explained',
  seoTitle: 'What Is Blend Capital? (Stellar Lending)',
  description:
    'Blend Capital is Stellar’s primary DeFi lending protocol. Learn how Blend works, where its yield comes from, whether it is safe, and how Spield uses it.',
  category: 'stellar',
  intent: 'informational',
  audience: 'beginner',
  primaryKeyword: 'what is Blend Capital',
  keywords: [
    'what is Blend Capital',
    'Blend Capital',
    'is Blend Capital safe',
    'Blend Capital APY',
    'Stellar lending protocol',
    'Blend backstop',
  ],
  datePublished: '2026-07-05',
  dateModified: '2026-07-05',
  readingMinutes: 0,
  body: [
    {
      type: 'answerBox',
      question: 'What is Blend Capital?',
      answer:
        'Blend Capital is the primary decentralized lending protocol on the Stellar network. Users supply assets like USDC to earn a variable yield, while borrowers post collateral to take loans, and a backstop module provides first-loss protection to each pool. Blend is the real, on-chain yield source that Spield builds its fixed-income products on.',
    },
    {
      type: 'keyTakeaways',
      items: [
        'Blend is a **non-custodial lending market** native to [Stellar](/glossary/stellar) and [Soroban](/glossary/soroban).',
        'Suppliers earn **variable yield**; borrowers pay interest against collateral.',
        'Each pool has a **backstop module** that absorbs first losses — a distinctive safety feature.',
        'Yield accrues through a rising **[bToken exchange rate](/glossary/btoken)** (`bRate`).',
        '**Spield** supplies into Blend and turns its real yield into fixed rates and [PT/YT](/glossary/yield-tokenization).',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'How does Blend Capital work?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Blend works through **isolated lending pools**: suppliers deposit an asset and receive [bTokens](/glossary/btoken) representing their share, borrowers post collateral and draw loans, and the interest borrowers pay flows to suppliers as yield. Each pool is permissionlessly created with its own risk parameters, so risk is contained rather than shared across the whole protocol.',
    },
    {
      type: 'paragraph',
      text: 'A defining feature is the **backstop module**. Backstop depositors provide first-loss capital to a pool and, in return, earn a "take rate" — a share of the interest borrowers pay. This gives each pool a cushion against bad debt and aligns incentives around pool health.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'Where does Blend’s yield come from?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Blend’s yield comes from **borrower interest** — genuine demand to borrow against collateral. This makes it [real yield](/glossary/real-yield), funded by economic activity rather than by printing a token. As interest accrues, the [bRate](/glossary/btoken) rises, so each bToken becomes redeemable for more of the underlying asset over time.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'Is Blend Capital safe?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Blend is an audited, non-custodial protocol with pool-level backstops for first-loss protection, and because it is Stellar-native it **avoids cross-chain bridge risk**. That said, like all DeFi lending it carries smart-contract risk and market risk (for example, sharp collateral price moves), so it is not risk-free — read [Is Stellar DeFi safe?](/learn/is-stellar-defi-safe) for a full breakdown.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'How does Spield use Blend?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Spield uses Blend as its **yield engine**. When you deposit USDC into Spield, it is supplied into a Blend pool; Blend’s rising bRate is the real yield Spield then tokenizes into a [Principal Token](/glossary/principal-token) and [Yield Token](/glossary/yield-token) or packages into a fixed-rate vault. Crucially, Spield’s fixed rate is tied to Blend’s actual on-chain rate, so it can never over-promise — enforced by a [solvency invariant](/glossary/solvency-invariant).',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Is Blend Capital safe?',
          a: 'Blend is an audited, non-custodial lending protocol native to Stellar, with a backstop module that absorbs first losses in each pool. It avoids bridge risk by being Stellar-only, but like all DeFi lending it still carries smart-contract and market risk.',
        },
        {
          q: 'What is the Blend Capital APY?',
          a: 'Blend’s supply APY is variable and set by pool utilization — it rises when more of the supplied assets are borrowed and falls when utilization drops. Live rates are shown in the Blend app and reflected in Spield’s underlying yield.',
        },
        {
          q: 'What is the Blend backstop module?',
          a: 'The backstop module is first-loss capital deposited into a Blend pool. Backstop depositors earn a "take rate" — a portion of borrower interest — in exchange for absorbing losses before ordinary suppliers are affected.',
        },
        {
          q: 'How is Blend different from Aave?',
          a: 'Blend and Aave are both lending markets, but Blend is native to Stellar/Soroban with permissionless isolated pools and a backstop module, while Aave runs on EVM chains. Blend’s Stellar-native design means near-zero fees and no bridge dependency.',
        },
      ],
    },
  ],
  related: [
    { href: '/learn/is-blend-capital-safe', label: 'Is Blend Capital safe?' },
    { href: '/glossary/btoken', label: 'bToken / bRate' },
    { href: '/learn/how-to-earn-yield-on-stellar', label: 'How to earn yield on Stellar' },
    { href: '/learn/is-stellar-defi-safe', label: 'Is Stellar DeFi safe?' },
    { href: '/compare/blend-vs-aave', label: 'Blend vs Aave' },
    { href: '/learn/spield-protocol-facts', label: 'Spield protocol facts' },
  ],
  sources: [
    { href: 'https://www.blend.capital/', label: 'Blend Capital' },
    { href: 'https://docs.blend.capital/', label: 'Blend Documentation' },
  ],
};
