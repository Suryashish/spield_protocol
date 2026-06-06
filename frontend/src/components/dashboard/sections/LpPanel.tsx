import { useMemo, useState } from 'react';
import { Loader2, Wallet, AlertTriangle, Droplets, Plus, Minus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useWallet } from '@/context/WalletContext';
import { useProtocol } from '@/context/ProtocolContext';
import { useTxAction } from '@/lib/useTxAction';
import { addLiquidity, removeLiquidity } from '@/lib/market';
import { setupTrustlines } from '@/lib/horizon';
import { fromBaseUnits, formatAmount, formatUsd } from '@/lib/soroban';
import { NETWORK, MARKET_DEPLOYED } from '@/lib/config';

type Mode = 'add' | 'remove';

/**
 * Liquidity panel — add or remove PT/USDC liquidity to earn the swap fee.
 *
 * **Add**: the pool requires a balanced deposit (matching its current PT:USDC ratio), so we mirror
 * the PT amount into the USDC side at the live ratio. **Remove**: burn LP shares back to a
 * proportional slice of both reserves. An "IL if you exit now vs at maturity" note turns the curve's
 * main selling point into UX: hold to maturity and PT marches to par along the curve, ~no IL.
 */
const LpPanel = () => {
  const { address, isConnected, openWalletPicker, connecting, onCorrectNetwork } = useWallet();
  const { balances, marketStats: m, lpPosition, trustlines } = useProtocol();
  const { run, busy } = useTxAction();

  const [mode, setMode] = useState<Mode>('add');
  const [ptAmount, setPtAmount] = useState('');
  const [removePct, setRemovePct] = useState(100);

  // Current pool ratio (USDC per PT). Used to mirror the add-liquidity USDC side.
  const ratio = useMemo(() => {
    if (!m || m.ptReserve === 0n) return 1; // empty pool → 1:1 (first LP sets the price)
    return fromBaseUnits(m.usdcReserve) / fromBaseUnits(m.ptReserve);
  }, [m]);

  const ptParsed = Number(ptAmount);
  const ptValid = ptAmount !== '' && !Number.isNaN(ptParsed) && ptParsed > 0;
  const usdcNeeded = ptValid ? ptParsed * ratio : 0;

  const ptBalHuman = fromBaseUnits(balances.pt);
  const usdcBalHuman = fromBaseUnits(balances.usdc);
  const overPt = ptValid && ptParsed > ptBalHuman;
  const overUsdc = ptValid && usdcNeeded > usdcBalHuman;

  const needsTrustlines = isConnected && onCorrectNetwork && !trustlines.ready;

  const sharesHuman = lpPosition ? fromBaseUnits(lpPosition.shares) : 0;
  const hasShares = sharesHuman > 0;
  const removeShares = hasShares ? (sharesHuman * removePct) / 100 : 0;

  const cta = useMemo(() => {
    if (!MARKET_DEPLOYED) return 'Market not deployed';
    if (!isConnected) return 'Connect Wallet';
    if (!onCorrectNetwork) return `Switch to ${NETWORK.name}`;
    if (needsTrustlines) return 'Enable PT & YT';
    if (mode === 'add') {
      if (!ptValid) return 'Enter an amount';
      if (overPt) return 'Insufficient PT';
      if (overUsdc) return 'Insufficient USDC';
      return 'Add Liquidity';
    }
    if (!hasShares) return 'No liquidity to remove';
    return 'Remove Liquidity';
  }, [isConnected, onCorrectNetwork, needsTrustlines, mode, ptValid, overPt, overUsdc, hasShares]);

  const disabled =
    !MARKET_DEPLOYED ||
    busy ||
    connecting ||
    (isConnected &&
      !needsTrustlines &&
      (!onCorrectNetwork ||
        (mode === 'add' ? !ptValid || overPt || overUsdc : !hasShares || removePct <= 0)));

  const handleClick = async () => {
    if (!isConnected || !address) {
      openWalletPicker();
      return;
    }
    if (needsTrustlines) {
      // Reuse the wrapper's PT/YT trustline helper (LP holds PT directly).
      await run('Enable PT & YT', async () => {
        const res = await setupTrustlines(address);
        return res ?? { hash: '' };
      });
      return;
    }
    if (mode === 'add') {
      const ok = await run('Add liquidity', () =>
        addLiquidity(address, ptAmount, String(usdcNeeded)),
      );
      if (ok) setPtAmount('');
    } else {
      const ok = await run('Remove liquidity', () =>
        removeLiquidity(address, String(removeShares)),
      );
      if (ok) setRemovePct(100);
    }
  };

  const setMaxPt = () => setPtAmount(ptBalHuman > 0 ? String(ptBalHuman) : '');

  return (
    <Card className="h-full rounded-xl border-border bg-card shadow-sm">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Droplets size={16} className="text-sky-400" />
          Provide Liquidity
        </CardTitle>
        <CardDescription className="text-xs">
          Supply PT + USDC to earn the swap fee. Hold to maturity for minimal impermanent loss.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {/* Mode toggle */}
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1">
          <button
            type="button"
            onClick={() => setMode('add')}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all',
              mode === 'add'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Plus size={13} /> Add
          </button>
          <button
            type="button"
            onClick={() => setMode('remove')}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all',
              mode === 'remove'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Minus size={13} /> Remove
          </button>
        </div>

        {mode === 'add' ? (
          <>
            {/* PT input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-0.5 text-xs font-semibold uppercase text-muted-foreground">
                <Label>PT amount</Label>
                <button
                  type="button"
                  onClick={setMaxPt}
                  disabled={!isConnected}
                  className="normal-case transition-colors hover:text-foreground"
                >
                  Bal: {isConnected ? formatAmount(balances.pt) : '0.00'} PT
                </button>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-input bg-muted/50 px-3 py-2.5">
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  placeholder="0.0"
                  value={ptAmount}
                  onChange={(e) => setPtAmount(e.target.value)}
                  disabled={!MARKET_DEPLOYED}
                  className="h-auto border-none bg-transparent p-0 text-lg font-bold shadow-none focus-visible:ring-0"
                />
                <span className="flex h-7 items-center rounded-md bg-accent px-2.5 text-xs font-bold">PT</span>
              </div>
            </div>

            {/* USDC mirrored at the pool ratio */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-0.5 text-xs font-semibold uppercase text-muted-foreground">
                <Label>USDC required</Label>
                <span className="normal-case">Bal: {isConnected ? formatAmount(balances.usdc) : '0.00'} USDC</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-input bg-muted/30 px-3 py-2.5">
                <span className="flex-1 text-lg font-bold tabular-nums text-muted-foreground">
                  {ptValid ? usdcNeeded.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '0.0'}
                </span>
                <span className="flex h-7 items-center rounded-md bg-accent px-2.5 text-xs font-bold">USDC</span>
              </div>
              <p className="px-0.5 text-xs text-muted-foreground">
                Auto-matched to the pool ratio ({ratio.toFixed(4)} USDC / PT).
              </p>
            </div>
          </>
        ) : (
          <>
            {/* Remove: percentage slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between px-0.5 text-xs font-semibold uppercase text-muted-foreground">
                <Label>Amount to remove</Label>
                <span className="text-foreground">{removePct}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={removePct}
                onChange={(e) => setRemovePct(Number(e.target.value))}
                disabled={!hasShares}
                className="w-full accent-primary"
              />
              <div className="flex justify-between gap-1">
                {[25, 50, 75, 100].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setRemovePct(p)}
                    disabled={!hasShares}
                    className={cn(
                      'flex-1 rounded-md border border-border py-1 text-xs font-semibold transition-colors',
                      removePct === p
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {p}%
                  </button>
                ))}
              </div>
            </div>
            {hasShares && (
              <div className="space-y-1.5 rounded-lg border border-border/50 bg-muted/30 p-3">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-muted-foreground">You receive (est.)</span>
                  <span className="text-foreground">
                    {formatAmount(BigInt(Math.round((Number(lpPosition!.ptClaim) * removePct) / 100)))} PT +{' '}
                    {formatUsd(BigInt(Math.round((Number(lpPosition!.usdcClaim) * removePct) / 100)))}
                  </span>
                </div>
              </div>
            )}
          </>
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

export default LpPanel;
