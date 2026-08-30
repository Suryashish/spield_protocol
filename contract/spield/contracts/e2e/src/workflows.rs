#![cfg(test)]
//! # The workflows a real deployment actually sees.
//!
//! Each test here is one **user journey end to end**, not one function call. The stack is the real
//! one — Blend v2 WASM underneath, no mocks except authorization — and the vault and the AMM share
//! a single series, which is the configuration `deploy_mainnet.sh` produces.

extern crate std;

use crate::harness::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::Address;

// ===========================================================================
// W1. THE FIXED-RATE SAVER
// ===========================================================================

/// Seed -> deposit -> wait -> harvest -> redeem. The promise must be paid to the stroop, and the
/// vault must still be solvent afterwards.
#[test]
fn w1_a_saver_locks_a_rate_and_is_paid_exactly_what_was_promised() {
    let w = setup(Cfg { term: 30 * DAY, ..Cfg::default() });
    w.seed_vault(2_000 * USDC);

    let saver = w.new_user(1_000 * USDC);
    let (quoted_payout, quoted_coupon, quoted_rate) = w.v().quote(&(1_000 * USDC));
    assert_eq!(quoted_rate, VAULT_RATE_BPS);
    assert!(quoted_coupon > 0, "a 30-day 3% coupon on 1000 USDC must be positive");

    let id = w.v().deposit(&saver, &(1_000 * USDC));
    let r = w.v().get_receipt(&id);
    assert_eq!(r.payout, quoted_payout, "quote and receipt must agree exactly");
    assert_eq!(r.principal, 1_000 * USDC);
    assert_eq!(w.usdc_t().balance(&saver), 0);

    // A keeper harvests part-way through; it must never reduce what is owed.
    w.advance(15 * DAY);
    let (claimed, minted) = w.v().harvest();
    assert!(claimed >= 0 && minted >= 0);
    let liab_after_harvest = w.v().stats().total_liability;
    assert_eq!(liab_after_harvest, r.payout, "harvest must not touch liabilities");

    w.advance(15 * DAY + 1);
    let paid = w.v().redeem(&id);
    assert_eq!(paid, r.payout, "paid exactly the promise");
    assert_eq!(w.usdc_t().balance(&saver), r.payout);
    assert!(!w.v().get_receipt(&id).open);

    let s = w.v().stats();
    assert_eq!(s.total_liability, 0);
    assert_eq!(s.open_receipts, 0);
    assert!(s.pt_inventory >= 0);
}

/// Several savers, deposited at different times, all paid in full and in any order.
#[test]
fn w1b_many_savers_at_different_times_are_all_paid_in_full_in_any_order() {
    let w = setup(Cfg { term: 60 * DAY, ..Cfg::default() });
    w.seed_vault(5_000 * USDC);

    let mut ids = std::vec::Vec::new();
    let mut users = std::vec::Vec::new();
    let mut payouts = std::vec::Vec::new();
    for k in 0..4 {
        let u = w.new_user(500 * USDC);
        let id = w.v().deposit(&u, &(500 * USDC));
        payouts.push(w.v().get_receipt(&id).payout);
        ids.push(id);
        users.push(u);
        w.advance(5 * DAY);
        let _ = k;
    }

    // Later deposits get a smaller coupon: less time left to run.
    assert!(payouts[0] > payouts[3], "coupon must shrink with the remaining term: {:?}", payouts);

    w.advance(60 * DAY);
    // Redeem in reverse order — nothing may depend on the order receipts were created in.
    for i in (0..4).rev() {
        let paid = w.v().redeem(&ids[i]);
        assert_eq!(paid, payouts[i], "receipt {} short-paid", i);
        assert_eq!(w.usdc_t().balance(&users[i]), payouts[i]);
    }
    assert_eq!(w.v().stats().total_liability, 0);
    assert_eq!(w.v().stats().open_receipts, 0);
}

/// The capacity gate is the vault's whole solvency argument: it must refuse the deposit it cannot
/// fund, not accept it and short-pay later.
#[test]
fn w1c_the_vault_refuses_the_deposit_it_cannot_fund() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    // Seed just enough for a small coupon.
    w.seed_vault(1 * USDC);

    let whale = w.new_user(1_000_000 * USDC);
    // 1,000,000 USDC at 3% for 90 days owes ~7,397 USDC of coupon; capacity is ~1 USDC.
    let res = w.v().try_deposit(&whale, &(1_000_000 * USDC));
    assert!(res.is_err(), "an unfundable promise must be refused, not made");

    // And a deposit that fits is still accepted.
    let small = w.new_user(100 * USDC);
    let id = w.v().deposit(&small, &(100 * USDC));
    assert!(w.v().get_receipt(&id).payout > 100 * USDC);
}

