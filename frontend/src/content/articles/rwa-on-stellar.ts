import type { Article } from '../types';

export const article: Article = {
  slug: 'rwa-on-stellar',
  title: 'RWAs on Stellar: Real-World Assets and Tokenized Yield',
  seoTitle: 'RWAs on Stellar: Real-World Assets Guide',
  description:
    'RWAs on Stellar: Franklin Templeton’s BENJI, native USDC, and how real-world assets combine with on-chain fixed income to bring real yield on-chain.',
  category: 'rwa',
  intent: 'informational',
  audience: 'intermediate',
  primaryKeyword: 'RWAs on Stellar',
  keywords: ['RWAs on Stellar', 'real world assets Stellar', 'Franklin Templeton BENJI Stellar', 'tokenized assets Stellar', 'Stellar RWA'],
  datePublished: '2026-07-05',
  dateModified: '2026-07-05',
  readingMinutes: 0,
  body: [
    {
      type: 'answerBox',
      question: 'What real-world assets are on Stellar?',
      answer:
        'Stellar hosts native USDC issued by Circle and tokenized real-world assets including Franklin Templeton’s BENJI, an on-chain U.S. government money-market fund. Combined with on-chain lending via Blend and fixed income via Spield, this makes Stellar a low-cost network for bringing real, off-chain and on-chain yield together in one place.',
    },
    {
      type: 'keyTakeaways',
      items: [
        '[Real-world assets (RWAs)](/glossary/rwa) bring off-chain value and yield on-chain as tokens.',
        'Stellar hosts **native USDC** (Circle) and **Franklin Templeton BENJI** (a tokenized money-market fund).',
        'Stellar’s **near-zero fees** and payments focus make it well-suited to RWAs and stablecoin yield.',
        'On-chain fixed income (Spield) and RWAs are complementary ways to earn predictable yield.',
        'Both benefit from Stellar being **bridge-free** for native USDC.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Why is Stellar a natural home for RWAs?',
    },
    {
      type: 'list',
      items: [
        '**Payments-native design.** Stellar was built for issuing and moving assets, which is exactly what tokenized RWAs require.',
        '**Near-zero fees.** RWA yields are modest and predictable; Stellar’s sub-cent fees keep them intact.',
        '**Native USDC.** RWAs settle against a real, natively-issued stablecoin — no bridge risk.',
        '**Institutional adoption.** Franklin Templeton chose Stellar for its BENJI money-market fund, a strong institutional signal.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'RWAs vs on-chain fixed income on Stellar',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Both give you predictable yield, but from different sources. [Tokenized treasuries](/learn/tokenized-treasuries-explained) and money-market funds derive yield **off-chain** from government securities, while Spield derives yield **on-chain** from Stellar lending on [Blend](/glossary/blend-capital). RWAs add regulated custody and traditional-asset exposure; on-chain fixed income adds permissionless access and composability.',
    },
    {
      type: 'callout',
      variant: 'info',
      title: 'They fit together',
      text: 'A Stellar user could hold a tokenized money-market fund for T-bill exposure and use Spield to lock a fixed rate on their USDC — two complementary ways to turn idle stablecoins into predictable yield on the same low-fee network.',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Is Franklin Templeton’s BENJI on Stellar?',
          a: 'Yes. Franklin Templeton’s BENJI, a tokenized U.S. government money-market fund, is issued on Stellar, making it one of the most prominent institutional real-world assets in the ecosystem.',
        },
        {
          q: 'How do RWAs relate to Spield?',
          a: 'RWAs and Spield both bring real yield on-chain, and Spield’s architecture can, over time, add tokenized-RWA yield sources through its adapter design. Today Spield sources yield from Blend; the same fixed-income tooling could wrap RWA yield in future.',
        },
      ],
    },
  ],
  related: [
    { href: '/glossary/rwa', label: 'Real-world asset (RWA)' },
    { href: '/learn/tokenized-treasuries-explained', label: 'Tokenized treasuries explained' },
    { href: '/learn/fixed-income-on-stellar', label: 'Fixed income on Stellar' },
    { href: '/glossary/stellar', label: 'Stellar' },
  ],
  sources: [
    { href: 'https://www.circle.com/multi-chain-usdc/stellar', label: 'Circle — USDC on Stellar' },
  ],
};
