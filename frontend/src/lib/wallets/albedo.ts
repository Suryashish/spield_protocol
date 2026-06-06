import { networkNameFromPassphrase } from './network';
import type { WalletAdapter } from './types';

/**
 * Albedo — a web wallet with no extension. It signs inside a popup at albedo.link.
 *
 * Rather than bundle `@albedo-link/intent`, we lazy-load Albedo's tiny intent script
 * from their CDN the first time it's needed. That keeps Albedo entirely out of the
 * main bundle: users who never pick Albedo never download a byte of it.
 */

type Albedo = {
  publicKey: (opts?: { token?: string }) => Promise<{ pubkey: string }>;
  tx: (opts: {
    xdr: string;
    pubkey?: string;
    network?: string;
  }) => Promise<{ signed_envelope_xdr: string }>;
};

const ALBEDO_SRC = 'https://albedo.link/albedo-intent-buttons.js';

let loader: Promise<Albedo> | null = null;

/** Inject the Albedo intent script once and resolve with `window.albedo`. */
const loadAlbedo = (): Promise<Albedo> => {
  if (loader) return loader;
  loader = new Promise<Albedo>((resolve, reject) => {
    const existing = (window as unknown as { albedo?: Albedo }).albedo;
    if (existing) return resolve(existing);

    const script = document.createElement('script');
    script.src = ALBEDO_SRC;
    script.async = true;
    script.onload = () => {
      const albedo = (window as unknown as { albedo?: Albedo }).albedo;
      if (albedo) resolve(albedo);
      else reject(new Error('Albedo loaded but its API was not found.'));
    };
    script.onerror = () => {
      loader = null; // allow a retry on next attempt
      reject(new Error('Could not load Albedo. Check your connection and try again.'));
    };
    document.head.appendChild(script);
  });
  return loader;
};

export const albedoAdapter: WalletAdapter = {
  id: 'albedo',
  name: 'Albedo',
  installUrl: 'https://albedo.link/',
  webBased: true,

  // No extension to detect — Albedo is always available (it's a popup web wallet).
  isInstalled: async () => true,

  connect: async () => {
    const albedo = await loadAlbedo();
    const { pubkey } = await albedo.publicKey();
    if (!pubkey) throw new Error('Albedo did not return an account.');
    return pubkey;
  },

  // Albedo is stateless across page loads (no persistent grant); a returning user
  // re-authorizes via the popup on next connect.
  restore: async () => null,

  getNetwork: async () => null,

  signTransaction: async (xdr, opts) => {
    try {
      const albedo = await loadAlbedo();
      const { signed_envelope_xdr } = await albedo.tx({
        xdr,
        pubkey: opts.address,
        network: networkNameFromPassphrase(opts.networkPassphrase).toLowerCase(),
      });
      if (!signed_envelope_xdr) {
        return { signedTxXdr: '', error: { message: 'Albedo returned no signed transaction.' } };
      }
      return { signedTxXdr: signed_envelope_xdr };
    } catch (err) {
      return {
        signedTxXdr: '',
        error: { message: err instanceof Error ? err.message : 'Transaction was rejected in Albedo.' },
      };
    }
  },
};
