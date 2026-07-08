import type { Comparison } from '../types';

export const comparison: Comparison = {
  slug: 'soroban-vs-evm',
  title: 'Soroban vs EVM: Stellar Smart Contracts vs Ethereum',
  seoTitle: 'Soroban vs EVM: Smart Contracts Compared',
  description:
    'Soroban vs EVM: Soroban runs Rust/WASM smart contracts on Stellar with predictable fees and a safety-first model; the EVM runs Solidity across Ethereum.',
  primaryKeyword: 'Soroban vs EVM',
  keywords: ['Soroban vs EVM', 'Soroban vs Solidity', 'Stellar smart contracts vs Ethereum', 'Soroban explained', 'Rust smart contracts Stellar'],
  datePublished: '2026-07-05',
  dateModified: '2026-07-05',
  intent: 'informational',
  audience: 'intermediate',
  body: [
    {
      type: 'answerBox',
      question: 'What is the difference between Soroban and the EVM?',
      answer:
        'Soroban is Stellar’s smart-contract platform, where contracts are written in Rust and compiled to WebAssembly, whereas the EVM (Ethereum Virtual Machine) runs Solidity contracts on Ethereum and compatible chains. Soroban emphasizes memory safety, predictable fees, parallel transaction execution, and a state-archival model that keeps live state cheap, while the EVM offers the largest developer ecosystem and tooling in crypto.',
    },
    {
      type: 'keyTakeaways',
      items: [
        '**[Soroban](/glossary/soroban)** = Rust + WebAssembly smart contracts on [Stellar](/glossary/stellar).',
        '**EVM** = Solidity smart contracts on Ethereum and EVM-compatible chains.',
        'Soroban emphasizes **memory safety (Rust)**, predictable fees, and explicit state management.',
        'EVM has the **largest ecosystem**, tooling, and liquidity.',
        'Soroban is what enables DeFi like Blend and Spield on Stellar.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Soroban vs EVM: side by side',
    },
    {
      type: 'table',
      caption: 'Soroban vs EVM comparison',
      headers: ['', 'Soroban (Stellar)', 'EVM (Ethereum)'],
      rows: [
        ['Language', 'Rust → WebAssembly', 'Solidity → EVM bytecode'],
        ['Live since', 'Feb 2024 (Protocol 20)', '2015'],
        ['Memory safety', 'Rust (memory-safe by design)', 'Depends on contract patterns'],
        ['Fees', 'Sub-cent, predictable', 'Gas — higher and variable'],
        ['Execution', 'Parallel (Protocol 23)', 'Mostly sequential'],
        ['State model', 'State archival + auto-restore', 'Persistent storage'],
        ['Ecosystem', 'Growing', 'Largest in crypto'],
        ['DeFi on it', 'Blend, Spield, AMMs', 'Aave, Uniswap, Pendle, etc.'],
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'What makes Soroban different?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Soroban is built with a **safety-first** philosophy: contracts are written in Rust, a memory-safe systems language, and the platform uses a **state-archival** model that moves inactive data to a cheaper archive while keeping live state in memory. As of Protocol 23 (September 2025), archived entries are **automatically restored** when a transaction touches them, and contracts execute in **parallel** — so the model targets predictable low fees and fewer whole classes of bugs, while introducing Soroban-specific concepts (authorization model, host types, storage lifetimes) that developers must learn.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'Why does this matter for DeFi users?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'It matters because Soroban is what makes programmable DeFi — lending, AMMs, and [yield tokenization](/learn/yield-tokenization) — possible on Stellar at all. Before Soroban, Stellar had payments and a built-in DEX but not general smart contracts. Its low, predictable fees are also a direct benefit to fixed-income products, where every basis point of cost matters.',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Is Soroban better than the EVM?',
          a: 'Neither is strictly better — they make different trade-offs. Soroban prioritizes memory safety, predictable low fees, and explicit state management, while the EVM offers the largest ecosystem, tooling, and liquidity. The right choice depends on your goals and where your users and assets are.',
        },
        {
          q: 'Can EVM developers build on Soroban?',
          a: 'Yes, but they write in Rust rather than Solidity and learn Soroban’s model (authorization, host types, and storage lifetimes / state archival). The concepts transfer, but the language and execution model are different.',
        },
      ],
    },
  ],
  related: [
    { href: '/glossary/soroban', label: 'Soroban' },
    { href: '/glossary/stellar', label: 'Stellar' },
    { href: '/learn/is-stellar-defi-safe', label: 'Is Stellar DeFi safe?' },
    { href: '/learn/fixed-income-on-stellar', label: 'Fixed income on Stellar' },
  ],
  sources: [
    { href: 'https://developers.stellar.org/docs/build/smart-contracts/overview', label: 'Stellar — Soroban smart contracts overview' },
    { href: 'https://stellar.org/blog/developers/announcing-protocol-23', label: 'Stellar — Announcing Protocol 23' },
  ],
};
