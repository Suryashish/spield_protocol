import type { Article } from '../types';

export const article: Article = {
  slug: 'verifiable-transparent-defi',
  title: 'Verifiable, Transparent DeFi: On-Chain Solvency Proof & Real Backing',
  seoTitle: 'Verifiable DeFi: On-Chain Solvency Proof | Spield',
  description:
    'How a transparent crypto vault proves its backing: on-chain solvency proof, verifiable DeFi backing, and yield you can audit at any block on Stellar.',
  category: 'defi-basics',
  intent: 'informational',
  audience: 'intermediate',
  primaryKeyword: 'verifiable DeFi backing',
  keywords: [
    'verifiable DeFi backing',
    'on-chain solvency proof',
    'transparent crypto vault',
    'proof of reserves DeFi',
    'proof of solvency',
    'auditable DeFi',
    'verifiable crypto yield',
    'is my DeFi yield backed',
  ],
  datePublished: '2026-07-09',
  dateModified: '2026-07-09',
  readingMinutes: 0,
  body: [
    {
      type: 'answerBox',
      question: 'How do you verify that a DeFi yield protocol is actually backed?',
      answer:
        'You verify a DeFi yield protocol by checking that its backing is real, on-chain, and enforced in code — not asserted in marketing. A transparent crypto vault publishes its contract addresses, derives yield from a verifiable on-chain source, and enforces a solvency invariant that keeps issued value at or below real backing. Spield does all three on Stellar, so its backing is provable at any block.',
    },
    {
      type: 'keyTakeaways',
      items: [
        '**On-chain solvency proof.** A [solvency invariant](/glossary/solvency-invariant) enforced in the contract keeps backing ÷ issued value ≥ 1 at every state change — checkable at any block.',
        '**Real, verifiable yield source.** Backing is a [Blend](/glossary/blend-capital) supply position whose [bToken](/glossary/btoken) rate rises on-chain — not an invented index.',
        '**Published contract logic.** Spield’s contracts are on-chain, so anyone can read exactly how mint, redeem, and the solvency check behave.',
        '**Transparent vault.** Contract addresses, config, and design guarantees are published and mirrored in a machine-readable [facts endpoint](/api/stats.json).',
        '**Stronger than proof-of-reserves.** Instead of a periodic snapshot, the backing is enforced continuously by the contract itself.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'What is an on-chain solvency proof?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'An on-chain solvency proof is a guarantee, enforced directly in a protocol’s smart-contract code, that its assets always cover its liabilities. Rather than publishing a periodic attestation, the contract checks on **every state change** that real backing is never less than the value it has issued, and reverts any action that would break the rule. The protocol is therefore *solvent by construction*.',
    },
    {
      type: 'paragraph',
      text: 'Spield implements this as a [solvency invariant](/glossary/solvency-invariant): the value of the [Principal Tokens](/glossary/principal-token) and [Yield Tokens](/glossary/yield-token) it issues can never exceed the value of the underlying [Blend](/glossary/blend-capital) position backing them. Because the yield index *is* Blend’s real on-chain rate, the vault can never quote or promise more than it actually holds.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'How is this different from proof of reserves?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Proof of reserves is a *snapshot* — a point-in-time attestation that reserves existed on a given date. An on-chain solvency invariant is *continuous* — the backing is re-verified by the contract on every deposit, mint, and redemption, so there is no window between attestations in which the protocol could quietly become insolvent.',
    },
    {
      type: 'table',
      caption: 'Snapshot attestation vs enforced invariant',
      headers: ['Property', 'Proof of reserves (snapshot)', 'Solvency invariant (Spield)'],
      rows: [
        ['When it holds', 'At the attestation date', '**Every block, every state change**'],
        ['Who enforces it', 'An off-chain auditor', '**The smart contract itself**'],
        ['Failure between checks', 'Possible, unseen', '**Impossible — the transaction reverts**'],
        ['What backs it', 'Reported reserves', '**Live on-chain Blend supply position**'],
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'What makes a crypto vault transparent?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'A transparent crypto vault is one where anyone can independently verify what it holds, what it has issued, and how it behaves — without trusting the operator’s word. That requires three things: published contract addresses, a verifiable on-chain yield source, and open logic for how funds move.',
    },
    {
      type: 'list',
      items: [
        '**Published addresses.** Every contract, asset, and dependency address is listed on the [protocol facts](/learn/spield-protocol-facts) page and verifiable on [Stellar Expert](https://stellar.expert/explorer/testnet).',
        '**Machine-readable facts.** A structured [facts endpoint](/api/stats.json) exposes config and live metrics for agents and integrators to pull directly.',
        '**Verifiable yield.** The backing is a [Blend](/glossary/blend-capital) supply position; its rising [bToken](/glossary/btoken) rate is readable on the ledger, so the yield is provably real.',
        '**On-chain contract logic.** Spield’s mint/redeem and solvency-check logic runs on-chain and can be inspected on the ledger.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Why does verifiable backing matter?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Verifiable backing matters because it lets anyone — users, auditors, AI agents, and integrators — check the exact rules that govern their funds instead of trusting a description of them. When the contract that mints your Principal Token and enforces the solvency invariant runs on-chain and its addresses are published, "verifiable backing" stops being a claim and becomes something you can check yourself.',
    },
    {
      type: 'callout',
      variant: 'tip',
      title: 'Verify, don’t trust',
      text: 'The strongest transparency signal is not a badge — it is the ability to reproduce the claim. Read the [protocol facts](/learn/spield-protocol-facts), pull the [facts JSON](/api/stats.json), open the contracts on [Stellar Expert](https://stellar.expert/explorer/testnet), and confirm the Blend backing yourself. Everything Spield claims about its backing is designed to be independently checkable.',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'What is an on-chain solvency proof?',
          a: 'It is a rule enforced in a protocol’s smart-contract code that guarantees its assets always cover its liabilities. The contract checks on every state change that real backing is never less than issued value and reverts anything that would break the rule, making the protocol solvent by construction.',
        },
        {
          q: 'How can anyone check how the protocol behaves?',
          a: 'Spield publishes its contract addresses, so anyone can inspect how deposits, PT/YT minting, redemption, and the solvency invariant behave on-chain and verify the backing on the Stellar ledger.',
        },
        {
          q: 'How is a solvency invariant better than proof of reserves?',
          a: 'Proof of reserves is a snapshot at a single date; a solvency invariant is enforced continuously by the contract on every deposit, mint, and redemption. There is no window between attestations in which the protocol could become insolvent unnoticed.',
        },
        {
          q: 'How can I verify Spield’s backing myself?',
          a: 'Read the protocol facts page for every contract and asset address, pull the machine-readable facts JSON endpoint, and open the contracts on Stellar Expert. The backing is a Blend supply position whose value is readable on the Stellar ledger.',
        },
      ],
    },
  ],
  related: [
    { href: '/learn/is-stellar-defi-safe', label: 'Is Stellar DeFi safe?' },
    { href: '/learn/spield-protocol-facts', label: 'Spield protocol facts' },
    { href: '/learn/fixed-income-defi-for-institutions', label: 'Fixed-income DeFi for institutions' },
    { href: '/glossary/solvency-invariant', label: 'Solvency invariant' },
    { href: '/glossary/real-yield', label: 'Real yield' },
    { href: '/glossary/blend-capital', label: 'Blend Capital' },
  ],
  sources: [
    { href: 'https://www.blend.capital/', label: 'Blend Capital' },
    { href: 'https://stellar.expert/explorer/testnet', label: 'Stellar Expert' },
  ],
};
