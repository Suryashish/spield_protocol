import type { xdr } from '@stellar/stellar-sdk';
import { SR_CONTRACTS, SR_DEPLOYED, DECIMALS } from './config';
import {
  addr,
  i128,
  u32,
  u64,
  fromBaseUnits,
  readContract,
  toBaseUnits,
  writeContract,
  type WriteResult,
  simulateCall,
} from './soroban';

/**
 * Typed client for the **SR stack** — Spield v2's Pendle-shaped contracts.
 *
 * ```text
 * USDC ──deposit──► SR ──mint_py──► PT (SAC) + YT (the yield engine itself)
 *                    │                   │
 *                    └──── PT/SR AMM ────┘
 * ```
 *
 * ## Four things the UI must get right, or it will not work
 *
 * 1. **SR is a share token, not a wrapper.** `1 SR ≠ 1 USDC`. Its value is
 *    `balance × exchange_rate / 1e12`, and the rate only ever rises. Always show users USDC
 *    values via {@link srToUsdc}, never raw SR.
 *
 * 2. **The yield engine IS the YT token.** To read a YT balance you call `balance` on
 *    `SR_CONTRACTS.yieldEngine`. There is no YT SAC and **no YT trustline** — YT is a custom
 *    SEP-41 contract precisely so it can settle interest on transfer.
 *
 * 3. **PT still needs a trustline.** PT is a classic asset, so a wallet must trust
 *    `SR_CONTRACTS.ptAsset` before it can receive any. {@link needsPtTrustline} checks this, and
 *    the UI must offer the trustline before any flow that delivers PT (buying PT, minting PY,
 *    removing liquidity). **Buying YT does not deliver PT**, so it needs no trustline.
 *
 * 4. **`buy_yt_exact_out` takes a MAXIMUM, and refunds the rest.** Pass a slippage-padded
 *    `max_sr_in` — never the exact quote. The user's real cost is computed on chain from the live
 *    index, which moves between simulation and signing; sending the exact figure makes the wallet's
 *    authorization fail. {@link buyYt} pads for you.
 *
 * Reads are free simulations. Writes need the connected wallet. Every entry point is a no-op when
 * the stack is not deployed on this network (`SR_DEPLOYED` false), so the UI renders an
 * unavailable state instead of throwing.
 */

const SCALE_12 = 10n ** 12n;

const toBig = (v: unknown): bigint => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string' && v.length > 0) return BigInt(v);
  return 0n;
};

/** Convert a SCALAR_12 fixed-point value (price, APY fraction, index) to a JS number. */
export const fromScalar12 = (v: bigint): number => Number(v) / Number(SCALE_12);

/** Slippage padding applied to `max_sr_in` on a YT buy. 3% covers index drift comfortably. */
const YT_MAX_IN_PAD_BPS = 300n;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Everything the Markets header needs, in one read pass. */
export type SrMarketStats = {
  /** PT reserve, in PT face (asset units, 7 dp). */
  ptReserve: bigint;
  /** SR reserve, in SR shares. */
  srReserve: bigint;
  /** The SR reserve expressed in asset units — what the curve actually compares against PT. */
  assetReserve: bigint;
  totalShares: bigint;
  /** PT price in asset units, SCALAR_12 (1.0 = par). */
  ptPrice: bigint;
  /** Implied APY as a SCALAR_12 fraction (0.05e12 = 5%). */
  impliedApy: bigint;
  /** Series expiry, unix seconds. */
  expiry: number;
  /** Lifetime SR routed to the treasury from swap fees. */
  treasuryEarned: bigint;
  /** Treasury's share of each swap fee, bps. */
  treasuryFeeShareBps: number;
};

/** A wallet's complete position across the SR stack. */
export type SrPortfolio = {
  usdc: bigint;
  /** SR shares held. */
  sr: bigint;
  /** Those shares valued in USDC at the current rate. */
  srAsUsdc: bigint;
  /** PT face held (0 if no trustline). */
  pt: bigint;
  /** YT face held. */
  yt: bigint;
  /** Yield earned and withdrawable right now, in SR, GROSS of the protocol fee. */
  claimableYield: bigint;
  /** That claim valued in USDC. */
  claimableYieldAsUsdc: bigint;
  /** Lifetime SR already withdrawn as yield. */
  withdrawn: bigint;
  /** Whether the wallet can currently receive PT. */
  hasPtTrustline: boolean;
};

/** Engine-wide solvency, for the Solvency page. */
export type SrSolvency = {
  /** SR the engine holds. */
  held: bigint;
  /** SR needed to cover every PT at par plus every credited yield claim. */
  needed: bigint;
  /** `held - needed`. **Owed to YT holders**, not protocol surplus — see srstack.md §5. */
  surplus: bigint;
  /** PT face outstanding. */
  totalPy: bigint;
  /** Sum of credited-but-unwithdrawn yield. */
  totalAccrued: bigint;
  /** The live PY index (SCALAR_12). */
  index: bigint;
  /** Protocol share of YT interest, bps. */
  yieldFeeBps: number;
};

/** LP position in the PT/SR pool. */
export type SrLpPosition = {
  shares: bigint;
  ptClaim: bigint;
  srClaim: bigint;
};

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/** SR's current exchange rate (asset per SR, SCALAR_12). Pure, cheap, never writes. */
export const getExchangeRate = async (): Promise<bigint> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return SCALE_12;
  const v = await readContract(SR_CONTRACTS.sr, 'exchange_rate', []);
  const rate = toBig(v);
  // A zero rate would make every conversion below divide by zero; fall back to par.
  return rate > 0n ? rate : SCALE_12;
};

/** Value `srShares` in USDC base units at `rate`. */
export const srToUsdc = (srShares: bigint, rate: bigint): bigint =>
  rate > 0n ? (srShares * rate) / SCALE_12 : 0n;

/** How many SR `usdcAmount` would mint at `rate`. */
export const usdcToSr = (usdcAmount: bigint, rate: bigint): bigint =>
  rate > 0n ? (usdcAmount * SCALE_12) / rate : 0n;

export const getMarketStats = async (): Promise<SrMarketStats | null> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return null;
  const m = SR_CONTRACTS.market;
  try {
    const [reserves, assetReserve, totalShares, ptPrice, impliedApy, expiry, treasuryEarned, feeShare] =
      await Promise.all([
        readContract(m, 'reserves', []),
        readContract(m, 'asset_reserve', []),
        readContract(m, 'total_shares', []),
        readContract(m, 'pt_price', []),
        readContract(m, 'implied_apy', []),
        readContract(m, 'expiry', []),
        readContract(m, 'treasury_earned', []),
        readContract(m, 'treasury_fee_share_bps', []),
      ]);
    const pair = (reserves ?? []) as unknown[];
    return {
      ptReserve: toBig(pair[0]),
      srReserve: toBig(pair[1]),
      assetReserve: toBig(assetReserve),
      totalShares: toBig(totalShares),
      ptPrice: toBig(ptPrice),
      impliedApy: toBig(impliedApy),
      expiry: Number(toBig(expiry)),
      treasuryEarned: toBig(treasuryEarned),
      treasuryFeeShareBps: Number(toBig(feeShare)),
    };
  } catch {
    return null;
  }
};

