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

/// Resolve `rate_scalar` from `scalar_root` and the time left. Panics `MarketExpired` at/after
/// maturity (callers gate trading on this too, but the math is undefined past maturity).
pub fn params(env: &Env, scalar_root: i128, rate_anchor: i128, maturity: u64, now: u64) -> CurveParams {
    if now >= maturity {
        panic_with_error!(env, Error::MarketExpired);
    }
    let time_to_mat = (maturity - now) as i128;
    // yearsToMat = time_to_mat / SECONDS_PER_YEAR (SCALAR_12).
    let years_to_mat = mul_div_floor(env, time_to_mat, SCALAR_12, SECONDS_PER_YEAR)
        .unwrap_or_else(|e| panic_with_error!(env, e));
    if years_to_mat <= 0 {
        // < ~1 SECONDS_PER_YEAR/1e12 of a year left: treat as effectively matured.
        panic_with_error!(env, Error::MarketExpired);
    }
    // rate_scalar = scalar_root / years_to_mat  (SCALAR_12 division).
    let rate_scalar = fdiv(env, scalar_root, years_to_mat)
        .unwrap_or_else(|e| panic_with_error!(env, e));
    CurveParams { rate_scalar, rate_anchor }
}

/// `proportion = pt / (pt + usdc)` at SCALAR_12, bounds-checked to stay strictly inside (0,1).
pub fn proportion(env: &Env, pt_reserve: i128, usdc_reserve: i128) -> i128 {
    let total = pt_reserve
        .checked_add(usdc_reserve)
        .unwrap_or_else(|| panic_with_error!(env, Error::MathOverflow));
    if total <= 0 || pt_reserve < 0 || usdc_reserve < 0 {
        panic_with_error!(env, Error::InsufficientLiquidity);
    }
    let p = mul_div_floor(env, pt_reserve, SCALAR_12, total)
        .unwrap_or_else(|e| panic_with_error!(env, e));
    if p < MIN_PROPORTION || p > MAX_PROPORTION {
        panic_with_error!(env, Error::InsufficientLiquidity);
    }
    p
}

/// `exchangeRate(proportion)` = rateAnchor − ln(p/(1-p)) / rateScalar, SCALAR_12. USDC per PT.
/// The minus sign encodes supply/demand: more PT in the pool (higher proportion ⇒ higher logit)
/// ⇒ a *lower* PT price.
pub fn exchange_rate(env: &Env, prop: i128, p: &CurveParams) -> i128 {
    // logit = ln( prop / (1 - prop) )  — signed; 0 at prop = 0.5, > 0 for PT-heavy pools.
    let one_minus = SCALAR_12 - prop;
    if one_minus <= 0 {
        panic_with_error!(env, Error::InsufficientLiquidity);
    }
    let ratio = fdiv(env, prop, one_minus).unwrap_or_else(|e| panic_with_error!(env, e));
    let logit = ln_fixed(env, ratio).unwrap_or_else(|e| panic_with_error!(env, e));
    // term = logit / rateScalar
    let term = fdiv(env, logit, p.rate_scalar).unwrap_or_else(|e| panic_with_error!(env, e));
    // rate = anchor − term  (PT-heavy ⇒ term > 0 ⇒ cheaper PT).
    let rate = p.rate_anchor
        .checked_sub(term)
        .unwrap_or_else(|| panic_with_error!(env, Error::MathOverflow));
    // A PT price must stay positive. The anchor (par) + bounded logit/rateScalar keep it so for sane
    // scalar_root; this is defence-in-depth against an extreme mis-set at init.
    if rate <= 0 {
        panic_with_error!(env, Error::InsufficientLiquidity);
    }
    rate
}

/// PT price in USDC at the current pool point (= exchangeRate). SCALAR_12.
pub fn pt_price(env: &Env, pt_reserve: i128, usdc_reserve: i128, p: &CurveParams) -> i128 {
    let prop = proportion(env, pt_reserve, usdc_reserve);
    exchange_rate(env, prop, p)
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
    let p = params(env, scalar_root, rate_anchor, maturity, now);
    let price = pt_price(env, pt_reserve, usdc_reserve, &p);
    if price >= SCALAR_12 {
        return 0; // PT at/above par ⇒ no positive yield to imply
    }
    // discount = par / price = 1 / price  (> 1)
    let discount = fdiv(env, SCALAR_12, price).unwrap_or_else(|e| panic_with_error!(env, e));
    // exponent = 1 / yearsToMat
    let time_to_mat = (maturity - now) as i128;
    let years_to_mat = mul_div_floor(env, time_to_mat, SCALAR_12, SECONDS_PER_YEAR)
        .unwrap_or_else(|e| panic_with_error!(env, e));
    if years_to_mat <= 0 {
        return 0;
    }
    let inv_years = fdiv(env, SCALAR_12, years_to_mat).unwrap_or_else(|e| panic_with_error!(env, e));
    // discount^(1/yearsToMat) = exp( (1/yearsToMat) * ln(discount) )
    let ln_disc = ln_fixed(env, discount).unwrap_or_else(|e| panic_with_error!(env, e));
    let pow_arg = fmul(env, inv_years, ln_disc).unwrap_or_else(|e| panic_with_error!(env, e));
    let grown = exp_fixed(env, pow_arg).unwrap_or_else(|e| panic_with_error!(env, e));
    grown - SCALAR_12
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
    if pt_in <= 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }
    let pt_after_fee = apply_fee(env, pt_in, fee_bps);
    let new_pt = pt_reserve + pt_after_fee;

    // Iterate: start with the spot rate, compute USDC out, recompute proportion with that USDC
    // removed, re-price. Two passes are plenty (rate is near-constant in usdc_out here).
    let mut usdc_out = 0i128;
    let mut prop_after = proportion(env, new_pt, usdc_reserve);
    for _ in 0..3 {
        let rate = exchange_rate(env, prop_after, p);
        usdc_out = fmul(env, pt_after_fee, rate).unwrap_or_else(|e| panic_with_error!(env, e));
        if usdc_out >= usdc_reserve {
            panic_with_error!(env, Error::InsufficientLiquidity);
        }
        prop_after = proportion(env, new_pt, usdc_reserve - usdc_out);
    }
    let _ = prop_after; // bounds-checked inside `proportion`; not surfaced to the caller
    SwapResult { amount_out: usdc_out }
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
    if usdc_in <= 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }
    let usdc_after_fee = apply_fee(env, usdc_in, fee_bps);
    let new_usdc = usdc_reserve + usdc_after_fee;

    let mut pt_out = 0i128;
    let mut prop_after = proportion(env, pt_reserve, new_usdc);
    for _ in 0..3 {
        let rate = exchange_rate(env, prop_after, p);
        // pt_out = usdc_after_fee / rate
        pt_out = fdiv(env, usdc_after_fee, rate).unwrap_or_else(|e| panic_with_error!(env, e));
        if pt_out >= pt_reserve {
            panic_with_error!(env, Error::InsufficientLiquidity);
        }
        prop_after = proportion(env, pt_reserve - pt_out, new_usdc);
    }
    let _ = prop_after; // bounds-checked inside `proportion`; not surfaced to the caller
    SwapResult { amount_out: pt_out }
}

/// `amount * (10_000 - fee_bps) / 10_000`, floored.
fn apply_fee(env: &Env, amount: i128, fee_bps: u32) -> i128 {
    let keep = (10_000 - fee_bps as i128).max(0);
    let out = mul_div_floor(env, amount, keep, 10_000).unwrap_or_else(|e| panic_with_error!(env, e));
    if out <= 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }
    out
}
