#![cfg(test)]
//! # tofix_audit — does the SR stack exhibit each `tofix.md` defect?
//!
//! One test per open item, named `tofix_<n>_...`, run against the **real Blend v2 WASM** (the
//! harness deploys actual Blend contracts into the Soroban test host — it is an integration test,
//! not a mock). A green run here is real evidence, not a simulation.
//!
//! **What this cannot cover, and therefore still needs testnet:**
//! * **#13 issuer lockdown** — a Stellar *classic* account operation (master weight → 0). There is
//!   no account subsystem in the contract test host. Must be rehearsed on testnet.
//! * **Deploy-script read-backs** — there is no deploy script for this stack yet.
//! * **Real Blend pool conditions** — the harness pool is ours; mainnet utilization, caps and
//!   backstop state are not reproduced.
//! * **TTL / archival over real time** — ledger entries are never actually evicted here.
//! * **Multi-transaction sequencing and fee estimation on a live network.**
//!
//! Everything else below is settled locally.

extern crate std;

use crate::test::*;
use crate::{SrMarket, SrMarketClient};
#[allow(unused_imports)]
use spield_sr::SrClient;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address,
};
#[allow(unused_imports)]
use spield_yield::YieldClient;

const USDC: i128 = 1_0000000;
const DAY: u64 = 24 * 60 * 60;
const YEAR: u64 = 365 * 24 * 60 * 60;

// ===========================================================================
// #18 P0 — unpaginated redeem + permissionless seed (vault)
// ===========================================================================

/// The SR stack has **no vault**, so #18 has no direct counterpart. What must be proven instead is
/// that nothing in the new stack has the property that made #18 a P0: a per-item loop whose cost
/// grows with history and can be inflated by a stranger.
///
/// Every exit here is O(1): `redeem_due_interest` touches one `UserInterest` entry, `redeem_py`
/// touches one balance. Neither walks a list.
#[test]
fn tofix_18_no_exit_cost_grows_with_history() {
    // Measure the SAME operation after DIFFERENT amounts of history. If cost scaled with history
    // (v1's `redeem` walked a position list), 3x the churn would cost meaningfully more.
    let measure = |rounds: usize| -> (u32, u32) {
        let w = std_setup(YEAR, 500);
        w.seed(500_000 * USDC, 500_000 * USDC);
        let (victim, _) = w.user_with_py(50_000 * USDC);
        for _ in 0..rounds {
            let (a, _) = w.user_with_py(1_000 * USDC);
            w.y().transfer(&a, &victim, &(10 * USDC));
            w.y().transfer(&victim, &a, &(10 * USDC));
        }
        w.advance(60 * DAY);
        w.env.cost_estimate().budget().reset_unlimited();
        w.y().redeem_due_interest(&victim);
        let r = w.env.cost_estimate().resources();
        // Entry COUNTS are the structural property. Byte/instruction totals also move with Blend's
        // own internal state (more deposits => a slightly larger pool), which is not our history.
        (r.write_entries, r.disk_read_entries + r.memory_read_entries + r.write_entries)
    };
    let (w10, e10) = measure(10);
    let (w30, e30) = measure(30);
    std::println!(
        "#18  claim after 10 rounds: {w10} write entries, {e10} total\n     claim after 30 rounds: {w30} write entries, {e30} total  (3x the history)"
    );
    assert_eq!(w30, w10, "write-entry count must not scale with history");
    assert_eq!(e30, e10, "footprint entry count must not scale with history");
    std::println!("     => O(1): one UserInterest entry touched, no list walk.");
}

// ===========================================================================
// #19 P0 — market init never cross-checks the settlement asset
// ===========================================================================

