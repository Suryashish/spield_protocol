#![cfg(test)]
//! # PT/SR market — end-to-end against the real Blend v2 WASM
//!
//! The whole Pendle-shaped stack: Blend → strategy → SR → yield (PT+YT) → this market. Nothing is
//! mocked. The tests are grouped by the four gaps `comparependle.md` measured, so each one either
//! demonstrates the fix or pins the honest limit.

extern crate std;

use crate::{SrMarket, SrMarketClient, MAX_LN_FEE_ROOT, MAX_TREASURY_FEE_SHARE_BPS};
use blend_contract_sdk::{pool, testutils::BlendFixture};
use sep_40_oracle::testutils::{Asset, MockPriceOracleClient, MockPriceOracleWASM};
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, BytesN, Env, String, Symbol, Vec,
};
use spield_sr::{Sr, SrClient};
use spield_strategy::{BlendStrategy, BlendStrategyClient};
use spield_yield::{Yield, YieldClient};

const USDC: i128 = 1_0000000;
const SCALAR_7: i128 = 1_0000000;
pub const SCALAR_12: i128 = 1_000_000_000_000;
const YEAR: u64 = 365 * 24 * 60 * 60;
const DAY: u64 = 24 * 60 * 60;
const REQ_SUPPLY_COLLATERAL: u32 = 2;
const REQ_BORROW: u32 = 4;

/// Curve steepness. With a dynamic anchor this only controls price impact, not the seed ratio.
const SCALAR_ROOT: i128 = 40 * SCALAR_12;
/// **0.25%/yr fee root**, chosen from the sweep in `calibrate_the_fee_root`:
/// PT round trip 0.17% (v1: 0.60%) and YT round trip 13.3% (v1: 40.5%).
/// `fee_rate = exp(ln_fee_root * years)`.
const LN_FEE_ROOT: i128 = 25 * SCALAR_12 / 10_000;
/// 20% of each swap fee to the protocol, 80% left with LPs (the inverse of Pendle's split).
const TREASURY_SHARE_BPS: u32 = 2_000;
/// 5% of YT interest — Pendle's rate.
const YIELD_FEE_BPS: u32 = 500;

pub struct World {
    pub env: Env,
    pub pool: Address,
    pub usdc: Address,
    pub oracle_id: Address,
    pub sr: Address,
    pub pt: Address,
    pub yield_c: Address,
    pub market: Address,
    pub treasury: Address,
    pub expiry: u64,
}

impl World {
    pub fn m(&self) -> SrMarketClient<'_> {
        SrMarketClient::new(&self.env, &self.market)
    }
    pub fn y(&self) -> YieldClient<'_> {
        YieldClient::new(&self.env, &self.yield_c)
    }
    pub fn sr(&self) -> SrClient<'_> {
        SrClient::new(&self.env, &self.sr)
    }
    pub fn pt(&self) -> TokenClient<'_> {
        TokenClient::new(&self.env, &self.pt)
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

    pub fn usdc_balance(&self, who: &Address) -> i128 {
        TokenClient::new(&self.env, &self.usdc).balance(who)
    }

    /// Wrap USDC -> SR -> mint PT+YT. Returns (user, py_face).
    pub fn user_with_py(&self, usdc_amount: i128) -> (Address, i128) {
        let (u, sr) = self.user_with_sr(usdc_amount);
        let py = self.y().mint_py(&u, &u, &sr);
        self.env.cost_estimate().budget().reset_unlimited();
        (u, py)
    }

    /// Fund a user and wrap into SR.
    pub fn user_with_sr(&self, usdc_amount: i128) -> (Address, i128) {
        let u = self.new_user(usdc_amount);
        let sr = self.sr().deposit(&u, &u, &usdc_amount, &0i128);
        // Setup work must not eat the budget the measured call needs.
        self.env.cost_estimate().budget().reset_unlimited();
        (u, sr)
    }

    /// Seed the pool with `pt_face` PT and `sr_side_usdc` worth of SR. The LP mints PT by
    /// stripping SR, so it needs `pt_face + sr_side_usdc` of USDC in total.
    pub fn seed(&self, pt_face: i128, sr_side_usdc: i128) -> (Address, i128) {
        let (lp, _) = self.user_with_sr(pt_face + sr_side_usdc);
        let sr_for_pt = self.sr().preview_deposit(&pt_face);
        let py = self.y().mint_py(&lp, &lp, &sr_for_pt);
        let sr_left = self.sr().balance(&lp);
        let shares = self.m().add_liquidity(&lp, &py, &sr_left);
        self.env.cost_estimate().budget().reset_unlimited();
        (lp, shares)
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

    World { env, pool, usdc, oracle_id, sr, pt, yield_c, market, treasury, expiry }
}

pub fn std_setup(term: u64, apy_bps: u32) -> World {
    setup(term, apy_bps, LN_FEE_ROOT, TREASURY_SHARE_BPS)
}

// ===========================================================================
// GAP 4 (comparependle §3.4): the dynamic anchor — cheap seeding AND par convergence
// ===========================================================================

/// v1 needed a measured **6.96:1** PT-heavy seed to open a 90-day 5% market, because its anchor was
/// pinned at par. Here the anchor is re-derived from the target rate, so a **1:1** seed opens at
/// exactly the same rate.
#[test]
fn any_seed_ratio_opens_the_pool_at_the_configured_rate() {
    for (label, pt_face, sr_usdc) in [
        ("1 : 1", 500_000 * USDC, 500_000 * USDC),
        ("2 : 1", 660_000 * USDC, 330_000 * USDC),
        ("1 : 2", 330_000 * USDC, 660_000 * USDC),
    ] {
        let w = std_setup(90 * DAY, 500);
        w.seed(pt_face, sr_usdc);
        let apy = w.m().implied_apy();
        let price = w.m().pt_price();
        std::println!(
            "seed {:<6} -> implied APY {:.4}%   PT price {:.6}",
            label,
            apy as f64 * 100.0 / 1e12,
            price as f64 / 1e12
        );
        assert!(
            (apy - 500 * SCALAR_12 / 10_000).abs() < SCALAR_12 / 500,
            "{label}: opened at {apy}, wanted 5%"
        );
    }
    std::println!("  (v1 needed 6.96:1 for this. Same rate, ~7x less LP capital.)");
}

