//! Fixed-point transcendental math for the Yield AMM (Phase 3, Stage B).
//!
//! The time-decay curve (`PHASE3_AMM_DESIGN.md` §2) needs `ln` and `exp` at `SCALAR_12`:
//! ```text
//! exchangeRate = (1 / rateScalar) * ln( proportion / (1 - proportion) ) + rateAnchor
//! impliedApy   = exp( ln(exchangeRate) / yearsToMaturity ) - 1
//! ```
//! Soroban runs `no_std` on `wasm32v1-none` with **no floating point**, so these are implemented in
//! pure integer arithmetic at `SCALAR_12` (12-decimal fixed point), routing every multiply through
//! the i256-widened [`crate::math::mul_div_floor`] so intermediates can never overflow `i128`.
//!
//! ## Algorithms (both range-reduce then sum a fast series)
//!
//! **`ln_fixed(x)`**, `x = m · 2^k` with `m ∈ [1, 2)`:  `ln(x) = k·ln2 + ln(m)`.
//! For `ln(m)` we use the **area-hyperbolic-tangent** series, which converges far faster than the
//! naive `ln(1+u)` series on this range: with `t = (m-1)/(m+1)` (so `t ∈ [0, 1/3)`),
//! `ln(m) = 2·(t + t³/3 + t⁵/5 + t⁷/7 + …)`. Because `t < 1/3`, `t⁹/9 < 6e-6`, so ~7 odd terms
//! already give ≳12 correct digits.
//!
//! **`exp_fixed(x)`**, signed `x`:  write `x = k·ln2 + r` with `r ∈ [-ln2/2, ln2/2]`, then
//! `exp(x) = 2^k · exp(r)`. `exp(r)` is the Taylor series `Σ rⁿ/n!`; since `|r| ≤ 0.3466`,
//! `|r|¹²/12! ≈ 8e-15`, so ~12 terms saturate `SCALAR_12` precision.
//!
//! ## Error bound (asserted in tests against an `f64` reference)
//! `ln`: worst-case **absolute** error ≤ ~1e-9 real units across `(0, 50]`. `exp`: worst-case
//! **relative** error ≤ ~5e-9 *where the result is resolvable*. Note the honest fixed-point floor:
//! `exp` of a large negative number (e.g. `exp(-20) ≈ 2e-9`) cannot be represented to 9 relative
//! digits in 12-decimal fixed point — only ~3 (the value is a handful of ULP). That tail is never
//! exercised by the AMM (implied-APY inputs are small → results near 1.0), but is documented rather
//! than hidden. Both functions are monotonic, which is what the curve actually relies on.

use soroban_sdk::Env;

use crate::{errors::Error, math::mul_div_floor, SCALAR_12};

/// `ln(2)` at SCALAR_12: 0.693147180559945… (12 digits). Used for range reduction in both `ln`/`exp`.
pub const LN2: i128 = 693_147_180_560;

/// The largest SCALAR_12 input `exp` accepts. The *result* must fit i128 at SCALAR_12: the max
/// representable real value is `i128::MAX / SCALAR_12 ≈ 1.7e26`, i.e. `exp(x) ≤ 1.7e26 ⟹ x ≲ 60.4`.
/// We cap at 44.0 (`exp(44) ≈ 1.3e19` → SCALAR_12 result `≈ 1.3e31`, safely inside i128) — far above
/// anything the AMM needs (implied APYs are single/low-double digit), with generous headroom.
pub const EXP_MAX_INPUT: i128 = 44 * SCALAR_12;

/// Fixed-point multiply at SCALAR_12: `floor(a * b / SCALAR_12)`. Overflow-proof (i256 intermediate).
#[inline]
pub fn fmul(env: &Env, a: i128, b: i128) -> Result<i128, Error> {
    // mul_div_floor requires non-negative inputs; handle a single negative operand by sign-splitting
    // (both ln's series term `t` and exp's `r` can be negative).
    let neg = (a < 0) ^ (b < 0);
    let res = mul_div_floor(env, a.abs(), b.abs(), SCALAR_12)?;
    Ok(if neg { -res } else { res })
}

/// Fixed-point divide at SCALAR_12: `floor(a * SCALAR_12 / b)`, `b != 0`. Sign-aware.
#[inline]
pub fn fdiv(env: &Env, a: i128, b: i128) -> Result<i128, Error> {
    if b == 0 {
        return Err(Error::InvalidAmount);
    }
    let neg = (a < 0) ^ (b < 0);
    let res = mul_div_floor(env, a.abs(), SCALAR_12, b.abs())?;
    Ok(if neg { -res } else { res })
}

