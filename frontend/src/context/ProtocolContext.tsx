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
import {
  getOwnerReceipts,
  getVaultStats,
  type Receipt,
  type VaultStats,
} from '@/lib/vault';
import {
  getLpPosition,
  getMarketStats,
  type LpPosition,
  type MarketStats,
} from '@/lib/market';
import { getTrustlines, type TrustlineStatus } from '@/lib/horizon';

type Balances = { usdc: bigint; pt: bigint; yt: bigint };

type ProtocolContextValue = {
  /** The connected wallet's positions (those still holding PT or YT). */
  positions: PositionValue[];
  /** USDC / PT / YT balances for the connected wallet. */
  balances: Balances;
  /** Whether the connected wallet has the PT/YT trustlines needed to deposit. */
  trustlines: TrustlineStatus;
  /** Protocol-wide solvency snapshot. */
  solvency: Solvency | null;
  /** PT maturity, unix seconds (protocol-wide). */
  maturity: number | null;
  /** Whether the protocol is paused. */
  paused: boolean;
  /** The Fixed-Rate Vault's health snapshot (null until deployed / on read failure). */
  vaultStats: VaultStats | null;
  /** The connected wallet's open fixed-rate receipts. */
  receipts: Receipt[];
  /** The Market (PT/USDC AMM) pool + curve snapshot (null until deployed / on read failure). */
  marketStats: MarketStats | null;
  /** The connected wallet's LP position in the market pool. */
  lpPosition: LpPosition | null;
  /** True while the first load is in flight. */
  loading: boolean;
  /** True while a background refresh is running. */
  refreshing: boolean;
  /** Last load error, if any. */
  error: string | null;
  /** Unix ms of the last *successful* full read, or null if none has succeeded yet. */
  lastUpdated: number | null;
  /** True when the most recent read failed — the displayed numbers may be out of date. */
  stale: boolean;
  /** Re-read everything from chain (call after a successful write). */
  refresh: () => Promise<void>;
  // Aggregates across the wallet's positions, base units.
  totalPrincipal: bigint;
  totalClaimable: bigint;
};

const EMPTY_BALANCES: Balances = { usdc: 0n, pt: 0n, yt: 0n };
const EMPTY_TRUSTLINES: TrustlineStatus = { pt: false, yt: false, ready: false };

const ProtocolContext = createContext<ProtocolContextValue | undefined>(undefined);

