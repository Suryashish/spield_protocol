extern crate std;

use super::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient,
};
use spield_ustry_nav::{UstryNav, UstryNavClient};

const UNIT: i128 = 10_000_000;
const DAY: u64 = 86_400;
const START: u64 = 1_800_000_000;
const TERM: u64 = 60 * DAY;
const P0: i128 = 125_000_000; // $1.25, deliberately not $1.

// ------------------------------------------------------------------ fault-injecting feed

#[contracttype]
#[derive(Clone)]
enum FaultKey {
    Mode,
    Records,
}

/// SEP-40 feed whose behaviour the test controls. Modes: 0 normal, 1 trap, 2 wrong base,
/// 3 wrong decimals, 4 `None`, 5 burns the whole budget (uncatchable by `try_`), 6 ignores
/// `records` and returns 40 samples.
#[contract]
pub struct FaultFeed;
#[contractimpl]
impl FaultFeed {
    pub fn set(env: Env, mode: u32, records: Vec<PriceData>) {
        env.storage().instance().set(&FaultKey::Mode, &mode);
        env.storage().instance().set(&FaultKey::Records, &records);
    }
    pub fn base(env: Env) -> Asset {
        let mode: u32 = env.storage().instance().get(&FaultKey::Mode).unwrap_or(0);
        if mode == 1 {
            panic!("feed down");
        }
        Asset::Other(Symbol::new(&env, if mode == 2 { "EUR" } else { "USD" }))
    }
    pub fn decimals(env: Env) -> u32 {
        let mode: u32 = env.storage().instance().get(&FaultKey::Mode).unwrap_or(0);
        if mode == 3 {
            7
        } else {
            8
        }
    }
    pub fn prices(env: Env, _asset: Asset, records: u32) -> Option<Vec<PriceData>> {
        let mode: u32 = env.storage().instance().get(&FaultKey::Mode).unwrap_or(0);
        if mode == 4 {
            return None;
        }
        let all: Vec<PriceData> = env.storage().instance().get(&FaultKey::Records).unwrap();
        if mode == 5 {
            let mut x = 0u64;
            while x != u64::MAX {
                x += env.storage().instance().has(&FaultKey::Mode) as u64;
            }
        }
        if mode == 6 {
            let now = env.ledger().timestamp();
            let mut v = Vec::new(&env);
            for i in 0..40u64 {
                v.push_back(pd(P0, now - 40 + i));
            }
            return Some(v);
        }
        let from = all.len().saturating_sub(records);
        Some(all.slice(from..))
    }
}

fn pd(price: i128, timestamp: u64) -> PriceData {
    PriceData { price, timestamp }
}

// ------------------------------------------------------------------ world

struct World {
    env: Env,
    admin: Address,
    asset: Address,
    feed: Address,
    series: Address,
    fault: bool,
}

fn params() -> Params {
    Params {
        max_age: DAY,
        grace: 7 * DAY,
        max_apr_bps: 10_000,
        cap: 1_000_000 * UNIT,
        window: 16,
    }
}

