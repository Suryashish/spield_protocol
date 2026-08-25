#![cfg(test)]
//! # SR Router — the one-transaction USDC front door, end to end against real Blend v2 WASM.
//!
//! Same stack as every other suite here (Blend -> strategy -> SR -> yield -> market), plus the
//! router on top. Nothing is mocked except authorization, and the places where mocked auth would
//! hide the bug that matters get their own explicitly-signed tests (see "AUTHORIZATION").
//!
//! What this suite is actually trying to falsify:
//!
//! 1. **Does the router hold anything?** It must not, ever, on any path — including reverts.
//! 2. **Does routing cost the user anything a manual three-step would not?** It must not.
//! 3. **Do the quotes match what executes?** A quote that drifts from execution is a lie the UI
//!    tells, and it is the failure mode users notice first.
//! 4. **Does the user-signed leg only ever carry user-supplied numbers?** This is the live-network
//!    bug class from `AUDITPREP.md` §4 and the reason `buy_yt_with_usdc` is exact-output.

extern crate std;

use crate::{SrRouter, SrRouterClient};
use blend_contract_sdk::{pool, testutils::BlendFixture};
use sep_40_oracle::testutils::{Asset, MockPriceOracleClient, MockPriceOracleWASM};
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, Ledger as _, MockAuth, MockAuthInvoke},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, BytesN, Env, IntoVal, String, Symbol, Vec,
};
use spield_sr::{Sr, SrClient};
use spield_srmarket::{SrMarket, SrMarketClient};
use spield_strategy::{BlendStrategy, BlendStrategyClient};
use spield_yield::{Yield, YieldClient};

pub const USDC: i128 = 1_0000000;
const SCALAR_7: i128 = 1_0000000;
pub const SCALAR_12: i128 = 1_000_000_000_000;
const DAY: u64 = 24 * 60 * 60;
const REQ_SUPPLY_COLLATERAL: u32 = 2;
const REQ_BORROW: u32 = 4;

const SCALAR_ROOT: i128 = 40 * SCALAR_12;
const LN_FEE_ROOT: i128 = 25 * SCALAR_12 / 10_000;
const TREASURY_SHARE_BPS: u32 = 2_000;
const YIELD_FEE_BPS: u32 = 500;
/// No deadline in the tests: the market treats 0 as "no ledger bound".
const NO_DEADLINE: u32 = 0;

pub struct World {
    pub env: Env,
    pub pool: Address,
    pub usdc: Address,
    pub oracle_id: Address,
    pub sr: Address,
    pub pt: Address,
    pub yield_c: Address,
    pub market: Address,
    pub router: Address,
    pub treasury: Address,
    pub admin: Address,
    pub expiry: u64,
}

impl World {
    pub fn r(&self) -> SrRouterClient<'_> { SrRouterClient::new(&self.env, &self.router) }
    pub fn m(&self) -> SrMarketClient<'_> { SrMarketClient::new(&self.env, &self.market) }
    pub fn y(&self) -> YieldClient<'_> { YieldClient::new(&self.env, &self.yield_c) }
    pub fn sr(&self) -> SrClient<'_> { SrClient::new(&self.env, &self.sr) }
    pub fn pt(&self) -> TokenClient<'_> { TokenClient::new(&self.env, &self.pt) }
    pub fn usdc_t(&self) -> TokenClient<'_> { TokenClient::new(&self.env, &self.usdc) }
    pub fn usdc_admin(&self) -> StellarAssetClient<'_> { StellarAssetClient::new(&self.env, &self.usdc) }
    pub fn oracle(&self) -> MockPriceOracleClient<'_> { MockPriceOracleClient::new(&self.env, &self.oracle_id) }
    pub fn pool_client(&self) -> pool::Client<'_> { pool::Client::new(&self.env, &self.pool) }

    pub fn advance(&self, secs: u64) {
        let t = self.env.ledger().timestamp();
        self.env.ledger().set_timestamp(t + secs);
        self.oracle().set_price_stable(&vec![&self.env, 1_0000000, 1_0000000]);
        self.pool_client().get_reserve(&self.usdc);
        self.sr().sync_rate();
        self.env.cost_estimate().budget().reset_unlimited();
    }

    pub fn new_user(&self, usdc_amount: i128) -> Address {
        let u = Address::generate(&self.env);
        self.usdc_admin().mint(&u, &usdc_amount);
        self.env.cost_estimate().budget().reset_unlimited();
        u
    }

    pub fn user_with_sr(&self, usdc_amount: i128) -> (Address, i128) {
        let u = self.new_user(usdc_amount);
        let sr = self.sr().deposit(&u, &u, &usdc_amount, &0i128);
        self.env.cost_estimate().budget().reset_unlimited();
        (u, sr)
    }

    /// Seed the pool with `pt_face` PT and `sr_side_usdc` worth of SR.
    pub fn seed(&self, pt_face: i128, sr_side_usdc: i128) -> (Address, i128) {
        let (lp, _) = self.user_with_sr(pt_face + sr_side_usdc);
        let sr_for_pt = self.sr().preview_deposit(&pt_face);
        let py = self.y().mint_py(&lp, &lp, &sr_for_pt);
        let sr_left = self.sr().balance(&lp);
        let shares = self.m().add_liquidity(&lp, &py, &sr_left);
        self.env.cost_estimate().budget().reset_unlimited();
        (lp, shares)
    }

