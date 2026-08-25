/**
 * **v1-shaped reads, sourced from the v2 (SR) contracts.**
 *
 * The dashboard was built against v1: twenty-odd components — every chart, stat tile, panel and
 * feed — read from `ProtocolContext`, which read from `lib/{spield,vault,market}.ts`. Pointing all
 * of that at the SR stack could have meant editing twenty components. It does not need to, because
 * they never talk to a contract directly; they consume a *shape*.
 *
 * So this module keeps the shape and swaps what fills it. Every export here has the same signature
 * and return type as its v1 counterpart, and reads the SR stack instead. `ProtocolContext` imports
 * from here rather than from `lib/spield`, and nothing downstream changes.
 *
 * ## The four places the two models genuinely differ
 *
 * The mapping is not cosmetic everywhere. Where v2 has no equivalent of a v1 concept, the choice is
 * documented at the function rather than papered over:
 *
 * 1. **Positions.** v1 issued a numbered position per deposit and tracked principal on each. v2's PT
 *    and YT are fungible bearer tokens — there is no position, by design, and that is what makes
 *    `tofix.md` #18 inexpressible. {@link getOwnerPositions} therefore returns at most **one
 *    synthetic position** describing the wallet's whole holding.
 * 2. **SR is a share, not a dollar.** Every SR figure is converted to USDC at the live rate before
 *    it reaches a component, because every component's label says USDC.
 * 3. **YT needs no trustline.** v1 required both; v2's YT is a contract, not a classic asset. The
 *    `yt` flag is reported as satisfied so `ready` means what it always meant: "can receive".
 * 4. **Solvency is denominated differently.** v1 compared a Blend position value against principal.
 *    v2's engine compares SR held against SR owed. Both are "backing vs obligations"; the units and
 *    the contract differ, so the conversion is explicit below.
 */

import { SR_CONTRACTS, SR_DEPLOYED } from './config';
import { addr, i128, readContract, u64, writeContract } from './soroban';
import type { PositionValue, Solvency } from './spield';
import type { Receipt, VaultStats } from './vault';
import type { LpPosition, MarketStats } from './market';
import type { TrustlineStatus } from './horizon';
import {
  getExchangeRate,
  getMarketStats as getSrMarketStats,
  getPortfolio,
  getSolvency as getSrSolvency,
  getLpPosition as getSrLpPosition,
  needsPtTrustline,
  srToUsdc,
} from './srstack';

const toBig = (v: unknown): bigint => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string' && v.length > 0) return BigInt(v);
  return 0n;
};

const toNum = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v.length > 0) return Number(v);
  return 0;
};

/**
 * Protocol-wide solvency, mapped from the engine's own view.
 *
 * v1's tuple is `(backing, principal, unclaimed)` in USDC. The engine reports SR held against SR
 * owed, so `held` converts to USDC at the live rate. `principal` uses **`totalPy`** rather than the
 * engine's `needed`: `needed` folds in credited-but-unwithdrawn yield, and reporting that as
 * principal would overstate what the protocol owes on the principal leg — which is precisely the
 * number the solvency card leads with.
 */
export const getSolvency = async (): Promise<Solvency> => {
  const [sol, rate] = await Promise.all([getSrSolvency(), getExchangeRate()]);
  if (!sol) return { backing: 0n, principal: 0n, unclaimed: 0n };
  return {
    backing: srToUsdc(sol.held, rate),
    // PT face is already denominated in the underlying, so it needs no conversion.
    principal: sol.totalPy,
    unclaimed: srToUsdc(sol.totalAccrued, rate),
  };
};

/** Series maturity, unix seconds. */
export const getMaturity = async (): Promise<number | null> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return null;
  try {
    return toNum(await readContract(SR_CONTRACTS.yieldEngine, 'expiry', []));
  } catch {
    return null;
  }
};

/**
 * Whether inflows are paused.
 *
 * Reads the **wrapper**, not the engine: SR is the front door, so a paused SR is what a user
 * actually runs into. Exits stay open in either case.
 */
