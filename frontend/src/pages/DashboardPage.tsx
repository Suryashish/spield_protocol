import { useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import Sidebar from '@/components/dashboard/layout/Sidebar';
import Header from '@/components/dashboard/layout/Header';
import StatsGrid from '@/components/dashboard/sections/StatsGrid';
import PortfolioChart from '@/components/dashboard/sections/PortfolioChart';
import ActivityFeed from '@/components/dashboard/sections/ActivityFeed';
import DepositPanel from '@/components/dashboard/sections/DepositPanel';
import PositionsPanel from '@/components/dashboard/sections/PositionsPanel';
import SolvencyCard from '@/components/dashboard/sections/SolvencyCard';

import { useWallet } from '@/context/WalletContext';
import { useProtocol } from '@/context/ProtocolContext';
import { NETWORK } from '@/lib/config';

const NetworkBanner = () => {
  const { isConnected, onCorrectNetwork } = useWallet();
  if (!isConnected || onCorrectNetwork) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-500">
      <AlertTriangle size={16} className="shrink-0" />
      <span>
        Your wallet is on the wrong network. Switch Freighter to{' '}
        <span className="font-semibold">{NETWORK.name}</span> to interact with the Spield contracts.
      </span>
    </div>
  );
};

const DashboardPage = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [activeNav, setActiveNav] = useState('dashboard');
  const { refresh, refreshing, paused } = useProtocol();

  return (
    <div className="dark flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        collapsed={collapsed}
        onToggle={setCollapsed}
        activeNav={activeNav}
        onNavChange={setActiveNav}
      />

      <main className="flex min-w-0 grow flex-col">
        <Header />

        <div className="grow overflow-y-auto p-4 lg:p-6">
          <div className="mx-auto max-w-7xl space-y-6">
            {/* Page title */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-1">
                <h1 className="font-display text-2xl font-medium tracking-tight">
                  Fixed-Income Dashboard
                </h1>
                <p className="text-sm text-muted-foreground">
                  Deposit USDC, mint PT + YT, and earn real Blend-backed yield.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refresh()}
                disabled={refreshing}
                className="h-9 gap-2 self-start text-sm font-semibold sm:self-auto"
              >
                <RefreshCw size={15} className={cn(refreshing && 'animate-spin')} />
                Refresh
              </Button>
            </div>

            <NetworkBanner />

            {paused && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                <AlertTriangle size={16} className="shrink-0" />
                <span>The protocol is currently paused. Deposits and redemptions are disabled.</span>
              </div>
            )}

            <StatsGrid />

            {/* Main grid: left column (chart, positions, activity) + right rail (deposit, solvency) */}
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
              <div className="space-y-6 lg:col-span-8">
                <PortfolioChart />
                <PositionsPanel />
                <ActivityFeed />
              </div>
              <div className="space-y-6 lg:col-span-4">
                <DepositPanel />
                <SolvencyCard />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default DashboardPage;