/// **Not expressible.** `srmarket::initialize` takes only the yield contract and *reads* pt, sr and
/// expiry back from it. There is no argument to get wrong, so the v1 failure — a market wired to a
/// foreign token that drains real value — cannot be constructed.
#[test]
fn tofix_19_the_market_cannot_be_wired_to_a_foreign_settlement_asset() {
    let w = std_setup(YEAR, 500);
    assert_eq!(w.m().pt_token(), w.y().pt_token());
    assert_eq!(w.m().sr_token(), w.y().sr_token());
    assert_eq!(w.m().expiry(), w.y().expiry());
    assert_eq!(w.m().yield_contract(), w.yield_c);

    // A second market against the SAME engine also discovers the same three — the operator has no
    // way to substitute an asset.
    let admin = Address::generate(&w.env);
    let m2 = w.env.register(SrMarket, (admin.clone(), w.treasury.clone()));
    SrMarketClient::new(&w.env, &m2).initialize(&w.yield_c, &(40 * SCALAR_12), &(25 * SCALAR_12 / 10_000), &(500 * SCALAR_12 / 10_000), &2_000u32);
    let m2c = SrMarketClient::new(&w.env, &m2);
    assert_eq!(m2c.pt_token(), w.y().pt_token());
    assert_eq!(m2c.sr_token(), w.y().sr_token());
    std::println!("#19  market discovers pt/sr/expiry from the engine — no argument to get wrong");
}

/// And a market cannot be initialized against an already-expired engine.
#[test]
fn tofix_19b_an_expired_engine_cannot_have_a_new_market() {
    let w = std_setup(90 * DAY, 500);
    w.advance(91 * DAY);
    let admin = Address::generate(&w.env);
    let m2 = w.env.register(SrMarket, (admin.clone(), w.treasury.clone()));
    assert!(SrMarketClient::new(&w.env, &m2)
        .try_initialize(&w.yield_c, &(40 * SCALAR_12), &(25 * SCALAR_12 / 10_000), &(500 * SCALAR_12 / 10_000), &2_000u32)
        .is_err());
}

// ===========================================================================
// #20 P1 — a Blend liquidity crunch halts exits, and there is no partial path
// ===========================================================================

/// **Partial path: present.** `Sr::redeem` takes a share amount, so a holder facing a constrained
/// pool can withdraw in slices rather than being all-or-nothing. This is the structural gap v1's
/// vault had (`settle_redeem` reverts anything short of `payout`).
///
/// The *liquidity* half of #20 is a Blend property and is NOT fixed — it follows the shared
/// strategy into v2 unchanged.
#[test]
fn tofix_20_sr_redemption_has_a_working_partial_path() {
    let w = std_setup(YEAR, 500);
    let (u, sr) = w.user_with_sr(100_000 * USDC);
    let mut got = 0i128;
    for _ in 0..5 {
        got += w.sr().redeem(&u, &u, &(sr / 5), &0i128);
    }
    assert!(got > 0);
    assert!(w.sr().balance(&u) <= 5, "five partial exits drained the position");
    std::println!("#20  partial exits work: 5 slices returned {:.2} USDC", got as f64 / USDC as f64);
}

/// A YT holder whose principal leg is illiquid can still take their yield out separately — the two
/// claims are independent, unlike v1 where the vault receipt was one indivisible payout.
#[test]
fn tofix_20b_the_yield_claim_is_independent_of_the_principal_claim() {
    let w = std_setup(YEAR, 500);
    let (u, py) = w.user_with_py(50_000 * USDC);
    w.advance(120 * DAY);
    let (paid, _) = w.y().redeem_due_interest(&u);
    assert!(paid > 0, "yield came out without touching the principal leg");
    assert_eq!(w.pt().balance(&u), py, "PT untouched");
}

// ===========================================================================
// #21 P1 — YT yield unclaimable after maturity
// ===========================================================================

/// **Closed.** Pre-expiry yield stays claimable forever, and claiming after expiry works.
#[test]
fn tofix_21_yield_is_still_claimable_long_after_expiry() {
    let w = std_setup(90 * DAY, 500);
    let (u, _) = w.user_with_py(50_000 * USDC);
    w.advance(89 * DAY);
    let earned = w.y().claimable_interest(&u);
    assert!(earned > 0);

    w.advance(2 * DAY);
    w.y().stamp_expiry_index();
    w.advance(365 * DAY); // a full year past expiry
    let (paid, fee) = w.y().redeem_due_interest(&u);
    assert!(paid + fee > 0, "must still be payable a year after expiry");
    std::println!("#21  claimed {} SR a full year after expiry", paid + fee);
}

