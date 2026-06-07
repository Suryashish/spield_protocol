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
    let strategy_id = b.env.register(BlendStrategy, ());
    let client = BlendStrategyClient::new(&b.env, &strategy_id);
    client.initialize(
        &admin,
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
    let strategy_id = b.env.register(BlendStrategy, ());
    let client = BlendStrategyClient::new(&b.env, &strategy_id);
    client.initialize(admin, wrapper, &b.pool, &b.usdc, &max_apr_bps);
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
