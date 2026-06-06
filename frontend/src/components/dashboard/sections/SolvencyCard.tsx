import { ShieldCheck, ShieldAlert, ExternalLink, Code2 } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useProtocol } from '@/context/ProtocolContext';
import { formatUsd, fromBaseUnits } from '@/lib/soroban';
import { CONTRACTS, explorerContract } from '@/lib/config';

/**
 * Public solvency hero (plan §11.5). v1 was rejected by SCF for being
 * undercollateralized by design; v2's whole pitch is that the vault is solvent by
 * construction — backing (live Blend position value) ≥ principal at all times.
 *
 * This card reads the contract's `solvency()` and leads with the trust signal: a big
 * status badge, the live collateralization ratio, and a bar where the full track is the
 * Blend backing, the solid fill is the principal it covers, and the remainder is the
 * surplus yield buffer — so "backing ≥ principal" is obvious at a glance.
 */
const SolvencyCard = () => {
  const { solvency, loading } = useProtocol();

  const backing = solvency ? fromBaseUnits(solvency.backing) : 0;
  const principal = solvency ? fromBaseUnits(solvency.principal) : 0;
  // Invariant: backing >= principal. Treat 1-stroop rounding dust as healthy.
  const healthy = !solvency || backing + 0.0001 >= principal;
  // Collateral ratio (backing as a % of principal). 100% with no principal yet.
  const ratio = principal > 0 ? (backing / principal) * 100 : 100;
  // Of the backing track, the share that covers principal vs. the surplus buffer.
  const principalShare = backing > 0 ? Math.min(100, (principal / backing) * 100) : 0;
  const surplusShare = Math.max(0, 100 - principalShare);

  if (loading) {
    return (
      <Card className="rounded-xl border-border bg-card shadow-sm">
        <CardContent className="p-4 sm:p-6">
          <div className="h-44 animate-pulse rounded-lg bg-muted/40" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        'overflow-hidden rounded-xl border-border bg-card shadow-sm',
        healthy ? 'ring-1 ring-emerald-500/20' : 'ring-1 ring-red-500/30',
      )}
    >
      <CardContent className="space-y-5 p-4 sm:space-y-6 sm:p-6">
        {/* Hero: status + headline ratio. On mobile they sit on one compact row
            (badge + label on the left, ratio on the right); from sm up it's the
            original stacked-then-spread layout. */}
        <div className="flex flex-row items-center justify-between gap-4 sm:items-center">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <div
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl sm:h-14 sm:w-14 sm:rounded-2xl',
                healthy ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500',
              )}
            >
              {healthy ? <ShieldCheck className="h-6 w-6 sm:h-7 sm:w-7" /> : <ShieldAlert className="h-6 w-6 sm:h-7 sm:w-7" />}
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-bold tracking-tight sm:text-xl">
                {healthy ? 'Solvent' : 'Under-backed'}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground sm:mt-1 sm:text-sm">
                Live Blend-backed value vs. outstanding principal, read on-chain.
              </p>
            </div>
          </div>

          <div className="shrink-0 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-xs">
              Collateralization
            </p>
            <p
              className={cn(
                'text-2xl font-bold tabular-nums sm:text-3xl',
                healthy ? 'text-emerald-500' : 'text-red-500',
              )}
            >
              {ratio.toFixed(2)}%
            </p>
          </div>
        </div>

        {/* Backing vs principal bar: full track = backing, solid = principal, rest = surplus.
            The bar's two colors are explained by the matching dots on the metrics below. */}
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full', healthy ? 'bg-emerald-500' : 'bg-red-500')}
            style={{ width: `${principalShare}%` }}
          />
          <div className="h-full bg-emerald-500/30" style={{ width: `${surplusShare}%` }} />
        </div>

        {/* Figures — also serve as the bar legend via the colored dots. */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Metric label="Backing (Blend)" value={formatUsd(solvency?.backing ?? 0n)} accent="positive" />
          <Metric
            label="Principal"
            value={formatUsd(solvency?.principal ?? 0n)}
            dot={healthy ? 'bg-emerald-500' : 'bg-red-500'}
          />
          <Metric
            label="Surplus buffer"
            value={`+${formatUsd(solvency?.unclaimed ?? 0n, 6)}`}
            accent="positive"
            dot="bg-emerald-500/30"
          />
        </div>

        {/* On-chain proof */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Code2 size={13} />
            Read live from{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
              solvency()
            </code>
          </span>
          <a
            href={explorerContract(CONTRACTS.wrapper)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            View wrapper contract <ExternalLink size={11} />
          </a>
        </div>
      </CardContent>
    </Card>
  );
};

const Metric = ({
  label,
  value,
  accent = 'default',
  dot,
}: {
  label: string;
  value: string;
  accent?: 'default' | 'positive';
  /** Optional Tailwind bg-class for a small legend swatch beside the label. */
  dot?: string;
}) => (
  <div className="rounded-lg border border-border/50 bg-muted/30 p-2.5 sm:p-3">
    <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:gap-1.5 sm:text-xs sm:tracking-wider">
      {dot && <span className={cn('h-2 w-2 shrink-0 rounded-sm', dot)} />}
      <span className="truncate">{label}</span>
    </p>
    <p
      className={cn(
        'mt-0.5 break-all text-sm font-bold leading-tight tabular-nums sm:mt-1 sm:break-normal sm:text-lg',
        accent === 'positive' && 'text-emerald-500',
      )}
    >
      {value}
    </p>
  </div>
);

export default SolvencyCard;
