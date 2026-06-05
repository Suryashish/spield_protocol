#![cfg(test)]
//! Rigorous test suite for the AMM fixed-point transcendentals (Phase 3 Stage B).
//!
//! This is the "rigor budget" the design doc allocates to the highest-risk module. We check four
//! things against an `f64` reference (the host has floats; the contract does not):
//!   1. **Golden values** — hand-picked points match `f64::ln`/`exp` to a tight tolerance.
//!   2. **Round-trips** — `exp(ln(x)) ≈ x` and `ln(exp(x)) ≈ x` across the domain.
//!   3. **Monotonicity** — both functions are strictly increasing (the curve relies on this).
//!   4. **Error bound** — the max abs error over a dense sweep is asserted to stay under budget.
//! Plus identities (`ln(1)=0`, `exp(0)=1`, `ln(ab)=ln a+ln b`) and edge/adversarial inputs.

extern crate std;

use crate::amm_math::{exp_fixed, ln_fixed, pow_fixed, EXP_MAX_INPUT, LN2};
use crate::SCALAR_12;
use soroban_sdk::Env;
use std::format;

const S: f64 = 1_000_000_000_000.0; // SCALAR_12 as f64

/// Convert a SCALAR_12 fixed-point integer to f64 real units.
fn to_f(x: i128) -> f64 {
    x as f64 / S
}
/// Convert an f64 real number to SCALAR_12 fixed point (round-to-nearest).
fn to_fp(x: f64) -> i128 {
    (x * S).round() as i128
}

/// Absolute error, in *real* units, between a fixed-point result and the true value.
fn abs_err(got: i128, truth: f64) -> f64 {
    (to_f(got) - truth).abs()
}

// ----------------------------------------------------------------------------- constants

#[test]
fn ln2_constant_is_accurate() {
    // The hardcoded LN2 must match ln(2) to fixed-point resolution.
    let truth = std::f64::consts::LN_2;
    assert!((to_f(LN2) - truth).abs() < 1e-11, "LN2 off: {}", to_f(LN2));
}

// ----------------------------------------------------------------------------- ln golden + identities

#[test]
fn ln_of_one_is_zero() {
    let env = Env::default();
    assert_eq!(ln_fixed(&env, SCALAR_12).unwrap(), 0);
}

#[test]
fn ln_golden_values() {
    let env = Env::default();
    // (input real, expected ln) — checked against f64::ln to < 1e-9 absolute.
    let cases = [0.5_f64, 1.5, 2.0, std::f64::consts::E, 10.0, 0.1, 100.0, 1.05575];
    for &v in &cases {
        let got = ln_fixed(&env, to_fp(v)).unwrap();
        let truth = v.ln();
        let e = abs_err(got, truth);
        assert!(e < 1e-9, "ln({}) = {} (want {}), err {}", v, to_f(got), truth, e);
    }
}

#[test]
fn ln_is_negative_below_one_positive_above() {
    let env = Env::default();
    assert!(ln_fixed(&env, to_fp(0.5)).unwrap() < 0);
    assert!(ln_fixed(&env, to_fp(2.0)).unwrap() > 0);
}

#[test]
fn ln_product_identity() {
    // ln(a*b) == ln(a) + ln(b) to fixed-point resolution. Three independent floored `ln` calls,
    // so a small ULP accumulation is expected; ~16 ULP (1.6e-11 real) is comfortably tight.
    let env = Env::default();
    let a = to_fp(3.0);
    let b = to_fp(7.0);
    let ab = to_fp(21.0);
    let lhs = ln_fixed(&env, ab).unwrap();
    let rhs = ln_fixed(&env, a).unwrap() + ln_fixed(&env, b).unwrap();
    assert!((lhs - rhs).abs() <= 16, "ln product identity off by {}", lhs - rhs);
}

#[test]
fn ln_is_monotonic_increasing() {
    let env = Env::default();
    // The I256-backed multiplies consume host budget; this loop makes ~1000 calls, so lift the cap.
    env.cost_estimate().budget().reset_unlimited();
    let mut prev = ln_fixed(&env, to_fp(0.01)).unwrap();
    let mut x = 0.02_f64;
    while x <= 50.0 {
        let cur = ln_fixed(&env, to_fp(x)).unwrap();
        assert!(cur > prev, "ln not increasing at x={}: {} !> {}", x, cur, prev);
        prev = cur;
        x += 0.05;
    }
}

#[test]
#[should_panic(expected = "InvalidAmount")]
fn ln_of_zero_errors() {
    let env = Env::default();
    ln_fixed(&env, 0).unwrap();
}

