#![cfg(test)]
//! # Blend parameter calibration harness
//!
//! These are **measurements, not regression assertions**. Every parameter Spield derives from
//! Blend's behaviour is calibrated here against the **real Blend v2 WASM** driven to the states
//! that matter, rather than against a remembered formula or a convenient round number.
//!
//! Run with output:
//! ```text
//! cargo test -p spield-strategy --lib calibration -- --nocapture --test-threads=1
//! ```
//!
//! The reserve is configured with the **live mainnet FixedV2 USDC parameters** (read on chain
//! 2026-08-29), not `blend_contract_sdk::testutils::default_reserve_config()`. That matters more
//! than it sounds: the SDK default has `r_three = 150%` while FixedV2 has **500%**, so a harness
//! built on the default would understate the top of the rate curve by 3.3x and quietly pass a
//! `max_apr_bps` that the real pool can breach.
//!
//! Findings are written up in `blendcalibration.md`.

extern crate std;

use blend_contract_sdk::{pool, testutils::BlendFixture};
use sep_40_oracle::testutils::{Asset, MockPriceOracleClient, MockPriceOracleWASM};
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, Ledger as _},
    token::StellarAssetClient,
    vec, Address, BytesN, Env, String, Symbol, Vec,
};

const SCALAR_7: i128 = 1_0000000;
const SCALAR_12: i128 = 1_000_000_000_000;
const USDC: i128 = 1_0000000;
const SECONDS_PER_YEAR: u64 = 365 * 24 * 60 * 60;

const REQ_SUPPLY_COLLATERAL: u32 = 2;
const REQ_BORROW: u32 = 4;

/// The **live mainnet FixedV2 USDC reserve config**, read from chain on 2026-08-29.
///
/// `get_reserve(USDC).config` on `CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD`:
/// `{c_factor: 9500000, l_factor: 9500000, util: 8000000, max_util: 9000000, r_base: 300000,
///   r_one: 400000, r_two: 1200000, r_three: 50000000, reactivity: 20, decimals: 7}`
fn fixedv2_reserve_config() -> pool::ReserveConfig {
    pool::ReserveConfig {
        decimals: 7,
        c_factor: 0_9500000,
        l_factor: 0_9500000,
        util: 0_8000000,      // 80% target
        max_util: 0_9000000,  // 90% ceiling on new borrows / withdrawals
        r_base: 0_0300000,    // 3%
        r_one: 0_0400000,     // 4%
        r_two: 0_1200000,     // 12%
        r_three: 5_0000000,   // 500%  <- the SDK default is 1_5000000; this is the real one
        reactivity: 20,
        index: 0,
        supply_cap: 100_000_000_0000000,
        enabled: true,
    }
}

/// FixedV2's pool-level backstop take rate: 20% (the SDK fixture and testnet both use 10%).
const FIXEDV2_BSTOP_RATE: u32 = 0_2000000;

struct Venue {
    env: Env,
    pool: Address,
    usdc: Address,
    oracle_id: Address,
}

impl Venue {
    fn pool_client(&self) -> pool::Client<'_> {
        pool::Client::new(&self.env, &self.pool)
    }
    fn oracle(&self) -> MockPriceOracleClient<'_> {
        MockPriceOracleClient::new(&self.env, &self.oracle_id)
    }
    /// `(b_rate, d_rate, ir_mod, utilization)` accrued to the current ledger.
    fn reserve(&self) -> (i128, i128, i128, f64) {
        let r = self.pool_client().get_reserve(&self.usdc);
        let supplied = r.data.b_supply * r.data.b_rate / SCALAR_12;
        let borrowed = r.data.d_supply * r.data.d_rate / SCALAR_12;
        let util = if supplied > 0 {
            borrowed as f64 / supplied as f64
        } else {
            0.0
        };
        (r.data.b_rate, r.data.d_rate, r.data.ir_mod, util)
    }
    fn advance(&self, secs: u64) {
        let t = self.env.ledger().timestamp();
        self.env.ledger().set_timestamp(t + secs);
        self.oracle()
            .set_price_stable(&vec![&self.env, 1_0000000, 1_0000000]);
        self.pool_client().get_reserve(&self.usdc);
    }
}

fn register_sac<'a>(env: &'a Env, admin: &Address) -> (Address, StellarAssetClient<'a>) {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let addr = sac.address();
    (addr.clone(), StellarAssetClient::new(env, &addr))
}

