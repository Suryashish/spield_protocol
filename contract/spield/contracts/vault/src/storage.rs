//! Storage layout for the Fixed-Rate Vault. Instance storage for config/singletons; persistent
//! storage for per-receipt records (each keyed by a unique `u64` id — never overwritten, the same
//! discipline the wrapper uses to avoid SCF #4). TTL is extended after every persistent write
//! (SCF #9) via `save_receipt` / `bump_instance`.

use soroban_sdk::{contracttype, vec, Address, Env, Vec};
use spield_shared::{ttl, types::FixedReceipt, Error};

/// ~30 / ~60 days expressed in 5-second ledgers, for the instance-storage TTL bump (config/
/// singletons, rewritten on every mutation). Per-receipt entries use the maturity-aware bump
/// (mainnet-readiness #5) so a held-to-maturity receipt can't archive before the vault matures.
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
    /// Walked on `harvest` (claim each, paginated) and `redeem` (burn PT across them); pruned as
    /// positions empty. Bounded per-call by pagination so the list can never make an op un-runnable.
    Positions,
    /// Round-robin cursor into `Positions` for paginated `harvest` — the index to resume from on the
    /// next call, so repeated `harvest(max)` calls sweep the whole list a chunk at a time.
    HarvestCursor,
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

/// The paginated-harvest cursor (index into `positions`). Defaults to 0.
pub fn harvest_cursor(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::HarvestCursor)
        .unwrap_or(0)
}

pub fn set_harvest_cursor(env: &Env, c: u32) {
    env.storage().instance().set(&DataKey::HarvestCursor, &c);
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
    bump_receipt_ttl(env, id);
}

/// Extend a receipt entry's TTL to exceed the vault's maturity (+grace), clamped to the network
/// max. Called on every write and by the permissionless `bump_receipt` so a held receipt never
/// archives before it can be redeemed.
pub fn bump_receipt_ttl(env: &Env, id: u64) {
    let maturity = get_maturity(env);
    let (threshold, extend_to) = ttl::maturity_aware_bump(env, maturity);
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::Receipt(id), threshold, extend_to);
}

/// True if a receipt entry exists (used by the permissionless bump to fail cleanly on a bad id).
pub fn has_receipt(env: &Env, id: u64) -> bool {
    env.storage().persistent().has(&DataKey::Receipt(id))
}

pub fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(BUMP_LO, BUMP_HI);
}

fn panic_not_init(env: &Env) -> ! {
    soroban_sdk::panic_with_error!(env, Error::NotInitialized)
}