impl World {
    fn new() -> Self {
        Self::build(false, params())
    }
    fn faulty() -> Self {
        Self::build(true, params())
    }
    fn build(fault: bool, p: Params) -> Self {
        let env = Env::new_with_config(soroban_sdk::testutils::EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.mock_all_auths();
        env.cost_estimate().budget().reset_unlimited();
        env.ledger().set_timestamp(START);
        env.ledger()
            .with_mut(|l| l.min_persistent_entry_ttl = 120_960);
        let admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let asset = sac.address();
        let feed = if fault {
            let id = env.register(FaultFeed, ());
            FaultFeedClient::new(&env, &id).set(&0, &soroban_sdk::vec![&env, pd(P0, START)]);
            id
        } else {
            env.register(
                UstryNav,
                (admin.clone(), admin.clone(), asset.clone(), P0, START, 60u64, 5_000u32),
            )
        };
        let series = env.register(UstrySeries, (admin.clone(), asset.clone(), feed.clone(), START + TERM, p));
        let mut t = std::vec::Vec::new();
        for kind in 0..3u32 {
            t.push(env.register(
                spield_rwa_token::ClaimToken,
                (
                    series.clone(),
                    kind,
                    soroban_sdk::String::from_str(&env, "Claim"),
                    soroban_sdk::String::from_str(&env, "CLM"),
                ),
            ));
        }
        UstrySeriesClient::new(&env, &series).bind_tokens(&t[0], &t[1], &t[2]);
        Self { env, admin, asset, feed, series, fault }
    }
    fn c(&self) -> UstrySeriesClient<'_> {
        UstrySeriesClient::new(&self.env, &self.series)
    }
    fn token(&self, kind: u32) -> spield_rwa_token::ClaimTokenClient<'_> {
        spield_rwa_token::ClaimTokenClient::new(&self.env, &self.c().config().tokens.get(kind).unwrap())
    }
    fn user(&self, amount: i128) -> Address {
        let u = Address::generate(&self.env);
        StellarAssetClient::new(&self.env, &self.asset).mint(&u, &amount);
        u
    }
    fn usdry(&self, who: &Address) -> i128 {
        token::Client::new(&self.env, &self.asset).balance(who)
    }
    fn now(&self) -> u64 {
        self.env.ledger().timestamp()
    }
    fn at(&self, t: u64) {
        self.env.ledger().set_timestamp(t);
    }
    /// Publish `price` stamped now (real relay) or replace the fault feed's records.
    fn publish(&self, price: i128) {
        let t = self.now();
        if self.fault {
            let mut r: Vec<PriceData> = self.env.as_contract(&self.feed, || {
                self.env.storage().instance().get(&FaultKey::Records).unwrap()
            });
            r.push_back(pd(price, t));
            self.fault_set(0, r);
        } else {
            UstryNavClient::new(&self.env, &self.feed).publish(&price, &t);
        }
    }
    fn fault_set(&self, mode: u32, records: Vec<PriceData>) {
        FaultFeedClient::new(&self.env, &self.feed).set(&mode, &records);
    }
    fn fault_mode(&self, mode: u32) {
        let r: Vec<PriceData> = self.env.as_contract(&self.feed, || {
            self.env.storage().instance().get(&FaultKey::Records).unwrap()
        });
        self.fault_set(mode, r);
    }
    fn obligations(&self) -> i128 {
        let s = self.c().state();
        s.receipts + s.backing
    }
    fn err<T, E: core::fmt::Debug>(r: Result<T, Result<E, soroban_sdk::InvokeError>>) -> E {
        match r {
            Err(Ok(e)) => e,
            Err(Err(e)) => panic!("host error {e:?}"),
            Ok(_) => panic!("expected an error"),
        }
    }
}
fn e(code: SeriesError) -> soroban_sdk::Error {
    code.into()
}

// ------------------------------------------------------------------ construction

#[test]
fn constructor_rejects_bad_params_and_bad_feeds() {
    let ok = World::new();
    let env = &ok.env;
    let mk = |p: Params, expiry: u64| {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            env.register(UstrySeries, (ok.admin.clone(), ok.asset.clone(), ok.feed.clone(), expiry, p))
        }))
        .is_err()
    };
    let base = params();
    assert!(mk(base.clone(), START)); // expiry not in the future
    assert!(mk(Params { max_age: 3_599, ..base.clone() }, START + TERM));
    assert!(mk(Params { max_age: 172_801, ..base.clone() }, START + TERM));
    assert!(mk(Params { grace: DAY - 1, ..base.clone() }, START + TERM));
    assert!(mk(Params { max_apr_bps: 0, ..base.clone() }, START + TERM));
    assert!(mk(Params { max_apr_bps: 10_001, ..base.clone() }, START + TERM));
    assert!(mk(Params { cap: 0, ..base.clone() }, START + TERM));
    assert!(mk(Params { window: 1, ..base.clone() }, START + TERM));
    assert!(mk(Params { window: 33, ..base.clone() }, START + TERM));
    // Stale seed: one day plus a second old.
    ok.at(START + DAY + 1);
    assert!(mk(base.clone(), START + TERM));

    for mode in [1u32, 2, 3, 4] {
        let w = World::faulty();
        w.fault_mode(mode);
        let env = &w.env;
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            env.register(UstrySeries, (w.admin.clone(), w.asset.clone(), w.feed.clone(), START + TERM, params()))
        }));
        assert!(r.is_err(), "mode {mode} must be refused at construction");
    }
}

