#![cfg(test)]
//! # Curve property / fuzz suite — the highest-risk math, hammered.
//!
//! The log curve (`exchangeRate = anchor − ln(p/(1−p))/rateScalar`) and its fixed-point swap solver
//! are the riskiest components in Spield. These tests exercise the **pure** curve functions directly
//! (no Blend, no contract harness — fast, so we can sweep thousands of cases) and assert the core
//! invariants the protocol relies on:
//!
//! * **No panics on any input.** Every `try_*` returns `Ok`/`Err`, never reverts — across empty,
//!   thin, imbalanced, and mainnet-scale pools, and near the (0.5%, 99.5%) proportion boundary.
//! * **Monotonic pricing.** More PT in the pool ⇒ strictly cheaper PT (and vice-versa).
//! * **Bounded, sane outputs.** `0 < price`; at proportion 0.5 the price equals the anchor; a swap
//!   never pays out more than the relevant reserve.
//! * **Round-trip unprofitability.** Buying then immediately selling (or vice-versa) loses to fees +
//!   curvature — no risk-free extraction.
//! * **Solver convergence & overflow-safety** at mainnet-scale reserves (1e14+ base units).

extern crate std;

use crate::curve::{
    self, try_exchange_rate, try_proportion, try_pt_price, try_swap_pt_for_usdc,
    try_swap_usdc_for_pt, CurveParams,
};
use soroban_sdk::Env;
use spield_shared::SCALAR_12;

/// The i256-backed `ln`/`exp` host ops consume Soroban budget; sweep tests that call them thousands
/// of times must lift the default budget (a single on-chain call fits the real budget — proven in
/// `spield-shared`'s amm_math gas test — these loops just aggregate far past one call's worth).
fn unbudgeted() -> Env {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    env
}

const FEE_BPS: u32 = 30; // 0.30%
const ANCHOR: i128 = SCALAR_12; // par
/// A representative `rate_scalar` (= scalar_root / yearsToMat). With scalar_root = 40·1e12 and ~1y
/// to maturity this is ~40·1e12; we also sweep a range below.
const RATE_SCALAR: i128 = 40 * SCALAR_12;

fn params(rate_scalar: i128) -> CurveParams {
    CurveParams { rate_scalar, rate_anchor: ANCHOR }
}

/// Tiny deterministic LCG so the "fuzz" is reproducible (no Math.random in the test host, and we
/// want failures to be replayable). Numerical Recipes constants.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0
    }
    /// Uniform in [lo, hi].
    fn range(&mut self, lo: i128, hi: i128) -> i128 {
        if hi <= lo {
            return lo;
        }
        let span = (hi - lo) as u128 + 1;
        lo + (self.next() as u128 % span) as i128
    }
}

// ---------------------------------------------------------------------------
// proportion: never panics; correct band behavior
// ---------------------------------------------------------------------------

#[test]
fn proportion_handles_every_pool_state_without_panicking() {
    let env = unbudgeted();
    let mut rng = Rng(0xC0FFEE);
    for _ in 0..5000 {
        // Sweep reserves from 0 up to mainnet scale (1e15 base units ≈ 100M at 7 decimals).
        let pt = rng.range(0, 1_000_000_000_000_000);
        let usdc = rng.range(0, 1_000_000_000_000_000);
        // Must return Ok or Err — never panic. (A panic here fails the test process.)
        match try_proportion(&env, pt, usdc) {
            Ok(p) => {
                // In-band proportions are always strictly inside (0,1) at SCALAR_12.
                assert!(p > 0 && p < SCALAR_12, "proportion out of (0,1): {}", p);
            }
            Err(_) => { /* empty / too-imbalanced — acceptable structured error */ }
        }
    }
}

