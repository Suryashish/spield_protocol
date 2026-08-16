import { CONTRACTS } from './config';
import { addr, i128, readContract, toBaseUnits, u64, writeContract } from './soroban';

/**
 * Typed client for the Spield wrapper contract — the protocol's public surface.
 *
 * Reads (`getPositionValue`, `getSolvency`, balances, maturity) are free
 * simulations. Writes (`mint`, `claimYield`, `redeemPt`, `combineAndRedeem`)
 * require the connected wallet and return a tx hash.
 */

/** Live snapshot of a single position (mirrors the contract's `PositionValue`). */
export type PositionValue = {
  positionId: number;
  /** Principal still locked, base units. */
  principal: bigint;
  /** Yield claimable right now, base units. */
  claimableYield: bigint;
  /** PT held by this position, base units. */
  ptAmount: bigint;
  /** YT held by this position, base units. */
  ytAmount: bigint;
  open: boolean;
};

/** Protocol-wide solvency figures (mirrors the contract's `solvency()` tuple). */
export type Solvency = {
  /** Live value of the wrapper's whole Blend position, base units. */
  backing: bigint;
  /** Total outstanding principal, base units. */
  principal: bigint;
  /** Unclaimed yield = max(backing - principal, 0), base units. */
  unclaimed: bigint;
};

const toBig = (v: unknown): bigint => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string') return BigInt(v);
  return 0n;
};

// ---------------------------------------------------------------- reads

/**
 * A read for a position id that doesn't exist panics with `PositionNotFound`
 * (error #20). That's a *genuine* "no position here" signal and must be told
 * apart from a transient RPC/network failure — otherwise a network blip looks
 * identical to an empty slot and silently drops or truncates real positions.
 * Anything that isn't a not-found panic is treated as transient.
 */