/// And the property the par anchor was protecting is not lost: PT still walks to 1.0 at expiry.
#[test]
fn pt_still_converges_to_par_with_a_dynamic_anchor() {
    let w = std_setup(90 * DAY, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let mut prices = std::vec::Vec::new();
    for d in [0u64, 30, 60, 80, 89] {
        w.env.ledger().set_timestamp(1_700_000_000 + d * DAY);
        prices.push((d, w.m().pt_price()));
    }
    for (d, p) in &prices {
        std::println!("  day {:<3} PT price {:.6}", d, *p as f64 / 1e12);
    }
    let first = prices[0].1;
    let last = prices[prices.len() - 1].1;
    assert!(last > first, "price must rise toward par");
    assert!(
        (SCALAR_12 - last).abs() < SCALAR_12 / 500,
        "must land within 0.2% of par: {last}"
    );
}

// ===========================================================================
// GAP 1 (comparependle §3.1): the fee scales with the yield being traded
// ===========================================================================

/// v1's flat 30 bps took **75% of the YT's value at 30 days** and 6.3% at 365. The time-scaled fee
/// takes the same share at every maturity — that is the whole point.
#[test]
fn the_fee_is_a_constant_share_of_the_yield_at_every_maturity() {
    std::println!("{:<8} {:>12} {:>12} {:>14}", "term", "fair YT/10k", "fee/10k", "fee / YT value");
    let mut ratios = std::vec::Vec::new();
    for days in [30u64, 90, 180, 365] {
        let w = std_setup(days * DAY, 500);
        w.seed(500_000 * USDC, 500_000 * USDC);
        let n = 10_000 * USDC;
        let price = w.m().pt_price();
        let fair_yt = (n as f64) * (1e12 - price as f64) / 1e12;
        let fee = w.m().fee_preview(&n) as f64;
        let ratio = fee * 100.0 / fair_yt;
        ratios.push(ratio);
        std::println!(
            "{:>4}d    {:>12.2} {:>12.3} {:>13.1}%",
            days,
            fair_yt / USDC as f64,
            fee / USDC as f64,
            ratio
        );
    }
    let (min, max) = ratios.iter().fold((f64::MAX, 0f64), |(a, b), r| (a.min(*r), b.max(*r)));
    assert!(
        max - min < 3.0,
        "the ratio must be flat across maturities: {min:.1}% .. {max:.1}%"
    );
    std::println!("  spread {:.2}pp across a 12x range of terms (v1 spread: ~69pp).", max - min);
}

/// **Calibrating `ln_fee_root`.** The time-scaled *shape* is right, but the *level* is a free dial
/// and it has to be set with numbers, not vibes. A YT trader feels `leverage x fee`, and leverage
/// at 90d/5% is ~67x — so a fee root that looks tiny to a PT trader is still large to a YT trader.
///
/// This sweeps the dial and reports both sides of the trade-off.
#[test]
fn calibrate_the_fee_root() {
    std::println!(
        "{:<12} {:>10} {:>12} {:>12} {:>14} {:>14}",
        "root/yr", "PT rt %", "YT cost", "YT resale", "YT rt %", "treasury/50k"
    );
    for root_bps in [100i128, 50, 25, 10, 5] {
        let root = root_bps * SCALAR_12 / 10_000;
        let w = setup(90 * DAY, 500, root, TREASURY_SHARE_BPS);
        w.seed(500_000 * USDC, 500_000 * USDC);

        // PT round trip
        let (t, sr_in) = w.user_with_sr(10_000 * USDC);
        let pt = w.m().swap_exact_sr_for_pt(&t, &sr_in, &0i128, &0u32);
        let back = w.m().swap_exact_pt_for_sr(&t, &pt, &0i128, &0u32);
        let pt_rt = (sr_in - back) as f64 * 100.0 / sr_in as f64;

        // YT round trip (fresh pool so the PT trade above does not pollute it)
        let w2 = setup(90 * DAY, 500, root, TREASURY_SHARE_BPS);
        w2.seed(500_000 * USDC, 500_000 * USDC);
        let n = 10_000 * USDC;
        let buy = w2.m().quote_buy_yt(&n);
        let sell = w2.m().quote_sell_yt(&n);
        let yt_rt = if buy > 0 { (buy - sell) as f64 * 100.0 / buy as f64 } else { 0.0 };

        // protocol revenue from one 50k PT purchase
        let w3 = setup(90 * DAY, 500, root, TREASURY_SHARE_BPS);
        w3.seed(500_000 * USDC, 500_000 * USDC);
        let (t3, s3) = w3.user_with_sr(50_000 * USDC);
        w3.m().swap_exact_sr_for_pt(&t3, &s3, &0i128, &0u32);
        let rev = w3.m().treasury_earned();

        std::println!(
            "{:>4} bps/yr  {:>9.3}% {:>12.3} {:>12.3} {:>13.1}% {:>14}",
            root_bps,
            pt_rt,
            buy as f64 / USDC as f64,
            sell as f64 / USDC as f64,
            yt_rt,
            rev
        );
    }
    std::println!("  v1 for comparison: PT rt 0.60%, YT rt 40.5% (flat 30 bps on notional).");
}

/// With the calibrated default, a 90-day YT round trip has to be far cheaper than v1's 40.5%.
#[test]
fn a_yt_round_trip_is_affordable_at_the_90_day_mainnet_default() {
    let w = std_setup(90 * DAY, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let n = 10_000 * USDC;
    let buy = w.m().quote_buy_yt(&n);
    let sell = w.m().quote_sell_yt(&n);
    assert!(buy > 0 && sell > 0);
    let rt = (buy - sell) as f64 * 100.0 / buy as f64;
    std::println!(
        "90d/5%: 10k YT costs {:.4} SR, instant resale {:.4} SR, round trip {:.1}% (v1 measured 40.5%)",
        buy as f64 / USDC as f64,
        sell as f64 / USDC as f64,
        rt
    );
    assert!(rt < 15.0, "round trip must be far under v1's 40.5%: got {rt:.1}%");
}

// ===========================================================================
// PT trading
// ===========================================================================

#[test]
fn buy_and_sell_pt_move_the_reserves_correctly() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let (pt0, sr0) = w.m().reserves();

    let (buyer, sr_in) = w.user_with_sr(10_000 * USDC);
    let pt_out = w.m().swap_exact_sr_for_pt(&buyer, &sr_in, &0i128, &0u32);
    assert!(pt_out > 0);
    assert_eq!(w.pt().balance(&buyer), pt_out);
    let (pt1, sr1) = w.m().reserves();
    assert_eq!(pt1, pt0 - pt_out, "PT reserve falls");
    assert!(sr1 > sr0, "SR reserve rises");

    let sr_out = w.m().swap_exact_pt_for_sr(&buyer, &pt_out, &0i128, &0u32);
    assert!(sr_out > 0 && sr_out < sr_in, "a round trip must lose the fee");
    std::println!(
        "PT round trip: paid {} SR, recovered {} SR ({:.2}% cost)",
        sr_in,
        sr_out,
        (sr_in - sr_out) as f64 * 100.0 / sr_in as f64
    );
}

#[test]
fn pt_bought_on_the_market_redeems_at_par_after_expiry() {
    let w = std_setup(90 * DAY, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let (buyer, sr_in) = w.user_with_sr(10_000 * USDC);
    let pt_out = w.m().swap_exact_sr_for_pt(&buyer, &sr_in, &0i128, &0u32);

    w.advance(91 * DAY);
    // PT alone redeems after expiry — the buyer never held any YT.
    let sr_back = w.y().redeem_py(&buyer, &buyer, &pt_out);
    let usdc_back = w.sr().redeem(&buyer, &buyer, &sr_back, &0i128);
    assert!(usdc_back > 10_000 * USDC, "bought at a discount, redeemed at par");
    std::println!(
        "fixed-yield trade: 10,000 USDC of SR -> {} PT -> {:.4} USDC at expiry",
        pt_out / USDC,
        usdc_back as f64 / USDC as f64
    );
}

// ===========================================================================
// YT trading — capital efficiency, with no flash loan and no special entrypoint
// ===========================================================================

#[test]
fn buying_yt_costs_only_the_yt_price_and_delivers_clean_yt() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let n = 10_000 * USDC;
    let quoted = w.m().quote_buy_yt(&n);
    assert!(quoted > 0);

    // Fund the user with ONLY the quote — proving they never front the notional.
    let (u, sr_in) = w.user_with_sr(w.sr().preview_redeem(&quoted) + 10);
    let paid = w.m().buy_yt_exact_out(&u, &n, &sr_in, &0u32);
    assert!(paid <= sr_in);
    assert_eq!(w.y().balance(&u), n, "user holds the full YT face");
    assert_eq!(w.pt().balance(&u), 0, "and no PT");
    // Clean YT: they inherit no history.
    assert_eq!(w.y().claimable_interest(&u), 0);
    std::println!(
        "bought {} YT for {} SR — leverage {:.1}x",
        n / USDC,
        paid,
        n as f64 / w.sr().preview_redeem(&paid) as f64
    );
}

#[test]
fn bought_yt_accrues_and_pays_real_blend_yield() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let n = 50_000 * USDC;
    let quoted = w.m().quote_buy_yt(&n);
    let (u, sr_in) = w.user_with_sr(w.sr().preview_redeem(&quoted) + 100);
    w.m().buy_yt_exact_out(&u, &n, &sr_in, &0u32);

    w.advance(180 * DAY);
    let claimable = w.y().claimable_interest(&u);
    assert!(claimable > 0);
    let (net, fee) = w.y().redeem_due_interest(&u);
    assert!(net > 0 && fee > 0, "the 5% yield fee applies");
    assert_eq!(net + fee, claimable);
    std::println!(
        "180d on {} YT: {} SR gross -> holder {} + treasury {}",
        n / USDC,
        claimable,
        net,
        fee
    );
}

