import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown,
  Loader2,
  Wallet,
  AlertTriangle,
  ShieldCheck,
  TrendingUp,
  Layers,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import AmountField from './AmountField';
import { useWallet } from '@/context/WalletContext';
import { useTxAction } from '@/lib/useTxAction';
import { fromBaseUnits, toBaseUnits } from '@/lib/soroban';
import { setupSrPtTrustline } from '@/lib/horizon';
import { SR_CONTRACTS, SR_DEPLOYED } from '@/lib/config';
import {
  getExchangeRate,
  getMarketStats,
  getPortfolio,
  ROUTER_AVAILABLE,
  quoteBuyPtWithUsdc,
  quoteSellPtForUsdc,
  quoteBuyYtFromUsdc,
  quoteSellYtForUsdc,
  quoteRedeemPyForUsdc,
  solveYtFaceForUsdc,
  buyPtWithUsdc,
  sellPtForUsdc,
  buyYtFromUsdc,
  sellYtToUsdc,
  redeemPyForUsdc,
  impliedApyPct,
  ptPriceHuman,
  daysToExpiry,
  isMatured,
  type SrMarketStats,
  type SrPortfolio,
} from '@/lib/srstack';

type Mode = 'buyPt' | 'sellPt' | 'buyYt' | 'sellYt' | 'redeem';

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'buyPt', label: 'Earn fixed', hint: 'USDC → PT' },
  { id: 'buyYt', label: 'Long yield', hint: 'USDC → YT' },
  { id: 'sellPt', label: 'Sell PT', hint: 'PT → USDC' },
  { id: 'sellYt', label: 'Sell YT', hint: 'YT → USDC' },
  { id: 'redeem', label: 'Redeem', hint: 'PT → USDC at par' },
];

const fmtTok = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 6 });

/**
 * **Spield v2 trading — denominated in USDC end to end.**
 *
 * The contracts speak SR. Users do not, and should not have to: the SR hop is real, but it is
 * plumbing, and a panel that made people wrap first was a panel that asked them to learn the
 * protocol's internals before they could use it. Everything here routes through `srrouter`, which
 * does USDC → SR → PT/YT (and back) in **one signature**, holds nothing, and refunds the change.
 *
 * Wrapping is still a first-class thing you can do — it lives in its own section, for the users who
 * genuinely want to hold SR itself. This panel is for the ones who just want a position.
 *
 * ## Four things this panel has to get right
 *
 * * **YT is priced exact-output, but people budget in dollars.** The contract must name the YT face
 *   (the payment is derived on chain from a live index, and a wallet signs simulation-time amounts
 *   — see `srstack.buyYtFromUsdc`). So the input here is USDC and we invert the quote client-side
 *   via `solveYtFaceForUsdc`. The user never sees the mismatch.
 * * **YT takes two signatures, and the panel says so up front.** A Blend supply plus a curve trade
 *   exceeds one Soroban transaction against Blend's pool — measured, not assumed. Surfacing that
 *   before the first prompt is the difference between "as expected" and "why is it asking again".
 * * **Only PT needs a trustline.** Buying YT delivers no PT, so we do not make long-yield buyers
 *   trust an asset they will never hold.
 * * **At maturity the market closes and redemption opens.** These are different code paths, and the
 *   panel switches over rather than letting a matured user press a button that cannot work.
 * * **Selling YT credits yield without paying it.** The claim survives the sale. Said out loud,
 *   because a balance going to zero looks like a loss otherwise.
 */
