import { useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldCheck, Coins, TrendingUp, Lock, Droplets, ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import Sidebar from '@/components/dashboard/layout/Sidebar';
import Header from '@/components/dashboard/layout/Header';
import StatsGrid from '@/components/dashboard/sections/StatsGrid';
import PortfolioChart from '@/components/dashboard/sections/PortfolioChart';
import YieldChart from '@/components/dashboard/sections/YieldChart';
import ActivityFeed from '@/components/dashboard/sections/ActivityFeed';
import DepositPanel from '@/components/dashboard/sections/DepositPanel';
import VaultPanel from '@/components/dashboard/sections/VaultPanel';
import ReceiptsPanel from '@/components/dashboard/sections/ReceiptsPanel';
import PositionsPanel from '@/components/dashboard/sections/PositionsPanel';
import SolvencyCard from '@/components/dashboard/sections/SolvencyCard';
import MarketChart from '@/components/dashboard/sections/MarketChart';
import TradePanel from '@/components/dashboard/sections/TradePanel';
import LpPanel from '@/components/dashboard/sections/LpPanel';
import { navById } from '@/components/dashboard/data';

import { useWallet } from '@/context/WalletContext';
import { useProtocol } from '@/context/ProtocolContext';
import { NavProvider } from '@/context/NavContext';
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
    <YieldChart />
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

const VaultSection = () => (
  <div className="space-y-6">
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
      <div className="order-2 lg:order-1">
        <HowVaultWorks />
      </div>
      <div className="order-1 lg:order-2">
        <VaultPanel />
      </div>
    </div>
    <ReceiptsPanel />
  </div>
);

const MarketsSection = () => (
  <div className="space-y-6">
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
      <div className="lg:col-span-8">
        <MarketChart />
      </div>
      <div className="lg:col-span-4">
        <TradePanel />
      </div>
    </div>
    <HowMarketWorks />
  </div>
);

const LiquiditySection = () => (
  <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
    <div className="order-2 lg:order-1">
      <HowLiquidityWorks />
    </div>
    <div className="order-1 lg:order-2">
      <LpPanel />
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
  vault: VaultSection,
  deposit: DepositSection,
  markets: MarketsSection,
  liquidity: LiquiditySection,
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

const HowVaultWorks = () => {
  const steps = [
    { icon: Coins, title: '1 · Deposit USDC', body: 'Supply USDC to the Fixed-Rate Vault — no need to understand PT or YT.' },
    { icon: Lock, title: '2 · Lock the rate', body: 'You get a receipt for a guaranteed payout (principal + a fixed coupon) at maturity.' },
    { icon: ShieldCheck, title: '3 · Backed by PT', body: 'The vault holds PT 1:1 against every payout, so your fixed return is solvent by construction.' },
    { icon: TrendingUp, title: '4 · Redeem at maturity', body: 'Redeem the receipt for your exact locked payout. The coupon is funded by the vault’s real Blend yield.' },
  ];
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <h3 className="text-base font-semibold">How the Fixed-Rate Vault works</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        The simplest way to use Spield: deposit USDC, earn a fixed, known return — the PT/YT
        machinery is hidden underneath.
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

const HowMarketWorks = () => {
  const [open, setOpen] = useState(false);
  const steps = [
    { icon: TrendingUp, title: 'Time-decay curve', body: 'PT trades below par and drifts to 1.0 as maturity nears — the discount is the yield. The curve makes that march automatic.' },
    { icon: Coins, title: 'Earn Fixed', body: 'Buy PT now with USDC and hold to maturity to lock the implied APY. The cheaper you buy, the higher your fixed return.' },
    { icon: Lock, title: 'Sell anytime', body: 'Need to exit early? Sell PT back to USDC at the live market price — no waiting for maturity.' },
    { icon: TrendingUp, title: 'Long Yield', body: 'Bet that real Blend yield beats the implied rate: mint PT + YT, sell the PT back, and keep the YT for a small net cost.' },
  ];
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 p-5 text-left"
      >
        <div>
          <h3 className="text-base font-semibold">How the Market works</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            A real yield AMM: PT prices are market-discovered and an implied APY falls out of the curve.
          </p>
        </div>
        <ChevronDown
          size={18}
          className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
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
      )}
    </div>
  );
};

const HowLiquidityWorks = () => {
  const steps = [
    { icon: Droplets, title: '1 · Supply PT + USDC', body: 'Add liquidity in the pool’s current ratio. The panel auto-matches the USDC side for you.' },
    { icon: Coins, title: '2 · Earn the swap fee', body: 'Every trade pays a 0.30% fee that accrues to the pool — your LP shares grow in value as volume flows.' },
    { icon: ShieldCheck, title: '3 · Low impermanent loss', body: 'Because the time-decay curve tracks PT’s march to par, an LP who holds to maturity sees ~no IL on the predictable price move.' },
    { icon: Lock, title: '4 · Withdraw anytime', body: 'Burn your LP shares to take back a proportional slice of PT + USDC — including any fees earned — whenever you like.' },
  ];
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <h3 className="text-base font-semibold">How liquidity works</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Provide the two sides of the pool, earn fees on every PT trade, and exit on your terms.
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

  const navValue = useMemo(
    () => ({ active: activeNav, navigate: setActiveNav }),
    [activeNav],
  );

  return (
    <NavProvider value={navValue}>
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
    </NavProvider>
  );
};

export default DashboardPage;
