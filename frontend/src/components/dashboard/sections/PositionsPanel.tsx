import { useState } from 'react';
import {
  Coins,
  Layers,
  Lock,
  RefreshCw,
  Sparkles,
  Unlock,
  ArrowRight,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import EmptyState from './EmptyState';
import { cn } from '@/lib/utils';
import { useProtocol } from '@/context/ProtocolContext';
import { useWallet } from '@/context/WalletContext';
import { useNav } from '@/context/NavContext';
import { type PositionValue } from '@/lib/spield';
import { formatAmount, formatUsd } from '@/lib/soroban';
import { VAULT_DEPLOYED } from '@/lib/config';

/** Whether the protocol-wide maturity has passed (PT redeemable 1:1). */
const isMatured = (maturity: number | null) =>
  maturity != null && Math.floor(Date.now() / 1000) >= maturity;

// No wallet or tx hooks: this row performs no writes any more, it routes to the pages that do.
const PositionRow = ({ pos, matured }: { pos: PositionValue; matured: boolean }) => {
  const { navigate } = useNav();

  const claimable = pos.claimableYield;
  const hasClaim = claimable > 0n;
  const hasPt = pos.ptAmount > 0n;
  const hasBoth = pos.ptAmount > 0n && pos.ytAmount > 0n;


  return (
    <div className="well rounded-xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="well grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground">
            <Layers size={16} />
          </div>
          <div>
            {/* v2 has no position ids — PT and YT are fungible bearer balances, which is exactly
                what makes v1's unpaginated position walk inexpressible here. The context surfaces
                the wallet's whole holding as one synthetic row, so name it for what it is rather
                than showing a meaningless "#0". */}
            <p className="text-[13.5px] font-medium">Your PT + YT position</p>
            <p className="text-xs text-muted-foreground">
              {formatUsd(pos.principal)} principal
            </p>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
            pos.open ? 'border-brand/25 bg-brand/10 text-brand-text' : 'border-border bg-muted text-muted-foreground',
          )}
        >
          {pos.open ? 'Active' : 'Closed'}
        </span>
      </div>

      {/* Token holdings + claimable */}
      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg border border-border bg-card py-2.5">
          <p className="text-xs font-semibold text-brand-text">PT</p>
          <p className="num mt-1 text-[14px] font-medium">{formatAmount(pos.ptAmount)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card py-2.5">
          <p className="text-xs font-semibold text-ember-text">YT</p>
          <p className="num mt-1 text-[14px] font-medium">{formatAmount(pos.ytAmount)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card py-2.5">
          <p className="text-xs font-semibold text-brand-text">Yield</p>
          <p
            className={cn(
              'num mt-1 text-[14px] font-medium',
              hasClaim ? 'text-brand-text' : 'text-foreground',
            )}
          >
            {formatAmount(pos.claimableYield, 6)}
          </p>
        </div>
      </div>

      {/* This panel shows what you hold and points at where each action lives. It carried three
          buttons — Claim, Combine, Redeem PT — and every one of them called a function that a
          dedicated page already exposes with more information. "Combine" and "Redeem PT" were the
          same call twice over: `combineAndRedeem` was a literal alias of `redeemPt`, and the engine
          decides which legs to burn from expiry, not from which button was pressed.
          A position view that also happens to be a control panel is how you end up with three
          buttons for one operation. */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={hasClaim ? 'default' : 'outline'}
          disabled={!hasClaim}
          onClick={() => navigate('v2')}
          className="h-8 flex-1 gap-1.5 text-[12.5px] font-medium"
        >
          <Sparkles size={13} />
          {hasClaim ? 'Claim in Yield' : 'No yield yet'}
        </Button>

        {/* Just "Redeem", and inert until the series matures.
            It read "Combine & redeem" before, which put the word *combine* back in a second place
            and made the button's meaning depend on what the wallet happened to hold. A position row
            should state one thing: this redeems at maturity. The early exit still exists — it is
            the Combine tab on the Deposit card — and the disabled tooltip says so, so nothing is
            hidden, it is just not competing for attention here. */}
        <Button
          size="sm"
          variant="outline"
          disabled={!matured || !hasPt}
          onClick={() => navigate('deposit')}
          className="h-8 flex-1 gap-1.5 text-[12.5px] font-medium"
          title={
            matured
              ? 'Redeem PT for its face value in USDC'
              : hasBoth
                ? 'Available at maturity. To exit early, use Combine on the Deposit card — it burns equal PT + YT and pays face.'
                : 'Available at maturity. To exit early, sell your PT on the market.'
          }
        >
          <Unlock size={13} />
          {matured ? 'Redeem' : 'Redeem at maturity'}
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
    <Card className="flex h-full flex-col gap-0 overflow-hidden rounded-xl py-0">
      <div className="flex items-start justify-between border-b border-border px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-[15px] font-medium tracking-[-0.015em]">Your Positions</h3>
            {positions.length > 0 && (
              <span className="num rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {positions.length}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Manage your tranches — claim yield, redeem principal, or exit early.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="-mr-1 shrink-0 text-muted-foreground hover:text-foreground"
          title="Refresh"
        >
          <RefreshCw size={14} className={cn((refreshing || manualRefresh) && 'animate-spin')} />
        </Button>
      </div>

      {/* Clarify scope: this list is the RAW PT/YT door only. Fixed Vault deposits are held by the
          vault contract (not your wallet), so they never appear here — they live under their own
          tab as receipts. Stated up-front so a vault depositor isn't confused by an empty list. */}
      {VAULT_DEPLOYED && (
        <div className="border-b border-border bg-accent/40 px-5 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
          These are your raw <span className="font-semibold text-foreground">PT/YT positions</span>{' '}
          from depositing above. Fixed Vault deposits appear under{' '}
          <button
            type="button"
            onClick={() => navigate('vault')}
            className="inline-flex items-center gap-0.5 font-semibold text-brand-text hover:underline"
          >
            Fixed Vault <ArrowRight size={11} />
          </button>{' '}
          as receipts.
        </div>
      )}

      {/* Scrollable list: `flex-1` fills the card when it's short (matching the Deposit
          panel's height via the row's items-stretch), while `max-h` caps it so a long list
          scrolls in place instead of stretching the whole section taller. */}
      <div className="flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto p-5 lg:max-h-128">
        {!isConnected ? (
          <EmptySlot
            icon={Coins}
            title="Connect your wallet"
            body="Connect Freighter to view and manage your PT/YT positions."
          />
        ) : loading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : positions.length === 0 ? (
          <EmptySlot
            icon={Layers}
            title="No open positions"
            body="Deposit USDC to mint your first PT + YT position."
            action={
              VAULT_DEPLOYED ? (
                <button
                  type="button"
                  onClick={() => navigate('vault')}
                  className="mt-1 inline-flex items-center gap-1 well rounded-lg px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-brand/40 hover:bg-brand/5"
                >
                  <Lock size={12} className="text-brand-text" />
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

/** The shared empty state, in the dashed frame this list uses for its slot. */
const EmptySlot = (props: React.ComponentProps<typeof EmptyState>) => (
  <div className="flex flex-1 flex-col justify-center rounded-xl border border-dashed border-border">
    <EmptyState {...props} />
  </div>
);

export default PositionsPanel;