export const getSolvency = async (): Promise<SrSolvency | null> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return null;
  const y = SR_CONTRACTS.yieldEngine;
  try {
    const [solv, totalPy, totalAccrued, index, feeBps] = await Promise.all([
      readContract(y, 'solvency', []),
      readContract(y, 'total_py', []),
      readContract(y, 'total_accrued', []),
      readContract(y, 'py_index', []),
      readContract(y, 'yield_fee_bps', []),
    ]);
    const t = (solv ?? []) as unknown[];
    return {
      held: toBig(t[0]),
      needed: toBig(t[1]),
      surplus: toBig(t[2]),
      totalPy: toBig(totalPy),
      totalAccrued: toBig(totalAccrued),
      index: toBig(index),
      yieldFeeBps: Number(toBig(feeBps)),
    };
  } catch {
    return null;
  }
};

/** Read a token balance, tolerating the "no trustline" error a classic SAC throws. */
const safeBalance = async (contract: string, owner: string): Promise<bigint> => {
  try {
    return toBig(await readContract(contract, 'balance', [addr(owner)]));
  } catch {
    return 0n;
  }
};

/**
 * Whether `owner` can receive PT. PT is a classic asset, so without a trustline the SAC's
 * `balance` call errors — which is exactly what we use to detect it.
 */
export const needsPtTrustline = async (owner: string): Promise<boolean> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return false;
  try {
    await readContract(SR_CONTRACTS.pt, 'balance', [addr(owner)]);
    return false;
  } catch {
    return true;
  }
};

export const getPortfolio = async (owner: string): Promise<SrPortfolio | null> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return null;
  const c = SR_CONTRACTS;
  try {
    const [rate, usdc, sr, pt, yt, claimable, interest, missingTrustline] = await Promise.all([
      getExchangeRate(),
      safeBalance(c.usdc, owner),
      safeBalance(c.sr, owner),
      safeBalance(c.pt, owner),
      // YT lives on the engine itself.
      safeBalance(c.yieldEngine, owner),
      readContract(c.yieldEngine, 'claimable_interest', [addr(owner)]).catch(() => 0n),
      readContract(c.yieldEngine, 'interest_of', [addr(owner)]).catch(() => null),
      needsPtTrustline(owner),
    ]);
    const claim = toBig(claimable);
    const rec = (interest ?? {}) as Record<string, unknown>;
    return {
      usdc,
      sr,
      srAsUsdc: srToUsdc(sr, rate),
      pt,
      yt,
      claimableYield: claim,
      claimableYieldAsUsdc: srToUsdc(claim, rate),
      withdrawn: toBig(rec.withdrawn),
      hasPtTrustline: !missingTrustline,
    };
  } catch {
    return null;
  }
};

export const getLpPosition = async (owner: string): Promise<SrLpPosition | null> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return null;
  try {
    const t = ((await readContract(SR_CONTRACTS.market, 'lp_position', [addr(owner)])) ??
      []) as unknown[];
    return { shares: toBig(t[0]), ptClaim: toBig(t[1]), srClaim: toBig(t[2]) };
  } catch {
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Quotes — all panic-free on chain: 0 means "no quote", never an exception.
// ─────────────────────────────────────────────────────────────────────────────

const quote = async (fn: string, arg: bigint): Promise<bigint> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return 0n;
  try {
    return toBig(await readContract(SR_CONTRACTS.market, fn, [i128(arg)]));
  } catch {
    return 0n;
  }
};

/** PT received for spending `srIn` SR. */
export const quoteBuyPt = (srIn: bigint) => quote('quote_buy_pt', srIn);
/** SR received for selling `ptIn` PT. */
export const quoteSellPt = (ptIn: bigint) => quote('quote_sell_pt', ptIn);
/** SR the user pays for exactly `ytOut` of YT face. */
export const quoteBuyYt = (ytOut: bigint) => quote('quote_buy_yt', ytOut);
/** SR the seller receives for `ytIn` of YT face. */
export const quoteSellYt = (ytIn: bigint) => quote('quote_sell_yt', ytIn);

/**
 * The leverage a YT buy gives: face ÷ cost. This is the number that makes YT worth explaining —
 * ~70x on a 90-day 5% pool means 1 USDC of exposure costs ~1.4 cents.
 *
 * Returns 0 when there is no quote.
 */
export const ytLeverage = (ytFace: bigint, srCost: bigint, rate: bigint): number => {
  if (srCost <= 0n) return 0;
  const costUsdc = srToUsdc(srCost, rate);
  if (costUsdc <= 0n) return 0;
  return Number(ytFace) / Number(costUsdc);
};

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Writes signal failure by THROWING — `WriteResult` is `{ hash }` and carries no error channel.
 * `useTxAction.run` catches and surfaces the message, so throwing is the correct shape here.
 */
const notDeployed = (): never => {
  throw new Error('The Spield v2 (SR) contracts are not deployed on this network.');
};

/** Wrap USDC into SR. `amount` is a human string (e.g. "50.5"). */
export const wrapUsdc = (wallet: string, amount: string): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return notDeployed();
  const units = toBaseUnits(amount);
  return writeContract(wallet, SR_CONTRACTS.sr, 'deposit', [
    addr(wallet),
    addr(wallet),
    i128(units),
    i128(0n),
  ]);
};

/** Unwrap SR back into USDC. `srShares` is a raw share amount, not a USDC figure. */
export const unwrapSr = (wallet: string, srShares: bigint): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return notDeployed();
  return writeContract(wallet, SR_CONTRACTS.sr, 'redeem', [
    addr(wallet),
    addr(wallet),
    i128(srShares),
    i128(0n),
  ]);
};

/** Strip SR into equal PT + YT. Requires a PT trustline. */
export const mintPy = (wallet: string, srIn: bigint): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return notDeployed();
  return writeContract(wallet, SR_CONTRACTS.yieldEngine, 'mint_py', [
    addr(wallet),
    addr(wallet),
    i128(srIn),
  ]);
};

/**
 * Recombine PT + YT back into SR.
 *
 * Before expiry this burns **both** legs. At/after expiry it burns **PT only** — a matured YT
 * carries no principal claim, so a PT holder who sold their YT can still redeem.
 */
export const redeemPy = (wallet: string, pyAmount: bigint): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return notDeployed();
  return writeContract(wallet, SR_CONTRACTS.yieldEngine, 'redeem_py', [
    addr(wallet),
    addr(wallet),
    i128(pyAmount),
  ]);
};

/** Buy PT with SR (the "earn fixed yield" trade). Requires a PT trustline. */
export const buyPt = (
  wallet: string,
  srIn: bigint,
  minPtOut: bigint,
): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return notDeployed();
  return writeContract(wallet, SR_CONTRACTS.market, 'swap_exact_sr_for_pt', [
    addr(wallet),
    i128(srIn),
    i128(minPtOut),
    u32(0),
  ]);
};