// ===========================================================================
// #23 P1 — the solvency monitor cannot see the real invariant
// ===========================================================================

/// **The contract now exposes everything a monitor needs, in one call.** `solvency()` returns the
/// exact three numbers the on-chain assertion uses, and the conservation identity is checkable from
/// public views alone: `total_py` must equal both token supplies while unexpired.
#[test]
fn tofix_23_the_full_solvency_state_is_readable_from_public_views() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let (u, py) = w.user_with_py(50_000 * USDC);
    w.advance(90 * DAY);
    w.y().redeem_due_interest(&u);

    let (held, needed, surplus) = w.y().solvency();
    assert!(held >= needed);
    assert_eq!(surplus, held - needed);
    // Conservation: PT liability == YT supply == tracked face, all from public views.
    assert_eq!(w.y().total_py(), w.y().total_supply(), "total_py == YT supply");
    assert!(w.y().total_accrued() >= 0);
    std::println!(
        "#23  monitor inputs: held {held}, needed {needed}, surplus {surplus}, total_py {}, yt_supply {}, accrued {}",
        w.y().total_py(), w.y().total_supply(), w.y().total_accrued()
    );
    let _ = py;
}

// ===========================================================================
// #25 P1 — the solvency dust band ratchets with lifetime users
// ===========================================================================

/// **Closed by construction.** The band is a fixed `SOLVENCY_SLACK`, not `open_positions + …`, so
/// no amount of churn widens it. Proven by making the churn enormous and re-asserting solvency with
/// the same tight margin.
#[test]
fn tofix_25_the_solvency_band_does_not_widen_with_churn() {
    let w = std_setup(YEAR, 500);
    for _ in 0..40 {
        let (u, py) = w.user_with_py(1_000 * USDC);
        w.advance(2 * DAY);
        w.y().redeem_py(&u, &u, &py); // open then immediately close
    }
    let (held, needed, _) = w.y().solvency();
    // The same 10-stroop slack the contract uses, after 40 full open/close cycles.
    assert!(
        held + 10 >= needed,
        "band must stay tight after 40 cycles: held {held}, needed {needed}"
    );
    std::println!("#25  after 40 open/close cycles: held {held} vs needed {needed} (slack is a constant 10)");
}

// ===========================================================================
// #26 P2 — market lifecycle and LP path gaps (three defects)
// ===========================================================================

/// **(a) `add_liquidity` is maturity-gated.**
#[test]
fn tofix_26a_add_liquidity_is_gated_on_maturity() {
    let w = std_setup(90 * DAY, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let (lp, sr) = w.user_with_sr(20_000 * USDC);
    let py = w.y().mint_py(&lp, &lp, &(sr / 2));
    w.advance(91 * DAY);
    assert!(
        w.m().try_add_liquidity(&lp, &py, &w.sr().balance(&lp), &0i128).is_err(),
        "adding liquidity after expiry must be refused"
    );
}

/// **(b) a dust add cannot mint zero shares and keep the deposit — FIXED 2026-08-26.**
///
/// The previous version of this test added dust to a pool that had **never traded**, where
/// `total_shares == pt_reserve`, so one unit still produced one share and the defect could not
/// occur. It passed for the wrong reason while the defect was live.
///
/// The defect needs swap fees to grow the reserves past `total_shares` first. Then both legs floor
/// to zero, `hi - lo == 0` passes the ratio check, and the deposit used to be consumed for nothing.
#[test]
fn tofix_26b_a_dust_add_cannot_swallow_the_deposit_for_zero_shares() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);

    // Trade first — this is the precondition the old test was missing.
    for _ in 0..2 {
        let (t, sr) = w.user_with_sr(20_000 * USDC);
        let py = w.y().mint_py(&t, &t, &(sr / 2));
        w.m().swap_exact_pt_for_sr(&t, &py, &0i128, &0u32);
        let back = w.sr().balance(&t);
        w.m().swap_exact_sr_for_pt(&t, &back, &0i128, &0u32);
    }
    let (pt_res, sr_res) = w.m().reserves();
    let total = w.m().total_shares();
    assert!(pt_res > total || sr_res > total, "fees must have grown a reserve past total_shares");

    let (lp, sr) = w.user_with_sr(20_000 * USDC);
    let _ = w.y().mint_py(&lp, &lp, &(sr / 2));
    let pt_before = w.pt().balance(&lp);
    let sr_before = w.sr().balance(&lp);
    let (res_pt0, res_sr0) = w.m().reserves();
    let total0 = w.m().total_shares();

    assert!(
        w.m().try_add_liquidity(&lp, &1i128, &1i128, &0i128).is_err(),
        "a dust add that would mint zero shares must revert, not consume the deposit"
    );
    assert_eq!(w.pt().balance(&lp), pt_before, "reverted without consuming PT");
    assert_eq!(w.sr().balance(&lp), sr_before, "reverted without consuming SR");
    assert_eq!(w.m().reserves(), (res_pt0, res_sr0), "reserves untouched");
    assert_eq!(w.m().total_shares(), total0, "total shares untouched");

    // A real, ratio-matched add still works.
    let (rp, rs) = w.m().reserves();
    let pt_add = 100 * USDC;
    let ok = w.m().add_liquidity(&lp, &pt_add, &(pt_add * rs / rp), &0i128);
    assert!(ok > 0, "an ordinary add must still mint shares");
    std::println!("#26b  dust add reverts and consumes nothing; a real add still mints {ok} shares");
}

