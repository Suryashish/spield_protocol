#![cfg(test)]
//! # Invariants, and the five defects this suite found.
//!
//! Two kinds of test live here.
//!
//! * **Invariants** — properties that hold today and must keep holding. Ordinary tests.
//! * **Defect reproductions** — each confirmed finding appears twice: an `#[ignore]`d test that
//!   asserts the **correct** behaviour (run it with `cargo test -- --ignored`; it fails, and it is
//!   meant to, until the defect is fixed), and a live *characterization* test that pins what the
//!   code does **today**, so the behaviour cannot silently get worse while the fix is pending.
//!
//! When a defect is fixed, its characterization test fails — that is the signal to delete the pair
//! and replace it with the plain invariant.
//!
//! Findings are numbered to match `anyfix.md`.

extern crate std;

use crate::harness::*;

// ###########################################################################
// F1 — `Sr::max_redeemable` and `Sr::redeem_partial` run on a STALE rate
// ###########################################################################
//
// `Sr::exchange_rate()` is a pure read of the stored high-water mark, by design: making it call the
// strategy caused an intermittent footprint failure on testnet. Only mutating paths sync.
//
// `max_redeemable()` is a view, so it reads that stale rate — and then divides available underlying
// by it to get shares. A stale rate is always LOWER than the live one, so the division returns MORE
// shares than the venue can actually pay for. `redeem_partial` clamps to that number and reverts.
//
// `LIQUIDITY_HAIRCUT_BPS` (1%) is what has been hiding this: it absorbs drift up to 1%, so the
// margin documented as covering "Blend's utilization ceiling and its own rounding" is in fact being
// spent on staleness, and there is nothing left for the thing it was written for.

/// **F1 — the fix.** `redeem_partial` is the documented exit of last resort: a crunch is supposed
/// to cost the holder extra transactions, never the whole exit. It must not revert.
#[test]
#[ignore = "F1: fails today — max_redeemable sizes the clamp with the stale stored rate"]
fn f1_redeem_partial_makes_progress_even_when_the_stored_rate_is_stale() {
    let w = setup(Cfg { term: 180 * DAY, ..Cfg::default() });
    let (h, sr) = w.user_with_sr(500_000 * USDC);
    w.drain_venue_to_max();
    w.advance_unsynced(30 * DAY);

    let (burned, paid) = w.sr().redeem_partial(&h, &h, &sr, &0i128);
    assert!(burned > 0 && paid > 0, "the partial exit paid nothing");
}

/// **F1 — what happens today.** Pins both the threshold and the size of the error.
#[test]
fn f1_characterize_stale_rate_overstates_max_redeemable() {
    let w = setup(Cfg { term: 180 * DAY, ..Cfg::default() });
    let (h, sr) = w.user_with_sr(500_000 * USDC);
    w.drain_venue_to_max();
    w.advance_unsynced(30 * DAY);

    let stale_cap = w.sr().max_redeemable();
    // Syncing is the whole difference — it is the only thing that changes between these two reads.
    w.sr().sync_rate();
    let live_cap = w.sr().max_redeemable();
    assert!(
        stale_cap > live_cap,
        "the stale read must over-state the cap: stale {} live {}", stale_cap, live_cap
    );

    // And after the sync the clamp is correct, which confirms the rate is the cause and nothing else.
    let (burned, paid) = w.sr().redeem_partial(&h, &h, &sr, &0i128);
    assert!(burned > 0 && paid > 0);
    assert!(burned <= live_cap, "the clamp exceeded the live capacity");
}

