import { ShieldCheck, ShieldAlert, ExternalLink } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useProtocol } from '@/context/ProtocolContext';
import { formatUsd, fromBaseUnits } from '@/lib/soroban';
import { CONTRACTS, explorerContract } from '@/lib/config';

/**
 * Public solvency dashboard (plan §11.5). v1 was rejected by SCF for being
 * undercollateralized by design; v2's whole pitch is that the vault is solvent by
 * construction — backing (live Blend position value) ≥ principal at all times.
 * This card reads the contract's `solvency()` and shows the invariant holding.
 */
const SolvencyCard = () => {
  const { solvency, loading } = useProtocol();

  const backing = solvency ? fromBaseUnits(solvency.backing) : 0;
  const principal = solvency ? fromBaseUnits(solvency.principal) : 0;
  // Invariant: backing >= principal. Treat 1-stroop rounding dust as healthy.
  const healthy = !solvency || backing + 0.0001 >= principal;
  // Collateral ratio, capped for display.
  const ratio = principal > 0 ? (backing / principal) * 100 : 100;
  const barWidth = Math.max(0, Math.min(100, principal > 0 ? (principal / backing) * 100 : 0));

  return (
    <Card className="overflow-hidden rounded-xl border-border bg-card shadow-sm">
      <CardHeader className="p-5 pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              {healthy ? (
                <ShieldCheck size={17} className="text-emerald-500" />
              ) : (
                <ShieldAlert size={17} className="text-red-500" />
              )}
              Protocol Solvency
            </CardTitle>
            <CardDescription className="text-sm">
              Live Blend-backed value vs. outstanding principal
            </CardDescription>
          </div>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold',
              healthy ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500',
            )}
          >
            {healthy ? 'Solvent' : 'Under-backed'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-5 pt-0">
        {loading ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted/40" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Metric label="Backing (Blend)" value={formatUsd(solvency?.backing ?? 0n)} accent="positive" />
              <Metric label="Principal" value={formatUsd(solvency?.principal ?? 0n)} />
            </div>

            {/* Collateral bar: principal as a fraction of backing. */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-muted-foreground">Collateralization</span>
                <span className={cn('font-bold', healthy ? 'text-emerald-500' : 'text-red-500')}>
                  {ratio.toFixed(2)}%
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('h-full rounded-full', healthy ? 'bg-emerald-500' : 'bg-red-500')}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Yield buffer:{' '}
                <span className="font-semibold text-foreground">
                  {formatUsd(solvency?.unclaimed ?? 0n, 6)}
                </span>{' '}
                — backing grows with Blend&apos;s rising bRate.
              </p>
            </div>
          </>
        )}

        <a
          href={explorerContract(CONTRACTS.wrapper)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          View wrapper contract <ExternalLink size={11} />
        </a>
      </CardContent>
    </Card>
  );
};

const Metric = ({
  label,
  value,
  accent = 'default',
}: {
  label: string;
  value: string;
  accent?: 'default' | 'positive';
}) => (
  <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className={cn('mt-1 text-lg font-bold tabular-nums', accent === 'positive' && 'text-emerald-500')}>
      {value}
    </p>
  </div>
);

export default SolvencyCard;
