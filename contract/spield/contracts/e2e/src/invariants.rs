#![cfg(test)]
//! # Invariants, and the defects this suite found.
//!
//! Five of the six findings in `anyfix.md` are **fixed**; their tests are ordinary invariants now
//! and are named `f1_`…`f4_` so the connection stays legible. Each asserts the property the fix was
//! supposed to establish, in the scenario that used to break it — not a narrower one.
//!
//! **F5 is not fixed on chain and deliberately so.** Its mitigation is operational (the keeper
//! stamps the index at expiry), so the on-chain reproduction stays `#[ignore]`d as the standing
//! record of the residual risk, paired with a live test pinning how large the race is. Run it with
//! `cargo test -- --ignored`.

extern crate std;

use crate::harness::*;

// ###########################################################################
// F1 — `Sr::max_redeemable` refreshes the rate before dividing by it  [FIXED]
// ###########################################################################
//
// `Sr::exchange_rate()` is a pure read of the stored high-water mark, and must stay that way — the
// alternative caused an intermittent `storage: exceeded_limit` footprint failure on testnet.
//
// But `max_redeemable` *divides* available underlying by that rate to get shares, and a stale rate
// is always lower than the live one, so it returned MORE shares than the venue could pay for.
// `redeem_partial` clamped to that number and reverted — the one path whose whole purpose is never
// to revert. It now calls `sync_rate` first, which ALWAYS writes and so keeps the footprint a
// function of the call graph alone.

/// `redeem_partial` is the exit of last resort: a crunch must cost the holder extra transactions,
/// never the exit itself. Thirty days of unsynced drift used to be enough to break it.
#[test]
fn f1_redeem_partial_makes_progress_even_when_the_stored_rate_is_stale() {
    let w = setup(Cfg { term: 180 * DAY, ..Cfg::default() });
    let (h, sr) = w.user_with_sr(500_000 * USDC);
    w.drain_venue_to_max();
    w.advance_unsynced(30 * DAY);

    let (burned, paid) = w.sr().redeem_partial(&h, &h, &sr, &0i128);
    assert!(burned > 0 && paid > 0, "the partial exit paid nothing");
    assert!(burned < sr, "a partial exit must leave the remainder of the position intact");
    assert_eq!(w.sr().balance(&h), sr - burned);
    assert_eq!(w.usdc_t().balance(&h), paid);
}

/// The number `max_redeemable` reports must be one that actually clears, whatever the stored rate
/// was doing beforehand. This is what a UI puts behind a max button.
#[test]
fn f1_max_redeemable_is_actionable_after_arbitrary_drift() {
    for stale_days in [0u64, 1, 7, 30, 90] {
        let w = setup(Cfg { term: 360 * DAY, ..Cfg::default() });
        let (h, sr) = w.user_with_sr(500_000 * USDC);
        w.drain_venue_to_max();
        w.advance_unsynced(stale_days * DAY);

        let cap = w.sr().max_redeemable();
        assert!(cap > 0 && cap < sr, "the crunch must bind at {} days: cap {}", stale_days, cap);
        assert!(
            w.sr().try_redeem(&h, &h, &cap, &0i128).is_ok(),
            "max_redeemable over-promised after {} days of drift", stale_days
        );
    }
}

/// Reading it twice in a row must give the same answer — the sync is idempotent, so the second read
/// has nothing left to correct.
#[test]
fn f1_max_redeemable_is_stable_once_synced() {
    let w = setup(Cfg { term: 180 * DAY, ..Cfg::default() });
    let (_h, _sr) = w.user_with_sr(500_000 * USDC);
    w.drain_venue_to_max();
    w.advance_unsynced(30 * DAY);

    let first = w.sr().max_redeemable();
    let second = w.sr().max_redeemable();
    assert_eq!(first, second, "the first read left the rate un-refreshed");
}

