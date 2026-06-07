#![no_std]
//! # spield-market — the PT/USDC time-decay AMM (Phase 3, **Stage C**)
//!
//! Lets users trade PT against USDC and lets LPs earn fees. This is the *trading* layer that turns
//! v1's fake escrow into a real venue (plan §6). One fixed-term pool per maturity.
//!
//! ## The time-decay yield curve (the differentiator)
//! Pricing is the Pendle V2 / Notional **log curve** (see `curve.rs` + `PHASE3_AMM_DESIGN.md` §2),
//! built on the audited `spield-shared::amm_math` fixed-point `ln`/`exp`:
//! ```text
//! exchangeRate = ln(proportion/(1-proportion)) / rateScalar + rateAnchor   // USDC per PT
//! rateScalar   = scalarRoot / yearsToMaturity                              // steepens as t → 0
//! ```
//! As `t → maturity`, `rateScalar → ∞`, the curve flattens onto `rateAnchor` and **PT price drifts
//! to par (1.0)** — so LPs who hold to maturity bear ~no impermanent loss for PT's predictable march
//! to par. This is the SCF-#11 answer made real; constant-product (Stage A) is gone from the swap
//! path. `implied_apy()` falls straight out of the PT price + time to maturity.
//!
//! Stage A's plumbing — LP share accounting, token wiring, slippage guards, the maturity halt, the
//! pause + fee-ceiling guardrails, the reserve invariants — carries over unchanged; only the swap
//! pricing core changed to the curve.
//!
//! ## Trust model
//! * **LP funds: trustless** — shares are proportional claims on the reserves; redeem any time.
//! * **Admin (sets fee within an on-chain ceiling, pauses): trusted, single-key → multisig-pathed.**
//!   Cannot move LP funds; the worst a bad fee does is make trading uneconomic.

mod curve;
mod events;
mod storage;

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, panic_with_error, token, Address, BytesN, Env, String,
};
use spield_shared::{governance, math, Error};

