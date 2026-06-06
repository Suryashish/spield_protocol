import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
  activeWallet,
  connectWallet,
  disconnectWallet,
  getWalletNetwork,
  restoreConnection,
  watchWallet,
} from '@/lib/stellar';
import { rememberedWallet, type WalletId } from '@/lib/wallets';
import { NETWORK } from '@/lib/config';
import WalletPicker from '@/components/dashboard/layout/WalletPicker';

type WalletContextValue = {
  /** Connected Stellar public key, or `null` when disconnected. */
  address: string | null;
  /** Which wallet is connected, or `null` when disconnected. */
  walletId: WalletId | null;
  /** True while a connect / restore request is in flight. */
  connecting: boolean;
  /** Last connection error message, if any. */
  error: string | null;
  isConnected: boolean;
  /** Network the wallet is on (e.g. `TESTNET`), or `null` if unknown. */
  network: string | null;
  /** True when the wallet is on the same network as the deployed contracts. */
  onCorrectNetwork: boolean;
  /** Connect a specific wallet by id (e.g. from the picker). */
  connect: (walletId: WalletId) => Promise<void>;
  disconnect: () => Promise<void>;
  /** Open the wallet picker modal (used by "Connect Wallet" CTAs app-wide). */
  openWalletPicker: () => void;
  /** Whether the wallet picker modal is open. */
  pickerOpen: boolean;
  /** Set the picker modal open state. */
  setPickerOpen: (open: boolean) => void;
};

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export const WalletProvider = ({ children }: { children: ReactNode }) => {
  const [address, setAddress] = useState<string | null>(null);
  const [walletId, setWalletId] = useState<WalletId | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Keep the watcher's teardown so we can stop it on disconnect/unmount.
  const stopWatchRef = useRef<(() => void) | null>(null);

  const startWatching = useCallback(() => {
    if (stopWatchRef.current) return;
    stopWatchRef.current = watchWallet(({ address: next, network: nextNetwork }) => {
      // Empty address means the wallet was locked or access revoked.
      setAddress(next || null);
      setNetwork(nextNetwork || null);
      if (!next) {
        setWalletId(null);
        if (stopWatchRef.current) {
          stopWatchRef.current();
          stopWatchRef.current = null;
        }
      }
    });
  }, []);

  // Restore a previously authorized session on first load.
  useEffect(() => {
    let active = true;
    restoreConnection().then(async (restored) => {
      if (!active || !restored) return;
      setAddress(restored);
      setWalletId(activeWallet()?.id ?? rememberedWallet());
      setNetwork(await getWalletNetwork());
      startWatching();
    });
    return () => {
      active = false;
      stopWatchRef.current?.();
      stopWatchRef.current = null;
    };
  }, [startWatching]);

  const connect = useCallback(
    async (id: WalletId) => {
      setConnecting(true);
      setError(null);
      try {
        const next = await connectWallet(id);
        setAddress(next);
        setWalletId(id);
        setNetwork(await getWalletNetwork());
        startWatching();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect wallet.');
        setAddress(null);
        setWalletId(null);
      } finally {
        setConnecting(false);
      }
    },
    [startWatching],
  );

  const disconnect = useCallback(async () => {
    await disconnectWallet();
    stopWatchRef.current?.();
    stopWatchRef.current = null;
    setAddress(null);
    setWalletId(null);
    setNetwork(null);
    setError(null);
  }, []);

  const openWalletPicker = useCallback(() => {
    setError(null);
    setPickerOpen(true);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      address,
      walletId,
      connecting,
      error,
      isConnected: Boolean(address),
      network,
      onCorrectNetwork: !network || network === NETWORK.name,
      connect,
      disconnect,
      openWalletPicker,
      pickerOpen,
      setPickerOpen,
    }),
    [address, walletId, connecting, error, network, connect, disconnect, openWalletPicker, pickerOpen],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      <WalletPicker open={pickerOpen} onOpenChange={setPickerOpen} />
    </WalletContext.Provider>
  );
};

export const useWallet = (): WalletContextValue => {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWallet must be used within a <WalletProvider>.');
  }
  return ctx;
};
