#![no_std]
//! # spield-srmarket — the PT/SR AMM
//!
//! Spield's `PendleMarket`. PT trades against **SR**, never against raw USDC.
//!
//! ## Why PT/SR and not PT/USDC
//! In a PT/USDC pool the USDC half sits dead — measured at ~50k USDC/yr forgone per 1M seeded
//! (`comparependle.md` §3.2). Here the non-PT half is SR, which keeps earning the strategy's yield
//! the entire time it is in the pool. LPs collect swap fees **and** the yield on their SR half
//! **and** PT's pull to par.
//!
//! ## What this market does differently from v1
//! | | v1 `market` | here |
//! |---|---|---|
//! | quote asset | raw USDC (idle) | **SR (yield-bearing)** |
//! | fee | flat bps on notional | **`exp(ln_fee_root × years)`** — scales with the yield traded |
//! | anchor | pinned at par ⇒ 6.96:1 seed | **re-derived each call** ⇒ any seed ratio |
//! | fee split | 100% LP, no revenue | **governed LP/treasury split** |
//! | YT trade | needed a wrapper special case | plain `mint_py` + `transfer` (the hook makes it safe) |
//!
//! ## YT trading needs no privileged entrypoint
//! Because YT is a hook-bearing token, the market can hold YT for one instant and hand it on with
//! an ordinary `transfer` — the hook settles both sides. So `buy_yt` is literally *mint the pair,
//! keep the PT, pass the YT*, and `sell_yt` is *take the YT, recombine with pool PT, split the
//! proceeds*. No `split_for_market`, no flash callback, no router allowlist.
//!
//! ## Call graph is one-directional
//! ```text
//! User -> Market -> Yield -> SR -> Strategy -> Blend
//! ```
//! Nothing calls back into the market. Soroban forbids re-entrancy by default, and this shape
//! never needs it — which is exactly why `FEATUREPLAN_BUY_YT.md`'s flash-lend design was dropped.

mod curve;
mod events;
mod storage;

#[cfg(test)]
mod test;

#[cfg(test)]
mod calibration_test;

#[cfg(test)]
mod tofix_audit;

#[cfg(test)]
mod governance_test;

#[cfg(test)]
mod economics_test;

use soroban_sdk::{contract, contractimpl, panic_with_error, token, Address, Env, BytesN, String};
use spield_shared::{
    governance,math, Error, SCALAR_12};

/// Hard ceiling on the treasury's share of swap fees. Governance can tune below this; it cannot
/// starve LPs past half the fee.
pub const MAX_TREASURY_FEE_SHARE_BPS: u32 = 5_000;

/// Hard ceiling on the annualized fee root (SCALAR_12) — 5%/yr. Well above any sane setting;
/// exists so a compromised admin cannot make trading confiscatory.
pub const MAX_LN_FEE_ROOT: i128 = SCALAR_12 / 20;

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
pub struct SrMarket;

#[contractimpl]
impl SrMarket {
    pub fn __constructor(env: Env, admin: Address, treasury: Address) {
        storage::set_admin(&env, &admin);
        storage::set_treasury(&env, &treasury);
        storage::set_paused(&env, false);
        governance::init(&env);
        storage::bump_instance(&env);
    }

    /// One-shot, admin-gated init.
    ///
    /// The market **discovers** PT, SR and expiry from the yield contract rather than being told
    /// them, so the three-way mismatch class that `tofix.md` #19 describes (a market wired to the
    /// wrong settlement asset, draining real value for a foreign token) is not expressible here.
    ///
    /// * `scalar_root` — curve steepness. Larger ⇒ flatter ⇒ less price impact per trade.
    /// * `ln_fee_root` — **annualized** fee, SCALAR_12. Measured trade-off at 90d/5%
    ///   (`calibrate_the_fee_root`), against v1's flat 30 bps which cost 0.60% / 40.5%:
    ///
    ///   | root/yr | PT round trip | YT round trip |
    ///   |---|---|---|
    ///   | 1.00% | 0.54% | 36.6% |
    ///   | 0.50% | 0.30% | 21.8% |
    ///   | **0.25%** | **0.17%** | **13.3%** ← recommended default |
    ///   | 0.10% | 0.10% | 7.9% |
    ///
    ///   A YT trader feels `leverage × fee`, and leverage at 90d/5% is ~67x — so a root that looks
    ///   negligible to a PT trader is still material to a YT trader. Pick lower for YT-focused
    ///   markets; the *shape* is fixed, only the level is a dial.
    /// * `initial_apy` — the rate the pool should open at, SCALAR_12 fraction. Stored as
    ///   `ln(1+apy)`; the anchor is derived from it, so **any** seed ratio opens at this rate.
    /// * `treasury_fee_share_bps` — protocol share of each swap fee, ≤ [`MAX_TREASURY_FEE_SHARE_BPS`].
    pub fn initialize(
        env: Env,
        yield_contract: Address,
        scalar_root: i128,
        ln_fee_root: i128,
        initial_apy: i128,
        treasury_fee_share_bps: u32,
    ) {
        if storage::is_initialized(&env) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        storage::get_admin(&env).require_auth();
        if scalar_root <= 0 || initial_apy < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if ln_fee_root < 0 || ln_fee_root > MAX_LN_FEE_ROOT {
            panic_with_error!(&env, Error::FeeNotAllowed);
        }
        if treasury_fee_share_bps > MAX_TREASURY_FEE_SHARE_BPS {
            panic_with_error!(&env, Error::FeeShareTooHigh);
        }

        let y = YieldClient::new(&env, &yield_contract);
        let pt = y.pt_token();
        let sr = y.sr_token();
        let expiry = y.expiry();
        if expiry <= env.ledger().timestamp() {
            panic_with_error!(&env, Error::SeriesExpired);
        }
        let ln_rate = curve::try_ln_rate_from_apy(&env, initial_apy)
            .unwrap_or_else(|e| panic_with_error!(&env, e));

        storage::set_initialized(&env);
        storage::set_yield(&env, &yield_contract);
        storage::set_pt(&env, &pt);
        storage::set_sr(&env, &sr);
        storage::set_expiry(&env, expiry);
        storage::set_scalar_root(&env, scalar_root);
        storage::set_ln_fee_root(&env, ln_fee_root);
        storage::set_last_ln_implied_rate(&env, ln_rate);
        storage::set_treasury_fee_share_bps(&env, treasury_fee_share_bps);
        storage::bump_instance(&env);

        events::initialized(&env, &yield_contract, &pt, &sr, expiry, scalar_root, ln_fee_root, ln_rate);
    }

