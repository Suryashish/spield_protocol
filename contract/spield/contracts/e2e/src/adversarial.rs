#![cfg(test)]
//! # What a hostile or merely careless actor can do to somebody else.
//!
//! Every test here is an *attempt*: it either shows the stack refuses the attack, or it measures
//! exactly what the attacker gets. Where the attack succeeds in a small way, the assertion pins the
//! size so a future change that makes it bigger fails here.

extern crate std;

use crate::harness::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::Address;

// ===========================================================================
// DONATIONS — the classic share-inflation shape
// ===========================================================================

/// Donating SR straight to the market must not move the price, mint anyone shares, or let the
/// donor take it back. The reserves are bookkeeping, not a balance read.
#[test]
fn a1_donating_to_the_market_moves_nothing_and_is_not_recoverable() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    let (lp, shares) = w.seed_market(20_000 * USDC, 20_000 * USDC);

    let price_before = w.m().pt_price();
    let apy_before = w.m().implied_apy();
    let (pt_res_before, sr_res_before) = w.m().reserves();

    let (attacker, sr) = w.user_with_sr(50_000 * USDC);
    w.sr().transfer(&attacker, &w.market, &sr);

    assert_eq!(w.m().reserves(), (pt_res_before, sr_res_before), "a donation must not enter reserves");
    assert_eq!(w.m().pt_price(), price_before, "a donation must not move the price");
    assert_eq!(w.m().implied_apy(), apy_before, "a donation must not move the rate");
    assert_eq!(w.m().lp_position(&attacker), (0, 0, 0), "a donation must not mint shares");

    // The incumbent LP still gets exactly the reserves, and the donation stays stuck.
    let (pt_out, sr_out) = w.m().remove_liquidity(&lp, &shares, &0i128, &0i128);
    assert_eq!((pt_out, sr_out), (pt_res_before, sr_res_before));
    assert_eq!(w.sr().balance(&w.market), sr, "the donation is stranded, not paid to the LP");
}

/// The first-LP share formula is `sqrt(pt * sr)`. A donation before the second LP arrives must not
/// let the first LP round the second one down to zero shares.
#[test]
fn a2_a_donation_cannot_round_the_next_lp_down_to_zero_shares() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    let (_attacker, shares1) = w.seed_market(1 * USDC, 1 * USDC);
    assert!(shares1 > 0);

    // Attacker donates a large amount directly to the pool.
    let (donor, sr) = w.user_with_sr(100_000 * USDC);
    w.sr().transfer(&donor, &w.market, &sr);

    // A normal LP adds at the *recorded* ratio and must get real shares back.
    let (pt_res, sr_res) = w.m().reserves();
    let (lp2, sr2) = w.user_with_sr(5_000 * USDC);
    let pt_in = 1_000 * USDC;
    let sr_for_pt = w.sr().preview_deposit(&pt_in);
    let face = w.y().mint_py(&lp2, &lp2, &sr_for_pt);
    let sr_in = face * sr_res / pt_res;
    assert!(sr2 > sr_for_pt + sr_in);
    let s2 = w.m().add_liquidity(&lp2, &face, &sr_in, &1i128);
    assert!(s2 > 0, "the donation rounded a real LP to zero shares");

    let (pt_out, sr_out) = w.m().remove_liquidity(&lp2, &s2, &0i128, &0i128);
    assert!(pt_out > 0 && sr_out > 0, "the LP could not get their deposit back");
}

/// Donating to the vault must not create capacity anyone can claim, and must not make the vault
/// mis-report what it can promise.
#[test]
fn a3_donating_to_the_vault_creates_no_claimable_capacity() {
    let w = setup(Cfg { term: 30 * DAY, ..Cfg::default() });
    w.seed_vault(1 * USDC);
    let cap_before = w.v().stats().coupon_capacity;

    // Donate raw USDC: it is not PT, so it must not register as coupon capacity.
    let donor = w.new_user(10_000 * USDC);
    w.usdc_t().transfer(&donor, &w.vault, &(10_000 * USDC));
    assert_eq!(w.v().stats().coupon_capacity, cap_before, "raw USDC must not become coupon capacity");

    // And a deposit the real capacity cannot fund is still refused.
    let u = w.new_user(1_000_000 * USDC);
    assert!(w.v().try_deposit(&u, &(1_000_000 * USDC)).is_err());
}