/// **F1b — the fix.** The `avail >= total_assets` short circuit returns `i128::MAX`, meaning "no
/// constraint at all". Both sides of that comparison use the stale rate, so it can say a position
/// is fully withdrawable when it is not.
#[test]
#[ignore = "F1b: fails today — the unbounded short circuit is decided on the stale valuation"]
fn f1b_an_unbounded_max_redeemable_means_a_full_exit_actually_clears() {
    let w = setup(Cfg { term: 360 * DAY, ..Cfg::default() });
    let (h, sr) = w.user_with_sr(200_000 * USDC);
    w.drain_venue_to_max();
    w.advance_unsynced(300 * DAY);
    let stale_assets = w.sr().total_assets();
    let avail = w.st().available_liquidity();
    let target = stale_assets + stale_assets / 200;
    if target > avail { w.refill_venue(target - avail); }

    if w.sr().max_redeemable() == i128::MAX {
        let out = w.sr().redeem(&h, &h, &sr, &0i128);
        assert!(out > 0, "max_redeemable promised no constraint and the exit still failed");
    }
}

/// **F1b — what happens today.**
#[test]
fn f1b_characterize_unbounded_cap_while_the_exit_reverts() {
    let w = setup(Cfg { term: 360 * DAY, ..Cfg::default() });
    let (h, sr) = w.user_with_sr(200_000 * USDC);
    w.drain_venue_to_max();
    w.advance_unsynced(300 * DAY);
    let stale_assets = w.sr().total_assets();
    let avail_now = w.st().available_liquidity();
    let target = stale_assets + stale_assets / 200;
    if target > avail_now { w.refill_venue(target - avail_now); }

    let avail = w.st().available_liquidity();
    let cap = w.sr().max_redeemable();
    w.sr().sync_rate();
    let live_assets = w.sr().total_assets();
    assert!(
        avail >= stale_assets && avail < live_assets,
        "the scenario must land between the stale and live valuations: avail {} stale {} live {}",
        avail, stale_assets, live_assets
    );
    assert_eq!(cap, i128::MAX, "the short circuit fired on the stale valuation");
    assert!(
        w.sr().try_redeem(&h, &h, &sr, &0i128).is_err(),
        "if this now succeeds, F1b is fixed — delete this pair"
    );
}

// ###########################################################################
// F2 — `SrVault::redeem` erodes its rounding reserve once per PARTIAL leg
// ###########################################################################
//
// `REDEEM_DUST` is 2 stroops **per receipt**, sized for the double flooring of one closing leg
// (`payout -> SR -> USDC`). But every *partial* leg floors too: it burns `take` PT face and banks
// `got <= take` USDC, so `pt_inventory + total_collected` — the exact left-hand side of
// `assert_solvent` — falls by a stroop each time.
//
// After a `sweep` down to the contract's own stated reserve, the slack is exactly 2. Two partial
// legs spend it; the third reverts with `SolvencyViolation` (#24) and the receipt cannot be
// redeemed at all until the venue can pay the entire remainder in a single call — which is the
// all-or-nothing behaviour `tofix.md` #20 says was fixed.
//
// The admin cannot rescue it either: `seed` routes through `mint_py`, which is refused at/after
// expiry, and a stuck receipt is by definition post-maturity.

/// **F2 — the fix.** A partially-redeemed receipt must always be able to take another partial leg.
#[test]
#[ignore = "F2: fails today — the third partial leg trips assert_solvent (#24)"]
fn f2_a_partially_redeemed_receipt_can_always_take_another_leg() {
    let (w, (id, _promised)) = stuck_receipt_world();
    for leg in 0..6 {
        assert!(
            w.v().try_redeem(&id).is_ok(),
            "partial leg {} reverted — a crunch cost the holder the exit, not just time", leg
        );
        if !w.v().get_receipt(&id).open { return; }
        w.refill_venue(3_000 * USDC);
    }
}