export const getPaused = async (): Promise<boolean> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return false;
  try {
    return Boolean(await readContract(SR_CONTRACTS.sr, 'is_paused', []));
  } catch {
    return false;
  }
};

/** USDC / PT / YT balances for a wallet. */
export const getWalletBalances = async (
  owner: string,
): Promise<{ usdc: bigint; pt: bigint; yt: bigint }> => {
  const p = await getPortfolio(owner);
  return p ? { usdc: p.usdc, pt: p.pt, yt: p.yt } : { usdc: 0n, pt: 0n, yt: 0n };
};

/**
 * The wallet's holding, expressed as v1's position list.
 *
 * **v2 has no positions.** PT and YT are fungible bearer balances, which is exactly why v1's
 * unpaginated position walk (`tofix.md` #18, a P0) cannot be written here. Rather than invent an
 * id-keyed structure that does not exist on chain, this returns a single synthetic entry
 * summarising the whole holding — and an empty list when there is nothing to show, so the
 * "No open positions" empty state still works.
 *
 * `positionId: 0` is a display placeholder. Nothing may use it to address anything on chain.
 */
export const getOwnerPositions = async (owner: string): Promise<PositionValue[]> => {
  const [p, rate] = await Promise.all([getPortfolio(owner), getExchangeRate()]);
  if (!p || (p.pt === 0n && p.yt === 0n)) return [];
  return [
    {
      positionId: 0,
      // PT face IS the principal claim: one unit redeems for one underlying at maturity.
      principal: p.pt,
      claimableYield: srToUsdc(p.claimableYield, rate),
      ptAmount: p.pt,
      ytAmount: p.yt,
      open: true,
    },
  ];
};

/**
 * Trustline readiness.
 *
 * Only PT is a classic asset here. YT is a contract — it needs a transfer hook to settle interest,
 * and a SAC has none — so there is no YT trustline to hold. Reporting `yt: true` keeps `ready`
 * meaning "this wallet can receive what it is about to be sent", which is what every caller checks.
 */
export const getTrustlines = async (owner: string): Promise<TrustlineStatus> => {
  const missing = await needsPtTrustline(owner);
  return { pt: !missing, yt: true, ready: !missing };
};

/** The Fixed-Rate Vault's health snapshot. */
export const getVaultStats = async (): Promise<VaultStats | null> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS?.vault) return null;
  try {
    const s = (await readContract(SR_CONTRACTS.vault, 'stats', [])) as Record<string, unknown>;
    return {
      ptInventory: toBig(s.pt_inventory),
      ytInventory: toBig(s.yt_inventory),
      totalLiability: toBig(s.total_liability),
      couponCapacity: toBig(s.coupon_capacity),
      rateBps: toNum(s.rate_bps),
      maturity: toNum(s.maturity),
    };
  } catch {
    return null;
  }
};

/**
 * The wallet's open fixed-rate receipts.
 *
 * Scans ids with a miss counter, mirroring v1 — the vault stores receipts by id and exposes no
 * owner index. Bounded at `maxScan`, and five consecutive misses end the scan, so an empty vault
 * costs a handful of reads rather than the full range.
 */
export const getOwnerReceipts = async (owner: string, maxScan = 64): Promise<Receipt[]> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS?.vault) return [];
  const vault = SR_CONTRACTS.vault;
  const out: Receipt[] = [];
  let misses = 0;
  const CONCURRENCY = 6;
  for (let start = 0; start < maxScan && misses < 5; start += CONCURRENCY) {
    const ids = Array.from({ length: Math.min(CONCURRENCY, maxScan - start) }, (_, o) => start + o);
    const results = await Promise.allSettled(
      ids.map((id) =>
        readContract<Record<string, unknown>>(vault, 'get_receipt', [u64(id)]),
      ),
    );
    for (let i = 0; i < ids.length && misses < 5; i += 1) {
      const r = results[i];
      // A missing receipt is an end-of-list signal, not an error.
      if (r.status === 'rejected' || !r.value) {
        misses += 1;
        continue;
      }
      misses = 0;
      const v = r.value;
      if (String(v.owner ?? '') !== owner) continue;
      if (!v.open) continue;
      out.push({
        receiptId: ids[i],
        principal: toBig(v.principal),
        payout: toBig(v.payout),
        rateBps: toNum(v.rate_bps),
        maturity: toNum(v.maturity),
        open: Boolean(v.open),
      });
    }
  }
  return out;
};

