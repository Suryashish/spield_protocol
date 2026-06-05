import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import { useWallet } from '@/context/WalletContext';
import {
  getMaturity,
  getOwnerPositions,
  getPaused,
  getSolvency,
  getWalletBalances,
  type PositionValue,
  type Solvency,
} from '@/lib/spield';

type Balances = { usdc: bigint; pt: bigint; yt: bigint };

type ProtocolContextValue = {
  /** The connected wallet's positions (those still holding PT or YT). */
  positions: PositionValue[];
  /** USDC / PT / YT balances for the connected wallet. */
  balances: Balances;
  /** Protocol-wide solvency snapshot. */
  solvency: Solvency | null;
  /** PT maturity, unix seconds (protocol-wide). */
  maturity: number | null;
  /** Whether the protocol is paused. */
  paused: boolean;
  /** True while the first load is in flight. */
  loading: boolean;
  /** True while a background refresh is running. */
  refreshing: boolean;
  /** Last load error, if any. */
  error: string | null;
  /** Re-read everything from chain (call after a successful write). */
  refresh: () => Promise<void>;
  // Aggregates across the wallet's positions, base units.
  totalPrincipal: bigint;
  totalClaimable: bigint;
};

const EMPTY_BALANCES: Balances = { usdc: 0n, pt: 0n, yt: 0n };

const ProtocolContext = createContext<ProtocolContextValue | undefined>(undefined);

export const ProtocolProvider = ({ children }: { children: ReactNode }) => {
  const { address, isConnected } = useWallet();

  const [positions, setPositions] = useState<PositionValue[]>([]);
  const [balances, setBalances] = useState<Balances>(EMPTY_BALANCES);
  const [solvency, setSolvency] = useState<Solvency | null>(null);
  const [maturity, setMaturity] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the latest request so a slow stale fetch can't clobber a newer one.
  const reqId = useRef(0);

  const load = useCallback(
    async (isInitial: boolean) => {
      const id = ++reqId.current;
      if (isInitial) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        // Protocol-wide reads always run; wallet-specific reads only when connected.
        const [solv, mat, isPaused] = await Promise.all([
          getSolvency().catch(() => null),
          getMaturity().catch(() => null),
          getPaused().catch(() => false),
        ]);

        let nextPositions: PositionValue[] = [];
        let nextBalances: Balances = EMPTY_BALANCES;
        if (isConnected && address) {
          [nextPositions, nextBalances] = await Promise.all([
            getOwnerPositions(address).catch(() => []),
            getWalletBalances(address).catch(() => EMPTY_BALANCES),
          ]);
        }

        if (id !== reqId.current) return; // a newer load superseded us
        setSolvency(solv);
        setMaturity(mat);
        setPaused(isPaused);
        setPositions(nextPositions);
        setBalances(nextBalances);
      } catch (err) {
        if (id === reqId.current) {
          setError(err instanceof Error ? err.message : 'Failed to read protocol state.');
        }
      } finally {
        if (id === reqId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [address, isConnected],
  );

  // Initial load + reload whenever the connected account changes. This is a
  // legitimate data-fetch effect (loading state is set inside the async `load`).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(true);
  }, [load]);

  const refresh = useCallback(() => load(false), [load]);

  const { totalPrincipal, totalClaimable } = useMemo(() => {
    return positions.reduce(
      (acc, p) => ({
        totalPrincipal: acc.totalPrincipal + p.principal,
        totalClaimable: acc.totalClaimable + p.claimableYield,
      }),
      { totalPrincipal: 0n, totalClaimable: 0n },
    );
  }, [positions]);

  const value = useMemo<ProtocolContextValue>(
    () => ({
      positions,
      balances,
      solvency,
      maturity,
      paused,
      loading,
      refreshing,
      error,
      refresh,
      totalPrincipal,
      totalClaimable,
    }),
    [
      positions,
      balances,
      solvency,
      maturity,
      paused,
      loading,
      refreshing,
      error,
      refresh,
      totalPrincipal,
      totalClaimable,
    ],
  );

  return <ProtocolContext.Provider value={value}>{children}</ProtocolContext.Provider>;
};

export const useProtocol = (): ProtocolContextValue => {
  const ctx = useContext(ProtocolContext);
  if (!ctx) {
    throw new Error('useProtocol must be used within a <ProtocolProvider>.');
  }
  return ctx;
};
