import {
  Wallet2,
  Lock,
  TrendingUp,
  Sparkles,
  Layers,
  CalendarClock,
} from 'lucide-react';

import StatTile from './StatTile';
import { useProtocol } from '@/context/ProtocolContext';
import { useWallet } from '@/context/WalletContext';
import { formatUsd, formatAmount } from '@/lib/soroban';

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
      <StatTile
        label="USDC Balance"
        value={isConnected ? formatUsd(balances.usdc) : '—'}
        sub={isConnected ? 'Available to deposit' : 'Connect your wallet'}
        tone="usdc"
        icon={Wallet2}
        loading={loading}
      />
      <StatTile
        label="PT Held"
        value={isConnected ? formatAmount(balances.pt) : '—'}
        sub="Principal · redeems 1:1"
        tone="brand"
        icon={Lock}
        loading={loading}
      />
      <StatTile
        label="YT Held"
        value={isConnected ? formatAmount(balances.yt) : '—'}
        sub="Yield token · variable"
        tone="ember"
        icon={TrendingUp}
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
        icon={Sparkles}
        loading={loading}
      />
      <StatTile label="Maturity" value={mat.value} sub={mat.sub} icon={CalendarClock} loading={loading} />
    </div>
  );
};

export default DepositStatsStrip;