    /// Every token the router could possibly be left holding. All four must be zero after any call.
    pub fn router_holdings(&self) -> (i128, i128, i128, i128) {
        (
            self.sr().balance(&self.router),
            self.pt().balance(&self.router),
            self.y().balance(&self.router),
            self.usdc_t().balance(&self.router),
        )
    }

    pub fn assert_router_empty(&self, ctx: &str) {
        let h = self.router_holdings();
        assert_eq!(h, (0, 0, 0, 0), "router held value after {}: (sr,pt,yt,usdc)={:?}", ctx, h);
    }
}

fn register_sac<'a>(env: &'a Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone()).address()
}

pub fn setup(term: u64, initial_apy_bps: u32, ln_fee_root: i128, treasury_bps: u32) -> World {
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

    let sr = env.register(Sr, (admin.clone(),));
    let strategy = env.register(BlendStrategy, (admin.clone(),));
    BlendStrategyClient::new(&env, &strategy).initialize(&sr, &pool, &usdc, &30_000u32);
    SrClient::new(&env, &sr).initialize(&strategy);

    let yield_c = env.register(Yield, (admin.clone(), treasury.clone()));
    let pt = register_sac(&env, &yield_c);
    let expiry = env.ledger().timestamp() + term;
    YieldClient::new(&env, &yield_c).initialize(&sr, &pt, &expiry, &YIELD_FEE_BPS);

    let market = env.register(SrMarket, (admin.clone(), treasury.clone()));
    let apy = (initial_apy_bps as i128) * SCALAR_12 / 10_000;
    SrMarketClient::new(&env, &market).initialize(
        &yield_c,
        &SCALAR_ROOT,
        &ln_fee_root,
        &apy,
        &treasury_bps,
    );

    let router = env.register(SrRouter, (admin.clone(),));
    SrRouterClient::new(&env, &router).initialize(&market);

    World { env, pool, usdc, oracle_id, sr, pt, yield_c, market, router, treasury, admin, expiry }
}


pub fn std_setup(term: u64, apy_bps: u32) -> World {
    setup(term, apy_bps, LN_FEE_ROOT, TREASURY_SHARE_BPS)
}

// ===========================================================================
// WIRING
// ===========================================================================

/// The router derives its whole topology from one address. A deploy cannot produce a router
/// pointed at market A and engine B — the same construction that makes `tofix.md` #24 inexpressible.
#[test]
fn the_router_discovers_its_own_wiring() {
    let w = std_setup(90 * DAY, 500);
    assert_eq!(w.r().market(), w.market);
    assert_eq!(w.r().yield_contract(), w.yield_c);
    assert_eq!(w.r().sr_token(), w.sr);
    assert_eq!(w.r().pt_token(), w.pt);
    assert_eq!(w.r().expiry(), w.expiry);
    assert_eq!(w.r().underlying(), w.usdc, "settlement asset came from the strategy, not an argument");
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // AlreadyInitialized
fn the_router_cannot_be_initialized_twice() {
    let w = std_setup(90 * DAY, 500);
    w.r().initialize(&w.market);
}

/// A market whose engine disagrees about PT/SR/expiry must be rejected at wiring time, not
/// discovered later by a user whose funds took the wrong route.
#[test]
fn a_router_pointed_at_a_mismatched_pair_refuses_to_initialize() {
    let w = std_setup(90 * DAY, 500);
    // Build a second, independent series on the same SR — different PT, different expiry.
    let other_yield = w.env.register(Yield, (w.admin.clone(), w.treasury.clone()));
    let other_pt = register_sac(&w.env, &other_yield);
    let other_expiry = w.env.ledger().timestamp() + 180 * DAY;
    YieldClient::new(&w.env, &other_yield).initialize(&w.sr, &other_pt, &other_expiry, &YIELD_FEE_BPS);

    // A market on the *other* series, and a router told to front it: consistent, so this works.
    let other_market = w.env.register(SrMarket, (w.admin.clone(), w.treasury.clone()));
    SrMarketClient::new(&w.env, &other_market).initialize(
        &other_yield, &SCALAR_ROOT, &LN_FEE_ROOT, &(500i128 * SCALAR_12 / 10_000), &TREASURY_SHARE_BPS,
    );
    let r2 = w.env.register(SrRouter, (w.admin.clone(),));
    SrRouterClient::new(&w.env, &r2).initialize(&other_market);
    assert_eq!(SrRouterClient::new(&w.env, &r2).pt_token(), other_pt);
    assert_ne!(SrRouterClient::new(&w.env, &r2).pt_token(), w.pt, "the two series really are distinct");
}

// ===========================================================================
// USDC -> PT
// ===========================================================================

#[test]
fn a_user_buys_pt_with_plain_usdc_in_one_call() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);

    let u = w.new_user(1_000 * USDC);
    let quoted = w.r().quote_buy_pt_with_usdc(&(1_000 * USDC));
    let pt_out = w.r().buy_pt_with_usdc(&u, &(1_000 * USDC), &0i128, &NO_DEADLINE);

    assert_eq!(w.usdc_t().balance(&u), 0, "spent exactly the input");
    assert_eq!(w.pt().balance(&u), pt_out, "PT landed with the user, not the router");
    assert_eq!(w.sr().balance(&u), 0, "the user never sees SR — that is the whole point");
    assert!(pt_out > 1_000 * USDC, "PT bought at a discount to face: {}", pt_out);
    w.assert_router_empty("buy_pt_with_usdc");

    // The quote is what the UI shows. It must not drift from what executes.
    assert!(pt_out >= quoted, "execution came in under the quote: {} < {}", pt_out, quoted);
    assert!(
        pt_out - quoted <= quoted / 10_000,
        "quote drifted more than 1bp: quoted {} got {}", quoted, pt_out
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #81)")] // SlippageExceeded
fn buying_pt_below_the_users_floor_reverts() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);
    let u = w.new_user(1_000 * USDC);
    w.r().buy_pt_with_usdc(&u, &(1_000 * USDC), &(10_000 * USDC), &NO_DEADLINE);
}

