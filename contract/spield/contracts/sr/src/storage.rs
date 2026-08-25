//! Instance config for the SR token. Balances/allowances live in `spield_shared::token`.

use soroban_sdk::{contracttype, panic_with_error, Address, Env};
use spield_shared::{ttl, Error};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Initialized,
    Admin,
    /// The `YieldStrategy` adapter this SR wraps (Blend day 1).
    Strategy,
    /// The underlying asset SAC (USDC), cached from the strategy at init.
    Underlying,
    /// Circuit breaker: blocks `deposit` (an inflow). `redeem` stays open.
    Paused,
    /// Highest exchange rate ever observed. SR's rate is monotonic **by contract**, even if the
    /// strategy's own rate dips — see `Sr::exchange_rate`.
    RateHighWater,
    /// Launch TVL cap, in underlying. `0` = uncapped. See `Sr::set_deposit_cap`.
    DepositCap,
}

/// The TVL cap in underlying units. `0` means uncapped.
pub fn deposit_cap(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::DepositCap).unwrap_or(0)
}
pub fn set_deposit_cap(env: &Env, v: i128) {
    env.storage().instance().set(&DataKey::DepositCap, &v);
}

pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(ttl::MIN_BUMP_LEDGERS, ttl::MIN_BUMP_LEDGERS * 2);
}

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
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

pub fn set_admin(env: &Env, a: &Address) {
    env.storage().instance().set(&DataKey::Admin, a);
}

pub fn get_strategy(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Strategy)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

pub fn set_strategy(env: &Env, a: &Address) {
    env.storage().instance().set(&DataKey::Strategy, a);
}

pub fn get_underlying(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Underlying)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

pub fn set_underlying(env: &Env, a: &Address) {
    env.storage().instance().set(&DataKey::Underlying, a);
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

pub fn rate_high_water(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::RateHighWater)
        .unwrap_or(0)
}

pub fn set_rate_high_water(env: &Env, r: i128) {
    env.storage().instance().set(&DataKey::RateHighWater, &r);
}
