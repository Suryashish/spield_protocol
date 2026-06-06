/**
 * Lightweight multi-wallet support for Stellar.
 *
 * Instead of pulling in the heavy `@creit.tech/stellar-wallets-kit` (which bundles
 * every wallet's SDK + WalletConnect), each supported wallet is a small adapter that
 * talks directly to the wallet's injected browser API. Adapters share one interface so
 * the rest of the app never needs to know which wallet is active.
 *
 * Adding a wallet = one new file implementing `WalletAdapter` + an entry in `index.ts`.
 */

/** Stable identifier for a wallet, persisted to localStorage to restore sessions. */
export type WalletId = 'freighter' | 'xbull' | 'rabet' | 'hana' | 'lobstr' | 'albedo';

/** Result of a signing request, shaped to mirror Freighter's `signTransaction`. */
export type SignResult = {
  signedTxXdr: string;
  /** Non-null when the wallet reported an error or the user rejected. */
  error?: { message: string } | null;
};

export type WatchHandler = (change: {
  /** Empty string when the wallet is locked or access was revoked. */
  address: string;
  /** Network name, e.g. `TESTNET`. May be empty if the wallet can't report it. */
  network: string;
}) => void;

export type WalletAdapter = {
  id: WalletId;
  /** Display name shown in the picker. */
  name: string;
  /**
   * Whether the wallet is usable right now. For extensions this means the global
   * is injected; for web wallets (Albedo) it's always true since there's nothing
   * to install.
   */
  isInstalled: () => Promise<boolean>;
  /** Where to send users who don't have the wallet yet. */
  installUrl: string;
  /** `true` for web/popup wallets that need no extension (shown without an "install" hint). */
  webBased?: boolean;

  /**
   * Prompt the user to connect and return the public key. Throws a readable error
   * if the wallet is missing or the request is rejected.
   */
  connect: () => Promise<string>;
  /**
   * Return the already-authorized address without prompting, or `null` if the app
   * was never granted access. Used to restore a session on page load.
   */
  restore: () => Promise<string | null>;
  /** Best-effort current network name, or `null` if it can't be determined. */
  getNetwork: () => Promise<string | null>;
  /**
   * Sign a transaction XDR. `address` is the connected account (some wallets
   * require it). Returns Freighter-shaped `{ signedTxXdr, error }`.
   */
  signTransaction: (xdr: string, opts: { networkPassphrase: string; address: string }) => Promise<SignResult>;
  /**
   * Subscribe to account/network changes, returning an unsubscribe function.
   * Optional — wallets without a change event simply don't provide one.
   */
  watch?: (onChange: WatchHandler) => () => void;
};
