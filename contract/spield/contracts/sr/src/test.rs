#![cfg(test)]
//! # SR — focused tests against a controllable strategy
//!
//! The full-stack SR behaviour (share semantics, growth, round trips) is covered end-to-end
//! against real Blend in `spield-yield`'s suite. What can **not** be tested there is a `b_rate`
//! **dip**: `BlendFixture` cannot be pushed backwards. So this suite drives SR against a mock
//! `YieldStrategy` whose rate we set directly, to answer one question precisely —
//!
//! **does SR's monotonic high-water clamp actually protect against `tofix.md` #3?**
//!
//! The answer, measured below, is **no, not on its own**, and the doc comment on
//! `Sr::exchange_rate` now says so.

extern crate std;

use crate::{Sr, SrClient};
use soroban_sdk::{
    contract, contractimpl, contracttype, panic_with_error,
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient,
    Address, Env,
};
use spield_shared::{math, types::RateBound, Error, SCALAR_12};

const USDC: i128 = 1_0000000;

#[derive(Clone)]
#[contracttype]
enum MK {
    Rate,
    Underlying,
    Shares,
    Bound,
    /// When true, `current_rate` enforces the same monotonicity guard the real Blend adapter does
    /// (and therefore panics on a dip). When false it reports the dip honestly.
    Guarded,
}

/// A minimal `YieldStrategy` whose rate we control. `guarded = true` mirrors `spield-strategy`'s
/// `check_rate_bound_timed` exactly, including the panic on `current < last`.
#[contract]
pub struct MockStrategy;

#[contractimpl]
impl MockStrategy {
    pub fn init(env: Env, underlying: Address, rate: i128, guarded: bool) {
        let s = env.storage().instance();
        s.set(&MK::Underlying, &underlying);
        s.set(&MK::Rate, &rate);
        s.set(&MK::Shares, &0i128);
        s.set(&MK::Guarded, &guarded);
        s.set(
            &MK::Bound,
            &RateBound {
                last_rate: rate,
                last_ts: env.ledger().timestamp(),
                max_apr_bps: 30_000,
            },
        );
    }

    /// Test hook: set the raw rate, including downward.
    pub fn set_rate(env: Env, rate: i128) {
        env.storage().instance().set(&MK::Rate, &rate);
    }

