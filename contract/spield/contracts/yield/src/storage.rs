//! Storage for the PT/YT engine.
//!
//! Instance: config + the index + the post-expiry stamp. Persistent: one `UserInterest` per YT
//! holder (Pendle's `InterestManagerYT.userInterest` mapping), and YT balances via
//! `spield_shared::token`.

use soroban_sdk::{contracttype, panic_with_error, Address, Env};
use spield_shared::{ttl, Error};

/// Per-holder interest state — Pendle's `UserInterest { index, accrued }`, one for one.
///
/// `index` is the value of the global PY index the last time this holder was settled.
/// `accrued` is SR they have earned but not yet withdrawn.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct UserInterest {
    /// Global index at this holder's last settlement. `0` means "never seen" — the first
    /// settlement just records the index and accrues nothing (they earn from here forward).
    pub index: i128,
    /// SR earned and credited, awaiting withdrawal. Survives selling every last YT.
    pub accrued: i128,
    /// Lifetime SR actually paid out to this holder (informational / dashboards).
    pub withdrawn: i128,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Initialized,
    Admin,
    /// The SR token this series strips.
    Sr,
    /// The PT Stellar Asset Contract (admined by this contract).
    Pt,
    /// Series expiry, unix seconds.
    Expiry,
    Paused,
    /// Monotonic PY index — `max(SR.exchange_rate(), stored)`. Pendle's `_pyIndexStored`.
    IndexStored,
    /// The index at `initialize`. No holder's settlement index can ever be lower, so this is the
    /// floor used to bound how much interest could still be unsettled across all YT holders.
    InitIndex,
    /// The index observed at/after expiry, written once. Pendle's `postExpiry.firstPYIndex`.
    /// Absent until the first post-expiry interaction stamps it.
    PostExpiryIndex,
    /// Total PY face outstanding (== PT supply == YT supply while unexpired).
    TotalPy,
    /// Sum of `accrued` across every holder — the protocol's unpaid-interest liability. The
    /// solvency assertion is `SR held >= PT cover + this`.
    TotalAccrued,
    /// Protocol treasury — receives the yield fee and post-expiry surplus.
    Treasury,
    /// Yield fee in bps, taken from interest at withdrawal time.
    YieldFeeBps,
    /// Per-holder interest state.
    Interest(Address),
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
inst_addr!(get_sr, set_sr, DataKey::Sr);
inst_addr!(get_pt, set_pt, DataKey::Pt);
inst_addr!(get_treasury, set_treasury, DataKey::Treasury);

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

pub fn index_stored(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::IndexStored)
        .unwrap_or(0)
}

pub fn set_index_stored(env: &Env, i: i128) {
    env.storage().instance().set(&DataKey::IndexStored, &i);
}

pub fn init_index(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::InitIndex).unwrap_or(0)
}

pub fn set_init_index(env: &Env, i: i128) {
    env.storage().instance().set(&DataKey::InitIndex, &i);
}

pub fn post_expiry_index(env: &Env) -> Option<i128> {
    env.storage().instance().get(&DataKey::PostExpiryIndex)
}

pub fn set_post_expiry_index(env: &Env, i: i128) {
    env.storage().instance().set(&DataKey::PostExpiryIndex, &i);
}

pub fn total_py(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalPy)
        .unwrap_or(0)
}

pub fn set_total_py(env: &Env, v: i128) {
    env.storage().instance().set(&DataKey::TotalPy, &v);
}

pub fn total_accrued(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalAccrued)
        .unwrap_or(0)
}

pub fn set_total_accrued(env: &Env, v: i128) {
    env.storage().instance().set(&DataKey::TotalAccrued, &v);
}

pub fn yield_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::YieldFeeBps)
        .unwrap_or(0)
}

pub fn set_yield_fee_bps(env: &Env, v: u32) {
    env.storage().instance().set(&DataKey::YieldFeeBps, &v);
}

// ---------- per-holder interest ----------

pub fn get_interest(env: &Env, user: &Address) -> UserInterest {
    env.storage()
        .persistent()
        .get(&DataKey::Interest(user.clone()))
        .unwrap_or(UserInterest {
            index: 0,
            accrued: 0,
            withdrawn: 0,
        })
}

/// Write a holder's interest state, bumping its TTL past expiry (+grace). A holder who never
/// touches the contract for a whole long-dated term must not have their claim archived.
pub fn set_interest(env: &Env, user: &Address, ui: &UserInterest) {
    let key = DataKey::Interest(user.clone());
    env.storage().persistent().set(&key, ui);
    let (lo, hi) = ttl::maturity_aware_bump(env, get_expiry(env));
    env.storage().persistent().extend_ttl(&key, lo, hi);
}


/// Permissionless TTL keep-alive for a holder's interest entry.
pub fn bump_interest_ttl(env: &Env, user: &Address) {
    let key = DataKey::Interest(user.clone());
    if env.storage().persistent().has(&key) {
        let (lo, hi) = ttl::maturity_aware_bump(env, get_expiry(env));
        env.storage().persistent().extend_ttl(&key, lo, hi);
    }
}