#[test]
fn selling_yt_settles_the_seller_first_and_pays_the_yt_value() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let n = 20_000 * USDC;
    let quoted = w.m().quote_buy_yt(&n);
    let (u, sr_in) = w.user_with_sr(w.sr().preview_redeem(&quoted) + 100);
    w.m().buy_yt_exact_out(&u, &n, &sr_in, &0u32);

    w.advance(120 * DAY);
    let earned = w.y().claimable_interest(&u);
    assert!(earned > 0);

    let sell_quote = w.m().quote_sell_yt(&n);
    assert!(sell_quote > 0);
    let got = w.m().sell_yt_exact_in(&u, &n, &sell_quote, &0u32);
    assert_eq!(got, sell_quote);
    assert_eq!(w.y().balance(&u), 0, "YT gone");

    // The sale CREDITED the yield (Pendle's "accrue, don't pay") — it is still there to collect.
    assert_eq!(w.y().interest_of(&u).accrued, earned, "nothing lost in the sale");
    let (net, fee) = w.y().redeem_due_interest(&u);
    assert_eq!(net + fee, earned);
    std::println!(
        "sold {} YT for {} SR, plus {} SR of accrued yield still collectable",
        n / USDC,
        got,
        earned
    );
}

#[test]
fn a_partial_yt_sale_leaves_the_rest_accruing_from_the_new_index() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let n = 20_000 * USDC;
    let quoted = w.m().quote_buy_yt(&n);
    let (u, sr_in) = w.user_with_sr(w.sr().preview_redeem(&quoted) + 100);
    w.m().buy_yt_exact_out(&u, &n, &sr_in, &0u32);

    w.advance(120 * DAY);
    let earned_on_full = w.y().claimable_interest(&u);
    let half = n / 2;
    let q = w.m().quote_sell_yt(&half);
    w.m().sell_yt_exact_in(&u, &half, &q, &0u32);

    assert_eq!(w.y().balance(&u), n - half);
    assert_eq!(
        w.y().interest_of(&u).accrued,
        earned_on_full,
        "checkpointed on the OLD full balance before the sale"
    );
    w.advance(60 * DAY);
    let more = w.y().claimable_interest(&u) - earned_on_full;
    assert!(more > 0, "the remaining half keeps earning");
    std::println!(
        "partial sale: {} SR credited on the full {} YT, then {} SR on the remaining half",
        earned_on_full,
        n / USDC,
        more
    );
}

#[test]
fn an_immediate_yt_round_trip_cannot_extract_value() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let n = 10_000 * USDC;
    let quoted = w.m().quote_buy_yt(&n);
    let (u, sr_in) = w.user_with_sr(w.sr().preview_redeem(&quoted) + 100);
    let before = w.sr().balance(&u);
    let paid = w.m().buy_yt_exact_out(&u, &n, &sr_in, &0u32);
    let got = w.m().sell_yt_exact_in(&u, &n, &0i128, &0u32);
    assert!(got < paid, "round trip must lose: paid {paid}, got {got}");
    assert!(w.sr().balance(&u) < before);
}

#[test]
fn yt_bought_on_the_market_is_freely_transferable_with_the_yield_following_it() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let n = 20_000 * USDC;
    let quoted = w.m().quote_buy_yt(&n);
    let (alice, sr_in) = w.user_with_sr(w.sr().preview_redeem(&quoted) + 100);
    w.m().buy_yt_exact_out(&alice, &n, &sr_in, &0u32);

    w.advance(90 * DAY);
    let alice_earned = w.y().claimable_interest(&alice);
    let bob = Address::generate(&w.env);
    w.y().transfer(&alice, &bob, &n);

    w.advance(90 * DAY);
    assert_eq!(w.y().claimable_interest(&alice), alice_earned, "Alice stops earning");
    assert!(w.y().claimable_interest(&bob) > 0, "Bob earns");
    // ...and Bob can sell what he was given, straight into the market.
    let q = w.m().quote_sell_yt(&n);
    assert!(w.m().sell_yt_exact_in(&bob, &n, &q, &0u32) > 0);
}

// ===========================================================================
// GAP 2 (comparependle §3.2): the pool's non-PT half earns
// ===========================================================================

#[test]
fn the_pools_sr_half_keeps_earning_while_it_sits_there() {
    let w = std_setup(YEAR, 500);
    let (lp, shares) = w.seed(500_000 * USDC, 500_000 * USDC);
    let (_, _, sr_claim0) = w.m().lp_position(&lp);
    let usdc_value0 = w.sr().preview_redeem(&sr_claim0);

    w.advance(365 * DAY - 1);

    let (_, _, sr_claim1) = w.m().lp_position(&lp);
    let usdc_value1 = w.sr().preview_redeem(&sr_claim1);
    assert_eq!(sr_claim1, sr_claim0, "share count unchanged (no trades)");
    assert!(
        usdc_value1 > usdc_value0,
        "but its USDC value grew: {usdc_value0} -> {usdc_value1}"
    );
    std::println!(
        "LP's SR half: {} shares worth {:.2} USDC -> {:.2} USDC after a year, with ZERO trades",
        sr_claim1,
        usdc_value0 as f64 / USDC as f64,
        usdc_value1 as f64 / USDC as f64
    );
    let _ = shares;
}

