import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { YieldSource } from '@/lib/series';

import {
  getActiveSeries,
  getActiveSeriesId,
  setActiveSeriesId,
  getSeriesForNetwork,
  getSeriesStatus,
  NETWORK_KEY,
  type SeriesConfig,
} from '@/lib/config';

type SeriesContextValue = {
  /** The currently active series configuration */
  activeSeries: SeriesConfig;
  /** Unique ID of the currently active series */
  activeSeriesId: string;
  /** All series available on the current network */
  seriesList: SeriesConfig[];
  /** Series that are currently active and un-matured (Live Now) */
  liveSeries: SeriesConfig[];
  /** Series that have already reached maturity (Ended) */
  endedSeries: SeriesConfig[];
  /** Whether the currently active series has matured */
  isCurrentEnded: boolean;
  /** Select and switch the active series */
  selectSeries: (seriesId: string) => void;
  selectSource: (source: YieldSource) => void;
  sources: YieldSource[];
};

const SeriesContext = createContext<SeriesContextValue | undefined>(undefined);

export const SeriesProvider = ({ children }: { children: ReactNode }) => {
  const [activeSeriesId, setActiveId] = useState<string>(() => getActiveSeriesId());
  const [nowSecs, setNowSecs] = useState<number>(() => Math.floor(Date.now() / 1000));

  // Clock tick every 30s to keep status accurate
  useEffect(() => {
    const t = setInterval(() => {
      setNowSecs(Math.floor(Date.now() / 1000));
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  // All series for the current network
  const seriesList = useMemo(() => {
    return getSeriesForNetwork(NETWORK_KEY);
  }, []);

  // The active series configuration
  const activeSeries = useMemo(() => {
    return seriesList.find((s) => s.id === activeSeriesId) ?? getActiveSeries();
  }, [seriesList, activeSeriesId]);

  // Split into 2 clear sections: Live Now and Ended
  const { liveSeries, endedSeries } = useMemo(() => {
    const live: SeriesConfig[] = [];
    const ended: SeriesConfig[] = [];

    for (const s of seriesList.filter(s => s.source === activeSeries.source)) {
      if (getSeriesStatus(s, nowSecs) === 'live') {
        live.push(s);
      } else {
        ended.push(s);
      }
    }

    return { liveSeries: live, endedSeries: ended };
  }, [seriesList, nowSecs, activeSeries.source]);

  const isCurrentEnded = useMemo(() => {
    return getSeriesStatus(activeSeries, nowSecs) === 'ended';
  }, [activeSeries, nowSecs]);

  const selectSeries = useCallback((id: string) => {
    const next = getSeriesForNetwork(NETWORK_KEY).find(s => s.id === id);
    if (!next) return;
    setActiveSeriesId(id);
    setActiveId(id);
    try { localStorage.setItem(`spield.series.${NETWORK_KEY}.${next.source}`, id); } catch { /* storage may be disabled */ }
  }, []);

  const sources = useMemo(() => [...new Set(seriesList.map(s => s.source))], [seriesList]);
  const selectSource = useCallback((source: YieldSource) => {
    const choices = getSeriesForNetwork(NETWORK_KEY).filter(s => s.source === source);
    let saved: string | null = null;
    try { saved = localStorage.getItem(`spield.series.${NETWORK_KEY}.${source}`); } catch { /* optional persistence */ }
    const selected = choices.find(s => s.id === saved) ?? choices.find(s => s.expiry > Date.now()/1000) ?? choices[0];
    if (selected) selectSeries(selected.id);
  }, [selectSeries]);

  const value = useMemo<SeriesContextValue>(
    () => ({
      activeSeries,
      activeSeriesId,
      seriesList,
      liveSeries,
      endedSeries,
      isCurrentEnded,
      selectSeries, selectSource, sources,
    }),
    [
      activeSeries,
      activeSeriesId,
      seriesList,
      liveSeries,
      endedSeries,
      isCurrentEnded,
      selectSeries, selectSource, sources,
    ],
  );

  return <SeriesContext.Provider value={value}>{children}</SeriesContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components -- The context hook is intentionally colocated with its provider.
export const useSeries = (): SeriesContextValue => {
  const ctx = useContext(SeriesContext);
  if (!ctx) {
    throw new Error('useSeries must be used within a <SeriesProvider>.');
  }
  return ctx;
};

