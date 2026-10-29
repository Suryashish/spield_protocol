import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  HelpCircle,
  RefreshCw,
  Coins,
  Layers,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSEO } from '@/hooks/useSEO';
import { APP_ORIGIN } from '@/lib/site';
import { NETWORK } from '@/lib/config';
import { units } from '@/lib/ustry';
import { NavProvider } from '@/context/NavContext';
import { navById, NAV_ITEMS } from '../data';
import Sidebar from '../layout/Sidebar';
import BottomNav from '../layout/BottomNav';
import Header from '../layout/Header';
import InteractiveAppTour from '../guide/InteractiveAppTour';
import HowItWorksModal, { type ExplainerConfig } from '../layout/HowItWorksModal';
import { useUstryDashboard } from './useUstryDashboard';
import {
  UstryOverview,
  UstryDeposit,
  UstryReceipts,
  UstryYield,
  UstryMarkets,
  UstrySolvency,
  UstryActivity,
  UstryUnavailable,
} from './UstrySections';

const SUBTITLES: Record<string, string> = {
  overview: 'Your portfolio at a glance — wallet USDC, principal, yield and USTRY backing.',
  deposit: 'Deposit USDC for PT and YT, or combine your position to receive USDC.',
  v2: 'What your YT has earned — claimable straight to USTRY without giving up the position.',
  srwrap: 'Wrap USDC into sUSTRY receipts, or unwrap sUSTRY back to USDC.',
  markets: 'Convert USDC and USTRY using executable exchange quotes with a minimum output.',
  liquidity: 'Pool and liquidity-position availability for the selected USTRY series.',
  solvency: 'Live USTRY backing against token obligations — and what can interrupt an exit.',
  activity: 'Your confirmed deposits, claims, transfers and redemptions for this USTRY series.',
};
function explainer(section: string, title: string): ExplainerConfig {
  const common: ExplainerConfig = {
    title: `How ${title.toLowerCase()} works with USTRY`,
    blurb: SUBTITLES[section],
    badge: 'USTRY · Stellar Testnet',
    steps: [
      {
        icon: Coins,
        title: '1 · Acquire or deposit USTRY',
        body: 'Pay with supported test USDC on Deposit to receive PT and YT, or use SR Wrapper to receive sUSTRY. The app converts through USTRY for either path.',
      },
      {
        icon: Layers,
        title: '2 · Separate principal and yield',
        body: 'PT and YT are measured in USD face. PT holds a token allocation; YT earns USTRY when NAV rises above its previous high.',
      },
      {
        icon: TrendingUp,
        title: '3 · Claim or exit',
        body: 'Claim earned yield in USTRY. Before maturity, combine matching PT and YT; after settlement, redeem PT alone. Deposit and Combine converts the USTRY payout to USDC.',
      },
    ],
    callout: {
      icon: ShieldCheck,
      title: 'Token units and dollars are different',
      body: 'Payouts use USTRY, whose NAV can fall. PT does not guarantee dollar principal. Unsplit receipt exits and finalized token payouts do not need a live oracle.',
    },
  };
  if (section === 'liquidity')
    return {
      ...common,
      steps: [
        {
          icon: Layers,
          title: 'Current series availability',
          body: 'No USTRY PT pool or LP contract is deployed. Markets can convert the underlying USTRY asset.',
        },
      ],
    };
  return common;
}
function Banner({
  children,
  tone = 'ember',
  action,
}: {
  children: React.ReactNode;
  tone?: 'ember' | 'danger';
  action?: React.ReactNode;
}) {
  return (
    <div
      role="status"
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
}
function ago(timestamp: number, clock: number) {
  const seconds = Math.max(0, Math.floor((clock - timestamp) / 1000));
  return seconds < 5
    ? 'just now'
    : seconds < 60
      ? `${seconds}s ago`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}m ago`
        : `${Math.floor(seconds / 3600)}h ago`;
}

export default function UstryDashboard() {
  const model = useUstryDashboard();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [lastPath, setLastPath] = useState(location.pathname);
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setMoreOpen(false);
    setHelpOpen(false);
  }
  const segment = location.pathname.split('/').at(-1) ?? 'overview';
  const activeNav = NAV_ITEMS.some((n) => n.id === segment) ? segment : 'overview';
  const nav = navById(activeNav);
  const subtitle = SUBTITLES[nav.id];
  useEffect(() => {
    const legacy = searchParams.get('section');
    if (legacy && NAV_ITEMS.some((n) => n.id === legacy)) navigate(`/${legacy}`, { replace: true });
  }, [searchParams, navigate]);
  const navValue = { active: activeNav, navigate: (id: string) => navigate(`/${id}`) };
  useSEO({
    title: `${nav.label} | Spield App`,
    description: subtitle,
    canonical: `${APP_ORIGIN}/${nav.id}`,
    noindex: true,
  });
  const { data, error, loading, busy, clock, stale, matured, address, onCorrectNetwork, refresh } =
    model;
  const pendingPrice = !!data?.syncError || (stale && !data?.state.finalized);
  const content =
    activeNav === 'overview' ? (
      <UstryOverview model={model} />
    ) : activeNav === 'deposit' ? (
      <UstryDeposit model={model} />
    ) : activeNav === 'srwrap' ? (
      <UstryReceipts model={model} />
    ) : activeNav === 'v2' ? (
      <UstryYield model={model} />
    ) : activeNav === 'markets' ? (
      <UstryMarkets model={model} />
    ) : activeNav === 'solvency' ? (
      <UstrySolvency model={model} />
    ) : activeNav === 'activity' ? (
      <UstryActivity model={model} />
    ) : (
      <UstryUnavailable model={model} />
    );
  return (
    <NavProvider value={navValue}>
      <div className="app-shell flex h-screen overflow-hidden bg-canvas text-foreground">
        <Sidebar
          collapsed={collapsed}
          onToggle={setCollapsed}
          activeNav={activeNav}
          onNavChange={navValue.navigate}
        />
        <main className="flex min-w-0 grow flex-col">
          <Header section={nav.label} />
          <div className="grow overflow-y-auto px-4 pt-6 pb-[calc(5.25rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pt-8 lg:pb-16">
            <div className="mx-auto max-w-7xl space-y-6">
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
                      onClick={() => setHelpOpen(true)}
                      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border/80 bg-card/60 px-3 text-[12px] font-medium text-foreground shadow-float-sm backdrop-blur transition-all duration-200 hover:-translate-y-px hover:border-brand/40 hover:bg-brand/5 hover:text-brand-text active:scale-95"
                    >
                      <HelpCircle size={13} className="text-brand-text" />
                      <span>How it works</span>
                    </Button>
                  </div>
                  <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-muted-foreground">
                    {subtitle}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 self-start sm:pt-1.5">
                  {data && (
                    <span
                      className={cn(
                        'eyebrow flex items-center gap-2',
                        error ? 'text-ember-text' : 'text-muted-foreground',
                      )}
                    >
                      <span
                        className={error ? 'size-1.5 shrink-0 rounded-full bg-ember' : 'pulse-dot'}
                      />
                      {error ? 'Stale · ' : 'Updated '}
                      {ago(data.readAt, clock)}
                    </span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void refresh()}
                    disabled={loading || busy}
                    title="Re-read the contracts"
                    className="h-9 gap-2 rounded-full px-4 text-[13px] font-medium"
                  >
                    <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
                    Refresh
                  </Button>
                </div>
              </div>
              {address && !onCorrectNetwork && (
                <Banner>
                  Your wallet is on the wrong network. Switch to{' '}
                  <span className="font-semibold">{NETWORK.name}</span> to interact with the Spield
                  contracts.
                </Banner>
              )}
              {data?.paused && (
                <Banner tone="danger">
                  New USTRY deposits and splits are paused. Existing exits remain available when
                  their price requirements are met.
                </Banner>
              )}
              {model.frozen && (
                <Banner tone="danger">
                  The series holds {units(model.shortfall)} USTRY less than it owes, most likely after an
                  issuer clawback. Withdrawals, redemptions, yield claims and new deposits are frozen
                  for everyone until the shortfall is restored, so no holder can exit at the
                  others&apos; expense. PT and YT transfers remain available.
                </Banner>
              )}
              {error && (
                <Banner
                  tone="danger"
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void refresh()}
                      disabled={loading}
                      className="h-8 shrink-0 gap-2 self-start border-danger/30 text-xs font-semibold text-danger-text hover:bg-danger/10 sm:self-auto"
                    >
                      <RefreshCw size={13} />
                      Retry
                    </Button>
                  }
                >
                  USTRY reads failed. Showing the last data we have; missing balances have not been
                  assumed to be zero.
                </Banner>
              )}
              {pendingPrice &&
                (data?.version === 2 ? (
                  <Banner>
                    {matured
                      ? 'Maturity settlement waits for a post-expiry NAV sample, or for the grace period to pass.'
                      : 'NAV is stale or the feed is unavailable, so new deposits are paused.'}{' '}
                    Combine, yield claims, transfers and receipt withdrawals remain available.
                  </Banner>
                ) : (
                  <Banner>
                    {matured
                      ? 'Maturity settlement is pending a valid boundary observation.'
                      : 'NAV is stale or synchronization is unavailable.'}{' '}
                    Priced actions are disabled. Unsplit receipts can still be withdrawn on SR
                    Wrapper.
                  </Banner>
                ))}
              {data?.state.finalized && (stale || !data.navAvailable) && (
                <Banner>
                  The displayed NAV is the last available observation. Finalized payouts use frozen
                  USTRY allocations and remain available.
                </Banner>
              )}
              <div className={cn('transition-opacity', error && 'opacity-60')}>{content}</div>
            </div>
          </div>
        </main>
        <BottomNav
          activeNav={activeNav}
          onNavChange={navValue.navigate}
          moreOpen={moreOpen}
          onMoreOpenChange={setMoreOpen}
        />
        <HowItWorksModal
          open={helpOpen}
          onOpenChange={setHelpOpen}
          sectionId={nav.id}
          config={explainer(nav.id, nav.label)}
        />
        <InteractiveAppTour />
      </div>
    </NavProvider>
  );
}
