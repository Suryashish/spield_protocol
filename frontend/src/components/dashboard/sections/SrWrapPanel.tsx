import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, Loader2, Wallet, Package, TrendingUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import AmountField from './AmountField';
import { useWallet } from '@/context/WalletContext';
import { useTxAction } from '@/lib/useTxAction';
import { fromBaseUnits, toBaseUnits, formatAmount } from '@/lib/soroban';
import { SR_DEPLOYED } from '@/lib/config';
import {
  getExchangeRate,
  getPortfolio,
  getMaxRedeemable,
  srToUsdc,
  usdcToSr,
  wrapUsdc,
  unwrapSr,
  unwrapSrPartial,
  fromScalar12,
  type SrPortfolio,
} from '@/lib/srstack';

const fmtTok = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 6 });

/**
 * **The SR wrapper, on its own.**
 *
 * Every PT/YT trade already wraps for you inside a single transaction, so nobody *has* to come
 * here. This section exists because holding SR is a legitimate position in its own right, not just
 * an intermediate step:
 *
 * * it is a **yield-bearing dollar** — one token whose redemption value rises with Blend's supply
 *   rate, with no maturity, no curve and no counterparty to trade against;
 * * it is the unit the PT/SR pool and the yield engine actually speak, so an LP or a market maker
 *   wants it directly;
 * * and it exits whenever you like — `redeem` has no expiry gate and stays open even while the
 *   protocol is paused.
 *
 * The one thing this panel must never let a user get wrong: **1 SR ≠ 1 USDC**. SR is a *share*.
 * Its value is `balance × exchange_rate / 1e12`, and that rate only ever climbs — which is exactly
 * where the yield shows up. So every SR figure here is shown with its USDC value beside it, and the
 * live rate is displayed rather than hidden.
 */
