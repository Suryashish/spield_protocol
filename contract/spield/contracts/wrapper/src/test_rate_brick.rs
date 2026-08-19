#![cfg(test)]
//! # testcando.md §0 P0 (fixed) — `brate_decrease_bricks_everything_including_exits`
//!
//! `math::check_rate_bound_timed` rejects `current < last` outright (Blend's `b_rate` is
//! documented monotonic non-decreasing). If Blend ever socialises bad debt and `b_rate` dips —
//! even by one stroop — **every** `current_rate` read panics `RateOutOfBounds`. That read sits
//! under mint, claim, redeem, combine, `position_value` and `solvency`, so the blast radius is
//! the whole protocol: **inflows *and* exits**. Only `transfer_position` survived, so a position
//! could be moved but never exited.
//!
//! `set_max_apr_bps` cannot unstick it: that knob only widens the *upper* ceiling, and the
//! failure is the lower `current < last` guard.
//!
//! **The fix is `strategy::reset_rate_floor`** — an admin valve that lowers the stored high-water
//! mark to the live rate. This suite keeps every freeze test (they still document the failure
//! mode, which is real and unchanged) and adds the recovery tests, including the case the valve
//! deliberately does *not* paper over: a dip deep enough that the backing genuinely no longer
//! covers principal still refuses to mutate, now with `SolvencyViolation` instead of
//! `RateOutOfBounds`. Reads come back either way, which is what the monitor needs.
//!
//! Blend's real `b_rate` cannot be pushed down through the `BlendFixture`, so this suite drives
//! the wrapper against a **mock strategy** that implements the same `YieldStrategy` interface and
//! the same rate-bound logic as `spield-strategy`, with a test-only hook to set the raw rate.
//! Everything else (the wrapper, the PT/YT SACs, the USDC SAC) is the real thing.

extern crate std;

