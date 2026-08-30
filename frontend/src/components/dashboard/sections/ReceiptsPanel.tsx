import { useEffect, useMemo, useState } from 'react';
import { Loader2, Lock, ShieldCheck, Sprout, Clock, CheckCircle2 } from 'lucide-react';

import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useWallet } from '@/context/WalletContext';
import { useProtocol } from '@/context/ProtocolContext';
import { useTxAction } from '@/lib/useTxAction';
import { type Receipt } from '@/lib/vault';
import { harvest, redeem, redeemRemaining } from '@/lib/v2adapters';
import { formatUsd } from '@/lib/soroban';
import { VAULT_DEPLOYED } from '@/lib/config';

const bpsToPct = (bps: number) => (bps / 100).toFixed(2);

const fmtDate = (unix: number): string =>
  new Date(unix * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

/** Human-friendly "time until maturity" relative to `now` (both unix seconds). */
const fmtRelative = (maturity: number, now: number): string => {
  const secs = maturity - now;
  if (secs <= 0) return 'matured';
  const days = Math.floor(secs / 86_400);
  if (days >= 1) return `in ${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.floor(secs / 3_600);
  if (hours >= 1) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const mins = Math.max(1, Math.floor(secs / 60));
  return `in ${mins} min${mins === 1 ? '' : 's'}`;
};

const nowSecs = () => Math.floor(Date.now() / 1000);

/**
 * A clock that re-renders the panel each second so `matured` flips live and the relative
 * "in N days/hours" countdown stays fresh — without this, a position that matures while the
 * user watches would stay disabled until some other refresh re-rendered the tree.
 */
const useNowSecs = (): number => {
  const [now, setNow] = useState(nowSecs);
  useEffect(() => {
    const t = setInterval(() => setNow(nowSecs()), 1_000);
    return () => clearInterval(t);
  }, []);
  return now;
};

const ReceiptRow = ({
  receipt,
  now,
  address,
}: {
  receipt: Receipt;
  now: number;
  address: string | null;
}) => {
  const { run, busy } = useTxAction();
  const matured = now >= receipt.maturity;
  const coupon = receipt.payout - receipt.principal;

  // Optimistic redeem lifecycle so the row visibly transitions instead of abruptly vanishing
  // when the post-redeem refresh drops it: idle → redeeming (during the tx) → redeemed (on
  // success, until refresh removes the row). On failure we fall back to idle and the toast
  // (from useTxAction) carries the error.
  //
  // `partial` is the fourth outcome, and the one that needs explaining to a user. A redeem is
  // resumable: if the lending venue is short on cash it collects what it can, banks the progress
  // against the receipt, and returns WITHOUT paying out. The transaction succeeded, the money is
  // safe and reserved — but less arrived than expected, and without this the user would have no
  // idea why.
  const [phase, setPhase] = useState<'idle' | 'redeeming' | 'redeemed' | 'partial'>('idle');
  const [stillOwed, setStillOwed] = useState<bigint>(0n);

  // A receipt can arrive already part-collected, from a previous session.
  const carriedOver = receipt.collected > 0n ? receipt.payout - receipt.collected : 0n;
  const outstanding = stillOwed > 0n ? stillOwed : carriedOver;
  const isPartial = phase === 'partial' || (phase === 'idle' && carriedOver > 0n);
  const collectedSoFar = receipt.payout - outstanding;

  const handleRedeem = async () => {
    if (!address) return;
    setPhase('redeeming');
    const ok = await run('Redeem', () => redeem(address, receipt.receiptId));
    if (!ok) {
      setPhase('idle');
      return;
    }
    // The transaction succeeded — but did it finish? Ask the contract rather than assuming.
    const remaining = await redeemRemaining(receipt.receiptId);
    setStillOwed(remaining);
    setPhase(remaining > 0n ? 'partial' : 'redeemed');
  };

  const redeemTitle = !address
    ? 'Connect your wallet to redeem'
    : !matured
      ? `Matures ${fmtRelative(receipt.maturity, now)} · ${fmtDate(receipt.maturity)}`
      : isPartial
        ? 'Collect the rest of this payout'
        : 'Redeem this matured receipt for its full fixed payout';

  return (
    <div
      className={cn(
        'flex flex-col gap-3 well rounded-lg p-3 transition-opacity sm:flex-row sm:items-center sm:justify-between',
        phase === 'redeemed' && 'opacity-50',
        isPartial && 'ring-1 ring-amber-500/40',
      )}
    >
      <div className="flex items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand-text">
          <Lock size={16} />
        </div>
        <div className="space-y-0.5">
          <div className="num text-[13.5px] font-medium">
            {formatUsd(receipt.payout)}{' '}
            <span className="text-xs font-medium text-muted-foreground">at maturity</span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>#{receipt.receiptId}</span>
            <span>{formatUsd(receipt.principal)} principal</span>
            <span className="text-brand-text">+{formatUsd(coupon)} coupon</span>
            <span>{bpsToPct(receipt.rateBps)}% fixed</span>
          </div>
          {isPartial && (
            <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-amber-600 dark:text-amber-500">
              <span className="font-medium">Partly withdrawn.</span> We could only collect{' '}
              {formatUsd(collectedSoFar)} of {formatUsd(receipt.payout)} right now — the lending pool
              is short on available cash. The rest is safe and reserved for you. Redeem again later
              to collect the remaining {formatUsd(outstanding)}.
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock size={12} />
          {phase === 'redeemed'
            ? 'Redeemed'
            : isPartial
              ? 'Partly withdrawn'
              : matured
                ? 'Matured'
                : fmtRelative(receipt.maturity, now)}
        </span>
        <Button
          size="sm"
          disabled={busy || !matured || !address || phase === 'redeeming' || phase === 'redeemed'}
          onClick={handleRedeem}
          className="h-8 gap-1.5 text-xs font-semibold"
          title={redeemTitle}
        >
          {phase === 'redeeming' ? (
            <Loader2 size={13} className="animate-spin" />
          ) : phase === 'redeemed' ? (
            <CheckCircle2 size={13} />
          ) : (
            <ShieldCheck size={13} />
          )}
          {phase === 'redeeming'
            ? 'Redeeming…'
            : phase === 'redeemed'
              ? 'Redeemed'
              : isPartial
                ? 'Collect rest'
                : 'Redeem'}
        </Button>
      </div>
    </div>
  );
};

/**
 * Receipts panel — the wallet's open fixed-rate positions in the vault, plus a
 * permissionless Harvest action that turns the vault's accrued YT yield into fresh
 * PT capacity (anyone can call it to keep the vault healthy).
 */
const ReceiptsPanel = () => {
  const { isConnected, address } = useWallet();
  const { receipts, vaultStats } = useProtocol();
  const { run, busy } = useTxAction();
  const now = useNowSecs();

  // Harvest realizes the vault's accrued YT yield into fresh PT capacity. The vault can only
  // have yield to harvest if it actually holds YT — so when its YT inventory is zero there is
  // definitively nothing to harvest, and we disable the button instead of letting it no-op.
  const hasYieldToHarvest = !!vaultStats && vaultStats.ytInventory > 0n;
  const harvestDisabled = busy || !address || !hasYieldToHarvest;
  const harvestTitle = !address
    ? 'Connect your wallet to harvest'
    : !hasYieldToHarvest
      ? 'No vault yield to harvest yet'
      : "Reinvest the vault's accrued YT yield into PT capacity";

  // Surface the actionable positions first (matured), then those maturing soonest. Aggregate
  // totals give an at-a-glance summary of capital locked and what it redeems for.
  const sorted = useMemo(
    () => [...receipts].sort((a, b) => a.maturity - b.maturity),
    [receipts],
  );
  const totals = useMemo(
    () =>
      receipts.reduce(
        (acc, r) => ({
          principal: acc.principal + r.principal,
          payout: acc.payout + r.payout,
        }),
        { principal: 0n, payout: 0n },
      ),
    [receipts],
  );

  return (
    <Card className="flex h-full flex-col rounded-xl">
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle>Your fixed-rate receipts</CardTitle>
          <CardDescription>
            Each receipt redeems for its fixed payout once the vault matures, subject to the risks below.
          </CardDescription>
          {isConnected && receipts.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums">
              <span className="text-muted-foreground">
                {formatUsd(totals.principal)} locked
              </span>
              <span className="font-medium text-foreground">
                {formatUsd(totals.payout)} at maturity
              </span>
            </div>
          )}
        </div>
        {VAULT_DEPLOYED && (
          <Button
            variant="outline"
            size="sm"
            disabled={harvestDisabled}
            onClick={() => address && run('Harvest', () => harvest(address))}
            className="h-8 gap-1.5 text-xs font-semibold"
            title={harvestTitle}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Sprout size={13} />}
            Harvest
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col space-y-2">
        {!VAULT_DEPLOYED ? (
          <p className="flex flex-1 items-center justify-center py-6 text-center text-sm text-muted-foreground">
            The Fixed-Rate Vault isn&apos;t deployed yet.
          </p>
        ) : !isConnected ? (
          <p className="flex flex-1 items-center justify-center py-6 text-center text-sm text-muted-foreground">
            Connect your wallet to see your receipts.
          </p>
        ) : receipts.length === 0 ? (
          <p className="flex flex-1 items-center justify-center py-6 text-center text-sm text-muted-foreground">
            No fixed-rate deposits yet. Lock a fixed rate to get started.
          </p>
        ) : (
          sorted.map((r) => (
            <ReceiptRow key={r.receiptId} receipt={r} now={now} address={address} />
          ))
        )}
      </CardContent>
    </Card>
  );
};

export default ReceiptsPanel;
