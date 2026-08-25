import { useMemo, useState } from 'react';
import { ArrowDown, Loader2, Wallet, AlertTriangle, ShieldCheck, Lock, ArrowRight, TrendingUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import AmountField from './AmountField';
import { useWallet } from '@/context/WalletContext';
import { useProtocol } from '@/context/ProtocolContext';
import { useNav } from '@/context/NavContext';
import { useTxAction } from '@/lib/useTxAction';
import { buildMintSteps, redeemPt } from '@/lib/v2adapters';
import { fromBaseUnits, toBaseUnits, formatAmount } from '@/lib/soroban';
import { setupSrPtTrustline } from '@/lib/horizon';
import { NETWORK, VAULT_DEPLOYED, MARKET_DEPLOYED, MIN_MINT_BASE_UNITS } from '@/lib/config';

/**
 * Deposit panel — the protocol's primary action.
 *
 * Deposit USDC → it is wrapped into SR, supplied to Blend, and split into equal amounts of
 * PT (the fixed-rate bond) and YT (the variable yield claim) to the user, opening
 * a new position. 1 USDC → 1 PT + 1 YT.
 *
 * ## Why redemption lives here too
 *
 * Minting and redeeming are **the same operation in opposite directions**, and both settle at par
 * with no curve — which is what distinguishes this page from Markets, where price is everything.
 * Pairing them under one selector says that out loud.
 *
 * It also removes a real duplication. Until 2026-08-26 the identical call
 * (`router.redeem_py_for_usdc`) was reachable from three places: a "Redeem" tab on the Markets
 * panel, and both a "Redeem PT" and a "Combine & Redeem" button on the positions list. Three
 * buttons, one contract function — `combineAndRedeem` was a literal alias of `redeemPt`. A user had
 * to choose between options that did the same thing.
 *
 * ## The one distinction that is real
 *
 * The engine decides what to burn based on expiry, so the *same call* means two things:
 *
 * * **before maturity** — burns PT **and** YT (a recombine), needs both legs, pays face;
 * * **at or after maturity** — burns PT alone, because a matured YT carries no principal claim and
 *   demanding it would strand anyone who had sold theirs.
 *
 * That is worth surfacing rather than hiding, because it changes what the user must hold. The panel
 * labels and caps itself accordingly below.
 */
type Mode = 'deposit' | 'redeem';
const DepositPanel = () => {
  const { address, isConnected, openWalletPicker, connecting, onCorrectNetwork } = useWallet();
  const { balances, paused, trustlines, maturity, lastUpdated } = useProtocol();
  const { navigate } = useNav();
  const { run, runSteps, busy } = useTxAction();
  const [mode, setMode] = useState<Mode>('deposit');
  const [amount, setAmount] = useState('');

  const usdcBalance = fromBaseUnits(balances.usdc);
  const parsed = Number(amount);
  const entered = amount !== '' && !Number.isNaN(parsed) && parsed > 0;

  // Derived from the context's last successful read rather than from `Date.now()`, which is impure
  // during render. It also gets the refresh for free: the context already polls, so this flips over
  // on the next poll after expiry without a second timer of its own.
  //
  // (`PositionsPanel` computes the same thing through a module-level helper. That silences the
  // linter without fixing the impurity — worth aligning if it is touched again.)
  const matured = maturity !== null && lastUpdated !== null && lastUpdated / 1000 >= maturity;
  // A pre-maturity redeem burns BOTH legs, so it is capped by whichever the wallet has less of.
  // After maturity only PT is burned, so PT alone is the cap.
  const redeemCapUnits = matured
    ? balances.pt
    : balances.pt < balances.yt
      ? balances.pt
      : balances.yt;
  const redeemCap = fromBaseUnits(redeemCapUnits);

  // Below SR's minimum, Blend credits 0 shares and the deposit refuses with
  // `InvalidAmount`. Catch it here so the user reads why instead of a failed tx.
  // Redemption has no such floor — it burns tokens that already exist.
  const belowMinimum =
    mode === 'deposit' && entered && toBaseUnits(amount) < MIN_MINT_BASE_UNITS;
  const amountValid = entered && !belowMinimum;
  const overBalance =
    amountValid && (mode === 'deposit' ? parsed > usdcBalance : parsed > redeemCap);

  // A connected wallet must trust PT before the engine can mint to it. YT needs no trustline —
  // it is a hook-bearing contract rather than a classic asset, which is what lets it settle
  // interest on transfer at all.
  const needsTrustlines = isConnected && onCorrectNetwork && !trustlines.ready;

  const cta = useMemo(() => {
    if (!isConnected) return 'Connect Wallet';
    if (!onCorrectNetwork) return `Switch to ${NETWORK.name}`;
    // Redemption is an EXIT. It is deliberately not gated on the trustline (the wallet already
    // holds PT, so it necessarily has one) nor on the pause (an exit must stay open while paused).
    if (mode === 'redeem') {
      if (!amountValid) return 'Enter an amount';
      if (overBalance) return matured ? 'Insufficient PT' : 'Insufficient PT + YT';
      return matured ? 'Redeem at par' : 'Combine PT + YT';
    }
    if (needsTrustlines) return 'Enable PT';
    if (paused) return 'Protocol Paused';
    if (belowMinimum) return 'Amount too small';
    if (!amountValid) return 'Enter an amount';
    if (overBalance) return 'Insufficient USDC';
    return 'Deposit & Mint';
  }, [
    mode,
    matured,
    isConnected,
    onCorrectNetwork,
    needsTrustlines,
    paused,
    amountValid,
    belowMinimum,
    overBalance,
  ]);

  const disabled =
    busy ||
    connecting ||
    (isConnected &&
      (mode === 'redeem'
        ? // No pause gate: exits stay open.
          !onCorrectNetwork || !amountValid || overBalance
        : !needsTrustlines && (!onCorrectNetwork || paused || !amountValid || overBalance)));

  const handleClick = async () => {
    if (!isConnected || !address) {
      openWalletPicker();
      return;
    }
    if (mode === 'redeem') {
      // One transaction either way — the engine reads expiry and burns one leg or two.
      const ok = await run(matured ? 'Redeem at par' : 'Combining PT + YT', () =>
        redeemPt(address, 0, amount),
      );
      if (ok) setAmount('');
      return;
    }
    if (needsTrustlines) {
      // One tx adds the missing PT/YT trustlines; `run` refreshes state after.
      await run('Enable PT', async () => {
        const res = await setupSrPtTrustline(address);
        return res ?? { hash: '' };
      });
      return;
    }
    // Two transactions (wrap, then split) — see `v2adapters.buildMintSteps`. `runSteps` puts both
    // under one toast with real progress, instead of a single spinner spanning two wallet prompts.
    const steps = await buildMintSteps(address, amount);
    if (!steps) return;
    const ok = await runSteps('Deposit', steps);
    if (ok) setAmount('');
  };

  const setMax = () => {
    const max = mode === 'deposit' ? usdcBalance : redeemCap;
    setAmount(max > 0 ? String(max) : '');
  };

  return (
    <Card className="h-full rounded-xl">
      <CardHeader>
        <CardTitle>{mode === 'deposit' ? 'Deposit' : matured ? 'Redeem' : 'Combine'}</CardTitle>
        <CardDescription>
          {mode === 'deposit'
            ? 'Supply USDC to mint a fixed-rate bond (PT) + a yield token (YT)'
            : matured
              ? 'Burn PT for its face value in USDC — par, no curve, no slippage'
              : 'Burn PT + YT together to exit at face value, without paying the spread'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Mode selector.
            Minting and redeeming are the same operation in opposite directions, and both settle at
            par. Pairing them here is what let the duplicate "Redeem" tab come off the Markets panel
            and both action buttons come off the positions list. */}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/50 p-1">
          {(['deposit', 'redeem'] as const).map((m) => (
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
              <span className="block">
                {m === 'deposit' ? 'Deposit' : matured ? 'Redeem' : 'Combine'}
              </span>
              <span className="block text-[10px] opacity-70">
                {m === 'deposit'
                  ? 'USDC → PT + YT'
                  : matured
                    ? 'PT → USDC'
                    : 'PT + YT → USDC'}
              </span>
            </button>
          ))}
        </div>

        {/* Pay */}
        {mode === 'deposit' ? (
          <AmountField
            label="Deposit"
            token="USDC"
            value={amount}
            onChange={setAmount}
            balance={`${isConnected ? formatAmount(balances.usdc) : '0.00'} USDC`}
            onMax={isConnected ? setMax : undefined}
            invalid={overBalance}
          />
        ) : (
          <AmountField
            label={matured ? 'You burn' : 'You burn (equal PT + YT)'}
            token={matured ? 'PT' : 'PT + YT'}
            value={amount}
            onChange={setAmount}
            balance={`${isConnected ? formatAmount(redeemCapUnits) : '0.00'} available`}
            onMax={isConnected ? setMax : undefined}
            invalid={overBalance}
          />
        )}

        <div className="flex items-center gap-3 py-0.5">
          <span className="rule-soft flex-1" aria-hidden="true" />
          <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-card text-subtle shadow-float-sm">
            <ArrowDown size={12} />
          </span>
          <span className="rule-soft flex-1" aria-hidden="true" />
        </div>

        {/* Receive */}
        {mode === 'deposit' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <AmountField
              label="You receive"
              token="PT"
              value={amountValid ? parsed.toLocaleString() : ''}
              hint="Redeems 1:1 at maturity"
              hintTone="brand"
            />
            <AmountField
              label="You receive"
              token="YT"
              value={amountValid ? parsed.toLocaleString() : ''}
              hint="Variable · claim anytime"
              hintTone="ember"
            />
          </div>
        ) : (
          <AmountField
            label="You receive"
            token="USDC"
            value={amountValid ? parsed.toLocaleString() : ''}
            hint="Face value · no curve, no slippage"
            hintTone="brand"
          />
        )}

        {/* Summary */}
        <div className="space-y-1.5 well rounded-lg p-3">
          {mode === 'deposit' ? (
            <>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-muted-foreground">Yield source</span>
                <span className="text-foreground">Blend (USDC pool)</span>
              </div>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-muted-foreground">You receive</span>
                <span className="text-foreground">
                  {amountValid
                    ? `${parsed.toLocaleString()} PT + ${parsed.toLocaleString()} YT`
                    : '— PT + — YT'}
                </span>
              </div>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-muted-foreground">Redeem PT 1:1</span>
                <span className="text-foreground">at maturity</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-muted-foreground">You burn</span>
                <span className="text-foreground">
                  {amountValid
                    ? matured
                      ? `${parsed.toLocaleString()} PT`
                      : `${parsed.toLocaleString()} PT + ${parsed.toLocaleString()} YT`
                    : '—'}
                </span>
              </div>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-muted-foreground">Price</span>
                <span className="text-foreground">Face value — no curve</span>
              </div>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-muted-foreground">
                  {matured ? 'YT no longer required' : 'Needs both legs'}
                </span>
                <span className="text-foreground">
                  {matured ? 'matured' : 'equal PT + YT'}
                </span>
              </div>
            </>
          )}
        </div>

        {/* The one thing about this call a user cannot guess: the same button burns one leg or two
            depending on expiry, and before maturity it needs BOTH. Say it rather than letting them
            find out from a reverted transaction. */}
        {mode === 'redeem' && !matured && (
          <p className="text-xs text-muted-foreground">
            Before maturity this burns equal PT <em>and</em> YT and returns face value — no spread,
            but it needs both legs. Holding only PT? Sell it on the{' '}
            <button
              type="button"
              onClick={() => navigate('markets')}
              className="font-medium text-brand-text underline underline-offset-2"
            >
              market
            </button>{' '}
            instead, or wait for maturity.
          </p>
        )}

        {!onCorrectNetwork && isConnected && (
          <div className="flex items-start gap-2 rounded-lg border border-ember/30 bg-ember/10 p-2.5 text-xs text-ember-text">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>Your wallet is on the wrong network. Switch Freighter to {NETWORK.name}.</span>
          </div>
        )}

        {needsTrustlines && (
          <div className="space-y-2 rounded-xl border border-brand/25 bg-primary/[0.07] p-4 text-xs">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <ShieldCheck size={15} className="shrink-0 text-brand-text" />
              One-time wallet setup — takes 5 seconds
            </div>
            <p className="text-muted-foreground leading-relaxed">
              Before you can receive PT, your wallet needs to &quot;trust&quot; it — PT is an ordinary
              Stellar asset, and Stellar asks first. This is a{' '}
              <span className="font-semibold text-foreground">free, one-click step</span> and no USDC
              leaves your wallet. YT needs nothing: it is a contract rather than a classic asset,
              which is exactly what lets it carry your yield when it moves.
            </p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Click <span className="font-medium text-foreground">Enable PT</span> below</li>
              <li>Approve the transaction in Freighter (no cost)</li>
              <li>Come back here and deposit your USDC</li>
            </ol>
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
          ) : needsTrustlines ? (
            <ShieldCheck size={15} />
          ) : null}
          {cta}
        </Button>

        {/* Cross-link: this is the raw PT/YT door. Point users wanting a fixed return to the
            Fixed Vault, which does this same mint under the hood and hands back a fixed payout. */}
        {VAULT_DEPLOYED && (
          <button
            type="button"
            onClick={() => navigate('vault')}
            className="flex w-full items-center justify-between gap-3 well rounded-lg px-3 py-2.5 text-left text-[12.5px] leading-relaxed transition-colors duration-200 hover:border-brand/40"
          >
            <span className="flex min-w-0 items-start gap-2 text-muted-foreground">
              <Lock size={13} className="mt-px shrink-0 text-brand-text" />
              <span>
                Want a <span className="font-medium text-foreground">fixed, guaranteed</span> return
                instead of variable yield?
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 font-medium text-brand-text">
              Fixed Vault <ArrowRight size={13} />
            </span>
          </button>
        )}

        {/* Cross-link to Markets.
            This used to read "already hold PT? trade it", which only covered the exit. The commoner
            reason to go to Markets is the *entry*: this page splits at par (1 USDC -> 1 PT + 1 YT,
            no curve), while Markets buys PT at a discount — and that discount IS the fixed return.
            A user who does not know the difference will pick whichever page they landed on. */}
        {MARKET_DEPLOYED && (
          <button
            type="button"
            onClick={() => navigate('markets')}
            className="flex w-full items-center justify-between gap-3 well rounded-lg px-3 py-2.5 text-left text-[12.5px] leading-relaxed transition-colors duration-200 hover:border-brand/40"
          >
            <span className="flex min-w-0 items-start gap-2 text-muted-foreground">
              <TrendingUp size={13} className="mt-px shrink-0 text-brand-text" />
              <span>
                This page splits at <span className="font-medium text-foreground">par</span> — you
                get both legs and no discount. To{' '}
                <span className="font-medium text-foreground">buy PT below par</span> and lock that
                gap as a fixed return, or to sell either leg, use the market.
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 font-medium text-brand-text">
              Markets <ArrowRight size={13} />
            </span>
          </button>
        )}
      </CardContent>
    </Card>
  );
};

export default DepositPanel;