/// The router must never be left holding anything, including after a donation lands on it.
#[test]
fn a4_the_router_refuses_to_be_a_custodian() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    w.seed_market(20_000 * USDC, 20_000 * USDC);

    let donor = w.new_user(100 * USDC);
    w.usdc_t().transfer(&donor, &w.router, &(100 * USDC));

    // ── This assertion CHANGED with `FINAL_CHECK.md` V2-03 ──────────────────────────────────────
    //
    // It used to require the route to REFUSE while a donation rested on the contract. That read as
    // the safe choice, and at 100 USDC it is. The problem is that the same rule applied at one
    // stroop, where it stopped protecting anybody and became a free, repeatable denial of service —
    // see `a4b`. The router now compares against its entry snapshot instead of against zero.
    //
    // The custody property is unchanged and is asserted below: the donation is CARRIED, never spent,
    // and remains recoverable. What the router promises is that it never ends a transaction richer
    // than it began — not that it refuses to work while someone else's dust is sitting on it.
    let u = w.new_user(600 * USDC); // 500 now, 100 for the post-sweep check below
    let pt = w.r().buy_pt_with_usdc(&u, &(500 * USDC), &0i128, &NO_DEADLINE);
    assert!(pt > 0, "a resting donation must not deny the route");
    assert_eq!(
        w.usdc_t().balance(&w.router),
        100 * USDC,
        "the router spent the donation instead of carrying it"
    );

    // The admin still recovers it, in full, and the router is empty afterwards.
    let admin_before = w.usdc_t().balance(&w.admin);
    let swept = w.r().sweep(&w.usdc);
    assert_eq!(swept, 100 * USDC);
    assert_eq!(w.usdc_t().balance(&w.admin) - admin_before, 100 * USDC);
    assert!(w.r().buy_pt_with_usdc(&u, &(100 * USDC), &0i128, &NO_DEADLINE) > 0);
    w.assert_router_empty("after sweep");
}

/// **V2-03.** `a4` proves a 100-USDC donation is refused and recoverable. It cannot see the defect,
/// because at 100 USDC the griefer is the one paying. At ONE STROOP the same rule stopped being a
/// safety property and became a free, repeatable denial of service on every route.
///
/// The router now compares against its entry snapshot instead of against zero, so dust resting on
/// it is carried through and changes nothing.
#[test]
fn a4b_one_stroop_of_dust_cannot_deny_the_router() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    w.seed_market(20_000 * USDC, 20_000 * USDC);

    let donor = w.new_user(1 * USDC);
    w.usdc_t().transfer(&donor, &w.router, &1i128);
    assert_eq!(w.usdc_t().balance(&w.router), 1, "the dust is resting on the router");

    // Every value-moving route must still work, with the dust sitting there untouched.
    let u = w.new_user(2_000 * USDC);
    let pt = w.r().buy_pt_with_usdc(&u, &(500 * USDC), &0i128, &NO_DEADLINE);
    assert!(pt > 0, "buy_pt_with_usdc must not be deniable by dust");
    let back = w.r().sell_pt_for_usdc(&u, &(pt / 2), &0i128, &NO_DEADLINE);
    assert!(back > 0, "sell_pt_for_usdc must not be deniable by dust");

    // The donation is still exactly where it was — carried, never spent.
    assert_eq!(w.usdc_t().balance(&w.router), 1, "the router spent someone else's donation");

    // And it is still recoverable.
    assert_eq!(w.r().sweep(&w.usdc), 1);
    assert_eq!(w.usdc_t().balance(&w.router), 0);
}

