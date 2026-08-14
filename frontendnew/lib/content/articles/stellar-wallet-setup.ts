import type { Article } from '../types';

export const article: Article = {
  slug: 'stellar-wallet-setup',
  title: 'How to Set Up a Stellar Wallet: A Freighter Walkthrough',
  seoTitle: 'How to Set Up a Stellar Wallet',
  description:
    'Set up a Stellar wallet in about five minutes: install Freighter, back up the recovery phrase, fund the 1 XLM minimum, and connect to apps like Spield.',
  category: 'stellar',
  intent: 'informational',
  audience: 'beginner',
  primaryKeyword: 'Stellar wallet setup',
  keywords: [
    'Stellar wallet setup',
    'how to set up a Stellar wallet',
    'Freighter wallet',
    'Freighter setup',
    'best Stellar wallet',
    'Stellar wallet for DeFi',
    'XLM wallet',
  ],
  datePublished: '2026-08-01',
  dateModified: '2026-08-01',
  readingMinutes: 0,
  body: [
    {
      type: 'answerBox',
      question: 'How do you set up a Stellar wallet?',
      answer:
        'To set up a Stellar wallet, install the Freighter browser extension, create a wallet, write the recovery phrase down offline, and send a little XLM to activate the account — Stellar requires a 1 XLM minimum balance. After that you can add trustlines for assets like USDC and connect to Stellar apps.',
    },
    {
      type: 'keyTakeaways',
      items: [
        '**Freighter** is the most widely used Stellar wallet: open-source, non-custodial, free.',
        'The **recovery phrase is the wallet.** Anyone holding it holds your funds; no one legitimate will ever ask for it.',
        'A new account needs **1 XLM to exist**, plus **0.5 XLM of reserve per [trustline](/glossary/trustline)** you add.',
        'Alternatives exist for every platform: Albedo, Rabet, xBull, LOBSTR, and Hana all connect to Spield.',
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'What do you need before you start?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'You need three things: a browser, ten minutes, and a small amount of XLM — a few units is plenty. The XLM matters because Stellar accounts are not free to open: the network requires a minimum balance of 1 XLM to activate an address, which keeps its ledger free of dust accounts. You can buy XLM on any major exchange and withdraw it to your new address as the activation deposit.',
    },
    {
      type: 'paragraph',
      text: 'Something worth knowing before you begin: a wallet does not hold your money. Your assets live on the Stellar ledger; the wallet holds the secret key that controls them. That is the thing you are really setting up, and protecting, in the steps below.',
    },
    {
      type: 'heading',
      level: 2,
      text: 'Setting up Freighter, step by step',
    },
    {
      type: 'steps',
      name: 'Set up a Stellar wallet with Freighter',
      steps: [
        {
          title: 'Install Freighter',
          text: 'Get the extension from [freighter.app](https://www.freighter.app/). Type the address yourself rather than following ads or search results, which is where fake wallets live.',
        },
        {
          title: 'Create a new wallet and password',
          text: 'The password only locks the extension on this device. It is not a backup and cannot recover anything on its own.',
        },
        {
          title: 'Write down the recovery phrase',
          text: 'On paper, offline, stored somewhere safe. A screenshot or notes app copy is one device-compromise away from being everyone’s recovery phrase.',
        },
        {
          title: 'Fund the account with XLM',
          text: 'Send at least 2 XLM from an exchange to your new public address (it starts with “G”). The first 1 XLM activates the account; the rest covers reserves and fees, which cost fractions of a cent.',
        },
        {
          title: 'Connect to an app',
          text: 'Open a Stellar app such as Spield, choose “Connect wallet”, and approve the connection in Freighter. You approve every transaction individually from here on.',
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'Which Stellar wallet should you choose?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Freighter is the default answer for desktop DeFi, but it is not the only good one. Every wallet below is non-custodial and connects to Spield; pick by the device you actually use.',
    },
    {
      type: 'table',
      caption: 'Stellar wallets that work with Spield',
      headers: ['Wallet', 'Where it lives', 'Good fit for'],
      rows: [
        ['**Freighter**', 'Browser extension + mobile', 'Desktop DeFi, most-tested app support'],
        ['**LOBSTR**', 'Mobile app + web', 'Everyday mobile use, beginners'],
        ['**xBull**', 'Extension, web, mobile', 'Power users who want every platform'],
        ['**Rabet**', 'Browser extension', 'A lightweight extension alternative'],
        ['**Albedo**', 'Web-based signer', 'Signing without installing anything'],
        ['**Hana**', 'Extension + mobile', 'A newer, clean multi-platform option'],
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: 'How do you keep it safe?',
    },
    {
      type: 'paragraph',
      lead: true,
      text: 'Wallet security on Stellar comes down to one sentence: whoever has the recovery phrase has the money. Exchanges can freeze a stolen account; a non-custodial wallet has no such undo button, and that cuts both ways. Nobody can lock you out. Nobody can bail you out either.',
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'The three scams that actually work',
      text: 'Fake wallet extensions in search ads, “support agents” who ask for your recovery phrase, and links that ask you to “validate” or “sync” your wallet. All three end the same way. Real support — Spield’s included — will never ask for your phrase, ever.',
    },
    {
      type: 'faq',
      items: [
        {
          q: 'Is Freighter free to use?',
          a: 'Yes. Freighter is open-source and charges no wallet fees; the only costs are Stellar network fees, which run to fractions of a cent per transaction.',
        },
        {
          q: 'Why does my new Stellar account say I need more XLM?',
          a: 'Stellar requires every account to keep a minimum balance: 1 XLM for the account itself, plus 0.5 XLM of reserve for each trustline or other entry you add. Top up with a little more XLM and the error goes away.',
        },
        {
          q: 'Can I use the same wallet on desktop and phone?',
          a: 'Yes, by importing the same recovery phrase into both — Freighter ships a mobile app, and wallets like xBull and Hana span platforms. Every copy is a full copy, so guard each device accordingly.',
        },
      ],
    },
  ],
  related: [
    { href: '/glossary/trustline', label: 'Trustline' },
    { href: '/glossary/stellar', label: 'Stellar' },
    { href: '/learn/how-to-get-usdc-on-stellar', label: 'How to get USDC on Stellar' },
    { href: '/learn/how-to-earn-yield-on-stellar', label: 'How to earn yield on Stellar' },
    { href: '/learn/is-stellar-defi-safe', label: 'Is Stellar DeFi safe?' },
  ],
  sources: [
    { href: 'https://www.freighter.app/', label: 'Freighter — official site' },
    { href: 'https://developers.stellar.org/docs/learn/fundamentals/lumens', label: 'Stellar Developers — Lumens & reserves' },
  ],
};
