// @ts-check
//
// Blend's interest-rate model, and the rule that turns it into a safe fixed rate.
//
// Pure math — no I/O, no network, no chain reads. Everything here is a function of numbers so it
// can be unit-tested (`calibrate_vault_rate.test.mjs`) without a live pool. The CLI that feeds it
// real reserve data is `calibrate_vault_rate.mjs`.
//
// ── Why this file exists ─────────────────────────────────────────────────────────────────────────
// The Fixed-Rate Vault promises a coupon it must fund from the yield its YT inventory earns in
// Blend. The promise is *solvent* however Blend behaves — `srvault::deposit` refuses any deposit
// whose coupon is not already backed by PT in inventory — but it is only *self-funding* when
//
//     blend_supply_apr x (1 - yield_fee) > vault_rate
//
// Below that line every deposit drains seed capital instead of replenishing it. Nothing in the
// protocol enforces that inequality, and nothing ever measured it: `VAULT_RATE_BPS` was a
// hardcoded 500 in all three deploy scripts, chosen before any of these numbers existed.
//
// ── The model ────────────────────────────────────────────────────────────────────────────────────
// Reconstructed from Blend's reserve config, then VALIDATED against reality rather than trusted:
// `modelledSupplyApr` is cross-checked in the CLI against the supply index's actual growth
// (`b_rate` sampled twice), and the calibration refuses to emit a verdict if the two disagree.
// Measured 2026-08-29 — mainnet FixedV2: model 7.212% vs realized 7.216%; testnet TestnetV2:
// model 0.2143% vs realized 0.214%.

/** Blend expresses utilization, rates, `ir_mod` and the backstop take in 7-decimal fixed point. */
export const UTIL_SCALAR = 1e7;
/** `b_rate` / `d_rate` are 12-decimal fixed point. */
export const RATE_SCALAR = 1e12;
/** Blend's second rate kink, above the reserve's configured utilization target. */
export const SECOND_KINK = 0.95;
/** `ir_mod`'s neutral value. Blend's floor is 0.1 and its ceiling is 100. */
export const IR_MOD_NEUTRAL = 1.0;

const SECONDS_PER_YEAR = 365 * 24 * 3600;

/**
 * Blend's piecewise-linear borrow rate, BEFORE the `ir_mod` multiplier.
 *
 * Three segments: linear to `r_one` at the utilization target, then to `r_two` at 95%, then a steep
 * `r_three` ramp meant to be punitive rather than reached.
 *
 * @param {number} util   current utilization, 0..1
 * @param {{ r_base: number, r_one: number, r_two: number, r_three: number, util: number }} cfg
 *   reserve config, raw 7-decimal fixed point as returned by `get_reserve`
 */
export const baseBorrowRate = (util, cfg) => {
  const target = cfg.util / UTIL_SCALAR;
  const rBase = cfg.r_base / UTIL_SCALAR;
  const rOne = cfg.r_one / UTIL_SCALAR;
  const rTwo = cfg.r_two / UTIL_SCALAR;
  const rThree = cfg.r_three / UTIL_SCALAR;

  if (util <= target) return (util / target) * rOne + rBase;
  if (util <= SECOND_KINK) {
    return ((util - target) / (SECOND_KINK - target)) * rTwo + rOne + rBase;
  }
  return ((util - SECOND_KINK) / (1 - SECOND_KINK)) * rThree + rTwo + rOne + rBase;
};

/**
 * What a SUPPLIER earns, as an APR fraction (0.05 = 5%).
 *
 * Borrowers pay `base x ir_mod` on the borrowed fraction only, and the backstop takes its cut off
 * the top, so suppliers receive `borrow_apr x utilization x (1 - backstop_take)`.
 *
 * @param {number} util    utilization, 0..1
 * @param {number} irMod   the rate modifier, 1.0 = neutral
 * @param {{ r_base: number, r_one: number, r_two: number, r_three: number, util: number }} cfg
 * @param {number} bstopRate  pool backstop take rate, raw 7-decimal fixed point
 */
export const modelledSupplyApr = (util, irMod, cfg, bstopRate) =>
  baseBorrowRate(util, cfg) * irMod * util * (1 - bstopRate / UTIL_SCALAR);

/**
 * Annualized supply APR realized between two `b_rate` samples.
 *
 * `b_rate` IS the supply index — the number a supplier's balance is multiplied by — so its growth
 * is the ground truth, independent of any model of how Blend sets rates.
 *
 * @param {bigint} b0  b_rate at t0
 * @param {bigint} b1  b_rate at t1
 * @param {number} dtSeconds  t1 - t0
 */
export const realizedSupplyApr = (b0, b1, dtSeconds) => {
  if (dtSeconds <= 0 || b0 <= 0n) return NaN;
  // Ratio in floating point: the values are ~1e12 so the division is exact well past the precision
  // that matters, and the delta over a short window is far too small to keep in integer math.
  return ((Number(b1) - Number(b0)) / Number(b0)) * (SECONDS_PER_YEAR / dtSeconds);
};