/// **F1b.** `i128::MAX` means "no constraint at all". It must never be returned while an exit would
/// revert — that is the worst possible thing to tell a wallet. The comparison behind the short
/// circuit used to be decided on a stale valuation of both sides.
#[test]
fn f1b_an_unbounded_max_redeemable_means_a_full_exit_actually_clears() {
    let w = setup(Cfg { term: 360 * DAY, ..Cfg::default() });
    let (h, sr) = w.user_with_sr(200_000 * USDC);
    w.drain_venue_to_max();
    w.advance_unsynced(300 * DAY);
    // Aim the venue's free liquidity into the band between the stale and live valuations — the
    // exact window where the short circuit used to misfire.
    let stale_assets = w.sr().total_assets();
    let avail = w.st().available_liquidity();
    let target = stale_assets + stale_assets / 200;
    if target > avail { w.refill_venue(target - avail); }

    if w.sr().max_redeemable() == i128::MAX {
        let out = w.sr().redeem(&h, &h, &sr, &0i128);
        assert!(out > 0, "max_redeemable promised no constraint and the exit still failed");
    }
}

// ###########################################################################
// F2 — the vault tracks its rounding residue explicitly  [FIXED]
// ###########################################################################
//
// `REDEEM_DUST` (2 stroops) covers the flooring on a receipt's *closing* leg. Every *partial* leg
// floors too — it burns `take` PT and banks `got <= take` USDC — so `pt_inventory + total_collected`
// fell about a stroop a leg while `total_liability` stood still. Two legs spent the margin and the
// third reverted with `SolvencyViolation`.
//
// The fix is two-sided: the loss is now recorded as `Receipt::residue` and counted by
// `assert_solvent` as the expected rounding it is, and `PARTIAL_LEG_BUDGET` reserves room for it so
// `deposit`, `sweep` and `coupon_capacity` stop telling the operator that a two-stroop margin is
// safe.

/// A receipt driven through a long crunch must keep taking partial legs until it closes.
#[test]
fn f2_a_partially_redeemed_receipt_can_always_take_another_leg() {
    let (w, (id, promised)) = stuck_receipt_world();
    let owner = w.v().get_receipt(&id).owner.clone();

    let mut legs = 0;
    while w.v().get_receipt(&id).open {
        assert!(
            w.v().try_redeem(&id).is_ok(),
            "partial leg {} reverted — a crunch cost the holder the exit, not just time", legs
        );
        legs += 1;
        assert!(legs < 40, "the receipt is not converging");
        w.refill_venue(3_000 * USDC);
    }
    assert!(legs > 2, "the scenario must exercise more than the old two-leg margin: {}", legs);
    assert_eq!(w.usdc_t().balance(&owner), promised, "the promise was not paid in full");
}

/// The residue is recorded while the receipt is open and released when it closes, so the slack in
/// the invariant never outlives the receipt that earned it.
#[test]
fn f2_residue_is_recorded_then_released_with_the_receipt() {
    let (w, (id, _promised)) = stuck_receipt_world();
    assert_eq!(w.v().total_residue(), 0, "nothing has floored yet");

    w.v().redeem(&id);
    let after_first = w.v().total_residue();
    assert!(
        w.v().get_receipt(&id).open,
        "this scenario needs a partial leg to exist at all"
    );
    assert!(after_first > 0, "a partial leg floored but recorded no residue");
    assert_eq!(w.v().get_receipt(&id).residue, after_first, "per-receipt and total must agree");

    while w.v().get_receipt(&id).open {
        w.refill_venue(3_000 * USDC);
        w.v().redeem(&id);
    }
    assert_eq!(w.v().total_residue(), 0, "closing the receipt must release its slack");
    assert_eq!(w.v().get_receipt(&id).residue, 0);
}

