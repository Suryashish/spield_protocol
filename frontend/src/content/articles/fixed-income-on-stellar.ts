import type { Article } from '../types';

export const article: Article = {
  slug: 'fixed-income-on-stellar',
  title: 'Fixed Income on Stellar: On-Chain Bonds, Fixed Rates & Yield Tokens',
  seoTitle: 'Fixed Income on Stellar: The Complete Guide',
  description:
    'Fixed income on Stellar means locking a guaranteed on-chain yield. Learn how fixed-rate vaults and principal/yield tokens bring bonds to Stellar via Spield.',
  category: 'fixed-income',
  intent: 'informational',
  audience: 'intermediate',
  primaryKeyword: 'fixed income on Stellar',
  keywords: [
    'fixed income on Stellar',
    'fixed rate yield Stellar',
    'on-chain bonds Stellar',
    'Stellar fixed income',
    'fixed income DeFi',
    'Stellar bonds',
    'principal protected defi',
    'fixed-rate crypto vault',
    'PT/USDC pool',
    'buy fixed yield crypto',
  ],
  datePublished: '2026-07-05',
  dateModified: '2026-07-09',
  readingMinutes: 0,
  pillar: true,
  body: [
    {
      type: 'answerBox',
      question: 'What is fixed income on Stellar?',
      answer:
        'Fixed income on Stellar is a class of DeFi products that pay a predictable, predetermined yield instead of a floating rate. It brings the traditional-finance idea of bonds and fixed-rate deposits on-chain to Stellar — through fixed-rate vaults and by splitting yield-bearing positions into Principal Tokens (fixed) and Yield Tokens (variable). Spield is the protocol that introduced fixed income to Stellar.',
    },
    {
      type: 'keyTakeaways',
      items: [
        '**Fixed income** trades upside for certainty: you know your return and maturity in advance.',
        'Almost all DeFi yield is **variable** — fixed income is the missing primitive that lets you lock a rate.',
        'On Stellar, fixed income is built from **real [Blend](/glossary/blend-capital) yield**, not an invented index.',
        'The building blocks are **[Principal Tokens (PT)](/glossary/principal-token)** — on-chain zero-coupon bonds — and **[Yield Tokens (YT)](/glossary/yield-token)**.',
        '**Spield** is the fixed-income layer for Stellar: fixed-rate vault, PT/YT tokenization, and a time-decay market.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Why does DeFi need fixed income at all?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'DeFi needs fixed income because almost every yield in crypto is **variable** — the rate changes block by block with supply and demand, so a depositor never really knows what they will earn. Fixed income solves that by letting you lock a known rate for a known term, exactly like a bond or a certificate of deposit in traditional finance.',
    },
    {
      type: 'paragraph',
      text: 'In traditional markets, fixed income is the largest asset class in the world — bonds are how governments, companies, and savers manage predictable cash flows. DeFi reproduced the *variable* side (lending, liquidity pools) first, but the predictable, plannable side barely existed on-chain, and on Stellar it did not exist at all before Spield.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'How is fixed income built on-chain?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'On-chain fixed income is built by **separating a yield-bearing position into its principal and its yield**, a process called [yield tokenization](/glossary/yield-tokenization). The principal becomes a token that redeems at full value on a fixed date; the yield becomes a separate token. Locking a rate is then as simple as buying the principal token at a discount.',
    },
    {
      type: 'table',
      caption: 'The two tokens that make fixed income work',
      headers: ['Token', 'What it is', 'Analogy', 'Who wants it'],
      rows: [
        [
          '[Principal Token (PT)](/glossary/principal-token)',
          'Redeems 1:1 for principal at maturity',
          'Zero-coupon bond',
          'Anyone who wants a **fixed** return',
        ],
        [
          '[Yield Token (YT)](/glossary/yield-token)',
          'Captures all yield until maturity',
          'Detached bond coupons',
          'Anyone who wants **leveraged yield** exposure',
        ],
      ],
    },
    {
      type: 'paragraph',
      text: 'Because the value of the PT plus the value of the YT always equals the underlying, the split is lossless — it just repackages the same position into a fixed leg and a variable leg. The [implied APY](/glossary/implied-apy) read from their prices is the fixed rate the market is offering.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'What makes Stellar a good home for fixed income?',
    },
    {
      type: 'list',
      items: [
        '**Near-zero fees.** Fixed income is about small, predictable returns; Stellar’s sub-cent fees mean yield is not eaten by gas the way it can be on Ethereum.',
        '**Native USDC.** Circle issues USDC natively on Stellar, so fixed-income products settle in a real stablecoin with no bridge risk.',
        '**A real yield source.** [Blend Capital](/glossary/blend-capital) provides genuine, on-chain lending yield to build fixed rates from.',
        '**Soroban smart contracts.** [Soroban](/glossary/soroban) makes the necessary DeFi primitives — vaults, AMMs, tokenization — possible on Stellar.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'The three fixed-income products on Spield',
    },
    {
      type: 'table',
      caption: 'How to use fixed income on Stellar with Spield',
      headers: ['Product', 'What you do', 'What you get'],
      rows: [
        [
          'Fixed-Rate Vault',
          'Deposit USDC, pick a term',
          'A guaranteed payout (principal + fixed coupon) at maturity',
        ],
        [
          'Tokenize (Wrapper)',
          'Deposit USDC to mint PT + YT',
          'A tradable bond (PT) and a yield token (YT)',
        ],
        [
          'PT/USDC Market',
          'Buy PT at a discount or provide liquidity',
          'Fixed yield by buying below par; LPs earn fees on a [time-decay AMM](/glossary/time-decay-amm)',
        ],
      ],
    },
    {
      type: 'callout',
      variant: 'success',
      title: 'Solvent by construction',
      text: 'Spield’s fixed rate is backed by a [solvency invariant](/glossary/solvency-invariant): because the yield index *is* Blend’s real on-chain rate, the vault can never promise more than the underlying actually earns. This is the fix for the classic "fixed yield" failure of quoting a rate you cannot back.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'Fixed income on Stellar vs tokenized treasuries',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Both offer predictable yield, but the source differs. [Tokenized treasuries](/glossary/tokenized-treasuries) derive yield *off-chain* from U.S. government bonds held by a custodian, while Spield’s fixed income derives yield *on-chain* from Stellar lending. Tokenized treasuries add regulatory and custody structure; on-chain fixed income adds permissionless access and composability.',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Is there fixed income on Stellar?',
          a: 'Yes. Spield is the fixed-income layer for Stellar, offering a fixed-rate vault, principal/yield token splitting, and a market to trade fixed yield — all built on real Blend lending yield.',
        },
        {
          q: 'How is a Principal Token like a bond?',
          a: 'A Principal Token behaves like a zero-coupon bond: it pays no interest along the way and instead redeems for full face value at a fixed maturity date, so buying it at a discount locks in a fixed return.',
        },
        {
          q: 'Where does the fixed rate come from?',
          a: 'From real on-chain yield. Spield supplies deposits into Blend Capital, Stellar’s lending protocol, and uses Blend’s rising bToken exchange rate as the yield it fixes — never an invented or unbacked index.',
        },
        {
          q: 'Can I lose money with on-chain fixed income?',
          a: 'Held to maturity, a Principal Token returns principal plus the locked-in discount. Before maturity its price moves with rates like any bond, and Yield Tokens carry more risk because they can decay to zero if realized yield underperforms the implied APY.',
        },
      ],
    },
  ],
  related: [
    { href: '/learn/how-to-earn-yield-on-stellar', label: 'How to earn yield on Stellar' },
    { href: '/learn/yield-tokenization', label: 'Yield tokenization explained' },
    { href: '/learn/pt-vs-yt', label: 'PT vs YT: which should you buy?' },
    { href: '/learn/what-is-blend-capital', label: 'What is Blend Capital?' },
    { href: '/glossary/fixed-income', label: 'Fixed income' },
    { href: '/glossary/principal-token', label: 'Principal Token (PT)' },
    { href: '/glossary/yield-token', label: 'Yield Token (YT)' },
  ],
  sources: [
    { href: 'https://www.blend.capital/', label: 'Blend Capital' },
    { href: 'https://chain.link/article/onchain-fixed-income', label: 'Chainlink — Onchain Fixed Income' },
  ],
};
