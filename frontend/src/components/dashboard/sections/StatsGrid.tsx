import { Wallet2, TrendingUp, Layers, CalendarClock } from 'lucide-react';

import StatTile from './StatTile';
import { useProtocol } from '@/context/ProtocolContext';
import { useWallet } from '@/context/WalletContext';
import { formatUsd } from '@/lib/soroban';

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
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatTile
        label="USDC Balance"
        value={isConnected ? formatUsd(balances.usdc) : '—'}
        sub={isConnected ? 'Available to deposit' : 'Connect your wallet'}
        tone="usdc"
        icon={Wallet2}
        loading={loading}
      />
      <StatTile
        label="Principal Locked"
        value={isConnected ? formatUsd(totalPrincipal) : '—'}
        sub={isConnected ? 'Across your positions' : 'Connect your wallet'}
        icon={Layers}
        loading={loading}
      />
      <StatTile
        label="Claimable Yield"
        value={isConnected ? formatUsd(totalClaimable, 6) : '—'}
        sub={isConnected ? 'Ready to claim now' : 'Connect your wallet'}
        tone={isConnected && totalClaimable > 0n ? 'positive' : 'default'}
        icon={TrendingUp}
        loading={loading}
      />
      <StatTile label="Maturity" value={mat.value} sub={mat.sub} icon={CalendarClock} loading={loading} />
    </div>
  );
};

export default StatsGrid;