/// The residue stays small — it is rounding, not a leak. A stroop or two a leg, bounded well inside
/// the budget the vault reserves for it.
#[test]
fn f2_residue_stays_within_the_reserved_budget() {
    let (w, (id, _)) = stuck_receipt_world();
    let mut legs = 0i128;
    while w.v().get_receipt(&id).open && legs < 20 {
        w.v().redeem(&id);
        legs += 1;
        w.refill_venue(3_000 * USDC);
    }
    let residue = w.v().get_receipt(&id).residue;
    assert!(
        residue <= legs * 2,
        "residue grew faster than two stroops a leg: {} over {} legs", residue, legs
    );
}

/// `sweep`, `deposit` and `stats().coupon_capacity` must agree on what is free. Sweeping everything
/// the dashboard reports as spare must leave every open receipt redeemable.
#[test]
fn f2_sweeping_all_reported_capacity_leaves_receipts_redeemable() {
    let w = setup(Cfg { term: 30 * DAY, ..Cfg::default() });
    w.seed_vault(50_000 * USDC);
    let a = w.new_user(50_000 * USDC);
    let ida = w.v().deposit(&a, &(50_000 * USDC));

    let free = w.v().stats().coupon_capacity;
    w.v().sweep(&w.admin, &free);
    assert_eq!(w.v().stats().coupon_capacity, 0, "the sweep must take exactly what was reported");
    // A stroop more must be refused — the reported figure is the real edge, not an estimate.
    assert!(w.v().try_sweep(&w.admin, &1i128).is_err(), "sweep released more than it reported free");

    w.advance(30 * DAY + 1);
    w.drain_venue_to_max();
    let promised = w.v().get_receipt(&ida).payout;
    let mut legs = 0;
    while w.v().get_receipt(&ida).open && legs < 40 {
        assert!(w.v().try_redeem(&ida).is_ok(), "leg {} reverted after a fully-reported sweep", legs);
        legs += 1;
        w.refill_venue(3_000 * USDC);
    }
    assert_eq!(w.usdc_t().balance(&a), promised);
}

// ###########################################################################
// F3 + F4 — the cap measures cost basis, and its headroom is actionable  [FIXED]
// ###########################################################################
//
// The cap used to be checked against `total_supply x live_rate` — a mark-to-market valuation — while
// `deposit_headroom()` derived the same figure from the *stale* stored rate. Two consequences: the
// advertised headroom was never depositable, and accrued yield slowly closed deposits on a healthy
// protocol, which is exactly what the comment above the check said it avoided.
//
// Both now read `total_principal`: a plain stored integer, raised by the deposit and released
// proportionally as shares are destroyed.

/// **F3.** A max button built on `deposit_headroom()` must work. It reads the same integer
/// `deposit` checks, with no rate in either, so this holds however stale the rate is.
#[test]
fn f3_a_deposit_of_exactly_the_advertised_headroom_succeeds() {
    for stale_days in [0u64, 30, 180] {
        let w = setup(Cfg { term: 360 * DAY, deposit_cap: 1_000 * USDC, ..Cfg::default() });
        let u = w.new_user(500 * USDC);
        w.sr().deposit(&u, &u, &(500 * USDC), &0i128);
        w.advance_unsynced(stale_days * DAY);

        let head = w.sr().deposit_headroom();
        let v = w.new_user(head);
        assert!(
            w.sr().try_deposit(&v, &v, &head, &0i128).is_ok(),
            "headroom of {} was not depositable after {} days of drift", head, stale_days
        );
        assert_eq!(w.sr().deposit_headroom(), 0, "the cap must now be exactly full");
        let x = w.new_user(1);
        assert!(w.sr().try_deposit(&x, &x, &1i128, &0i128).is_err(), "and one stroop more refused");
    }
}

