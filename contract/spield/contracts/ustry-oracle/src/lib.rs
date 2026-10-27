#![no_std]
//! Authenticated sandbox NAV relay. Observation time is relay observation time,
//! not a claim about the bond administrator's underlying valuation effective time.
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Env, Symbol, Vec,
};
#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum NavError {
    Invalid = 1,
    Cadence = 2,
    Full = 3,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Observation {
    pub price: i128,
    pub timestamp: u64,
}
#[contracttype]
#[derive(Clone)]
struct Config {
    admin: Address,
    asset: Address,
    expiry: u64,
}
#[contract]
pub struct UstryOracle;
fn valid(env: &Env, price: i128, timestamp: u64) {
    if !(1..=100_000_000_000).contains(&price)
        || timestamp > env.ledger().timestamp()
        || env.ledger().timestamp() - timestamp > 300
    {
        panic_with_error!(env, NavError::Invalid);
    }
}
#[contractimpl]
impl UstryOracle {
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset: Address,
        price: i128,
        timestamp: u64,
        expiry: u64,
    ) {
        valid(&env, price, timestamp);
        if expiry <= timestamp {
            panic_with_error!(&env, NavError::Invalid);
        }
        env.storage().instance().set(
            &symbol_short!("config"),
            &Config {
                admin,
                asset,
                expiry,
            },
        );
        let mut history = Vec::new(&env);
        history.push_back(Observation { price, timestamp });
        env.storage()
            .instance()
            .set(&symbol_short!("history"), &history);
        env.storage()
            .instance()
            .extend_ttl(10_000, env.storage().max_ttl());
    }
    pub fn asset(env: Env) -> Address {
        cfg(&env).asset
    }
    pub fn base(env: Env) -> Symbol {
        Symbol::new(&env, "USD")
    }
    pub fn decimals(_env: Env) -> u32 {
        8
    }
    pub fn observations(env: Env) -> Vec<Observation> {
        env.storage()
            .instance()
            .extend_ttl(10_000, env.storage().max_ttl());
        env.storage()
            .instance()
            .get(&symbol_short!("history"))
            .unwrap()
    }
    pub fn publish(env: Env, price: i128, timestamp: u64) {
        let c = cfg(&env);
        c.admin.require_auth();
        valid(&env, price, timestamp);
        let mut h = Self::observations(env.clone());
        let last = h.last().unwrap();
        if timestamp <= last.timestamp {
            panic_with_error!(&env, NavError::Invalid);
        }
        let crossing = last.timestamp < c.expiry && timestamp >= c.expiry;
        if !crossing
            && timestamp - last.timestamp < 43_200
            && (price - last.price).abs() * 1000 < last.price
        {
            panic_with_error!(&env, NavError::Cadence);
        }
        if h.len() >= 256 {
            panic_with_error!(&env, NavError::Full);
        }
        h.push_back(Observation { price, timestamp });
        env.storage().instance().set(&symbol_short!("history"), &h);
    }
}
fn cfg(env: &Env) -> Config {
    env.storage()
        .instance()
        .get(&symbol_short!("config"))
        .unwrap()
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    #[test]
    fn cadence_identity_loss_maturity_and_bad_samples() {
        let e = Env::default();
        e.mock_all_auths();
        e.ledger().set_timestamp(1000);
        let asset = Address::generate(&e);
        let id = e.register(
            UstryOracle,
            (
                Address::generate(&e),
                asset.clone(),
                100_000_000i128,
                1000u64,
                2000u64,
            ),
        );
        let c = UstryOracleClient::new(&e, &id);
        assert_eq!(c.asset(), asset);
        assert_eq!(c.base(), Symbol::new(&e, "USD"));
        assert_eq!(c.decimals(), 8);
        e.ledger().set_timestamp(1010);
        assert!(c.try_publish(&100_000_001, &1010).is_err());
        assert!(c.try_publish(&0, &1010).is_err());
        assert!(c.try_publish(&100_200_000, &1011).is_err());
        c.publish(&99_000_000, &1010); // Falling NAV is retained, never clamped.
        assert!(c.try_publish(&100_000_000, &1000).is_err());
        e.ledger().set_timestamp(2000);
        c.publish(&99_000_000, &2000); // boundary despite heartbeat
        e.ledger().set_timestamp(45_200);
        c.publish(&99_000_000, &45_200);
        assert_eq!(c.observations().len(), 4);
    }
}