    // ================= liquidity =================

    /// Add `pt_in` PT and `sr_in` SR. The first LP sets the reserve ratio — and because the anchor
    /// is dynamic, **any** ratio opens the pool at the configured rate, so a 1:1 seed is fine.
    pub fn add_liquidity(
        env: Env,
        lp: Address,
        pt_in: i128,
        sr_in: i128,
        min_shares: i128,
    ) -> i128 {
        Self::ensure_can_trade(&env);
        lp.require_auth();
        if pt_in <= 0 || sr_in <= 0 || min_shares < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let pt_res = storage::pt_reserve(&env);
        let sr_res = storage::sr_reserve(&env);
        let total = storage::total_shares(&env);

        let shares = if total == 0 || pt_res == 0 || sr_res == 0 {
            let s = isqrt(
                math::mul_div_floor(&env, pt_in, sr_in, 1)
                    .unwrap_or_else(|e| panic_with_error!(&env, e)),
            );
            if s <= 0 {
                panic_with_error!(&env, Error::InvalidAmount);
            }
            s
        } else {
            let by_pt = math::mul_div_floor(&env, pt_in, total, pt_res)
                .unwrap_or_else(|e| panic_with_error!(&env, e));
            let by_sr = math::mul_div_floor(&env, sr_in, total, sr_res)
                .unwrap_or_else(|e| panic_with_error!(&env, e));
            let (lo, hi) = if by_pt < by_sr { (by_pt, by_sr) } else { (by_sr, by_pt) };
            // `tofix.md` #26c. The 0.1% band below is the *pool's* tolerance, not the caller's, and
            // it is what makes a pre-quoted add trivially DoS-able: any swap landing first moves
            // the ratio and reverts an otherwise correct deposit, with nothing the LP can widen.
            //
            // `min_shares` is the standard AMM answer — the caller states the outcome they will
            // accept and the contract mints `min(by_pt, by_sr)`, donating the over-supplied leg.
            // So when the caller has given a bound, that bound *replaces* the band; when they have
            // not (`min_shares == 0`), the band stays as the safe default, because a naive caller
            // with no bound and no band could donate an arbitrarily large excess leg.
            //
            // This keeps every existing zero-bound caller on exactly today's behaviour.
            if min_shares == 0 && hi - lo > (hi / 1000) + 1 {
                panic_with_error!(&env, Error::ImbalancedLiquidity);
            }
            lo
        };

        // `tofix.md` #26b: the follow-on branch above can floor BOTH legs to zero once swap fees
        // have grown the reserves past `total_shares` — `hi - lo` is then 0, the ratio check
        // passes, and the deposit is consumed for no ownership at all. The first-LP branch has
        // always guarded its own result; this makes the two consistent. It must run before either
        // transfer.
        if shares <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        // `tofix.md` #26c: the ratio band above is the pool's, not the caller's. Any swap landing
        // between an LP's quote and their transaction moves the ratio and reverts an otherwise
        // correct add, with no argument to widen. `min_shares` is that argument.
        if shares < min_shares {
            panic_with_error!(&env, Error::SlippageExceeded);
        }

        let me = env.current_contract_address();
        token::Client::new(&env, &storage::get_pt(&env)).transfer(&lp, &me, &pt_in);
        SrClient::new(&env, &storage::get_sr(&env)).transfer(&lp, &me, &sr_in);

        storage::set_pt_reserve(&env, pt_res + pt_in);
        storage::set_sr_reserve(&env, sr_res + sr_in);
        storage::set_total_shares(&env, total + shares);
        storage::save_shares(&env, &lp, storage::shares_of(&env, &lp) + shares);
        Self::sync_implied_rate(&env, pt_res, sr_res);
        storage::bump_instance(&env);

        events::added(&env, &lp, pt_in, sr_in, shares);
        Self::assert_sane(&env);
        shares
    }

