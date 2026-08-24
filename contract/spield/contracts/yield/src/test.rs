#![cfg(test)]
//! # PT/YT engine — end-to-end against the real Blend v2 WASM
//!
//! Same harness shape as the wrapper/market suites: a live Blend pool, the real strategy adapter,
//! the real SR token, and the real yield contract on top. Nothing about the yield path is mocked.
//!
//! The load-bearing tests are the **transfer-hook** ones. Everything else is plumbing; the hook is
//! the thing that makes YT a real token instead of a receipt.

extern crate std;

use crate::{Yield, YieldClient, MAX_YIELD_FEE_BPS};
use blend_contract_sdk::{pool, testutils::BlendFixture};
use sep_40_oracle::testutils::{Asset, MockPriceOracleClient, MockPriceOracleWASM};
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, BytesN, Env, String, Symbol, Vec,
};
use spield_sr::{Sr, SrClient};
use spield_strategy::{BlendStrategy, BlendStrategyClient};

pub const USDC: i128 = 1_0000000;
pub const SCALAR_7: i128 = 1_0000000;
pub const SCALAR_12: i128 = 1_000_000_000_000;
pub const YEAR: u64 = 365 * 24 * 60 * 60;
pub const DAY: u64 = 24 * 60 * 60;
const REQ_SUPPLY_COLLATERAL: u32 = 2;
const REQ_BORROW: u32 = 4;

pub struct World {
    pub env: Env,
    pub pool: Address,
    pub usdc: Address,
    pub oracle_id: Address,
    pub strategy: Address,
    pub sr: Address,
    pub pt: Address,
    pub yield_c: Address,
    pub treasury: Address,
    pub admin: Address,
    pub expiry: u64,
}

impl World {
    pub fn y(&self) -> YieldClient<'_> {
        YieldClient::new(&self.env, &self.yield_c)
    }
    pub fn sr(&self) -> SrClient<'_> {
        SrClient::new(&self.env, &self.sr)
    }
    pub fn pt(&self) -> TokenClient<'_> {
        TokenClient::new(&self.env, &self.pt)
    }
    pub fn usdc(&self) -> TokenClient<'_> {
        TokenClient::new(&self.env, &self.usdc)
    }
    pub fn usdc_admin(&self) -> StellarAssetClient<'_> {
        StellarAssetClient::new(&self.env, &self.usdc)
    }
    pub fn oracle(&self) -> MockPriceOracleClient<'_> {
        MockPriceOracleClient::new(&self.env, &self.oracle_id)
    }
    pub fn pool_client(&self) -> pool::Client<'_> {
        pool::Client::new(&self.env, &self.pool)
    }

    /// Advance the clock and refresh Blend so interest accrues into `b_rate`.
    pub fn advance(&self, secs: u64) {
        let t = self.env.ledger().timestamp();
        self.env.ledger().set_timestamp(t + secs);
        self.oracle()
            .set_price_stable(&vec![&self.env, 1_0000000, 1_0000000]);
        self.pool_client().get_reserve(&self.usdc);
        self.env.cost_estimate().budget().reset_unlimited();
    }

    pub fn new_user(&self, usdc_amount: i128) -> Address {
        let u = Address::generate(&self.env);
        self.usdc_admin().mint(&u, &usdc_amount);
        u
    }

    /// Fund a user with `usdc_amount` USDC and wrap all of it into SR. Returns (user, sr_minted).
    pub fn user_with_sr(&self, usdc_amount: i128) -> (Address, i128) {
        let u = self.new_user(usdc_amount);
        let sr = self.sr().deposit(&u, &u, &usdc_amount, &0i128);
        (u, sr)
    }

    /// Wrap USDC → SR → mint PT+YT. Returns (user, py_face).
    pub fn user_with_py(&self, usdc_amount: i128) -> (Address, i128) {
        let (u, sr) = self.user_with_sr(usdc_amount);
        let py = self.y().mint_py(&u, &u, &sr);
        (u, py)
    }
}

fn register_sac<'a>(env: &'a Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone()).address()
}

