//! The time-decay yield curve (Phase 3, Stage C) — the differentiating math (`PHASE3_AMM_DESIGN.md`
//! §2). Replaces Stage A's constant-product core with the Pendle V2 / Notional log curve, so PT
//! price drifts to par (1.0) and YT to 0 as `t → maturity`, automatically, from the curve — which
//! is what spares LPs the impermanent loss of PT's predictable march to par.
//!
//! ## Definitions (all SCALAR_12 fixed point; reserves in 7-dec underlying units)
//! ```text
//! proportion   = pt_reserve / (pt_reserve + usdc_reserve)            ∈ (0,1)
//! yearsToMat   = (maturity - now) / SECONDS_PER_YEAR                 > 0 before maturity
//! rateScalar   = scalarRoot / yearsToMat                             steepens as t → 0
//! exchangeRate = rateAnchor − ln( proportion / (1 - proportion) ) / rateScalar
//! ```
//! `exchangeRate` is **USDC paid per 1 PT** at the current pool point. The `−` makes it monotonic
//! the economically correct way: as the pool fills with PT (proportion ↑ ⇒ logit ↑), PT gets
//! **cheaper** (rate ↓) — supply/demand. At `proportion = 0.5` the `ln` term is 0 so
//! `exchangeRate = rateAnchor`.
//!
//! ## Par convergence (the IL-minimizing property)
//! `rateAnchor` is set to **par (1.0)** at init. As `t → maturity`, `yearsToMat → 0`, so
//! `rateScalar → ∞` and the `ln/rateScalar` term → 0 for any fixed proportion. The curve flattens
//! onto `exchangeRate = rateAnchor = 1.0` — so **PT price → par at maturity**, automatically, which
//! is the IL-minimizing property: an LP who holds to maturity sees PT march to par along the curve,
//! not against it. (Dynamic re-anchoring on liquidity events — Pendle's `_updateMarketState` — is a
//! Stage C.1 refinement, `PHASE3_AMM_DESIGN.md` §3.4; the fixed par anchor already gives the core
//! convergence.) Before maturity, a PT-heavy pool prices PT below par ⇒ a positive implied yield.
//!
//! ## Swap mechanics
//! A swap is priced at the `exchangeRate` evaluated at the **post-trade proportion** (Pendle's
//! convention: the marginal price reflects where the pool ends up). For an exact PT input we
//! Newton-solve the USDC out that makes `usdc_out = pt_in * rate(proportion_after)` self-consistent;
//! in practice one fixed-point pass on the proportion converges to <1 ULP because `rate` moves
//! slowly in `usdc_out`. The fee is taken on the input.

use soroban_sdk::{panic_with_error, Env};
use spield_shared::{
    amm_math::{exp_fixed, fdiv, fmul, ln_fixed},
    math::mul_div_floor,
    Error, SCALAR_12,
};

const SECONDS_PER_YEAR: i128 = 365 * 24 * 60 * 60;

/// A proportion this close to 0 or 1 is refused — the `ln(p/(1-p))` logit blows up at the
/// boundaries, and a pool that lopsided has no useful liquidity anyway. 0.5% … 99.5%.
const MIN_PROPORTION: i128 = SCALAR_12 / 200; // 0.005
const MAX_PROPORTION: i128 = SCALAR_12 - SCALAR_12 / 200; // 0.995

/// Curve parameters resolved for the current ledger time.
pub struct CurveParams {
    /// `scalarRoot / yearsToMaturity`, SCALAR_12. Larger ⇒ steeper ⇒ flatter price impact near par.
    pub rate_scalar: i128,
    /// The curve's anchor exchange rate (USDC per PT at proportion 0.5), SCALAR_12.
    pub rate_anchor: i128,
}

/// **Non-panicking** resolve of `rate_scalar` from `scalar_root` and the time left. Returns
/// `Err(MarketExpired)` at/after maturity (the math is undefined past it) so views can fall back.
pub fn try_params(
    env: &Env,
    scalar_root: i128,
    rate_anchor: i128,
    maturity: u64,
    now: u64,
) -> Result<CurveParams, Error> {
    if now >= maturity {
        return Err(Error::MarketExpired);
    }
    let time_to_mat = (maturity - now) as i128;
    // yearsToMat = time_to_mat / SECONDS_PER_YEAR (SCALAR_12).
    let years_to_mat = mul_div_floor(env, time_to_mat, SCALAR_12, SECONDS_PER_YEAR)?;
    if years_to_mat <= 0 {
        // < ~1 SECONDS_PER_YEAR/1e12 of a year left: treat as effectively matured.
        return Err(Error::MarketExpired);
    }
    // rate_scalar = scalar_root / years_to_mat  (SCALAR_12 division).
    let rate_scalar = fdiv(env, scalar_root, years_to_mat)?;
    Ok(CurveParams { rate_scalar, rate_anchor })
}

