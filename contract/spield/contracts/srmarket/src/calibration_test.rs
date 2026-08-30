#![cfg(test)]
//! # `scalar_root` calibration
//!
//! `scalar_root` sets how hard a trade moves the market's quoted rate. V2_WORK §14 left it open at
//! **40** with the note that the first readings "are the input to the decision, not the decision".
//! This measures the decision.
//!
//! Run:
//! ```text
//! cargo test -p spield-srmarket --lib scalar_calibration -- --nocapture --test-threads=1
//! ```
//!
//! ## Time cancels — and that is worth knowing
//!
//! `rate_scalar = scalar_root / years_to_expiry`, so a short series has a much flatter PRICE curve.
//! It is tempting to conclude that a 30-day series is ~12x less rate-sensitive than the one-year
//! market §14 measured. **It is not, and test 2 shows why.**
//!
//! A price move is proportional to `1 / rate_scalar = years / scalar_root`. Converting a price move
//! into an APY move divides by `years` again. The two cancel exactly, so **sensitivity in APY terms
//! depends on `scalar_root` alone** and is invariant to time to expiry. §14's one-year readings do
//! therefore transfer to a 30-day series — measured here, not assumed.
//!
//! ## What is being chosen against
//!
//! `scalar_root` is NOT Blend-derived — it is a property of the AMM. But the *criterion* is
//! Blend-anchored: the vault quotes a fixed rate that Blend funds (300 bps, ceiling 312 bps —
//! `blendcalibration.md`), and PT trading on the same screen should not imply a wildly different
//! rate for the same maturity. The question from `tofix.md` #34 is exactly this:
//!
//! > *How far may one trade move the headline before it stops resembling the vault's rate?*

extern crate std;

use crate::test::setup_with_scalar;
use soroban_sdk::testutils::Ledger as _;
use spield_shared::SCALAR_12;

const USDC: i128 = 1_0000000;
const DAY: u64 = 24 * 3600;
const LN_FEE_ROOT: i128 = 25 * SCALAR_12 / 10_000;
const TREASURY_SHARE_BPS: u32 = 2_000;

/// Implied APY in basis points.
fn apy_bps(v: i128) -> f64 {
    v as f64 / SCALAR_12 as f64 * 10_000.0
}

