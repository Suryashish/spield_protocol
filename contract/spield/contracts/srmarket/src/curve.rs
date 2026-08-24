//! The PT/SR curve — Pendle V2's `MarketMathCore`, ported to Soroban.
//!
//! Three things here that the v1 PT/USDC curve does not have, each closing a measured gap from
//! `comparependle.md`:
//!
//! ## 1. Reserves are compared in ASSET units, not raw balances
//! The pool holds **SR shares** on one side and **PT face (asset units)** on the other. Those are
//! not the same unit — 1 SR is worth `index` assets and drifts upward. Pendle converts first
//! (`index.syToAsset(totalSy)`), and so do we. Skipping this would make the proportion — and every
//! price derived from it — silently wrong by the accumulated yield.
//!
//! ## 2. The fee scales with time to expiry
//! ```text
//! fee_rate = exp(ln_fee_root * years_to_expiry)      (>= 1)
//! buying PT   -> effective price = price * fee_rate      (you pay more)
//! selling PT  -> effective price = price / fee_rate      (you receive less)
//! ```
//! `ln_fee_root` is an **annualized** rate, so the fee is a constant share of the *yield being
//! traded* at every maturity. The v1 flat-bps fee is a constant share of *notional*, which
//! measured **75% of the YT's value at 30 days** and 6.3% at 365 — one number cannot serve both.
//!
//! ## 3. The anchor is recomputed, not pinned at par
//! v1 pins `rate_anchor` at 1.0 forever, so the entire PT discount has to come from an extreme
//! PT-heavy pool — a measured **6.96:1** seed for a 90-day 5% market. Pendle re-derives the anchor
//! each time from the last implied rate:
//! ```text
//! target_price = exp(-last_ln_implied_rate * years)     // price consistent with the stored rate
//! rate_anchor  = target_price + logit(proportion) / rate_scalar
//! ```
//! Two properties fall out at once:
//! * **Cheap seeding** — any proportion works; the anchor absorbs it. A 1:1 seed is fine.
//! * **Par convergence survives.** As `t -> 0`, `rate_scalar -> inf` so the logit term vanishes and
//!   `price -> target_price = exp(0) = 1`. A *static* below-par anchor freezes PT below par while
//!   it still redeems at 1.0 — a standing risk-free draw on LPs. The dynamic anchor does not.

use soroban_sdk::{panic_with_error, Env};
use spield_shared::{
    amm_math::{exp_fixed, fdiv, fmul, ln_fixed},
    math::mul_div_floor,
    Error, SCALAR_12,
};

pub const SECONDS_PER_YEAR: i128 = 365 * 24 * 60 * 60;

/// The logit blows up at the boundaries and a pool that lopsided has no useful liquidity.
const MIN_PROPORTION: i128 = SCALAR_12 / 200; // 0.5%
const MAX_PROPORTION: i128 = SCALAR_12 - SCALAR_12 / 200; // 99.5%

/// Below this much time left, the implied-rate update is skipped: `-ln(price)/years` is numerically
/// meaningless as `years -> 0`, and the stored rate is already irrelevant (the curve has flattened
/// onto par regardless).
const MIN_YEARS_FOR_RATE_UPDATE: i128 = SCALAR_12 / 1000; // ~8.8 hours

/// Everything the pricing needs, resolved for one ledger instant.
#[derive(Clone)]
pub struct Params {
    /// `scalar_root / years_to_expiry` — steepens without bound as expiry nears.
    pub rate_scalar: i128,
    /// Re-derived every call from `last_ln_implied_rate` and the *current* proportion.
    pub rate_anchor: i128,
    /// `exp(ln_fee_root * years)`, always >= SCALAR_12 (i.e. >= 1.0).
    pub fee_rate: i128,
    /// Years to expiry, SCALAR_12.
    pub years: i128,
    /// Pool value on the SR side expressed in asset units.
    pub asset_reserve: i128,
}

/// `proportion = pt / (pt + asset)`, bounds-checked into the usable band.
pub fn try_proportion(env: &Env, pt_reserve: i128, asset_reserve: i128) -> Result<i128, Error> {
    if pt_reserve < 0 || asset_reserve < 0 {
        return Err(Error::InsufficientLiquidity);
    }
    let total = pt_reserve
        .checked_add(asset_reserve)
        .ok_or(Error::MathOverflow)?;
    if total <= 0 {
        return Err(Error::InsufficientLiquidity);
    }
    let p = mul_div_floor(env, pt_reserve, SCALAR_12, total)?;
    if !(MIN_PROPORTION..=MAX_PROPORTION).contains(&p) {
        return Err(Error::InsufficientLiquidity);
    }
    Ok(p)
}

/// `ln(p / (1 - p))` — signed; zero at p = 0.5, positive for a PT-heavy pool.
fn logit(env: &Env, prop: i128) -> Result<i128, Error> {
    let one_minus = SCALAR_12 - prop;
    if one_minus <= 0 || prop <= 0 {
        return Err(Error::InsufficientLiquidity);
    }
    ln_fixed(env, fdiv(env, prop, one_minus)?)
}