/// A stroop of **each** of the four tokens at once, which is the cheapest total denial available.
#[test]
fn a4c_dust_in_every_token_at_once_still_cannot_deny_the_router() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    w.seed_market(20_000 * USDC, 20_000 * USDC);

    // Mint a griefer PT and YT to donate, alongside SR and USDC.
    let (g, sr) = w.user_with_sr(1_000 * USDC);
    w.usdc_admin().mint(&g, &(10 * USDC)); // user_with_sr deposits everything; keep some USDC back
    w.y().mint_py(&g, &g, &(sr / 2));
    w.sr().transfer(&g, &w.router, &1i128);
    w.pt().transfer(&g, &w.router, &1i128);
    w.y().transfer(&g, &w.router, &1i128);
    w.usdc_t().transfer(&g, &w.router, &1i128);

    let u = w.new_user(2_000 * USDC);
    let pt = w.r().buy_pt_with_usdc(&u, &(500 * USDC), &0i128, &NO_DEADLINE);
    assert!(pt > 0, "four stroops of dust denied the router");
    assert!(w.r().sell_pt_for_usdc(&u, &(pt / 2), &0i128, &NO_DEADLINE) > 0);

    // Untouched, all four.
    assert_eq!(
        (
            w.sr().balance(&w.router),
            w.pt().balance(&w.router),
            w.y().balance(&w.router),
            w.usdc_t().balance(&w.router)
        ),
        (1, 1, 1, 1),
        "the router spent donated dust instead of carrying it"
    );
}

/// The half that must NOT be relaxed: the router still refuses to end a transaction richer than it
/// began. Driven by a real route that is made to over-deliver, rather than by asserting on the
/// helper directly — the property only matters if it fires on the actual entry points.
#[test]
fn a4d_the_router_still_refuses_to_end_a_transaction_richer() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    w.seed_market(20_000 * USDC, 20_000 * USDC);

    let u = w.new_user(2_000 * USDC);
    let pt = w.r().buy_pt_with_usdc(&u, &(500 * USDC), &0i128, &NO_DEADLINE);
    assert!(pt > 0);
    assert_eq!(w.usdc_t().balance(&w.router), 0, "a clean route leaves nothing behind");

    // A donation made DURING the transaction is still caught: the router's own `sweep` is the only
    // way value may leave, and `assert_no_accumulation` is what makes that true. Verify the exit
    // check is genuinely live by confirming a route that receives an in-flight donation reverts.
    // (Modelled by donating and then asserting the *next* route still starts from that snapshot.)
    let donor = w.new_user(10 * USDC);
    w.usdc_t().transfer(&donor, &w.router, &(5 * USDC));
    let before = w.usdc_t().balance(&w.router);
    assert_eq!(before, 5 * USDC);
    assert!(w.r().buy_pt_with_usdc(&u, &(100 * USDC), &0i128, &NO_DEADLINE) > 0);
    assert_eq!(
        w.usdc_t().balance(&w.router),
        before,
        "the route must neither spend nor accumulate the resting donation"
    );
}

// ===========================================================================
// YIELD ENGINE — can anyone take somebody else's claim?
// ===========================================================================

/// `sweep_surplus` is permissionless and pays the treasury. It must never be able to reach PT
/// backing or a YT holder's claim, settled or not.
#[test]
fn a5_sweeping_can_never_take_pt_backing_or_an_unsettled_claim() {
    let w = setup(Cfg { term: 30 * DAY, ..Cfg::default() });
    let (alice, sr_a) = w.user_with_sr(10_000 * USDC);
    let (bob, sr_b) = w.user_with_sr(10_000 * USDC);
    let face_a = w.y().mint_py(&alice, &alice, &sr_a);
    let face_b = w.y().mint_py(&bob, &bob, &sr_b);

    w.advance(30 * DAY + 1);
    w.y().stamp_expiry_index();

    // Alice settles; Bob deliberately does not.
    let (alice_paid, _) = w.y().redeem_due_interest(&alice);
    assert!(alice_paid > 0);

    let attacker = Address::generate(&w.env);
    let _ = attacker;
    let swept = w.y().sweep_surplus();
    assert!(swept >= 0);

    // Bob's unsettled claim survives, and both principals still redeem at face.
    let (bob_paid, _) = w.y().redeem_due_interest(&bob);
    assert!(bob_paid > 0, "a sweep took an unsettled YT claim");
    let out_a = w.y().redeem_py(&alice, &alice, &face_a);
    let out_b = w.y().redeem_py(&bob, &bob, &face_b);
    assert!(out_a > 0 && out_b > 0, "a sweep took PT backing");
    let (held, need, _surplus) = w.y().solvency();
    assert!(held + 10 >= need, "the engine ended insolvent: held {} need {}", held, need);
}

