import {
  LayoutDashboard,
  BarChart3,
  Wallet2,
  Plane,
  ShieldCheck,
  History,
  Bell,
  Settings,
  TrendingUp,
  Layers,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = { icon: LucideIcon; label: string; id: string };

export const NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard', id: 'dashboard' },
  { icon: BarChart3, label: 'Analytics', id: 'analytics' },
  { icon: Wallet2, label: 'Wallet', id: 'wallet' },
  { icon: Plane, label: 'Bridge', id: 'bridge' },
  { icon: ShieldCheck, label: 'Vaults', id: 'vaults' },
  { icon: History, label: 'History', id: 'history' },
];

export const FOOTER_NAV_ITEMS: NavItem[] = [
  { icon: Bell, label: 'Notifications', id: 'notifications' },
  { icon: Settings, label: 'Settings', id: 'settings' },
];

export type Stat = {
  label: string;
  value: string;
  change?: string;
  isPositive?: boolean;
  icon: LucideIcon;
};

export const STATS: Stat[] = [
  { label: 'Total Balance', value: '$124,502', change: '+2.4%', icon: Wallet2 },
  { label: 'Total Yield', value: '$12,482', change: '+14.2%', icon: TrendingUp },
  { label: 'Active Positions', value: '12', icon: Layers },
  { label: 'APR', value: '18.6%', change: '-0.8%', isPositive: false, icon: BarChart3 },
];

export const chartData = [
  { day: '01', tvl: 45000 },
  { day: '03', tvl: 52000 },
  { day: '05', tvl: 48000 },
  { day: '07', tvl: 61000 },
  { day: '09', tvl: 55000 },
  { day: '11', tvl: 67000 },
  { day: '13', tvl: 72000 },
  { day: '15', tvl: 68000 },
  { day: '17', tvl: 85000 },
  { day: '19', tvl: 78000 },
  { day: '21', tvl: 92000 },
  { day: '23', tvl: 88000 },
  { day: '25', tvl: 96000 },
  { day: '27', tvl: 104000 },
  { day: '29', tvl: 112000 },
  { day: '31', tvl: 124502 },
];

export const chartConfig = {
  tvl: {
    label: 'TVL',
    color: 'var(--primary)',
  },
};

export type Transaction = {
  id: string;
  type: string;
  amount: string;
  positive: boolean;
  status: 'Confirmed' | 'Pending';
  time: string;
};

export const transactions: Transaction[] = [
  { id: '0x81...9f21', type: 'Stake SPIELD', amount: '+42,000 SPIELD', positive: true, status: 'Confirmed', time: '2m ago' },
  { id: '0xa4...1d42', type: 'Swap ASSET', amount: '-1,240 USDT', positive: false, status: 'Confirmed', time: '1h ago' },
  { id: '0xc9...7b03', type: 'Claim Yield', amount: '+312 SPIELD', positive: true, status: 'Confirmed', time: '4h ago' },
  { id: '0xe2...0a55', type: 'Bridge In', amount: '+5.0 ETH', positive: true, status: 'Pending', time: '6h ago' },
];