// ===========================================================================
// W2. THE PT BUYER — fixed yield through the market
// ===========================================================================

/// USDC in, PT out, hold to expiry, redeem at face. The whole point of PT is that this is
/// profitable and knowable in advance.
#[test]
fn w2_a_pt_buyer_earns_the_discount_and_redeems_at_face_after_expiry() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    w.seed_market(50_000 * USDC, 50_000 * USDC);

    let buyer = w.new_user(1_000 * USDC);
    let quoted = w.r().quote_buy_pt_with_usdc(&(1_000 * USDC));
    let pt = w.r().buy_pt_with_usdc(&buyer, &(1_000 * USDC), &0i128, &NO_DEADLINE);
    assert!(pt > 1_000 * USDC, "PT must be bought below face: {}", pt);
    assert!(pt >= quoted, "execution under quote: {} < {}", pt, quoted);
    w.assert_router_empty("buy_pt_with_usdc");

    // The market refuses to trade past expiry — the engine is the exit from there.
    w.advance(90 * DAY + 1);
    assert!(
        w.m().try_swap_exact_pt_for_sr(&buyer, &pt, &0i128, &NO_DEADLINE).is_err(),
        "the AMM must be closed after expiry"
    );

    let usdc_out = w.r().redeem_py_for_usdc(&buyer, &pt, &0i128);
    w.assert_router_empty("redeem_py_for_usdc");
    assert!(
        usdc_out > 1_000 * USDC,
        "the PT buyer must end up ahead: put in {} got {}", 1_000 * USDC, usdc_out
    );
    // Face value, within the two floors of the SR round trip.
    assert!((pt - usdc_out).abs() <= 2, "post-expiry PT must redeem at face: {} vs {}", pt, usdc_out);
    assert_eq!(w.pt().balance(&buyer), 0);
}

/// Before expiry, `redeem_py` is a *recombine* — it needs both legs. A holder with PT alone must
/// be told that clearly rather than silently getting a worse deal.
#[test]
fn w2b_before_expiry_redeeming_principal_requires_both_legs() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    w.seed_market(50_000 * USDC, 50_000 * USDC);
    let buyer = w.new_user(1_000 * USDC);
    let pt = w.r().buy_pt_with_usdc(&buyer, &(1_000 * USDC), &0i128, &NO_DEADLINE);

    // PT but no YT: the burn of the YT leg must fail.
    assert_eq!(w.y().balance(&buyer), 0);
    assert!(
        w.r().try_redeem_py_for_usdc(&buyer, &pt, &0i128).is_err(),
        "a pre-expiry recombine without YT must revert"
    );

    // With both legs it works and is priced at face — no curve, no spread.
    let (holder, sr) = w.user_with_sr(500 * USDC);
    let face = w.y().mint_py(&holder, &holder, &sr);
    let quoted = w.r().quote_redeem_py_for_usdc(&face);
    let got = w.r().redeem_py_for_usdc(&holder, &face, &0i128);
    assert!((got - quoted).abs() <= 2, "quote {} vs execution {}", quoted, got);
    assert!((got - 500 * USDC).abs() <= 3, "recombine must return the principal: {}", got);
}

// ===========================================================================
// W3. THE YT BUYER — leveraged yield
// ===========================================================================