    /// Burn `shares` and return the proportional PT + SR. Open even while paused and after expiry,
    /// so a pause can never trap LP funds.
    pub fn remove_liquidity(env: Env, lp: Address, shares: i128, min_pt_out: i128, min_sr_out: i128) -> (i128, i128) {
        Self::ensure_initialized(&env);
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
        let sr_res = storage::sr_reserve(&env);
        let pt_out = math::mul_div_floor(&env, pt_res, shares, total)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        let sr_out = math::mul_div_floor(&env, sr_res, shares, total)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        if pt_out < min_pt_out || sr_out < min_sr_out {
            panic_with_error!(&env, Error::SlippageExceeded);
        }

        storage::set_pt_reserve(&env, pt_res - pt_out);
        storage::set_sr_reserve(&env, sr_res - sr_out);
        storage::set_total_shares(&env, total - shares);
        storage::save_shares(&env, &lp, held - shares);

        let me = env.current_contract_address();
        if pt_out > 0 {
            token::Client::new(&env, &storage::get_pt(&env)).transfer(&me, &lp, &pt_out);
        }
        if sr_out > 0 {
            SrClient::new(&env, &storage::get_sr(&env)).transfer(&me, &lp, &sr_out);
        }
        storage::bump_instance(&env);

        events::removed(&env, &lp, shares, pt_out, sr_out);
        Self::assert_sane(&env);
        (pt_out, sr_out)
    }

    // ================= PT trading =================

    /// Sell exactly `pt_in` PT for SR.
    pub fn swap_exact_pt_for_sr(
        env: Env,
        trader: Address,
        pt_in: i128,
        min_sr_out: i128,
        deadline_ledger: u32,
    ) -> i128 {
        Self::ensure_can_trade(&env);
        Self::ensure_deadline(&env, deadline_ledger);
        trader.require_auth();

        let index = Self::index(&env);
        let p = Self::params(&env, index);
        let pt_res = storage::pt_reserve(&env);
        let t = curve::try_sell_pt(&env, pt_in, pt_res, &p)
            .unwrap_or_else(|e| panic_with_error!(&env, e));

        let sr_out = Self::asset_to_sr(&env, t.asset_amount, index);
        if sr_out < min_sr_out {
            panic_with_error!(&env, Error::SlippageExceeded);
        }
        let fee_sr = Self::asset_to_sr(&env, t.fee_asset, index);
        let treasury_sr = Self::treasury_cut(&env, fee_sr);

        let me = env.current_contract_address();
        token::Client::new(&env, &storage::get_pt(&env)).transfer(&trader, &me, &pt_in);
        let sr = SrClient::new(&env, &storage::get_sr(&env));
        sr.transfer(&me, &trader, &sr_out);
        if treasury_sr > 0 {
            sr.transfer(&me, &storage::get_treasury(&env), &treasury_sr);
        }

        let pre_sr_res = storage::sr_reserve(&env);
        storage::set_pt_reserve(&env, pt_res + pt_in);
        storage::set_sr_reserve(&env, pre_sr_res - sr_out - treasury_sr);
        Self::record_treasury(&env, treasury_sr);
        Self::sync_implied_rate(&env, pt_res, pre_sr_res);
        storage::bump_instance(&env);

        events::swapped(&env, &trader, true, pt_in, sr_out, fee_sr, treasury_sr);
        Self::assert_sane(&env);
        sr_out
    }

    /// Buy PT with exactly `sr_in` SR.
    pub fn swap_exact_sr_for_pt(
        env: Env,
        trader: Address,
        sr_in: i128,
        min_pt_out: i128,
        deadline_ledger: u32,
    ) -> i128 {
        Self::ensure_can_trade(&env);
        Self::ensure_deadline(&env, deadline_ledger);
        trader.require_auth();

        let index = Self::index(&env);
        let p = Self::params(&env, index);
        let pt_res = storage::pt_reserve(&env);
        let asset_in = Self::sr_to_asset(&env, sr_in, index);
        let t = curve::try_buy_pt_exact_in(&env, asset_in, pt_res, &p)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        if t.pt_amount < min_pt_out {
            panic_with_error!(&env, Error::SlippageExceeded);
        }
        let fee_sr = Self::asset_to_sr(&env, t.fee_asset, index);
        let treasury_sr = Self::treasury_cut(&env, fee_sr);

        let me = env.current_contract_address();
        let sr = SrClient::new(&env, &storage::get_sr(&env));
        sr.transfer(&trader, &me, &sr_in);
        token::Client::new(&env, &storage::get_pt(&env)).transfer(&me, &trader, &t.pt_amount);
        if treasury_sr > 0 {
            sr.transfer(&me, &storage::get_treasury(&env), &treasury_sr);
        }

        let pre_sr_res = storage::sr_reserve(&env);
        storage::set_pt_reserve(&env, pt_res - t.pt_amount);
        storage::set_sr_reserve(&env, pre_sr_res + sr_in - treasury_sr);
        Self::record_treasury(&env, treasury_sr);
        Self::sync_implied_rate(&env, pt_res, pre_sr_res);
        storage::bump_instance(&env);

        events::swapped(&env, &trader, false, sr_in, t.pt_amount, fee_sr, treasury_sr);
        Self::assert_sane(&env);
        t.pt_amount
    }

    // ================= YT trading =================

