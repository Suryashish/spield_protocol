#![no_std]
//! # spield-ustry-series — USTRY principal/yield split on any SEP-40 NAV feed
//!
//! Deposit USTRY, receive unsplit receipts (sUSTRY) or split them into equal USD-face PT and YT.
//! PT holds a token allocation fixed at the high-water NAV; YT earns the USTRY freed when NAV
//! rises above its previous high. Payouts are USTRY units — **USD face is not a principal
//! guarantee**.
//!
//! ## The four Series 1 failure modes, and what replaces them
//!
//! | Series 1 (`spield-rwa`) | here |
//! |---|---|
//! | Read a custom `observations()` history, so only Spield's relay could feed it | Reads the standard **SEP-40** interface. Testnet: `spield-ustry-nav`. Mainnet: RedStone's wrapper. Same code. |
//! | Every priced action — combine, claim, YT transfer — reverted once NAV was 13h old | Only **new exposure** reads the feed. Exits (combine, claim, YT transfer/burn, receipts) **never call the oracle**: they use the state last folded by `sync()` or a deposit. A feed that errors, traps or burns the whole budget cannot touch them. |
//! | Finalization needed a fresh pre-expiry sample; one late relay locked PT/YT for ever | Finalizes on a **post-expiry sample**, or after a **grace period** without calling the oracle at all. No feed behaviour can brick it. |
//! | Any accepted price moved the high-water mark | High-water may rise at most `max_apr_bps` per year, measured **linearly from the seed** (not compounded per sample), like Blend's strategy rate bound. A spiked or compromised feed cannot move USTRY from PT to YT faster than that. |
//!
//! It also adopts Blend-v2 operations: configurable cap, two-step admin rotation, and
//! upgrades behind the shared 24h-minimum timelock.
//!
//! ## Why exits on the stored state are safe
//! A combine burns `face` PT and `face` YT and pays `face·f + face·(f_entry − f) = face·f_entry`
//! — independent of the current factor `f`. Folding fewer prices changes only how that payout is
//! labelled (principal vs yield), never its size or anyone else's. A `claim_yield` on an unfolded
//! state pays less now and the rest after the next `sync()`. A YT transfer on an unfolded state
//! hands not-yet-folded yield to the buyer — a price the two parties agree between themselves.
//! Anyone, including the relay, may call `sync()` to keep the stored state current.
//!
//! ## Solvency invariant
//! `USTRY held >= receipts + backing`, asserted after every value-moving call.
use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, token, Address, BytesN, Env, Symbol, Vec,
};
use spield_shared::{
    governance,
    math::{mul_div_ceil, mul_div_floor},
};

pub const PRICE_SCALE: i128 = 100_000_000;
pub const FACTOR_SCALE: i128 = 1_000_000_000_000_000_000;
const PRICE_DECIMALS: u32 = 8;
const YEAR: i128 = 365 * 24 * 3600;
const TTL_LO: u32 = 30 * 17_280;
/// Feed timestamps may lead the ledger clock by this much (packages are signed off-chain).
const MAX_SKEW: u64 = 60;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum SeriesError {
    Config = 1,
    Amount = 2,
    Balance = 3,
    Expired = 4,
    NotExpired = 5,
    OracleUnavailable = 6,
    OracleStale = 7,
    MaturityPending = 8,
    Drawdown = 9,
    Slippage = 10,
    Math = 11,
    Insolvent = 12,
    Binding = 13,
    Paused = 14,
    Cap = 15,
    NotFinalized = 16,
}

// ------------------------------------------------------------------ SEP-40 client

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

#[contractclient(name = "Sep40Client")]
pub trait Sep40 {
    fn base(env: Env) -> Asset;
    fn decimals(env: Env) -> u32;
    fn prices(env: Env, asset: Asset, records: u32) -> Option<Vec<PriceData>>;
}

#[contractclient(name = "ClaimTokenClient")]
pub trait ClaimToken {
    fn series(env: Env) -> Address;
    fn kind(env: Env) -> u32;
    fn decimals(env: Env) -> u32;
    fn issued(env: Env, owner: Address, amount: i128, mint: bool);
}