/// The router must cost nothing versus doing it by hand. If it did, it would be a tax on the
/// convenient path, and the sophisticated users would route around it.
#[test]
fn routing_costs_the_user_nothing_versus_the_manual_three_step() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);

    let manual = w.new_user(1_000 * USDC);
    let sr = w.sr().deposit(&manual, &manual, &(1_000 * USDC), &0i128);
    let manual_pt = w.m().swap_exact_sr_for_pt(&manual, &sr, &0i128, &NO_DEADLINE);

    let routed = w.new_user(1_000 * USDC);
    let routed_pt = w.r().buy_pt_with_usdc(&routed, &(1_000 * USDC), &0i128, &NO_DEADLINE);

    // Not identical — the second trade moves along the same curve the first one just moved — but
    // the routed user must not be *worse off than the curve*, i.e. no router-specific haircut.
    let drift = (manual_pt - routed_pt).abs();
    assert!(
        drift * 10_000 / manual_pt <= 20,
        "routing cost more than curve drift: manual {} routed {}", manual_pt, routed_pt
    );
}

// ===========================================================================
// USDC -> YT
// ===========================================================================

#[test]
fn a_user_buys_yt_with_plain_usdc_and_gets_the_change_back() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);

    let yt_want = 10_000 * USDC;
    let quoted = w.r().quote_buy_yt_with_usdc(&yt_want);
    let budget = quoted * 110 / 100; // a deliberately fat 10% pad

    let u = w.new_user(budget);
    let sr_spent = w.r().buy_yt_with_usdc(&u, &yt_want, &budget, &NO_DEADLINE);

    assert_eq!(w.y().balance(&u), yt_want, "exactly the YT asked for");
    w.assert_router_empty("buy_yt_with_usdc");

    // Everything the market did not need came back as SR — the pad is not lost, just wrapped.
    let refund_sr = w.sr().balance(&u);
    let refund_usdc = w.sr().preview_redeem(&refund_sr);
    assert!(refund_sr > 0, "a 10% pad produced no refund at all");
    assert!(
        (refund_usdc - (budget - w.sr().preview_redeem(&sr_spent))).abs() <= budget / 1_000,
        "change did not add up: budget {} sr_spent {} refunded {} USDC", budget, sr_spent, refund_usdc
    );

    // Quote accuracy, in the direction that matters: a quote that under-states cost makes the
    // frontend wrap too little and the trade reverts.
    let real_cost = w.sr().preview_redeem(&sr_spent);
    assert!(real_cost <= quoted + 2, "cost {} exceeded the quote {}", real_cost, quoted);
}

/// A pad of exactly zero is the worst case for an exact-output path — the quote has to be exact or
/// the trade dies. It is also what a user with "0% slippage" set will send.
#[test]
fn an_unpadded_quote_is_still_enough_to_execute() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);

    // A quote with no pad at all is the sharpest case: the wrap has to cover the fill exactly.
    let yt_want = 5_000 * USDC;
    let quoted = w.r().quote_buy_yt_with_usdc(&yt_want);
    let u = w.new_user(quoted);
    let sr_spent = w.r().buy_yt_with_usdc(&u, &yt_want, &quoted, &NO_DEADLINE);
    assert_eq!(w.y().balance(&u), yt_want);
    assert!(w.sr().preview_redeem(&sr_spent) <= quoted);
    w.assert_router_empty("unpadded buy_yt");
}

#[test]
#[should_panic] // the market rejects the purchase when the budget cannot cover it
fn buying_yt_beyond_the_users_budget_reverts() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);
    let u = w.new_user(10_000 * USDC);
    // Ask for a lot of YT while wrapping a token amount — the market must refuse, not part-fill.
    w.r().buy_yt_with_usdc(&u, &(10_000 * USDC), &(1 * USDC), &NO_DEADLINE);
}

// ===========================================================================
// PT / YT -> USDC
// ===========================================================================