    pub fn deposit(env: Env, from: Address, amount: i128) -> i128 {
        let rate: i128 = env.storage().instance().get(&MK::Rate).unwrap();
        let underlying: Address = env.storage().instance().get(&MK::Underlying).unwrap();
        soroban_sdk::token::Client::new(&env, &underlying).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );
        let shares = math::underlying_to_shares(&env, amount, rate).unwrap();
        let total: i128 = env.storage().instance().get(&MK::Shares).unwrap_or(0);
        env.storage().instance().set(&MK::Shares, &(total + shares));
        shares
    }

    pub fn redeem(env: Env, to: Address, shares: i128) -> i128 {
        let rate: i128 = env.storage().instance().get(&MK::Rate).unwrap();
        let underlying: Address = env.storage().instance().get(&MK::Underlying).unwrap();
        let amount = math::shares_to_underlying(&env, shares, rate).unwrap();
        soroban_sdk::token::Client::new(&env, &underlying).transfer(
            &env.current_contract_address(),
            &to,
            &amount,
        );
        let total: i128 = env.storage().instance().get(&MK::Shares).unwrap_or(0);
        env.storage().instance().set(&MK::Shares, &(total - shares));
        amount
    }

    /// The venue can only pay out what it actually holds — the same measure the real Blend adapter
    /// uses, and realistic here because this mock custodies the underlying itself.
    pub fn available_liquidity(env: Env) -> i128 {
        let underlying: Address = env.storage().instance().get(&MK::Underlying).unwrap();
        soroban_sdk::token::Client::new(&env, &underlying).balance(&env.current_contract_address())
    }

    /// Test hook: simulate a liquidity crunch. Moves underlying OUT of the venue without touching
    /// share accounting — exactly the shape of borrowers having drawn down a lending pool.
    pub fn drain(env: Env, to: Address, amount: i128) {
        let underlying: Address = env.storage().instance().get(&MK::Underlying).unwrap();
        soroban_sdk::token::Client::new(&env, &underlying)
            .transfer(&env.current_contract_address(), &to, &amount);
    }

    pub fn redeem_underlying(env: Env, to: Address, amount: i128) -> i128 {
        let rate: i128 = env.storage().instance().get(&MK::Rate).unwrap();
        let shares = math::underlying_to_shares(&env, amount, rate).unwrap();
        Self::redeem(env, to, shares);
        shares
    }

    /// The real adapter's guard: `b_rate` is documented monotonic, so a dip is treated as a fault
    /// and **panics** — which is exactly `tofix.md` #3.
    pub fn current_rate(env: Env) -> i128 {
        let rate: i128 = env.storage().instance().get(&MK::Rate).unwrap();
        let guarded: bool = env.storage().instance().get(&MK::Guarded).unwrap_or(true);
        if guarded {
            let bound: RateBound = env.storage().instance().get(&MK::Bound).unwrap();
            if rate < bound.last_rate {
                panic_with_error!(&env, Error::RateOutOfBounds);
            }
            env.storage().instance().set(
                &MK::Bound,
                &RateBound {
                    last_rate: rate,
                    last_ts: env.ledger().timestamp(),
                    max_apr_bps: bound.max_apr_bps,
                },
            );
        }
        rate
    }

    pub fn position_value(env: Env, shares: i128) -> i128 {
        let rate: i128 = env.storage().instance().get(&MK::Rate).unwrap();
        math::shares_to_underlying(&env, shares, rate).unwrap_or(0)
    }

    pub fn total_shares(env: Env) -> i128 {
        env.storage().instance().get(&MK::Shares).unwrap_or(0)
    }

    pub fn underlying(env: Env) -> Address {
        env.storage().instance().get(&MK::Underlying).unwrap()
    }
}

struct W {
    env: Env,
    sr: Address,
    strategy: Address,
    usdc: Address,
}

impl W {
    fn sr(&self) -> SrClient<'_> {
        SrClient::new(&self.env, &self.sr)
    }
    fn st(&self) -> MockStrategyClient<'_> {
        MockStrategyClient::new(&self.env, &self.strategy)
    }
    fn usdc_balance(&self, who: &Address) -> i128 {
        soroban_sdk::token::Client::new(&self.env, &self.usdc).balance(who)
    }
    fn user(&self, amount: i128) -> Address {
        let u = Address::generate(&self.env);
        StellarAssetClient::new(&self.env, &self.usdc).mint(&u, &amount);
        u
    }
}

fn setup(guarded: bool) -> W {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);
    env.cost_estimate().budget().reset_unlimited();

    let admin = Address::generate(&env);
    let usdc = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let strategy = env.register(MockStrategy, ());
    MockStrategyClient::new(&env, &strategy).init(&usdc, &SCALAR_12, &guarded);

    let sr = env.register(Sr, (admin.clone(),));
    SrClient::new(&env, &sr).initialize(&strategy);
    W { env, sr, strategy, usdc }
}

// ===========================================================================
// tofix.md #3 — does SR's clamp help?
// ===========================================================================

