import { useState } from 'react';
import { Layers } from 'lucide-react';

import { Button } from '@/components/ui/button';

import Sidebar from '@/components/dashboard/layout/Sidebar';
import Header from '@/components/dashboard/layout/Header';
import StatsGrid from '@/components/dashboard/sections/StatsGrid';
import PerformanceChart from '@/components/dashboard/sections/PerformanceChart';
import RecentTransactions from '@/components/dashboard/sections/RecentTransactions';
import TradePanel from '@/components/dashboard/sections/TradePanel';

const DashboardPage = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [activeNav, setActiveNav] = useState('dashboard');

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
                <h1 className="font-display text-2xl font-medium tracking-tight">Portfolio Overview</h1>
                <p className="text-sm text-muted-foreground">
                  Track your protocol metrics and performance.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-2 self-start text-sm font-semibold sm:self-auto"
              >
                <Layers size={15} />
                Manage Positions
              </Button>
            </div>

            <StatsGrid />

            {/* Chart + Trade panel */}
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
              <div className="space-y-6 lg:col-span-8">
                <PerformanceChart />
                <RecentTransactions />
              </div>
              <div className="lg:col-span-4">
                <TradePanel />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default DashboardPage;