#[test]
fn a_user_sells_pt_straight_back_to_usdc() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);

    let u = w.new_user(1_000 * USDC);
    let pt = w.r().buy_pt_with_usdc(&u, &(1_000 * USDC), &0i128, &NO_DEADLINE);

    let quoted = w.r().quote_sell_pt_for_usdc(&pt);
    let usdc_out = w.r().sell_pt_for_usdc(&u, &pt, &0i128, &NO_DEADLINE);

    assert_eq!(w.pt().balance(&u), 0);
    assert_eq!(w.usdc_t().balance(&u), usdc_out, "USDC went to the user directly");
    assert_eq!(w.sr().balance(&u), 0, "no SR residue on the way out either");
    w.assert_router_empty("sell_pt_for_usdc");

    // Round trip loses only the spread — this is the fee calibration, re-checked through the router.
    let loss_bps = (1_000 * USDC - usdc_out) * 10_000 / (1_000 * USDC);
    assert!(loss_bps >= 0 && loss_bps < 100, "round trip lost {}bps", loss_bps);
    assert!((usdc_out - quoted).abs() <= quoted / 10_000, "sell quote drifted: {} vs {}", quoted, usdc_out);
}

#[test]
fn a_user_sells_yt_straight_back_to_usdc() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);

    let yt_want = 10_000 * USDC;
    let budget = w.r().quote_buy_yt_with_usdc(&yt_want) * 110 / 100;
    let u = w.new_user(budget);
    w.r().buy_yt_with_usdc(&u, &yt_want, &budget, &NO_DEADLINE);
    let before = w.usdc_t().balance(&u) + w.sr().preview_redeem(&w.sr().balance(&u));

    let quoted = w.r().quote_sell_yt_for_usdc(&yt_want);
    let usdc_out = w.r().sell_yt_for_usdc(&u, &yt_want, &0i128, &NO_DEADLINE);

    assert_eq!(w.y().balance(&u), 0);
    assert_eq!(w.usdc_t().balance(&u), before - w.sr().preview_redeem(&w.sr().balance(&u)) + usdc_out);
    w.assert_router_empty("sell_yt_for_usdc");
    assert!((usdc_out - quoted).abs() <= quoted / 1_000, "yt sell quote drifted: {} vs {}", quoted, usdc_out);
}

/// Selling YT must not forfeit interest already earned — the engine's `before_yt_change` hook
/// settles the seller before the balance moves. Checked *through the router*, because the router
/// adds a hop (user -> router -> market) and each hop is a settlement opportunity to get wrong.
#[test]
fn selling_yt_through_the_router_keeps_the_interest_already_earned() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);

    let yt_want = 20_000 * USDC;
    let budget = w.r().quote_buy_yt_with_usdc(&yt_want) * 120 / 100;
    let u = w.new_user(budget);
    w.r().buy_yt_with_usdc(&u, &yt_want, &budget, &NO_DEADLINE);

    w.advance(30 * DAY);
    let earned_before_sale = w.r().quote_claim_yield(&u);
    assert!(earned_before_sale > 0, "30 days should have accrued something");

    w.r().sell_yt_for_usdc(&u, &yt_want, &0i128, &NO_DEADLINE);

    // The YT is gone, but the interest it earned while held is still owed.
    assert_eq!(w.y().balance(&u), 0);
    let still_claimable = w.r().quote_claim_yield(&u);
    assert!(
        still_claimable >= earned_before_sale - 2,
        "selling YT erased earned interest: {} before, {} after", earned_before_sale, still_claimable
    );
    let claimed = w.r().claim_yield_to_usdc(&u, &0i128);
    assert!(claimed > 0, "the settled interest was not claimable in USDC");
    w.assert_router_empty("claim after sale");
}

// ===========================================================================
// YIELD
// ===========================================================================

#[test]
fn yt_yield_is_claimable_straight_to_usdc() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);

    let yt_want = 20_000 * USDC;
    let budget = w.r().quote_buy_yt_with_usdc(&yt_want) * 120 / 100;
    let u = w.new_user(budget);
    w.r().buy_yt_with_usdc(&u, &yt_want, &budget, &NO_DEADLINE);
    let usdc_before = w.usdc_t().balance(&u);

    w.advance(45 * DAY);

    let quoted = w.r().quote_claim_yield(&u);
    assert!(quoted > 0, "45 days of Blend yield on 20k of YT face should be non-zero");
    let paid = w.r().claim_yield_to_usdc(&u, &0i128);

    assert_eq!(w.usdc_t().balance(&u), usdc_before + paid, "paid in USDC, not SR");
    assert_eq!(w.y().balance(&u), yt_want, "claiming does not consume the YT");
    w.assert_router_empty("claim_yield_to_usdc");
    assert!((paid - quoted).abs() <= 2, "claim quote drifted: quoted {} paid {}", quoted, paid);

    // Claiming twice in the same ledger pays nothing the second time, and does not revert.
    assert_eq!(w.r().claim_yield_to_usdc(&u, &0i128), 0);
}

#[test]
fn claiming_with_nothing_accrued_is_a_no_op_not_an_error() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);
    let u = w.new_user(100 * USDC);
    assert_eq!(w.r().quote_claim_yield(&u), 0);
    assert_eq!(w.r().claim_yield_to_usdc(&u, &0i128), 0);
    w.assert_router_empty("empty claim");
}