    /// **Buy exactly `yt_out` YT.** The user funds only the YT's price; the pool funds the rest of
    /// the notional and atomically keeps the freshly minted PT.
    ///
    /// Sequence — no callback, no flash loan:
    /// 1. price it as "the pool buys `yt_out` PT" (one ordinary curve evaluation)
    /// 2. pull the user's SR share
    /// 3. `mint_py` the full notional → market holds `yt_out` PT **and** `yt_out` YT
    /// 4. `transfer` the YT to the user — **the hook settles them, so it is clean YT**
    ///
    /// ## Two live-network bugs were fixed here — do not undo either (testnet 2026-08-24)
    /// 1. **Pull `max_sr_in`, not the computed cost.** The user's payment is derived from the live
    ///    index, which moves every ledger. Wallets sign auth entries against *simulation* amounts,
    ///    so signing the computed figure fails at execution with `auth: invalid_action`. We pull the
    ///    user's own `max_sr_in` and refund the difference.
    /// 2. **The index is read through a PURE view.** `Sr::exchange_rate` no longer calls the
    ///    strategy. It used to, and `strategy::current_rate` writes its RateBound only
    ///    *conditionally* — so the footprint depended on timing and this call failed intermittently
    ///    with `storage: exceeded_limit — outside of the footprint`. With the pure read, three
    ///    consecutive brand-new users each bought YT successfully on their first attempt.
    ///
    /// Returns the SR the user paid.
    pub fn buy_yt_exact_out(
        env: Env,
        user: Address,
        yt_out: i128,
        max_sr_in: i128,
        deadline_ledger: u32,
    ) -> i128 {
        Self::ensure_can_trade(&env);
        Self::ensure_deadline(&env, deadline_ledger);
        user.require_auth();
        if yt_out <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let index = Self::index(&env);
        let p = Self::params(&env, index);
        let pt_res = storage::pt_reserve(&env);
        // The pool is buying `yt_out` PT: price exactly as if that PT were sold into it.
        let t = curve::try_sell_pt(&env, yt_out, pt_res, &p)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        if t.asset_amount >= yt_out {
            // PT at/above par: the user would be paid to take YT. Refuse.
            panic_with_error!(&env, Error::InsufficientLiquidity);
        }

        // Total SR the mint needs, then the user's share, then the pool's share BY SUBTRACTION so
        // the three always reconcile exactly.
        let total_sr = Self::asset_to_sr_ceil(&env, yt_out, index);
        let pool_sr = Self::asset_to_sr(&env, t.asset_amount, index);
        if pool_sr >= total_sr {
            panic_with_error!(&env, Error::InsufficientLiquidity);
        }
        let user_sr = total_sr - pool_sr;
        if user_sr > max_sr_in {
            panic_with_error!(&env, Error::SlippageExceeded);
        }
        let fee_sr = Self::asset_to_sr(&env, t.fee_asset, index);
        let treasury_sr = Self::treasury_cut(&env, fee_sr);
        if storage::sr_reserve(&env) < pool_sr + treasury_sr {
            panic_with_error!(&env, Error::InsufficientLiquidity);
        }

        let me = env.current_contract_address();
        let sr_addr = storage::get_sr(&env);
        let sr = SrClient::new(&env, &sr_addr);

        // Pull `max_sr_in` — NOT the computed `user_sr` — then refund the difference below.
        //
        // This is not a style choice. `user_sr` is derived from the LIVE index, which moves every
        // ledger as Blend accrues. A wallet signs its authorization entries against the amounts
        // seen during *simulation*, so by execution the computed figure has drifted and the signed
        // `transfer(user, market, X)` no longer matches the actual call — the host rejects it with
        // `auth: invalid_action` and the whole trade traps. `max_sr_in` is the user's own
        // parameter, so it is identical in simulation and execution and the signature always fits.
        //
        // Found on testnet 2026-08-24, not in the unit suite: `mock_all_auths()` authorizes any
        // amount, so this class of failure is invisible locally by construction.
        sr.transfer(&user, &me, &max_sr_in);

        // Mint the pair to OURSELVES, then hand the YT on. Legal precisely because YT has a hook.
        let yield_addr = storage::get_yield(&env);
        Self::authorize_sr_pull(&env, &sr_addr, &yield_addr, total_sr);
        let y = YieldClient::new(&env, &yield_addr);
        let py = y.mint_py(&me, &me, &total_sr);
        if py < yt_out {
            panic_with_error!(&env, Error::DustAmount);
        }
        y.transfer(&me, &user, &yt_out);
        // Any face minted above the requested YT (a rounding stroop from the ceil) stays as pool PT.
        if treasury_sr > 0 {
            sr.transfer(&me, &storage::get_treasury(&env), &treasury_sr);
        }
        // Refund whatever the user over-authorized. Their net cost is still exactly `user_sr`.
        let refund = max_sr_in - user_sr;
        if refund > 0 {
            sr.transfer(&me, &user, &refund);
        }

        let pre_sr_res = storage::sr_reserve(&env);
        storage::set_pt_reserve(&env, pt_res + py);
        storage::set_sr_reserve(&env, pre_sr_res - pool_sr - treasury_sr);
        Self::record_treasury(&env, treasury_sr);
        Self::sync_implied_rate(&env, pt_res, pre_sr_res);
        storage::bump_instance(&env);

        events::yt_traded(&env, &user, true, yt_out, user_sr, fee_sr, treasury_sr);
        Self::assert_sane(&env);
        user_sr
    }

