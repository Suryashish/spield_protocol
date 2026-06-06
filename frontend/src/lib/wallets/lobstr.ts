import type { WalletAdapter } from './types';

/**
 * LOBSTR — browser extension (the LOBSTR Signer).
 *
 * Unlike the other extensions, LOBSTR doesn't expose a plain injected global; it
 * talks over a postMessage protocol that its tiny official package
 * `@lobstrco/signer-extension-api` implements (a few KB, no WalletConnect — nothing
 * like the full wallets-kit). We import it lazily so it's only pulled into the bundle
 * for users who actually pick LOBSTR.
 */

type LobstrApi = {
  isConnected: () => Promise<boolean>;
  getPublicKey: () => Promise<string>;
  signTransaction: (xdr: string) => Promise<string>;
};

let apiPromise: Promise<LobstrApi> | null = null;

// Lazy-load the LOBSTR signer package only when needed. `getPublicKey`/`signTransaction`
// are free functions in the package; we adapt them into a small object.
const loadApi = (): Promise<LobstrApi> => {
  if (apiPromise) return apiPromise;
  apiPromise = import('@lobstrco/signer-extension-api').then((mod) => ({
    isConnected: mod.isConnected,
    getPublicKey: mod.getPublicKey,
    signTransaction: mod.signTransaction,
  }));
  return apiPromise;
};

export const lobstrAdapter: WalletAdapter = {
  id: 'lobstr',
  name: 'LOBSTR',
  installUrl: 'https://lobstr.co/',

  isInstalled: async () => {
    try {
      const api = await loadApi();
      return await api.isConnected();
    } catch {
      return false;
    }
  },

  connect: async () => {
    const api = await loadApi();
    const connected = await api.isConnected();
    if (!connected) {
      throw new Error('LOBSTR signer not found. Install the LOBSTR Signer extension and try again.');
    }
    const publicKey = await api.getPublicKey();
    if (!publicKey) throw new Error('Connection request was rejected in LOBSTR.');
    return publicKey;
  },

  restore: async () => {
    try {
      const api = await loadApi();
      if (!(await api.isConnected())) return null;
      const publicKey = await api.getPublicKey();
      return publicKey || null;
    } catch {
      return null;
    }
  },

  getNetwork: async () => null,

  signTransaction: async (xdr) => {
    try {
      const api = await loadApi();
      const signedTxXdr = await api.signTransaction(xdr);
      if (!signedTxXdr) {
        return { signedTxXdr: '', error: { message: 'LOBSTR returned no signed transaction.' } };
      }
      return { signedTxXdr };
    } catch (err) {
      return {
        signedTxXdr: '',
        error: { message: err instanceof Error ? err.message : 'Transaction was rejected in LOBSTR.' },
      };
    }
  },
};