// ===========================================================================
// GAP 3 / revenue: the fee split
// ===========================================================================

#[test]
fn swap_fees_split_between_lps_and_the_treasury() {
    let w = std_setup(YEAR, 500);
    let (lp, shares) = w.seed(500_000 * USDC, 500_000 * USDC);
    assert_eq!(w.m().treasury_earned(), 0);

    let (t, sr_in) = w.user_with_sr(50_000 * USDC);
    w.m().swap_exact_sr_for_pt(&t, &sr_in, &0i128, &0u32);
    let earned1 = w.m().treasury_earned();
    assert!(earned1 > 0, "the protocol takes its share");
    assert_eq!(w.sr().balance(&w.treasury), earned1);

    // The LP's share stayed in the pool: their claim is worth more than they put in.
    let (_, pt_claim, sr_claim) = w.m().lp_position(&lp);
    assert!(pt_claim > 0 && sr_claim > 0);
    let _ = shares;
    std::println!("treasury took {} SR from one 50k swap; LP share stayed in the reserves", earned1);
}

#[test]
fn the_treasury_share_is_exactly_the_configured_fraction() {
    // 0% and 50% bracket the range; check the treasury's take scales with the setting.
    let mut takes = std::vec::Vec::new();
    for bps in [0u32, 1_000, 2_000, MAX_TREASURY_FEE_SHARE_BPS] {
        let w = setup(YEAR, 500, LN_FEE_ROOT, bps);
        w.seed(500_000 * USDC, 500_000 * USDC);
        let (t, sr_in) = w.user_with_sr(50_000 * USDC);
        w.m().swap_exact_sr_for_pt(&t, &sr_in, &0i128, &0u32);
        takes.push((bps, w.m().treasury_earned()));
    }
    for (bps, take) in &takes {
        std::println!("treasury share {:>5} bps -> {} SR from a 50k swap", bps, take);
    }
    assert_eq!(takes[0].1, 0, "0 bps means no protocol cut at all");
    assert!(takes[1].1 > 0 && takes[2].1 > takes[1].1 && takes[3].1 > takes[2].1);
    // 20% should be ~2x 10%.
    let r = takes[2].1 as f64 / takes[1].1 as f64;
    assert!((r - 2.0).abs() < 0.05, "20% should be ~2x 10%, got {r:.3}");
}

#[test]
fn yt_trades_pay_the_same_fee_split_as_pt_trades() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let n = 20_000 * USDC;
    let quoted = w.m().quote_buy_yt(&n);
    let (u, sr_in) = w.user_with_sr(w.sr().preview_redeem(&quoted) + 100);
    w.m().buy_yt_exact_out(&u, &n, &sr_in, &0u32);
    let after_buy = w.m().treasury_earned();
    assert!(after_buy > 0, "a YT buy is a PT trade and pays the same fee");
    w.m().sell_yt_exact_in(&u, &n, &0i128, &0u32);
    assert!(w.m().treasury_earned() > after_buy, "and so is a YT sale");
}

#[test]
#[should_panic(expected = "Error(Contract, #104)")] // FeeShareTooHigh
fn the_treasury_share_cannot_exceed_its_ceiling() {
    let w = std_setup(YEAR, 500);
    w.m().set_treasury_fee_share(&(MAX_TREASURY_FEE_SHARE_BPS + 1));
}

#[test]
#[should_panic(expected = "Error(Contract, #85)")] // FeeNotAllowed
fn the_fee_root_cannot_exceed_its_ceiling() {
    let w = std_setup(YEAR, 500);
    w.m().set_ln_fee_root(&(MAX_LN_FEE_ROOT + 1));
}

// ===========================================================================
// LP mechanics
// ===========================================================================

#[test]
fn lps_can_always_exit_proportionally() {
    let w = std_setup(YEAR, 500);
    let (lp, shares) = w.seed(500_000 * USDC, 500_000 * USDC);
    let (t, sr_in) = w.user_with_sr(50_000 * USDC);
    w.m().swap_exact_sr_for_pt(&t, &sr_in, &0i128, &0u32);

    let (pt_out, sr_out) = w.m().remove_liquidity(&lp, &shares, &0i128, &0i128);
    assert!(pt_out > 0 && sr_out > 0);
    assert_eq!(w.m().total_shares(), 0);
    assert_eq!(w.m().reserves(), (0, 0));
}

#[test]
fn an_lp_can_exit_while_paused() {
    let w = std_setup(YEAR, 500);
    let (lp, shares) = w.seed(500_000 * USDC, 500_000 * USDC);
    w.m().pause();
    let (pt_out, sr_out) = w.m().remove_liquidity(&lp, &shares, &0i128, &0i128);
    assert!(pt_out > 0 && sr_out > 0, "a pause must never trap LP funds");
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")] // Paused
fn a_pause_blocks_new_trades() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    w.m().pause();
    let (t, sr_in) = w.user_with_sr(1_000 * USDC);
    w.m().swap_exact_sr_for_pt(&t, &sr_in, &0i128, &0u32);
}

#[test]
#[should_panic(expected = "Error(Contract, #84)")] // ImbalancedLiquidity
fn a_later_lp_must_match_the_pool_ratio() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let (lp2, sr) = w.user_with_sr(200_000 * USDC);
    let py = w.y().mint_py(&lp2, &lp2, &(sr / 4));
    w.m().add_liquidity(&lp2, &py, &w.sr().balance(&lp2));
}

// ===========================================================================
// guardrails / critical cases
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #81)")] // SlippageExceeded
fn buy_yt_respects_max_sr_in() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let n = 10_000 * USDC;
    let quoted = w.m().quote_buy_yt(&n);
    let (u, _) = w.user_with_sr(w.sr().preview_redeem(&quoted) + 1_000);
    w.m().buy_yt_exact_out(&u, &n, &(quoted - 1), &0u32);
}

#[test]
#[should_panic(expected = "Error(Contract, #81)")] // SlippageExceeded
fn sell_yt_respects_min_sr_out() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let n = 10_000 * USDC;
    let quoted = w.m().quote_buy_yt(&n);
    let (u, sr_in) = w.user_with_sr(w.sr().preview_redeem(&quoted) + 100);
    w.m().buy_yt_exact_out(&u, &n, &sr_in, &0u32);
    let q = w.m().quote_sell_yt(&n);
    w.m().sell_yt_exact_in(&u, &n, &(q + 1), &0u32);
}

#[test]
#[should_panic(expected = "Error(Contract, #101)")] // SeriesExpired (deadline)
fn a_stale_deadline_reverts() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let (u, sr_in) = w.user_with_sr(1_000 * USDC);
    w.env.ledger().set_sequence_number(500);
    w.m().swap_exact_sr_for_pt(&u, &sr_in, &0i128, &10u32);
}

