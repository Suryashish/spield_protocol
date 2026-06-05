import {
  LayoutDashboard,
  Coins,
  Layers,
  ShieldCheck,
  History,
  Bell,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = { icon: LucideIcon; label: string; id: string };

/**
 * Dashboard navigation. Labels reflect the real Spield product: a fixed-income
 * protocol where you deposit USDC, mint PT (a fixed-rate bond) + YT (variable
 * yield), claim yield, and redeem at maturity.
 */
export const NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, label: 'Overview', id: 'dashboard' },
  { icon: Coins, label: 'Deposit', id: 'deposit' },
  { icon: Layers, label: 'Positions', id: 'positions' },
  { icon: ShieldCheck, label: 'Solvency', id: 'solvency' },
  { icon: History, label: 'Activity', id: 'history' },
];

export const FOOTER_NAV_ITEMS: NavItem[] = [
  { icon: Bell, label: 'Notifications', id: 'notifications' },
  { icon: Settings, label: 'Settings', id: 'settings' },
];