/// Resolve `rate_scalar` from `scalar_root` and the time left. Panics `MarketExpired` at/after
/// maturity (callers gate trading on this too, but the math is undefined past maturity). Panicking
/// wrapper for the swap/quote path.
pub fn params(env: &Env, scalar_root: i128, rate_anchor: i128, maturity: u64, now: u64) -> CurveParams {
    try_params(env, scalar_root, rate_anchor, maturity, now)
        .unwrap_or_else(|e| panic_with_error!(env, e))
}

/// `proportion = pt / (pt + usdc)` at SCALAR_12, bounds-checked to stay strictly inside the usable
/// band (0.5% … 99.5%). **Non-panicking core**: returns `Err(InsufficientLiquidity)` for an empty,
/// negative, or too-imbalanced pool, and `Err(MathOverflow)` on overflow — so read-only views can
/// degrade gracefully instead of reverting. The swap path uses the panicking [`proportion`] wrapper.
pub fn try_proportion(env: &Env, pt_reserve: i128, usdc_reserve: i128) -> Result<i128, Error> {
    if pt_reserve < 0 || usdc_reserve < 0 {
        return Err(Error::InsufficientLiquidity);
    }
    let total = pt_reserve
        .checked_add(usdc_reserve)
        .ok_or(Error::MathOverflow)?;
    if total <= 0 {
        return Err(Error::InsufficientLiquidity);
    }
    let p = mul_div_floor(env, pt_reserve, SCALAR_12, total)?;
    if p < MIN_PROPORTION || p > MAX_PROPORTION {
        return Err(Error::InsufficientLiquidity);
    }
    Ok(p)
}

/// Panicking wrapper around [`try_proportion`] (the coherent panicking API used by tests; the
/// production swap/quote paths now go through the `try_*` variants directly).
#[allow(dead_code)]
pub fn proportion(env: &Env, pt_reserve: i128, usdc_reserve: i128) -> i128 {
    try_proportion(env, pt_reserve, usdc_reserve)
        .unwrap_or_else(|e| panic_with_error!(env, e))
}

/// **Non-panicking** `exchangeRate(proportion)` = rateAnchor − ln(p/(1-p)) / rateScalar, SCALAR_12
/// (USDC per PT). Returns `Err` instead of reverting so views can fall back. `prop` is assumed to be
/// already inside the usable band (the callers pass the output of `try_proportion`).
pub fn try_exchange_rate(env: &Env, prop: i128, p: &CurveParams) -> Result<i128, Error> {
    if p.rate_scalar <= 0 {
        return Err(Error::InsufficientLiquidity);
    }
    // logit = ln( prop / (1 - prop) ) — signed; 0 at prop = 0.5, > 0 for PT-heavy pools.
    let one_minus = SCALAR_12 - prop;
    if one_minus <= 0 || prop <= 0 {
        return Err(Error::InsufficientLiquidity);
    }
    let ratio = fdiv(env, prop, one_minus)?;
    let logit = ln_fixed(env, ratio)?;
    let term = fdiv(env, logit, p.rate_scalar)?;
    let rate = p.rate_anchor.checked_sub(term).ok_or(Error::MathOverflow)?;
    // A PT price must stay positive.
    if rate <= 0 {
        return Err(Error::InsufficientLiquidity);
    }
    Ok(rate)
}

/// `exchangeRate(proportion)` = rateAnchor − ln(p/(1-p)) / rateScalar, SCALAR_12. USDC per PT.
/// The minus sign encodes supply/demand: more PT in the pool (higher proportion ⇒ higher logit)
/// ⇒ a *lower* PT price. Panicking wrapper (coherent API; used by tests).
#[allow(dead_code)]
pub fn exchange_rate(env: &Env, prop: i128, p: &CurveParams) -> i128 {
    try_exchange_rate(env, prop, p).unwrap_or_else(|e| panic_with_error!(env, e))
}

