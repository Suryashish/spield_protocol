import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, Loader2, Wallet, AlertTriangle, ShieldCheck, Lock, Coins, ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import AmountField from './AmountField';
import { useWallet } from '@/context/WalletContext';
import { useProtocol } from '@/context/ProtocolContext';
import { useNav } from '@/context/NavContext';
import { useTxAction } from '@/lib/useTxAction';
import { deposit, quote, type Quote } from '@/lib/vault';
import { fromBaseUnits, formatAmount } from '@/lib/soroban';
import { setupTrustlines } from '@/lib/horizon';
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
  const { address, isConnected, openWalletPicker, connecting, onCorrectNetwork } = useWallet();
  const { balances, paused, vaultStats, trustlines } = useProtocol();
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

  // The vault mints PT + YT to the user under the hood, so — exactly like the raw Deposit door —
  // the wallet must trust PT + YT first or the mint panics on-chain. Detect it up front and turn
  // the CTA into a one-time "Enable PT & YT" step instead of letting the user deposit and only
  // discover the missing trustline after they've signed.
  const needsTrustlines = isConnected && onCorrectNetwork && !trustlines.ready;

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
    if (needsTrustlines) return 'Enable PT & YT';
    if (paused) return 'Protocol Paused';
    if (!amountValid) return 'Enter an amount';
    if (overBalance) return 'Insufficient USDC';
    if (overCapacity) return 'Exceeds vault capacity';
    return 'Lock Fixed Rate';
  }, [isConnected, onCorrectNetwork, needsTrustlines, paused, amountValid, overBalance, overCapacity]);

  // The trustline step needs no amount, so it stays enabled regardless of amount/capacity;
  // every other deposit precondition only applies once trustlines are in place.
  const disabled =
    !VAULT_DEPLOYED ||
    busy ||
    connecting ||
    (isConnected &&
      !needsTrustlines &&
      (!onCorrectNetwork || paused || !amountValid || overBalance || overCapacity));

  const handleClick = async () => {
    if (!isConnected || !address) {
      openWalletPicker();
      return;
    }
    if (needsTrustlines) {
      // One tx adds the missing PT/YT trustlines; `run` refreshes state after, which flips
      // `needsTrustlines` off and reveals the normal "Lock Fixed Rate" flow.
      await run('Enable PT & YT', async () => {
        const res = await setupTrustlines(address);
        return res ?? { hash: '' };
      });
      return;
    }
    const ok = await run('Lock fixed rate', () => deposit(address, amount));
    if (ok) setAmount('');
  };

  const setMax = () => setAmount(usdcBalance > 0 ? String(usdcBalance) : '');

  const payout = liveQuote?.payout ?? 0n;
  const coupon = liveQuote?.coupon ?? 0n;

  return (
    <Card className="h-full rounded-xl">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2">
          <Lock size={16} className="text-brand-text" />
          Fixed-Rate Vault
        </CardTitle>
        <CardDescription>
          Deposit USDC and lock a guaranteed fixed return until maturity — backed 1:1 by PT.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {/* Deposit: USDC */}
        <AmountField
          label="Deposit"
          token="USDC"
          value={amount}
          onChange={setAmount}
          disabled={!VAULT_DEPLOYED}
          balance={`${isConnected ? formatAmount(balances.usdc) : '0.00'} USDC`}
          onMax={isConnected ? setMax : undefined}
          invalid={overBalance || overCapacity}
        />

        <div className="flex items-center gap-3 py-0.5">
          <span className="rule-soft flex-1" aria-hidden="true" />
          <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-card text-subtle shadow-float-sm">
            <ArrowDown size={12} />
          </span>
          <span className="rule-soft flex-1" aria-hidden="true" />
        </div>

        {/* Receive at maturity — the same field, read-only, so the deposit and
            the payout read as two halves of one instrument. */}
        <AmountField
          label="Guaranteed at maturity"
          token="USDC"
          value={amountValid && liveQuote ? formatAmount(payout) : ''}
          loading={quoting}
          hint={
            amountValid && liveQuote
              ? `+ ${formatAmount(coupon)} fixed coupon`
              : 'principal + fixed coupon'
          }
          hintTone="brand"
        />

        {/* Summary — just the two facts the hero payout box doesn't already state.
            The coupon/total payout are shown above; vault-wide stats (APR, maturity,
            capacity) live in the summary strip at the top of the page. */}
        <div className="space-y-1.5 well rounded-lg p-3">
          <div className="flex justify-between text-[12.5px]">
            <span className="text-muted-foreground">Locked APR</span>
            <span className="text-foreground">
              {amountValid && liveQuote ? `${bpsToPct(rateBps)}%` : '—'}
            </span>
          </div>
          <div className="flex justify-between text-[12.5px]">
            <span className="text-muted-foreground">Matures</span>
            <span className="text-foreground">
              {vaultStats ? fmtMaturity(vaultStats.maturity) : '—'}
            </span>
          </div>
        </div>

        {!VAULT_DEPLOYED && (
          <div className="flex items-start gap-2 well rounded-lg p-2.5 text-xs text-muted-foreground">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              The Fixed-Rate Vault isn&apos;t deployed yet. Run{' '}
              <span className="font-mono">scripts/deploy_testnet.sh</span> and paste the printed
              vault address into <span className="font-mono">config.ts</span>.
            </span>
          </div>
        )}

        {overCapacity && (
          <div className="flex items-start gap-2 rounded-lg border border-ember/30 bg-ember/10 p-2.5 text-xs text-ember-text">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              This deposit&apos;s coupon exceeds the vault&apos;s current spare PT capacity. Try a
              smaller amount, or harvest/seed the vault to widen capacity.
            </span>
          </div>
        )}

        {!onCorrectNetwork && isConnected && (
          <div className="flex items-start gap-2 rounded-lg border border-ember/30 bg-ember/10 p-2.5 text-xs text-ember-text">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>Your wallet is on the wrong network. Switch Freighter to {NETWORK.name}.</span>
          </div>
        )}

        {needsTrustlines && (
          <div className="flex items-start gap-2 rounded-lg border border-brand/30 bg-brand/10 p-2.5 text-xs text-foreground">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-brand-text" />
            <span>
              One-time setup: the vault hands you PT &amp; YT under the hood, so your wallet needs
              their trustlines first. This is a single, free transaction — approve it, then lock
              your rate.
            </span>
          </div>
        )}

        <Button
          onClick={handleClick}
          disabled={disabled}
          className="h-11 w-full text-[14px] font-medium"
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
          className="flex w-full items-center justify-between gap-3 well rounded-lg px-3 py-2.5 text-left text-[12.5px] leading-relaxed transition-colors duration-200 hover:border-brand/40"
        >
          <span className="flex min-w-0 items-start gap-2 text-muted-foreground">
            <Coins size={13} className="mt-px shrink-0 text-ember-text" />
            <span>
              Want the raw <span className="font-medium text-foreground">PT + YT tokens</span> and
              variable yield instead?
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 font-medium text-brand-text">
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
