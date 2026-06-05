import { useMemo, useState } from 'react';
import { ArrowDown, Loader2, Wallet, AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useWallet } from '@/context/WalletContext';
import { useProtocol } from '@/context/ProtocolContext';
import { useTxAction } from '@/lib/useTxAction';
import { mint } from '@/lib/spield';
import { fromBaseUnits, formatAmount } from '@/lib/soroban';
import { NETWORK } from '@/lib/config';

/**
 * Deposit panel — the protocol's primary action.
 *
 * Deposit USDC → the wrapper supplies it to Blend and mints an equal amount of
 * PT (the fixed-rate bond) and YT (the variable yield claim) to the user, opening
 * a new position. 1 USDC → 1 PT + 1 YT.
 */
const DepositPanel = () => {
  const { address, isConnected, connect, connecting, onCorrectNetwork } = useWallet();
  const { balances, paused } = useProtocol();
  const { run, busy } = useTxAction();
  const [amount, setAmount] = useState('');

  const usdcBalance = fromBaseUnits(balances.usdc);
  const parsed = Number(amount);
  const amountValid = amount !== '' && !Number.isNaN(parsed) && parsed > 0;
  const overBalance = amountValid && parsed > usdcBalance;

  const cta = useMemo(() => {
    if (!isConnected) return 'Connect Wallet';
    if (!onCorrectNetwork) return `Switch to ${NETWORK.name}`;
    if (paused) return 'Protocol Paused';
    if (!amountValid) return 'Enter an amount';
    if (overBalance) return 'Insufficient USDC';
    return 'Deposit & Mint';
  }, [isConnected, onCorrectNetwork, paused, amountValid, overBalance]);

  const disabled =
    busy ||
    connecting ||
    (isConnected && (!onCorrectNetwork || paused || !amountValid || overBalance));

  const handleClick = async () => {
    if (!isConnected || !address) {
      await connect();
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

export default DepositPanel;