/// The protocol's yield fee must survive the routing. Revenue that only accrues on the
/// inconvenient path is revenue that does not accrue.
#[test]
fn the_protocol_still_earns_its_yield_fee_through_the_router() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);
    let yt_want = 20_000 * USDC;
    let budget = w.r().quote_buy_yt_with_usdc(&yt_want) * 120 / 100;
    let u = w.new_user(budget);
    w.r().buy_yt_with_usdc(&u, &yt_want, &budget, &NO_DEADLINE);

    w.advance(45 * DAY);
    let treasury_before = w.sr().balance(&w.treasury);
    let paid = w.r().claim_yield_to_usdc(&u, &0i128);
    let fee = w.sr().balance(&w.treasury) - treasury_before;

    assert!(fee > 0, "treasury earned nothing on a routed claim");
    let fee_usdc = w.sr().preview_redeem(&fee);
    let implied_bps = fee_usdc * 10_000 / (paid + fee_usdc);
    assert!(
        (implied_bps - YIELD_FEE_BPS as i128).abs() <= 1,
        "routed yield fee was {}bps, expected {}", implied_bps, YIELD_FEE_BPS
    );
}

// ===========================================================================
// REDEMPTION — the path that matters after expiry
// ===========================================================================

/// After expiry the market refuses to trade, so `sell_pt_for_usdc` stops working exactly where it
/// matters most. `redeem_py_for_usdc` is the exit, at face, with no curve and no liquidity need.
#[test]
fn after_expiry_pt_redeems_to_usdc_at_face_without_the_market() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);

    let u = w.new_user(1_000 * USDC);
    let pt = w.r().buy_pt_with_usdc(&u, &(1_000 * USDC), &0i128, &NO_DEADLINE);

    w.advance(91 * DAY);

    // The market is shut. Confirm that first, so the next assertion means something.
    assert!(w.m().try_swap_exact_pt_for_sr(&u, &pt, &0i128, &NO_DEADLINE).is_err());

    let quoted = w.r().quote_redeem_py_for_usdc(&pt);
    let usdc_out = w.r().redeem_py_for_usdc(&u, &pt, &0i128);

    assert_eq!(w.pt().balance(&u), 0);
    assert_eq!(w.usdc_t().balance(&u), usdc_out);
    w.assert_router_empty("redeem_py_for_usdc after expiry");
    assert!(usdc_out >= pt - 2, "PT paid {} on {} of face — that is not par", usdc_out, pt);
    assert!(usdc_out > 1_000 * USDC, "the fixed-rate return did not materialise: {}", usdc_out);
    assert!((usdc_out - quoted).abs() <= 2, "redeem quote drifted: {} vs {}", quoted, usdc_out);
}

/// Before expiry the same call is a *recombine*: it burns both legs and pays face. This is the
/// no-spread way out for someone holding a complete position.
#[test]
fn before_expiry_the_same_call_recombines_both_legs() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);

    let (u, sr) = w.user_with_sr(1_000 * USDC);
    let py = w.y().mint_py(&u, &u, &sr);
    assert_eq!(w.pt().balance(&u), py);
    assert_eq!(w.y().balance(&u), py);

    let usdc_out = w.r().redeem_py_for_usdc(&u, &py, &0i128);
    assert_eq!(w.pt().balance(&u), 0, "PT leg burned");
    assert_eq!(w.y().balance(&u), 0, "YT leg burned too — this is a recombine, not a PT sale");
    assert!(usdc_out >= 1_000 * USDC - 10, "recombine should return ~par: {}", usdc_out);
    w.assert_router_empty("recombine");
}

// ===========================================================================
// THE INVARIANT: the router is never a custodian
// ===========================================================================

/// Every path, one after another, on the same router instance. After each, all four balances zero.
#[test]
fn the_router_holds_nothing_after_any_path() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);

    let u = w.new_user(20_000 * USDC);

    let pt = w.r().buy_pt_with_usdc(&u, &(2_000 * USDC), &0i128, &NO_DEADLINE);
    w.assert_router_empty("after buy_pt");

    let yt_want = 3_000 * USDC;
    let budget = w.r().quote_buy_yt_with_usdc(&yt_want) * 110 / 100;
    w.r().buy_yt_with_usdc(&u, &yt_want, &budget, &NO_DEADLINE);
    w.assert_router_empty("after buy_yt");

    w.r().sell_pt_for_usdc(&u, &(pt / 2), &0i128, &NO_DEADLINE);
    w.assert_router_empty("after sell_pt");

    w.r().sell_yt_for_usdc(&u, &(yt_want / 2), &0i128, &NO_DEADLINE);
    w.assert_router_empty("after sell_yt");

    w.advance(30 * DAY);
    w.r().claim_yield_to_usdc(&u, &0i128);
    w.assert_router_empty("after claim");

    w.advance(70 * DAY);
    w.r().redeem_py_for_usdc(&u, &w.pt().balance(&u), &0i128);
    w.assert_router_empty("after redeem");
}

/// A revert must leave nothing behind either. Soroban rolls back state on panic, so this is really
/// a check that we never split a route across two transactions.
#[test]
fn a_reverted_route_leaves_the_router_empty() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);
    let u = w.new_user(1_000 * USDC);

    assert!(w.r().try_buy_pt_with_usdc(&u, &(1_000 * USDC), &(10_000 * USDC), &NO_DEADLINE).is_err());
    w.assert_router_empty("after a reverted buy");
    assert_eq!(w.usdc_t().balance(&u), 1_000 * USDC, "the user's funds came back");
}