/// **(c) `add_liquidity` takes a caller-chosen tolerance — FIXED 2026-08-26.**
///
/// The previous version of this test exercised **`remove_liquidity`**, a different function that
/// genuinely did have `min_pt_out` / `min_sr_out`. It never touched the defect, which is that an
/// LP's pre-quoted `add_liquidity` is knocked out by any swap landing first, with no argument to
/// widen. `min_shares` is that argument.
#[test]
fn tofix_26c_add_liquidity_has_a_caller_chosen_tolerance() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);

    // The LP computes a deposit that matches the CURRENT ratio exactly.
    let (pt_res, sr_res) = w.m().reserves();
    let pt_in = 10_000 * USDC;
    let sr_in = pt_in * sr_res / pt_res;

    // A swap of ~1% of the pool lands first and moves the ratio.
    let (t, sr) = w.user_with_sr(20_000 * USDC);
    let py = w.y().mint_py(&t, &t, &(sr / 2));
    w.m().swap_exact_pt_for_sr(&t, &(py.min(5_000 * USDC)), &0i128, &0u32);

    let (lp, lsr) = w.user_with_sr(120_000 * USDC);
    let _ = w.y().mint_py(&lp, &lp, &(lsr / 2));

    // The pre-quoted add now goes through: the LP set their own bound instead of being held to the
    // pool's fixed 0.1% band.
    // With no bound stated, the pool's own band still rejects it — today's behaviour, preserved.
    assert!(
        w.m().try_add_liquidity(&lp, &pt_in, &sr_in, &0i128).is_err(),
        "min_shares == 0 keeps the pool's 0.1% band as the safe default"
    );
    // Stating a bound opts out of the band and into the caller's own tolerance.
    let shares = w.m().add_liquidity(&lp, &pt_in, &sr_in, &1i128);
    assert!(shares > 0, "a pre-quoted add with a stated bound must survive an intervening swap");
    std::println!("#26c  pre-quoted add after a 1% swap minted {shares} shares");

    // And the bound actually binds, in both directions.
    let (lp2, lsr2) = w.user_with_sr(120_000 * USDC);
    let _ = w.y().mint_py(&lp2, &lp2, &(lsr2 / 2));
    let pt_before = w.pt().balance(&lp2);
    assert!(
        w.m().try_add_liquidity(&lp2, &pt_in, &sr_in, &i128::MAX).is_err(),
        "min_shares must bind"
    );
    assert_eq!(w.pt().balance(&lp2), pt_before, "a bound breach consumes nothing");
    // Exactly at the boundary succeeds.
    let got = w.m().add_liquidity(&lp2, &pt_in, &sr_in, &shares);
    assert!(got >= shares, "min_shares == the achievable amount must succeed");
    std::println!("#26c  min_shares binds above the achievable amount and passes at the boundary");
}

