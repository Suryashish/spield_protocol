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

/** Read a position's live value. Returns `null` if the position doesn't exist. */
export const getPositionValue = async (positionId: number): Promise<PositionValue | null> => {
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
  } catch {
    // A non-existent position id makes the contract panic — treat as "no position".
    return null;
  }
};

/**
 * Scan position ids from 0 upward, returning those owned by `owner` that still
 * hold PT or YT. We discover ids by reading the raw `Position` (which carries the
 * owner) and stop after a run of missing ids.
 *
 * The contract intentionally doesn't expose an owner→positions index on-chain
 * (unbounded iteration), so the dashboard scans — fine for a testnet demo.
 */
export const getOwnerPositions = async (
  owner: string,
  maxScan = 64,
): Promise<PositionValue[]> => {
  const positions: PositionValue[] = [];
  let misses = 0;
  for (let id = 0; id < maxScan && misses < 5; id++) {
    let pos: Record<string, unknown> | null;
    try {
      pos = await readContract<Record<string, unknown>>(CONTRACTS.wrapper, 'get_position', [
        u64(id),
      ]);
    } catch {
      misses += 1;
      continue;
    }
    misses = 0;
    if (!pos || String(pos.owner) !== owner) continue;
    const value = await getPositionValue(id);
    if (value && (value.ptAmount > 0n || value.ytAmount > 0n || value.open)) {
      positions.push(value);
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
