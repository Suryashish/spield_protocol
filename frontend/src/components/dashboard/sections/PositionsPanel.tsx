import { useState } from 'react';
import {
  Coins,
  Layers,
  Loader2,
  Lock,
  RefreshCw,
  Sparkles,
  Unlock,
  Combine,
  ArrowRight,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useProtocol } from '@/context/ProtocolContext';
import { useWallet } from '@/context/WalletContext';
import { useNav } from '@/context/NavContext';
import { useTxAction } from '@/lib/useTxAction';
import { claimYield, combineAndRedeem, redeemPt, type PositionValue } from '@/lib/spield';
import { formatAmount, formatUsd, fromBaseUnits } from '@/lib/soroban';
import { VAULT_DEPLOYED } from '@/lib/config';

/** Whether the protocol-wide maturity has passed (PT redeemable 1:1). */
const isMatured = (maturity: number | null) =>
  maturity != null && Math.floor(Date.now() / 1000) >= maturity;

const PositionRow = ({ pos, matured }: { pos: PositionValue; matured: boolean }) => {
  const { address } = useWallet();
  const { run, busy } = useTxAction();

  const claimable = pos.claimableYield;
  const hasClaim = claimable > 0n;
  const hasPt = pos.ptAmount > 0n;
  const hasBoth = pos.ptAmount > 0n && pos.ytAmount > 0n;

  const onClaim = () => address && run('Claim yield', () => claimYield(address, pos.positionId));
  const onRedeem = () =>
    address &&
    run('Redeem PT', () =>
      redeemPt(address, pos.positionId, String(fromBaseUnits(pos.ptAmount))),
    );
  const onCombine = () => {
    if (!address) return;
    const amt = pos.ptAmount < pos.ytAmount ? pos.ptAmount : pos.ytAmount;
    run('Combine & redeem', () =>
      combineAndRedeem(address, pos.positionId, String(fromBaseUnits(amt))),
    );
  };

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/60 text-foreground">
            <Layers size={16} />
          </div>
          <div>
            <p className="text-sm font-semibold">Position #{pos.positionId}</p>
            <p className="text-xs text-muted-foreground">
              {formatUsd(pos.principal)} principal
            </p>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
            pos.open ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground',
          )}
        >
          {pos.open ? 'Active' : 'Closed'}
        </span>
      </div>

      {/* Token holdings + claimable */}
      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg border border-border/50 bg-card/50 py-2">
          <p className="text-xs font-semibold text-primary">PT</p>
          <p className="mt-0.5 text-sm font-bold tabular-nums">{formatAmount(pos.ptAmount)}</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/50 py-2">
          <p className="text-xs font-semibold text-amber-500">YT</p>
          <p className="mt-0.5 text-sm font-bold tabular-nums">{formatAmount(pos.ytAmount)}</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/50 py-2">
          <p className="text-xs font-semibold text-emerald-500">Yield</p>
          <p
            className={cn(
              'mt-0.5 text-sm font-bold tabular-nums',
              hasClaim ? 'text-emerald-500' : 'text-foreground',
            )}
          >
            {formatAmount(pos.claimableYield, 6)}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={hasClaim ? 'default' : 'outline'}
          disabled={busy || !hasClaim}
          onClick={onClaim}
          className="h-8 flex-1 gap-1.5 text-xs font-semibold"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          Claim
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={busy || !hasBoth}
          onClick={onCombine}
          className="h-8 flex-1 gap-1.5 text-xs font-semibold"
          title="Burn equal PT + YT to redeem principal early (auto-claims yield first)"
        >
          <Combine size={13} />
          Combine
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={busy || !hasPt || !matured}
          onClick={onRedeem}
          className="h-8 flex-1 gap-1.5 text-xs font-semibold"
          title={matured ? 'Redeem PT 1:1 for USDC' : 'Available at maturity'}
        >
          <Unlock size={13} />
          Redeem PT
        </Button>
      </div>
    </div>
  );
};

const PositionsPanel = () => {
  const { isConnected } = useWallet();
  const { navigate } = useNav();
  const { positions, maturity, loading, refreshing, refresh } = useProtocol();
  const [manualRefresh, setManualRefresh] = useState(false);
  const matured = isMatured(maturity);

  const handleRefresh = async () => {
    setManualRefresh(true);
    await refresh();
    setManualRefresh(false);
  };

  return (
    <Card className="overflow-hidden rounded-xl border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold">Your Positions</h3>
          {positions.length > 0 && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              {positions.length}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="text-muted-foreground hover:text-foreground"
          title="Refresh"
        >
          <RefreshCw size={14} className={cn((refreshing || manualRefresh) && 'animate-spin')} />
        </Button>
      </div>

      {/* Clarify scope: this tab is the RAW PT/YT door only. Fixed Vault deposits are held by the
          vault contract (not your wallet), so they never appear here — they live under their own
          tab as receipts. Stated up-front so a vault depositor isn't confused by an empty list. */}
      {VAULT_DEPLOYED && (
        <div className="border-b border-border bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
          This shows your raw <span className="font-semibold text-foreground">PT/YT positions</span>{' '}
          from the Deposit page. Fixed Vault deposits appear under{' '}
          <button
            type="button"
            onClick={() => navigate('vault')}
            className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline"
          >
            Fixed Vault <ArrowRight size={11} />
          </button>{' '}
          as receipts.
        </div>
      )}

      <div className="space-y-3 p-4">
        {!isConnected ? (
          <EmptyState
            icon={<Coins size={22} />}
            title="Connect your wallet"
            body="Connect Freighter to view and manage your PT/YT positions."
          />
        ) : loading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl bg-muted/40" />
            ))}
          </div>
        ) : positions.length === 0 ? (
          <EmptyState
            icon={<Layers size={22} />}
            title="No open positions"
            body="Deposit USDC to mint your first PT + YT position."
            action={
              VAULT_DEPLOYED ? (
                <button
                  type="button"
                  onClick={() => navigate('vault')}
                  className="mt-1 inline-flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  <Lock size={12} className="text-primary" />
                  Deposited in the Fixed Vault? See it under Fixed Vault
                  <ArrowRight size={12} />
                </button>
              ) : undefined
            }
          />
        ) : (
          positions.map((pos) => <PositionRow key={pos.positionId} pos={pos} matured={matured} />)
        )}
      </div>
    </Card>
  );
};

const EmptyState = ({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) => (
  <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-12 text-center">
    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/50 text-muted-foreground">
      {icon}
    </div>
    <p className="text-sm font-semibold">{title}</p>
    <p className="max-w-xs text-xs text-muted-foreground">{body}</p>
    {action}
  </div>
);

export default PositionsPanel;