// ===========================================================================
// #34 P1 — the reported rate and price must respond to trading
// ===========================================================================

/// **FIXED 2026-08-26.** `sync_implied_rate` used to anchor on the *post-trade* reserves and then
/// price that same proportion. `try_params` builds the anchor so `price(prop) == target_price` by
/// construction, so that was a fixpoint: the stored rate could never change, and `implied_apy()` /
/// `pt_price()` stayed frozen at the seeded rate no matter how much the pool traded — measured
/// identical across 1%-50% trade sizes.
///
/// It now anchors on the pre-trade state and prices the proportion the trade left behind.
#[test]
fn tofix_34_the_quote_moves_with_flow_and_scales_with_size() {
    let mut deltas = std::vec::Vec::new();
    for pctile in [1i128, 5, 25] {
        let w = std_setup(YEAR, 500);
        w.seed(500_000 * USDC, 500_000 * USDC);
        let apy0 = w.m().implied_apy();
        let px0 = w.m().pt_price();

        let (_, sr_res) = w.m().reserves();
        let (t, sr) = w.user_with_sr(900_000 * USDC);
        let _ = w.y().mint_py(&t, &t, &(sr / 2));
        w.m().swap_exact_sr_for_pt(&t, &(sr_res * pctile / 100), &0i128, &0u32);

        let apy1 = w.m().implied_apy();
        let px1 = w.m().pt_price();
        std::println!("#34  buy {pctile:>2}% of the SR side: apy {apy0} -> {apy1}, pt_price {px0} -> {px1}");
        assert!(apy1 < apy0, "buying PT must LOWER the implied yield");
        assert!(px1 > px0, "buying PT must RAISE its price");
        deltas.push(apy0 - apy1);
    }
    for i in 1..deltas.len() {
        assert!(deltas[i] > deltas[i - 1], "a bigger trade must move the quote further: {deltas:?}");
    }
    std::println!("#34  quote response scales with size: {deltas:?}");
}

/// And the other direction: selling PT raises the implied yield and lowers the price.
#[test]
fn tofix_34b_selling_moves_the_quote_the_other_way() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let apy0 = w.m().implied_apy();
    let px0 = w.m().pt_price();

    let (t, sr) = w.user_with_sr(200_000 * USDC);
    let py = w.y().mint_py(&t, &t, &(sr / 2));
    w.m().swap_exact_pt_for_sr(&t, &py, &0i128, &0u32);

    let apy1 = w.m().implied_apy();
    let px1 = w.m().pt_price();
    std::println!("#34b sell: apy {apy0} -> {apy1}, pt_price {px0} -> {px1}");
    assert!(apy1 > apy0, "selling PT must RAISE the implied yield");
    assert!(px1 < px0, "selling PT must LOWER its price");
}

