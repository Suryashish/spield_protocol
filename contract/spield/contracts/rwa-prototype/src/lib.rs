#![no_std]
//! Isolated accounting experiment. No Blend dependency, USDC conversion, issuer
//! redemption or production approval. Receipts and PT/YT are INTERNAL LEDGERS,
//! not SEP-41 tokens. All actual transfers use a 7-decimal backing token.
//!
//! USD face uses 7 decimals; price is USD/token at 8 decimals. An inverse
//! high-water NAV factor allocates fixed token units between PT and YT. Losses
//! reduce their USD value: there is deliberately no dollar principal guarantee.
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error, token,
    Address, Env, Symbol, Vec,
};
use spield_shared::math::{mul_div_ceil, mul_div_floor};

pub const PRICE_SCALE: i128 = 100_000_000;
pub const FACTOR_SCALE: i128 = 1_000_000_000_000_000_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RwaError {
    Config = 1,
    Amount = 2,
    Balance = 3,
    Expired = 4,
    NotExpired = 5,
    OracleIdentity = 6,
    OraclePrice = 7,
    OracleFuture = 8,
    OracleStale = 9,
    OracleHistory = 10,
    MaturityPending = 11,
    Drawdown = 12,
    Slippage = 13,
    Math = 14,
    Insolvent = 15,
}

// Wire-compatible with the separate mock oracle. A real provider needs an
// adapter implementing this history/identity interface; changing an address alone
// does NOT make the current RedStone SEP-40 feed compatible.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Observation {
    pub price: i128,
    pub timestamp: u64,
}

#[contractclient(name = "OracleClient")]
pub trait Oracle {
    fn asset(env: Env) -> Address;
    fn base(env: Env) -> Symbol;
    fn decimals(env: Env) -> u32;
    fn observations(env: Env) -> Vec<Observation>;
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub asset: Address,
    pub oracle: Address,
    pub expiry: u64,
    pub max_age: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct State {
    pub high_water: i128,
    pub factor: i128,
    pub cursor: u32,
    pub last_observation: Observation,
    pub finalized: bool,
    pub receipts: i128,
    pub face: i128,
    pub backing: i128,
}

#[contracttype]
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Holding {
    pub receipt: i128,
    pub pt: i128,
    pub yt: i128,
    pub factor: i128,
    pub accrued: i128,
}

#[contracttype]
#[derive(Clone)]
enum Key {
    Config,
    State,
    Holding(Address),
}

#[contract]
pub struct RwaSeries;

#[contractimpl]
impl RwaSeries {
    pub fn __constructor(env: Env, asset: Address, oracle: Address, expiry: u64, max_age: u64) {
        if expiry <= env.ledger().timestamp() || max_age == 0 {
            panic_with_error!(&env, RwaError::Config);
        }
        if token::Client::new(&env, &asset).decimals() != 7 {
            panic_with_error!(&env, RwaError::Config);
        }
        let cfg = Config {
            asset,
            oracle,
            expiry,
            max_age,
        };
        let history = read_history(&env, &cfg);
        let last = history.last().unwrap();
        fresh(&env, &last, env.ledger().timestamp(), max_age);
        let state = State {
            high_water: last.price,
            factor: inverse(&env, last.price),
            cursor: history.len(),
            last_observation: last,
            finalized: false,
            receipts: 0,
            face: 0,
            backing: 0,
        };
        env.storage().instance().set(&Key::Config, &cfg);
        save_state(&env, &state);
    }

    /// Accept token units into 1:1 unsplit receipts; no price is needed. Even
    /// during an oracle outage these receipts can be withdrawn in kind.
    pub fn deposit(env: Env, owner: Address, amount: i128) {
        owner.require_auth();
        positive(&env, amount);
        let cfg = config(&env);
        if env.ledger().timestamp() >= cfg.expiry {
            panic_with_error!(&env, RwaError::Expired);
        }
        let mut state = Self::state(env.clone());
        let mut h = holding(&env, &owner);
        h.receipt = add(&env, h.receipt, amount);
        state.receipts = add(&env, state.receipts, amount);
        token::Client::new(&env, &cfg.asset).transfer(
            &owner,
            env.current_contract_address(),
            &amount,
        );
        save_holding(&env, &owner, &h);
        save_state(&env, &state);
        assert_custody(&env, &cfg, &state);
    }