// ------------------------------------------------------------------ storage types

/// Construction parameters, bounded in [`__constructor`](UstrySeries::__constructor).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Params {
    /// Oldest NAV accepted for **new exposure**, seconds. 1h … 48h.
    pub max_age: u64,
    /// After expiry, finalization without a post-expiry sample waits this long. 1 … 90 days.
    pub grace: u64,
    /// Maximum high-water growth per year of observation time, bps. 1 … 10,000.
    pub max_apr_bps: u32,
    /// Ceiling on `receipts + backing`, token units.
    pub cap: i128,
    /// Records requested per fold. 2 … 32.
    pub window: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub tokens: Vec<Address>,
    pub paused: bool,
    pub asset: Address,
    pub oracle: Address,
    pub expiry: u64,
    pub max_age: u64,
    pub grace: u64,
    pub max_apr_bps: u32,
    pub cap: i128,
    pub window: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct State {
    pub total_yt: i128,
    pub high_water: i128,
    pub factor: i128,
    /// Newest folded sample at or before expiry. Its timestamp is the fold cursor.
    pub last_observation: PriceData,
    /// Seed sample. The rate bound is linear from here: `anchor·(1 + max_apr·(t − t0)/year)`.
    pub anchor: PriceData,
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

/// Read-only health snapshot for the app. `entry_open` is exactly what `split` will check.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Status {
    pub state: State,
    pub oracle_ok: bool,
    pub fresh: bool,
    pub entry_open: bool,
    pub boundary_seen: bool,
    pub finalizable: bool,
    /// The stored state already includes every foldable sample. When false, a `sync()` before
    /// `claim_yield` pays the yield the feed has already published.
    pub synced: bool,
}

#[contracttype]
#[derive(Clone)]
enum Key {
    Config,
    State,
    Holding(Address),
}

#[contractevent]
#[derive(Clone)]
pub struct Finalized {
    pub high_water: i128,
    pub factor: i128,
    pub boundary: bool,
}

#[contract]
pub struct UstrySeries;

// ------------------------------------------------------------------ the fold

struct Fold {
    state: State,
    boundary: bool,
}

/// Fold every new sample at or before expiry into the high-water mark.
///
/// `Err` means the feed could not be trusted this call: unreachable, wrong base or decimals,
/// empty, out of order, non-positive or future-dated. Callers decide what that means —
/// new exposure refuses, exits keep the stored state.
fn fold(env: &Env, cfg: &Config, mut state: State) -> Result<Fold, SeriesError> {
    let client = Sep40Client::new(env, &cfg.oracle);
    let usd = Asset::Other(Symbol::new(env, "USD"));
    match client.try_base() {
        Ok(Ok(b)) if b == usd => {}
        _ => return Err(SeriesError::OracleUnavailable),
    }
    match client.try_decimals() {
        Ok(Ok(PRICE_DECIMALS)) => {}
        _ => return Err(SeriesError::OracleUnavailable),
    }
    let records = match client.try_prices(&Asset::Stellar(cfg.asset.clone()), &cfg.window) {
        Ok(Ok(Some(r))) if !r.is_empty() => r,
        _ => return Err(SeriesError::OracleUnavailable),
    };
    let n = records.len();
    // A feed that ignores `records` is not trusted with an unbounded loop.
    if n > cfg.window {
        return Err(SeriesError::OracleUnavailable);
    }
    // SEP-40 does not fix the order. Accept strictly monotonic either way; anything else is
    // not a history and is rejected whole rather than half-applied.
    let descending = n > 1 && records.get(0).unwrap().timestamp > records.get(n - 1).unwrap().timestamp;
    let now = env.ledger().timestamp();
    let mut prev: Option<u64> = None;
    let mut boundary = false;
    for i in 0..n {
        let p = records.get(if descending { n - 1 - i } else { i }).unwrap();
        if p.price <= 0 || p.timestamp > now + MAX_SKEW || prev.is_some_and(|t| p.timestamp <= t) {
            return Err(SeriesError::OracleUnavailable);
        }
        prev = Some(p.timestamp);
        if p.timestamp >= cfg.expiry {
            boundary = true;
        }
        if p.timestamp > cfg.expiry || p.timestamp <= state.last_observation.timestamp {
            continue;
        }
        if p.price > state.high_water {
            let cap = rate_cap(env, cfg, &state.anchor, p.timestamp)?;
            let next = if p.price < cap { p.price } else { cap };
            if next > state.high_water {
                state.high_water = next;
                state.factor = inverse(env, next)?;
            }
        }
        state.last_observation = p;
    }
    Ok(Fold { state, boundary })
}

