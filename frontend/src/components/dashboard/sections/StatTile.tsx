import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The figure tile — the unit every summary strip on the dashboard is built
 * from (Overview, Deposit, Vault, Liquidity).
 *
 * It was four separate near-identical `Tile` components, one per strip, each
 * with its own idea of the label size and the accent list; they are one now,
 * so a strip on the Vault page and a strip on the Liquidity page are the same
 * object rather than two things that happen to look similar.
 *
 * Anatomy: the label is the app's micro-caption, the figure is Satoshi at
 * display size with tabular figures (so a column of them lines up and a value
 * that ticks doesn't shuffle sideways), and the icon sits in a well tinted by
 * the tone.
 */
export type StatTone = 'default' | 'brand' | 'ember' | 'usdc' | 'positive';

const CHIP: Record<StatTone, string> = {
  default: 'well text-subtle',
  brand: 'bg-brand/10 text-brand-text',
  ember: 'bg-ember/10 text-ember-text',
  usdc: 'bg-usdc/10 text-usdc-text',
  positive: 'well text-subtle',
};

const VALUE: Record<StatTone, string> = {
  default: '',
  brand: 'text-brand-text',
  ember: 'text-ember-text',
  usdc: 'text-usdc-text',
  positive: 'text-brand-text',
};

export type StatTileProps = {
  label: string;
  value: string;
  sub?: string;
  tone?: StatTone;
  icon: LucideIcon;
  loading?: boolean;
};

const StatTile = ({ label, value, sub, tone = 'default', icon: Icon, loading }: StatTileProps) => (
  <div className="panel panel-hover flex flex-col rounded-xl p-3.5 sm:p-4">
    <div className="flex flex-1 items-start justify-between gap-2">
      <span className="eyebrow pt-1 leading-tight">{label}</span>
      <div
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-lg transition-colors duration-300',
          CHIP[tone],
        )}
      >
        <Icon size={14} />
      </div>
    </div>

    {/* The figure and its note are pushed to the foot of the tile, so a strip
        whose labels wrap onto two lines still reads as one row of numbers
        rather than a staircase. */}
    <div className="mt-3 flex items-baseline pt-1">
      {loading ? (
        <span className="h-6 w-20 animate-pulse rounded-md bg-muted" />
      ) : (
        <span
          className={cn(
            'num truncate font-display text-[21px] leading-none font-medium tracking-[-0.02em] sm:text-[23px]',
            // An em dash is "nothing to show", not a value — colouring it in
            // the tone turns the placeholder into a bright little bar.
            value === '—' ? 'text-subtle' : VALUE[tone],
          )}
          title={value}
        >
          {value}
        </span>
      )}
    </div>

    {sub && !loading && (
      <p className="mt-2 truncate text-[12px] text-muted-foreground" title={sub}>
        {sub}
      </p>
    )}
  </div>
);

export default StatTile;
