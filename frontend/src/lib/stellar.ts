import {
  getAdapter,
  forgetWallet,
  rememberWallet,
  rememberedWallet,
  type SignResult,
  type WalletAdapter,
  type WalletId,
} from './wallets';

/**
 * Wallet connection layer.
 *
 * This module deals only with the *wallet connection* — detecting wallets,
 * requesting/restoring access, signing and watching for account changes. It holds
 * no contract or business logic.
 *
 * Multiple Stellar wallets are supported through small per-wallet adapters (see
 * `./wallets`). One adapter is "active" at a time; this module remembers which and
 * routes every call (including signing, used by `soroban.ts` / `horizon.ts`) to it.
 */

/** The currently connected wallet adapter, or `null` when disconnected. */
let active: WalletAdapter | null = null;

/** The active wallet adapter, or `null` if nothing is connected. */
export const activeWallet = (): WalletAdapter | null => active;

/** Shorten a Stellar public key for display, e.g. `GAWL…7JOE`. */
export const shortenAddress = (address: string, lead = 4, tail = 4): string => {
  if (!address) return '';
  if (address.length <= lead + tail) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
};

/**
 * Restore an existing session without prompting the user. Returns the connected
 * address if a previously-selected wallet still grants access, otherwise `null`.
 */
export const restoreConnection = async (): Promise<string | null> => {
  const id = rememberedWallet();
  if (!id) return null;
  const adapter = getAdapter(id);
  if (!adapter) return null;
  const address = await adapter.restore();
  if (!address) return null;
  active = adapter;
  return address;
};

/**
 * Prompt the user to connect the wallet identified by `walletId` and grant this
 * app access. Returns the connected address. Throws a user-friendly error if the
 * wallet is missing or the user rejects the request.
 */
export const connectWallet = async (walletId: WalletId): Promise<string> => {
  const adapter = getAdapter(walletId);
  if (!adapter) throw new Error('Unsupported wallet.');
  const address = await adapter.connect();
  active = adapter;
  rememberWallet(walletId);
  return address;
};

/**
 * "Disconnect" from the app's perspective. Wallets expose no programmatic way to
 * revoke access, so disconnecting means the app forgets the session.
 */
export const disconnectWallet = async (): Promise<void> => {
  active = null;
  forgetWallet();
};

/**
 * Read the network the active wallet is on (e.g. `TESTNET`), or `null` if it can't
 * be determined. Used to warn when the wallet is on the wrong network.
 */
export const getWalletNetwork = async (): Promise<string | null> => {
  if (!active) return null;
  return active.getNetwork();
};

/**
 * Sign a transaction XDR with the active wallet. Returns Freighter-shaped
 * `{ signedTxXdr, error }`. Used by the Soroban and Horizon submit paths.
 */
export const signWithWallet = async (
  xdr: string,
  opts: { networkPassphrase: string; address: string },
): Promise<SignResult> => {
  if (!active) {
    return { signedTxXdr: '', error: { message: 'No wallet is connected.' } };
  }
  return active.signTransaction(xdr, opts);
};

export type WalletChange = {
  address: string;
  network: string;
};

/**
 * Watch for the user switching accounts or networks in the active wallet. Returns
 * an unsubscribe function. Wallets without a change event return a no-op
 * unsubscribe (the app falls back to its own state).
 */
export const watchWallet = (onChange: (change: WalletChange) => void): (() => void) => {
  if (!active?.watch) return () => {};
  return active.watch(onChange);
};