pub fn years_to_expiry(expiry: u64, now: u64) -> Option<i128> {
    if now >= expiry {
        return None;
    }
    let secs = (expiry - now) as i128;
    let y = secs.checked_mul(SCALAR_12)? / SECONDS_PER_YEAR;
    if y <= 0 {
        None
    } else {
        Some(y)
    }
}

/// Resolve the full parameter set. `Err(SeriesExpired)` at/after expiry.
#[allow(clippy::too_many_arguments)]
pub fn try_params(
    env: &Env,
    pt_reserve: i128,
    sr_reserve: i128,
    index: i128,
    scalar_root: i128,
    ln_fee_root: i128,
    last_ln_implied_rate: i128,
    expiry: u64,
    now: u64,
) -> Result<Params, Error> {
    let years = years_to_expiry(expiry, now).ok_or(Error::SeriesExpired)?;
    if scalar_root <= 0 || index <= 0 {
        return Err(Error::InvalidAmount);
    }
    let rate_scalar = fdiv(env, scalar_root, years)?;
    if rate_scalar <= 0 {
        return Err(Error::InsufficientLiquidity);
    }
    // SR shares -> asset units. Without this the proportion drifts with accrued yield.
    let asset_reserve = mul_div_floor(env, sr_reserve, index, SCALAR_12)?;
    let prop = try_proportion(env, pt_reserve, asset_reserve)?;

    // target_price = exp(-last_ln_implied_rate * years): the PT price that reproduces the stored
    // implied rate at *this* time to expiry.
    let target_price = exp_fixed(env, -fmul(env, last_ln_implied_rate, years)?)?;
    // rate_anchor = target_price + logit(prop)/rate_scalar, so price(prop) == target_price now.
    let rate_anchor = target_price
        .checked_add(fdiv(env, logit(env, prop)?, rate_scalar)?)
        .ok_or(Error::MathOverflow)?;

    let fee_rate = exp_fixed(env, fmul(env, ln_fee_root, years)?)?;
    if fee_rate < SCALAR_12 {
        // ln_fee_root must be non-negative; a fee that pays the trader is never intended.
        return Err(Error::FeeNotAllowed);
    }

    Ok(Params {
        rate_scalar,
        rate_anchor,
        fee_rate,
        years,
        asset_reserve,
    })
}

/// PT price in asset units at a given proportion: `anchor - logit(p)/rate_scalar`.
pub fn try_price_at(env: &Env, prop: i128, p: &Params) -> Result<i128, Error> {
    let price = p
        .rate_anchor
        .checked_sub(fdiv(env, logit(env, prop)?, p.rate_scalar)?)
        .ok_or(Error::MathOverflow)?;
    if price <= 0 {
        return Err(Error::InsufficientLiquidity);
    }
    Ok(price)
}

/// Spot PT price (asset per PT) at the pool's current point.
pub fn try_spot_price(env: &Env, pt_reserve: i128, p: &Params) -> Result<i128, Error> {
    try_price_at(env, try_proportion(env, pt_reserve, p.asset_reserve)?, p)
}

/// One priced trade. All amounts are ASSET units except `fee_asset`, which is also asset units;
/// the caller converts to SR at the index.
pub struct Trade {
    /// Asset the user receives (PT sale) or pays (PT purchase), after fee.
    pub asset_amount: i128,
    /// PT that moved.
    pub pt_amount: i128,
    /// The fee, in asset units. Split between LPs (stays) and treasury (leaves).
    pub fee_asset: i128,
}

/// **Sell exactly `pt_in` PT into the pool.** Returns the asset the user receives, after fee.
///
/// Price is evaluated at the *post-trade* proportion (Pendle's convention: the marginal price
/// reflects where the pool ends up), found by a short fixed-point pass.
pub fn try_sell_pt(
    env: &Env,
    pt_in: i128,
    pt_reserve: i128,
    p: &Params,
) -> Result<Trade, Error> {
    if pt_in <= 0 {
        return Err(Error::InvalidAmount);
    }
    let new_pt = pt_reserve.checked_add(pt_in).ok_or(Error::MathOverflow)?;

    let mut asset_pre = 0i128;
    let mut prop_after = try_proportion(env, new_pt, p.asset_reserve)?;
    for _ in 0..3 {
        let price = try_price_at(env, prop_after, p)?;
        asset_pre = fmul(env, pt_in, price)?;
        if asset_pre >= p.asset_reserve {
            return Err(Error::InsufficientLiquidity);
        }
        prop_after = try_proportion(env, new_pt, p.asset_reserve - asset_pre)?;
    }
    // Selling: you receive LESS. price / fee_rate  ==  asset_pre * SCALAR / fee_rate.
    let asset_out = fdiv(env, asset_pre, p.fee_rate)?;
    if asset_out <= 0 {
        return Err(Error::DustAmount);
    }
    Ok(Trade {
        asset_amount: asset_out,
        pt_amount: pt_in,
        fee_asset: asset_pre - asset_out,
    })
}

