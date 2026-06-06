import type { WalletAdapter } from './types';

/**
 * Hana — browser extension that injects `window.hanaWallet.stellar`.
 *
 * `getPublicKey()` returns the active account (string or `{ publicKey }`), and
 * `signTransaction({ xdr, networkPassphrase, accountToSign })` returns the signed
 * XDR (string or `{ signedXDR }`). We normalize both shapes defensively since the
 * exact return shape has varied across Hana versions.
 */

type HanaStellar = {
  getPublicKey: () => Promise<string | { publicKey: string }>;
  signTransaction: (req: {
    xdr: string;
    networkPassphrase?: string;
    accountToSign?: string;
  }) => Promise<string | { signedXDR?: string; signedTxXdr?: string }>;
};

const hana = (): HanaStellar | undefined =>
  (window as unknown as { hanaWallet?: { stellar?: HanaStellar } }).hanaWallet?.stellar;

const asKey = (v: string | { publicKey: string }): string =>
  typeof v === 'string' ? v : v.publicKey;

export const hanaAdapter: WalletAdapter = {
  id: 'hana',
  name: 'Hana',
  installUrl: 'https://www.hanawallet.io/',

  isInstalled: async () => Boolean(hana()),

  connect: async () => {
    const h = hana();
    if (!h) throw new Error('Hana wallet not found. Install the Hana extension to continue.');
    const key = asKey(await h.getPublicKey());
    if (!key) throw new Error('No account is available in Hana.');
    return key;
  },

  restore: async () => {
    const h = hana();
    if (!h) return null;
    try {
      const key = asKey(await h.getPublicKey());
      return key || null;
    } catch {
      return null;
    }
  },

  getNetwork: async () => null,

  signTransaction: async (xdr, opts) => {
    const h = hana();
    if (!h) return { signedTxXdr: '', error: { message: 'Hana is not available.' } };
    try {
      const res = await h.signTransaction({
        xdr,
        networkPassphrase: opts.networkPassphrase,
        accountToSign: opts.address,
      });
      const signedTxXdr =
        typeof res === 'string' ? res : res.signedTxXdr || res.signedXDR || '';
      if (!signedTxXdr) {
        return { signedTxXdr: '', error: { message: 'Hana returned no signed transaction.' } };
      }
      return { signedTxXdr };
    } catch (err) {
      return {
        signedTxXdr: '',
        error: { message: err instanceof Error ? err.message : 'Transaction was rejected in Hana.' },
      };
    }
  },
};
