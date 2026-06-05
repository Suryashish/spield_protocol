import { TrendingUp, Droplets, Clock, Percent, AlertTriangle } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { useProtocol } from '@/context/ProtocolContext';
import { formatAmount, formatUsd } from '@/lib/soroban';
import { fromScalar12, impliedApyPct, poolValueUsd } from '@/lib/market';
import { MARKET_DEPLOYED } from '@/lib/config';

const fmtMaturity = (unix: number): string =>
  new Date(unix * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

const daysLeft = (unix: number): number =>
  Math.max(0, Math.ceil((unix * 1000 - Date.now()) / (24 * 60 * 60 * 1000)));

/**
 * Markets page header — the headline **implied APY** (the number the whole trading
 * surface exists to discover) plus the live pool snapshot: PT price, liquidity, fee
 * and maturity. All read straight from the Market contract's curve.
 */
const MarketHeader = () => {
  const { marketStats: m, loading } = useProtocol();

  if (!MARKET_DEPLOYED) {
    return (
      <Card className="flex items-start gap-2 rounded-xl border-border/60 bg-muted/40 p-4 text-xs text-muted-foreground">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span>
          The Market AMM isn&apos;t deployed yet. Run <span className="font-mono">scripts/deploy_testnet.sh</span>{' '}
          and paste the printed market address into <span className="font-mono">config.ts</span>.
        </span>
      </Card>
    );
  }

  const apyPct = impliedApyPct(m);
  const ptPrice = m ? fromScalar12(m.ptPrice) : 0;
  const tvl = poolValueUsd(m);
  const hasLiquidity = !!m && (m.ptReserve > 0n || m.usdcReserve > 0n);

  return (
    <Card className="overflow-hidden rounded-xl border-border bg-card shadow-sm">
      <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
        {/* Implied APY — the hero number */}
        <Stat
          className="bg-card"
          icon={<TrendingUp size={15} className="text-emerald-500" />}
          label="Implied APY"
          value={loading ? '—' : hasLiquidity ? `${apyPct.toFixed(2)}%` : '—'}
          valueClass="text-emerald-500"
          hint="Buy PT, redeem at par at maturity"
        />
        {/* PT price */}
        <Stat
          className="bg-card"
          icon={<Percent size={15} className="text-primary" />}
          label="PT Price"
          value={loading || !hasLiquidity ? '—' : `${ptPrice.toFixed(4)}`}
          hint="USDC per PT · → 1.00 at maturity"
        />
        {/* Liquidity */}
        <Stat
          className="bg-card"
          icon={<Droplets size={15} className="text-sky-400" />}
          label="Pool Liquidity"
          value={loading ? '—' : formatUsd(BigInt(Math.round(tvl * 1e7)))}
          hint={
            m
              ? `${formatAmount(m.ptReserve, 2)} PT · ${formatAmount(m.usdcReserve, 2)} USDC`
              : '—'
          }
        />
        {/* Maturity */}
        <Stat
          className="bg-card"
          icon={<Clock size={15} className="text-amber-500" />}
          label="Matures"
          value={m ? fmtMaturity(m.maturity) : '—'}
          hint={m ? `${daysLeft(m.maturity)} days left · ${(m.feeBps / 100).toFixed(2)}% fee` : '—'}
        />
      </div>
    </Card>
  );
};

const Stat = ({
  icon,
  label,
  value,
  hint,
  valueClass,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
  className?: string;
}) => (
  <div className={`p-4 ${className ?? ''}`}>
    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {icon}
      {label}
    </div>
    <div className={`mt-1.5 text-xl font-bold tabular-nums ${valueClass ?? 'text-foreground'}`}>
      {value}
    </div>
    {hint && <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div>}
  </div>
);

export default MarketHeader;