export const ProtocolProvider = ({ children }: { children: ReactNode }) => {
  const { address, isConnected } = useWallet();

  const [positions, setPositions] = useState<PositionValue[]>([]);
  const [balances, setBalances] = useState<Balances>(EMPTY_BALANCES);
  const [trustlines, setTrustlines] = useState<TrustlineStatus>(EMPTY_TRUSTLINES);
  const [solvency, setSolvency] = useState<Solvency | null>(null);
  const [maturity, setMaturity] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [vaultStats, setVaultStats] = useState<VaultStats | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [marketStats, setMarketStats] = useState<MarketStats | null>(null);
  const [lpPosition, setLpPosition] = useState<LpPosition | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  // Track the latest request so a slow stale fetch can't clobber a newer one.
  const reqId = useRef(0);
  // React Strict Mode re-runs mount effects in development. Remembering the
  // account avoids starting a duplicate full on-chain scan for the same mount.
  const initialLoadKey = useRef<string | null>(null);

  const load = useCallback(
    async (isInitial: boolean, includeWallet = true) => {
      const id = ++reqId.current;
      if (isInitial) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        // Protocol-wide reads always run; wallet-specific reads only when connected.
        const [solv, mat, isPaused, vStats, mStats] = await Promise.all([
          getSolvency().catch(() => null),
          getMaturity().catch(() => null),
          getPaused().catch(() => false),
          getVaultStats().catch(() => null),
          getMarketStats().catch(() => null),
        ]);

        // Wallet-specific reads. Each can fail independently; a failed read must
        // PRESERVE the previous value, not blank it — otherwise a transient RPC
        // error wipes the user's positions to an empty "No open positions" state.
        // `undefined` = this read failed → keep prior state; a value (incl. `[]`)
        // = a real answer → apply it. `anyWalletReadFailed` flags the result stale.
        let nextPositions: PositionValue[] | undefined;
        let nextBalances: Balances | undefined;
        let nextTrustlines: TrustlineStatus | undefined;
        let nextReceipts: Receipt[] | undefined;
        let nextLp: LpPosition | null | undefined;
        let anyWalletReadFailed = false;
        if (isConnected && address && includeWallet) {
          const [posR, balR, tlR, rcptR, lpR] = await Promise.allSettled([
            getOwnerPositions(address),
            getWalletBalances(address),
            getTrustlines(address),
            getOwnerReceipts(address),
            getLpPosition(address),
          ]);
          if (posR.status === 'fulfilled') nextPositions = posR.value;
          else anyWalletReadFailed = true;
          if (balR.status === 'fulfilled') nextBalances = balR.value;
          else anyWalletReadFailed = true;
          if (tlR.status === 'fulfilled') nextTrustlines = tlR.value;
          else anyWalletReadFailed = true;
          if (rcptR.status === 'fulfilled') nextReceipts = rcptR.value;
          else anyWalletReadFailed = true;
          if (lpR.status === 'fulfilled') nextLp = lpR.value;
          else anyWalletReadFailed = true;
        } else if (!isConnected) {
          // Disconnected: reset wallet state to empty.
          nextPositions = [];
          nextBalances = EMPTY_BALANCES;
          nextTrustlines = EMPTY_TRUSTLINES;
          nextReceipts = [];
          nextLp = null;
        }

        if (id !== reqId.current) return; // a newer load superseded us
        setSolvency(solv);
        setMaturity(mat);
        setPaused(isPaused);
        setVaultStats(vStats);
        setMarketStats(mStats);
        // Only overwrite wallet state when the read actually succeeded.
        if (nextPositions !== undefined) setPositions(nextPositions);
        if (nextBalances !== undefined) setBalances(nextBalances);
        if (nextTrustlines !== undefined) setTrustlines(nextTrustlines);
        if (nextReceipts !== undefined) setReceipts(nextReceipts);
        if (nextLp !== undefined) setLpPosition(nextLp);
        if (anyWalletReadFailed) {
          setError('Some wallet data failed to load; showing the last known values.');
        }
        setLastUpdated(Date.now());
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
    const key = isConnected && address ? address : '__disconnected__';
    if (initialLoadKey.current === key) return;
    initialLoadKey.current = key;
    void load(true, true);
  }, [address, isConnected, load]);

  // Explicit/user-initiated refreshes (including post-transaction refreshes)
  // include wallet details. The background poll below deliberately does not:
  // owner-position and receipt scans are the expensive reads in this app.
  const refresh = useCallback(() => load(false, true), [load]);

  // Poll chain state in the background so yield, solvency, pool, and receipt numbers stay
  // live without the user clicking Refresh or doing a transaction. We skip the tick while the
  // tab is hidden (no point hammering the RPC for a screen nobody's looking at) and fire an
  // immediate catch-up refresh when it becomes visible again so a returning user sees fresh
  // data right away rather than waiting out the next interval.
  useEffect(() => {
    const POLL_MS = 30_000;
    const tick = () => {
      if (document.visibilityState === 'visible') void load(false, false);
    };
    const timer = setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(false, false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

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
      trustlines,
      solvency,
      maturity,
      paused,
      vaultStats,
      receipts,
      marketStats,
      lpPosition,
      loading,
      refreshing,
      error,
      lastUpdated,
      stale: error !== null,
      refresh,
      totalPrincipal,
      totalClaimable,
    }),
    [
      positions,
      balances,
      trustlines,
      solvency,
      maturity,
      paused,
      vaultStats,
      receipts,
      marketStats,
      lpPosition,
      loading,
      refreshing,
      error,
      lastUpdated,
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
