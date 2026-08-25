#![cfg(test)]
//! # Economic model — does the thing actually pay, and to whom?
//!
//! The other suites prove the mechanism is *correct*. This one asks whether it is *viable*: does a
//! PT buyer receive the rate they were quoted, does an LP come out ahead, does the protocol earn
//! enough to matter, and does every stroop of every fee land somewhere accounted for.
//!
//! Every number is measured against the real Blend v2 WASM at the **shipped parameters**:
//!
//! ```text
//! ln_fee_root              0.25%/yr      (calibrate_the_fee_root)
//! treasury swap share      2000 bps      (20% protocol / 80% LP)
//! yield fee                 500 bps      (5%, Pendle's rate)
//! scalar_root                 40e12
//! ```
//!
//! One caveat that applies to every figure below: the test harness's Blend pool accrues far slower
//! than mainnet (~0.4–1.9%/yr). Anything that depends on *realized* yield is therefore a mechanism
//! check, not a forecast. Everything that depends on the *curve* — PT's discount, the fee split,
//! LP inventory — is exact and does transfer.

extern crate std;

use crate::test::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::Address;

const YEAR: u64 = 365 * 24 * 60 * 60;
const DAY: u64 = 24 * 60 * 60;

/// Value an LP claim in asset units, pricing PT at its **market** price rather than at face.
/// Valuing PT at 1.0 would make every PT-for-SR swap look like a loss, because PT trades at a
/// discount right up until expiry — the discount is the whole product.
fn lp_value(pt: i128, sr: i128, pt_price: i128, index: i128) -> i128 {
    (pt * pt_price) / 1_000_000_000_000i128 + (sr * index) / 1_000_000_000_000i128
}

/// Annualized return from a total return over `days`.
fn annualize(ret: f64, days: f64) -> f64 {
    if days <= 0.0 {
        return 0.0;
    }
    ((1.0 + ret).powf(365.0 / days) - 1.0) * 100.0
}

// ===========================================================================
// 1. Does a PT buyer actually receive the rate they were quoted?
// ===========================================================================

/// **The flagship promise.** Buy PT at a quoted implied APY, hold to expiry, redeem at par. The
/// realized annualized return must land close to the quote — a little under, by the fee.
#[test]
fn a_pt_buyer_held_to_maturity_earns_the_quoted_rate() {
    for (days, apy_bps) in [(90u64, 500u32), (180, 500), (365, 500), (365, 800)] {
        let w = std_setup(days * DAY, apy_bps);
        w.seed(500_000 * USDC, 500_000 * USDC);
        let quoted = w.m().implied_apy() as f64 * 100.0 / 1e12;

        // Buy PT with 10,000 USDC of SR.
        let (u, sr_in) = w.user_with_sr(10_000 * USDC);
        let spent_usdc = w.sr().preview_redeem(&sr_in);
        let pt = w.m().swap_exact_sr_for_pt(&u, &sr_in, &0i128, &0u32);

        // Hold to expiry, then redeem PT at par and unwrap to USDC.
        w.env.ledger().set_timestamp(w.expiry + 1);
        let sr_out = w.y().redeem_py(&u, &u, &pt);
        let got_usdc = w.sr().redeem(&u, &u, &sr_out, &0i128);

        let ret = (got_usdc - spent_usdc) as f64 / spent_usdc as f64;
        let realized = annualize(ret, days as f64);
        std::println!(
            "{:>3}d @ {:>4}bps: quoted {:.3}%  realized {:.3}%  ({} -> {} USDC)",
            days, apy_bps, quoted, realized, spent_usdc, got_usdc
        );
        assert!(realized > 0.0, "a PT hold must be profitable");
        assert!(
            realized <= quoted + 0.05,
            "realized {realized:.3}% cannot exceed the quote {quoted:.3}% — that would be free money"
        );
        // The gap is the entry fee amortized over the term; it must be small, not structural.
        assert!(
            quoted - realized < quoted * 0.35,
            "the fee should cost well under a third of the quoted rate: quoted {quoted:.3}%, realized {realized:.3}%"
        );
    }
}

