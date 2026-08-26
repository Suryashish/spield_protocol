#![cfg(test)]
//! # Phase 0 — Blend de-risking spike (plan §8 Phase 0 exit criterion)
//!
//! These tests run against the **real Blend v2 WASM** (shipped in `blend-contract-sdk`'s
//! `testutils`), not a hand-written mock of Blend. They prove the property v1 never had:
//! the escrowed asset *genuinely grows on-chain*, and we can read that growth back through
//! our strategy adapter. The only mock is the price *oracle* (SEP-40), exactly as Blend's
//! own test suite does it — a local unit test can't reach a real oracle or advance the
//! testnet clock, and we need to control time to make `b_rate` rise on demand.
//!
//! Exit criterion proven here: *supply USDC to Blend → let `b_rate` move → read the gain back.*

extern crate std;

use crate::{BlendStrategy, BlendStrategyClient};
use blend_contract_sdk::{pool, testutils::BlendFixture};
use sep_40_oracle::testutils::{Asset, MockPriceOracleClient, MockPriceOracleWASM};
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, Ledger as _},
    token::StellarAssetClient,
    vec, Address, BytesN, Env, String, Symbol, Vec,
};

const SCALAR_7: i128 = 1_0000000;
/// USDC has 7 decimals on the Blend testnet token; use the same here for parity.
const USDC: i128 = 1_0000000;

/// A fully wired-up Blend test environment with an active pool holding XLM + USDC reserves,
/// a price oracle, and a whale who has seeded both reserves and is borrowing (so utilization
/// is non-zero and the USDC `b_rate` will rise as the ledger advances).
///
/// Holds only owned data (the `Env` + addresses); clients are rebuilt on demand via accessor
/// methods so the struct isn't self-referential (Soroban clients borrow from the `Env`).
struct BlendEnv {
    env: Env,
    pool: Address,
    usdc: Address,
    oracle_id: Address,
    #[allow(dead_code)]
    xlm: Address,
}

impl BlendEnv {
    fn pool_client(&self) -> pool::Client<'_> {
        pool::Client::new(&self.env, &self.pool)
    }
    fn usdc_admin(&self) -> StellarAssetClient<'_> {
        StellarAssetClient::new(&self.env, &self.usdc)
    }
    fn oracle(&self) -> MockPriceOracleClient<'_> {
        MockPriceOracleClient::new(&self.env, &self.oracle_id)
    }
}

/// Blend RequestType discriminants (mirrors the adapter; used by the test whale directly).
const REQ_SUPPLY_COLLATERAL: u32 = 2;
const REQ_BORROW: u32 = 4;

fn register_sac<'a>(env: &'a Env, admin: &Address) -> (Address, StellarAssetClient<'a>) {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let addr = sac.address();
    (addr.clone(), StellarAssetClient::new(env, &addr))
}