const SrWrapPanel = () => {
  const { address, isConnected, openWalletPicker, connecting, onCorrectNetwork } = useWallet();
  const { run, busy } = useTxAction();

  const [mode, setMode] = useState<'wrap' | 'unwrap'>('wrap');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState<bigint>(10n ** 12n);
  const [portfolio, setPortfolio] = useState<SrPortfolio | null>(null);
  /**
   * The venue's exit capacity in SR shares, or null when unconstrained (`tofix.md` #20).
   *
   * Worth showing even though it is usually null: when it is not, the alternative is a withdrawal
   * that reverts with no explanation and no hint at the amount that would have worked.
   */
  const [maxRedeemable, setMaxRedeemable] = useState<bigint | null>(null);

  const refresh = useCallback(async () => {
    if (!SR_DEPLOYED) return;
    const [r, cap] = await Promise.all([getExchangeRate(), getMaxRedeemable()]);
    setRate(r);
    setMaxRedeemable(cap);
    if (address) setPortfolio(await getPortfolio(address));
  }, [address]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const parsed = Number(amount);
  const amountValid = amount !== '' && !Number.isNaN(parsed) && parsed > 0;

  const inBalance = mode === 'wrap' ? (portfolio?.usdc ?? 0n) : (portfolio?.sr ?? 0n);
  const inBalanceHuman = fromBaseUnits(inBalance);
  const overBalance = amountValid && parsed > inBalanceHuman;

  const preview = amountValid
    ? mode === 'wrap'
      ? usdcToSr(toBaseUnits(amount), rate)
      : srToUsdc(toBaseUnits(amount), rate)
    : 0n;

  // True when this withdrawal is larger than the venue can currently pay.
  const units = amountValid ? toBaseUnits(amount) : 0n;
  const crunched = mode === 'unwrap' && maxRedeemable !== null && units > maxRedeemable;

  const onSubmit = async () => {
    if (!address || !amountValid) return;
    await run(
      mode === 'wrap'
        ? 'Wrapping USDC into SR'
        : crunched
          ? 'Withdrawing what the pool can pay'
          : 'Unwrapping SR into USDC',
      () =>
        mode === 'wrap'
          ? wrapUsdc(address, amount)
          : // All-or-nothing would revert here and leave the user with nothing. Take what is there.
            crunched
            ? unwrapSrPartial(address, units)
            : unwrapSr(address, units),
    );
    setAmount('');
    void refresh();
  };

  if (!SR_DEPLOYED) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>SR Wrapper</CardTitle>
          <CardDescription>Not available on this network.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The v2 (SR) contracts are deployed on testnet only.
          </p>
        </CardContent>
      </Card>
    );
  }

  const rateNum = fromScalar12(rate);
  const srValueUsdc = portfolio ? srToUsdc(portfolio.sr, rate) : 0n;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-4 w-4" aria-hidden />
          SR Wrapper — hold the yield-bearing dollar
        </CardTitle>
        <CardDescription>
          1 SR = {rateNum.toFixed(6)} USDC · the rate only ever rises
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-2.5 py-2 text-xs">
          <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
          <span className="text-muted-foreground">
            SR is a <strong className="text-foreground">share</strong>, not a receipt — your balance
            stays flat and the redemption rate climbs. You do not need this to trade PT or YT; those
            wrap for you in one transaction. Come here to hold SR itself.
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/50 p-1">
          {(['wrap', 'unwrap'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setAmount('');
              }}
              className={cn(
                'rounded-md px-2 py-1.5 text-xs font-medium transition',
                mode === m
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="block capitalize">{m}</span>
              <span className="block text-[10px] opacity-70">
                {m === 'wrap' ? 'USDC → SR' : 'SR → USDC'}
              </span>
            </button>
          ))}
        </div>

        <AmountField
          label={`You pay (${mode === 'wrap' ? 'USDC' : 'SR'})`}
          value={amount}
          onChange={setAmount}
          balance={String(inBalanceHuman)}
          onMax={() => setAmount(String(inBalanceHuman))}
        />

        <div className="flex justify-center">
          <ArrowDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              You receive ({mode === 'wrap' ? 'SR' : 'USDC'})
            </span>
            <span className="font-medium tabular-nums">
              {amountValid ? fmtTok(fromBaseUnits(preview)) : '—'}
            </span>
          </div>
          {mode === 'wrap' && amountValid && (
            <p className="mt-2 text-xs text-muted-foreground">
              Worth {fmtTok(parsed)} USDC today, and more every ledger after that.
            </p>
          )}
          {mode === 'unwrap' && !crunched && (
            <p className="mt-2 text-xs text-muted-foreground">
              No maturity gate — unwrapping stays open even if deposits are paused.
            </p>
          )}
          {crunched && (
            <p className="mt-2 text-xs text-amber-500">
              The lending pool cannot pay that much right now — borrowers have drawn down its
              supply. This will withdraw about{' '}
              {fmtTok(fromBaseUnits(srToUsdc(maxRedeemable ?? 0n, rate)))} USDC and leave the rest of
              your position intact, claimable as liquidity returns.
            </p>
          )}
        </div>

        {overBalance && (
          <p className="text-xs text-destructive">
            That is more {mode === 'wrap' ? 'USDC' : 'SR'} than this wallet holds.
          </p>
        )}

        {portfolio && portfolio.sr > 0n && (
          <div className="flex items-center justify-between rounded-md border px-3 py-2 text-xs">
            <span className="text-muted-foreground">Your SR</span>
            <span className="tabular-nums">
              {fmtTok(fromBaseUnits(portfolio.sr))} SR
              <span className="ml-2 text-muted-foreground">
                ≈ {formatAmount(srValueUsdc)} USDC
              </span>
            </span>
          </div>
        )}

        <div className="mt-auto">
          {!isConnected ? (
            <Button className="w-full" onClick={openWalletPicker} disabled={connecting}>
              <Wallet className="mr-2 h-4 w-4" aria-hidden />
              Connect wallet
            </Button>
          ) : !onCorrectNetwork ? (
            <Button className="w-full" disabled variant="secondary">
              Switch your wallet network
            </Button>
          ) : (
            <Button
              className="w-full"
              onClick={onSubmit}
              disabled={busy || !amountValid || overBalance}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              {mode === 'wrap' ? 'Wrap into SR' : crunched ? 'Withdraw what is available' : 'Unwrap to USDC'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default SrWrapPanel;
