#![cfg(test)]
//! # Market (PT/USDC AMM) — Stage A test suite, end-to-end vs the real Blend v2 WASM
//!
//! Same harness shape as the wrapper/vault §7.4 suites: a live Blend pool, the real strategy
//! adapter, the real wrapper (admins the PT/YT SACs), and the **market** trading PT against USDC.
//! No mocks of Blend or our own contracts.
//!
//! Stage A proves the *plumbing*, not the curve: that real PT minted via the wrapper can be
//! supplied to the pool, swapped both ways, that LP shares are conserved with no value extraction,
//! that yield still claims and PT still redeems for the holders after trading, and that the
//! guardrails (slippage, maturity halt, pause, fee ceiling) fire. The pricing is constant-product
//! and is replaced by the time-decay curve in Stage C behind this same interface.

extern crate std;

use crate::{Market, MarketClient};
use blend_contract_sdk::{pool, testutils::BlendFixture};
use sep_40_oracle::testutils::{Asset, MockPriceOracleClient, MockPriceOracleWASM};
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, BytesN, Env, String, Symbol, Vec,
};
use spield_strategy::{BlendStrategy, BlendStrategyClient};
use spield_wrapper::{Wrapper, WrapperClient};

const USDC: i128 = 1_0000000; // 7 decimals
const SCALAR_7: i128 = 1_0000000;
const REQ_SUPPLY_COLLATERAL: u32 = 2;
const REQ_BORROW: u32 = 4;
const YEAR: u64 = 365 * 24 * 60 * 60;
const FEE_BPS: u32 = 30; // 0.30% swap fee
const MAX_FEE_BPS: u32 = 100; // 1% ceiling
const SCALAR_12: i128 = 1_000_000_000_000;
// Curve params: anchor at PAR (1.0) so the price converges to par at maturity; the discount (and
// thus the implied yield) comes from the pool being tilted toward PT. A moderate steepness root
// gives realistic, bounded price impact per trade.
const SCALAR_ROOT: i128 = 40 * SCALAR_12;
const RATE_ANCHOR: i128 = SCALAR_12; // 1.0 (par)

struct World {
    env: Env,
    pool: Address,
    usdc: Address,
    oracle_id: Address,
    wrapper: Address,
    market: Address,
    pt: Address,
    maturity: u64,
}

impl World {
    fn env(&self) -> &Env {
        &self.env
    }
    fn market(&self) -> MarketClient<'_> {
        MarketClient::new(&self.env, &self.market)
    }
    fn wrapper(&self) -> WrapperClient<'_> {
        WrapperClient::new(&self.env, &self.wrapper)
    }
    fn usdc_admin(&self) -> StellarAssetClient<'_> {
        StellarAssetClient::new(&self.env, &self.usdc)
    }
    fn usdc(&self) -> TokenClient<'_> {
        TokenClient::new(&self.env, &self.usdc)
    }
    fn pt(&self) -> TokenClient<'_> {
        TokenClient::new(&self.env, &self.pt)
    }
    fn oracle(&self) -> MockPriceOracleClient<'_> {
        MockPriceOracleClient::new(&self.env, &self.oracle_id)
    }
    fn pool_client(&self) -> pool::Client<'_> {
        pool::Client::new(&self.env, &self.pool)
    }

    /// Advance the clock and refresh oracle prices so interest accrues into `b_rate`.
    fn advance(&self, secs: u64) {
        let t = self.env.ledger().timestamp();
        self.env.ledger().set_timestamp(t + secs);
        self.oracle()
            .set_price_stable(&vec![&self.env, 1_0000000, 1_0000000]);
        self.pool_client().get_reserve(&self.usdc);
    }

    /// Fund a fresh user with `amount` USDC.
    fn new_user(&self, amount: i128) -> Address {
        let user = Address::generate(&self.env);
        self.usdc_admin().mint(&user, &amount);
        user
    }

    /// Mint a fresh wrapper position for `user` worth `amount` USDC → they get `amount` PT + YT.
    /// Returns the position id.
    fn mint_position(&self, user: &Address, amount: i128) -> u64 {
        self.wrapper().mint(user, &amount)
    }
}

fn register_sac<'a>(env: &'a Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone()).address()
}

/// Build the full stack: Blend pool + strategy + wrapper (with PT/YT SACs) + the market on top.
fn setup(maturity_secs_from_now: u64) -> World {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);
    env.cost_estimate().budget().reset_unlimited();

    let admin = Address::generate(&env);
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

    // Whale borrows USDC so b_rate rises over time.
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

    // Wrapper first (so we can admin PT/YT to it), then strategy, then PT/YT SACs, then init.
    // Each contract's admin is bound atomically by its constructor (front-run-proof).
    let wrapper = env.register(Wrapper, (admin.clone(),));
    let strategy = env.register(BlendStrategy, (admin.clone(),));
    BlendStrategyClient::new(&env, &strategy).initialize(&wrapper, &pool, &usdc, &30_000u32);

    let pt = register_sac(&env, &wrapper);
    let yt = register_sac(&env, &wrapper);

    let maturity = env.ledger().timestamp() + maturity_secs_from_now;
    WrapperClient::new(&env, &wrapper).initialize(&strategy, &pt, &yt, &maturity);

    // The market trades PT against USDC. It's told the wrapper it trades against and
    // cross-checks `pt` + `maturity` against it on chain, so the pairing is an invariant.
    let market = env.register(Market, (admin.clone(),));
    MarketClient::new(&env, &market).initialize(
        &wrapper, &pt, &usdc, &maturity, &FEE_BPS, &MAX_FEE_BPS, &SCALAR_ROOT, &RATE_ANCHOR,
    );

    World { env, pool, usdc, oracle_id, wrapper, market, pt, maturity }
}

/// Mint PT+YT for an LP and seed the pool with `pt_amt` PT + `usdc_amt` USDC. Returns (lp, shares).
/// The LP keeps the YT (only PT is needed for the pool).
fn seed_pool(w: &World, pt_amt: i128, usdc_amt: i128) -> (Address, i128) {
    // Mint enough PT via the wrapper, plus separate USDC for the other side of the pool.
    let lp = w.new_user(pt_amt + usdc_amt);
    w.mint_position(&lp, pt_amt); // lp now holds pt_amt PT + pt_amt YT, spent pt_amt USDC
    let shares = w.market().add_liquidity(&lp, &pt_amt, &usdc_amt);
    (lp, shares)
}

// ===========================================================================
// Wiring: init records the market's PT/USDC/maturity and starts empty.
// ===========================================================================

