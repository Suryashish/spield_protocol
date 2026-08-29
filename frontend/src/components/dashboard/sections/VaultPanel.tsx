import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, Loader2, Wallet, AlertTriangle, ShieldCheck, Lock, Coins, ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import AmountField from './AmountField';
import { useWallet } from '@/context/WalletContext';
import { useProtocol } from '@/context/ProtocolContext';
import { useNav } from '@/context/NavContext';
import { useTxAction } from '@/lib/useTxAction';
import { type Quote } from '@/lib/vault';
import { deposit, quote } from '@/lib/v2adapters';
import { fromBaseUnits, formatAmount } from '@/lib/soroban';
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

  // A vault with NO spare PT cannot back a coupon of any size, so every deposit reverts with
  // InsufficientCapacity. That is the state a freshly deployed, unseeded vault is in — `deposit`
  // is a pure config write, `seed` is the only step that spends USDC, and it defaults to zero.
  // Without this the panel quotes a rate it cannot honour and the user only finds out after typing
  // an amount and reading a capacity error meant for oversized deposits.
  const noCapacity = VAULT_DEPLOYED && !!vaultStats && capacity <= 0n;

  const rateBps = liveQuote?.rateBps ?? vaultStats?.rateBps ?? 0;

  // The vault mints PT + YT to the user under the hood, so — exactly like the raw Deposit door —
  // the wallet must trust PT + YT first or the mint panics on-chain. Detect it up front and turn
  // (v1 turned the CTA into a one-time trustline step here. v2's vault hands you a receipt and keeps
  // the PT itself, so there is nothing to trust and nothing to gate.)

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
    if (noCapacity) return 'Not accepting deposits';
    if (!amountValid) return 'Enter an amount';
    if (overBalance) return 'Insufficient USDC';
    if (overCapacity) return 'Exceeds vault capacity';
    return 'Lock Fixed Rate';
  }, [isConnected, onCorrectNetwork, paused, noCapacity, amountValid, overBalance, overCapacity]);

  // The trustline step needs no amount, so it stays enabled regardless of amount/capacity;
  // every other deposit precondition only applies once trustlines are in place.
  const disabled =
    !VAULT_DEPLOYED ||
    busy ||
    connecting ||
    noCapacity ||
    (isConnected && (!onCorrectNetwork || paused || !amountValid || overBalance || overCapacity));

  const handleClick = async () => {
    if (!isConnected || !address) {
      openWalletPicker();
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock size={16} className="text-brand-text" />
          Fixed-Rate Vault
        </CardTitle>
        <CardDescription>
          Deposit USDC and lock a guaranteed fixed return until maturity — backed 1:1 by PT.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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

        {noCapacity && (
          <div className="flex items-start gap-2 rounded-lg border border-ember/30 bg-ember/10 p-2.5 text-xs text-ember-text">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              This vault has no spare capacity to back a coupon, so it isn&apos;t accepting deposits
              yet. Its fixed rate is funded from PT inventory the vault already holds — an operator
              has to seed that before the first deposit.
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

        {/* No trustline notice: the vault keeps the PT itself and hands you a receipt, so there is
            nothing for your wallet to trust. This is one fewer step than v1 required. */}
        <div className="flex items-start gap-2 rounded-lg border border-brand/30 bg-brand/10 p-2.5 text-xs text-foreground">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-brand-text" />
          <span>
            No setup needed. The vault holds the principal tokens backing your payout itself, so
            your wallet needs no trustlines — deposit and your rate is locked.
          </span>
        </div>

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
