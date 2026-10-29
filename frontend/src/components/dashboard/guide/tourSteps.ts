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

type StepContent = Omit<TourStep, 'stepNumber'>;

const SOURCE_AND_SERIES_STEPS: StepContent[] = [
  {
    id: 'yield-source',
    route: '/overview',
    targetSelector: '[data-tour="yield-source"]',
    sectionName: 'Yield source',
    title: 'Switch Blend / USTRY',
    text: 'Use Yield source in the header to switch from Blend to USTRY or back. Only sources available on this network are listed. Try switching now; the guide continues with the selected source.',
    tag: 'Try it',
  },
  {
    id: 'series-selector',
    route: '/overview',
    targetSelector: '[data-tour="series-maturity"]',
    sectionName: 'Series',
    title: 'Choose Your Series',
    text: 'Use Series / maturity beside the source to choose a series and its maturity date. Balances, positions and activity follow that series. Ended marks matured series. Switching views does not move funds.',
    tag: 'Try it',
  },
];

const BLEND_TOUR_STEPS: StepContent[] = [
  {
    id: 'wallet',
    route: '/overview',
    targetSelector: '[data-tour="wallet-menu"]',
    sectionName: 'Wallet',
    title: 'Connect Your Wallet',
    text: 'Connect Freighter or Lobstr to sign transactions and manage your deposits non-custodially on Stellar.',
    tag: 'Non-Custodial',
  },
  ...SOURCE_AND_SERIES_STEPS,
  {
    id: 'overview-stats',
    route: '/overview',
    targetSelector: '[data-tour="overview-stats"]',
    sectionName: 'Overview',
    title: 'Portfolio & Live Stats',
    text: 'Track your total deposits, accrued interest, and real-time protocol solvency in one glance.',
    tag: 'Live Chain Data',
  },
  {
    id: 'vault-panel',
    route: '/vault',
    targetSelector: '[data-tour="vault-panel"]',
    sectionName: 'Fixed Vault',
    title: 'Fixed-Rate Vault',
    text: 'Deposit USDC to lock a guaranteed fixed APY. Redeem your receipt 1:1 for principal + coupon at maturity.',
    tag: 'Guaranteed Return',
  },
  {
    id: 'deposit-panel',
    route: '/deposit',
    targetSelector: '[data-tour="deposit-panel"]',
    sectionName: 'Deposit',
    title: 'Split Into PT + YT',
    text: 'Split 1 USDC into 1 fixed bond (PT) and 1 floating yield claim (YT) with zero fees or slippage.',
    tag: '0% Slippage Mint',
  },
  {
    id: 'markets-panel',
    route: '/markets',
    targetSelector: '[data-tour="markets-panel"]',
    sectionName: 'Markets',
    title: 'Trade Bonds at Discount',
    text: 'Buy PT below $1.00 to lock in fixed profit at maturity, or trade YT for leveraged yield speculation.',
    tag: 'Time-Decay AMM',
  },
  {
    id: 'yield-panel',
    route: '/v2',
    targetSelector: '[data-tour="yield-panel"]',
    sectionName: 'Yield',
    title: 'Claim Accrued Interest',
    text: 'Harvest your accumulated earnings directly to USDC anytime without burning your tokens.',
    tag: '1-Click Harvest',
  },
  {
    id: 'liquidity-panel',
    route: '/liquidity',
    targetSelector: '[data-tour="liquidity-panel"]',
    sectionName: 'Liquidity',
    title: 'Earn 80% of Swap Fees',
    text: 'Provide PT and USDC liquidity to collect trading fees, with zero impermanent loss at maturity.',
    tag: '80% Fee Share',
  },
  {
    id: 'solvency-panel',
    route: '/solvency',
    targetSelector: '[data-tour="solvency-panel"]',
    sectionName: 'Solvency',
    title: '100% Backed by Blend',
    text: 'Soroban smart contracts mathematically enforce that collateral backing exceeds liabilities on every block.',
    tag: 'Invariant Verified',
  },
];
import type { YieldSource } from '@/lib/series';


const USTRY_TOUR_STEPS: StepContent[] = [
  BLEND_TOUR_STEPS[0],
  ...SOURCE_AND_SERIES_STEPS,
  {
    id: 'overview-stats',
    route: '/overview',
    targetSelector: '[data-tour="overview-stats"]',
    sectionName: 'Overview',
    title: 'Your USTRY Portfolio',
    text: 'View your wallet balances, principal, yield and USTRY backing for the selected series. USTRY token amounts and USD face values are different.',
    tag: 'Selected Series',
  },
  {
    id: 'deposit-panel',
    route: '/deposit',
    targetSelector: '[data-tour="deposit-panel"]',
    sectionName: 'Deposit',
    title: 'Split or Combine',
    text: 'Deposit supported USDC through USTRY to receive PT and YT. Before maturity, combine matching PT and YT to exit; after settlement, redeem PT alone. Review the quote and minimum output before signing.',
    tag: 'PT + YT',
  },
  {
    id: 'markets-panel',
    route: '/markets',
    targetSelector: '[data-tour="markets-panel"]',
    sectionName: 'Markets',
    title: 'Convert USDC / USTRY',
    text: 'Get an executable quote to convert between USDC and USTRY. Check the issuer, expected output and minimum received. This converts the underlying asset; it does not trade PT or YT.',
    tag: 'Conversion',
  },
  {
    id: 'yield-panel',
    route: '/v2',
    targetSelector: '[data-tour="yield-panel"]',
    sectionName: 'Yield',
    title: 'Claim USTRY Yield',
    text: 'See what your YT has earned when NAV rises above its previous high. Claim available yield in USTRY while keeping your position.',
    tag: 'USTRY Payout',
  },
  {
    id: 'srwrap-panel',
    route: '/srwrap',
    targetSelector: '[data-tour="srwrap-panel"]',
    sectionName: 'SR Wrapper',
    title: 'Hold USTRY Receipts',
    text: 'Wrap supported USDC into sUSTRY receipts without splitting into PT and YT, or unwrap receipts back to USDC. Review the conversion quote before confirming.',
    tag: 'sUSTRY',
  },
  {
    id: 'solvency-panel',
    route: '/solvency',
    targetSelector: '[data-tour="solvency-panel"]',
    sectionName: 'Solvency',
    title: 'Check USTRY Backing',
    text: 'Inspect USTRY custody, obligations, NAV freshness and settlement status for this series. USTRY NAV can fall; PT does not guarantee dollar principal.',
    tag: 'Backing',
  },
];

const numberSteps = (steps: StepContent[]): TourStep[] => steps.map((step, index) => ({
  ...step,
  stepNumber: `${String(index + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}`,
}));

export const APP_TOUR_STEPS = numberSteps(BLEND_TOUR_STEPS);
const USTRY_STEPS = numberSteps(USTRY_TOUR_STEPS);

export const getTourSteps = (source: YieldSource): TourStep[] =>
  source === 'ustry' ? USTRY_STEPS : APP_TOUR_STEPS;
