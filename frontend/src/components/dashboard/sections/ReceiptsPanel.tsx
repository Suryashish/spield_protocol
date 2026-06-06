import { useEffect, useMemo, useState } from 'react';
import { Loader2, Lock, ShieldCheck, Sprout, Clock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useWallet } from '@/context/WalletContext';
import { useProtocol } from '@/context/ProtocolContext';
import { useTxAction } from '@/lib/useTxAction';
import { harvest, redeem, type Receipt } from '@/lib/vault';
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

  const redeemTitle = !address
    ? 'Connect your wallet to redeem'
    : !matured
      ? `Matures ${fmtRelative(receipt.maturity, now)} · ${fmtDate(receipt.maturity)}`
      : 'Redeem this matured receipt for its full fixed payout';

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Lock size={16} />
        </div>
        <div className="space-y-0.5">
          <div className="text-sm font-semibold tabular-nums">
            {formatUsd(receipt.payout)}{' '}
            <span className="text-xs font-medium text-muted-foreground">at maturity</span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>#{receipt.receiptId}</span>
            <span>{formatUsd(receipt.principal)} principal</span>
            <span className="text-emerald-500">+{formatUsd(coupon)} coupon</span>
            <span>{bpsToPct(receipt.rateBps)}% fixed</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock size={12} />
          {matured ? 'Matured' : fmtRelative(receipt.maturity, now)}
        </span>
        <Button
          size="sm"
          disabled={busy || !matured || !address}
          onClick={() => address && run('Redeem', () => redeem(address, receipt.receiptId))}
          className="h-8 gap-1.5 text-xs font-semibold"
          title={redeemTitle}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
          Redeem
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
    <Card className="flex h-full flex-col rounded-xl border-border bg-card shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between p-4 pb-2">
        <div>
          <CardTitle className="text-base font-semibold">Your fixed-rate receipts</CardTitle>
          <CardDescription className="text-xs">
            Each receipt redeems for a guaranteed payout once the vault matures.
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
      <CardContent className="flex flex-1 flex-col space-y-2 p-4">
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
