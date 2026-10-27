import { useSeries } from '@/context/SeriesContext';
import type { YieldSource } from '@/lib/series';

export default function SourceSeriesControl() {
  const { activeSeries, seriesList, endedSeries, sources, selectSource, selectSeries } =
    useSeries();
  const style =
    'h-9 max-w-[min(42vw,14rem)] rounded-full border border-border bg-card px-3 text-xs text-foreground shadow-float-sm focus-visible:outline-brand';
  return (
    <div className="flex items-center gap-2" data-tour="series-selector">
      <label className="flex flex-col gap-0.5">
        <span className="sr-only">Yield source</span>
        <select
          aria-label="Yield source"
          className={style}
          value={activeSeries.source}
          onChange={(e) => selectSource(e.target.value as YieldSource)}
        >
          {sources.map((source) => (
            <option key={source} value={source}>
              {source === 'blend' ? 'Blend' : 'USTRY'}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="sr-only">Series / maturity</span>
        <select
          aria-label="Series / maturity"
          className={style}
          value={activeSeries.id}
          onChange={(e) => selectSeries(e.target.value)}
        >
          {seriesList
            .filter((s) => s.source === activeSeries.source)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.maturityDate}
                {endedSeries.some((ended) => ended.id === s.id) ? ' · Ended' : ''}
              </option>
            ))}
        </select>
      </label>
    </div>
  );
}
