import { Networks } from '@stellar/stellar-sdk';

import type { WalletAdapter } from './types';

/**
 * Rabet — browser extension that injects `window.rabet`.
 *
 * Its API is minimal: `connect()` returns `{ publicKey }` and `sign(xdr, network)`
 * returns `{ signedXDR }` (older builds use `{ xdr }`). Network is the lowercase
 * short name `'mainnet'` / `'testnet'`.
 */

type RabetResult = { publicKey?: string; signedXDR?: string; xdr?: string };
type Rabet = {
  connect: () => Promise<RabetResult>;
  sign: (xdr: string, network: 'mainnet' | 'testnet') => Promise<RabetResult>;
};

const rabet = (): Rabet | undefined => (window as unknown as { rabet?: Rabet }).rabet;

const networkArg = (passphrase: string): 'mainnet' | 'testnet' =>
  passphrase === Networks.PUBLIC ? 'mainnet' : 'testnet';

export const rabetAdapter: WalletAdapter = {
  id: 'rabet',
  name: 'Rabet',
  installUrl: 'https://rabet.io/',

  isInstalled: async () => Boolean(rabet()),

  connect: async () => {
    const r = rabet();
    if (!r) throw new Error('Rabet wallet not found. Install the Rabet extension to continue.');
    const { publicKey } = await r.connect();
    if (!publicKey) throw new Error('Connection request was rejected in Rabet.');
    return publicKey;
  },

  // Rabet always prompts on connect and has no silent-restore, so there is nothing
  // to restore without re-prompting; sessions are re-established by an explicit connect.
  restore: async () => null,

  getNetwork: async () => null,

  signTransaction: async (xdr, opts) => {
    const r = rabet();
    if (!r) return { signedTxXdr: '', error: { message: 'Rabet is not available.' } };
    try {
      const res = await r.sign(xdr, networkArg(opts.networkPassphrase));
      const signedTxXdr = res.signedXDR || res.xdr || '';
      if (!signedTxXdr) {
        return { signedTxXdr: '', error: { message: 'Rabet returned no signed transaction.' } };
      }
      return { signedTxXdr };
    } catch (err) {
      return {
        signedTxXdr: '',
        error: { message: err instanceof Error ? err.message : 'Transaction was rejected in Rabet.' },
      };
    }
  },
};