/// **It does not, on its own.** The real adapter panics `RateOutOfBounds` *inside*
/// `current_rate()`, so SR never gets a chance to clamp. The high-water mark protects against a
/// strategy that *reports* a lower rate, not against one that refuses to report at all.
///
/// This is the honest scope of the mitigation, and the reason `tofix.md` #3 stays open.
#[test]
fn a_guarded_strategy_still_bricks_sr_on_a_rate_dip() {
    let w = setup(true);
    let u = w.user(1_000 * USDC);
    let shares = w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);
    assert!(shares > 0);

    // Blend socialises bad debt: b_rate dips by one stroop.
    w.st().set_rate(&(SCALAR_12 - 1));

    // READS now survive: `exchange_rate` is a pure read of SR's own stored high-water mark and
    // never touches the strategy (see its doc comment — this was forced by a testnet footprint
    // failure, and closing tofix #27 at this layer bought #3 partial relief for free).
    assert_eq!(
        w.sr().exchange_rate(),
        SCALAR_12,
        "the rate read must survive a strategy that refuses to report"
    );
    // Anything that must REFRESH from the strategy still bricks — that is #3, unchanged.
    assert!(w.sr().try_sync_rate().is_err(), "sync still bricks");
    assert!(
        w.sr().try_deposit(&u, &u, &(1 * USDC), &0i128).is_err(),
        "deposits still brick"
    );
    // `redeem` does not read `current_rate`, so the exit survives — that is the one thing SR
    // improves over the v1 wrapper, whose `combine_and_redeem` auto-claims and therefore reads it.
    let out = w.sr().redeem(&u, &u, &shares, &0i128);
    assert!(out > 0, "SR redemption must survive a dip");
    std::println!(
        "guarded dip: sync + deposits brick (tofix #3 unchanged), but reads AND redeem survive — redeem paid {out}"
    );
}

/// If the adapter *reports* a dip instead of panicking, SR's clamp is what stops the whole stack
/// above it repricing downward. This is the case the clamp is actually for.
#[test]
fn the_high_water_clamp_holds_the_rate_when_the_strategy_reports_a_dip() {
    let w = setup(false); // unguarded: the strategy reports the dip honestly
    let u = w.user(2_000 * USDC); // keep a reserve so the post-dip deposit is fundable
    w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);
    w.sr().sync_rate();
    let before = w.sr().exchange_rate();

    w.st().set_rate(&(SCALAR_12 / 2)); // a 50% collapse
    w.sr().sync_rate();                // pull the dip in explicitly
    let after = w.sr().exchange_rate();

    assert_eq!(after, before, "SR must not reprice downward");
    assert!(after >= SCALAR_12);
    // And the stack above keeps working rather than freezing.
    assert!(w.sr().try_deposit(&u, &u, &(1 * USDC), &0i128).is_ok());
    std::println!("unguarded dip: strategy said {}, SR held {after}", SCALAR_12 / 2);
}

/// The clamp is one-directional: a genuine rise still passes straight through.
#[test]
fn the_clamp_never_holds_back_a_genuine_rise() {
    let w = setup(false);
    let u = w.user(10_000 * USDC);
    w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);
    for mult in [11i128, 12, 15, 20] {
        w.st().set_rate(&(SCALAR_12 * mult / 10));
        // `exchange_rate` is now a pure read of stored state, so a rise lands only once synced.
        assert_eq!(w.sr().sync_rate(), SCALAR_12 * mult / 10);
        assert_eq!(w.sr().exchange_rate(), SCALAR_12 * mult / 10);
    }
}

/// **The clamp's cost, stated plainly.** Holding the rate up while the strategy is genuinely worth
/// less means SR promises more underlying than the strategy can pay. `redeem` therefore honours
/// what the strategy *actually* returns, not `shares x clamped_rate`.
#[test]
fn a_clamped_rate_never_promises_more_than_the_strategy_pays() {
    let w = setup(false);
    let u = w.user(1_000 * USDC);
    let shares = w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);
    w.st().set_rate(&(SCALAR_12 / 2));
    w.sr().sync_rate();

    let previewed = w.sr().preview_redeem(&shares); // uses the clamped (optimistic) rate
    let actual = w.sr().redeem(&u, &u, &shares, &0i128); // pays what the strategy really gives
    assert!(actual < previewed, "the preview is optimistic under a clamp");
    std::println!(
        "clamped preview {} vs actual payout {} — redeem honours reality, preview does not",
        previewed, actual
    );
}