/** Sell PT back for SR. */
export const sellPt = (
  wallet: string,
  ptIn: bigint,
  minSrOut: bigint,
): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return notDeployed();
  return writeContract(wallet, SR_CONTRACTS.market, 'swap_exact_pt_for_sr', [
    addr(wallet),
    i128(ptIn),
    i128(minSrOut),
    u32(0),
  ]);
};

/**
 * Buy exactly `ytOut` of YT face — the capital-efficient "long yield" trade. **No PT trustline
 * needed**: the pool keeps the PT, the user receives only YT.
 *
 * `maxSrIn` is padded above the quote by {@link YT_MAX_IN_PAD_BPS} and the contract refunds
 * whatever is not needed. Do NOT pass the exact quote: the real cost is derived on chain from the
 * live index, which moves between the wallet's simulation and its signature, and an exact-amount
 * authorization then fails to match. Padding is what makes the signature valid.
 */
export const buyYt = async (wallet: string, ytOut: bigint): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return notDeployed();
  const quoted = await quoteBuyYt(ytOut);
  if (quoted <= 0n) {
    throw new Error(
      'No quote available — the pool cannot fill that size right now. Try a smaller amount.',
    );
  }
  const maxIn = quoted + (quoted * YT_MAX_IN_PAD_BPS) / 10_000n + 1n;
  return writeContract(wallet, SR_CONTRACTS.market, 'buy_yt_exact_out', [
    addr(wallet),
    i128(ytOut),
    i128(maxIn),
    u32(0),
  ]);
};

/** Sell `ytIn` of YT face back into the pool. The sale settles accrued yield but does NOT pay it —
 *  collect it separately with {@link claimYield}. */
export const sellYt = (
  wallet: string,
  ytIn: bigint,
  minSrOut: bigint,
): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return notDeployed();
  return writeContract(wallet, SR_CONTRACTS.market, 'sell_yt_exact_in', [
    addr(wallet),
    i128(ytIn),
    i128(minSrOut),
    u32(0),
  ]);
};

/** Transfer YT to another address. The engine settles both parties' interest first, so the yield
 *  correctly follows the token — the v1 stranding bug cannot happen here. */
export const transferYt = (
  wallet: string,
  to: string,
  amount: bigint,
): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return notDeployed();
  return writeContract(wallet, SR_CONTRACTS.yieldEngine, 'transfer', [
    addr(wallet),
    addr(to),
    i128(amount),
  ]);
};

/** Withdraw accrued yield, paid in SR net of the protocol's yield fee. */
export const claimYield = (wallet: string): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return notDeployed();
  return writeContract(wallet, SR_CONTRACTS.yieldEngine, 'redeem_due_interest', [addr(wallet)]);
};

/**
 * Add liquidity to the PT/SR pool.
 *
 * `minShares` is the caller's own tolerance and it changes which check applies:
 *
 * - `0n` (the default) keeps the pool's fixed ~0.1% ratio band. Safe, but any swap landing between
 *   your quote and your transaction moves the ratio and reverts the add.
 * - a positive value replaces that band with your bound: the contract mints `min(byPt, bySr)` and
 *   reverts `SlippageExceeded` (#81) below `minShares`. Use this for a pre-quoted deposit that must
 *   survive intervening flow — but size it deliberately, because the over-supplied leg is donated
 *   to the pool rather than refunded.
 */
export const addLiquidity = (
  wallet: string,
  ptIn: bigint,
  srIn: bigint,
  minShares: bigint = 0n,
): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return notDeployed();
  return writeContract(wallet, SR_CONTRACTS.market, 'add_liquidity', [
    addr(wallet),
    i128(ptIn),
    i128(srIn),
    i128(minShares),
  ]);
};

export const removeLiquidity = (
  wallet: string,
  shares: bigint,
): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return notDeployed();
  return writeContract(wallet, SR_CONTRACTS.market, 'remove_liquidity', [
    addr(wallet),
    i128(shares),
    i128(0n),
    i128(0n),
  ]);
};

// ─────────────────────────────────────────────────────────────────────────────
// Fixed-rate vault (srvault)
//
// Deposit USDC, lock today's rate, receive a receipt promising `payout` at maturity. The vault
// holds PT as bearer inventory, so the promise is backed by bond face rather than by a claim on
// anyone's position.
//
// **Redemption is resumable.** During a venue liquidity crunch a `redeem` collects what it can,
// banks it against the receipt, and returns; the holder is paid in full only once `collected`
// reaches `payout`. Call it again as liquidity returns. `vaultRedeemRemaining` says how much is
// still outstanding, and `receipt.collected` how much is already secured.
// ─────────────────────────────────────────────────────────────────────────────

export interface SrVaultStats {
  ptInventory: bigint;
  ytInventory: bigint;
  totalLiability: bigint;
  couponCapacity: bigint;
  /** USDC banked against partially-redeemed receipts. Reserved — never swept. */
  totalCollected: bigint;
  rateBps: number;
  maturity: number;
  openReceipts: number;
}

export interface SrVaultReceipt {
  owner: string;
  principal: bigint;
  payout: bigint;
  rateBps: number;
  maturity: number;
  open: boolean;
  /** USDC already collected toward `payout`. Non-zero only mid-way through a crunched exit. */
  collected: bigint;
}

const VAULT_DEPLOYED = (): boolean => Boolean(SR_DEPLOYED && SR_CONTRACTS?.vault);

export const SR_VAULT_AVAILABLE = VAULT_DEPLOYED();

export const getVaultStats = async (): Promise<SrVaultStats | null> => {
  if (!VAULT_DEPLOYED() || !SR_CONTRACTS) return null;
  try {
    const s = (await readContract(SR_CONTRACTS.vault, 'stats', [])) as Record<string, unknown>;
    return {
      ptInventory: BigInt((s.pt_inventory as string) ?? 0),
      ytInventory: BigInt((s.yt_inventory as string) ?? 0),
      totalLiability: BigInt((s.total_liability as string) ?? 0),
      couponCapacity: BigInt((s.coupon_capacity as string) ?? 0),
      totalCollected: BigInt((s.total_collected as string) ?? 0),
      rateBps: Number(s.rate_bps ?? 0),
      maturity: Number(s.maturity ?? 0),
      openReceipts: Number(s.open_receipts ?? 0),
    };
  } catch {
    return null;
  }
};

/** `(payout, coupon, rateBps)` for a prospective deposit. Read-only. */
export const quoteVaultDeposit = async (
  usdcAmount: bigint,
): Promise<{ payout: bigint; coupon: bigint; rateBps: number } | null> => {
  if (!VAULT_DEPLOYED() || !SR_CONTRACTS) return null;
  try {
    const q = (await readContract(SR_CONTRACTS.vault, 'quote', [i128(usdcAmount)])) as unknown[];
    return { payout: BigInt(q[0] as string), coupon: BigInt(q[1] as string), rateBps: Number(q[2]) };
  } catch {
    return null;
  }
};

