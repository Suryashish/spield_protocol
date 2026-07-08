import type { Article } from '../types';

export const article: Article = {
  slug: 'tokenized-treasuries-explained',
  title: 'Tokenized Treasuries Explained: On-Chain T-Bills for Beginners',
  seoTitle: 'Tokenized Treasuries Explained (On-Chain T-Bills)',
  description:
    'Tokenized treasuries put U.S. T-bill yield on-chain, backed 1:1 by real securities. Learn how they work, if they are safe, and how they relate to DeFi.',
  category: 'rwa',
  intent: 'informational',
  audience: 'beginner',
  primaryKeyword: 'tokenized treasuries explained',
  keywords: ['tokenized treasuries explained', 'on-chain T-bills', 'what are tokenized treasuries', 'tokenized treasury bills', 'how do tokenized treasuries work'],
  datePublished: '2026-07-05',
  dateModified: '2026-07-05',
  readingMinutes: 0,
  body: [
    {
      type: 'answerBox',
      question: 'What are tokenized treasuries?',
      answer:
        'Tokenized treasuries are blockchain tokens that represent ownership of U.S. Treasury bills or money-market funds, backed 1:1 by the real securities held with a regulated custodian. They bring low-risk government-bond yield on-chain with 24/7 settlement and fractional access, and are one of the fastest-growing real-world-asset categories in crypto.',
    },
    {
      type: 'keyTakeaways',
      items: [
        'Tokenized treasuries = **U.S. T-bill exposure as a blockchain token**, backed 1:1 by real securities.',
        'A custodian holds the bills; a smart contract mints tokens; an oracle updates the value.',
        'They offer **government-bond yield** (recently ~3–5%) with **24/7, fractional** on-chain access.',
        'Examples: BlackRock **BUIDL**, Ondo **OUSG/USDY**, Franklin **BENJI**.',
        'They are a type of [real-world asset (RWA)](/glossary/rwa) and a cousin of on-chain [fixed income](/learn/fixed-income-on-stellar).',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'How do tokenized treasuries work?',
    },
    {
      type: 'steps',
      name: 'How a tokenized treasury works',
      steps: [
        { title: 'The issuer buys the securities', text: 'A regulated issuer buys short-term U.S. Treasuries or shares of a money-market fund.' },
        { title: 'A custodian holds them', text: 'The real securities are held by a regulated custodian, keeping the token backed 1:1.' },
        { title: 'A smart contract mints tokens', text: 'On-chain tokens are minted to represent claims on the underlying, often restricted to eligible investors.' },
        { title: 'An oracle updates value', text: 'An oracle updates the net asset value (typically daily) so the token reflects accrued yield.' },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Why do tokenized treasuries matter?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Tokenized treasuries matter because they let on-chain capital earn **safe, familiar government-bond yield without leaving the blockchain**. Instead of holding idle stablecoins, a crypto treasury or investor can hold a token that pays T-bill yield, settles instantly, trades 24/7, and can be composed into DeFi — for example as collateral.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'Are tokenized treasuries safe?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Tokenized treasuries are backed by some of the lowest-risk assets in the world (short-term U.S. government debt) held with regulated custodians, which makes their *underlying* very safe. The added risks are **on-chain risks** — smart-contract bugs, oracle/NAV accuracy, issuer and custody counterparty risk, and access restrictions or redemption gates. The underlying is low-risk; the wrapper introduces new considerations.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'Tokenized treasuries vs on-chain DeFi fixed income',
    },
    {
      type: 'table',
      caption: 'Two ways to get predictable on-chain yield',
      headers: ['', 'Tokenized treasuries', 'On-chain fixed income (e.g. Spield)'],
      rows: [
        ['Yield source', 'Off-chain U.S. Treasuries', 'On-chain lending ([Blend](/glossary/blend-capital))'],
        ['Backing', 'Real securities in custody', 'On-chain assets + [solvency invariant](/glossary/solvency-invariant)'],
        ['Access', 'Often gated / eligibility rules', 'Permissionless'],
        ['Settlement', '24/7 on-chain', '24/7 on-chain'],
        ['Trust model', 'Issuer + custodian', 'Smart contract'],
      ],
    },
    {
      type: 'faq',
      items: [
        {
          q: 'What is the difference between tokenized treasuries and stablecoins?',
          a: 'A stablecoin holds its value at $1 and usually pays no yield to the holder, while a tokenized treasury pays the yield of the underlying Treasuries. Both can be backed by similar assets, but tokenized treasuries pass the interest to you.',
        },
        {
          q: 'Are tokenized treasuries available on Stellar?',
          a: 'Yes — Stellar hosts tokenized real-world assets, including Franklin Templeton’s BENJI money-market fund. See our guide to RWAs on Stellar for how they fit the ecosystem.',
        },
      ],
    },
  ],
  related: [
    { href: '/glossary/tokenized-treasuries', label: 'Tokenized treasuries (glossary)' },
    { href: '/glossary/rwa', label: 'Real-world asset (RWA)' },
    { href: '/learn/rwa-on-stellar', label: 'RWAs on Stellar' },
    { href: '/learn/fixed-income-on-stellar', label: 'Fixed income on Stellar' },
  ],
  sources: [
    { href: 'https://app.rwa.xyz/treasuries', label: 'RWA.xyz — Tokenized Treasuries data' },
  ],
};
