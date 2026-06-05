import { Wallet2, TrendingUp, Layers, CalendarClock, type LucideIcon } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useProtocol } from '@/context/ProtocolContext';
import { useWallet } from '@/context/WalletContext';
import { formatUsd } from '@/lib/soroban';

type StatCardProps = {
  label: string;
  value: string;
  sub?: string;
  accent?: 'default' | 'positive';
  icon: LucideIcon;
  loading?: boolean;
};

const StatCard = ({ label, value, sub, accent = 'default', icon: Icon, loading }: StatCardProps) => (
  <Card className="rounded-xl border-border bg-card shadow-sm">
    <CardContent className="p-4">
      <div className="flex items-start justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/50 text-muted-foreground">
          <Icon size={15} />
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        {loading ? (
          <span className="h-7 w-24 animate-pulse rounded bg-muted" />
        ) : (
          <span
            className={cn(
              'text-2xl font-bold tracking-tight',
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

/** Days until (or since) maturity, formatted. */
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

const StatsGrid = () => {
  const { isConnected } = useWallet();
  const { balances, totalPrincipal, totalClaimable, maturity, loading } = useProtocol();
  const mat = maturityLabel(maturity);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="USDC Balance"
        value={isConnected ? formatUsd(balances.usdc) : '—'}
        sub={isConnected ? 'Available to deposit' : 'Connect your wallet'}
        icon={Wallet2}
        loading={loading}
      />
      <StatCard
        label="Principal Locked"
        value={isConnected ? formatUsd(totalPrincipal) : '—'}
        sub={isConnected ? 'Across your positions' : 'Connect your wallet'}
        icon={Layers}
        loading={loading}
      />
      <StatCard
        label="Claimable Yield"
        value={isConnected ? formatUsd(totalClaimable, 6) : '—'}
        sub={isConnected ? 'Ready to claim now' : 'Connect your wallet'}
        accent={isConnected && totalClaimable > 0n ? 'positive' : 'default'}
        icon={TrendingUp}
        loading={loading}
      />
      <StatCard label="Maturity" value={mat.value} sub={mat.sub} icon={CalendarClock} loading={loading} />
    </div>
  );
};

export default StatsGrid;