export const getVaultReceipt = async (receiptId: bigint): Promise<SrVaultReceipt | null> => {
  if (!VAULT_DEPLOYED() || !SR_CONTRACTS) return null;
  try {
    const r = (await readContract(SR_CONTRACTS.vault, 'get_receipt', [
      u64(receiptId),
    ])) as Record<string, unknown>;
    return {
      owner: String(r.owner),
      principal: BigInt((r.principal as string) ?? 0),
      payout: BigInt((r.payout as string) ?? 0),
      rateBps: Number(r.rate_bps ?? 0),
      maturity: Number(r.maturity ?? 0),
      open: Boolean(r.open),
      collected: BigInt((r.collected as string) ?? 0),
    };
  } catch {
    return null;
  }
};

/** USDC a receipt still needs before it can be paid. `0n` = ready (or already closed). */
export const vaultRedeemRemaining = async (receiptId: bigint): Promise<bigint> => {
  if (!VAULT_DEPLOYED() || !SR_CONTRACTS) return 0n;
  try {
    return BigInt(
      (await readContract(SR_CONTRACTS.vault, 'redeem_remaining', [u64(receiptId)])) as string,
    );
  } catch {
    return 0n;
  }
};

/** Deposit USDC and receive a receipt. Returns the write result; the id is in the event. */
export const vaultDeposit = (wallet: string, usdcAmount: bigint): Promise<WriteResult> => {
  if (!VAULT_DEPLOYED() || !SR_CONTRACTS) return notDeployed();
  return writeContract(wallet, SR_CONTRACTS.vault, 'deposit', [addr(wallet), i128(usdcAmount)]);
};

/**
 * Redeem a matured receipt.
 *
 * May be **partial** under a venue liquidity crunch: the call banks what it collected and leaves
 * the receipt open. Check {@link vaultRedeemRemaining} afterwards and call again as liquidity
 * returns — progress is never lost.
 */
export const vaultRedeem = (wallet: string, receiptId: bigint): Promise<WriteResult> => {
  if (!VAULT_DEPLOYED() || !SR_CONTRACTS) return notDeployed();
  return writeContract(wallet, SR_CONTRACTS.vault, 'redeem', [u64(receiptId)]);
};

/** Claim the vault's YT yield and reinvest it as fresh PT capacity. Permissionless upkeep. */
export const vaultHarvest = (wallet: string): Promise<WriteResult> => {
  if (!VAULT_DEPLOYED() || !SR_CONTRACTS) return notDeployed();
  return writeContract(wallet, SR_CONTRACTS.vault, 'harvest', []);
};

/** Keep a long-dated receipt's storage entry alive. Permissionless. */
export const bumpVaultReceipt = (wallet: string, receiptId: bigint): Promise<WriteResult> => {
  if (!VAULT_DEPLOYED() || !SR_CONTRACTS) return notDeployed();
  return writeContract(wallet, SR_CONTRACTS.vault, 'bump_receipt', [u64(receiptId)]);
};

/** What an admin sweep would release right now: `(sr, yt, usdc)`. Read-only. */
export const getVaultSurplus = async (): Promise<{ sr: bigint; yt: bigint; usdc: bigint } | null> => {
  if (!VAULT_DEPLOYED() || !SR_CONTRACTS) return null;
  try {
    const v = (await readContract(SR_CONTRACTS.vault, 'surplus', [])) as unknown[];
    return { sr: BigInt(v[0] as string), yt: BigInt(v[1] as string), usdc: BigInt(v[2] as string) };
  } catch {
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TTL keep-alive
//
// Soroban archives a persistent entry whose TTL lapses, and an archived entry needs an off-chain
// restore to recover. Every entry below is bumped whenever it is *written*, so these matter only
// for a holder who opens a position and then does nothing — which for SR, whose wrapper has no
// maturity at all, is the ordinary case rather than the edge case.
//
// All four are permissionless: they extend an entry and never move value, so anyone (including a
// keeper) may call them on anyone's behalf. Each no-ops when the address holds nothing.
// ─────────────────────────────────────────────────────────────────────────────

/** Keep an SR holder's balance entry alive. */
export const bumpSrHolder = (wallet: string, holder: string = wallet): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return notDeployed();
  return writeContract(wallet, SR_CONTRACTS.sr, 'bump_holder', [addr(holder)]);
};

/** Keep a YT holder's interest record *and* balance entry alive. */
export const bumpYieldHolder = (wallet: string, holder: string = wallet): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return notDeployed();
  return writeContract(wallet, SR_CONTRACTS.yieldEngine, 'bump_holder', [addr(holder)]);
};

/** Keep an LP's share entry alive. */
export const bumpLpPosition = (wallet: string, lp: string = wallet): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return notDeployed();
  return writeContract(wallet, SR_CONTRACTS.market, 'bump_lp', [addr(lp)]);
};

/**
 * Bump every entry this wallet could own, in one go. Cheap and idempotent — the calls that find
 * nothing simply do nothing — so it is the sensible thing to run when a dormant user returns.
 */
export const bumpAll = async (wallet: string): Promise<WriteResult[]> =>
  Promise.all([bumpSrHolder(wallet), bumpYieldHolder(wallet), bumpLpPosition(wallet)]);

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────────────────

export const SR_DECIMALS = DECIMALS;

/** PT price as a plain number (1.0 = par). */
export const ptPriceHuman = (s: SrMarketStats | null): number =>
  s ? fromScalar12(s.ptPrice) : 0;

/** Implied APY as a percentage. */
export const impliedApyPct = (s: SrMarketStats | null): number =>
  s ? fromScalar12(s.impliedApy) * 100 : 0;

/** Total pool value in USDC base units (PT at its market price + SR at the index). */
export const poolValueUsdc = (s: SrMarketStats | null): bigint => {
  if (!s) return 0n;
  const ptValue = (s.ptReserve * s.ptPrice) / SCALE_12;
  return ptValue + s.assetReserve;
};

/** Days remaining until expiry (0 once matured). */
export const daysToExpiry = (s: SrMarketStats | null): number => {
  if (!s) return 0;
  const secs = s.expiry - Math.floor(Date.now() / 1000);
  return secs > 0 ? Math.ceil(secs / 86_400) : 0;
};

export const isMatured = (s: SrMarketStats | null): boolean =>
  s ? Math.floor(Date.now() / 1000) >= s.expiry : false;

// ─────────────────────────────────────────────────────────────────────────────
// Router — the one-transaction USDC front door
// ─────────────────────────────────────────────────────────────────────────────
//
// Everything above this line deals in SR, because that is what the core contracts speak. Everything
// below deals in USDC, because that is what users have. The router is the translation, and it is
// the default path for every buy and sell in the UI.
//
// Three properties the UI depends on, all enforced on chain:
//
// 1. **The router never holds funds.** Each entry point ends with its balance of USDC/SR/PT/YT back
//    at zero, asserted in the contract. So there is no "stuck in the router" state to design for.
// 2. **Exact-input on the way in and out, exact-OUTPUT on YT.** `buy_yt_with_usdc` names the YT you
//    want and a USDC ceiling; the change comes back. This is forced, not a preference — see
//    {@link buyYtFromUsdc}.
// 3. **Quotes are produced by the same composition that executes**, so what the panel shows is what
//    the transaction does, to within index drift of a ledger or two.

