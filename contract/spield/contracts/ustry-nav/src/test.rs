extern crate std;

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke};
use soroban_sdk::IntoVal;

const T0: u64 = 1_800_000_000;
const P0: i128 = 110_000_000;

struct W {
    env: Env,
    admin: Address,
    publisher: Address,
    asset: Address,
    id: Address,
}
fn world() -> W {
    let env = Env::new_with_config(soroban_sdk::testutils::EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    env.ledger().set_timestamp(T0);
    let admin = Address::generate(&env);
    let publisher = Address::generate(&env);
    let asset = Address::generate(&env);
    let id = env.register(
        UstryNav,
        (
            admin.clone(),
            publisher.clone(),
            asset.clone(),
            P0,
            T0,
            3_600u64,
            500u32,
        ),
    );
    W {
        env,
        admin,
        publisher,
        asset,
        id,
    }
}
impl W {
    fn c(&self) -> UstryNavClient<'_> {
        UstryNavClient::new(&self.env, &self.id)
    }
    fn at(&self, t: u64) {
        self.env.ledger().set_timestamp(t);
    }
    fn ours(&self) -> Asset {
        Asset::Stellar(self.asset.clone())
    }
}

#[test]
fn sep40_shape_matches_redstone() {
    let w = world();
    let c = w.c();
    assert_eq!(c.base(), Asset::Other(Symbol::new(&w.env, "USD")));
    assert_eq!(c.decimals(), 8);
    assert_eq!(c.resolution(), 3_600);
    assert_eq!(c.assets(), soroban_sdk::vec![&w.env, w.ours()]);
    assert_eq!(
        c.lastprice(&w.ours()),
        Some(PriceData {
            price: P0,
            timestamp: T0
        })
    );
    let other = Asset::Stellar(Address::generate(&w.env));
    assert_eq!(c.lastprice(&other), None);
    assert_eq!(c.prices(&other, &5), None);
    assert_eq!(c.prices(&w.ours(), &0), None);
    assert_eq!(c.price(&w.ours(), &T0).unwrap().price, P0);
    assert_eq!(c.price(&w.ours(), &(T0 + 1)), None);
}

#[test]
fn only_the_publisher_publishes_and_admin_is_not_publisher() {
    let w = world();
    let c = w.c();
    w.at(T0 + 3_600);
    // The admin cannot publish: the roles are separate.
    assert!(c
        .mock_auths(&[MockAuth {
            address: &w.admin,
            invoke: &MockAuthInvoke {
                contract: &w.id,
                fn_name: "publish",
                args: (P0, T0 + 3_600).into_val(&w.env),
                sub_invokes: &[],
            },
        }])
        .try_publish(&P0, &(T0 + 3_600))
        .is_err());
    c.mock_auths(&[MockAuth {
        address: &w.publisher,
        invoke: &MockAuthInvoke {
            contract: &w.id,
            fn_name: "publish",
            args: (P0, T0 + 3_600).into_val(&w.env),
            sub_invokes: &[],
        },
    }])
    .publish(&P0, &(T0 + 3_600));
    assert_eq!(c.prices(&w.ours(), &10).unwrap().len(), 2);
}

