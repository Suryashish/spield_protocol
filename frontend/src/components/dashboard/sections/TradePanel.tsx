import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, Loader2, Wallet, AlertTriangle, ShieldCheck, TrendingUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useWallet } from '@/context/WalletContext';
import { useProtocol } from '@/context/ProtocolContext';
import { useTxAction } from '@/lib/useTxAction';
import { buyPt, sellPt, quoteSwap, type TradeSide } from '@/lib/market';
import { fromBaseUnits, formatAmount } from '@/lib/soroban';
import { setupTrustlines } from '@/lib/horizon';
import { NETWORK, MARKET_DEPLOYED } from '@/lib/config';

/** Apply a slippage tolerance (as a fraction, e.g. 0.005) to a quoted output → a min-out string. */
const applySlippage = (out: bigint, tolerance: number): string => {
  const keep = BigInt(Math.round((1 - tolerance) * 10_000));
  const min = (out * keep) / 10_000n;
  return String(fromBaseUnits(min));
};

const SLIPPAGE_OPTIONS = [0.005, 0.01, 0.02]; // 0.5% / 1% / 2%

/**
 * Trade panel — buy or sell PT against USDC on the time-decay curve.
 *
 * **Earn Fixed** (buy PT): pay USDC now, hold PT to maturity, redeem 1:1 → a fixed return locked at
 * today's implied APY. **Sell PT**: exit a PT holding back to USDC at the market price. Both are
 * direct on-chain swaps with a live quote and a slippage guard, run through the shared tx lifecycle.
 */