/// PT bought closer to maturity should still deliver ~the same *annualized* rate — the curve's
/// whole purpose. If short-dated PT paid a systematically worse annualized rate, the venue would
/// only work for one tenor.
#[test]
fn the_annualized_rate_is_consistent_across_tenors() {
    let mut rates = std::vec::Vec::new();
    for days in [30u64, 90, 180, 365] {
        let w = std_setup(days * DAY, 500);
        w.seed(500_000 * USDC, 500_000 * USDC);
        let (u, sr_in) = w.user_with_sr(10_000 * USDC);
        let spent = w.sr().preview_redeem(&sr_in);
        let pt = w.m().swap_exact_sr_for_pt(&u, &sr_in, &0i128, &0u32);
        w.env.ledger().set_timestamp(w.expiry + 1);
        let sr_out = w.y().redeem_py(&u, &u, &pt);
        let got = w.sr().redeem(&u, &u, &sr_out, &0i128);
        let r = annualize((got - spent) as f64 / spent as f64, days as f64);
        rates.push((days, r));
    }
    for (d, r) in &rates {
        std::println!("  {:>3}d PT hold -> {:.3}% annualized", d, r);
    }
    let lo = rates.iter().map(|(_, r)| *r).fold(f64::MAX, f64::min);
    let hi = rates.iter().map(|(_, r)| *r).fold(0f64, f64::max);
    assert!(
        hi - lo < 1.0,
        "annualized return must not depend on tenor: {lo:.3}% .. {hi:.3}%"
    );
    std::println!("  spread {:.3}pp across a 12x tenor range", hi - lo);
}

// ===========================================================================
// 2. Fee conservation — every stroop lands somewhere
// ===========================================================================

/// For every trade: what leaves the user equals what the pool keeps plus what the treasury takes.
/// Nothing is created, nothing evaporates.
#[test]
fn every_fee_is_conserved_across_the_user_pool_and_treasury() {
    let w = std_setup(YEAR, 500);
    let (lp, _) = w.seed(500_000 * USDC, 500_000 * USDC);
    let _ = lp;

    let (u, sr_in) = w.user_with_sr(50_000 * USDC);
    let user_before = w.sr().balance(&u);
    let pool_before = w.sr().balance(&w.market);
    let tre_before = w.sr().balance(&w.treasury);

    w.m().swap_exact_sr_for_pt(&u, &sr_in, &0i128, &0u32);

    let user_out = user_before - w.sr().balance(&u);
    let pool_in = w.sr().balance(&w.market) - pool_before;
    let tre_in = w.sr().balance(&w.treasury) - tre_before;

    assert_eq!(
        user_out,
        pool_in + tre_in,
        "SR out of the user must equal SR into the pool + treasury"
    );
    assert!(tre_in > 0, "the treasury takes a share");
    std::println!(
        "PT buy: user paid {user_out} SR -> pool {pool_in} + treasury {tre_in}  (treasury = {:.2}% of the trade)",
        tre_in as f64 * 100.0 / user_out as f64
    );
}

/// The same conservation on the YT path, including the refund leg — the place it would be easiest
/// to lose a stroop.
#[test]
fn a_yt_buy_conserves_value_including_the_refund() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let n = 20_000 * USDC;
    let quoted = w.m().quote_buy_yt(&n);
    let (u, sr_in) = w.user_with_sr(w.sr().preview_redeem(&quoted) + 50_000 * USDC);

    let user_before = w.sr().balance(&u);
    let pool_before = w.sr().balance(&w.market);
    let tre_before = w.sr().balance(&w.treasury);
    let engine_before = w.sr().balance(&w.yield_c);

    w.m().buy_yt_exact_out(&u, &n, &sr_in, &0u32);

    let user_out = user_before - w.sr().balance(&u);
    let pool_delta = w.sr().balance(&w.market) - pool_before; // negative: the pool funds most of it
    let tre_in = w.sr().balance(&w.treasury) - tre_before;
    let engine_in = w.sr().balance(&w.yield_c) - engine_before;

    // The engine + treasury received exactly what left the user and the pool. `pool_delta` is
    // NEGATIVE (the pool funds most of the notional), so the SR it contributed is `-pool_delta`.
    assert_eq!(
        user_out - pool_delta,
        engine_in + tre_in,
        "SR out of (user + pool) must equal SR into (engine + treasury)"
    );
    assert!(user_out > 0 && user_out < n, "the user pays only the YT price");
    std::println!(
        "YT buy: user {user_out} SR, pool {pool_delta} SR, engine +{engine_in}, treasury +{tre_in}"
    );
}

