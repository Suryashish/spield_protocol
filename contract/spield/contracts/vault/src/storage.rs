//! Storage layout for the Fixed-Rate Vault. Instance storage for config/singletons; persistent
//! storage for per-receipt records (each keyed by a unique `u64` id — never overwritten, the same
//! discipline the wrapper uses to avoid SCF #4). TTL is extended after every persistent write
//! (SCF #9) via `save_receipt` / `bump_instance`.

use soroban_sdk::{contracttype, vec, Address, Env, Vec};
use spield_shared::{types::FixedReceipt, Error};

/// ~30 / ~60 days expressed in 5-second ledgers, for instance + persistent TTL bumps (matches
/// the wrapper's bump window so the whole protocol's state ages consistently).
pub const BUMP_LO: u32 = 30 * 24 * 60 * 60 / 5;
pub const BUMP_HI: u32 = 60 * 24 * 60 * 60 / 5;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Initialized,
    /// Operational admin (sets the quoted rate, pauses, harvests; cannot move user funds).
    Admin,
    /// The Spield wrapper this vault sits on top of (its sole source of PT/YT).
    Wrapper,
    /// PT Stellar Asset Contract — the vault's bond inventory token.
    PtToken,
    /// YT Stellar Asset Contract — the vault's variable leg.
    YtToken,
    /// Underlying deposit asset SAC (USDC), cached from the wrapper's market.
    Underlying,
    /// Market maturity (unix seconds), inherited from the wrapper.
    Maturity,
    /// The fixed APR the vault currently quotes, in basis points.
    RateBps,
    /// The maximum APR (bps) the admin may quote — a guardrail so a bad rate can't be set.
    MaxRateBps,
    /// Circuit-breaker pause flag.
    Paused,
    /// Monotonic counter for receipt ids.
    NextReceiptId,
    /// Sum of `payout` across all open receipts — the vault's maturity obligation.
    TotalLiability,
    /// The list of wrapper position ids the vault owns (its PT/YT inventory lives across these).
    /// Walked on `harvest` (claim each) and `redeem` (burn PT across them); pruned as positions
    /// empty. Bounded for a testnet demo; a production vault would consolidate periodically.
    Positions,
    /// A single fixed-rate receipt, keyed by id.
    Receipt(u64),
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

pub fn set_admin(env: &Env, a: &Address) {
    env.storage().instance().set(&DataKey::Admin, a);
}

pub fn get_wrapper(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Wrapper)
        .unwrap_or_else(|| panic_not_init(env))
}

pub fn set_wrapper(env: &Env, a: &Address) {
    env.storage().instance().set(&DataKey::Wrapper, a);
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

pub fn get_rate_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::RateBps)
        .unwrap_or(0)
}

pub fn set_rate_bps(env: &Env, r: u32) {
    env.storage().instance().set(&DataKey::RateBps, &r);
}

pub fn get_max_rate_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::MaxRateBps)
        .unwrap_or(0)
}

pub fn set_max_rate_bps(env: &Env, r: u32) {
    env.storage().instance().set(&DataKey::MaxRateBps, &r);
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

pub fn total_liability(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalLiability)
        .unwrap_or(0)
}

pub fn set_total_liability(env: &Env, v: i128) {
    env.storage().instance().set(&DataKey::TotalLiability, &v);
}

/// The list of wrapper position ids the vault currently owns.
pub fn positions(env: &Env) -> Vec<u64> {
    env.storage()
        .instance()
        .get(&DataKey::Positions)
        .unwrap_or_else(|| vec![env])
}

pub fn set_positions(env: &Env, p: &Vec<u64>) {
    env.storage().instance().set(&DataKey::Positions, p);
}

/// Read the next receipt id without incrementing (= total receipts ever issued).
pub fn peek_next_receipt_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextReceiptId)
        .unwrap_or(0)
}

pub fn next_receipt_id(env: &Env) -> u64 {
    let id: u64 = env
        .storage()
        .instance()
        .get(&DataKey::NextReceiptId)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKey::NextReceiptId, &(id + 1));
    id
}

// ----- per-receipt persistent accessors -----

pub fn get_receipt(env: &Env, id: u64) -> Result<FixedReceipt, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Receipt(id))
        .ok_or(Error::ReceiptNotFound)
}

pub fn save_receipt(env: &Env, id: u64, r: &FixedReceipt) {
    env.storage().persistent().set(&DataKey::Receipt(id), r);
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::Receipt(id), BUMP_LO, BUMP_HI);
}

pub fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(BUMP_LO, BUMP_HI);
}

fn panic_not_init(env: &Env) -> ! {
    soroban_sdk::panic_with_error!(env, Error::NotInitialized)
}
