import {
  LayoutDashboard,
  Coins,
  Lock,
  ShieldCheck,
  History,
  TrendingUp,
  Droplets,
  ArrowRightLeft,
  type LucideIcon, Layers } from 'lucide-react';

/**
 * Sidebar groups. The nav is eight entries long, which is exactly the length
 * at which a flat list stops being a list and starts being a wall — so the
 * rail states what each run of items is FOR. Purely presentational: routing,
 * page titles and the active-section lookup all still work off the flat array.
 */
export type NavGroup = 'main' | 'earn' | 'trade' | 'proof';

export const NAV_GROUPS: Array<{ id: NavGroup; label: string }> = [
  { id: 'main', label: '' },
  { id: 'earn', label: 'Earn' },
  { id: 'trade', label: 'Trade' },
  { id: 'proof', label: 'Verify' },
];

export type NavItem = {
  icon: LucideIcon;
  /** Sidebar label. */
  label: string;
  /** Section id (drives which page renders). */
  id: string;
  /** Page heading shown at the top of the section. */
  title: string;
  /** Short page description under the heading. */
  subtitle: string;
  /** Which sidebar run this item belongs to. */
  group: NavGroup;
};

/**
 * Dashboard navigation = the dashboard's sections. Labels reflect the real
 * Spield product: deposit USDC, mint PT (a fixed-rate bond) + YT (variable
 * yield), claim yield, redeem at maturity, and watch the vault stay solvent.
 *
 * Each entry is a real page — selecting it swaps the main content. The first
 * entry is the default landing view.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    icon: LayoutDashboard,
    label: 'Overview',
    id: 'overview',
    title: 'Overview',
    subtitle: 'Your portfolio at a glance — balances, performance and solvency.',
    group: 'main',
  },
  {
    icon: Layers,
    label: 'Spield v2',
    id: 'v2',
    title: 'Spield v2 — PT / YT',
    subtitle:
      'The Pendle-shaped stack: wrap USDC into SR, then trade principal (PT) and yield (YT).',
    group: 'trade',
  },
  {
    icon: Lock,
    label: 'Fixed Vault',
    id: 'vault',
    title: 'Fixed-Rate Vault',
    subtitle: 'Deposit USDC and lock a guaranteed fixed return until maturity.',
    group: 'earn',
  },
  {
    icon: Coins,
    label: 'Deposit',
    id: 'deposit',
    title: 'Deposit',
    subtitle: 'Supply USDC to mint a fixed-rate bond (PT) and a yield token (YT).',
    group: 'earn',
  },
  {
    icon: TrendingUp,
    label: 'Markets',
    id: 'markets',
    title: 'Markets',
    subtitle: 'Trade PT on the time-decay AMM — buy for a fixed return, sell to exit, or long yield.',
    group: 'trade',
  },
  {
    icon: Droplets,
    label: 'Liquidity',
    id: 'liquidity',
    title: 'Liquidity',
    subtitle: 'Provide PT + USDC to the time-decay pool and earn the swap fee.',
    group: 'trade',
  },
  {
    icon: ArrowRightLeft,
    label: 'Bridge',
    id: 'bridge',
    title: 'Bridge Assets',
    subtitle: 'Cross-chain swap assets to and from Stellar via Allbridge Core.',
    group: 'trade',
  },
  {
    icon: ShieldCheck,
    label: 'Solvency',
    id: 'solvency',
    title: 'Solvency',
    subtitle: 'Live proof the vault is fully backed by its Blend position.',
    group: 'proof',
  },
  {
    icon: History,
    label: 'Activity',
    id: 'activity',
    title: 'Activity',
    subtitle: 'On-chain deposits, claims and redemptions from the wrapper contract.',
    group: 'proof',
  },
];

/** Look up a nav entry by id, falling back to the first (Overview). */
export const navById = (id: string): NavItem => NAV_ITEMS.find((n) => n.id === id) ?? NAV_ITEMS[0];
