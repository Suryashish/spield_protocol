export interface TourStep {
  id: string;
  route: string;
  targetSelector: string;
  stepNumber: string; // e.g. "01 / 08"
  sectionName: string;
  title: string;
  text: string;
  tag: string;
}

export const APP_TOUR_STEPS: TourStep[] = [
  {
    id: 'wallet',
    route: '/overview',
    targetSelector: '[data-tour="wallet-menu"]',
    stepNumber: '01 / 08',
    sectionName: 'Wallet',
    title: 'Connect Your Wallet',
    text: 'Connect Freighter or Lobstr to sign transactions and manage your deposits non-custodially on Stellar.',
    tag: 'Non-Custodial',
  },
  {
    id: 'overview-stats',
    route: '/overview',
    targetSelector: '[data-tour="overview-stats"]',
    stepNumber: '02 / 08',
    sectionName: 'Overview',
    title: 'Portfolio & Live Stats',
    text: 'Track your total deposits, accrued interest, and real-time protocol solvency in one glance.',
    tag: 'Live Chain Data',
  },
  {
    id: 'vault-panel',
    route: '/vault',
    targetSelector: '[data-tour="vault-panel"]',
    stepNumber: '03 / 08',
    sectionName: 'Fixed Vault',
    title: 'Fixed-Rate Vault',
    text: 'Deposit USDC to lock a guaranteed fixed APY. Redeem your receipt 1:1 for principal + coupon at maturity.',
    tag: 'Guaranteed Return',
  },
  {
    id: 'deposit-panel',
    route: '/deposit',
    targetSelector: '[data-tour="deposit-panel"]',
    stepNumber: '04 / 08',
    sectionName: 'Deposit',
    title: 'Split Into PT + YT',
    text: 'Split 1 USDC into 1 fixed bond (PT) and 1 floating yield claim (YT) with zero fees or slippage.',
    tag: '0% Slippage Mint',
  },
  {
    id: 'markets-panel',
    route: '/markets',
    targetSelector: '[data-tour="markets-panel"]',
    stepNumber: '05 / 08',
    sectionName: 'Markets',
    title: 'Trade Bonds at Discount',
    text: 'Buy PT below $1.00 to lock in fixed profit at maturity, or trade YT for leveraged yield speculation.',
    tag: 'Time-Decay AMM',
  },
  {
    id: 'yield-panel',
    route: '/v2',
    targetSelector: '[data-tour="yield-panel"]',
    stepNumber: '06 / 08',
    sectionName: 'Yield',
    title: 'Claim Accrued Interest',
    text: 'Harvest your accumulated earnings directly to USDC anytime without burning your tokens.',
    tag: '1-Click Harvest',
  },
  {
    id: 'liquidity-panel',
    route: '/liquidity',
    targetSelector: '[data-tour="liquidity-panel"]',
    stepNumber: '07 / 08',
    sectionName: 'Liquidity',
    title: 'Earn 80% of Swap Fees',
    text: 'Provide PT and USDC liquidity to collect trading fees, with zero impermanent loss at maturity.',
    tag: '80% Fee Share',
  },
  {
    id: 'solvency-panel',
    route: '/solvency',
    targetSelector: '[data-tour="solvency-panel"]',
    stepNumber: '08 / 08',
    sectionName: 'Solvency',
    title: '100% Backed by Blend',
    text: 'Soroban smart contracts mathematically enforce that collateral backing exceeds liabilities on every block.',
    tag: 'Invariant Verified',
  },
];
