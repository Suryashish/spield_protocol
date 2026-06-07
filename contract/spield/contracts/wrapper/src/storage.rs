//! Storage layout for the wrapper. Instance storage for config/singletons; persistent storage
//! for per-position records (each keyed by a unique `u64` id — never overwritten, fixing SCF #4).
//!
//! TTL is extended after every persistent write (SCF #9). **Per-position entries are bumped to
//! exceed the market's maturity** (mainnet-readiness #5) via `spield_shared::ttl` — a flat ~60-day
//! bump could otherwise let a long-dated bond's position *archive before maturity*. Instance config
//! still uses the flat window (it's rewritten on every mutation, so it never idles long enough to
//! lapse).

use soroban_sdk::{contracttype, Address, Env};
use spield_shared::{ttl, types::Position, Error};

/// ~30 / ~60 days expressed in 5-second ledgers, for the instance-storage TTL bump (config/
/// singletons, rewritten on every mutation). Per-position entries use the maturity-aware bump.
pub const BUMP_LO: u32 = 30 * 24 * 60 * 60 / 5;
pub const BUMP_HI: u32 = 60 * 24 * 60 * 60 / 5;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Initialized,
    Admin,
    /// The `YieldStrategy` adapter address (Blend day 1).
    Strategy,
    /// Underlying asset SAC (USDC) — cached from the strategy at init.
    Underlying,
    /// PT Stellar Asset Contract address (admined by this wrapper).
    PtToken,
    /// YT Stellar Asset Contract address (admined by this wrapper).
    YtToken,
    /// Market maturity (unix seconds). PT redeems 1:1 only at/after this time.
    Maturity,
    /// Circuit-breaker pause flag.
    Paused,
    /// Monotonic counter for position ids.
    NextPositionId,
    /// Total principal across all open positions (underlying terms). Solvency LHS component.
    TotalPrincipal,
    /// Count of withdrawing operations (claims/redeems). Bounds cumulative withdraw rounding dust.
    WithdrawOps,
    /// A single position record, keyed by id.
    Position(u64),
}

// ----- instance config accessors -----

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

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_strategy(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Strategy)
        .unwrap_or_else(|| panic_not_init(env))
}

pub fn set_strategy(env: &Env, s: &Address) {
    env.storage().instance().set(&DataKey::Strategy, s);
}

pub fn get_underlying(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Underlying)
        .unwrap_or_else(|| panic_not_init(env))
}

pub fn set_underlying(env: &Env, u: &Address) {
    env.storage().instance().set(&DataKey::Underlying, u);
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

pub fn get_yt(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::YtToken)
        .unwrap_or_else(|| panic_not_init(env))
}

pub fn set_yt(env: &Env, a: &Address) {
    env.storage().instance().set(&DataKey::YtToken, a);
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

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, p: bool) {
    env.storage().instance().set(&DataKey::Paused, &p);
}

pub fn total_principal(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalPrincipal)
        .unwrap_or(0)
}

pub fn set_total_principal(env: &Env, v: i128) {
    env.storage().instance().set(&DataKey::TotalPrincipal, &v);
}

/// Read the next position id without incrementing (= total positions ever opened).
pub fn peek_next_position_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextPositionId)
        .unwrap_or(0)
}

pub fn withdraw_ops(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::WithdrawOps)
        .unwrap_or(0)
}

pub fn bump_withdraw_ops(env: &Env) {
    let n = withdraw_ops(env);
    env.storage()
        .instance()
        .set(&DataKey::WithdrawOps, &(n + 1));
}

pub fn next_position_id(env: &Env) -> u64 {
    let id: u64 = env
        .storage()
        .instance()
        .get(&DataKey::NextPositionId)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKey::NextPositionId, &(id + 1));
    id
}

// ----- per-position persistent accessors -----

pub fn get_position(env: &Env, id: u64) -> Result<Position, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Position(id))
        .ok_or(Error::PositionNotFound)
}

pub fn save_position(env: &Env, id: u64, p: &Position) {
    env.storage().persistent().set(&DataKey::Position(id), p);
    bump_position_ttl(env, id);
}

/// Extend a position entry's TTL to comfortably exceed the market's maturity (+ grace), clamped to
/// the network max. Called on every write (`save_position`) and, crucially, by the permissionless
/// `bump_position` entry point so a long-held position never archives before its bond matures.
pub fn bump_position_ttl(env: &Env, id: u64) {
    let maturity = get_maturity(env);
    let (threshold, extend_to) = ttl::maturity_aware_bump(env, maturity);
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::Position(id), threshold, extend_to);
}

/// True if a position entry exists (used by the permissionless bump to fail cleanly on a bad id).
pub fn has_position(env: &Env, id: u64) -> bool {
    env.storage().persistent().has(&DataKey::Position(id))
}

pub fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(BUMP_LO, BUMP_HI);
}

fn panic_not_init(env: &Env) -> ! {
    soroban_sdk::panic_with_error!(env, Error::NotInitialized)
}