/// `anchor · (1 + max_apr · (t − t_anchor) / year)`. Linear in observation time from the seed,
/// so the bound is the true annual limit however many samples arrive (a per-sample cap compounds).
fn rate_cap(env: &Env, cfg: &Config, anchor: &PriceData, at: u64) -> Result<i128, SeriesError> {
    let dt = at.saturating_sub(anchor.timestamp) as i128;
    let growth = mul_div_floor(env, anchor.price, cfg.max_apr_bps as i128 * dt, 10_000 * YEAR)
        .map_err(|_| SeriesError::Math)?;
    anchor.price.checked_add(growth).ok_or(SeriesError::Math)
}

fn inverse(env: &Env, price: i128) -> Result<i128, SeriesError> {
    let f = mul_div_ceil(env, PRICE_SCALE, FACTOR_SCALE, price).map_err(|_| SeriesError::Math)?;
    if f <= 0 {
        return Err(SeriesError::Math);
    }
    Ok(f)
}

/// `sync()`: fold if the feed cooperates, otherwise keep what is stored. Exits do not use this —
/// even a `try_` call cannot survive a feed that exhausts the budget.
fn best_effort(env: &Env, cfg: &Config, state: State) -> State {
    if state.finalized {
        return state;
    }
    match fold(env, cfg, state.clone()) {
        Ok(f) => f.state,
        Err(_) => state,
    }
}

/// New exposure: fresh, non-drawdown NAV or nothing.
fn strict(env: &Env, cfg: &Config, state: State) -> State {
    let f = fold(env, cfg, state).unwrap_or_else(|e| panic_with_error!(env, e));
    if !fresh(env, cfg, &f.state) {
        panic_with_error!(env, SeriesError::OracleStale);
    }
    if f.state.last_observation.price < f.state.high_water {
        panic_with_error!(env, SeriesError::Drawdown);
    }
    f.state
}

fn fresh(env: &Env, cfg: &Config, s: &State) -> bool {
    let now = env.ledger().timestamp();
    s.last_observation.timestamp <= now + MAX_SKEW
        && now.saturating_sub(s.last_observation.timestamp) <= cfg.max_age
}