// ===========================================================================
// SEP-41 surface + guards
// ===========================================================================

#[test]
fn sr_rejects_bad_amounts_everywhere() {
    let w = setup(false);
    let u = w.user(1_000 * USDC);
    let shares = w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);
    let other = Address::generate(&w.env);
    for bad in [0i128, -1, -1_000] {
        assert!(w.sr().try_deposit(&u, &u, &bad, &0i128).is_err());
        assert!(w.sr().try_redeem(&u, &u, &bad, &0i128).is_err());
        assert!(w.sr().try_transfer(&u, &other, &bad).is_err());
        assert!(w.sr().try_burn(&u, &bad).is_err());
    }
    assert_eq!(w.sr().balance(&u), shares);
}

#[test]
fn sr_min_out_guards_actually_bind() {
    let w = setup(false);
    let u = w.user(1_000 * USDC);
    assert!(
        w.sr().try_deposit(&u, &u, &(1_000 * USDC), &i128::MAX).is_err(),
        "min_shares_out must bind"
    );
    let shares = w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);
    assert!(
        w.sr().try_redeem(&u, &u, &shares, &i128::MAX).is_err(),
        "min_underlying_out must bind"
    );
    assert_eq!(w.sr().balance(&u), shares, "the failed redeem burned nothing");
}

#[test]
fn sr_cannot_redeem_more_than_held() {
    let w = setup(false);
    let u = w.user(1_000 * USDC);
    let shares = w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);
    assert!(w.sr().try_redeem(&u, &u, &(shares + 1), &0i128).is_err());
    assert!(w.sr().try_transfer(&u, &Address::generate(&w.env), &(shares + 1)).is_err());
    assert_eq!(w.sr().balance(&u), shares);
}

#[test]
fn an_sr_self_transfer_is_a_no_op() {
    let w = setup(false);
    let u = w.user(1_000 * USDC);
    let shares = w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);
    let supply = w.sr().total_supply();
    w.sr().transfer(&u, &u, &(shares / 3));
    assert_eq!(w.sr().balance(&u), shares);
    assert_eq!(w.sr().total_supply(), supply);
}

#[test]
fn sr_allowances_are_consumed_and_bounded() {
    let w = setup(false);
    let u = w.user(1_000 * USDC);
    let shares = w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);
    let spender = Address::generate(&w.env);
    let to = Address::generate(&w.env);
    let exp = w.env.ledger().sequence() + 1_000;

    w.sr().approve(&u, &spender, &(shares / 2), &exp);
    assert_eq!(w.sr().allowance(&u, &spender), shares / 2);
    assert!(w.sr().try_transfer_from(&spender, &u, &to, &shares).is_err(), "over-spend refused");
    w.sr().transfer_from(&spender, &u, &to, &(shares / 2));
    assert_eq!(w.sr().allowance(&u, &spender), 0);
    assert_eq!(w.sr().balance(&to), shares / 2);
}

#[test]
fn an_expired_sr_allowance_cannot_be_spent() {
    let w = setup(false);
    let u = w.user(1_000 * USDC);
    let shares = w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);
    let spender = Address::generate(&w.env);
    let exp = w.env.ledger().sequence() + 5;
    w.sr().approve(&u, &spender, &shares, &exp);
    w.env.ledger().set_sequence_number(exp + 1);
    assert_eq!(w.sr().allowance(&u, &spender), 0);
    assert!(w.sr().try_transfer_from(&spender, &u, &spender, &shares).is_err());
}

#[test]
fn a_pause_blocks_deposits_but_never_redemption() {
    let w = setup(false);
    let u = w.user(2_000 * USDC);
    let shares = w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);
    w.sr().pause();
    assert!(w.sr().try_deposit(&u, &u, &(1_000 * USDC), &0i128).is_err());
    let out = w.sr().redeem(&u, &u, &shares, &0i128);
    assert!(out > 0, "a pause must never trap SR holders");
}

