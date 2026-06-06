import { Droplets, Percent, Wallet2, TrendingUp, type LucideIcon } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useProtocol } from '@/context/ProtocolContext';
import { useWallet } from '@/context/WalletContext';
import { formatUsd } from '@/lib/soroban';
import { poolValueUsd, impliedApyPct } from '@/lib/market';
import { MARKET_DEPLOYED } from '@/lib/config';

/** USDC bigint (7dp) from a human USD number, for reusing formatUsd on derived values. */
const usdFromHuman = (v: number) => BigInt(Math.round(v * 1e7));

type TileProps = {
  label: string;
  value: string;
  sub?: string;
  accent?: 'default' | 'primary' | 'sky' | 'positive';
  icon: LucideIcon;
  loading?: boolean;
};

const Tile = ({ label, value, sub, accent = 'default', icon: Icon, loading }: TileProps) => (
  <Card className="rounded-xl border-border bg-card shadow-sm">
    <CardContent className="p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-xs">
          {label}
        </span>
        <div
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg sm:h-8 sm:w-8',
            accent === 'primary'
              ? 'bg-primary/10 text-primary'
              : accent === 'sky'
                ? 'bg-sky-500/10 text-sky-400'
                : 'bg-accent/50 text-muted-foreground',
          )}
        >
          <Icon size={15} />
        </div>
      </div>
      <div className="mt-2 flex items-baseline gap-2 sm:mt-3">
        {loading ? (
          <span className="h-7 w-20 animate-pulse rounded bg-muted" />
        ) : (
          <span
            className={cn(
              'text-xl font-bold tracking-tight sm:text-2xl',
              accent === 'primary' && 'text-primary',
              accent === 'sky' && 'text-sky-400',
              accent === 'positive' && 'text-emerald-500',
            )}
          >
            {value}
          </span>
        )}
      </div>
      {sub && !loading && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </CardContent>
  </Card>
);

/**
 * Liquidity summary strip — the at-a-glance header for the Liquidity page.
 *
 * Mirrors the Vault / Deposit strips: surfaces the four figures an LP weighs before
 * supplying — the pool's total value, the swap fee they'll earn, the value of their
 * own position, and the curve's implied APY — so the add/remove panel and the position
 * card below can stay focused on actions.
 */
const LpStatsStrip = () => {
  const { isConnected } = useWallet();
  const { marketStats: m, lpPosition, loading } = useProtocol();

  const tvl = poolValueUsd(m);
  const apyPct = impliedApyPct(m);
  const hasLiquidity = !!m && (m.ptReserve > 0n || m.usdcReserve > 0n);

  // The LP's own position value in USDC terms (PT claim × price + USDC claim).
  const yourValue =
    lpPosition && m
      ? poolValueUsd({ ...m, ptReserve: lpPosition.ptClaim, usdcReserve: lpPosition.usdcClaim })
      : 0;
  const hasPosition = !!lpPosition && lpPosition.shares > 0n;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Tile
        label="Pool TVL"
        value={MARKET_DEPLOYED && hasLiquidity ? formatUsd(usdFromHuman(tvl)) : '—'}
        sub="PT + USDC reserves"
        accent="sky"
        icon={Droplets}
        loading={loading}
      />
      <Tile
        label="Swap Fee"
        value={MARKET_DEPLOYED && m ? `${(m.feeBps / 100).toFixed(2)}%` : '—'}
        sub="Earned by LPs per trade"
        icon={Percent}
        loading={loading}
      />
      <Tile
        label="Your Liquidity"
        value={isConnected && hasPosition ? formatUsd(usdFromHuman(yourValue)) : '—'}
        sub={isConnected ? (hasPosition ? 'Value of your shares' : 'No position yet') : 'Connect your wallet'}
        accent={isConnected && hasPosition ? 'positive' : 'default'}
        icon={Wallet2}
        loading={loading}
      />
      <Tile
        label="Implied APY"
        value={MARKET_DEPLOYED && hasLiquidity && apyPct > 0 ? `${apyPct.toFixed(2)}%` : '—'}
        sub="From the time-decay curve"
        accent="primary"
        icon={TrendingUp}
        loading={loading}
      />
    </div>
  );
};

export default LpStatsStrip;