/// Buy YT, let it accrue, claim to USDC, sell the rest. Yield already earned must survive the
/// sale — that is the entire reason YT is a hook-bearing contract rather than a SAC.
#[test]
fn w3_a_yt_buyer_accrues_claims_and_sells_without_losing_earned_yield() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    w.seed_market(50_000 * USDC, 50_000 * USDC);

    let (buyer, sr_bal) = w.user_with_sr(1_000 * USDC);
    let yt_out = 5_000 * USDC;
    let cost = w.m().buy_yt_exact_out(&buyer, &yt_out, &sr_bal, &NO_DEADLINE);
    assert!(cost > 0 && cost <= sr_bal);
    assert_eq!(w.y().balance(&buyer), yt_out);

    w.advance(45 * DAY);
    let claimable = w.y().claimable_interest(&buyer);
    assert!(claimable > 0, "45 days of YT must have accrued something");

    // Sell HALF the position. The hook settles the seller first, so the other half's earned
    // yield must still be there afterwards.
    let half = yt_out / 2;
    let _ = w.m().sell_yt_exact_in(&buyer, &half, &0i128, &NO_DEADLINE);
    assert_eq!(w.y().balance(&buyer), yt_out - half);

    let after_sale = w.y().claimable_interest(&buyer);
    assert!(
        after_sale >= claimable,
        "selling YT erased earned yield: {} before, {} after", claimable, after_sale
    );

    let (net, fee) = w.y().redeem_due_interest(&buyer);
    assert!(net > 0, "the claim must pay");
    assert!(fee >= 0);
    assert_eq!(w.y().claimable_interest(&buyer), 0, "claim must zero the balance");
}

/// A YT holder who never trades and never claims must still be able to collect everything they
/// earned before expiry, at any point afterwards.
#[test]
fn w3b_pre_expiry_yt_yield_stays_claimable_forever_after_maturity() {
    let w = setup(Cfg { term: 30 * DAY, ..Cfg::default() });
    let (holder, sr) = w.user_with_sr(2_000 * USDC);
    w.y().mint_py(&holder, &holder, &sr);

    w.advance(30 * DAY);
    let at_expiry = w.y().claimable_interest(&holder);
    assert!(at_expiry > 0);

    // Long after maturity, with the index frozen.
    w.advance(200 * DAY);
    w.y().stamp_expiry_index();
    let (net, _fee) = w.y().redeem_due_interest(&holder);
    assert!(net > 0, "yield earned before expiry became unclaimable after it");
}

// ===========================================================================
// W4. THE LIQUIDITY PROVIDER
// ===========================================================================

/// Provide, get traded against, withdraw. The LP must come out with at least the value they put
/// in, denominated in asset units at the prevailing index.
#[test]
fn w4_an_lp_survives_a_full_term_of_two_sided_flow_and_exits_whole() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    let (lp, shares) = w.seed_market(20_000 * USDC, 20_000 * USDC);

    let index0 = w.y().py_index();
    let (pt0, sr0) = w.m().reserves();
    let value_in = pt0 + sr0 * index0 / SCALAR_12;

    // Two-sided flow: buyers and sellers alternate, so the pool is not simply run over.
    for _ in 0..6 {
        let b = w.new_user(500 * USDC);
        w.r().buy_pt_with_usdc(&b, &(500 * USDC), &0i128, &NO_DEADLINE);
        w.advance(5 * DAY);

        let (s, sr) = w.user_with_sr(400 * USDC);
        let face = w.y().mint_py(&s, &s, &sr);
        w.m().swap_exact_pt_for_sr(&s, &face, &0i128, &NO_DEADLINE);
        w.advance(5 * DAY);
    }

    let (pt_out, sr_out) = w.m().remove_liquidity(&lp, &shares, &0i128, &0i128);
    let index1 = w.y().py_index();
    let value_out = pt_out + sr_out * index1 / SCALAR_12;
    assert!(
        value_out >= value_in,
        "LP lost asset-denominated value across a fee-earning term: in {} out {}", value_in, value_out
    );
    assert_eq!(w.m().total_shares(), 0, "the only LP exited fully");
    let (pt_res, sr_res) = w.m().reserves();
    assert_eq!((pt_res, sr_res), (0, 0), "reserves must be exactly drained");
}

