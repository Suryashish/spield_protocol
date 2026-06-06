import {
  getAddress,
  getNetwork,
  isAllowed,
  isConnected,
  requestAccess,
  setAllowed,
  signTransaction as freighterSign,
  WatchWalletChanges,
} from '@stellar/freighter-api';

import type { WalletAdapter } from './types';

/** Freighter — the original supported wallet, via its official API package. */
export const freighterAdapter: WalletAdapter = {
  id: 'freighter',
  name: 'Freighter',
  installUrl: 'https://www.freighter.app/',

  isInstalled: async () => {
    try {
      const { isConnected: installed, error } = await isConnected();
      return !error && Boolean(installed);
    } catch {
      return false;
    }
  },

  connect: async () => {
    await setAllowed();
    const { address, error } = await requestAccess();
    if (error) throw new Error(error.message || 'Connection request was rejected.');
    if (!address) throw new Error('No account is available in Freighter.');
    return address;
  },

  restore: async () => {
    try {
      const { isAllowed: allowed, error: allowedError } = await isAllowed();
      if (allowedError || !allowed) return null;
      const { address, error } = await getAddress();
      if (error || !address) return null;
      return address;
    } catch {
      return null;
    }
  },

  getNetwork: async () => {
    try {
      const { network, error } = await getNetwork();
      return error || !network ? null : network;
    } catch {
      return null;
    }
  },

  signTransaction: async (xdr, opts) => {
    const { signedTxXdr, error } = await freighterSign(xdr, {
      networkPassphrase: opts.networkPassphrase,
      address: opts.address,
    });
    return { signedTxXdr, error };
  },

  watch: (onChange) => {
    const watcher = new WatchWalletChanges();
    watcher.watch(({ address, network }) => onChange({ address, network }));
    return () => watcher.stop();
  },
};