#[contractimpl]
impl UstrySeries {
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset: Address,
        oracle: Address,
        expiry: u64,
        params: Params,
    ) {
        let now = env.ledger().timestamp();
        if expiry <= now
            || !(3_600..=172_800).contains(&params.max_age)
            || !(86_400..=7_776_000).contains(&params.grace)
            || !(1..=10_000).contains(&params.max_apr_bps)
            || params.cap <= 0
            || !(2..=32).contains(&params.window)
        {
            panic_with_error!(&env, SeriesError::Config);
        }
        if token::Client::new(&env, &asset).decimals() != 7 {
            panic_with_error!(&env, SeriesError::Config);
        }
        let cfg = Config {
            admin,
            tokens: Vec::new(&env),
            paused: false,
            asset,
            oracle,
            expiry,
            max_age: params.max_age,
            grace: params.grace,
            max_apr_bps: params.max_apr_bps,
            cap: params.cap,
            window: params.window,
        };
        // Seed from the newest sample. The constructor is strict: a series is never born on a
        // stale, unreachable or mis-specified feed.
        let seed = State {
            total_yt: 0,
            high_water: 0,
            factor: 0,
            last_observation: PriceData {
                price: 0,
                timestamp: 0,
            },
            anchor: PriceData {
                price: 0,
                timestamp: 0,
            },
            finalized: false,
            receipts: 0,
            face: 0,
            backing: 0,
        };
        let records = match Sep40Client::new(&env, &cfg.oracle)
            .try_prices(&Asset::Stellar(cfg.asset.clone()), &cfg.window)
        {
            Ok(Ok(Some(r))) if !r.is_empty() => r,
            _ => panic_with_error!(&env, SeriesError::OracleUnavailable),
        };
        let newest = records
            .iter()
            .max_by_key(|p| p.timestamp)
            .unwrap_or_else(|| panic_with_error!(&env, SeriesError::OracleUnavailable));
        let mut first = seed;
        first.high_water = newest.price;
        first.factor = inverse(&env, newest.price).unwrap_or_else(|e| panic_with_error!(&env, e));
        first.last_observation = PriceData {
            price: newest.price,
            timestamp: newest.timestamp.saturating_sub(1),
        };
        first.anchor = newest.clone();
        let state = fold(&env, &cfg, first).unwrap_or_else(|e| panic_with_error!(&env, e)).state;
        if !fresh(&env, &cfg, &state) || state.last_observation.timestamp >= expiry {
            panic_with_error!(&env, SeriesError::OracleStale);
        }
        env.storage().instance().set(&Key::Config, &cfg);
        save_state(&env, &state);
        governance::init(&env);
    }

    // ------------------------------------------------------------ configuration

    pub fn config(env: Env) -> Config {
        config(&env)
    }

    pub fn bind_tokens(env: Env, receipt: Address, pt: Address, yt: Address) {
        let mut cfg = config(&env);
        cfg.admin.require_auth();
        if !cfg.tokens.is_empty() || receipt == pt || receipt == yt || pt == yt {
            panic_with_error!(&env, SeriesError::Binding);
        }
        for (kind, address) in [(0, &receipt), (1, &pt), (2, &yt)] {
            let t = ClaimTokenClient::new(&env, address);
            if t.series() != env.current_contract_address() || t.kind() != kind || t.decimals() != 7
            {
                panic_with_error!(&env, SeriesError::Binding);
            }
        }
        cfg.tokens = soroban_sdk::vec![&env, receipt, pt, yt];
        env.storage().instance().set(&Key::Config, &cfg);
    }

    /// Pauses **new exposure only**. Every exit stays open, as on the Blend contracts.
    pub fn set_paused(env: Env, paused: bool) {
        let mut cfg = config(&env);
        cfg.admin.require_auth();
        cfg.paused = paused;
        env.storage().instance().set(&Key::Config, &cfg);
    }

    /// Gates deposits only; lowering it below current exposure blocks entry, never exit.
    pub fn set_cap(env: Env, cap: i128) {
        let mut cfg = config(&env);
        cfg.admin.require_auth();
        if cap <= 0 {
            panic_with_error!(&env, SeriesError::Config);
        }
        cfg.cap = cap;
        env.storage().instance().set(&Key::Config, &cfg);
    }

    // ------------------------------------------------------------ entry (strict NAV)

    /// Receipts need no price; they are refused only when paused, expired or over the cap.
    pub fn deposit(env: Env, owner: Address, amount: i128) {
        owner.require_auth();
        deposit_inner(&env, &owner, amount);
    }

    pub fn deposit_split(env: Env, owner: Address, amount: i128, min_face: i128) -> i128 {
        owner.require_auth();
        deposit_inner(&env, &owner, amount);
        split_inner(&env, &owner, amount, min_face)
    }

    pub fn split(env: Env, owner: Address, amount: i128, min_face: i128) -> i128 {
        owner.require_auth();
        split_inner(&env, &owner, amount, min_face)
    }

    // ------------------------------------------------------------ exits (never oracle-gated)

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

    /// Before finalization burns matching PT + YT (combine); after, PT alone. Pays token units.
    pub fn redeem(env: Env, owner: Address, face: i128, min_tokens: i128) -> i128 {
        owner.require_auth();
        positive(&env, face);
        if min_tokens < 0 {
            panic_with_error!(&env, SeriesError::Amount);
        }
        let cfg = config(&env);
        let mut state = Self::state(env.clone());
        let mut h = holding(&env, &owner);
        settle(&env, &mut h, state.factor);
        h.pt = sub(&env, h.pt, face);
        if !state.finalized {
            h.yt = sub(&env, h.yt, face);
            state.total_yt = sub(&env, state.total_yt, face);
            issued(&env, &cfg, 2, &owner, face, false);
        }
        // Dust can round to zero; the claims still burn, so no balance is left unredeemable.
        let paid = floor(&env, face, state.factor, FACTOR_SCALE);
        if paid < min_tokens {
            panic_with_error!(&env, SeriesError::Slippage);
        }
        state.face = sub(&env, state.face, face);
        issued(&env, &cfg, 1, &owner, face, false);
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

    pub fn claim_yield(env: Env, owner: Address) -> i128 {
        owner.require_auth();
        let cfg = config(&env);
        let mut state = Self::state(env.clone());
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

    // ------------------------------------------------------------ claim-token facade

    pub fn claim_balance(env: Env, owner: Address, kind: u32) -> i128 {
        let h = holding(&env, &owner);
        match kind {
            0 => h.receipt,
            1 => h.pt,
            2 => h.yt,
            _ => panic_with_error!(&env, SeriesError::Binding),
        }
    }

    pub fn claim_supply(env: Env, kind: u32) -> i128 {
        let s = Self::state(env.clone());
        match kind {
            0 => s.receipts,
            1 => s.face,
            2 => s.total_yt,
            _ => panic_with_error!(&env, SeriesError::Binding),
        }
    }

    /// Only the bound token contract may move claims (it carries the owner's auth or allowance).
    pub fn transfer_claim(env: Env, from: Address, to: Address, amount: i128, kind: u32) {
        let cfg = config(&env);
        bound(&env, &cfg, kind).require_auth();
        if amount < 0 {
            panic_with_error!(&env, SeriesError::Amount);
        }
        // A zero transfer needs no allowance at the facade; it must not touch the owner's state.
        if amount == 0 {
            return;
        }
        let state = Self::state(env.clone());
        let mut a = holding(&env, &from);
        let mut b = holding(&env, &to);
        if kind == 2 {
            settle(&env, &mut a, state.factor);
            settle(&env, &mut b, state.factor);
        }
        let available = match kind {
            0 => a.receipt,
            1 => a.pt,
            _ => a.yt,
        };
        if available < amount {
            panic_with_error!(&env, SeriesError::Balance);
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

    /// Voluntary burn abandons the right; yield credited before the burn stays claimable.
    pub fn burn_claim(env: Env, from: Address, amount: i128, kind: u32) {
        let cfg = config(&env);
        bound(&env, &cfg, kind).require_auth();
        if amount < 0 {
            panic_with_error!(&env, SeriesError::Amount);
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
                settle(&env, &mut h, state.factor);
                h.yt = sub(&env, h.yt, amount);
                state.total_yt = sub(&env, state.total_yt, amount);
            }
        }
        save_holding(&env, &from, &h);
        save_state(&env, &state);
    }

    // ------------------------------------------------------------ NAV and maturity

    /// Permissionless fold. Never reverts on a bad feed; returns the state it kept.
    pub fn sync(env: Env) -> State {
        let state = best_effort(&env, &config(&env), Self::state(env.clone()));
        save_state(&env, &state);
        state
    }

    /// Permissionless. Freezes PT/YT allocations once the series can prove it has seen every
    /// pre-expiry sample (a sample at/after expiry exists), or once `expiry + grace` has passed.
    /// Neither path needs the feed to be healthy at the time, so finalization cannot be bricked.
    pub fn finalize(env: Env) -> State {
        let cfg = config(&env);
        let stored = Self::state(env.clone());
        if stored.finalized {
            return stored;
        }
        let now = env.ledger().timestamp();
        if now < cfg.expiry {
            panic_with_error!(&env, SeriesError::NotExpired);
        }
        // After the grace period the oracle is not called at all, so no feed behaviour —
        // including one that exhausts the budget — can stop finalization.
        let (mut state, boundary) = if now >= cfg.expiry.saturating_add(cfg.grace) {
            (stored, false)
        } else {
            match fold(&env, &cfg, stored) {
                Ok(f) if f.boundary => (f.state, true),
                _ => panic_with_error!(&env, SeriesError::MaturityPending),
            }
        };
        state.finalized = true;
        save_state(&env, &state);
        Finalized {
            high_water: state.high_water,
            factor: state.factor,
            boundary,
        }
        .publish(&env);
        state
    }

    /// Stored snapshot. Does not assert that its last price is currently fresh — see [`status`].
    pub fn state(env: Env) -> State {
        env.storage().instance().get(&Key::State).unwrap()
    }

    /// What the next call would see, without writing. The app's single health read.
    pub fn status(env: Env) -> Status {
        let cfg = config(&env);
        let stored = Self::state(env.clone());
        let now = env.ledger().timestamp();
        let (state, oracle_ok, boundary) = if stored.finalized {
            (stored.clone(), true, true)
        } else {
            match fold(&env, &cfg, stored.clone()) {
                Ok(f) => (f.state, true, f.boundary),
                Err(_) => (stored.clone(), false, false),
            }
        };
        let synced = state == stored;
        let is_fresh = fresh(&env, &cfg, &state);
        let entry_open = oracle_ok
            && is_fresh
            && !cfg.paused
            && now < cfg.expiry
            && cfg.tokens.len() == 3
            && state.last_observation.price >= state.high_water;
        let finalizable = !state.finalized
            && now >= cfg.expiry
            && (boundary || now >= cfg.expiry.saturating_add(cfg.grace));
        Status {
            state,
            oracle_ok,
            fresh: is_fresh,
            entry_open,
            boundary_seen: boundary,
            finalizable,
            synced,
        }
    }

    pub fn balance(env: Env, owner: Address) -> Holding {
        holding(&env, &owner)
    }

    /// USD value of `amount` USTRY at the newest **fresh** sample.
    pub fn value_usd(env: Env, amount: i128) -> i128 {
        if amount < 0 {
            panic_with_error!(&env, SeriesError::Amount);
        }
        let cfg = config(&env);
        let f = fold(&env, &cfg, Self::state(env.clone()))
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        if !fresh(&env, &cfg, &f.state) {
            panic_with_error!(&env, SeriesError::OracleStale);
        }
        floor(&env, amount, f.state.last_observation.price, PRICE_SCALE)
    }

    // ------------------------------------------------------------ governance

    pub fn propose_admin(env: Env, new_admin: Address) {
        governance::propose_admin(&env, &config(&env).admin, &new_admin);
    }
    pub fn accept_admin(env: Env) {
        let mut cfg = config(&env);
        cfg.admin = governance::accept_admin(&env);
        env.storage().instance().set(&Key::Config, &cfg);
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
        soroban_sdk::String::from_str(&env, "spield-ustry-series-0.1.0")
    }
}

// ------------------------------------------------------------------ helpers

fn deposit_inner(env: &Env, owner: &Address, amount: i128) {
    positive(env, amount);
    let cfg = config(env);
    if env.ledger().timestamp() >= cfg.expiry {
        panic_with_error!(env, SeriesError::Expired);
    }
    exposure(env, &cfg);
    let mut state = UstrySeries::state(env.clone());
    if add(env, add(env, state.receipts, state.backing), amount) > cfg.cap {
        panic_with_error!(env, SeriesError::Cap);
    }
    let mut h = holding(env, owner);
    h.receipt = add(env, h.receipt, amount);
    issued(env, &cfg, 0, owner, amount, true);
    state.receipts = add(env, state.receipts, amount);
    token::Client::new(env, &cfg.asset).transfer(owner, env.current_contract_address(), &amount);
    save_holding(env, owner, &h);
    save_state(env, &state);
    assert_custody(env, &cfg, &state);
}

fn split_inner(env: &Env, owner: &Address, amount: i128, min_face: i128) -> i128 {
    positive(env, amount);
    if min_face < 0 {
        panic_with_error!(env, SeriesError::Amount);
    }
    let cfg = config(env);
    if env.ledger().timestamp() >= cfg.expiry {
        panic_with_error!(env, SeriesError::Expired);
    }
    exposure(env, &cfg);
    let mut state = strict(env, &cfg, UstrySeries::state(env.clone()));
    let face = floor(env, amount, FACTOR_SCALE, state.factor);
    positive(env, face);
    if face < min_face {
        panic_with_error!(env, SeriesError::Slippage);
    }
    let mut h = holding(env, owner);
    settle(env, &mut h, state.factor);
    h.receipt = sub(env, h.receipt, amount);
    h.pt = add(env, h.pt, face);
    h.yt = add(env, h.yt, face);
    state.receipts = sub(env, state.receipts, amount);
    state.face = add(env, state.face, face);
    state.total_yt = add(env, state.total_yt, face);
    issued(env, &cfg, 0, owner, amount, false);
    issued(env, &cfg, 1, owner, face, true);
    issued(env, &cfg, 2, owner, face, true);
    state.backing = add(env, state.backing, amount);
    save_holding(env, owner, &h);
    save_state(env, &state);
    assert_custody(env, &cfg, &state);
    face
}

fn bound(env: &Env, cfg: &Config, kind: u32) -> Address {
    if kind > 2 || cfg.tokens.len() != 3 {
        panic_with_error!(env, SeriesError::Binding);
    }
    cfg.tokens.get(kind).unwrap()
}
fn issued(env: &Env, cfg: &Config, kind: u32, owner: &Address, amount: i128, mint: bool) {
    ClaimTokenClient::new(env, &bound(env, cfg, kind)).issued(owner, &amount, &mint);
}
fn exposure(env: &Env, cfg: &Config) {
    if cfg.paused {
        panic_with_error!(env, SeriesError::Paused);
    }
    bound(env, cfg, 0);
}
fn config(env: &Env) -> Config {
    env.storage().instance().get(&Key::Config).unwrap()
}
fn floor(env: &Env, a: i128, b: i128, d: i128) -> i128 {
    mul_div_floor(env, a, b, d).unwrap_or_else(|_| panic_with_error!(env, SeriesError::Math))
}
fn add(env: &Env, a: i128, b: i128) -> i128 {
    a.checked_add(b)
        .unwrap_or_else(|| panic_with_error!(env, SeriesError::Math))
}
fn sub(env: &Env, a: i128, b: i128) -> i128 {
    if b < 0 || a < b {
        panic_with_error!(env, SeriesError::Balance);
    }
    a - b
}
fn positive(env: &Env, amount: i128) {
    if amount <= 0 {
        panic_with_error!(env, SeriesError::Amount);
    }
}
/// Yield accrues on the factor falling; it only ever falls, so `factor > h.factor` cannot occur.
fn settle(env: &Env, h: &mut Holding, factor: i128) {
    if h.factor != 0 && factor < h.factor {
        h.accrued = add(
            env,
            h.accrued,
            floor(env, h.yt, h.factor - factor, FACTOR_SCALE),
        );
    }
    h.factor = factor;
}
fn holding(env: &Env, owner: &Address) -> Holding {
    let key = Key::Holding(owner.clone());
    let h = env.storage().persistent().get(&key).unwrap_or_default();
    if env.storage().persistent().has(&key) {
        let max = env.storage().max_ttl();
        env.storage()
            .persistent()
            .extend_ttl(&key, max.saturating_sub(TTL_LO), max);
    }
    h
}
fn save_holding(env: &Env, owner: &Address, h: &Holding) {
    let key = Key::Holding(owner.clone());
    env.storage().persistent().set(&key, h);
    let max = env.storage().max_ttl();
    env.storage()
        .persistent()
        .extend_ttl(&key, max.saturating_sub(TTL_LO), max);
}
fn save_state(env: &Env, state: &State) {
    env.storage().instance().set(&Key::State, state);
    let max = env.storage().max_ttl();
    env.storage()
        .instance()
        .extend_ttl(max.saturating_sub(TTL_LO), max);
}
fn assert_custody(env: &Env, cfg: &Config, state: &State) {
    if token::Client::new(env, &cfg.asset).balance(&env.current_contract_address())
        < add(env, state.receipts, state.backing)
    {
        panic_with_error!(env, SeriesError::Insolvent);
    }
}

#[cfg(test)]
mod test;
#[cfg(all(test, feature = "fork-tests"))]
mod fork_test;