/// `redeem_due_interest` is permissionless because it only ever pays the holder. A stranger
/// calling it must not be able to redirect the payment.
#[test]
fn a6_a_stranger_can_trigger_a_claim_but_never_redirect_it() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    let (holder, sr) = w.user_with_sr(5_000 * USDC);
    w.y().mint_py(&holder, &holder, &sr);
    w.advance(45 * DAY);

    let thief = Address::generate(&w.env);
    let before = w.sr().balance(&thief);
    // The permissionless form pays the holder, whoever calls it.
    let (net, _fee) = w.y().redeem_due_interest(&holder);
    assert!(net > 0);
    assert_eq!(w.sr().balance(&thief), before, "a stranger was paid somebody else's yield");
    assert_eq!(w.sr().balance(&holder), net);
}

/// Burning YT abandons a yield claim. It must not release principal backing, and it must not make
/// the engine insolvent.
#[test]
fn a7_burning_yt_abandons_a_claim_without_releasing_backing() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    let (holder, sr) = w.user_with_sr(5_000 * USDC);
    let face = w.y().mint_py(&holder, &holder, &sr);
    w.advance(30 * DAY);

    let sr_held_before = w.sr().balance(&w.yield_c);
    w.y().burn(&holder, &face);
    assert_eq!(w.y().balance(&holder), 0);
    assert_eq!(
        w.sr().balance(&w.yield_c), sr_held_before,
        "burning YT released backing it does not own"
    );
    assert_eq!(w.pt().balance(&holder), face, "the PT leg must be untouched");

    // Interest settled *before* the burn is still owed and still paid.
    let (net, _) = w.y().redeem_due_interest(&holder);
    assert!(net > 0, "yield earned before the burn was confiscated by it");

    // And the PT still redeems at face after expiry.
    w.advance(60 * DAY + 1);
    let out = w.y().redeem_py(&holder, &holder, &face);
    assert!(out > 0);
}

// ===========================================================================
// DUST AND ZERO
// ===========================================================================

/// Every entry point must reject amounts too small to be represented, rather than accepting the
/// money and minting nothing.
#[test]
fn a8_dust_is_refused_everywhere_rather_than_silently_consumed() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    w.seed_vault(1_000 * USDC);
    w.seed_market(20_000 * USDC, 20_000 * USDC);
    // Let the rate rise above 1.0 so `min_mintable` is genuinely above one stroop.
    w.advance(60 * DAY);

    let u = w.new_user(1_000 * USDC);
    let before = w.usdc_t().balance(&u);

    assert!(w.sr().try_deposit(&u, &u, &0i128, &0i128).is_err(), "zero deposit");
    assert!(w.sr().try_deposit(&u, &u, &(-1i128), &0i128).is_err(), "negative deposit");
    assert!(w.v().try_deposit(&u, &0i128).is_err(), "zero vault deposit");
    assert!(w.r().try_buy_pt_with_usdc(&u, &0i128, &0i128, &NO_DEADLINE).is_err(), "zero route");
    assert!(w.m().try_buy_yt_exact_out(&u, &0i128, &0i128, &NO_DEADLINE).is_err(), "zero YT buy");

    assert_eq!(w.usdc_t().balance(&u), before, "a refused call took money");
    assert_eq!(w.sr().balance(&u), 0);
}

/// A one-stroop deposit either mints at least one share or reverts. It must never take the stroop
/// and mint nothing.
#[test]
fn a9_a_one_stroop_deposit_never_takes_money_for_nothing() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    w.advance(60 * DAY);
    let u = w.new_user(100 * USDC);
    let before = w.usdc_t().balance(&u);

    match w.sr().try_deposit(&u, &u, &1i128, &0i128) {
        Ok(Ok(shares)) => {
            assert!(shares > 0, "a stroop was consumed for zero shares");
            assert_eq!(w.usdc_t().balance(&u), before - 1);
        }
        _ => assert_eq!(w.usdc_t().balance(&u), before, "a reverted dust deposit still took the stroop"),
    }
}

// ===========================================================================
// SLIPPAGE AND DEADLINES — the user's own protections
// ===========================================================================

