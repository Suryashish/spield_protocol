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
import { TrendingUp, Activity, Info, Percent, Droplets, Clock, AlertTriangle } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import EmptyState from './EmptyState';
import { cn } from '@/lib/utils';
import { useProtocol } from '@/context/ProtocolContext';
import { getMarketHistory, type MarketHistory } from '@/lib/marketHistory';
import { fromScalar12, impliedApyPct, poolValueUsd } from '@/lib/market';
import { formatAmount, formatUsd } from '@/lib/soroban';
import { MARKET_DEPLOYED } from '@/lib/config';

type Series = 'price' | 'apy';

const fmtTime = (unix: number): string =>
  new Date(unix * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const fmtMaturity = (unix: number): string =>
  new Date(unix * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

const daysLeft = (unix: number): number =>
  Math.max(0, Math.ceil((unix * 1000 - Date.now()) / (24 * 60 * 60 * 1000)));

/** Grow decimal places until a tiny percentage is visible (early testnet APYs are small). */
const fmtAdaptivePct = (frac: number | null): string => {
  if (frac == null) return '—';
  const pct = frac * 100;
  if (pct === 0) return '0%';
  for (let digits = 2; digits <= 6; digits++) {
    if (Number(pct.toFixed(digits)) !== 0) return `${pct.toFixed(digits)}%`;
  }
  return '<0.000001%';
};

/**
 * Market chart — live PT price (and implied APY) over time, the dynamic rate the time-decay AMM
 * discovers. Every point is a value the chain reported: the pool mid (`pt_price`) sampled each load
 * + executed prices reconstructed from `Swap` events, persisted in localStorage so the series grows.
 *
 * The chart card also folds in the key market stats (implied APY, PT price, liquidity, maturity), so
 * the Markets page leads with one prominent visual instead of a separate stat strip.
 */
const MarketChart = () => {
  const { lastUpdated, marketStats: m } = useProtocol();
  const [history, setHistory] = useState<MarketHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [series, setSeries] = useState<Series>('price');

  useEffect(() => {
    if (!lastUpdated) return;
    let cancelled = false;
    // Legitimate data-fetch effect; the terminal state is set in the async callbacks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getMarketHistory(
      Math.floor(Date.now() / 1000),
      m ? { ptPrice: m.ptPrice, impliedApy: m.impliedApy } : null,
    )
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
    // Re-pull once after a completed protocol refresh so a fresh point lands.
  }, [lastUpdated, m]);

  const { data, spanLabel, intraday, hasEnough } = useMemo(() => {
    const samples = history?.samples ?? [];
    // The APY series only uses live curve reads (swap-derived rows carry no APY).
    const rows =
      series === 'apy' ? samples.filter((s) => s.impliedApy > 0n) : samples;
    if (rows.length < 2) {
      return { data: [], spanLabel: '', intraday: false, hasEnough: false };
    }
    const data = rows.map((s) => ({
      t: s.t,
      v: series === 'apy' ? fromScalar12(s.impliedApy) * 100 : fromScalar12(s.ptPrice),
    }));
    const secs = rows[rows.length - 1].t - rows[0].t;
    const hours = secs / 3600;
    const spanLabel =
      hours >= 48
        ? `${(hours / 24).toFixed(1)} days`
        : hours >= 1
          ? `${hours.toFixed(1)} hours`
          : `${Math.round(hours * 60)} min`;
    return { data, spanLabel, intraday: secs < 36 * 3600, hasEnough: true };
  }, [history, series]);

  if (!MARKET_DEPLOYED) {
    return (
      <Card className="flex items-start gap-2 well rounded-xl p-4 text-xs text-muted-foreground">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span>
          The Market AMM isn&apos;t deployed yet. Run{' '}
          <span className="font-mono">scripts/deploy_testnet.sh</span> and paste the printed market
          address into <span className="font-mono">config.ts</span>.
        </span>
      </Card>
    );
  }

  const apyPct = impliedApyPct(m);
  const ptPrice = m ? fromScalar12(m.ptPrice) : 0;
  const tvl = poolValueUsd(m);
  const hasLiquidity = !!m && (m.ptReserve > 0n || m.usdcReserve > 0n);
  // The market's forward rate is the ember — the same hue the landing
  // page's rate drifts in before it locks. Realized/PT price is the green.
  const accent = series === 'apy' ? 'var(--ember)' : 'var(--brand)';

  return (
    <Card className="overflow-hidden rounded-xl">
      <CardHeader className="p-4 pb-2 sm:p-5">
        <CardTitle>Market — PT Price &amp; Rate</CardTitle>
        <CardDescription>
          Live price discovery on the time-decay curve
        </CardDescription>
        {/* Folded-in stats strip (replaces the old MarketHeader) — a 2×2 / 4-across grid under the
            title so it stays readable in the narrower column beside the trade panel. */}
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 well rounded-lg p-3 sm:grid-cols-4">
          <Stat
            icon={<TrendingUp size={13} className="text-ember-text" />}
            label="Implied APY"
            value={loading ? '—' : hasLiquidity && apyPct > 0 ? `${apyPct.toFixed(2)}%` : '—'}
            valueClass="text-ember-text"
          />
          <Stat
            icon={<Percent size={13} className="text-brand-text" />}
            label="PT Price"
            value={loading || !hasLiquidity ? '—' : ptPrice.toFixed(4)}
            valueClass="text-brand-text"
          />
          <Stat
            icon={<Droplets size={13} className="text-usdc-text" />}
            label="Liquidity"
            value={loading ? '—' : formatUsd(BigInt(Math.round(tvl * 1e7)))}
            hint={m ? `${formatAmount(m.ptReserve, 1)} PT · ${formatAmount(m.usdcReserve, 1)} USDC` : undefined}
          />
          <Stat
            icon={<Clock size={13} className="text-ember-text" />}
            label="Matures"
            value={m ? fmtMaturity(m.maturity) : '—'}
            hint={m ? `${daysLeft(m.maturity)}d · ${(m.feeBps / 100).toFixed(2)}% fee` : undefined}
          />
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-1 sm:p-5">
        {/* Series toggle */}
        <div className="mb-3 grid w-fit grid-cols-2 gap-1 well rounded-lg p-1 text-xs font-semibold">
          {(['price', 'apy'] as Series[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSeries(s)}
              className={cn(
                'rounded-md px-3 py-1 transition-all',
                series === s
                  ? 'border border-border bg-card text-foreground shadow-float-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {s === 'price' ? 'PT Price' : 'Implied APY'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="h-64 animate-pulse rounded-xl bg-muted" />
        ) : !hasEnough ? (
          <EmptyState
            className="h-64"
            icon={Activity}
            title="Building price history…"
            body={
              series === 'apy'
                ? 'The implied-APY line fills in as the pool is read over time — keep the dashboard open, or check back later.'
                : 'The price line fills in from trades and live reads — make a swap, or check back later, to watch it move.'
            }
          />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={264}>
              <AreaChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="marketFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={accent} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={accent} stopOpacity={0} />
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
                  width={64}
                  domain={series === 'apy' ? [0, 'auto'] : ['auto', 'auto']}
                  tickFormatter={(v) =>
                    series === 'apy' ? fmtAdaptivePct(Number(v) / 100) : Number(v).toFixed(4)
                  }
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
                  formatter={(value) => {
                    const n = typeof value === 'number' ? value : Number(value);
                    return series === 'apy'
                      ? [fmtAdaptivePct(n / 100), 'Implied APY']
                      : [`${n.toFixed(4)} USDC`, 'PT Price'];
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={accent}
                  strokeWidth={2}
                  fill="url(#marketFill)"
                />
              </AreaChart>
            </ResponsiveContainer>

            <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info size={13} className="mt-0.5 shrink-0" />
              <span>
                {series === 'price' ? (
                  <>
                    PT price (USDC per PT) over {spanLabel} of observations — the pool mid, drifting
                    toward <span className="font-medium text-foreground">1.00 (par)</span> as maturity
                    nears. The discount below par is the fixed yield a buyer locks in.
                  </>
                ) : (
                  <>
                    The forward implied APY the curve prices in, over {spanLabel} of observations —
                    derived from the PT price + time to maturity.
                  </>
                )}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

const Stat = ({
  icon,
  label,
  value,
  hint,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
}) => (
  <div className="min-w-0">
    <div className="flex items-center gap-1.5 eyebrow">
      {icon}
      {label}
    </div>
    <div
    className={cn(
      'num mt-1 font-display text-[16px] font-medium tracking-[-0.015em]',
      // a dash is 'nothing to read yet', so it never takes the series colour
      value === '—' ? 'text-subtle' : (valueClass ?? 'text-foreground'),
    )}
  >
      {value}
    </div>
    {hint && <div className="truncate text-[10px] text-muted-foreground">{hint}</div>}
  </div>
);

export default MarketChart;