    /// **Sell exactly `yt_in` YT.** The pool contributes matching PT, the pair is recombined, and
    /// the released SR is split: the pool keeps the PT's market value, the seller takes the rest.
    ///
    /// The seller's accrued interest is settled by the YT transfer in step 1 — it is **credited,
    /// not paid**, exactly like Pendle. Collect it with `yield.redeem_due_interest`.
    ///
    /// Returns the SR paid to the seller.
    pub fn sell_yt_exact_in(
        env: Env,
        user: Address,
        yt_in: i128,
        min_sr_out: i128,
        deadline_ledger: u32,
    ) -> i128 {
        Self::ensure_can_trade(&env);
        Self::ensure_deadline(&env, deadline_ledger);
        user.require_auth();
        if yt_in <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let index = Self::index(&env);
        let p = Self::params(&env, index);
        let pt_res = storage::pt_reserve(&env);
        if yt_in > pt_res {
            panic_with_error!(&env, Error::InsufficientLiquidity);
        }
        // The pool is giving up `yt_in` PT: price the exact-output purchase.
        let t = curve::try_buy_pt_exact_out(&env, yt_in, pt_res, &p)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        if t.asset_amount >= yt_in {
            panic_with_error!(&env, Error::InsufficientLiquidity);
        }
        let retained_sr = Self::asset_to_sr_ceil(&env, t.asset_amount, index);
        let released_sr = Self::asset_to_sr(&env, yt_in, index);
        if retained_sr >= released_sr {
            panic_with_error!(&env, Error::InsufficientLiquidity);
        }
        let user_sr = released_sr - retained_sr;
        if user_sr < min_sr_out {
            panic_with_error!(&env, Error::SlippageExceeded);
        }
        let fee_sr = Self::asset_to_sr(&env, t.fee_asset, index);
        let treasury_sr = Self::treasury_cut(&env, fee_sr);

        let me = env.current_contract_address();
        let yield_addr = storage::get_yield(&env);
        let y = YieldClient::new(&env, &yield_addr);
        // 1. Take the YT. The hook settles the seller on the way in — nothing is lost.
        y.transfer(&user, &me, &yt_in);
        // 2. Recombine our PT with that YT, releasing SR to us.
        Self::authorize_pt_burn(&env, yt_in);
        let got_sr = y.redeem_py(&me, &me, &yt_in);
        if got_sr < user_sr {
            panic_with_error!(&env, Error::WithdrawShortfall);
        }
        // 3. Pay the seller; keep the PT's value in the pool.
        let sr = SrClient::new(&env, &storage::get_sr(&env));
        sr.transfer(&me, &user, &user_sr);
        if treasury_sr > 0 {
            sr.transfer(&me, &storage::get_treasury(&env), &treasury_sr);
        }

        let pre_sr_res = storage::sr_reserve(&env);
        storage::set_pt_reserve(&env, pt_res - yt_in);
        storage::set_sr_reserve(&env, pre_sr_res + (got_sr - user_sr) - treasury_sr);
        Self::record_treasury(&env, treasury_sr);
        Self::sync_implied_rate(&env, pt_res, pre_sr_res);
        storage::bump_instance(&env);

        events::yt_traded(&env, &user, false, yt_in, user_sr, fee_sr, treasury_sr);
        Self::assert_sane(&env);
        user_sr
    }

    // ================= quotes (panic-free) =================

    /// SR out for selling `pt_in` PT. `0` = no quote.
    pub fn quote_sell_pt(env: Env, pt_in: i128) -> i128 {
        Self::try_quote(&env, |env, index, p| {
            curve::try_sell_pt(env, pt_in, storage::pt_reserve(env), p)
                .map(|t| Self::asset_to_sr(env, t.asset_amount, index))
        })
    }

    /// PT out for spending `sr_in` SR. `0` = no quote.
    pub fn quote_buy_pt(env: Env, sr_in: i128) -> i128 {
        Self::try_quote(&env, |env, index, p| {
            let asset_in = Self::sr_to_asset(env, sr_in, index);
            curve::try_buy_pt_exact_in(env, asset_in, storage::pt_reserve(env), p)
                .map(|t| t.pt_amount)
        })
    }

    /// SR the user pays for exactly `yt_out` YT. `0` = no quote.
    pub fn quote_buy_yt(env: Env, yt_out: i128) -> i128 {
        Self::try_quote(&env, |env, index, p| {
            let t = curve::try_sell_pt(env, yt_out, storage::pt_reserve(env), p)?;
            if t.asset_amount >= yt_out {
                return Err(Error::InsufficientLiquidity);
            }
            let total = Self::asset_to_sr_ceil(env, yt_out, index);
            let pool = Self::asset_to_sr(env, t.asset_amount, index);
            if pool >= total {
                return Err(Error::InsufficientLiquidity);
            }
            Ok(total - pool)
        })
    }

    /// SR the seller receives for `yt_in` YT. `0` = no quote.
    pub fn quote_sell_yt(env: Env, yt_in: i128) -> i128 {
        Self::try_quote(&env, |env, index, p| {
            let pt_res = storage::pt_reserve(env);
            if yt_in > pt_res {
                return Err(Error::InsufficientLiquidity);
            }
            let t = curve::try_buy_pt_exact_out(env, yt_in, pt_res, p)?;
            let retained = Self::asset_to_sr_ceil(env, t.asset_amount, index);
            let released = Self::asset_to_sr(env, yt_in, index);
            if retained >= released {
                return Err(Error::InsufficientLiquidity);
            }
            Ok(released - retained)
        })
    }

    /// PT price in asset units (SCALAR_12). `0` = no price.
    pub fn pt_price(env: Env) -> i128 {
        Self::try_quote(&env, |env, _i, p| {
            curve::try_spot_price(env, storage::pt_reserve(env), p)
        })
    }

    /// Implied APY as a SCALAR_12 fraction. `0` = none.
    pub fn implied_apy(env: Env) -> i128 {
        if !storage::is_initialized(&env) {
            return 0;
        }
        curve::try_implied_apy(&env, storage::last_ln_implied_rate(&env)).unwrap_or(0)
    }

    // ================= views =================

    pub fn reserves(env: Env) -> (i128, i128) {
        (storage::pt_reserve(&env), storage::sr_reserve(&env))
    }

    /// The SR reserve valued in asset units — what the curve actually compares against PT.
    pub fn asset_reserve(env: Env) -> i128 {
        let index = Self::index_view(&env);
        math::mul_div_floor(&env, storage::sr_reserve(&env), index, SCALAR_12).unwrap_or(0)
    }