/// A **proportional** liquidity change must be rate-neutral — it does not change the pool's
/// proportion, so pre-trade and post-trade agree and the stored rate must not move. This is the
/// property that could plausibly have been broken by the fix, so it is pinned explicitly.
#[test]
fn tofix_34c_proportional_liquidity_changes_are_rate_neutral() {
    let w = std_setup(YEAR, 500);
    let (lp, seeded) = w.seed(500_000 * USDC, 500_000 * USDC);

    // Trade first, so the stored rate is something other than its seeded value.
    let (t, sr) = w.user_with_sr(60_000 * USDC);
    let _ = w.y().mint_py(&t, &t, &(sr / 2));
    let (_, sr_res) = w.m().reserves();
    w.m().swap_exact_sr_for_pt(&t, &(sr_res / 20), &0i128, &0u32);

    let apy_before = w.m().implied_apy();
    let px_before = w.m().pt_price();

    // Add proportionally.
    let (rp, rs) = w.m().reserves();
    let (lp2, lsr) = w.user_with_sr(200_000 * USDC);
    let _ = w.y().mint_py(&lp2, &lp2, &(lsr / 2));
    let pt_add = 10_000 * USDC;
    w.m().add_liquidity(&lp2, &pt_add, &(pt_add * rs / rp), &1i128);
    // `pt_add * rs / rp` floors, so the add is proportional only to the nearest stroop and the
    // quote drifts by that rounding. Bound it at 1 ppm — three orders of magnitude tighter than the
    // ~1.1% move a 5% trade produces above, so a regression to real movement cannot hide here.
    let tol = apy_before / 1_000_000;
    let d_add = (w.m().implied_apy() - apy_before).abs();
    assert!(d_add <= tol, "a proportional add must not move the rate: drifted {d_add} (tol {tol})");
    assert!(
        (w.m().pt_price() - px_before).abs() <= px_before / 1_000_000,
        "a proportional add must not move the price"
    );

    // And remove proportionally.
    w.m().remove_liquidity(&lp, &(seeded / 10), &0i128, &0i128);
    let d_rm = (w.m().implied_apy() - apy_before).abs();
    assert!(d_rm <= tol, "a proportional removal must not move the rate: drifted {d_rm} (tol {tol})");
    std::println!(
        "#34c quote held at {apy_before} through a proportional add (drift {d_add}) and removal (drift {d_rm}); tolerance {tol}"
    );
}

// ===========================================================================
// #27 P2 — "read-only" views write to chain state
// ===========================================================================

/// **Closed.** Every public view is pure. Proven by snapshotting the full observable state, calling
/// every view repeatedly, and asserting nothing moved — including the index, which is the one that
/// stamps on the *mutating* path (`index_current`) but not on the view path (`py_index`).
#[test]
fn tofix_27_no_view_mutates_chain_state() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let (u, py) = w.user_with_py(50_000 * USDC);
    w.advance(90 * DAY);

    let snap = || {
        (
            w.m().reserves(),
            w.m().total_shares(),
            w.m().last_ln_implied_rate(),
            w.m().treasury_earned(),
            w.y().total_py(),
            w.y().total_accrued(),
            w.y().total_supply(),
            w.y().interest_of(&u),
            w.y().expiry_index(),
        )
    };
    let before = snap();

    for _ in 0..3 {
        let _ = w.m().pt_price();
        let _ = w.m().implied_apy();
        let _ = w.m().quote_buy_pt(&(1_000 * USDC));
        let _ = w.m().quote_sell_pt(&(1_000 * USDC));
        let _ = w.m().quote_buy_yt(&(1_000 * USDC));
        let _ = w.m().quote_sell_yt(&(1_000 * USDC));
        let _ = w.m().fee_preview(&(1_000 * USDC));
        let _ = w.m().asset_reserve();
        let _ = w.m().lp_position(&u);
        let _ = w.y().py_index();
        let _ = w.y().claimable_interest(&u);
        let _ = w.y().solvency();
        let _ = w.y().interest_of(&u);
        let _ = w.sr().exchange_rate();
        let _ = w.sr().assets_of(&u);
        let _ = w.sr().preview_deposit(&(1_000 * USDC));
        let _ = w.sr().preview_redeem(&(1_000 * USDC));
    }
    let after = snap();
    assert_eq!(
        (before.0, before.1, before.2, before.3, before.4, before.5, before.6, before.7.clone(), before.8),
        (after.0, after.1, after.2, after.3, after.4, after.5, after.6, after.7.clone(), after.8),
        "a view mutated state"
    );
    std::println!("#27  17 views x3 calls each: zero state change");
    let _ = py;
}

/// The same, past expiry — where v1's views were most likely to stamp.
#[test]
fn tofix_27b_views_are_still_pure_after_expiry() {
    let w = std_setup(90 * DAY, 500);
    let (u, _) = w.user_with_py(50_000 * USDC);
    w.advance(91 * DAY);
    // Deliberately do NOT stamp first — the view must not stamp on our behalf.
    assert_eq!(w.y().expiry_index(), None, "nothing stamped yet");
    for _ in 0..5 {
        let _ = w.y().py_index();
        let _ = w.y().claimable_interest(&u);
        let _ = w.y().solvency();
    }
    assert_eq!(
        w.y().expiry_index(),
        None,
        "a view stamped the expiry index — that is a write"
    );
    std::println!("#27b views did not stamp the expiry index");
}