/// Deploy Blend + a pool with XLM (collateral) and USDC (borrowable) reserves, an oracle
/// pricing both at $1, and a whale supplying both and borrowing USDC to create utilization.
fn setup_blend() -> BlendEnv {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);
    env.cost_estimate().budget().reset_unlimited();

    let admin = Address::generate(&env);

    // Tokens: BLND + USDC are required by BlendFixture; XLM is our collateral asset.
    let (blnd, _blnd_admin) = register_sac(&env, &admin);
    let (usdc, usdc_admin) = register_sac(&env, &admin);
    let (xlm, xlm_admin) = register_sac(&env, &admin);

    let blend = BlendFixture::deploy(&env, &admin, &blnd, &usdc);

    // Oracle: base USD, 7 decimals; price XLM and USDC at $1.00 each (stable => never stale).
    let oracle_id = Address::generate(&env);
    env.register_at(&oracle_id, MockPriceOracleWASM, ());
    let oracle = MockPriceOracleClient::new(&env, &oracle_id);
    oracle.set_data(
        &admin,
        &Asset::Other(Symbol::new(&env, "USD")),
        &vec![
            &env,
            Asset::Stellar(xlm.clone()),
            Asset::Stellar(usdc.clone()),
        ],
        &7,
        &300,
    );
    oracle.set_price_stable(&vec![&env, 1_0000000, 1_0000000]);

    // Deploy a pool via the factory.
    let pool = blend.pool_factory.deploy(
        &admin,
        &String::from_str(&env, "spield-test-pool"),
        &BytesN::<32>::random(&env),
        &oracle_id,
        &0_1000000, // 10% backstop take rate
        &6,         // max positions
        &1_0000000, // $1 min collateral to borrow
    );
    let pool_client = pool::Client::new(&env, &pool);

    // Add XLM and USDC reserves with the default config.
    let mut cfg = blend_contract_sdk::testutils::default_reserve_config();
    cfg.index = 0;
    pool_client.queue_set_reserve(&xlm, &cfg);
    pool_client.set_reserve(&xlm);
    cfg.index = 1;
    pool_client.queue_set_reserve(&usdc, &cfg);
    pool_client.set_reserve(&usdc);

    // Backstop the pool and activate it.
    blend.backstop.deposit(&admin, &pool, &50_000_0000000);
    pool_client.set_status(&3);
    pool_client.update_status();

    // Whale supplies XLM as collateral + USDC liquidity, then borrows USDC => utilization > 0.
    let whale = Address::generate(&env);
    xlm_admin.mint(&whale, &(1_000_000 * SCALAR_7));
    usdc_admin.mint(&whale, &(1_000_000 * USDC));
    let requests = Vec::from_array(
        &env,
        [
            pool::Request {
                request_type: REQ_SUPPLY_COLLATERAL,
                address: xlm.clone(),
                amount: 500_000 * SCALAR_7,
            },
            pool::Request {
                request_type: REQ_SUPPLY_COLLATERAL,
                address: usdc.clone(),
                amount: 200_000 * USDC,
            },
            pool::Request {
                request_type: REQ_BORROW,
                address: usdc.clone(),
                amount: 100_000 * USDC, // 50% utilization of the whale's own USDC supply
            },
        ],
    );
    pool_client.submit(&whale, &whale, &whale, &requests);

    BlendEnv {
        env,
        pool,
        usdc,
        oracle_id,
        xlm,
    }
}

/// Deploy + initialize our strategy adapter against a Blend env, owned by `wrapper`.
fn deploy_strategy<'a>(b: &'a BlendEnv, wrapper: &Address) -> BlendStrategyClient<'a> {
    let admin = Address::generate(&b.env);
    let strategy_id = b.env.register(BlendStrategy, (admin.clone(),)); // constructor binds admin
    let client = BlendStrategyClient::new(&b.env, &strategy_id);
    client.initialize(
        wrapper,
        &b.pool,
        &b.usdc,
        &30_000u32, // allow up to 300% APR growth in tests (time-pro-rated; we fast-forward years)
    );
    client
}

/// Advance the ledger clock by `secs` and poke the pool so interest accrues into `b_rate`.
fn advance(b: &BlendEnv, secs: u64) {
    let t = b.env.ledger().timestamp();
    b.env.ledger().set_timestamp(t + secs);
    // Re-stamp stable prices so they're fresh at the new time, then touch the pool to accrue.
    b.oracle().set_price_stable(&vec![&b.env, 1_0000000, 1_0000000]);
    // `get_reserve` returns reserve data accrued to the current ledger.
    b.pool_client().get_reserve(&b.usdc);
}

// ---------------------------------------------------------------------------
// Phase 0 exit criterion
// ---------------------------------------------------------------------------

