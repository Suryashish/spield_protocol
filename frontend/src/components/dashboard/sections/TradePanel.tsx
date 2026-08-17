import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, Loader2, Wallet, AlertTriangle, ShieldCheck, TrendingUp, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import AmountField from './AmountField';
import { useWallet } from '@/context/WalletContext';
import { useProtocol } from '@/context/ProtocolContext';
import { useTxAction } from '@/lib/useTxAction';
import { buyPt, sellPt, quoteSwap, buildBuyYtSteps } from '@/lib/market';
import { mint } from '@/lib/spield';
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

type Mode = 'buyPt' | 'sellPt' | 'longYt';

const fmtTok = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 6 });

/**
 * Trade panel — three flows over the time-decay curve, all through the shared tx lifecycle.
 *
 * **Earn Fixed** (buy PT): pay USDC, hold PT to maturity, redeem 1:1 → a fixed return locked at the
 * implied APY. **Sell PT**: exit a PT holding back to USDC at the market price. **Long Yield** (YT):
 * a *routed* trade with no YT pool — mint PT+YT via the wrapper, then sell the PT back into the
 * market; the user keeps the YT for a net cost of `usdcIn − (PT sale proceeds)`, a leveraged bet
 * that real Blend yield beats the implied rate.
 */
const TradePanel = () => {
  const { address, isConnected, openWalletPicker, connecting, onCorrectNetwork } = useWallet();
  const { balances, trustlines, marketStats } = useProtocol();
  const { run, runSteps, busy } = useTxAction();

  const [mode, setMode] = useState<Mode>('buyPt');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(0.01);
  // For buyPt/sellPt: the swap output. For longYt: the PT-sale proceeds (USDC recovered).
  const [quote, setQuote] = useState<bigint | null>(null);
  const [quoting, setQuoting] = useState(false);

  // The input token + balance differ per mode. longYt and buyPt both spend USDC.
  const inToken = mode === 'sellPt' ? 'PT' : 'USDC';
  const outToken = mode === 'buyPt' ? 'PT' : mode === 'sellPt' ? 'USDC' : 'YT';
  const inBalance = mode === 'sellPt' ? balances.pt : balances.usdc;
  const inBalanceHuman = fromBaseUnits(inBalance);

  const parsed = Number(amount);
  const amountValid = amount !== '' && !Number.isNaN(parsed) && parsed > 0;
  const overBalance = amountValid && parsed > inBalanceHuman;

  // Receiving PT or YT requires the PT/YT trustlines; selling PT does not.
  const needsTrustlines = mode !== 'sellPt' && isConnected && onCorrectNetwork && !trustlines.ready;

  // The quote side: longYt prices the PT it will sell (== amount of USDC minted into PT), so it uses
  // the sell-PT quote on `amount`. buyPt/sellPt quote directly.
  const quoteSide = mode === 'sellPt' ? 'sellPt' : mode === 'buyPt' ? 'buyPt' : 'sellPt';

  // Debounced live quote whenever amount/mode changes.
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
      const q = await quoteSwap(quoteSide, amount);
      if (!cancelled) {
        setQuote(q);
        setQuoting(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [amount, quoteSide, amountValid]);

  const poolHasLiquidity = !!marketStats && marketStats.ptReserve > 0n && marketStats.usdcReserve > 0n;
  const exceedsLiquidity =
    amountValid && !quoting && !overBalance && poolHasLiquidity && (quote === null || quote === 0n);

  // longYt derived figures: YT received == amount (1 USDC mints 1 PT + 1 YT); net cost = usdcIn − proceeds.
  const ytReceived = parsed; // 1:1 mint
  const usdcRecovered = quote != null ? fromBaseUnits(quote) : 0;
  const ytNetCost = amountValid && quote != null ? Math.max(0, parsed - usdcRecovered) : 0;
  // Implied "leverage": how much YT face you control per USDC actually spent.
  const ytLeverage = ytNetCost > 0 ? ytReceived / ytNetCost : 0;

  const cta = useMemo(() => {
    if (!MARKET_DEPLOYED) return 'Market not deployed';
    if (!isConnected) return 'Connect Wallet';
    if (!onCorrectNetwork) return `Switch to ${NETWORK.name}`;
    if (needsTrustlines) return 'Enable PT & YT';
    if (!amountValid) return 'Enter an amount';
    if (overBalance) return `Insufficient ${inToken}`;
    if (!poolHasLiquidity) return 'No liquidity';
    if (exceedsLiquidity) return 'Amount exceeds liquidity';
    return mode === 'buyPt' ? 'Buy PT' : mode === 'sellPt' ? 'Sell PT' : 'Long Yield (Buy YT)';
  }, [
    isConnected,
    onCorrectNetwork,
    needsTrustlines,
    amountValid,
    overBalance,
    poolHasLiquidity,
    exceedsLiquidity,
    mode,
    inToken,
  ]);

  const disabled =
    !MARKET_DEPLOYED ||
    busy ||
    connecting ||
    (isConnected &&
      !needsTrustlines &&
      (!onCorrectNetwork ||
        !amountValid ||
        overBalance ||
        !poolHasLiquidity ||
        exceedsLiquidity ||
        !quote));

  const handleClick = async () => {
    if (!isConnected || !address) {
      openWalletPicker();
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

    if (mode === 'longYt') {
      // Routed: mint PT+YT, then sell the PT. Built from the live quote so the sell leg is bounded.
      const steps = await buildBuyYtSteps(address, amount, slippage, mint);
      if (!steps) return;
      const ok = await runSteps('Long Yield', steps);
      if (ok) setAmount('');
      return;
    }

    const minOut = applySlippage(quote, slippage);
    const label = mode === 'buyPt' ? 'Buy PT' : 'Sell PT';
    const ok = await run(label, () =>
      mode === 'buyPt' ? buyPt(address, amount, minOut) : sellPt(address, amount, minOut),
    );
    if (ok) setAmount('');
  };

  const setMax = () => setAmount(inBalanceHuman > 0 ? String(inBalanceHuman) : '');

  const outHuman = quote != null ? fromBaseUnits(quote) : 0;
  // Effective PT price for the simple swaps.
  const effPrice =
    quote && amountValid && mode !== 'longYt'
      ? mode === 'buyPt'
        ? parsed / outHuman // USDC paid per PT received
        : outHuman / parsed // USDC received per PT sold
      : 0;

  const TABS: { id: Mode; label: string }[] = [
    { id: 'buyPt', label: 'Earn Fixed' },
    { id: 'sellPt', label: 'Sell PT' },
    { id: 'longYt', label: 'Long Yield' },
  ];

  return (
    <Card className="h-full rounded-xl">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2">
          <TrendingUp size={16} className="text-brand-text" />
          Trade
        </CardTitle>
        <CardDescription>
          Buy PT for a fixed return, sell PT to exit, or long YT to bet on yield.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {/* Mode toggle */}
        <div className="grid grid-cols-3 gap-1 well rounded-lg p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setMode(t.id);
                setAmount('');
                setQuote(null);
              }}
              className={cn(
                'rounded-md px-2 py-1.5 text-xs font-semibold transition-all',
                mode === t.id
                  ? 'border border-border bg-card text-foreground shadow-float-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Pay */}
        <AmountField
          label={mode === 'longYt' ? 'You spend (upfront)' : 'You pay'}
          token={inToken}
          value={amount}
          onChange={setAmount}
          disabled={!MARKET_DEPLOYED}
          balance={`${isConnected ? formatAmount(inBalance) : '0.00'} ${inToken}`}
          onMax={isConnected ? setMax : undefined}
          invalid={overBalance}
        />

        <div className="flex items-center gap-3 py-0.5">
          <span className="rule-soft flex-1" aria-hidden="true" />
          <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-card text-subtle shadow-float-sm">
            <ArrowDown size={12} />
          </span>
          <span className="rule-soft flex-1" aria-hidden="true" />
        </div>

        {/* Receive */}
        <AmountField
          label={mode === 'longYt' ? 'You receive (YT)' : 'You receive (est.)'}
          token={outToken}
          value={
            amountValid && quote != null
              ? fmtTok(mode === 'longYt' ? ytReceived : outHuman)
              : ''
          }
          loading={quoting}
        />

        {/* Summary */}
        <div className="space-y-1.5 well rounded-lg p-3">
          {mode === 'longYt' ? (
            <>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-muted-foreground">USDC recovered (PT sale)</span>
                <span className="text-foreground">
                  {amountValid && quote != null ? `${fmtTok(usdcRecovered)} USDC` : '—'}
                </span>
              </div>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-muted-foreground">Net YT cost</span>
                <span className="font-semibold text-ember-text">
                  {amountValid && quote != null ? `${fmtTok(ytNetCost)} USDC` : '—'}
                </span>
              </div>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-muted-foreground">Effective exposure</span>
                <span className="text-foreground">
                  {ytLeverage > 1 ? `~${ytLeverage.toFixed(1)}× YT per USDC` : '—'}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-muted-foreground">Price</span>
                <span className="text-foreground">
                  {effPrice > 0 ? `${effPrice.toFixed(4)} USDC / PT` : '—'}
                </span>
              </div>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-muted-foreground">Min received</span>
                <span className="text-foreground">
                  {quote && amountValid
                    ? `${fmtTok(Number(applySlippage(quote, slippage)))} ${outToken}`
                    : '—'}
                </span>
              </div>
            </>
          )}
          <div className="flex items-center justify-between text-[12.5px]">
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
                      ? 'bg-brand/15 text-brand-text'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {(s * 100).toFixed(s < 0.01 ? 1 : 0)}%
                </button>
              ))}
            </div>
          </div>
        </div>

        {mode === 'buyPt' && (
          <div className="flex items-start gap-2 rounded-lg border border-brand/20 bg-brand/5 p-2.5 text-xs text-muted-foreground">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-brand-text" />
            <span>
              PT redeems 1:1 for USDC at maturity. Buying below par locks a fixed return — the
              discount is your yield.
            </span>
          </div>
        )}

        {mode === 'longYt' && (
          <div className="flex items-start gap-2 rounded-lg border border-ember/20 bg-ember/5 p-2.5 text-xs text-muted-foreground">
            <Zap size={14} className="mt-0.5 shrink-0 text-ember-text" />
            <span>
              <span className="font-semibold text-foreground">2 transactions:</span> mint PT + YT,
              then sell the PT back. You keep the YT — a leveraged bet that real Blend yield beats the
              implied rate. Profit if it does; the net cost is your max loss.
            </span>
          </div>
        )}

        {!onCorrectNetwork && isConnected && (
          <div className="flex items-start gap-2 rounded-lg border border-ember/30 bg-ember/10 p-2.5 text-xs text-ember-text">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>Your wallet is on the wrong network. Switch Freighter to {NETWORK.name}.</span>
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
          ) : null}
          {cta}
        </Button>
      </CardContent>
    </Card>
  );
};

export default TradePanel;
