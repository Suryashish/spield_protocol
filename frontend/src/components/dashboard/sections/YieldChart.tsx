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
import { TrendingUp, Activity, Info } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useProtocol } from '@/context/ProtocolContext';
import { getYieldHistory, sampleYield, type YieldHistory } from '@/lib/yield';

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
  // Re-pull whenever the protocol refreshes (e.g. after a deposit/claim).
  const { refreshing } = useProtocol();
  const [history, setHistory] = useState<YieldHistory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, [refreshing]);

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
  const headlineLabel = apyReliable ? 'Realized APY' : 'Yield so far';
  const headlineValue = apyReliable ? fmtPct(apy) : fmtAdaptivePct(cumulative);

  return (
    <Card className="overflow-hidden rounded-xl border-border bg-card shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between p-5 pb-0">
        <div>
          <CardTitle className="text-base font-semibold">Realized Yield</CardTitle>
          <CardDescription className="text-sm">
            Real on-chain return from Blend, observed over time
          </CardDescription>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
            <TrendingUp size={13} className="text-emerald-500" />
            {headlineLabel}
          </div>
          <div className="text-2xl font-bold tabular-nums text-emerald-500">{headlineValue}</div>
        </div>
      </CardHeader>

      <CardContent className="p-5 pt-3">
        {loading ? (
          <div className="h-64 animate-pulse rounded-lg bg-muted/40" />
        ) : !hasEnough ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/50 text-muted-foreground">
              <Activity size={20} />
            </div>
            <p className="text-sm font-semibold">Building yield history…</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              We have {history?.samples.length ?? 0} rate observation
              {(history?.samples.length ?? 0) === 1 ? '' : 's'} so far. The curve fills in as Blend&apos;s
              rate ticks up — keep the dashboard open, or check back later, to watch it grow.
            </p>
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={264}>
              <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="yieldFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
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
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
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
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  width={68}
                  domain={[0, 'auto']}
                  tickFormatter={(v) => fmtAdaptivePct(Number(v) / 100)}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 12,
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
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#yieldFill)"
                />
              </AreaChart>
            </ResponsiveContainer>

            <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info size={13} className="mt-0.5 shrink-0" />
              <span>
                Cumulative yield since the first observation ({spanLabel} of history).{' '}
                {apyReliable ? (
                  <>
                    APY is the annualized growth of Blend&apos;s exchange rate over this window — the{' '}
                    <span className="font-medium text-foreground">realized</span> return.
                  </>
                ) : (
                  <>
                    We need at least a day of observations before annualizing into an APY, so a short
                    window can&apos;t mislead.
                  </>
                )}{' '}
                Market-derived implied APY arrives with the trading AMM.
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default YieldChart;
