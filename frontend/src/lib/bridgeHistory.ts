import { useCallback, useEffect, useState } from 'react';

import { DEFAULT_CCTP_ENVIRONMENT, type CctpStep, type TransferMode } from './cctp';
import type { NetworkKey } from './config';

/** Local, best-effort history for Circle CCTP burns initiated by this browser. */
const STORAGE_KEY = 'spield.cctp.transfers.v2';
const MAX_TRANSFERS = 25;

export type BridgeTransfer = {
  /** Source-chain CCTP burn transaction hash. */
  hash: string;
  sourceChainShort: string;
  sourceChainName: string;
  amount: string;
  recipient: string;
  environment: NetworkKey;
  mode: TransferMode;
  startedAt: number;
  updatedAt: number;
  status: Exclude<CctpStep, 'idle' | 'approving' | 'burning'>;
  stellarHash: string | null;
  error: string | null;
};

export type NewBridgeTransfer = Pick<
  BridgeTransfer,
  | 'hash'
  | 'sourceChainShort'
  | 'sourceChainName'
  | 'amount'
  | 'recipient'
  | 'environment'
  | 'mode'
  | 'startedAt'
  | 'status'
>;

const isBrowser = typeof window !== 'undefined';

const load = (): BridgeTransfer[] => {
  if (!isBrowser) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return (parsed as BridgeTransfer[])
      .filter((transfer) =>
        typeof transfer.hash === 'string' && typeof transfer.status === 'string')
      .map((transfer) => ({
        ...transfer,
        environment: transfer.environment ?? DEFAULT_CCTP_ENVIRONMENT,
      }));
  } catch {
    return [];
  }
};

const save = (transfers: BridgeTransfer[]) => {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(transfers.slice(0, MAX_TRANSFERS)));
  } catch {
    // History must never block a bridge if browser storage is unavailable.
  }
};

export const useBridgeHistory = () => {
  const [transfers, setTransfers] = useState<BridgeTransfer[]>(load);

  useEffect(() => save(transfers), [transfers]);

  const track = useCallback((transfer: NewBridgeTransfer) => {
    setTransfers((current) => {
      if (current.some((item) => item.hash === transfer.hash)) return current;
      return [{
        ...transfer,
        updatedAt: transfer.startedAt,
        stellarHash: null,
        error: null,
      }, ...current].slice(0, MAX_TRANSFERS);
    });
  }, []);

  const update = useCallback((
    hash: string,
    patch: Partial<Pick<BridgeTransfer, 'status' | 'stellarHash' | 'error'>>,
  ) => {
    setTransfers((current) => current.map((transfer) =>
      transfer.hash === hash
        ? { ...transfer, ...patch, updatedAt: Date.now() }
        : transfer,
    ));
  }, []);

  const clear = useCallback(() => setTransfers([]), []);

  return { transfers, track, update, clear };
};