/// **F4.** Yield is the users' own return, not new exposure. Headroom must not move because time
/// passed.
#[test]
fn f4_headroom_does_not_shrink_just_because_yield_accrued() {
    let w = setup(Cfg { term: 360 * DAY, deposit_cap: 1_000 * USDC, ..Cfg::default() });
    let u = w.new_user(900 * USDC);
    w.sr().deposit(&u, &u, &(900 * USDC), &0i128);
    let head0 = w.sr().deposit_headroom();
    assert_eq!(head0, 100 * USDC, "headroom must be cap minus what was actually deposited");

    w.advance(90 * DAY);
    assert_eq!(w.sr().deposit_headroom(), head0, "yield alone closed headroom");
    w.advance(270 * DAY);
    assert_eq!(w.sr().deposit_headroom(), head0, "yield alone closed headroom over a year");
    // The mark-to-market figure has genuinely grown — the point is that the cap ignores it.
    assert!(w.sr().total_assets() > 900 * USDC, "the position really did earn");
    assert_eq!(w.sr().total_principal(), 900 * USDC, "cost basis is unmoved by yield");
}

/// Exposure is released as shares leave, proportionally and by every route — `redeem`,
/// `redeem_partial`, and a bare SEP-41 `burn`.
#[test]
fn f4_every_exit_releases_cost_basis_proportionally() {
    let w = setup(Cfg { term: 360 * DAY, deposit_cap: 10_000 * USDC, ..Cfg::default() });
    let (a, sr_a) = w.user_with_sr(1_000 * USDC);
    let (b, sr_b) = w.user_with_sr(1_000 * USDC);
    assert_eq!(w.sr().total_principal(), 2_000 * USDC);

    w.advance(90 * DAY);

    // Half of A's position out through `redeem`.
    w.sr().redeem(&a, &a, &(sr_a / 2), &0i128);
    let after_half = w.sr().total_principal();
    assert!(
        (after_half - 1_500 * USDC).abs() <= 2,
        "half of A's exposure should have been released: {}", after_half
    );

    // B burns their shares outright, taking nothing — exposure still leaves.
    w.sr().burn(&b, &sr_b);
    let after_burn = w.sr().total_principal();
    assert!(after_burn < after_half, "a bare burn must release exposure too");

    // Everything out: cost basis lands exactly on zero, not on a residue.
    let rest = w.sr().balance(&a);
    w.sr().redeem(&a, &a, &rest, &0i128);
    assert_eq!(w.sr().total_supply(), 0);
    assert_eq!(w.sr().total_principal(), 0, "the last exit must release the last of the basis");
}

/// The cap keeps doing its actual job: it is still a global ceiling that the operator's own seeding
/// consumes, and it still binds LPs transitively.
#[test]
fn f4_the_cap_still_bounds_everything_it_did_before() {
    let cap = 50 * USDC;
    let w = setup(Cfg { term: 30 * DAY, deposit_cap: cap, ..Cfg::default() });
    w.seed_vault(20 * USDC);
    assert_eq!(w.sr().deposit_headroom(), 30 * USDC, "vault seeding consumes the cap exactly");
    w.seed_market(10 * USDC, 10 * USDC);
    assert_eq!(w.sr().deposit_headroom(), 10 * USDC, "AMM seeding consumes the cap exactly");

    let u = w.new_user(11 * USDC);
    assert!(w.sr().try_deposit(&u, &u, &(11 * USDC), &0i128).is_err(), "over the headroom");
    assert!(w.sr().deposit(&u, &u, &(10 * USDC), &0i128) > 0, "exactly the headroom");
    assert_eq!(w.sr().deposit_headroom(), 0);
}

// ###########################################################################
// F5 — post-expiry yield goes to YT until somebody stamps the index
// ###########################################################################
//
// NOT fixed on chain, and deliberately: the freeze would have to happen *at* the expiry timestamp,
// and Blend exposes no historical rate to reconstruct it from. The mitigation is operational —
// `ttl_keeper.mjs` now stamps the index as soon as a series expires, and `sr_solvency_monitor.mjs`
// pages if a series is expired and still unstamped. That bounds the race to the keeper's interval
// instead of leaving it unbounded.
//
// The pair below is the standing record of the residual: the ignored test is what a real fix would
// have to satisfy, and the live one pins how big the race is so it cannot quietly grow.