use crate::{Wrapper, WrapperClient};
use soroban_sdk::{
    contract, contractimpl, contracttype, panic_with_error,
    testutils::{Address as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, InvokeError,
};
use spield_shared::{math, types::RateBound, Error, SCALAR_12};

const USDC: i128 = 1_0000000; // 7 decimals
const YEAR: u64 = 365 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// A minimal `YieldStrategy` whose rate we control, mirroring `spield-strategy`'s
// `current_rate` bound logic exactly (including the `last_rate`/`last_ts` advance).
// ---------------------------------------------------------------------------

#[derive(Clone)]
#[contracttype]
enum MK {
    Rate,
    Underlying,
    Shares,
    Bound,
}

#[contract]
pub struct MockStrategy;

#[contractimpl]
impl MockStrategy {
    pub fn init(env: Env, underlying: Address, rate: i128, max_apr_bps: u32) {
        let s = env.storage().instance();
        s.set(&MK::Underlying, &underlying);
        s.set(&MK::Rate, &rate);
        s.set(&MK::Shares, &0i128);
        s.set(
            &MK::Bound,
            &RateBound { last_rate: rate, last_ts: env.ledger().timestamp(), max_apr_bps },
        );
    }

    /// Test-only hook: set the raw rate the "pool" reports, bypassing the bound.
    /// This is what lets us simulate a `b_rate` dip.
    pub fn force_rate(env: Env, rate: i128) {
        env.storage().instance().set(&MK::Rate, &rate);
    }

    /// The same safety valve the real strategy exposes — proving it does NOT help here.
    pub fn set_max_apr_bps(env: Env, max_apr_bps: u32) {
        let mut b: RateBound = env.storage().instance().get(&MK::Bound).unwrap();
        b.max_apr_bps = max_apr_bps;
        env.storage().instance().set(&MK::Bound, &b);
    }

    /// Mirrors `spield_strategy::BlendStrategy::reset_rate_floor` exactly: read the RAW
    /// rate (bypassing the bound, which is the thing that is stuck), and lower the stored
    /// high-water mark to it. Never raises. Returns the floor in effect afterwards.
    pub fn reset_rate_floor(env: Env) -> i128 {
        let raw: i128 = env.storage().instance().get(&MK::Rate).unwrap();
        if raw <= 0 {
            panic_with_error!(&env, Error::RateOutOfBounds);
        }
        let mut b: RateBound = env.storage().instance().get(&MK::Bound).unwrap();
        if raw < b.last_rate {
            b.last_rate = raw;
            b.last_ts = env.ledger().timestamp();
            env.storage().instance().set(&MK::Bound, &b);
        }
        b.last_rate
    }

    pub fn rate_bound(env: Env) -> (i128, u64, u32) {
        let b: RateBound = env.storage().instance().get(&MK::Bound).unwrap();
        (b.last_rate, b.last_ts, b.max_apr_bps)
    }

    // ---- YieldStrategy ----

    pub fn deposit(env: Env, from: Address, amount: i128) -> i128 {
        let u = Self::underlying(env.clone());
        TokenClient::new(&env, &u).transfer(&from, &env.current_contract_address(), &amount);
        let rate = Self::current_rate(env.clone());
        let minted = math::underlying_to_shares(&env, amount, rate).unwrap();
        if minted <= 0 {
            panic_with_error!(&env, Error::NoStrategyPosition);
        }
        let s: i128 = env.storage().instance().get(&MK::Shares).unwrap();
        env.storage().instance().set(&MK::Shares, &(s + minted));
        minted
    }

    pub fn redeem(env: Env, to: Address, shares: i128) -> i128 {
        let rate = Self::current_rate(env.clone());
        let amount = math::shares_to_underlying(&env, shares, rate).unwrap();
        Self::redeem_underlying(env, to, amount);
        amount
    }

    pub fn redeem_underlying(env: Env, to: Address, amount: i128) -> i128 {
        let rate = Self::current_rate(env.clone());
        // Blend burns ceil(amount / rate) shares.
        let burned = (amount * SCALAR_12 + rate - 1) / rate;
        let s: i128 = env.storage().instance().get(&MK::Shares).unwrap();
        let burned = if burned > s { s } else { burned };
        env.storage().instance().set(&MK::Shares, &(s - burned));
        let u = Self::underlying(env.clone());
        TokenClient::new(&env, &u).transfer(&env.current_contract_address(), &to, &amount);
        burned
    }

    /// Byte-for-byte the same shape as `spield_strategy::BlendStrategy::current_rate`.
    pub fn current_rate(env: Env) -> i128 {
        let rate: i128 = env.storage().instance().get(&MK::Rate).unwrap();
        let mut bound: RateBound = env.storage().instance().get(&MK::Bound).unwrap();
        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(bound.last_ts);
        math::check_rate_bound_timed(&env, bound.last_rate, rate, elapsed, bound.max_apr_bps)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        if rate > bound.last_rate || now > bound.last_ts {
            if rate > bound.last_rate {
                bound.last_rate = rate;
            }
            bound.last_ts = now;
            env.storage().instance().set(&MK::Bound, &bound);
        }
        rate
    }

    pub fn position_value(env: Env, shares: i128) -> i128 {
        let rate = Self::current_rate(env.clone());
        math::shares_to_underlying(&env, shares, rate).unwrap_or(0)
    }

    pub fn total_shares(env: Env) -> i128 {
        env.storage().instance().get(&MK::Shares).unwrap_or(0)
    }

    pub fn underlying(env: Env) -> Address {
        env.storage().instance().get(&MK::Underlying).unwrap()
    }
}

struct MockWorld {
    env: Env,
    usdc: Address,
    wrapper: Address,
    strategy: Address,
    pt: Address,
    maturity: u64,
}

impl MockWorld {
    fn env(&self) -> &Env {
        &self.env
    }
    fn wrapper(&self) -> WrapperClient<'_> {
        WrapperClient::new(&self.env, &self.wrapper)
    }
    fn strategy(&self) -> MockStrategyClient<'_> {
        MockStrategyClient::new(&self.env, &self.strategy)
    }
    fn usdc(&self) -> TokenClient<'_> {
        TokenClient::new(&self.env, &self.usdc)
    }
    fn pt(&self) -> TokenClient<'_> {
        TokenClient::new(&self.env, &self.pt)
    }
    fn new_user(&self, amount: i128) -> Address {
        let u = Address::generate(&self.env);
        StellarAssetClient::new(&self.env, &self.usdc).mint(&u, &amount);
        u
    }
}