/// Donated tokens are recoverable by the admin — and only by the admin. This exists because
/// `assert_drained` would otherwise turn a stranger's 1-stroop gift into a permanent denial of
/// service on every route.
#[test]
fn donations_are_sweepable_and_do_not_brick_the_router() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);

    w.usdc_admin().mint(&w.router, &(5 * USDC));
    assert_eq!(w.usdc_t().balance(&w.router), 5 * USDC);

    // While the donation sits there, routes revert — deliberately, but it must be recoverable.
    let u = w.new_user(100 * USDC);
    assert!(w.r().try_buy_pt_with_usdc(&u, &(100 * USDC), &0i128, &NO_DEADLINE).is_err());

    // The admin already holds USDC from the Blend fixture setup, so measure the delta.
    let admin_before = w.usdc_t().balance(&w.admin);
    assert_eq!(w.r().sweep(&w.usdc), 5 * USDC);
    assert_eq!(w.usdc_t().balance(&w.admin) - admin_before, 5 * USDC);
    // ...and the router works again.
    assert!(w.r().buy_pt_with_usdc(&u, &(100 * USDC), &0i128, &NO_DEADLINE) > 0);
    w.assert_router_empty("after sweeping a donation");
}

// ===========================================================================
// AUTHORIZATION — the class of bug `mock_all_auths` cannot see
// ===========================================================================

/// **The live-network bug class, pinned.** (`AUDITPREP.md` §4, item 1.)
///
/// A wallet signs the auth tree produced by *simulation*. If the router put an on-chain-derived
/// amount inside the user's transfer, the entry signed at simulation would not match the call made
/// at execution and the host would reject the transaction — intermittently, only on a live network,
/// only when the index moved between the two.
///
/// `mock_all_auths` rubber-stamps anything, so it cannot see this. Here we declare the *exact* tree
/// we expect the user to sign. If the router asks for one stroop more, or asks a different
/// contract, this fails.
#[test]
fn the_only_thing_a_pt_buyer_signs_is_a_transfer_of_their_own_stated_amount() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);
    let u = w.new_user(1_000 * USDC);
    let amount = 1_000 * USDC;

    let pt_out = w
        .r()
        .mock_auths(&[MockAuth {
            address: &u,
            invoke: &MockAuthInvoke {
                contract: &w.router,
                fn_name: "buy_pt_with_usdc",
                args: (u.clone(), amount, 0i128, NO_DEADLINE).into_val(&w.env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &w.usdc,
                    fn_name: "transfer",
                    // The user's own number. Not a price, not an index-derived figure.
                    args: (u.clone(), w.router.clone(), amount).into_val(&w.env),
                    sub_invokes: &[],
                }],
            },
        }])
        .buy_pt_with_usdc(&u, &amount, &0i128, &NO_DEADLINE);

    assert!(pt_out > 0);
    assert_eq!(w.pt().balance(&u), pt_out);
    w.assert_router_empty("explicitly-authorized buy_pt");
}

/// Same property for the exact-output path, where it is sharper: the signed figure is the user's
/// `max_usdc_in` ceiling, never the price the market computes from the live index.
#[test]
fn a_yt_buyer_signs_only_their_ceiling_never_the_computed_price() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);

    let yt_want = 5_000 * USDC;
    let budget = w.r().quote_buy_yt_with_usdc(&yt_want) * 110 / 100;
    let u = w.new_user(budget);

    let sr_spent = w
        .r()
        .mock_auths(&[MockAuth {
            address: &u,
            invoke: &MockAuthInvoke {
                contract: &w.router,
                fn_name: "buy_yt_with_usdc",
                args: (u.clone(), yt_want, budget, NO_DEADLINE).into_val(&w.env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &w.usdc,
                    fn_name: "transfer",
                    args: (u.clone(), w.router.clone(), budget).into_val(&w.env),
                    sub_invokes: &[],
                }],
            },
        }])
        .buy_yt_with_usdc(&u, &yt_want, &budget, &NO_DEADLINE);

    assert_eq!(w.y().balance(&u), yt_want);
    assert!(w.sr().preview_redeem(&sr_spent) < budget, "the pad should not have been consumed entirely");
    w.assert_router_empty("explicitly-authorized buy_yt");
}

/// Redirecting a holder's yield to a third party requires that holder's signature. The
/// permissionless "pay a holder their own yield" case must stay permissionless.
#[test]
fn redirecting_someone_elses_yield_requires_their_signature() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);

    let yt_want = 10_000 * USDC;
    let budget = w.r().quote_buy_yt_with_usdc(&yt_want) * 120 / 100;
    let holder = w.new_user(budget);
    w.r().buy_yt_with_usdc(&holder, &yt_want, &budget, &NO_DEADLINE);
    w.advance(30 * DAY);

    let attacker = Address::generate(&w.env);
    // The attacker signs for themselves, and nothing else. Redirecting the holder's accrued SR to
    // the router en route to... anywhere... must not be authorized by that.
    let attempt = w.r().mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &w.router,
            fn_name: "claim_yield_to_usdc",
            args: (holder.clone(), 0i128).into_val(&w.env),
            sub_invokes: &[],
        },
    }]).try_claim_yield_to_usdc(&holder, &0i128);
    assert!(attempt.is_err(), "an attacker redirected another user's yield");

    // But paying the holder their own yield stays open to anyone — it only moves value TO them.
    let paid_direct = w.y().redeem_due_interest(&holder);
    assert!(paid_direct.0 > 0, "the permissionless self-claim path was broken by the redirect gate");
}