// ===========================================================================
// #28 P2 — exits account the requested amount, not the amount actually paid
// ===========================================================================

/// **Closed.** `Sr::redeem` returns what the strategy actually paid, and the event carries the same
/// figure. Verified by reconciling the return value against the recipient's real balance delta.
#[test]
fn tofix_28_exits_report_what_actually_moved() {
    let w = std_setup(YEAR, 500);
    let (u, sr) = w.user_with_sr(50_000 * USDC);
    let before = w.usdc_balance(&u);
    let reported = w.sr().redeem(&u, &u, &sr, &0i128);
    let actual = w.usdc_balance(&u) - before;
    assert_eq!(reported, actual, "returned {reported} but {actual} moved");

    // Same for the PY leg.
    let (u2, py) = w.user_with_py(50_000 * USDC);
    let sr_before = w.sr().balance(&u2);
    let reported2 = w.y().redeem_py(&u2, &u2, &py);
    assert_eq!(reported2, w.sr().balance(&u2) - sr_before);
    std::println!("#28  redeem return == real balance delta on both legs");
}

// ===========================================================================
// #29 P2 — a YT-only holder has no principal exit before maturity
// ===========================================================================

/// **Closed, and the premise no longer applies.** PT and YT are independent tokens here, so a
/// YT-only holder never had a principal claim to exit — they exit by selling the YT.
#[test]
fn tofix_29_a_yt_only_holder_has_a_real_pre_maturity_exit() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let n = 20_000 * USDC;
    let q = w.m().quote_buy_yt(&n);
    let (u, sr_in) = w.user_with_sr(w.sr().preview_redeem(&q) + 1_000);
    w.m().buy_yt_exact_out(&u, &n, &sr_in, &0u32);
    assert_eq!(w.pt().balance(&u), 0, "YT-only holder");

    w.advance(60 * DAY);
    let out = w.m().sell_yt_exact_in(&u, &n, &0i128, &0u32);
    assert!(out > 0, "must be able to exit mid-term");
    let (yield_paid, _) = w.y().redeem_due_interest(&u);
    std::println!("#29  YT-only holder exited mid-term: {out} SR of principal value + {yield_paid} SR of yield");
}

// ===========================================================================
// #16 P2 — post-maturity surplus accrues to nobody
// ===========================================================================

/// **Reframed, not closed.** The conservation identity means every stroop above PT cover is owed to
/// a YT holder, so there is no pot to capture. What *is* recoverable is abandoned claims. Both
/// halves are asserted here so the reframing is not taken on trust.
#[test]
fn tofix_16_surplus_is_owed_to_holders_not_to_the_protocol() {
    let w = std_setup(90 * DAY, 500);
    let (u, _) = w.user_with_py(100_000 * USDC);
    w.advance(91 * DAY);
    w.y().stamp_expiry_index();
    w.advance(180 * DAY);

    let owed = w.y().claimable_interest(&u);
    let surplus = w.y().solvency().2;
    let swept = w.y().sweep_surplus();
    assert!(swept * 100 < surplus.max(1), "the sweep must not raid holder claims");
    let (paid, fee) = w.y().redeem_due_interest(&u);
    assert_eq!(paid + fee, owed, "the holder is still paid in full after a sweep");
    std::println!(
        "#16  surplus {surplus} SR was owed to holders; only {swept} was unowed; holder still paid {}",
        paid + fee
    );
}

// ===========================================================================
// #15 P1 — a raw YT transfer strands the recipient's claim
// ===========================================================================

