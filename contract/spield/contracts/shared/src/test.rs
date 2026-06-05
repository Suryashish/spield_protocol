#![cfg(test)]
//! Pure unit tests for the fixed-point math (no Blend, no host calls beyond I256). Fast, and
//! they pin the exact SCF-#4 worked example from plan §7.4.

use crate::{math, SCALAR_12};
use soroban_sdk::Env;

#[test]
fn shares_underlying_roundtrip_at_rate_1() {
    let env = Env::default();
    // rate = 1.0 → shares == underlying
    let u = math::shares_to_underlying(&env, 100, SCALAR_12).unwrap();
    assert_eq!(u, 100);
    let s = math::underlying_to_shares(&env, 100, SCALAR_12).unwrap();
    assert_eq!(s, 100);
}

#[test]
fn shares_to_underlying_grows_with_rate() {
    let env = Env::default();
    // 100 shares at rate 1.05 = 105 underlying
    let rate = SCALAR_12 + SCALAR_12 / 20; // 1.05
    let u = math::shares_to_underlying(&env, 100_0000000, rate).unwrap();
    assert_eq!(u, 105_0000000);
}

#[test]
fn yield_amount_is_delta_times_yt() {
    let env = Env::default();
    // 100 YT, settled 1.00, current 1.05 → 5 yield
    let settled = SCALAR_12;
    let current = SCALAR_12 + SCALAR_12 / 20;
    let y = math::yield_amount(&env, 100_0000000, settled, current).unwrap();
    assert_eq!(y, 5_0000000);
}

#[test]
fn yield_amount_clamps_at_zero_when_rate_not_risen() {
    let env = Env::default();
    let settled = SCALAR_12 + SCALAR_12 / 20; // 1.05
    let current = SCALAR_12; // 1.00 (lower — should never happen, but clamp)
    let y = math::yield_amount(&env, 100_0000000, settled, current).unwrap();
    assert_eq!(y, 0);
}

/// The exact SCF-#4 worked example (plan §7.4): two tranches at 1.00 and 1.05; at 1.10 the total
/// claimable is 15, not 10. Proves per-position entry rates are honored.
#[test]
fn scf4_two_tranche_total_is_fifteen_not_ten() {
    let env = Env::default();
    let r100 = SCALAR_12; // 1.00
    let r105 = SCALAR_12 + SCALAR_12 / 20; // 1.05
    let r110 = SCALAR_12 + SCALAR_12 / 10; // 1.10

    // Position A: 100 YT entered at 1.00, claimed at 1.10 → 10
    let a = math::yield_amount(&env, 100_0000000, r100, r110).unwrap();
    // Position B: 100 YT entered at 1.05, claimed at 1.10 → 5
    let b = math::yield_amount(&env, 100_0000000, r105, r110).unwrap();
    assert_eq!(a, 10_0000000);
    assert_eq!(b, 5_0000000);
    assert_eq!(a + b, 15_0000000, "v1 lost 5 by overwriting A's entry; v2 must total 15");
}

#[test]
fn rate_bound_accepts_monotonic_within_jump() {
    let env = Env::default();
    let last = SCALAR_12;
    let current = SCALAR_12 + SCALAR_12 / 100; // +1%
    // allow up to 5% jump
    assert!(math::check_rate_bound(&env, last, current, 500).is_ok());
}

#[test]
fn rate_bound_rejects_decrease() {
    let env = Env::default();
    let last = SCALAR_12 + SCALAR_12 / 20;
    let current = SCALAR_12; // decreased
    assert!(math::check_rate_bound(&env, last, current, 10_000).is_err());
}

#[test]
fn rate_bound_rejects_absurd_jump() {
    let env = Env::default();
    let last = SCALAR_12;
    let current = SCALAR_12 * 3; // +200%
    // allow only 50%
    assert!(math::check_rate_bound(&env, last, current, 5_000).is_err());
}

#[test]
fn rate_bound_rejects_nonpositive() {
    let env = Env::default();
    assert!(math::check_rate_bound(&env, SCALAR_12, 0, 10_000).is_err());
    assert!(math::check_rate_bound(&env, SCALAR_12, -1, 10_000).is_err());
}

#[test]
fn mul_div_floor_no_overflow_large() {
    let env = Env::default();
    // 1e15 shares at rate 1.05 (1.05e12) / 1e12 — would overflow naive i128 multiply path only
    // if not widened; here it must compute cleanly.
    let big = 1_000_000_000_000_000i128; // 1e15
    let rate = SCALAR_12 + SCALAR_12 / 20;
    let u = math::shares_to_underlying(&env, big, rate).unwrap();
    assert_eq!(u, 1_050_000_000_000_000);
}