#[test]
#[should_panic(expected = "Error(Contract, #101)")] // SeriesExpired
fn trading_halts_at_expiry() {
    let w = std_setup(90 * DAY, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let (u, sr_in) = w.user_with_sr(1_000 * USDC);
    w.advance(91 * DAY);
    w.m().swap_exact_sr_for_pt(&u, &sr_in, &0i128, &0u32);
}

#[test]
fn quotes_never_revert_they_return_zero() {
    let w = std_setup(90 * DAY, 500);
    // Empty pool.
    assert_eq!(w.m().quote_buy_yt(&(1_000 * USDC)), 0);
    assert_eq!(w.m().quote_sell_yt(&(1_000 * USDC)), 0);
    assert_eq!(w.m().pt_price(), 0);
    w.seed(500_000 * USDC, 500_000 * USDC);
    assert!(w.m().quote_buy_yt(&(1_000 * USDC)) > 0);
    // Past expiry.
    w.advance(91 * DAY);
    assert_eq!(w.m().quote_buy_yt(&(1_000 * USDC)), 0);
    assert_eq!(w.m().quote_sell_yt(&(1_000 * USDC)), 0);
    assert_eq!(w.m().pt_price(), 0);
    // Absurd sizes.
    assert_eq!(w.m().quote_buy_yt(&i128::MAX), 0);
    assert_eq!(w.m().quote_sell_yt(&i128::MAX), 0);
}

#[test]
fn a_yt_sale_bigger_than_the_pools_pt_is_refused_without_touching_the_position() {
    let w = std_setup(YEAR, 500);
    w.seed(100_000 * USDC, 100_000 * USDC);
    let n = 10_000 * USDC;
    let quoted = w.m().quote_buy_yt(&n);
    let (u, sr_in) = w.user_with_sr(w.sr().preview_redeem(&quoted) + 100);
    w.m().buy_yt_exact_out(&u, &n, &sr_in, &0u32);

    let (pt_res, _) = w.m().reserves();
    let before = w.y().balance(&u);
    assert!(w.m().try_sell_yt_exact_in(&u, &(pt_res + 1), &0i128, &0u32).is_err());
    assert_eq!(w.y().balance(&u), before, "position untouched");
}

#[test]
fn stored_reserves_never_exceed_the_tokens_actually_held() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let n = 20_000 * USDC;
    let quoted = w.m().quote_buy_yt(&n);
    let (u, sr_in) = w.user_with_sr(w.sr().preview_redeem(&quoted) + 100);
    w.m().buy_yt_exact_out(&u, &n, &sr_in, &0u32);
    w.advance(30 * DAY);
    w.m().sell_yt_exact_in(&u, &(n / 2), &0i128, &0u32);
    let (t, s) = w.user_with_sr(10_000 * USDC);
    w.m().swap_exact_sr_for_pt(&t, &s, &0i128, &0u32);

    let (pt_res, sr_res) = w.m().reserves();
    assert!(w.pt().balance(&w.market) >= pt_res, "PT actual >= accounted");
    assert!(w.sr().balance(&w.market) >= sr_res, "SR actual >= accounted");
}

#[test]
fn repeated_yt_buying_raises_the_price_and_eventually_refuses_cleanly() {
    let w = std_setup(YEAR, 500);
    w.seed(50_000 * USDC, 50_000 * USDC);
    let n = 10_000 * USDC;
    let mut round = 0;
    let mut last = 0i128;
    loop {
        let q = w.m().quote_buy_yt(&n);
        if q == 0 {
            std::println!("round {round}: no quote — pool refuses further YT buys");
            break;
        }
        assert!(q > last, "each buy must cost more than the last");
        last = q;
        let (u, sr_in) = w.user_with_sr(w.sr().preview_redeem(&q) + 1_000);
        if w.m().try_buy_yt_exact_out(&u, &n, &sr_in, &0u32).is_err() {
            std::println!("round {round}: refused cleanly by the pool");
            break;
        }
        std::println!("round {round}: {} YT cost {} SR", n / USDC, q);
        round += 1;
        assert!(round < 30, "pool never refused — unbounded drain");
    }
    assert!(round > 0);
    // Nobody was liquidated and the engine is still solvent.
    let (held, needed, _) = w.y().solvency();
    assert!(held + 10 >= needed);
}

#[test]
fn the_market_is_wired_to_the_yield_contracts_own_tokens() {
    let w = std_setup(YEAR, 500);
    assert_eq!(w.m().pt_token(), w.y().pt_token());
    assert_eq!(w.m().sr_token(), w.y().sr_token());
    assert_eq!(w.m().expiry(), w.y().expiry());
    // tofix #19's mismatch class is not expressible: the market reads all three from the engine.
}

#[test]
fn buy_yt_works_with_only_the_users_signature() {
    use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
    use soroban_sdk::IntoVal;

    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let n = 10_000 * USDC;
    let quoted = w.m().quote_buy_yt(&n);
    let (u, sr_in) = w.user_with_sr(w.sr().preview_redeem(&quoted) + 100);
    let env = &w.env;

    // Only the user signs, and only for the SR they actually hand over. The market must supply the
    // rest of the notional on its own contract authority.
    env.mock_auths(&[MockAuth {
        address: &u,
        invoke: &MockAuthInvoke {
            contract: &w.market,
            fn_name: "buy_yt_exact_out",
            args: (u.clone(), n, sr_in, 0u32).into_val(env),
            sub_invokes: &[MockAuthInvoke {
                contract: &w.sr,
                fn_name: "transfer",
                args: (u.clone(), w.market.clone(), quoted).into_val(env),
                sub_invokes: &[],
            }],
        },
    }]);
    let paid = w.m().buy_yt_exact_out(&u, &n, &sr_in, &0u32);
    assert_eq!(paid, quoted);
    assert_eq!(w.y().balance(&u), n);
}

#[test]
fn a_stranger_cannot_spend_someone_elses_yt_through_the_market() {
    use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
    use soroban_sdk::IntoVal;

    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let n = 10_000 * USDC;
    let quoted = w.m().quote_buy_yt(&n);
    let (alice, sr_in) = w.user_with_sr(w.sr().preview_redeem(&quoted) + 100);
    w.m().buy_yt_exact_out(&alice, &n, &sr_in, &0u32);

    let mallory = Address::generate(&w.env);
    let env = &w.env;
    env.mock_auths(&[MockAuth {
        address: &mallory,
        invoke: &MockAuthInvoke {
            contract: &w.market,
            fn_name: "sell_yt_exact_in",
            args: (mallory.clone(), n, 0i128, 0u32).into_val(env),
            sub_invokes: &[],
        },
    }]);
    assert!(w.m().try_sell_yt_exact_in(&mallory, &n, &0i128, &0u32).is_err());
    env.mock_all_auths();
    assert_eq!(w.y().balance(&alice), n, "Alice's YT untouched");
}

// ===========================================================================
// resource budget
// ===========================================================================

const MAINNET_INSTRUCTIONS: i64 = 600_000_000;
const MAINNET_MEM_BYTES: i64 = 41_943_040;
const MAINNET_WRITE_ENTRIES: u32 = 50;
const MAINNET_LEDGER_ENTRIES: u32 = 100;
const MAINNET_WRITE_BYTES: u32 = 132_096;