/// Integer square root (Newton) for the first LP's share seeding (`sqrt(pt*usdc)`), mirroring
/// Uniswap-V2's initial-mint. Operates on the host i128; inputs are non-negative.
fn isqrt(n: i128) -> i128 {
    if n <= 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

#[contract]
pub struct Market;

#[contractimpl]
impl Market {
    /// One-shot, admin-gated init (SCF #7). The market is told its PT/USDC SACs and maturity
    /// explicitly — they must match the wrapper market this pool trades against (the deploy script
    /// reads them from the wrapper and passes them here, exactly like the vault's `underlying`).
    ///
    /// * `admin` — operational admin (sets fee, pauses; cannot move LP funds).
    /// * `pt` — the Principal Token SAC (a pool reserve).
    /// * `usdc` — the settlement SAC (the other pool reserve, what PT trades against / redeems into).
    /// * `maturity` — unix seconds; trading halts at/after it (PT then just redeems 1:1 via wrapper).
    /// * `fee_bps` — initial swap fee, must be ≤ `max_fee_bps`.
    /// * `max_fee_bps` — hard ceiling on any future fee (guardrail).
    /// * `scalar_root` — curve steepness root (SCALAR_12); `rateScalar = scalar_root / yearsToMat`.
    ///   A larger root ⇒ steeper ⇒ less price impact per trade. Set from the target liquidity depth.
    /// * `rate_anchor` — the curve's anchor (SCALAR_12, USDC per PT at proportion 0.5). Set near the
    ///   target opening PT price so the pool opens at ~the vault's fixed rate. Must be > 0.
    pub fn initialize(
        env: Env,
        admin: Address,
        pt: Address,
        usdc: Address,
        maturity: u64,
        fee_bps: u32,
        max_fee_bps: u32,
        scalar_root: i128,
        rate_anchor: i128,
    ) {
        if storage::is_initialized(&env) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        admin.require_auth();
        if fee_bps > max_fee_bps {
            panic_with_error!(&env, Error::FeeNotAllowed);
        }
        if scalar_root <= 0 || rate_anchor <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        storage::set_initialized(&env);
        storage::set_admin(&env, &admin);
        storage::set_pt(&env, &pt);
        storage::set_underlying(&env, &usdc);
        storage::set_maturity(&env, maturity);
        storage::set_fee_bps(&env, fee_bps);
        storage::set_max_fee_bps(&env, max_fee_bps);
        storage::set_scalar_root(&env, scalar_root);
        storage::set_rate_anchor(&env, rate_anchor);
        storage::set_paused(&env, false);
        storage::set_pt_reserve(&env, 0);
        storage::set_usdc_reserve(&env, 0);
        storage::set_total_shares(&env, 0);
        governance::init(&env);
        storage::bump_instance(&env);
    }

    /// Add liquidity: pull `pt_in` PT and `usdc_in` USDC from `lp` into the pool and mint LP shares.
    ///
    /// * **First LP** sets the pool's price; shares minted = `sqrt(pt_in * usdc_in)` (Uniswap-V2
    ///   style). It defines the initial PT/USDC ratio (the deploy script seeds this near the vault's
    ///   fixed rate).
    /// * **Later LPs** must supply at the pool's *current* ratio (within a dust tolerance) so they
    ///   don't move the price or dilute existing LPs; shares minted are proportional to the deposit.
    ///
    /// Returns the LP shares minted.
    pub fn add_liquidity(env: Env, lp: Address, pt_in: i128, usdc_in: i128) -> i128 {
        Self::ensure_can_trade(&env); // inflow — blocked while paused
        lp.require_auth();
        if pt_in <= 0 || usdc_in <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let pt_res = storage::pt_reserve(&env);
        let usdc_res = storage::usdc_reserve(&env);
        let total = storage::total_shares(&env);

        let shares = if total == 0 || pt_res == 0 || usdc_res == 0 {
            // First provision — seed shares from the geometric mean of the deposit.
            let s = isqrt(
                math::mul_div_floor(&env, pt_in, usdc_in, 1)
                    .unwrap_or_else(|e| panic_with_error!(&env, e)),
            );
            if s <= 0 {
                panic_with_error!(&env, Error::InvalidAmount);
            }
            s
        } else {
            // Later LP: deposit must match the current reserve ratio. We mint the lesser of the two
            // proportional share amounts and require they agree within a tiny tolerance so a
            // mismatched (price-moving) deposit is rejected rather than silently re-pricing.
            let by_pt = math::mul_div_floor(&env, pt_in, total, pt_res)
                .unwrap_or_else(|e| panic_with_error!(&env, e));
            let by_usdc = math::mul_div_floor(&env, usdc_in, total, usdc_res)
                .unwrap_or_else(|e| panic_with_error!(&env, e));
            let (lo, hi) = if by_pt < by_usdc {
                (by_pt, by_usdc)
            } else {
                (by_usdc, by_pt)
            };
            // Tolerance scales with size: reject deposits that are off-ratio by > ~0.1%.
            let tol = (hi / 1000) + 1;
            if hi - lo > tol {
                panic_with_error!(&env, Error::ImbalancedLiquidity);
            }
            lo
        };

        // Move the LP's tokens into the pool (LP authorizes these transfers directly).
        let me = env.current_contract_address();
        token::Client::new(&env, &storage::get_pt(&env)).transfer(&lp, &me, &pt_in);
        token::Client::new(&env, &storage::get_underlying(&env)).transfer(&lp, &me, &usdc_in);

        storage::set_pt_reserve(&env, pt_res + pt_in);
        storage::set_usdc_reserve(&env, usdc_res + usdc_in);
        storage::set_total_shares(&env, total + shares);
        storage::save_shares(&env, &lp, storage::shares_of(&env, &lp) + shares);
        storage::bump_instance(&env);

        events::added(&env, &lp, pt_in, usdc_in, shares);
        Self::assert_reserves_sane(&env);
        shares
    }

    /// Remove liquidity: burn `shares` LP shares and return the proportional PT + USDC to `lp`.
    /// Allowed any time (including after maturity, so LPs can always exit). Returns `(pt_out,
    /// usdc_out)`.
    pub fn remove_liquidity(env: Env, lp: Address, shares: i128) -> (i128, i128) {
        Self::ensure_initialized(&env); // LP exit — allowed even while paused
        lp.require_auth();
        if shares <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let held = storage::shares_of(&env, &lp);
        let total = storage::total_shares(&env);
        if shares > held || shares > total {
            panic_with_error!(&env, Error::InsufficientShares);
        }

        let pt_res = storage::pt_reserve(&env);
        let usdc_res = storage::usdc_reserve(&env);
        // Proportional share of each reserve (floored — rounding favors the pool / remaining LPs).
        let pt_out = math::mul_div_floor(&env, pt_res, shares, total)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        let usdc_out = math::mul_div_floor(&env, usdc_res, shares, total)
            .unwrap_or_else(|e| panic_with_error!(&env, e));

        storage::set_pt_reserve(&env, pt_res - pt_out);
        storage::set_usdc_reserve(&env, usdc_res - usdc_out);
        storage::set_total_shares(&env, total - shares);
        storage::save_shares(&env, &lp, held - shares);

        let me = env.current_contract_address();
        if pt_out > 0 {
            token::Client::new(&env, &storage::get_pt(&env)).transfer(&me, &lp, &pt_out);
        }
        if usdc_out > 0 {
            token::Client::new(&env, &storage::get_underlying(&env)).transfer(&me, &lp, &usdc_out);
        }
        storage::bump_instance(&env);

        events::removed(&env, &lp, shares, pt_out, usdc_out);
        Self::assert_reserves_sane(&env);
        (pt_out, usdc_out)
    }

    /// Swap exactly `pt_in` PT for USDC along the curve. Reverts if the USDC out is below
    /// `min_usdc_out` (slippage guard). Trading is halted at/after maturity. Returns USDC out.
    pub fn swap_exact_pt_for_usdc(
        env: Env,
        trader: Address,
        pt_in: i128,
        min_usdc_out: i128,
    ) -> i128 {
        Self::ensure_can_trade(&env); // swap is an inflow-side op — blocked while paused
        Self::ensure_tradeable(&env);
        trader.require_auth();

        let pt_res = storage::pt_reserve(&env);
        let usdc_res = storage::usdc_reserve(&env);
        let fee = storage::get_fee_bps(&env);
        let params = Self::curve_params(&env);
        let res = curve::swap_pt_for_usdc(&env, pt_in, pt_res, usdc_res, fee, &params);
        let out = res.amount_out;
        if out < min_usdc_out {
            panic_with_error!(&env, Error::SlippageExceeded);
        }

        let me = env.current_contract_address();
        // Pull PT in (trader authorizes), pay USDC out (we authorize as the pool/invoker).
        token::Client::new(&env, &storage::get_pt(&env)).transfer(&trader, &me, &pt_in);
        token::Client::new(&env, &storage::get_underlying(&env)).transfer(&me, &trader, &out);

        storage::set_pt_reserve(&env, pt_res + pt_in);
        storage::set_usdc_reserve(&env, usdc_res - out);
        storage::bump_instance(&env);

        events::swapped(&env, &trader, true, pt_in, out);
        Self::assert_reserves_sane(&env);
        out
    }

    /// Swap exactly `usdc_in` USDC for PT along the curve. Reverts if the PT out is below
    /// `min_pt_out` (slippage guard). Trading is halted at/after maturity. Returns PT out.
    pub fn swap_exact_usdc_for_pt(
        env: Env,
        trader: Address,
        usdc_in: i128,
        min_pt_out: i128,
    ) -> i128 {
        Self::ensure_can_trade(&env); // swap is an inflow-side op — blocked while paused
        Self::ensure_tradeable(&env);
        trader.require_auth();

        let pt_res = storage::pt_reserve(&env);
        let usdc_res = storage::usdc_reserve(&env);
        let fee = storage::get_fee_bps(&env);
        let params = Self::curve_params(&env);
        let res = curve::swap_usdc_for_pt(&env, usdc_in, pt_res, usdc_res, fee, &params);
        let out = res.amount_out;
        if out < min_pt_out {
            panic_with_error!(&env, Error::SlippageExceeded);
        }

        let me = env.current_contract_address();
        token::Client::new(&env, &storage::get_underlying(&env)).transfer(&trader, &me, &usdc_in);
        token::Client::new(&env, &storage::get_pt(&env)).transfer(&me, &trader, &out);

        storage::set_usdc_reserve(&env, usdc_res + usdc_in);
        storage::set_pt_reserve(&env, pt_res - out);
        storage::bump_instance(&env);

        events::swapped(&env, &trader, false, usdc_in, out);
        Self::assert_reserves_sane(&env);
        out
    }

    // ---------- read-only views (frontend Markets/Trade/LP) ----------

    /// Quote USDC out for a PT-in swap (matches `swap_exact_pt_for_usdc` exactly).
    pub fn quote_pt_for_usdc(env: Env, pt_in: i128) -> i128 {
        let params = Self::curve_params(&env);
        curve::swap_pt_for_usdc(
            &env,
            pt_in,
            storage::pt_reserve(&env),
            storage::usdc_reserve(&env),
            storage::get_fee_bps(&env),
            &params,
        )
        .amount_out
    }

    /// Quote PT out for a USDC-in swap (matches `swap_exact_usdc_for_pt` exactly).
    pub fn quote_usdc_for_pt(env: Env, usdc_in: i128) -> i128 {
        let params = Self::curve_params(&env);
        curve::swap_usdc_for_pt(
            &env,
            usdc_in,
            storage::pt_reserve(&env),
            storage::usdc_reserve(&env),
            storage::get_fee_bps(&env),
            &params,
        )
        .amount_out
    }

    /// PT price in USDC at SCALAR_12 — the curve's `exchangeRate` at the current pool point. Drifts
    /// to par (1.0) as `now → maturity`. Returns 0 if the pool is empty.
    pub fn pt_price(env: Env) -> i128 {
        let pt_res = storage::pt_reserve(&env);
        let usdc_res = storage::usdc_reserve(&env);
        if pt_res <= 0 || usdc_res <= 0 {
            return 0;
        }
        let params = Self::curve_params(&env);
        curve::pt_price(&env, pt_res, usdc_res, &params)
    }

    /// The headline implied APY (SCALAR_12 fraction, e.g. 0.08 = 8%): the annualized return of
    /// buying PT now and redeeming at par at maturity, derived from the PT price + time to maturity.
    /// Returns 0 if the pool is empty or PT is at/above par.
    pub fn implied_apy(env: Env) -> i128 {
        let pt_res = storage::pt_reserve(&env);
        let usdc_res = storage::usdc_reserve(&env);
        if pt_res <= 0 || usdc_res <= 0 {
            return 0;
        }
        curve::implied_apy(
            &env,
            pt_res,
            usdc_res,
            storage::get_scalar_root(&env),
            storage::get_rate_anchor(&env),
            storage::get_maturity(&env),
            env.ledger().timestamp(),
        )
    }

    /// Current pool reserves `(pt, usdc)`.
    pub fn reserves(env: Env) -> (i128, i128) {
        (storage::pt_reserve(&env), storage::usdc_reserve(&env))
    }

    /// An LP's position: `(shares, pt_claim, usdc_claim)` — their shares and the reserves those
    /// shares currently redeem for.
    pub fn lp_position(env: Env, lp: Address) -> (i128, i128, i128) {
        let shares = storage::shares_of(&env, &lp);
        let total = storage::total_shares(&env);
        if total == 0 || shares == 0 {
            return (shares, 0, 0);
        }
        let pt = math::mul_div_floor(&env, storage::pt_reserve(&env), shares, total).unwrap_or(0);
        let usdc =
            math::mul_div_floor(&env, storage::usdc_reserve(&env), shares, total).unwrap_or(0);
        (shares, pt, usdc)
    }

    pub fn total_shares(env: Env) -> i128 {
        storage::total_shares(&env)
    }

    pub fn fee_bps(env: Env) -> u32 {
        storage::get_fee_bps(&env)
    }

    pub fn maturity(env: Env) -> u64 {
        storage::get_maturity(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        storage::is_paused(&env)
    }

    pub fn pt_token(env: Env) -> Address {
        storage::get_pt(&env)
    }

    pub fn underlying(env: Env) -> Address {
        storage::get_underlying(&env)
    }

    /// Curve params `(scalar_root, rate_anchor)` as configured at init (SCALAR_12).
    pub fn curve_config(env: Env) -> (i128, i128) {
        (storage::get_scalar_root(&env), storage::get_rate_anchor(&env))
    }

    pub fn version(env: Env) -> String {
        String::from_str(&env, "spield-market-0.1.0-stageC-curve")
    }

    // ---------- admin / circuit breaker ----------

    /// Set the swap fee (bps) for new trades. Bounded by the on-chain `max_fee_bps` ceiling.
    pub fn set_fee(env: Env, fee_bps: u32) {
        storage::get_admin(&env).require_auth();
        if fee_bps > storage::get_max_fee_bps(&env) {
            panic_with_error!(&env, Error::FeeNotAllowed);
        }
        storage::set_fee_bps(&env, fee_bps);
        storage::bump_instance(&env);
        events::fee_set(&env, fee_bps);
    }

    pub fn pause(env: Env) {
        storage::get_admin(&env).require_auth();
        storage::set_paused(&env, true);
        storage::bump_instance(&env);
        events::paused(&env, true);
    }

    pub fn unpause(env: Env) {
        storage::get_admin(&env).require_auth();
        storage::set_paused(&env, false);
        storage::bump_instance(&env);
        events::paused(&env, false);
    }

    // ---------- governance: admin rotation (two-step) + upgrade timelock ----------

    /// Propose a new admin (step 1 of 2). Current admin authorizes; the proposed admin must then
    /// call `accept_admin` to take control.
    pub fn propose_admin(env: Env, new_admin: Address) {
        governance::propose_admin(&env, &storage::get_admin(&env), &new_admin);
    }

    /// Accept a pending admin proposal (step 2 of 2). Must be called by the proposed admin.
    pub fn accept_admin(env: Env) {
        let new_admin = governance::accept_admin(&env);
        storage::set_admin(&env, &new_admin);
        storage::bump_instance(&env);
    }

    /// Cancel a pending admin proposal. Current admin only.
    pub fn cancel_admin_transfer(env: Env) {
        governance::cancel_admin_transfer(&env, &storage::get_admin(&env));
    }

    pub fn pending_admin(env: Env) -> Option<Address> {
        governance::pending_admin(&env)
    }

    /// Schedule a contract upgrade to `wasm_hash`, applyable after the timelock. Returns the `eta`.
    pub fn schedule_upgrade(env: Env, wasm_hash: BytesN<32>) -> u64 {
        governance::schedule_upgrade(&env, &storage::get_admin(&env), wasm_hash)
    }

    pub fn apply_upgrade(env: Env) {
        governance::apply_upgrade(&env, &storage::get_admin(&env));
    }

    pub fn cancel_upgrade(env: Env) {
        governance::cancel_upgrade(&env, &storage::get_admin(&env));
    }

    pub fn pending_upgrade(env: Env) -> Option<governance::PendingUpgrade> {
        governance::pending_upgrade(&env)
    }

    pub fn timelock(env: Env) -> u64 {
        governance::timelock(&env)
    }

    pub fn set_timelock(env: Env, secs: u64) {
        governance::set_timelock(&env, &storage::get_admin(&env), secs);
    }

    pub fn admin(env: Env) -> Address {
        storage::get_admin(&env)
    }

    // ---------------- internals ----------------

    /// Guard for **inflows** (liquidity in, swaps): initialized AND not paused. A pause blocks
    /// `add_liquidity` and both swaps so no new exposure enters during an emergency.
    fn ensure_can_trade(env: &Env) {
        if !storage::is_initialized(env) {
            panic_with_error!(env, Error::NotInitialized);
        }
        if storage::is_paused(env) {
            panic_with_error!(env, Error::Paused);
        }
    }

    /// Guard for the **LP exit** (`remove_liquidity`): initialized only — staying open while paused
    /// so a pause can never trap LP funds (mainnet-readiness #8: block inflows, allow exits).
    fn ensure_initialized(env: &Env) {
        if !storage::is_initialized(env) {
            panic_with_error!(env, Error::NotInitialized);
        }
    }

    /// Resolve the curve parameters for *this* ledger time (rate_scalar grows as maturity nears).
    /// Panics `MarketExpired` at/after maturity — quotes/prices are undefined past it.
    fn curve_params(env: &Env) -> curve::CurveParams {
        curve::params(
            env,
            storage::get_scalar_root(env),
            storage::get_rate_anchor(env),
            storage::get_maturity(env),
            env.ledger().timestamp(),
        )
    }

    /// Trading (swaps) halts at/after maturity — PT then redeems 1:1 via the wrapper, so there is no
    /// market to make. LPs can still `remove_liquidity` to exit.
    fn ensure_tradeable(env: &Env) {
        if env.ledger().timestamp() >= storage::get_maturity(env) {
            panic_with_error!(env, Error::MarketExpired);
        }
    }

    /// Defence-in-depth: reserves must never go negative. (LP/swap math is floored and bounded, so
    /// this should be unreachable; we assert it after every mutation like the wrapper/vault do.)
    fn assert_reserves_sane(env: &Env) {
        if storage::pt_reserve(env) < 0 || storage::usdc_reserve(env) < 0 {
            panic_with_error!(env, Error::InsufficientLiquidity);
        }
    }
}
