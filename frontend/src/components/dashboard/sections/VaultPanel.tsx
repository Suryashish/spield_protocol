import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, Loader2, Wallet, AlertTriangle, ShieldCheck, Lock, Coins, ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useWallet } from '@/context/WalletContext';
import { useProtocol } from '@/context/ProtocolContext';
import { useNav } from '@/context/NavContext';
import { useTxAction } from '@/lib/useTxAction';
import { deposit, quote, type Quote } from '@/lib/vault';
import { fromBaseUnits, formatAmount, formatUsd } from '@/lib/soroban';
import { NETWORK, VAULT_DEPLOYED } from '@/lib/config';

const bpsToPct = (bps: number) => (bps / 100).toFixed(2);

const fmtMaturity = (unix: number): string =>
  new Date(unix * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

/**
 * Fixed-Rate Vault panel — the flagship "lock X% fixed" deposit flow.
 *
 * The user deposits USDC and receives a receipt for a *known* payout at maturity
 * (principal + a fixed coupon). The quote is read live from the vault's `quote` view
 * so the headline number is exactly what the contract will lock in. PT/YT never appear
 * — the vault holds them under the hood and backs the payout 1:1 with its PT inventory.
 */
const VaultPanel = () => {
  const { address, isConnected, connect, connecting, onCorrectNetwork } = useWallet();
  const { balances, paused, vaultStats } = useProtocol();
  const { navigate } = useNav();
  const { run, busy } = useTxAction();
  const [amount, setAmount] = useState('');
  const [liveQuote, setLiveQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);

  const usdcBalance = fromBaseUnits(balances.usdc);
  const parsed = Number(amount);
  const amountValid = amount !== '' && !Number.isNaN(parsed) && parsed > 0;
  const overBalance = amountValid && parsed > usdcBalance;

  // The vault's spare PT capacity caps how much coupon it can currently back. A deposit
  // whose payout exceeds capacity will be refused on-chain (InsufficientCapacity); we
  // surface that ahead of time so the user isn't surprised.
  const capacity = vaultStats?.couponCapacity ?? 0n;
  const overCapacity =
    !!liveQuote && amountValid && liveQuote.payout - toBigSafe(amount) > capacity;

  const rateBps = liveQuote?.rateBps ?? vaultStats?.rateBps ?? 0;

  // Re-quote (debounced) whenever the amount changes and the vault is live. All setState calls
  // happen inside the timeout callback (never synchronously in the effect body) so we don't
  // trigger cascading renders on commit.
  useEffect(() => {
    let cancelled = false;
    const live = VAULT_DEPLOYED && amountValid;
    const t = setTimeout(async () => {
      if (cancelled) return;
      if (!live) {
        setLiveQuote(null);
        setQuoting(false);
        return;
      }
      setQuoting(true);
      const q = await quote(amount);
      if (!cancelled) {
        setLiveQuote(q);
        setQuoting(false);
      }
    }, live ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [amount, amountValid]);

  const cta = useMemo(() => {
    if (!VAULT_DEPLOYED) return 'Vault not deployed';
    if (!isConnected) return 'Connect Wallet';
    if (!onCorrectNetwork) return `Switch to ${NETWORK.name}`;
    if (paused) return 'Protocol Paused';
    if (!amountValid) return 'Enter an amount';
    if (overBalance) return 'Insufficient USDC';
    if (overCapacity) return 'Exceeds vault capacity';
    return 'Lock Fixed Rate';
  }, [isConnected, onCorrectNetwork, paused, amountValid, overBalance, overCapacity]);

  const disabled =
    !VAULT_DEPLOYED ||
    busy ||
    connecting ||
    (isConnected && (!onCorrectNetwork || paused || !amountValid || overBalance || overCapacity));

  const handleClick = async () => {
    if (!isConnected || !address) {
      await connect();
      return;
    }
    const ok = await run('Lock fixed rate', () => deposit(address, amount));
    if (ok) setAmount('');
  };

  const setMax = () => setAmount(usdcBalance > 0 ? String(usdcBalance) : '');

  const payout = liveQuote?.payout ?? 0n;
  const coupon = liveQuote?.coupon ?? 0n;

  return (
    <Card className="h-full rounded-xl border-border bg-card shadow-sm">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Lock size={16} className="text-primary" />
          Fixed-Rate Vault
        </CardTitle>
        <CardDescription className="text-xs">
          Deposit USDC and lock a guaranteed fixed return until maturity — backed 1:1 by PT.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {/* Headline rate */}
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Fixed APR</span>
          <span className="text-xl font-bold tabular-nums text-primary">
            {VAULT_DEPLOYED ? `${bpsToPct(rateBps)}%` : '—'}
          </span>
        </div>

        {/* Deposit: USDC */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-0.5 text-xs font-semibold uppercase text-muted-foreground">
            <Label>Deposit</Label>
            <button
              type="button"
              onClick={setMax}
              disabled={!isConnected}
              className="normal-case transition-colors hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
            >
              Bal: {isConnected ? formatAmount(balances.usdc) : '0.00'} USDC
            </button>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-input bg-muted/50 px-3 py-2.5">
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={!VAULT_DEPLOYED}
              className="h-auto border-none bg-transparent p-0 text-lg font-bold shadow-none focus-visible:ring-0"
            />
            <span className="flex h-7 items-center rounded-md bg-accent px-2.5 text-xs font-bold">
              USDC
            </span>
          </div>
        </div>

        <div className="relative z-10 -my-3 flex justify-center">
          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
            <ArrowDown size={12} />
          </div>
        </div>

        {/* Receive at maturity */}
        <div className="space-y-1.5">
          <div className="px-0.5 text-xs font-semibold uppercase text-muted-foreground">
            <Label>Guaranteed at maturity</Label>
          </div>
          <div className="rounded-lg border border-input bg-muted/50 px-3 py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold tabular-nums">
                {amountValid && liveQuote ? formatAmount(payout) : '0.0'}
              </span>
              <span className="text-xs font-semibold text-muted-foreground">USDC</span>
              {quoting && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
            </div>
            <div className="mt-0.5 text-xs font-semibold text-emerald-500">
              {amountValid && liveQuote
                ? `+ ${formatAmount(coupon)} fixed coupon`
                : 'principal + fixed coupon'}
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="space-y-1.5 rounded-lg border border-border/50 bg-muted/30 p-3">
          <div className="flex justify-between text-xs font-medium">
            <span className="text-muted-foreground">Fixed coupon</span>
            <span className="text-foreground">
              {amountValid && liveQuote ? formatUsd(coupon) : '—'}
            </span>
          </div>
          <div className="flex justify-between text-xs font-medium">
            <span className="text-muted-foreground">Total payout</span>
            <span className="text-foreground">
              {amountValid && liveQuote ? formatUsd(payout) : '—'}
            </span>
          </div>
          <div className="flex justify-between text-xs font-medium">
            <span className="text-muted-foreground">Matures</span>
            <span className="text-foreground">
              {vaultStats ? fmtMaturity(vaultStats.maturity) : '—'}
            </span>
          </div>
          <div className="flex justify-between text-xs font-medium">
            <span className="text-muted-foreground">Vault capacity left</span>
            <span className="text-foreground">{VAULT_DEPLOYED ? formatUsd(capacity) : '—'}</span>
          </div>
        </div>

        {!VAULT_DEPLOYED && (
          <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 p-2.5 text-xs text-muted-foreground">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              The Fixed-Rate Vault isn&apos;t deployed yet. Run{' '}
              <span className="font-mono">scripts/deploy_testnet.sh</span> and paste the printed
              vault address into <span className="font-mono">config.ts</span>.
            </span>
          </div>
        )}

        {overCapacity && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-500">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              This deposit&apos;s coupon exceeds the vault&apos;s current spare PT capacity. Try a
              smaller amount, or harvest/seed the vault to widen capacity.
            </span>
          </div>
        )}

        {!onCorrectNetwork && isConnected && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-500">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>Your wallet is on the wrong network. Switch Freighter to {NETWORK.name}.</span>
          </div>
        )}

        <Button
          onClick={handleClick}
          disabled={disabled}
          className="h-10 w-full text-sm font-bold uppercase tracking-wide shadow-none"
        >
          {busy || connecting ? (
            <Loader2 size={15} className="animate-spin" />
          ) : !isConnected ? (
            <Wallet size={15} />
          ) : (
            <ShieldCheck size={15} />
          )}
          {cta}
        </Button>

        {/* Cross-link: the vault hides PT/YT and gives a fixed payout. Point advanced users who
            want the raw tokens + variable yield (claim/redeem/trade themselves) to the Deposit door.
            Both call the same wrapper.mint under the hood — they're two doors to one protocol. */}
        <button
          type="button"
          onClick={() => navigate('deposit')}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5 text-left text-xs transition-colors hover:border-primary/40 hover:bg-primary/5"
        >
          <span className="flex items-center gap-2 text-muted-foreground">
            <Coins size={13} className="shrink-0 text-amber-500" />
            Want the raw <span className="font-semibold text-foreground">PT + YT tokens</span> and
            variable yield instead?
          </span>
          <span className="flex shrink-0 items-center gap-1 font-semibold text-primary">
            Deposit <ArrowRight size={13} />
          </span>
        </button>
      </CardContent>
    </Card>
  );
};

/** Parse a human USDC string to base units (7 decimals) without importing the writer. */
function toBigSafe(amount: string): bigint {
  const [whole, fracRaw = ''] = amount.replace('-', '').split('.');
  const frac = (fracRaw + '0000000').slice(0, 7);
  return BigInt(whole || '0') * 10_000_000n + BigInt(frac || '0');
}

export default VaultPanel;
