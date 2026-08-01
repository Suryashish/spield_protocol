import type { Article } from '../types';

export const article: Article = {
  slug: 'how-to-get-usdc-on-stellar',
  title: 'How to Get USDC on Stellar: Three Routes That Work',
  seoTitle: 'How to Get USDC on Stellar',
  description:
    'Three ways to get USDC on Stellar: withdraw from an exchange over the Stellar network, on-ramp through an anchor, or bridge from another chain. Trustline first.',
  category: 'stellar',
  intent: 'transactional',
  audience: 'beginner',
  primaryKeyword: 'how to get USDC on Stellar',
  keywords: [
    'how to get USDC on Stellar',
    'USDC Stellar',
    'Stellar USDC trustline',
    'withdraw USDC to Stellar',
    'buy USDC Stellar network',
    'Stellar anchor USDC',
    'bridge USDC to Stellar',
  ],
  datePublished: '2026-08-01',
  dateModified: '2026-08-01',
  readingMinutes: 0,
  body: [
    {
      type: 'answerBox',
      question: 'How do you get USDC on Stellar?',
      answer:
        'You get USDC on Stellar three ways: withdraw USDC from an exchange that supports the Stellar network, on-ramp through a Stellar anchor, or bridge USDC over from another chain. In every case your wallet first needs a USDC trustline — a one-time step that reserves 0.5 XLM.',
    },
    {
      type: 'keyTakeaways',
      items: [
        'USDC on Stellar is **issued natively by Circle**: the real thing, not a wrapped copy.',
        'Add the **USDC [trustline](/glossary/trustline)** before anything else, or incoming transfers will bounce.',
        'An **exchange withdrawal** over the Stellar network is usually the cheapest, fastest route.',
        '[Anchors](/glossary/anchor) connect bank money to Stellar directly.',
        'A **bridge is optional**, for funds already on other chains, never a requirement.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Why do you need a trustline first?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'A Stellar account only holds assets it has explicitly opted into, and that opt-in is called a [trustline](/glossary/trustline). Until your account has a trustline to Circle’s USDC, it cannot receive USDC at all — an exchange withdrawal would simply fail. Adding one takes a few seconds in any wallet (look for “add asset”), and it reserves 0.5 XLM while it exists. That’s the whole prerequisite.',
    },
    {
      type: 'callout',
      variant: 'info',
      title: 'Check the issuer, not just the ticker',
      text: 'Anyone can issue a Stellar asset called “USDC”. The real one is issued by Circle — most wallets show it as verified with the domain **centre.io** or **circle.com**. Verify the issuer once when you add the trustline and you never have to think about it again.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'Which route should you take?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'All three routes end in the same asset in the same wallet, so the choice is about where your money starts.',
    },
    {
      type: 'table',
      caption: 'Three ways to get USDC on Stellar',
      headers: ['Route', 'Your money starts as', 'What to expect'],
      rows: [
        ['**Exchange withdrawal**', 'Crypto or fiat on an exchange', 'Cheap and quick; needs an exchange that supports Stellar withdrawals'],
        ['**[Anchor](/glossary/anchor) on-ramp**', 'Money in a bank account', 'Fiat in, USDC out on Stellar; availability varies by region'],
        ['**Bridge**', 'USDC on another chain', 'Optional route; adds bridge fees and bridge risk'],
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'The exchange route, step by step',
    },
    {
      type: 'steps',
      name: 'Withdraw USDC to Stellar from an exchange',
      steps: [
        {
          title: 'Add the USDC trustline in your wallet',
          text: 'Do this first. A withdrawal to an account with no trustline will be rejected or returned.',
        },
        {
          title: 'Buy USDC on the exchange',
          text: 'Or convert what you already hold. Any major exchange lists USDC.',
        },
        {
          title: 'Withdraw and pick the Stellar network',
          text: 'The network choice is the step that matters. Choosing another chain sends your USDC somewhere your Stellar wallet will never see.',
        },
        {
          title: 'Paste your address and the memo, if asked',
          text: 'Your address starts with “G”. If the exchange shows a memo field for withdrawals, include what it asks for; when depositing back to an exchange later, the memo is usually mandatory.',
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'What about anchors and bridges?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Anchors are Stellar’s bank connectors: regulated services that take a fiat deposit and deliver the equivalent asset to your Stellar wallet, no exchange account required. Where a good anchor operates in your region and currency, this is the most direct road from a bank account to USDC on-chain.',
    },
    {
      type: 'paragraph',
      text: 'Bridges solve a different problem — USDC you already hold on another chain. The Spield app includes a bridge for exactly that case on mainnet. Worth being precise here: Spield’s protocol itself settles only in Stellar-native USDC and holds no bridged assets. The bridge is an optional way in, not part of the machinery your deposit sits in.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'How do people actually lose money doing this?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Almost never through the network, and almost always through one of three small mistakes: withdrawing over the wrong network, forgetting a memo on a deposit back to an exchange, or adding a trustline to a fake USDC. Each takes five seconds of checking to avoid. Slow down at the network dropdown. That is the honest advice.',
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Test with a small amount first',
      text: 'On your first withdrawal, send a few dollars of USDC before the real amount. Stellar’s fees are fractions of a cent, so the rehearsal costs nothing and proves the whole route end to end.',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Is USDC on Stellar the same as USDC on Ethereum?',
          a: 'Same issuer, same dollar backing, different rails. Circle issues USDC natively on both networks, so neither is a wrapped derivative of the other — but a Stellar wallet can only receive the Stellar version.',
        },
        {
          q: 'Can I send USDC from Ethereum straight to my Stellar address?',
          a: 'No. The networks are separate, and an Ethereum transfer cannot reach a Stellar address. Move it through an exchange or a bridge instead.',
        },
        {
          q: 'Do I need XLM to hold USDC on Stellar?',
          a: 'Yes, a little. Your account needs its 1 XLM minimum plus 0.5 XLM reserved for the USDC trustline, and transactions cost fractions of a cent in XLM. A couple of XLM covers a lot of activity.',
        },
        {
          q: 'What is a memo and when do I need one?',
          a: 'A memo is a short tag that tells a shared receiving account who the deposit belongs to. Exchanges rely on them: forgetting the memo when depositing to an exchange is the classic way funds get delayed in support queues.',
        },
      ],
    },
  ],
  related: [
    { href: '/glossary/trustline', label: 'Trustline' },
    { href: '/glossary/anchor', label: 'Anchor (Stellar)' },
    { href: '/learn/stellar-wallet-setup', label: 'How to set up a Stellar wallet' },
    { href: '/learn/usdc-yield-on-stellar', label: 'USDC yield on Stellar' },
    { href: '/learn/how-to-earn-yield-on-stellar', label: 'How to earn yield on Stellar' },
  ],
  sources: [
    { href: 'https://www.circle.com/usdc', label: 'Circle — USDC' },
    { href: 'https://developers.stellar.org/docs/learn/fundamentals/lumens', label: 'Stellar Developers — Lumens & reserves' },
  ],
};