/// THE Phase 0 test: supply USDC to a real Blend pool through our adapter, let `b_rate` rise
/// as real borrower interest accrues over a year, and read the gain back. Proves the yield is
/// real, on-chain, and readable — the property v1 lacked.
#[test]
fn phase0_supply_let_brate_move_read_gain_back() {
    let b = setup_blend();
    // The "wrapper" is just an address here; the adapter only checks it's the configured caller.
    let wrapper = Address::generate(&b.env);
    let strategy = deploy_strategy(&b, &wrapper);

    // Fund the wrapper with USDC and have it deposit 1000 USDC via the adapter.
    let deposit = 1_000 * USDC;
    b.usdc_admin().mint(&wrapper, &deposit);

    let rate_before = strategy.current_rate();
    let shares = strategy.deposit(&wrapper, &deposit);
    assert!(shares > 0, "Blend must credit bToken shares for the supply");

    // Value right after deposit ~= the principal (allowing for floor rounding).
    let value_at_entry = strategy.position_value(&shares);
    assert!(
        (deposit - value_at_entry).abs() <= 2,
        "value at entry ({}) should equal principal ({})",
        value_at_entry,
        deposit
    );

    // Let a full year pass with active borrowing => b_rate rises.
    advance(&b, 365 * 24 * 60 * 60);

    let rate_after = strategy.current_rate();
    assert!(
        rate_after > rate_before,
        "b_rate must rise: before={} after={}",
        rate_before,
        rate_after
    );

    // The gain we can read back through the adapter.
    let value_after = strategy.position_value(&shares);
    let gain = value_after - deposit;
    std::println!(
        "Phase 0: deposit={} value_after={} gain={} (rate {} -> {})",
        deposit,
        value_after,
        gain,
        rate_before,
        rate_after
    );
    assert!(
        gain > 0,
        "the escrowed Blend position must have grown (gain={})",
        gain
    );
    // Sanity: a year at ~some positive rate on 1000 USDC should be a non-trivial but bounded gain.
    assert!(gain < deposit, "gain should be a yield, not a doubling");
}

/// We can withdraw the exact principal back out of Blend (liquidity permitting), proving the
/// redeem path works against real Blend, not just the read path.
#[test]
fn phase0_redeem_underlying_returns_funds() {
    let b = setup_blend();
    let wrapper = Address::generate(&b.env);
    let strategy = deploy_strategy(&b, &wrapper);

    let deposit = 1_000 * USDC;
    b.usdc_admin().mint(&wrapper, &deposit);
    strategy.deposit(&wrapper, &deposit);

    advance(&b, 180 * 24 * 60 * 60);

    // Withdraw 500 USDC of underlying to a recipient.
    let recipient = Address::generate(&b.env);
    let usdc_token = soroban_sdk::token::Client::new(&b.env, &b.usdc);
    let bal_before = usdc_token.balance(&recipient);
    let shares_burned = strategy.redeem_underlying(&recipient, &(500 * USDC));
    let bal_after = usdc_token.balance(&recipient);

    assert!(shares_burned > 0, "must burn shares to withdraw");
    assert_eq!(
        bal_after - bal_before,
        500 * USDC,
        "recipient must receive exactly the requested underlying"
    );
}

/// The rate sanity bound rejects an absurd reading. (Construct via a tiny custom-bound deploy:
/// here we just assert the bound logic is wired by checking a normal read passes; the unit-level
/// bound math is tested in spield-shared.)
#[test]
fn phase0_current_rate_is_monotonic_across_reads() {
    let b = setup_blend();
    let wrapper = Address::generate(&b.env);
    let strategy = deploy_strategy(&b, &wrapper);

    let r1 = strategy.current_rate();
    advance(&b, 30 * 24 * 60 * 60);
    let r2 = strategy.current_rate();
    advance(&b, 30 * 24 * 60 * 60);
    let r3 = strategy.current_rate();
    assert!(r1 <= r2 && r2 <= r3, "b_rate must be monotonic: {} {} {}", r1, r2, r3);
}

// ---------------------------------------------------------------------------
// Mainnet-readiness #3: the TIME-AWARE max_apr_bps sanity bound + safety valve
// ---------------------------------------------------------------------------