// ===========================================================================
// 3. LP economics — is providing liquidity actually worth it?
// ===========================================================================

/// An LP who seeds a pool, absorbs realistic two-way flow and holds to maturity must end up with
/// **more value than they put in**. If this fails the venue cannot bootstrap.
#[test]
fn an_lp_that_holds_through_two_way_flow_ends_up_ahead() {
    let w = std_setup(180 * DAY, 500);
    let (lp, shares) = w.seed(500_000 * USDC, 500_000 * USDC);

    // Value the LP's stake at entry, in asset units.
    let (_, pt0, sr0) = w.m().lp_position(&lp);
    let entry_value = lp_value(pt0, sr0, w.m().pt_price(), w.y().py_index());

    // Realistic two-way flow: PT buyers and PT sellers alternating, plus YT activity.
    for i in 0..8 {
        w.advance(20 * DAY);
        if i % 2 == 0 {
            let (t, s) = w.user_with_sr(20_000 * USDC);
            let _ = w.m().try_swap_exact_sr_for_pt(&t, &s, &0i128, &0u32);
        } else {
            let (t, s) = w.user_with_sr(20_000 * USDC);
            let py = w.y().mint_py(&t, &t, &s);
            let _ = w.m().try_swap_exact_pt_for_sr(&t, &py, &0i128, &0u32);
        }
    }

    let (_, pt1, sr1) = w.m().lp_position(&lp);
    let exit_value = lp_value(pt1, sr1, w.m().pt_price(), w.y().py_index());

    let gain = exit_value - entry_value;
    std::println!(
        "LP over 160d of two-way flow: {} -> {} asset units  ({:+.4}%)",
        entry_value,
        exit_value,
        gain as f64 * 100.0 / entry_value as f64
    );
    assert!(gain > 0, "an LP absorbing balanced flow must end up ahead: {entry_value} -> {exit_value}");
    // And they can actually get it out.
    let (pt_out, sr_out) = w.m().remove_liquidity(&lp, &shares, &0i128, &0i128);
    assert!(pt_out > 0 && sr_out > 0);
}

/// The LP's SR half earns Blend yield the whole time it sits in the pool — the structural advantage
/// of PT/SR over PT/USDC. Quantified here with zero trading, so the growth is purely the yield.
#[test]
fn the_lp_earns_strategy_yield_on_its_sr_half_with_no_trading_at_all() {
    let w = std_setup(YEAR, 500);
    let (lp, _) = w.seed(500_000 * USDC, 500_000 * USDC);
    let (_, _, sr_claim) = w.m().lp_position(&lp);
    let before = w.sr().preview_redeem(&sr_claim);

    w.advance(YEAR - DAY);

    let (_, _, sr_claim2) = w.m().lp_position(&lp);
    let after = w.sr().preview_redeem(&sr_claim2);
    assert_eq!(sr_claim2, sr_claim, "no trades, so the share count is unchanged");
    assert!(after > before, "but its USDC value grew");
    std::println!(
        "LP SR half, zero trades, one year: {:.2} -> {:.2} USDC ({:+.4}%)  [harness Blend rate]",
        before as f64 / USDC as f64,
        after as f64 / USDC as f64,
        (after - before) as f64 * 100.0 / before as f64
    );
    std::println!("  In a PT/USDC pool this half earns exactly 0.");
}