/** True when the router is deployed and wired on this network. */
export const ROUTER_AVAILABLE = Boolean(
  SR_DEPLOYED && SR_CONTRACTS?.router && !SR_CONTRACTS.router.startsWith('__'),
);

/** Default floor applied to `min_*_out` on router exits, in bps below the executable amount. */
export const DEFAULT_SLIPPAGE_BPS = 100n;

/** The slippage settings the UI offers. 0.1% is tight, 5% is the "just fill it" end. */
export const SLIPPAGE_CHOICES_BPS = [10n, 50n, 100n, 300n, 500n] as const;

/**
 * **ECO-01 — when is a trade big enough that splitting it is worth the trouble?**
 *
 * The curve prices a trade at its *post-trade* proportion, so one large trade is charged
 * conservatively and a sliced one converges on the true integral. Slicing therefore gets a better
 * price. That is inherited from Pendle's convention, not a fault — but it is real money, so the UI
 * should say so instead of letting the user find out afterwards.
 *
 * **Measured**, not guessed — `srmarket::economics_test::eco01_how_the_slicing_gain_scales_with_trade_size`
 * on a balanced 500k/500k pool, one trade vs five slices:
 *
 * ```text
 *    1% of pool -> +0.0214%      10% of pool -> +0.2148%
 *    2% of pool -> +0.0429%      20% of pool -> +0.4347%
 *    5% of pool -> +0.1072%
 * ```
 *
 * The gain is linear in the fraction of the pool consumed: **≈ 2.15 bps per 1% of pool**. Five
 * slices capture ~81% of everything available (100 slices reach +0.2659% where 5 reach +0.2148%),
 * so there is no reason to suggest more.
 *
 * Returns `null` below the threshold — most trades should say nothing at all.
 */
export const SPLIT_ADVICE_MIN_GAIN_BPS = 10n; // ~0.1%; below this the extra signatures aren't worth it
const GAIN_BPS_PER_PCT_OF_POOL = 215n; // 2.15 bps, held as hundredths to stay in integers

export type SplitAdvice = {
  /** The trade as a percentage of the reserve it draws down. */
  pctOfPool: number;
  /** Estimated gain from splitting into `slices`, in bps. */
  estimatedGainBps: number;
  /** How many pieces to suggest. Five captures ~81% of the available gain. */
  slices: number;
};

/**
 * Advice for a trade of `notionalAsset` (asset units — USDC-equivalent), or `null` when the trade is
 * small enough that splitting it would not pay for the extra signatures.
 *
 * The denominator is the **smaller** reserve. On the balanced pool the calibration ran against the
 * two are equal; on a lopsided one this warns earlier, which is the safe direction.
 */
export const splitAdvice = async (notionalAsset: bigint): Promise<SplitAdvice | null> => {
  if (notionalAsset <= 0n) return null;
  const stats = await getMarketStats();
  if (!stats) return null;

  const reference =
    stats.ptReserve < stats.assetReserve ? stats.ptReserve : stats.assetReserve;
  if (reference <= 0n) return null;

  // pct in hundredths of a percent, to stay in integer maths.
  const pctHundredths = (notionalAsset * 10_000n) / reference;
  const gainBps = (pctHundredths * GAIN_BPS_PER_PCT_OF_POOL) / 10_000n;
  if (gainBps < SPLIT_ADVICE_MIN_GAIN_BPS) return null;

  return {
    pctOfPool: Number(pctHundredths) / 100,
    estimatedGainBps: Number(gainBps),
    slices: 5,
  };
};


/**
 * **Size `min_out` from a simulation of the real entry point, not from `quote_*`.**
 *
 * `FINAL_CHECK.md` V2-01: the market synchronizes SR on every value-moving call, but the `quote_*`
 * views cannot — a view may not write. So a quote prices on SR's stored rate, which lags whenever
 * nothing has synced since the last mutation, and for a SALE it therefore reports MORE than the
 * trade will pay. Deriving `min_out` from it means the trade can trip its own slippage bound and
 * revert, for no reason the user can see.
 *
 * Simulating the entry point runs the same synchronized code the submission runs, so its result is
 * what actually executes. `simulateCall` signs and sends nothing.
 *
 * `quoted` is the fallback: simulation legitimately returns `null` when the user cannot yet afford
 * the trade, when the pool cannot fill it, or on a deployment predating the route. Falling back to
 * the view reproduces exactly today's behaviour rather than blocking the trade.
 */
const executableOut = async (
  method: string,
  args: xdr.ScVal[],
  wallet: string,
  quoted: bigint,
): Promise<bigint> => {
  if (!SR_CONTRACTS) return quoted;
  const simulated = await simulateCall(SR_CONTRACTS.router, method, args, wallet);
  return simulated !== null && simulated > 0n ? simulated : quoted;
};

/**
 * Apply the slippage floor to whichever basis we ended up trusting.
 *
 * `min_out` is the user's only protection against the price moving between simulation and
 * execution: the contract reverts rather than filling worse than this. It is deliberately the
 * caller's choice — a tight floor protects the price and risks a revert, a loose one fills but
 * accepts a worse rate — so the UI exposes it rather than deciding for everybody.
 */
const floorOut = (basis: bigint, slippageBps: bigint = DEFAULT_SLIPPAGE_BPS): bigint =>
  basis > 0n ? basis - (basis * slippageBps) / 10_000n : 0n;

const routerNotDeployed = (): never => {
  throw new Error('The Spield v2 router is not deployed on this network.');
};

const routerQuote = async (fn: string, arg: bigint): Promise<bigint> => {
  if (!ROUTER_AVAILABLE || !SR_CONTRACTS) return 0n;
  try {
    return toBig(await readContract(SR_CONTRACTS.router, fn, [i128(arg)]));
  } catch {
    return 0n;
  }
};

/** PT received for spending `usdcIn` USDC, wrap included. */
export const quoteBuyPtWithUsdc = (usdcIn: bigint) =>
  routerQuote('quote_buy_pt_with_usdc', usdcIn);

/** USDC needed to buy exactly `ytOut` of YT face, wrap included. */
export const quoteBuyYtWithUsdc = (ytOut: bigint) =>
  routerQuote('quote_buy_yt_with_usdc', ytOut);

/** USDC received for selling `ptIn` PT, unwrap included. */
export const quoteSellPtForUsdc = (ptIn: bigint) =>
  routerQuote('quote_sell_pt_for_usdc', ptIn);

/** USDC received for selling `ytIn` of YT face, unwrap included. */
export const quoteSellYtForUsdc = (ytIn: bigint) =>
  routerQuote('quote_sell_yt_for_usdc', ytIn);