/// Wrapper + PT/YT SACs + the mock strategy, starting at `rate`.
fn mock_setup(rate: i128) -> MockWorld {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);
    env.cost_estimate().budget().reset_unlimited();

    let admin = Address::generate(&env);
    let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let wrapper = env.register(Wrapper, (admin.clone(),));
    let strategy = env.register(MockStrategy, ());
    MockStrategyClient::new(&env, &strategy).init(&usdc, &rate, &30_000u32);
    // The mock models the *rate*, not Blend's liquidity: pre-fund it so accrued
    // yield is always payable (in Blend the interest is real pool USDC).
    StellarAssetClient::new(&env, &usdc).mint(&strategy, &(1_000_000 * USDC));

    let pt = env.register_stellar_asset_contract_v2(wrapper.clone()).address();
    let yt = env.register_stellar_asset_contract_v2(wrapper.clone()).address();

    let maturity = env.ledger().timestamp() + YEAR;
    WrapperClient::new(&env, &wrapper).initialize(&strategy, &pt, &yt, &maturity);

    MockWorld { env, usdc, wrapper, strategy, pt, maturity }
}

/// The mock strategy is a faithful stand-in: the full happy path works against it.
#[test]
fn mock_strategy_supports_the_full_lifecycle() {
    let w = mock_setup(SCALAR_12);
    let user = w.new_user(100 * USDC);
    let id = w.wrapper().mint(&user, &(100 * USDC));
    assert_eq!(w.pt().balance(&user), 100 * USDC);

    // Rate rises 10% over the year → 10 USDC of yield on a 100 USDC position.
    w.env().ledger().set_timestamp(w.env().ledger().timestamp() + YEAR / 2);
    w.strategy().force_rate(&(SCALAR_12 * 11 / 10));
    let claimed = w.wrapper().claim_yield(&id);
    assert_eq!(claimed, 10 * USDC, "shares(100) × Δrate(0.1) = 10 USDC");

    w.env().ledger().set_timestamp(w.maturity + 1);
    let before = w.usdc().balance(&user);
    w.wrapper().redeem_pt(&id, &(100 * USDC));
    assert_eq!(w.usdc().balance(&user) - before, 100 * USDC);
}

// ---------------------------------------------------------------------------
// The finding: one stroop of `b_rate` decrease freezes the entire protocol.
// ---------------------------------------------------------------------------

/// Assert a `try_*` call reverted with `RateOutOfBounds`. Generic over the Ok
/// type so one helper covers every entry point's differing return.
#[track_caller]
fn assert_rate_bricked<T, E>(
    r: Result<Result<T, E>, Result<soroban_sdk::Error, InvokeError>>,
    what: &str,
) {
    match r {
        Err(Ok(e)) => assert_eq!(
            e,
            Error::RateOutOfBounds.into(),
            "{}: reverted with the wrong error",
            what
        ),
        Err(Err(e)) => std::panic!("{}: host error {:?}, expected RateOutOfBounds", what, e),
        Ok(_) => std::panic!("{}: succeeded — expected RateOutOfBounds", what),
    }
}