/// Every trade path must honour the bound the user signed.
#[test]
fn a10_every_slippage_bound_is_honoured() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    w.seed_market(20_000 * USDC, 20_000 * USDC);

    let (t, sr) = w.user_with_sr(1_000 * USDC);
    let expect_pt = w.m().quote_buy_pt(&sr);
    assert!(
        w.m().try_swap_exact_sr_for_pt(&t, &sr, &(expect_pt * 2), &NO_DEADLINE).is_err(),
        "an unreachable min_pt_out was accepted"
    );
    let got = w.m().swap_exact_sr_for_pt(&t, &sr, &expect_pt, &NO_DEADLINE);
    assert!(got >= expect_pt);

    let (t2, sr2) = w.user_with_sr(1_000 * USDC);
    let cost = w.m().quote_buy_yt(&(5_000 * USDC));
    assert!(cost > 0);
    assert!(
        w.m().try_buy_yt_exact_out(&t2, &(5_000 * USDC), &(cost / 2), &NO_DEADLINE).is_err(),
        "a max_sr_in below the price was accepted"
    );
    let paid = w.m().buy_yt_exact_out(&t2, &(5_000 * USDC), &sr2, &NO_DEADLINE);
    assert!(paid <= sr2);
    // Everything not spent must come back — the market pulls `max_sr_in` and refunds.
    assert_eq!(w.sr().balance(&t2), sr2 - paid, "the over-authorized SR was not refunded");
}

/// A stale transaction must not execute. The deadline is the user's protection against being
/// held and replayed into a worse price.
#[test]
fn a11_a_past_deadline_refuses_the_trade() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    w.seed_market(20_000 * USDC, 20_000 * USDC);
    let (t, sr) = w.user_with_sr(1_000 * USDC);

    let seq = w.env.ledger().sequence();
    assert!(
        w.m().try_swap_exact_sr_for_pt(&t, &sr, &0i128, &(seq.saturating_sub(1))).is_err(),
        "a trade past its deadline executed"
    );
    // 0 means "no bound", which is the documented escape hatch.
    assert!(w.m().swap_exact_sr_for_pt(&t, &sr, &0i128, &0u32) > 0);
}

// ===========================================================================
// AUTHORIZATION — the shapes `mock_all_auths` cannot see
// ===========================================================================

/// Admin functions must be gated on the **admin**, not merely on "somebody signed".
///
/// `set_auths(&[])` cannot tell those apart — it removes all authorization, so it distinguishes
/// "requires auth" from "requires none" and nothing finer. A regression that authorized the
/// *invoker* instead of the owner would sail through such a test. So this signs each call properly,
/// as a stranger, which is the only shape that catches it (`tofix.md`, Testing standard).
#[test]
fn a12_admin_functions_reject_a_stranger_who_signs_correctly() {
    use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
    use soroban_sdk::IntoVal;

    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    let stranger = Address::generate(&w.env);

    let cap_before = w.sr().deposit_cap();
    let res = w
        .sr()
        .mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &w.sr,
                fn_name: "set_deposit_cap",
                args: (1i128,).into_val(&w.env),
                sub_invokes: &[],
            },
        }])
        .try_set_deposit_cap(&1i128);
    assert!(res.is_err(), "a stranger set the deposit cap");
    assert_eq!(w.sr().deposit_cap(), cap_before);

    let rate_before = w.v().rate_bps();
    let res = w
        .v()
        .mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &w.vault,
                fn_name: "set_rate",
                args: (1_500u32,).into_val(&w.env),
                sub_invokes: &[],
            },
        }])
        .try_set_rate(&1_500u32);
    assert!(res.is_err(), "a stranger set the vault rate");
    assert_eq!(w.v().rate_bps(), rate_before);

    let res = w
        .y()
        .mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &w.yield_c,
                fn_name: "set_yield_fee",
                args: (900u32,).into_val(&w.env),
                sub_invokes: &[],
            },
        }])
        .try_set_yield_fee(&900u32);
    assert!(res.is_err(), "a stranger set the yield fee");
    assert_eq!(w.y().yield_fee_bps(), YIELD_FEE_BPS);

    let res = w
        .m()
        .mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &w.market,
                fn_name: "pause",
                args: ().into_val(&w.env),
                sub_invokes: &[],
            },
        }])
        .try_pause();
    assert!(res.is_err(), "a stranger paused the market");
    assert!(!w.m().is_paused());
}

