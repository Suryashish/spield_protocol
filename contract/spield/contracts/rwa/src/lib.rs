#![no_std]
//! Testnet USTRY accounting; USD face is not a principal guarantee.
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
    Binding = 16,
    Paused = 17,
    Cap = 18,
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
    pub admin: Address,
    pub tokens: Vec<Address>,
    pub paused: bool,
    pub asset: Address,
    pub oracle: Address,
    pub expiry: u64,
    pub max_age: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct State {
    pub total_yt: i128,
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
pub struct UstrySeries;

#[contracttype]
#[derive(Clone)]
pub struct TokenSet {
    pub receipt: Address,
    pub pt: Address,
    pub yt: Address,
}

#[contractclient(name = "ClaimTokenClient")]
pub trait ClaimToken {
    fn series(env: Env) -> Address;
    fn kind(env: Env) -> u32;
    fn decimals(env: Env) -> u32;
    fn transfer(env: Env, from: Address, to: Address, amount: i128);
    fn issued(env: Env, owner: Address, amount: i128, mint: bool);
}

#[contractimpl]
impl UstrySeries {
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset: Address,
        oracle: Address,
        expiry: u64,
        max_age: u64,
    ) {
        if expiry <= env.ledger().timestamp() || max_age == 0 {
            panic_with_error!(&env, RwaError::Config);
        }
        if token::Client::new(&env, &asset).decimals() != 7 {
            panic_with_error!(&env, RwaError::Config);
        }
        let cfg = Config {
            admin,
            tokens: Vec::new(&env),
            paused: false,
            asset,
            oracle,
            expiry,
            max_age,
        };
        let history = read_history(&env, &cfg);
        let last = history.last().unwrap();
        fresh(&env, &last, env.ledger().timestamp(), max_age);
        let state = State {
            total_yt: 0,
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

    pub fn config(env: Env) -> Config {
        config(&env)
    }

    pub fn bind_tokens(env: Env, receipt: Address, pt: Address, yt: Address) {
        let mut cfg = config(&env);
        cfg.admin.require_auth();
        if !cfg.tokens.is_empty() || receipt == pt || receipt == yt || pt == yt {
            panic_with_error!(&env, RwaError::Binding);
        }
        for (kind, address) in [(0, &receipt), (1, &pt), (2, &yt)] {
            let t = ClaimTokenClient::new(&env, address);
            if t.series() != env.current_contract_address() || t.kind() != kind || t.decimals() != 7
            {
                panic_with_error!(&env, RwaError::Binding);
            }
        }
        cfg.tokens = soroban_sdk::vec![&env, receipt, pt, yt];
        env.storage().instance().set(&Key::Config, &cfg);
    }

    pub fn set_paused(env: Env, paused: bool) {
        let mut cfg = config(&env);
        cfg.admin.require_auth();
        cfg.paused = paused;
        env.storage().instance().set(&Key::Config, &cfg);
    }

    pub fn deposit_split(env: Env, owner: Address, amount: i128, min_face: i128) -> i128 {
        owner.require_auth();
        deposit_inner(env.clone(), owner.clone(), amount);
        split_inner(env, owner, amount, min_face)
    }

    pub fn claim_balance(env: Env, owner: Address, kind: u32) -> i128 {
        let h = holding(&env, &owner);
        match kind {
            0 => h.receipt,
            1 => h.pt,
            2 => h.yt,
            _ => panic_with_error!(&env, RwaError::Binding),
        }
    }

    pub fn claim_supply(env: Env, kind: u32) -> i128 {
        let s = Self::state(env.clone());
        match kind {
            0 => s.receipts,
            1 => s.face,
            2 => s.total_yt,
            _ => panic_with_error!(&env, RwaError::Binding),
        }
    }

    // Only the immutable, bound token facade may use delegated allowances.
    pub fn transfer_claim(env: Env, from: Address, to: Address, amount: i128, kind: u32) {
        let cfg = config(&env);
        bound(&env, &cfg, kind).require_auth();
        if amount < 0 {
            panic_with_error!(&env, RwaError::Amount);
        }
        let mut state = Self::state(env.clone());
        let mut a = holding(&env, &from);
        let mut b = holding(&env, &to);
        if kind == 2 {
            state = synchronize(&env, &cfg, state);
            settle(&env, &mut a, state.factor);
            settle(&env, &mut b, state.factor);
        }
        let available = match kind {
            0 => a.receipt,
            1 => a.pt,
            _ => a.yt,
        };
        if available < amount {
            panic_with_error!(&env, RwaError::Balance);
        }
        if from != to {
            match kind {
                0 => {
                    a.receipt -= amount;
                    b.receipt = add(&env, b.receipt, amount);
                }
                1 => {
                    a.pt -= amount;
                    b.pt = add(&env, b.pt, amount);
                }
                _ => {
                    a.yt -= amount;
                    b.yt = add(&env, b.yt, amount);
                }
            }
            save_holding(&env, &to, &b);
        }
        save_holding(&env, &from, &a);
        save_state(&env, &state);
    }

    /// Voluntary token burn abandons the right; credited past yield stays claimable.
    pub fn burn_claim(env: Env, from: Address, amount: i128, kind: u32) {
        let cfg = config(&env);
        bound(&env, &cfg, kind).require_auth();
        if amount < 0 {
            panic_with_error!(&env, RwaError::Amount);
        }
        let mut state = Self::state(env.clone());
        let mut h = holding(&env, &from);
        match kind {
            0 => {
                h.receipt = sub(&env, h.receipt, amount);
                state.receipts = sub(&env, state.receipts, amount);
            }
            1 => {
                h.pt = sub(&env, h.pt, amount);
                state.face = sub(&env, state.face, amount);
            }
            _ => {
                state = synchronize(&env, &cfg, state);
                settle(&env, &mut h, state.factor);
                h.yt = sub(&env, h.yt, amount);
                state.total_yt = sub(&env, state.total_yt, amount);
            }
        }
        save_holding(&env, &from, &h);
        save_state(&env, &state);
    }

    /// Accept token units into 1:1 unsplit receipts; no price is needed. Even
    /// during an oracle outage these receipts can be withdrawn in kind.
    pub fn deposit(env: Env, owner: Address, amount: i128) {
        owner.require_auth();
        deposit_inner(env, owner, amount)
    }

    pub fn withdraw_receipts(env: Env, owner: Address, amount: i128) {
        owner.require_auth();
        positive(&env, amount);
        let cfg = config(&env);
        let mut state = Self::state(env.clone());
        let mut h = holding(&env, &owner);
        h.receipt = sub(&env, h.receipt, amount);
        issued(&env, &cfg, 0, &owner, amount, false);
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
        split_inner(env, owner, amount, min_face)
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
            state.total_yt = sub(&env, state.total_yt, face);
            issued(&env, &cfg, 2, &owner, face, false);
        }
        let paid = floor(&env, face, state.factor, FACTOR_SCALE);
        positive(&env, paid);
        if paid < min_tokens {
            panic_with_error!(&env, RwaError::Slippage);
        }
        state.face = sub(&env, state.face, face);
        issued(&env, &cfg, 1, &owner, face, false);
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

fn bound(env: &Env, cfg: &Config, kind: u32) -> Address {
    if kind > 2 || cfg.tokens.len() != 3 {
        panic_with_error!(env, RwaError::Binding);
    }
    cfg.tokens.get(kind).unwrap()
}
fn issued(env: &Env, cfg: &Config, kind: u32, owner: &Address, amount: i128, mint: bool) {
    ClaimTokenClient::new(env, &bound(env, cfg, kind)).issued(owner, &amount, &mint);
}
fn exposure(env: &Env, cfg: &Config) {
    if cfg.paused {
        panic_with_error!(env, RwaError::Paused);
    }
    bound(env, cfg, 0);
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
        env.storage().persistent().extend_ttl(
            &key,
            env.storage().max_ttl().saturating_sub(17_280),
            env.storage().max_ttl(),
        );
    }
    h
}

fn save_holding(env: &Env, owner: &Address, h: &Holding) {
    let key = Key::Holding(owner.clone());
    env.storage().persistent().set(&key, h);
    env.storage().persistent().extend_ttl(
        &key,
        env.storage().max_ttl().saturating_sub(17_280),
        env.storage().max_ttl(),
    );
}

fn save_state(env: &Env, state: &State) {
    env.storage().instance().set(&Key::State, state);
    env.storage().instance().extend_ttl(
        env.storage().max_ttl().saturating_sub(17_280),
        env.storage().max_ttl(),
    );
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

fn deposit_inner(env: Env, owner: Address, amount: i128) {
    positive(&env, amount);
    let cfg = config(&env);
    if env.ledger().timestamp() >= cfg.expiry {
        panic_with_error!(&env, RwaError::Expired);
    }
    exposure(&env, &cfg);
    let mut state = UstrySeries::state(env.clone());
    if add(&env, add(&env, state.receipts, state.backing), amount) > 10_000_000_000 {
        panic_with_error!(&env, RwaError::Cap);
    }
    let mut h = holding(&env, &owner);
    h.receipt = add(&env, h.receipt, amount);
    issued(&env, &cfg, 0, &owner, amount, true);
    state.receipts = add(&env, state.receipts, amount);
    token::Client::new(&env, &cfg.asset).transfer(&owner, env.current_contract_address(), &amount);
    save_holding(&env, &owner, &h);
    save_state(&env, &state);
    assert_custody(&env, &cfg, &state);
}
fn split_inner(env: Env, owner: Address, amount: i128, min_face: i128) -> i128 {
    positive(&env, amount);
    if min_face < 0 {
        panic_with_error!(&env, RwaError::Amount);
    }
    let cfg = config(&env);
    if env.ledger().timestamp() >= cfg.expiry {
        panic_with_error!(&env, RwaError::Expired);
    }
    exposure(&env, &cfg);
    let mut state = synchronize(&env, &cfg, UstrySeries::state(env.clone()));
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
    state.total_yt = add(&env, state.total_yt, face);
    issued(&env, &cfg, 0, &owner, amount, false);
    issued(&env, &cfg, 1, &owner, face, true);
    issued(&env, &cfg, 2, &owner, face, true);
    state.backing = add(&env, state.backing, amount);
    save_holding(&env, &owner, &h);
    save_state(&env, &state);
    assert_custody(&env, &cfg, &state);
    face
}
