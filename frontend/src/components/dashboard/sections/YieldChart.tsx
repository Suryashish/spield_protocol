import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TrendingUp, Activity, Info, LineChart } from 'lucide-react';

import EmptyState from './EmptyState';
import { cn } from '@/lib/utils';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useProtocol } from '@/context/ProtocolContext';
import { getYieldHistory, sampleYield, type YieldHistory } from '@/lib/yield';
import { impliedApyPct } from '@/lib/v2adapters';
import { MARKET_DEPLOYED } from '@/lib/config';

const fmtPct = (frac: number | null, digits = 2): string =>
  frac == null ? '—' : `${(frac * 100).toFixed(digits)}%`;

/**
 * Format a yield fraction with *enough* precision to show a real, non-zero number.
 * Early testnet yields are tiny (e.g. 0.00004%), so a fixed 2-dp format would read
 * as "0.00%" and look broken. We grow the decimal places until the value is visible
 * (or give up at 8). Exact zero stays "0%".
 */
const fmtAdaptivePct = (frac: number | null): string => {
  if (frac == null) return '—';
  const pct = frac * 100;
  if (pct === 0) return '0%';
  for (let digits = 2; digits <= 8; digits++) {
    const rounded = Number(pct.toFixed(digits));
    if (rounded !== 0) return `${pct.toFixed(digits)}%`;
  }
  // Smaller than 1e-8% — show it as a vanishingly small positive number.
  return '<0.00000001%';
};

