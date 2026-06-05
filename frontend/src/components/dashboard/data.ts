import {
  LayoutDashboard,
  Coins,
  Layers,
  ShieldCheck,
  History,
  type LucideIcon,
} from 'lucide-react';

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
  },
  {
    icon: Coins,
    label: 'Deposit',
    id: 'deposit',
    title: 'Deposit',
    subtitle: 'Supply USDC to mint a fixed-rate bond (PT) and a yield token (YT).',
  },
  {
    icon: Layers,
    label: 'Positions',
    id: 'positions',
    title: 'Positions',
    subtitle: 'Manage your tranches — claim yield, redeem principal, or exit early.',
  },
  {
    icon: ShieldCheck,
    label: 'Solvency',
    id: 'solvency',
    title: 'Solvency',
    subtitle: 'Live proof the vault is fully backed by its Blend position.',
  },
  {
    icon: History,
    label: 'Activity',
    id: 'activity',
    title: 'Activity',
    subtitle: 'On-chain deposits, claims and redemptions from the wrapper contract.',
  },
];

/** Look up a nav entry by id, falling back to the first (Overview). */
export const navById = (id: string): NavItem => NAV_ITEMS.find((n) => n.id === id) ?? NAV_ITEMS[0];
