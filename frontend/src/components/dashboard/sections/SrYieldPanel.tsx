import { useCallback, useEffect, useState } from 'react';
import { Coins, Loader2, Wallet, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoTooltip } from '@/components/ui/tooltip';
import { useWallet } from '@/context/WalletContext';
import { useTxAction } from '@/lib/useTxAction';
import { fromBaseUnits, formatAmount } from '@/lib/soroban';
import { claimYieldCard } from '@/lib/shareCard';
import { SR_DEPLOYED } from '@/lib/config';
import {
  getPortfolio,
  getSolvency,
  getMarketStats,
  ROUTER_AVAILABLE,
  quoteClaimYieldUsdc,
  claimYieldToUsdc,
  claimYield,
  fromScalar12,
  daysToExpiry,
  isMatured,
  type SrPortfolio,
  type SrSolvency,
  type SrMarketStats,
} from '@/lib/srstack';

const fmtTok = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 6 });

const Row = ({
  label,
  value,
  hint,
  info,
}: {
  label: string;
  value: string;
  hint?: string;
  info?: string;
}) => (
  <div className="flex items-baseline justify-between gap-3 border-b py-2 last:border-b-0">
    <div>
      <div className="flex items-center gap-1.5 text-sm">
        <span>{label}</span>
        {info && <InfoTooltip content={info} size={12} />}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
    <div className="shrink-0 font-medium tabular-nums">{value}</div>
  </div>
);

/**
 * **Yield — what YT actually pays, and how to take it.**
 *
 * This card exists because YT is otherwise illegible. Holding it accrues SR continuously against a
 * rising index; without a single "here is what you earned, in dollars, take it" surface, a holder
 * has to claim SR, unwrap it, and then work out which of the two numbers was their return.
 * `claim_yield_to_usdc` collapses all of that into one signature and one figure.
 *
 * ## Three contract behaviours this card has to explain, not hide
 *
 * * **Claiming does not consume the YT.** The position keeps earning. People expect a claim to burn
 *   something, so the balance staying put reads as a bug unless we say otherwise.
 * * **Selling YT credits yield without paying it.** The claim survives the sale — that is why this
 *   card stays live with a zero YT balance, and why the empty state says so rather than hiding.
 * * **The quote is net of the protocol's yield fee.** We show the fee explicitly. A "you earned X"
 *   that silently differs from what lands is the fastest way to lose someone's trust.
 *
 * The fallback path matters too: if the router is not deployed, claiming still works — it just pays
 * in SR instead of USDC. The card degrades to that rather than disappearing.
 */
const SrYieldPanel = () => {
  const { address, isConnected, openWalletPicker, connecting, onCorrectNetwork } = useWallet();
  const { run, busy } = useTxAction();

  const [portfolio, setPortfolio] = useState<SrPortfolio | null>(null);
  const [solvency, setSolvency] = useState<SrSolvency | null>(null);
  const [stats, setStats] = useState<SrMarketStats | null>(null);
  const [claimUsdc, setClaimUsdc] = useState<bigint>(0n);

  const refresh = useCallback(async () => {
    if (!SR_DEPLOYED) return;
    const [sol, s] = await Promise.all([getSolvency(), getMarketStats()]);
    setSolvency(sol);
    setStats(s);
    if (address) {
      const [p, q] = await Promise.all([getPortfolio(address), quoteClaimYieldUsdc(address)]);
      setPortfolio(p);
      setClaimUsdc(q);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!SR_DEPLOYED) return null;

  const ytFace = portfolio?.yt ?? 0n;
  const claimableSr = portfolio?.claimableYield ?? 0n;
  const grossUsdc = portfolio?.claimableYieldAsUsdc ?? 0n;
  // The router's quote is net of the fee; the portfolio figure is gross. The difference IS the fee.
  const netUsdc = ROUTER_AVAILABLE && claimUsdc > 0n ? claimUsdc : grossUsdc;
  const feeUsdc = ROUTER_AVAILABLE && claimUsdc > 0n && grossUsdc > claimUsdc
    ? grossUsdc - claimUsdc
    : 0n;
  const feeBps = solvency?.yieldFeeBps ?? 0;
  const hasClaim = claimableSr > 0n;
  const matured = isMatured(stats);

  const onClaim = async () => {
    if (!address) return;
    await run(
      ROUTER_AVAILABLE ? 'Claiming yield to USDC' : 'Claiming yield (paid in SR)',
      () => (ROUTER_AVAILABLE ? claimYieldToUsdc(address) : claimYield(address)),
      // The figure on the button is the figure on the card: net of the fee when the router pays
      // USDC, the raw SR claim when it cannot.
      claimYieldCard(
        ROUTER_AVAILABLE
          ? { amount: netUsdc, unit: 'USDC', yt: ytFace }
          : { amount: claimableSr, unit: 'SR', yt: ytFace },
      ),
    );
    void refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" aria-hidden />
            Yield
          </span>
          <InfoTooltip
            title="Yield & Claiming"
            content="Claiming accrued yield leaves your YT untouched — your position keeps earning. Selling YT credits earned yield without paying it out, so it stays claimable here."
          />
        </CardTitle>
        <CardDescription>
          What your YT has earned — claimable to USDC in one signature, without giving up the
          position.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
          <Row
            label="Claimable now"
            hint={ROUTER_AVAILABLE ? 'net of the protocol fee' : 'paid in SR'}
            info="Net claimable USDC after protocol yield fees. Claiming does not burn or reduce your YT tokens."
            value={`${formatAmount(netUsdc)} USDC`}
          />
          <Row
            label="YT face held"
            hint="the notional earning yield for you"
            info="The principal notional earning floating Blend yield for your wallet."
            value={`${fmtTok(fromBaseUnits(ytFace))} YT`}
          />
          <Row
            label="Protocol yield fee"
            hint={`${(feeBps / 100).toFixed(2)}% of interest`}
            info="Protocol performance fee applied only to accrued interest, never to principal."
            value={feeUsdc > 0n ? `${formatAmount(feeUsdc)} USDC` : `${(feeBps / 100).toFixed(2)}%`}
          />
          <Row
            label="Already withdrawn"
            hint="lifetime, in SR"
            info="Total historical yield claimed by this wallet, measured in SR shares."
            value={fmtTok(fromBaseUnits(portfolio?.withdrawn ?? 0n))}
          />
          {solvency && (
            <Row
              label="Yield index"
              hint="rises every ledger — this is where yield comes from"
              info="Blend pool bRate index. As borrow interest accumulates on-chain, this index climbs."
              value={fromScalar12(solvency.index).toFixed(8)}
            />
          )}
          {stats && (
            <Row
              label="Accruing until"
              hint={matured ? 'this series has matured' : 'maturity'}
              info={
                matured
                  ? 'This series has matured. The yield index is frozen at expiry. All accrued yield remains claimable with no deadline.'
                  : 'Floating yield continues to accrue until the series reaches maturity.'
              }
              value={matured ? 'matured' : `${daysToExpiry(stats)} days`}
            />
          )}
        </div>

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
          <Button className="w-full" onClick={onClaim} disabled={busy || !hasClaim}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Coins className="mr-2 h-4 w-4" aria-hidden />
            )}
            {hasClaim
              ? ROUTER_AVAILABLE
                ? `Claim ${formatAmount(netUsdc)} USDC`
                : `Claim ${fmtTok(fromBaseUnits(claimableSr))} SR`
              : 'Nothing to claim yet'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default SrYieldPanel;
