import {
  LayoutDashboard,
  Lock,
  Coins,
  TrendingUp,
  Layers,
  Droplets,
  Package,
  ArrowRightLeft,
  type LucideIcon,
} from 'lucide-react';

export interface GuideStepItem {
  number: number;
  title: string;
  description: string;
}

export interface GuideSection {
  id: string;
  icon: LucideIcon;
  shortLabel: string;
  title: string;
  subtitle: string;
  badge: string;
  route: string;
  concept: string;
  steps: GuideStepItem[];
  proTip: string;
  highlights: Array<{ label: string; value: string }>;
  graphicType: 'overview' | 'vault' | 'deposit' | 'markets' | 'v2' | 'liquidity' | 'srwrap' | 'bridge';
}

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'overview',
    icon: LayoutDashboard,
    shortLabel: 'Overview',
    title: 'Welcome to Spield',
    subtitle: 'Institutional-grade fixed-income DeFi & yield tokenization on Stellar.',
    badge: 'Step 1 of 8 · Foundations',
    route: '/overview',
    concept:
      'Spield allows you to lock fixed yields or speculate on interest rates. We split yield-bearing USDC deposits into Principal Tokens (PT) and Yield Tokens (YT), backed 1:1 on-chain.',
    steps: [
      {
        number: 1,
        title: 'Connect Freighter Wallet',
        description:
          'Click the Connect Wallet pill at the top right to link your Freighter, Lobstr, or hardware wallet on Stellar.',
      },
      {
        number: 2,
        title: 'Pick Your Strategy',
        description:
          'Choose the Fixed Vault for simple guaranteed returns, Deposit to split PT/YT, or Markets to trade discounts.',
      },
      {
        number: 3,
        title: 'Track Performance & Backing',
        description:
          'Monitor your total portfolio balance, accrued earnings, and verified 100%+ solvency proofs in real time.',
      },
    ],
    proTip:
      'All principal is backed by real collateral supplied into Blend, Stellar’s primary decentralized lending market.',
    highlights: [
      { label: 'Settlement', value: '< 5 seconds' },
      { label: 'Backing', value: '100% On-chain' },
      { label: 'Network', value: 'Stellar Soroban' },
    ],
    graphicType: 'overview',
  },
  {
    id: 'vault',
    icon: Lock,
    shortLabel: 'Fixed Vault',
    title: 'Fixed-Rate Vault',
    subtitle: 'The easiest way to earn a guaranteed, predictable return with zero hassle.',
    badge: 'Step 2 of 8 · Fixed Savings',
    route: '/vault',
    concept:
      'Deposit USDC and lock in a fixed return until maturity. No need to understand PT or YT token mechanics — the vault manages everything for you.',
    steps: [
      {
        number: 1,
        title: 'Enter Deposit Amount',
        description:
          'Input the amount of USDC you wish to deposit. The calculator instantly shows your locked APY and maturity date.',
      },
      {
        number: 2,
        title: 'Review Locked Return',
        description:
          'Confirm your transaction. You will receive an on-chain receipt guaranteeing your exact payout at term end.',
      },
      {
        number: 3,
        title: 'Redeem at Maturity',
        description:
          'When the series matures, redeem your receipt 1:1 for your original principal plus guaranteed fixed coupon.',
      },
    ],
    proTip:
      'The vault holds the Principal Tokens (PT) itself, so your wallet requires zero custom trustlines or manual management.',
    highlights: [
      { label: 'Rate Type', value: 'Guaranteed Fixed' },
      { label: 'Setup', value: 'No Trustlines Needed' },
      { label: 'Backing', value: '1:1 by PT' },
    ],
    graphicType: 'vault',
  },
  {
    id: 'deposit',
    icon: Coins,
    shortLabel: 'Deposit & Mint',
    title: 'Deposit & Par Splitting',
    subtitle: 'Split yield-bearing deposits into fixed bonds (PT) and floating yield tokens (YT).',
    badge: 'Step 3 of 8 · Token Splitting',
    route: '/deposit',
    concept:
      '1 USDC splits into 1 PT + 1 YT at exact par value with zero slippage. PT gives you guaranteed principal back at maturity; YT gives you 100% of the interest earned along the way.',
    steps: [
      {
        number: 1,
        title: 'Specify USDC to Split',
        description:
          'Enter how much USDC you want to supply. Your funds are deposited into Blend lending pool to earn real interest.',
      },
      {
        number: 2,
        title: 'Receive PT + YT at Par',
        description:
          'Receive equal amounts of PT (fixed zero-coupon bond) and YT (interest claim) with zero curve spread or slippage.',
      },
      {
        number: 3,
        title: 'Recombine or Trade',
        description:
          'Recombine 1 PT + 1 YT anytime before maturity to withdraw your initial USDC, or trade each piece independently.',
      },
    ],
    proTip:
      'Par splitting has zero price impact: 100 USDC will always mint exactly 100 PT and 100 YT.',
    highlights: [
      { label: 'Mint Ratio', value: '1 USDC = 1 PT + 1 YT' },
      { label: 'Slippage', value: '0.00%' },
      { label: 'Recombination', value: 'Instant & Free' },
    ],
    graphicType: 'deposit',
  },
  {
    id: 'markets',
    icon: TrendingUp,
    shortLabel: 'Markets',
    title: 'Markets & AMM Trading',
    subtitle: 'Trade PT at a discount for fixed APY or trade YT for high-leverage yield speculation.',
    badge: 'Step 4 of 8 · Trading AMM',
    route: '/markets',
    concept:
      'PT trades below $1.00 and drifts toward par as maturity nears. Buying PT locks the discount as guaranteed fixed yield. Buying YT gives you levered upside on rising interest rates.',
    steps: [
      {
        number: 1,
        title: 'Choose Buy PT or Long YT',
        description:
          'Select Buy PT to lock in fixed APY, Sell PT to liquidate early, or Long YT to speculate on higher Blend yields.',
      },
      {
        number: 2,
        title: 'Check Market Discount & APY',
        description:
          'Review the live implied APY generated automatically by the time-decay AMM curve based on current supply and demand.',
      },
      {
        number: 3,
        title: 'Swap with Native USDC',
        description:
          'Execute the swap in a single transaction. The router automatically handles wrapping and contract interactions.',
      },
    ],
    proTip:
      'Because PT automatically converges to $1.00 at maturity, buying earlier locks in higher annualized fixed yields.',
    highlights: [
      { label: 'Curve Model', value: 'Time-Decay AMM' },
      { label: 'PT Pricing', value: 'Discount → $1.00 Par' },
      { label: 'YT Exposure', value: 'High Leverage' },
    ],
    graphicType: 'markets',
  },
  {
    id: 'v2',
    icon: Layers,
    shortLabel: 'Yield',
    title: 'Yield Accrual & Claiming',
    subtitle: 'Harvest accrued variable interest straight to native USDC without burning your tokens.',
    badge: 'Step 5 of 8 · Harvest Interest',
    route: '/v2',
    concept:
      'Holding YT continuously accrues variable interest as Blend borrowers pay borrowing fees. Claim your accumulated yield anytime without giving up your position.',
    steps: [
      {
        number: 1,
        title: 'Inspect Claimable Yield',
        description:
          'View your live accrued yield balance in real time. It updates continuously as Blend’s supply index climbs.',
      },
      {
        number: 2,
        title: 'Claim Straight to USDC',
        description:
          'Click Claim Yield. The smart contract router harvests your interest and settles it into your wallet as liquid USDC.',
      },
      {
        number: 3,
        title: 'Keep Your YT Intact',
        description:
          'Claiming is non-destructive! Your YT tokens are not burned, so they continue generating interest until maturity.',
      },
    ],
    proTip:
      'YT is an asset, not debt — you can never be liquidated or margin called regardless of market volatility.',
    highlights: [
      { label: 'Settlement', value: '1-Signature USDC' },
      { label: 'YT Impact', value: 'Non-Destructive' },
      { label: 'Liquidation Risk', value: '0%' },
    ],
    graphicType: 'v2',
  },
  {
    id: 'liquidity',
    icon: Droplets,
    shortLabel: 'Liquidity',
    title: 'Liquidity Provision',
    subtitle: 'Provide PT and USDC liquidity to earn swap fees with built-in impermanent loss protection.',
    badge: 'Step 6 of 8 · Earn Fees',
    route: '/liquidity',
    concept:
      'Supply liquidity to the PT/SR pool and earn 80% of all swap fees. Because PT mathematically converges to par, holding LP until maturity eliminates impermanent loss.',
    steps: [
      {
        number: 1,
        title: 'Supply PT + USDC',
        description:
          'Deposit PT alongside USDC. The panel automatically wraps your USDC into yield-bearing SR under the hood.',
      },
      {
        number: 2,
        title: 'Earn 80% of Swap Fees',
        description:
          'Every trade in the AMM pays a fee. LPs keep 80% of all fees, which compound directly into the pool reserves.',
      },
      {
        number: 3,
        title: 'Withdraw Anytime',
        description:
          'Burn your LP shares whenever you want to redeem your proportional slice of PT and SR, including fee rewards.',
      },
    ],
    proTip:
      'Unlike standard AMM pools where token prices fluctuate randomly, PT price movement toward $1.00 is predictable.',
    highlights: [
      { label: 'LP Fee Split', value: '80% to LPs' },
      { label: 'IL Profile', value: 'Minimizes to 0 at term' },
      { label: 'Withdrawal', value: 'Unrestricted' },
    ],
    graphicType: 'liquidity',
  },
  {
    id: 'srwrap',
    icon: Package,
    shortLabel: 'SR Wrapper',
    title: 'SR Dollar Wrapper',
    subtitle: 'Hold a yield-bearing dollar with no maturity date or term lockup.',
    badge: 'Step 7 of 8 · Perpetual Dollar',
    route: '/srwrap',
    concept:
      'SR (Stellar Reserve share) is an interest-bearing token backed by Blend pool supply. Its redemption exchange rate against USDC only ever rises as lending interest compounds.',
    steps: [
      {
        number: 1,
        title: 'Wrap USDC to SR',
        description:
          'Convert liquid USDC into SR shares at the live exchange rate with a single confirmation.',
      },
      {
        number: 2,
        title: 'Earn Floating Dollar Yield',
        description:
          'Hold SR in your wallet as an appreciating dollar asset. It has no expiration date and requires no rollover.',
      },
      {
        number: 3,
        title: 'Unwrap Back to USDC',
        description:
          'Unwrap your SR back to USDC anytime at the latest exchange rate with zero lockup, spread, or penalty.',
      },
    ],
    proTip:
      '1 SR ≠ 1 USDC: 1 SR is a share whose redemption rate continuously grows as interest compounds on Blend.',
    highlights: [
      { label: 'Term Length', value: 'Perpetual (No Expiry)' },
      { label: 'Rate Growth', value: 'Monotonically Rising' },
      { label: 'Liquidity', value: 'Instant Wrap / Unwrap' },
    ],
    graphicType: 'srwrap',
  },
  {
    id: 'bridge',
    icon: ArrowRightLeft,
    shortLabel: 'Bridge & Solvency',
    title: 'Circle Bridge & Solvency Proof',
    subtitle: 'Transfer native USDC cross-chain and inspect mathematically provable 100%+ backing.',
    badge: 'Step 8 of 8 · Safety & Bridging',
    route: '/bridge',
    concept:
      'Bridge native USDC from Ethereum, Arbitrum, Base, or Solana via Circle CCTP. Every outstanding position on Spield is continuously verified by on-chain invariant proofs.',
    steps: [
      {
        number: 1,
        title: 'Bridge Native USDC',
        description:
          'Transfer native USDC across chains using Circle CCTP V2 — zero synthetic wrappers and zero pool slippage.',
      },
      {
        number: 2,
        title: 'Check Solvency Dashboard',
        description:
          'Visit the Solvency section to view real-time collateralization, Blend reserve metrics, and the invariant health check.',
      },
      {
        number: 3,
        title: 'Guaranteed Solvency',
        description:
          'The smart contracts assert "backing ≥ principal" on every state mutation, ensuring bank runs are mathematically impossible.',
      },
    ],
    proTip:
      'Anyone can query the public solvency() view function on Soroban to verify protocol reserves at any block.',
    highlights: [
      { label: 'Bridge Engine', value: 'Circle CCTP V2' },
      { label: 'Collateralization', value: '≥ 100% Invariant' },
      { label: 'Verification', value: 'Public View Function' },
    ],
    graphicType: 'bridge',
  },
];

