import { useMemo, useState } from 'react';
import { ArrowDown, Loader2, Wallet, AlertTriangle, ShieldCheck, Lock, ArrowRight, TrendingUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useWallet } from '@/context/WalletContext';
import { useProtocol } from '@/context/ProtocolContext';
import { useNav } from '@/context/NavContext';
import { useTxAction } from '@/lib/useTxAction';
import { mint } from '@/lib/spield';
import { fromBaseUnits, formatAmount } from '@/lib/soroban';
import { setupTrustlines } from '@/lib/horizon';
import { NETWORK, VAULT_DEPLOYED, MARKET_DEPLOYED } from '@/lib/config';

/**
 * Deposit panel — the protocol's primary action.
 *
 * Deposit USDC → the wrapper supplies it to Blend and mints an equal amount of
 * PT (the fixed-rate bond) and YT (the variable yield claim) to the user, opening
 * a new position. 1 USDC → 1 PT + 1 YT.
 */
const DepositPanel = () => {
  const { address, isConnected, connect, connecting, onCorrectNetwork } = useWallet();
  const { balances, paused, trustlines } = useProtocol();
  const { navigate } = useNav();
  const { run, busy } = useTxAction();
  const [amount, setAmount] = useState('');

  const usdcBalance = fromBaseUnits(balances.usdc);
  const parsed = Number(amount);
  const amountValid = amount !== '' && !Number.isNaN(parsed) && parsed > 0;
  const overBalance = amountValid && parsed > usdcBalance;

  // A connected wallet must trust PT + YT before the wrapper can mint to it.
  const needsTrustlines = isConnected && onCorrectNetwork && !trustlines.ready;

  const cta = useMemo(() => {
    if (!isConnected) return 'Connect Wallet';
    if (!onCorrectNetwork) return `Switch to ${NETWORK.name}`;
    if (needsTrustlines) return 'Enable PT & YT';
    if (paused) return 'Protocol Paused';
    if (!amountValid) return 'Enter an amount';
    if (overBalance) return 'Insufficient USDC';
    return 'Deposit & Mint';
  }, [isConnected, onCorrectNetwork, needsTrustlines, paused, amountValid, overBalance]);

  const disabled =
    busy ||
    connecting ||
    (isConnected &&
      !needsTrustlines &&
      (!onCorrectNetwork || paused || !amountValid || overBalance));

  const handleClick = async () => {
    if (!isConnected || !address) {
      await connect();
      return;
    }
    if (needsTrustlines) {
      // One tx adds the missing PT/YT trustlines; `run` refreshes state after.
      await run('Enable PT & YT', async () => {
        const res = await setupTrustlines(address);
        return res ?? { hash: '' };
      });
      return;
    }
    const ok = await run('Deposit', () => mint(address, amount));
    if (ok) setAmount('');
  };

  const setMax = () => setAmount(usdcBalance > 0 ? String(usdcBalance) : '');

  return (
    <Card className="h-full rounded-xl border-border bg-card shadow-sm">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base font-semibold">Deposit</CardTitle>
        <CardDescription className="text-xs">
          Supply USDC to mint a fixed-rate bond (PT) + a yield token (YT)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {/* Pay: USDC */}
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

        {/* Receive: PT + YT */}
        <div className="space-y-1.5">
          <div className="px-0.5 text-xs font-semibold uppercase text-muted-foreground">
            <Label>Receive</Label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-input bg-muted/50 px-3 py-2.5">
              <div className="text-lg font-bold tabular-nums">
                {amountValid ? parsed.toLocaleString() : '0.0'}
              </div>
              <div className="mt-0.5 text-xs font-semibold text-primary">PT · Principal</div>
            </div>
            <div className="rounded-lg border border-input bg-muted/50 px-3 py-2.5">
              <div className="text-lg font-bold tabular-nums">
                {amountValid ? parsed.toLocaleString() : '0.0'}
              </div>
              <div className="mt-0.5 text-xs font-semibold text-amber-500">YT · Yield</div>
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="space-y-1.5 rounded-lg border border-border/50 bg-muted/30 p-3">
          <div className="flex justify-between text-xs font-medium">
            <span className="text-muted-foreground">Yield source</span>
            <span className="text-foreground">Blend (USDC pool)</span>
          </div>
          <div className="flex justify-between text-xs font-medium">
            <span className="text-muted-foreground">You receive</span>
            <span className="text-foreground">
              {amountValid ? `${parsed.toLocaleString()} PT + ${parsed.toLocaleString()} YT` : '— PT + — YT'}
            </span>
          </div>
          <div className="flex justify-between text-xs font-medium">
            <span className="text-muted-foreground">Redeem PT 1:1</span>
            <span className="text-foreground">at maturity</span>
          </div>
        </div>

        {!onCorrectNetwork && isConnected && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-500">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>Your wallet is on the wrong network. Switch Freighter to {NETWORK.name}.</span>
          </div>
        )}

        {needsTrustlines && (
          <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 p-2.5 text-xs text-foreground">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" />
            <span>
              One-time setup: your wallet needs trustlines to receive PT &amp; YT. This is a single,
              free transaction — approve it, then deposit.
            </span>
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
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5 text-left text-xs transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <span className="flex items-center gap-2 text-muted-foreground">
              <Lock size={13} className="shrink-0 text-primary" />
              Want a <span className="font-semibold text-foreground">fixed, guaranteed</span> return
              instead of variable yield?
            </span>
            <span className="flex shrink-0 items-center gap-1 font-semibold text-primary">
              Fixed Vault <ArrowRight size={13} />
            </span>
          </button>
        )}

        {/* Cross-link: already hold PT/YT? Trade them or LP on the Markets AMM. */}
        {MARKET_DEPLOYED && (
          <button
            type="button"
            onClick={() => navigate('markets')}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5 text-left text-xs transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <span className="flex items-center gap-2 text-muted-foreground">
              <TrendingUp size={13} className="shrink-0 text-emerald-500" />
              Already hold PT? <span className="font-semibold text-foreground">Trade it</span> or earn
              fees by providing liquidity.
            </span>
            <span className="flex shrink-0 items-center gap-1 font-semibold text-primary">
              Markets <ArrowRight size={13} />
            </span>
          </button>
        )}
      </CardContent>
    </Card>
  );
};

export default DepositPanel;