/// A second LP joining a pool that has already traded must be priced fairly — neither diluting the
/// incumbent nor being diluted.
#[test]
fn w4b_a_late_lp_joining_a_traded_pool_is_priced_fairly() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    let (lp1, s1) = w.seed_market(20_000 * USDC, 20_000 * USDC);

    let t = w.new_user(3_000 * USDC);
    w.r().buy_pt_with_usdc(&t, &(3_000 * USDC), &0i128, &NO_DEADLINE);
    w.advance(10 * DAY);

    // LP2 adds at the pool's current ratio.
    let (pt_res, sr_res) = w.m().reserves();
    let total = w.m().total_shares();
    let (lp2, sr_all) = w.user_with_sr(10_000 * USDC);
    // Match the ratio: give SR proportional to the PT we are about to mint.
    let pt_in = 2_000 * USDC;
    let sr_in = pt_in * sr_res / pt_res;
    let sr_for_pt = w.sr().preview_deposit(&pt_in);
    assert!(sr_all > sr_for_pt + sr_in, "test needs enough SR to fund both legs");
    let face = w.y().mint_py(&lp2, &lp2, &sr_for_pt);
    let s2 = w.m().add_liquidity(&lp2, &face, &sr_in, &0i128);

    assert!(s2 > 0);
    let expected = face * total / pt_res;
    assert!(
        (s2 - expected).abs() <= expected / 1000 + 1,
        "late LP mis-priced: got {} expected ~{}", s2, expected
    );

    // Both exit; neither can take more than their share.
    let (a_pt, a_sr) = w.m().remove_liquidity(&lp2, &s2, &0i128, &0i128);
    let (b_pt, b_sr) = w.m().remove_liquidity(&lp1, &s1, &0i128, &0i128);
    assert!(a_pt > 0 && a_sr > 0 && b_pt > 0 && b_sr > 0);
    assert_eq!(w.m().total_shares(), 0);
}

// ===========================================================================
// W5. THE VAULT AND THE MARKET SHARING ONE SERIES
// ===========================================================================

/// The deployment ships both products on one engine. Heavy AMM flow must not be able to make a
/// vault receipt unpayable, and vice versa.
#[test]
fn w5_amm_flow_and_vault_promises_do_not_interfere() {
    let w = setup(Cfg { term: 60 * DAY, ..Cfg::default() });
    w.seed_vault(3_000 * USDC);
    w.seed_market(30_000 * USDC, 30_000 * USDC);

    let saver = w.new_user(1_000 * USDC);
    let id = w.v().deposit(&saver, &(1_000 * USDC));
    let promised = w.v().get_receipt(&id).payout;

    // Hammer the AMM in both directions for the whole term.
    for _ in 0..8 {
        let b = w.new_user(800 * USDC);
        w.r().buy_pt_with_usdc(&b, &(800 * USDC), &0i128, &NO_DEADLINE);
        let (s, sr) = w.user_with_sr(600 * USDC);
        let f = w.y().mint_py(&s, &s, &sr);
        w.m().swap_exact_pt_for_sr(&s, &f, &0i128, &NO_DEADLINE);
        let (yb, ysr) = w.user_with_sr(300 * USDC);
        let _ = w.m().try_buy_yt_exact_out(&yb, &(1_500 * USDC), &ysr, &NO_DEADLINE);
        w.advance(7 * DAY);
    }

    w.advance(10 * DAY);
    let paid = w.v().redeem(&id);
    assert_eq!(paid, promised, "AMM flow moved a vault payout");
    assert_eq!(w.usdc_t().balance(&saver), promised);
}

// ===========================================================================
// W6. EXPIRY BOUNDARY
// ===========================================================================

/// Every entry closes at expiry and every exit stays open. This is the property that decides
/// whether a series winds down cleanly or strands people.
#[test]
fn w6_at_expiry_entries_close_and_every_exit_stays_open() {
    let w = setup(Cfg { term: 30 * DAY, ..Cfg::default() });
    w.seed_vault(2_000 * USDC);
    let (lp, shares) = w.seed_market(10_000 * USDC, 10_000 * USDC);

    let saver = w.new_user(500 * USDC);
    let vid = w.v().deposit(&saver, &(500 * USDC));
    let (holder, sr) = w.user_with_sr(1_000 * USDC);
    let face = w.y().mint_py(&holder, &holder, &sr);

    w.advance(30 * DAY + 1);

    // Entries: all closed.
    let late = w.new_user(100 * USDC);
    assert!(w.v().try_deposit(&late, &(100 * USDC)).is_err(), "vault deposit after maturity");
    let (m, msr) = w.user_with_sr(100 * USDC);
    assert!(w.y().try_mint_py(&m, &m, &msr).is_err(), "mint_py after expiry");
    assert!(w.m().try_swap_exact_sr_for_pt(&m, &msr, &0i128, &NO_DEADLINE).is_err(), "swap after expiry");
    assert!(w.m().try_buy_yt_exact_out(&m, &(10 * USDC), &msr, &NO_DEADLINE).is_err(), "buy YT after expiry");

    // Exits: all open.
    assert_eq!(w.v().redeem(&vid), w.v().get_receipt(&vid).payout);
    let (pt_out, sr_out) = w.m().remove_liquidity(&lp, &shares, &0i128, &0i128);
    assert!(pt_out > 0 && sr_out > 0, "LP exit after expiry");
    let got = w.r().redeem_py_for_usdc(&holder, &face, &0i128);
    assert!(got > 0, "PT holder exit after expiry");
    // And the LP can settle the PT they just took out, PT-only.
    let lp_out = w.y().redeem_py(&lp, &lp, &pt_out);
    assert!(lp_out > 0);
}