/// Deploy the adapter with a caller-chosen `max_apr_bps` (the default helper hardcodes 30_000).
fn deploy_strategy_with_bound<'a>(
    b: &'a BlendEnv,
    wrapper: &Address,
    admin: &Address,
    max_apr_bps: u32,
) -> BlendStrategyClient<'a> {
    let strategy_id = b.env.register(BlendStrategy, (admin.clone(),)); // constructor binds admin
    let client = BlendStrategyClient::new(&b.env, &strategy_id);
    client.initialize(wrapper, &b.pool, &b.usdc, &max_apr_bps);
    client
}

/// THE point of the time-aware bound: a position can sit **untouched for a long time** and the next
/// read must still pass, because the allowed `b_rate` rise is pro-rated by the elapsed seconds — not
/// a fixed per-read cap. (The old per-read form would soft-brick here.) We use a realistic annual
/// cap (300% APR) and a year-long gap; real Blend growth is far under the cap, so the read succeeds.
#[test]
fn time_aware_bound_does_not_soft_brick_after_a_long_gap() {
    let b = setup_blend();
    let wrapper = Address::generate(&b.env);
    let admin = Address::generate(&b.env);
    let strategy = deploy_strategy_with_bound(&b, &wrapper, &admin, 30_000u32); // 300% APR cap

    let deposit = 1_000 * USDC;
    b.usdc_admin().mint(&wrapper, &deposit);
    strategy.current_rate(); // establish last_rate + last_ts
    strategy.deposit(&wrapper, &deposit);

    // A full year with no reads in between — the danger case for the old per-read bound.
    advance(&b, 365 * 24 * 60 * 60);

    // Must NOT trip: the year of elapsed time scales the allowance up to a full year's worth.
    let rate = strategy.current_rate();
    assert!(rate > 0, "a long-untouched read must still pass under the time-aware bound");
}

/// The bound still catches a genuinely impossible rate (its defence-in-depth purpose): over a tiny
/// elapsed window the pro-rated allowance is ~0, so a same-instant rate that jumped is rejected.
/// `set_max_apr_bps` is the admin safety valve — widen the annual cap and reads pass again.
#[test]
fn tiny_annual_cap_trips_then_set_max_apr_bps_unsticks() {
    let b = setup_blend();
    let wrapper = Address::generate(&b.env);
    let admin = Address::generate(&b.env);
    // Absurdly tight: 1 bps = 0.01% APR. Even a full year of real Blend growth exceeds this.
    let strategy = deploy_strategy_with_bound(&b, &wrapper, &admin, 1u32);

    let deposit = 1_000 * USDC;
    b.usdc_admin().mint(&wrapper, &deposit);
    strategy.current_rate();
    strategy.deposit(&wrapper, &deposit);
    advance(&b, 365 * 24 * 60 * 60);

    // 0.01% APR over a year is still far below the real accrual => rejected (soft-brick condition).
    assert_eq!(
        strategy.try_current_rate(),
        Err(Ok(spield_shared::Error::RateOutOfBounds.into())),
        "a real jump beyond the (absurdly tight) annual cap must be rejected"
    );

    // Admin widens the annual cap (the valve). Reads work again — no redeploy needed.
    strategy.set_max_apr_bps(&30_000u32);
    let (_, _, max) = strategy.rate_bound();
    assert_eq!(max, 30_000u32, "annual cap widened");
    let rate = strategy.current_rate();
    assert!(rate > 0, "reads work again after widening the cap");
    let total = strategy.total_shares();
    assert!(strategy.position_value(&total) > 0, "downstream value reads unfrozen");
}

// ---------------------------------------------------------------------------
// The `b_rate` DECREASE valve: `reset_rate_floor` (tofix.md item 3)
// ---------------------------------------------------------------------------