/** USDC paid by redeeming `pyAmount` of face — par, no curve, no slippage. */
export const quoteRedeemPyForUsdc = (pyAmount: bigint) =>
  routerQuote('quote_redeem_py_for_usdc', pyAmount);

/** USDC a yield claim would pay right now, net of the protocol's yield fee. */
export const quoteClaimYieldUsdc = async (owner: string): Promise<bigint> => {
  if (!ROUTER_AVAILABLE || !SR_CONTRACTS) return 0n;
  try {
    return toBig(await readContract(SR_CONTRACTS.router, 'quote_claim_yield', [addr(owner)]));
  } catch {
    return 0n;
  }
};

/**
 * **Buy PT with plain USDC, one signature.** Requires a PT trustline — the user receives PT.
 *
 * `amount` is a human string. The floor is derived from the live quote so the user is protected
 * across the *whole* route: a bad wrap rate and a bad swap price both land in the same number.
 */
export const buyPtWithUsdc = async (
  wallet: string,
  amount: string,
  /** Caller's slippage tolerance in bps below the executable amount. */
  slippageBps: bigint = DEFAULT_SLIPPAGE_BPS,
): Promise<WriteResult> => {
  if (!ROUTER_AVAILABLE || !SR_CONTRACTS) return routerNotDeployed();
  const units = toBaseUnits(amount);
  const quoted = await quoteBuyPtWithUsdc(units);
  if (quoted <= 0n) {
    throw new Error('No quote available — the pool cannot fill that size right now.');
  }
  const basis = await executableOut(
    'buy_pt_with_usdc',
    [addr(wallet), i128(units), i128(0n), u32(0)],
    wallet,
    quoted,
  );
  const minOut = floorOut(basis, slippageBps);
  return writeContract(wallet, SR_CONTRACTS.router, 'buy_pt_with_usdc', [
    addr(wallet),
    i128(units),
    i128(minOut),
    u32(0),
  ]);
};

/**
 * **Buy YT starting from plain USDC — in two transactions, deliberately.**
 *
 * Everything else in this file is one signature. YT is not, and the reason is a hard measured limit
 * rather than a design choice:
 *
 * ```text
 * srmarket.buy_yt_exact_out alone   →  Success
 * sr.deposit alone                  →  Success
 * both in one transaction           →  Error(Budget, ExceededLimit)      (testnet, 2026-08-25)
 * ```
 *
 * A Blend supply plus a `mint_py`-bearing curve trade exceeds one Soroban transaction against a
 * pool of Blend's weight. `srrouter.buy_yt_with_usdc` exists, is correct and is fully tested — it
 * simply cannot execute here, so wiring the UI to it would ship a button that always fails.
 *
 * So: wrap only what the trade needs, then buy. The user signs twice and the outcome is identical.
 * If they already hold enough SR, step one is skipped and it *is* one signature.
 *
 * `onProgress` reports which leg is running so the UI can say "1 of 2" instead of going quiet
 * between two wallet prompts — which reads as a hang.
 */
export const buyYtFromUsdc = async (
  wallet: string,
  ytOut: bigint,
  onProgress?: (step: 'wrap' | 'buy', of: number) => void,
): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return notDeployed();

  const srNeeded = await quoteBuyYt(ytOut);
  if (srNeeded <= 0n) {
    throw new Error(
      'No quote available — the pool cannot fill that size right now. Try a smaller amount.',
    );
  }
  // Pad, because the market re-prices against the live index at execution and the refund makes
  // over-padding free. Under-padding costs the trade.
  const srBudget = srNeeded + (srNeeded * YT_MAX_IN_PAD_BPS) / 10_000n + 1n;

  const held = await safeBalance(SR_CONTRACTS.sr, wallet);
  const steps = held >= srBudget ? 1 : 2;

  if (held < srBudget) {
    onProgress?.('wrap', steps);
    // Wrap the shortfall, converted at the current rate and rounded up so one stroop of drift
    // cannot leave us a stroop short after signing.
    const rate = await getExchangeRate();
    const shortfallUsdc = srToUsdc(srBudget - held, rate) + 1n;
    await wrapUsdc(wallet, fromBaseUnits(shortfallUsdc).toString());
  }

  onProgress?.('buy', steps);
  return writeContract(wallet, SR_CONTRACTS.market, 'buy_yt_exact_out', [
    addr(wallet),
    i128(ytOut),
    i128(srBudget),
    u32(0),
  ]);
};

/**
 * USDC a two-step YT buy will cost, all in. Composes the market's SR quote with the wrapper's rate,
 * so it is the same arithmetic {@link buyYtFromUsdc} performs.
 */
export const quoteBuyYtFromUsdc = async (ytOut: bigint): Promise<bigint> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return 0n;
  const sr = await quoteBuyYt(ytOut);
  if (sr <= 0n) return 0n;
  return srToUsdc(sr, await getExchangeRate());
};

/** **Sell PT straight back to USDC, one signature.** */
export const sellPtForUsdc = async (
  wallet: string,
  ptIn: bigint,
  /** Caller's slippage tolerance in bps below the executable amount. */
  slippageBps: bigint = DEFAULT_SLIPPAGE_BPS,
): Promise<WriteResult> => {
  if (!ROUTER_AVAILABLE || !SR_CONTRACTS) return routerNotDeployed();
  const quoted = await quoteSellPtForUsdc(ptIn);
  const basis = await executableOut(
    'sell_pt_for_usdc',
    [addr(wallet), i128(ptIn), i128(0n), u32(0)],
    wallet,
    quoted,
  );
  const minOut = floorOut(basis, slippageBps);
  return writeContract(wallet, SR_CONTRACTS.router, 'sell_pt_for_usdc', [
    addr(wallet),
    i128(ptIn),
    i128(minOut),
    u32(0),
  ]);
};

/**
 * Sell YT and unwrap the proceeds, as a step list.
 *
 * **Prefer this over {@link sellYtForUsdc}.** That one-transaction path stopped fitting on
 * 2026-08-26: it was the heaviest router path that worked (64.5M instructions), and growing the SR
 * and strategy contracts — to add the TVL cap and the partial-exit path, both closing real tracker
 * items — pushed the *cumulative* memory budget over. Both legs still work perfectly alone.
 *
 * That is the trade, stated plainly: two features that close `tofix.md` #3 and #20 cost one
 * convenience path a second signature. It also makes the two YT directions symmetric — buying has
 * needed two since the beginning, for the same reason.
 *
 * `onProgress` reports which leg is running so the UI can show "1 of 2" rather than going quiet
 * between two wallet prompts.
 */
