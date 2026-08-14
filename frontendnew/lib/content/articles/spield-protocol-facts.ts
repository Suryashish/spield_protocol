import type { Article } from '../types';
import { PROTOCOL_FACTS as F } from '@/lib/seo/facts';

/**
 * The protocol-facts page. Built directly from the facts module so the visible
 * page, the /api/stats.json endpoint, and the Dataset schema never drift.
 * This is the AEO anchor: a single, authoritative, machine-readable source of
 * Spield's on-chain facts that AI engines and agents can cite and verify.
 */
export const article: Article = {
  slug: 'spield-protocol-facts',
  title: 'Spield Protocol Facts: Contracts, Config & On-Chain Data',
  seoTitle: 'Spield Protocol Facts & On-Chain Data',
  description:
    'Authoritative facts about Spield: contract addresses, network, products, config, and guarantees — plus a machine-readable stats endpoint to verify.',
  category: 'stellar',
  intent: 'informational',
  audience: 'intermediate',
  primaryKeyword: 'Spield protocol facts',
  keywords: ['Spield protocol facts', 'Spield contract addresses', 'Spield solvency', 'Spield stats', 'Spield on-chain data'],
  datePublished: '2026-07-06',
  dateModified: F.factsUpdated,
  readingMinutes: 0,
  dataset: true,
  body: [
    {
      type: 'answerBox',
      question: 'What is Spield and where can its on-chain facts be verified?',
      answer:
        `Spield is a fixed-income and yield-tokenization protocol on Stellar. It sources real yield from ${F.yieldSource}. Every fact on this page — contract addresses, network, products, and configuration — is published in a machine-readable form at spield.live/api/stats.json and can be independently verified on ${F.networkLabel} via Stellar Expert.`,
    },
    {
      type: 'keyTakeaways',
      // copied out: PROTOCOL_FACTS is `as const`, so its arrays are readonly
      items: [...F.guarantees],
    },
    {
      type: 'callout',
      variant: 'info',
      title: 'Machine-readable & verifiable',
      text: 'These facts are also served as JSON at [/api/stats.json](/api/stats.json) for AI agents and integrations, and every contract can be checked directly on-chain via [Stellar Expert](https://stellar.expert/explorer/testnet). This is proof, not marketing.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'What does Spield offer?',
    },
    {
      type: 'table',
      caption: 'Spield products',
      headers: ['Product', 'What it does'],
      rows: F.products.map((p) => [`**${p.name}**`, p.description]),
    },
    {
      type: 'heading',
      level: 2,
      text: 'What is the protocol configuration?',
    },
    {
      type: 'table',
      caption: `Configuration (${F.networkLabel})`,
      headers: ['Parameter', 'Value'],
      rows: F.config.map((c) => [c.label, c.value]),
    },
    {
      type: 'heading',
      level: 2,
      text: 'What are the Spield contract addresses?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: `Spield is deployed as four focused Soroban contracts on ${F.networkLabel}. Each can be verified on [Stellar Expert](${F.explorer}).`,
    },
    {
      type: 'table',
      caption: 'Spield contracts',
      headers: ['Contract', 'Role', 'Address'],
      rows: F.contracts.map((c) => [`**${c.name}**`, c.role, `\`${c.address}\``]),
    },
    {
      type: 'table',
      caption: 'Assets',
      headers: ['Asset', 'Role', 'Address'],
      rows: F.assets.map((a) => [`**${a.name}**`, a.role, `\`${a.address}\``]),
    },
    {
      type: 'table',
      caption: 'Dependencies',
      headers: ['Component', 'Role', 'Address'],
      rows: F.dependencies.map((d) => [`**${d.name}**`, d.role, `\`${d.address}\``]),
    },
    {
      type: 'heading',
      level: 2,
      text: 'What are the live protocol metrics?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Live metrics (current fixed APR, total value locked, and the solvency ratio) are read from the contracts on-chain. Where a value is not yet wired to a live data source, it is shown as pending rather than estimated — Spield does not publish invented numbers.',
    },
    {
      type: 'table',
      caption: 'Live metrics',
      headers: ['Metric', 'Value', 'How it is derived'],
      rows: F.live.map((m) => [
        m.label,
        m.value === null ? 'pending live source' : `${m.value} ${m.unit}`,
        m.method,
      ]),
    },
    {
      type: 'callout',
      variant: 'success',
      title: 'Solvent by construction',
      text: 'Spield enforces a [solvency invariant](/glossary/solvency-invariant) in its contracts: because the yield index is Blend’s real on-chain rate, issued value can never exceed real backing. The solvency ratio above is expected to stay at or above 1 by design.',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'How can I verify Spield’s contracts myself?',
          a: `Copy any contract address from this page and look it up on Stellar Expert at ${F.explorer}/contract/<address>. The contracts, assets, and Blend dependency are all publicly viewable on-chain.`,
        },
        {
          q: 'Is there a machine-readable version of these facts?',
          a: 'Yes. The same facts are served as JSON at spield.live/api/stats.json, so AI agents, integrations, and researchers can pull exact values without scraping the page.',
        },
        {
          q: 'Where does Spield’s yield come from?',
          a: `From ${F.yieldSource}. It is real, on-chain lending yield, not an invented index, and the solvency invariant ensures the protocol can never promise more than the underlying actually earns.`,
        },
      ],
    },
  ],
  related: [
    { href: '/learn/is-stellar-defi-safe', label: 'Is Stellar DeFi safe?' },
    { href: '/glossary/solvency-invariant', label: 'Solvency invariant' },
    { href: '/learn/what-is-blend-capital', label: 'What is Blend Capital?' },
    { href: '/learn/what-is-a-fixed-rate-vault', label: 'What is a fixed-rate vault?' },
    { href: '/learn/how-to-earn-yield-on-stellar', label: 'How to earn yield on Stellar' },
  ],
  sources: [
    { href: 'https://stellar.expert/explorer/testnet', label: 'Stellar Expert (verify contracts on-chain)' },
    { href: 'https://www.blend.capital/', label: 'Blend Capital' },
  ],
};
