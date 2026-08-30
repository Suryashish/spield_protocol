import { CONTRACTS, VAULT_DEPLOYED } from './config';
import { addr, i128, readContract, toBaseUnits, u32, u64, writeContract } from './soroban';

/**
 * Typed client for the Fixed-Rate Vault — the flagship "lock X% fixed" product.
 *
 * The vault sits on top of the wrapper (PT-passthrough): a user deposits USDC and
 * receives a `FixedReceipt` worth a known `payout` (principal + a fixed coupon) at
 * maturity, backed 1:1 by PT the vault holds. Reads (`quote`, `stats`, receipts) are
 * free simulations; writes (`deposit`, `redeem`, `harvest`) need the connected wallet.
 *
 * Every entry point is a no-op when the vault isn't deployed yet (`VAULT_DEPLOYED`
 * is false), so the dashboard can render a "coming soon" state without throwing.
 */

/** A single fixed-rate receipt (mirrors the contract's `FixedReceipt`). */
export type Receipt = {
  receiptId: number;
  /** USDC principal deposited, base units. */
  principal: bigint;
  /** USDC the receipt pays at maturity (principal + fixed coupon), base units. Fixed, not
   *  guaranteed: it is a claim on PT, which redeems from the Blend position. */
  payout: bigint;
  /** The fixed APR locked in, basis points. */
  rateBps: number;
  /** Maturity, unix seconds. */
  maturity: number;
  open: boolean;
  /**
   * USDC already collected toward `payout` by an earlier partial redemption, base units.
   *
   * Non-zero only when a redeem could not gather the whole payout in one call — the lending venue
   * was short on cash. The amount is **safe and reserved for this receipt**; a later `redeem`
   * collects the rest. Zero on the ordinary path.
   */
  collected: bigint;
};

/** The vault's health snapshot (mirrors the contract's `VaultStats`). */
export type VaultStats = {
  /** PT the vault holds (its bond inventory), base units. */
  ptInventory: bigint;
  /** YT the vault holds (the variable leg), base units. */
  ytInventory: bigint;
  /** Sum of payouts across open receipts, base units. */
  totalLiability: bigint;
  /** Spare PT available to back new coupons (`ptInventory - totalLiability`), base units. */
  couponCapacity: bigint;
  /** Current quoted fixed APR, basis points. */
  rateBps: number;
  /** Maturity, unix seconds. */
  maturity: number;
};

/** A live deposit quote (mirrors the contract's `quote` tuple). */
export type Quote = {
  /** USDC the deposit would lock in at maturity, base units. */
  payout: bigint;
  /** The fixed coupon portion, base units. */
  coupon: bigint;
  /** The fixed APR, basis points. */
  rateBps: number;
};

const toBig = (v: unknown): bigint => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string') return BigInt(v);
  return 0n;
};

const toNum = (v: unknown): number => Number(toBig(v));

// ---------------------------------------------------------------- reads

/** Quote the payout a deposit of `amount` (human string) would lock in right now. */
export const quote = async (amount: string): Promise<Quote | null> => {
  if (!VAULT_DEPLOYED) return null;
  try {
    const tuple = await readContract<unknown[]>(CONTRACTS.vault, 'quote', [
      i128(toBaseUnits(amount)),
    ]);
    const [payout, coupon, rateBps] = tuple ?? [];
    return { payout: toBig(payout), coupon: toBig(coupon), rateBps: toNum(rateBps) };
  } catch {
    return null;
  }
};

/** Read the vault's health snapshot. */
export const getVaultStats = async (): Promise<VaultStats | null> => {
  if (!VAULT_DEPLOYED) return null;
  try {
    const raw = await readContract<Record<string, unknown>>(CONTRACTS.vault, 'stats');
    if (!raw) return null;
    return {
      ptInventory: toBig(raw.pt_inventory),
      ytInventory: toBig(raw.yt_inventory),
      totalLiability: toBig(raw.total_liability),
      couponCapacity: toBig(raw.coupon_capacity),
      rateBps: toNum(raw.rate_bps),
      maturity: toNum(raw.maturity),
    };
  } catch {
    return null;
  }
};