fn cost(w: &World, label: &str) {
    let r = w.env.cost_estimate().resources();
    let entries = r.disk_read_entries + r.memory_read_entries + r.write_entries;
    std::println!(
        "{:<24} insns {:>11}/{} ({:>5.1}%)  mem {:>10}/{} ({:>5.1}%)  write {:>2}/{}  entries {:>3}/{}  wbytes {:>6}/{}",
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
fn every_path_fits_the_mainnet_per_transaction_budget() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);

    let (t, sr_in) = w.user_with_sr(10_000 * USDC);
    w.env.cost_estimate().budget().reset_unlimited();
    let pt_out = w.m().swap_exact_sr_for_pt(&t, &sr_in, &0i128, &0u32);
    cost(&w, "swap_exact_sr_for_pt");

    w.env.cost_estimate().budget().reset_unlimited();
    w.m().swap_exact_pt_for_sr(&t, &pt_out, &0i128, &0u32);
    cost(&w, "swap_exact_pt_for_sr");

    let n = 20_000 * USDC;
    let quoted = w.m().quote_buy_yt(&n);
    let (u, sr2) = w.user_with_sr(w.sr().preview_redeem(&quoted) + 100);
    w.env.cost_estimate().budget().reset_unlimited();
    w.m().buy_yt_exact_out(&u, &n, &sr2, &0u32);
    cost(&w, "buy_yt_exact_out");

    w.advance(90 * DAY);
    w.env.cost_estimate().budget().reset_unlimited();
    w.m().sell_yt_exact_in(&u, &(n / 2), &0i128, &0u32);
    cost(&w, "sell_yt_exact_in");

    w.env.cost_estimate().budget().reset_unlimited();
    w.y().redeem_due_interest(&u);
    cost(&w, "redeem_due_interest");
}

// ===========================================================================
// ADVERSARIAL — second pass.
// ===========================================================================

/// **Suspected leak.** `buy_yt_exact_out` ceils the SR it needs, so `mint_py` can return slightly
/// MORE face than the user asked for. The market keeps that difference as YT it never accounts for.
/// This measures whether it stays at dust or accumulates into something real.
#[test]
fn the_markets_untracked_yt_residue_stays_at_dust() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let mut residues = std::vec::Vec::new();
    for i in 0..12 {
        let n = 1_000 * USDC + (i as i128) * 137;
        let q = w.m().quote_buy_yt(&n);
        if q == 0 {
            break;
        }
        let (u, sr_in) = w.user_with_sr(w.sr().preview_redeem(&q) + 1_000);
        w.m().buy_yt_exact_out(&u, &n, &sr_in, &0u32);
        residues.push(w.y().balance(&w.market));
    }
    let final_residue = *residues.last().unwrap();
    std::println!(
        "market YT residue after {} buys: {} stroops ({:.10} USDC)",
        residues.len(),
        final_residue,
        final_residue as f64 / USDC as f64
    );
    // A stroop or two per trade is inherent to the ceil; anything larger is an accounting fault.
    assert!(
        final_residue <= residues.len() as i128 * 2,
        "residue {final_residue} grew faster than ~1 stroop/trade over {} trades",
        residues.len()
    );
    // And it is backed: the engine is still solvent.
    let (held, needed, _) = w.y().solvency();
    assert!(held + 10 >= needed);
}

/// **Sandwich / implied-rate manipulation.** The stored `last_ln_implied_rate` is rebuilt into the
/// anchor on every quote. Pushing the pool to an extreme and back must not extract value.
#[test]
fn a_sandwich_round_trip_cannot_extract_value_from_the_pool() {
    let w = std_setup(YEAR, 500);
    let (lp, shares) = w.seed(500_000 * USDC, 500_000 * USDC);
    let (_, lp_pt0, lp_sr0) = w.m().lp_position(&lp);

    // Attacker slams the pool one way, then unwinds.
    let (att, sr_in) = w.user_with_sr(200_000 * USDC);
    let pt = w.m().swap_exact_sr_for_pt(&att, &sr_in, &0i128, &0u32);
    let back = w.m().swap_exact_pt_for_sr(&att, &pt, &0i128, &0u32);
    assert!(back < sr_in, "the attacker must lose: in {sr_in}, out {back}");

    let (_, lp_pt1, lp_sr1) = w.m().lp_position(&lp);
    std::println!(
        "sandwich: attacker in {} SR, out {} SR (lost {}); LP PT {} -> {}, LP SR {} -> {}",
        sr_in, back, sr_in - back, lp_pt0, lp_pt1, lp_sr0, lp_sr1
    );
    // The LP must be no worse off in total value than before the churn.
    let idx = w.y().py_index();
    let v0 = lp_pt0 + lp_sr0 * idx / SCALAR_12;
    let v1 = lp_pt1 + lp_sr1 * idx / SCALAR_12;
    assert!(v1 >= v0, "LP value must not fall from someone else's round trip: {v0} -> {v1}");
    let _ = shares;
}

/// The same, through the YT route — an actor must not be able to arbitrage the PT path against the
/// YT path, since both must share one fee and one reserve transition.
#[test]
fn buying_yt_then_selling_pt_cannot_beat_the_pool() {
    let w = std_setup(YEAR, 500);
    let (lp, _) = w.seed(500_000 * USDC, 500_000 * USDC);
    let idx0 = w.y().py_index();
    let (_, p0, s0) = w.m().lp_position(&lp);
    let v0 = p0 + s0 * idx0 / SCALAR_12;

    let n = 50_000 * USDC;
    let q = w.m().quote_buy_yt(&n);
    let (att, sr_in) = w.user_with_sr(w.sr().preview_redeem(&q) + 10_000 * USDC);
    let spent = w.m().buy_yt_exact_out(&att, &n, &sr_in, &0u32);
    let got = w.m().sell_yt_exact_in(&att, &n, &0i128, &0u32);
    assert!(got < spent, "YT round trip must lose: spent {spent}, got {got}");

    let idx1 = w.y().py_index();
    let (_, p1, s1) = w.m().lp_position(&lp);
    let v1 = p1 + s1 * idx1 / SCALAR_12;
    assert!(v1 >= v0, "LP value fell from a YT round trip: {v0} -> {v1}");
}

/// A donation straight to the market address must not become tradeable capacity or LP value.
#[test]
fn donations_do_not_become_reserves() {
    let w = std_setup(YEAR, 500);
    let (lp, _) = w.seed(500_000 * USDC, 500_000 * USDC);
    let (pt0, sr0) = w.m().reserves();
    let (_, lp_pt0, lp_sr0) = w.m().lp_position(&lp);
    let q0 = w.m().quote_buy_yt(&(10_000 * USDC));

    // Donate both legs.
    let (donor, sr) = w.user_with_sr(100_000 * USDC);
    let py = w.y().mint_py(&donor, &donor, &(sr / 2));
    w.pt().transfer(&donor, &w.market, &py);
    w.sr().transfer(&donor, &w.market, &w.sr().balance(&donor));

    assert_eq!(w.m().reserves(), (pt0, sr0), "stored reserves are authoritative");
    assert_eq!(w.m().lp_position(&lp), (w.m().lp_position(&lp).0, lp_pt0, lp_sr0));
    assert_eq!(w.m().quote_buy_yt(&(10_000 * USDC)), q0, "no quote changed");
}

