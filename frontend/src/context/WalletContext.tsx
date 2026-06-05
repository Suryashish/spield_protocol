import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
  connectWallet,
  disconnectWallet,
  getWalletNetwork,
  restoreConnection,
  watchWallet,
} from '@/lib/stellar';
import { NETWORK } from '@/lib/config';

type WalletContextValue = {
  /** Connected Stellar public key, or `null` when disconnected. */
  address: string | null;
  /** True while a connect / restore request is in flight. */
  connecting: boolean;
  /** Last connection error message, if any. */
  error: string | null;
  isConnected: boolean;
  /** Network the wallet is on (e.g. `TESTNET`), or `null` if unknown. */
  network: string | null;
  /** True when the wallet is on the same network as the deployed contracts. */
  onCorrectNetwork: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
};

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export const WalletProvider = ({ children }: { children: ReactNode }) => {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);

  // Keep the watcher's teardown so we can stop it on disconnect/unmount.
  const stopWatchRef = useRef<(() => void) | null>(null);

  const startWatching = useCallback(() => {
    if (stopWatchRef.current) return;
    stopWatchRef.current = watchWallet(({ address: next, network: nextNetwork }) => {
      // Empty address means the wallet was locked or access revoked.
      setAddress(next || null);
      setNetwork(nextNetwork || null);
      if (!next && stopWatchRef.current) {
        stopWatchRef.current();
        stopWatchRef.current = null;
      }
    });
  }, []);

  // Restore a previously authorized session on first load.
  useEffect(() => {
    let active = true;
    restoreConnection().then(async (restored) => {
      if (!active || !restored) return;
      setAddress(restored);
      setNetwork(await getWalletNetwork());
      startWatching();
    });
    return () => {
      active = false;
      stopWatchRef.current?.();
      stopWatchRef.current = null;
    };
  }, [startWatching]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const next = await connectWallet();
      setAddress(next);
      setNetwork(await getWalletNetwork());
      startWatching();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect wallet.');
      setAddress(null);
    } finally {
      setConnecting(false);
    }
  }, [startWatching]);

  const disconnect = useCallback(async () => {
    await disconnectWallet();
    stopWatchRef.current?.();
    stopWatchRef.current = null;
    setAddress(null);
    setNetwork(null);
    setError(null);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      address,
      connecting,
      error,
      isConnected: Boolean(address),
      network,
      onCorrectNetwork: !network || network === NETWORK.name,
      connect,
      disconnect,
    }),
    [address, connecting, error, network, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

export const useWallet = (): WalletContextValue => {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWallet must be used within a <WalletProvider>.');
  }
  return ctx;
};
