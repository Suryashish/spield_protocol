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
 * Install state per wallet. A missing key means "not determined yet" — callers must
 * render that as *checking*, never as installed or missing, or the picker will claim
 * something it doesn't know.
 */
export type InstallMap = Partial<Record<WalletId, boolean>>;

/**
 * How long one wallet's probe may take before the picker stops waiting on it. Probes
 * are postMessage round-trips to an extension; a wallet that never answers must not
 * pin its row (or the whole modal) in a loading state forever.
 */
const PROBE_TIMEOUT_MS = 1500;

/** Last known install state, replayed to paint a picker's first frame. */
const probeCache: InstallMap = {};

/**
 * Probe every wallet's install state, reporting each result **as it arrives** rather
 * than batching them. The adapters differ by orders of magnitude — xBull/Rabet/Hana
 * are a synchronous global lookup, while Freighter and LOBSTR are async round-trips
 * (LOBSTR also lazy-loads its signer package first) — so waiting for all of them
 * before showing any would hold the fast majority behind the slowest one.
 *
 * A probe that throws or stalls counts as "not installed"; a slow answer that arrives
 * after the timeout still gets reported, so a genuinely installed but sluggish wallet
 * corrects itself instead of being stuck on "Install".
 *
 * Anything an earlier probe already resolved is replayed synchronously up front, so a
 * caller that opens after the warm probe paints real state immediately rather than
 * showing "checking" for wallets whose answer is already known.
 *
 * Returns an unsubscribe function that stops further callbacks (the cache still fills).
 */
export const probeWallets = (
  onResult: (id: WalletId, installed: boolean) => void,
): (() => void) => {
  let active = true;
  const timers: ReturnType<typeof setTimeout>[] = [];

  const emit = (id: WalletId, installed: boolean) => {
    probeCache[id] = installed;
    if (active) onResult(id, installed);
  };

  for (const w of WALLETS) {
    const known = probeCache[w.id];
    if (known !== undefined) onResult(w.id, known);
  }

  for (const w of WALLETS) {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      emit(w.id, false);
    }, PROBE_TIMEOUT_MS);
    timers.push(timer);

    const settle = (installed: boolean) => {
      clearTimeout(timer);
      // After a timeout the row already reads "Install"; only a late `true` is news.
      if (!timedOut || installed) emit(w.id, installed);
    };

    try {
      Promise.resolve(w.isInstalled()).then(
        (installed) => settle(Boolean(installed)),
        () => settle(false),
      );
    } catch {
      // An adapter that throws synchronously must not take the other probes down.
      settle(false);
    }
  }

  return () => {
    active = false;
    timers.forEach(clearTimeout);
  };
};

let warmed = false;

/**
 * Kick off a probe ahead of time so the picker can paint real state on its first
 * frame. Safe to call repeatedly; only the first call does work.
 */
export const warmWalletProbe = (): void => {
  if (warmed) return;
  warmed = true;
  probeWallets(() => {});
};
