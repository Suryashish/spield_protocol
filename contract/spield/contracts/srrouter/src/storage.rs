//! Storage for the SR router.
//!
//! Deliberately tiny. The router is a **stateless composer**: it remembers who may govern it and
//! which market it fronts, and derives everything else — engine, SR, PT, underlying, expiry — by
//! asking those contracts at `initialize`. Nothing here is a balance, because the router never
//! holds one across transactions.

use soroban_sdk::{contracttype, panic_with_error, Address, Env};
use spield_shared::{ttl, Error};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Initialized,
    Admin,
    /// The PT/SR market this router routes through.
    Market,
    /// The PT/YT engine, read back from the market.
    YieldContract,
    Sr,
    Pt,
    Underlying,
    Expiry,
    Paused,
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}
pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

macro_rules! addr_accessor {
    ($get:ident, $set:ident, $key:ident) => {
        pub fn $get(env: &Env) -> Address {
            env.storage()
                .instance()
                .get(&DataKey::$key)
                .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
        }
        pub fn $set(env: &Env, v: &Address) {
            env.storage().instance().set(&DataKey::$key, v);
        }
    };
}

addr_accessor!(get_admin, set_admin, Admin);
addr_accessor!(get_market, set_market, Market);
addr_accessor!(get_yield, set_yield, YieldContract);
addr_accessor!(get_sr, set_sr, Sr);
addr_accessor!(get_pt, set_pt, Pt);
addr_accessor!(get_underlying, set_underlying, Underlying);

pub fn expiry(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::Expiry).unwrap_or(0)
}
pub fn set_expiry(env: &Env, v: u64) {
    env.storage().instance().set(&DataKey::Expiry, &v);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
}
pub fn set_paused(env: &Env, v: bool) {
    env.storage().instance().set(&DataKey::Paused, &v);
}

pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(ttl::MIN_BUMP_LEDGERS, ttl::MIN_BUMP_LEDGERS * 2);
}
