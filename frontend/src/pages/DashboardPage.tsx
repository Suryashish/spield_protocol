import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { useSEO } from '@/hooks/useSEO';
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
import DepositStatsStrip from '@/components/dashboard/sections/DepositStatsStrip';
import VaultPanel from '@/components/dashboard/sections/VaultPanel';
import VaultStatsStrip from '@/components/dashboard/sections/VaultStatsStrip';
import ReceiptsPanel from '@/components/dashboard/sections/ReceiptsPanel';
import PositionsPanel from '@/components/dashboard/sections/PositionsPanel';
import SolvencyCard from '@/components/dashboard/sections/SolvencyCard';
import MarketChart from '@/components/dashboard/sections/MarketChart';
import TradePanel from '@/components/dashboard/sections/TradePanel';
import LpPanel from '@/components/dashboard/sections/LpPanel';
import LpStatsStrip from '@/components/dashboard/sections/LpStatsStrip';
import LpPositionPanel from '@/components/dashboard/sections/LpPositionPanel';
import BridgeSection from '@/components/dashboard/sections/BridgeSection';
import { navById, NAV_ITEMS } from '@/components/dashboard/data';

import { useWallet } from '@/context/WalletContext';
import { useProtocol } from '@/context/ProtocolContext';
import { NavProvider } from '@/context/NavContext';
import { NETWORK } from '@/lib/config';
import { APP_ORIGIN } from '@/lib/site';

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

// Surface a failed chain read instead of silently showing zeros — for a funds app, a blank
// dashboard reads as "my money is gone" when the real cause is an RPC hiccup. We keep showing
// whatever data we have and offer a one-click retry.
const ErrorBanner = () => {
  const { error, refresh, refreshing } = useProtocol();
  if (!error) return null;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500 sm:flex-row sm:items-center sm:justify-between">
      <span className="flex items-center gap-2">
        <AlertTriangle size={16} className="shrink-0" />
        Couldn&apos;t reach the network — showing the last data we have. {error}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => refresh()}
        disabled={refreshing}
        className="h-8 shrink-0 gap-2 self-start border-red-500/40 text-xs font-semibold text-red-500 hover:bg-red-500/10 sm:self-auto"
      >
        <RefreshCw size={13} className={cn(refreshing && 'animate-spin')} />
        Retry
      </Button>
    </div>
  );
};

/** Human "Ns/m/h ago" for a unix-ms timestamp relative to `now` (also unix ms). */
const fmtAgo = (ts: number, now: number): string => {
  const secs = Math.max(0, Math.floor((now - ts) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
};

/**
 * "Updated Ns ago" freshness pill next to Refresh. Self-ticks every second so the relative
 * time stays honest, and turns amber while data is stale (last read failed) so users can
 * trust at a glance whether the numbers on screen are current.
 */
const LastUpdated = () => {
  const { lastUpdated, stale } = useProtocol();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);
  if (!lastUpdated) return null;
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 text-xs font-medium',
        stale ? 'text-amber-500' : 'text-muted-foreground',
      )}
      title={stale ? 'The latest refresh failed — showing the last good data.' : undefined}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          stale ? 'bg-amber-500' : 'bg-emerald-500',
        )}
      />
      {stale ? 'Stale · ' : 'Updated '}
      {fmtAgo(lastUpdated, now)}
    </span>
  );
};

/* ------------------------------------------------------------------ sections */

const OverviewSection = () => (
  <div className="space-y-6">
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
  </div>
);

const DepositSection = () => (
  <div className="space-y-6">
    <DepositStatsStrip />
    <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
      <div className="lg:col-span-5">
        <DepositPanel />
      </div>
      <div className="lg:col-span-7">
        <PositionsPanel />
      </div>
    </div>
    <HowItWorks />
  </div>
);