export const sellYtToUsdc = async (
  wallet: string,
  ytIn: bigint,
  onProgress?: (step: 'sell' | 'unwrap', of: number) => void,
): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return notDeployed();
  const quoted = await quoteSellYt(ytIn);
  if (quoted <= 0n) {
    throw new Error('The pool cannot fill that size right now. Try a smaller amount.');
  }
  const before = await safeBalance(SR_CONTRACTS.sr, wallet);

  onProgress?.('sell', 2);
  await sellYt(wallet, ytIn, (quoted * 99n) / 100n);

  // Unwrap what the sale actually produced, not the quote — re-read rather than assume, since the
  // market re-prices against the live index between the two transactions.
  const after = await safeBalance(SR_CONTRACTS.sr, wallet);
  const proceeds = after - before;
  if (proceeds <= 0n) {
    throw new Error('The sale completed but produced no SR to unwrap.');
  }
  onProgress?.('unwrap', 2);
  return unwrapSr(wallet, proceeds);
};

/**
 * **Sell YT straight back to USDC, one signature.**
 *
 * **Does not currently execute against Blend's deployed pool** — see {@link sellYtToUsdc}. Kept
 * because the contract entry point is correct and a lighter yield source would run it.
 *
 * The sale settles the seller's accrued interest before the balance moves — the engine's
 * `before_yt_change` hook — so selling never forfeits yield already earned. It stays claimable
 * afterwards via {@link claimYieldToUsdc}, which the UI should say out loud.
 */
export const sellYtForUsdc = async (
  wallet: string,
  ytIn: bigint,
  /** Caller's slippage tolerance in bps below the executable amount. */
  slippageBps: bigint = DEFAULT_SLIPPAGE_BPS,
): Promise<WriteResult> => {
  if (!ROUTER_AVAILABLE || !SR_CONTRACTS) return routerNotDeployed();
  const quoted = await quoteSellYtForUsdc(ytIn);
  const basis = await executableOut(
    'sell_yt_for_usdc',
    [addr(wallet), i128(ytIn), i128(0n), u32(0)],
    wallet,
    quoted,
  );
  const minOut = floorOut(basis, slippageBps);
  return writeContract(wallet, SR_CONTRACTS.router, 'sell_yt_for_usdc', [
    addr(wallet),
    i128(ytIn),
    i128(minOut),
    u32(0),
  ]);
};

/**
 * **Redeem principal to USDC at face, one signature.**
 *
 * * **After maturity** this is the exit: PT alone, par value, no curve and no liquidity needed. The
 *   market refuses to trade past expiry, so {@link sellPtForUsdc} stops working exactly where this
 *   starts mattering — the UI must switch over at maturity.
 * * **Before maturity** the same call is a *recombine*: it burns both PT and YT and pays face. No
 *   spread, but it needs both legs, so only offer it when the user holds both.
 */
export const redeemPyForUsdc = async (
  wallet: string,
  pyAmount: bigint,
  /** Caller's slippage tolerance in bps below the executable amount. */
  slippageBps: bigint = DEFAULT_SLIPPAGE_BPS,
): Promise<WriteResult> => {
  if (!ROUTER_AVAILABLE || !SR_CONTRACTS) return routerNotDeployed();
  const quoted = await quoteRedeemPyForUsdc(pyAmount);
  const basis = await executableOut(
    'redeem_py_for_usdc',
    [addr(wallet), i128(pyAmount), i128(0n)],
    wallet,
    quoted,
  );
  const minOut = floorOut(basis, slippageBps);
  return writeContract(wallet, SR_CONTRACTS.router, 'redeem_py_for_usdc', [
    addr(wallet),
    i128(pyAmount),
    i128(minOut),
  ]);
};

/**
 * **Claim accrued YT yield straight to USDC, one signature.**
 *
 * This is what makes YT legible: holding it earns SR continuously, and without this the holder has
 * to claim SR, then unwrap it, then work out which of the two numbers was their actual return.
 * Claiming does not consume the YT — the position keeps earning.
 */
export const claimYieldToUsdc = (wallet: string): Promise<WriteResult> => {
  if (!ROUTER_AVAILABLE || !SR_CONTRACTS) return routerNotDeployed();
  return writeContract(wallet, SR_CONTRACTS.router, 'claim_yield_to_usdc', [
    addr(wallet),
    i128(0n),
  ]);
};

/**
 * Solve "how much YT face can I get for `usdcBudget`?" — the inverse of
 * {@link quoteBuyYtFromUsdc}.
 *
 * The purchase is exact-*output* by necessity (see {@link buyYtFromUsdc}), but users think in
 * "I want to spend $100". Rather than push that mismatch onto them, we invert the quote here.
 *
 * Cost is very nearly linear in face over any size a single user trades, so a scaled secant
 * converges in two or three probes; we cap it at five and accept the last under-budget candidate.
 * Every iteration is a free simulation, and returning slightly *under* budget is the safe
 * direction — the padded ceiling absorbs the difference and the remainder is refunded.
 *
 * Returns `0n` when the pool cannot fill anything at that budget.
 */
export const solveYtFaceForUsdc = async (usdcBudget: bigint): Promise<bigint> => {
  if (!ROUTER_AVAILABLE || usdcBudget <= 0n) return 0n;

  // Opening guess. The multiplier depends on the series: YT costs roughly the yield over the
  // remaining term, so a 90-day 5% pool prices it near 1.2% of face (~80x) while a 30-day 2.5% one
  // prices it near 0.37% (~270x). Being wrong is cheap — phase 1 corrects it.
  let face = usdcBudget * 80n;
  let cost = 0n;

  // ── Phase 1: find ANY fillable size ───────────────────────────────────────────────────────────
  //
  // **The binding constraint is usually the POOL, not the budget.** A thin pool caps the face far
  // below what the budget could afford, and halving from the opening guess can take a dozen steps
  // to reach it. This phase therefore gets its own generous bound.
  //
  // Sharing one iteration budget across both phases produced a bug where a LARGER budget returned a
  // WORSE answer: measured on a 2.6 USDC PT reserve, a 1 USDC budget found a fill on its last
  // allowed probe while a 2 USDC budget ran out one step short and quoted nothing at all.
  for (let i = 0; i < 40 && face > 0n; i += 1) {
    cost = await quoteBuyYtFromUsdc(face);
    if (cost > 0n) break;
    face /= 2n;
  }
  if (face <= 0n || cost <= 0n) return 0n;

  // ── Phase 2: refine toward the budget ─────────────────────────────────────────────────────────
  //
  // Cost is very nearly linear in face over any size a single user trades, so a scaled secant
  // converges in two or three probes. Returning slightly UNDER budget is the safe direction — the
  // padded ceiling absorbs the difference and the remainder is refunded.
  let best = cost <= usdcBudget ? face : 0n;
  for (let i = 0; i < 5; i += 1) {
    if (cost > 0n && cost <= usdcBudget && usdcBudget - cost <= usdcBudget / 200n) return face;
    const next = (face * usdcBudget) / cost;
    if (next <= 0n) break;
    // Damp the first correction; an opening guess far off can otherwise overshoot into a size the
    // pool cannot quote at all, wasting a probe.
    face = i === 0 ? (face + next) / 2n : next;
    if (face <= 0n) break;
    cost = await quoteBuyYtFromUsdc(face);
    if (cost <= 0n) {
      // Overshot the pool's capacity. Step back toward the last size that worked.
      face = best > 0n ? (face + best) / 2n : face / 2n;
      if (face <= 0n) break;
      cost = await quoteBuyYtFromUsdc(face);
      if (cost <= 0n) break;
    }
    if (cost <= usdcBudget && face > best) best = face;
  }
  return best;
};