#[test]
#[should_panic(expected = "InvalidAmount")]
fn ln_of_negative_errors() {
    let env = Env::default();
    ln_fixed(&env, -SCALAR_12).unwrap();
}

// ----------------------------------------------------------------------------- exp golden + identities

#[test]
fn exp_of_zero_is_one() {
    let env = Env::default();
    assert_eq!(exp_fixed(&env, 0).unwrap(), SCALAR_12);
}

#[test]
fn exp_golden_values() {
    let env = Env::default();
    let cases = [0.0_f64, 1.0, -1.0, 0.5, 2.0, -2.0, 5.0, -5.0, 0.05, 10.0];
    for &v in &cases {
        let got = exp_fixed(&env, to_fp(v)).unwrap();
        let truth = v.exp();
        // Relative error is the right metric for exp (values span many orders of magnitude).
        let rel = (to_f(got) - truth).abs() / truth.max(1e-12);
        assert!(rel < 1e-9, "exp({}) = {} (want {}), rel err {}", v, to_f(got), truth, rel);
    }
}

#[test]
fn exp_is_monotonic_increasing() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let mut prev = exp_fixed(&env, to_fp(-10.0)).unwrap();
    let mut x = -9.9_f64;
    while x <= 20.0 {
        let cur = exp_fixed(&env, to_fp(x)).unwrap();
        assert!(cur >= prev, "exp not increasing at x={}: {} < {}", x, cur, prev);
        prev = cur;
        x += 0.05;
    }
}

#[test]
fn exp_of_large_negative_floors_to_zero() {
    let env = Env::default();
    assert_eq!(exp_fixed(&env, -EXP_MAX_INPUT - SCALAR_12).unwrap(), 0);
}

#[test]
#[should_panic(expected = "MathOverflow")]
fn exp_above_cap_errors() {
    let env = Env::default();
    exp_fixed(&env, EXP_MAX_INPUT + SCALAR_12).unwrap();
}

// ----------------------------------------------------------------------------- round-trips

#[test]
fn exp_ln_roundtrip() {
    // exp(ln(x)) ≈ x across a wide range.
    let env = Env::default();
    let cases = [0.1_f64, 0.5, 1.0, 1.5, 2.0, 5.0, 10.0, 50.0, 1.05575];
    for &v in &cases {
        let l = ln_fixed(&env, to_fp(v)).unwrap();
        let back = exp_fixed(&env, l).unwrap();
        let rel = (to_f(back) - v).abs() / v;
        assert!(rel < 1e-8, "exp(ln({})) = {} rel err {}", v, to_f(back), rel);
    }
}

#[test]
fn ln_exp_roundtrip() {
    // ln(exp(x)) ≈ x across a wide range (incl. negatives).
    let env = Env::default();
    let cases = [-5.0_f64, -1.0, -0.3, 0.0, 0.3, 1.0, 3.0, 7.0, 15.0];
    for &v in &cases {
        let e = exp_fixed(&env, to_fp(v)).unwrap();
        let back = ln_fixed(&env, e).unwrap();
        let err = (to_f(back) - v).abs();
        assert!(err < 1e-8, "ln(exp({})) = {} err {}", v, to_f(back), err);
    }
}

// ----------------------------------------------------------------------------- error bound sweep

#[test]
fn ln_max_error_bound_over_domain() {
    // Dense sweep over (0, 50]; assert the worst-case absolute error stays under budget.
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let mut max_err = 0.0_f64;
    let mut worst = 0.0_f64;
    let mut x = 0.001_f64;
    while x <= 50.0 {
        let got = ln_fixed(&env, to_fp(x)).unwrap();
        let e = abs_err(got, x.ln());
        if e > max_err {
            max_err = e;
            worst = x;
        }
        x += 0.013; // irregular step to hit varied mantissas
    }
    // Budget: a few ULP of SCALAR_12 (1e-9 real). We assert a comfortable 5e-9.
    assert!(max_err < 5e-9, "ln max err {} at x={} exceeds budget", max_err, worst);
    std::println!("ln max abs error over (0,50]: {:.3e} (at x={:.3})", max_err, worst);
}

