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

/// Seconds in a (non-leap) year, used to pro-rate an annual fixed rate over a deposit's term.
pub const SECONDS_PER_YEAR: i128 = 365 * 24 * 60 * 60;

/// The fixed coupon the Fixed-Rate Vault owes on `principal` for a deposit held `term_secs` at a
/// fixed annual `rate_bps` (basis points), using simple (non-compounding) interest:
///
/// ```text
/// coupon = principal * rate_bps * term_secs / (10_000 * SECONDS_PER_YEAR)
/// ```
///
/// Floored, and computed via `mul_div_floor` (i256 intermediate) so the product can never
/// overflow. A zero rate or zero term yields a zero coupon (defence-in-depth — the vault rejects
/// past-maturity deposits separately).
pub fn coupon_amount(
    env: &Env,
    principal: i128,
    rate_bps: u32,
    term_secs: u64,
) -> Result<i128, Error> {
    if principal < 0 {
        return Err(Error::InvalidAmount);
    }
    if rate_bps == 0 || term_secs == 0 {
        return Ok(0);
    }
    // Two floored mul_divs: scale by the annual rate, then pro-rate by the term fraction.
    let annual = mul_div_floor(env, principal, rate_bps as i128, 10_000)?;
    mul_div_floor(env, annual, term_secs as i128, SECONDS_PER_YEAR)
}

/// Small absolute tolerance (stroops of SCALAR_12 rate) added to every rate-bound ceiling so that
/// fixed-point floor-rounding in Blend's own share math can't false-trip the check at very short
/// elapsed times (when the time-pro-rated allowance rounds down to ~0). Microscopic next to any
/// real rate, far below a meaningful jump.
pub const RATE_BOUND_DUST: i128 = 16;

/// Defence-in-depth sanity bound on a freshly-read `b_rate`, **scaled by elapsed time**.
///
/// Blend's state is trusted, but a catastrophically wrong read (host bug, or a misconfigured /
/// malicious strategy address) should not be allowed to mint phantom value. The honest physical
/// bound on `b_rate` is an **annual growth ceiling**: Blend's supply rate can never exceed its max
/// borrow APR, so over `elapsed` seconds `b_rate` can rise by at most
///
/// ```text
/// max_increase = last * (max_apr_bps / 10_000) * (elapsed / SECONDS_PER_YEAR)   (+ dust)
/// ```
///
/// This is **time-aware on purpose**: the previous per-read form falsely tripped when a position
/// sat untouched for a long time (a big-but-legitimate single-read jump), which would soft-brick the
/// whole protocol. Pro-rating by elapsed time removes the read-frequency dependency entirely — the
/// only thing to calibrate is `max_apr_bps` against Blend's real max borrow APR (a known constant),
/// not how often Spield happens to read. We require:
///   * `current > 0`,
///   * `current >= last` (Blend's `b_rate` is monotonic non-decreasing), and
///   * `current <= last + max_increase`.
///
/// `last == 0` (first observation) bypasses the upper bound (nothing to compare against) but still
/// requires `current > 0`. `elapsed == 0` (same-ledger re-read) ⇒ `max_increase == 0`, so only the
/// dust tolerance is allowed — i.e. the rate must not move within a single timestamp.
///
/// `max_apr_bps` is the **annual** ceiling in basis points (e.g. `30_000` = 300% APR), generously
/// above Blend's real max so honest reads always pass while a wild read is still caught.
pub fn check_rate_bound_timed(
    env: &Env,
    last: i128,
    current: i128,
    elapsed_secs: u64,
    max_apr_bps: u32,
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
    // max_increase = last * max_apr_bps/10_000 * elapsed/SECONDS_PER_YEAR, in two floored steps
    // (each via the i256-backed mul_div_floor so the products can't overflow).
    let annual_cap = mul_div_floor(env, last, max_apr_bps as i128, 10_000)?;
    let max_increase =
        mul_div_floor(env, annual_cap, elapsed_secs as i128, SECONDS_PER_YEAR)?;
    let ceiling = last
        .checked_add(max_increase)
        .and_then(|c| c.checked_add(RATE_BOUND_DUST))
        .ok_or(Error::MathOverflow)?;
    if current > ceiling {
        return Err(Error::RateOutOfBounds);
    }
    Ok(())
}