#[test]
fn brate_decrease_bricks_every_entry_point_including_exits() {
    let w = mock_setup(SCALAR_12);
    let user = w.new_user(200 * USDC);
    let id = w.wrapper().mint(&user, &(100 * USDC));

    // Normal accrual first, so `last_rate` is above the floor.
    w.env().ledger().set_timestamp(w.env().ledger().timestamp() + YEAR / 2);
    w.strategy().force_rate(&(SCALAR_12 * 11 / 10));
    assert!(w.wrapper().claim_yield(&id) > 0);
    let (last_rate, _, _) = w.strategy().rate_bound();
    assert_eq!(last_rate, SCALAR_12 * 11 / 10);

    // Blend socialises bad debt: `b_rate` dips by ONE stroop.
    w.strategy().force_rate(&(SCALAR_12 * 11 / 10 - 1));
    w.env().ledger().set_timestamp(w.env().ledger().timestamp() + 24 * 60 * 60);

    // INFLOW is blocked (arguably fine)…
    assert_rate_bricked(w.wrapper().try_mint(&user, &(50 * USDC)), "mint");
    // …but so is every EXIT, which is not fine: user funds are frozen.
    assert_rate_bricked(w.wrapper().try_claim_yield(&id), "claim_yield");
    assert_rate_bricked(
        w.wrapper().try_combine_and_redeem(&id, &(50 * USDC)),
        "combine_and_redeem",
    );
    // …and the read-only views the dashboard and the solvency monitor depend on.
    assert_rate_bricked(w.wrapper().try_position_value(&id), "position_value");
    assert_rate_bricked(w.wrapper().try_solvency(), "solvency");

    // Post-maturity redemption — the last resort — is frozen too, because
    // `assert_solvent` reads the rate after the payout is computed.
    w.env().ledger().set_timestamp(w.maturity + 1);
    assert_rate_bricked(
        w.wrapper().try_redeem_pt(&id, &(100 * USDC)),
        "redeem_pt at maturity",
    );

    // `transfer_position` is the ONLY thing that still works (it never reads the rate),
    // so a position can be moved but never exited.
    let other = Address::generate(w.env());
    w.wrapper().transfer_position(&id, &other);
    assert_eq!(w.wrapper().get_position(&id).owner, other);
}

#[test]
fn set_max_apr_bps_cannot_unstick_a_rate_decrease() {
    let w = mock_setup(SCALAR_12);
    let user = w.new_user(200 * USDC);
    let id = w.wrapper().mint(&user, &(100 * USDC));

    w.env().ledger().set_timestamp(w.env().ledger().timestamp() + YEAR / 2);
    w.strategy().force_rate(&(SCALAR_12 * 11 / 10));
    w.wrapper().claim_yield(&id);

    // Dip.
    w.strategy().force_rate(&(SCALAR_12 * 105 / 100));
    assert_rate_bricked(w.wrapper().try_claim_yield(&id), "claim after dip");

    // Widening the annual ceiling to its maximum does nothing for the `current < last`
    // guard — this is the WRONG knob, and reaching for it during an incident wastes time.
    w.strategy().set_max_apr_bps(&u32::MAX);
    assert_rate_bricked(
        w.wrapper().try_claim_yield(&id),
        "set_max_apr_bps(u32::MAX) must NOT unstick a decrease — it is the wrong valve",
    );

    // Without the valve, recovery is only possible once Blend's rate climbs back on its own.
    w.strategy().force_rate(&(SCALAR_12 * 11 / 10));
    assert!(w.wrapper().try_claim_yield(&id).is_ok(), "recovers once the rate is restored");
}

// ---------------------------------------------------------------------------
// The fix: `reset_rate_floor` is the valve for a decrease.
// ---------------------------------------------------------------------------

/// The headline recovery: after a dip freezes everything, one admin call restores
/// **exits**, reads, and inflows — without the rate having to climb back.
#[test]
fn reset_rate_floor_unsticks_a_rate_decrease() {
    let w = mock_setup(SCALAR_12);
    let user = w.new_user(200 * USDC);
    let id = w.wrapper().mint(&user, &(100 * USDC));

    // Accrue, claim (so `last_rate` is a real high-water mark), then dip one stroop.
    w.env().ledger().set_timestamp(w.env().ledger().timestamp() + YEAR / 2);
    w.strategy().force_rate(&(SCALAR_12 * 11 / 10));
    assert!(w.wrapper().claim_yield(&id) > 0);
    let dipped = SCALAR_12 * 11 / 10 - 1;
    w.strategy().force_rate(&dipped);
    w.env().ledger().set_timestamp(w.env().ledger().timestamp() + 24 * 60 * 60);

    // Frozen, as before.
    assert_rate_bricked(w.wrapper().try_claim_yield(&id), "claim before the reset");
    assert_rate_bricked(w.wrapper().try_solvency(), "solvency before the reset");

    // ONE admin call. It reports the new floor, which is the live rate.
    let floor = w.strategy().reset_rate_floor();
    assert_eq!(floor, dipped, "the floor is lowered to the live rate");
    let (last_rate, _, _) = w.strategy().rate_bound();
    assert_eq!(last_rate, dipped, "the stored high-water mark really moved");

    // Everything is unfrozen: the read paths the dashboard and monitor need…
    assert!(w.wrapper().try_solvency().is_ok(), "solvency readable again");
    assert!(w.wrapper().try_position_value(&id).is_ok(), "position_value readable again");
    // …the exits that matter most…
    assert!(w.wrapper().try_claim_yield(&id).is_ok(), "claim_yield works again");
    assert!(
        w.wrapper().try_combine_and_redeem(&id, &(50 * USDC)).is_ok(),
        "combine_and_redeem works again"
    );
    // …and post-maturity redemption of the remainder.
    w.env().ledger().set_timestamp(w.maturity + 1);
    let before = w.usdc().balance(&user);
    assert_eq!(w.wrapper().redeem_pt(&id, &(50 * USDC)), 50 * USDC);
    assert_eq!(w.usdc().balance(&user) - before, 50 * USDC, "the user really got paid");

    // Inflows too — the protocol is fully live again, not just drainable.
    let fresh = w.new_user(50 * USDC);
    w.env().ledger().set_timestamp(w.maturity - 1); // mint is maturity-gated
    assert!(w.wrapper().try_mint(&fresh, &(50 * USDC)).is_ok(), "mint works again");
}