/// **Closed.** Restated here in the audit so the whole list is answerable from one run.
#[test]
fn tofix_15_a_raw_yt_transfer_carries_the_claim_with_it() {
    let w = std_setup(YEAR, 500);
    let (alice, py) = w.user_with_py(50_000 * USDC);
    let bob = Address::generate(&w.env);
    w.y().transfer(&alice, &bob, &py);
    w.advance(120 * DAY);
    let (a, _) = w.y().redeem_due_interest(&alice);
    let (b, _) = w.y().redeem_due_interest(&bob);
    assert_eq!(a, 0, "a holder with no YT earns nothing");
    assert!(b > 0, "the token holder earns everything");
}

// ===========================================================================
// #30 P2 — TTL keep-alive coverage
// ===========================================================================

/// **FIXED 2026-08-26.** Only `srvault::bump_receipt` and `yield::bump_holder` existed, and the
/// latter bumped only the `Interest` record — not the YT balance entry beside it. SR balances and
/// srmarket LP shares had no keep-alive at all, and SR is the most exposed of the three because it
/// has no maturity bounding how long a holder may sit dormant.
///
/// All three are permissionless: they prolong an entry and never touch accounting.
#[test]
fn tofix_30_every_holder_entry_has_a_permissionless_keep_alive() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let (u, py) = w.user_with_py(50_000 * USDC);
    let sr_bal = w.sr().balance(&u);
    let yt_bal = w.y().balance(&u);
    let (lp, lsr) = w.user_with_sr(200_000 * USDC);
    let lp_py = w.y().mint_py(&lp, &lp, &(lsr / 2));
    let (rp, rs) = w.m().reserves();
    let pt_add = lp_py.min(5_000 * USDC);
    w.m().add_liquidity(&lp, &pt_add, &(pt_add * rs / rp), &1i128);
    let (lp_shares, _, _) = w.m().lp_position(&lp);
    assert!(lp_shares > 0);

    // Every bump is callable and moves no value.
    w.sr().bump_holder(&u);
    w.y().bump_holder(&u);
    w.m().bump_lp(&lp);

    assert_eq!(w.sr().balance(&u), sr_bal, "bumping must not move SR");
    assert_eq!(w.y().balance(&u), yt_bal, "bumping must not move YT");
    assert_eq!(w.m().lp_position(&lp).0, lp_shares, "bumping must not move LP shares");
    assert_eq!(w.pt().balance(&u), py, "bumping must not move PT");

    // They are safe on an address that holds nothing — no entry is created.
    let nobody = Address::generate(&w.env);
    w.sr().bump_holder(&nobody);
    w.y().bump_holder(&nobody);
    w.m().bump_lp(&nobody);
    assert_eq!(w.sr().balance(&nobody), 0);
    assert_eq!(w.y().balance(&nobody), 0);
    assert_eq!(w.m().lp_position(&nobody), (0, 0, 0));
    std::println!("#30  sr::bump_holder, yield::bump_holder and srmarket::bump_lp all live and value-neutral");
}

// ===========================================================================
// Deployment-readiness gaps that no test can close
// ===========================================================================

/// **Closed 2026-08-25.** The three v2 contracts now expose the same governance surface v1 has:
/// two-step admin rotation and timelocked upgrades, via `spield_shared::governance`. Proven
/// end-to-end in `governance.rs`; this asserts the surface simply exists on all three.
#[test]
fn tofix_governance_all_three_contracts_expose_admin_rotation_and_a_timelock() {
    let w = std_setup(YEAR, 500);
    // Every contract answers `timelock()` with the shared 24h default, and `pending_*` with None.
    for (name, tl, pa, pu) in [
        ("market", w.m().timelock(), w.m().pending_admin(), w.m().pending_upgrade().is_none()),
        ("yield", w.y().timelock(), w.y().pending_admin(), w.y().pending_upgrade().is_none()),
        ("sr", w.sr().timelock(), w.sr().pending_admin(), w.sr().pending_upgrade().is_none()),
    ] {
        assert_eq!(tl, 24 * 60 * 60, "{name}: default timelock");
        assert_eq!(pa, None, "{name}: no pending admin at deploy");
        assert!(pu, "{name}: no pending upgrade at deploy");
    }
    std::println!("#governance  sr / yield / srmarket all expose rotation + a 24h upgrade timelock");
}