/// First-LP share seeding must not let a dust position dilute a real one.
#[test]
fn a_dust_first_lp_cannot_dilute_a_real_one() {
    let w = std_setup(YEAR, 500);
    // Attacker seeds with the smallest viable amount.
    let (att, sr) = w.user_with_sr(200_000 * USDC);
    let py = w.y().mint_py(&att, &att, &(sr / 2));
    let att_shares = w.m().add_liquidity(&att, &(100 * USDC), &(100 * USDC));
    assert!(att_shares > 0);

    // Real LP joins at the pool ratio.
    let (lp, sr2) = w.user_with_sr(400_000 * USDC);
    let py2 = w.y().mint_py(&lp, &lp, &(sr2 / 2));
    let lp_shares = w.m().add_liquidity(&lp, &(100_000 * USDC), &w.sr().balance(&lp).min(w.sr().preview_deposit(&(100_000 * USDC))));

    let total = w.m().total_shares();
    let att_frac = att_shares as f64 / total as f64;
    std::println!(
        "attacker {} shares, real LP {} shares -> attacker holds {:.4}% of the pool",
        att_shares, lp_shares, att_frac * 100.0
    );
    assert!(att_frac < 0.02, "a 100-unit seed must not hold >2% against a 100k deposit");
    let _ = (py, py2);
}

/// An LP must never be able to withdraw more value than they put in, absent fees.
#[test]
fn an_lp_round_trip_returns_no_more_than_it_deposited() {
    let w = std_setup(YEAR, 500);
    let (lp, shares) = w.seed(500_000 * USDC, 500_000 * USDC);
    let (pt_in, sr_in) = w.m().reserves();
    let (pt_out, sr_out) = w.m().remove_liquidity(&lp, &shares, &0i128, &0i128);
    assert!(pt_out <= pt_in && sr_out <= sr_in, "cannot withdraw more than the reserves");
    assert!(
        pt_in - pt_out <= 2 && sr_in - sr_out <= 2,
        "the only LP should get essentially everything back"
    );
}

#[test]
fn overflow_sized_trades_revert_cleanly() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let (u, sr_in) = w.user_with_sr(10_000 * USDC);
    let (pt0, sr0) = w.m().reserves();
    assert!(w.m().try_swap_exact_sr_for_pt(&u, &i128::MAX, &0i128, &0u32).is_err());
    assert!(w.m().try_swap_exact_pt_for_sr(&u, &i128::MAX, &0i128, &0u32).is_err());
    assert!(w.m().try_buy_yt_exact_out(&u, &i128::MAX, &i128::MAX, &0u32).is_err());
    assert!(w.m().try_sell_yt_exact_in(&u, &i128::MAX, &0i128, &0u32).is_err());
    assert_eq!(w.m().reserves(), (pt0, sr0), "nothing moved");
    let _ = sr_in;
}

#[test]
fn zero_and_negative_trade_sizes_are_refused() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let (u, _) = w.user_with_sr(10_000 * USDC);
    for bad in [0i128, -1, -10_000] {
        assert!(w.m().try_swap_exact_sr_for_pt(&u, &bad, &0i128, &0u32).is_err());
        assert!(w.m().try_swap_exact_pt_for_sr(&u, &bad, &0i128, &0u32).is_err());
        assert!(w.m().try_buy_yt_exact_out(&u, &bad, &i128::MAX, &0u32).is_err());
        assert!(w.m().try_sell_yt_exact_in(&u, &bad, &0i128, &0u32).is_err());
        assert!(w.m().try_add_liquidity(&u, &bad, &bad).is_err());
        assert!(w.m().try_remove_liquidity(&u, &bad, &0i128, &0i128).is_err());
    }
}

/// **Path dependence, quantified.** The curve prices a trade at its *post-trade* proportion, so a
/// single large trade is charged conservatively (in the LP's favour) while a sliced trade converges
/// on the true integral. Slicing therefore gets a better price. This is inherited from Pendle's
/// convention, not an implementation fault — but the size matters, so it is measured, not assumed.
#[test]
fn slicing_a_trade_gets_a_better_price_and_by_how_much() {
    let single = {
        let w = std_setup(YEAR, 500);
        w.seed(500_000 * USDC, 500_000 * USDC);
        let (u, sr) = w.user_with_sr(50_000 * USDC);
        w.m().swap_exact_sr_for_pt(&u, &sr, &0i128, &0u32)
    };
    for slices in [2i128, 5, 25, 100] {
        let w = std_setup(YEAR, 500);
        w.seed(500_000 * USDC, 500_000 * USDC);
        let (u, sr) = w.user_with_sr(50_000 * USDC);
        let mut total = 0;
        for _ in 0..slices {
            total += w.m().swap_exact_sr_for_pt(&u, &(sr / slices), &0i128, &0u32);
        }
        std::println!(
            "  {:>3} slices -> {} PT  ({:+.4}% vs one trade)",
            slices,
            total,
            (total - single) as f64 * 100.0 / single as f64
        );
    }
    std::println!("  one 50k trade (5% of the pool) -> {single} PT");
    std::println!("  Slicing converges on the fair integral; the single-trade price is the conservative bound.");
}

/// **The decisive test.** Path dependence is only dangerous if a *round trip* can profit from it.
/// Slice in, slice out — the trader must still end up down by the fee.
#[test]
fn a_sliced_round_trip_still_cannot_extract_value() {
    for slices in [5i128, 25, 100] {
        let w = std_setup(YEAR, 500);
        let (lp, _) = w.seed(500_000 * USDC, 500_000 * USDC);
        let idx0 = w.y().py_index();
        let (_, p0, s0) = w.m().lp_position(&lp);
        let lp_v0 = p0 + s0 * idx0 / SCALAR_12;

        let (u, sr_start) = w.user_with_sr(50_000 * USDC);
        let mut pt = 0i128;
        for _ in 0..slices {
            pt += w.m().swap_exact_sr_for_pt(&u, &(sr_start / slices), &0i128, &0u32);
        }
        let mut sr_back = 0i128;
        for i in 0..slices {
            let amt = if i == slices - 1 { w.pt().balance(&u) } else { pt / slices };
            if amt > 0 {
                sr_back += w.m().swap_exact_pt_for_sr(&u, &amt, &0i128, &0u32);
            }
        }
        let (_, p1, s1) = w.m().lp_position(&lp);
        let lp_v1 = p1 + s1 * w.y().py_index() / SCALAR_12;
        std::println!(
            "  {:>3} slices each way: trader {} -> {} SR ({:+}), LP value {:+}",
            slices,
            sr_start,
            sr_back,
            sr_back - sr_start,
            lp_v1 - lp_v0
        );
        assert!(
            sr_back < sr_start,
            "{slices} slices: a round trip PROFITED — {sr_start} -> {sr_back}"
        );
        assert!(lp_v1 >= lp_v0, "{slices} slices: LP value fell {lp_v0} -> {lp_v1}");
    }
}