// ===========================================================================
// 4. Protocol revenue — is it enough to matter?
// ===========================================================================

/// Measure what the protocol actually earns from a realistic volume, and report it as a share of
/// the volume so it can be extrapolated honestly.
#[test]
fn protocol_swap_revenue_scales_with_volume_and_is_reportable() {
    let w = std_setup(90 * DAY, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);

    let mut volume = 0i128;
    for _ in 0..10 {
        let (t, s) = w.user_with_sr(25_000 * USDC);
        let spent = w.sr().preview_redeem(&s);
        if w.m().try_swap_exact_sr_for_pt(&t, &s, &0i128, &0u32).is_ok() {
            volume += spent;
        }
    }
    let earned_sr = w.m().treasury_earned();
    let earned_usdc = w.sr().preview_redeem(&earned_sr);
    let bps = earned_usdc as f64 * 10_000.0 / volume as f64;

    std::println!(
        "10 PT buys, {:.0} USDC of volume -> treasury {:.4} USDC  ({:.3} bps of volume)",
        volume as f64 / USDC as f64,
        earned_usdc as f64 / USDC as f64,
        bps
    );
    std::println!(
        "  LPs kept the other 80%: ~{:.4} USDC",
        (earned_usdc as f64 / USDC as f64) * 4.0
    );
    assert!(earned_sr > 0, "the protocol must earn something");
    // A 90-day market at a 0.25%/yr root: ~6 bps of notional total fee, 20% of it to the treasury.
    assert!(bps > 0.5 && bps < 6.0, "treasury take of {bps:.3} bps is outside the expected band");
}

/// The **yield fee** is the primary revenue line. Verify it is exactly the configured share, that
/// it does not disturb solvency, and report it against the yield produced.
#[test]
fn the_yield_fee_is_exact_and_is_the_primary_revenue_line() {
    let w = std_setup(YEAR, 500);
    let (u, _) = w.user_with_py(500_000 * USDC);
    w.advance(365 * DAY - DAY);

    let gross = w.y().claimable_interest(&u);
    assert!(gross > 0);
    let (net, fee) = w.y().redeem_due_interest(&u);
    assert_eq!(net + fee, gross, "nothing is lost in the split");
    assert_eq!(fee, gross * 500 / 10_000, "exactly 5%");

    let (held, needed, _) = w.y().solvency();
    assert!(held + 10 >= needed, "the fee must not break solvency");

    std::println!(
        "500k face for a year: gross yield {:.4} USDC -> holder {:.4} + treasury {:.4}",
        w.sr().preview_redeem(&gross) as f64 / USDC as f64,
        w.sr().preview_redeem(&net) as f64 / USDC as f64,
        w.sr().preview_redeem(&fee) as f64 / USDC as f64,
    );
    std::println!("  => protocol revenue is 5% of ALL yield the protocol intermediates.");
}

/// Revenue is bounded by governance ceilings that hold under attack: a compromised admin cannot
/// raise either fee past its on-chain cap.
#[test]
fn neither_revenue_lever_can_be_raised_past_its_ceiling() {
    let w = std_setup(YEAR, 500);
    // Swap-fee share: capped at 50%.
    assert!(w.m().try_set_treasury_fee_share(&5_001u32).is_err());
    w.m().set_treasury_fee_share(&5_000u32);
    assert_eq!(w.m().treasury_fee_share_bps(), 5_000);
    // Fee root: capped at 5%/yr.
    assert!(w.m().try_set_ln_fee_root(&(6 * 1_000_000_000_000i128 / 100)).is_err());
    // Yield fee: capped at 10%.
    assert!(w.y().try_set_yield_fee(&1_001u32).is_err());
    w.y().set_yield_fee(&1_000u32);
    assert_eq!(w.y().yield_fee_bps(), 1_000);
    std::println!("ceilings hold: swap share <= 50%, fee root <= 5%/yr, yield fee <= 10%");
}

// ===========================================================================
// 5. YT economics — what does a buyer actually need to break even?
// ===========================================================================