const fmtTime = (unix: number): string =>
  new Date(unix * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * Realized-yield chart — the protocol's real, on-chain return over time.
 *
 * Plots cumulative yield since the first observed Blend `b_rate` (so the growth is
 * visible even though the raw rate barely moves hour-to-hour), with the annualized
 * realized APY as the headline. Every point is a rate the chain actually reported —
 * reconstructed from events + live reads, never fabricated. This is the "what did it
 * actually earn" view; the market-derived *implied* APY arrives with the Phase 3 AMM.
 */
const YieldChart = () => {
  // Use the completed-refresh timestamp rather than `refreshing`, which changes
  // twice per refresh and previously issued duplicate history RPC calls.
  const { lastUpdated, marketStats } = useProtocol();
  const [history, setHistory] = useState<YieldHistory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!lastUpdated) return;
    let cancelled = false;
    // Legitimate data-fetch effect; the terminal state is set in the async callbacks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    // `Date.now` is fine in the browser; the contracts never see it.
    getYieldHistory(Math.floor(Date.now() / 1000))
      .then((h) => {
        if (!cancelled) {
          setHistory(h);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lastUpdated]);

  // Convert absolute rate samples → cumulative yield % since the first observation.
  // Yield is computed from the integer baseline at full precision (see lib/yield).
  const { data, spanLabel, intraday, hasEnough } = useMemo(() => {
    const samples = history?.samples ?? [];
    if (samples.length < 2) {
      return { data: [], spanLabel: '', intraday: false, hasEnough: false };
    }
    const base = samples[0].rate;
    const data = samples.map((s) => ({
      t: s.t,
      yieldPct: sampleYield(base, s.rate) * 100,
    }));
    const secs = history?.windowSecs ?? 0;
    const hours = secs / 3600;
    const spanLabel =
      hours >= 48
        ? `${(hours / 24).toFixed(1)} days`
        : hours >= 1
          ? `${hours.toFixed(1)} hours`
          : `${Math.round(hours * 60)} min`;
    return { data, spanLabel, intraday: secs < 36 * 3600, hasEnough: true };
  }, [history]);

  const apy = history?.apy ?? null;
  const apyReliable = history?.apyReliable ?? false;
  const cumulative = history?.cumulativeYield ?? null;

  // Headline: a trustworthy annualized APY once the window is long enough; until
  // then, the honest cumulative figure rather than a noisy extrapolation.
  const realizedLabel = apyReliable ? 'Realized APY' : 'Yield so far';
  const realizedValue = apyReliable ? fmtPct(apy) : fmtAdaptivePct(cumulative);

  // The market's forward-looking number (from the AMM curve), shown beside the backward-looking
  // realized figure so the two views sit together: what it earned vs what the market prices in.
  const impliedPct = impliedApyPct(marketStats);
  const showImplied = MARKET_DEPLOYED && !!marketStats;

  return (
    <Card className="overflow-hidden rounded-xl">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Yield — Realized vs Implied</CardTitle>
          <CardDescription>
            What Blend has actually paid, next to what the market prices in
          </CardDescription>
        </div>
        <div className="flex items-stretch gap-3">
          {/* Realized — backward-looking, from observed b_rate growth */}
          <div className="text-right">
            <div className="flex items-center justify-end gap-1.5 eyebrow">
              <TrendingUp size={13} className="text-brand-text" />
              {realizedLabel}
            </div>
            <div
              className={cn(
                'num font-display text-[22px] font-medium tracking-[-0.02em] sm:text-[26px]',
                realizedValue === '—' ? 'text-subtle' : 'text-brand-text',
              )}
            >
              {realizedValue}
            </div>
            <div className="eyebrow">realized</div>
          </div>
          {showImplied && (
            <>
              <div className="w-px self-stretch bg-border" />
              {/* Implied — forward-looking, from the AMM curve */}
              <div className="text-right">
                <div className="flex items-center justify-end gap-1.5 eyebrow">
                  <LineChart size={13} className="text-ember-text" />
                  Implied APY
                </div>
                <div
                  className={cn(
                    'num font-display text-[22px] font-medium tracking-[-0.02em] sm:text-[26px]',
                    impliedPct > 0 ? 'text-ember-text' : 'text-subtle',
                  )}
                >
                  {impliedPct > 0 ? `${impliedPct.toFixed(2)}%` : '—'}
                </div>
                <div className="eyebrow">
                  market · forward
                </div>
              </div>
            </>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="h-64 animate-pulse rounded-xl bg-muted" />
        ) : !hasEnough ? (
          <EmptyState
            className="h-64"
            icon={Activity}
            title="Building yield history…"
            body={
              <>
                We have {history?.samples.length ?? 0} rate observation
                {(history?.samples.length ?? 0) === 1 ? '' : 's'} so far. The curve fills in as
                Blend&apos;s rate ticks up — keep the dashboard open to watch it grow.
              </>
            }
          />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={264}>
              <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="yieldFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  scale="time"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--ink-subtle)', fontSize: 10.5 }}
                  tickFormatter={(v) =>
                    new Date(v * 1000).toLocaleTimeString(undefined, {
                      // Short windows are all one day → label by time, not a repeated date.
                      ...(intraday
                        ? { hour: 'numeric', minute: '2-digit' }
                        : { month: 'short', day: 'numeric' }),
                    })
                  }
                  minTickGap={50}
                  dy={6}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--ink-subtle)', fontSize: 10.5 }}
                  width={68}
                  domain={[0, 'auto']}
                  tickFormatter={(v) => fmtAdaptivePct(Number(v) / 100)}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    boxShadow: 'var(--shadow-float)',
                    fontSize: 12,
                    color: 'var(--ink)',
                  }}
                  labelFormatter={(v) => fmtTime(Number(v))}
                  formatter={(value) => [
                    fmtAdaptivePct((typeof value === 'number' ? value : Number(value)) / 100),
                    'Cumulative yield',
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="yieldPct"
                  stroke="var(--brand)"
                  strokeWidth={2}
                  fill="url(#yieldFill)"
                />
              </AreaChart>
            </ResponsiveContainer>

            <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info size={13} className="mt-0.5 shrink-0" />
              <span>
                The line is cumulative yield since the first observation ({spanLabel} of history).{' '}
                <span className="font-medium text-brand-text">Realized</span> is the annualized growth
                of Blend&apos;s exchange rate over this window — what actually happened.{' '}
                {showImplied ? (
                  <>
                    <span className="font-medium text-ember-text">Implied</span> is forward-looking: the
                    return the AMM prices in right now, derived from the PT price + time to maturity.
                    A gap between them is the market&apos;s view on where yield is heading.
                  </>
                ) : (
                  <>The market-derived implied APY appears here once the AMM pool has liquidity.</>
                )}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default YieldChart;
