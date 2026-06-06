import {
  Wallet2,
  Lock,
  TrendingUp,
  Sparkles,
  Layers,
  CalendarClock,
  type LucideIcon,
} from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useProtocol } from '@/context/ProtocolContext';
import { useWallet } from '@/context/WalletContext';
import { formatUsd, formatAmount } from '@/lib/soroban';

type TileProps = {
  label: string;
  value: string;
  sub?: string;
  accent?: 'default' | 'primary' | 'amber' | 'positive';
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
              : accent === 'amber'
                ? 'bg-amber-500/10 text-amber-500'
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
              accent === 'amber' && 'text-amber-500',
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

/** Days until (or since) maturity, formatted as a short countdown + date. */
const maturityLabel = (maturity: number | null): { value: string; sub: string } => {
  if (!maturity) return { value: '—', sub: 'Maturity not set' };
  const now = Math.floor(Date.now() / 1000);
  const days = Math.ceil((maturity - now) / 86400);
  const date = new Date(maturity * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  if (days > 0) return { value: `${days}d`, sub: `Matures ${date}` };
  return { value: 'Matured', sub: `On ${date}` };
};

/**
 * Deposit summary strip — the at-a-glance header for the Deposit page.
 *
 * Surfaces the six figures a depositor checks before minting: how much USDC is
 * available to deposit, the PT (principal) and YT (yield) they already hold, the
 * principal locked across their positions, any yield ready to claim, and when PT
 * matures — so the panel and the positions list below can stay focused on actions.
 */
const DepositStatsStrip = () => {
  const { isConnected } = useWallet();
  const { balances, totalPrincipal, totalClaimable, maturity, loading } = useProtocol();
  const mat = maturityLabel(maturity);

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      <Tile
        label="USDC Balance"
        value={isConnected ? formatUsd(balances.usdc) : '—'}
        sub={isConnected ? 'Available to deposit' : 'Connect your wallet'}
        icon={Wallet2}
        loading={loading}
      />
      <Tile
        label="PT Held"
        value={isConnected ? formatAmount(balances.pt) : '—'}
        sub="Principal · redeems 1:1"
        accent="primary"
        icon={Lock}
        loading={loading}
      />
      <Tile
        label="YT Held"
        value={isConnected ? formatAmount(balances.yt) : '—'}
        sub="Yield token · variable"
        accent="amber"
        icon={TrendingUp}
        loading={loading}
      />
      <Tile
        label="Principal Locked"
        value={isConnected ? formatUsd(totalPrincipal) : '—'}
        sub={isConnected ? 'Across your positions' : 'Connect your wallet'}
        icon={Layers}
        loading={loading}
      />
      <Tile
        label="Claimable Yield"
        value={isConnected ? formatUsd(totalClaimable, 6) : '—'}
        sub={isConnected ? 'Ready to claim now' : 'Connect your wallet'}
        accent={isConnected && totalClaimable > 0n ? 'positive' : 'default'}
        icon={Sparkles}
        loading={loading}
      />
      <Tile label="Maturity" value={mat.value} sub={mat.sub} icon={CalendarClock} loading={loading} />
    </div>
  );
};

export default DepositStatsStrip;