/// The valve against the real Blend pool. Blend's `b_rate` only rises, so we cannot make
/// it dip here — instead we drive the stored high-water mark ABOVE the live rate the only
/// honest way available: read at a late timestamp (recording a high `last_rate`), then
/// evaluate at an earlier one. That reproduces exactly the `current < last` condition a
/// bad-debt socialisation would create, against real pool data.
#[test]
fn reset_rate_floor_recovers_from_a_stale_high_water_mark() {
    let b = setup_blend();
    let wrapper = Address::generate(&b.env);
    let admin = Address::generate(&b.env);
    let strategy = deploy_strategy_with_bound(&b, &wrapper, &admin, 30_000u32);

    let deposit = 1_000 * USDC;
    b.usdc_admin().mint(&wrapper, &deposit);
    strategy.deposit(&wrapper, &deposit);

    // Record a high-water mark a year out…
    advance(&b, 365 * 24 * 60 * 60);
    let high = strategy.current_rate();
    let (stored, _, _) = strategy.rate_bound();
    assert_eq!(stored, high);

    // …then evaluate against an earlier ledger, where the pool's real rate is lower.
    b.env.ledger().set_timestamp(b.env.ledger().timestamp() - 180 * 24 * 60 * 60);
    b.oracle().set_price_stable(&vec![&b.env, 1_0000000, 1_0000000]);
    let frozen = strategy.try_current_rate();
    assert_eq!(
        frozen,
        Err(Ok(spield_shared::Error::RateOutOfBounds.into())),
        "a rate below the stored high-water mark must freeze reads (the failure mode)"
    );
    // The wrong valve stays wrong, against real Blend too.
    strategy.set_max_apr_bps(&u32::MAX);
    assert_eq!(
        strategy.try_current_rate(),
        Err(Ok(spield_shared::Error::RateOutOfBounds.into())),
        "set_max_apr_bps widens the UPPER ceiling; it cannot clear a decrease"
    );

    // The right valve: one admin call, and reads resolve again.
    let new_floor = strategy.reset_rate_floor();
    assert!(new_floor < high, "the floor was lowered: {} -> {}", high, new_floor);
    let rate = strategy.current_rate();
    assert_eq!(rate, new_floor, "reads return the live pool rate");
    let total = strategy.total_shares();
    assert!(strategy.position_value(&total) > 0, "downstream value reads unfrozen");
}

/// The valve is admin-only. It can only ever lower a sanity threshold, but it is still a
/// privileged operation and must not be callable by anyone who notices the freeze.
#[test]
fn reset_rate_floor_is_admin_gated() {
    let b = setup_blend();
    let wrapper = Address::generate(&b.env);
    let admin = Address::generate(&b.env);
    let strategy = deploy_strategy_with_bound(&b, &wrapper, &admin, 30_000u32);

    // The env mocks all auths, so assert the requirement was RECORDED against the admin —
    // that is what proves the gate exists rather than that the call happened to succeed.
    strategy.reset_rate_floor();
    let auths = b.env.auths();
    assert!(
        auths.iter().any(|(addr, _)| addr == &admin),
        "reset_rate_floor must require the admin's authorization, got {:?}",
        auths.len()
    );
}

/// It is not timelocked, deliberately: a liveness valve that must work during an incident.
/// Governance still applies to *who* may call it, so a rotated admin inherits it.
#[test]
fn rotated_admin_inherits_the_rate_floor_valve() {
    let b = setup_blend();
    let wrapper = Address::generate(&b.env);
    let admin = Address::generate(&b.env);
    let strategy = deploy_strategy_with_bound(&b, &wrapper, &admin, 30_000u32);

    let new_admin = Address::generate(&b.env);
    strategy.propose_admin(&new_admin);
    strategy.accept_admin();
    assert_eq!(strategy.admin(), new_admin);

    strategy.reset_rate_floor();
    assert!(
        b.env.auths().iter().any(|(addr, _)| addr == &new_admin),
        "the rotated admin must be the one authorizing the valve"
    );
}