/**
 * The PT/SR pool, expressed as v1's PT/USDC shape.
 *
 * `usdcReserve` uses the market's own **`assetReserve`** — the SR reserve already converted to asset
 * units — rather than converting `srReserve` here. That is deliberate: `assetReserve` is the figure
 * the curve itself prices against, so the dashboard and the AMM agree by construction instead of by
 * two independent conversions that can drift apart.
 *
 * `feeBps` is **measured**, not configured. v1's fee was a flat constant; v2's is time-scaled
 * (`exp(lnFeeRoot × yearsToExpiry)`), so there is no stored number to read — it shrinks every day
 * toward zero at expiry. We price a small notional through `fee_preview` and derive the effective
 * rate from what the curve actually charges.
 *
 * Reporting the *configured* treasury share here instead — as this did until 2026-08-26 — put
 * "20.00%" on a tile labelled "Swap Fee, earned by LPs". The real figure was 6.03 bps, LPs keep 80%
 * of it rather than all, and the number was wrong by a factor of ~330.
 */
export const getMarketStats = async (): Promise<MarketStats | null> => {
  const s = await getSrMarketStats();
  if (!s) return null;
  return {
    ptReserve: s.ptReserve,
    usdcReserve: s.assetReserve,
    totalShares: s.totalShares,
    ptPrice: s.ptPrice,
    impliedApy: s.impliedApy,
    feeBps: await effectiveFeeBps(),
    maturity: s.expiry,
  };
};

/**
 * The swap fee the curve is charging right now, in bps.
 *
 * Priced on a deliberately small notional (0.1 USDC) so the answer is the *rate* rather than the
 * rate plus price impact, and so it still quotes when the pool is thin. Returns 0 when the pool
 * cannot quote at all, which the tile renders as "—" rather than as a free market.
 */
const effectiveFeeBps = async (): Promise<number> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS) return 0;
  const NOTIONAL = 1_000_000n;
  try {
    const fee = toBig(
      await readContract(SR_CONTRACTS.market, 'fee_preview', [i128(NOTIONAL)]),
    );
    if (fee <= 0n) return 0;
    return Number((fee * 10_000n * 100n) / NOTIONAL) / 100;
  } catch {
    return 0;
  }
};

/** The wallet's LP position, with the SR leg valued in USDC. */
export const getLpPosition = async (owner: string): Promise<LpPosition | null> => {
  const [p, rate] = await Promise.all([getSrLpPosition(owner), getExchangeRate()]);
  if (!p) return null;
  return { shares: p.shares, ptClaim: p.ptClaim, usdcClaim: srToUsdc(p.srClaim, rate) };
};

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// WRITES
// ═════════════════════════════════════════════════════════════════════════════════════════════════
//
// Same idea as the reads: identical signatures to their v1 counterparts, v2 contracts underneath,
// so the panels that call them need an import swap and nothing else.
//
// One difference is worth stating plainly rather than hiding, because it changes what a user signs:
// **the SR hop is real.** v1's contracts took USDC directly; v2's take SR. Where the router can do
// the wrap inside one transaction it does (`buyPt`, `sellPt`), and the user still signs once. Where
// it cannot — minting PY, adding liquidity, funding a YT purchase — the wrap is a separate
// transaction, and the functions below return a **step list** so the UI can say "1 of 2" instead of
// going quiet between two wallet prompts.

