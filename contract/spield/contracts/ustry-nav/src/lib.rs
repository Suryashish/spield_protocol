#![no_std]
//! # spield-ustry-nav — authenticated NAV relay behind a SEP-40 read interface
//!
//! The testnet sandbox USTRY has no RedStone feed, so Spield relays the issuer's sandbox NAV
//! itself. This contract exposes exactly the SEP-40 subset that RedStone's mainnet wrapper
//! (`CBMGLKUQ…`) exposes — `base`, `decimals`, `resolution`, `assets`, `lastprice`, `prices`,
//! `price` — so `spield-ustry-series` reads either one through the same client. Swapping the
//! testnet relay for RedStone on mainnet is a constructor argument, not a code change.
//!
//! ## What changed from `spield-ustry-oracle` (Series 1)
//!
//! | v1 | here |
//! |---|---|
//! | One admin key both publishes and governs | Separate **publisher** (hot, rotatable by admin) and **admin** (two-step rotation, timelocked upgrades) |
//! | Publish only every 12h unless NAV moves 0.1% — a one-hour window before the 13h consumer limit | Admin-set `min_interval` (60s … 12h). The relay can publish every few hours, so a missed run is not an outage |
//! | Append-only history capped at 256 samples, then `Full` forever | Ring buffer of the last [`HISTORY`] samples. The series folds by timestamp, so dropping old samples never breaks it |
//! | Any price in range accepted | Per-publish move bound (`max_move_bps`) rejects fat-fingered prices |
//!
//! Observation time is relay observation time, not a claim about the bond administrator's
//! underlying valuation effective time.
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, BytesN, Env,
    Symbol, Vec,
};
use spield_shared::governance;

/// Samples retained. Two days at one-hour publication, ~10 days at the 4h relay cadence.
pub const HISTORY: u32 = 64;
const DECIMALS: u32 = 8;
const MAX_PRICE: i128 = 100_000_000_000; // $1,000 at 8 decimals.
const MAX_SKEW: u64 = 300;
const DEVIATION_BPS: i128 = 10; // 0.1% move publishes early, like RedStone's trigger.
const MIN_INTERVAL_FLOOR: u64 = 60;
const MIN_INTERVAL_CEILING: u64 = 43_200;
const BUMP_LO: u32 = 30 * 17_280;
const BUMP_HI: u32 = 60 * 17_280;

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum NavError {
    Invalid = 1,
    Cadence = 2,
    Move = 3,
    Config = 4,
}

/// SEP-40 asset. Variant names and order match RedStone's wrapper, which encodes `base()` as
/// `{"Other":"USD"}` and keys feeds by `Stellar(<SAC address>)`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

/// SEP-40 price record: `price` at [`DECIMALS`], `timestamp` in **seconds**.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub publisher: Address,
    pub asset: Address,
    pub min_interval: u64,
    pub max_move_bps: u32,
    pub resolution: u32,
}

#[contracttype]
#[derive(Clone)]
enum Key {
    Config,
    History,
}

#[contract]
pub struct UstryNav;

fn bump(env: &Env) {
    env.storage().instance().extend_ttl(BUMP_LO, BUMP_HI);
}
fn config(env: &Env) -> Config {
    bump(env);
    env.storage().instance().get(&Key::Config).unwrap()
}
fn history(env: &Env) -> Vec<PriceData> {
    env.storage().instance().get(&Key::History).unwrap()
}
fn sample(env: &Env, price: i128, timestamp: u64) {
    let now = env.ledger().timestamp();
    if !(1..=MAX_PRICE).contains(&price) || timestamp > now || now - timestamp > MAX_SKEW {
        panic_with_error!(env, NavError::Invalid);
    }
}
fn check_interval(env: &Env, secs: u64) {
    if !(MIN_INTERVAL_FLOOR..=MIN_INTERVAL_CEILING).contains(&secs) {
        panic_with_error!(env, NavError::Config);
    }
}
fn check_move(env: &Env, bps: u32) {
    if !(100..=5_000).contains(&bps) {
        panic_with_error!(env, NavError::Config);
    }
}
fn ours(env: &Env, asset: &Asset) -> bool {
    *asset == Asset::Stellar(config(env).asset)
}

