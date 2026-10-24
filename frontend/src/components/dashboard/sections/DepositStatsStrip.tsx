import { Wallet2, Layers, Sparkles, CalendarClock } from 'lucide-react';

import StatTile from './StatTile';
import { useProtocol } from '@/context/ProtocolContext';
import { useWallet } from '@/context/WalletContext';
import { useSeries } from '@/context/SeriesContext';
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
  const { activeSeries } = useSeries();
  const mat = maturityLabel(maturity ?? activeSeries.expiry);

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatTile
        label="USDC Balance"
        value={isConnected ? formatUsd(balances.usdc) : '—'}
        sub={isConnected ? 'Available to deposit' : 'Connect your wallet'}
        icon={Wallet2}
        loading={loading}
        info="USDC in your connected Stellar wallet available to mint or deposit."
      />
      <StatTile
        label="PT Held"
        value={isConnected ? formatAmount(balances.pt) : '—'}
        sub="Redeems 1:1 at maturity"
        icon={Layers}
        loading={loading}
        info="Principal Tokens held by your wallet. Each PT redeems 1:1 for USDC at maturity."
      />
      <StatTile
        label="YT Held"
        value={isConnected ? formatAmount(balances.yt) : '—'}
        sub="Earns the variable rate"
        icon={Sparkles}
        loading={loading}
        info="Yield Tokens held by your wallet, collecting 100% of variable Blend lending interest."
      />
      <StatTile
        label="Maturity"
        value={mat.value}
        sub={mat.sub}
        icon={CalendarClock}
        loading={loading}
        info="Maturity date for this active series, at which point PT redeems at par."
      />
    </div>
  );
};

export default DepositStatsStrip;