// ─────────────────────────────────────────────────────────────────────────────
// The launch TVL cap (tofix.md #3)
// ─────────────────────────────────────────────────────────────────────────────
//
// #3 accepts a residual — a deep Blend bad-debt event freezes withdrawals — and mitigates it by
// bounding total exposure. The cap is enforced in `Sr::deposit` rather than in a runbook, and it
// gates deposits ONLY: no cap setting can ever block a withdrawal.

const srRead = async (fn: string, fallback: bigint): Promise<bigint> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return fallback;
  try {
    return toBig(await readContract(SR_CONTRACTS.sr, fn, []));
  } catch {
    // An older deployment predates the cap. Report "uncapped" rather than throwing — but note the
    // UI says "no cap is set", which is the truthful reading either way.
    return fallback;
  }
};

/** The TVL cap in USDC base units. `0n` means uncapped. */
export const getDepositCap = () => srRead('deposit_cap', 0n);
/** Underlying currently deployed through the wrapper — what the cap is measured against. */
export const getTotalAssets = () => srRead('total_assets', 0n);
/** Underlying that can still be deposited before the cap bites. */
export const getDepositHeadroom = () => srRead('deposit_headroom', 0n);

// ─────────────────────────────────────────────────────────────────────────────
// Honest valuation after a loss (FINAL_CHECK RISK-01)
// ─────────────────────────────────────────────────────────────────────────────
//
// `exchange_rate` is a HIGH-WATER MARK: it ratchets up and never falls. That is deliberate — it
// stops the whole protocol repricing on a transient dip — but it means every value we show the
// user (`assets_of`, `preview_redeem`, `total_assets`, and therefore this dashboard) reports MORE
// underlying than a withdrawal would actually pay once Blend has taken a real loss.
//
// `sr.realizable_rate()` is the honest twin: total assets that actually exist / total SR shares.
// It reads the venue with no monotonicity guard, so unlike `current_rate` it keeps answering while
// exits are frozen — which is exactly when somebody needs the number.
//
// **It returns `null` on a deployment that predates the method**, which is the same graceful
// degradation `srRead` uses for the deposit cap. The UI simply omits the comparison until the
// contracts carrying `realizable_rate` are live, and lights up on its own afterwards with no
// frontend change.

/** Underlying per 1e12 SR valued on what ACTUALLY exists. `null` when the deployment predates it. */
export const getRealizableRate = async (): Promise<bigint | null> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return null;
  try {
    const rate = toBig(await readContract(SR_CONTRACTS.sr, 'realizable_rate', []));
    return rate > 0n ? rate : null;
  } catch {
    return null; // pre-`realizable_rate` deployment — omit the comparison rather than throwing
  }
};

export type SrValueGap = {
  /** What the protocol quotes — the high-water `exchange_rate`. */
  quoted: bigint;
  /** What actually exists, per 1e12 SR. */
  realizable: bigint;
  /** How far the quote overstates reality, in basis points. `0` when the quote is honest. */
  shortfallBps: number;
};

/**
 * Compare the quoted rate against the realizable one. `null` while `realizable_rate` is
 * unavailable, so callers can render nothing rather than a misleading zero.
 *
 * `realizable` sitting slightly ABOVE `quoted` is normal and harmless — it sees accrual the stored
 * rate has not synced yet. Only the other direction matters, so `shortfallBps` floors at 0.
 */
export const getValueGap = async (): Promise<SrValueGap | null> => {
  const [quoted, realizable] = await Promise.all([getExchangeRate(), getRealizableRate()]);
  if (realizable === null || quoted <= 0n) return null;
  const shortfall = quoted > realizable ? ((quoted - realizable) * 10_000n) / quoted : 0n;
  return { quoted, realizable, shortfallBps: Number(shortfall) };
};

/** Value `srShares` on what actually exists, not on the high-water quote. `null` if unavailable. */
export const getRealizableValue = async (srShares: bigint): Promise<bigint | null> => {
  const rate = await getRealizableRate();
  return rate === null ? null : srToUsdc(srShares, rate);
};

// ─────────────────────────────────────────────────────────────────────────────
// Exit liquidity (tofix.md #20)
// ─────────────────────────────────────────────────────────────────────────────
//
// A withdrawal can fail for a reason that has nothing to do with solvency: borrowers have taken the
// venue's supply and there is nothing on hand to pay with. Until now that surfaced as a bare
// revert. These two let the UI say "you can take out X right now" instead, and let the user take
// that X rather than nothing.

/** The largest redemption that can succeed right now, in SR shares. `null` when unconstrained. */
export const getMaxRedeemable = async (): Promise<bigint | null> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return null;
  try {
    const v = toBig(await readContract(SR_CONTRACTS.sr, 'max_redeemable', []));
    // The contract returns i128::MAX to mean "no constraint at all". Normalise that to null so
    // callers do not have to know the sentinel.
    return v >= (2n ** 127n - 1n) ? null : v;
  } catch {
    // An older deployment predates the view. Unknown, not zero — reporting zero would tell the user
    // they cannot withdraw at all, which is a far worse error than saying nothing.
    return null;
  }
};

/**
 * Redeem up to `srShares`, taking whatever the venue can actually pay.
 *
 * Use this in preference to {@link unwrapSr} whenever {@link getMaxRedeemable} reports a constraint:
 * the plain redeem is all-or-nothing, so during a crunch it returns the user nothing at all.
 * `srShares` is a ceiling — burning fewer than authorized can only leave the user better off.
 */
export const unwrapSrPartial = (wallet: string, srShares: bigint): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return notDeployed();
  return writeContract(wallet, SR_CONTRACTS.sr, 'redeem_partial', [
    addr(wallet),
    addr(wallet),
    i128(srShares),
    i128(0n),
  ]);
};

/** SR shares held by `owner`. Exposed for callers that need to size a wrap before a trade. */
export const getSrBalance = (owner: string): Promise<bigint> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return Promise.resolve(0n);
  return safeBalance(SR_CONTRACTS.sr, owner);
};

/**
 * Buy exactly `ytOut` of YT face, paying at most `maxSrIn` SR.
 *
 * The raw market call, for callers that have already wrapped. Prefer {@link buyYtFromUsdc} when
 * starting from USDC — it handles the wrap leg and reports progress across both prompts.
 */
export const buyYtExactOut = (
  wallet: string,
  ytOut: bigint,
  maxSrIn: bigint,
): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return notDeployed();
  return writeContract(wallet, SR_CONTRACTS.market, 'buy_yt_exact_out', [
    addr(wallet),
    i128(ytOut),
    i128(maxSrIn),
    u32(0),
  ]);
};