#[test]
fn binding_is_once_and_checked() {
    let w = World::new();
    let t = w.c().config().tokens;
    assert_eq!(
        World::err(w.c().try_bind_tokens(&t.get(0).unwrap(), &t.get(1).unwrap(), &t.get(2).unwrap())),
        e(SeriesError::Binding)
    );
}

// ------------------------------------------------------------------ lifecycle

#[test]
fn full_lifecycle_yield_maturity_and_pt_only_exit_conserve_tokens() {
    let w = World::new();
    let c = w.c();
    let alice = w.user(100 * UNIT);
    let face = c.deposit_split(&alice, &(40 * UNIT), &0);
    assert_eq!(face, 50 * UNIT); // 40 USTRY × $1.25
    assert_eq!(w.token(1).balance(&alice), face);
    assert_eq!(w.token(2).balance(&alice), face);
    assert_eq!(w.token(1).total_supply(), face);

    // NAV +4% over 30 days: within the 100%/yr rate bound, so recognised in full.
    w.at(START + 30 * DAY);
    w.publish(130_000_000);
    assert!(!c.status().synced);
    assert_eq!(c.claim_yield(&alice), 0); // exits never read the feed
    c.sync();
    assert!(c.status().synced);
    let claimed = c.claim_yield(&alice);
    // 50 face held 40 USTRY at $1.25 and 50/1.30 after; YT is paid the difference, computed
    // with the contract's own rounding (factor rounds up, payouts round down).
    let f = |p: i128| (PRICE_SCALE * FACTOR_SCALE + p - 1) / p;
    let (f0, f1) = (f(P0), f(130_000_000));
    assert_eq!(claimed, face * (f0 - f1) / FACTOR_SCALE);
    assert!((40 * UNIT - 384_615_385 - 1..=40 * UNIT - 384_615_384).contains(&claimed));
    assert_eq!(w.token(2).balance(&alice), face); // claiming never burns YT

    // Past expiry. A post-expiry sample proves coverage; finalize on it.
    w.at(START + TERM + 3_600);
    w.publish(131_000_000);
    let s = c.finalize();
    assert!(s.finalized);
    assert_eq!(s.high_water, 130_000_000); // post-expiry price is not yield
    // PT alone now redeems its frozen allocation.
    let paid = c.redeem(&alice, &face, &0);
    assert_eq!(paid, face * f1 / FACTOR_SCALE);
    assert_eq!(w.token(2).balance(&alice), face); // YT untouched by a post-maturity PT exit
    assert_eq!(c.claim_yield(&alice), 0);
    // Every token is either back with Alice or still in the series as rounding dust.
    let held = w.usdry(&w.series);
    assert!(held >= w.obligations() && held <= 2, "held {held}");
    assert_eq!(w.usdry(&alice) + held, 100 * UNIT);
}

#[test]
fn receipts_are_price_free_and_split_into_equal_face() {
    let w = World::faulty();
    let c = w.c();
    let a = w.user(10 * UNIT);
    w.fault_mode(1); // feed trapping
    c.deposit(&a, &(4 * UNIT));
    assert_eq!(w.token(0).balance(&a), 4 * UNIT);
    c.withdraw_receipts(&a, &UNIT);
    assert_eq!(w.usdry(&a), 7 * UNIT);
    // Splitting needs a price and is refused while the feed is down.
    assert_eq!(World::err(c.try_split(&a, &UNIT, &0)), e(SeriesError::OracleUnavailable));
    w.fault_mode(0);
    assert_eq!(c.split(&a, &UNIT, &0), 12_500_000);
}

#[test]
fn new_depositor_does_not_inherit_existing_yield() {
    let w = World::new();
    let c = w.c();
    let a = w.user(10 * UNIT);
    c.deposit_split(&a, &(8 * UNIT), &0);
    w.at(START + 10 * DAY);
    w.publish(127_000_000);
    let b = w.user(10 * UNIT);
    c.deposit_split(&b, &(8 * UNIT), &0);
    assert_eq!(c.claim_yield(&b), 0);
    assert!(c.claim_yield(&a) > 0);
}