#[test]
fn proportion_boundary_band_is_respected() {
    let env = Env::default();
    // Exactly at 0.5% boundary (pt/total = 0.005): in-band (>=).
    // total = 200_000, pt = 1_000 → 0.005 exactly.
    assert!(try_proportion(&env, 1_000, 199_000).is_ok(), "0.5% should be in band");
    // Just below 0.5% → Err.
    assert!(
        try_proportion(&env, 1, 1_000_000).is_err(),
        "well below 0.5% must be rejected"
    );
    // Just above 99.5% → Err.
    assert!(
        try_proportion(&env, 1_000_000, 1).is_err(),
        "well above 99.5% must be rejected"
    );
    // Balanced is fine.
    let p = try_proportion(&env, 500_000, 500_000).unwrap();
    assert_eq!(p, SCALAR_12 / 2, "balanced pool is proportion 0.5");
}

#[test]
fn empty_and_single_sided_pools_error_not_panic() {
    let env = Env::default();
    assert!(try_proportion(&env, 0, 0).is_err(), "empty pool");
    assert!(try_proportion(&env, 0, 1_000_000).is_err(), "no PT");
    assert!(try_proportion(&env, 1_000_000, 0).is_err(), "no USDC");
    assert!(try_proportion(&env, -1, 1_000_000).is_err(), "negative reserve");
}

// ---------------------------------------------------------------------------
// exchange_rate / pt_price: bounded, anchored, monotonic
// ---------------------------------------------------------------------------

#[test]
fn price_at_balanced_pool_equals_anchor() {
    let env = Env::default();
    let p = params(RATE_SCALAR);
    let price = try_pt_price(&env, 1_000_000, 1_000_000, &p).unwrap();
    // At proportion 0.5 the ln term is 0 ⇒ price == anchor (within fixed-point dust).
    assert!((price - ANCHOR).abs() <= 4, "balanced price {} != anchor {}", price, ANCHOR);
}

#[test]
fn price_is_strictly_positive_everywhere_in_band() {
    let env = unbudgeted();
    let p = params(RATE_SCALAR);
    let mut rng = Rng(0xBEEF);
    for _ in 0..5000 {
        let pt = rng.range(1, 1_000_000_000_000_000);
        let usdc = rng.range(1, 1_000_000_000_000_000);
        if let Ok(price) = try_pt_price(&env, pt, usdc, &p) {
            assert!(price > 0, "price must be > 0, got {} (pt={}, usdc={})", price, pt, usdc);
        }
    }
}

#[test]
fn price_monotonic_more_pt_is_cheaper() {
    let env = unbudgeted();
    let p = params(RATE_SCALAR);
    // Hold USDC fixed; increase PT reserve across the band. Price must be non-increasing (cheaper).
    let usdc = 1_000_000i128;
    // Start above any possible anchor-based price so the first comparison always holds (avoid
    // i128::MAX + dust overflow in the assertion below).
    let mut prev = ANCHOR * 1_000;
    let mut samples = 0;
    // pt from very-low (USDC-heavy ⇒ expensive PT) to very-high (PT-heavy ⇒ cheap PT).
    let mut pt = usdc / 100; // ~1% proportion-ish
    while pt < usdc * 100 {
        if let Ok(price) = try_pt_price(&env, pt, usdc, &p) {
            assert!(
                price <= prev + 2, // allow fixed-point dust
                "price not monotonic: pt={} price={} prev={}",
                pt,
                price,
                prev
            );
            prev = price;
            samples += 1;
        }
        pt += usdc / 50;
    }
    assert!(samples > 20, "expected many in-band samples, got {}", samples);
}

#[test]
fn pt_heavy_below_par_usdc_heavy_above_par() {
    let env = Env::default();
    let p = params(RATE_SCALAR);
    // PT-heavy pool: PT is cheap (below par).
    let cheap = try_pt_price(&env, 800_000, 200_000, &p).unwrap();
    assert!(cheap < ANCHOR, "PT-heavy pool must price PT below par: {}", cheap);
    // USDC-heavy pool: PT is dear (above par).
    let dear = try_pt_price(&env, 200_000, 800_000, &p).unwrap();
    assert!(dear > ANCHOR, "USDC-heavy pool must price PT above par: {}", dear);
}