#[test]
fn exp_max_error_bound_over_domain() {
    // The honest bound for a SCALAR_12 result is: error is small *relative* to the value when the
    // value is resolvable, but near zero the absolute resolution floor (1 ULP = 1e-12 real)
    // dominates — you cannot represent exp(-20) ≈ 2e-9 to 9 relative digits in 12-dp fixed point.
    // So we assert: rel error < 5e-9  OR  abs error < 2e-12 (a couple ULP). This is met everywhere.
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let mut max_rel = 0.0_f64;
    let mut worst = 0.0_f64;
    let mut x = -20.0_f64;
    while x <= 20.0 {
        let got = exp_fixed(&env, to_fp(x)).unwrap();
        let truth = x.exp();
        let abs = (to_f(got) - truth).abs();
        let rel = abs / truth.max(1e-30);
        // The metric we bound is min(rel, scaled-abs): a point passes if EITHER is tiny.
        let effective = if abs < 2e-12 { 0.0 } else { rel };
        if effective > max_rel {
            max_rel = effective;
            worst = x;
        }
        x += 0.011;
    }
    assert!(max_rel < 5e-9, "exp max rel err {} at x={} exceeds budget", max_rel, worst);
    std::println!("exp max rel error (where resolvable) over [-20,20]: {:.3e} (at x={:.3})", max_rel, worst);
}

// ----------------------------------------------------------------------------- pow + curve-shaped inputs

#[test]
fn pow_matches_reference() {
    let env = Env::default();
    // base^p for a few (base, p): compare to f64 powf.
    let cases = [(1.05_f64, 12.0_f64), (2.0, 0.5), (1.08, 3.5), (1.2, 0.25)];
    for &(b, p) in &cases {
        let got = pow_fixed(&env, to_fp(b), to_fp(p)).unwrap();
        let truth = b.powf(p);
        let rel = (to_f(got) - truth).abs() / truth;
        assert!(rel < 1e-7, "{}^{} = {} (want {}), rel {}", b, p, to_f(got), truth, rel);
    }
}

#[test]
fn ln_handles_curve_proportion_logits() {
    // The curve evaluates ln(prop/(1-prop)). Check the logit at proportions near the usable band.
    let env = Env::default();
    for &prop in &[0.05_f64, 0.2, 0.5, 0.8, 0.95] {
        let ratio = prop / (1.0 - prop);
        let got = ln_fixed(&env, to_fp(ratio)).unwrap();
        let truth = ratio.ln();
        assert!(
            abs_err(got, truth) < 1e-9,
            "{}",
            format!("logit(prop={}) ratio={} err {}", prop, ratio, abs_err(got, truth))
        );
    }
    // proportion 0.5 → ratio 1.0 → ln = 0 exactly.
    assert_eq!(ln_fixed(&env, SCALAR_12).unwrap(), 0);
}

// ----------------------------------------------------------------------------- adversarial / edges

#[test]
fn ln_tiny_and_huge_inputs() {
    let env = Env::default();
    // x = 1e-6 (smallest realistic) and x = 1e6.
    let small = ln_fixed(&env, SCALAR_12 / 1_000_000).unwrap(); // ln(1e-6) ≈ -13.8155
    assert!(abs_err(small, (1e-6_f64).ln()) < 5e-8, "ln(1e-6) err");
    let big = ln_fixed(&env, SCALAR_12 * 1_000_000).unwrap(); // ln(1e6) ≈ 13.8155
    assert!(abs_err(big, (1e6_f64).ln()) < 5e-8, "ln(1e6) err");
}

#[test]
fn exp_small_increments_resolve() {
    // Tiny exponents must still move the result (no flat spot at 0).
    let env = Env::default();
    let e1 = exp_fixed(&env, SCALAR_12 / 1_000_000).unwrap(); // exp(1e-6)
    assert!(e1 > SCALAR_12, "exp(1e-6) must exceed 1.0");
    assert!(abs_err(e1, (1e-6_f64).exp()) < 1e-9);
}

// ----------------------------------------------------------------------------- per-call gas budget

/// The design doc flags per-call host budget as the real ship blocker. A single swap calls `ln`
/// once and `exp` at most once, so prove that one `ln` + one `exp` complete under the **default**
/// (un-reset) Soroban budget — i.e. a real transaction can afford them. (The sweep tests reset the
/// budget only because they make ~1000 calls in a loop.)
#[test]
fn single_call_fits_default_budget() {
    let env = Env::default();
    // No reset_unlimited(): use the default per-invocation budget the host enforces on-chain.
    let l = ln_fixed(&env, to_fp(1.5)).unwrap();
    let _ = exp_fixed(&env, l).unwrap();
    // A second pair (a swap might evaluate the curve twice) should also still fit.
    let l2 = ln_fixed(&env, to_fp(3.0)).unwrap();
    let _ = exp_fixed(&env, l2).unwrap();
}
