import type { Article } from '../types';

export const article: Article = {
  slug: 'is-stellar-defi-safe',
  title: 'Is Stellar DeFi Safe? Risks and Protections Explained',
  seoTitle: 'Is Stellar DeFi Safe? Risks Explained',
  description:
    'Is Stellar DeFi safe? A clear guide to the real risks — smart-contract, market, and why being Stellar-native removes bridge risk — plus how to stay safe.',
  category: 'stellar',
  intent: 'informational',
  audience: 'beginner',
  primaryKeyword: 'is Stellar DeFi safe',
  keywords: [
    'is Stellar DeFi safe',
    'Stellar DeFi risks',
    'Soroban security',
    'is Blend safe',
    'Stellar smart contract security',
    'DeFi safety',
  ],
  datePublished: '2026-07-05',
  dateModified: '2026-07-05',
  readingMinutes: 0,
  pillar: true,
  body: [
    {
      type: 'answerBox',
      question: 'Is Stellar DeFi safe?',
      answer:
        'Stellar DeFi carries the normal DeFi risks — smart-contract risk and market risk — but it removes one major category: bridge risk, because USDC is native on Stellar and leading protocols are Stellar-only. Stellar’s Soroban contracts are written in Rust and audited under a dedicated Security Audit Bank, and no major exploit has occurred since Soroban’s launch. No DeFi is risk-free, but Stellar’s design reduces several common attack surfaces.',
    },
    {
      type: 'keyTakeaways',
      items: [
        'The biggest DeFi risks are **smart-contract bugs**, **market/liquidation risk**, and **bridge exploits**.',
        'Stellar DeFi **removes bridge risk** — USDC is native and protocols like Blend and Spield are Stellar-only.',
        '[Soroban](/glossary/soroban) contracts are written in **Rust** and audited via the SDF **Security Audit Bank**.',
        'Spield adds a **[solvency invariant](/glossary/solvency-invariant)** so its fixed rate can never exceed real backing.',
        'You still control your own risk: verify contracts, understand the product, and never risk more than you can lose.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'What are the actual risks in Stellar DeFi?',
    },
    {
      type: 'table',
      caption: 'The main DeFi risks and how Stellar handles them',
      headers: ['Risk', 'What it means', 'How Stellar / Spield addresses it'],
      rows: [
        [
          'Smart-contract risk',
          'A bug in the code could be exploited',
          'Soroban is Rust-based (memory-safe); audited via SDF’s Security Audit Bank; Spield’s accounting is tested against real Blend WASM',
        ],
        [
          'Bridge risk',
          'Cross-chain bridges are a top hack target',
          '**Eliminated** — USDC is native on Stellar; Blend and Spield are Stellar-only, so there is no bridge',
        ],
        [
          'Market / liquidation risk',
          'Collateral prices move; positions can be liquidated',
          'Isolated Blend pools and backstop modules contain risk per pool',
        ],
        [
          'Solvency risk',
          'A protocol promises more than it can pay',
          'Spield’s [solvency invariant](/glossary/solvency-invariant) makes the fixed rate solvent by construction',
        ],
        [
          'Custody risk',
          'Someone else controls your keys',
          'Non-custodial — you hold your own keys in your wallet',
        ],
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Why is "no bridge" such a big deal?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Cross-chain bridges have historically been one of DeFi’s single largest sources of losses, because they concentrate assets and are complex to secure. Stellar DeFi sidesteps this entirely: **USDC is issued natively on Stellar by Circle**, and protocols like [Blend](/glossary/blend-capital) and Spield operate only on Stellar. There is no wrapped asset and no relayer to compromise, so an entire class of exploits simply does not apply.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'How secure is Soroban?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: '[Soroban](/glossary/soroban) is designed with security as a priority: contracts are written in **Rust**, a memory-safe systems language, and the Stellar Development Foundation runs a **Soroban Security Audit Bank** that has funded dozens of professional audits across the ecosystem. Since Soroban’s launch in 2024, no major protocol-level exploit has been observed — though Soroban has its own model (storage lifetimes, authorization, host types) that developers must handle carefully.',
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Safe design ≠ zero risk',
      text: 'No DeFi protocol is risk-free. Audits reduce risk but cannot prove the absence of all bugs, and market conditions can still cause losses. Treat any yield as compensation for real risk, and size positions accordingly.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'How can you protect yourself?',
    },
    {
      type: 'list',
      items: [
        'Use official, audited protocols and verify contract addresses against their docs and [Stellar Expert](https://stellar.expert/).',
        'Understand the product before depositing — know your maturity, your rate, and what can go wrong.',
        'Keep your wallet recovery phrase offline and never share it.',
        'Prefer protocols that publish their **solvency** and testing methodology (Spield exposes a live solvency invariant).',
        'Start small, especially on new protocols, and never risk funds you cannot afford to lose.',
      ],
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Has Stellar DeFi ever been hacked?',
          a: 'No major protocol-level exploit has been observed in the Stellar/Soroban DeFi ecosystem since Soroban launched, aided by the SDF Soroban Security Audit Bank that funds professional audits. This is not a guarantee against future risk, but the track record and Rust-based, bridge-free design reduce several common attack surfaces.',
        },
        {
          q: 'Is my money safe in a Stellar DeFi protocol?',
          a: 'Your funds are non-custodial, meaning you control the keys, and Stellar-native protocols avoid bridge risk. However, smart-contract and market risks remain, so no protocol can promise your money is completely safe. Use audited protocols, understand the product, and size positions to your risk tolerance.',
        },
        {
          q: 'Is Spield safe?',
          a: 'Spield is Stellar-native (no bridge risk), sources real yield from Blend rather than an invented index, and enforces a solvency invariant so its fixed rate can never exceed actual backing. Its accounting is tested against the real Blend contract. As with all DeFi, smart-contract and market risks still apply.',
        },
      ],
    },
  ],
  related: [
    { href: '/learn/what-is-blend-capital', label: 'What is Blend Capital?' },
    { href: '/learn/how-to-earn-yield-on-stellar', label: 'How to earn yield on Stellar' },
    { href: '/glossary/solvency-invariant', label: 'Solvency invariant' },
    { href: '/glossary/soroban', label: 'Soroban' },
    { href: '/learn/spield-protocol-facts', label: 'Spield protocol facts (verify on-chain)' },
  ],
  sources: [
    { href: 'https://stellar.org/blog/developers/soroban-security-audit-bank-raising-the-standard-for-smart-contract-security', label: 'SDF — Soroban Security Audit Bank' },
    { href: 'https://stellar.expert/', label: 'Stellar Expert (block explorer)' },
  ],
};
