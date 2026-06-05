//! Fixed-point math for Spield, all at `SCALAR_12` (Blend's rate scale).
//!
//! Rates (`b_rate`) are 12-decimal fixed point: a rate of `1.05` is stored as
//! `1_050_000_000_000`. Token amounts are in the underlying's own decimals (USDC = 7 on the
//! Blend testnet token). The conversion between bToken *shares* and underlying *amount* is
//! `amount = shares * b_rate / SCALAR_12`, matching Blend's `to_asset_from_b_token`.
//!
//! We deliberately use 256-bit intermediates (`i128::checked_mul` would overflow for
//! `shares * b_rate` at realistic magnitudes — e.g. 1e12 shares × 1e12 rate = 1e24 > i128::MAX
//! is false, but 1e15 × 1e12 = 1e27 < 1.7e38 is fine; still, we route through `mul_div_floor`
//! which widens to i256 so the product never overflows regardless of magnitude).

use soroban_sdk::Env;

use crate::{errors::Error, SCALAR_12};

/// `floor(a * b / denom)` computed with a widened (i256) intermediate so `a * b` cannot
/// overflow i128. `denom` must be > 0. Inputs are assumed non-negative (rates and amounts
/// in Spield are always ≥ 0); a negative result would be a logic bug and is rejected.
pub fn mul_div_floor(env: &Env, a: i128, b: i128, denom: i128) -> Result<i128, Error> {
    if denom <= 0 || a < 0 || b < 0 {
        return Err(Error::InvalidAmount);
    }
    // Widen to i256 (host-native big int) to make the multiply overflow-proof, then divide.
    let prod = soroban_sdk::I256::from_i128(env, a).mul(&soroban_sdk::I256::from_i128(env, b));
    let quot = prod.div(&soroban_sdk::I256::from_i128(env, denom));
    quot.to_i128().ok_or(Error::MathOverflow)
}

/// Convert bToken *shares* to *underlying* using a 12-decimal `b_rate`:
/// `underlying = shares * b_rate / SCALAR_12` (floored, like Blend).
pub fn shares_to_underlying(env: &Env, shares: i128, b_rate: i128) -> Result<i128, Error> {
    mul_div_floor(env, shares, b_rate, SCALAR_12)
}

/// Convert *underlying* to bToken *shares* using a 12-decimal `b_rate`:
/// `shares = underlying * SCALAR_12 / b_rate` (floored).
pub fn underlying_to_shares(env: &Env, underlying: i128, b_rate: i128) -> Result<i128, Error> {
    if b_rate <= 0 {
        return Err(Error::RateOutOfBounds);
    }
    mul_div_floor(env, underlying, SCALAR_12, b_rate)
}

/// The yield earned by a position between its `settled` rate and the `current` rate, measured
/// on the position's **bToken shares**: `yield = shares * (current - settled) / SCALAR_12`.
///
/// This is the economically exact ERC-4626 / Blend bToken model: a position's underlying value
/// is `shares * rate`, so the growth since last settle is `shares * Δrate`. Measuring on shares
/// (not on the YT face amount) is what keeps the vault solvent when a position was minted at an
/// `entry_rate > 1.0` — using the YT face amount would over-state the yield (1 YT only maps to 1
/// share when `entry_rate == 1.0`) and silently drain principal backing.
///
/// Clamped at 0 (defence-in-depth — Blend's `b_rate` is monotonic, but a lower read pays 0
/// rather than underflow). Every claim is measured from the position's *own* `settled` rate, so
/// no tranche is over-/under-counted (SCF #4) and a fresh owner whose `settled` starts at the
/// transfer rate can never claim pre-ownership yield (SCF #5).
pub fn yield_amount(
    env: &Env,
    shares: i128,
    settled_rate: i128,
    current_rate: i128,
) -> Result<i128, Error> {
    if current_rate <= settled_rate {
        return Ok(0);
    }
    let delta = current_rate - settled_rate;
    mul_div_floor(env, shares, delta, SCALAR_12)
}

/// Defence-in-depth sanity bound on a freshly-read `b_rate`. Blend's state is trusted, but a
/// catastrophically wrong read (oracle/host bug, or a malicious strategy address) should not
/// be allowed to mint phantom value. We require:
///   * `current >= last` (rates are monotonic non-decreasing), and
///   * the increase is at most `max_jump_bps` basis points of `last` (a per-update ceiling).
///
/// `last == 0` (first observation) bypasses the upper bound (nothing to compare against) but
/// still requires `current > 0`.
pub fn check_rate_bound(
    env: &Env,
    last: i128,
    current: i128,
    max_jump_bps: u32,
) -> Result<(), Error> {
    if current <= 0 {
        return Err(Error::RateOutOfBounds);
    }
    if last == 0 {
        return Ok(());
    }
    if current < last {
        return Err(Error::RateOutOfBounds);
    }
    // max allowed = last * (1 + max_jump_bps/10_000)
    let max_increase = mul_div_floor(env, last, max_jump_bps as i128, 10_000)?;
    let ceiling = last.checked_add(max_increase).ok_or(Error::MathOverflow)?;
    if current > ceiling {
        return Err(Error::RateOutOfBounds);
    }
    Ok(())
}