const isPositionNotFound = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('PositionNotFound') || /Error\(Contract, ?#20\)/.test(msg);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Read a position's live value. Returns `null` only if the position genuinely
 * doesn't exist (`PositionNotFound`). A transient RPC error is retried and, if it
 * still fails, thrown — so a network blip never masquerades as "no position" and
 * silently drops a real holding from the list.
 */
export const getPositionValue = async (
  positionId: number,
  retries = 2,
): Promise<PositionValue | null> => {
  for (let attempt = 0; ; attempt++) {
    try {
      const raw = await readContract<Record<string, unknown>>(CONTRACTS.wrapper, 'position_value', [
        u64(positionId),
      ]);
      if (!raw) return null;
      return {
        positionId,
        principal: toBig(raw.principal),
        claimableYield: toBig(raw.claimable_yield),
        ptAmount: toBig(raw.pt_amount),
        ytAmount: toBig(raw.yt_amount),
        open: Boolean(raw.open),
      };
    } catch (err) {
      if (isPositionNotFound(err)) return null; // real gap
      if (attempt >= retries) throw err; // transient, out of retries
      await sleep(150 * (attempt + 1));
    }
  }
};

/**
 * Read `get_position(id)`, distinguishing three outcomes:
 *   - `{ ...position }` — the id exists.
 *   - `null`            — the id genuinely doesn't exist (PositionNotFound).
 *   - throws            — a transient error persisted through retries; the
 *                         caller must NOT treat this as "no position".
 * Transient failures are retried with a short backoff before giving up.
 */
const readPositionSlot = async (
  id: number,
  retries = 2,
): Promise<Record<string, unknown> | null> => {
  for (let attempt = 0; ; attempt++) {
    try {
      const pos = await readContract<Record<string, unknown>>(CONTRACTS.wrapper, 'get_position', [
        u64(id),
      ]);
      return pos ?? null;
    } catch (err) {
      if (isPositionNotFound(err)) return null; // real gap, not an error
      if (attempt >= retries) throw err; // transient, but out of retries → surface it
      await sleep(150 * (attempt + 1));
    }
  }
};

/**
 * Scan position ids from 0 upward, returning those owned by `owner` that still
 * hold PT or YT. Ids are global across all users, so this owner's positions can
 * be interspersed with gaps and other owners' ids.
 *
 * The contract intentionally doesn't expose an owner→positions index on-chain
 * (unbounded iteration), so the dashboard scans. We stop only after a long run
 * of *genuinely missing* ids (`PositionNotFound`), never on a transient RPC
 * error — a network blip mid-scan throws so the caller keeps the prior list
 * instead of rendering an empty "No open positions" state.
 */
export const getOwnerPositions = async (
  owner: string,
  maxScan = 128,
  /** Stop after this many consecutive genuinely-missing ids (end of the id space). */
  missStreakLimit = 12,
): Promise<PositionValue[]> => {
  const positions: PositionValue[] = [];
  let misses = 0;
  // Keep a small, bounded amount of parallelism. The old one-at-a-time scan made
  // every 50 ms RPC response visible as another request in DevTools and could make
  // a 128-id scan take several seconds. A bounded batch is much faster without
  // turning a public testnet endpoint into a 128-request burst.
  const SCAN_CONCURRENCY = 6;
  for (let start = 0; start < maxScan && misses < missStreakLimit; start += SCAN_CONCURRENCY) {
    const ids = Array.from(
      { length: Math.min(SCAN_CONCURRENCY, maxScan - start) },
      (_, offset) => start + offset,
    );
    const slots = await Promise.all(ids.map((id) => readPositionSlot(id)));

    for (let index = 0; index < ids.length && misses < missStreakLimit; index++) {
      const id = ids[index];
      const pos = slots[index];
      if (pos === null) {
        misses += 1;
        continue;
      }
      misses = 0;
      if (String(pos.owner) !== owner) continue;
      const value = await getPositionValue(id);
      if (value && (value.ptAmount > 0n || value.ytAmount > 0n || value.open)) {
        positions.push(value);
      }
    }
  }
  return positions;
};

/** Read protocol-wide solvency figures. */
export const getSolvency = async (): Promise<Solvency> => {
  const tuple = await readContract<unknown[]>(CONTRACTS.wrapper, 'solvency');
  const [backing, principal, unclaimed] = tuple ?? [];
  return {
    backing: toBig(backing),
    principal: toBig(principal),
    unclaimed: toBig(unclaimed),
  };
};

/** PT maturity as a unix-seconds timestamp. */
export const getMaturity = async (): Promise<number> => {
  const m = await readContract<unknown>(CONTRACTS.wrapper, 'maturity');
  return Number(toBig(m));
};

/**
 * Live Blend exchange rate (`b_rate`) from the strategy adapter, as raw SCALAR_12
 * (12-decimal fixed point — e.g. `1055750028382` = 1.05575…). This is the monotonic
 * rate whose growth over time *is* the protocol's realized yield. Returns null on
 * read failure so callers can degrade gracefully.
 */
export const getCurrentRate = async (): Promise<bigint | null> => {
  try {
    const r = await readContract<unknown>(CONTRACTS.strategy, 'current_rate');
    return toBig(r);
  } catch {
    return null;
  }
};

/** Whether the protocol is paused. */
export const getPaused = async (): Promise<boolean> =>
  readContract<boolean>(CONTRACTS.wrapper, 'is_paused');

/** Read a SAC token balance for `owner`, base units. */
export const getTokenBalance = async (token: string, owner: string): Promise<bigint> => {
  try {
    const bal = await readContract<unknown>(token, 'balance', [addr(owner)]);
    return toBig(bal);
  } catch {
    return 0n;
  }
};

/** Convenience: USDC / PT / YT balances for an account, in parallel. */
export const getWalletBalances = async (owner: string) => {
  const [usdc, pt, yt] = await Promise.all([
    getTokenBalance(CONTRACTS.usdc, owner),
    getTokenBalance(CONTRACTS.pt, owner),
    getTokenBalance(CONTRACTS.yt, owner),
  ]);
  return { usdc, pt, yt };
};

// ---------------------------------------------------------------- writes

/** Deposit `amount` USDC (human string) → mint PT + YT to the connected wallet. */
export const mint = (wallet: string, amount: string) =>
  writeContract(wallet, CONTRACTS.wrapper, 'mint', [addr(wallet), i128(toBaseUnits(amount))]);

/** Claim accrued yield for a position (keeps the YT). */
export const claimYield = (wallet: string, positionId: number) =>
  writeContract(wallet, CONTRACTS.wrapper, 'claim_yield', [u64(positionId)]);

/** Redeem `amount` PT 1:1 for USDC (only valid at/after maturity). */
export const redeemPt = (wallet: string, positionId: number, amount: string) =>
  writeContract(wallet, CONTRACTS.wrapper, 'redeem_pt', [u64(positionId), i128(toBaseUnits(amount))]);

/** Combine equal PT+YT and redeem principal early (auto-claims yield first). */
export const combineAndRedeem = (wallet: string, positionId: number, amount: string) =>
  writeContract(wallet, CONTRACTS.wrapper, 'combine_and_redeem', [
    u64(positionId),
    i128(toBaseUnits(amount)),
  ]);
