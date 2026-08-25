import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, AlertTriangle, ExternalLink } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useWallet } from '@/context/WalletContext';
import { formatAmount, formatUsd } from '@/lib/soroban';
import { NETWORK, SR_CONTRACTS, SR_DEPLOYED } from '@/lib/config';
import {
  getExchangeRate,
  getMarketStats,
  getPortfolio,
  getSolvency,
  getLpPosition,
  fromScalar12,
  impliedApyPct,
  ptPriceHuman,
  daysToExpiry,
  isMatured,
  poolValueUsdc,
  type SrMarketStats,
  type SrPortfolio,
  type SrSolvency,
  type SrLpPosition,
} from '@/lib/srstack';

const Row = ({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: boolean;
}) => (
  <div className="flex items-baseline justify-between gap-4 py-2">
    <span className="text-sm text-muted-foreground">{label}</span>
    <span className="text-right">
      <span className={accent ? 'font-semibold tabular-nums text-emerald-500' : 'font-medium tabular-nums'}>
        {value}
      </span>
      {sub ? <span className="block text-xs text-muted-foreground">{sub}</span> : null}
    </span>
  </div>
);

/**
 * Your position across the SR stack, plus the market and engine state behind it.
 *
 * Two things this deliberately spells out rather than glossing:
 *
 * * **SR balances are shown with their USDC value.** SR is a share whose rate only rises, so a raw
 *   share count is meaningless to a user.
 * * **The engine's "surplus" is labelled as owed to YT holders.** It is not protocol profit — every
 *   stroop above PT cover belongs to someone's yield claim (`srstack.md` §5). Showing it as a
 *   protocol number would be actively misleading.
 */
const SrPortfolioPanel = () => {
  const { address, isConnected } = useWallet();
  const [stats, setStats] = useState<SrMarketStats | null>(null);
  const [portfolio, setPortfolio] = useState<SrPortfolio | null>(null);
  const [solvency, setSolvency] = useState<SrSolvency | null>(null);
  const [lp, setLp] = useState<SrLpPosition | null>(null);
  const [rate, setRate] = useState<bigint>(10n ** 12n);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!SR_DEPLOYED) {
      setLoading(false);
      return;
    }
    const [s, sol, r] = await Promise.all([getMarketStats(), getSolvency(), getExchangeRate()]);
    setStats(s);
    setSolvency(sol);
    setRate(r);
    if (address) {
      const [p, l] = await Promise.all([getPortfolio(address), getLpPosition(address)]);
      setPortfolio(p);
      setLp(l);
    } else {
      setPortfolio(null);
      setLp(null);
    }
    setLoading(false);
  }, [address]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!SR_DEPLOYED) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Position</CardTitle>
          <CardDescription>Spield v2 is testnet-only for now.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const matured = isMatured(stats);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>Your v2 position</CardTitle>
        <CardDescription>
          {loading ? 'Loading…' : matured ? 'This series has matured.' : 'Live against the Blend testnet pool.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading position…
          </div>
        ) : (
          <>
            {/* Market */}
            <section>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Market
              </h3>
              <div className="divide-y rounded-lg border px-3">
                <Row
                  label="Implied APY"
                  value={stats ? `${impliedApyPct(stats).toFixed(2)}%` : '—'}
                  accent
                />
                <Row
                  label="PT price"
                  value={stats ? ptPriceHuman(stats).toFixed(6) : '—'}
                  sub="redeems at 1.000000 on expiry"
                />
                <Row
                  label="Time to expiry"
                  value={matured ? 'matured' : stats ? `${daysToExpiry(stats)} days` : '—'}
                />
                <Row
                  label="Pool size"
                  value={stats ? formatUsd(poolValueUsdc(stats)) : '—'}
                  sub={
                    stats
                      ? `${formatAmount(stats.ptReserve)} PT · ${formatAmount(stats.assetReserve)} SR (as USDC)`
                      : undefined
                  }
                />
                <Row
                  label="SR exchange rate"
                  value={fromScalar12(rate).toFixed(6)}
                  sub="USDC per SR — rises with Blend yield"
                />
              </div>
            </section>

            {/* Wallet */}
            <section>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Wallet
              </h3>
              {!isConnected ? (
                <p className="rounded-lg border px-3 py-4 text-sm text-muted-foreground">
                  Connect a wallet to see your balances.
                </p>
              ) : (
                <div className="divide-y rounded-lg border px-3">
                  <Row label="USDC" value={formatAmount(portfolio?.usdc ?? 0n)} />
                  <Row
                    label="SR"
                    value={formatAmount(portfolio?.sr ?? 0n)}
                    sub={`≈ ${formatUsd(portfolio?.srAsUsdc ?? 0n)}`}
                  />
                  <Row
                    label="PT"
                    value={
                      portfolio?.hasPtTrustline === false ? (
                        <span className="text-xs text-amber-500">no trustline</span>
                      ) : (
                        formatAmount(portfolio?.pt ?? 0n)
                      )
                    }
                    sub={
                      portfolio?.hasPtTrustline === false
                        ? 'add it before buying PT'
                        : 'redeems 1:1 at expiry'
                    }
                  />
                  <Row
                    label="YT"
                    value={formatAmount(portfolio?.yt ?? 0n)}
                    sub={matured ? 'matured — earns nothing further' : 'earning Blend yield'}
                  />
                  <Row
                    label="Claimable yield"
                    value={formatUsd(portfolio?.claimableYieldAsUsdc ?? 0n)}
                    sub={
                      solvency
                        ? `gross — the protocol takes ${(solvency.yieldFeeBps / 100).toFixed(2)}%`
                        : undefined
                    }
                    accent={(portfolio?.claimableYield ?? 0n) > 0n}
                  />
                  {lp && lp.shares > 0n && (
                    <Row
                      label="LP position"
                      value={`${formatAmount(lp.ptClaim)} PT`}
                      sub={`+ ${formatAmount(lp.srClaim)} SR`}
                    />
                  )}
                </div>
              )}
            </section>

            {/* Engine solvency */}
            {solvency && (
              <section>
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Engine solvency
                </h3>
                <div className="divide-y rounded-lg border px-3">
                  <Row
                    label="SR held"
                    value={formatAmount(solvency.held)}
                    sub={`vs ${formatAmount(solvency.needed)} required`}
                  />
                  <Row
                    label="PT outstanding"
                    value={formatAmount(solvency.totalPy)}
                    sub="every unit redeems at par"
                  />
                  <Row
                    label="Owed to YT holders"
                    value={formatAmount(solvency.surplus)}
                    sub="SR above PT cover — a yield claim, not protocol surplus"
                  />
                </div>
                <div className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
                  {solvency.held >= solvency.needed ? (
                    <>
                      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
                      <span>
                        Solvent: the engine holds enough SR to redeem every PT at par and pay every
                        credited yield claim.
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                      <span>Backing is below outstanding claims. Do not deposit.</span>
                    </>
                  )}
                </div>
              </section>
            )}

            {SR_CONTRACTS && (
              <a
                className="mt-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                href={`${NETWORK.explorer}/contract/${SR_CONTRACTS.market}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="h-3 w-3" aria-hidden />
                View the market contract
              </a>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default SrPortfolioPanel;