    pub fn lp_position(env: Env, lp: Address) -> (i128, i128, i128) {
        let shares = storage::shares_of(&env, &lp);
        let total = storage::total_shares(&env);
        if total == 0 || shares == 0 {
            return (shares, 0, 0);
        }
        let pt = math::mul_div_floor(&env, storage::pt_reserve(&env), shares, total).unwrap_or(0);
        let sr = math::mul_div_floor(&env, storage::sr_reserve(&env), shares, total).unwrap_or(0);
        (shares, pt, sr)
    }

    /// **Permissionless TTL keep-alive for an LP's share entry** (`tofix.md` #30).
    ///
    /// Share entries are bumped on every liquidity event, so an LP who provides once and then sits
    /// through the term is never written to. Anyone may call this — it only prolongs an entry.
    ///
    /// No-ops for an address with no position.
    pub fn bump_lp(env: Env, lp: Address) {
        Self::ensure_initialized(&env);
        storage::bump_shares_ttl(&env, &lp);
        storage::bump_instance(&env);
    }

    pub fn total_shares(env: Env) -> i128 {
        storage::total_shares(&env)
    }
    pub fn pt_token(env: Env) -> Address {
        storage::get_pt(&env)
    }
    pub fn sr_token(env: Env) -> Address {
        storage::get_sr(&env)
    }
    pub fn yield_contract(env: Env) -> Address {
        storage::get_yield(&env)
    }
    pub fn expiry(env: Env) -> u64 {
        storage::get_expiry(&env)
    }
    pub fn treasury(env: Env) -> Address {
        storage::get_treasury(&env)
    }
    pub fn treasury_fee_share_bps(env: Env) -> u32 {
        storage::treasury_fee_share_bps(&env)
    }
    /// Lifetime SR routed to the treasury from swap fees.
    pub fn treasury_earned(env: Env) -> i128 {
        storage::treasury_earned(&env)
    }
    pub fn ln_fee_root(env: Env) -> i128 {
        storage::ln_fee_root(&env)
    }
    pub fn scalar_root(env: Env) -> i128 {
        storage::scalar_root(&env)
    }
    pub fn last_ln_implied_rate(env: Env) -> i128 {
        storage::last_ln_implied_rate(&env)
    }
    pub fn is_paused(env: Env) -> bool {
        storage::is_paused(&env)
    }
    pub fn admin(env: Env) -> Address {
        storage::get_admin(&env)
    }

    /// The fee a trader of `notional` PT face would pay right now, in asset units — the number the
    /// UI should show, because it is what actually scales with time to expiry.
    pub fn fee_preview(env: Env, notional: i128) -> i128 {
        Self::try_quote(&env, |env, _i, p| {
            let t = curve::try_sell_pt(env, notional, storage::pt_reserve(env), p)?;
            Ok(t.fee_asset)
        })
    }

    // ================= admin =================

    pub fn set_ln_fee_root(env: Env, v: i128) {
        storage::get_admin(&env).require_auth();
        if v < 0 || v > MAX_LN_FEE_ROOT {
            panic_with_error!(&env, Error::FeeNotAllowed);
        }
        storage::set_ln_fee_root(&env, v);
        storage::bump_instance(&env);
        events::fee_root_set(&env, v);
    }

    pub fn set_treasury_fee_share(env: Env, bps: u32) {
        storage::get_admin(&env).require_auth();
        if bps > MAX_TREASURY_FEE_SHARE_BPS {
            panic_with_error!(&env, Error::FeeShareTooHigh);
        }
        storage::set_treasury_fee_share_bps(&env, bps);
        storage::bump_instance(&env);
        events::treasury_share_set(&env, bps);
    }

    pub fn set_treasury(env: Env, treasury: Address) {
        storage::get_admin(&env).require_auth();
        storage::set_treasury(&env, &treasury);
        storage::bump_instance(&env);
    }

    pub fn pause(env: Env) {
        storage::get_admin(&env).require_auth();
        storage::set_paused(&env, true);
        storage::bump_instance(&env);
    }

    pub fn unpause(env: Env) {
        storage::get_admin(&env).require_auth();
        storage::set_paused(&env, false);
        storage::bump_instance(&env);
    }


    // ---------- governance: two-step admin rotation + timelocked upgrades ----------
    //
    // Identical in shape to the v1 wrapper/vault/market, deliberately: an operator who has learned
    // one of these contracts has learned all of them, and a divergent governance surface is exactly
    // the kind of thing that goes wrong under pressure.
    //
    // Rotation is TWO-STEP — the current admin proposes, the new admin must accept — so a typo in
    // an address cannot lock the contract out of administration. Upgrades are TIMELOCKED, so a
    // compromised admin key cannot swap the code out from under holders without a public window in
    // which the pending hash is readable on chain and users can exit.

    /// Propose a new admin (step 1 of 2). The proposed address must then call
    /// [`Self::accept_admin`]; until it does, nothing changes.
    pub fn propose_admin(env: Env, new_admin: Address) {
        governance::propose_admin(&env, &storage::get_admin(&env), &new_admin);
    }

    /// Accept a pending admin proposal (step 2 of 2). Callable only by the proposed address.
    pub fn accept_admin(env: Env) {
        let new_admin = governance::accept_admin(&env);
        storage::set_admin(&env, &new_admin);
        storage::bump_instance(&env);
    }

