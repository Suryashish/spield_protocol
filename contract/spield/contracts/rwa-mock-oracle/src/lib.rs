#![no_std]
//! TEST FIXTURE ONLY. An admin can publish arbitrary prices, including invalid prices
//! and future timestamps, to exercise consumer rejection. Never use for real funds.
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Observation {
    pub price: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
enum Key {
    Admin,
    Asset,
    Base,
    Decimals,
    History,
}

#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    pub fn __constructor(env: Env, admin: Address, asset: Address, base: Symbol, decimals: u32) {
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::Base, &base);
        env.storage().instance().set(&Key::Decimals, &decimals);
        env.storage()
            .instance()
            .set(&Key::History, &Vec::<Observation>::new(&env));
    }

    pub fn asset(env: Env) -> Address {
        env.storage().instance().get(&Key::Asset).unwrap()
    }

    pub fn base(env: Env) -> Symbol {
        env.storage().instance().get(&Key::Base).unwrap()
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage().instance().get(&Key::Decimals).unwrap()
    }

    pub fn observations(env: Env) -> Vec<Observation> {
        env.storage().instance().get(&Key::History).unwrap()
    }

    /// Append-only, bounded history. Bad values are intentional test inputs. The
    /// increasing timestamp rule prevents rewriting history after a maturity marker.
    pub fn publish(env: Env, price: i128, timestamp: u64) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        let mut history = Self::observations(env.clone());
        assert!(
            history.len() < 256,
            "mock history full: deploy a fresh fixture"
        );
        if let Some(last) = history.last() {
            assert!(timestamp > last.timestamp, "timestamps must increase");
        }
        history.push_back(Observation { price, timestamp });
        env.storage().instance().set(&Key::History, &history);
        env.storage().instance().extend_ttl(10_000, 100_000);
    }
}
