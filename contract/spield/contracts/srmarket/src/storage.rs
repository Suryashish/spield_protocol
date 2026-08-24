//! Instance storage for the PT/SR market. LP shares are persistent, per-address.

use soroban_sdk::{contracttype, panic_with_error, Address, Env};
use spield_shared::{ttl, Error};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Initialized,
    Admin,
    /// The PT/YT engine this market is bound to.
    YieldContract,
    /// The PT SAC (a pool reserve).
    Pt,
    /// The SR token (the *other* pool reserve — yield-bearing, unlike a raw-USDC pool).
    Sr,
    Expiry,
    Paused,
    /// Curve steepness root, SCALAR_12.
    ScalarRoot,
    /// Annualized fee root, SCALAR_12: `fee_rate = exp(ln_fee_root * years)`.
    LnFeeRoot,
    /// The last implied rate the pool priced, SCALAR_12. **This is the state that makes the anchor
    /// dynamic** — every quote re-derives `rate_anchor` from it.
    LastLnImpliedRate,
    /// PT reserve, in PT face (asset units).
    PtReserve,
    /// SR reserve, in SR shares.
    SrReserve,
    TotalShares,
    Shares(Address),
    /// Protocol treasury.
    Treasury,
    /// Share of each swap fee routed to the treasury, in bps. The remainder stays in the reserves
    /// and therefore belongs to LPs.
    TreasuryFeeShareBps,
    /// Lifetime SR sent to the treasury from swap fees (dashboards / revenue reporting).
    TreasuryEarned,
}

pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(ttl::MIN_BUMP_LEDGERS, ttl::MIN_BUMP_LEDGERS * 2);
}

macro_rules! inst_addr {
    ($get:ident, $set:ident, $key:expr) => {
        pub fn $get(env: &Env) -> Address {
            env.storage()
                .instance()
                .get(&$key)
                .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
        }
        pub fn $set(env: &Env, a: &Address) {
            env.storage().instance().set(&$key, a);
        }
    };
}

inst_addr!(get_admin, set_admin, DataKey::Admin);
inst_addr!(get_yield, set_yield, DataKey::YieldContract);
inst_addr!(get_pt, set_pt, DataKey::Pt);
inst_addr!(get_sr, set_sr, DataKey::Sr);
inst_addr!(get_treasury, set_treasury, DataKey::Treasury);

macro_rules! inst_i128 {
    ($get:ident, $set:ident, $key:expr) => {
        pub fn $get(env: &Env) -> i128 {
            env.storage().instance().get(&$key).unwrap_or(0)
        }
        pub fn $set(env: &Env, v: i128) {
            env.storage().instance().set(&$key, &v);
        }
    };
}

inst_i128!(scalar_root, set_scalar_root, DataKey::ScalarRoot);
inst_i128!(ln_fee_root, set_ln_fee_root, DataKey::LnFeeRoot);
inst_i128!(
    last_ln_implied_rate,
    set_last_ln_implied_rate,
    DataKey::LastLnImpliedRate
);
inst_i128!(pt_reserve, set_pt_reserve, DataKey::PtReserve);
inst_i128!(sr_reserve, set_sr_reserve, DataKey::SrReserve);
inst_i128!(total_shares, set_total_shares, DataKey::TotalShares);
inst_i128!(treasury_earned, set_treasury_earned, DataKey::TreasuryEarned);

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

pub fn get_expiry(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::Expiry)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

pub fn set_expiry(env: &Env, e: u64) {
    env.storage().instance().set(&DataKey::Expiry, &e);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, p: bool) {
    env.storage().instance().set(&DataKey::Paused, &p);
}

pub fn treasury_fee_share_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::TreasuryFeeShareBps)
        .unwrap_or(0)
}

pub fn set_treasury_fee_share_bps(env: &Env, v: u32) {
    env.storage()
        .instance()
        .set(&DataKey::TreasuryFeeShareBps, &v);
}

// ---------- LP shares ----------

pub fn shares_of(env: &Env, lp: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Shares(lp.clone()))
        .unwrap_or(0)
}

pub fn save_shares(env: &Env, lp: &Address, amount: i128) {
    let key = DataKey::Shares(lp.clone());
    env.storage().persistent().set(&key, &amount);
    let (lo, hi) = ttl::maturity_aware_bump(env, get_expiry(env));
    env.storage().persistent().extend_ttl(&key, lo, hi);
}