    pub fn withdraw_receipts(env: Env, owner: Address, amount: i128) {
        owner.require_auth();
        positive(&env, amount);
        let cfg = config(&env);
        let mut state = Self::state(env.clone());
        let mut h = holding(&env, &owner);
        h.receipt = sub(&env, h.receipt, amount);
        state.receipts = sub(&env, state.receipts, amount);
        save_holding(&env, &owner, &h);
        save_state(&env, &state);
        token::Client::new(&env, &cfg.asset).transfer(
            &env.current_contract_address(),
            &owner,
            &amount,
        );
        assert_custody(&env, &cfg, &state);
    }

    /// Convert receipt token units into equal PT and YT USD face. New exposure is
    /// refused in a drawdown; recovery below the high-water mark creates no yield.
    pub fn split(env: Env, owner: Address, amount: i128, min_face: i128) -> i128 {
        owner.require_auth();
        positive(&env, amount);
        if min_face < 0 {
            panic_with_error!(&env, RwaError::Amount);
        }
        let cfg = config(&env);
        if env.ledger().timestamp() >= cfg.expiry {
            panic_with_error!(&env, RwaError::Expired);
        }
        let mut state = synchronize(&env, &cfg, Self::state(env.clone()));
        if state.last_observation.price < state.high_water {
            panic_with_error!(&env, RwaError::Drawdown);
        }
        let face = floor(&env, amount, FACTOR_SCALE, state.factor);
        positive(&env, face);
        if face < min_face {
            panic_with_error!(&env, RwaError::Slippage);
        }
        let mut h = holding(&env, &owner);
        settle(&env, &mut h, state.factor);
        h.receipt = sub(&env, h.receipt, amount);
        h.pt = add(&env, h.pt, face);
        h.yt = add(&env, h.yt, face);
        state.receipts = sub(&env, state.receipts, amount);
        state.face = add(&env, state.face, face);
        state.backing = add(&env, state.backing, amount);
        save_holding(&env, &owner, &h);
        save_state(&env, &state);
        assert_custody(&env, &cfg, &state);
        face
    }

    /// Settle before transferring YT so prior earnings stay with the seller.
    pub fn transfer_yt(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        positive(&env, amount);
        let cfg = config(&env);
        let state = synchronize(&env, &cfg, Self::state(env.clone()));
        let mut a = holding(&env, &from);
        settle(&env, &mut a, state.factor);
        if a.yt < amount {
            panic_with_error!(&env, RwaError::Balance);
        }
        if from != to {
            let mut b = holding(&env, &to);
            settle(&env, &mut b, state.factor);
            a.yt -= amount;
            b.yt = add(&env, b.yt, amount);
            save_holding(&env, &to, &b);
        }
        save_holding(&env, &from, &a);
        save_state(&env, &state);
    }

    pub fn transfer_pt(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        positive(&env, amount);
        let mut a = holding(&env, &from);
        if a.pt < amount {
            panic_with_error!(&env, RwaError::Balance);
        }
        if from != to {
            let mut b = holding(&env, &to);
            a.pt -= amount;
            b.pt = add(&env, b.pt, amount);
            save_holding(&env, &to, &b);
        }
        save_holding(&env, &from, &a);
    }

