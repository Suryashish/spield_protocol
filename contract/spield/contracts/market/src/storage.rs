//! Storage layout for the Market (PT/USDC AMM). Instance storage for config + pool singletons
//! (reserves, total LP shares); persistent storage for per-LP share balances (one entry per LP,
//! never overwritten destructively). TTL extended after every write (SCF #9) via `bump_instance`
//! / `save_shares`.
//!
//! **Stage A note:** the pricing here is constant-product (`x*y=k`) — a *throwaway test harness*
//! to prove the mint→add_liquidity→swap→claim→redeem plumbing end-to-end. The storage shape is
//! curve-agnostic (reserves + shares + maturity), so swapping in the Phase-3 time-decay curve
//! later does not touch this module. See `PHASE3_AMM_DESIGN.md` §5.

use soroban_sdk::{contracttype, Address, Env};

/// ~30 / ~60 days in 5-second ledgers, matching the wrapper/vault bump window so the whole
/// protocol's state ages consistently.
pub const BUMP_LO: u32 = 30 * 24 * 60 * 60 / 5;
pub const BUMP_HI: u32 = 60 * 24 * 60 * 60 / 5;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Initialized,
    /// Operational admin (sets fee within ceiling, pauses; cannot touch LP funds).
    Admin,
    /// PT Stellar Asset Contract — one of the two pool reserves.
    PtToken,
    /// Underlying / settlement SAC (USDC) — the other pool reserve.
    Underlying,
    /// Market maturity (unix seconds); must equal the wrapper's. Trading halts at/after it.
    Maturity,
    /// Swap fee in basis points (e.g. 30 = 0.30%).
    FeeBps,
    /// Hard ceiling on the swap fee the admin may set (guardrail).
    MaxFeeBps,
    /// Curve steepness root (SCALAR_12): `rateScalar = scalarRoot / yearsToMaturity`. Set at init.
    ScalarRoot,
    /// Curve anchor exchange rate (SCALAR_12): the USDC-per-PT at proportion 0.5. Set at init.
    RateAnchor,
    /// Circuit-breaker pause flag.
    Paused,
    /// PT held by the pool (reserve), base units.
    PtReserve,
    /// USDC held by the pool (reserve), base units.
    UsdcReserve,
    /// Total LP shares outstanding.
    TotalShares,
    /// LP share balance for an address.
    Shares(Address),
}

// ----- instance config -----

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_not_init(env))
}

pub fn set_admin(env: &Env, a: &Address) {
    env.storage().instance().set(&DataKey::Admin, a);
}

pub fn get_pt(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::PtToken)
        .unwrap_or_else(|| panic_not_init(env))
}

pub fn set_pt(env: &Env, a: &Address) {
    env.storage().instance().set(&DataKey::PtToken, a);
}

pub fn get_underlying(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Underlying)
        .unwrap_or_else(|| panic_not_init(env))
}

pub fn set_underlying(env: &Env, a: &Address) {
    env.storage().instance().set(&DataKey::Underlying, a);
}

pub fn get_maturity(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::Maturity)
        .unwrap_or_else(|| panic_not_init(env))
}

pub fn set_maturity(env: &Env, m: u64) {
    env.storage().instance().set(&DataKey::Maturity, &m);
}

pub fn get_fee_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0)
}

pub fn set_fee_bps(env: &Env, f: u32) {
    env.storage().instance().set(&DataKey::FeeBps, &f);
}

pub fn get_max_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::MaxFeeBps)
        .unwrap_or(0)
}

pub fn set_max_fee_bps(env: &Env, f: u32) {
    env.storage().instance().set(&DataKey::MaxFeeBps, &f);
}

pub fn get_scalar_root(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::ScalarRoot)
        .unwrap_or_else(|| panic_not_init(env))
}

pub fn set_scalar_root(env: &Env, v: i128) {
    env.storage().instance().set(&DataKey::ScalarRoot, &v);
}

pub fn get_rate_anchor(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::RateAnchor)
        .unwrap_or_else(|| panic_not_init(env))
}

pub fn set_rate_anchor(env: &Env, v: i128) {
    env.storage().instance().set(&DataKey::RateAnchor, &v);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
}

pub fn set_paused(env: &Env, p: bool) {
    env.storage().instance().set(&DataKey::Paused, &p);
}

// ----- pool state -----

pub fn pt_reserve(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::PtReserve).unwrap_or(0)
}

pub fn set_pt_reserve(env: &Env, v: i128) {
    env.storage().instance().set(&DataKey::PtReserve, &v);
}

pub fn usdc_reserve(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::UsdcReserve)
        .unwrap_or(0)
}

pub fn set_usdc_reserve(env: &Env, v: i128) {
    env.storage().instance().set(&DataKey::UsdcReserve, &v);
}

pub fn total_shares(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalShares)
        .unwrap_or(0)
}

pub fn set_total_shares(env: &Env, v: i128) {
    env.storage().instance().set(&DataKey::TotalShares, &v);
}

// ----- per-LP shares (persistent) -----

pub fn shares_of(env: &Env, lp: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Shares(lp.clone()))
        .unwrap_or(0)
}

pub fn save_shares(env: &Env, lp: &Address, v: i128) {
    let key = DataKey::Shares(lp.clone());
    env.storage().persistent().set(&key, &v);
    env.storage().persistent().extend_ttl(&key, BUMP_LO, BUMP_HI);
}

pub fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(BUMP_LO, BUMP_HI);
}

fn panic_not_init(env: &Env) -> ! {
    soroban_sdk::panic_with_error!(env, spield_shared::Error::NotInitialized)
}
