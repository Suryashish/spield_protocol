import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Check,
  Layers,
  AlertCircle,
  Archive,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useSeries } from '@/context/SeriesContext';
import { useToast } from '@/context/ToastContext';
import type { SeriesConfig } from '@/lib/config';

type SectionTab = 'live' | 'ended';

/** Human-readable time remaining or time elapsed since maturity */
const formatExpirySubtitle = (expiry: number): string => {
  const diffSecs = expiry - Math.floor(Date.now() / 1000);
  if (diffSecs <= 0) {
    const daysAgo = Math.floor(Math.abs(diffSecs) / 86400);
    if (daysAgo <= 0) return 'Matured today';
    if (daysAgo === 1) return 'Matured yesterday';
    return `Matured ${daysAgo}d ago`;
  }
  const days = Math.ceil(diffSecs / 86400);
  if (days === 1) return 'Matures tomorrow';
  return `Matures in ${days}d`;
};

export default function SeriesHeaderControl() {
  const {
    activeSeries,
    activeSeriesId,
    liveSeries,
    endedSeries,
    isCurrentEnded,
    selectSeries,
  } = useSeries();
  const { push } = useToast();

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SectionTab>(() =>
    isCurrentEnded ? 'ended' : 'live',
  );
  const menuRef = useRef<HTMLDivElement>(null);

  // Sync tab with active series when dropdown opens
  useEffect(() => {
    if (open) {
      setActiveTab(isCurrentEnded ? 'ended' : 'live');
    }
  }, [open, isCurrentEnded]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const handleSelect = (series: SeriesConfig) => {
    if (series.id === activeSeriesId) {
      setOpen(false);
      return;
    }
    selectSeries(series.id);
    setOpen(false);
    const isEnded = series.expiry <= Math.floor(Date.now() / 1000);
    push({
      title: `Switched to ${series.name}`,
      message: isEnded
        ? `Viewing ended series (matured ${series.maturityDate}). Redemptions are open at par.`
        : `Viewing live series (matures ${series.maturityDate}). Deposits & trades active.`,
      kind: 'success',
    });
  };

  const currentTabList = activeTab === 'live' ? liveSeries : endedSeries;

  return (
    <div ref={menuRef} className="relative">
      {/* Trigger Pill */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Switch active series"
        className={cn(
          'group inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border bg-card px-3 text-[13px] font-medium shadow-float-sm transition-all duration-200 ease-vault hover:-translate-y-px',
          open
            ? 'border-line-strong bg-accent/60 ring-1 ring-border-strong/30'
            : isCurrentEnded
              ? 'border-ember/40 bg-ember/[0.03] hover:border-ember/70'
              : 'border-border hover:border-line-strong',
        )}
      >
        <span
          className={cn(
            'size-2 shrink-0 rounded-full shadow-xs',
            isCurrentEnded ? 'bg-ember' : 'bg-brand',
          )}
        />

        <span className="font-display font-semibold text-[13px] tracking-[-0.01em] text-foreground">
          {activeSeries.name}
        </span>

        {/* Responsive status pill: visible on sm+ */}
        <span
          className={cn(
            'hidden sm:inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold',
            isCurrentEnded
              ? 'bg-ember/10 text-ember-text border border-ember/25'
              : 'bg-brand/10 text-brand-text border border-brand/25',
          )}
        >
          {isCurrentEnded ? 'Ended' : 'Live Now'}
        </span>

        {/* Duration badge: visible on lg+ */}
        <span className="hidden font-mono text-[11px] text-ink-subtle lg:inline">
          · {activeSeries.durationLabel}
        </span>

        <ChevronDown
          size={13}
          className={cn('text-subtle transition-transform duration-200 ease-vault', open && 'rotate-180 text-foreground')}
        />
      </button>

      {/* Dropdown Menu */}
      {open && (
        <div
          role="menu"
          className="panel absolute right-0 top-11 z-30 w-[calc(100vw-2rem)] sm:w-[460px] max-w-[460px] origin-top-right overflow-hidden rounded-2xl border border-line-strong/60 bg-card/98 p-3.5 shadow-lift backdrop-blur-2xl duration-150 animate-in fade-in-0 zoom-in-95"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/60 pb-3 pt-0.5">
            <div className="flex items-center gap-2.5">
              <div className="grid size-8 place-items-center rounded-xl bg-sunken border border-border text-brand-text shadow-float-sm">
                <Layers size={15} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-display text-[14px] font-bold tracking-tight text-foreground">
                    Yield Series
                  </p>
                  <span className="rounded-md bg-sunken border border-border px-1.5 py-0.2 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-ink-muted">
                    {activeSeries.network}
                  </span>
                </div>
                <p className="text-[11.5px] text-ink-muted">
                  Isolated fixed-rate tranches & on-chain orderbooks
                </p>
              </div>
            </div>
          </div>

          {/* Segmented Control: 2 Sections */}
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-sunken/80 p-1 border border-border">
            <button
              type="button"
              onClick={() => setActiveTab('live')}
              className={cn(
                'group flex items-center justify-center gap-2 rounded-lg py-1.5 text-xs font-semibold transition-all duration-200',
                activeTab === 'live'
                  ? 'bg-card text-foreground shadow-float-sm border border-line-strong/60'
                  : 'text-ink-muted hover:text-foreground',
              )}
            >
              <TrendingUp
                size={13}
                className={activeTab === 'live' ? 'text-brand-text' : 'text-subtle transition-colors group-hover:text-foreground'}
              />
              <span>Live Now</span>
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.2 text-[10px] font-mono transition-colors',
                  activeTab === 'live'
                    ? 'bg-brand/15 text-brand-text font-bold'
                    : 'bg-surface text-ink-subtle border border-border',
                )}
              >
                {liveSeries.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('ended')}
              className={cn(
                'group flex items-center justify-center gap-2 rounded-lg py-1.5 text-xs font-semibold transition-all duration-200',
                activeTab === 'ended'
                  ? 'bg-card text-foreground shadow-float-sm border border-line-strong/60'
                  : 'text-ink-muted hover:text-foreground',
              )}
            >
              <Archive
                size={13}
                className={activeTab === 'ended' ? 'text-ember-text' : 'text-subtle transition-colors group-hover:text-foreground'}
              />
              <span>Ended</span>
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.2 text-[10px] font-mono transition-colors',
                  activeTab === 'ended'
                    ? 'bg-ember/15 text-ember-text font-bold'
                    : 'bg-surface text-ink-subtle border border-border',
                )}
              >
                {endedSeries.length}
              </span>
            </button>
          </div>

          {/* Series Cards */}
          <div className="mt-3 max-h-[60vh] space-y-2.5 overflow-y-auto pr-0.5">
            {currentTabList.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-ink-muted">
                No series found in this section.
              </div>
            ) : (
              currentTabList.map((series) => {
                const isSelected = series.id === activeSeriesId;
                const isEnded = series.expiry <= Math.floor(Date.now() / 1000);
                const expirySub = formatExpirySubtitle(series.expiry);

                return (
                  <button
                    key={series.id}
                    type="button"
                    onClick={() => handleSelect(series)}
                    className={cn(
                      'group flex w-full flex-col gap-2.5 rounded-xl border p-3.5 text-left transition-all duration-200 ease-vault',
                      isSelected
                        ? isEnded
                          ? 'border-ember/50 bg-ember/[0.04] shadow-float-sm ring-1 ring-ember/25'
                          : 'border-brand/50 bg-brand/[0.04] shadow-float-sm ring-1 ring-brand/25'
                        : 'border-border/70 bg-card hover:border-line-strong hover:bg-surface/80 hover:shadow-float-sm',
                    )}
                  >
                    {/* Top Row: Name, Duration, Status, and Action Indicator */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-[15px] font-bold tracking-tight text-foreground">
                          {series.name}
                        </span>
                        <span className="rounded-md bg-sunken border border-border/80 px-2 py-0.5 font-mono text-[10.5px] font-medium text-ink-muted">
                          {series.durationLabel}
                        </span>
                        {isEnded ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-ember/10 border border-ember/25 px-2 py-0.5 font-mono text-[10px] font-semibold text-ember-text">
                            <span className="size-1.5 rounded-full bg-ember" />
                            Ended
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 border border-brand/25 px-2 py-0.5 font-mono text-[10px] font-semibold text-brand-text">
                            <span className="size-1.5 rounded-full bg-brand" />
                            Live Now
                          </span>
                        )}
                      </div>

                      {isSelected ? (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold shadow-xs',
                            isEnded
                              ? 'bg-ember/15 text-ember-text border border-ember/30'
                              : 'bg-brand/15 text-brand-text border border-brand/30',
                          )}
                        >
                          <Check size={11} strokeWidth={2.5} />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-subtle transition-colors group-hover:text-foreground">
                          Switch
                          <ArrowRight size={11} className="transition-transform group-hover:translate-x-0.5" />
                        </span>
                      )}
                    </div>

                    {/* Middle: Short Description */}
                    <p className="line-clamp-1 text-[11.5px] text-ink-muted leading-relaxed">
                      {series.description}
                    </p>

                    {/* Bottom: 3 Financial Metrics Grid */}
                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-sunken/70 border border-border/70 p-2 text-left">
                      <div>
                        <p className="eyebrow text-[9.5px]">Fixed APR</p>
                        <p
                          className={cn(
                            'num font-mono text-[13px] font-bold mt-0.5',
                            isEnded ? 'text-ember-text' : 'text-brand-text',
                          )}
                        >
                          {series.fixedAprPct.toFixed(2)}%
                        </p>
                      </div>
                      <div>
                        <p className="eyebrow text-[9.5px]">Maturity</p>
                        <p className="num font-mono text-[11.5px] font-medium text-foreground mt-0.5">
                          {series.maturityDate}
                        </p>
                      </div>
                      <div>
                        <p className="eyebrow text-[9.5px]">Timeline</p>
                        <p className="text-[11.5px] font-medium text-ink-muted mt-0.5 truncate">
                          {expirySub}
                        </p>
                      </div>
                    </div>

                    {/* Par Redemption Note if Ended */}
                    {isEnded && (
                      <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-ink-subtle pt-0.5">
                        <Check size={11} className="text-brand-text shrink-0" />
                        <span>1 PT = 1 USDC guaranteed redemption at par</span>
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Contextual Notice if Viewing Ended Series */}
          {isCurrentEnded ? (
            <div className="mt-3 rounded-xl border border-ember/25 bg-ember/8 p-3 text-[12px] text-foreground">
              <div className="flex items-start gap-2.5">
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-ember-text" />
                <div className="flex-1 space-y-1">
                  <p className="font-semibold text-ember-text">
                    Viewing Ended Series: {activeSeries.name}
                  </p>
                  <p className="text-[11.5px] text-ink-muted leading-normal">
                    New deposits and mints are disabled. Outstanding PT tokens and vault receipts can be redeemed 1:1 for USDC at par.
                  </p>
                  {liveSeries.length > 0 && (
                    <button
                      type="button"
                      onClick={() => handleSelect(liveSeries[0])}
                      className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-text hover:underline"
                    >
                      Switch to {liveSeries[0].name} (Live Now)
                      <ArrowRight size={11} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-2.5 flex items-center justify-between border-t border-border/50 px-1 pt-2.5 text-[11px] text-ink-subtle">
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-brand" />
                Isolated contracts & orderbook
              </span>
              <span className="font-mono text-ink-muted">1 PT = 1 USDC at maturity</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
