import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Check,
  Layers,
  Clock,
  AlertCircle,
  Archive,
  ArrowRight,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useSeries } from '@/context/SeriesContext';
import { useToast } from '@/context/ToastContext';
import type { SeriesConfig } from '@/lib/config';

type SectionTab = 'live' | 'ended';

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

  const pill = cn(
    'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border bg-card px-3 text-[13px] font-medium shadow-float-sm transition-all duration-200 ease-vault hover:-translate-y-px hover:border-line-strong',
    isCurrentEnded
      ? 'border-amber-500/35 bg-amber-500/8 text-amber-200 hover:border-amber-500/50'
      : 'border-emerald-500/30 bg-emerald-500/8 text-foreground hover:border-emerald-500/50',
  );

  const displayedList = activeTab === 'live' ? liveSeries : endedSeries;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Switch active series"
        className={pill}
      >
        {isCurrentEnded ? (
          <span className="size-2 rounded-full bg-amber-500 shadow-sm" />
        ) : (
          <span className="pulse-dot" />
        )}
        <span className="font-semibold">{activeSeries.name}</span>
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[11px] font-medium hidden min-[400px]:inline',
            isCurrentEnded
              ? 'bg-amber-500/20 text-amber-400'
              : 'bg-emerald-500/20 text-emerald-400',
          )}
        >
          {isCurrentEnded ? 'Ended' : 'Live Now'}
        </span>
        <ChevronDown
          size={13}
          className={cn('text-subtle transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="panel absolute right-0 top-11 z-30 w-84 sm:w-96 origin-top-right overflow-hidden rounded-2xl p-2.5 shadow-lift border border-border bg-card/95 backdrop-blur-xl duration-150 animate-in fade-in-0 zoom-in-95"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/70 px-2 pb-2.5 pt-1 text-xs">
            <span className="eyebrow flex items-center gap-1.5 text-foreground font-medium">
              <Layers size={13} className="text-brand-text" />
              Select Series
            </span>
            <span className="rounded-full bg-accent px-2 py-0.5 text-[10.5px] uppercase font-mono tracking-wider text-muted-foreground">
              {activeSeries.network}
            </span>
          </div>

          {/* 2 Sections Toggle Tabs */}
          <div className="mt-2.5 grid grid-cols-2 gap-1 rounded-xl bg-accent/60 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('live')}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all duration-150',
                activeTab === 'live'
                  ? 'bg-card text-emerald-500 shadow-sm border border-emerald-500/30'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="pulse-dot" />
              <span>Live Now</span>
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.2 text-[10.5px]',
                  activeTab === 'live'
                    ? 'bg-emerald-500/20 text-emerald-500'
                    : 'bg-foreground/10 text-muted-foreground',
                )}
              >
                {liveSeries.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('ended')}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all duration-150',
                activeTab === 'ended'
                  ? 'bg-card text-amber-500 shadow-sm border border-amber-500/30'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Archive size={12} className={activeTab === 'ended' ? 'text-amber-500' : 'text-muted-foreground'} />
              <span>Ended</span>
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.2 text-[10.5px]',
                  activeTab === 'ended'
                    ? 'bg-amber-500/20 text-amber-500'
                    : 'bg-foreground/10 text-muted-foreground',
                )}
              >
                {endedSeries.length}
              </span>
            </button>
          </div>

          {/* Series List in Active Section */}
          <div className="mt-2.5 max-h-[60vh] space-y-2 overflow-y-auto pr-0.5">
            {displayedList.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                No series in this section.
              </div>
            ) : (
              displayedList.map((series) => {
                const isSelected = series.id === activeSeriesId;
                const isEnded = series.expiry <= Math.floor(Date.now() / 1000);

                return (
                  <button
                    key={series.id}
                    type="button"
                    onClick={() => handleSelect(series)}
                    className={cn(
                      'group flex w-full flex-col gap-1.5 rounded-xl border p-3 text-left transition-all duration-150',
                      isSelected
                        ? isEnded
                          ? 'border-amber-500/50 bg-amber-500/10 shadow-sm'
                          : 'border-emerald-500/50 bg-emerald-500/10 shadow-sm'
                        : 'border-border/70 bg-card hover:border-line-strong hover:bg-accent/50',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-bold text-foreground">
                          {series.name}
                        </span>
                        <span className="rounded bg-accent px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                          {series.durationLabel}
                        </span>
                        {isEnded ? (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-500 border border-amber-500/25">
                            Ended
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-500 border border-emerald-500/25">
                            <span className="pulse-dot" />
                            Live Now
                          </span>
                        )}
                      </div>

                      {isSelected ? (
                        <span
                          className={cn(
                            'flex size-5 items-center justify-center rounded-full text-white shadow-sm',
                            isEnded ? 'bg-amber-500' : 'bg-emerald-500',
                          )}
                        >
                          <Check size={12} strokeWidth={3} />
                        </span>
                      ) : (
                        <span className="text-xs text-subtle group-hover:text-foreground flex items-center gap-1 font-medium transition-colors">
                          Switch
                          <ArrowRight size={11} />
                        </span>
                      )}
                    </div>

                    <p className="line-clamp-1 text-[11.5px] text-muted-foreground">
                      {series.description}
                    </p>

                    <div className="mt-1 flex items-center justify-between border-t border-border/40 pt-2 text-[11.5px]">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Clock size={11} className={isEnded ? 'text-amber-500' : 'text-emerald-500'} />
                        {isEnded ? `Matured ${series.maturityDate}` : `Matures ${series.maturityDate}`}
                      </span>

                      <div className="flex items-center gap-2">
                        {series.depositCapUsdc && (
                          <span className="text-muted-foreground">
                            {series.depositCapUsdc} USDC cap
                          </span>
                        )}
                        <span
                          className={cn(
                            'font-mono font-semibold',
                            isEnded ? 'text-amber-500' : 'text-emerald-500',
                          )}
                        >
                          {series.fixedAprPct.toFixed(2)}% APR
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer note if ended series is active */}
          {isCurrentEnded && (
            <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11.5px] leading-relaxed text-amber-200">
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-amber-400" />
              <span>
                Currently viewing ended series <strong>{activeSeries.name}</strong>. You can view
                your balances and redeem PT & vault receipts 1:1 at par.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