/// What an on-chain fix would have to establish.
#[test]
#[ignore = "F5: not fixed on chain by design — the mitigation is the keeper stamping at expiry"]
fn f5_a_matured_yt_earns_the_same_however_late_the_index_is_stamped() {
    let prompt = yt_claim_when_stamped_after(0);
    let late = yt_claim_when_stamped_after(180);
    assert_eq!(prompt, late, "stamping 180 days late paid {} instead of {}", late, prompt);
}

/// How large the race is. The keeper's job is to keep the real world at the top row.
#[test]
fn f5_the_size_of_the_stamping_race() {
    let prompt = yt_claim_when_stamped_after(0);
    let d30 = yt_claim_when_stamped_after(30);
    let d180 = yt_claim_when_stamped_after(180);
    assert!(prompt > 0 && d30 > prompt && d180 > d30,
        "if these are now equal, F5 has been fixed on chain: {} {} {}", prompt, d30, d180);
    assert!(d30 * 10 / prompt >= 15, "the +30d multiple shrank: {}x", d30 as f64 / prompt as f64);
    assert!(d180 / prompt >= 5, "the +180d multiple shrank: {}x", d180 / prompt);
}

/// Stamping promptly — what the keeper does — is what makes the claim honest, and stamping is
/// permissionless so the keeper needs no privilege to do it.
#[test]
fn f5_a_prompt_stamp_is_permissionless_and_write_once() {
    let w = setup(Cfg { term: 30 * DAY, ..Cfg::default() });
    let (h, sr) = w.user_with_sr(10_000 * USDC);
    w.y().mint_py(&h, &h, &sr);

    assert!(w.y().try_stamp_expiry_index().is_err(), "cannot stamp before expiry");
    w.advance(30 * DAY + 1);

    let pinned = w.y().stamp_expiry_index();
    assert_eq!(w.y().expiry_index(), Some(pinned));
    let claim_then = w.y().claimable_interest(&h);

    // Once pinned, later calls cannot raise it — so a late caller can no longer inflate the claim.
    w.advance(180 * DAY);
    assert_eq!(w.y().stamp_expiry_index(), pinned, "a later stamp moved the frozen index");
    assert_eq!(w.y().claimable_interest(&h), claim_then, "the claim kept growing after the stamp");
}

fn yt_claim_when_stamped_after(wait_days: u64) -> i128 {
    let w = setup(Cfg { term: 30 * DAY, ..Cfg::default() });
    let (h, sr) = w.user_with_sr(10_000 * USDC);
    w.y().mint_py(&h, &h, &sr);
    w.advance(30 * DAY + 1);
    if wait_days > 0 { w.advance(wait_days * DAY); }
    w.y().stamp_expiry_index();
    w.y().claimable_interest(&h)
}

// ###########################################################################
// INVARIANTS THAT HOLD — pinned so they keep holding
// ###########################################################################