/// A YT buyer is betting realized yield beats the implied rate. Their break-even realized APY
/// should be ~the implied APY the pool quotes, plus the fee. If break-even were far above the
/// implied rate the product would be structurally unwinnable.
#[test]
fn a_yt_buyers_break_even_is_close_to_the_pools_implied_rate() {
    for days in [90u64, 180, 365] {
        let w = std_setup(days * DAY, 500);
        w.seed(500_000 * USDC, 500_000 * USDC);
        let implied = w.m().implied_apy() as f64 * 100.0 / 1e12;

        let face = 10_000 * USDC;
        let cost_sr = w.m().quote_buy_yt(&face);
        let cost_usdc = w.sr().preview_redeem(&cost_sr);

        // Break-even: the YT must accrue `cost` of yield on `face` over the term.
        let period_return = cost_usdc as f64 / face as f64;
        let breakeven = annualize(period_return, days as f64);

        std::println!(
            "{:>3}d: YT on {} face costs {:.4} USDC -> break-even realized APY {:.3}%  (pool implies {:.3}%)",
            days,
            face / USDC,
            cost_usdc as f64 / USDC as f64,
            breakeven,
            implied
        );
        assert!(
            breakeven > implied,
            "break-even must exceed the implied rate — otherwise YT is free money"
        );
        assert!(
            breakeven < implied * 1.6,
            "break-even {breakeven:.3}% is too far above the implied {implied:.3}% to be winnable"
        );
    }
}

/// PT and YT must price consistently: buying both legs costs ~the same as just holding the
/// underlying. A gap either way is an arbitrage against the pool.
#[test]
fn pt_plus_yt_costs_about_the_same_as_the_underlying() {
    let w = std_setup(180 * DAY, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let face = 10_000 * USDC;

    // Cost of the YT leg.
    let yt_cost = w.sr().preview_redeem(&w.m().quote_buy_yt(&face));
    // Cost of the PT leg: how much SR buys `face` PT (approximate via the reverse quote).
    let pt_price = w.m().pt_price() as f64 / 1e12;
    let pt_cost = (face as f64 * pt_price) as i128;

    let total = pt_cost + yt_cost;
    let drift = (total - face) as f64 * 100.0 / face as f64;
    std::println!(
        "PT {:.4} + YT {:.4} = {:.4} vs {} face  ({:+.3}%)",
        pt_cost as f64 / USDC as f64,
        yt_cost as f64 / USDC as f64,
        total as f64 / USDC as f64,
        face / USDC,
        drift
    );
    assert!(
        drift.abs() < 1.5,
        "PT + YT must track the underlying within the fee band: drift {drift:.3}%"
    );
}

// ===========================================================================
// 6. Stress — does the model survive a busy, adversarial term?
// ===========================================================================

/// Run a full term of mixed activity and assert the invariants that make the economics honest:
/// solvency holds, reserves stay backed, the treasury only ever gains, and no participant can end
/// up with more than they are owed.
#[test]
fn the_model_survives_a_full_term_of_mixed_activity() {
    let w = std_setup(180 * DAY, 500);
    let (lp, _) = w.seed(500_000 * USDC, 500_000 * USDC);
    let mut holders = std::vec::Vec::new();
    let mut last_treasury = 0i128;

    for step in 0..9 {
        w.advance(20 * DAY);
        match step % 4 {
            0 => {
                let (t, s) = w.user_with_sr(30_000 * USDC);
                let _ = w.m().try_swap_exact_sr_for_pt(&t, &s, &0i128, &0u32);
            }
            1 => {
                let n = 15_000 * USDC;
                if w.m().quote_buy_yt(&n) > 0 {
                    let (t, s) = w.user_with_sr(40_000 * USDC);
                    if w.m().try_buy_yt_exact_out(&t, &n, &s, &0u32).is_ok() {
                        holders.push(t);
                    }
                }
            }
            2 => {
                if let Some(h) = holders.pop() {
                    let bal = w.y().balance(&h);
                    if bal > 0 {
                        let _ = w.m().try_sell_yt_exact_in(&h, &(bal / 2), &0i128, &0u32);
                        w.y().redeem_due_interest(&h);
                    }
                }
            }
            _ => {
                let (t, s) = w.user_with_sr(20_000 * USDC);
                let py = w.y().mint_py(&t, &t, &s);
                let _ = w.m().try_swap_exact_pt_for_sr(&t, &py, &0i128, &0u32);
            }
        }

        // Invariants, every step.
        let (held, needed, _) = w.y().solvency();
        assert!(held + 20 >= needed, "step {step}: engine insolvent ({held} < {needed})");
        let (pt_res, sr_res) = w.m().reserves();
        assert!(w.pt().balance(&w.market) >= pt_res, "step {step}: PT reserve unbacked");
        assert!(w.sr().balance(&w.market) >= sr_res, "step {step}: SR reserve unbacked");
        let tre = w.m().treasury_earned();
        assert!(tre >= last_treasury, "step {step}: treasury_earned went backwards");
        last_treasury = tre;
    }

    // Everyone exits.
    for h in &holders {
        w.y().redeem_due_interest(h);
    }
    let (shares, _, _) = w.m().lp_position(&lp);
    let (pt_out, sr_out) = w.m().remove_liquidity(&lp, &shares, &0i128, &0i128);
    assert!(pt_out > 0 && sr_out > 0, "the LP must still be able to exit");

    let (held, needed, surplus) = w.y().solvency();
    assert!(held + 20 >= needed);
    std::println!(
        "full term survived: treasury {} SR, engine held {held} vs needed {needed} (surplus {surplus} owed to YT)",
        last_treasury
    );
}

/// The treasury's SR is real, withdrawable value — not a phantom counter. Prove it by unwrapping.
#[test]
fn treasury_revenue_is_actually_withdrawable() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let (t, s) = w.user_with_sr(50_000 * USDC);
    w.m().swap_exact_sr_for_pt(&t, &s, &0i128, &0u32);

    let earned = w.m().treasury_earned();
    assert!(earned > 0);
    assert_eq!(w.sr().balance(&w.treasury), earned, "the counter matches the real balance");

    // The treasury address can unwrap it to USDC like anyone else.
    let usdc = w.sr().redeem(&w.treasury, &w.treasury, &earned, &0i128);
    assert!(usdc > 0, "treasury SR must be redeemable for real USDC");
    std::println!("treasury unwrapped {} SR into {} USDC base units", earned, usdc);
}