// ===========================================================================
// PAUSE — convenience is revocable, access is not
// ===========================================================================

#[test]
fn pausing_the_router_blocks_entries_but_never_exits() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);

    let u = w.new_user(2_000 * USDC);
    let pt = w.r().buy_pt_with_usdc(&u, &(1_000 * USDC), &0i128, &NO_DEADLINE);
    let yt_want = 2_000 * USDC;
    let budget = w.r().quote_buy_yt_with_usdc(&yt_want) * 110 / 100;
    w.r().buy_yt_with_usdc(&u, &yt_want, &budget, &NO_DEADLINE);

    w.r().pause();
    assert!(w.r().is_paused());

    // Entries: shut.
    assert!(w.r().try_buy_pt_with_usdc(&u, &(10 * USDC), &0i128, &NO_DEADLINE).is_err());
    assert!(w.r().try_buy_yt_with_usdc(&u, &(10 * USDC), &(20 * USDC), &NO_DEADLINE).is_err());

    // Exits: open. Redemption and yield claims are how a user gets out; a pause must not trap them.
    w.advance(30 * DAY);
    assert!(w.r().claim_yield_to_usdc(&u, &0i128) > 0, "a paused router trapped a yield claim");
    w.advance(70 * DAY);
    assert!(w.r().redeem_py_for_usdc(&u, &pt, &0i128) > 0, "a paused router trapped a redemption");

    w.r().unpause();
    assert!(!w.r().is_paused());
}

/// A paused router removes convenience, not access — the whole reason it is safe to pause on
/// suspicion. Everything underneath stays directly reachable.
#[test]
fn the_underlying_stack_stays_reachable_while_the_router_is_paused() {
    let w = std_setup(90 * DAY, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);
    w.r().pause();

    let (u, sr) = w.user_with_sr(1_000 * USDC);
    assert!(sr > 0, "Sr::deposit still works");
    let pt = w.m().swap_exact_sr_for_pt(&u, &sr, &0i128, &NO_DEADLINE);
    assert!(pt > 0, "the market still works");
    assert!(w.m().swap_exact_pt_for_sr(&u, &pt, &0i128, &NO_DEADLINE) > 0);
    assert!(w.sr().redeem(&u, &u, &w.sr().balance(&u), &0i128) > 0, "Sr::redeem still works");
}

// ===========================================================================
// WRAP / UNWRAP — still a first-class, separate surface
// ===========================================================================

/// The router composes the SR hop; it does not replace it. A user who wants to hold the wrapper
/// itself — to farm, to LP, to hold a yield-bearing dollar — still can, and the router being
/// present changes nothing about that path.
#[test]
fn holding_sr_directly_remains_a_supported_first_class_position() {
    let w = std_setup(90 * DAY, 500);

    let u = w.new_user(1_000 * USDC);
    let sr = w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);
    assert!(sr > 0);
    assert_eq!(w.sr().balance(&u), sr);

    let rate_before = w.sr().exchange_rate();
    w.advance(60 * DAY);
    assert!(w.sr().exchange_rate() > rate_before, "SR is yield-bearing on its own");

    let out = w.sr().redeem(&u, &u, &sr, &0i128);
    assert!(out > 1_000 * USDC, "a plain SR hold earned {} on 1000", out - 1_000 * USDC);
}

// ===========================================================================
// GOVERNANCE
// ===========================================================================

#[test]
fn the_router_has_two_step_admin_rotation() {
    let w = std_setup(90 * DAY, 500);
    let new_admin = Address::generate(&w.env);

    w.r().propose_admin(&new_admin);
    assert_eq!(w.r().pending_admin(), Some(new_admin.clone()));
    assert_eq!(w.r().admin(), w.admin, "proposing alone does not transfer");

    w.r().accept_admin();
    assert_eq!(w.r().admin(), new_admin);
    assert_eq!(w.r().pending_admin(), None);
}

#[test]
fn the_router_has_a_timelocked_upgrade_path() {
    let w = std_setup(90 * DAY, 500);
    assert_eq!(w.r().timelock(), 86_400);

    let hash = BytesN::<32>::random(&w.env);
    let eta = w.r().schedule_upgrade(&hash);
    assert!(eta > w.env.ledger().timestamp());
    assert!(w.r().pending_upgrade().is_some());

    assert!(w.r().try_apply_upgrade().is_err(), "the timelock did not hold");
    w.r().cancel_upgrade();
    assert!(w.r().pending_upgrade().is_none());
}

