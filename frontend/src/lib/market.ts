import { CONTRACTS, MARKET_DEPLOYED, DECIMALS } from './config';
import {
  addr,
  i128,
  readContract,
  toBaseUnits,
  fromBaseUnits,
  writeContract,
  type WriteResult,
} from './soroban';

/**
 * Typed client for the Market — the PT/USDC time-decay AMM (Phase 3 trading venue).
 *
 * The market prices PT against USDC on the Pendle-style log curve: PT drifts to par
 * (1.0) as maturity nears, and an implied APY falls out of the price + time. Reads
 * (`quote_*`, `pt_price`, `implied_apy`, `reserves`, `lp_position`) are free
 * simulations; writes (`swap_*`, `add/remove_liquidity`) need the connected wallet.
 *
 * YT never trades in its own pool — it's *routed* through the wrapper (`PT + YT =
 * underlying`): buying YT = mint then sell the PT; selling YT = buy PT then combine.
 * See {@link routeBuyYt} / {@link routeSellYt}.
 *
 * Every entry point is a no-op when the market isn't deployed (`MARKET_DEPLOYED`
 * false), so the UI renders a "coming soon" state without throwing.
 */

const SCALE_12 = 10n ** 12n;

const toBig = (v: unknown): bigint => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string') return BigInt(v);
  return 0n;
};

const toNum = (v: unknown): number => Number(toBig(v));

/** Convert a SCALAR_12 fixed-point bigint (e.g. a price or APY fraction) to a JS number. */
export const fromScalar12 = (v: bigint): number => Number(v) / Number(SCALE_12);

/** Pool + curve snapshot for the Markets page header. */
export type MarketStats = {
  /** PT in the pool, base units. */
  ptReserve: bigint;
  /** USDC in the pool, base units. */
  usdcReserve: bigint;
  /** Total LP shares outstanding, base units. */
  totalShares: bigint;
  /** PT price in USDC (SCALAR_12 fixed point — 1.0 = par). */
  ptPrice: bigint;
  /** Implied APY (SCALAR_12 fraction — 0.08 = 8%). */
  impliedApy: bigint;
  /** Swap fee, basis points. */
  feeBps: number;
  /** Maturity, unix seconds. */
  maturity: number;
};

/** A connected wallet's LP position in the pool. */
export type LpPosition = {
  /** LP shares held, base units. */
  shares: bigint;
  /** PT those shares currently redeem for, base units. */
  ptClaim: bigint;
  /** USDC those shares currently redeem for, base units. */
  usdcClaim: bigint;
};

/** Which leg a trade targets. */
export type TradeSide = 'buyPt' | 'sellPt';

// ---------------------------------------------------------------- reads

/** Read the full market snapshot in parallel. Returns `null` if not deployed / on read failure. */
export const getMarketStats = async (): Promise<MarketStats | null> => {
  if (!MARKET_DEPLOYED) return null;
  try {
    const [reserves, ptPrice, impliedApy, feeBps, maturity, totalShares] = await Promise.all([
      readContract<unknown[]>(CONTRACTS.market, 'reserves'),
      readContract<unknown>(CONTRACTS.market, 'pt_price').catch(() => 0n),
      readContract<unknown>(CONTRACTS.market, 'implied_apy').catch(() => 0n),
      readContract<unknown>(CONTRACTS.market, 'fee_bps'),
      readContract<unknown>(CONTRACTS.market, 'maturity'),
      readContract<unknown>(CONTRACTS.market, 'total_shares'),
    ]);
    const [pt, usdc] = (reserves as unknown[]) ?? [];
    return {
      ptReserve: toBig(pt),
      usdcReserve: toBig(usdc),
      totalShares: toBig(totalShares),
      ptPrice: toBig(ptPrice),
      impliedApy: toBig(impliedApy),
      feeBps: toNum(feeBps),
      maturity: toNum(maturity),
    };
  } catch {
    return null;
  }
};

/** A connected wallet's LP position. */
export const getLpPosition = async (owner: string): Promise<LpPosition | null> => {
  if (!MARKET_DEPLOYED) return null;
  try {
    const tuple = await readContract<unknown[]>(CONTRACTS.market, 'lp_position', [addr(owner)]);
    const [shares, ptClaim, usdcClaim] = tuple ?? [];
    return {
      shares: toBig(shares),
      ptClaim: toBig(ptClaim),
      usdcClaim: toBig(usdcClaim),
    };
  } catch {
    return null;
  }
};

/**
 * Quote a swap. `usdcIn` (human string) for `buyPt`, `ptIn` for `sellPt`. Returns the output in
 * base units, or `null` if the quote can't be computed (e.g. empty pool, past maturity).
 */
