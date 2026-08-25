import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, Loader2, Wallet, AlertTriangle, ShieldCheck, TrendingUp, Layers, Coins } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import AmountField from './AmountField';
import { useWallet } from '@/context/WalletContext';
import { useTxAction } from '@/lib/useTxAction';
import { fromBaseUnits, toBaseUnits, formatAmount } from '@/lib/soroban';
import { setupSrPtTrustline } from '@/lib/horizon';
import { SR_CONTRACTS, SR_DEPLOYED } from '@/lib/config';
import {
  getExchangeRate,
  getMarketStats,
  getPortfolio,
  quoteBuyPt,
  quoteSellPt,
  quoteBuyYt,
  quoteSellYt,
  srToUsdc,
  usdcToSr,
  ytLeverage,
  wrapUsdc,
  unwrapSr,
  buyPt,
  sellPt,
  buyYt,
  sellYt,
  claimYield,
  impliedApyPct,
  ptPriceHuman,
  daysToExpiry,
  isMatured,
  type SrMarketStats,
  type SrPortfolio,
} from '@/lib/srstack';

type Mode = 'wrap' | 'unwrap' | 'buyPt' | 'sellPt' | 'buyYt' | 'sellYt';

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'wrap', label: 'Wrap', hint: 'USDC → SR' },
  { id: 'unwrap', label: 'Unwrap', hint: 'SR → USDC' },
  { id: 'buyPt', label: 'Earn fixed', hint: 'SR → PT' },
  { id: 'sellPt', label: 'Sell PT', hint: 'PT → SR' },
  { id: 'buyYt', label: 'Long yield', hint: 'SR → YT' },
  { id: 'sellYt', label: 'Sell YT', hint: 'YT → SR' },
];

const SLIPPAGE_OPTIONS = [0.005, 0.01, 0.02];

const fmtTok = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 6 });

/**
 * The **Spield v2 (SR stack)** interaction surface — every flow the Pendle-shaped contracts expose.
 *
 * The model differs from v1 in ways this panel has to make legible rather than hide:
 *
 * * **SR is the entry point, and it is a share.** Users wrap USDC into SR first; the PT/YT engine
 *   and the AMM speak only SR. `1 SR ≠ 1 USDC`, so every SR figure is shown with its USDC value
 *   next to it.
 * * **Long yield is one transaction.** No mint-then-sell round trip: the pool funds the rest of the
 *   notional and keeps the PT. The user pays only the YT's price, which is why the leverage figure
 *   is worth showing prominently.
 * * **YT needs no trustline.** Only flows that *deliver PT* do — buying PT, and removing liquidity.
 *   Long-yield buyers never touch PT, so we do not make them trust an asset they will not hold.
 * * **Selling YT credits your yield, it does not pay it.** The claim survives the sale; the Claim
 *   button stays live afterwards. That is deliberate contract behaviour, so the UI says so.
 */