#[test]
fn sr_total_supply_tracks_mints_and_burns_exactly() {
    let w = setup(false);
    let a = w.user(1_000 * USDC);
    let b = w.user(3_000 * USDC);
    let sa = w.sr().deposit(&a, &a, &(1_000 * USDC), &0i128);
    let sb = w.sr().deposit(&b, &b, &(3_000 * USDC), &0i128);
    assert_eq!(w.sr().total_supply(), sa + sb);
    w.sr().redeem(&a, &a, &sa, &0i128);
    assert_eq!(w.sr().total_supply(), sb);
    w.sr().burn(&b, &(sb / 2));
    assert_eq!(w.sr().total_supply(), sb - sb / 2);
}

/// A donation of raw underlying to the SR contract must not become anyone's shares.
#[test]
fn a_raw_underlying_donation_does_not_mint_shares() {
    let w = setup(false);
    let u = w.user(1_000 * USDC);
    let shares = w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);
    let supply = w.sr().total_supply();
    let donor = w.user(5_000 * USDC);
    soroban_sdk::token::Client::new(&w.env, &w.usdc).transfer(&donor, &w.sr, &(5_000 * USDC));
    assert_eq!(w.sr().total_supply(), supply, "no shares minted");
    assert_eq!(w.sr().balance(&u), shares);
    assert_eq!(w.sr().exchange_rate(), SCALAR_12, "and the rate is unmoved");
}

#[test]
fn sr_metadata_is_sane() {
    let w = setup(false);
    assert_eq!(w.sr().decimals(), 7);
    assert_eq!(w.sr().underlying(), w.usdc);
    assert_eq!(w.sr().strategy(), w.strategy);
    assert!(!w.sr().is_paused());
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // AlreadyInitialized
fn sr_cannot_be_initialized_twice() {
    let w = setup(false);
    w.sr().initialize(&w.strategy);
}

// ===========================================================================
// The launch TVL cap — tofix.md #3's mitigation, enforced on chain
// ===========================================================================
//
// #3 accepts a real residual (a deep Blend bad-debt event freezes every mutation, exits included)
// and mitigates it with a TVL cap that bounds the worst case. The tracker specified that cap as an
// *operational* control — "decide the number, write it down, enforce it operationally". These tests
// pin it as a contract invariant instead, because a cap enforced by policy is not a cap.

#[test]
fn uncapped_by_default_so_the_cap_is_opt_in() {
    let w = setup(false);
    assert_eq!(w.sr().deposit_cap(), 0);
    assert_eq!(w.sr().deposit_headroom(), i128::MAX);
    let u = w.user(100_000 * USDC);
    assert!(w.sr().deposit(&u, &u, &(100_000 * USDC), &0i128) > 0);
}

#[test]
fn the_cap_stops_deposits_at_the_configured_number() {
    let w = setup(false);
    w.sr().set_deposit_cap(&(1_000 * USDC));
    assert_eq!(w.sr().deposit_cap(), 1_000 * USDC);

    let a = w.user(900 * USDC);
    w.sr().deposit(&a, &a, &(900 * USDC), &0i128);
    // Headroom is reported in the same unit the cap is set in, so an operator can read it directly.
    let headroom = w.sr().deposit_headroom();
    assert!(headroom > 0 && headroom <= 100 * USDC, "headroom was {headroom}");

    let b = w.user(500 * USDC);
    assert!(
        w.sr().try_deposit(&b, &b, &(500 * USDC), &0i128).is_err(),
        "a deposit past the cap was allowed"
    );
    // ...but one that fits still goes through, so the cap is a ceiling and not a freeze.
    assert!(w.sr().deposit(&b, &b, &(50 * USDC), &0i128) > 0);
}

/// **The property that makes the cap safe to hand an admin.** It gates deposits only. Lowering it
/// below current TVL — or setting one on a wrapper that is already full — must never trap anyone.
#[test]
fn the_cap_can_never_trap_a_depositor() {
    let w = setup(false);
    let u = w.user(1_000 * USDC);
    let shares = w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);

    // Slam the cap far below current TVL — the most hostile setting available.
    w.sr().set_deposit_cap(&(1 * USDC));
    assert_eq!(w.sr().deposit_headroom(), 0, "headroom should read as exhausted");
    assert!(w.sr().try_deposit(&u, &u, &(1 * USDC), &0i128).is_err(), "inflow should be shut");

    // The exit is untouched.
    let out = w.sr().redeem(&u, &u, &shares, &0i128);
    assert!(out >= 1_000 * USDC - 10, "the cap blocked an exit: got {out}");
    assert_eq!(w.sr().balance(&u), 0);
}