/// **F2 — what happens today.** Exactly two partial legs are tolerated; the third reverts with
/// `SolvencyViolation`, and the receipt is left open with the holder paid nothing.
#[test]
fn f2_characterize_the_third_partial_leg_reverts() {
    let (w, (id, promised)) = stuck_receipt_world();

    let mut legs = 0u32;
    let mut failed = false;
    while w.v().get_receipt(&id).open && legs < 8 {
        if w.v().try_redeem(&id).is_err() { failed = true; break; }
        w.refill_venue(3_000 * USDC);
        legs += 1;
    }
    assert!(failed, "if no leg reverts, F2 is fixed — delete this pair");
    assert_eq!(legs, 2, "the tolerated leg count changed: {}", legs);

    let r = w.v().get_receipt(&id);
    assert!(r.open, "the receipt is left open");
    assert!(r.collected > 0 && r.collected < promised, "with progress banked but nothing paid out");
    assert_eq!(w.usdc_t().balance(&r.owner), 0, "the holder has been paid nothing");

    // It is not permanent: once the venue can pay the WHOLE remainder in one call, it closes.
    w.refill_venue(500_000 * USDC);
    w.advance(DAY);
    assert!(w.v().try_redeem(&id).is_ok(), "the receipt recovers when a single leg can finish it");
}

/// **F2 — the admin's only tool for adding PT inventory is unavailable after maturity**, which is
/// the only time a receipt can be stuck.
#[test]
fn f2_seed_is_refused_after_expiry_so_the_admin_cannot_add_capacity() {
    let w = setup(Cfg { term: 30 * DAY, ..Cfg::default() });
    w.seed_vault(1_000 * USDC);
    w.advance(30 * DAY + 1);
    let f = w.new_user(1_000 * USDC);
    assert!(
        w.v().try_seed(&f, &(1_000 * USDC)).is_err(),
        "if seed now works after expiry, F2's recovery story has changed"
    );
}

// ###########################################################################
// F3 — `deposit_headroom()` is not actionable
// ###########################################################################

/// **F3 — the fix.** `deposit_headroom()` exists so a UI can show "X of Y remaining" and offer a
/// max button. Depositing exactly that number must work.
#[test]
#[ignore = "F3: fails today — the view uses the stale rate, deposit syncs first"]
fn f3_a_deposit_of_exactly_the_advertised_headroom_succeeds() {
    let w = setup(Cfg { term: 90 * DAY, deposit_cap: 1_000 * USDC, ..Cfg::default() });
    let u = w.new_user(500 * USDC);
    w.sr().deposit(&u, &u, &(500 * USDC), &0i128);
    w.advance_unsynced(30 * DAY);

    let head = w.sr().deposit_headroom();
    let v = w.new_user(head);
    assert!(
        w.sr().try_deposit(&v, &v, &head, &0i128).is_ok(),
        "the advertised headroom of {} could not be deposited", head
    );
}

/// **F3 — what happens today**, and the size of the gap.
#[test]
fn f3_characterize_headroom_overstates_what_deposit_will_accept() {
    let w = setup(Cfg { term: 90 * DAY, deposit_cap: 1_000 * USDC, ..Cfg::default() });
    let u = w.new_user(500 * USDC);
    w.sr().deposit(&u, &u, &(500 * USDC), &0i128);
    w.advance_unsynced(30 * DAY);

    let head = w.sr().deposit_headroom();
    let v = w.new_user(head);
    assert!(
        w.sr().try_deposit(&v, &v, &head, &0i128).is_err(),
        "if this now succeeds, F3 is fixed — delete this pair"
    );
    // Syncing first is the workaround, and it is what proves the cause.
    w.sr().sync_rate();
    let synced = w.sr().deposit_headroom();
    assert!(synced < head, "the synced headroom must be smaller: {} vs {}", synced, head);
    assert!(w.sr().deposit(&v, &v, &synced, &0i128) > 0, "the synced headroom is depositable");
}

// ###########################################################################
// F4 — the deposit cap counts accrued yield as new exposure
// ###########################################################################