/// PT price in USDC at the current pool point (= exchangeRate). SCALAR_12. Panicking wrapper
/// (coherent API; used by tests — production reads go through `try_pt_price`).
#[allow(dead_code)]
pub fn pt_price(env: &Env, pt_reserve: i128, usdc_reserve: i128, p: &CurveParams) -> i128 {
    let prop = proportion(env, pt_reserve, usdc_reserve);
    exchange_rate(env, prop, p)
}

/// **Non-panicking** PT price for read-only views: `Ok(price)` for a healthy pool, `Err` for an
/// empty / thin / too-imbalanced pool (the caller maps that to a safe fallback like 0).
pub fn try_pt_price(
    env: &Env,
    pt_reserve: i128,
    usdc_reserve: i128,
    p: &CurveParams,
) -> Result<i128, Error> {
    let prop = try_proportion(env, pt_reserve, usdc_reserve)?;
    try_exchange_rate(env, prop, p)
}

/// **Seed calibration** — the PT reserve to pair with `usdc_in` so the pool *opens* at
/// `target_apy` (SCALAR_12 fraction, e.g. `0.05e12` = 5%). The exact inverse of [`implied_apy`].
///
/// ## Why this exists
/// The curve prices PT at `rateAnchor − ln(p/(1−p)) / rateScalar`, and `rateAnchor` is pinned at
/// **par** so PT converges to 1.0 at maturity (the IL-minimizing property — see the module docs).
/// At `proportion = 0.5` the `ln` term is zero, so **a balanced pool prices PT at exactly par and
/// implies 0% APY**. A 1:1 seed therefore ships a venue where buying PT and holding to maturity
/// *loses* the swap fee — the flagship "Earn Fixed" trade is negative by construction.
///
/// Positive yield comes only from imbalance: the pool must open **PT-heavy**. This derives how
/// heavy, from the target rate rather than from a guess:
///
/// ```text
/// targetPrice = 1 / (1 + apy)^yearsToMat          (invert the APY definition)
/// logit       = (rateAnchor − targetPrice) · rateScalar
/// ptReserve   = usdcReserve · exp(logit)          (since logit = ln(p/(1−p)) = ln(pt/usdc))
/// ```
///
/// The last step uses `p/(1−p) == ptReserve/usdcReserve`, which falls straight out of
/// `p = pt/(pt+usdc)`.
///
/// Deriving this on-chain — rather than in the deploy script — means the seed ratio is computed by
/// the *same* `ln`/`exp` and the same `rateScalar` the pricing uses, so the opening quote cannot
/// drift from the target through a rounding or formula mismatch elsewhere.
///
/// Returns `Err` at/after maturity, for a non-positive `usdc_in`, or if the target is so extreme
/// that the implied proportion leaves the tradeable band — callers should treat that as
/// "uncalibratable, do not seed".
pub fn try_seed_pt_for_apy(
    env: &Env,
    usdc_in: i128,
    target_apy: i128,
    scalar_root: i128,
    rate_anchor: i128,
    maturity: u64,
    now: u64,
) -> Result<i128, Error> {
    if usdc_in <= 0 || target_apy < 0 {
        return Err(Error::InvalidAmount);
    }
    let p = try_params(env, scalar_root, rate_anchor, maturity, now)?;
    let time_to_mat = (maturity - now) as i128;
    let years_to_mat = mul_div_floor(env, time_to_mat, SCALAR_12, SECONDS_PER_YEAR)?;
    if years_to_mat <= 0 {
        return Err(Error::MarketExpired);
    }

    // targetPrice = (1 + apy)^(-yearsToMat) = exp(-yearsToMat · ln(1 + apy))
    let one_plus = SCALAR_12.checked_add(target_apy).ok_or(Error::MathOverflow)?;
    let ln_one_plus = ln_fixed(env, one_plus)?;
    let growth = exp_fixed(env, fmul(env, years_to_mat, ln_one_plus)?)?; // (1+apy)^T > 1
    let target_price = fdiv(env, SCALAR_12, growth)?;

    // A target at/above the anchor needs no imbalance (and any excess is unreachable with a par
    // anchor), so pair 1:1 — the pool opens exactly at the anchor.
    if target_price >= rate_anchor {
        return Ok(usdc_in);
    }

    // logit = (anchor − targetPrice) · rateScalar, then ptReserve = usdcReserve · exp(logit).
    let logit = fmul(env, rate_anchor - target_price, p.rate_scalar)?;
    let ratio = exp_fixed(env, logit)?;
    let pt = fmul(env, usdc_in, ratio)?;
    if pt <= 0 {
        return Err(Error::InvalidAmount);
    }
    // Refuse a target that would open the pool outside the tradeable proportion band — such a pool
    // could not be swapped against at all, so seeding it would strand the liquidity.
    let prop = try_proportion(env, pt, usdc_in)?;
    if !(MIN_PROPORTION..=MAX_PROPORTION).contains(&prop) {
        return Err(Error::InsufficientLiquidity);
    }
    Ok(pt)
}