/// A Blend pool carrying FixedV2's real USDC curve, with the whale borrowing `borrow_pct` of the
/// USDC he supplied (so utilization starts wherever the experiment needs it).
fn setup(borrow_pct: i128) -> Venue {
    setup_with_max_util(borrow_pct, 0_9000000)
}

/// Same venue, but with `max_util` overridden so a test can borrow into the steep `r_three` branch
/// directly. Everything else stays at FixedV2's real values — only the ceiling on how far a
/// borrower may push utilization changes, which is what gates access to that branch.
fn setup_with_max_util(borrow_pct: i128, max_util: u32) -> Venue {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);
    env.cost_estimate().budget().reset_unlimited();

    let admin = Address::generate(&env);
    let (blnd, _) = register_sac(&env, &admin);
    let (usdc, usdc_admin) = register_sac(&env, &admin);
    let (xlm, xlm_admin) = register_sac(&env, &admin);

    let blend = BlendFixture::deploy(&env, &admin, &blnd, &usdc);

    let oracle_id = Address::generate(&env);
    env.register_at(&oracle_id, MockPriceOracleWASM, ());
    let oracle = MockPriceOracleClient::new(&env, &oracle_id);
    oracle.set_data(
        &admin,
        &Asset::Other(Symbol::new(&env, "USD")),
        &vec![&env, Asset::Stellar(xlm.clone()), Asset::Stellar(usdc.clone())],
        &7,
        &300,
    );
    oracle.set_price_stable(&vec![&env, 1_0000000, 1_0000000]);

    let pool = blend.pool_factory.deploy(
        &admin,
        &String::from_str(&env, "fixedv2-clone"),
        &BytesN::<32>::random(&env),
        &oracle_id,
        &FIXEDV2_BSTOP_RATE,
        &6,
        &1_0000000,
    );
    let pool_client = pool::Client::new(&env, &pool);

    let mut cfg = fixedv2_reserve_config();
    cfg.max_util = max_util;
    cfg.index = 0;
    pool_client.queue_set_reserve(&xlm, &cfg);
    pool_client.set_reserve(&xlm);
    cfg.index = 1;
    pool_client.queue_set_reserve(&usdc, &cfg);
    pool_client.set_reserve(&usdc);

    blend.backstop.deposit(&admin, &pool, &50_000_0000000);
    pool_client.set_status(&3);
    pool_client.update_status();

    let whale = Address::generate(&env);
    xlm_admin.mint(&whale, &(10_000_000 * SCALAR_7));
    usdc_admin.mint(&whale, &(10_000_000 * USDC));
    let supply = 200_000 * USDC;
    pool_client.submit(
        &whale,
        &whale,
        &whale,
        &Vec::from_array(
            &env,
            [
                pool::Request { request_type: REQ_SUPPLY_COLLATERAL, address: xlm.clone(), amount: 5_000_000 * SCALAR_7 },
                pool::Request { request_type: REQ_SUPPLY_COLLATERAL, address: usdc.clone(), amount: supply },
                pool::Request { request_type: REQ_BORROW, address: usdc.clone(), amount: supply * borrow_pct / 100 },
            ],
        ),
    );

    Venue { env, pool, usdc, oracle_id }
}