/// `redeem_py` after expiry must burn PT **only** — a PT holder who sold their YT must not be
/// stranded.
#[test]
fn w6b_after_expiry_a_pt_holder_who_sold_their_yt_can_still_redeem() {
    let w = setup(Cfg { term: 30 * DAY, ..Cfg::default() });
    w.seed_market(20_000 * USDC, 20_000 * USDC);

    let (holder, sr) = w.user_with_sr(1_000 * USDC);
    let face = w.y().mint_py(&holder, &holder, &sr);
    // Sell the whole YT leg into the market.
    w.m().sell_yt_exact_in(&holder, &face, &0i128, &NO_DEADLINE);
    assert_eq!(w.y().balance(&holder), 0);

    w.advance(30 * DAY + 1);
    let out = w.y().redeem_py(&holder, &holder, &face);
    assert!(out > 0, "PT-only redemption after expiry must work with no YT held");
    assert_eq!(w.pt().balance(&holder), 0);
}

// ===========================================================================
// W7. THE LIQUIDITY CRUNCH — real Blend utilization, not a mock
// ===========================================================================

/// When borrowers have taken the pool's cash, exits must degrade into partial fills that keep
/// progress, not into bare reverts that lose it.
#[test]
fn w7_a_crunch_turns_a_full_exit_into_partial_progress_not_a_revert() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    // A position that is large relative to the pool — Blend leaves ~5% of supply on hand, so only
    // a big holder actually meets the ceiling.
    let (holder, sr) = w.user_with_sr(500_000 * USDC);

    let free = w.drain_venue_to_max();
    let position = w.sr().preview_redeem(&sr);
    assert!(free < position, "the crunch must bind: {} free vs {} owed", free, position);

    let cap = w.sr().max_redeemable();
    assert!(cap > 0 && cap < sr, "max_redeemable must report the crunch: cap {} of {}", cap, sr);

    // The all-or-nothing path fails...
    assert!(w.sr().try_redeem(&holder, &holder, &sr, &0i128).is_err());
    // ...and the partial path pays what it can and keeps the rest of the position.
    let (burned, paid) = w.sr().redeem_partial(&holder, &holder, &sr, &0i128);
    assert!(burned > 0 && paid > 0, "partial exit paid nothing");
    assert!(burned < sr, "partial exit must leave the remainder intact");
    assert_eq!(w.sr().balance(&holder), sr - burned);
    assert_eq!(w.usdc_t().balance(&holder), paid);

    // When liquidity returns, the remainder comes out.
    w.refill_venue(600_000 * USDC);
    w.advance(DAY);
    let rest = w.sr().balance(&holder);
    let out = w.sr().redeem(&holder, &holder, &rest, &0i128);
    assert!(out > 0);
    assert_eq!(w.sr().balance(&holder), 0);
    assert!(
        w.usdc_t().balance(&holder) >= 500_000 * USDC,
        "a crunch must cost time, never principal: {}", w.usdc_t().balance(&holder)
    );
}

/// `max_redeemable` is what a UI shows before the user signs. It must not promise more than the
/// venue will actually pay.
#[test]
fn w7b_max_redeemable_never_over_promises() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    let (holder, sr) = w.user_with_sr(500_000 * USDC);
    w.drain_venue_to_max();

    let cap = w.sr().max_redeemable();
    assert!(cap > 0 && cap < sr);
    // Exactly the advertised amount must clear in one call. If this reverts, the number the UI
    // shows is a lie and the user loses a transaction to find out.
    let out = w.sr().redeem(&holder, &holder, &cap, &0i128);
    assert!(out > 0);
}