/// Natural log of a SCALAR_12 fixed-point number. `x` must be `> 0`.
///
/// Returns `ln(x)` at SCALAR_12 (signed: negative for `x < 1.0`, zero at `x == 1.0`). Monotonically
/// increasing in `x`. Errors on `x <= 0`.
pub fn ln_fixed(env: &Env, x: i128) -> Result<i128, Error> {
    if x <= 0 {
        return Err(Error::InvalidAmount);
    }
    if x == SCALAR_12 {
        return Ok(0);
    }

    // --- range reduction: bring the mantissa into [1, 2) by powers of two ---
    // We track k such that  x = m * 2^k,  m ∈ [1, 2).  Done with shifts on the fixed-point value
    // (multiplying/dividing the *real* value by 2 == shifting the SCALAR_12 integer by 2).
    let mut m = x;
    let mut k: i32 = 0;
    let two = 2 * SCALAR_12;
    while m >= two {
        m /= 2;
        k += 1;
    }
    while m < SCALAR_12 {
        m *= 2;
        k -= 1;
    }
    // now m ∈ [1, 2)

    // --- ln(m) via atanh series: t = (m-1)/(m+1), ln(m) = 2 (t + t^3/3 + t^5/5 + …) ---
    let num = m - SCALAR_12; // m - 1   (≥ 0, < 1)
    let den = m + SCALAR_12; // m + 1
    let t = fdiv(env, num, den)?; // t ∈ [0, 1/3)
    let t2 = fmul(env, t, t)?; // t^2

    let mut term = t; // t^1
    let mut sum = t; // running Σ t^(2i+1)/(2i+1)
    // 8 odd terms (through t^17) is comfortably below 1 ULP for t < 1/3.
    let mut denom: i128 = 3;
    for _ in 0..8 {
        term = fmul(env, term, t2)?; // t^(odd+2)
        let contrib = term / denom; // /(2i+1) — plain int div is exact enough at this scale
        if contrib == 0 {
            break; // converged within fixed-point resolution
        }
        sum += contrib;
        denom += 2;
    }
    let ln_m = 2 * sum;

    // --- recombine: ln(x) = k*ln2 + ln(m) ---
    let k_ln2 = (k as i128)
        .checked_mul(LN2)
        .ok_or(Error::MathOverflow)?;
    k_ln2.checked_add(ln_m).ok_or(Error::MathOverflow)
}

/// `e^x` for a signed SCALAR_12 fixed-point exponent. Returns the result at SCALAR_12.
///
/// Monotonically increasing. `exp(0) == 1.0`. Capped at [`EXP_MAX_INPUT`]; very negative inputs
/// floor to 0. Errors only on input above the cap (would overflow i128).
pub fn exp_fixed(env: &Env, x: i128) -> Result<i128, Error> {
    if x > EXP_MAX_INPUT {
        return Err(Error::MathOverflow);
    }
    if x == 0 {
        return Ok(SCALAR_12);
    }
    // exp(-80) ≈ 1.8e-35 → 0 at SCALAR_12; short-circuit deep negatives.
    if x < -EXP_MAX_INPUT {
        return Ok(0);
    }

    // --- range reduction: x = k*ln2 + r,  r ∈ [-ln2/2, ln2/2] ---
    // k = round(x / ln2). Use floored division then nudge so the remainder lands in the symmetric
    // band (smaller |r| ⇒ faster, more accurate Taylor series).
    let mut k = x / LN2; // truncates toward zero
    let mut r = x - k * LN2;
    if r > LN2 / 2 {
        k += 1;
        r -= LN2;
    } else if r < -LN2 / 2 {
        k -= 1;
        r += LN2;
    }

    // --- exp(r) via Taylor: Σ r^n / n!  (|r| ≤ ln2/2 ≈ 0.3466) ---
    let mut term = SCALAR_12; // r^0 / 0! = 1
    let mut sum = SCALAR_12;
    // 13 terms ⇒ last term |r|^13/13! ≈ 6e-17, far under 1 ULP.
    for n in 1..=13i128 {
        term = fmul(env, term, r)?; // *= r
        term /= n; // /= n  (builds r^n/n!)
        if term == 0 {
            break;
        }
        sum += term;
    }

    // --- recompose: exp(x) = 2^k * exp(r) ---
    if k >= 0 {
        let factor = 1i128.checked_shl(k as u32).ok_or(Error::MathOverflow)?;
        sum.checked_mul(factor).ok_or(Error::MathOverflow)
    } else {
        let shift = (-k) as u32;
        if shift >= 127 {
            return Ok(0);
        }
        Ok(sum >> shift)
    }
}

/// Convenience: `exp(p * ln(base))` == `base^p` for a SCALAR_12 `base > 0` and signed SCALAR_12
/// exponent `p`. Used by `implied_apy` (`exchangeRate^(1/yearsToMaturity)`). Returns SCALAR_12.
pub fn pow_fixed(env: &Env, base: i128, p: i128) -> Result<i128, Error> {
    if base <= 0 {
        return Err(Error::InvalidAmount);
    }
    if p == 0 {
        return Ok(SCALAR_12);
    }
    let lnb = ln_fixed(env, base)?;
    let exponent = fmul(env, p, lnb)?;
    exp_fixed(env, exponent)
}
