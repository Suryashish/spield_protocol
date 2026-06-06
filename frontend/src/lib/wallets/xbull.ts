import { networkNameFromPassphrase } from './network';
import type { WalletAdapter } from './types';

/**
 * xBull — browser extension that injects `window.xBullSDK`.
 *
 * The SDK requires an explicit permission grant (`connect`) declaring which
 * capabilities the app needs before `getPublicKey` / `signXDR` will work.
 */

type XBullSDK = {
  connect: (perms: {
    canRequestPublicKey?: boolean;
    canRequestSign?: boolean;
  }) => Promise<unknown>;
  getPublicKey: () => Promise<string>;
  signXDR: (
    xdr: string,
    opts?: { publicKey?: string; network?: string; networkPassphrase?: string },
  ) => Promise<string>;
};

const sdk = (): XBullSDK | undefined =>
  (window as unknown as { xBullSDK?: XBullSDK }).xBullSDK;

export const xbullAdapter: WalletAdapter = {
  id: 'xbull',
  name: 'xBull',
  installUrl: 'https://xbull.app/',

  isInstalled: async () => Boolean(sdk()),

  connect: async () => {
    const x = sdk();
    if (!x) throw new Error('xBull wallet not found. Install the xBull extension to continue.');
    await x.connect({ canRequestPublicKey: true, canRequestSign: true });
    const publicKey = await x.getPublicKey();
    if (!publicKey) throw new Error('No account is available in xBull.');
    return publicKey;
  },

  // xBull has no silent-restore API; calling getPublicKey after a granted session
  // resolves without a prompt, but throws if access was never granted.
  restore: async () => {
    const x = sdk();
    if (!x) return null;
    try {
      const publicKey = await x.getPublicKey();
      return publicKey || null;
    } catch {
      return null;
    }
  },

  // xBull doesn't expose the active network directly; assume it matches the app's.
  getNetwork: async () => null,

  signTransaction: async (xdr, opts) => {
    const x = sdk();
    if (!x) return { signedTxXdr: '', error: { message: 'xBull is not available.' } };
    try {
      const signedTxXdr = await x.signXDR(xdr, {
        publicKey: opts.address,
        network: networkNameFromPassphrase(opts.networkPassphrase),
        networkPassphrase: opts.networkPassphrase,
      });
      return { signedTxXdr };
    } catch (err) {
      return {
        signedTxXdr: '',
        error: { message: err instanceof Error ? err.message : 'Transaction was rejected in xBull.' },
      };
    }
  },
};