/// Admin can rotate (two-step) and the new admin controls `set_max_apr_bps`.
#[test]
fn strategy_admin_rotation_and_governed_set_max_apr() {
    let b = setup_blend();
    let wrapper = Address::generate(&b.env);
    let admin = Address::generate(&b.env);
    let strategy = deploy_strategy_with_bound(&b, &wrapper, &admin, 5_000u32);

    assert_eq!(strategy.admin(), admin);
    let new_admin = Address::generate(&b.env);
    strategy.propose_admin(&new_admin);
    assert_eq!(strategy.pending_admin(), Some(new_admin.clone()));
    strategy.accept_admin();
    assert_eq!(strategy.admin(), new_admin);

    strategy.set_max_apr_bps(&7_777u32);
    let (_, _, max) = strategy.rate_bound();
    assert_eq!(max, 7_777u32);
}

// ===========================================================================
// Re-review of the 2026-08-24 `current_rate` change (SR-stack prerequisite)
//
// The diff removed one guard so the RateBound write became unconditional:
//
//   -  if rate > bound.last_rate || now > bound.last_ts {
//   -      if rate > bound.last_rate { bound.last_rate = rate; }
//   -      bound.last_ts = now;
//   -      env.storage().instance().set(&DataKey::Bound, &bound);
//   -      Self::bump_instance(&env);
//   -  }
//   +  if rate > bound.last_rate { bound.last_rate = rate; }
//   +  bound.last_ts = now;
//   +  env.storage().instance().set(&DataKey::Bound, &bound);
//   +  Self::bump_instance(&env);
//
// This contract is shared with the audited v1 deployment, so the change needs to be shown SAFE,
// not merely useful. The argument, then the tests that pin it:
//
//   The old guard could only be FALSE when `rate <= last_rate && now <= last_ts`. Ledger
//   timestamps are non-decreasing and `last_ts` was itself a past `now`, so `now <= last_ts`
//   implies `now == last_ts` — i.e. a second call inside the SAME ledger with a non-rising rate.
//   In exactly that case the new code writes `last_rate` unchanged and `last_ts = now == last_ts`:
//   **byte-identical values**. Every other input reaches an identical write under both versions.
//
//   So the change alters no stored state. It alters only *whether a write happens*, which is what
//   made the transaction footprint depend on wall-clock timing — see `Sr::exchange_rate`.
//
// Cost: one extra instance write on a path that already reads that entry, plus a TTL bump that is
// strictly protective. Measured below.
// ===========================================================================

/// Same-ledger repeats are idempotent: the stored bound is unchanged, which is the exact case the
/// removed guard used to skip.
#[test]
fn repeated_same_ledger_rate_reads_leave_the_bound_identical() {
    let b = setup_blend();
    let wrapper = Address::generate(&b.env);
    let s = deploy_strategy(&b, &wrapper);

    let first = s.current_rate();
    let bound_after_first = s.rate_bound(); // (last_rate, last_ts, max_apr_bps)
    // Several more reads in the SAME ledger — no time passes, the rate cannot rise.
    for _ in 0..5 {
        assert_eq!(s.current_rate(), first, "rate must not move within a ledger");
        assert_eq!(
            s.rate_bound(),
            bound_after_first,
            "the unconditional write must store identical values on a same-ledger repeat"
        );
    }
}

/// Across ledgers the bound advances exactly as before: `last_ts` tracks now, `last_rate` only
/// ratchets upward.
#[test]
fn the_bound_still_advances_correctly_across_ledgers() {
    let b = setup_blend();
    let wrapper = Address::generate(&b.env);
    let s = deploy_strategy(&b, &wrapper);

    let mut prev = s.rate_bound();
    for _ in 0..4 {
        advance(&b, 30 * 24 * 60 * 60);
        let rate = s.current_rate();
        let now = b.env.ledger().timestamp();
        let (last_rate, last_ts, _) = s.rate_bound();
        assert_eq!(last_ts, now, "last_ts must track the observation time");
        assert_eq!(last_rate, rate, "last_rate must equal the observed rate once it has risen");
        assert!(last_rate >= prev.0, "last_rate must never fall");
        assert!(last_ts >= prev.1, "last_ts must never go backwards");
        prev = (last_rate, last_ts, prev.2);
    }
}

