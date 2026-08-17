import { Droplets, Percent, Wallet2, TrendingUp } from 'lucide-react';

import StatTile from './StatTile';
import { useProtocol } from '@/context/ProtocolContext';
import { useWallet } from '@/context/WalletContext';
import { formatUsd } from '@/lib/soroban';
import { poolValueUsd, impliedApyPct } from '@/lib/market';
import { MARKET_DEPLOYED } from '@/lib/config';

/** USDC bigint (7dp) from a human USD number, for reusing formatUsd on derived values. */
const usdFromHuman = (v: number) => BigInt(Math.round(v * 1e7));

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
      <StatTile
        label="Pool TVL"
        value={MARKET_DEPLOYED && hasLiquidity ? formatUsd(usdFromHuman(tvl)) : '—'}
        sub="PT + USDC reserves"
        tone="usdc"
        icon={Droplets}
        loading={loading}
      />
      <StatTile
        label="Swap Fee"
        value={MARKET_DEPLOYED && m ? `${(m.feeBps / 100).toFixed(2)}%` : '—'}
        sub="Earned by LPs per trade"
        icon={Percent}
        loading={loading}
      />
      <StatTile
        label="Your Liquidity"
        value={isConnected && hasPosition ? formatUsd(usdFromHuman(yourValue)) : '—'}
        sub={isConnected ? (hasPosition ? 'Value of your shares' : 'No position yet') : 'Connect your wallet'}
        tone={isConnected && hasPosition ? 'positive' : 'default'}
        icon={Wallet2}
        loading={loading}
      />
      <StatTile
        label="Implied APY"
        value={MARKET_DEPLOYED && hasLiquidity && apyPct > 0 ? `${apyPct.toFixed(2)}%` : '—'}
        sub="From the time-decay curve"
        tone="ember"
        icon={TrendingUp}
        loading={loading}
      />
    </div>
  );
};

export default LpStatsStrip;