const VaultSection = () => (
  <div className="space-y-6">
    <VaultStatsStrip />
    <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
      <div className="lg:col-span-5">
        <VaultPanel />
      </div>
      <div className="lg:col-span-7">
        <ReceiptsPanel />
      </div>
    </div>
    <HowVaultWorks />
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
  <div className="space-y-6">
    <LpStatsStrip />
    <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
      <div className="lg:col-span-5">
        <LpPanel />
      </div>
      <div className="lg:col-span-7">
        <LpPositionPanel />
      </div>
    </div>
    <HowLiquidityWorks />
  </div>
);

const SolvencySection = () => (
  <div className="space-y-6">
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
  bridge: BridgeSection,
  solvency: SolvencySection,
  activity: ActivitySection,
};

/* -------------------------------------------------------- explainer cards */

const HowItWorks = () => {
  const [open, setOpen] = useState(false);
  const steps = [
    { icon: Coins, title: '1 · Deposit USDC', body: 'Supply USDC; it is lent into the Blend pool where it earns real, on-chain interest.' },
    { icon: Lock, title: '2 · Get PT + YT', body: 'You receive equal PT (your principal, redeemable 1:1 at maturity) and YT (the yield claim).' },
    { icon: TrendingUp, title: '3 · Earn & claim', body: "As Blend's bRate rises, claim accrued yield against your YT — anytime, without burning it." },
    { icon: ShieldCheck, title: '4 · Redeem', body: 'Redeem PT 1:1 at maturity, or combine PT + YT to exit early. The vault stays fully backed.' },
  ];
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 p-5 text-left"
      >
        <div>
          <h3 className="text-base font-semibold">How a deposit works</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Spield splits a yield-bearing deposit into a fixed-rate bond and a yield token.
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

const HowVaultWorks = () => {
  const [open, setOpen] = useState(false);
  const steps = [
    { icon: Coins, title: '1 · Deposit USDC', body: 'Supply USDC to the Fixed-Rate Vault — no need to understand PT or YT.' },
    { icon: Lock, title: '2 · Lock the rate', body: 'You get a receipt for a guaranteed payout (principal + a fixed coupon) at maturity.' },
    { icon: ShieldCheck, title: '3 · Backed by PT', body: 'The vault holds PT 1:1 against every payout, so your fixed return is solvent by construction.' },
    { icon: TrendingUp, title: '4 · Redeem at maturity', body: 'Redeem the receipt for your exact locked payout. The coupon is funded by the vault’s real Blend yield.' },
  ];
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 p-5 text-left"
      >
        <div>
          <h3 className="text-base font-semibold">How the Fixed-Rate Vault works</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            The simplest way to use Spield: deposit USDC, earn a fixed, known return — the PT/YT
            machinery is hidden underneath.
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
  const [open, setOpen] = useState(false);
  const steps = [
    { icon: Droplets, title: '1 · Supply PT + USDC', body: 'Add liquidity in the pool’s current ratio. The panel auto-matches the USDC side for you.' },
    { icon: Coins, title: '2 · Earn the swap fee', body: 'Every trade pays a 0.30% fee that accrues to the pool — your LP shares grow in value as volume flows.' },
    { icon: ShieldCheck, title: '3 · Low impermanent loss', body: 'Because the time-decay curve tracks PT’s march to par, an LP who holds to maturity sees ~no IL on the predictable price move.' },
    { icon: Lock, title: '4 · Withdraw anytime', body: 'Burn your LP shares to take back a proportional slice of PT + USDC — including any fees earned — whenever you like.' },
  ];
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 p-5 text-left"
      >
        <div>
          <h3 className="text-base font-semibold">How liquidity works</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Provide the two sides of the pool, earn fees on every PT trade, and exit on your terms.
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

const WhySolvency = () => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 p-5 text-left"
      >
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <ShieldCheck size={17} className="text-emerald-500" />
            Solvent by construction
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Why backing can never fall below principal — and how anyone can verify it.
          </p>
        </div>
        <ChevronDown
          size={18}
          className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="space-y-3 px-5 pb-5 text-sm text-muted-foreground">
          <p>
            Every deposit is supplied to <span className="font-medium text-foreground">Blend</span>,
            Stellar&apos;s lending protocol. The escrowed asset grows on-chain via Blend&apos;s rising{' '}
            <span className="font-medium text-foreground">bRate</span> — so yield is real, not an
            IOU.
          </p>
          <p>
            The wrapper asserts the invariant{' '}
            <span className="font-mono text-xs text-foreground">backing ≥ principal</span> after every
            mutation. The figures above are read live from the contract&apos;s{' '}
            <span className="font-mono text-xs text-foreground">solvency()</span> view — anyone can
            verify them.
          </p>
          <p>
            This is the core difference from the earlier design: there is no off-chain yield index and
            no trusted relayer. The first claimant can never drain the vault.
          </p>
        </div>
      )}
    </div>
  );
};