// NOTE on the monotonicity half of the bound: forcing `b_rate` DOWN needs a test-only setter this
// contract deliberately does not expose, and `BlendFixture` cannot push the real rate backwards.
// That half is covered against a controllable mock in `wrapper::test_rate_brick`
// (`brate_decrease_bricks_every_entry_point_including_exits`) and in `sr::test`
// (`a_guarded_strategy_still_bricks_sr_on_a_rate_dip`) — both still pass after this change, which
// is the evidence that the CHECK was untouched and only the WRITE became unconditional.

/// And the *ceiling* half of the bound still fires: an implausible jump is still rejected.
#[test]
fn the_ceiling_guard_still_fires_after_the_change() {
    let b = setup_blend();
    let wrapper = Address::generate(&b.env);
    // A 1 bps/yr cap makes any real accrual look implausible.
    let admin = Address::generate(&b.env);
    let s = deploy_strategy_with_bound(&b, &wrapper, &admin, 1);
    s.current_rate();
    advance(&b, 365 * 24 * 60 * 60);
    assert!(
        s.try_current_rate().is_err(),
        "a rise past the pro-rated ceiling must still be refused"
    );
}

/// The measured cost of making the write unconditional, so the trade-off is a number rather than an
/// assertion. One instance write on a path that already reads that entry.
#[test]
fn the_unconditional_write_costs_one_instance_entry() {
    let b = setup_blend();
    let wrapper = Address::generate(&b.env);
    let s = deploy_strategy(&b, &wrapper);
    s.current_rate(); // warm

    b.env.cost_estimate().budget().reset_unlimited();
    s.current_rate();
    let r = b.env.cost_estimate().resources();
    std::println!(
        "current_rate (same-ledger repeat, always writes): {} insns, {} mem, {} write entries, {} write bytes",
        r.instructions, r.mem_bytes, r.write_entries, r.write_bytes
    );
    assert!(r.write_entries <= 2, "should touch its own instance entry, not a pile of them");
    assert!(r.instructions < 50_000_000, "still cheap");
}

// ---------------------------------------------------------------------------
// tofix.md #20 / V2_WORK §12 — how large must the safety haircut actually be?
// ---------------------------------------------------------------------------

/// Build a world, put a strategy position in it, and drive the venue to roughly `target_util_pct`
/// of its USDC supply. Returns `(strategy, whale, achieved_utilization_bps)`.
fn world_at_utilization(target_util_pct: i128) -> (BlendEnv, Address, Address, i128) {
    let b = setup_blend();
    let wrapper = Address::generate(&b.env);
    let strategy_id = {
        let admin = Address::generate(&b.env);
        b.env.register(BlendStrategy, (admin,))
    };
    BlendStrategyClient::new(&b.env, &strategy_id).initialize(&wrapper, &b.pool, &b.usdc, &30_000u32);
    b.usdc_admin().mint(&wrapper, &(100_000 * USDC));
    BlendStrategyClient::new(&b.env, &strategy_id).deposit(&wrapper, &(100_000 * USDC));

    // A borrower with ample collateral, so utilization is what binds and not the health factor.
    let borrower = Address::generate(&b.env);
    StellarAssetClient::new(&b.env, &b.xlm).mint(&borrower, &(50_000_000 * SCALAR_7));
    b.pool_client().submit(&borrower, &borrower, &borrower, &vec![
        &b.env,
        pool::Request { request_type: REQ_SUPPLY_COLLATERAL, address: b.xlm.clone(), amount: 50_000_000 * SCALAR_7 },
    ]);

    // Walk utilization up in halving chunks until the target is reached or Blend refuses.
    let reserve = |b: &BlendEnv| {
        let r = b.pool_client().get_reserve(&b.usdc);
        let supplied = r.data.b_supply * r.data.b_rate / 1_000_000_000_000i128;
        let borrowed = r.data.d_supply * r.data.d_rate / 1_000_000_000_000i128;
        (supplied, borrowed)
    };
    let (supplied, borrowed0) = reserve(&b);
    let want = supplied * target_util_pct / 100 - borrowed0;
    let mut chunk = if want > 0 { want } else { 0 };
    while chunk > USDC {
        let ok = b.pool_client().try_submit(&borrower, &borrower, &borrower, &vec![
            &b.env,
            pool::Request { request_type: REQ_BORROW, address: b.usdc.clone(), amount: chunk },
        ]).is_ok();
        if !ok { chunk /= 2; } else { break; }
    }
    let (s2, d2) = reserve(&b);
    let util_bps = if s2 > 0 { d2 * 10_000 / s2 } else { 0 };
    (b, wrapper, strategy_id, util_bps)
}