    /// Before expiry burns matching PT/YT; after finalization only PT is needed.
    /// Pays token units, not dollars. The high-water allocation is NOT a floor
    /// on the USD value of those units when NAV falls.
    pub fn redeem(env: Env, owner: Address, face: i128, min_tokens: i128) -> i128 {
        owner.require_auth();
        positive(&env, face);
        if min_tokens < 0 {
            panic_with_error!(&env, RwaError::Amount);
        }
        let cfg = config(&env);
        let mut state = synchronize(&env, &cfg, Self::state(env.clone()));
        let mut h = holding(&env, &owner);
        settle(&env, &mut h, state.factor);
        h.pt = sub(&env, h.pt, face);
        if !state.finalized {
            h.yt = sub(&env, h.yt, face);
        }
        let paid = floor(&env, face, state.factor, FACTOR_SCALE);
        positive(&env, paid);
        if paid < min_tokens {
            panic_with_error!(&env, RwaError::Slippage);
        }
        state.face = sub(&env, state.face, face);
        state.backing = sub(&env, state.backing, paid);
        save_holding(&env, &owner, &h);
        save_state(&env, &state);
        token::Client::new(&env, &cfg.asset).transfer(
            &env.current_contract_address(),
            &owner,
            &paid,
        );
        assert_custody(&env, &cfg, &state);
        paid
    }

    pub fn claim_yield(env: Env, owner: Address) -> i128 {
        owner.require_auth();
        let cfg = config(&env);
        let mut state = synchronize(&env, &cfg, Self::state(env.clone()));
        let mut h = holding(&env, &owner);
        settle(&env, &mut h, state.factor);
        let paid = h.accrued;
        h.accrued = 0;
        state.backing = sub(&env, state.backing, paid);
        save_holding(&env, &owner, &h);
        save_state(&env, &state);
        if paid > 0 {
            token::Client::new(&env, &cfg.asset).transfer(
                &env.current_contract_address(),
                &owner,
                &paid,
            );
        }
        assert_custody(&env, &cfg, &state);
        paid
    }

    pub fn sync(env: Env) -> State {
        let state = synchronize(&env, &config(&env), Self::state(env.clone()));
        save_state(&env, &state);
        state
    }

    /// Permissionless. Requires append-only history reaching at least expiry,
    /// plus a fresh-enough last observation at/before expiry. No interpolation.
    pub fn finalize(env: Env) -> State {
        let cfg = config(&env);
        if env.ledger().timestamp() < cfg.expiry {
            panic_with_error!(&env, RwaError::NotExpired);
        }
        Self::sync(env)
    }

    /// Stored snapshot, NOT an assertion that its last price is currently fresh.
    pub fn state(env: Env) -> State {
        env.storage().instance().get(&Key::State).unwrap()
    }

    pub fn balance(env: Env, owner: Address) -> Holding {
        holding(&env, &owner)
    }