/// The vault's own redemption must survive the same crunch: partial, retryable, and eventually
/// paying the exact promise.
#[test]
fn w7c_a_vault_receipt_survives_a_crunch_and_still_pays_the_exact_promise() {
    let w = setup(Cfg { term: 30 * DAY, ..Cfg::default() });
    w.seed_vault(100_000 * USDC);
    let saver = w.new_user(300_000 * USDC);
    let id = w.v().deposit(&saver, &(300_000 * USDC));
    let promised = w.v().get_receipt(&id).payout;

    w.advance(30 * DAY + 1);
    let free = w.drain_venue_to_max();
    assert!(free < promised, "the crunch must bind: {} free vs {} owed", free, promised);

    let first = w.v().redeem(&id);
    assert!(first > 0, "a crunched redeem must make progress, not revert");
    assert!(w.v().get_receipt(&id).open, "this payout cannot clear in one call at this liquidity");
    assert!(w.v().get_receipt(&id).collected > 0, "a partial redemption must record progress");
    assert_eq!(w.usdc_t().balance(&saver), 0, "a partial leg pays the holder nothing yet");

    let mut calls = 1;
    while w.v().get_receipt(&id).open && calls < 20 {
        w.refill_venue(100_000 * USDC);
        w.v().redeem(&id);
        calls += 1;
    }
    assert!(!w.v().get_receipt(&id).open, "the receipt never closed in {} calls", calls);
    assert_eq!(w.usdc_t().balance(&saver), promised, "the promise was not paid in full");
    assert_eq!(w.v().stats().total_liability, 0);
    assert_eq!(w.v().stats().total_collected, 0, "banked cash must be released with the receipt");
}

// ===========================================================================
// W8. OPERATOR WORKFLOWS
// ===========================================================================

/// The guarded-launch story from `left.md` §C, executed exactly as written: cap = seed + user
/// allowance, and the operator's own seeding consumes the cap.
#[test]
fn w8_the_deposit_cap_is_a_global_tvl_ceiling_that_the_operators_own_seed_consumes() {
    let cap = 50 * USDC;
    let w = setup(Cfg { term: 30 * DAY, deposit_cap: cap, ..Cfg::default() });
    assert_eq!(w.sr().deposit_cap(), cap);
    assert_eq!(w.sr().deposit_headroom(), cap);

    // Operator seeds the vault with 20 — straight out of the same cap.
    w.seed_vault(20 * USDC);
    let head_after_vault = w.sr().deposit_headroom();
    assert!(
        (head_after_vault - 30 * USDC).abs() <= 2,
        "vault seeding must consume the cap: headroom {}", head_after_vault
    );

    // Operator seeds the AMM with 20 more.
    w.seed_market(10 * USDC, 10 * USDC);
    let head_after_amm = w.sr().deposit_headroom();
    assert!(
        head_after_amm < 12 * USDC && head_after_amm > 8 * USDC,
        "AMM seeding must consume the cap too: headroom {}", head_after_amm
    );

    // A user can take the headroom and not a stroop more.
    let u = w.new_user(head_after_amm + 5 * USDC);
    assert!(
        w.sr().try_deposit(&u, &u, &(head_after_amm + 5 * USDC), &0i128).is_err(),
        "a deposit over the headroom must be refused"
    );
    let got = w.sr().deposit(&u, &u, &head_after_amm, &0i128);
    assert!(got > 0);

    // LPs are capped transitively, which is the claim in left.md §C.
    let lp = w.new_user(10 * USDC);
    assert!(
        w.sr().try_deposit(&lp, &lp, &(10 * USDC), &0i128).is_err(),
        "there is no uncapped way to bring new USDC in"
    );
}

/// The cap gates deposits only. Setting it below current TVL must never trap anyone.
#[test]
fn w8b_lowering_the_cap_below_tvl_blocks_deposits_and_traps_nobody() {
    let w = setup(Cfg { term: 30 * DAY, ..Cfg::default() });
    let (u, sr) = w.user_with_sr(1_000 * USDC);

    w.sr().set_deposit_cap(&(5 * USDC));
    assert_eq!(w.sr().deposit_headroom(), 0);
    let v = w.new_user(1 * USDC);
    assert!(w.sr().try_deposit(&v, &v, &(1 * USDC), &0i128).is_err());

    // Exits are untouched.
    let out = w.sr().redeem(&u, &u, &sr, &0i128);
    assert!(out > 0);
    assert_eq!(w.sr().balance(&u), 0);
}