const TradePanel = () => {
  const { address, isConnected, connect, connecting, onCorrectNetwork } = useWallet();
  const { balances, trustlines, marketStats } = useProtocol();
  const { run, busy } = useTxAction();

  const [side, setSide] = useState<TradeSide>('buyPt');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(0.01);
  const [quote, setQuote] = useState<bigint | null>(null);
  const [quoting, setQuoting] = useState(false);

  const inToken = side === 'buyPt' ? 'USDC' : 'PT';
  const outToken = side === 'buyPt' ? 'PT' : 'USDC';
  const inBalance = side === 'buyPt' ? balances.usdc : balances.pt;
  const inBalanceHuman = fromBaseUnits(inBalance);

  const parsed = Number(amount);
  const amountValid = amount !== '' && !Number.isNaN(parsed) && parsed > 0;
  const overBalance = amountValid && parsed > inBalanceHuman;

  // Selling PT needs a PT trustline to receive nothing new, but buying PT requires the wallet to
  // already trust PT to receive it.
  const needsTrustlines = side === 'buyPt' && isConnected && onCorrectNetwork && !trustlines.ready;

  // Debounced live quote whenever amount/side changes.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      if (!amountValid) {
        setQuote(null);
        setQuoting(false);
        return;
      }
      setQuoting(true);
      const q = await quoteSwap(side, amount);
      if (!cancelled) {
        setQuote(q);
        setQuoting(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [amount, side, amountValid]);

  // A null quote (when not actively quoting) on a valid amount + a funded pool means the trade
  // exceeds the pool's available liquidity — surfaced as an actionable message.
  const poolHasLiquidity = !!marketStats && marketStats.ptReserve > 0n && marketStats.usdcReserve > 0n;
  const exceedsLiquidity =
    amountValid && !quoting && !overBalance && poolHasLiquidity && (quote === null || quote === 0n);

  const cta = useMemo(() => {
    if (!MARKET_DEPLOYED) return 'Market not deployed';
    if (!isConnected) return 'Connect Wallet';
    if (!onCorrectNetwork) return `Switch to ${NETWORK.name}`;
    if (needsTrustlines) return 'Enable PT & YT';
    if (!amountValid) return 'Enter an amount';
    if (overBalance) return `Insufficient ${inToken}`;
    if (!poolHasLiquidity) return 'No liquidity';
    if (exceedsLiquidity) return 'Amount exceeds liquidity';
    return side === 'buyPt' ? 'Buy PT' : 'Sell PT';
  }, [
    isConnected,
    onCorrectNetwork,
    needsTrustlines,
    amountValid,
    overBalance,
    poolHasLiquidity,
    exceedsLiquidity,
    side,
    inToken,
  ]);

  const disabled =
    !MARKET_DEPLOYED ||
    busy ||
    connecting ||
    (isConnected &&
      !needsTrustlines &&
      (!onCorrectNetwork || !amountValid || overBalance || !poolHasLiquidity || exceedsLiquidity || !quote));

  const handleClick = async () => {
    if (!isConnected || !address) {
      await connect();
      return;
    }
    if (needsTrustlines) {
      await run('Enable PT & YT', async () => {
        const res = await setupTrustlines(address);
        return res ?? { hash: '' };
      });
      return;
    }
    if (!quote) return;
    const minOut = applySlippage(quote, slippage);
    const label = side === 'buyPt' ? 'Buy PT' : 'Sell PT';
    const ok = await run(label, () =>
      side === 'buyPt' ? buyPt(address, amount, minOut) : sellPt(address, amount, minOut),
    );
    if (ok) setAmount('');
  };

  const setMax = () => setAmount(inBalanceHuman > 0 ? String(inBalanceHuman) : '');

  const outHuman = quote != null ? fromBaseUnits(quote) : 0;
  // Effective price the trade executes at (USDC per PT), for the user's reference.
  const effPrice =
    quote && amountValid
      ? side === 'buyPt'
        ? parsed / outHuman // USDC paid per PT received
        : outHuman / parsed // USDC received per PT sold
      : 0;

  return (
    <Card className="h-full rounded-xl border-border bg-card shadow-sm">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <TrendingUp size={16} className="text-primary" />
          Trade
        </CardTitle>
        <CardDescription className="text-xs">
          Buy PT to lock a fixed return, or sell PT back to USDC at the market price.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {/* Side toggle */}
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1">
          <button
            type="button"
            onClick={() => {
              setSide('buyPt');
              setAmount('');
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-semibold transition-all',
              side === 'buyPt'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Earn Fixed (Buy PT)
          </button>
          <button
            type="button"
            onClick={() => {
              setSide('sellPt');
              setAmount('');
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-semibold transition-all',
              side === 'sellPt'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Sell PT
          </button>
        </div>

        {/* Pay */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-0.5 text-xs font-semibold uppercase text-muted-foreground">
            <Label>You pay</Label>
            <button
              type="button"
              onClick={setMax}
              disabled={!isConnected}
              className="normal-case transition-colors hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
            >
              Bal: {isConnected ? formatAmount(inBalance) : '0.00'} {inToken}
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
              disabled={!MARKET_DEPLOYED}
              className="h-auto border-none bg-transparent p-0 text-lg font-bold shadow-none focus-visible:ring-0"
            />
            <span className="flex h-7 items-center rounded-md bg-accent px-2.5 text-xs font-bold">
              {inToken}
            </span>
          </div>
        </div>

        <div className="relative z-10 -my-3 flex justify-center">
          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
            <ArrowDown size={12} />
          </div>
        </div>

        {/* Receive */}
        <div className="space-y-1.5">
          <div className="px-0.5 text-xs font-semibold uppercase text-muted-foreground">
            <Label>You receive (est.)</Label>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-input bg-muted/50 px-3 py-2.5">
            <div className="flex flex-1 items-baseline gap-2">
              <span className="text-lg font-bold tabular-nums">
                {amountValid && quote != null ? outHuman.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '0.0'}
              </span>
              {quoting && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
            </div>
            <span className="flex h-7 items-center rounded-md bg-accent px-2.5 text-xs font-bold">
              {outToken}
            </span>
          </div>
        </div>

        {/* Summary */}
        <div className="space-y-1.5 rounded-lg border border-border/50 bg-muted/30 p-3">
          <div className="flex justify-between text-xs font-medium">
            <span className="text-muted-foreground">Price</span>
            <span className="text-foreground">
              {effPrice > 0 ? `${effPrice.toFixed(4)} USDC / PT` : '—'}
            </span>
          </div>
          <div className="flex justify-between text-xs font-medium">
            <span className="text-muted-foreground">Min received</span>
            <span className="text-foreground">
              {quote && amountValid
                ? `${Number(applySlippage(quote, slippage)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${outToken}`
                : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-muted-foreground">Max slippage</span>
            <div className="flex items-center gap-1">
              {SLIPPAGE_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSlippage(s)}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-xs font-semibold transition-colors',
                    slippage === s
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {(s * 100).toFixed(s < 0.01 ? 1 : 0)}%
                </button>
              ))}
            </div>
          </div>
        </div>

        {side === 'buyPt' && (
          <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-xs text-muted-foreground">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" />
            <span>
              PT redeems 1:1 for USDC at maturity. Buying below par locks a fixed return — the
              discount is your yield.
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
          ) : null}
          {cta}
        </Button>
      </CardContent>
    </Card>
  );
};

export default TradePanel;