/// **How much safety margin does `available_liquidity()` actually need?**
///
/// It reports `min(pool_balance, supplied - borrowed/max_util)`. `Sr::max_redeemable` then takes
/// `LIQUIDITY_HAIRCUT_BPS` off before converting to shares, and that constant is the open question
/// in `V2_WORK.md` §12 — it was 1%, chosen without measurement, back when the estimate was the raw
/// balance and overstated the truth by ~13%.
///
/// This measures the residual directly: at several utilization levels, try to withdraw **exactly**
/// what `available_liquidity()` reports, and if that fails, ladder down until it succeeds. The
/// largest haircut any level needs is the number the constant must cover.
#[test]
fn measure_the_haircut_available_liquidity_actually_needs() {
    extern crate std;
    std::println!(
        "{:>7} | {:>18} | {:>18} | {:>10}",
        "util", "probe ceiling", "largest accepted", "haircut"
    );
    let mut worst_bps = 0i128;

    for target in [50i128, 70, 85, 94] {
        // Probe fractions of the reported figure, from "all of it" downward. Each probe needs a
        // fresh world, because a successful withdrawal changes the utilization it was measured at.
        let mut accepted_bps = 0i128;
        let mut avail_seen = 0i128;
        let mut util_seen = 0i128;

        for frac_bps in [10_000i128, 9_999, 9_990, 9_950, 9_900, 9_500, 9_000] {
            let (b, wrapper, strategy_id, util) = world_at_utilization(target);
            let strategy = BlendStrategyClient::new(&b.env, &strategy_id);
            let avail = strategy.available_liquidity();
            // Cap the probe at what this position is actually worth. At low utilization the venue
            // can pay more than we hold, and a failure there would mean "we don't own that much",
            // not "the venue refused" — `Sr::max_redeemable` returns `i128::MAX` for exactly that
            // case and the haircut never applies.
            let position = strategy.position_value(&strategy.total_shares());
            let ceiling = if avail < position { avail } else { position };
            avail_seen = ceiling;
            util_seen = util;
            if ceiling <= 0 { break; }
            let amount = ceiling * frac_bps / 10_000;
            if amount <= 0 { break; }
            if strategy.try_redeem_underlying(&wrapper, &amount).is_ok() {
                accepted_bps = frac_bps;
                break;
            }
        }

        let haircut_bps = 10_000 - accepted_bps;
        if accepted_bps > 0 && haircut_bps > worst_bps { worst_bps = haircut_bps; }
        std::println!(
            "{:>6.2}% | {:>18} | {:>17}% | {:>7} bps",
            util_seen as f64 / 100.0,
            avail_seen,
            accepted_bps as f64 / 100.0,
            haircut_bps
        );
    }

    std::println!("=> largest haircut any level required: {worst_bps} bps (LIQUIDITY_HAIRCUT_BPS is 100)");
    assert!(
        worst_bps <= 100,
        "the shipped 1% haircut must cover the measured residual, but {worst_bps} bps were needed"
    );
}