#[test]
fn cadence_deviation_skew_and_bad_samples() {
    let w = world();
    w.env.mock_all_auths();
    let c = w.c();
    // Too soon, no deviation.
    w.at(T0 + 1_800);
    assert_eq!(
        c.try_publish(&P0, &(T0 + 1_800)).err().unwrap().unwrap(),
        NavError::Cadence.into()
    );
    // A 0.1% move publishes early, but never inside the 60s floor.
    w.at(T0 + 30);
    assert!(c.try_publish(&(P0 + 110_000), &(T0 + 30)).is_err());
    w.at(T0 + 1_800);
    c.publish(&(P0 + 110_000), &(T0 + 1_800));
    // Same or older timestamp, future timestamp, stale (>300s) timestamp, zero and oversized price.
    w.at(T0 + 9_000);
    assert!(c.try_publish(&P0, &(T0 + 1_800)).is_err());
    assert!(c.try_publish(&P0, &(T0 + 9_001)).is_err());
    assert!(c.try_publish(&P0, &(T0 + 8_699)).is_err());
    assert!(c.try_publish(&0, &(T0 + 9_000)).is_err());
    assert!(c.try_publish(&(MAX_PRICE + 1), &(T0 + 9_000)).is_err());
    // Falling NAV is retained, never clamped.
    c.publish(&(P0 - 1_000_000), &(T0 + 9_000));
    assert_eq!(c.lastprice(&w.ours()).unwrap().price, P0 - 1_000_000);
}

#[test]
fn fat_finger_move_is_rejected_and_admin_can_widen_it() {
    let w = world();
    w.env.mock_all_auths();
    let c = w.c();
    w.at(T0 + 3_600);
    // 5% bound: +6% rejected both ways.
    assert_eq!(
        c.try_publish(&(P0 * 106 / 100), &(T0 + 3_600))
            .err()
            .unwrap()
            .unwrap(),
        NavError::Move.into()
    );
    assert!(c.try_publish(&(P0 * 94 / 100), &(T0 + 3_600)).is_err());
    c.publish(&(P0 * 105 / 100), &(T0 + 3_600));
    assert!(c.try_set_max_move_bps(&50).is_err());
    assert!(c.try_set_max_move_bps(&5_001).is_err());
    c.set_max_move_bps(&1_000);
    w.at(T0 + 7_200);
    c.publish(&(P0 * 105 / 100 * 109 / 100), &(T0 + 7_200));
}

#[test]
fn history_is_a_bounded_ring_returned_oldest_first() {
    let w = world();
    w.env.mock_all_auths();
    let c = w.c();
    for i in 1..=(HISTORY as u64 + 10) {
        let t = T0 + i * 3_600;
        w.at(t);
        c.publish(&(P0 + i as i128), &t);
    }
    let all = c.prices(&w.ours(), &1_000).unwrap();
    assert_eq!(all.len(), HISTORY);
    for i in 1..all.len() {
        assert!(all.get(i).unwrap().timestamp > all.get(i - 1).unwrap().timestamp);
    }
    assert_eq!(all.last().unwrap(), c.lastprice(&w.ours()).unwrap());
    let three = c.prices(&w.ours(), &3).unwrap();
    assert_eq!(three.len(), 3);
    assert_eq!(three.last().unwrap(), all.last().unwrap());
}

#[test]
fn admin_controls_publisher_interval_and_rotates_in_two_steps() {
    let w = world();
    w.env.mock_all_auths();
    let c = w.c();
    let hot = Address::generate(&w.env);
    c.set_publisher(&hot);
    assert_eq!(c.config().publisher, hot);
    assert!(c.try_set_min_interval(&59).is_err());
    assert!(c.try_set_min_interval(&43_201).is_err());
    c.set_min_interval(&600);
    assert_eq!(c.resolution(), 600);
    let next = Address::generate(&w.env);
    c.propose_admin(&next);
    assert_eq!(c.config().admin, w.admin);
    c.accept_admin();
    assert_eq!(c.config().admin, next);
    assert!(c.try_accept_admin().is_err());
}

#[test]
fn constructor_rejects_bad_configuration() {
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    let a = Address::generate(&env);
    for (price, ts, interval, mv) in [
        (0i128, T0, 3_600u64, 500u32),
        (P0, T0 + 1, 3_600, 500),
        (P0, T0 - 301, 3_600, 500),
        (P0, T0, 59, 500),
        (P0, T0, 3_600, 99),
    ] {
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            env.register(
                UstryNav,
                (a.clone(), a.clone(), a.clone(), price, ts, interval, mv),
            )
        }));
        assert!(r.is_err());
    }
}