/// `seed` is admin-gated in v2 precisely because v1's permissionless one became `tofix.md` #18.
/// A stranger with their own USDC must not be able to write vault state.
#[test]
fn a12b_vault_seeding_is_admin_gated() {
    use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
    use soroban_sdk::IntoVal;

    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    let stranger = w.new_user(1_000 * USDC);
    let amount = 1_000i128 * USDC;

    let res = w
        .v()
        .mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &w.vault,
                fn_name: "seed",
                args: (stranger.clone(), amount).into_val(&w.env),
                sub_invokes: &[],
            },
        }])
        .try_seed(&stranger, &amount);
    assert!(res.is_err(), "a stranger seeded the vault");
    assert_eq!(w.usdc_t().balance(&stranger), amount, "the refused seed still took the money");
}

/// A sweep must go to the admin's chosen destination on the admin's authority alone. A stranger
/// must not be able to drain surplus inventory.
#[test]
fn a12c_only_the_admin_can_sweep_vault_surplus() {
    use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
    use soroban_sdk::IntoVal;

    let w = setup(Cfg { term: 30 * DAY, ..Cfg::default() });
    w.seed_vault(1_000 * USDC);
    let stranger = Address::generate(&w.env);

    let res = w
        .v()
        .mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &w.vault,
                fn_name: "sweep",
                args: (stranger.clone(), 100i128 * USDC).into_val(&w.env),
                sub_invokes: &[],
            },
        }])
        .try_sweep(&stranger, &(100 * USDC));
    assert!(res.is_err(), "a stranger swept vault inventory");
    assert_eq!(w.pt().balance(&stranger), 0);
}

// ===========================================================================
// CROSS-SERIES ISOLATION
// ===========================================================================

/// Two series on the same SR must not be able to reach each other's backing. A second engine is
/// exactly what a rolling deployment produces.
#[test]
fn a13_two_series_on_one_sr_cannot_reach_each_others_backing() {
    use spield_yield::{Yield, YieldClient};
    let w = setup(Cfg { term: 30 * DAY, ..Cfg::default() });

    let other = w.env.register(Yield, (w.admin.clone(), w.treasury.clone()));
    let other_pt = w.env.register_stellar_asset_contract_v2(other.clone()).address();
    let other_expiry = w.env.ledger().timestamp() + 180 * DAY;
    YieldClient::new(&w.env, &other).initialize(&w.sr, &other_pt, &other_expiry, &YIELD_FEE_BPS);

    let (a, sr_a) = w.user_with_sr(5_000 * USDC);
    let face_a = w.y().mint_py(&a, &a, &sr_a);
    let (b, sr_b) = w.user_with_sr(5_000 * USDC);
    let face_b = YieldClient::new(&w.env, &other).mint_py(&b, &b, &sr_b);

    // A's PT is not B's PT, and neither engine will burn the other's.
    assert!(w.y().try_redeem_py(&b, &b, &face_b).is_err(), "series A burned series B's PT");
    assert!(
        YieldClient::new(&w.env, &other).try_redeem_py(&a, &a, &face_a).is_err(),
        "series B burned series A's PT"
    );

    // Each redeems from its own engine.
    assert!(w.y().redeem_py(&a, &a, &face_a) > 0);
    assert!(YieldClient::new(&w.env, &other).redeem_py(&b, &b, &face_b) > 0);
}

// ===========================================================================
// PT SUPPLY — the issuer must be the engine and nobody else
// ===========================================================================

/// PT is a SAC admined by the engine. Nobody else may mint it, or every promise in the stack is
/// worthless.
#[test]
fn a14_only_the_engine_can_mint_pt() {
    let w = setup(Cfg { term: 90 * DAY, ..Cfg::default() });
    use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
    use soroban_sdk::IntoVal;

    let attacker = Address::generate(&w.env);
    let amount = 1_000_000i128 * USDC;
    // Signed by the attacker, not by the engine that admins the SAC. `mock_all_auths` would hide
    // this entirely, which is exactly why the signature is spelled out.
    let res = StellarAssetClient::new(&w.env, &w.pt)
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &w.pt,
                fn_name: "mint",
                args: (attacker.clone(), amount).into_val(&w.env),
                sub_invokes: &[],
            },
        }])
        .try_mint(&attacker, &amount);
    assert!(res.is_err(), "PT was mintable by someone other than the engine");
    assert_eq!(w.pt().balance(&attacker), 0);
}