const SrTradePanel = () => {
  const { address, isConnected, openWalletPicker, connecting, onCorrectNetwork } = useWallet();
  const { run, busy } = useTxAction();

  const [rawMode, setMode] = useState<Mode>('buyPt');
  const [amount, setAmount] = useState('');
  const [stats, setStats] = useState<SrMarketStats | null>(null);
  const [portfolio, setPortfolio] = useState<SrPortfolio | null>(null);
  const [, setRate] = useState<bigint>(10n ** 12n);
  const [quote, setQuote] = useState<bigint | null>(null);
  /** For the YT buy: the face the solver landed on for the user's USDC budget. */
  const [ytFace, setYtFace] = useState<bigint>(0n);
  /**
   * "1 of 2" / "2 of 2" while a YT buy runs. YT is the one flow that needs two signatures (see
   * `srstack.buyYtFromUsdc`), and going quiet between two wallet prompts reads as a hang.
   */
  const [ytStep, setYtStep] = useState<string | null>(null);
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

  const matured = isMatured(stats);

  // At maturity the market stops trading and `redeem_py_for_usdc` becomes the only exit. Derived
  // rather than pushed into state by an effect: maturity is a fact about the series, not a user
  // choice, so writing it back into `mode` would just be a second source of truth to keep in sync.
  const mode: Mode = matured ? 'redeem' : rawMode;

  const parsed = Number(amount);
  const amountValid = amount !== '' && !Number.isNaN(parsed) && parsed > 0;

  const payToken = mode === 'buyPt' || mode === 'buyYt' ? 'USDC' : mode === 'sellYt' ? 'YT' : 'PT';
  const getToken = mode === 'buyPt' ? 'PT' : mode === 'buyYt' ? 'YT' : 'USDC';

  const payBalance =
    payToken === 'USDC'
      ? (portfolio?.usdc ?? 0n)
      : payToken === 'PT'
        ? (portfolio?.pt ?? 0n)
        : (portfolio?.yt ?? 0n);
  const payBalanceHuman = fromBaseUnits(payBalance);
  const overBalance = amountValid && parsed > payBalanceHuman;

  // Only PT delivery needs the trustline.
  const deliversPt = mode === 'buyPt';
  const needsTrustline =
    deliversPt && isConnected && onCorrectNetwork && portfolio?.hasPtTrustline === false;

  // A pre-maturity redeem is a recombine: it burns BOTH legs, so it needs both.
  const recombine = mode === 'redeem' && !matured;
  const redeemCap = recombine
    ? (portfolio && portfolio.pt < portfolio.yt ? portfolio.pt : portfolio?.yt) ?? 0n
    : (portfolio?.pt ?? 0n);

  // Live quote, debounced.
  useEffect(() => {
    let cancelled = false;
    // No `setQuote(null)` here: writing state synchronously from an effect cascades a render, and
    // it is unnecessary — every consumer below already gates on `amountValid`, so a stale quote is
    // never displayed while the field is empty.
    if (!amountValid) return;
    const timer = setTimeout(async () => {
      // The spinner is raised inside the debounce rather than before it, so it tracks real network
      // work instead of flickering on every keystroke.
      setQuoting(true);
      const units = toBaseUnits(amount);
      let q = 0n;
      let face = 0n;
      if (mode === 'buyPt') q = await quoteBuyPtWithUsdc(units);
      else if (mode === 'sellPt') q = await quoteSellPtForUsdc(units);
      else if (mode === 'buyYt') {
        // Invert: the user gave a budget, the contract needs a face.
        face = await solveYtFaceForUsdc(units);
        q = face > 0n ? await quoteBuyYtFromUsdc(face) : 0n;
      } else if (mode === 'sellYt') q = await quoteSellYtForUsdc(units);
      else if (mode === 'redeem') q = await quoteRedeemPyForUsdc(units);
      if (!cancelled) {
        setQuote(q);
        setYtFace(face);
        setQuoting(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setQuoting(false);
    };
  }, [amount, amountValid, mode]);

  const onSubmit = async () => {
    if (!address || !amountValid) return;
    const units = toBaseUnits(amount);
    const label = {
      buyPt: 'Buying PT with USDC',
      sellPt: 'Selling PT for USDC',
      buyYt: 'Buying YT with USDC',
      sellYt: 'Selling YT for USDC',
      redeem: recombine ? 'Redeeming PT + YT at par' : 'Redeeming PT at par',
    }[mode];

    await run(label, async () => {
      switch (mode) {
        case 'buyPt':
          return buyPtWithUsdc(address, amount);
        case 'sellPt':
          return sellPtForUsdc(address, units);
        case 'buyYt':
          if (ytFace <= 0n) throw new Error('No fillable size at that budget — try less.');
          return buyYtFromUsdc(address, ytFace, (step, of) => setYtStep(of > 1 ? `${step === 'wrap' ? 1 : 2} of ${of}` : null));
        case 'sellYt':
          // Two transactions — see `srstack.sellYtToUsdc`. Same shape as the buy.
          return sellYtToUsdc(address, units, (step, of) =>
            setYtStep(`${step === 'sell' ? 1 : 2} of ${of}`),
          );
        case 'redeem':
          return redeemPyForUsdc(address, units);
      }
    });
    setAmount('');
    setYtStep(null);
    void refresh();
  };

  const onTrustline = async () => {
    if (!address || !SR_CONTRACTS) return;
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

  if (!ROUTER_AVAILABLE) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Spield v2 — Trade</CardTitle>
          <CardDescription>The one-transaction router is not deployed here yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            You can still trade by wrapping USDC into SR first — see the SR Wrapper section — and
            using the market directly. The router only removes signatures; it is not required.
          </p>
        </CardContent>
      </Card>
    );
  }

  const quoteHuman = quote !== null ? fromBaseUnits(quote) : null;
  const ytFaceHuman = fromBaseUnits(ytFace);
  const leverage = mode === 'buyYt' && quote && quote > 0n ? Number(ytFace) / Number(quote) : 0;

  // What the "you receive" box shows. For a YT buy the quote is the *cost*, not the output.
  const receiveDisplay = !amountValid
    ? '—'
    : mode === 'buyYt'
      ? ytFace > 0n
        ? fmtTok(ytFaceHuman)
        : 'no quote'
      : quoteHuman !== null && quoteHuman > 0
        ? fmtTok(quoteHuman)
        : 'no quote';

  const noFill =
    amountValid && !quoting && (mode === 'buyYt' ? ytFace === 0n : quote === null || quote === 0n);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-4 w-4" aria-hidden />
          Trade — PT / YT
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
        <div className="flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/5 px-2.5 py-1.5 text-xs">
          <Zap className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          <span className="text-muted-foreground">
            One signature, straight from USDC. The SR wrap happens inside the transaction.
          </span>
        </div>

        {/* Mode picker */}
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/50 p-1">
          {MODES.map((m) => {
            const disabled = matured && m.id !== 'redeem';
            return (
              <button
                key={m.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setMode(m.id);
                  setAmount('');
                  setQuote(null);
                  setYtFace(0n);
                }}
                className={cn(
                  'rounded-md px-2 py-1.5 text-xs font-medium transition',
                  mode === m.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                  disabled && 'cursor-not-allowed opacity-40 hover:text-muted-foreground',
                )}
              >
                <span className="block">{m.label}</span>
                <span className="block text-[10px] opacity-70">{m.hint}</span>
              </button>
            );
          })}
        </div>

        {matured && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
            <span>
              This series has matured, so the market is closed. PT now redeems at par with no
              slippage and no liquidity needed — and any yield you accrued is still claimable below.
            </span>
          </div>
        )}

        <AmountField
          label={
            mode === 'buyYt'
              ? 'You spend (USDC)'
              : mode === 'redeem'
                ? `You redeem (${recombine ? 'PT + YT' : 'PT'})`
                : `You pay (${payToken})`
          }
          value={amount}
          onChange={setAmount}
          balance={String(mode === 'redeem' ? fromBaseUnits(redeemCap) : payBalanceHuman)}
          onMax={() =>
            setAmount(String(mode === 'redeem' ? fromBaseUnits(redeemCap) : payBalanceHuman))
          }
        />

        <div className="flex justify-center">
          <ArrowDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>

        {/* Output preview */}
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              You receive ({mode === 'redeem' ? 'USDC' : getToken})
            </span>
            <span className="font-medium tabular-nums">
              {quoting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                receiveDisplay
              )}
            </span>
          </div>

          {mode === 'buyYt' && leverage > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-500">
              <TrendingUp className="h-3.5 w-3.5" aria-hidden />
              <span>
                {leverage.toFixed(1)}× leverage — {fmtTok(ytFaceHuman)} of yield exposure for{' '}
                {fmtTok(quoteHuman ?? 0)} USDC
              </span>
            </div>
          )}

          {mode === 'buyPt' && quoteHuman !== null && quoteHuman > 0 && amountValid && (
            <p className="mt-2 text-xs text-muted-foreground">
              {fmtTok(quoteHuman - parsed)} USDC of fixed return, locked in now and paid at maturity.
            </p>
          )}

          {mode === 'redeem' && (
            <p className="mt-2 text-xs text-muted-foreground">
              {recombine
                ? 'Before maturity this burns both legs and returns face value — no spread, but it needs equal PT and YT.'
                : 'Par value, paid from the engine. No curve, no slippage, no liquidity required.'}
            </p>
          )}

          {mode === 'buyYt' && (
            <p className="mt-2 text-xs text-muted-foreground">
              Buying YT takes two signatures — wrap, then buy. A Blend deposit and a curve trade do
              not fit in one Stellar transaction. If you already hold enough SR, it is just one.
            </p>
          )}

          {mode === 'sellYt' && (
            <p className="mt-2 text-xs text-muted-foreground">
              Two signatures — sell, then unwrap; a market sale and a Blend withdrawal do not fit in
              one Stellar transaction. Selling credits the yield you have already earned rather than
              paying it out: it stays claimable in the Yield card, and the sale cannot strand it.
            </p>
          )}

          {noFill && (
            <p className="mt-2 text-xs text-muted-foreground">
              The pool cannot fill that size right now. Try a smaller amount — this is a liquidity
              limit, not a problem with your position.
            </p>
          )}
        </div>

        {overBalance && mode !== 'redeem' && (
          <p className="text-xs text-destructive">That is more {payToken} than this wallet holds.</p>
        )}
        {mode === 'redeem' && amountValid && toBaseUnits(amount) > redeemCap && (
          <p className="text-xs text-destructive">
            {recombine
              ? 'A pre-maturity redeem burns both legs, so it is capped by whichever of your PT and YT is smaller.'
              : 'That is more PT than this wallet holds.'}
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
                quoting ||
                noFill ||
                (mode === 'redeem' ? toBaseUnits(amount) > redeemCap : overBalance || matured)
              }
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              {busy && ytStep
                ? `Signature ${ytStep}…`
                : MODES.find((m) => m.id === mode)?.label}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default SrTradePanel;