/// Annualized growth of `b_rate` between two samples, in basis points — the exact quantity
/// `check_rate_bound_timed` bounds with `max_apr_bps`.
fn annualized_bps(b0: i128, b1: i128, dt: u64) -> f64 {
    if b0 <= 0 || dt == 0 {
        return f64::NAN;
    }
    ((b1 - b0) as f64 / b0 as f64) * (SECONDS_PER_YEAR as f64 / dt as f64) * 10_000.0
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// A. max_apr_bps — can a LEGITIMATE Blend state exceed the 30,000 bps (300% APR) bound?
// ═════════════════════════════════════════════════════════════════════════════════════════════

/// Sweep utilization across Blend's whole range and record, at each point, the annualized growth
/// of BOTH rates: `d_rate` (what borrowers pay) and `b_rate` (what suppliers earn — the quantity
/// `check_rate_bound_timed` actually bounds).
///
/// Measured over a SHORT window at each point so `ir_mod` barely moves and the reading is the
/// instantaneous curve rather than a blend of curve and modifier drift.
///
/// This is the number `max_apr_bps` must sit above. If a legitimate pool state can produce growth
/// beyond it, `current_rate` panics `RateOutOfBounds` and **every deposit and every redeem
/// reverts** — during precisely the liquidity crisis when holders most need to exit.
#[test]
fn calibration_a_rate_curve_sweep() {
    std::println!("\n=== A1. Rate curve sweep, mainnet FixedV2 config (short windows, ir_mod ~fixed) ===");
    std::println!(
        "{:>8}  {:>9}  {:>16}  {:>16}  {:>10}",
        "util", "ir_mod", "borrow APR bps", "supply APR bps", "vs 30000"
    );

    // Blend refuses new borrows above max_util (90%), so this is the reachable range by borrowing.
    let mut peak_supply = 0.0f64;
    let mut peak_at = 0.0f64;
    for pct in [25i128, 50, 70, 80, 85, 88, 89] {
        let v = setup(pct);
        let window = 3600u64; // one hour: long enough to accrue, short enough that ir_mod is ~static
        let (b0, d0, _, _) = v.reserve();
        v.advance(window);
        let (b1, d1, ir, util) = v.reserve();
        let sup = annualized_bps(b0, b1, window);
        let bor = annualized_bps(d0, d1, window);
        if sup > peak_supply {
            peak_supply = sup;
            peak_at = util;
        }
        std::println!(
            "{:>7.2}%  {:>9.4}  {:>16.0}  {:>16.0}  {:>10}",
            util * 100.0,
            ir as f64 / SCALAR_7 as f64,
            bor,
            sup,
            if sup > 30_000.0 { "BREACH" } else { "ok" }
        );
    }
    std::println!(
        "  peak supply APR reachable by BORROWING: {:.0} bps at {:.2}% utilization",
        peak_supply, peak_at * 100.0
    );

    // ── Above max_util: only reachable passively, as debt accrues faster than supply. ──────────
    std::println!("\n=== A2. Above max_util — passive drift, where the r_three ramp lives ===");
    std::println!(
        "{:>9}  {:>9}  {:>9}  {:>16}  {:>16}  {:>10}",
        "elapsed", "util", "ir_mod", "borrow APR bps", "supply APR bps", "vs 30000"
    );

    let v = setup(89);
    let mut peak_bps = 0.0f64;
    let mut peak_util = 0.0f64;
    let mut peak_ir = 0i128;
    let mut elapsed_total = 0u64;
    let step = SECONDS_PER_YEAR / 12; // monthly

    for i in 0..180 {
        let (b0, d0, _, _) = v.reserve();
        v.advance(step);
        elapsed_total += step;
        let (b1, d1, ir, util) = v.reserve();
        let sup = annualized_bps(b0, b1, step);
        let bor = annualized_bps(d0, d1, step);
        if sup > peak_bps {
            peak_bps = sup;
            peak_util = util;
            peak_ir = ir;
        }
        if i % 24 == 0 || sup > 30_000.0 {
            std::println!(
                "{:>8}y  {:>8.2}%  {:>9.4}  {:>16.0}  {:>16.0}  {:>10}",
                elapsed_total / SECONDS_PER_YEAR,
                util * 100.0,
                ir as f64 / SCALAR_7 as f64,
                bor,
                sup,
                if sup > 30_000.0 { "BREACH" } else { "ok" }
            );
        }
    }

    std::println!(
        "\n  PEAK annualized b_rate growth over 15 simulated years: {:.0} bps ({:.2}% APR)",
        peak_bps,
        peak_bps / 100.0
    );
    std::println!(
        "    at utilization {:.2}%, ir_mod {:.4}",
        peak_util * 100.0,
        peak_ir as f64 / SCALAR_7 as f64
    );
    std::println!(
        "  configured max_apr_bps: 30000 bps (300% APR)  ->  headroom {:.0}x",
        30_000.0 / peak_bps.max(1.0)
    );

    assert!(peak_bps > 0.0, "the pool must actually accrue for this to measure anything");
}

/// Blend's `ir_mod` bounds, observed rather than assumed. The calibration rule in
/// `scripts/blend_rate.mjs` stresses `ir_mod` down to 1.0; that is only a *moderate* stress if the
/// real floor is well below it, and `max_apr_bps` only holds if the real ceiling is not far above.
#[test]
fn calibration_b_ir_mod_bounds() {
    std::println!("\n=== B. ir_mod bounds (mainnet FixedV2 curve) ===");

    // Above target for a long time -> ir_mod climbs.
    let hi = setup(89);
    let mut max_ir = 0i128;
    for _ in 0..40 {
        hi.advance(SECONDS_PER_YEAR / 4);
        let (_, _, ir, _) = hi.reserve();
        if ir > max_ir {
            max_ir = ir;
        }
    }
    let (_, _, _, hi_util) = hi.reserve();

    // Far below target for a long time -> ir_mod decays toward its floor.
    let lo = setup(5);
    let mut min_ir = i128::MAX;
    for _ in 0..40 {
        lo.advance(SECONDS_PER_YEAR / 4);
        let (_, _, ir, _) = lo.reserve();
        if ir < min_ir {
            min_ir = ir;
        }
    }
    let (_, _, _, lo_util) = lo.reserve();

    std::println!(
        "  sustained ABOVE target (util ended {:.2}%): ir_mod reached {:.4}",
        hi_util * 100.0,
        max_ir as f64 / SCALAR_7 as f64
    );
    std::println!(
        "  sustained BELOW target (util ended {:.2}%): ir_mod fell to  {:.4}",
        lo_util * 100.0,
        min_ir as f64 / SCALAR_7 as f64
    );
    std::println!(
        "  live readings 2026-08-29: mainnet FixedV2 1.4899, testnet TestnetV2 0.1067"
    );

    assert!(max_ir > 0 && min_ir < i128::MAX, "both runs must observe an ir_mod");
}


/// Exercise the **third rate branch** (`r_three`, above the 95% kink) directly by raising
/// `max_util` so a borrower can reach it, with `ir_mod` still ~1. Passive drift cannot isolate this
/// — it moves utilization and `ir_mod` together, and the reading becomes a blend of both.
///
/// This is the branch that decides whether `max_apr_bps = 30000` is safe: FixedV2 carries
/// `r_three = 500%`, which is 3.3x the `blend_contract_sdk` default the rest of the suite uses.
#[test]
fn calibration_a3_third_branch_is_where_the_ceiling_lives() {
    std::println!("\n=== A3. The r_three branch, reached by borrowing (ir_mod ~1) ===");
    std::println!(
        "{:>8}  {:>9}  {:>16}  {:>16}  {:>10}",
        "util", "ir_mod", "borrow APR bps", "supply APR bps", "vs 30000"
    );

    let mut peak = 0.0f64;
    let mut peak_at = 0.0f64;
    let mut breached = false;
    for pct in [90i128, 93, 95, 96, 97, 98, 99] {
        let v = setup_with_max_util(pct, 0_9990000);
        let window = 3600u64;
        let (b0, d0, _, _) = v.reserve();
        v.advance(window);
        let (b1, d1, ir, util) = v.reserve();
        let sup = annualized_bps(b0, b1, window);
        let bor = annualized_bps(d0, d1, window);
        if sup > peak {
            peak = sup;
            peak_at = util;
        }
        if sup > 30_000.0 {
            breached = true;
        }
        std::println!(
            "{:>7.2}%  {:>9.4}  {:>16.0}  {:>16.0}  {:>10}",
            util * 100.0,
            ir as f64 / SCALAR_7 as f64,
            bor,
            sup,
            if sup > 30_000.0 { "BREACH" } else { "ok" }
        );
    }

    std::println!(
        "\n  peak supply APR on the r_three branch at ir_mod~1: {:.0} bps ({:.1}% APR) at {:.2}% util",
        peak, peak / 100.0, peak_at * 100.0
    );
    std::println!(
        "  max_apr_bps = 30000  ->  {}",
        if breached { "BREACHED by a legitimate pool state" } else { "not breached at ir_mod~1" }
    );
    std::println!(
        "  NOTE: ir_mod multiplies this. At the observed ceiling (see B) the figures above scale up."
    );

    assert!(peak > 0.0);
}

/// Print the raw reserve fields so every scale used above is verifiable rather than assumed.
#[test]
fn calibration_a4_raw_reserve_fields() {
    let v = setup(89);
    v.advance(3600);
    let r = v.pool_client().get_reserve(&v.usdc);
    std::println!("\n=== A4. Raw reserve fields (scales, verifiable) ===");
    std::println!("  b_rate   {}  (SCALAR_12 -> {:.6})", r.data.b_rate, r.data.b_rate as f64 / SCALAR_12 as f64);
    std::println!("  d_rate   {}  (SCALAR_12 -> {:.6})", r.data.d_rate, r.data.d_rate as f64 / SCALAR_12 as f64);
    std::println!("  ir_mod   {}  (SCALAR_7  -> {:.4})", r.data.ir_mod, r.data.ir_mod as f64 / SCALAR_7 as f64);
    std::println!("  b_supply {}", r.data.b_supply);
    std::println!("  d_supply {}", r.data.d_supply);
    std::println!("  backstop_credit {}", r.data.backstop_credit);
    std::println!("  config: util {} max_util {} r_base {} r_one {} r_two {} r_three {}",
        r.config.util, r.config.max_util, r.config.r_base, r.config.r_one, r.config.r_two, r.config.r_three);
}


/// Can the real FixedV2 pool — `max_util = 90%` — actually REACH the `r_three` branch?
///
/// Borrowers cannot push past `max_util`. The only route is passive: debt accruing faster than
/// supply. A2 showed the rate FALLING along that path, which contradicts a monotonic curve, so
/// this measures Blend's own utilization (against real cash) rather than inferring it from
/// share counts, and reports the pool status alongside.
#[test]
fn calibration_a5_is_the_steep_branch_reachable_at_max_util_90() {
    let v = setup(89);
    let token = soroban_sdk::token::TokenClient::new(&v.env, &v.usdc);

    std::println!("\n=== A5. Is the r_three branch reachable when max_util = 90%? ===");
    std::println!(
        "{:>8}  {:>12}  {:>12}  {:>8}  {:>16}",
        "elapsed", "util(shares)", "util(cash)", "status", "supply APR bps"
    );

    let step = SECONDS_PER_YEAR / 4;
    let mut elapsed = 0u64;
    let mut peak_cash_util = 0.0f64;
    for i in 0..40 {
        let (b0, _, _, _) = v.reserve();
        v.advance(step);
        elapsed += step;
        let (b1, _, _, util_shares) = v.reserve();
        let r = v.pool_client().get_reserve(&v.usdc);
        let borrowed = r.data.d_supply * r.data.d_rate / SCALAR_12;
        let cash = token.balance(&v.pool);
        let util_cash = if borrowed + cash > 0 {
            borrowed as f64 / (borrowed + cash) as f64
        } else {
            0.0
        };
        if util_cash > peak_cash_util {
            peak_cash_util = util_cash;
        }
        let status = v.pool_client().get_config().status;
        if i % 6 == 0 {
            std::println!(
                "{:>7}y  {:>11.2}%  {:>11.2}%  {:>8}  {:>16.0}",
                elapsed / SECONDS_PER_YEAR,
                util_shares * 100.0,
                util_cash * 100.0,
                status,
                annualized_bps(b0, b1, step)
            );
        }
    }
    std::println!(
        "\n  peak CASH utilization over 10 simulated years of an unrepaid pool: {:.2}%",
        peak_cash_util * 100.0
    );
    std::println!(
        "  the r_three branch starts at 95%  ->  {}",
        if peak_cash_util > 0.95 { "REACHED" } else { "NOT reached by drift alone" }
    );
}


/// Deploy the real adapter against a Blend pool in a stressed-but-legitimate state and show what
/// `max_apr_bps = 30000` actually does when the venue outruns it.
///
/// This is the decisive test. A2/A5 measured the rate; this measures the CONSEQUENCE: when
/// `check_rate_bound_timed` rejects, `current_rate` panics, and `current_rate` is the first line of
/// `redeem` — so **holders cannot exit**, in exactly the crisis that produced the rate.
#[test]
fn calibration_c_a_legitimate_rate_spike_freezes_exits() {
    use crate::{BlendStrategy, BlendStrategyClient};
    use soroban_sdk::token::StellarAssetClient;

    // A pool that permits the steep branch, driven to ir_mod's ceiling by sustained over-target
    // utilization — both states Blend reaches on its own, neither one an attack.
    let v = setup_with_max_util(96, 0_9990000);
    for _ in 0..24 {
        v.advance(SECONDS_PER_YEAR / 12);
    }
    let (_, _, ir, _) = v.reserve();

    let wrapper = Address::generate(&v.env);
    let admin = Address::generate(&v.env);
    let sid = v.env.register(BlendStrategy, (admin.clone(),));
    let strategy = BlendStrategyClient::new(&v.env, &sid);
    strategy.initialize(&wrapper, &v.pool, &v.usdc, &30_000u32);

    StellarAssetClient::new(&v.env, &v.usdc).mint(&wrapper, &(10_000 * USDC));
    strategy.deposit(&wrapper, &(10_000 * USDC));

    let (last_rate, _, max_apr) = strategy.rate_bound();
    let (b0, _, _, _) = v.reserve();

    // One hour later — a perfectly ordinary gap between two reads.
    let window = 3600u64;
    v.advance(window);
    let (b1, _, _, util) = v.reserve();
    let observed = annualized_bps(b0, b1, window);

    std::println!("\n=== C. Consequence of a legitimate rate spike ===");
    std::println!("  pool state      : utilization {:.2}%, ir_mod {:.4}", util * 100.0, ir as f64 / SCALAR_7 as f64);
    std::println!("  observed rate   : {:.0} bps annualized b_rate growth", observed);
    std::println!("  max_apr_bps     : {}", max_apr);
    std::println!("  stored last_rate: {}", last_rate);

    let res = strategy.try_current_rate();
    match res {
        Ok(_) => std::println!("  current_rate()  : OK — the bound held at this rate"),
        Err(_) => std::println!("  current_rate()  : PANICKED (RateOutOfBounds) -> deposit AND redeem both revert"),
    }
    std::println!(
        "  => {}",
        if res.is_err() {
            "EXITS ARE FROZEN. Recovery needs an admin set_max_apr_bps; until then nobody can withdraw."
        } else {
            "no freeze at this rate; the bound had enough headroom here"
        }
    );
}


/// The reachability question that decides whether C is a real risk or a theoretical one:
/// with FixedV2's **actual** `max_util = 90%`, does an unrepaid pool ever produce b_rate growth
/// above `max_apr_bps = 30000`?
///
/// Borrowers cannot cross 90%. Only accrual can, and only slowly. This runs the clock and reports
/// the first moment (if any) at which the bound would reject a read.
#[test]
fn calibration_c2_reachability_at_the_real_max_util() {
    let v = setup(89); // FixedV2's real max_util = 90%
    let token = soroban_sdk::token::TokenClient::new(&v.env, &v.usdc);

    std::println!("\n=== C2. Reachability at FixedV2's real max_util = 90% ===");
    std::println!(
        "{:>8}  {:>11}  {:>9}  {:>16}  {:>10}",
        "elapsed", "util(cash)", "ir_mod", "supply APR bps", "vs 30000"
    );

    let step = SECONDS_PER_YEAR / 12;
    let mut elapsed = 0u64;
    let mut peak = 0.0f64;
    let mut breach_year: Option<u64> = None;

    for i in 0..600 {
        let (b0, _, _, _) = v.reserve();
        v.advance(step);
        elapsed += step;
        let (b1, _, ir, _) = v.reserve();
        let sup = annualized_bps(b0, b1, step);
        if sup > peak {
            peak = sup;
        }
        if sup > 30_000.0 && breach_year.is_none() {
            breach_year = Some(elapsed / SECONDS_PER_YEAR);
        }
        let r = v.pool_client().get_reserve(&v.usdc);
        let borrowed = r.data.d_supply * r.data.d_rate / SCALAR_12;
        let cash = token.balance(&v.pool);
        let util_cash = borrowed as f64 / (borrowed + cash) as f64;
        if i % 60 == 0 || (sup > 30_000.0 && breach_year == Some(elapsed / SECONDS_PER_YEAR)) {
            std::println!(
                "{:>7}y  {:>10.2}%  {:>9.4}  {:>16.0}  {:>10}",
                elapsed / SECONDS_PER_YEAR,
                util_cash * 100.0,
                ir as f64 / SCALAR_7 as f64,
                sup,
                if sup > 30_000.0 { "BREACH" } else { "ok" }
            );
        }
    }

    std::println!("\n  peak supply APR over 50 simulated years: {:.0} bps ({:.1}% APR)", peak, peak / 100.0);
    match breach_year {
        Some(y) => std::println!("  max_apr_bps 30000 first BREACHED after ~{}y of an unrepaid pool", y),
        None => std::println!("  max_apr_bps 30000 NEVER breached on this path (headroom {:.1}x)", 30_000.0 / peak.max(1.0)),
    }
}
