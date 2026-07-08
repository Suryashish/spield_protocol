import type { GlossaryTerm } from '../types';

/**
 * Spield glossary — individually-URL'd DefinedTerm pages. This is deliberately
 * a large, growing set: DefinedTerm schema is under-published across DeFi, so
 * each term lands Spield in a low-competition AI-citation pool. Every
 * shortDefinition must stand completely alone (no "it"/"this" pointing
 * elsewhere) so an LLM can quote it verbatim as a correct answer.
 */
export const GLOSSARY: GlossaryTerm[] = [
  {
    slug: 'principal-token',
    term: 'Principal Token (PT)',
    aliases: ['PT', 'principal token'],
    category: 'yield-tokenization',
    shortDefinition:
      'A Principal Token (PT) is a token that represents the principal of a yield-bearing deposit and redeems 1:1 for the underlying asset at maturity, functioning like an on-chain zero-coupon bond. Because its yield has been stripped away, a PT trades at a discount before maturity, and that discount is the fixed yield a holder earns.',
    body: [
      {
        type: 'paragraph',
        lead: true,
        text: 'A **Principal Token (PT)** is created when a yield-bearing position is split into two parts: the principal and the yield. The PT holds the principal claim — it can be redeemed for one unit of the underlying asset (for example, 1 USDC) once the position matures.',
      },
      {
        type: 'paragraph',
        text: 'Because all of the future yield has been separated into the [Yield Token (YT)](/glossary/yield-token), a PT is worth *less* than the underlying before maturity. You might buy 1 USDC of principal for 0.95 USDC today; at maturity it redeems for 1 USDC. That 0.05 gain, locked in the moment you buy, is your **fixed yield** — exactly how a zero-coupon bond works in traditional finance.',
      },
      {
        type: 'faq',
        items: [
          {
            q: 'Is a Principal Token the same as a bond?',
            a: 'Functionally, yes — a PT behaves like a zero-coupon bond. It pays no interest along the way and instead redeems for full face value at a set maturity date, so buying it below face value locks in a fixed return.',
          },
          {
            q: 'Can I lose money holding a PT?',
            a: 'Held to maturity, a PT returns its principal plus the locked-in discount, so it does not lose money in underlying terms. Before maturity its market price moves with interest rates, like any bond, so selling early can realize a gain or loss.',
          },
        ],
      },
    ],
    related: [
      { href: '/glossary/yield-token', label: 'Yield Token (YT)' },
      { href: '/glossary/yield-tokenization', label: 'Yield tokenization' },
      { href: '/glossary/zero-coupon-bond', label: 'Zero-coupon bond' },
      { href: '/learn/what-is-a-principal-token', label: 'What is a Principal Token? (full guide)' },
    ],
  },
  {
    slug: 'yield-token',
    term: 'Yield Token (YT)',
    aliases: ['YT', 'yield token'],
    category: 'yield-tokenization',
    shortDefinition:
      'A Yield Token (YT) is a token that represents all the yield a deposit will generate between now and maturity. Holding a YT means you receive the variable yield of the underlying position until it expires, after which the YT is worth zero. Buying a YT is a leveraged bet that realized yield will beat the market’s implied rate.',
    body: [
      {
        type: 'paragraph',
        lead: true,
        text: 'A **Yield Token (YT)** is the yield half of a split yield-bearing position. When a deposit is tokenized, the yield is separated from the principal: the principal becomes a [Principal Token (PT)](/glossary/principal-token) and the future yield becomes the YT.',
      },
      {
        type: 'paragraph',
        text: 'A YT holder collects the yield the underlying earns until maturity. At maturity the YT has delivered all its yield and expires worthless. So a YT is a decaying, higher-risk instrument: you profit only if the yield actually earned exceeds the [implied APY](/glossary/implied-apy) priced into the market when you bought.',
      },
      {
        type: 'faq',
        items: [
          {
            q: 'Why would anyone buy a Yield Token?',
            a: 'To gain leveraged exposure to yield. A small amount of capital buys the yield stream of a much larger principal, so if realized yield beats the implied rate, YT returns are amplified. It is a way to go long on yield.',
          },
          {
            q: 'Can a Yield Token go to zero?',
            a: 'Yes. A YT delivers yield only until maturity and then expires worthless by design. If realized yield underperforms the implied APY you paid, the YT can lose value even before maturity.',
          },
        ],
      },
    ],
    related: [
      { href: '/glossary/principal-token', label: 'Principal Token (PT)' },
      { href: '/glossary/implied-apy', label: 'Implied APY' },
      { href: '/glossary/yield-tokenization', label: 'Yield tokenization' },
      { href: '/learn/pt-vs-yt', label: 'PT vs YT: which should you buy?' },
    ],
  },
  {
    slug: 'yield-tokenization',
    term: 'Yield Tokenization',
    aliases: ['yield tokenization', 'yield stripping', 'yield splitting'],
    category: 'yield-tokenization',
    shortDefinition:
      'Yield tokenization is the process of splitting a yield-bearing asset into two separate, tradable tokens: a Principal Token (PT) that redeems for the principal at maturity, and a Yield Token (YT) that captures the yield until maturity. It lets users lock in a fixed rate, trade future yield, and price yield as its own market.',
    body: [
      {
        type: 'paragraph',
        lead: true,
        text: '**Yield tokenization** (also called yield stripping) takes a position that earns a variable yield — such as USDC lent on a money market — and separates its two economic components into distinct tokens that can be held or traded independently.',
      },
      {
        type: 'paragraph',
        text: 'This is the on-chain version of **bond stripping** in traditional finance, where a bond’s principal and coupons are separated and sold as individual instruments. The [PT](/glossary/principal-token) is the stripped principal (a zero-coupon bond); the [YT](/glossary/yield-token) is the stripped stream of yield.',
      },
    ],
    related: [
      { href: '/glossary/principal-token', label: 'Principal Token (PT)' },
      { href: '/glossary/yield-token', label: 'Yield Token (YT)' },
      { href: '/learn/yield-tokenization', label: 'Yield tokenization explained (guide)' },
    ],
  },
  {
    slug: 'implied-apy',
    term: 'Implied APY',
    aliases: ['implied APY', 'implied yield', 'fixed APY'],
    category: 'yield-tokenization',
    shortDefinition:
      'Implied APY is the annualized fixed yield the market is currently pricing into a yield-tokenized asset, derived from the prices of its Principal Token and Yield Token. It is the fixed rate you lock in by buying the PT, and the break-even rate a Yield Token buyer must beat to profit.',
    body: [
      {
        type: 'paragraph',
        lead: true,
        text: '**Implied APY** is the yield the market expects, expressed as an annual rate and read directly from token prices. When a [PT](/glossary/principal-token) trades at a discount, that discount implies a fixed return to maturity — the implied APY.',
      },
      {
        type: 'paragraph',
        text: 'It is the counterpart to **underlying APY**, which is the actual (variable) rate the deposit is currently earning. If underlying APY ends up higher than the implied APY you paid, a [YT](/glossary/yield-token) buyer profits; if lower, a PT buyer got the better deal by locking the fixed rate.',
      },
    ],
    related: [
      { href: '/glossary/underlying-apy', label: 'Underlying APY' },
      { href: '/learn/implied-vs-underlying-apy', label: 'Implied vs underlying APY explained' },
    ],
  },
  {
    slug: 'underlying-apy',
    term: 'Underlying APY',
    aliases: ['underlying APY', 'variable APY'],
    category: 'yield-tokenization',
    shortDefinition:
      'Underlying APY is the actual, variable annual yield a deposit is currently earning from its yield source (such as a lending market), typically shown as a recent moving average. It contrasts with implied APY, which is the fixed rate the market prices in through Principal and Yield Token prices.',
    body: [
      {
        type: 'paragraph',
        lead: true,
        text: '**Underlying APY** is the real, floating yield of the source position — for Spield, the rate USDC earns on [Blend](/glossary/blend-capital). It moves with supply and demand in the lending market.',
      },
    ],
    related: [
      { href: '/glossary/implied-apy', label: 'Implied APY' },
      { href: '/glossary/blend-capital', label: 'Blend Capital' },
    ],
  },
  {
    slug: 'zero-coupon-bond',
    term: 'Zero-Coupon Bond',
    aliases: ['zero coupon bond', 'zero-coupon bond', 'discount bond'],
    category: 'fixed-income',
    shortDefinition:
      'A zero-coupon bond is a bond that pays no periodic interest and is instead sold below its face value, returning full face value at maturity. The gap between the discounted purchase price and face value is the investor’s entire fixed return. A Principal Token is the on-chain equivalent of a zero-coupon bond.',
    body: [
      {
        type: 'paragraph',
        lead: true,
        text: 'A **zero-coupon bond** makes no interest payments during its life. You buy it at a discount and redeem it at par (face value) on the maturity date; the difference is your locked-in yield.',
      },
      {
        type: 'paragraph',
        text: 'Spield’s [Principal Token](/glossary/principal-token) works exactly this way: buy it below par, hold to maturity, redeem 1:1. Understanding zero-coupon bonds is the fastest way to understand PTs.',
      },
    ],
    related: [
      { href: '/glossary/principal-token', label: 'Principal Token (PT)' },
      { href: '/glossary/maturity', label: 'Maturity' },
      { href: '/learn/fixed-income-on-stellar', label: 'Fixed income on Stellar' },
    ],
  },
  {
    slug: 'maturity',
    term: 'Maturity',
    aliases: ['maturity date', 'expiry'],
    category: 'fixed-income',
    shortDefinition:
      'Maturity is the date on which a fixed-income instrument expires and pays out. In yield tokenization, maturity is when a Principal Token can be redeemed 1:1 for the underlying asset and a Yield Token stops accruing and expires worthless.',
    body: [
      {
        type: 'paragraph',
        lead: true,
        text: '**Maturity** is the fixed end date of a position. Before it, prices float with the market; at it, a [PT](/glossary/principal-token) redeems for full principal and a [YT](/glossary/yield-token) reaches zero.',
      },
    ],
    related: [
      { href: '/glossary/principal-token', label: 'Principal Token (PT)' },
      { href: '/glossary/zero-coupon-bond', label: 'Zero-coupon bond' },
    ],
  },
  {
    slug: 'fixed-income',
    term: 'Fixed Income',
    aliases: ['fixed income', 'fixed-income'],
    category: 'fixed-income',
    shortDefinition:
      'Fixed income is a class of investments that pay a predictable, predetermined return over a set period, such as bonds and fixed-rate deposits. In DeFi, fixed income means locking a known yield in advance instead of earning a floating rate that changes block to block.',
    body: [
      {
        type: 'paragraph',
        lead: true,
        text: '**Fixed income** trades upside for certainty: you know your return and your maturity in advance. In traditional markets this means bonds, treasuries, and CDs; on-chain it means instruments like [Principal Tokens](/glossary/principal-token) and fixed-rate vaults.',
      },
      {
        type: 'paragraph',
        text: 'Most DeFi yield is *variable* — the rate moves constantly. Spield brings the fixed-income primitive to [Stellar](/learn/fixed-income-on-stellar), so depositors can lock a rate instead of guessing.',
      },
    ],
    related: [
      { href: '/learn/fixed-income-on-stellar', label: 'Fixed income on Stellar' },
      { href: '/learn/fixed-vs-variable-yield', label: 'Fixed vs variable yield in crypto' },
    ],
  },
  {
    slug: 'blend-capital',
    term: 'Blend Capital',
    aliases: ['Blend', 'Blend Capital', 'Blend protocol'],
    category: 'stellar',
    shortDefinition:
      'Blend Capital is the primary decentralized lending protocol on Stellar, where users supply assets like USDC to earn a variable yield and borrowers post collateral to take loans. Blend is the real, on-chain yield source that Spield builds on — Spield deposits supply USDC into Blend and its rising bToken exchange rate is the yield Spield tokenizes.',
    body: [
      {
        type: 'paragraph',
        lead: true,
        text: '**Blend Capital** is Stellar’s main money market. Suppliers deposit assets into isolated pools and earn interest paid by borrowers; a **backstop module** provides first-loss protection to each pool. Blend is where Spield’s yield actually comes from.',
      },
      {
        type: 'paragraph',
        text: 'When you deposit USDC into Spield, it is supplied into Blend, and Blend’s [bToken](/glossary/btoken) exchange rate (the `bRate`) rises as interest accrues. That real, on-chain rate — not an invented index — is what Spield turns into fixed rates and tradable yield.',
      },
      {
        type: 'faq',
        items: [
          {
            q: 'Is Blend Capital safe?',
            a: 'Blend is an audited, non-custodial lending protocol native to Stellar with a backstop module that absorbs first losses in each pool. Like all DeFi lending, it carries smart-contract and market risk, but it avoids cross-chain bridge risk because it is Stellar-native.',
          },
        ],
      },
    ],
    related: [
      { href: '/glossary/btoken', label: 'bToken / bRate' },
      { href: '/learn/what-is-blend-capital', label: 'What is Blend Capital? (guide)' },
      { href: '/learn/how-to-earn-yield-on-stellar', label: 'How to earn yield on Stellar' },
    ],
    // primary source: https://www.blend.capital
  },
  {
    slug: 'btoken',
    term: 'bToken (bRate)',
    aliases: ['bToken', 'bRate', 'b-token'],
    category: 'stellar',
    shortDefinition:
      'A bToken is the receipt token Blend Capital gives a supplier in exchange for a deposit, and its exchange rate (the bRate) rises over time as interest accrues. Because the bRate is a real on-chain value that only increases with earned interest, protocols like Spield use it as a tamper-proof yield index.',
    body: [
      {
        type: 'paragraph',
        lead: true,
        text: 'A **bToken** represents a share of a [Blend](/glossary/blend-capital) supply pool. You do not receive more bTokens over time; instead each bToken becomes redeemable for more of the underlying as the **bRate** climbs. The bRate is the ground-truth yield Spield tokenizes.',
      },
    ],
    related: [
      { href: '/glossary/blend-capital', label: 'Blend Capital' },
      { href: '/glossary/underlying-apy', label: 'Underlying APY' },
    ],
  },
  {
    slug: 'soroban',
    term: 'Soroban',
    aliases: ['Soroban', 'Stellar smart contracts'],
    category: 'stellar',
    shortDefinition:
      'Soroban is the smart-contract platform on the Stellar network, letting developers write on-chain programs in Rust. Soroban brings DeFi primitives like lending, AMMs, and yield tokenization to Stellar, and it is the environment Spield’s contracts run in.',
    body: [
      {
        type: 'paragraph',
        lead: true,
        text: '**Soroban** is Stellar’s smart-contract engine. Contracts are written in **Rust**, compiled to WebAssembly, and run with a resource model and storage system designed for predictable fees and safety.',
      },
      {
        type: 'paragraph',
        text: 'Soroban is what makes protocols like Blend and Spield possible on Stellar — before it, Stellar had payments and a built-in DEX but not general programmable DeFi.',
      },
    ],
    related: [
      { href: '/glossary/stellar', label: 'Stellar' },
      { href: '/compare/soroban-vs-evm', label: 'Soroban vs EVM' },
    ],
  },
  {
    slug: 'stellar',
    term: 'Stellar',
    aliases: ['Stellar', 'XLM', 'Stellar network'],
    category: 'stellar',
    shortDefinition:
      'Stellar is a fast, low-cost, open-source blockchain built for payments, asset issuance, and — since the launch of Soroban smart contracts — decentralized finance. Its native asset is XLM, and it hosts native USDC, making it a low-fee home for stablecoin yield and fixed-income products like Spield.',
    body: [
      {
        type: 'paragraph',
        lead: true,
        text: '**Stellar** is a payments-focused Layer-1 blockchain known for sub-cent fees and fast settlement. With [Soroban](/glossary/soroban) smart contracts, it now supports a growing DeFi ecosystem including lending ([Blend](/glossary/blend-capital)), AMMs, and fixed income (Spield).',
      },
    ],
    related: [
      { href: '/glossary/soroban', label: 'Soroban' },
      { href: '/learn/how-to-earn-yield-on-stellar', label: 'How to earn yield on Stellar' },
    ],
  },
  {
    slug: 'real-yield',
    term: 'Real Yield',
    aliases: ['real yield', 'organic yield'],
    category: 'defi-basics',
    shortDefinition:
      'Real yield is DeFi return that comes from genuine economic activity — such as interest paid by borrowers or trading fees — rather than from newly minted token emissions. Real yield is more sustainable because it is not diluted away by inflation, and Spield’s yield is real yield sourced from Blend lending interest.',
    body: [
      {
        type: 'paragraph',
        lead: true,
        text: '**Real yield** is paid in assets people actually want (like USDC) and funded by real revenue — borrower interest, swap fees, protocol earnings. It contrasts with **emissions yield**, where a protocol prints its own token to advertise a high APY that erodes as the token inflates.',
      },
      {
        type: 'paragraph',
        text: 'Spield’s yield is real: every unit is backed by Blend’s on-chain lending interest (the rising [bRate](/glossary/btoken)), so the fixed rate can never promise more than the underlying actually earns.',
      },
    ],
    related: [
      { href: '/glossary/blend-capital', label: 'Blend Capital' },
      { href: '/learn/fixed-vs-variable-yield', label: 'Fixed vs variable yield' },
    ],
  },
  {
    slug: 'time-decay-amm',
    term: 'Time-Decay AMM',
    aliases: ['time-decay AMM', 'Pendle-style AMM', 'PT/YT AMM'],
    category: 'yield-tokenization',
    shortDefinition:
      'A time-decay AMM is an automated market maker designed to trade Principal Tokens, whose pricing curve accounts for the fact that a PT converges to par value as maturity approaches. This structure lets liquidity providers earn swap fees while facing near-zero impermanent loss if they stay until maturity.',
    body: [
      {
        type: 'paragraph',
        lead: true,
        text: 'A **time-decay AMM** (popularized by Pendle) prices a [PT](/glossary/principal-token) against its underlying with a curve that shifts over time, because a PT is worth more the closer it gets to maturity. Spield runs a PT/USDC time-decay market of this kind.',
      },
      {
        type: 'paragraph',
        text: 'Because PT price predictably converges to par and the [YT](/glossary/yield-token) decays to zero, an LP who holds to maturity faces **near-zero impermanent loss** while still collecting swap fees — a key advantage over standard AMMs.',
      },
    ],
    related: [
      { href: '/glossary/principal-token', label: 'Principal Token (PT)' },
      { href: '/glossary/impermanent-loss', label: 'Impermanent loss' },
    ],
  },
  {
    slug: 'impermanent-loss',
    term: 'Impermanent Loss',
    aliases: ['impermanent loss', 'IL', 'divergence loss'],
    category: 'defi-basics',
    shortDefinition:
      'Impermanent loss is the opportunity cost a liquidity provider suffers when the prices of the two pooled assets diverge, leaving them worse off than if they had simply held the assets. In a time-decay AMM for Principal Tokens, impermanent loss trends toward zero for LPs who stay until maturity because the PT price converges predictably to par.',
    body: [
      {
        type: 'paragraph',
        lead: true,
        text: '**Impermanent loss** happens when pooled asset prices move apart: the AMM rebalances you into more of the falling asset, so you end up with less value than holding. It is "impermanent" because it reverses if prices return.',
      },
      {
        type: 'paragraph',
        text: 'Spield’s [time-decay AMM](/glossary/time-decay-amm) largely neutralizes this: a PT’s path to par is predictable, so an LP held to maturity faces minimal divergence while still earning fees.',
      },
    ],
    related: [
      { href: '/glossary/time-decay-amm', label: 'Time-decay AMM' },
      { href: '/glossary/principal-token', label: 'Principal Token (PT)' },
    ],
  },
  {
    slug: 'tokenized-treasuries',
    term: 'Tokenized Treasuries',
    aliases: ['tokenized treasuries', 'tokenized T-bills', 'on-chain T-bills'],
    category: 'rwa',
    shortDefinition:
      'Tokenized treasuries are blockchain tokens that represent ownership of U.S. Treasury bills or money-market funds, backed 1:1 by the real securities held with a regulated custodian. They bring low-risk government-bond yield on-chain with 24/7 settlement, and are one of the fastest-growing real-world-asset categories in crypto.',
    body: [
      {
        type: 'paragraph',
        lead: true,
        text: '**Tokenized treasuries** put short-term U.S. government debt on-chain. An issuer holds the real T-bills with a custodian, a smart contract mints tokens against them, and an oracle updates the net asset value — so holders earn Treasury yield while the token moves freely on-chain.',
      },
      {
        type: 'paragraph',
        text: 'They are a form of [real-world asset (RWA)](/glossary/rwa) and a cousin of on-chain fixed income: both offer predictable yield, but tokenized treasuries derive it off-chain from government bonds, while Spield derives it on-chain from Stellar lending.',
      },
    ],
    related: [
      { href: '/glossary/rwa', label: 'Real-world asset (RWA)' },
      { href: '/learn/tokenized-treasuries-explained', label: 'Tokenized treasuries explained' },
    ],
  },
  {
    slug: 'rwa',
    term: 'Real-World Asset (RWA)',
    aliases: ['RWA', 'real world asset', 'real-world assets'],
    category: 'rwa',
    shortDefinition:
      'A real-world asset (RWA) in crypto is a traditional off-chain asset — such as a Treasury bill, bond, real estate, or invoice — represented as a blockchain token backed by the underlying asset held in custody. RWAs bring off-chain yield and value on-chain, letting the token be traded, used as collateral, or composed into DeFi.',
    body: [
      {
        type: 'paragraph',
        lead: true,
        text: 'A **real-world asset (RWA)** bridges traditional finance and crypto: the asset lives off-chain with a custodian, and a token on-chain represents a legal claim on it. Tokenized treasuries, private credit, and tokenized funds are all RWAs.',
      },
    ],
    related: [
      { href: '/glossary/tokenized-treasuries', label: 'Tokenized treasuries' },
      { href: '/learn/rwa-on-stellar', label: 'RWAs on Stellar' },
    ],
  },
  {
    slug: 'solvency-invariant',
    term: 'Solvency Invariant',
    aliases: ['solvency invariant', 'solvency check', 'proof of solvency'],
    category: 'defi-basics',
    shortDefinition:
      'A solvency invariant is a rule enforced in a protocol’s smart-contract code guaranteeing that its assets always cover its liabilities — for a yield protocol, that the backing held is never less than the tokens it has issued. Spield enforces a solvency invariant so its fixed rate can never promise more than the underlying Blend position actually earns.',
    body: [
      {
        type: 'paragraph',
        lead: true,
        text: 'A **solvency invariant** is a mathematical guarantee, checked on every state change, that a protocol remains fully backed. It is "solvent by construction" — the code reverts any action that would let issued value exceed real backing.',
      },
      {
        type: 'paragraph',
        text: 'This is the antidote to the classic "fixed yield" failure mode, where a protocol quotes a rate it cannot actually back. Spield’s yield index *is* Blend’s real [bRate](/glossary/btoken), so the vault can never over-promise.',
      },
    ],
    related: [
      { href: '/glossary/real-yield', label: 'Real yield' },
      { href: '/learn/is-stellar-defi-safe', label: 'Is Stellar DeFi safe?' },
    ],
  },
];