/// Open a market with `scalar_root`, seed it, optionally age it, buy `buy_pct` of the SR side, and
/// report how far the quoted rate moved.
///
/// Returns `(apy_before_bps, apy_after_bps)`.
fn measure(term_days: u64, scalar_root_units: i128, seed_usdc: i128, aged_days: u64, buy_pct: i128)
    -> Option<(f64, f64)>
{
    let w = setup_with_scalar(
        term_days * DAY,
        300, // the calibrated vault rate — the market opens where the vault quotes
        LN_FEE_ROOT,
        TREASURY_SHARE_BPS,
        scalar_root_units * SCALAR_12,
    );
    w.seed(seed_usdc * USDC, seed_usdc * USDC);

    if aged_days > 0 {
        let t = w.env.ledger().timestamp();
        w.env.ledger().set_timestamp(t + aged_days * DAY);
    }

    let before = apy_bps(w.m().implied_apy());

    // Buy PT with SR: the SR side grows, the PT side shrinks, PT gets dearer, implied rate falls.
    let sr_in = seed_usdc * USDC * buy_pct / 100;
    let (buyer, sr) = w.user_with_sr(sr_in);
    w.m().try_swap_exact_sr_for_pt(&buyer, &sr, &0i128, &u32::MAX).ok()?.ok()?;

    Some((before, apy_bps(w.m().implied_apy())))
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 1. The parameter sweep, at the series length Spield actually ships
// ═════════════════════════════════════════════════════════════════════════════════════════════

#[test]
fn scalar_calibration_1_sweep_at_30_day_series() {
    std::println!("\n=== 1. Rate movement per trade — 30-DAY series, 20 USDC/side, at open ===");
    std::println!("  (the market opens at 300 bps, the calibrated vault rate)\n");
    std::println!("{:>12}  {:>10}  {:>10}  {:>10}  {:>10}", "scalar_root", "1% buy", "5% buy", "10% buy", "25% buy");

    for root in [10i128, 20, 40, 80, 160, 320] {
        let mut cells = std::vec::Vec::new();
        for pct in [1i128, 5, 10, 25] {
            match measure(30, root, 20, 0, pct) {
                Some((b, a)) => cells.push(std::format!("{:>+9.1}", a - b)),
                None => cells.push(std::format!("{:>10}", "n/a")),
            }
        }
        std::println!("{:>12}  {}  {}  {}  {}", root, cells[0], cells[1], cells[2], cells[3]);
    }
    std::println!("\n  cells are the move in the quoted implied APY, in bps (negative = rate falls)");
}


// ═════════════════════════════════════════════════════════════════════════════════════════════
// 2. Is sensitivity really time-invariant?
// ═════════════════════════════════════════════════════════════════════════════════════════════

/// The price curve flattens as expiry nears (`rate_scalar` grows without bound), so a naive reading
/// says a late-series trade barely moves anything. In APY terms it does not work out that way,
/// because the same `years` that flattens the price also divides the price->APY conversion.
///
/// If this table is flat across the row, `scalar_root` can be chosen once and holds for the whole
/// series — which is what makes it a deployable constant rather than something to re-tune weekly.
#[test]
fn scalar_calibration_2_sensitivity_is_time_invariant() {
    std::println!("\n=== 2. Same trade, different points in a 30-day series (scalar_root = 40) ===");
    std::println!("{:>16}  {:>10}  {:>10}  {:>10}", "days elapsed", "1% buy", "5% buy", "25% buy");

    for aged in [0u64, 15, 25, 29] {
        let mut cells = std::vec::Vec::new();
        for pct in [1i128, 5, 25] {
            match measure(30, 40, 20, aged, pct) {
                Some((b, a)) => cells.push(std::format!("{:>+9.1}", a - b)),
                None => cells.push(std::format!("{:>10}", "n/a")),
            }
        }
        std::println!(
            "{:>13}d ({:>2}d left)  {}  {}  {}",
            aged, 30 - aged, cells[0], cells[1], cells[2]
        );
    }
    std::println!("\n  flat row => scalar_root is a whole-series constant, not a per-week tuning knob");
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 3. The decision table: ABSOLUTE trade sizes at the guarded-launch seed
// ═════════════════════════════════════════════════════════════════════════════════════════════

/// Percentages hide the problem. At the guarded-launch seed the pool is tiny, so trades that are
/// trivial in dollars are enormous as a share of it — and it is the dollar size a real user types.
///
/// This is the table the decision should be made from.
#[test]
fn scalar_calibration_3_absolute_trade_sizes_at_launch_seed() {
    let seed = 20i128; // USDC per side — the guarded-launch figure from left.md §C
    std::println!(
        "\n=== 3. DECISION TABLE — {} USDC/side seed, 30-day series, quote opens at 300 bps ===",
        seed
    );
    std::println!("  resulting quoted APY after a single buy of the given SIZE IN USDC\n");
    std::println!(
        "{:>12}  {:>14}  {:>14}  {:>14}  {:>14}",
        "scalar_root", "0.5 USDC", "1 USDC", "2 USDC", "5 USDC"
    );

    for root in [40i128, 80, 160, 320, 640] {
        let mut cells = std::vec::Vec::new();
        for usdc in [0.5f64, 1.0, 2.0, 5.0] {
            let pct = (usdc / seed as f64 * 100.0).round() as i128;
            match measure(30, root, seed, 0, pct.max(1)) {
                Some((_, a)) => cells.push(std::format!("{:>10.0} bps", a)),
                None => cells.push(std::format!("{:>14}", "n/a")),
            }
        }
        std::println!("{:>12}  {}  {}  {}  {}", root, cells[0], cells[1], cells[2], cells[3]);
    }
    std::println!("\n  the vault quotes 300 bps; its calibrated ceiling is 312 bps");
    std::println!("  a market quote far from 300 on a trivial trade is what #34 asks about");
}


// ═════════════════════════════════════════════════════════════════════════════════════════════
// 4. Is the response scale-free, and what is the closed form?
// ═════════════════════════════════════════════════════════════════════════════════════════════

/// If the same trade *as a share of the pool* moves the quote by the same amount regardless of how
/// big the pool is, then `scalar_root` can be chosen once — independent of the seed — against a
/// single question: "how far may a trade of X% of the pool move the quote?"
///
/// If it is NOT scale-free, `scalar_root` has to be re-picked whenever liquidity changes, which
/// would make it a much worse parameter to hard-code.
#[test]
fn scalar_calibration_4_scale_free_and_closed_form() {
    std::println!("\n=== 4a. Same %-of-pool trade at different seed sizes (scalar_root = 40) ===");
    std::println!("{:>14}  {:>10}  {:>10}  {:>10}", "seed USDC/side", "1% buy", "5% buy", "25% buy");
    for seed in [20i128, 200, 2_000, 20_000] {
        let mut cells = std::vec::Vec::new();
        for pct in [1i128, 5, 25] {
            match measure(30, 40, seed, 0, pct) {
                Some((b, a)) => cells.push(std::format!("{:>+9.1}", a - b)),
                None => cells.push(std::format!("{:>10}", "n/a")),
            }
        }
        std::println!("{:>14}  {}  {}  {}", seed, cells[0], cells[1], cells[2]);
    }
    std::println!("  identical rows => scale-free: only the SHARE of the pool matters, not its size");

    // ── Fit the constant ──────────────────────────────────────────────────────────────────────
    std::println!("\n=== 4b. Closed form:  bps_move  ~=  K x trade_pct / scalar_root ===");
    std::println!("{:>12}  {:>10}  {:>12}  {:>10}", "scalar_root", "trade %", "measured bps", "implied K");
    let mut ks = std::vec::Vec::new();
    for root in [40i128, 80, 160, 320] {
        for pct in [1i128, 5, 10, 25] {
            if let Some((b, a)) = measure(30, root, 200, 0, pct) {
                let moved = (b - a).abs();
                let k = moved * root as f64 / pct as f64;
                ks.push(k);
                std::println!("{:>12}  {:>9}%  {:>12.1}  {:>10.1}", root, pct, moved, k);
            }
        }
    }
    let mean: f64 = ks.iter().sum::<f64>() / ks.len() as f64;
    let spread = ks.iter().cloned().fold(f64::MIN, f64::max) - ks.iter().cloned().fold(f64::MAX, f64::min);
    std::println!("\n  K = {:.0}  (spread across all 16 points: {:.1})", mean, spread);
    std::println!("  => scalar_root  =  K x trade_pct / acceptable_bps_move");
}


// ═════════════════════════════════════════════════════════════════════════════════════════════
// 5. What a flatter curve COSTS
// ═════════════════════════════════════════════════════════════════════════════════════════════

/// Raising `scalar_root` makes the quote steadier, which is the whole point — but steadier is not
/// free. A flat curve means a trader moves the price less for the same size, so when the fair rate
/// genuinely moves, an arbitrageur can take more before the pool re-prices. LPs pay for that.
///
/// Round-tripping (buy PT, immediately sell it back) measures it: the loss is slippage + fees, and
/// it is the toll an arbitrageur pays. A LOWER round-trip cost means cheaper arbitrage.
#[test]
fn scalar_calibration_5_what_a_flatter_curve_costs() {
    std::println!("\n=== 5. Round-trip cost of a 10%-of-pool trade (buy PT, sell straight back) ===");
    std::println!("  higher round-trip = arbitrage is more expensive = LPs better protected\n");
    std::println!("{:>12}  {:>16}  {:>18}", "scalar_root", "10% buy moves", "round-trip cost");

    for root in [40i128, 80, 160, 320, 640] {
        let w = setup_with_scalar(30 * DAY, 300, LN_FEE_ROOT, TREASURY_SHARE_BPS, root * SCALAR_12);
        let seed = 2_000 * USDC;
        w.seed(seed, seed);

        let before = apy_bps(w.m().implied_apy());
        let sr_in = seed / 10;
        let (t, sr) = w.user_with_sr(sr_in);

        let pt_out = match w.m().try_swap_exact_sr_for_pt(&t, &sr, &0i128, &u32::MAX) {
            Ok(Ok(v)) => v,
            _ => { std::println!("{:>12}  {:>16}  {:>18}", root, "n/a", "n/a"); continue; }
        };
        let after = apy_bps(w.m().implied_apy());

        // Sell it straight back.
        let sr_back = match w.m().try_swap_exact_pt_for_sr(&t, &pt_out, &0i128, &u32::MAX) {
            Ok(Ok(v)) => v,
            _ => { std::println!("{:>12}  {:>16.1}  {:>18}", root, after - before, "sell failed"); continue; }
        };
        let cost_bps = (sr_in - sr_back) as f64 / sr_in as f64 * 10_000.0;

        std::println!("{:>12}  {:>13.1} bps  {:>14.1} bps", root, after - before, cost_bps);
    }
    std::println!("\n  the trade-off: raising scalar_root steadies the quote AND cheapens arbitrage");
}