import { fromBaseUnits, toBaseUnits, type WriteResult } from './soroban';
import type { Quote } from './vault';
import {
  addLiquidity as srAddLiquidity,
  buyPtWithUsdc,
  buyYtExactOut,
  claimYieldToUsdc,
  mintPy,
  quoteBuyPtWithUsdc,
  quoteSellPtForUsdc,
  redeemPyForUsdc,
  removeLiquidity as srRemoveLiquidity,
  sellPtForUsdc,
  usdcToSr,
  wrapUsdc,
} from './srstack';
import type { TradeSide } from './market';

/**
 * **Mint PT + YT from USDC.** Two transactions: wrap, then split.
 *
 * `mint_py` takes SR, and wrapping plus splitting exceeds one Soroban transaction against Blend's
 * pool — the same cumulative-memory ceiling documented on `srrouter::buy_yt_with_usdc`. So this is
 * honest about being two steps rather than failing at the second one.
 */
export const mint = async (wallet: string, amount: string): Promise<WriteResult> => {
  const rate = await getExchangeRate();
  await wrapUsdc(wallet, amount);
  // Convert at the rate we just read. A stroop of drift only means a stroop less PY minted, and
  // the SR remainder stays in the user's wallet where they can see it.
  return mintPy(wallet, usdcToSr(toBaseUnits(amount), rate));
};

/**
 * `mint` as a step list, so the UI can show "1 of 2" across the two wallet prompts.
 *
 * Prefer this over {@link mint} in a panel. Two prompts behind a single spinner looks like the app
 * asked twice by mistake, and that is the moment people cancel.
 *
 * When the wallet already holds enough SR, the wrap step is dropped and this is a single step.
 */
export const buildMintSteps = async (
  wallet: string,
  amount: string,
): Promise<Array<{ label: string; fn: () => Promise<WriteResult> }> | null> => {
  const units = toBaseUnits(amount);
  if (units <= 0n) return null;
  const rate = await getExchangeRate();
  const srNeeded = usdcToSr(units, rate);
  if (srNeeded <= 0n) return null;

  const { getSrBalance } = await import('./srstack');
  const held = await getSrBalance(wallet);

  const steps: Array<{ label: string; fn: () => Promise<WriteResult> }> = [];
  if (held < srNeeded) {
    const shortfall = srToUsdc(srNeeded - held, rate) + 1n;
    steps.push({
      label: 'Wrap USDC into SR',
      fn: () => wrapUsdc(wallet, fromBaseUnits(shortfall).toString()),
    });
  }
  steps.push({ label: 'Split into PT + YT', fn: () => mintPy(wallet, srNeeded) });
  return steps;
};

/** `addLiquidity` as a step list, for the same reason as {@link buildMintSteps}. */
export const buildAddLiquiditySteps = async (
  wallet: string,
  ptIn: string,
  usdcIn: string,
): Promise<Array<{ label: string; fn: () => Promise<WriteResult> }> | null> => {
  const usdcUnits = toBaseUnits(usdcIn);
  if (usdcUnits <= 0n) return null;
  const rate = await getExchangeRate();
  const srNeeded = usdcToSr(usdcUnits, rate);

  const { getSrBalance } = await import('./srstack');
  const held = await getSrBalance(wallet);

  const steps: Array<{ label: string; fn: () => Promise<WriteResult> }> = [];
  if (held < srNeeded) {
    const shortfall = srToUsdc(srNeeded - held, rate) + 1n;
    steps.push({
      label: 'Wrap USDC into SR',
      fn: () => wrapUsdc(wallet, fromBaseUnits(shortfall).toString()),
    });
  }
  steps.push({
    label: 'Add liquidity',
    fn: () => srAddLiquidity(wallet, toBaseUnits(ptIn), srNeeded),
  });
  return steps;
};

/** Claim accrued yield, paid in USDC. `positionId` is ignored — v2 has no positions. */
export const claimYield = (wallet: string, _positionId: number): Promise<WriteResult> =>
  claimYieldToUsdc(wallet);