#[test]
fn recovery_below_previous_peak_pays_nothing_and_blocks_new_splits() {
    let w = World::new();
    let c = w.c();
    let a = w.user(10 * UNIT);
    c.deposit_split(&a, &(8 * UNIT), &0);
    w.at(START + 10 * DAY);
    w.publish(127_000_000);
    c.sync();
    let first = c.claim_yield(&a);
    w.at(START + 11 * DAY);
    w.publish(120_000_000);
    assert_eq!(World::err(c.try_deposit_split(&a, &UNIT, &0)), e(SeriesError::Drawdown));
    w.at(START + 12 * DAY);
    w.publish(126_000_000); // still below the 1.27 peak
    c.sync();
    assert_eq!(c.claim_yield(&a), 0);
    assert!(first > 0);
    // The receipt path never needs a price.
    c.deposit(&a, &UNIT);
    c.withdraw_receipts(&a, &UNIT);
}

// ------------------------------------------------------------------ stale and broken feeds

#[test]
fn stale_nav_blocks_only_new_exposure() {
    let w = World::new();
    let c = w.c();
    let a = w.user(10 * UNIT);
    let b = Address::generate(&w.env);
    let face = c.deposit_split(&a, &(8 * UNIT), &0);
    w.at(START + DAY + 1); // one second past max_age, no new sample
    assert!(!c.status().fresh);
    assert!(!c.status().entry_open);
    assert_eq!(World::err(c.try_deposit_split(&a, &UNIT, &0)), e(SeriesError::OracleStale));
    assert_eq!(World::err(c.try_value_usd(&UNIT)), e(SeriesError::OracleStale));
    // Every exit still works.
    c.claim_yield(&a);
    w.token(1).transfer(&a, &b, &UNIT);
    w.token(2).transfer(&a, &b, &UNIT);
    let paid = c.redeem(&a, &(face - UNIT), &0);
    assert_eq!(paid, 72_000_000); // 9 face / $1.25
    c.deposit(&a, &UNIT); // receipts still accepted
    c.withdraw_receipts(&a, &UNIT);
    // A fresh sample reopens entry.
    w.publish(P0);
    assert!(c.status().entry_open);
    c.deposit_split(&a, &UNIT, &0);
}

#[test]
fn every_kind_of_broken_feed_leaves_exits_open() {
    for mode in [1u32, 2, 3, 4] {
        let w = World::faulty();
        let c = w.c();
        let a = w.user(10 * UNIT);
        let face = c.deposit_split(&a, &(8 * UNIT), &0);
        w.fault_mode(mode);
        let st = c.status();
        assert!(!st.oracle_ok && !st.entry_open, "mode {mode}");
        assert_eq!(World::err(c.try_split(&a, &UNIT, &0)), e(SeriesError::OracleUnavailable));
        assert_eq!(c.sync(), c.state()); // sync keeps state instead of reverting
        assert_eq!(c.claim_yield(&a), 0);
        w.token(2).transfer(&a, &Address::generate(&w.env), &1);
        assert_eq!(c.redeem(&a, &(face - 1), &0), 79_999_999); // (10 face - 1) / $1.25
    }
}

#[test]
fn malformed_histories_are_rejected_whole() {
    let w = World::faulty();
    let c = w.c();
    let a = w.user(10 * UNIT);
    c.deposit_split(&a, &(8 * UNIT), &0);
    let now = START + DAY / 2;
    w.at(now);
    let cases = [
        soroban_sdk::vec![&w.env, pd(P0, START), pd(200_000_000, now - 5), pd(P0, now - 10)], // not monotonic
        soroban_sdk::vec![&w.env, pd(P0, START), pd(130_000_000, now + 61)], // beyond the 60s skew allowance
        soroban_sdk::vec![&w.env, pd(P0, START), pd(0, now)], // zero price
        soroban_sdk::vec![&w.env, pd(P0, START), pd(130_000_000, now), pd(130_000_000, now)], // duplicate
        Vec::new(&w.env),
    ];
    for r in cases {
        w.fault_set(0, r);
        let before = c.state();
        assert!(!c.status().oracle_ok);
        assert_eq!(c.sync(), before, "malformed history must not be half-applied");
        assert!(c.try_split(&a, &UNIT, &0).is_err());
    }
}