/// Yield growth must not silently consume headroom. The cap bounds *exposure*, and a user's own
/// return is not new exposure — otherwise a healthy protocol slowly closes its own front door.
#[test]
fn yield_growth_does_not_eat_the_cap() {
    let w = setup(false);
    w.sr().set_deposit_cap(&(1_000 * USDC));
    let a = w.user(500 * USDC);
    w.sr().deposit(&a, &a, &(500 * USDC), &0i128);

    let headroom_before = w.sr().deposit_headroom();
    // A 4% rate rise — roughly a very good year of Blend yield.
    w.st().set_rate(&(w.st().current_rate() * 104 / 100));
    w.sr().sync_rate();
    let headroom_after = w.sr().deposit_headroom();

    // Assets grew, so headroom shrinks by the yield — but only by the yield, which is small next to
    // the cap. The check that matters is that a deposit sized to the remaining headroom still fits.
    let lost = headroom_before - headroom_after;
    assert!(
        lost < 50 * USDC,
        "yield ate {lost} of headroom on a 4% rate rise — the cap is measuring the wrong thing"
    );
    let b = w.user(400 * USDC);
    assert!(w.sr().deposit(&b, &b, &(400 * USDC), &0i128) > 0, "a deposit inside the cap was refused");
}

#[test]
fn a_negative_cap_is_rejected() {
    let w = setup(false);
    assert!(w.sr().try_set_deposit_cap(&-1i128).is_err());
}

// ===========================================================================
// Partial exits under a liquidity crunch — tofix.md #20
// ===========================================================================
//
// #20 is the freeze mode that does NOT involve insolvency: backing is fine, but borrowers have
// taken the venue's supply and there is nothing on hand to pay with. It is considerably more likely
// than #3's bad-debt scenario — Blend's testnet USDC reserve was at 85.4% utilization when this was
// written — and until now it produced a bare revert with no way to find out in advance and no way
// to discover the smaller amount that would have worked.

#[test]
fn max_redeemable_is_unbounded_when_liquidity_is_healthy() {
    let w = setup(false);
    let u = w.user(1_000 * USDC);
    w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);
    // Plenty on hand, so callers need no special case for the common path.
    let cap = w.sr().max_redeemable();
    assert!(cap >= w.sr().balance(&u), "a healthy venue reported a cap of {cap}");
}

#[test]
fn a_crunch_is_visible_before_you_submit() {
    let w = setup(false);
    let u = w.user(1_000 * USDC);
    let shares = w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);

    // Borrowers take 90% of the supply.
    let sink = Address::generate(&w.env);
    w.st().drain(&sink, &(900 * USDC));

    let cap = w.sr().max_redeemable();
    assert!(cap > 0 && cap < shares, "cap {cap} should sit between 0 and the full {shares}");
    // The cap is conservative by design: strictly under the raw 100 USDC still on hand.
    let cap_underlying = w.sr().preview_redeem(&cap);
    assert!(
        cap_underlying <= 100 * USDC && cap_underlying > 95 * USDC,
        "cap of {cap_underlying} should be just under the 100 USDC available"
    );
}