/// Value is conserved across a full term with every product in play: what users take out equals
/// what they put in, plus genuine Blend yield, and nothing else.
#[test]
fn i1_the_protocol_conserves_value_across_a_whole_term() {
    let w = setup(Cfg { term: 60 * DAY, ..Cfg::default() });
    w.seed_vault(5_000 * USDC);
    let (lp, shares) = w.seed_market(20_000 * USDC, 20_000 * USDC);

    let mut in_total = 0i128;
    let mut actors = std::vec::Vec::new();
    for _ in 0..4 {
        let u = w.new_user(2_000 * USDC);
        in_total += 2_000 * USDC;
        w.r().buy_pt_with_usdc(&u, &(1_000 * USDC), &0i128, &NO_DEADLINE);
        actors.push(u);
        w.advance(7 * DAY);
    }
    let saver = w.new_user(3_000 * USDC);
    in_total += 3_000 * USDC;
    let vid = w.v().deposit(&saver, &(3_000 * USDC));

    w.advance(40 * DAY);
    for u in actors.iter() {
        let pt = w.pt().balance(u);
        if pt > 0 { w.r().redeem_py_for_usdc(u, &pt, &0i128); }
        let _ = w.r().try_claim_yield_to_usdc(u, &0i128);
    }
    w.v().redeem(&vid);
    let (pt_out, sr_out) = w.m().remove_liquidity(&lp, &shares, &0i128, &0i128);
    if pt_out > 0 { w.y().redeem_py(&lp, &lp, &pt_out); }
    let _ = sr_out;

    let mut out_total = 0i128;
    for u in actors.iter() { out_total += w.usdc_t().balance(u); }
    out_total += w.usdc_t().balance(&saver);

    assert!(out_total >= in_total, "users lost principal: in {} out {}", in_total, out_total);
    // The gain is Blend yield, not creation: bounded well under a year of any plausible rate.
    assert!(
        out_total - in_total < in_total / 20,
        "users gained more than the venue could have produced: +{}", out_total - in_total
    );
    let (held, need, _) = w.y().solvency();
    assert!(held + 10 >= need, "the engine ended insolvent: held {} need {}", held, need);
}

/// The market's stored reserves must equal its actual balances after any sequence of trades —
/// no drift, no unaccounted dust.
#[test]
fn i2_market_reserves_track_actual_balances_exactly() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    w.seed_market(50_000 * USDC, 50_000 * USDC);
    for i in 0..8 {
        let (b, sr) = w.user_with_sr(2_000 * USDC);
        let _ = w.m().try_buy_yt_exact_out(&b, &(3_000 * USDC + i), &sr, &NO_DEADLINE);
        let (t, sr2) = w.user_with_sr(1_500 * USDC);
        let _ = w.m().try_swap_exact_sr_for_pt(&t, &sr2, &0i128, &NO_DEADLINE);
        let (s, sr3) = w.user_with_sr(1_000 * USDC);
        let f = w.y().mint_py(&s, &s, &sr3);
        let _ = w.m().try_swap_exact_pt_for_sr(&s, &f, &0i128, &NO_DEADLINE);
        w.advance(5 * DAY);
    }
    let (pt_res, sr_res) = w.m().reserves();
    assert_eq!(w.pt().balance(&w.market), pt_res, "PT balance drifted from the reserve");
    assert_eq!(w.sr().balance(&w.market), sr_res, "SR balance drifted from the reserve");
    // `buy_yt_exact_out` mints a pair to the market and sends only the YT on. Any YT it keeps is
    // unaccounted value; there must be none.
    assert_eq!(w.y().balance(&w.market), 0, "the market accumulated unaccounted YT");
}

/// Every stroop of swap fee routed to the treasury is both recorded and actually delivered.
#[test]
fn i3_treasury_fees_are_recorded_and_delivered_exactly() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    w.seed_market(50_000 * USDC, 50_000 * USDC);
    for _ in 0..6 {
        let (t, sr) = w.user_with_sr(2_000 * USDC);
        w.m().swap_exact_sr_for_pt(&t, &sr, &0i128, &NO_DEADLINE);
    }
    assert!(w.m().treasury_earned() > 0, "six trades produced no protocol fee");
    assert_eq!(
        w.sr().balance(&w.treasury), w.m().treasury_earned(),
        "recorded treasury income does not match what the treasury holds"
    );
}