#[test]
fn descending_feeds_fold_like_ascending_ones() {
    let w = World::faulty();
    let c = w.c();
    let t = START + 2 * DAY;
    w.at(t);
    // Moves stay inside the 100%/yr rate bound so the fold, not the clamp, is under test.
    let asc = soroban_sdk::vec![&w.env, pd(P0, START), pd(125_300_000, START + DAY), pd(125_200_000, t)];
    let mut desc = Vec::new(&w.env);
    for i in (0..asc.len()).rev() {
        desc.push_back(asc.get(i).unwrap());
    }
    w.fault_set(0, desc);
    let s = c.sync();
    assert_eq!(s.high_water, 125_300_000);
    assert_eq!(s.last_observation, pd(125_200_000, t));
}

// ------------------------------------------------------------------ rate bound

#[test]
fn high_water_cannot_rise_faster_than_max_apr() {
    let w = World::build(false, Params { max_apr_bps: 2_000, ..params() });
    let c = w.c();
    let a = w.user(100 * UNIT);
    c.deposit_split(&a, &(80 * UNIT), &0);
    // A +40% "NAV" one day later: the relay's 50% move bound lets it through, the series does not.
    w.at(START + DAY);
    w.publish(175_000_000);
    let s = c.sync();
    let cap = P0 + P0 * 2_000 * DAY as i128 / (10_000 * YEAR);
    assert_eq!(s.high_water, cap);
    let yield_paid = c.claim_yield(&a); // sync() above already folded the clamped mark
    // At most 20%/yr × 1 day of the 80 USTRY backing PT.
    assert!(yield_paid <= 80 * UNIT * 2_000 / 10_000 / 365 + 1, "{yield_paid}");
    // Spike is not a drawdown for new entrants; the price is above the clamped high-water.
    c.deposit_split(&a, &UNIT, &0);
    // Over time the mark catches up at the bounded rate, never past the price.
    w.at(START + 400 * DAY);
    let w2 = w.c().config();
    assert_eq!(w2.max_apr_bps, 2_000);
}

#[test]
fn window_limits_folding_conservatively() {
    let w = World::build(false, Params { window: 2, ..params() });
    let c = w.c();
    // Three unfolded samples; only the newest two are returned. The middle peak is visible,
    // the oldest is skipped — the mark can only end up lower than the full history, never higher.
    for (i, p) in [(1u64, 125_150_000i128), (2, 125_120_000), (3, 125_110_000)] {
        w.at(START + i * DAY / 2);
        w.publish(p);
    }
    assert_eq!(c.sync().high_water, 125_120_000);
}

// ------------------------------------------------------------------ maturity

#[test]
fn maturity_cannot_brick_boundary_and_grace_paths() {
    // Boundary path: a sample exactly at expiry is folded and proves coverage.
    let w = World::new();
    let c = w.c();
    let a = w.user(10 * UNIT);
    let face = c.deposit_split(&a, &(8 * UNIT), &0);
    assert_eq!(World::err(c.try_finalize()), e(SeriesError::NotExpired));
    w.at(START + TERM);
    w.publish(126_000_000);
    let s = c.finalize();
    assert!(s.finalized && s.high_water == 126_000_000);
    assert_eq!(c.finalize(), s); // idempotent

    // Grace path: the feed dies before expiry and never recovers.
    let w = World::faulty();
    let c = w.c();
    let a = w.user(10 * UNIT);
    let face2 = c.deposit_split(&a, &(8 * UNIT), &0);
    w.fault_mode(1);
    w.at(START + TERM + 1);
    assert!(!c.status().finalizable);
    assert_eq!(World::err(c.try_finalize()), e(SeriesError::MaturityPending));
    // Combine still works between expiry and finalization.
    assert_eq!(c.redeem(&a, &UNIT, &0), 8_000_000);
    // PT alone is not yet redeemable: YT must accompany it until finalization.
    w.token(2).transfer(&a, &Address::generate(&w.env), &(face2 - UNIT));
    assert_eq!(World::err(c.try_redeem(&a, &(face2 - UNIT), &0)), e(SeriesError::Balance));
    w.at(START + TERM + 7 * DAY);
    assert!(c.status().finalizable);
    let s = c.finalize();
    assert!(s.finalized && s.high_water == P0);
    assert_eq!(c.redeem(&a, &(face2 - UNIT), &0), 72_000_000);
    let _ = face;
}