#[test]
fn steeper_scalar_flattens_price_toward_anchor() {
    let env = Env::default();
    // Same imbalanced pool, two rate_scalars. Larger rate_scalar (nearer maturity) ⇒ price closer
    // to the anchor (the par-convergence property).
    let pt = 700_000i128;
    let usdc = 300_000i128;
    let shallow = try_pt_price(&env, pt, usdc, &params(RATE_SCALAR)).unwrap();
    let steep = try_pt_price(&env, pt, usdc, &params(RATE_SCALAR * 20)).unwrap();
    let d_shallow = (shallow - ANCHOR).abs();
    let d_steep = (steep - ANCHOR).abs();
    assert!(
        d_steep < d_shallow,
        "steeper scalar must pull price toward par: shallow dev {}, steep dev {}",
        d_shallow,
        d_steep
    );
}

// ---------------------------------------------------------------------------
// Swap solver: bounded output, convergence, mainnet scale, no overflow
// ---------------------------------------------------------------------------

#[test]
fn swap_output_never_exceeds_reserve_fuzz() {
    let env = unbudgeted();
    let p = params(RATE_SCALAR);
    let mut rng = Rng(0x5EED);
    let mut ok_swaps = 0;
    for _ in 0..3000 {
        // Mainnet-scale reserves.
        let pt_res = rng.range(1_000_000, 1_000_000_000_000_000);
        let usdc_res = rng.range(1_000_000, 1_000_000_000_000_000);
        let pt_in = rng.range(1, pt_res); // trade up to the whole reserve
        if let Ok(r) = try_swap_pt_for_usdc(&env, pt_in, pt_res, usdc_res, FEE_BPS, &p) {
            assert!(r.amount_out > 0, "positive output");
            assert!(r.amount_out < usdc_res, "USDC out {} >= reserve {}", r.amount_out, usdc_res);
            ok_swaps += 1;
        }
        let usdc_in = rng.range(1, usdc_res);
        if let Ok(r) = try_swap_usdc_for_pt(&env, usdc_in, pt_res, usdc_res, FEE_BPS, &p) {
            assert!(r.amount_out > 0, "positive output");
            assert!(r.amount_out < pt_res, "PT out {} >= reserve {}", r.amount_out, pt_res);
            ok_swaps += 1;
        }
    }
    assert!(ok_swaps > 100, "expected many valid swaps in the fuzz sweep, got {}", ok_swaps);
}

#[test]
fn swap_solver_is_self_consistent() {
    // After the 3-pass solve, usdc_out should equal pt_after_fee * rate(proportion_after) to within
    // fixed-point dust — i.e. the iteration actually converged.
    let env = Env::default();
    let p = params(RATE_SCALAR);
    let pt_res = 1_000_000_000i128; // 100 PT (7-dec) scale
    let usdc_res = 1_000_000_000i128;
    let pt_in = 50_000_000i128; // 5 PT
    let r = try_swap_pt_for_usdc(&env, pt_in, pt_res, usdc_res, FEE_BPS, &p).unwrap();

    // Recompute the implied rate at the post-trade proportion and check self-consistency.
    let pt_after_fee = pt_in * (10_000 - FEE_BPS as i128) / 10_000;
    let new_pt = pt_res + pt_after_fee;
    let prop_after = try_proportion(&env, new_pt, usdc_res - r.amount_out).unwrap();
    let rate = try_exchange_rate(&env, prop_after, &p).unwrap();
    let implied = pt_after_fee * rate / SCALAR_12;
    let diff = (implied - r.amount_out).abs();
    // Tolerance: a few base units of fixed-point/flooring slack.
    assert!(diff <= 8, "solver not self-consistent: out={} implied={} diff={}", r.amount_out, implied, diff);
}

#[test]
fn mainnet_scale_swaps_do_not_overflow() {
    // Reserves at ~100M USDC / PT (7 decimals ⇒ 1e15 base units), large trades. The i256-backed
    // mul_div in the math layer must absorb this without overflow.
    let env = Env::default();
    let p = params(RATE_SCALAR);
    let big = 1_000_000_000_000_000i128; // 1e15
    let r1 = try_swap_pt_for_usdc(&env, big / 10, big, big, FEE_BPS, &p).unwrap();
    assert!(r1.amount_out > 0 && r1.amount_out < big);
    let r2 = try_swap_usdc_for_pt(&env, big / 10, big, big, FEE_BPS, &p).unwrap();
    assert!(r2.amount_out > 0 && r2.amount_out < big);
}

