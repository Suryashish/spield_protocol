import { AlertTriangle, Droplets, ShieldCheck, Wallet } from 'lucide-react';

import EmptyState from './EmptyState';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useWallet } from '@/context/WalletContext';
import { useProtocol } from '@/context/ProtocolContext';
import { formatAmount, formatUsd, fromBaseUnits } from '@/lib/soroban';
import { poolValueUsd, fromScalar12 } from '@/lib/market';
import { MARKET_DEPLOYED } from '@/lib/config';

const usdFromHuman = (v: number) => BigInt(Math.round(v * 1e7));

/**
 * Your Liquidity — the companion card beside the add/remove panel.
 *
 * Surfaces the connected wallet's LP position in full: shares held, the PT + USDC those
 * shares currently redeem for, the position's value in USDC terms, and a composition bar
 * showing the PT:USDC split. Keeps the action panel focused on the add/remove flow while
 * still giving the LP a clear, always-visible read on what they hold.
 */
const LpPositionPanel = () => {
  const { isConnected } = useWallet();
  const { marketStats: m, lpPosition: lp, loading } = useProtocol();

  const hasPosition = !!lp && lp.shares > 0n;

  // PT and USDC legs in USDC terms, for the value + composition bar.
  const ptPrice = m ? fromScalar12(m.ptPrice) : 1;
  const ptLegUsd = lp ? fromBaseUnits(lp.ptClaim) * (ptPrice || 1) : 0;
  const usdcLegUsd = lp ? fromBaseUnits(lp.usdcClaim) : 0;
  const totalUsd =
    lp && m ? poolValueUsd({ ...m, ptReserve: lp.ptClaim, usdcReserve: lp.usdcClaim }) : 0;
  const ptPctOfPool = totalUsd > 0 ? Math.round((ptLegUsd / (ptLegUsd + usdcLegUsd)) * 100) : 50;

  const body = () => {
    if (!MARKET_DEPLOYED) {
      return (
        <Empty
          icon={AlertTriangle}
          title="Market not deployed"
          body="The PT/USDC pool isn't live yet. Once deployed, your liquidity position shows here."
        />
      );
    }
    if (!isConnected) {
      return (
        <Empty
          icon={Wallet}
          title="Connect your wallet"
          body="Connect Freighter to see the liquidity you've supplied to the pool."
        />
      );
    }
    if (loading) {
      return <div className="h-40 flex-1 animate-pulse rounded-xl bg-muted" />;
    }
    if (!hasPosition) {
      return (
        <Empty
          icon={Droplets}
          title="No liquidity yet"
          body="Add PT + USDC in the panel to start earning the swap fee on every trade."
        />
      );
    }

    return (
      <div className="space-y-4">
        {/* Headline value */}
        <div className="well rounded-xl p-4">
          <p className="eyebrow">
            Position value
          </p>
          <p className="num mt-1 font-display text-[24px] font-medium tracking-[-0.02em]">{formatUsd(usdFromHuman(totalUsd))}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatAmount(lp!.shares, 2)} LP shares
          </p>
        </div>

        {/* Composition bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="text-brand-text">PT · {formatAmount(lp!.ptClaim, 2)}</span>
            <span className="text-usdc-text">USDC · {formatUsd(lp!.usdcClaim)}</span>
          </div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
            <div className="bg-primary" style={{ width: `${ptPctOfPool}%` }} />
            <div className="bg-usdc" style={{ width: `${100 - ptPctOfPool}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            Your share of the pool, split {ptPctOfPool}% PT / {100 - ptPctOfPool}% USDC at the live
            price.
          </p>
        </div>

        {/* IL reassurance — the pool's main selling point */}
        <div className="flex items-start gap-2 rounded-lg border border-usdc/20 bg-usdc/5 p-3 text-xs text-muted-foreground">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-usdc-text" />
          <span>
            Hold to maturity and PT marches to par along the time-decay curve, so you get principal
            + accrued fees back with <span className="font-semibold text-foreground">~no impermanent loss</span>.
          </span>
        </div>
      </div>
    );
  };

  return (
    <Card className="flex h-full flex-col rounded-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Droplets size={16} className="text-usdc-text" />
          Your Liquidity
        </CardTitle>
        <CardDescription>
          What your LP shares hold and redeem for right now.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">{body()}</CardContent>
    </Card>
  );
};

/** The shared empty state, in the dashed frame this panel uses for its slot. */
const Empty = (props: React.ComponentProps<typeof EmptyState>) => (
  <div className="flex flex-1 flex-col justify-center rounded-xl border border-dashed border-border">
    <EmptyState {...props} />
  </div>
);

export default LpPositionPanel;