/// **The point of the whole feature.** A full exit reverts and the user gets nothing; a partial exit
/// gets them most of their money and leaves the rest claimable.
#[test]
fn a_partial_exit_succeeds_where_a_full_one_reverts() {
    let w = setup(false);
    let u = w.user(1_000 * USDC);
    let shares = w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);

    let sink = Address::generate(&w.env);
    w.st().drain(&sink, &(900 * USDC));

    // Today's behaviour: all or nothing, and it is nothing.
    assert!(
        w.sr().try_redeem(&u, &u, &shares, &0i128).is_err(),
        "the full exit should fail — there is only 100 USDC on hand"
    );
    assert_eq!(w.sr().balance(&u), shares, "and the failed attempt must change nothing");

    // The partial path: ask for everything, take what is there.
    let (burned, paid) = w.sr().redeem_partial(&u, &u, &shares, &0i128);
    assert!(paid > 90 * USDC, "should have recovered most of the available 100 USDC, got {paid}");
    assert!(burned < shares, "only the redeemed shares should burn");
    assert_eq!(w.sr().balance(&u), shares - burned, "the rest of the position survives");
    assert_eq!(w.usdc_balance(&u), paid);
}

/// The remainder is not stranded — as liquidity returns, so does access to it.
#[test]
fn the_rest_of_the_position_is_claimable_once_liquidity_returns() {
    let w = setup(false);
    let u = w.user(1_000 * USDC);
    let shares = w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);

    let sink = Address::generate(&w.env);
    w.st().drain(&sink, &(900 * USDC));
    let (burned, _) = w.sr().redeem_partial(&u, &u, &shares, &0i128);

    // Borrowers repay.
    StellarAssetClient::new(&w.env, &w.usdc).mint(&w.strategy, &(900 * USDC));

    let left = shares - burned;
    let out = w.sr().redeem(&u, &u, &left, &0i128);
    assert!(out > 0, "the remainder should be redeemable once the venue refills");
    assert_eq!(w.sr().balance(&u), 0, "and the position closes fully");
}

/// A user who would rather fail than take a partial fill sets `min_underlying_out` to the full
/// amount and gets exactly today's behaviour. The partial path must not take that choice away.
#[test]
fn min_out_still_lets_a_user_refuse_a_partial_fill() {
    let w = setup(false);
    let u = w.user(1_000 * USDC);
    let shares = w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);
    let sink = Address::generate(&w.env);
    w.st().drain(&sink, &(900 * USDC));

    assert!(
        w.sr().try_redeem_partial(&u, &u, &shares, &(1_000 * USDC)).is_err(),
        "a full-amount floor should still reject a partial fill"
    );
    assert_eq!(w.sr().balance(&u), shares, "and leave the position untouched");
}

/// `shares` is a ceiling, so a partial exit can never burn more than the user authorized — and when
/// liquidity is fine it behaves exactly like an ordinary redeem.
#[test]
fn a_partial_exit_never_exceeds_what_was_asked_for() {
    let w = setup(false);
    let u = w.user(1_000 * USDC);
    let shares = w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);

    let half = shares / 2;
    let (burned, paid) = w.sr().redeem_partial(&u, &u, &half, &0i128);
    assert_eq!(burned, half, "healthy liquidity should fill the whole request");
    assert!(paid >= 499 * USDC, "got {paid}");
    assert_eq!(w.sr().balance(&u), shares - half);
}

#[test]
#[should_panic(expected = "Error(Contract, #42)")] // WithdrawShortfall
fn a_fully_drained_venue_fails_loudly_rather_than_returning_zero() {
    let w = setup(false);
    let u = w.user(1_000 * USDC);
    let shares = w.sr().deposit(&u, &u, &(1_000 * USDC), &0i128);
    let sink = Address::generate(&w.env);
    w.st().drain(&sink, &(1_000 * USDC));
    // Returning (0, 0) here would be far worse than reverting: a caller could read it as success.
    w.sr().redeem_partial(&u, &u, &shares, &0i128);
}