#[test]
fn round_trip_is_unprofitable() {
    // Buy PT with USDC, then sell that PT straight back. Fees + curvature ⇒ you get back strictly
    // less USDC than you put in. No risk-free extraction.
    let env = Env::default();
    let p = params(RATE_SCALAR);
    let pt_res = 1_000_000_000i128;
    let usdc_res = 1_000_000_000i128;

    let usdc_in = 20_000_000i128; // 2 USDC
    let bought_pt = try_swap_usdc_for_pt(&env, usdc_in, pt_res, usdc_res, FEE_BPS, &p)
        .unwrap()
        .amount_out;
    // Pool moves after the first leg; sell into the updated reserves.
    let pt_res2 = pt_res - bought_pt;
    let usdc_res2 = usdc_res + usdc_in;
    let usdc_back = try_swap_pt_for_usdc(&env, bought_pt, pt_res2, usdc_res2, FEE_BPS, &p)
        .unwrap()
        .amount_out;
    assert!(
        usdc_back < usdc_in,
        "round-trip must lose to fees: in={} back={}",
        usdc_in,
        usdc_back
    );
}

#[test]
fn larger_trade_gets_worse_average_price() {
    // Price impact: buying more PT in one shot yields a worse PT-per-USDC average than a small buy.
    let env = Env::default();
    let p = params(RATE_SCALAR);
    let pt_res = 10_000_000_000i128;
    let usdc_res = 10_000_000_000i128;

    let small_in = 10_000_000i128; // 1 USDC
    let big_in = 1_000_000_000i128; // 100 USDC
    let small_pt = try_swap_usdc_for_pt(&env, small_in, pt_res, usdc_res, FEE_BPS, &p).unwrap().amount_out;
    let big_pt = try_swap_usdc_for_pt(&env, big_in, pt_res, usdc_res, FEE_BPS, &p).unwrap().amount_out;
    // PT per USDC: small trade should get >= big trade (less slippage).
    // Compare small_pt/small_in vs big_pt/big_in via cross-multiplication (avoid float).
    let lhs = small_pt * big_in;
    let rhs = big_pt * small_in;
    assert!(lhs >= rhs, "big trade must not get a better unit price (slippage): {} vs {}", lhs, rhs);
}

#[test]
fn swap_rejects_output_exceeding_reserve() {
    // A trade so large it would drain the opposite reserve must Err (InsufficientLiquidity), not
    // produce a bogus output.
    let env = Env::default();
    let p = params(RATE_SCALAR);
    // Tiny USDC reserve, huge PT input → would need more USDC than exists.
    let res = try_swap_pt_for_usdc(&env, 1_000_000_000_000, 1_000_000, 1_000, FEE_BPS, &p);
    assert!(res.is_err(), "draining trade must be rejected");
}

#[test]
fn implied_apy_safe_on_all_states() {
    // The fully-safe implied_apy must never panic and must give 0 for unusable/at-par/expired states.
    let env = Env::default();
    let scalar_root = 40 * SCALAR_12;
    let now = 1_000u64;
    let maturity = now + 365 * 24 * 60 * 60;

    // Empty pool → 0.
    assert_eq!(curve::implied_apy(&env, 0, 0, scalar_root, ANCHOR, maturity, now), 0);
    // Imbalanced beyond band → 0 (no panic).
    assert_eq!(curve::implied_apy(&env, 1, 1_000_000_000, scalar_root, ANCHOR, maturity, now), 0);
    // At/after maturity → 0 (no panic).
    assert_eq!(curve::implied_apy(&env, 500_000, 500_000, scalar_root, ANCHOR, maturity, maturity), 0);
    // Healthy PT-heavy (below par) pool → positive APY.
    let apy = curve::implied_apy(&env, 700_000, 300_000, scalar_root, ANCHOR, maturity, now);
    assert!(apy > 0, "below-par pool should imply a positive APY, got {}", apy);
    // Balanced (at par) → 0 (no discount).
    assert_eq!(curve::implied_apy(&env, 500_000, 500_000, scalar_root, ANCHOR, maturity, now), 0);
}