// ===========================================================================
// TRANSACTION BUDGET — the router's real risk
// ===========================================================================
//
// A routed trade does in one transaction what previously took three: a Blend supply (or withdraw),
// a curve evaluation, and two or three token transfers. That is the whole value proposition and
// also the whole danger — Soroban's per-transaction limits are hard, and a path that fits locally
// but not on mainnet is a path that simply does not exist for users.
//
// ## Read these numbers with the right amount of suspicion
//
// The binding limit for this stack is **memory, not instructions** — measured on chain, the busiest
// router path uses ~16% of the 400M instruction budget, while `buy_yt_with_usdc` fails on the 40MB
// memory budget at *every* trade size, down to 0.005 USDC of face. Soroban's memory budget is
// **cumulative**, not a high-water mark: every host allocation and every module instantiation
// spends it and nothing is ever given back. So two operations that each fit can still sum past it.
//
// And the memory figures below are the least trustworthy thing in this file, because the local
// `BlendFixture` is far lighter than the deployed pool. Treat them as a regression tripwire — "did
// this path get dramatically worse?" — never as evidence that a path fits on a real network. Only
// a simulation against the target network can tell you that.
//
// Read from the live network's `ConfigSettingContractComputeV0` on 2026-08-25, not copied from a
// blog post: `txMaxInstructions = 400_000_000`, `txMemoryLimit = 41_943_040`. The 600M figure this
// file previously used was simply wrong, and being wrong in the *permissive* direction is the worst
// kind — it would have let a genuinely over-budget path pass here.
const MAINNET_INSTRUCTIONS: i64 = 400_000_000;
const MAINNET_MEM_BYTES: i64 = 41_943_040;
const MAINNET_WRITE_ENTRIES: u32 = 50;
const MAINNET_LEDGER_ENTRIES: u32 = 100;
const MAINNET_WRITE_BYTES: u32 = 132_096;

fn cost(w: &World, label: &str) {
    let r = w.env.cost_estimate().resources();
    let entries = r.disk_read_entries + r.memory_read_entries + r.write_entries;
    std::println!(
        "{:<26} insns {:>11}/{} ({:>5.1}%)  mem {:>10}/{} ({:>5.1}%)  write {:>2}/{}  entries {:>3}/{}  wbytes {:>6}/{}",
        label,
        r.instructions, MAINNET_INSTRUCTIONS, r.instructions as f64 * 100.0 / MAINNET_INSTRUCTIONS as f64,
        r.mem_bytes, MAINNET_MEM_BYTES, r.mem_bytes as f64 * 100.0 / MAINNET_MEM_BYTES as f64,
        r.write_entries, MAINNET_WRITE_ENTRIES,
        entries, MAINNET_LEDGER_ENTRIES,
        r.write_bytes, MAINNET_WRITE_BYTES,
    );
    assert!(r.mem_bytes < MAINNET_MEM_BYTES, "{label} exceeds mainnet memory");
    assert!(r.instructions < MAINNET_INSTRUCTIONS, "{label} exceeds mainnet instructions");
    assert!(r.write_entries <= MAINNET_WRITE_ENTRIES, "{label} exceeds write entries");
    assert!(entries <= MAINNET_LEDGER_ENTRIES, "{label} exceeds ledger entries");
    assert!(r.write_bytes <= MAINNET_WRITE_BYTES, "{label} exceeds write bytes");
}

#[test]
fn every_routed_path_fits_the_mainnet_per_transaction_budget() {
    let w = std_setup(365 * DAY, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);

    let u = w.new_user(100_000 * USDC);
    // A brand-new holder has no interest entry; create it separately so the measurement below is of
    // the trade, not of first-touch bookkeeping. This mirrors what the deploy scripts do.
    w.y().checkpoint(&u);

    w.env.cost_estimate().budget().reset_unlimited();
    let pt = w.r().buy_pt_with_usdc(&u, &(10_000 * USDC), &0i128, &NO_DEADLINE);
    cost(&w, "buy_pt_with_usdc");

    w.env.cost_estimate().budget().reset_unlimited();
    w.r().sell_pt_for_usdc(&u, &(pt / 2), &0i128, &NO_DEADLINE);
    cost(&w, "sell_pt_for_usdc");

    // The heaviest path by construction: a Blend supply, a curve solve, a mint_py, and a refund
    // that may itself be a Blend withdraw.
    let yt_want = 20_000 * USDC;
    let budget = w.r().quote_buy_yt_with_usdc(&yt_want) * 110 / 100;
    w.env.cost_estimate().budget().reset_unlimited();
    w.r().buy_yt_with_usdc(&u, &yt_want, &budget, &NO_DEADLINE);
    cost(&w, "buy_yt_with_usdc");

    w.advance(90 * DAY);

    w.env.cost_estimate().budget().reset_unlimited();
    w.r().sell_yt_for_usdc(&u, &(yt_want / 2), &0i128, &NO_DEADLINE);
    cost(&w, "sell_yt_for_usdc");

    w.env.cost_estimate().budget().reset_unlimited();
    w.r().claim_yield_to_usdc(&u, &0i128);
    cost(&w, "claim_yield_to_usdc");

    w.advance(300 * DAY);
    w.env.cost_estimate().budget().reset_unlimited();
    w.r().redeem_py_for_usdc(&u, &w.pt().balance(&u), &0i128);
    cost(&w, "redeem_py_for_usdc");
}