/// Once a series is settled, nothing of value may be stranded in the vault: `sweep` takes the PT
/// leg, `sweep_surplus` takes SR, YT and USDC, and the vault ends empty.
#[test]
fn i4_a_settled_vault_can_be_emptied_completely() {
    let w = setup(Cfg { term: 30 * DAY, ..Cfg::default() });
    w.seed_vault(20_000 * USDC);
    let s = w.new_user(5_000 * USDC);
    let id = w.v().deposit(&s, &(5_000 * USDC));
    w.advance(15 * DAY);
    w.v().harvest();
    w.advance(15 * DAY + 1);
    w.v().redeem(&id);
    w.v().harvest();

    let cap = w.v().stats().coupon_capacity;
    if cap > 0 { w.v().sweep(&w.admin, &cap); }
    w.v().sweep_surplus(&w.admin);

    assert_eq!(w.pt().balance(&w.vault), 0, "PT stranded");
    assert_eq!(w.sr().balance(&w.vault), 0, "SR stranded");
    assert_eq!(w.usdc_t().balance(&w.vault), 0, "USDC stranded");
    assert_eq!(w.y().balance(&w.vault), 0, "YT stranded");
}

/// A vault nobody keeps must still pay every promise — `harvest` is an optimization, not a
/// dependency.
#[test]
fn i5_an_unharvested_vault_still_pays_every_promise() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    w.seed_vault(20_000 * USDC);
    let mut rows = std::vec::Vec::new();
    for _ in 0..5 {
        let u = w.new_user(5_000 * USDC);
        let id = w.v().deposit(&u, &(5_000 * USDC));
        rows.push((u, id, w.v().get_receipt(&id).payout));
        w.advance(15 * DAY);
    }
    w.advance(30 * DAY);
    for (u, id, promised) in rows.iter() {
        assert_eq!(w.v().redeem(id), *promised, "an unharvested vault short-paid");
        assert_eq!(w.usdc_t().balance(u), *promised);
    }
    assert!(
        w.y().claimable_interest(&w.vault) > 0,
        "the unclaimed YT yield must still be sitting there, claimable"
    );
}

/// The market's quoted rate must respond to flow in both directions — `tofix.md` #34 was a
/// fixpoint that left it frozen at the seeded rate no matter how much traded.
#[test]
fn i6_the_quoted_rate_moves_with_flow_and_comes_back() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    w.seed_market(50_000 * USDC, 50_000 * USDC);
    let apy0 = w.m().implied_apy();
    for _ in 0..5 {
        let b = w.new_user(5_000 * USDC);
        w.r().buy_pt_with_usdc(&b, &(5_000 * USDC), &0i128, &NO_DEADLINE);
    }
    let after_buys = w.m().implied_apy();
    assert!(after_buys < apy0 * 9 / 10, "buying PT did not compress the rate: {} -> {}", apy0, after_buys);
    for _ in 0..5 {
        let (s, sr) = w.user_with_sr(5_000 * USDC);
        let f = w.y().mint_py(&s, &s, &sr);
        w.m().swap_exact_pt_for_sr(&s, &f, &0i128, &NO_DEADLINE);
    }
    let after_sells = w.m().implied_apy();
    assert!(after_sells > after_buys * 12 / 10, "selling PT did not widen the rate back");
    // Reversing the flow must not hand the pool back MORE than it started with.
    assert!(after_sells <= apy0, "a round trip moved the rate past its start: {} -> {}", apy0, after_sells);
}

/// A round trip through the market must cost the trader the spread and nothing stranger.
#[test]
fn i7_round_trip_costs_are_the_spread_not_a_leak() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    w.seed_market(50_000 * USDC, 50_000 * USDC);

    let (u, sr) = w.user_with_sr(5_000 * USDC);
    let pt = w.m().swap_exact_sr_for_pt(&u, &sr, &0i128, &NO_DEADLINE);
    let back = w.m().swap_exact_pt_for_sr(&u, &pt, &0i128, &NO_DEADLINE);
    let pt_bps = (sr - back) * 10_000 / sr;
    assert!(back < sr, "a PT round trip must cost the trader something");
    assert!(pt_bps < 100, "PT round-trip cost blew out to {} bps", pt_bps);

    // YT is priced off the same notional, so its round trip costs a similar number of bps OF
    // NOTIONAL — which is a large fraction of the much smaller YT price. That is the correct
    // behaviour and the number a UI has to show honestly.
    let (u2, sr2) = w.user_with_sr(5_000 * USDC);
    let notional = 10_000 * USDC;
    let paid = w.m().buy_yt_exact_out(&u2, &notional, &sr2, &NO_DEADLINE);
    let got = w.m().sell_yt_exact_in(&u2, &notional, &0i128, &NO_DEADLINE);
    let of_notional = (paid - got) * 10_000 / notional;
    assert!(got < paid);
    assert!(of_notional < 100, "YT round-trip cost blew out to {} bps of notional", of_notional);
    let of_price = (paid - got) * 100 / paid;
    assert!(
        (10..=50).contains(&of_price),
        "YT round-trip cost as a share of the YT price moved: {}%", of_price
    );
}

