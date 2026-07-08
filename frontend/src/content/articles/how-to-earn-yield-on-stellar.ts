import type { Article } from '../types';

export const article: Article = {
  slug: 'how-to-earn-yield-on-stellar',
  title: 'How to Earn Yield on Stellar: The Complete 2026 Guide',
  seoTitle: 'How to Earn Yield on Stellar (2026 Guide)',
  description:
    'A step-by-step guide to earning yield on Stellar — set up a wallet, get USDC, and choose between variable lending yield and a locked fixed rate with Spield.',
  category: 'stellar',
  intent: 'informational',
  audience: 'beginner',
  primaryKeyword: 'how to earn yield on Stellar',
  keywords: [
    'how to earn yield on Stellar',
    'earn yield on XLM',
    'USDC yield Stellar',
    'Stellar passive income',
    'best yield on Stellar',
    'Stellar DeFi yield',
    'guaranteed crypto returns',
    'lock yield crypto',
    'USDC yield splitting',
  ],
  datePublished: '2026-07-05',
  dateModified: '2026-07-09',
  readingMinutes: 0,
  pillar: true,
  body: [
    {
      type: 'answerBox',
      question: 'How do you earn yield on Stellar?',
      answer:
        'You earn yield on Stellar by supplying stablecoins like USDC into on-chain DeFi protocols. The simplest path is to lend USDC on Blend Capital for a variable rate, or to lock a guaranteed fixed rate through Spield, which is built on Blend’s real yield. You need a Stellar wallet (such as Freighter), some USDC, and a few minutes.',
    },
    {
      type: 'keyTakeaways',
      items: [
        'Stellar yield comes from **DeFi**, not from staking XLM — XLM is not a proof-of-stake asset, so there is no native staking reward.',
        'The main yield source on Stellar today is **lending USDC on Blend Capital**, which pays a variable rate.',
        '**Spield** sits on top of Blend and lets you **lock a fixed rate** or split your position into a tradable bond (PT) and yield token (YT).',
        'Fees on Stellar are a fraction of a cent, so yield is not eaten by gas the way it can be on Ethereum.',
        'You only need a **Stellar wallet + USDC** to start.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Where does yield on Stellar actually come from?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Yield on Stellar comes from **decentralized finance activity** — mainly the interest borrowers pay when they take loans against collateral in a lending market. When you supply USDC, borrowers pay to use it, and that interest is your yield. This is [real yield](/glossary/real-yield): it is funded by genuine economic demand, not by a protocol printing its own token.',
    },
    {
      type: 'paragraph',
      text: 'A common misconception is that you can "stake XLM" for yield the way you stake ETH or SOL. You cannot — Stellar does not use proof-of-stake, so there is no staking reward for holding XLM. Yield on Stellar is a **DeFi** activity, and the dominant venue is [Blend Capital](/glossary/blend-capital), Stellar’s primary lending protocol.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'What do you need to get started?',
    },
    {
      type: 'list',
      items: [
        'A **Stellar wallet** — [Freighter](https://www.freighter.app/) is the standard browser extension.',
        'A small amount of **XLM** to cover network fees (a fraction of a cent per transaction).',
        '**USDC on Stellar** — the stablecoin you will actually earn yield on. USDC is native on Stellar (issued by Circle), so there is no bridging required.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Step by step: earning your first yield on Stellar',
    },
    {
      type: 'steps',
      name: 'How to earn yield on Stellar with USDC',
      steps: [
        {
          title: 'Install a Stellar wallet',
          text: 'Install the [Freighter](https://www.freighter.app/) browser extension and create a wallet. Save your recovery phrase offline — anyone with it controls your funds.',
        },
        {
          title: 'Fund your wallet',
          text: 'Add a little XLM (for fees) and the USDC you want to put to work. You can buy USDC on Stellar through an exchange that supports Stellar withdrawals, or use an on-ramp. On testnet, fund free test XLM via the [Stellar Friendbot](https://friendbot.stellar.org/).',
        },
        {
          title: 'Choose variable or fixed yield',
          text: 'Decide your goal. For a **variable** rate that can rise or fall, supply USDC directly on Blend. For a **guaranteed fixed** rate you know in advance, use [Spield](/), which deposits into Blend for you and locks the rate.',
        },
        {
          title: 'Deposit',
          text: 'Connect your wallet to the app, approve the USDC, and deposit. With Spield you either pick the fixed-rate vault or mint a [Principal Token](/glossary/principal-token) + [Yield Token](/glossary/yield-token) pair.',
        },
        {
          title: 'Track and redeem',
          text: 'Your position accrues yield on-chain. With a fixed-rate vault you redeem principal plus the fixed coupon at maturity; with PT/YT you can claim yield anytime, redeem the PT at par at maturity, or trade either token on the market.',
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Variable vs fixed: which should you choose?',
    },
    {
      type: 'table',
      caption: 'Two ways to earn USDC yield on Stellar',
      headers: ['', 'Variable yield (lend on Blend)', 'Fixed yield (Spield)'],
      rows: [
        ['Rate', 'Floats with the market', 'Locked in advance'],
        ['Best for', 'Maximizing yield when rates are high', 'Certainty and planning'],
        ['Effort', 'Passive, but rate can change', 'Set once, know your payout'],
        ['Extra features', '—', 'Trade PT/YT, buy yield at a discount'],
        ['Risk profile', 'Rate risk (yield can drop)', 'Fixed return if held to maturity'],
      ],
    },
    {
      type: 'callout',
      variant: 'tip',
      title: 'Why fixed yield matters',
      text: 'Most DeFi yield is variable — you never truly know what you will earn. Locking a fixed rate turns crypto yield into something you can actually plan around, the way a traditional bond or savings certificate does. That is the core idea behind [fixed income on Stellar](/learn/fixed-income-on-stellar).',
    },
    {
      type: 'heading',
      level: 2,
      text: 'Is earning yield on Stellar safe?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Earning yield on Stellar carries the normal DeFi risks — smart-contract risk and market risk — but it avoids one major category: **bridge risk**. Because USDC is native on Stellar and protocols like Blend and Spield are Stellar-only, there is no cross-chain bridge to be exploited, which has historically been one of DeFi’s largest attack surfaces.',
    },
    {
      type: 'paragraph',
      text: 'Spield adds a further safeguard: a [solvency invariant](/glossary/solvency-invariant) enforced in its contracts, so its fixed rate can never promise more than the underlying [Blend](/glossary/blend-capital) position actually earns. Read the full breakdown in [Is Stellar DeFi safe?](/learn/is-stellar-defi-safe).',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Can I stake XLM to earn yield?',
          a: 'No. Stellar does not use proof-of-stake, so holding XLM earns no staking reward. To earn yield on Stellar you supply assets (usually USDC) into DeFi protocols like Blend, or lock a fixed rate through Spield.',
        },
        {
          q: 'What is the best yield on Stellar?',
          a: 'The best option depends on your goal. Blend offers a competitive variable rate on USDC; Spield lets you lock that yield as a fixed rate or trade it as PT/YT. For predictability, a fixed rate is usually best; for maximizing return in a high-rate environment, variable can pay more.',
        },
        {
          q: 'Do I need XLM to earn yield on Stellar?',
          a: 'You need a small amount of XLM to pay network fees, which are a fraction of a cent per transaction. The asset you actually earn yield on is typically USDC.',
        },
        {
          q: 'How much money do I need to start?',
          a: 'Very little. Stellar’s fees are near zero, so there is no practical minimum beyond covering fees. You can start earning yield with a small USDC amount and scale up.',
        },
      ],
    },
  ],
  related: [
    { href: '/learn/fixed-income-on-stellar', label: 'Fixed income on Stellar' },
    { href: '/learn/what-is-blend-capital', label: 'What is Blend Capital?' },
    { href: '/learn/is-stellar-defi-safe', label: 'Is Stellar DeFi safe?' },
    { href: '/learn/yield-tokenization', label: 'Yield tokenization explained' },
    { href: '/glossary/blend-capital', label: 'Blend Capital' },
  ],
  sources: [
    { href: 'https://www.blend.capital/', label: 'Blend Capital' },
    { href: 'https://www.circle.com/multi-chain-usdc/stellar', label: 'Circle — USDC on Stellar' },
    { href: 'https://www.freighter.app/', label: 'Freighter wallet' },
  ],
};
