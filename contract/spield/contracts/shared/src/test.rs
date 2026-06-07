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

const YEAR_SECS: u64 = 365 * 24 * 60 * 60;

#[test]
fn rate_bound_accepts_monotonic_within_annual_cap() {
    let env = Env::default();
    let last = SCALAR_12;
    let current = SCALAR_12 + SCALAR_12 / 100; // +1% over a year
                                               // allow up to 5% APR
    assert!(math::check_rate_bound_timed(&env, last, current, YEAR_SECS, 500).is_ok());
}

#[test]
fn rate_bound_rejects_decrease() {
    let env = Env::default();
    let last = SCALAR_12 + SCALAR_12 / 20;
    let current = SCALAR_12; // decreased
    assert!(math::check_rate_bound_timed(&env, last, current, YEAR_SECS, 10_000).is_err());
}

#[test]
fn rate_bound_rejects_absurd_jump_for_elapsed() {
    let env = Env::default();
    let last = SCALAR_12;
    let current = SCALAR_12 * 3; // +200% in one year
                                 // allow only 50% APR => rejected
    assert!(math::check_rate_bound_timed(&env, last, current, YEAR_SECS, 5_000).is_err());
}

#[test]
fn rate_bound_rejects_nonpositive() {
    let env = Env::default();
    assert!(math::check_rate_bound_timed(&env, SCALAR_12, 0, YEAR_SECS, 10_000).is_err());
    assert!(math::check_rate_bound_timed(&env, SCALAR_12, -1, YEAR_SECS, 10_000).is_err());
}

#[test]
fn rate_bound_first_observation_bypasses_cap() {
    let env = Env::default();
    // last == 0 (no prior observation) accepts any positive current, regardless of cap/elapsed.
    assert!(math::check_rate_bound_timed(&env, 0, SCALAR_12 * 100, 0, 1).is_ok());
    assert!(math::check_rate_bound_timed(&env, 0, 0, 0, 1).is_err()); // still must be positive
}

#[test]
fn rate_bound_is_time_proportional() {
    let env = Env::default();
    let last = SCALAR_12;
    // 100% APR cap. A +10% move is allowed over ~1.2 months (10% of a year) but NOT over 1 month.
    let plus_10pct = last + SCALAR_12 / 10;
    let tenth_year = YEAR_SECS / 10; // exactly 10% of a year => allowance ~= +10%
    assert!(
        math::check_rate_bound_timed(&env, last, plus_10pct, tenth_year + 1000, 10_000).is_ok(),
        "10% rise over ~1/10 year is within a 100% APR cap"
    );
    let one_month = YEAR_SECS / 12;
    assert!(
        math::check_rate_bound_timed(&env, last, plus_10pct, one_month, 10_000).is_err(),
        "the same 10% rise over only 1 month exceeds a 100% APR cap"
    );
}

#[test]
fn rate_bound_same_timestamp_allows_only_dust() {
    let env = Env::default();
    let last = SCALAR_12;
    // elapsed == 0: allowance is just RATE_BOUND_DUST. Equal rate ok; a real rise rejected.
    assert!(math::check_rate_bound_timed(&env, last, last, 0, 30_000).is_ok());
    assert!(
        math::check_rate_bound_timed(&env, last, last + math::RATE_BOUND_DUST, 0, 30_000).is_ok(),
        "dust drift tolerated at the same timestamp"
    );
    assert!(
        math::check_rate_bound_timed(&env, last, last + SCALAR_12 / 100, 0, 30_000).is_err(),
        "a real 1% rise within a single timestamp is rejected"
    );
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

// ---------------------------------------------------------------------------
// Maturity-aware TTL bump (mainnet-readiness #5)
// ---------------------------------------------------------------------------

use crate::ttl;
use soroban_sdk::testutils::Ledger as _;

/// Set the ledger so TTL math has a known now/sequence, with a given `max_entry_ttl` (the count of
/// ledgers, from current, that an entry may live — the SDK's `set_max_entry_ttl` adds 1 internally).
fn set_ledger(env: &Env, timestamp: u64, sequence: u32, max_entry_ttl: u32) {
    env.ledger().with_mut(|li| {
        li.timestamp = timestamp;
        li.sequence_number = sequence;
    });
    env.ledger().set_max_entry_ttl(max_entry_ttl);
}

#[test]
fn ttl_bump_targets_maturity_plus_grace() {
    let env = Env::default();
    // now = 1000s, seq = 100. Maturity 90 days out. Network max-TTL very high (not the constraint).
    let now = 1_000u64;
    let maturity = now + 90 * 24 * 60 * 60;
    set_ledger(&env, now, 100, 50_000_000);

    let (threshold, extend_to) = ttl::maturity_aware_bump(&env, maturity);
    assert_eq!(threshold, 0, "always re-extends");
    // Expected: (maturity + grace - now) / 5 ledgers (network cap is not binding here).
    let expected =
        ((maturity + ttl::POST_MATURITY_GRACE_SECS - now) / ttl::SECS_PER_LEDGER) as u32;
    assert_eq!(extend_to, expected, "bump must reach maturity + grace");
    // And that's well past the old flat 60-day window.
    let flat_60d = (60 * 24 * 60 * 60 / ttl::SECS_PER_LEDGER) as u32;
    assert!(extend_to > flat_60d, "maturity-aware bump exceeds the old 60-day flat bump");
}

#[test]
fn ttl_bump_clamps_to_network_max() {
    let env = Env::default();
    let now = 1_000u64;
    // Maturity 2 years out — beyond the network max-TTL we set below.
    let maturity = now + 2 * 365 * 24 * 60 * 60;
    let seq = 100u32;
    // Network cap: only ~30 days of ledgers allowed from current.
    let cap_ledgers = (30 * 24 * 60 * 60 / ttl::SECS_PER_LEDGER) as u32;
    set_ledger(&env, now, seq, cap_ledgers);

    let (_t, extend_to) = ttl::maturity_aware_bump(&env, maturity);
    let max_extend = env.ledger().max_live_until_ledger() - seq;
    assert_eq!(
        extend_to, max_extend,
        "must clamp to the network max — a >max-TTL bond is re-bumped via bump_position later"
    );
    // The desired (uncapped) value would have been far larger.
    assert!(extend_to < (maturity / ttl::SECS_PER_LEDGER) as u32);
}

#[test]
fn ttl_bump_floors_at_minimum_after_maturity() {
    let env = Env::default();
    let now = 10_000_000u64;
    // Maturity already in the past → desired window is just the grace; still at least MIN_BUMP.
    let maturity = now - 1; // matured
    set_ledger(&env, now, 100, 50_000_000);
    let (_t, extend_to) = ttl::maturity_aware_bump(&env, maturity);
    assert!(
        extend_to >= ttl::MIN_BUMP_LEDGERS,
        "even past maturity the entry gets at least the minimum bump"
    );
}
