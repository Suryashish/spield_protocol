export interface TourStep {
  id: string;
  route: string;
  targetSelector: string;
  stepNumber: string; // e.g. "01 / 08"
  sectionName: string;
  title: string;
  summary: string;
  actions: string[];
  highlight: string;
}

export const APP_TOUR_STEPS: TourStep[] = [
  {
    id: 'wallet',
    route: '/overview',
    targetSelector: '[data-tour="wallet-menu"]',
    stepNumber: '01 / 08',
    sectionName: 'Wallet',
    title: 'Connect Your Wallet',
    summary: 'Connect your Freighter or Lobstr wallet to interact with Spield smart contracts on Stellar.',
    actions: [
      'Click to connect your Stellar wallet',
      'Sign transactions securely with one click',
    ],
    highlight: 'Non-custodial · You always control your keys and funds',
  },
  {
    id: 'overview-stats',
    route: '/overview',
    targetSelector: '[data-tour="overview-stats"]',
    stepNumber: '02 / 08',
    sectionName: 'Overview',
    title: 'Your Portfolio at a Glance',
    summary: 'See your active deposits, locked coupons, accrued interest, and live protocol solvency in real time.',
    actions: [
      'Monitor live returns across all positions',
      'Track maturity countdowns and fresh on-chain data',
    ],
    highlight: 'Real-time chain reads · Backing verified every block',
  },
  {
    id: 'vault-panel',
    route: '/vault',
    targetSelector: '[data-tour="vault-panel"]',
    stepNumber: '03 / 08',
    sectionName: 'Fixed Vault',
    title: 'Guaranteed Fixed Savings',
    summary: 'The simplest way to earn: deposit USDC and lock in a guaranteed fixed return until maturity.',
    actions: [
      'Enter USDC to see your locked payout & fixed APY',
      'Deposit & sign in your wallet to receive your receipt',
    ],
    highlight: 'No trustlines needed · Redeem 1:1 at maturity',
  },
  {
    id: 'deposit-panel',
    route: '/deposit',
    targetSelector: '[data-tour="deposit-panel"]',
    stepNumber: '04 / 08',
    sectionName: 'Deposit',
    title: 'Split Into Bond + Yield Tokens',
    summary: 'Turn 1 USDC into 1 fixed bond (PT) and 1 floating yield claim (YT) with zero fees or slippage.',
    actions: [
      'Mint PT (pays $1 at maturity) + YT (earns variable yield)',
      'Trade them separately or recombine back to USDC anytime',
    ],
    highlight: '0% Slippage · Par value minting',
  },
  {
    id: 'markets-panel',
    route: '/markets',
    targetSelector: '[data-tour="markets-panel"]',
    stepNumber: '05 / 08',
    sectionName: 'Markets',
    title: 'Trade Bonds at a Discount',
    summary: 'Buy PT below $1.00 (e.g. at $0.94) and redeem for $1.00 at maturity. The discount is your profit.',
    actions: [
      'Buy PT at discount to lock higher fixed APY',
      'Or Long YT to capture leveraged floating yield',
    ],
    highlight: 'Time-decay AMM · Price converges to $1.00 at maturity',
  },
  {
    id: 'yield-panel',
    route: '/v2',
    targetSelector: '[data-tour="yield-panel"]',
    stepNumber: '06 / 08',
    sectionName: 'Yield',
    title: 'Harvest Accrued Interest',
    summary: 'Your YT tokens continuously accumulate interest. Harvest your earnings directly into USDC whenever you like.',
    actions: [
      'Inspect your live accrued yield balance',
      'Click Claim Yield to withdraw USDC to your wallet',
    ],
    highlight: 'Non-destructive · Tokens keep earning until maturity',
  },
  {
    id: 'liquidity-panel',
    route: '/liquidity',
    targetSelector: '[data-tour="liquidity-panel"]',
    stepNumber: '07 / 08',
    sectionName: 'Liquidity',
    title: 'Earn 80% of Trading Fees',
    summary: 'Supply PT and USDC to the pool to collect trading fees, with built-in protection against impermanent loss.',
    actions: [
      'Deposit assets to receive pool LP shares',
      '80% of all swap fees compound directly into your balance',
    ],
    highlight: 'Low impermanent loss · Predictable march to par',
  },
  {
    id: 'solvency-panel',
    route: '/solvency',
    targetSelector: '[data-tour="solvency-panel"]',
    stepNumber: '08 / 08',
    sectionName: 'Solvency',
    title: '100% Verifiable On-Chain Backing',
    summary: 'Cryptographic proof that all deposits are fully backed by Blend pool collateral on Stellar.',
    actions: [
      'View real-time reserve ratios and health metrics',
      'Contracts enforce backing ≥ 100% on every single block',
    ],
    highlight: 'Mathematical proof · Bank runs are impossible',
  },
];
