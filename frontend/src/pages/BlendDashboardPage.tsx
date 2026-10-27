import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { useSEO } from '@/hooks/useSEO';
import {
  AlertTriangle,
  RefreshCw,
  HelpCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import Sidebar from '@/components/dashboard/layout/Sidebar';
import BottomNav from '@/components/dashboard/layout/BottomNav';
import DemoBanner from '@/components/dashboard/layout/DemoBanner';
import Header from '@/components/dashboard/layout/Header';
import HowItWorksModal from '@/components/dashboard/layout/HowItWorksModal';
import InteractiveAppTour from '@/components/dashboard/guide/InteractiveAppTour';
import { useTutorial } from '@/context/TutorialContext';
import { APP_TOUR_STEPS } from '@/components/dashboard/guide/tourSteps';
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
import RiskDisclosure from '@/components/dashboard/sections/RiskDisclosure';
import MarketChart from '@/components/dashboard/sections/MarketChart';
import SrTradePanel from '@/components/dashboard/sections/SrTradePanel';
import SrWrapPanel from '@/components/dashboard/sections/SrWrapPanel';
import SrYieldPanel from '@/components/dashboard/sections/SrYieldPanel';
import SrPortfolioPanel from '@/components/dashboard/sections/SrPortfolioPanel';
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

/**
 * One banner shape for everything the page has to say before its content:
 * a tinted hairline strip with the tone's own icon well. `tone` picks the
 * hue — ember for "you need to do something", danger for "we couldn't".
 */
const Banner = ({
  tone,
  children,
  action,
}: {
  tone: 'ember' | 'danger';
  children: React.ReactNode;
  action?: React.ReactNode;
}) => (
  <div
    className={cn(
      'flex flex-col gap-2.5 rounded-xl border px-4 py-3 text-[13.5px] leading-relaxed sm:flex-row sm:items-center sm:justify-between',
      tone === 'ember'
        ? 'border-ember/25 bg-ember/8 text-ember-text'
        : 'border-danger/25 bg-danger/8 text-danger-text',
    )}
  >
    <span className="flex items-start gap-2.5 sm:items-center">
      <AlertTriangle size={15} className="mt-0.5 shrink-0 sm:mt-0" />
      <span>{children}</span>
    </span>
    {action}
  </div>
);

const NetworkBanner = () => {
  const { isConnected, onCorrectNetwork } = useWallet();
  if (!isConnected || onCorrectNetwork) return null;
  return (
    <Banner tone="ember">
      Your wallet is on the wrong network. Switch Freighter to{' '}
      <span className="font-semibold">{NETWORK.name}</span> to interact with the Spield contracts.
    </Banner>
  );
};

const PausedBanner = () => {
  const { paused } = useProtocol();
  if (!paused) return null;
  return (
    <Banner tone="danger">
      The protocol is currently paused. Deposits and redemptions are disabled.
    </Banner>
  );
};

// Surface a failed chain read instead of silently showing zeros — for a funds app, a blank
// dashboard reads as "my money is gone" when the real cause is an RPC hiccup. We keep showing
// whatever data we have and offer a one-click retry.
const ErrorBanner = () => {
  const { error, refresh, refreshing } = useProtocol();
  if (!error) return null;
  return (
    <Banner
      tone="danger"
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => refresh()}
          disabled={refreshing}
          className="h-8 shrink-0 gap-2 self-start border-danger/30 text-xs font-semibold text-danger-text hover:bg-danger/10 sm:self-auto"
        >
          <RefreshCw size={13} className={cn(refreshing && 'animate-spin')} />
          Retry
        </Button>
      }
    >
      Couldn&apos;t reach the network — showing the last data we have. {error}
    </Banner>
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
      className={cn('eyebrow flex items-center gap-2', stale ? 'text-ember-text' : 'text-muted-foreground')}
      title={stale ? 'The latest refresh failed — showing the last good data.' : undefined}
    >
      {/* Filled and pulsing means these figures are being read from chain
          right now — the same mark, and the same promise, as the site. */}
      {stale ? <span className="size-1.5 shrink-0 rounded-full bg-ember" /> : <span className="pulse-dot" />}
      {stale ? 'Stale · ' : 'Updated '}
      {fmtAgo(lastUpdated, now)}
    </span>
  );
};

/* ------------------------------------------------------------------ sections */

const OverviewSection = () => (
  <div className="space-y-6">
    <div data-tour="overview-stats">
      <StatsGrid />
    </div>
    <YieldChart />
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
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
    <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
      <div className="lg:col-span-5" data-tour="deposit-panel">
        <DepositPanel />
      </div>
      <div className="lg:col-span-7">
        <PositionsPanel />
      </div>
    </div>
  </div>
);

const VaultSection = () => (
  <div className="space-y-6">
    <VaultStatsStrip />
    <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
      <div className="lg:col-span-5" data-tour="vault-panel">
        <VaultPanel />
      </div>
      <div className="lg:col-span-7">
        <ReceiptsPanel />
      </div>
    </div>
  </div>
);

const MarketsSection = () => (
  <div className="space-y-6">
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
      <div className="lg:col-span-8">
        <MarketChart />
      </div>
      <div className="lg:col-span-4" data-tour="markets-panel">
        <SrTradePanel />
      </div>
    </div>
  </div>
);

const LiquiditySection = () => (
  <div className="space-y-6">
    <LpStatsStrip />
    <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
      <div className="lg:col-span-5" data-tour="liquidity-panel">
        <LpPanel />
      </div>
      <div className="lg:col-span-7">
        <LpPositionPanel />
      </div>
    </div>
  </div>
);

