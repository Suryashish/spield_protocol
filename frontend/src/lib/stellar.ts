import {
  getAddress,
  getNetwork,
  isAllowed,
  isConnected,
  requestAccess,
  setAllowed,
  WatchWalletChanges,
} from '@stellar/freighter-api';

/**
 * Thin wrapper around the Freighter wallet API.
 *
 * This module intentionally only deals with the *wallet connection*:
 * detecting the extension, requesting/restoring access and watching for
 * account changes. It holds no contract or business logic.
 */

/** Shorten a Stellar public key for display, e.g. `GAWL…7JOE`. */
export const shortenAddress = (address: string, lead = 4, tail = 4): string => {
  if (!address) return '';
  if (address.length <= lead + tail) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
};

/** True if the Freighter browser extension is installed/available. */
export const isWalletInstalled = async (): Promise<boolean> => {
  try {
    const { isConnected: installed, error } = await isConnected();
    if (error) return false;
    return Boolean(installed);
  } catch {
    return false;
  }
};

/**
 * Restore an existing session without prompting the user.
 *
 * Returns the connected address if the app was previously granted access,
 * otherwise `null`. Use this on page load so a returning user stays connected.
 */
export const restoreConnection = async (): Promise<string | null> => {
  try {
    const { isAllowed: allowed, error: allowedError } = await isAllowed();
    if (allowedError || !allowed) return null;

    const { address, error } = await getAddress();
    if (error || !address) return null;
    return address;
  } catch {
    return null;
  }
};

/**
 * Prompt the user to connect Freighter and grant this app access.
 *
 * Returns the connected address. Throws a user-friendly error if Freighter
 * is missing or the user rejects the request.
 */
export const connectWallet = async (): Promise<string> => {
  if (!(await isWalletInstalled())) {
    throw new Error('Freighter wallet not found. Install the Freighter extension to continue.');
  }

  // Make sure the app is on Freighter's allow-list, then read the address.
  await setAllowed();

  const { address, error } = await requestAccess();
  if (error) {
    throw new Error(error.message || 'Connection request was rejected.');
  }
  if (!address) {
    throw new Error('No account is available in Freighter.');
  }
  return address;
};

/**
 * "Disconnect" from the app's perspective.
 *
 * Freighter exposes no programmatic way to revoke access, so disconnecting
 * means the app forgets the session. The caller is responsible for clearing
 * its own state; this exists so consumers have a single, named entry point.
 */
export const disconnectWallet = async (): Promise<void> => {
  // No-op against the wallet itself — access is revoked by the user inside
  // the Freighter extension. Kept async so the contract stays stable if a
  // future Freighter version adds a real disconnect call.
};

/**
 * Read the network Freighter is currently pointed at (e.g. `TESTNET`).
 * Returns `null` if it can't be determined. Used to warn the user when their
 * wallet is on the wrong network for the deployed contracts.
 */
export const getWalletNetwork = async (): Promise<string | null> => {
  try {
    const { network, error } = await getNetwork();
    if (error || !network) return null;
    return network;
  } catch {
    return null;
  }
};

export type WalletChange = {
  address: string;
  network: string;
  networkPassphrase: string;
};

/**
 * Watch for the user switching accounts or networks inside Freighter.
 *
 * Returns an unsubscribe function. `onChange` fires whenever the active
 * address or network changes (including switching to a locked/empty wallet,
 * where `address` will be an empty string).
 */
export const watchWallet = (onChange: (change: WalletChange) => void): (() => void) => {
  const watcher = new WatchWalletChanges();
  watcher.watch(({ address, network, networkPassphrase }) => {
    onChange({ address, network, networkPassphrase });
  });
  return () => watcher.stop();
};
