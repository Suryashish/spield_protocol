import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

import { useSeries } from '@/context/SeriesContext';
import type { YieldSource } from '@/lib/series';

/**
 * Native <select> keeps keyboard and mobile pickers for free, but its built-in arrow sits flush
 * against the border and ignores our padding. `appearance-none` drops it, and the chevron is drawn
 * over a reserved `pr-8` gutter so long labels truncate before reaching it.
 */
function PillSelect({
  label,
  value,
  onChange,
  className,
  tourTarget,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  tourTarget: string;
  children: ReactNode;
}) {
  return (
    <label className={`relative flex min-w-0 items-center ${className ?? ''}`}>
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        data-tour={tourTarget}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full min-w-0 cursor-pointer appearance-none truncate rounded-full border border-border bg-card pl-3.5 pr-8 text-[13px] font-medium text-foreground shadow-float-sm transition-colors duration-200 hover:border-line-strong focus-visible:outline-brand"
      >
        {children}
      </select>
      <ChevronDown
        size={13}
        aria-hidden="true"
        className="pointer-events-none absolute right-3 text-subtle"
      />
    </label>
  );
}

export default function SourceSeriesControl() {
  const { activeSeries, seriesList, endedSeries, sources, selectSource, selectSeries } =
    useSeries();
  return (
    <div className="flex min-w-0 items-center gap-2" data-tour="series-selector">
      <PillSelect
        label="Yield source"
        tourTarget="yield-source"
        value={activeSeries.source}
        onChange={(v) => selectSource(v as YieldSource)}
        className="shrink-0"
      >
        {sources.map((source) => (
          <option key={source} value={source}>
            {source === 'blend' ? 'Blend' : 'USTRY'}
          </option>
        ))}
      </PillSelect>
      <PillSelect
        label="Series / maturity"
        tourTarget="series-maturity"
        value={activeSeries.id}
        onChange={selectSeries}
        className="max-w-[min(52vw,16rem)]"
      >
        {seriesList
          .filter((s) => s.source === activeSeries.source)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.maturityDate}
              {endedSeries.some((ended) => ended.id === s.id) ? ' · Ended' : ''}
            </option>
          ))}
      </PillSelect>
    </div>
  );
}