const SolvencySection = () => (
  <div className="space-y-6" data-tour="solvency-panel">
    <SolvencyCard />
    {/* Solvency proof and risk disclosure belong on the same page: one says what holds today, the
        other says what would break it. Showing the first without the second is the shape of most
        DeFi dashboards, and it is why people are surprised later. */}
    <RiskDisclosure />
  </div>
);

/**
 * **Yield** — what YT has earned, and the position that earned it.
 *
 * This page used to be "Spield v2" and carried a trading panel and a portfolio panel too. Once the
 * whole dashboard moved onto the SR contracts, the trading panel became a second Markets page (so it
 * moved there, where the chart already lived) and the portfolio panel repeated both this card's
 * claimable figure and the Solvency page's numbers. What is left is the job nothing else covers:
 * seeing accrued yield and taking it, without giving up the position.
 */
const YieldSection = () => (
  <div data-tour="yield-panel">
    <SrYieldPanel />
  </div>
);

/**
 * The SR wrapper, on its own page. Separate from trading on purpose: it is a different job (hold a
 * yield-bearing dollar) rather than a prerequisite for one, and folding it into the trade panel is
 * what made v2 read as a two-step protocol when it is not.
 */
const SrWrapSection = () => (
  <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12" data-tour="srwrap-panel">
    <div className="lg:col-span-5">
      <SrWrapPanel />
    </div>
    <div className="lg:col-span-7">
      <SrPortfolioPanel />
    </div>
  </div>
);

const ActivitySection = () => <ActivityFeed />;

const SECTIONS: Record<string, () => React.ReactNode> = {
  overview: OverviewSection,
  vault: VaultSection,
  deposit: DepositSection,
  markets: MarketsSection,
  v2: YieldSection,
  srwrap: SrWrapSection,
  liquidity: LiquiditySection,
  bridge: BridgeSection,
  solvency: SolvencySection,
  activity: ActivitySection,
};

/* ----------------------------------------------------------------- page */

const BlendDashboardPage = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const { refresh, refreshing, stale } = useProtocol();
  const { startTour } = useTutorial();

  const handleHowItWorksClick = () => {
    const idx = APP_TOUR_STEPS.findIndex((s) => s.route === `/${nav.id}`);
    startTour(idx !== -1 ? idx : 0);
  };

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

  // A route change from anywhere — the sheet, a deep link, the back gesture —
  // must leave the sheet closed. Without this, going back after tapping a sheet
  // item returns you to the previous section with the sheet still up.
  //
  // Adjusted during render rather than in an effect: this is state derived from
  // a change in another value, which React handles in-render without the extra
  // commit-then-rerender an effect would cost.
  // https://react.dev/learn/you-might-not-need-an-effect
  const [lastPath, setLastPath] = useState(location.pathname);
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setMoreOpen(false);
  }

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
      {/* The theme now lives on <html> (set before paint in index.html), so
          the shell no longer hard-codes `dark` — this app can be paper. */}
      <div className="app-shell flex h-screen overflow-hidden bg-canvas text-foreground">
        <Sidebar
          collapsed={collapsed}
          onToggle={setCollapsed}
          activeNav={activeNav}
          onNavChange={navValue.navigate}
        />

        <main className="flex min-w-0 grow flex-col">
          <Header section={nav.label} />
          {/* Renders nothing unless VITE_MAINNET_DEMO is on. */}
          <DemoBanner />

          {/* The gutter steps 16 → 24 → 32 with the viewport rather than
              jumping straight from a phone's margin to a desktop's. */}
          <div className="grow overflow-y-auto px-4 pt-6 pb-[calc(5.25rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pt-8 lg:pb-16">
            <div className="mx-auto max-w-7xl space-y-6">
              {/* Page title. Satoshi at display size with the subtitle set on
                  a real measure under it — the section states what it is once,
                  properly, instead of twice in the same weight.

                  `pb-2` on top of the column's 24px gap is what makes the
                  heading→content step 32px, one rung above the 24px that
                  separates the blocks below it. */}
              <div className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h1 className="font-display text-[26px] leading-[1.1] font-bold tracking-[-0.03em] sm:text-[32px]">
                      {nav.title}
                    </h1>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleHowItWorksClick}
                      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border/80 bg-card/60 px-3 text-[12px] font-medium text-foreground shadow-float-sm backdrop-blur transition-all duration-200 hover:-translate-y-px hover:border-brand/40 hover:bg-brand/5 hover:text-brand-text active:scale-95"
                    >
                      <HelpCircle size={13} className="text-brand-text" />
                      <span>How it works</span>
                    </Button>
                  </div>
                  <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-muted-foreground">
                    {nav.subtitle}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 self-start sm:pt-1.5">
                  <LastUpdated />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refresh()}
                    disabled={refreshing}
                    title="Re-read the contracts"
                    className="h-9 gap-2 rounded-full px-4 text-[13px] font-medium"
                  >
                    <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
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

        {/* Phones navigate from the bottom. Rendered as a sibling of <main> so
            it spans the viewport, not the content column. */}
        <BottomNav
          activeNav={activeNav}
          onNavChange={navValue.navigate}
          moreOpen={moreOpen}
          onMoreOpenChange={setMoreOpen}
        />

        {/* Section explainer modal */}
        <HowItWorksModal
          open={howItWorksOpen}
          onOpenChange={setHowItWorksOpen}
          sectionId={nav.id}
        />

        {/* Real in-app interactive tour with spotlight and contextual pop-up models */}
        <InteractiveAppTour />
      </div>
    </NavProvider>
  );
};

export default BlendDashboardPage;