/// The valve only ever LOWERS the floor. Calling it when the live rate is at or above
/// the stored mark is a no-op — it must never raise the floor, which would brick reads
/// that currently pass (the exact failure it exists to undo).
#[test]
fn reset_rate_floor_never_raises_the_floor() {
    let w = mock_setup(SCALAR_12);
    let user = w.new_user(200 * USDC);
    let id = w.wrapper().mint(&user, &(100 * USDC));
    w.env().ledger().set_timestamp(w.env().ledger().timestamp() + YEAR / 2);
    w.strategy().force_rate(&(SCALAR_12 * 11 / 10));
    w.wrapper().claim_yield(&id);
    let (before, _, _) = w.strategy().rate_bound();

    // Live rate == stored mark: no-op.
    assert_eq!(w.strategy().reset_rate_floor(), before);
    assert_eq!(w.strategy().rate_bound().0, before, "floor unchanged when the rate has not dipped");

    // Live rate ABOVE the stored mark: still a no-op, NOT a raise. Raising here would
    // shrink the allowed-increase window and could brick the very next honest read.
    // (Give the rise real elapsed time to sit in, or the *upper* time-pro-rated ceiling
    // rejects it for an unrelated reason and the test would prove nothing.)
    w.env().ledger().set_timestamp(w.env().ledger().timestamp() + YEAR / 4);
    w.strategy().force_rate(&(SCALAR_12 * 12 / 10));
    assert_eq!(w.strategy().reset_rate_floor(), before, "must not raise the floor");
    assert_eq!(w.strategy().rate_bound().0, before);
    // …and normal operation is unaffected by the no-op calls.
    assert!(w.wrapper().try_claim_yield(&id).is_ok());
}