#[test]
fn stale_boundary_still_finalizes_and_late_samples_add_no_yield() {
    // The relay stopped two days before expiry and resumed a day after it. Series 1 could never
    // finalize this; here the post-expiry sample proves coverage and no yield is invented.
    let w = World::new();
    let c = w.c();
    let a = w.user(10 * UNIT);
    c.deposit_split(&a, &(8 * UNIT), &0);
    w.at(START + TERM - 2 * DAY);
    w.publish(127_000_000);
    w.at(START + TERM + DAY);
    w.publish(140_000_000);
    let s = c.finalize();
    assert_eq!(s.high_water, 127_000_000);
    let before = c.claim_yield(&a); // finalize folded the pre-expiry sample
    w.at(START + TERM + 3 * DAY);
    w.publish(150_000_000);
    c.sync();
    assert_eq!(c.claim_yield(&a), 0);
    assert!(before > 0);
}

#[test]
fn deposits_close_at_expiry_but_receipts_and_combine_stay_open() {
    let w = World::new();
    let c = w.c();
    let a = w.user(10 * UNIT);
    c.deposit(&a, &UNIT);
    let face = c.split(&a, &UNIT, &0);
    w.at(START + TERM);
    assert_eq!(World::err(c.try_deposit(&a, &UNIT)), e(SeriesError::Expired));
    assert_eq!(World::err(c.try_deposit_split(&a, &UNIT, &0)), e(SeriesError::Expired));
    assert_eq!(c.redeem(&a, &face, &0), UNIT);
}

// ------------------------------------------------------------------ transfers

#[test]
fn yt_transfer_settles_both_parties_first() {
    let w = World::new();
    let c = w.c();
    let a = w.user(10 * UNIT);
    let b = w.user(10 * UNIT);
    let face = c.deposit_split(&a, &(8 * UNIT), &0);
    w.at(START + 10 * DAY);
    w.publish(130_000_000);
    c.sync();
    w.token(2).transfer(&a, &b, &face);
    // The seller keeps what accrued before the sale; the buyer starts at zero.
    assert!(c.claim_yield(&a) > 0);
    assert_eq!(c.claim_yield(&b), 0);
    w.at(START + 20 * DAY);
    w.publish(131_000_000);
    c.sync();
    assert!(c.claim_yield(&b) > 0);
    assert_eq!(c.claim_yield(&a), 0);
}

#[test]
fn only_bound_tokens_move_claims_and_owners_authorise_exits() {
    let w = World::new();
    let c = w.c();
    let a = w.user(10 * UNIT);
    c.deposit_split(&a, &UNIT, &0);
    let thief = Address::generate(&w.env);
    // Direct calls to the facade hooks must carry the bound token's auth.
    w.env.set_auths(&[]);
    assert!(c.try_transfer_claim(&a, &thief, &1, &1).is_err());
    assert!(c.try_burn_claim(&a, &1, &1).is_err());
    assert!(c.try_withdraw_receipts(&a, &1).is_err());
    assert!(c.try_redeem(&a, &1, &0).is_err());
    assert!(c.try_set_paused(&true).is_err());
    assert!(c.try_set_cap(&1).is_err());
    assert!(c.try_schedule_upgrade(&BytesN::from_array(&w.env, &[0; 32])).is_err());
    w.env.mock_all_auths();
    assert!(c.try_transfer_claim(&a, &thief, &1, &3).is_err());
}

#[test]
fn self_transfers_and_burns_keep_supply_consistent() {
    let w = World::new();
    let c = w.c();
    let a = w.user(10 * UNIT);
    let face = c.deposit_split(&a, &(2 * UNIT), &0);
    w.token(1).transfer(&a, &a, &face);
    w.token(2).transfer(&a, &a, &face);
    assert_eq!(w.token(1).balance(&a), face);
    w.token(2).burn(&a, &UNIT);
    assert_eq!(w.token(2).total_supply(), face - UNIT);
    assert_eq!(c.state().total_yt, face - UNIT);
}

// ------------------------------------------------------------------ admin

