import { Percent, CalendarClock, Gauge, Wallet2 } from 'lucide-react';

import StatTile from './StatTile';
import { useProtocol } from '@/context/ProtocolContext';
import { useWallet } from '@/context/WalletContext';
import { formatUsd } from '@/lib/soroban';
import { VAULT_DEPLOYED } from '@/lib/config';

const bpsToPct = (bps: number) => (bps / 100).toFixed(2);

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
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatTile
        label="Fixed APR"
        value={VAULT_DEPLOYED ? `${bpsToPct(rateBps)}%` : '—'}
        sub="Locked for the full term"
        tone="brand"
        icon={Percent}
        loading={loading}
      />
      <StatTile
        label="Maturity"
        value={VAULT_DEPLOYED ? mat.value : '—'}
        sub={VAULT_DEPLOYED ? mat.sub : 'Not deployed'}
        icon={CalendarClock}
        loading={loading}
      />
      <StatTile
        label="Capacity Left"
        value={VAULT_DEPLOYED && vaultStats ? formatUsd(vaultStats.couponCapacity) : '—'}
        sub="Available to lock now"
        icon={Gauge}
        loading={loading}
      />
      <StatTile
        label="Your Locked"
        value={isConnected ? formatUsd(yoursTotal) : '—'}
        sub={
          isConnected
            ? `${receipts.length} receipt${receipts.length === 1 ? '' : 's'} at maturity`
            : 'Connect your wallet'
        }
        tone={isConnected && yoursTotal > 0n ? 'positive' : 'default'}
        icon={Wallet2}
        loading={loading}
      />
    </div>
  );
};

export default VaultStatsStrip;