/** Derive utilization from a `get_reserve` payload. Both supplies are SHARE counts, not underlying. */
export const utilizationOf = (data) => {
  const supplied = (BigInt(data.b_supply) * BigInt(data.b_rate)) / BigInt(RATE_SCALAR);
  const borrowed = (BigInt(data.d_supply) * BigInt(data.d_rate)) / BigInt(RATE_SCALAR);
  return {
    supplied,
    borrowed,
    util: supplied > 0n ? Number(borrowed) / Number(supplied) : 0,
  };
};

/**
 * THE CALIBRATION RULE — the maximum fixed rate this venue can fund, and a verdict on a proposal.
 *
 * Deliberately conservative in three compounding steps, because the failure it guards against is
 * slow and invisible: a vault quoting more than its yield source pays does not revert, it just
 * bleeds seed capital until capacity runs out and deposits start failing.
 *
 *   1. STRESS — assume no input ever improves.
 *
 *        util_stress   = min(util_now, util_target)
 *        ir_mod_stress = min(ir_mod_now, 1.0)
 *
 *      Spot rates are not evidence of anything durable. On mainnet FixedV2 the entire margin over a
 *      5% promise came from `ir_mod` sitting at 1.49 — 49% above neutral — which is a transient,
 *      not a property of the pool. Taking `min` in BOTH directions is what makes the rule
 *      symmetric: it will not assume a depressed modifier recovers either, which is why testnet
 *      (ir_mod 0.107) correctly fails instead of being flattered by a reversion-to-1.0 assumption.
 *
 *      This is a MODERATE stress, not a worst case: `ir_mod`'s floor is 0.1, six times below what
 *      is assumed here. The worst case is left to the on-chain capacity check, which caps the
 *      total loss at the seed no matter how far Blend falls.
 *
 *   2. FEE — the yield engine takes `yield_fee_bps` of the YT interest before the vault sees it,
 *      so the vault never keeps the full supply rate.
 *
 *   3. MARGIN — a further haircut on what is left. The default 2500 bps is high on purpose: a
 *      fixed-rate promise runs for the whole term and cannot be repriced mid-series.
 *
 * @param {object} p
 * @param {number} p.utilNow        current utilization, 0..1
 * @param {number} p.irModNow       current ir_mod, 1.0 = neutral
 * @param {object} p.reserveConfig  raw `get_reserve().config`
 * @param {number} p.bstopRate      raw pool `bstop_rate`
 * @param {number} p.yieldFeeBps    the yield engine's protocol fee
 * @param {number} p.marginBps      safety margin
 * @param {number} p.proposedBps    the rate being validated
 */
export const calibrate = ({
  utilNow,
  irModNow,
  reserveConfig,
  bstopRate,
  yieldFeeBps,
  marginBps,
  proposedBps,
}) => {
  const utilTarget = reserveConfig.util / UTIL_SCALAR;

  // 1. Stress: never assume an input improves.
  const utilStress = Math.min(utilNow, utilTarget);
  const irModStress = Math.min(irModNow, IR_MOD_NEUTRAL);

  const spotApr = modelledSupplyApr(utilNow, irModNow, reserveConfig, bstopRate);
  const stressApr = modelledSupplyApr(utilStress, irModStress, reserveConfig, bstopRate);

  // 2. Fee, and 3. margin.
  const keep = 1 - yieldFeeBps / 10_000;
  const netSpotApr = spotApr * keep;
  const netStressApr = stressApr * keep;
  const maxSafeApr = netStressApr * (1 - marginBps / 10_000);

  // Floor to whole basis points: a rate is quoted in bps, so a max that rounds UP would licence a
  // rate the rule does not actually clear.
  const maxSafeBps = Math.floor(maxSafeApr * 10_000);
  const breakEvenBps = Math.floor(netStressApr * 10_000);

  /** @type {'PASS'|'WARN'|'FAIL'} */
  let verdict;
  if (proposedBps <= maxSafeBps) verdict = 'PASS';
  else if (proposedBps <= breakEvenBps) verdict = 'WARN';
  else verdict = 'FAIL';

  return {
    utilNow,
    utilTarget,
    utilStress,
    irModNow,
    irModStress,
    spotApr,
    stressApr,
    netSpotApr,
    netStressApr,
    maxSafeApr,
    maxSafeBps,
    breakEvenBps,
    proposedBps,
    verdict,
    /** How many times over TODAY's net yield covers the promise. Headline, not a safety criterion. */
    spotCoverage: proposedBps > 0 ? (netSpotApr * 10_000) / proposedBps : Infinity,
    /** Same, under the stress assumption. Below 1.0 the promise is not funded. */
    stressCoverage: proposedBps > 0 ? (netStressApr * 10_000) / proposedBps : Infinity,
  };
};
