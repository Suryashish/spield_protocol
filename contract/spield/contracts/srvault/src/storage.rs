//! Storage for the v2 Fixed-Rate Vault.
//!
//! Note what is **absent**: there is no `Positions` vector. v1's vault tracked a list of wrapper
//! position ids and walked it on every redeem, which is what made `tofix.md` #18 a P0 — an
//! unbounded walk whose cost a stranger could inflate. Here PT is a pure bearer asset, so the
//! vault holds a *balance*, not a list, and redemption touches one entry regardless of history.

use soroban_sdk::{contracttype, panic_with_error, Address, Env};
use spield_shared::{ttl, Error, SCALAR_12};

/// A single fixed-rate deposit. `payout` is the current effective claim, backed by PT the vault
/// actually holds. A realized venue loss can reduce it by the shared loss factor.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Receipt {
    pub owner: Address,
    /// USDC the user deposited.
    pub principal: i128,
    /// USDC guaranteed at maturity = principal + fixed coupon. Backed 1:1 by PT face.
    pub payout: i128,
    /// The APR quoted, in bps. Display only — `payout` is the binding number.
    pub rate_bps: u32,
    pub maturity: u64,
    pub open: bool,
    /// USDC collected by the legacy all-or-nothing redemption path before the incremental upgrade.
    /// New redemptions pay each leg directly, so this remains only for upgrade compatibility.
    pub collected: i128,
    /// PT face deficit tolerated from partial redemptions (`anyfix.md` F2).
    ///
    /// A partial leg's flooring deficit is hard-bounded by `PARTIAL_LEG_BUDGET`; a larger shortfall
    /// is recognized as a loss haircut instead of being accumulated into an unbounded allowance.
    ///
    /// Released from the running total when the receipt closes, so the slack never outlives the
    /// receipt that earned it.
    pub residue: i128,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Initialized,
    Admin,
    /// The PT/YT engine this vault sits on.
    YieldContract,
    Sr,
    Pt,
    Underlying,
    Maturity,
    Paused,
    RateBps,
    MaxRateBps,
    /// Sum of `payout` across open receipts — the vault's total obligation.
    TotalLiability,
    /// Sum of `collected` across open receipts — obligation already backed by USDC rather than PT.
    TotalCollected,
    /// Sum of `Receipt::residue` across open receipts — flooring loss already realized by partial
    /// redemptions, which `assert_solvent` must not mistake for a deficit (`anyfix.md` F2).
    TotalResidue,
    NextReceiptId,
    /// Count of open receipts, for the dashboard.
    OpenReceipts,
    Receipt(u64),
    /// Lowest venue-value factor observed relative to the frozen PT index. Missing on old
    /// instances, where the default is the loss-free factor.
    LossFactor,
    /// Cumulative USDC paid directly to a receipt owner by the incremental redemption path.
    /// Kept separate from `Receipt` so existing serialized receipts remain upgrade-compatible.
    Paid(u64),
    /// Loss factor already applied to a receipt. Also separate from `Receipt` for upgrade safety.
    ReceiptLossFactor(u64),
}

pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(ttl::MIN_BUMP_LEDGERS, ttl::MIN_BUMP_LEDGERS * 2);
}

macro_rules! inst_addr {
    ($get:ident, $set:ident, $key:expr) => {
        pub fn $get(env: &Env) -> Address {
            env.storage().instance().get(&$key)
                .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
        }
        pub fn $set(env: &Env, a: &Address) { env.storage().instance().set(&$key, a); }
    };
}
inst_addr!(get_admin, set_admin, DataKey::Admin);
inst_addr!(get_yield, set_yield, DataKey::YieldContract);
inst_addr!(get_sr, set_sr, DataKey::Sr);
inst_addr!(get_pt, set_pt, DataKey::Pt);
inst_addr!(get_underlying, set_underlying, DataKey::Underlying);

pub fn is_initialized(env: &Env) -> bool { env.storage().instance().has(&DataKey::Initialized) }
pub fn set_initialized(env: &Env) { env.storage().instance().set(&DataKey::Initialized, &true); }

