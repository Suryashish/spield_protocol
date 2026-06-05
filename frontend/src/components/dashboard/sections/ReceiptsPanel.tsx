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

const nowSecs = () => Math.floor(Date.now() / 1000);

const ReceiptRow = ({ receipt }: { receipt: Receipt }) => {
  const { address } = useWallet();
  const { run, busy } = useTxAction();
  const matured = nowSecs() >= receipt.maturity;
  const coupon = receipt.payout - receipt.principal;

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
          {matured ? 'Matured' : fmtDate(receipt.maturity)}
        </span>
        <Button
          size="sm"
          disabled={busy || !matured || !address}
          onClick={() => address && run('Redeem', () => redeem(address, receipt.receiptId))}
          className="h-8 gap-1.5 text-xs font-semibold"
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

  return (
    <Card className="rounded-xl border-border bg-card shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between p-4 pb-2">
        <div>
          <CardTitle className="text-base font-semibold">Your fixed-rate receipts</CardTitle>
          <CardDescription className="text-xs">
            Each receipt redeems for a guaranteed payout once the vault matures.
          </CardDescription>
        </div>
        {VAULT_DEPLOYED && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !address}
            onClick={() => address && run('Harvest', () => harvest(address))}
            className="h-8 gap-1.5 text-xs font-semibold"
            title="Reinvest the vault's accrued YT yield into PT capacity"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Sprout size={13} />}
            Harvest
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2 p-4">
        {!VAULT_DEPLOYED ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            The Fixed-Rate Vault isn&apos;t deployed yet.
          </p>
        ) : !isConnected ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Connect your wallet to see your receipts.
          </p>
        ) : receipts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No fixed-rate deposits yet. Lock a fixed rate to get started.
          </p>
        ) : (
          receipts.map((r) => <ReceiptRow key={r.receiptId} receipt={r} />)
        )}

        {VAULT_DEPLOYED && vaultStats && (
          <div className="mt-2 flex flex-wrap justify-between gap-2 rounded-lg border border-border/50 bg-muted/20 p-3 text-xs">
            <span className="text-muted-foreground">
              Vault PT inventory:{' '}
              <span className="font-semibold text-foreground">
                {formatUsd(vaultStats.ptInventory)}
              </span>
            </span>
            <span className="text-muted-foreground">
              Outstanding payouts:{' '}
              <span className="font-semibold text-foreground">
                {formatUsd(vaultStats.totalLiability)}
              </span>
            </span>
            <span className="text-muted-foreground">
              Spare capacity:{' '}
              <span className="font-semibold text-emerald-500">
                {formatUsd(vaultStats.couponCapacity)}
              </span>
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ReceiptsPanel;
