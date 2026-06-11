import { useCallback, useEffect, useRef, useState } from 'react';

import { getBridgeProgress, type BridgeProgress } from './allbridge';

/**
 * Local history of cross-chain bridge transfers, with live completion tracking.
 *
 * A bridge is asynchronous: the source tx confirms in seconds, but the funds only
 * land on Stellar once the messenger has collected enough signatures and the
 * destination claim runs — typically a few minutes later. The UI used to fire a
 * single "submitted" toast and then forget the transfer, so the user never saw
 * WHEN it actually completed. This module fixes that: it records each transfer the
 * moment it's submitted, persists it to `localStorage` so it survives a reload,
 * and polls Allbridge until the destination `receive` leg appears — capturing the
 * completion time to show in the bridge section.
 */

const STORAGE_KEY = 'spield.bridge.transfers.v1';

/** Keep the list bounded so old transfers don't grow unbounded in storage. */
const MAX_TRANSFERS = 25;

/** How often we poll the status of a still-pending transfer. */
const POLL_INTERVAL_MS = 15_000;

/** Stop polling a transfer this long after submission even if never resolved. */
const POLL_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

export type BridgeTransfer = {
  /** Source-chain tx hash — the key we poll status by. */
  hash: string;
  /** Allbridge source chain symbol (e.g. "ETH", "SOL") — needed for status lookup. */
  sourceChainSymbol: string;
  /** Human chain name for display (e.g. "Ethereum"). */
  sourceChainName: string;
  /** Source token symbol sent (e.g. "USDC"). */
  sourceSymbol: string;
  /** Amount sent, as the user entered it (float string). */
  amount: string;
  /** Stellar recipient (G-address). */
  recipient: string;
  /** Unix ms the transfer was submitted from this app. */
  startedAt: number;
  /** Average expected duration in ms (Allbridge estimate), or null if unknown. */
  etaMs: number | null;
  /** Unix ms the funds landed on Stellar, or null while pending. */
  completedAt: number | null;
  /** Destination (Stellar) tx hash once received, else null. */
  receiveHash: string | null;
  /** Signatures collected / needed — pending-phase progress, for display. */
  signaturesCount: number;
  signaturesNeeded: number;
};

/** What the panel passes in to start tracking a freshly-submitted transfer. */
export type NewBridgeTransfer = Pick<
  BridgeTransfer,
  | 'hash'
  | 'sourceChainSymbol'
  | 'sourceChainName'
  | 'sourceSymbol'
  | 'amount'
  | 'recipient'
  | 'startedAt'
  | 'etaMs'
>;

const isBrowser = typeof window !== 'undefined';

const load = (): BridgeTransfer[] => {
  if (!isBrowser) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Normalize fields that newer versions added so entries persisted by an older
    // build don't have `undefined` where the UI expects `null`.
    return (parsed as BridgeTransfer[]).map((t) => ({ ...t, etaMs: t.etaMs ?? null }));
  } catch {
    return [];
  }
};

const save = (transfers: BridgeTransfer[]) => {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(transfers.slice(0, MAX_TRANSFERS)));
  } catch {
    // Storage full / disabled — history is best-effort, so swallow.
  }
};

/** Merge a fresh status snapshot into a stored transfer (immutably). */
const applyProgress = (t: BridgeTransfer, p: BridgeProgress): BridgeTransfer => ({
  ...t,
  completedAt: p.completedAt ?? t.completedAt,
  receiveHash: p.receiveHash ?? t.receiveHash,
  signaturesCount: p.signaturesCount,
  signaturesNeeded: p.signaturesNeeded,
});

/**
 * Hook owning the bridge-transfer history + polling loop.
 *
 * Returns the list (newest first) and `track(transfer)` to start following a new
 * one. Pending transfers are polled on an interval until they complete or age out;
 * completed transfers keep their `completedAt` timestamp for the UI to render.
 */
export const useBridgeHistory = () => {
  const [transfers, setTransfers] = useState<BridgeTransfer[]>(load);

  // Mirror the latest list into a ref so the long-lived polling loop can read it
  // without re-subscribing on every change. Synced inside an effect (never during
  // render) so React's ref rules are satisfied.
  const transfersRef = useRef(transfers);
  useEffect(() => {
    transfersRef.current = transfers;
    save(transfers);
  }, [transfers]);

  const track = useCallback((t: NewBridgeTransfer) => {
    setTransfers((prev) => {
      // De-dupe by hash in case the same submit fires twice.
      if (prev.some((x) => x.hash === t.hash)) return prev;
      const entry: BridgeTransfer = {
        ...t,
        completedAt: null,
        receiveHash: null,
        signaturesCount: 0,
        signaturesNeeded: 0,
      };
      return [entry, ...prev].slice(0, MAX_TRANSFERS);
    });
  }, []);

  // Poll the status of every still-pending, not-yet-timed-out transfer.
  useEffect(() => {
    if (!isBrowser) return;

    let cancelled = false;

    const tick = async () => {
      const now = Date.now();
      const pending = transfersRef.current.filter(
        (t) => !t.completedAt && now - t.startedAt < POLL_TIMEOUT_MS,
      );
      if (pending.length === 0) return;

      const updates = await Promise.all(
        pending.map(async (t) => {
          const progress = await getBridgeProgress(t.sourceChainSymbol, t.hash);
          return progress ? { hash: t.hash, progress } : null;
        }),
      );
      if (cancelled) return;

      const byHash = new Map(updates.filter(Boolean).map((u) => [u!.hash, u!.progress]));
      if (byHash.size === 0) return;

      setTransfers((prev) =>
        prev.map((t) => {
          const p = byHash.get(t.hash);
          return p ? applyProgress(t, p) : t;
        }),
      );
    };

    // Poll once on mount (so a reload reconciles state quickly) then on interval.
    void tick();
    const id = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const clear = useCallback(() => setTransfers([]), []);

  return { transfers, track, clear };
};