/**
 * Redeem principal to USDC at face.
 *
 * After maturity this burns PT alone; before it, it burns PT **and** YT (a recombine). Same call
 * either way — the engine decides based on expiry — which is why v1's separate `redeemPt` and
 * `combineAndRedeem` both land here.
 */
export const redeemPt = (wallet: string, _positionId: number, amount: string): Promise<WriteResult> =>
  redeemPyForUsdc(wallet, toBaseUnits(amount));

export const combineAndRedeem = redeemPt;

/** PT out for USDC in, or USDC out for PT in. Returns null when the pool cannot fill it. */
export const quoteSwap = async (side: TradeSide, amount: string): Promise<bigint | null> => {
  const units = toBaseUnits(amount);
  if (units <= 0n) return null;
  const q = side === 'buyPt' ? await quoteBuyPtWithUsdc(units) : await quoteSellPtForUsdc(units);
  return q > 0n ? q : null;
};

/** Buy PT with USDC — one signature, wrap included. */
export const buyPt = (wallet: string, usdcIn: string, _minPtOut: string): Promise<WriteResult> =>
  buyPtWithUsdc(wallet, usdcIn);

/** Sell PT for USDC — one signature, unwrap included. */
export const sellPt = (wallet: string, ptIn: string, _minUsdcOut: string): Promise<WriteResult> =>
  sellPtForUsdc(wallet, toBaseUnits(ptIn));

/**
 * Add liquidity. Two transactions: the pool's quote leg is SR, so the USDC side is wrapped first.
 *
 * `ptIn` is spent as-is — the wallet must already hold the PT.
 */
export const addLiquidity = async (
  wallet: string,
  ptIn: string,
  usdcIn: string,
): Promise<WriteResult> => {
  const rate = await getExchangeRate();
  await wrapUsdc(wallet, usdcIn);
  return srAddLiquidity(wallet, toBaseUnits(ptIn), usdcToSr(toBaseUnits(usdcIn), rate));
};

/** Remove liquidity. Returns PT and SR; the SR is the user's to unwrap in the wrapper section. */
export const removeLiquidity = (wallet: string, shares: string): Promise<WriteResult> =>
  srRemoveLiquidity(wallet, toBaseUnits(shares));

/**
 * The steps a YT purchase takes, as a labelled list the caller can show progress against.
 *
 * v1 routed this as "mint PT+YT, then sell the PT". v2 buys YT directly from the pool — the pool
 * funds the rest of the notional and keeps the PT — which is both cheaper and the reason a YT buy
 * needs no PT trustline.
 *
 * It is still **two** steps, for the reason documented at `srstack.buyYtFromUsdc`: a Blend supply
 * plus a `mint_py`-bearing curve trade exceeds one Soroban transaction against the real pool. The
 * steps are returned explicitly rather than hidden inside one function so the UI's "1 of 2"
 * indicator tells the truth — a silent second wallet prompt reads as a bug.
 *
 * When the wallet already holds enough SR the wrap step is dropped and this returns a single step.
 *
 * `slippage` and `mintFn` are accepted and unused: they were v1's routing parameters, and keeping
 * the signature identical is what lets `TradePanel` swap one import and stop.
 */
export const buildBuyYtSteps = async (
  wallet: string,
  usdcIn: string,
  _slippage?: number,
  _mintFn?: unknown,
): Promise<Array<{ label: string; fn: () => Promise<WriteResult> }> | null> => {
  const units = toBaseUnits(usdcIn);
  if (units <= 0n) return null;

  const { solveYtFaceForUsdc, quoteBuyYt, getSrBalance } = await import('./srstack');
  const face = await solveYtFaceForUsdc(units);
  if (face <= 0n) return null;

  const srNeeded = await quoteBuyYt(face);
  if (srNeeded <= 0n) return null;
  const srBudget = srNeeded + srNeeded / 33n + 1n; // ~3% pad; the market refunds the remainder
  const held = await getSrBalance(wallet);

  const steps: Array<{ label: string; fn: () => Promise<WriteResult> }> = [];
  if (held < srBudget) {
    const rate = await getExchangeRate();
    const shortfall = srToUsdc(srBudget - held, rate) + 1n;
    steps.push({
      label: 'Wrap USDC into SR',
      fn: () => wrapUsdc(wallet, fromBaseUnits(shortfall).toString()),
    });
  }
  steps.push({ label: 'Buy YT', fn: () => buyYtExactOut(wallet, face, srBudget) });
  return steps;
};