/// Build the whole Pendle-shaped stack: Blend → strategy → SR → yield (PT+YT).
pub fn setup(term: u64, yield_fee_bps: u32) -> World {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);
    env.cost_estimate().budget().reset_unlimited();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let blnd = register_sac(&env, &admin);
    let usdc = register_sac(&env, &admin);
    let xlm = register_sac(&env, &admin);

    let blend = BlendFixture::deploy(&env, &admin, &blnd, &usdc);

    let oracle_id = Address::generate(&env);
    env.register_at(&oracle_id, MockPriceOracleWASM, ());
    let oracle = MockPriceOracleClient::new(&env, &oracle_id);
    oracle.set_data(
        &admin,
        &Asset::Other(Symbol::new(&env, "USD")),
        &vec![&env, Asset::Stellar(xlm.clone()), Asset::Stellar(usdc.clone())],
        &7,
        &300,
    );
    oracle.set_price_stable(&vec![&env, 1_0000000, 1_0000000]);

    let pool = blend.pool_factory.deploy(
        &admin,
        &String::from_str(&env, "spield-pool"),
        &BytesN::<32>::random(&env),
        &oracle_id,
        &0_1000000,
        &6,
        &1_0000000,
    );
    let pool_client = pool::Client::new(&env, &pool);
    let mut cfg = blend_contract_sdk::testutils::default_reserve_config();
    cfg.index = 0;
    pool_client.queue_set_reserve(&xlm, &cfg);
    pool_client.set_reserve(&xlm);
    cfg.index = 1;
    pool_client.queue_set_reserve(&usdc, &cfg);
    pool_client.set_reserve(&usdc);
    blend.backstop.deposit(&admin, &pool, &50_000_0000000);
    pool_client.set_status(&3);
    pool_client.update_status();

    // A whale borrows so b_rate actually rises over time.
    let whale = Address::generate(&env);
    StellarAssetClient::new(&env, &xlm).mint(&whale, &(2_000_000 * SCALAR_7));
    StellarAssetClient::new(&env, &usdc).mint(&whale, &(2_000_000 * USDC));
    let reqs = Vec::from_array(
        &env,
        [
            pool::Request { request_type: REQ_SUPPLY_COLLATERAL, address: xlm.clone(), amount: 1_000_000 * SCALAR_7 },
            pool::Request { request_type: REQ_SUPPLY_COLLATERAL, address: usdc.clone(), amount: 500_000 * USDC },
            pool::Request { request_type: REQ_BORROW, address: usdc.clone(), amount: 300_000 * USDC },
        ],
    );
    pool_client.submit(&whale, &whale, &whale, &reqs);

    // SR first (it owns the Blend position), then the yield contract on top of it.
    let sr = env.register(Sr, (admin.clone(),));
    let strategy = env.register(BlendStrategy, (admin.clone(),));
    BlendStrategyClient::new(&env, &strategy).initialize(&sr, &pool, &usdc, &30_000u32);
    SrClient::new(&env, &sr).initialize(&strategy);

    let yield_c = env.register(Yield, (admin.clone(), treasury.clone()));
    let pt = register_sac(&env, &yield_c);
    let expiry = env.ledger().timestamp() + term;
    YieldClient::new(&env, &yield_c).initialize(&sr, &pt, &expiry, &yield_fee_bps);

    World { env, pool, usdc, oracle_id, strategy, sr, pt, yield_c, treasury, admin, expiry }
}

// ===========================================================================
// SR: the wrapper is a SHARE, and the rate is the yield
// ===========================================================================

#[test]
fn sr_is_a_share_token_whose_rate_grows() {
    let w = setup(YEAR, 0);
    let (u, sr) = w.user_with_sr(1_000 * USDC);
    let rate0 = w.sr().exchange_rate();
    assert!(sr > 0);
    assert_eq!(w.sr().balance(&u), sr);
    // assets == shares * rate
    let assets0 = w.sr().assets_of(&u);
    assert!((assets0 - 1_000 * USDC).abs() <= 2, "assets {assets0}");

    w.advance(180 * DAY);
    let rate1 = w.sr().exchange_rate();
    assert!(rate1 > rate0, "rate must grow: {rate0} -> {rate1}");
    // The SHARE count never changes; the value does. That is the whole point of SR.
    assert_eq!(w.sr().balance(&u), sr, "share count is constant");
    assert!(w.sr().assets_of(&u) > assets0, "value grows");
    std::println!(
        "SR: {} shares, rate {:.9} -> {:.9}, assets {:.4} -> {:.4}",
        sr,
        rate0 as f64 / 1e12,
        rate1 as f64 / 1e12,
        assets0 as f64 / USDC as f64,
        w.sr().assets_of(&u) as f64 / USDC as f64
    );
}

#[test]
fn sr_round_trips_to_underlying() {
    let w = setup(YEAR, 0);
    let (u, sr) = w.user_with_sr(1_000 * USDC);
    assert_eq!(w.usdc().balance(&u), 0);
    let out = w.sr().redeem(&u, &u, &sr, &0i128);
    assert!((out - 1_000 * USDC).abs() <= 2, "round trip {out}");
    assert_eq!(w.sr().balance(&u), 0);
}

#[test]
fn sr_exchange_rate_never_goes_down() {
    let w = setup(YEAR, 0);
    let mut last = w.sr().exchange_rate();
    for _ in 0..12 {
        w.advance(30 * DAY);
        let r = w.sr().exchange_rate();
        assert!(r >= last, "SR rate must be monotonic: {last} -> {r}");
        last = r;
    }
}

#[test]
fn sr_transfers_like_any_token() {
    let w = setup(YEAR, 0);
    let (a, sr) = w.user_with_sr(1_000 * USDC);
    let b = Address::generate(&w.env);
    w.sr().transfer(&a, &b, &(sr / 2));
    assert_eq!(w.sr().balance(&b), sr / 2);
    assert_eq!(w.sr().balance(&a), sr - sr / 2);
}

// ===========================================================================
// mint_py / redeem_py
// ===========================================================================

#[test]
fn mint_py_creates_equal_pt_and_yt() {
    let w = setup(YEAR, 0);
    let (u, py) = w.user_with_py(1_000 * USDC);
    assert!(py > 0);
    assert_eq!(w.pt().balance(&u), py, "PT face");
    assert_eq!(w.y().balance(&u), py, "YT face");
    assert_eq!(w.y().total_py(), py);
    assert_eq!(w.sr().balance(&u), 0, "all SR went in");
    // Face is in ASSET units, so ~= the USDC deposited.
    assert!((py - 1_000 * USDC).abs() <= 2, "py {py}");
}