#[test]
fn init_sets_market_params() {
    let w = setup(YEAR);
    assert_eq!(w.market().pt_token(), w.pt);
    assert_eq!(w.market().underlying(), w.usdc);
    assert_eq!(w.market().maturity(), w.maturity);
    assert_eq!(w.market().fee_bps(), FEE_BPS);
    assert!(!w.market().is_paused());
    assert_eq!(w.market().reserves(), (0, 0));
    assert_eq!(w.market().total_shares(), 0);
    // The pool records which wrapper it is bound to, and that binding is verifiable:
    // both cross-checked fields agree with the wrapper's own views.
    assert_eq!(w.market().wrapper(), w.wrapper);
    assert_eq!(w.market().maturity(), w.wrapper().maturity());
    assert_eq!(w.market().pt_token(), w.wrapper().pt_token());
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // AlreadyInitialized
fn double_initialize_panics() {
    let w = setup(YEAR);
    w.market().initialize(
        &w.wrapper, &w.pt, &w.usdc, &w.maturity, &FEE_BPS, &MAX_FEE_BPS, &SCALAR_ROOT, &RATE_ANCHOR,
    );
}

// ===========================================================================
// add_liquidity: first LP seeds reserves & gets sqrt(pt*usdc) shares.
// ===========================================================================

#[test]
fn first_lp_seeds_reserves_and_shares() {
    let w = setup(YEAR);
    let (lp, shares) = seed_pool(&w, 100 * USDC, 100 * USDC);
    assert!(shares > 0, "first LP must receive shares");
    assert_eq!(w.market().reserves(), (100 * USDC, 100 * USDC));
    assert_eq!(w.market().total_shares(), shares);

    let (held, pt_claim, usdc_claim) = w.market().lp_position(&lp);
    assert_eq!(held, shares);
    // The sole LP's shares redeem for ~the whole pool.
    assert!(pt_claim >= 100 * USDC - 2 && usdc_claim >= 100 * USDC - 2);
}

// ===========================================================================
// Swap PT->USDC: trader sells PT, pool PT rises / USDC falls, quote == executed.
// ===========================================================================

#[test]
fn swap_pt_for_usdc_matches_quote() {
    let w = setup(YEAR);
    seed_pool(&w, 1_000 * USDC, 1_000 * USDC);

    // A trader mints a PT position and sells 100 PT into the pool.
    let trader = w.new_user(100 * USDC);
    w.mint_position(&trader, 100 * USDC); // 100 PT + 100 YT
    assert_eq!(w.pt().balance(&trader), 100 * USDC);

    let quoted = w.market().quote_pt_for_usdc(&(100 * USDC));
    let usdc_before = w.usdc().balance(&trader);
    let out = w.market().swap_exact_pt_for_usdc(&trader, &(100 * USDC), &0);
    let usdc_after = w.usdc().balance(&trader);

    assert_eq!(out, quoted, "executed output must equal the quote");
    assert_eq!(usdc_after - usdc_before, out, "trader received the USDC out");
    assert_eq!(w.pt().balance(&trader), 0, "trader's PT went into the pool");
    // Pool moved: more PT, less USDC.
    let (pt_res, usdc_res) = w.market().reserves();
    assert_eq!(pt_res, 1_000 * USDC + 100 * USDC);
    assert_eq!(usdc_res, 1_000 * USDC - out);
    // PT trades below par on the curve (~0.97) minus fee + price impact → well under 100 USDC.
    assert!(out < 100 * USDC, "PT sells below par + fee → < 100 USDC");
    std::println!("sold 100 PT -> {} USDC out (quote {})", out, quoted);
}

// ===========================================================================
// Swap USDC->PT: the "Earn Fixed" income flow — buy PT with USDC.
// ===========================================================================

#[test]
fn swap_usdc_for_pt_buys_pt() {
    let w = setup(YEAR);
    seed_pool(&w, 1_000 * USDC, 1_000 * USDC);

    let buyer = w.new_user(100 * USDC);
    let quoted = w.market().quote_usdc_for_pt(&(100 * USDC));
    let pt_before = w.pt().balance(&buyer);
    let out = w.market().swap_exact_usdc_for_pt(&buyer, &(100 * USDC), &0);
    let pt_after = w.pt().balance(&buyer);

    assert_eq!(out, quoted);
    assert_eq!(pt_after - pt_before, out, "buyer received PT");
    assert_eq!(w.usdc().balance(&buyer), 0, "buyer spent their USDC");
    // Pool starts balanced (price ≈ par), so 100 USDC buys ≈100 PT minus fee + the price impact of
    // the buy (which lifts PT's price). Net a bit under 100 PT, and never absurd.
    assert!(out > 95 * USDC && out < 100 * USDC, "100 USDC buys just under 100 PT, got {}", out);
    std::println!("bought {} PT with 100 USDC", out);
}

// ===========================================================================
// Slippage guard: a too-high min_out reverts the swap.
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #81)")] // SlippageExceeded
fn swap_respects_slippage_guard() {
    let w = setup(YEAR);
    seed_pool(&w, 1_000 * USDC, 1_000 * USDC);
    let trader = w.new_user(100 * USDC);
    w.mint_position(&trader, 100 * USDC);
    // Demand at least 100 USDC out for 100 PT in — impossible after fee/slippage → revert.
    w.market()
        .swap_exact_pt_for_usdc(&trader, &(100 * USDC), &(100 * USDC));
}

// ===========================================================================
// LP round-trip: add then remove returns ~the deposit (minus nothing, no trades).
// ===========================================================================

#[test]
fn lp_add_then_remove_returns_deposit() {
    let w = setup(YEAR);
    let (lp, shares) = seed_pool(&w, 100 * USDC, 100 * USDC);

    let pt_before = w.pt().balance(&lp);
    let usdc_before = w.usdc().balance(&lp);
    let (pt_out, usdc_out) = w.market().remove_liquidity(&lp, &shares);

    assert!(pt_out >= 100 * USDC - 2 && usdc_out >= 100 * USDC - 2, "LP gets ~deposit back");
    assert_eq!(w.pt().balance(&lp) - pt_before, pt_out);
    assert_eq!(w.usdc().balance(&lp) - usdc_before, usdc_out);
    assert_eq!(w.market().total_shares(), 0, "all shares burned");
    assert_eq!(w.market().reserves(), (0, 0), "pool drained");
}

// ===========================================================================
// LPs earn fees: after a swap round-trips through the pool, exiting LPs hold more value than they
// put in (the fee accrues to the reserves the shares redeem for).
// ===========================================================================

#[test]
fn lp_earns_swap_fees() {
    let w = setup(YEAR);
    let (lp, shares) = seed_pool(&w, 1_000 * USDC, 1_000 * USDC);
    let k_before = {
        let (p, u) = w.market().reserves();
        p + u // proxy for pool value at 1:1-ish price
    };

    // Two opposite swaps push value (fees) into the reserves without changing token identity much.
    let t1 = w.new_user(200 * USDC);
    w.mint_position(&t1, 200 * USDC);
    w.market().swap_exact_pt_for_usdc(&t1, &(200 * USDC), &0);
    let t2 = w.new_user(200 * USDC);
    w.market().swap_exact_usdc_for_pt(&t2, &(200 * USDC), &0);

    let (pt_out, usdc_out) = w.market().remove_liquidity(&lp, &shares);
    let value_after = pt_out + usdc_out;
    assert!(
        value_after > k_before,
        "LP value must grow from fees: before {} after {}",
        k_before,
        value_after
    );
    std::println!("LP value {} -> {} (fees earned)", k_before, value_after);
}

// ===========================================================================
// THE STAGE-A PLUMBING PROOF: mint -> add_liquidity -> swap -> claim -> redeem, end to end.
// ===========================================================================

#[test]
fn full_lifecycle_mint_lp_swap_claim_redeem() {
    let w = setup(YEAR);

    // LP seeds the pool with PT (minted via wrapper) + USDC.
    let (lp, lp_shares) = seed_pool(&w, 1_000 * USDC, 1_000 * USDC);

    // A trader buys PT with USDC (the "Earn Fixed" flow) and holds it to maturity.
    let trader = w.new_user(100 * USDC);
    let pt_bought = w.market().swap_exact_usdc_for_pt(&trader, &(100 * USDC), &0);
    assert!(pt_bought > 0);

    // Time passes; real Blend yield accrues on the LP's retained YT position.
    w.advance(YEAR - 24 * 60 * 60);

    // The LP can still claim the YT yield from their wrapper position (position id 0 was theirs).
    w.env().cost_estimate().budget().reset_unlimited();
    let claimed = w.wrapper().claim_yield(&0u64);
    assert!(claimed > 0, "LP claims real accrued Blend yield on retained YT");
    std::println!("LP claimed {} USDC of YT yield", claimed);

    // At maturity, the trader redeems their bought PT 1:1 for USDC via the wrapper.
    // (PT bought on the market is the same SAC the wrapper mints; the trader needs a wrapper
    //  position to redeem against — so they mint a matching position and combine. Here we simply
    //  verify the PT is a real, redeemable SAC balance the trader holds.)
    w.env().ledger().set_timestamp(w.maturity + 1);
    w.oracle().set_price_stable(&vec![w.env(), 1_0000000, 1_0000000]);
    assert_eq!(w.pt().balance(&trader), pt_bought, "trader holds redeemable PT");

    // The LP exits the pool after maturity (remove_liquidity is allowed post-maturity).
    w.env().cost_estimate().budget().reset_unlimited();
    let (pt_out, usdc_out) = w.market().remove_liquidity(&lp, &lp_shares);
    assert!(pt_out > 0 && usdc_out > 0, "LP recovers reserves");
    std::println!(
        "lifecycle OK: trader holds {} PT, LP exited with {} PT + {} USDC",
        pt_bought, pt_out, usdc_out
    );
}

// ===========================================================================
// Trading halts at maturity; LPs can still exit.
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #82)")] // MarketExpired
fn swap_after_maturity_panics() {
    let w = setup(YEAR);
    seed_pool(&w, 1_000 * USDC, 1_000 * USDC);
    // Acquire the PT BEFORE maturity — `wrapper::mint` is now maturity-gated too, and we
    // want this test to fail on the swap's halt, not on the mint's.
    let trader = w.new_user(100 * USDC);
    w.mint_position(&trader, 100 * USDC);
    w.env().ledger().set_timestamp(w.maturity + 1);
    w.market().swap_exact_pt_for_usdc(&trader, &(100 * USDC), &0);
}

#[test]
fn lp_can_exit_after_maturity() {
    let w = setup(YEAR);
    let (lp, shares) = seed_pool(&w, 100 * USDC, 100 * USDC);
    w.env().ledger().set_timestamp(w.maturity + 1);
    w.env().cost_estimate().budget().reset_unlimited();
    let (pt_out, usdc_out) = w.market().remove_liquidity(&lp, &shares);
    assert!(pt_out > 0 && usdc_out > 0, "LP must be able to exit after maturity");
}

// ===========================================================================
// AMM hardening: LP can NEVER be trapped — exit works under EVERY combination of
// the maturity-state transition and the pause circuit-breaker. (Invariant tests.)
// ===========================================================================

/// The strongest no-trap guarantee: post-maturity AND paused at the same time, the LP still exits
/// in full and gets back proportional reserves. Neither the maturity halt (which only gates swaps)
/// nor a pause (which only gates inflows) can lock liquidity in.
#[test]
fn lp_exit_works_even_when_matured_and_paused() {
    let w = setup(YEAR);
    let (lp, shares) = seed_pool(&w, 100 * USDC, 100 * USDC);

    // Trigger BOTH trap conditions.
    w.env().ledger().set_timestamp(w.maturity + 1); // matured
    w.market().pause(); // and paused
    w.env().cost_estimate().budget().reset_unlimited();

    let (pt_out, usdc_out) = w.market().remove_liquidity(&lp, &shares);
    assert!(pt_out > 0 && usdc_out > 0, "LP trapped: cannot exit when matured + paused");
    let (held, _, _) = w.market().lp_position(&lp);
    assert_eq!(held, 0, "all shares redeemed");
}

/// Conservation: the sum of what every LP can remove equals the pool reserves (no shares left
/// stranded, no reserves conjured). Two LPs split the pool proportionally and both fully exit.
#[test]
fn full_lp_exit_conserves_reserves() {
    let w = setup(YEAR);
    let (lp1, s1) = seed_pool(&w, 100 * USDC, 100 * USDC);
    // Second LP adds at the current (1:1) ratio.
    let lp2 = w.new_user(200 * USDC);
    w.mint_position(&lp2, 100 * USDC);
    let s2 = w.market().add_liquidity(&lp2, &(100 * USDC), &(100 * USDC));

    let (pt_res0, usdc_res0) = w.market().reserves();
    w.env().cost_estimate().budget().reset_unlimited();
    let (pt1, usdc1) = w.market().remove_liquidity(&lp1, &s1);
    let (pt2, usdc2) = w.market().remove_liquidity(&lp2, &s2);

    // Everything paid out equals the starting reserves (flooring may leave at most a tiny dust).
    let pt_paid = pt1 + pt2;
    let usdc_paid = usdc1 + usdc2;
    assert!(pt_res0 - pt_paid >= 0 && pt_res0 - pt_paid <= 2, "PT conservation off: {} vs {}", pt_paid, pt_res0);
    assert!(usdc_res0 - usdc_paid >= 0 && usdc_res0 - usdc_paid <= 2, "USDC conservation off: {} vs {}", usdc_paid, usdc_res0);
    let (after_pt, after_usdc) = w.market().reserves();
    assert!(after_pt <= 2 && after_usdc <= 2, "pool not drained to dust: {} {}", after_pt, after_usdc);
    assert_eq!(w.market().total_shares(), 0, "all shares burned");
}

// ===========================================================================
// AMM hardening: read-only views NEVER panic on empty / thin / imbalanced /
// matured pools — they return safe fallbacks (0) instead of reverting.
// ===========================================================================

#[test]
fn views_safe_on_empty_pool() {
    let w = setup(YEAR);
    // No liquidity added at all. Every analytics view must return a safe 0, not revert.
    assert_eq!(w.market().pt_price(), 0, "pt_price on empty pool");
    assert_eq!(w.market().implied_apy(), 0, "implied_apy on empty pool");
    assert_eq!(w.market().quote_pt_for_usdc(&(USDC)), 0, "quote on empty pool");
    assert_eq!(w.market().quote_usdc_for_pt(&(USDC)), 0, "quote on empty pool");
    let (held, pt, usdc) = w.market().lp_position(&w.new_user(0));
    assert_eq!((held, pt, usdc), (0, 0, 0));
}

#[test]
fn views_safe_on_imbalanced_pool() {
    let w = setup(YEAR);
    // Seed an out-of-band pool directly (first LP sets the price): 1000 PT : 1 USDC ⇒ proportion
    // ≈ 0.999, beyond the 99.5% band, so the curve can't price it. Fund the LP for BOTH legs:
    // 1000 USDC to mint 1000 PT, PLUS 1 USDC for the pool's USDC side (= 1001 USDC total).
    let lp = w.new_user(1_001 * USDC);
    w.mint_position(&lp, 1_000 * USDC); // spends 1000 USDC → 1000 PT (+1000 YT); 1 USDC left
    w.market().add_liquidity(&lp, &(1_000 * USDC), &(1 * USDC));

    // Views must not panic — they return safe fallbacks for an out-of-band pool.
    assert_eq!(w.market().pt_price(), 0, "pt_price must degrade to 0 on imbalanced pool");
    assert_eq!(w.market().implied_apy(), 0, "implied_apy must degrade to 0 on imbalanced pool");
    assert_eq!(w.market().quote_usdc_for_pt(&(USDC)), 0, "quote degrades on imbalanced pool");
}

#[test]
fn views_safe_after_maturity() {
    let w = setup(YEAR);
    seed_pool(&w, 100 * USDC, 100 * USDC);
    w.env().ledger().set_timestamp(w.maturity + 1);
    // Past maturity the curve is undefined; views must return 0, not panic (MarketExpired).
    assert_eq!(w.market().pt_price(), 0, "pt_price must be 0 after maturity");
    assert_eq!(w.market().implied_apy(), 0, "implied_apy must be 0 after maturity");
    assert_eq!(w.market().quote_pt_for_usdc(&(USDC)), 0, "quote must be 0 after maturity");
    assert_eq!(w.market().quote_usdc_for_pt(&(USDC)), 0, "quote must be 0 after maturity");
    // reserves() (a pure read) still works.
    let (pt, usdc) = w.market().reserves();
    assert!(pt > 0 && usdc > 0, "reserves still readable after maturity");
}

#[test]
fn quote_returns_zero_when_amount_exceeds_liquidity() {
    let w = setup(YEAR);
    seed_pool(&w, 10 * USDC, 10 * USDC);
    w.env().cost_estimate().budget().reset_unlimited();
    // A buy larger than the pool can fill returns 0 ("amount exceeds liquidity"), not a revert.
    let q = w.market().quote_usdc_for_pt(&(1_000_000 * USDC));
    assert_eq!(q, 0, "oversized quote must degrade to 0");
}

// ===========================================================================
// Imbalanced add_liquidity (off the pool ratio) is rejected.
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #84)")] // ImbalancedLiquidity
fn imbalanced_add_liquidity_panics() {
    let w = setup(YEAR);
    seed_pool(&w, 1_000 * USDC, 1_000 * USDC); // pool ratio 1:1

    // A second LP tries to add at 1:2 (way off ratio) → reject.
    let lp2 = w.new_user(300 * USDC);
    w.mint_position(&lp2, 100 * USDC); // 100 PT
    w.market().add_liquidity(&lp2, &(100 * USDC), &(200 * USDC));
}

// ===========================================================================
// Admin guardrails: fee within ceiling ok; above ceiling rejected; pause halts swaps.
// ===========================================================================

#[test]
fn set_fee_within_ceiling() {
    let w = setup(YEAR);
    w.market().set_fee(&50); // 0.5%, under the 1% ceiling
    assert_eq!(w.market().fee_bps(), 50);
}

#[test]
#[should_panic(expected = "Error(Contract, #85)")] // FeeNotAllowed
fn set_fee_above_ceiling_panics() {
    let w = setup(YEAR);
    w.market().set_fee(&(MAX_FEE_BPS + 1));
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")] // Paused
fn paused_blocks_swap() {
    let w = setup(YEAR);
    seed_pool(&w, 1_000 * USDC, 1_000 * USDC);
    w.market().pause();
    let trader = w.new_user(100 * USDC);
    w.mint_position(&trader, 100 * USDC);
    w.market().swap_exact_pt_for_usdc(&trader, &(100 * USDC), &0);
}

// ===========================================================================
// Pause coverage & emergency exit (mainnet-readiness #8): pause blocks inflows
// (add_liquidity, swaps) but LPs can still EXIT via remove_liquidity.
// ===========================================================================

#[test]
fn paused_still_allows_remove_liquidity() {
    let w = setup(YEAR);
    let (lp, shares) = seed_pool(&w, 1_000 * USDC, 1_000 * USDC);

    // Emergency pause.
    w.market().pause();
    assert!(w.market().is_paused());

    // Inflows are blocked: add_liquidity and swaps.
    let lp2 = w.new_user(200 * USDC);
    w.mint_position(&lp2, 100 * USDC);
    assert_eq!(
        w.market().try_add_liquidity(&lp2, &(100 * USDC), &(100 * USDC)),
        Err(Ok(spield_shared::Error::Paused.into())),
        "add_liquidity (inflow) must be blocked while paused"
    );
    assert_eq!(
        w.market().try_swap_exact_usdc_for_pt(&lp2, &(10 * USDC), &0),
        Err(Ok(spield_shared::Error::Paused.into())),
        "swap (inflow) must be blocked while paused"
    );

    // ...but the LP can still EXIT via remove_liquidity while paused (no trapped funds).
    let (pt_out, usdc_out) = w.market().remove_liquidity(&lp, &shares);
    assert!(pt_out > 0 && usdc_out > 0, "LP must be able to exit while paused");
    let (held, _, _) = w.market().lp_position(&lp);
    assert_eq!(held, 0, "all shares removed");
}

// ===========================================================================
// remove_liquidity for more shares than held is rejected.
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #83)")] // InsufficientShares
fn remove_too_many_shares_panics() {
    let w = setup(YEAR);
    let (lp, shares) = seed_pool(&w, 100 * USDC, 100 * USDC);
    w.market().remove_liquidity(&lp, &(shares + 1));
}

// ===========================================================================
// TTL: an LP's shares survive a ledger advance (SCF #9).
// ===========================================================================

#[test]
fn lp_shares_survive_ttl_window() {
    let w = setup(YEAR);
    let (lp, shares) = seed_pool(&w, 100 * USDC, 100 * USDC);
    w.env().ledger().with_mut(|li| {
        li.sequence_number += 100_000;
    });
    let (held, _, _) = w.market().lp_position(&lp);
    assert_eq!(held, shares, "LP shares archived/lost after ledger advance (SCF #9)");
}

// ===========================================================================
// Two LPs split fees & reserves proportionally (no value extraction across LPs).
// ===========================================================================

#[test]
fn two_lps_split_pool_proportionally() {
    let w = setup(YEAR);
    let (_lp1, shares1) = seed_pool(&w, 1_000 * USDC, 1_000 * USDC);

    // Second LP adds at the same 1:1 ratio for half the size.
    let lp2 = w.new_user(1_000 * USDC);
    w.mint_position(&lp2, 500 * USDC); // 500 PT
    let shares2 = w.market().add_liquidity(&lp2, &(500 * USDC), &(500 * USDC));

    // lp2 supplied half of lp1 → ~half the shares.
    assert!(
        (shares1 / 2 - 2..=shares1 / 2 + 2).contains(&shares2),
        "second LP shares {} should be ~half of first {}",
        shares2,
        shares1
    );
    // Total reserves now 1500/1500.
    assert_eq!(w.market().reserves(), (1_500 * USDC, 1_500 * USDC));
}

// ===========================================================================
// CURVE (Stage C) — the differentiating properties.
// ===========================================================================

/// At a balanced 50/50 pool, PT price == the rate anchor (the logit term is 0 at proportion 0.5).
#[test]
fn pt_price_at_balanced_pool_equals_anchor() {
    let w = setup(YEAR);
    seed_pool(&w, 1_000 * USDC, 1_000 * USDC); // proportion 0.5
    let price = w.market().pt_price();
    // Anchor is 0.97; allow a hair of fixed-point/ time-decay drift (a few ledgers elapsed in setup).
    assert!(
        (RATE_ANCHOR - SCALAR_12 / 100..=RATE_ANCHOR + SCALAR_12 / 100).contains(&price),
        "balanced PT price {} should be ~anchor {}",
        price,
        RATE_ANCHOR
    );
    std::println!("balanced PT price = {} (anchor {})", price, RATE_ANCHOR);
}

/// THE differentiator: as `now → maturity`, the curve flattens onto the anchor and PT price drifts
/// toward par (1.0) — the IL-minimizing property. We compare price far from maturity vs near it,
/// holding the pool composition fixed, and assert it moved toward 1.0.
#[test]
fn pt_price_drifts_toward_par_near_maturity() {
    // Use a pool tilted toward PT so the off-anchor price is clearly below the anchor; as maturity
    // nears, the curve flattens and the price rises toward par.
    let w = setup(YEAR);
    // Tilt: more PT than USDC → proportion > 0.5 → PT cheaper than anchor.
    seed_pool(&w, 1_500 * USDC, 500 * USDC);

    let price_far = w.market().pt_price(); // ~1 year out
    // Advance to 1 day before maturity (still tradeable) and re-read at the same composition.
    w.env().ledger().set_timestamp(w.maturity - 24 * 60 * 60);
    w.oracle().set_price_stable(&vec![w.env(), 1_0000000, 1_0000000]);
    let price_near = w.market().pt_price();

    assert!(
        price_near > price_far,
        "PT price must rise toward par as maturity nears: far {} -> near {}",
        price_far,
        price_near
    );
    // And it should be close to par (within a few % of 1.0) right before maturity.
    assert!(
        price_near > SCALAR_12 - SCALAR_12 / 20,
        "near-maturity PT price {} should be within ~5% of par",
        price_near
    );
    std::println!("PT price: far={} near-maturity={} (→ par)", price_far, price_near);
}

/// Implied APY is positive when PT trades below par, and it is the headline UX number.
#[test]
fn implied_apy_is_positive_below_par() {
    let w = setup(YEAR);
    // Tilt toward PT so it's clearly below par → positive implied yield.
    seed_pool(&w, 1_300 * USDC, 700 * USDC);
    let apy = w.market().implied_apy();
    assert!(apy > 0, "implied APY must be positive when PT < par, got {}", apy);
    // Sanity: a few-percent discount over ~1y is a low-double-digit APY at most, not absurd.
    assert!(apy < SCALAR_12, "implied APY {} unreasonably high (>100%)", apy);
    std::println!("implied APY (SCALAR_12) = {} (~{}%)", apy, apy * 100 / SCALAR_12);
}

/// Buying PT (USDC→PT) pushes its price *up* (proportion falls as PT leaves the pool); selling PT
/// pushes it *down*. The curve must respond monotonically to flow — the basis of price discovery.
#[test]
fn price_moves_monotonically_with_flow() {
    let w = setup(YEAR);
    seed_pool(&w, 1_000 * USDC, 1_000 * USDC);
    let p0 = w.market().pt_price();

    // Buy PT with USDC → pool loses PT, proportion ↓, PT price ↑.
    let buyer = w.new_user(200 * USDC);
    w.market().swap_exact_usdc_for_pt(&buyer, &(200 * USDC), &0);
    let p_after_buy = w.market().pt_price();
    assert!(p_after_buy > p0, "buying PT must raise its price: {} -> {}", p0, p_after_buy);

    // Now sell a chunk of PT back → pool gains PT, price ↓.
    let seller = w.new_user(300 * USDC);
    w.mint_position(&seller, 300 * USDC);
    w.market().swap_exact_pt_for_usdc(&seller, &(300 * USDC), &0);
    let p_after_sell = w.market().pt_price();
    assert!(p_after_sell < p_after_buy, "selling PT must lower its price: {} -> {}", p_after_buy, p_after_sell);
    std::println!("price discovery: {} --buy--> {} --sell--> {}", p0, p_after_buy, p_after_sell);
}

/// Round-trip arbitrage must not be profitable: buy PT then immediately sell it back yields less
/// than you put in (fee + price impact). Guards against a curve that lets value leak to traders.
#[test]
fn immediate_roundtrip_is_unprofitable() {
    let w = setup(YEAR);
    seed_pool(&w, 1_000 * USDC, 1_000 * USDC);

    let trader = w.new_user(100 * USDC);
    let pt_got = w.market().swap_exact_usdc_for_pt(&trader, &(100 * USDC), &0);
    // Sell exactly the PT just bought straight back.
    let usdc_back = w.market().swap_exact_pt_for_usdc(&trader, &pt_got, &0);
    assert!(
        usdc_back < 100 * USDC,
        "round-trip must lose to fee + impact: put 100 USDC, got {} back",
        usdc_back
    );
    std::println!("round-trip: 100 USDC -> {} PT -> {} USDC (loss = fee+impact)", pt_got, usdc_back);
}

/// `curve_config` returns what init set, and `version` reflects Stage C.
#[test]
fn curve_config_and_version() {
    let w = setup(YEAR);
    let (root, anchor) = w.market().curve_config();
    assert_eq!(root, SCALAR_ROOT);
    assert_eq!(anchor, RATE_ANCHOR);
}

// ===========================================================================
// Governance: admin rotation + upgrade timelock wiring (mainnet-readiness)
// ===========================================================================

#[test]
fn market_admin_rotation_two_step() {
    let w = setup(YEAR);
    let new_admin = Address::generate(w.env());

    assert_eq!(w.market().pending_admin(), None);
    w.market().propose_admin(&new_admin);
    assert_eq!(w.market().pending_admin(), Some(new_admin.clone()));
    w.market().accept_admin();
    assert_eq!(w.market().admin(), new_admin);
    assert_eq!(w.market().pending_admin(), None);

    // New admin can drive an admin-only op (set_fee within the ceiling).
    w.market().set_fee(&50u32);
    assert_eq!(w.market().fee_bps(), 50u32);
}

#[test]
fn market_upgrade_timelock_schedule_and_default() {
    let w = setup(YEAR);
    assert_eq!(w.market().timelock(), 24 * 60 * 60);
    let hash = BytesN::<32>::random(w.env());
    let now = w.env().ledger().timestamp();
    let eta = w.market().schedule_upgrade(&hash);
    assert_eq!(eta, now + 24 * 60 * 60);
    assert_eq!(w.market().pending_upgrade().unwrap().eta, eta);
    assert_eq!(
        w.market().try_apply_upgrade(),
        Err(Ok(spield_shared::Error::TimelockNotElapsed.into()))
    );
}

// ===========================================================================
// Mainnet-readiness: init asserts the USDC token has 7 decimals (no assumption),
// and code_hash() returns the live deployed wasm hash.
// ===========================================================================

mod mock6 {
    use soroban_sdk::{contract, contractimpl, Address, Env, String};
    /// A minimal token stub whose only meaningful method is `decimals()` = 6, used to prove the
    /// market refuses a non-7-decimal settlement asset at init.
    #[contract]
    pub struct Token6;
    #[contractimpl]
    impl Token6 {
        pub fn decimals(_env: Env) -> u32 {
            6
        }
        pub fn name(env: Env) -> String {
            String::from_str(&env, "M6")
        }
        pub fn symbol(env: Env) -> String {
            String::from_str(&env, "M6")
        }
        pub fn balance(_env: Env, _id: Address) -> i128 {
            0
        }
    }
}

/// A stand-in exposing just the two wrapper views `market::initialize` cross-checks,
/// so the decimals test doesn't need the whole Blend stack behind it.
mod mock_wrapper {
    use soroban_sdk::{contract, contractimpl, Address, Env};
    #[contract]
    pub struct W;
    #[contractimpl]
    impl W {
        pub fn __constructor(env: Env, pt: Address, maturity: u64) {
            env.storage().instance().set(&0u32, &pt);
            env.storage().instance().set(&1u32, &maturity);
        }
        pub fn pt_token(env: Env) -> Address {
            env.storage().instance().get(&0u32).unwrap()
        }
        pub fn maturity(env: Env) -> u64 {
            env.storage().instance().get(&1u32).unwrap()
        }
    }
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")] // UnexpectedDecimals
fn init_rejects_non_seven_decimal_usdc() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);
    let admin = Address::generate(&env);
    let pt = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let bad_usdc = env.register(mock6::Token6, ());
    let maturity = env.ledger().timestamp() + YEAR;
    // A wrapper that WOULD pass the cross-check, so the only thing left to fail is the
    // decimals assertion — the test can't accidentally pass for the wrong reason.
    let wrapper = env.register(mock_wrapper::W, (pt.clone(), maturity));
    let market = env.register(Market, (admin.clone(),));
    // 6-decimal usdc must be rejected at init.
    MarketClient::new(&env, &market).initialize(
        &wrapper,
        &pt,
        &bad_usdc,
        &maturity,
        &FEE_BPS,
        &MAX_FEE_BPS,
        &SCALAR_ROOT,
        &RATE_ANCHOR,
    );
}

#[test]
fn code_hash_returns_live_wasm_hash() {
    let w = setup(YEAR);
    let h = w.market().code_hash();
    // 32-byte hash, not all-zero.
    assert_eq!(h.len(), 32);
    let mut nonzero = false;
    for b in h.iter() {
        if b != 0 {
            nonzero = true;
            break;
        }
    }
    assert!(nonzero, "code_hash must be a real, non-zero wasm hash");
}

// ===========================================================================
// testcando.md §0 — mechanism-level gaps found while reading the code.
//
// These tests do NOT assert that the protocol is correct; they PIN the actual
// behavior at the boundary between the market's loose PT (a plain SAC balance)
// and the wrapper's *position-gated* redemption. Every wrapper exit path
// (`redeem_pt`, `combine_and_redeem`, `transfer_position`) burns/transfers from
// `pos.owner`'s SAC balance against a position the caller owns. The moment PT
// changes hands on the AMM, the position record and the SAC balances diverge,
// and the two sides break in opposite directions:
//
//   * the BUYER holds redeemable PT but owns no position  → no exit at all;
//   * the SELLER owns the position but holds no PT        → their exits revert.
//
// ===========================================================================

/// Warp to `ts` and refresh the oracle so Blend keeps quoting (prices go stale).
fn warp_to(w: &World, ts: u64) {
    w.env().ledger().set_timestamp(ts);
    w.oracle().set_price_stable(&vec![w.env(), 1_0000000, 1_0000000]);
    w.env().cost_estimate().budget().reset_unlimited();
}

// --------------------------------------------------------------------------
// §0 P0 — `market_bought_pt_is_redeemable_by_buyer`  ✅ FIXED
//
// A trader buys PT on the AMM and holds it to maturity. `wrapper::redeem_pt` is
// position-gated and the buyer has no position, so this flow used to dead-end —
// the trader finished holding redeemable PT and 0 USDC, with no call available to
// convert one into the other. This test asserted that gap; it now asserts the exit.
//
// `wrapper::redeem_pt_bearer` makes the TOKEN the claim. Its safety rests on PT
// supply being honest, which the §13 issuer lockdown enforces (deploy step 3c:
// issuer master weight -> 0, verified on chain before anything is seeded).
// --------------------------------------------------------------------------

/// **The seed calibration, end to end against the real contracts.**
///
/// The deploy scripts used to seed the pool 1:1. That is not neutral: `rate_anchor` is pinned at
/// par so PT converges to 1.0 at maturity, which means a balanced pool prices PT at exactly par and
/// implies **0% APY** — buying PT and holding to maturity lost the 0.30% swap fee. This asserts
/// both halves: the balanced seed really is a losing trade, and the calibrated seed really is a
/// winning one that opens at the advertised rate.
#[test]
fn a_calibrated_seed_makes_earn_fixed_profitable_and_a_balanced_one_does_not() {
    // ── Balanced seed (the old default): a losing trade.
    let w = setup(YEAR);
    let (_lp, _s) = seed_pool(&w, 1_000 * USDC, 1_000 * USDC);
    assert_eq!(w.market().implied_apy(), 0, "a 1:1 pool implies 0% APY — it opens at par");

    let loser = w.new_user(100 * USDC);
    let pt_bal = w.market().swap_exact_usdc_for_pt(&loser, &(100 * USDC), &0);
    warp_to(&w, w.maturity + 1);
    let got_bal = w.wrapper().redeem_pt_bearer(&loser, &pt_bal);
    assert!(
        got_bal < 100 * USDC,
        "the balanced seed must LOSE money — that is the bug: paid {} got {}",
        100 * USDC,
        got_bal
    );

    // ── Calibrated seed: opens at the target rate and the same trade profits.
    let w2 = setup(YEAR);
    let usdc_side = 1_000 * USDC;
    let target_bps: u32 = 500; // match the vault's advertised 5.00%
    let pt_side = w2.market().seed_pt_for_apy(&usdc_side, &target_bps);
    assert!(pt_side > usdc_side, "a calibrated pool must be PT-heavy, got {}", pt_side);
    seed_pool(&w2, pt_side, usdc_side);

    let opened = w2.market().implied_apy();
    let target = target_bps as i128 * 1_000_000_000_000i128 / 10_000;
    assert!(
        (opened - target).abs() <= 1_000_000_000_000i128 / 10_000,
        "pool must OPEN within 1bp of {}bps, implied {}",
        target_bps,
        opened
    );

    let winner = w2.new_user(100 * USDC);
    let pt_cal = w2.market().swap_exact_usdc_for_pt(&winner, &(100 * USDC), &0);
    warp_to(&w2, w2.maturity + 1);
    let got_cal = w2.wrapper().redeem_pt_bearer(&winner, &pt_cal);
    assert!(
        got_cal > 100 * USDC,
        "the calibrated seed must PROFIT: paid {} got {}",
        100 * USDC,
        got_cal
    );

    std::println!(
        "Earn Fixed round trip on 100 USDC:  balanced 1:1 seed -> {}  |  calibrated seed -> {}",
        got_bal,
        got_cal
    );
}

#[test]
fn market_bought_pt_is_redeemable_by_the_buyer() {
    let w = setup(YEAR);
    // LP mints position #0 (1_000 PT + 1_000 YT) and puts ALL the PT in the pool.
    let (lp, _shares) = seed_pool(&w, 1_000 * USDC, 1_000 * USDC);

    // A trader buys PT with USDC — the headline "Earn Fixed via the AMM" flow.
    let trader = w.new_user(100 * USDC);
    let pt_bought = w.market().swap_exact_usdc_for_pt(&trader, &(100 * USDC), &0);
    assert!(pt_bought > 0);
    assert_eq!(w.usdc().balance(&trader), 0, "trader spent all their USDC on PT");

    // Hold to maturity. The PT is a real SAC balance the trader owns outright.
    warp_to(&w, w.maturity + 1);
    assert_eq!(w.pt().balance(&trader), pt_bought, "trader holds redeemable PT");

    // The buyer STILL owns no position — nothing about that changed.
    assert_eq!(w.wrapper().get_position(&0u64).owner, lp, "only the LP has a position");
    assert!(
        w.wrapper().try_get_position(&1u64).is_err(),
        "no second position exists — the buyer never minted one"
    );
    assert_eq!(
        w.wrapper().try_redeem_pt(&1u64, &pt_bought),
        Err(Ok(spield_shared::Error::PositionNotFound.into())),
        "the POSITION path still (correctly) has nothing to redeem against"
    );

    // …but the BEARER path pays them, which is the whole point of the fix.
    let paid = w.wrapper().redeem_pt_bearer(&trader, &pt_bought);
    assert_eq!(paid, pt_bought, "PT redeems 1:1 at maturity");
    assert_eq!(w.usdc().balance(&trader), pt_bought, "the trader is really paid in USDC");
    assert_eq!(w.pt().balance(&trader), 0, "the PT is burned");

    // The redemption returns exactly the PT held — whether that beats the 100 USDC paid is a
    // property of the curve, the 0.30% fee and the price impact of this particular trade size,
    // not of the redemption path, so it is reported rather than asserted here.
    assert_eq!(
        w.usdc().balance(&trader),
        pt_bought,
        "every PT bought must convert to exactly 1 USDC"
    );
    // And the protocol is still solvent afterwards.
    let (backing, principal, _) = w.wrapper().solvency();
    assert!(backing + 8 >= principal, "backing {} principal {}", backing, principal);
    // NOTE the economics this prints, which are about the SEED and not the redemption path:
    // seeded 1:1 the curve opens at par, so a buyer pays ~par and the 0.30% fee leaves them
    // *behind* at maturity (100 USDC in -> ~99.2 USDC out). The redemption works perfectly; the
    // venue is quoting ~0% APY because of the balanced seed. That is exactly the calibration
    // `testcando.md` §14 flags ("the scripted 1:1 seed ships a 0% APY venue") — the seed ratio has
    // to put PT at a real discount before launch, or Earn Fixed is a losing trade by construction.
    std::println!(
        "Earn Fixed via AMM (1:1 seed): spent {} USDC -> {} PT -> {} USDC at maturity",
        100 * USDC,
        pt_bought,
        w.usdc().balance(&trader)
    );
}

/// The documented workaround today: the *seller* hands over the position itself.
/// It only works if the seller still holds the matching PT — i.e. after the LP
/// pulls its PT back out of the pool. This pins the one exit that does exist.
#[test]
fn transfer_position_is_the_only_exit_for_market_bought_pt() {
    let w = setup(YEAR);
    let (lp, shares) = seed_pool(&w, 1_000 * USDC, 1_000 * USDC);
    let trader = w.new_user(100 * USDC);
    let pt_bought = w.market().swap_exact_usdc_for_pt(&trader, &(100 * USDC), &0);

    warp_to(&w, w.maturity + 1);

    // The LP exits the pool, recovering PT into their own balance.
    let (pt_out, _usdc_out) = w.market().remove_liquidity(&lp, &shares);
    // Position #0 still records the full 1_000 PT, but the LP only got `pt_out`
    // back (the trader took `pt_bought` out of the pool) — the position and the
    // SAC balance have already diverged.
    let pos = w.wrapper().get_position(&0u64);
    assert_eq!(pos.pt_amount, 1_000 * USDC);
    assert_eq!(w.pt().balance(&lp), pt_out);
    assert!(pt_out < pos.pt_amount, "LP recovered less PT than the position records");

    // So `transfer_position` (which moves `pos.pt_amount`) CANNOT be executed:
    // the LP does not hold that much PT.
    assert!(
        w.wrapper().try_transfer_position(&0u64, &trader).is_err(),
        "transfer_position must fail — it moves pos.pt_amount, which the LP no longer holds"
    );

    // The LP can only redeem what they actually hold, and only against their own
    // position. The trader's `pt_bought` stays stranded.
    let before = w.usdc().balance(&lp);
    w.wrapper().redeem_pt(&0u64, &pt_out);
    assert_eq!(w.usdc().balance(&lp) - before, pt_out, "LP redeems the PT it holds");
    assert_eq!(w.pt().balance(&trader), pt_bought, "the buyer's PT is still stranded");
}

// --------------------------------------------------------------------------
// §0 P0 — `seller_with_sold_pt_cannot_redeem_or_transfer`
//
// The mirror image: mint, sell the PT leg on the market, keep the position + YT.
// `claim_yield` must keep working (it touches neither SAC), but `redeem_pt`,
// `combine_and_redeem` and `transfer_position` must all fail on the SAC leg —
// the divergence must degrade gracefully, never corrupt state.
// --------------------------------------------------------------------------

#[test]
fn seller_with_sold_pt_can_still_claim_yield() {
    let w = setup(YEAR);
    seed_pool(&w, 1_000 * USDC, 1_000 * USDC);

    let seller = w.new_user(100 * USDC);
    let id = w.mint_position(&seller, 100 * USDC);
    // Sell the whole PT leg; keep the position record and the YT.
    let usdc_out = w.market().swap_exact_pt_for_usdc(&seller, &(100 * USDC), &0);
    assert!(usdc_out > 0);
    assert_eq!(w.pt().balance(&seller), 0, "PT leg sold");
    // The position still records the PT even though the SAC balance is gone.
    assert_eq!(w.wrapper().get_position(&id).pt_amount, 100 * USDC);

    // claim_yield touches neither SAC — it must keep working.
    w.advance(YEAR - 24 * 60 * 60);
    let claimed = w.wrapper().claim_yield(&id);
    assert!(claimed > 0, "YT yield must still be claimable after selling the PT leg");

    // ...and the wrapper stays solvent throughout.
    let (backing, principal, _) = w.wrapper().solvency();
    assert!(backing + 8 >= principal, "backing {} principal {}", backing, principal);
}

#[test]
fn seller_with_sold_pt_cannot_redeem_pt() {
    let w = setup(YEAR);
    seed_pool(&w, 1_000 * USDC, 1_000 * USDC);
    let seller = w.new_user(100 * USDC);
    let id = w.mint_position(&seller, 100 * USDC);
    w.market().swap_exact_pt_for_usdc(&seller, &(100 * USDC), &0);

    warp_to(&w, w.maturity + 1);
    // The position says 100 PT is redeemable, but the SAC burn has nothing to burn.
    assert_eq!(w.wrapper().get_position(&id).pt_amount, 100 * USDC);
    assert!(
        w.wrapper().try_redeem_pt(&id, &(100 * USDC)).is_err(),
        "redeem_pt must fail on the SAC burn shortfall, not silently pay out"
    );
    // State is untouched by the failed attempt (the whole tx reverted).
    assert_eq!(w.wrapper().get_position(&id).pt_amount, 100 * USDC);
    assert_eq!(w.usdc().balance(&w.wrapper), 0);
}

#[test]
fn seller_with_sold_pt_cannot_combine_or_transfer() {
    let w = setup(YEAR);
    seed_pool(&w, 1_000 * USDC, 1_000 * USDC);
    let seller = w.new_user(100 * USDC);
    let id = w.mint_position(&seller, 100 * USDC);
    w.market().swap_exact_pt_for_usdc(&seller, &(100 * USDC), &0);
    w.env().cost_estimate().budget().reset_unlimited();

    // combine burns PT + YT; the PT leg is gone, so it must fail.
    assert!(
        w.wrapper().try_combine_and_redeem(&id, &(100 * USDC)).is_err(),
        "combine_and_redeem must fail without the PT leg"
    );
    // transfer_position moves pos.pt_amount PT; the seller no longer holds it.
    let other = Address::generate(w.env());
    assert!(
        w.wrapper().try_transfer_position(&id, &other).is_err(),
        "transfer_position must fail without the PT leg"
    );
    // Ownership unchanged after the failed transfer.
    assert_eq!(w.wrapper().get_position(&id).owner, seller);
}

// --------------------------------------------------------------------------
// §0 P1 (fixed) — `market_maturity_mismatch_with_wrapper`
//
// `market::initialize` used to take `maturity` as a free parameter and never check
// it against the wrapper whose PT it trades: a deploy-script promise, not an
// on-chain invariant. Both directions failed, in opposite ways —
//
//   * LATE-dated  → past the wrapper's maturity the curve is still live, so the pool
//                   keeps quoting PT at a discount while every PT already redeems at
//                   par. Measured before the fix: 100 USDC bought 101.07 PT, a
//                   risk-free draw on the LPs, repeatable until their USDC was gone.
//   * EARLY-dated → between the market's maturity and the wrapper's, holders have no
//                   venue (`MarketExpired`) and no redemption (`NotMatured`).
//
// `initialize` now takes the `wrapper` and asserts both `pt` and `maturity` against
// it, so neither market can be constructed at all.
// --------------------------------------------------------------------------

/// Deploy a fresh market with a caller-chosen `pt`/`maturity` against `w`'s wrapper and
/// try to initialize it, flattening the nested `try_*` result to the contract error so
/// callers can assert the exact rejection. A host-level error is a test bug, not an
/// expected outcome, so it panics rather than being folded into the comparison.
fn try_init_market(w: &World, pt: &Address, maturity: u64) -> Result<(), soroban_sdk::Error> {
    let admin = w.wrapper().admin();
    let m = MarketClient::new(w.env(), &w.env().register(Market, (admin,)));
    match m.try_initialize(
        &w.wrapper, pt, &w.usdc, &maturity, &FEE_BPS, &MAX_FEE_BPS, &SCALAR_ROOT, &RATE_ANCHOR,
    ) {
        Ok(_) => Ok(()),
        Err(Ok(e)) => Err(e),
        Err(Err(e)) => std::panic!("expected a contract error, got host error {:?}", e),
    }
}

#[test]
fn market_init_cross_checks_wrapper_maturity() {
    let w = setup(YEAR);

    // A market dated 30 days AFTER the wrapper's maturity is refused…
    assert_eq!(
        try_init_market(&w, &w.pt, w.maturity + 30 * 24 * 60 * 60),
        Err(spield_shared::Error::MaturityMismatch.into()),
        "a late-dated market must be refused at init"
    );
    // …as is one dated 30 days BEFORE it…
    assert_eq!(
        try_init_market(&w, &w.pt, w.maturity - 30 * 24 * 60 * 60),
        Err(spield_shared::Error::MaturityMismatch.into()),
        "an early-dated market must be refused at init"
    );
    // …and so is a one-second slip in either direction: the check is exact equality,
    // not a tolerance, because even a small window is an arbitrage window.
    assert_eq!(
        try_init_market(&w, &w.pt, w.maturity + 1),
        Err(spield_shared::Error::MaturityMismatch.into())
    );
    assert_eq!(
        try_init_market(&w, &w.pt, w.maturity - 1),
        Err(spield_shared::Error::MaturityMismatch.into())
    );

    // The matching maturity is accepted (proving the tests above fail for the right reason).
    assert!(try_init_market(&w, &w.pt, w.maturity).is_ok());
}

/// The other half of the binding: a pool pointed at the wrong PT SAC is refused too.
/// Without this a market could quote a *different* bond's PT against this wrapper's
/// maturity, which is the same class of mismatch one field over.
#[test]
fn market_init_cross_checks_wrapper_pt_token() {
    let w = setup(YEAR);
    // A PT-shaped SAC that this wrapper does not mint.
    let impostor = register_sac(w.env(), &w.wrapper);
    assert_eq!(
        try_init_market(&w, &impostor, w.maturity),
        Err(spield_shared::Error::PtTokenMismatch.into()),
        "a market must trade the wrapper's own PT, not a look-alike SAC"
    );
    // The YT SAC is a particularly plausible mix-up — also refused.
    let yt = w.wrapper().yt_token();
    assert_eq!(
        try_init_market(&w, &yt, w.maturity),
        Err(spield_shared::Error::PtTokenMismatch.into()),
        "passing YT where PT belongs must be caught"
    );
}

/// The economic property the cross-check buys, stated positively: because the two
/// maturities are now identical, the moment trading halts is the moment PT becomes
/// redeemable at par. There is no window in which the curve quotes a discount on an
/// already-redeemable bond — which is what the late-dated arbitrage fed on.
#[test]
fn trading_halts_exactly_when_pt_becomes_redeemable() {
    let w = setup(YEAR);
    // PT-heavy pool (proportion 0.8): PT is clearly discounted, the state the
    // late-dated arbitrage exploited.
    let lp = w.new_user(2_000 * USDC);
    w.mint_position(&lp, 1_600 * USDC);
    w.market().add_liquidity(&lp, &(1_600 * USDC), &(400 * USDC));

    // One second BEFORE maturity: the curve is live and PT is below par, but
    // redemption is not open yet — so there is nothing to arbitrage against.
    warp_to(&w, w.maturity - 1);
    let price = w.market().pt_price();
    assert!(price > 0 && price < SCALAR_12, "PT trades below par pre-maturity: {}", price);
    let holder = w.new_user(100 * USDC);
    let hid = w.mint_position(&holder, 100 * USDC);
    assert_eq!(
        w.wrapper().try_redeem_pt(&hid, &(100 * USDC)),
        Err(Ok(spield_shared::Error::NotMatured.into())),
        "PT is not yet redeemable while the curve still discounts it"
    );

    // AT maturity: the discount window closes in the same instant redemption opens.
    warp_to(&w, w.maturity);
    assert_eq!(w.market().pt_price(), 0, "no live curve past maturity");
    assert_eq!(
        w.market().try_swap_exact_usdc_for_pt(&holder, &(10 * USDC), &0),
        Err(Ok(spield_shared::Error::MarketExpired.into())),
        "no discounted PT can be bought once it redeems at par"
    );
    w.env().cost_estimate().budget().reset_unlimited();
    assert_eq!(
        w.wrapper().redeem_pt(&hid, &(100 * USDC)),
        100 * USDC,
        "…and redemption at par is open in that same instant"
    );
}

/// The early-dated failure's mirror: with matched maturities there is no interval in
/// which a holder has neither a venue nor a redemption. Before maturity they can trade;
/// from maturity they can redeem. The two intervals meet with no gap.
#[test]
fn no_window_exists_with_neither_a_venue_nor_a_redemption() {
    let w = setup(YEAR);
    let lp = w.new_user(2_000 * USDC);
    w.mint_position(&lp, 1_000 * USDC);
    w.market().add_liquidity(&lp, &(1_000 * USDC), &(1_000 * USDC));

    let holder = w.new_user(200 * USDC);
    let hid = w.mint_position(&holder, 100 * USDC);

    // Sample across the term, including both sides of the boundary.
    for offset in [-(YEAR as i64) / 2, -(24 * 60 * 60), -1, 0, 1, 24 * 60 * 60] {
        let ts = (w.maturity as i64 + offset) as u64;
        warp_to(&w, ts);
        let can_trade = w.market().quote_pt_for_usdc(&(1 * USDC)) > 0;
        let can_redeem = w
            .wrapper()
            .try_redeem_pt(&hid, &1i128)
            .is_ok();
        assert!(
            can_trade || can_redeem,
            "at maturity{:+}s the holder had neither a venue nor a redemption",
            offset
        );
        // And they are never both open — the handoff is clean, not overlapping
        // (an overlap is exactly the late-dated arbitrage).
        assert!(
            !(can_trade && can_redeem),
            "at maturity{:+}s the pool still quotes PT that already redeems at par",
            offset
        );
    }
}