// ── Fixed-Rate Vault ─────────────────────────────────────────────────────────────────────────────
//
// The one place v2 is *simpler* than v1 rather than merely different. v1's vault tracked a list of
// wrapper positions and walked it on every redemption — an unbounded walk a stranger could inflate,
// which is what made `tofix.md` #18 a P0. v2's vault holds PT as a fungible bearer balance, so
// redemption touches one entry regardless of history, and `seed` is admin-gated besides. Same
// surface, none of the same failure modes.

/** Quote a fixed-rate deposit: `(payout, coupon, rateBps)`. Same tuple shape as v1. */
export const quote = async (amount: string): Promise<Quote | null> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS?.vault) return null;
  try {
    const tuple = (await readContract<unknown[]>(SR_CONTRACTS.vault, 'quote', [
      i128(toBaseUnits(amount)),
    ])) as unknown[];
    if (!tuple) return null;
    const [payout, coupon, rateBps] = tuple;
    return { payout: toBig(payout), coupon: toBig(coupon), rateBps: toNum(rateBps) };
  } catch {
    return null;
  }
};

/** Deposit USDC for a fixed-rate receipt. Takes USDC directly — no wrap step for the user. */
export const deposit = (wallet: string, amount: string): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS?.vault) return vaultNotDeployed();
  return writeContract(wallet, SR_CONTRACTS.vault, 'deposit', [
    addr(wallet),
    i128(toBaseUnits(amount)),
  ]);
};

/** Redeem a matured receipt for its guaranteed payout. */
export const redeem = (wallet: string, receiptId: number): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS?.vault) return vaultNotDeployed();
  return writeContract(wallet, SR_CONTRACTS.vault, 'redeem', [u64(receiptId)]);
};

/**
 * Sweep the vault's accrued YT yield into inventory.
 *
 * v1's took a batch size because it walked positions and could run out of budget. v2's walks
 * nothing, so the parameter is accepted and ignored rather than removed — keeping the signature
 * identical is what lets `ReceiptsPanel` swap one import and stop.
 */
export const harvest = (wallet: string, _maxPositions?: number): Promise<WriteResult> => {
  if (!SR_DEPLOYED || !SR_CONTRACTS?.vault) return vaultNotDeployed();
  return writeContract(wallet, SR_CONTRACTS.vault, 'harvest', []);
};

const vaultNotDeployed = (): never => {
  throw new Error('The Spield v2 Fixed-Rate Vault is not deployed on this network.');
};

// ── Presentation helpers ─────────────────────────────────────────────────────────────────────────
//
// Pure functions over the shapes above — no contract access. They live here rather than in
// `lib/market` so that **no component imports runtime code from a v1 contract module**. That was
// already true by accident (the three helpers there happen to be pure); moving them makes it true
// by construction, and the lint rule in `eslint.config.js` keeps it that way.

/** Convert a SCALAR_12 fixed-point value to a JS number. */
export const fromScalar12 = (v: bigint): number => Number(v) / 1e12;

/** Implied APY as a percentage, e.g. 5.00. */
export const impliedApyPct = (stats: MarketStats | null): number =>
  stats ? fromScalar12(stats.impliedApy) * 100 : 0;

/** Total pool value in USDC terms: the asset side plus PT marked at its curve price. */
export const poolValueUsd = (stats: MarketStats | null): number => {
  if (!stats) return 0;
  const usdc = fromBaseUnits(stats.usdcReserve);
  const pt = fromBaseUnits(stats.ptReserve) * fromScalar12(stats.ptPrice || 10n ** 12n);
  return usdc + pt;
};
