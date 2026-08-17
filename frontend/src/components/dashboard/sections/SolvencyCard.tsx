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
/** Surplus can be a tiny sub-cent buffer. Show 2 decimals once it's ≥ $0.01, but
 *  keep just enough precision (up to 4 dp) for smaller amounts so it stays legible
 *  without the 6-decimal string that overflowed the compact tile. */
const formatSurplus = (units: bigint | number | string): string => {
  const v = fromBaseUnits(units);
  return v > 0 && v < 0.01 ? formatUsd(units, 4) : formatUsd(units, 2);
};

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
      <Card className="rounded-xl">
        <CardContent>
          <div className="h-44 animate-pulse rounded-xl bg-muted" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        'overflow-hidden rounded-xl',
        // A border, not a ring: `ring-*` compiles into box-shadow, which
        // would replace the card's float shadow rather than sit alongside it.
        healthy ? 'border-brand/30' : 'border-danger/40',
      )}
    >
      <CardContent className="@container space-y-5">
        {/* Hero: status + headline ratio. On mobile they sit on one compact row
            (badge + label on the left, ratio on the right); from sm up it's the
            original stacked-then-spread layout. */}
        <div className="flex flex-col gap-4 @md:flex-row @md:items-center @md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={cn(
                'grid size-11 shrink-0 place-items-center rounded-xl @md:size-14 @md:rounded-2xl',
                healthy ? 'bg-brand/10 text-brand-text' : 'bg-danger/10 text-danger-text',
              )}
            >
              {healthy ? <ShieldCheck className="size-6 @md:size-7" /> : <ShieldAlert className="size-6 @md:size-7" />}
            </div>
            <div className="min-w-0">
              <h3 className="font-display text-[19px] font-medium tracking-[-0.02em] @md:text-[21px]">
                {healthy ? 'Solvent' : 'Under-backed'}
              </h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground @md:text-[13px]">
                Live Blend-backed value vs. outstanding principal, read on-chain.
              </p>
            </div>
          </div>

          <div className="shrink-0 @md:text-right">
            <p className="eyebrow">Collateralization</p>
            <p
              className={cn(
                'num mt-1 font-display text-[26px] leading-none font-medium tracking-[-0.025em] @md:text-[32px]',
                healthy ? 'text-brand-text' : 'text-danger-text',
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
            className={cn('h-full', healthy ? 'bg-brand' : 'bg-danger')}
            style={{ width: `${principalShare}%` }}
          />
          <div className="h-full bg-brand/30" style={{ width: `${surplusShare}%` }} />
        </div>

        {/* Figures — also serve as the bar legend via the colored dots. */}
        <div className="grid grid-cols-3 gap-2 @md:gap-3">
          <Metric label="Backing" value={formatUsd(solvency?.backing ?? 0n)} accent="positive" />
          <Metric
            label="Principal"
            value={formatUsd(solvency?.principal ?? 0n)}
            dot={healthy ? 'bg-brand' : 'bg-danger'}
          />
          <Metric
            label="Surplus"
            value={`+${formatSurplus(solvency?.unclaimed ?? 0n)}`}
            accent="positive"
            dot="bg-brand/30"
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
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-text hover:underline"
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
  <div className="min-w-0 well rounded-lg p-2.5 sm:p-3">
    <p className="flex items-center gap-1 eyebrow sm:gap-1.5">
      {dot && <span className={cn('h-2 w-2 shrink-0 rounded-sm', dot)} />}
      <span className="truncate">{label}</span>
    </p>
    <p
      className={cn(
        'num mt-1 truncate font-display text-[15px] leading-tight font-medium tracking-[-0.015em] sm:text-[17px]',
        accent === 'positive' && 'text-brand-text',
      )}
      title={value}
    >
      {value}
    </p>
  </div>
);

export default SolvencyCard;
