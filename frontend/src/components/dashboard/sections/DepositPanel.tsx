import { useMemo, useState } from 'react';
import { ArrowDown, Loader2, Wallet, AlertTriangle, ShieldCheck, Lock, ArrowRight, TrendingUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import AmountField from './AmountField';
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
  const { address, isConnected, openWalletPicker, connecting, onCorrectNetwork } = useWallet();
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
      openWalletPicker();
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
    <Card className="h-full rounded-xl">
      <CardHeader>
        <CardTitle>Deposit</CardTitle>
        <CardDescription>
          Supply USDC to mint a fixed-rate bond (PT) + a yield token (YT)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pay: USDC */}
        <AmountField
          label="Deposit"
          token="USDC"
          value={amount}
          onChange={setAmount}
          balance={`${isConnected ? formatAmount(balances.usdc) : '0.00'} USDC`}
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

        {/* Receive: PT + YT, minted 1:1:1 with the deposit */}
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

        {/* Summary */}
        <div className="space-y-1.5 well rounded-lg p-3">
          <div className="flex justify-between text-[12.5px]">
            <span className="text-muted-foreground">Yield source</span>
            <span className="text-foreground">Blend (USDC pool)</span>
          </div>
          <div className="flex justify-between text-[12.5px]">
            <span className="text-muted-foreground">You receive</span>
            <span className="text-foreground">
              {amountValid ? `${parsed.toLocaleString()} PT + ${parsed.toLocaleString()} YT` : '— PT + — YT'}
            </span>
          </div>
          <div className="flex justify-between text-[12.5px]">
            <span className="text-muted-foreground">Redeem PT 1:1</span>
            <span className="text-foreground">at maturity</span>
          </div>
        </div>

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
              Before you can receive PT &amp; YT tokens, your wallet needs to &quot;trust&quot; them.
              This is a <span className="font-semibold text-foreground">free, one-click step</span> — no USDC
              will leave your wallet. After you approve it, you can deposit immediately.
            </p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Click <span className="font-medium text-foreground">Enable PT &amp; YT</span> below</li>
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

        {/* Cross-link: already hold PT/YT? Trade them or LP on the Markets AMM. */}
        {MARKET_DEPLOYED && (
          <button
            type="button"
            onClick={() => navigate('markets')}
            className="flex w-full items-center justify-between gap-3 well rounded-lg px-3 py-2.5 text-left text-[12.5px] leading-relaxed transition-colors duration-200 hover:border-brand/40"
          >
            <span className="flex min-w-0 items-start gap-2 text-muted-foreground">
              <TrendingUp size={13} className="mt-px shrink-0 text-brand-text" />
              <span>
                Already hold PT? <span className="font-medium text-foreground">Trade it</span> or earn
                fees by providing liquidity.
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