/// Pausing must remove entries everywhere while leaving every exit open. An operator has to be
/// able to flip this on suspicion, and that is only safe if it cannot trap funds.
#[test]
fn w8c_pausing_the_whole_stack_stops_entries_and_traps_nothing() {
    let w = setup(Cfg { term: 30 * DAY, ..Cfg::default() });
    w.seed_vault(2_000 * USDC);
    let (lp, shares) = w.seed_market(10_000 * USDC, 10_000 * USDC);
    let saver = w.new_user(500 * USDC);
    let vid = w.v().deposit(&saver, &(500 * USDC));
    let (holder, sr) = w.user_with_sr(1_000 * USDC);
    let face = w.y().mint_py(&holder, &holder, &sr);

    w.sr().pause();
    w.y().pause();
    w.m().pause();
    w.v().pause();
    w.r().pause();

    // Entries closed.
    let n = w.new_user(100 * USDC);
    assert!(w.sr().try_deposit(&n, &n, &(100 * USDC), &0i128).is_err(), "SR deposit while paused");
    assert!(w.v().try_deposit(&n, &(100 * USDC)).is_err(), "vault deposit while paused");
    assert!(w.r().try_buy_pt_with_usdc(&n, &(100 * USDC), &0i128, &NO_DEADLINE).is_err(), "router while paused");
    assert!(w.m().try_swap_exact_pt_for_sr(&holder, &face, &0i128, &NO_DEADLINE).is_err(), "swap while paused");

    // Exits open.
    let (pt_out, sr_out) = w.m().remove_liquidity(&lp, &shares, &0i128, &0i128);
    assert!(pt_out > 0 && sr_out > 0, "LP trapped by a pause");
    let recombined = w.y().redeem_py(&holder, &holder, &face);
    assert!(recombined > 0, "PT/YT holder trapped by a pause");
    let out = w.sr().redeem(&holder, &holder, &recombined, &0i128);
    assert!(out > 0, "SR holder trapped by a pause");

    w.advance(30 * DAY + 1);
    assert_eq!(w.v().redeem(&vid), w.v().get_receipt(&vid).payout, "vault receipt trapped by a pause");
}

/// Admin rotation is two-step everywhere, so a typo cannot lock a contract out of administration.
#[test]
fn w8d_admin_rotation_is_two_step_on_every_contract() {
    let w = std_world();
    let next = Address::generate(&w.env);

    w.sr().propose_admin(&next);
    w.y().propose_admin(&next);
    w.m().propose_admin(&next);
    w.v().propose_admin(&next);
    w.r().propose_admin(&next);
    w.st().propose_admin(&next);

    // Nothing has changed yet.
    assert_ne!(w.sr().admin(), next);
    assert_ne!(w.y().admin(), next);
    assert_ne!(w.m().admin(), next);
    assert_ne!(w.v().admin(), next);
    assert_ne!(w.r().admin(), next);
    assert_ne!(w.st().admin(), next);

    w.sr().accept_admin();
    w.y().accept_admin();
    w.m().accept_admin();
    w.v().accept_admin();
    w.r().accept_admin();
    w.st().accept_admin();

    assert_eq!(w.sr().admin(), next);
    assert_eq!(w.y().admin(), next);
    assert_eq!(w.m().admin(), next);
    assert_eq!(w.v().admin(), next);
    assert_eq!(w.r().admin(), next);
    assert_eq!(w.st().admin(), next);
}

/// The vault's forward-only rate: a change applies to new deposits, never to receipts already
/// written.
#[test]
fn w8e_a_rate_change_is_forward_only() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    w.seed_vault(5_000 * USDC);

    let a = w.new_user(1_000 * USDC);
    let ida = w.v().deposit(&a, &(1_000 * USDC));
    let pay_a = w.v().get_receipt(&ida).payout;
    assert_eq!(w.v().get_receipt(&ida).rate_bps, VAULT_RATE_BPS);

    w.v().set_rate(&600u32);
    let b = w.new_user(1_000 * USDC);
    let idb = w.v().deposit(&b, &(1_000 * USDC));
    assert_eq!(w.v().get_receipt(&idb).rate_bps, 600);
    assert!(w.v().get_receipt(&idb).payout > pay_a, "the new rate must pay more");
    assert_eq!(w.v().get_receipt(&ida).payout, pay_a, "an existing receipt must not move");

    // And the on-chain ceiling holds even against the admin.
    assert!(w.v().try_set_rate(&(VAULT_MAX_RATE_BPS + 1)).is_err(), "max_rate_bps must bind the admin");
}
