import { Percent, CalendarClock, Gauge, Wallet2, type LucideIcon } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useProtocol } from '@/context/ProtocolContext';
import { useWallet } from '@/context/WalletContext';
import { formatUsd } from '@/lib/soroban';
import { VAULT_DEPLOYED } from '@/lib/config';

const bpsToPct = (bps: number) => (bps / 100).toFixed(2);

type TileProps = {
  label: string;
  value: string;
  sub?: string;
  accent?: 'default' | 'primary' | 'positive';
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
 * Vault summary strip — the at-a-glance header for the Fixed-Rate Vault page.
 *
 * Surfaces the four numbers a depositor cares about before doing anything: the live
 * fixed APR, the maturity countdown, how much coupon capacity the vault has left, and
 * the wallet's own locked total. Keeping these here lets the deposit panel and receipts
 * list stay focused on actions rather than repeating vault health figures.
 */
const VaultStatsStrip = () => {
  const { isConnected } = useWallet();
  const { vaultStats, receipts, loading } = useProtocol();

  const mat = maturityLabel(vaultStats?.maturity ?? null);
  const yoursTotal = receipts.reduce((sum, r) => sum + r.payout, 0n);
  const rateBps = vaultStats?.rateBps ?? 0;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Tile
        label="Fixed APR"
        value={VAULT_DEPLOYED ? `${bpsToPct(rateBps)}%` : '—'}
        sub="Locked for the full term"
        accent="primary"
        icon={Percent}
        loading={loading}
      />
      <Tile
        label="Maturity"
        value={VAULT_DEPLOYED ? mat.value : '—'}
        sub={VAULT_DEPLOYED ? mat.sub : 'Not deployed'}
        icon={CalendarClock}
        loading={loading}
      />
      <Tile
        label="Capacity Left"
        value={VAULT_DEPLOYED && vaultStats ? formatUsd(vaultStats.couponCapacity) : '—'}
        sub="Available to lock now"
        icon={Gauge}
        loading={loading}
      />
      <Tile
        label="Your Locked"
        value={isConnected ? formatUsd(yoursTotal) : '—'}
        sub={
          isConnected
            ? `${receipts.length} receipt${receipts.length === 1 ? '' : 's'} at maturity`
            : 'Connect your wallet'
        }
        accent={isConnected && yoursTotal > 0n ? 'positive' : 'default'}
        icon={Wallet2}
        loading={loading}
      />
    </div>
  );
};

export default VaultStatsStrip;
