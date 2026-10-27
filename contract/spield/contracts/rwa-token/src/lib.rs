#![no_std]
#![allow(deprecated)]
use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Env, String,
};
use spield_shared::{token as allowance, Error};

#[contractclient(name = "SeriesClient")]
pub trait Series {
    fn claim_balance(env: Env, owner: Address, kind: u32) -> i128;
    fn claim_supply(env: Env, kind: u32) -> i128;
    fn transfer_claim(env: Env, from: Address, to: Address, amount: i128, kind: u32);
    fn burn_claim(env: Env, from: Address, amount: i128, kind: u32);
}
#[contracttype]
#[derive(Clone)]
struct Metadata {
    series: Address,
    kind: u32,
    name: String,
    symbol: String,
}
#[contract]
pub struct ClaimToken;
fn meta(env: &Env) -> Metadata {
    env.storage()
        .instance()
        .extend_ttl(10_000, env.storage().max_ttl());
    env.storage()
        .instance()
        .get(&symbol_short!("meta"))
        .unwrap()
}
fn nonnegative(env: &Env, amount: i128) {
    if amount < 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }
}
#[contractimpl]
impl ClaimToken {
    pub fn __constructor(env: Env, series: Address, kind: u32, name: String, symbol: String) {
        if kind > 2 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        env.storage().instance().set(
            &symbol_short!("meta"),
            &Metadata {
                series,
                kind,
                name,
                symbol,
            },
        );
    }
    pub fn series(env: Env) -> Address {
        meta(&env).series
    }
    pub fn kind(env: Env) -> u32 {
        meta(&env).kind
    }
    pub fn decimals(_env: Env) -> u32 {
        7
    }
    pub fn name(env: Env) -> String {
        meta(&env).name
    }
    pub fn symbol(env: Env) -> String {
        meta(&env).symbol
    }
    pub fn balance(env: Env, id: Address) -> i128 {
        let m = meta(&env);
        SeriesClient::new(&env, &m.series).claim_balance(&id, &m.kind)
    }
    pub fn total_supply(env: Env) -> i128 {
        let m = meta(&env);
        SeriesClient::new(&env, &m.series).claim_supply(&m.kind)
    }
    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        allowance::allowance(&env, &from, &spender)
    }
    pub fn approve(
        env: Env,
        from: Address,
        spender: Address,
        amount: i128,
        expiration_ledger: u32,
    ) {
        from.require_auth();
        allowance::set_allowance(&env, &from, &spender, amount, expiration_ledger);
        env.events().publish(
            (symbol_short!("approve"), from, spender),
            (amount, expiration_ledger),
        );
    }
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        move_claim(&env, &from, &to, amount);
    }
    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        nonnegative(&env, amount);
        spender.require_auth();
        allowance::spend_allowance(&env, &from, &spender, amount);
        move_claim(&env, &from, &to, amount);
    }
    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        burn_claim(&env, &from, amount);
    }
    pub fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        nonnegative(&env, amount);
        spender.require_auth();
        allowance::spend_allowance(&env, &from, &spender, amount);
        burn_claim(&env, &from, amount);
    }
    /// Ledger mint/burn events are emitted only at the engine's request.
    pub fn issued(env: Env, owner: Address, amount: i128, mint: bool) {
        let m = meta(&env);
        m.series.require_auth();
        nonnegative(&env, amount);
        if mint {
            env.events()
                .publish((symbol_short!("mint"), m.series, owner), amount);
        } else {
            env.events().publish((symbol_short!("burn"), owner), amount);
        }
    }
}
fn move_claim(env: &Env, from: &Address, to: &Address, amount: i128) {
    nonnegative(env, amount);
    let m = meta(env);
    SeriesClient::new(env, &m.series).transfer_claim(from, to, &amount, &m.kind);
    env.events()
        .publish((symbol_short!("transfer"), from, to), amount);
}
fn burn_claim(env: &Env, from: &Address, amount: i128) {
    nonnegative(env, amount);
    let m = meta(env);
    SeriesClient::new(env, &m.series).burn_claim(from, &amount, &m.kind);
    env.events().publish((symbol_short!("burn"), from), amount);
}