/// **F4 — the fix.** `Sr::deposit`'s own comment: *"Growth from yield is deliberately NOT counted
/// as new exposure: it is the users' own return, and letting it consume headroom would slowly close
/// deposits on a healthy protocol."* The code measures `total_supply x live_rate`, which is exactly
/// that growth, so headroom shrinks on a protocol where nothing has happened but time.
#[test]
#[ignore = "F4: fails today — the code does the opposite of the comment above it"]
fn f4_headroom_does_not_shrink_just_because_yield_accrued() {
    let w = setup(Cfg { term: 90 * DAY, deposit_cap: 1_000 * USDC, ..Cfg::default() });
    let u = w.new_user(900 * USDC);
    w.sr().deposit(&u, &u, &(900 * USDC), &0i128);
    let head0 = w.sr().deposit_headroom();
    w.advance(90 * DAY);
    let head1 = w.sr().deposit_headroom();
    assert_eq!(head1, head0, "yield alone closed {} of headroom", head0 - head1);
}

/// **F4 — what happens today**, with the magnitude pinned.
#[test]
fn f4_characterize_yield_consumes_headroom() {
    let w = setup(Cfg { term: 90 * DAY, deposit_cap: 1_000 * USDC, ..Cfg::default() });
    let u = w.new_user(900 * USDC);
    w.sr().deposit(&u, &u, &(900 * USDC), &0i128);
    let head0 = w.sr().deposit_headroom();
    w.advance(90 * DAY);
    let head1 = w.sr().deposit_headroom();
    assert!(head1 < head0, "if headroom no longer shrinks, F4 is fixed — delete this pair");
    // ~0.66% of TVL over 90 days at this fixture's Blend rate. Pinned as a band, not a constant,
    // so an ordinary rate change does not fail the test but a change of *mechanism* does.
    let eaten = head0 - head1;
    let tvl = 900 * USDC;
    let bps = eaten * 10_000 / tvl;
    assert!(
        (40..=120).contains(&bps),
        "the amount of headroom eaten by yield moved: {} bps of TVL over 90 days", bps
    );
}

// ###########################################################################
// F5 — post-expiry yield goes to YT until somebody stamps the index
// ###########################################################################
//
// `Yield`'s module docs: *"The index freezes at the first post-expiry observation, so a matured YT
// earns nothing more."* The freeze happens on the first post-expiry *touch*, not at expiry, and
// `stamp_expiry_index` is permissionless with nothing to make anyone call it. So a matured YT keeps
// earning for however long the contract is left alone, and the size of a YT holder's payout is
// decided by who happens to touch the contract first.

/// **F5 — the fix.** A YT holder's claim must be the same whether the index is stamped at expiry or
/// six months later.
#[test]
#[ignore = "F5: fails today — the claim scales with how late the index is stamped"]
fn f5_a_matured_yt_earns_the_same_however_late_the_index_is_stamped() {
    let prompt = yt_claim_when_stamped_after(0);
    let late = yt_claim_when_stamped_after(180);
    assert_eq!(prompt, late, "stamping 180 days late paid {} instead of {}", late, prompt);
}

/// **F5 — what happens today**, with the multiple pinned.
#[test]
fn f5_characterize_a_late_stamp_multiplies_the_yt_claim() {
    let prompt = yt_claim_when_stamped_after(0);
    let d30 = yt_claim_when_stamped_after(30);
    let d180 = yt_claim_when_stamped_after(180);
    assert!(prompt > 0 && d30 > prompt && d180 > d30,
        "if these are now equal, F5 is fixed — delete this pair: {} {} {}", prompt, d30, d180);
    // Roughly 2x at +30 days and 7x at +180 on a 30-day series.
    assert!(d30 * 10 / prompt >= 15, "the +30d multiple shrank: {}x", d30 as f64 / prompt as f64);
    assert!(d180 / prompt >= 5, "the +180d multiple shrank: {}x", d180 / prompt);
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

/// The natural operator sequence that reaches F2: seed, two savers, one redeems, the admin
/// recovers exactly what `coupon_capacity` reports as free, and the straggler meets a crunch.
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

    w.drain_venue_to_max();
    let promised = w.v().get_receipt(&idb).payout;
    (w, (idb, promised))
}