const SrPanel = () => {
  const { address, isConnected, openWalletPicker, connecting, onCorrectNetwork } = useWallet();
  const { run, busy } = useTxAction();

  const [mode, setMode] = useState<Mode>('wrap');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(0.01);
  const [stats, setStats] = useState<SrMarketStats | null>(null);
  const [portfolio, setPortfolio] = useState<SrPortfolio | null>(null);
  const [rate, setRate] = useState<bigint>(10n ** 12n);
  const [quote, setQuote] = useState<bigint | null>(null);
  const [quoting, setQuoting] = useState(false);

  const refresh = useCallback(async () => {
    if (!SR_DEPLOYED) return;
    const [s, r] = await Promise.all([getMarketStats(), getExchangeRate()]);
    setStats(s);
    setRate(r);
    if (address) setPortfolio(await getPortfolio(address));
  }, [address]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const parsed = Number(amount);
  const amountValid = amount !== '' && !Number.isNaN(parsed) && parsed > 0;

  // What the user spends, and how much of it they have.
  const inToken =
    mode === 'wrap' ? 'USDC' : mode === 'sellPt' ? 'PT' : mode === 'sellYt' ? 'YT' : 'SR';
  const outToken =
    mode === 'wrap' ? 'SR' : mode === 'unwrap' ? 'USDC' : mode === 'buyPt' ? 'PT' : mode === 'buyYt' ? 'YT' : 'SR';

  const inBalance =
    mode === 'wrap'
      ? (portfolio?.usdc ?? 0n)
      : mode === 'sellPt'
        ? (portfolio?.pt ?? 0n)
        : mode === 'sellYt'
          ? (portfolio?.yt ?? 0n)
          : (portfolio?.sr ?? 0n);
  const inBalanceHuman = fromBaseUnits(inBalance);
  const overBalance = amountValid && parsed > inBalanceHuman;

  // Only flows that DELIVER PT need the trustline. Long-yield buyers never receive PT.
  const deliversPt = mode === 'buyPt';
  const needsTrustline = deliversPt && isConnected && onCorrectNetwork && portfolio?.hasPtTrustline === false;

  const matured = isMatured(stats);

  // Live quote, debounced.
  useEffect(() => {
    let cancelled = false;
    if (!amountValid || mode === 'wrap' || mode === 'unwrap') {
      setQuote(null);
      return;
    }
    setQuoting(true);
    const timer = setTimeout(async () => {
      const units = toBaseUnits(amount);
      let q = 0n;
      if (mode === 'buyPt') q = await quoteBuyPt(units);
      else if (mode === 'sellPt') q = await quoteSellPt(units);
      else if (mode === 'buyYt') q = await quoteBuyYt(units);
      else if (mode === 'sellYt') q = await quoteSellYt(units);
      if (!cancelled) {
        setQuote(q);
        setQuoting(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setQuoting(false);
    };
  }, [amount, amountValid, mode]);

  const minOut = (out: bigint): bigint => {
    const keep = BigInt(Math.round((1 - slippage) * 10_000));
    return (out * keep) / 10_000n;
  };

  const onSubmit = async () => {
    if (!address || !amountValid) return;
    const units = toBaseUnits(amount);
    const label =
      mode === 'wrap'
        ? 'Wrapping USDC into SR'
        : mode === 'unwrap'
          ? 'Unwrapping SR into USDC'
          : mode === 'buyPt'
            ? 'Buying PT'
            : mode === 'sellPt'
              ? 'Selling PT'
              : mode === 'buyYt'
                ? 'Buying YT'
                : 'Selling YT';

    await run(label, async () => {
      switch (mode) {
        case 'wrap':
          return wrapUsdc(address, amount);
        case 'unwrap':
          return unwrapSr(address, units);
        case 'buyPt':
          return buyPt(address, units, quote ? minOut(quote) : 0n);
        case 'sellPt':
          return sellPt(address, units, quote ? minOut(quote) : 0n);
        case 'buyYt':
          // `buyYt` pads max_sr_in itself — the on-chain cost is derived from the live index and
          // an exact-amount authorization would not match at execution.
          return buyYt(address, units);
        case 'sellYt':
          return sellYt(address, units, quote ? minOut(quote) : 0n);
      }
    });
    setAmount('');
    void refresh();
  };

  const onClaim = async () => {
    if (!address) return;
    await run('Claiming yield', () => claimYield(address));
    void refresh();
  };

  const onTrustline = async () => {
    if (!address || !SR_CONTRACTS) return;
    // `setupTrustlines` resolves to null when the trustline already exists; `run` wants a
    // WriteResult, so normalise that no-op case into one.
    await run('Adding the PT trustline', async () => {
      const res = await setupSrPtTrustline(address);
      return res ?? { hash: '' };
    });
    void refresh();
  };

  if (!SR_DEPLOYED) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Spield v2</CardTitle>
          <CardDescription>Not available on this network.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The v2 (SR) contracts are deployed on testnet only. Switch your wallet to testnet to try
            them.
          </p>
        </CardContent>
      </Card>
    );
  }

  const quoteHuman = quote !== null ? fromBaseUnits(quote) : null;
  const leverage =
    mode === 'buyYt' && quote && quote > 0n ? ytLeverage(toBaseUnits(amount), quote, rate) : 0;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-4 w-4" aria-hidden />
          Spield v2 — PT / YT
        </CardTitle>
        <CardDescription>
          {stats ? (
            <>
              {impliedApyPct(stats).toFixed(2)}% implied APY · PT {ptPriceHuman(stats).toFixed(4)} ·{' '}
              {matured ? 'matured' : `${daysToExpiry(stats)}d to expiry`}
            </>
          ) : (
            'Loading market…'
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        {/* Mode picker */}
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/50 p-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setMode(m.id);
                setAmount('');
                setQuote(null);
              }}
              className={cn(
                'rounded-md px-2 py-1.5 text-xs font-medium transition',
                mode === m.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="block">{m.label}</span>
              <span className="block text-[10px] opacity-70">{m.hint}</span>
            </button>
          ))}
        </div>

        {matured && mode !== 'unwrap' && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
            <span>
              This series has matured. Trading is closed — PT now redeems at par, and a matured YT
              earns nothing further (any yield you already accrued is still claimable).
            </span>
          </div>
        )}

        <AmountField
          label={`You pay (${inToken})`}
          value={amount}
          onChange={setAmount}
          balance={String(inBalanceHuman)}
          onMax={() => setAmount(String(inBalanceHuman))}
        />

        <div className="flex justify-center">
          <ArrowDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>

        {/* Output preview */}
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">You receive ({outToken})</span>
            <span className="font-medium tabular-nums">
              {quoting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : mode === 'wrap' ? (
                amountValid ? fmtTok(fromBaseUnits(usdcToSr(toBaseUnits(amount), rate))) : '—'
              ) : mode === 'unwrap' ? (
                amountValid ? fmtTok(fromBaseUnits(srToUsdc(toBaseUnits(amount), rate))) : '—'
              ) : quoteHuman !== null && quoteHuman > 0 ? (
                fmtTok(quoteHuman)
              ) : amountValid ? (
                'no quote'
              ) : (
                '—'
              )}
            </span>
          </div>

          {mode === 'buyYt' && leverage > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-500">
              <TrendingUp className="h-3.5 w-3.5" aria-hidden />
              <span>
                {leverage.toFixed(1)}× leverage — {fmtTok(parsed)} of yield exposure for{' '}
                {fmtTok(fromBaseUnits(srToUsdc(quote ?? 0n, rate)))} USDC
              </span>
            </div>
          )}

          {mode === 'buyYt' && amountValid && (quote === null || quote === 0n) && !quoting && (
            <p className="mt-2 text-xs text-muted-foreground">
              The pool cannot fill that size right now. Try a smaller amount — this is a liquidity
              limit, not a failure of your position.
            </p>
          )}

          {mode === 'sellYt' && (
            <p className="mt-2 text-xs text-muted-foreground">
              Selling credits the yield you have already earned — it does not pay it out. Claim it
              separately below; it survives the sale.
            </p>
          )}

          {(mode === 'buyPt' || mode === 'sellPt' || mode === 'sellYt') && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Slippage</span>
              {SLIPPAGE_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSlippage(s)}
                  className={cn(
                    'rounded px-1.5 py-0.5',
                    slippage === s ? 'bg-primary/15 text-primary' : 'text-muted-foreground',
                  )}
                >
                  {(s * 100).toFixed(1)}%
                </button>
              ))}
            </div>
          )}
        </div>

        {overBalance && (
          <p className="text-xs text-destructive">
            That is more {inToken} than this wallet holds.
          </p>
        )}

        {/* Actions */}
        <div className="mt-auto space-y-2">
          {!isConnected ? (
            <Button className="w-full" onClick={openWalletPicker} disabled={connecting}>
              <Wallet className="mr-2 h-4 w-4" aria-hidden />
              Connect wallet
            </Button>
          ) : !onCorrectNetwork ? (
            <Button className="w-full" disabled variant="secondary">
              Switch your wallet network
            </Button>
          ) : needsTrustline ? (
            <Button className="w-full" onClick={onTrustline} disabled={busy}>
              <ShieldCheck className="mr-2 h-4 w-4" aria-hidden />
              Add the PT trustline first
            </Button>
          ) : (
            <Button
              className="w-full"
              onClick={onSubmit}
              disabled={
                busy ||
                !amountValid ||
                overBalance ||
                (matured && mode !== 'unwrap') ||
                (mode !== 'wrap' && mode !== 'unwrap' && (quote === null || quote === 0n))
              }
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              {MODES.find((m) => m.id === mode)?.label}
            </Button>
          )}

          {portfolio && portfolio.claimableYield > 0n && (
            <Button variant="secondary" className="w-full" onClick={onClaim} disabled={busy}>
              <Coins className="mr-2 h-4 w-4" aria-hidden />
              Claim {formatAmount(portfolio.claimableYieldAsUsdc)} USDC of yield
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default SrPanel;