/* ----------------------------------------------------------------- page */

const DashboardPage = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const { refresh, refreshing, stale } = useProtocol();

  // Derive the active section from the URL path segment (e.g. /vault -> vault)
  const activeNav = useMemo(() => {
    const parts = location.pathname.split('/');
    const segment = parts[parts.length - 1];
    return NAV_ITEMS.some((n) => n.id === segment) ? segment : 'overview';
  }, [location.pathname]);

  // Backward compatibility: redirect any legacy ?section=vault URLs to /vault
  useEffect(() => {
    const sectionParam = searchParams.get('section');
    if (sectionParam && NAV_ITEMS.some((n) => n.id === sectionParam)) {
      navigate(`/${sectionParam}`, { replace: true });
    }
  }, [searchParams, navigate]);

  const nav = navById(activeNav);

  // The app subdomain is deliberately kept out of search — the indexable pages
  // are the marketing site and content hub at spield.live. Titles and share
  // cards still matter for tabs and for links pasted into chats, so they stay.
  useSEO({
    title: `${nav.label} | Spield App`,
    description: nav.subtitle,
    canonical: `${APP_ORIGIN}/${nav.id}`,
    noindex: true,
  });

  const Section = SECTIONS[nav.id] ?? OverviewSection;

  // Provide compatibility for nested dashboard components using useNav()
  const navValue = useMemo(
    () => ({
      active: activeNav,
      navigate: (id: string) => navigate(`/${id}`),
    }),
    [activeNav, navigate],
  );

  return (
    <NavProvider value={navValue}>
      <div className="app-shell dark flex h-screen overflow-hidden bg-background text-foreground">
        <Sidebar
          collapsed={collapsed}
          onToggle={setCollapsed}
          activeNav={activeNav}
          onNavChange={navValue.navigate}
        />

        <main className="flex min-w-0 grow flex-col">
          <Header section={nav.label} />

          <div className="grow overflow-y-auto p-4 lg:p-6">
            <div className="mx-auto max-w-7xl space-y-5 lg:space-y-6">
              {/* Page title */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1">
                  <h1 className="font-display text-xl font-medium tracking-tight sm:text-2xl">{nav.title}</h1>
                  <p className="text-sm text-muted-foreground">{nav.subtitle}</p>
                </div>
                <div className="flex items-center gap-3 self-start sm:self-auto">
                  <LastUpdated />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refresh()}
                    disabled={refreshing}
                    className="h-9 gap-2 text-sm font-semibold"
                  >
                    <RefreshCw size={15} className={cn(refreshing && 'animate-spin')} />
                    Refresh
                  </Button>
                </div>
              </div>

              <NetworkBanner />
              <PausedBanner />
              <ErrorBanner />

              {/* Dim the live data while it's stale so the numbers visibly read as "not current"
                  until a refresh succeeds — the dot/pill says why, the dim says "don't trust me". */}
              <div className={cn('transition-opacity', stale && 'opacity-60')}>
                <Section />
              </div>
            </div>
          </div>
        </main>
      </div>
    </NavProvider>
  );
};

export default DashboardPage;