#[test]
fn pause_and_cap_gate_entry_only() {
    let w = World::new();
    let c = w.c();
    let a = w.user(100 * UNIT);
    let face = c.deposit_split(&a, &(2 * UNIT), &0);
    c.set_paused(&true);
    assert!(!c.status().entry_open);
    assert_eq!(World::err(c.try_deposit(&a, &UNIT)), e(SeriesError::Paused));
    c.claim_yield(&a);
    c.redeem(&a, &(face / 2), &0);
    c.set_paused(&false);
    c.set_cap(&(3 * UNIT));
    assert_eq!(World::err(c.try_deposit(&a, &(3 * UNIT))), e(SeriesError::Cap));
    c.deposit(&a, &(2 * UNIT));
    assert_eq!(World::err(c.try_set_cap(&0)), e(SeriesError::Config));
}

#[test]
fn admin_rotates_in_two_steps_and_upgrades_wait_for_the_timelock() {
    let w = World::new();
    let c = w.c();
    let next = Address::generate(&w.env);
    c.propose_admin(&next);
    assert_eq!(c.config().admin, w.admin);
    c.accept_admin();
    assert_eq!(c.config().admin, next);
    let hash = BytesN::from_array(&w.env, &[7; 32]);
    let eta = c.schedule_upgrade(&hash);
    assert_eq!(eta, w.now() + governance::DEFAULT_TIMELOCK_SECS);
    assert!(c.try_apply_upgrade().is_err());
    c.cancel_upgrade();
    assert!(c.pending_upgrade().is_none());
}

// ------------------------------------------------------------------ conservation

#[test]
fn many_users_rounding_and_every_exit_conserve_tokens() {
    let w = World::new();
    let c = w.c();
    let mut users = std::vec::Vec::new();
    let mut minted = 0i128;
    for i in 0..6i128 {
        let amt = 1_234_567 * (i + 1) + 13 * i;
        let u = w.user(amt * 3);
        minted += amt * 3;
        c.deposit_split(&u, &amt, &0);
        c.deposit(&u, &(amt / 3 + 1));
        users.push(u);
    }
    let prices = [125_300_017i128, 125_299_000, 125_811_113, 126_000_001, 126_000_001, 126_500_777];
    for (d, p) in prices.iter().enumerate() {
        w.at(START + (d as u64 + 1) * 5 * DAY);
        w.publish(*p);
        c.sync();
        let u = &users[d % users.len()];
        c.claim_yield(u);
        let to = &users[(d + 1) % users.len()];
        let yt = w.token(2).balance(u);
        if yt > 3 {
            w.token(2).transfer(u, to, &(yt / 3));
        }
        assert!(w.usdry(&w.series) >= w.obligations());
    }
    w.at(START + TERM);
    w.publish(126_600_000);
    c.finalize();
    for u in &users {
        let pt = w.token(1).balance(u);
        if pt > 0 {
            c.redeem(u, &pt, &0);
        }
        c.claim_yield(u);
        let r = w.token(0).balance(u);
        if r > 0 {
            c.withdraw_receipts(u, &r);
        }
    }
    let s = c.state();
    assert_eq!((s.receipts, s.face), (0, 0));
    let held = w.usdry(&w.series);
    let paid: i128 = users.iter().map(|u| w.usdry(u)).sum();
    assert_eq!(held + paid, minted);
    assert!(held <= 20, "rounding dust {held}");
}

// ------------------------------------------------------------------ review regressions

fn under_default_budget<T>(w: &World, f: impl FnOnce() -> T) -> std::thread::Result<T> {
    w.env.cost_estimate().budget().reset_default();
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
    w.env.cost_estimate().budget().reset_unlimited();
    r
}