/** The current fixed APR quoted (basis points). */
export const getVaultRateBps = async (): Promise<number> => {
  if (!VAULT_DEPLOYED) return 0;
  try {
    return toNum(await readContract<unknown>(CONTRACTS.vault, 'rate_bps'));
  } catch {
    return 0;
  }
};

/** Read a single receipt by id. Returns `null` if it doesn't exist. */
export const getReceipt = async (receiptId: number): Promise<Receipt | null> => {
  if (!VAULT_DEPLOYED) return null;
  try {
    const raw = await readContract<Record<string, unknown>>(CONTRACTS.vault, 'get_receipt', [
      u64(receiptId),
    ]);
    if (!raw) return null;
    return {
      receiptId,
      principal: toBig(raw.principal),
      payout: toBig(raw.payout),
      rateBps: toNum(raw.rate_bps),
      maturity: toNum(raw.maturity),
      open: Boolean(raw.open),
      // v1 receipts have no partial-collection field; the resumable redeem is v2 only.
      collected: toBig(raw.collected),
    };
  } catch {
    return null;
  }
};

/**
 * Scan receipt ids from 0 upward, returning the open ones owned by `owner`. Like the
 * wrapper's position scan, the contract intentionally doesn't keep an owner→receipts
 * index on-chain (unbounded iteration), so the dashboard scans — fine for a testnet demo.
 */
export const getOwnerReceipts = async (owner: string, maxScan = 64): Promise<Receipt[]> => {
  if (!VAULT_DEPLOYED) return [];
  const receipts: Receipt[] = [];
  let misses = 0;
  const SCAN_CONCURRENCY = 6;
  for (let start = 0; start < maxScan && misses < 5; start += SCAN_CONCURRENCY) {
    const ids = Array.from(
      { length: Math.min(SCAN_CONCURRENCY, maxScan - start) },
      (_, offset) => start + offset,
    );
    const results = await Promise.allSettled(
      ids.map((id) =>
        readContract<Record<string, unknown>>(CONTRACTS.vault, 'get_receipt', [u64(id)]),
      ),
    );

    for (let index = 0; index < ids.length && misses < 5; index++) {
      const result = results[index];
      if (result.status === 'rejected' || !result.value) {
        // A missing receipt is an end-of-list signal. Previously only RPC errors
        // incremented this counter, so an empty vault could scan all 64 ids.
        misses += 1;
        continue;
      }

      misses = 0;
      const raw = result.value;
      if (String(raw.owner) !== owner || !raw.open) continue;
      receipts.push({
        receiptId: ids[index],
        principal: toBig(raw.principal),
        payout: toBig(raw.payout),
        rateBps: toNum(raw.rate_bps),
        maturity: toNum(raw.maturity),
        open: true,
        // v1 receipts have no partial-collection field; the resumable redeem is v2 only.
        collected: toBig(raw.collected),
      });
    }
  }
  return receipts;
};

// ---------------------------------------------------------------- writes

/** Deposit `amount` USDC (human string) and lock the current fixed rate. */
export const deposit = (wallet: string, amount: string) =>
  writeContract(wallet, CONTRACTS.vault, 'deposit', [addr(wallet), i128(toBaseUnits(amount))]);

/** Redeem a matured receipt for its full fixed payout. */
export const redeem = (wallet: string, receiptId: number) =>
  writeContract(wallet, CONTRACTS.vault, 'redeem', [u64(receiptId)]);

/**
 * How many tracked positions one `harvest` call sweeps. Mirrors the contract's
 * `MAX_HARVEST_BATCH`, which clamps `max_positions` to this internally — the largest batch that
 * fits a mainnet transaction with a deliberate memory margin. Keep in sync with
 * `contracts/vault/src/lib.rs`.
 */
export const MAX_HARVEST_BATCH = 3;

/**
 * Harvest the vault's accrued YT yield into fresh PT capacity (permissionless).
 *
 * `vault::harvest` takes a required `max_positions: u32` — calling it with no arguments cannot
 * succeed, which is what this used to do. Sweeping N tracked positions takes ceil(N/3) calls.
 */
export const harvest = (wallet: string, maxPositions: number = MAX_HARVEST_BATCH) =>
  writeContract(wallet, CONTRACTS.vault, 'harvest', [u32(maxPositions)]);
