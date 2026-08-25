import { Wallet2, Layers, Sparkles, CalendarClock } from 'lucide-react';

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
 * Four tiles, not six. It carried "Principal Locked" and "Claimable Yield" as well, which repeated
 * the Overview and Yield pages **verbatim** — same label, same figure, same source. A number shown
 * in three places is not three times as useful; it is one number and two chances to wonder whether
 * they disagree.
 *
 * What is left is what a depositor actually checks before minting: how much USDC they can spend,
 * what they already hold on each leg, and when the series matures.
 */
const DepositStatsStrip = () => {
  const { isConnected } = useWallet();
  const { balances, maturity, loading } = useProtocol();
  const mat = maturityLabel(maturity);

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatTile
        label="USDC Balance"
        value={isConnected ? formatUsd(balances.usdc) : '—'}
        sub={isConnected ? 'Available to deposit' : 'Connect your wallet'}
        icon={Wallet2}
        loading={loading}
      />
      <StatTile
        label="PT Held"
        value={isConnected ? formatAmount(balances.pt) : '—'}
        sub="Redeems 1:1 at maturity"
        icon={Layers}
        loading={loading}
      />
      <StatTile
        label="YT Held"
        value={isConnected ? formatAmount(balances.yt) : '—'}
        sub="Earns the variable rate"
        icon={Sparkles}
        loading={loading}
      />
      <StatTile
        label="Maturity"
        value={mat.value}
        sub={mat.sub}
        icon={CalendarClock}
        loading={loading}
      />
    </div>
  );
};

export default DepositStatsStrip;