/// Nobody — not the treasury, not an LP, not a trader — can extract value from a pool by doing
/// nothing. A "do nothing" participant's claim must never grow at another's expense.
#[test]
fn an_idle_participant_cannot_gain_at_anothers_expense() {
    let w = std_setup(YEAR, 500);
    let (lp, _) = w.seed(500_000 * USDC, 500_000 * USDC);
    let idle = Address::generate(&w.env);
    let (_, pt0, sr0) = w.m().lp_position(&lp);

    // Heavy activity by others.
    for _ in 0..5 {
        let (t, s) = w.user_with_sr(20_000 * USDC);
        let _ = w.m().try_swap_exact_sr_for_pt(&t, &s, &0i128, &0u32);
    }

    // The idle account gained nothing anywhere.
    assert_eq!(w.sr().balance(&idle), 0);
    assert_eq!(w.y().balance(&idle), 0);
    assert_eq!(w.m().lp_position(&idle), (0, 0, 0));
    assert_eq!(w.y().claimable_interest(&idle), 0);

    // The LP who took the flow did gain (in PT inventory terms at minimum).
    let (_, pt1, sr1) = w.m().lp_position(&lp);
    let price = w.m().pt_price();
    let idx = w.y().py_index();
    let v0 = lp_value(pt0, sr0, price, idx);
    let v1 = lp_value(pt1, sr1, price, idx);
    assert!(v1 >= v0, "the LP absorbing the flow must not lose: {v0} -> {v1}");
}