/// **Buy PT with exactly `asset_in` asset.** Returns the PT received, after fee.
pub fn try_buy_pt_exact_in(
    env: &Env,
    asset_in: i128,
    pt_reserve: i128,
    p: &Params,
) -> Result<Trade, Error> {
    if asset_in <= 0 {
        return Err(Error::InvalidAmount);
    }
    // Buying: you pay MORE. Skim the fee off the input first, then price the remainder.
    let asset_after_fee = fdiv(env, asset_in, p.fee_rate)?;
    if asset_after_fee <= 0 {
        return Err(Error::DustAmount);
    }
    let new_asset = p
        .asset_reserve
        .checked_add(asset_after_fee)
        .ok_or(Error::MathOverflow)?;

    let mut pt_out = 0i128;
    let mut prop_after = try_proportion(env, pt_reserve, new_asset)?;
    for _ in 0..3 {
        let price = try_price_at(env, prop_after, p)?;
        pt_out = fdiv(env, asset_after_fee, price)?;
        if pt_out >= pt_reserve {
            return Err(Error::InsufficientLiquidity);
        }
        prop_after = try_proportion(env, pt_reserve - pt_out, new_asset)?;
    }
    if pt_out <= 0 {
        return Err(Error::DustAmount);
    }
    Ok(Trade {
        asset_amount: asset_in,
        pt_amount: pt_out,
        fee_asset: asset_in - asset_after_fee,
    })
}

/// **Buy exactly `pt_out` PT.** Returns the asset the user must pay, including fee.
///
/// The exact-output direction is what a YT *sale* needs: the recombine burns exactly `N` PT
/// against exactly `N` YT, so the PT leg is pinned and the asset leg is solved for.
pub fn try_buy_pt_exact_out(
    env: &Env,
    pt_out: i128,
    pt_reserve: i128,
    p: &Params,
) -> Result<Trade, Error> {
    if pt_out <= 0 {
        return Err(Error::InvalidAmount);
    }
    if pt_out >= pt_reserve {
        return Err(Error::InsufficientLiquidity);
    }
    let new_pt = pt_reserve - pt_out;

    let mut asset_pre = 0i128;
    let mut prop_after = try_proportion(env, new_pt, p.asset_reserve)?;
    for _ in 0..3 {
        let price = try_price_at(env, prop_after, p)?;
        asset_pre = fmul(env, pt_out, price)?;
        prop_after = try_proportion(env, new_pt, p.asset_reserve + asset_pre)?;
    }
    // Buying: pay MORE. Gross up so the pool nets `asset_pre` after the fee is skimmed.
    // ceil so the pool is never short by a stroop.
    let asset_in = fmul(env, asset_pre, p.fee_rate)?;
    let asset_in = if fdiv(env, asset_in, p.fee_rate)? < asset_pre {
        asset_in + 1
    } else {
        asset_in
    };
    if asset_in <= 0 {
        return Err(Error::DustAmount);
    }
    Ok(Trade {
        asset_amount: asset_in,
        pt_amount: pt_out,
        fee_asset: asset_in - asset_pre,
    })
}

/// The implied rate the pool prices after a trade — stored so the next call can re-derive the
/// anchor from it. `ln_implied = -ln(price) / years`.
///
/// Returns `None` when the update should be skipped (too close to expiry, or PT at/above par —
/// both cases where the number is meaningless rather than merely extreme).
pub fn try_new_ln_implied_rate(
    env: &Env,
    pt_reserve: i128,
    asset_reserve: i128,
    p: &Params,
) -> Option<i128> {
    if p.years < MIN_YEARS_FOR_RATE_UPDATE {
        return None;
    }
    let prop = try_proportion(env, pt_reserve, asset_reserve).ok()?;
    let price = try_price_at(env, prop, p).ok()?;
    if price >= SCALAR_12 {
        return Some(0); // at/above par ⇒ zero implied yield
    }
    let ln_price = ln_fixed(env, price).ok()?; // negative, price < 1
    let rate = fdiv(env, -ln_price, p.years).ok()?;
    if rate < 0 {
        None
    } else {
        Some(rate)
    }
}

/// Implied APY as a SCALAR_12 fraction (`exp(ln_implied) - 1`), for display.
pub fn try_implied_apy(env: &Env, ln_implied_rate: i128) -> Result<i128, Error> {
    if ln_implied_rate <= 0 {
        return Ok(0);
    }
    Ok(exp_fixed(env, ln_implied_rate)? - SCALAR_12)
}

/// `ln(1 + apy)` — the inverse of [`try_implied_apy`], for calibrating a market at init.
pub fn try_ln_rate_from_apy(env: &Env, apy: i128) -> Result<i128, Error> {
    if apy < 0 {
        return Err(Error::InvalidAmount);
    }
    ln_fixed(env, SCALAR_12.checked_add(apy).ok_or(Error::MathOverflow)?)
}

/// Panicking wrapper for the swap path.
pub fn params_or_panic(env: &Env, r: Result<Params, Error>) -> Params {
    r.unwrap_or_else(|e| panic_with_error!(env, e))
}