/// An LP taking one-sided flow for a whole term takes ordinary directional loss and no more.
#[test]
fn i8_one_sided_flow_costs_an_lp_only_directional_loss() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    let (lp, shares) = w.seed_market(20_000 * USDC, 20_000 * USDC);
    let i0 = w.y().py_index();
    let (p0, s0) = w.m().reserves();
    let v0 = p0 + s0 * i0 / SCALAR_12;

    for _ in 0..8 {
        let b = w.new_user(2_000 * USDC);
        let _ = w.r().try_buy_pt_with_usdc(&b, &(2_000 * USDC), &0i128, &NO_DEADLINE);
        w.advance(5 * DAY);
    }
    let (pt_out, sr_out) = w.m().remove_liquidity(&lp, &shares, &0i128, &0i128);
    let v1 = pt_out + sr_out * w.y().py_index() / SCALAR_12;
    let bps = (v0 - v1) * 10_000 / v0;
    assert!(bps < 100, "one-sided flow cost the LP {} bps — more than directional loss", bps);
}

/// A deposit made seconds before maturity earns a near-zero coupon and still redeems cleanly.
#[test]
fn i9_a_deposit_at_the_maturity_boundary_behaves() {
    let w = setup(Cfg { term: 30 * DAY, ..Cfg::default() });
    w.seed_vault(5_000 * USDC);
    w.advance(30 * DAY - 2);
    let u = w.new_user(1_000 * USDC);
    let (payout, coupon, _) = w.v().quote(&(1_000 * USDC));
    assert!(coupon >= 0 && coupon < USDC, "a two-second coupon must be negligible: {}", coupon);
    let id = w.v().deposit(&u, &(1_000 * USDC));
    assert_eq!(w.v().get_receipt(&id).payout, payout);
    w.advance(10);
    assert_eq!(w.v().redeem(&id), payout);
}

// ---------------------------------------------------------------------------
// shared scenario builders
// ---------------------------------------------------------------------------

/// The natural operator sequence that used to reach F2: seed, two savers, one redeems, the admin
/// recovers exactly what `coupon_capacity` reports as free, and the straggler meets a crunch.
///
/// It is still the sharpest scenario in the suite — the vault is at its own stated limit with a
/// partially-redeemable receipt outstanding — so the F2 tests keep using it.
fn stuck_receipt_world() -> (World, (u64, i128)) {
    let w = setup(Cfg { term: 30 * DAY, ..Cfg::default() });
    w.seed_vault(50_000 * USDC);
    let a = w.new_user(50_000 * USDC);
    let ida = w.v().deposit(&a, &(50_000 * USDC));
    let b = w.new_user(50_000 * USDC);
    let idb = w.v().deposit(&b, &(50_000 * USDC));

    w.advance(30 * DAY + 1);
    w.v().harvest();
    w.v().redeem(&ida);

    let free_pt = w.v().stats().coupon_capacity;
    w.v().sweep(&w.admin, &free_pt);
    assert_eq!(w.v().stats().coupon_capacity, 0, "the sweep must take the vault to its own limit");
    assert_eq!(w.v().total_residue(), 0, "no partial leg has run yet");

    w.drain_venue_to_max();
    let promised = w.v().get_receipt(&idb).payout;
    (w, (idb, promised))
}