/// Implied APY (SCALAR_12 fraction) from the current PT price and the time to maturity:
/// `impliedApy = (1 / ptPrice)^(1 / yearsToMat) - 1` (continuous-style, via pow). PT trades below
/// par, so `1/ptPrice > 1` and the APY is positive. Returns 0 if PT is already at/above par.
pub fn implied_apy(
    env: &Env,
    pt_reserve: i128,
    usdc_reserve: i128,
    scalar_root: i128,
    rate_anchor: i128,
    maturity: u64,
    now: u64,
) -> i128 {
    // The view layer never wants this to revert: any unusable/expired/thin state ⇒ 0 (no implied
    // yield to show). `try_implied_apy` carries the real fallible math.
    try_implied_apy(env, pt_reserve, usdc_reserve, scalar_root, rate_anchor, maturity, now)
        .unwrap_or(0)
}

/// **Non-panicking** implied APY. Returns `Ok(apy)` for a healthy below-par pool, `Ok(0)` for an
/// at/above-par pool or one effectively at maturity, and `Err` for an empty / thin / expired /
/// overflowing state (the caller maps `Err` → 0). This is the fallible core behind the [`implied_apy`]
/// view; isolating it lets tests assert the *graceful-degradation* contract directly.
pub fn try_implied_apy(
    env: &Env,
    pt_reserve: i128,
    usdc_reserve: i128,
    scalar_root: i128,
    rate_anchor: i128,
    maturity: u64,
    now: u64,
) -> Result<i128, Error> {
    let p = try_params(env, scalar_root, rate_anchor, maturity, now)?;
    let price = try_pt_price(env, pt_reserve, usdc_reserve, &p)?;
    if price >= SCALAR_12 {
        return Ok(0); // PT at/above par ⇒ no positive yield to imply
    }
    // discount = par / price = 1 / price  (> 1)
    let discount = fdiv(env, SCALAR_12, price)?;
    // exponent = 1 / yearsToMat
    let time_to_mat = (maturity - now) as i128;
    let years_to_mat = mul_div_floor(env, time_to_mat, SCALAR_12, SECONDS_PER_YEAR)?;
    if years_to_mat <= 0 {
        return Ok(0);
    }
    let inv_years = fdiv(env, SCALAR_12, years_to_mat)?;
    // discount^(1/yearsToMat) = exp( (1/yearsToMat) * ln(discount) )
    let ln_disc = ln_fixed(env, discount)?;
    let pow_arg = fmul(env, inv_years, ln_disc)?;
    let grown = exp_fixed(env, pow_arg)?;
    Ok(grown - SCALAR_12)
}

/// Result of pricing a swap: the gross output (before the caller's slippage check). The post-trade
/// proportion is already bounds-checked inside the solve (via `proportion`), so callers only need
/// the output amount.
pub struct SwapResult {
    pub amount_out: i128,
}

/// Price `pt_in` PT → USDC out along the curve. The fee is taken on the PT input. The output is
/// `pt_after_fee * exchangeRate(proportion_after)`, found by a short fixed-point iteration on the
/// post-trade proportion (it converges immediately because the USDC leg barely moves the
/// proportion relative to the PT leg). Reverts if the pool can't cover the output.
pub fn swap_pt_for_usdc(
    env: &Env,
    pt_in: i128,
    pt_reserve: i128,
    usdc_reserve: i128,
    fee_bps: u32,
    p: &CurveParams,
) -> SwapResult {
    try_swap_pt_for_usdc(env, pt_in, pt_reserve, usdc_reserve, fee_bps, p)
        .unwrap_or_else(|e| panic_with_error!(env, e))
}