#[test]
fn redeem_py_before_expiry_burns_both_legs() {
    let w = setup(YEAR, 0);
    let (u, py) = w.user_with_py(1_000 * USDC);
    let sr_out = w.y().redeem_py(&u, &u, &py);
    assert!(sr_out > 0);
    assert_eq!(w.pt().balance(&u), 0);
    assert_eq!(w.y().balance(&u), 0);
    assert_eq!(w.y().total_py(), 0);
    let back = w.sr().redeem(&u, &u, &sr_out, &0i128);
    assert!((back - 1_000 * USDC).abs() <= 3, "full round trip {back}");
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")] // InsufficientBalance — no YT to burn
fn redeem_py_before_expiry_requires_the_yt_leg_too() {
    let w = setup(YEAR, 0);
    let (u, py) = w.user_with_py(1_000 * USDC);
    // Give the YT away; the PT alone must not redeem before expiry.
    let other = Address::generate(&w.env);
    w.y().transfer(&u, &other, &py);
    w.y().redeem_py(&u, &u, &py);
}

// ===========================================================================
// THE TRANSFER HOOK — the reason YT is a custom token at all
// ===========================================================================

#[test]
fn a_yt_transfer_settles_both_sides_and_the_yield_follows_the_token() {
    let w = setup(YEAR, 0);
    let (alice, py) = w.user_with_py(10_000 * USDC);
    let bob = Address::generate(&w.env);

    // Phase 1: Alice holds everything for 120 days.
    w.advance(120 * DAY);
    let alice_earned_phase1 = w.y().claimable_interest(&alice);
    assert!(alice_earned_phase1 > 0);

    // Hand every YT to Bob. The hook settles both.
    w.y().transfer(&alice, &bob, &py);
    assert_eq!(w.y().balance(&bob), py);
    assert_eq!(w.y().balance(&alice), 0);

    // Alice keeps EXACTLY what she earned; Bob starts at zero.
    assert_eq!(w.y().claimable_interest(&alice), alice_earned_phase1);
    assert_eq!(w.y().claimable_interest(&bob), 0, "Bob inherits no history");

    // Phase 2: Bob holds for 120 days.
    w.advance(120 * DAY);
    let bob_earned = w.y().claimable_interest(&bob);
    assert!(bob_earned > 0, "Bob earns from here forward");
    assert_eq!(
        w.y().claimable_interest(&alice),
        alice_earned_phase1,
        "Alice earns NOTHING after giving up the token"
    );

    // Both can withdraw independently.
    let (a_paid, _) = w.y().redeem_due_interest(&alice);
    let (b_paid, _) = w.y().redeem_due_interest(&bob);
    assert_eq!(a_paid, alice_earned_phase1);
    assert_eq!(b_paid, bob_earned);
    std::println!(
        "hook: Alice earned {:.6} SR over 120d then transferred; Bob earned {:.6} SR over the next 120d",
        a_paid as f64 / USDC as f64,
        b_paid as f64 / USDC as f64
    );
}

/// The v1 failure this whole redesign exists to remove. In the SAC-based wrapper, Alice could
/// transfer away every YT and still claim all the yield, while the recipient claimed nothing
/// (`tofix.md` #15). Here that is impossible.
#[test]
fn the_v1_stranding_bug_is_gone() {
    let w = setup(YEAR, 0);
    let (alice, py) = w.user_with_py(10_000 * USDC);
    let bob = Address::generate(&w.env);
    w.y().transfer(&alice, &bob, &py);

    w.advance(180 * DAY);
    let (alice_paid, _) = w.y().redeem_due_interest(&alice);
    let (bob_paid, _) = w.y().redeem_due_interest(&bob);

    assert_eq!(alice_paid, 0, "a holder with no YT earns nothing");
    assert!(bob_paid > 0, "the token holder earns everything");
}

#[test]
fn a_partial_yt_transfer_splits_future_yield_pro_rata() {
    let w = setup(YEAR, 0);
    let (alice, py) = w.user_with_py(10_000 * USDC);
    let bob = Address::generate(&w.env);
    w.advance(90 * DAY);
    let phase1 = w.y().claimable_interest(&alice);

    w.y().transfer(&alice, &bob, &(py / 2));
    w.advance(90 * DAY);

    let a = w.y().claimable_interest(&alice);
    let b = w.y().claimable_interest(&bob);
    let a_phase2 = a - phase1;
    // Both held half for the same window, so their phase-2 earnings must match to rounding.
    assert!((a_phase2 - b).abs() <= 2, "phase2 alice {a_phase2} vs bob {b}");
    std::println!(
        "split: alice {:.6} (of which {:.6} pre-split), bob {:.6}",
        a as f64 / USDC as f64,
        phase1 as f64 / USDC as f64,
        b as f64 / USDC as f64
    );
}

#[test]
fn many_small_transfers_do_not_create_or_destroy_yield() {
    let w = setup(YEAR, 0);
    let (alice, py) = w.user_with_py(10_000 * USDC);
    let bob = Address::generate(&w.env);
    // Churn the token back and forth while time passes.
    for i in 0..10 {
        w.advance(20 * DAY);
        if i % 2 == 0 {
            w.y().transfer(&alice, &bob, &(py / 4));
        } else {
            w.y().transfer(&bob, &alice, &(py / 4));
        }
    }
    let total_claim = w.y().claimable_interest(&alice) + w.y().claimable_interest(&bob);
    // Whatever the split, every claim (settled AND unsettled) must be covered by the SR actually
    // held above PT cover. `solvency()` already nets out the settled part, so add it back.
    let (held, needed, surplus) = w.y().solvency();
    let coverage = surplus + w.y().total_accrued();
    assert!(
        total_claim <= coverage + 10,
        "claims {total_claim} must be covered by {coverage} (held {held}, needed {needed})"
    );
    let (a, _) = w.y().redeem_due_interest(&alice);
    let (b, _) = w.y().redeem_due_interest(&bob);
    assert!(a + b > 0);
    std::println!("after 10 churned transfers: alice {a}, bob {b}, sum {} <= coverage {coverage}", a + b);
}

// ===========================================================================
// accrual correctness
// ===========================================================================

#[test]
fn a_fresh_holder_never_inherits_history() {
    let w = setup(YEAR, 0);
    let (alice, _) = w.user_with_py(10_000 * USDC);
    w.advance(180 * DAY);
    let alice_180d = w.y().claimable_interest(&alice);
    assert!(alice_180d > 0);

    // A brand-new minter joining late starts at exactly zero...
    let (bob, _) = w.user_with_py(10_000 * USDC);
    assert_eq!(w.y().claimable_interest(&bob), 0, "zero at the instant of mint");

    // ...and after another 180 days has earned only the SECOND window, never the first.
    w.advance(180 * DAY);
    let bob_total = w.y().claimable_interest(&bob);
    let alice_total = w.y().claimable_interest(&alice);
    let alice_window2 = alice_total - alice_180d;
    assert!(bob_total > 0, "Bob earns from his own start");
    assert!(
        (bob_total - alice_window2).abs() <= 2,
        "same balance, same window: bob {bob_total} vs alice's second window {alice_window2}"
    );
    assert!(
        alice_total > bob_total,
        "Alice has 360 days of yield, Bob only 180: {alice_total} vs {bob_total}"
    );
}

#[test]
fn topping_up_checkpoints_before_the_balance_grows() {
    let w = setup(YEAR, 0);
    let (u, _py) = w.user_with_py(10_000 * USDC);
    w.advance(120 * DAY);
    let before = w.y().claimable_interest(&u);
    assert!(before > 0);

    // Second mint into the SAME address.
    let extra = w.new_user(0);
    let _ = extra;
    w.usdc_admin().mint(&u, &(10_000 * USDC));
    let sr2 = w.sr().deposit(&u, &u, &(10_000 * USDC), &0i128);
    w.y().mint_py(&u, &u, &sr2);

    // The earlier yield is preserved exactly — not recomputed against the new, larger balance.
    assert_eq!(
        w.y().interest_of(&u).accrued,
        before,
        "the top-up settles the OLD balance first"
    );
}

#[test]
fn claiming_twice_does_not_pay_twice() {
    let w = setup(YEAR, 0);
    let (u, _) = w.user_with_py(10_000 * USDC);
    w.advance(180 * DAY);
    let (first, _) = w.y().redeem_due_interest(&u);
    assert!(first > 0);
    let (second, _) = w.y().redeem_due_interest(&u);
    assert_eq!(second, 0, "nothing left immediately after a claim");
    w.advance(60 * DAY);
    let (third, _) = w.y().redeem_due_interest(&u);
    assert!(third > 0, "but new yield still accrues");
}

#[test]
fn accrued_yield_survives_selling_every_last_yt() {
    let w = setup(YEAR, 0);
    let (u, py) = w.user_with_py(10_000 * USDC);
    w.advance(150 * DAY);
    let earned = w.y().claimable_interest(&u);
    assert!(earned > 0);

    // Dispose of ALL the YT without claiming.
    let sink = Address::generate(&w.env);
    w.y().transfer(&u, &sink, &py);
    assert_eq!(w.y().balance(&u), 0);

    // The credit is still there, and still payable.
    assert_eq!(w.y().interest_of(&u).accrued, earned);
    let (paid, _) = w.y().redeem_due_interest(&u);
    assert_eq!(paid, earned, "credited yield outlives the token");
}

// ===========================================================================
// expiry
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #101)")] // SeriesExpired
fn mint_py_is_refused_after_expiry() {
    let w = setup(90 * DAY, 0);
    let (u, sr) = w.user_with_sr(1_000 * USDC);
    w.env.ledger().set_timestamp(w.expiry + 1);
    w.y().mint_py(&u, &u, &sr);
}

#[test]
fn after_expiry_pt_alone_redeems_and_yt_is_not_required() {
    let w = setup(90 * DAY, 0);
    let (u, py) = w.user_with_py(10_000 * USDC);
    // Give away every YT, then expire.
    let other = Address::generate(&w.env);
    w.y().transfer(&u, &other, &py);
    w.advance(91 * DAY);
    assert!(w.env.ledger().timestamp() >= w.expiry);

    // PT-only redemption works — matching Pendle's `if (!isExpired()) _burn(...)`.
    let sr_out = w.y().redeem_py(&u, &u, &py);
    assert!(sr_out > 0);
    assert_eq!(w.pt().balance(&u), 0);
    // The YT holder still has their (now worthless) YT and their accrued claim.
    assert_eq!(w.y().balance(&other), py);
}

#[test]
fn yt_stops_earning_at_expiry_but_earlier_yield_stays_claimable_forever() {
    let w = setup(90 * DAY, 0);
    let (u, _) = w.user_with_py(10_000 * USDC);
    w.advance(89 * DAY);
    let pre = w.y().claimable_interest(&u);
    assert!(pre > 0);

    w.advance(2 * DAY); // past expiry
    w.y().stamp_expiry_index();
    let at_expiry = w.y().claimable_interest(&u);

    w.advance(200 * DAY);
    let long_after = w.y().claimable_interest(&u);
    assert_eq!(at_expiry, long_after, "a matured YT earns nothing more");

    let (paid, _) = w.y().redeem_due_interest(&u);
    assert_eq!(paid, at_expiry, "and the pre-expiry yield is still payable");
    std::println!(
        "expiry: {:.6} SR earned by day 89, frozen at {:.6}, still claimable 200 days later",
        pre as f64 / USDC as f64,
        at_expiry as f64 / USDC as f64
    );
}

#[test]
fn the_expiry_index_is_stamped_once_and_never_moves() {
    let w = setup(90 * DAY, 0);
    let (_u, _) = w.user_with_py(1_000 * USDC);
    w.advance(91 * DAY);
    let first = w.y().stamp_expiry_index();
    w.advance(100 * DAY);
    let second = w.y().stamp_expiry_index();
    assert_eq!(first, second, "write-once");
    assert_eq!(w.y().expiry_index(), Some(first));
}

#[test]
#[should_panic(expected = "Error(Contract, #102)")] // SeriesNotExpired
fn the_expiry_index_cannot_be_stamped_early() {
    let w = setup(90 * DAY, 0);
    w.y().stamp_expiry_index();
}

// ===========================================================================
// protocol revenue
// ===========================================================================

#[test]
fn the_yield_fee_routes_to_the_treasury_and_the_rest_to_the_holder() {
    let w = setup(YEAR, 500); // 5%, Pendle's rate
    let (u, _) = w.user_with_py(100_000 * USDC);
    w.advance(300 * DAY);
    let gross = w.y().claimable_interest(&u);
    assert!(gross > 0);

    let (net, fee) = w.y().redeem_due_interest(&u);
    assert_eq!(net + fee, gross, "no yield is lost in the split");
    assert_eq!(fee, gross * 500 / 10_000, "exactly 5%");
    assert_eq!(w.sr().balance(&w.treasury), fee);
    assert_eq!(w.sr().balance(&u), net);
    std::println!(
        "yield fee: gross {:.6} SR -> holder {:.6} + treasury {:.6} (5%)",
        gross as f64 / USDC as f64,
        net as f64 / USDC as f64,
        fee as f64 / USDC as f64
    );
}

#[test]
fn a_zero_yield_fee_pays_the_holder_everything() {
    let w = setup(YEAR, 0);
    let (u, _) = w.user_with_py(100_000 * USDC);
    w.advance(300 * DAY);
    let gross = w.y().claimable_interest(&u);
    let (net, fee) = w.y().redeem_due_interest(&u);
    assert_eq!(fee, 0);
    assert_eq!(net, gross);
}

#[test]
#[should_panic(expected = "Error(Contract, #104)")] // FeeShareTooHigh
fn the_yield_fee_cannot_exceed_its_on_chain_ceiling() {
    let w = setup(YEAR, 0);
    w.y().set_yield_fee(&(MAX_YIELD_FEE_BPS + 1));
}

/// **The honest result, and it is not what we first assumed.**
///
/// A share-based PY design has no growing "post-expiry pot": every stroop above PT cover is owed
/// to some YT holder. So in a healthy series the sweep recovers ~nothing — and that is correct.
/// The first version of `sweep_surplus` returned a large number here by paying the treasury out of
/// holders' *unsettled* interest, which then tripped the solvency assertion on their next
/// withdrawal. This test pins the corrected behaviour.
#[test]
fn a_healthy_series_has_almost_nothing_to_sweep() {
    let w = setup(90 * DAY, 0);
    let (u, _py) = w.user_with_py(100_000 * USDC);
    w.advance(91 * DAY);
    w.y().stamp_expiry_index();
    w.advance(180 * DAY);

    let surplus = w.y().solvency().2;
    let swept = w.y().sweep_surplus();
    std::println!(
        "healthy series: surplus above PT cover = {} SR (ALL owed to YT), actually sweepable = {}",
        surplus, swept
    );
    assert!(
        swept * 1000 < surplus.max(1),
        "the sweep must not touch what YT holders are owed: swept {swept} vs surplus {surplus}"
    );
    // And the holder is still paid in full afterwards.
    let owed = w.y().claimable_interest(&u);
    let (paid, _) = w.y().redeem_due_interest(&u);
    assert_eq!(paid, owed);
    assert!(paid > 0);
}

/// Where the sweep DOES recover value: a holder who burns their YT abandons all future claim to
/// it. That value is then owed to nobody, and becomes real protocol revenue.
#[test]
fn abandoned_yt_becomes_sweepable_protocol_revenue() {
    let w = setup(90 * DAY, 0);
    let (u, py) = w.user_with_py(100_000 * USDC);
    w.advance(45 * DAY);
    // The holder walks away from the yield leg entirely (keeps the PT).
    w.y().burn(&u, &py);
    assert_eq!(w.y().balance(&u), 0);
    // They keep what they had already earned...
    let earned = w.y().interest_of(&u).accrued;
    assert!(earned > 0);

    w.advance(46 * DAY);
    w.y().stamp_expiry_index();
    let before = w.sr().balance(&w.treasury);
    let swept = w.y().sweep_surplus();
    assert!(swept > 0, "abandoned yield must be recoverable");
    assert_eq!(w.sr().balance(&w.treasury) - before, swept);
    std::println!("abandoned YT: treasury recovered {} SR", swept);

    // The abandoner's already-earned credit is untouched, and the PT still redeems.
    let (paid, _) = w.y().redeem_due_interest(&u);
    assert_eq!(paid, earned, "the sweep left the credited claim intact");
    assert!(w.y().redeem_py(&u, &u, &py) > 0, "PT still redeems at par");
}

#[test]
fn sweeping_can_never_take_pt_backing_or_a_credited_claim() {
    let w = setup(90 * DAY, 0);
    let (u, py) = w.user_with_py(100_000 * USDC);
    w.advance(91 * DAY);
    w.y().stamp_expiry_index();
    let owed = w.y().claimable_interest(&u);
    assert!(owed > 0);

    // Sweep WITHOUT the holder claiming first.
    w.y().sweep_surplus();

    // Their credited interest is still payable, and the PT still redeems.
    let (paid, _) = w.y().redeem_due_interest(&u);
    assert_eq!(paid, owed, "the sweep left the claim intact");
    let sr_out = w.y().redeem_py(&u, &u, &py);
    assert!(sr_out > 0, "PT still redeems at par");
}

// ===========================================================================
// solvency + guardrails
// ===========================================================================

#[test]
fn the_contract_stays_solvent_across_a_full_lifecycle() {
    let w = setup(180 * DAY, 500);
    let mut users = std::vec::Vec::new();
    for _ in 0..5 {
        let (u, py) = w.user_with_py(20_000 * USDC);
        users.push((u, py));
    }
    for step in 0..6 {
        w.advance(30 * DAY);
        let (held, needed, _) = w.y().solvency();
        assert!(held + 10 >= needed, "step {step}: held {held} < needed {needed}");
        // Some churn each step.
        if step % 2 == 0 {
            w.y().redeem_due_interest(&users[step % 5].0);
        } else {
            let (a, _) = &users[0];
            let (b, _) = &users[1];
            w.y().transfer(a, b, &(1_000 * USDC));
        }
    }
    let (held, needed, surplus) = w.y().solvency();
    assert!(held + 10 >= needed);
    std::println!("end of lifecycle: held {held}, needed {needed}, surplus {surplus}");
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")] // InvalidAmount
fn minting_zero_is_refused() {
    let w = setup(YEAR, 0);
    let (u, _) = w.user_with_sr(1_000 * USDC);
    w.y().mint_py(&u, &u, &0i128);
}

#[test]
fn checkpoint_credits_without_paying() {
    let w = setup(YEAR, 0);
    let (u, _) = w.user_with_py(10_000 * USDC);
    w.advance(90 * DAY);
    let earned = w.y().checkpoint(&u);
    assert!(earned > 0);
    assert_eq!(w.sr().balance(&u), 0, "checkpoint moves no SR");
    assert_eq!(w.y().interest_of(&u).accrued, earned);
    let (paid, _) = w.y().redeem_due_interest(&u);
    assert_eq!(paid, earned);
}

#[test]
fn a_stranger_cannot_move_someone_elses_yt() {
    use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
    use soroban_sdk::IntoVal;
    let w = setup(YEAR, 0);
    let (alice, py) = w.user_with_py(10_000 * USDC);
    let mallory = Address::generate(&w.env);
    let env = &w.env;
    env.mock_auths(&[MockAuth {
        address: &mallory,
        invoke: &MockAuthInvoke {
            contract: &w.yield_c,
            fn_name: "transfer",
            args: (alice.clone(), mallory.clone(), py).into_val(env),
            sub_invokes: &[],
        },
    }]);
    assert!(w.y().try_transfer(&alice, &mallory, &py).is_err());
    env.mock_all_auths();
    assert_eq!(w.y().balance(&alice), py);
}

#[test]
fn interest_math_matches_the_closed_form() {
    // 1 YT = a claim on the yield of 1 asset. Over an index move prev -> cur, a holder of
    // `face` YT earns `face*S12/prev - face*S12/cur` in SR. Check against real Blend numbers.
    let w = setup(YEAR, 0);
    let (u, py) = w.user_with_py(50_000 * USDC);
    let prev = w.y().py_index();
    w.advance(200 * DAY);
    let cur = w.y().py_index();
    let expected = (py as i128) * SCALAR_12 / prev - (py as i128) * SCALAR_12 / cur;
    let actual = w.y().claimable_interest(&u);
    assert!(
        (expected - actual).abs() <= 2,
        "closed form {expected} vs contract {actual}"
    );
    std::println!(
        "index {:.9} -> {:.9}; {} YT earned {} SR (closed form {})",
        prev as f64 / 1e12,
        cur as f64 / 1e12,
        py / USDC,
        actual,
        expected
    );
}

// ===========================================================================
// ADVERSARIAL — second pass. These are written to FAIL if the accounting is wrong.
// ===========================================================================

/// Self-transfer must be a no-op. The implementation writes `from` then reads `to`, so an
/// aliasing bug here would either double-credit the balance or destroy it.
#[test]
fn a_self_transfer_neither_creates_nor_destroys_yt_or_yield() {
    let w = setup(YEAR, 0);
    let (u, py) = w.user_with_py(10_000 * USDC);
    w.advance(90 * DAY);
    let before_claim = w.y().claimable_interest(&u);
    let before_supply = w.y().total_supply();

    w.y().transfer(&u, &u, &(py / 3));

    assert_eq!(w.y().balance(&u), py, "self-transfer must not change the balance");
    assert_eq!(w.y().total_supply(), before_supply, "nor the supply");
    assert_eq!(
        w.y().claimable_interest(&u),
        before_claim,
        "nor double-credit the interest"
    );
    let (held, needed, _) = w.y().solvency();
    assert!(held + 10 >= needed);
}

/// Property test: whatever sequence of mints, transfers, claims and redemptions happens, the SR
/// held must always cover PT at par plus every claim — settled AND unsettled.
#[test]
fn interest_is_conserved_under_adversarial_churn() {
    let w = setup(YEAR, 500);
    let mut holders = std::vec::Vec::new();
    for _ in 0..4 {
        let (u, py) = w.user_with_py(25_000 * USDC);
        holders.push((u, py));
    }

    let check = |label: &str| {
        let total_claim: i128 = holders
            .iter()
            .map(|(u, _)| w.y().claimable_interest(u))
            .sum();
        let (held, _needed, surplus) = w.y().solvency();
        let coverage = surplus + w.y().total_accrued();
        assert!(
            total_claim <= coverage + 20,
            "{label}: claims {total_claim} exceed coverage {coverage} (held {held})"
        );
    };

    for step in 0..12u64 {
        w.advance(20 * DAY);
        match step % 6 {
            0 => {
                w.y().transfer(&holders[0].0, &holders[1].0, &(3_000 * USDC));
            }
            1 => {
                w.y().redeem_due_interest(&holders[2].0);
            }
            2 => {
                w.y().transfer(&holders[1].0, &holders[3].0, &(1_500 * USDC));
            }
            3 => {
                w.y().checkpoint(&holders[0].0);
            }
            4 => {
                // partial recombine by a holder who still has both legs
                let (u, _) = &holders[3];
                let bal = w.y().balance(u).min(w.pt().balance(u));
                if bal > 1_000 * USDC {
                    w.y().redeem_py(u, u, &(500 * USDC));
                }
            }
            _ => {
                w.y().transfer(&holders[3].0, &holders[0].0, &(700 * USDC));
            }
        }
        check("step");
    }

    // Everyone withdraws; nothing may fail and solvency must hold at the end.
    for (u, _) in &holders {
        w.y().redeem_due_interest(u);
    }
    let (held, needed, _) = w.y().solvency();
    assert!(held + 20 >= needed, "final: held {held} needed {needed}");
    std::println!("adversarial churn survived 12 steps; final held {held}, needed {needed}");
}

/// Repeated no-op settles must not manufacture yield. Someone calling `checkpoint` in a tight loop
/// should extract nothing — every call re-reads the same index.
#[test]
fn hammering_checkpoint_extracts_nothing() {
    let w = setup(YEAR, 0);
    let (u, _) = w.user_with_py(10_000 * USDC);
    w.advance(90 * DAY);
    let baseline = w.y().claimable_interest(&u);
    for _ in 0..25 {
        w.y().checkpoint(&u);
    }
    assert_eq!(
        w.y().interest_of(&u).accrued,
        baseline,
        "25 checkpoints in the same instant must credit exactly one settlement"
    );
}

/// Splitting one big transfer into many small ones must not pay more than doing it once.
#[test]
fn slicing_transfers_cannot_beat_a_single_transfer() {
    let one = {
        let w = setup(YEAR, 0);
        let (a, py) = w.user_with_py(10_000 * USDC);
        let b = Address::generate(&w.env);
        w.advance(180 * DAY);
        w.y().transfer(&a, &b, &py);
        w.advance(180 * DAY);
        w.y().claimable_interest(&a) + w.y().claimable_interest(&b)
    };
    let many = {
        let w = setup(YEAR, 0);
        let (a, py) = w.user_with_py(10_000 * USDC);
        let b = Address::generate(&w.env);
        w.advance(180 * DAY);
        for _ in 0..50 {
            w.y().transfer(&a, &b, &(py / 50));
        }
        w.advance(180 * DAY);
        w.y().claimable_interest(&a) + w.y().claimable_interest(&b)
    };
    std::println!("one transfer: {one} SR total; 50 slices: {many} SR total");
    assert!(
        many <= one + 60,
        "slicing must not manufacture yield: {many} vs {one}"
    );
}

/// Many tiny claims must not beat one big claim (fee flooring must not be farmable in reverse,
/// and payout flooring must not leak).
#[test]
fn slicing_claims_cannot_beat_a_single_claim() {
    let single = {
        let w = setup(YEAR, 500);
        let (u, _) = w.user_with_py(50_000 * USDC);
        w.advance(360 * DAY);
        let (net, _) = w.y().redeem_due_interest(&u);
        net
    };
    let sliced = {
        let w = setup(YEAR, 500);
        let (u, _) = w.user_with_py(50_000 * USDC);
        let mut total = 0;
        for _ in 0..36 {
            w.advance(10 * DAY);
            let (net, _) = w.y().redeem_due_interest(&u);
            total += net;
        }
        total
    };
    std::println!("one claim: {single} SR net; 36 claims: {sliced} SR net");
    // Slicing can only lose to flooring, never win.
    assert!(sliced <= single + 40, "sliced {sliced} beat single {single}");
}

/// A donation of SR straight to the yield contract must not become anyone's yield — it should show
/// up as surplus, and be attributable, not silently inflate every holder's claim.
#[test]
fn a_direct_sr_donation_does_not_inflate_holder_claims() {
    let w = setup(YEAR, 0);
    let (u, _) = w.user_with_py(10_000 * USDC);
    w.advance(90 * DAY);
    let before = w.y().claimable_interest(&u);

    let (donor, sr) = w.user_with_sr(5_000 * USDC);
    w.sr().transfer(&donor, &w.yield_c, &sr);

    assert_eq!(
        w.y().claimable_interest(&u),
        before,
        "a donation must not change any holder's claim — the index drives it, not the balance"
    );
    let (held, needed, _) = w.y().solvency();
    assert!(held >= needed);
}

/// Burning YT must not release backing. It abandons the yield claim; the principal claim lives in
/// the PT, which the burner still holds.
#[test]
fn burning_yt_does_not_release_any_backing() {
    let w = setup(YEAR, 0);
    let (u, py) = w.user_with_py(10_000 * USDC);
    let sr_before = w.sr().balance(&w.yield_c);
    w.advance(60 * DAY);
    w.y().burn(&u, &(py / 2));
    assert_eq!(
        w.sr().balance(&w.yield_c),
        sr_before,
        "burning YT moves no SR"
    );
    assert_eq!(w.pt().balance(&u), py, "PT untouched");
    assert_eq!(w.y().total_py(), py, "PT liability untouched");
}

#[test]
fn overflow_sized_amounts_revert_cleanly_rather_than_wrapping() {
    let w = setup(YEAR, 0);
    let (u, _) = w.user_with_sr(1_000 * USDC);
    assert!(w.y().try_mint_py(&u, &u, &i128::MAX).is_err());
    assert!(w.y().try_mint_py(&u, &u, &(i128::MAX / 2)).is_err());
    let (u2, py) = w.user_with_py(1_000 * USDC);
    assert!(w.y().try_redeem_py(&u2, &u2, &i128::MAX).is_err());
    assert!(w.y().try_transfer(&u2, &u, &i128::MAX).is_err());
    assert_eq!(w.y().balance(&u2), py, "nothing moved");
}

#[test]
fn zero_and_negative_amounts_are_refused_everywhere() {
    let w = setup(YEAR, 0);
    let (u, py) = w.user_with_py(1_000 * USDC);
    let other = Address::generate(&w.env);
    for bad in [0i128, -1, -1_000] {
        assert!(w.y().try_mint_py(&u, &u, &bad).is_err(), "mint {bad}");
        assert!(w.y().try_redeem_py(&u, &u, &bad).is_err(), "redeem {bad}");
        assert!(w.y().try_transfer(&u, &other, &bad).is_err(), "transfer {bad}");
        assert!(w.y().try_burn(&u, &bad).is_err(), "burn {bad}");
    }
    assert_eq!(w.y().balance(&u), py);
}

/// The allowance path must obey the same hook and the same limits as a direct transfer.
#[test]
fn the_allowance_path_settles_interest_the_same_way() {
    let w = setup(YEAR, 0);
    let (alice, py) = w.user_with_py(10_000 * USDC);
    let spender = Address::generate(&w.env);
    let bob = Address::generate(&w.env);
    w.advance(120 * DAY);
    let alice_earned = w.y().claimable_interest(&alice);

    w.y().approve(&alice, &spender, &py, &(w.env.ledger().sequence() + 1000));
    assert_eq!(w.y().allowance(&alice, &spender), py);
    w.y().transfer_from(&spender, &alice, &bob, &py);

    assert_eq!(w.y().balance(&bob), py);
    assert_eq!(w.y().claimable_interest(&alice), alice_earned, "settled on the way out");
    assert_eq!(w.y().claimable_interest(&bob), 0, "no inherited history");
    assert_eq!(w.y().allowance(&alice, &spender), 0, "allowance consumed");
    // And it cannot be reused.
    assert!(w.y().try_transfer_from(&spender, &bob, &alice, &py).is_err());
}

#[test]
fn spending_more_than_the_allowance_is_refused() {
    let w = setup(YEAR, 0);
    let (alice, py) = w.user_with_py(10_000 * USDC);
    let spender = Address::generate(&w.env);
    w.y().approve(&alice, &spender, &(py / 2), &(w.env.ledger().sequence() + 1000));
    assert!(w.y().try_transfer_from(&spender, &alice, &spender, &py).is_err());
    assert_eq!(w.y().balance(&alice), py);
}

/// YT stays transferable after expiry (it is worthless, but not frozen), and doing so must not
/// resurrect accrual for either party.
#[test]
fn transferring_a_matured_yt_moves_no_yield() {
    let w = setup(90 * DAY, 0);
    let (a, py) = w.user_with_py(10_000 * USDC);
    w.advance(91 * DAY);
    w.y().stamp_expiry_index();
    let a_owed = w.y().claimable_interest(&a);
    assert!(a_owed > 0);

    let b = Address::generate(&w.env);
    w.y().transfer(&a, &b, &py);
    w.advance(200 * DAY);

    assert_eq!(w.y().claimable_interest(&a), a_owed, "seller keeps exactly what she earned");
    assert_eq!(w.y().claimable_interest(&b), 0, "a matured YT earns the buyer nothing");
}

/// A holder who never interacts for a whole long-dated term must still be able to claim. This
/// exercises the TTL bump on the interest entry (`tofix.md` #19's class of problem, one layer up).
#[test]
fn a_dormant_holder_can_still_claim_after_a_full_term() {
    let w = setup(YEAR, 0);
    let (u, _) = w.user_with_py(10_000 * USDC);
    // No interaction at all for the whole term.
    for _ in 0..12 {
        w.advance(30 * DAY);
    }
    let owed = w.y().claimable_interest(&u);
    assert!(owed > 0);
    let (paid, _) = w.y().redeem_due_interest(&u);
    assert_eq!(paid, owed);
}

/// `redeem_due_interest` is permissionless. That must never let a third party redirect the payout.
#[test]
fn anyone_may_trigger_a_claim_but_only_the_holder_is_paid() {
    let w = setup(YEAR, 0);
    let (u, _) = w.user_with_py(10_000 * USDC);
    let keeper = Address::generate(&w.env);
    w.advance(120 * DAY);
    let owed = w.y().claimable_interest(&u);
    let (paid, _) = w.y().redeem_due_interest(&u);
    assert_eq!(paid, owed);
    assert_eq!(w.sr().balance(&u), paid, "the holder got it");
    assert_eq!(w.sr().balance(&keeper), 0, "the caller got nothing");
}

/// Dust: a mint too small to produce any face must be refused, not silently swallow the SR.
#[test]
fn sub_dust_mints_are_refused_and_keep_the_users_sr() {
    let w = setup(YEAR, 0);
    let (u, sr) = w.user_with_sr(1_000 * USDC);
    let before = w.sr().balance(&u);
    // 0 SR in => must revert, not consume.
    assert!(w.y().try_mint_py(&u, &u, &0i128).is_err());
    assert_eq!(w.sr().balance(&u), before);
    // A genuine 1-stroop mint either works or reverts; it must never take SR without giving face.
    match w.y().try_mint_py(&u, &u, &1i128) {
        Ok(Ok(py)) => assert!(py > 0, "took 1 SR and gave zero face"),
        _ => assert_eq!(w.sr().balance(&u), before, "reverted without consuming"),
    }
    let _ = sr;
}