pub fn get_maturity(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::Maturity)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}
pub fn set_maturity(env: &Env, m: u64) { env.storage().instance().set(&DataKey::Maturity, &m); }

pub fn is_paused(env: &Env) -> bool { env.storage().instance().get(&DataKey::Paused).unwrap_or(false) }
pub fn set_paused(env: &Env, p: bool) { env.storage().instance().set(&DataKey::Paused, &p); }

pub fn rate_bps(env: &Env) -> u32 { env.storage().instance().get(&DataKey::RateBps).unwrap_or(0) }
pub fn set_rate_bps(env: &Env, v: u32) { env.storage().instance().set(&DataKey::RateBps, &v); }
pub fn max_rate_bps(env: &Env) -> u32 { env.storage().instance().get(&DataKey::MaxRateBps).unwrap_or(0) }
pub fn set_max_rate_bps(env: &Env, v: u32) { env.storage().instance().set(&DataKey::MaxRateBps, &v); }

pub fn total_liability(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::TotalLiability).unwrap_or(0)
}
pub fn set_total_liability(env: &Env, v: i128) {
    env.storage().instance().set(&DataKey::TotalLiability, &v);
}

pub fn total_collected(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::TotalCollected).unwrap_or(0)
}
pub fn set_total_collected(env: &Env, v: i128) {
    env.storage().instance().set(&DataKey::TotalCollected, &v);
}

pub fn total_residue(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::TotalResidue).unwrap_or(0)
}
pub fn set_total_residue(env: &Env, v: i128) {
    env.storage().instance().set(&DataKey::TotalResidue, &v);
}

pub fn loss_factor(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::LossFactor).unwrap_or(SCALAR_12)
}

pub fn set_loss_factor(env: &Env, v: i128) {
    env.storage().instance().set(&DataKey::LossFactor, &v);
}

pub fn open_receipts(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::OpenReceipts).unwrap_or(0)
}
pub fn set_open_receipts(env: &Env, v: u64) {
    env.storage().instance().set(&DataKey::OpenReceipts, &v);
}

pub fn next_receipt_id(env: &Env) -> u64 {
    let id: u64 = env.storage().instance().get(&DataKey::NextReceiptId).unwrap_or(0);
    env.storage().instance().set(&DataKey::NextReceiptId, &(id + 1));
    id
}

pub fn get_receipt(env: &Env, id: u64) -> Result<Receipt, Error> {
    env.storage().persistent().get(&DataKey::Receipt(id)).ok_or(Error::ReceiptNotFound)
}

pub fn save_receipt(env: &Env, id: u64, r: &Receipt) {
    let key = DataKey::Receipt(id);
    env.storage().persistent().set(&key, r);
    let (lo, hi) = ttl::maturity_aware_bump(env, get_maturity(env));
    env.storage().persistent().extend_ttl(&key, lo, hi);
}

pub fn paid(env: &Env, id: u64) -> i128 {
    env.storage().persistent().get(&DataKey::Paid(id)).unwrap_or(0)
}

pub fn set_paid(env: &Env, id: u64, value: i128) {
    let key = DataKey::Paid(id);
    env.storage().persistent().set(&key, &value);
    let (lo, hi) = ttl::maturity_aware_bump(env, get_maturity(env));
    env.storage().persistent().extend_ttl(&key, lo, hi);
}

pub fn receipt_loss_factor(env: &Env, id: u64) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::ReceiptLossFactor(id))
        .unwrap_or(SCALAR_12)
}

pub fn set_receipt_loss_factor(env: &Env, id: u64, value: i128) {
    let key = DataKey::ReceiptLossFactor(id);
    env.storage().persistent().set(&key, &value);
    let (lo, hi) = ttl::maturity_aware_bump(env, get_maturity(env));
    env.storage().persistent().extend_ttl(&key, lo, hi);
}

pub fn bump_receipt_ttl(env: &Env, id: u64) {
    let key = DataKey::Receipt(id);
    if env.storage().persistent().has(&key) {
        let (lo, hi) = ttl::maturity_aware_bump(env, get_maturity(env));
        env.storage().persistent().extend_ttl(&key, lo, hi);
    }
}