    /// Explicit USD valuation of token quantity using the current fresh price.
    /// Remains distinct from nominal PT face and the high-water accrual index.
    pub fn value_usd(env: Env, amount: i128) -> i128 {
        if amount < 0 {
            panic_with_error!(&env, RwaError::Amount);
        }
        let cfg = config(&env);
        let last = read_history(&env, &cfg).last().unwrap();
        fresh(&env, &last, env.ledger().timestamp(), cfg.max_age);
        floor(&env, amount, last.price, PRICE_SCALE)
    }
}

fn config(env: &Env) -> Config {
    env.storage().instance().get(&Key::Config).unwrap()
}

fn floor(env: &Env, a: i128, b: i128, d: i128) -> i128 {
    mul_div_floor(env, a, b, d).unwrap_or_else(|_| panic_with_error!(env, RwaError::Math))
}

fn inverse(env: &Env, price: i128) -> i128 {
    let factor = mul_div_ceil(env, PRICE_SCALE, FACTOR_SCALE, price)
        .unwrap_or_else(|_| panic_with_error!(env, RwaError::Math));
    positive(env, factor);
    factor
}

fn add(env: &Env, a: i128, b: i128) -> i128 {
    a.checked_add(b)
        .unwrap_or_else(|| panic_with_error!(env, RwaError::Math))
}

fn sub(env: &Env, a: i128, b: i128) -> i128 {
    if b < 0 || a < b {
        panic_with_error!(env, RwaError::Balance);
    }
    a - b
}

fn positive(env: &Env, amount: i128) {
    if amount <= 0 {
        panic_with_error!(env, RwaError::Amount);
    }
}

fn holding(env: &Env, owner: &Address) -> Holding {
    let key = Key::Holding(owner.clone());
    let h = env.storage().persistent().get(&key).unwrap_or_default();
    if env.storage().persistent().has(&key) {
        env.storage().persistent().extend_ttl(&key, 10_000, 100_000);
    }
    h
}

fn save_holding(env: &Env, owner: &Address, h: &Holding) {
    let key = Key::Holding(owner.clone());
    env.storage().persistent().set(&key, h);
    env.storage().persistent().extend_ttl(&key, 10_000, 100_000);
}

fn save_state(env: &Env, state: &State) {
    env.storage().instance().set(&Key::State, state);
    env.storage().instance().extend_ttl(10_000, 100_000);
}

fn settle(env: &Env, h: &mut Holding, factor: i128) {
    if h.factor != 0 {
        if factor > h.factor {
            panic_with_error!(env, RwaError::OracleHistory);
        }
        h.accrued = add(
            env,
            h.accrued,
            floor(env, h.yt, h.factor - factor, FACTOR_SCALE),
        );
    }
    h.factor = factor;
}

fn read_history(env: &Env, cfg: &Config) -> Vec<Observation> {
    let oracle = OracleClient::new(env, &cfg.oracle);
    if oracle.asset() != cfg.asset
        || oracle.base() != Symbol::new(env, "USD")
        || oracle.decimals() != 8
    {
        panic_with_error!(env, RwaError::OracleIdentity);
    }
    let history = oracle.observations();
    if history.is_empty() || history.len() > 256 {
        panic_with_error!(env, RwaError::OracleHistory);
    }
    let mut prev = None;
    for p in history.iter() {
        if p.price <= 0 {
            panic_with_error!(env, RwaError::OraclePrice);
        }
        if p.timestamp > env.ledger().timestamp() {
            panic_with_error!(env, RwaError::OracleFuture);
        }
        if let Some(t) = prev {
            if p.timestamp <= t {
                panic_with_error!(env, RwaError::OracleHistory);
            }
        }
        prev = Some(p.timestamp);
    }
    history
}

fn fresh(env: &Env, p: &Observation, at: u64, max_age: u64) {
    if p.timestamp > at {
        panic_with_error!(env, RwaError::OracleFuture);
    }
    if at - p.timestamp > max_age {
        panic_with_error!(env, RwaError::OracleStale);
    }
}

fn synchronize(env: &Env, cfg: &Config, mut state: State) -> State {
    if state.finalized {
        return state;
    } // Frozen token allocations need no live oracle.
    let history = read_history(env, cfg);
    if history.len() < state.cursor {
        panic_with_error!(env, RwaError::OracleHistory);
    }
    // Detect a changed previously accepted record as well as truncated history.
    if history.get(state.cursor - 1).unwrap() != state.last_observation {
        panic_with_error!(env, RwaError::OracleHistory);
    }
    let matured = env.ledger().timestamp() >= cfg.expiry;
    let last = history.last().unwrap();
    if matured {
        if last.timestamp < cfg.expiry {
            panic_with_error!(env, RwaError::MaturityPending);
        }
    } else {
        fresh(env, &last, env.ledger().timestamp(), cfg.max_age);
    }
    for i in state.cursor..history.len() {
        let p = history.get(i).unwrap();
        if p.timestamp > cfg.expiry {
            break;
        }
        if p.price > state.high_water {
            state.high_water = p.price;
            state.factor = inverse(env, p.price);
        }
        state.last_observation = p;
        state.cursor = i + 1;
    }
    if matured {
        fresh(env, &state.last_observation, cfg.expiry, cfg.max_age);
        state.finalized = true;
    }
    state
}

fn assert_custody(env: &Env, cfg: &Config, state: &State) {
    if token::Client::new(env, &cfg.asset).balance(&env.current_contract_address())
        < add(env, state.receipts, state.backing)
    {
        panic_with_error!(env, RwaError::Insolvent);
    }
}

#[cfg(test)]
mod test;
