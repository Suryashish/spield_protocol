import { albedoAdapter } from './albedo';
import { freighterAdapter } from './freighter';
import { hanaAdapter } from './hana';
import { lobstrAdapter } from './lobstr';
import { rabetAdapter } from './rabet';
import { xbullAdapter } from './xbull';
import type { WalletAdapter, WalletId } from './types';

export type { WalletAdapter, WalletId, SignResult, WatchHandler } from './types';

/** All supported wallets, in the order they appear in the picker. */
export const WALLETS: WalletAdapter[] = [
  freighterAdapter,
  xbullAdapter,
  rabetAdapter,
  hanaAdapter,
  lobstrAdapter,
  albedoAdapter,
];

const byId = new Map<WalletId, WalletAdapter>(WALLETS.map((w) => [w.id, w]));

export const getAdapter = (id: WalletId): WalletAdapter | undefined => byId.get(id);

const STORAGE_KEY = 'spield.wallet';

/** Remember which wallet the user connected, so the session restores after reload. */
export const rememberWallet = (id: WalletId): void => {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage may be unavailable (private mode); session just won't persist */
  }
};

export const forgetWallet = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
};

/** The wallet id from a previous session, if any and still supported. */
export const rememberedWallet = (): WalletId | null => {
  try {
    const id = localStorage.getItem(STORAGE_KEY) as WalletId | null;
    return id && byId.has(id) ? id : null;
  } catch {
    return null;
  }
};

/**
 * Probe every wallet's install state in parallel, for the picker. Returns a map
 * keyed by wallet id. Web-based wallets (Albedo) report `true` since there's
 * nothing to install.
 */
export const probeInstalled = async (): Promise<Record<WalletId, boolean>> => {
  const entries = await Promise.all(
    WALLETS.map(async (w) => [w.id, await w.isInstalled()] as const),
  );
  return Object.fromEntries(entries) as Record<WalletId, boolean>;
};