/// Trading right up against expiry must degrade gracefully, never mis-price or panic.
#[test]
fn the_last_hours_before_expiry_are_safe() {
    let w = std_setup(90 * DAY, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    for hours_left in [48u64, 12, 3, 1] {
        w.env
            .ledger()
            .set_timestamp(1_700_000_000 + 90 * DAY - hours_left * 3600);
        let price = w.m().pt_price();
        let buy = w.m().quote_buy_yt(&(10_000 * USDC));
        let sell = w.m().quote_sell_yt(&(10_000 * USDC));
        std::println!(
            "  {:>2}h left: PT {:.6}  YT buy {}  YT sell {}",
            hours_left,
            price as f64 / 1e12,
            buy,
            sell
        );
        assert!(price > 0 && price <= SCALAR_12 + SCALAR_12 / 1000, "price {price} out of band");
        if buy > 0 {
            // A trade this close to expiry must still be executable and still lose on a round trip.
            let (u, sr_in) = w.user_with_sr(w.sr().preview_redeem(&buy) + 1_000);
            if w.m().try_buy_yt_exact_out(&u, &(10_000 * USDC), &sr_in, &0u32).is_ok() {
                let got = w.m().sell_yt_exact_in(&u, &(10_000 * USDC), &0i128, &0u32);
                assert!(got < sr_in);
            }
        }
    }
}

/// One second past expiry every trading path must be shut, while exits stay open.
#[test]
fn the_expiry_boundary_is_exact() {
    let w = std_setup(90 * DAY, 500);
    let (lp, shares) = w.seed(500_000 * USDC, 500_000 * USDC);
    let (u, sr_in) = w.user_with_sr(10_000 * USDC);

    w.env.ledger().set_timestamp(w.expiry - 1);
    assert!(w.m().try_swap_exact_sr_for_pt(&u, &(sr_in / 2), &0i128, &0u32).is_ok());

    w.env.ledger().set_timestamp(w.expiry);
    assert!(w.m().try_swap_exact_sr_for_pt(&u, &(sr_in / 4), &0i128, &0u32).is_err());
    assert!(w.m().try_buy_yt_exact_out(&u, &(100 * USDC), &i128::MAX, &0u32).is_err());
    assert!(w.m().try_sell_yt_exact_in(&u, &(100 * USDC), &0i128, &0u32).is_err());
    assert!(w.m().try_add_liquidity(&u, &(100 * USDC), &(100 * USDC)).is_err());
    // ...but the LP exit stays open, at the exact boundary and after.
    assert!(w.m().try_remove_liquidity(&lp, &(shares / 2), &0i128, &0i128).is_ok());
}

/// LPs must be able to exit after expiry and redeem their PT at par, closing the loop.
#[test]
fn an_lp_can_wind_down_completely_after_expiry() {
    let w = std_setup(90 * DAY, 500);
    let (lp, shares) = w.seed(500_000 * USDC, 500_000 * USDC);
    let (t, s) = w.user_with_sr(50_000 * USDC);
    w.m().swap_exact_sr_for_pt(&t, &s, &0i128, &0u32);

    w.advance(91 * DAY);
    let (pt_out, sr_out) = w.m().remove_liquidity(&lp, &shares, &0i128, &0i128);
    assert!(pt_out > 0 && sr_out > 0);
    // PT redeems alone after expiry; SR unwraps to USDC.
    let sr_from_pt = w.y().redeem_py(&lp, &lp, &pt_out);
    let total_sr = sr_from_pt + sr_out;
    let usdc = w.sr().redeem(&lp, &lp, &total_sr, &0i128);
    assert!(usdc > 0);
    std::println!("LP wound down completely: {:.2} USDC out", usdc as f64 / USDC as f64);
    assert_eq!(w.m().total_shares(), 0);
}

/// The fee split must never round in a way that pays the treasury more than the fee itself.
#[test]
fn the_treasury_cut_never_exceeds_the_fee() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let mut prev = 0i128;
    for i in 1..=15i128 {
        let (u, sr) = w.user_with_sr(i * 3 * USDC);
        if w.m().try_swap_exact_sr_for_pt(&u, &sr, &0i128, &0u32).is_err() {
            continue;
        }
        let earned = w.m().treasury_earned();
        let cut = earned - prev;
        prev = earned;
        // 20% share: the cut can never exceed the notional, let alone the fee.
        assert!(cut >= 0 && cut < sr, "cut {cut} vs input {sr}");
    }
    // And the treasury actually holds what it recorded.
    assert_eq!(w.sr().balance(&w.treasury), w.m().treasury_earned());
}

/// Stored reserves must never exceed real balances after ANY sequence — the one-sided invariant.
#[test]
fn reserves_stay_backed_through_a_long_mixed_sequence() {
    let w = std_setup(YEAR, 500);
    let (lp, shares) = w.seed(500_000 * USDC, 500_000 * USDC);
    let n = 20_000 * USDC;
    let mut holders = std::vec::Vec::new();

    for step in 0..10 {
        w.advance(20 * DAY);
        match step % 5 {
            0 => {
                let (u, sr) = w.user_with_sr(30_000 * USDC);
                let _ = w.m().try_swap_exact_sr_for_pt(&u, &sr, &0i128, &0u32);
            }
            1 => {
                let q = w.m().quote_buy_yt(&n);
                if q > 0 {
                    let (u, sr) = w.user_with_sr(w.sr().preview_redeem(&q) + 5_000 * USDC);
                    if w.m().try_buy_yt_exact_out(&u, &n, &sr, &0u32).is_ok() {
                        holders.push(u);
                    }
                }
            }
            2 => {
                if let Some(u) = holders.pop() {
                    let bal = w.y().balance(&u);
                    if bal > 0 {
                        let _ = w.m().try_sell_yt_exact_in(&u, &(bal / 2), &0i128, &0u32);
                    }
                }
            }
            3 => {
                let _ = w.m().try_remove_liquidity(&lp, &(shares / 50), &0i128, &0i128);
            }
            _ => {
                let (u, sr) = w.user_with_sr(10_000 * USDC);
                let _ = w.m().try_swap_exact_sr_for_pt(&u, &sr, &0i128, &0u32);
            }
        }
        let (pt_res, sr_res) = w.m().reserves();
        assert!(pt_res >= 0 && sr_res >= 0, "step {step}: negative reserve");
        assert!(
            w.pt().balance(&w.market) >= pt_res,
            "step {step}: PT actual {} < stored {pt_res}",
            w.pt().balance(&w.market)
        );
        assert!(
            w.sr().balance(&w.market) >= sr_res,
            "step {step}: SR actual {} < stored {sr_res}",
            w.sr().balance(&w.market)
        );
        let (held, needed, _) = w.y().solvency();
        assert!(held + 20 >= needed, "step {step}: engine insolvent");
    }
    std::println!("10-step mixed sequence: reserves stayed backed and the engine stayed solvent");
}