#[contractimpl]
impl UstryNav {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        env: Env,
        admin: Address,
        publisher: Address,
        asset: Address,
        price: i128,
        timestamp: u64,
        min_interval: u64,
        max_move_bps: u32,
    ) {
        sample(&env, price, timestamp);
        check_interval(&env, min_interval);
        check_move(&env, max_move_bps);
        env.storage().instance().set(
            &Key::Config,
            &Config {
                admin,
                publisher,
                asset,
                min_interval,
                max_move_bps,
                resolution: min_interval as u32,
            },
        );
        let mut h = Vec::new(&env);
        h.push_back(PriceData { price, timestamp });
        env.storage().instance().set(&Key::History, &h);
        governance::init(&env);
        bump(&env);
    }

    // ---------------------------------------------------------------- SEP-40 reads

    pub fn base(env: Env) -> Asset {
        Asset::Other(Symbol::new(&env, "USD"))
    }
    pub fn assets(env: Env) -> Vec<Asset> {
        soroban_sdk::vec![&env, Asset::Stellar(config(&env).asset)]
    }
    pub fn decimals(_env: Env) -> u32 {
        DECIMALS
    }
    pub fn resolution(env: Env) -> u32 {
        config(&env).resolution
    }
    pub fn lastprice(env: Env, asset: Asset) -> Option<PriceData> {
        if !ours(&env, &asset) {
            return None;
        }
        history(&env).last()
    }
    /// The last `records` samples, **oldest first** — the order RedStone's wrapper returns.
    pub fn prices(env: Env, asset: Asset, records: u32) -> Option<Vec<PriceData>> {
        if !ours(&env, &asset) || records == 0 {
            return None;
        }
        let h = history(&env);
        let from = h.len().saturating_sub(records);
        Some(h.slice(from..))
    }
    pub fn price(env: Env, asset: Asset, timestamp: u64) -> Option<PriceData> {
        if !ours(&env, &asset) {
            return None;
        }
        history(&env).iter().find(|p| p.timestamp == timestamp)
    }

    // ---------------------------------------------------------------- publication

    pub fn publish(env: Env, price: i128, timestamp: u64) {
        let c = config(&env);
        c.publisher.require_auth();
        sample(&env, price, timestamp);
        let mut h = history(&env);
        let last = h.last().unwrap();
        if timestamp <= last.timestamp {
            panic_with_error!(&env, NavError::Invalid);
        }
        let moved = (price - last.price).abs();
        if moved * 10_000 > last.price * c.max_move_bps as i128 {
            panic_with_error!(&env, NavError::Move);
        }
        let elapsed = timestamp - last.timestamp;
        let deviated = moved * 10_000 >= last.price * DEVIATION_BPS;
        if elapsed < MIN_INTERVAL_FLOOR || (elapsed < c.min_interval && !deviated) {
            panic_with_error!(&env, NavError::Cadence);
        }
        h.push_back(PriceData { price, timestamp });
        while h.len() > HISTORY {
            h.pop_front();
        }
        env.storage().instance().set(&Key::History, &h);
    }

    // ---------------------------------------------------------------- administration

    pub fn config(env: Env) -> Config {
        config(&env)
    }
    pub fn set_publisher(env: Env, publisher: Address) {
        let mut c = config(&env);
        c.admin.require_auth();
        c.publisher = publisher;
        env.storage().instance().set(&Key::Config, &c);
    }
    pub fn set_min_interval(env: Env, secs: u64) {
        let mut c = config(&env);
        c.admin.require_auth();
        check_interval(&env, secs);
        c.min_interval = secs;
        c.resolution = secs as u32;
        env.storage().instance().set(&Key::Config, &c);
    }
    pub fn set_max_move_bps(env: Env, bps: u32) {
        let mut c = config(&env);
        c.admin.require_auth();
        check_move(&env, bps);
        c.max_move_bps = bps;
        env.storage().instance().set(&Key::Config, &c);
    }

    // ---------------------------------------------------------------- governance

    pub fn propose_admin(env: Env, new_admin: Address) {
        governance::propose_admin(&env, &config(&env).admin, &new_admin);
    }
    pub fn accept_admin(env: Env) {
        let mut c = config(&env);
        c.admin = governance::accept_admin(&env);
        env.storage().instance().set(&Key::Config, &c);
    }
    pub fn cancel_admin_transfer(env: Env) {
        governance::cancel_admin_transfer(&env, &config(&env).admin);
    }
    pub fn pending_admin(env: Env) -> Option<Address> {
        governance::pending_admin(&env)
    }
    pub fn schedule_upgrade(env: Env, wasm_hash: BytesN<32>) -> u64 {
        governance::schedule_upgrade(&env, &config(&env).admin, wasm_hash)
    }
    pub fn apply_upgrade(env: Env) {
        governance::apply_upgrade(&env, &config(&env).admin);
    }
    pub fn cancel_upgrade(env: Env) {
        governance::cancel_upgrade(&env, &config(&env).admin);
    }
    pub fn pending_upgrade(env: Env) -> Option<governance::PendingUpgrade> {
        governance::pending_upgrade(&env)
    }
    pub fn timelock(env: Env) -> u64 {
        governance::timelock(&env)
    }
    pub fn set_timelock(env: Env, secs: u64) {
        governance::set_timelock(&env, &config(&env).admin, secs);
    }
    pub fn code_hash(env: Env) -> BytesN<32> {
        governance::code_hash(&env)
    }
    pub fn version(env: Env) -> soroban_sdk::String {
        soroban_sdk::String::from_str(&env, "spield-ustry-nav-0.1.0")
    }
}

#[cfg(test)]
mod test;