    /// Withdraw a pending proposal. Current admin only.
    pub fn cancel_admin_transfer(env: Env) {
        governance::cancel_admin_transfer(&env, &storage::get_admin(&env));
    }

    pub fn pending_admin(env: Env) -> Option<Address> {
        governance::pending_admin(&env)
    }

    /// Schedule an upgrade to `wasm_hash`, applyable once the timelock elapses. Returns the `eta`.
    /// The pending hash is publicly readable via [`Self::pending_upgrade`] for the whole window.
    pub fn schedule_upgrade(env: Env, wasm_hash: BytesN<32>) -> u64 {
        governance::schedule_upgrade(&env, &storage::get_admin(&env), wasm_hash)
    }

    /// Apply a scheduled upgrade. Reverts until `eta` has passed.
    pub fn apply_upgrade(env: Env) {
        governance::apply_upgrade(&env, &storage::get_admin(&env));
    }

    pub fn cancel_upgrade(env: Env) {
        governance::cancel_upgrade(&env, &storage::get_admin(&env));
    }

    pub fn pending_upgrade(env: Env) -> Option<governance::PendingUpgrade> {
        governance::pending_upgrade(&env)
    }

    /// The current upgrade delay, seconds. Bounded on chain to [1h, 30d].
    pub fn timelock(env: Env) -> u64 {
        governance::timelock(&env)
    }

    pub fn set_timelock(env: Env, secs: u64) {
        governance::set_timelock(&env, &storage::get_admin(&env), secs);
    }

    /// The live deployed WASM hash (32-byte SHA-256) — reflects the running code across upgrades,
    /// so anyone can verify what is actually deployed rather than trusting a version string.
    pub fn code_hash(env: Env) -> BytesN<32> {
        governance::code_hash(&env)
    }

    /// Human-readable semver of the source build (informational; for verifiable identity use
    /// [`Self::code_hash`]).
    pub fn version(env: Env) -> String {
        String::from_str(&env, "spield-srmarket-0.1.0")
    }

    // ================= internals =================

    fn ensure_initialized(env: &Env) {
        if !storage::is_initialized(env) {
            panic_with_error!(env, Error::NotInitialized);
        }
    }

    fn ensure_can_trade(env: &Env) {
        Self::ensure_initialized(env);
        if storage::is_paused(env) {
            panic_with_error!(env, Error::Paused);
        }
        if env.ledger().timestamp() >= storage::get_expiry(env) {
            panic_with_error!(env, Error::SeriesExpired);
        }
    }

    fn ensure_deadline(env: &Env, deadline_ledger: u32) {
        if deadline_ledger != 0 && env.ledger().sequence() > deadline_ledger {
            panic_with_error!(env, Error::SeriesExpired);
        }
    }

    /// Live index from the yield contract, **synchronized** — the one number a value-moving
    /// transaction prices, transfers, settles reserves and emits events on.
    ///
    /// This calls the MUTATING `py_index_current`, not the `py_index` view. The distinction is the
    /// whole of `FINAL_CHECK.md` V2-01: the view reads SR's stored high-water rate, which lags
    /// whenever nothing has synced since the last mutation, while the `mint_py`/`redeem_py` these
    /// paths go on to call synchronize first. Pricing on the stale one moved value to PT sellers,
    /// short-changed PT buyers, and stranded YT in the pool.
    fn index(env: &Env) -> i128 {
        YieldClient::new(env, &storage::get_yield(env)).py_index_current()
    }

    fn index_view(env: &Env) -> i128 {
        if !storage::is_initialized(env) {
            return SCALAR_12;
        }
        YieldClient::new(env, &storage::get_yield(env)).py_index()
    }

    fn params(env: &Env, index: i128) -> curve::Params {
        curve::params_or_panic(
            env,
            curve::try_params(
                env,
                storage::pt_reserve(env),
                storage::sr_reserve(env),
                index,
                storage::scalar_root(env),
                storage::ln_fee_root(env),
                storage::last_ln_implied_rate(env),
                storage::get_expiry(env),
                env.ledger().timestamp(),
            ),
        )
    }

    /// Run a fallible quote, mapping every failure to `0` so views never revert.
    fn try_quote<F>(env: &Env, f: F) -> i128
    where
        F: Fn(&Env, i128, &curve::Params) -> Result<i128, Error>,
    {
        if !storage::is_initialized(env) {
            return 0;
        }
        let index = Self::index_view(env);
        match curve::try_params(
            env,
            storage::pt_reserve(env),
            storage::sr_reserve(env),
            index,
            storage::scalar_root(env),
            storage::ln_fee_root(env),
            storage::last_ln_implied_rate(env),
            storage::get_expiry(env),
            env.ledger().timestamp(),
        ) {
            Ok(p) => f(env, index, &p).unwrap_or(0).max(0),
            Err(_) => 0,
        }
    }

    fn sr_to_asset(env: &Env, sr: i128, index: i128) -> i128 {
        math::mul_div_floor(env, sr, index, SCALAR_12).unwrap_or(0)
    }

    fn asset_to_sr(env: &Env, asset: i128, index: i128) -> i128 {
        math::mul_div_floor(env, asset, SCALAR_12, index).unwrap_or(0)
    }

    /// Ceil variant — used wherever rounding down would leave the pool short.
    fn asset_to_sr_ceil(env: &Env, asset: i128, index: i128) -> i128 {
        let floor = Self::asset_to_sr(env, asset, index);
        if Self::sr_to_asset(env, floor, index) < asset {
            floor + 1
        } else {
            floor
        }
    }

