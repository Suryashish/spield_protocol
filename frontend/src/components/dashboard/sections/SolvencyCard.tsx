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
        <CardContent className="p-6">
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
      <CardContent className="space-y-6 p-6">
        {/* Hero: status + headline ratio */}
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div
              className={cn(
                'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl',
                healthy ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500',
              )}
            >
              {healthy ? <ShieldCheck size={28} /> : <ShieldAlert size={28} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-bold tracking-tight">
                  {healthy ? 'Solvent' : 'Under-backed'}
                </h3>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                    healthy
                      ? 'bg-emerald-500/10 text-emerald-500'
                      : 'bg-red-500/10 text-red-500',
                  )}
                >
                  {healthy ? 'Backing ≥ Principal' : 'Backing < Principal'}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Live Blend-backed value vs. outstanding principal, read on-chain.
              </p>
            </div>
          </div>

          <div className="shrink-0 sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Collateralization
            </p>
            <p
              className={cn(
                'text-3xl font-bold tabular-nums',
                healthy ? 'text-emerald-500' : 'text-red-500',
              )}
            >
              {ratio.toFixed(2)}%
            </p>
          </div>
        </div>

        {/* Backing vs principal bar: full track = backing, solid = principal, rest = surplus. */}
        <div className="space-y-2">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full', healthy ? 'bg-emerald-500' : 'bg-red-500')}
              style={{ width: `${principalShare}%` }}
            />
            <div className="h-full bg-emerald-500/30" style={{ width: `${surplusShare}%` }} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className={cn('h-2 w-2 rounded-sm', healthy ? 'bg-emerald-500' : 'bg-red-500')} />
              Principal covered
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-sm bg-emerald-500/30" />
              Surplus yield buffer
            </span>
          </div>
        </div>

        {/* Figures */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Metric label="Backing (Blend)" value={formatUsd(solvency?.backing ?? 0n)} accent="positive" />
          <Metric label="Principal" value={formatUsd(solvency?.principal ?? 0n)} />
          <Metric
            label="Surplus buffer"
            value={`+${formatUsd(solvency?.unclaimed ?? 0n, 6)}`}
            accent="positive"
          />
        </div>

        <p className="text-xs text-muted-foreground">
          The escrowed asset grows on-chain with Blend&apos;s rising{' '}
          <span className="font-semibold text-foreground">bRate</span>, so the buffer widens over
          time — the first claimant can never drain the vault.
        </p>

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