/// **The valve's honest limit — read this before relying on it in an incident.**
///
/// `reset_rate_floor` restores *reads* unconditionally, but it cannot conjure backing.
/// After a dip deep enough that Blend's position no longer covers outstanding principal,
/// the wrapper's SCF-#3 invariant takes over and mutations still refuse — with
/// `SolvencyViolation`, the correct error, instead of `RateOutOfBounds`.
///
/// So the valve converts "frozen for an unknown reason, dashboard dark" into "visibly
/// under-backed, and the shortfall is the thing blocking exits". That is a real
/// improvement in an incident — the monitor works, the size of the hole is readable, and
/// the remaining block is the honest one — but it is **not** a general unfreeze. A deep
/// bad-debt event still leaves funds inaccessible until the backing recovers or a
/// deliberate loss-allocation change ships. Option B (tolerating a bounded decrease) and
/// splitting the guard so exits are permissive would both change that; option A does not.
#[test]
fn reset_rate_floor_does_not_override_the_solvency_invariant() {
    let w = mock_setup(SCALAR_12);
    // TWO positions: with only one, its own exit drains principal and backing together
    // and the invariant is trivially satisfied on the way out. A shortfall is only
    // observable while other principal is still outstanding — which is the real shape of
    // a bad-debt event, where the loss is shared across everyone still in.
    let a = w.new_user(100 * USDC);
    let b = w.new_user(100 * USDC);
    let id_a = w.wrapper().mint(&a, &(100 * USDC));
    let _id_b = w.wrapper().mint(&b, &(100 * USDC));

    // A 12% haircut — far beyond the rounding dust the tolerance absorbs.
    w.env().ledger().set_timestamp(w.env().ledger().timestamp() + YEAR / 2);
    w.strategy().force_rate(&(SCALAR_12 * 88 / 100));
    assert_rate_bricked(w.wrapper().try_claim_yield(&id_a), "claim before the reset");
    assert_rate_bricked(w.wrapper().try_solvency(), "solvency before the reset");

    w.strategy().reset_rate_floor();

    // Reads come back — the monitor can now SEE the hole, which is the point.
    let (backing, principal, _) = w.wrapper().solvency();
    assert!(
        backing < principal,
        "the scenario must really be under-backed: backing {} principal {}",
        backing,
        principal
    );
    assert!(w.wrapper().try_position_value(&id_a).is_ok(), "per-position reads work again");
    std::println!(
        "post-reset: backing={} principal={} shortfall={}",
        backing,
        principal,
        principal - backing
    );

    // But mutations still refuse, and now for the RIGHT reason — including a partial
    // exit, so this is not a size threshold that a small enough withdrawal slips under.
    for amount in [100 * USDC, 50 * USDC, 1 * USDC] {
        match w.wrapper().try_combine_and_redeem(&id_a, &amount) {
            Err(Ok(e)) => assert_eq!(
                e,
                Error::SolvencyViolation.into(),
                "an under-backed wrapper must refuse with SolvencyViolation, not be \
                 unlocked by the rate valve (amount {})",
                amount
            ),
            Err(Err(e)) => std::panic!("host error {:?}, expected SolvencyViolation", e),
            Ok(_) => std::panic!(
                "combine_and_redeem({}) succeeded — the valve must not override solvency",
                amount
            ),
        }
    }
}

/// Sanity on the valve's own guard: the mock's `force_rate(0)` case. A non-positive raw
/// rate is nonsense, and the valve must refuse rather than store it as the new floor —
/// otherwise one bad read would permanently disable the monotonicity check.
#[test]
fn reset_rate_floor_refuses_a_non_positive_rate() {
    let w = mock_setup(SCALAR_12);
    let user = w.new_user(100 * USDC);
    w.wrapper().mint(&user, &(100 * USDC));
    let (before, _, _) = w.strategy().rate_bound();

    w.strategy().force_rate(&0i128);
    assert!(
        w.strategy().try_reset_rate_floor().is_err(),
        "a zero/negative pool rate must be refused, not adopted as the floor"
    );
    assert_eq!(w.strategy().rate_bound().0, before, "the floor was not corrupted");
}

/// The floor is `last_rate`, not `entry_rate`: the protocol freezes on any dip
/// below the HIGH-WATER MARK ever observed, however long ago.
#[test]
fn the_freeze_floor_is_the_all_time_high_water_mark() {
    let w = mock_setup(SCALAR_12);
    let user = w.new_user(200 * USDC);
    let id = w.wrapper().mint(&user, &(100 * USDC));

    // A single read at a spiked rate permanently raises the floor.
    w.env().ledger().set_timestamp(w.env().ledger().timestamp() + YEAR / 2);
    w.strategy().force_rate(&(SCALAR_12 * 12 / 10));
    w.wrapper().claim_yield(&id);
    let (hwm, _, _) = w.strategy().rate_bound();
    assert_eq!(hwm, SCALAR_12 * 12 / 10);

    // Even a rate far ABOVE the position's entry rate (1.0) now bricks it.
    w.strategy().force_rate(&(SCALAR_12 * 115 / 100));
    assert_rate_bricked(
        w.wrapper().try_claim_yield(&id),
        "1.15 > entry_rate 1.0 and the position is deeply solvent, yet it is frozen",
    );
}
