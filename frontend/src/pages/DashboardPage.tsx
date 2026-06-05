import { useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldCheck, Coins, TrendingUp, Lock } from 'lucide-react';

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
import { navById } from '@/components/dashboard/data';

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

const PausedBanner = () => {
  const { paused } = useProtocol();
  if (!paused) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
      <AlertTriangle size={16} className="shrink-0" />
      <span>The protocol is currently paused. Deposits and redemptions are disabled.</span>
    </div>
  );
};

/* ------------------------------------------------------------------ sections */

const OverviewSection = () => (
  <>
    <StatsGrid />
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
      <div className="lg:col-span-8">
        <PortfolioChart />
      </div>
      <div className="lg:col-span-4">
        <SolvencyCard />
      </div>
    </div>
    <ActivityFeed />
  </>
);

const DepositSection = () => (
  <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
    <div className="order-2 lg:order-1">
      <HowItWorks />
    </div>
    <div className="order-1 lg:order-2">
      <DepositPanel />
    </div>
  </div>
);

const PositionsSection = () => (
  <>
    <StatsGrid />
    <PositionsPanel />
  </>
);

const SolvencySection = () => (
  <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
    <SolvencyCard />
    <WhySolvency />
  </div>
);

const ActivitySection = () => <ActivityFeed />;

const SECTIONS: Record<string, () => React.ReactNode> = {
  overview: OverviewSection,
  deposit: DepositSection,
  positions: PositionsSection,
  solvency: SolvencySection,
  activity: ActivitySection,
};

/* -------------------------------------------------------- explainer cards */

const HowItWorks = () => {
  const steps = [
    { icon: Coins, title: '1 · Deposit USDC', body: 'Supply USDC; it is lent into the Blend pool where it earns real, on-chain interest.' },
    { icon: Lock, title: '2 · Get PT + YT', body: 'You receive equal PT (your principal, redeemable 1:1 at maturity) and YT (the yield claim).' },
    { icon: TrendingUp, title: '3 · Earn & claim', body: "As Blend's bRate rises, claim accrued yield against your YT — anytime, without burning it." },
    { icon: ShieldCheck, title: '4 · Redeem', body: 'Redeem PT 1:1 at maturity, or combine PT + YT to exit early. The vault stays fully backed.' },
  ];
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <h3 className="text-base font-semibold">How a deposit works</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Spield splits a yield-bearing deposit into a fixed-rate bond and a yield token.
      </p>
      <div className="mt-4 space-y-3">
        {steps.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.title} className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/60 text-foreground">
                <Icon size={15} />
              </div>
              <div>
                <p className="text-sm font-semibold">{s.title}</p>
                <p className="text-xs text-muted-foreground">{s.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const WhySolvency = () => (
  <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
    <h3 className="flex items-center gap-2 text-base font-semibold">
      <ShieldCheck size={17} className="text-emerald-500" />
      Solvent by construction
    </h3>
    <div className="mt-3 space-y-3 text-sm text-muted-foreground">
      <p>
        Every deposit is supplied to <span className="font-medium text-foreground">Blend</span>,
        Stellar&apos;s lending protocol. The escrowed asset grows on-chain via Blend&apos;s rising{' '}
        <span className="font-medium text-foreground">bRate</span> — so yield is real, not an
        IOU.
      </p>
      <p>
        The wrapper asserts the invariant{' '}
        <span className="font-mono text-xs text-foreground">backing ≥ principal</span> after every
        mutation. The number on the left is read live from the contract&apos;s{' '}
        <span className="font-mono text-xs text-foreground">solvency()</span> view — anyone can
        verify it.
      </p>
      <p>
        This is the core difference from the earlier design: there is no off-chain yield index and
        no trusted relayer. The first claimant can never drain the vault.
      </p>
    </div>
  </div>
);

/* ----------------------------------------------------------------- page */

const DashboardPage = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [activeNav, setActiveNav] = useState('overview');
  const { refresh, refreshing } = useProtocol();

  const nav = navById(activeNav);
  const Section = SECTIONS[nav.id] ?? OverviewSection;

  return (
    <div className="dark flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        collapsed={collapsed}
        onToggle={setCollapsed}
        activeNav={activeNav}
        onNavChange={setActiveNav}
      />

      <main className="flex min-w-0 grow flex-col">
        <Header section={nav.label} />

        <div className="grow overflow-y-auto p-4 lg:p-6">
          <div className="mx-auto max-w-7xl space-y-6">
            {/* Page title */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-1">
                <h1 className="font-display text-2xl font-medium tracking-tight">{nav.title}</h1>
                <p className="text-sm text-muted-foreground">{nav.subtitle}</p>
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
            <PausedBanner />

            <Section />
          </div>
        </div>
      </main>
    </div>
  );
};

export default DashboardPage;
