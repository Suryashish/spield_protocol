import type { Article } from '../types';

export const article: Article = {
  slug: 'does-xlm-have-staking',
  title: 'Does XLM Have Staking? No — Here’s What Works Instead',
  seoTitle: 'Does XLM Have Staking?',
  description:
    'No. XLM cannot be staked. Stellar’s consensus pays no validator rewards, so anything sold as “XLM staking” is really lending. Here’s how yield on Stellar works.',
  category: 'stellar',
  intent: 'informational',
  audience: 'beginner',
  primaryKeyword: 'does XLM have staking',
  keywords: [
    'does XLM have staking',
    'XLM staking',
    'stake Stellar lumens',
    'XLM staking rewards',
    'Stellar proof of stake',
    'earn interest on XLM',
    'XLM passive income',
  ],
  datePublished: '2026-08-01',
  dateModified: '2026-08-01',
  readingMinutes: 0,
  body: [
    {
      type: 'answerBox',
      question: 'Does XLM have staking?',
      answer:
        'No. XLM cannot be staked. Stellar reaches consensus through the Stellar Consensus Protocol, which relies on agreement between trusted validators rather than proof-of-stake, and validators earn no rewards. Anything marketed as “XLM staking” is really a lending program wearing a familiar label — the yield never comes from the network itself.',
    },
    {
      type: 'keyTakeaways',
      items: [
        'Stellar is **not proof-of-stake**. There is no protocol reward for locking XLM, anywhere.',
        'Products advertising “XLM staking” are **lending or custody programs**: different risk, same word.',
        'XLM sitting in your own wallet **earns exactly nothing**, by design.',
        'Yield on Stellar is real but lives in **[DeFi](/learn/how-to-earn-yield-on-stellar)**: lending USDC, fixed rates, LP fees.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Why doesn’t Stellar have staking?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Stellar doesn’t have staking because nothing in its consensus needs it. Proof-of-stake networks pay rewards to people who lock tokens, because locked value is what secures the chain. Stellar secures itself differently: validators vote in overlapping trust groups under the [Stellar Consensus Protocol](/glossary/stellar), no capital is locked, and no block rewards exist to hand out. The official documentation is unusually blunt about it:',
    },
    {
      type: 'quote',
      text: 'There are no monetary rewards for being a validator on the Stellar network.',
      cite: 'Stellar Developer Documentation',
    },
    {
      type: 'paragraph',
      text: 'Trivia that settles arguments: early Stellar did have a small inflation mechanism that paid out to vote-designated accounts, and the network voted it away back in 2019. Since then, the supply is what it is. Hold 10,000 XLM in your own wallet for a decade and you will have 10,000 XLM.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'What are people actually selling as “XLM staking”?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'When a platform offers “XLM staking rewards”, the yield has to come from somewhere, and it is never the Stellar protocol. Decode the label and it is almost always one of these:',
    },
    {
      type: 'table',
      caption: 'What “XLM staking” usually means in practice',
      headers: ['What it’s called', 'What it actually is', 'The real risk'],
      rows: [
        ['“Staking” on an exchange', 'Lending your XLM to the exchange', 'Custody: their solvency is your ceiling'],
        ['“Flexible earn” programs', 'The platform deploys your coins as it sees fit', 'Opaque — you can’t verify where yield comes from'],
        ['“Locked staking” with high APY', 'A marketing rate, often subsidized and temporary', 'Rate evaporates; withdrawal locks remain'],
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Is earning on custodial programs ever worth it?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Sometimes, for people who genuinely don’t want to hold their own keys — that is a legitimate preference with a real cost attached. Just name the trade honestly: you are lending coins to a company and trusting its balance sheet, not staking on a network. The word “staking” borrows the safety reputation of protocol rewards for something that is actually unsecured lending.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'How do you earn yield on Stellar, then?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'On-chain, and mostly in stablecoins. The yield that exists on Stellar comes from real economic activity: borrowers paying interest on [Blend](/learn/what-is-blend-capital), traders paying swap fees to liquidity providers, and fixed-rate products like Spield restructuring that same lending yield into known payouts. USDC is the workhorse asset for all three — XLM’s job in your wallet is mostly to pay fees and reserves.',
    },
    {
      type: 'callout',
      variant: 'tip',
      title: 'The question that cuts through every yield ad',
      text: 'Ask “who is paying this yield, and why?” Borrowers paying interest and traders paying fees are good answers. “The platform” or silence are not. On Stellar, the good answers are all verifiable on-chain.',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Is Stellar proof-of-stake or proof-of-work?',
          a: 'Neither. Stellar uses the Stellar Consensus Protocol, a federated agreement system in which validators are chosen by trust rather than by stake or computational power, and no consensus rewards are paid.',
        },
        {
          q: 'Can I earn interest on XLM at all?',
          a: 'Only by lending it, through a custodial “earn” program or an on-chain market, which is a different risk than staking. Most on-chain yield on Stellar is denominated in USDC rather than XLM.',
        },
        {
          q: 'Why do exchanges call it staking if it isn’t?',
          a: 'Because the word converts. “Staking” sounds native and safe; “unsecured lending to our balance sheet” does not. On networks without proof-of-stake, the honest description is always the second one.',
        },
      ],
    },
  ],
  related: [
    { href: '/glossary/stellar', label: 'Stellar' },
    { href: '/glossary/real-yield', label: 'Real yield' },
    { href: '/learn/how-to-earn-yield-on-stellar', label: 'How to earn yield on Stellar' },
    { href: '/learn/usdc-yield-on-stellar', label: 'USDC yield on Stellar' },
    { href: '/learn/fixed-income-on-stellar', label: 'Fixed income on Stellar' },
  ],
  sources: [
    { href: 'https://developers.stellar.org/docs/learn/fundamentals/stellar-consensus-protocol', label: 'Stellar Developers — Stellar Consensus Protocol' },
  ],
};