/// **Non-panicking** core of [`swap_pt_for_usdc`]. Returns `Err` (instead of reverting) for a bad
/// amount, an unusable/too-imbalanced post-trade proportion, or a pool that can't cover the output —
/// so the quote view can return a safe `0` ("no quote") and the swap path maps `Err` → revert.
pub fn try_swap_pt_for_usdc(
    env: &Env,
    pt_in: i128,
    pt_reserve: i128,
    usdc_reserve: i128,
    fee_bps: u32,
    p: &CurveParams,
) -> Result<SwapResult, Error> {
    if pt_in <= 0 {
        return Err(Error::InvalidAmount);
    }
    let pt_after_fee = try_apply_fee(env, pt_in, fee_bps)?;
    let new_pt = pt_reserve.checked_add(pt_after_fee).ok_or(Error::MathOverflow)?;

    // Iterate: start with the spot rate, compute USDC out, recompute proportion with that USDC
    // removed, re-price. A few passes converge (rate is near-constant in usdc_out here).
    let mut usdc_out = 0i128;
    let mut prop_after = try_proportion(env, new_pt, usdc_reserve)?;
    for _ in 0..3 {
        let rate = try_exchange_rate(env, prop_after, p)?;
        usdc_out = fmul(env, pt_after_fee, rate)?;
        if usdc_out >= usdc_reserve {
            return Err(Error::InsufficientLiquidity);
        }
        prop_after = try_proportion(env, new_pt, usdc_reserve - usdc_out)?;
    }
    let _ = prop_after; // bounds-checked inside `try_proportion`; not surfaced to the caller
    Ok(SwapResult { amount_out: usdc_out })
}

/// Price `usdc_in` USDC → PT out along the curve. The fee is taken on the USDC input. The output is
/// `usdc_after_fee / exchangeRate(proportion_after)` (PT bought = USDC paid ÷ price-per-PT), found
/// by the same short fixed-point pass. Reverts if the pool can't cover the PT output.
pub fn swap_usdc_for_pt(
    env: &Env,
    usdc_in: i128,
    pt_reserve: i128,
    usdc_reserve: i128,
    fee_bps: u32,
    p: &CurveParams,
) -> SwapResult {
    try_swap_usdc_for_pt(env, usdc_in, pt_reserve, usdc_reserve, fee_bps, p)
        .unwrap_or_else(|e| panic_with_error!(env, e))
}

/// **Non-panicking** core of [`swap_usdc_for_pt`]. Returns `Err` for a bad amount, an unusable
/// post-trade proportion, or a pool that can't cover the PT output; the quote view maps `Err` → 0.
pub fn try_swap_usdc_for_pt(
    env: &Env,
    usdc_in: i128,
    pt_reserve: i128,
    usdc_reserve: i128,
    fee_bps: u32,
    p: &CurveParams,
) -> Result<SwapResult, Error> {
    if usdc_in <= 0 {
        return Err(Error::InvalidAmount);
    }
    let usdc_after_fee = try_apply_fee(env, usdc_in, fee_bps)?;
    let new_usdc = usdc_reserve.checked_add(usdc_after_fee).ok_or(Error::MathOverflow)?;

    let mut pt_out = 0i128;
    let mut prop_after = try_proportion(env, pt_reserve, new_usdc)?;
    for _ in 0..3 {
        let rate = try_exchange_rate(env, prop_after, p)?;
        // pt_out = usdc_after_fee / rate
        pt_out = fdiv(env, usdc_after_fee, rate)?;
        if pt_out >= pt_reserve {
            return Err(Error::InsufficientLiquidity);
        }
        prop_after = try_proportion(env, pt_reserve - pt_out, new_usdc)?;
    }
    let _ = prop_after; // bounds-checked inside `try_proportion`; not surfaced to the caller
    Ok(SwapResult { amount_out: pt_out })
}

/// `amount * (10_000 - fee_bps) / 10_000`, floored. Non-panicking core.
fn try_apply_fee(env: &Env, amount: i128, fee_bps: u32) -> Result<i128, Error> {
    let keep = (10_000 - fee_bps as i128).max(0);
    let out = mul_div_floor(env, amount, keep, 10_000)?;
    if out <= 0 {
        return Err(Error::InvalidAmount);
    }
    Ok(out)
}