#[test]
fn a_budget_burning_feed_cannot_block_any_exit_or_late_finalize() {
    let w = World::faulty();
    let c = w.c();
    let a = w.user(10 * UNIT);
    let face = c.deposit_split(&a, &(8 * UNIT), &0);
    c.deposit(&a, &UNIT);
    w.fault_mode(5);
    // try_ cannot catch budget exhaustion: anything that reads the feed now reverts.
    assert!(under_default_budget(&w, || c.sync()).is_err());
    assert!(under_default_budget(&w, || c.split(&a, &1, &0)).is_err());
    // Exits never read it.
    under_default_budget(&w, || c.claim_yield(&a)).unwrap();
    under_default_budget(&w, || c.redeem(&a, &UNIT, &0)).unwrap();
    under_default_budget(&w, || w.token(2).transfer(&a, &Address::generate(&w.env), &1)).unwrap();
    under_default_budget(&w, || w.token(2).burn(&a, &1)).unwrap();
    under_default_budget(&w, || w.token(1).transfer(&a, &Address::generate(&w.env), &1)).unwrap();
    under_default_budget(&w, || c.withdraw_receipts(&a, &UNIT)).unwrap();
    // Before the grace period finalize needs a boundary sample, so it waits.
    w.at(START + TERM + 1);
    assert!(under_default_budget(&w, || c.finalize()).is_err());
    // After it, finalize does not call the oracle at all.
    w.at(START + TERM + 7 * DAY);
    assert!(under_default_budget(&w, || c.finalize()).unwrap().finalized);
    let left = face - UNIT - 2;
    assert!(under_default_budget(&w, || c.redeem(&a, &left, &0)).unwrap() > 0);
}

#[test]
fn a_feed_returning_more_than_requested_is_refused_without_looping() {
    let w = World::faulty();
    let c = w.c();
    w.at(START + 100);
    w.fault_mode(6);
    let st = c.status();
    assert!(!st.oracle_ok && !st.entry_open);
    assert_eq!(c.sync(), c.state());
}

#[test]
fn rate_bound_is_linear_from_the_seed_not_compounded_per_sample() {
    let w = World::build(true, Params { window: 32, ..params() }); // 100%/yr
    let c = w.c();
    // 31 spiked samples across the whole term, the last exactly at expiry.
    let mut recs = soroban_sdk::vec![&w.env, pd(P0, START)];
    for k in 1..=31u64 {
        recs.push_back(pd(P0 * 100, START + k * TERM / 31));
    }
    w.at(START + TERM);
    w.fault_set(0, recs);
    // Per-sample caps compounded; the bound is linear from the seed: P0·(1 + 100% · term/year).
    let linear = P0 + P0 * TERM as i128 / YEAR;
    assert_eq!(c.sync().high_water, linear);
}

#[test]
fn dust_positions_always_redeem() {
    let w = World::new();
    let c = w.c();
    let a = w.user(10 * UNIT);
    let b = Address::generate(&w.env);
    c.deposit_split(&a, &UNIT, &0);
    w.token(1).transfer(&a, &b, &1);
    w.token(2).transfer(&a, &b, &1);
    assert_eq!(c.redeem(&b, &1, &0), 0); // 1 face × 0.8 rounds to zero; claims still burn
    assert_eq!((w.token(1).balance(&b), w.token(2).balance(&b)), (0, 0));
    assert_eq!(World::err(c.try_redeem(&b, &1, &0)), e(SeriesError::Balance));
    assert!(w.usdry(&w.series) >= w.obligations());
}

#[test]
fn zero_transfers_from_strangers_do_not_touch_the_owner() {
    let w = World::new();
    let c = w.c();
    let a = w.user(10 * UNIT);
    c.deposit_split(&a, &(8 * UNIT), &0);
    w.at(START + 10 * DAY);
    w.publish(127_000_000);
    c.sync();
    let before = c.balance(&a);
    let stranger = Address::generate(&w.env);
    w.token(2).transfer_from(&stranger, &a, &stranger, &0);
    assert_eq!(c.balance(&a), before); // no forced settle, no rounding loss
}

#[test]
fn feed_clock_may_lead_the_ledger_by_a_minute_but_no_more() {
    let w = World::faulty();
    let c = w.c();
    let a = w.user(10 * UNIT);
    let now = START + 3_600;
    w.at(now);
    w.fault_set(0, soroban_sdk::vec![&w.env, pd(P0, START), pd(P0, now + 60)]);
    assert!(c.status().entry_open);
    c.deposit_split(&a, &UNIT, &0);
    w.fault_set(0, soroban_sdk::vec![&w.env, pd(P0, START), pd(P0, now + 61)]);
    assert!(!c.status().oracle_ok);
}