    fn treasury_cut(env: &Env, fee_sr: i128) -> i128 {
        if fee_sr <= 0 {
            return 0;
        }
        math::mul_div_floor(
            env,
            fee_sr,
            storage::treasury_fee_share_bps(env) as i128,
            10_000,
        )
        .unwrap_or(0)
    }

    fn record_treasury(env: &Env, amount: i128) {
        if amount > 0 {
            storage::set_treasury_earned(env, storage::treasury_earned(env) + amount);
        }
    }

    /// Re-derive and store the implied rate the pool now prices. **This is what makes the anchor
    /// dynamic** — the next quote rebuilds the anchor from this number and the time then remaining.
    /// Re-derive and store the pool's implied rate after a state change.
    ///
    /// **The two reserve sets are deliberately different, and that asymmetry is the whole
    /// mechanism** (`tofix.md` #34). `try_params` builds an anchor such that
    /// `price(proportion_it_was_given) == target_price` — an identity. So anchoring on the
    /// *post-trade* reserves and then pricing that *same* proportion reads back exactly the rate
    /// we started with: a fixpoint, and the update becomes a mathematical no-op. That is what this
    /// used to do, and it left `implied_apy()` / `pt_price()` frozen at the seeded rate no matter
    /// how much the pool traded — measured identical across 1%–50% trade sizes.
    ///
    /// Pendle's `_updateMarketState` anchors on the state *before* the trade and prices the
    /// proportion the trade *left behind*. That is what this does now.
    ///
    /// A proportional `add_liquidity` / `remove_liquidity` is rate-neutral for free: it does not
    /// change the proportion, so pre and post agree and the stored rate does not move.
    fn sync_implied_rate(env: &Env, pre_pt_res: i128, pre_sr_res: i128) {
        let index = Self::index_view(env);
        // Anchor on the PRE-trade state.
        if let Ok(p) = curve::try_params(
            env,
            pre_pt_res,
            pre_sr_res,
            index,
            storage::scalar_root(env),
            storage::ln_fee_root(env),
            storage::last_ln_implied_rate(env),
            storage::get_expiry(env),
            env.ledger().timestamp(),
        ) {
            // Price the POST-trade proportion under that anchor.
            let pt_res = storage::pt_reserve(env);
            let sr_res = storage::sr_reserve(env);
            let asset_res = Self::sr_to_asset(env, sr_res, index);
            if let Some(r) = curve::try_new_ln_implied_rate(env, pt_res, asset_res, &p) {
                storage::set_last_ln_implied_rate(env, r);
            }
        }
    }

    /// Stored reserves must never exceed what the pool actually holds, and never go negative.
    /// A direct donation can only make the actual side larger, never smaller — so this is the
    /// one-sided check `comparependle.md` / `futureamm.md` §12.11 asks for.
    fn assert_sane(env: &Env) {
        let pt_res = storage::pt_reserve(env);
        let sr_res = storage::sr_reserve(env);
        if pt_res < 0 || sr_res < 0 {
            panic_with_error!(env, Error::InsufficientLiquidity);
        }
        let me = env.current_contract_address();
        let pt_bal = token::Client::new(env, &storage::get_pt(env)).balance(&me);
        let sr_bal = SrClient::new(env, &storage::get_sr(env)).balance(&me);
        if pt_bal < pt_res || sr_bal < sr_res {
            panic_with_error!(env, Error::InsufficientLiquidity);
        }
    }

    fn authorize_sr_pull(env: &Env, sr: &Address, spender: &Address, amount: i128) {
        use soroban_sdk::{
            auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
            IntoVal, Symbol, Vec,
        };
        let me = env.current_contract_address();
        let args: Vec<soroban_sdk::Val> = (me.clone(), spender.clone(), amount).into_val(env);
        env.authorize_as_current_contract(Vec::from_array(
            env,
            [InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: sr.clone(),
                    fn_name: Symbol::new(env, "transfer"),
                    args,
                },
                sub_invocations: Vec::new(env),
            })],
        ));
    }

    fn authorize_pt_burn(env: &Env, amount: i128) {
        use soroban_sdk::{
            auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
            IntoVal, Symbol, Vec,
        };
        let me = env.current_contract_address();
        let pt = storage::get_pt(env);
        let args: Vec<soroban_sdk::Val> = (me.clone(), amount).into_val(env);
        env.authorize_as_current_contract(Vec::from_array(
            env,
            [InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: pt,
                    fn_name: Symbol::new(env, "burn"),
                    args,
                },
                sub_invocations: Vec::new(env),
            })],
        ));
    }
}

/// The PT/YT engine's surface, as this market uses it.
#[soroban_sdk::contractclient(name = "YieldClient")]
pub trait YieldContract {
    fn pt_token(env: Env) -> Address;
    fn sr_token(env: Env) -> Address;
    fn expiry(env: Env) -> u64;
    fn py_index(env: Env) -> i128;
    fn py_index_current(env: Env) -> i128;
    fn mint_py(env: Env, from: Address, receiver: Address, sr_in: i128) -> i128;
    fn redeem_py(env: Env, from: Address, receiver: Address, py_amount: i128) -> i128;
    fn transfer(env: Env, from: Address, to: Address, amount: i128);
    fn balance(env: Env, id: Address) -> i128;
}

/// The SR token's surface.
#[soroban_sdk::contractclient(name = "SrClient")]
pub trait SrToken {
    fn exchange_rate(env: Env) -> i128;
    fn balance(env: Env, id: Address) -> i128;
    fn transfer(env: Env, from: Address, to: Address, amount: i128);
}