export const quoteSwap = async (side: TradeSide, amount: string): Promise<bigint | null> => {
  if (!MARKET_DEPLOYED || !amount || Number(amount) <= 0) return null;
  const method = side === 'buyPt' ? 'quote_usdc_for_pt' : 'quote_pt_for_usdc';
  try {
    const out = await readContract<unknown>(CONTRACTS.market, method, [i128(toBaseUnits(amount))]);
    return toBig(out);
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- writes (direct PT/USDC)

/**
 * Buy PT with `usdcIn` USDC — the "Earn Fixed" income flow. `minPtOut` (human string) is the
 * slippage floor; pass the quote × (1 − tolerance).
 */
export const buyPt = (wallet: string, usdcIn: string, minPtOut: string): Promise<WriteResult> =>
  writeContract(wallet, CONTRACTS.market, 'swap_exact_usdc_for_pt', [
    addr(wallet),
    i128(toBaseUnits(usdcIn)),
    i128(toBaseUnits(minPtOut)),
  ]);

/** Sell `ptIn` PT for USDC. `minUsdcOut` (human string) is the slippage floor. */
export const sellPt = (wallet: string, ptIn: string, minUsdcOut: string): Promise<WriteResult> =>
  writeContract(wallet, CONTRACTS.market, 'swap_exact_pt_for_usdc', [
    addr(wallet),
    i128(toBaseUnits(ptIn)),
    i128(toBaseUnits(minUsdcOut)),
  ]);

/** Add liquidity: deposit `ptIn` PT + `usdcIn` USDC (human strings). Returns shares minted. */
export const addLiquidity = (
  wallet: string,
  ptIn: string,
  usdcIn: string,
): Promise<WriteResult> =>
  writeContract(wallet, CONTRACTS.market, 'add_liquidity', [
    addr(wallet),
    i128(toBaseUnits(ptIn)),
    i128(toBaseUnits(usdcIn)),
  ]);

/** Remove `shares` LP shares (human string in share units, 7-dec). Returns (pt_out, usdc_out). */
export const removeLiquidity = (wallet: string, shares: string): Promise<WriteResult> =>
  writeContract(wallet, CONTRACTS.market, 'remove_liquidity', [
    addr(wallet),
    i128(toBaseUnits(shares)),
  ]);

// ---------------------------------------------------------------- YT routing

/**
 * "Long Yield": buy YT exposure cheaply. There is no YT pool — we mint `usdcIn` PT+YT via the
 * wrapper (1 USDC → 1 PT + 1 YT), then sell the PT back into the market for USDC. Net: the user
 * keeps `usdcIn` YT, having recovered most of their USDC (the PT sale proceeds). The effective YT
 * cost is `usdcIn − ptSaleProceeds`.
 *
 * This is two transactions (mint, then swap) because the wrapper `mint` returns a fresh position
 * the user must hold before selling its PT. Each leg flows through the standard tx lifecycle.
 */
export type YtRoutePreview = {
  /** YT the user ends up holding, base units (== minted PT+YT == usdcIn). */
  ytAmount: bigint;
  /** USDC recovered by selling the minted PT, base units (quote). */
  usdcRecovered: bigint;
  /** Net USDC cost of the YT exposure, base units (`usdcIn − usdcRecovered`). */
  netCost: bigint;
};

/** Preview a "buy YT" route: how much YT, how much USDC comes back, the net cost. */
export const previewBuyYt = async (usdcIn: string): Promise<YtRoutePreview | null> => {
  if (!MARKET_DEPLOYED || !usdcIn || Number(usdcIn) <= 0) return null;
  // Minting 1:1 gives `usdcIn` PT+YT; selling that PT yields this much USDC back.
  const usdcRecovered = await quoteSwap('sellPt', usdcIn);
  if (usdcRecovered == null) return null;
  const ytAmount = toBaseUnits(usdcIn);
  return {
    ytAmount,
    usdcRecovered,
    netCost: ytAmount - usdcRecovered,
  };
};

/**
 * Build the two-step "buy YT" route as ordered tx steps for `useTxAction.runSteps`:
 *   1. `wrapper.mint(usdcIn)` → user gets `usdcIn` PT + `usdcIn` YT.
 *   2. `market.sell_pt(usdcIn)` → sell exactly the minted PT back for USDC.
 * The user keeps the YT; their net cost is `usdcIn − (PT sale proceeds)`. `slippage` (fraction,
 * e.g. 0.01) bounds the min USDC out on the sell leg, derived from the live quote.
 *
 * Returns `null` if the route can't be priced (e.g. insufficient pool liquidity for the PT sale).
 * Imported lazily-typed via the wrapper's `mint` to avoid a hard dep cycle (callers pass it in).
 */
export const buildBuyYtSteps = async (
  wallet: string,
  usdcIn: string,
  slippage: number,
  mintFn: (wallet: string, amount: string) => Promise<WriteResult>,
): Promise<Array<{ label: string; fn: () => Promise<WriteResult> }> | null> => {
  const recovered = await quoteSwap('sellPt', usdcIn);
  if (recovered == null || recovered === 0n) return null;
  const keep = BigInt(Math.round((1 - slippage) * 10_000));
  const minUsdcOut = String(fromBaseUnits((recovered * keep) / 10_000n));
  return [
    { label: 'Mint PT + YT', fn: () => mintFn(wallet, usdcIn) },
    { label: 'Sell PT for USDC', fn: () => sellPt(wallet, usdcIn, minUsdcOut) },
  ];
};

/**
 * The number of decimals the underlying / PT / YT use, surfaced for the router's display math
 * (kept in sync with the contract's `DECIMALS`).
 */
export const MARKET_DECIMALS = DECIMALS;

/** Convenience: human-readable PT price (e.g. 0.9821) from the SCALAR_12 stat. */
export const ptPriceHuman = (stats: MarketStats | null): number =>
  stats ? fromScalar12(stats.ptPrice) : 0;

/** Convenience: implied APY as a percentage number (e.g. 8.4) from the SCALAR_12 stat. */
export const impliedApyPct = (stats: MarketStats | null): number =>
  stats ? fromScalar12(stats.impliedApy) * 100 : 0;

/** Convenience: a pool's total value in USDC terms (usdc reserve + pt reserve × price). */
export const poolValueUsd = (stats: MarketStats | null): number => {
  if (!stats) return 0;
  const usdc = fromBaseUnits(stats.usdcReserve);
  const pt = fromBaseUnits(stats.ptReserve) * fromScalar12(stats.ptPrice || SCALE_12);
  return usdc + pt;
};
