import type { Article } from '../types';

export const article: Article = {
  slug: 'fixed-income-defi-for-institutions',
  title: 'Fixed-Income DeFi for Institutions & Capital Investors on Stellar',
  seoTitle: 'Fixed-Income DeFi for Institutions | Spield',
  description:
    'For treasuries and capital investors: earn a fixed, predictable return on USDC with principal-protected, liquidation-free DeFi on Stellar, backed by a verifiable on-chain solvency invariant.',
  category: 'institutional',
  intent: 'commercial',
  audience: 'institutional',
  primaryKeyword: 'fixed income defi',
  keywords: [
    'fixed income defi',
    'institutional DeFi',
    'principal protected defi',
    'guaranteed crypto returns',
    'guaranteed DeFi yield',
    'no liquidation risk crypto',
    'fixed return on crypto',
    'DeFi for corporate treasuries',
    'fixed-rate crypto vault',
    'USDC fixed yield',
  ],
  datePublished: '2026-07-09',
  dateModified: '2026-07-09',
  readingMinutes: 0,
  body: [
    {
      type: 'answerBox',
      question: 'Can institutions earn a fixed return on capital in DeFi?',
      answer:
        'Yes. Fixed-income DeFi lets an institution or capital investor lock a fixed, predetermined return on deployed USDC — the on-chain equivalent of a bond or fixed-rate deposit. On Stellar, Spield offers this through a principal-protected, liquidation-free fixed-rate vault backed by real Blend lending yield and a smart-contract solvency invariant, so the quoted rate can never exceed the underlying it holds.',
    },
    {
      type: 'keyTakeaways',
      items: [
        '**Fixed return on capital deployed.** A capital allocator can lock a known yield for a known term instead of accepting a floating rate that moves block to block.',
        '**Principal protected.** A [Principal Token (PT)](/glossary/principal-token) redeems 1:1 for its underlying at maturity — held to maturity, the principal is returned in full.',
        '**No liquidation risk.** The fixed-rate position is a supply-side deposit, not a leveraged loan, so there is no collateral to be liquidated.',
        '**Verifiable backing.** A [solvency invariant](/glossary/solvency-invariant) enforced in the contracts guarantees issued value never exceeds real on-chain backing — auditable at any block.',
        '**No bridge exposure.** Spield is Stellar-native: both the underlying and settlement currency (native USDC) live on Stellar, removing cross-chain bridge risk entirely.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Why do institutions want fixed income on-chain?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Institutions and capital investors want fixed income on-chain because a treasury cannot plan around a yield that changes every block. A corporate treasury, fund, or DAO allocating stablecoins needs a **known return for a known term** to model cash flows — exactly what bonds and fixed-rate deposits provide in traditional finance, and exactly what most DeFi lacks.',
    },
    {
      type: 'paragraph',
      text: 'Almost all DeFi yield is *variable*: supply USDC to a lending market and the rate floats with demand. That is fine for opportunistic capital but unworkable for a treasury with liabilities to match. Fixed-income DeFi closes that gap by letting an allocator convert a floating position into a **fixed, guaranteed return** — the on-chain version of buying a bond.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'How does a fixed-rate DeFi vault protect principal?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'A fixed-rate DeFi vault protects principal because the position it issues — a [Principal Token](/glossary/principal-token) — is an on-chain zero-coupon bond that **redeems 1:1 for the underlying at maturity**. You deposit USDC, the vault locks a fixed rate, and at the maturity date you redeem principal plus the fixed coupon. Held to maturity, the principal is returned in full; the return is known the moment you deposit.',
    },
    {
      type: 'table',
      caption: 'How fixed-income DeFi compares for a capital allocator',
      headers: ['Property', 'Variable DeFi lending', 'Fixed-income DeFi (Spield)'],
      rows: [
        ['Return', 'Floats block to block', '**Fixed and known in advance**'],
        ['Principal', 'Repaid, but rate uncertain', '**Principal protected — PT redeems 1:1 at maturity**'],
        ['Liquidation risk', 'None on supply side; borrowers can be liquidated', '**None — a supply deposit, not a leveraged loan**'],
        ['Backing', 'Pool solvency', '**Enforced [solvency invariant](/glossary/solvency-invariant), verifiable on-chain**'],
        ['Bridge risk', 'Depends on chain', '**None — Stellar-native, native USDC**'],
      ],
    },
    {
      type: 'callout',
      variant: 'success',
      title: 'Guaranteed by construction, not by promise',
      text: 'The classic failure mode of "guaranteed crypto returns" is a protocol quoting a rate it cannot actually back. Spield avoids this because its yield index *is* [Blend](/glossary/blend-capital)’s real on-chain lending rate, and a [solvency invariant](/glossary/solvency-invariant) reverts any action that would let issued value exceed real backing. The guarantee is enforced in code and auditable, not asserted in marketing.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'Is there liquidation risk in a fixed-rate vault?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'No. A fixed-rate vault deposit carries **no liquidation risk** because you are supplying capital, not borrowing against collateral. Liquidations happen to *borrowers* whose collateral falls below a threshold; a Spield fixed-rate depositor takes no loan and posts no collateral, so there is nothing to liquidate. The main residual risks are smart-contract risk and, if you sell a Principal Token before maturity, ordinary interest-rate price movement.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'How can an institution verify the backing?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'An institution can verify the backing directly on-chain because Spield publishes its contract addresses, configuration, and design guarantees, and enforces backing through a [solvency invariant](/glossary/solvency-invariant) that can be checked at any block. There is no off-chain custodian to trust for the yield itself — the backing is Blend’s on-chain supply position, and its value is readable on the ledger.',
    },
    {
      type: 'list',
      items: [
        'Read the [protocol facts](/learn/spield-protocol-facts) — every contract and asset address, verifiable on [Stellar Expert](https://stellar.expert/explorer/testnet).',
        'Pull the machine-readable [facts endpoint](/api/stats.json) for structured protocol data and live metrics.',
        'Confirm the yield source is real: deposits become a [Blend](/glossary/blend-capital) supply position whose [bToken](/glossary/btoken) rate rises on-chain — no invented index.',
        'Check the [solvency invariant](/glossary/solvency-invariant): backing ÷ issued value is kept ≥ 1 by the contract, so the protocol is solvent by construction.',
      ],
    },
    {
      type: 'callout',
      variant: 'info',
      title: 'Complementary to tokenized treasuries',
      text: 'Fixed-income DeFi is not a replacement for [tokenized treasuries](/learn/tokenized-treasuries-explained) like Franklin Templeton’s BENJI (issued on Stellar) — it is a complement. Tokenized treasuries deliver off-chain government-bond yield with regulatory and custody structure; on-chain fixed income delivers permissionless, composable yield from Stellar lending. A treasury can hold both.',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Can an institution get a guaranteed fixed return in DeFi?',
          a: 'An institution can lock a fixed, predetermined return by holding a Principal Token to maturity or depositing into a fixed-rate vault. The rate is fixed in advance and enforced by a solvency invariant, so it can never exceed the real on-chain yield backing it. As with any smart contract, the guarantee is subject to contract risk, but the rate itself is not left floating.',
        },
        {
          q: 'Is fixed-income DeFi principal protected?',
          a: 'A Principal Token redeems 1:1 for its underlying asset at maturity, so principal is protected when held to maturity. Selling a Principal Token before maturity exposes you to interest-rate price movement, like selling a bond early.',
        },
        {
          q: 'Does a fixed-rate DeFi deposit have liquidation risk?',
          a: 'No. A fixed-rate deposit is supply-side capital, not a leveraged loan, so there is no collateral to be liquidated. Liquidation risk applies to borrowers, not to fixed-rate depositors.',
        },
        {
          q: 'How does a capital allocator verify the yield is real?',
          a: 'The yield comes from Blend Capital, Stellar’s lending protocol, via its on-chain rising bToken exchange rate. Contract addresses and configuration are published, and a solvency invariant enforced in code keeps issued value at or below real backing — all verifiable on the Stellar ledger.',
        },
      ],
    },
  ],
  related: [
    { href: '/learn/fixed-income-on-stellar', label: 'Fixed income on Stellar' },
    { href: '/learn/is-stellar-defi-safe', label: 'Is Stellar DeFi safe?' },
    { href: '/learn/spield-protocol-facts', label: 'Spield protocol facts' },
    { href: '/learn/tokenized-treasuries-explained', label: 'Tokenized treasuries explained' },
    { href: '/glossary/principal-token', label: 'Principal Token (PT)' },
    { href: '/glossary/solvency-invariant', label: 'Solvency invariant' },
    { href: '/glossary/fixed-income', label: 'Fixed income' },
  ],
  sources: [
    { href: 'https://www.blend.capital/', label: 'Blend Capital' },
    { href: 'https://chain.link/article/onchain-fixed-income', label: 'Chainlink — Onchain Fixed Income' },
  ],
};
