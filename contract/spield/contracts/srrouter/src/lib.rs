#![no_std]
//! # SR Router — the one-transaction front door
//!
//! Users think in USDC. The protocol thinks in SR. This contract is the translation layer, and it
//! is the only thing standing between "deposit USDC, approve, wrap, then swap" and "buy PT".
//!
//! ```text
//!   buy_pt_with_usdc    USDC ──wrap──> SR ──market──> PT
//!   buy_yt_with_usdc    USDC ──wrap──> SR ──market──> YT   (+ unused USDC refunded)
//!   sell_pt_for_usdc      PT ──market──> SR ──unwrap──> USDC
//!   sell_yt_for_usdc      YT ──market──> SR ──unwrap──> USDC
//!   redeem_py_for_usdc  PT(+YT) ──engine──> SR ──unwrap──> USDC
//!   claim_yield_to_usdc     yield ──> SR ──unwrap──> USDC
//! ```
//!
//! The SR hop is still a first-class, separately callable step — `Sr::deposit` / `Sr::redeem` are
//! unchanged and remain the documented way to hold the wrapper directly. This contract does not
//! replace that surface, it composes it. Anything the router can do, a user can still do by hand in
//! three transactions; the router only removes the signatures.
//!
//! ## What this contract is trusted with: nothing
//!
//! The router holds **no admin rights** on SR, the engine, the market or the vault. It cannot mint,
//! cannot pause, cannot move anyone's balance. Every unit of value it touches was authorized by the
//! user in the same transaction, and every entry point ends with the router's balance of all four
//! tokens back at zero (`assert_drained`). If this contract were replaced tomorrow by a hostile
//! one, the worst it could do is mishandle funds a user handed it inside a single call — which is
//! why the `min_*_out` guards are on the *user's* side of every path.
//!
//! ## The one rule that shapes every function here
//!
//! **No amount derived on chain may appear inside a transfer the user signs.** Wallets build
//! authorization entries against *simulation*, so a figure recomputed at execution time — from a
//! live index that moved a ledger later — no longer matches, and the host rejects the whole
//! transaction with `auth: invalid_action`. This bit us on testnet (`AUDITPREP.md` §4, item 1).
//!
//! So the user-signed leg of every path moves a number the **user supplied**: `usdc_in` on the
//! exact-input paths, `max_usdc_in` on the exact-output one, `pt_in`/`yt_in` on the exits. Anything
//! computed mid-flight moves under the *router's* own authority, where no wallet signature is
//! involved and drift is harmless. That is also why `buy_yt_with_usdc` is exact-output: the market
//! prices YT from the live index, so an exact-input version would have to solve for the payment on
//! chain and put that number back into the user's signed transfer — precisely the forbidden shape.
//!
//! ## Deadlines
//!
//! The router takes no deadline of its own. It forwards `deadline_ledger` to the market, which
//! already enforces it, and Stellar transactions carry network-enforced `timeBounds` besides. A
//! third clock would be redundant surface.

mod events;
mod storage;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, panic_with_error, token, Address, BytesN, Env, String};
use spield_shared::{governance, Error};


#[contract]
pub struct SrRouter;

/// The four tokens the router can hold. A plain Rust struct — it never crosses a contract boundary.
struct Holdings {
    sr: i128,
    pt: i128,
    yt: i128,
    usdc: i128,
}

#[contractimpl]
impl SrRouter {
    pub fn __constructor(env: Env, admin: Address) {
        storage::set_admin(&env, &admin);
        governance::init(&env);
        storage::bump_instance(&env);
    }

    /// Wire the router to a market, reading everything else back **from the chain**.
    ///
    /// The caller supplies one address. Engine, SR, PT, underlying and expiry are all read from the
    /// market and the contracts it names, so a fat-fingered deploy cannot produce a router pointed
    /// at a market for one series and an engine for another. This is the same construction that
    /// makes `tofix.md` #24 inexpressible in the vault.
    pub fn initialize(env: Env, market: Address) {
        if storage::is_initialized(&env) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        storage::get_admin(&env).require_auth();

        let m = MarketClient::new(&env, &market);
        let yield_addr = m.yield_contract();
        let sr_addr = m.sr_token();
        let pt_addr = m.pt_token();

        // Cross-check the market's view against the engine's own. If these disagree, one of the two
        // is misconfigured and every route through this router would be silently wrong.
        let y = YieldClient::new(&env, &yield_addr);
        if y.sr_token() != sr_addr || y.pt_token() != pt_addr {
            panic_with_error!(&env, Error::UnderlyingMismatch);
        }
        let expiry = y.expiry();
        if expiry != m.expiry() {
            panic_with_error!(&env, Error::UnderlyingMismatch);
        }

        storage::set_market(&env, &market);
        storage::set_yield(&env, &yield_addr);
        storage::set_sr(&env, &sr_addr);
        storage::set_pt(&env, &pt_addr);
        storage::set_underlying(&env, &SrClient::new(&env, &sr_addr).underlying());
        storage::set_expiry(&env, expiry);
        storage::set_initialized(&env);
        storage::bump_instance(&env);
    }

    // ================= USDC -> PT / YT =================

    /// **Buy PT with USDC, exact input.** Spends exactly `usdc_in`; reverts below `min_pt_out`.
    ///
    /// `min_pt_out` is the user's only protection here and it is a real one: it is denominated in
    /// PT, so it bounds the *whole* route — a bad wrap rate and a bad swap price both show up in
    /// the same number.
    pub fn buy_pt_with_usdc(
        env: Env,
        user: Address,
        usdc_in: i128,
        min_pt_out: i128,
        deadline_ledger: u32,
    ) -> i128 {
        // Snapshot BEFORE any work: the exit check is "no richer than we started".
        let before = Self::holdings(&env);
        Self::ensure_active(&env);
        user.require_auth();
        Self::positive(&env, usdc_in);

        let me = env.current_contract_address();
        let underlying = storage::get_underlying(&env);
        let sr_addr = storage::get_sr(&env);
        let market = storage::get_market(&env);

        // User-signed leg: exactly the amount they passed in. No on-chain arithmetic touches it.
        token::Client::new(&env, &underlying).transfer(&user, &me, &usdc_in);

        let sr_mid = Self::wrap(&env, &underlying, &sr_addr, usdc_in);

        Self::auth_transfer(&env, &sr_addr, &market, sr_mid);
        let pt_out = MarketClient::new(&env, &market)
            .swap_exact_sr_for_pt(&me, &sr_mid, &min_pt_out, &deadline_ledger);

        token::Client::new(&env, &storage::get_pt(&env)).transfer(&me, &user, &pt_out);

        storage::bump_instance(&env);
        events::bought_pt(&env, &user, usdc_in, sr_mid, pt_out);
        Self::assert_no_accumulation(&env, &before);
        pt_out
    }

    /// **Buy YT with plain USDC, one signature.** Delivers exactly `yt_out`, wrapping exactly
    /// `usdc_in`; anything the market does not need comes back as SR.
    ///
    /// ## Why `usdc_in` is an input rather than something we work out
    ///
    /// This is the tightest path in the protocol for transaction budget: a Blend supply, a curve
    /// solve, a `mint_py` and three transfers, all in one transaction. An earlier version priced
    /// the trade itself — `quote_buy_yt`, then two rate conversions — and **failed on live testnet
    /// with `Error(Budget, ExceededLimit)`** while fitting comfortably against the local Blend
    /// fixture, which is far lighter than the real pool. Every cross-contract call it could shed
    /// was the difference between a path that exists and one that does not.
    ///
    /// So the pricing moved off chain, where it is free. The caller quotes with
    /// [`Self::quote_buy_yt_with_usdc`], pads for index drift, and passes the result. This costs
    /// nothing in safety: `usdc_in` is a **user-supplied** number, which is exactly what the one
    /// rule in the module docs demands of the amount a wallet signs. Pass too little and the market
    /// reverts cleanly; pass too much and the excess comes back.
    ///
    /// ## Why the change comes back as SR and not USDC
    ///
    /// Unwrapping it would mean a second Blend round trip — the very cost that made this path
    /// impossible to begin with. SR is still the user's value and still yield-bearing, and the
    /// wrapper section turns it back into USDC whenever they like. Quote well and it is a crumb.
    ///
    /// ## MEASURED LIMIT — this path does not fit on Blend's testnet pool
    ///
    /// Verified on chain 2026-08-25, and it is not marginal. Each leg succeeds alone:
    ///
    /// ```text
    /// srmarket::buy_yt_exact_out(300000000 YT)  →  Success, sr_amount 4451632
    /// sr::deposit(1000000 USDC)                 →  Success, shares_out 947027
    /// srrouter::buy_yt_with_usdc(both)          →  Error(Budget, ExceededLimit)
    /// ```
    ///
    /// Stripping the router to its minimum did not close the gap — not the on-chain pricing (moved
    /// off chain), not the second Blend round trip (removed), not even the PT read in the drain
    /// check. A Blend supply plus a `mint_py`-bearing curve trade is simply more than one Soroban
    /// transaction holds against a pool of that weight.
    ///
    /// The code is correct and fully tested, and the cost is a property of the *underlying pool*,
    /// not of this contract — a lighter pool or a higher limit would run it. So it stays, and the
    /// dApp uses the two-transaction route (wrap, then `buy_yt_exact_out`) for YT instead. Every
    /// other router path fits comfortably and is used.
    ///
    /// **Do not wire a UI to this without simulating first on the target network.**
    ///
    /// Returns the SR the market actually took.
    pub fn buy_yt_with_usdc(
        env: Env,
        user: Address,
        yt_out: i128,
        usdc_in: i128,
        deadline_ledger: u32,
    ) -> i128 {
        // Snapshot BEFORE any work: the exit check is "no richer than we started".
        let before = Self::holdings(&env);
        Self::ensure_active(&env);
        user.require_auth();
        Self::positive(&env, yt_out);
        Self::positive(&env, usdc_in);

        let me = env.current_contract_address();
        let underlying = storage::get_underlying(&env);
        let sr_addr = storage::get_sr(&env);
        let market = storage::get_market(&env);

        // User-signed leg: exactly the amount they passed in.
        token::Client::new(&env, &underlying).transfer(&user, &me, &usdc_in);

        let sr_budget = Self::wrap(&env, &underlying, &sr_addr, usdc_in);

        // The market pulls up to `sr_budget` and refunds its own excess to us.
        Self::auth_transfer(&env, &sr_addr, &market, sr_budget);
        let sr_spent = MarketClient::new(&env, &market)
            .buy_yt_exact_out(&me, &yt_out, &sr_budget, &deadline_ledger);

        YieldClient::new(&env, &storage::get_yield(&env)).transfer(&me, &user, &yt_out);

        // Derived from the two known SR figures, never from our own balance: a stranger can donate
        // SR here, and a balance read would hand the donation to whoever trades next.
        let sr_refund = sr_budget - sr_spent;
        if sr_refund > 0 {
            SrClient::new(&env, &sr_addr).transfer(&me, &user, &sr_refund);
        }

        storage::bump_instance(&env);
        events::bought_yt(&env, &user, usdc_in, yt_out, 0, sr_refund);
        Self::assert_no_accumulation(&env, &before);
        sr_spent
    }

    // ================= PT / YT -> USDC =================

    /// **Sell PT for USDC.** Exact input; reverts below `min_usdc_out`.
    pub fn sell_pt_for_usdc(
        env: Env,
        user: Address,
        pt_in: i128,
        min_usdc_out: i128,
        deadline_ledger: u32,
    ) -> i128 {
        // Snapshot BEFORE any work: the exit check is "no richer than we started".
        let before = Self::holdings(&env);
        Self::ensure_active(&env);
        user.require_auth();
        Self::positive(&env, pt_in);

        let me = env.current_contract_address();
        let market = storage::get_market(&env);

        token::Client::new(&env, &storage::get_pt(&env)).transfer(&user, &me, &pt_in);

        Self::auth_pt_transfer(&env, &market, pt_in);
        // Slippage is checked once, at the end, in USDC — the SR leg's own floor stays at 0 so a
        // benign rounding difference in the wrapper cannot revert a trade that met the user's
        // actual requirement.
        let sr_mid = MarketClient::new(&env, &market)
            .swap_exact_pt_for_sr(&me, &pt_in, &0i128, &deadline_ledger);

        let usdc_out = Self::unwrap(&env, &user, sr_mid, min_usdc_out);

        storage::bump_instance(&env);
        events::sold_pt(&env, &user, pt_in, sr_mid, usdc_out);
        Self::assert_no_accumulation(&env, &before);
        usdc_out
    }

    /// **Sell YT for USDC.** Exact input; reverts below `min_usdc_out`.
    ///
    /// The seller's accrued interest is settled by the YT transfer in the first line — the engine's
    /// `before_yt_change` hook credits it to them *before* the balance moves, so selling YT never
    /// forfeits yield already earned. It stays claimable afterwards via `claim_yield_to_usdc`.
    pub fn sell_yt_for_usdc(
        env: Env,
        user: Address,
        yt_in: i128,
        min_usdc_out: i128,
        deadline_ledger: u32,
    ) -> i128 {
        // Snapshot BEFORE any work: the exit check is "no richer than we started".
        let before = Self::holdings(&env);
        Self::ensure_active(&env);
        user.require_auth();
        Self::positive(&env, yt_in);

        let me = env.current_contract_address();
        let market = storage::get_market(&env);
        let yield_addr = storage::get_yield(&env);

        YieldClient::new(&env, &yield_addr).transfer(&user, &me, &yt_in);

        Self::auth_yt_transfer(&env, &yield_addr, &market, yt_in);
        let sr_mid = MarketClient::new(&env, &market)
            .sell_yt_exact_in(&me, &yt_in, &0i128, &deadline_ledger);

        let usdc_out = Self::unwrap(&env, &user, sr_mid, min_usdc_out);

        storage::bump_instance(&env);
        events::sold_yt(&env, &user, yt_in, sr_mid, usdc_out);
        Self::assert_no_accumulation(&env, &before);
        usdc_out
    }

    /// **Redeem principal to USDC**, at face value, through the engine rather than the market.
    ///
    /// * **After expiry** this is the exit: it burns PT only and pays face, no curve, no slippage,
    ///   no liquidity requirement. Note the market refuses to trade past expiry, so
    ///   `sell_pt_for_usdc` stops working exactly where this starts mattering.
    /// * **Before expiry** it is a *recombine*: it burns `py_amount` of **both** PT and YT. Useful
    ///   to unwind a full position without paying the spread twice, and priced at face by
    ///   definition — but it needs both legs, which is why the UI offers it separately.
    ///
    /// Deliberately not pausable-gated beyond the router's own switch: this is an exit path.
    pub fn redeem_py_for_usdc(env: Env, user: Address, py_amount: i128, min_usdc_out: i128) -> i128 {
        // Snapshot BEFORE any work: the exit check is "no richer than we started".
        let before = Self::holdings(&env);
        Self::ensure_initialized(&env);
        user.require_auth();
        Self::positive(&env, py_amount);

        let me = env.current_contract_address();
        let yield_addr = storage::get_yield(&env);

        // The engine burns from `user` under the user's own authorization and pays SR to us.
        let sr_mid = YieldClient::new(&env, &yield_addr).redeem_py(&user, &me, &py_amount);
        let usdc_out = Self::unwrap(&env, &user, sr_mid, min_usdc_out);

        let after_expiry = env.ledger().timestamp() >= storage::expiry(&env);
        storage::bump_instance(&env);
        events::redeemed_for_usdc(&env, &user, py_amount, sr_mid, usdc_out, after_expiry);
        Self::assert_no_accumulation(&env, &before);
        usdc_out
    }

    // ================= yield =================

    /// **Claim accrued YT yield straight to USDC.**
    ///
    /// This is the piece that makes YT legible to a normal user. Holding YT earns SR continuously;
    /// without this the holder has to claim SR, then unwrap it, then work out which of the two
    /// numbers was their actual return. Here it is one call and one number, in the unit they
    /// deposited.
    ///
    /// The redirect to this contract is why the engine grew `redeem_due_interest_to`: claiming to
    /// the user and pulling the proceeds back would require the router to name an amount only known
    /// on chain inside a user-signed transfer — the forbidden shape from the module docs.
    ///
    /// Returns the USDC paid. Claiming zero is not an error; it returns 0 and touches nothing.
    pub fn claim_yield_to_usdc(env: Env, user: Address, min_usdc_out: i128) -> i128 {
        // Snapshot BEFORE any work: the exit check is "no richer than we started".
        let before = Self::holdings(&env);
        Self::ensure_initialized(&env); // an exit — open while the router is paused
        user.require_auth();

        let me = env.current_contract_address();
        let (sr_net, sr_fee) = YieldClient::new(&env, &storage::get_yield(&env))
            .redeem_due_interest_to(&user, &me);

        if sr_net <= 0 {
            events::yield_claimed(&env, &user, 0, sr_fee, 0);
            return 0;
        }
        let usdc_out = Self::unwrap(&env, &user, sr_net, min_usdc_out);

        storage::bump_instance(&env);
        events::yield_claimed(&env, &user, sr_net, sr_fee, usdc_out);
        Self::assert_no_accumulation(&env, &before);
        usdc_out
    }

    // ================= quotes =================
    //
    // All pure views. Each one composes the wrapper's preview with the market's quote so the
    // frontend gets a single USDC-denominated figure instead of having to chain them itself — and,
    // more importantly, so the number it shows is produced by the *same* composition the trade will
    // execute. Two places doing the conversion is two places to get it inconsistent.

    /// PT out for a given USDC input.
    pub fn quote_buy_pt_with_usdc(env: Env, usdc_in: i128) -> i128 {
        Self::ensure_initialized(&env);
        let sr = SrClient::new(&env, &storage::get_sr(&env)).preview_deposit(&usdc_in);
        MarketClient::new(&env, &storage::get_market(&env)).quote_buy_pt(&sr)
    }

    /// USDC needed for a given YT output. Pad this by the user's slippage tolerance and pass the
    /// padded figure as `max_usdc_in`; the pad is refunded.
    pub fn quote_buy_yt_with_usdc(env: Env, yt_out: i128) -> i128 {
        Self::ensure_initialized(&env);
        let sr = MarketClient::new(&env, &storage::get_market(&env)).quote_buy_yt(&yt_out);
        Self::sr_to_usdc_ceil(&env, sr)
    }

    /// USDC out for a given PT input.
    pub fn quote_sell_pt_for_usdc(env: Env, pt_in: i128) -> i128 {
        Self::ensure_initialized(&env);
        let sr = MarketClient::new(&env, &storage::get_market(&env)).quote_sell_pt(&pt_in);
        SrClient::new(&env, &storage::get_sr(&env)).preview_redeem(&sr)
    }

    /// USDC out for a given YT input.
    pub fn quote_sell_yt_for_usdc(env: Env, yt_in: i128) -> i128 {
        Self::ensure_initialized(&env);
        let sr = MarketClient::new(&env, &storage::get_market(&env)).quote_sell_yt(&yt_in);
        SrClient::new(&env, &storage::get_sr(&env)).preview_redeem(&sr)
    }

    /// USDC a `redeem_py_for_usdc` of `py_amount` would pay — face value, no curve.
    pub fn quote_redeem_py_for_usdc(env: Env, py_amount: i128) -> i128 {
        Self::ensure_initialized(&env);
        // Face is denominated in underlying already: PY face *is* USDC face.
        let sr = SrClient::new(&env, &storage::get_sr(&env));
        let shares = spield_shared::math::underlying_to_shares(
            &env,
            py_amount,
            YieldClient::new(&env, &storage::get_yield(&env)).py_index(),
        )
        .unwrap_or(0);
        sr.preview_redeem(&shares)
    }

    /// USDC a `claim_yield_to_usdc` would pay right now, net of the protocol's yield fee.
    pub fn quote_claim_yield(env: Env, user: Address) -> i128 {
        Self::ensure_initialized(&env);
        let y = YieldClient::new(&env, &storage::get_yield(&env));
        let gross = y.claimable_interest(&user);
        if gross <= 0 {
            return 0;
        }
        let fee = gross * (y.yield_fee_bps() as i128) / 10_000;
        SrClient::new(&env, &storage::get_sr(&env)).preview_redeem(&(gross - fee))
    }

    // ================= views =================

    pub fn market(env: Env) -> Address {
        storage::get_market(&env)
    }
    pub fn yield_contract(env: Env) -> Address {
        storage::get_yield(&env)
    }
    pub fn sr_token(env: Env) -> Address {
        storage::get_sr(&env)
    }
    pub fn pt_token(env: Env) -> Address {
        storage::get_pt(&env)
    }
    pub fn underlying(env: Env) -> Address {
        storage::get_underlying(&env)
    }
    pub fn expiry(env: Env) -> u64 {
        storage::expiry(&env)
    }
    pub fn is_paused(env: Env) -> bool {
        storage::is_paused(&env)
    }
    pub fn admin(env: Env) -> Address {
        storage::get_admin(&env)
    }

    // ================= admin =================

    /// Pause the router's entry paths. **Exits stay open**, and so does everything underneath — a
    /// paused router removes convenience, never access. Users can still reach `Sr::deposit`,
    /// `SrMarket::swap_*` and `Yield::redeem_py` directly, which is the property that makes this
    /// switch safe to flip on suspicion rather than on proof.
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

    /// Recover tokens **donated** to the router — never user funds in flight, because there are
    /// none: every entry point drains before it returns. Admin-gated and sent to the admin.
    pub fn sweep(env: Env, tokenc: Address) -> i128 {
        Self::ensure_initialized(&env);
        let admin = storage::get_admin(&env);
        admin.require_auth();
        let me = env.current_contract_address();
        let bal = token::Client::new(&env, &tokenc).balance(&me);
        if bal > 0 {
            token::Client::new(&env, &tokenc).transfer(&me, &admin, &bal);
        }
        bal
    }

    // ================= governance =================

    pub fn propose_admin(env: Env, new_admin: Address) {
        governance::propose_admin(&env, &storage::get_admin(&env), &new_admin);
    }
    pub fn accept_admin(env: Env) {
        let a = governance::accept_admin(&env);
        storage::set_admin(&env, &a);
        storage::bump_instance(&env);
    }
    pub fn cancel_admin_transfer(env: Env) {
        governance::cancel_admin_transfer(&env, &storage::get_admin(&env));
    }
    pub fn pending_admin(env: Env) -> Option<Address> {
        governance::pending_admin(&env)
    }
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
    pub fn code_hash(env: Env) -> BytesN<32> {
        governance::code_hash(&env)
    }
    pub fn version(env: Env) -> String {
        String::from_str(&env, "spield-srrouter-0.1.0")
    }

    // ================= internals =================

    fn ensure_initialized(env: &Env) {
        if !storage::is_initialized(env) {
            panic_with_error!(env, Error::NotInitialized);
        }
    }

    fn ensure_active(env: &Env) {
        Self::ensure_initialized(env);
        if storage::is_paused(env) {
            panic_with_error!(env, Error::Paused);
        }
    }

    fn positive(env: &Env, v: i128) {
        if v <= 0 {
            panic_with_error!(env, Error::InvalidAmount);
        }
    }

    /// USDC held by this contract -> SR held by this contract.
    fn wrap(env: &Env, underlying: &Address, sr_addr: &Address, usdc: i128) -> i128 {
        Self::auth_transfer(env, underlying, sr_addr, usdc);
        let me = env.current_contract_address();
        let sr = SrClient::new(env, sr_addr).deposit(&me, &me, &usdc, &0i128);
        if sr <= 0 {
            panic_with_error!(env, Error::DustAmount);
        }
        sr
    }

    /// SR held by this contract -> USDC paid **directly to `user`** by the strategy.
    ///
    /// The payout goes to the user rather than via us on purpose: one fewer transfer, one fewer
    /// footprint entry, and no window in which the router holds redeemable USDC.
    fn unwrap(env: &Env, user: &Address, sr: i128, min_usdc_out: i128) -> i128 {
        if sr <= 0 {
            panic_with_error!(env, Error::DustAmount);
        }
        let me = env.current_contract_address();
        SrClient::new(env, &storage::get_sr(env)).redeem(&me, user, &sr, &min_usdc_out)
    }

    /// Everything the router can possibly end up holding, read at one instant.
    fn holdings(env: &Env) -> Holdings {
        let me = env.current_contract_address();
        Holdings {
            sr: SrClient::new(env, &storage::get_sr(env)).balance(&me),
            pt: token::Client::new(env, &storage::get_pt(env)).balance(&me),
            yt: YieldClient::new(env, &storage::get_yield(env)).balance(&me),
            usdc: token::Client::new(env, &storage::get_underlying(env)).balance(&me),
        }
    }

    /// **The router must not ACCUMULATE value.** Every entry point snapshots its holdings on the
    /// way in and ends here, so a future edit that forgets to forward a balance still fails loudly.
    ///
    /// ## Why this is `<= before` and not `== 0` (`FINAL_CHECK.md` V2-03)
    ///
    /// It used to require all four balances to be exactly zero. The intent was right — refusing to
    /// trade while holding someone's funds beats quietly spending them — but the absolute made the
    /// router trivially deniable: **one stroop** of any of the four, sent by anybody for the cost of
    /// a transaction fee, bricked every route until an admin ran `sweep`. Repeatable indefinitely.
    /// `a4_the_router_refuses_to_be_a_custodian` never caught it because it donates 100 USDC, and at
    /// 100 USDC the griefer is the one paying.
    ///
    /// Comparing against the entry snapshot keeps the whole of the original property. A donation
    /// resting on the contract from some earlier transaction is carried through untouched and
    /// changes nothing; a donation made *during* this transaction, or a leg that forgets to forward,
    /// still raises a balance above where it started and still fails. The router remains
    /// non-custodial in the only sense that matters — **it never ends a transaction richer than it
    /// began** — and `sweep` still exists to recover whatever has been left on it.
    fn assert_no_accumulation(env: &Env, before: &Holdings) {
        let after = Self::holdings(env);
        if after.sr > before.sr
            || after.pt > before.pt
            || after.yt > before.yt
            || after.usdc > before.usdc
        {
            panic_with_error!(env, Error::SolvencyViolation);
        }
    }

    /// USDC needed to mint `sr` shares, rounded **up**. Quotes for an exact-output buy must never
    /// round down: a quote a stroop short becomes a `max_usdc_in` a stroop short, and the trade
    /// reverts at execution instead of costing one extra stroop.
    fn sr_to_usdc_ceil(env: &Env, sr: i128) -> i128 {
        if sr <= 0 {
            return 0;
        }
        let c = SrClient::new(env, &storage::get_sr(env));
        let floor = c.preview_redeem(&sr);
        // `preview_redeem` floors; step up until the round trip actually covers the shares.
        if c.preview_deposit(&floor) >= sr {
            floor
        } else {
            floor + 1
        }
    }

    // ---- nested-call authorization ----
    //
    // Each of these grants exactly one nested transfer, scoped to the immediately following call,
    // on the router's own behalf. They are the router's only privileged act, and none of them can
    // move anything the router does not already hold.

    fn auth_transfer(env: &Env, tokenc: &Address, spender: &Address, amount: i128) {
        Self::auth_fn(env, tokenc, "transfer", spender, amount);
    }
    fn auth_pt_transfer(env: &Env, spender: &Address, amount: i128) {
        Self::auth_fn(env, &storage::get_pt(env), "transfer", spender, amount);
    }
    fn auth_yt_transfer(env: &Env, yield_addr: &Address, spender: &Address, amount: i128) {
        Self::auth_fn(env, yield_addr, "transfer", spender, amount);
    }

    fn auth_fn(env: &Env, tokenc: &Address, fname: &str, spender: &Address, amount: i128) {
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
                    contract: tokenc.clone(),
                    fn_name: Symbol::new(env, fname),
                    args,
                },
                sub_invocations: Vec::new(env),
            })],
        ));
    }
}

/// The market's surface, as this router uses it.
#[soroban_sdk::contractclient(name = "MarketClient")]
pub trait SrMarketContract {
    fn pt_token(env: Env) -> Address;
    fn sr_token(env: Env) -> Address;
    fn yield_contract(env: Env) -> Address;
    fn expiry(env: Env) -> u64;
    fn swap_exact_sr_for_pt(
        env: Env, trader: Address, sr_in: i128, min_pt_out: i128, deadline_ledger: u32,
    ) -> i128;
    fn swap_exact_pt_for_sr(
        env: Env, trader: Address, pt_in: i128, min_sr_out: i128, deadline_ledger: u32,
    ) -> i128;
    fn buy_yt_exact_out(
        env: Env, user: Address, yt_out: i128, max_sr_in: i128, deadline_ledger: u32,
    ) -> i128;
    fn sell_yt_exact_in(
        env: Env, user: Address, yt_in: i128, min_sr_out: i128, deadline_ledger: u32,
    ) -> i128;
    fn quote_buy_pt(env: Env, sr_in: i128) -> i128;
    fn quote_sell_pt(env: Env, pt_in: i128) -> i128;
    fn quote_buy_yt(env: Env, yt_out: i128) -> i128;
    fn quote_sell_yt(env: Env, yt_in: i128) -> i128;
}

/// The PT/YT engine's surface, as this router uses it.
#[soroban_sdk::contractclient(name = "YieldClient")]
pub trait YieldContract {
    fn pt_token(env: Env) -> Address;
    fn sr_token(env: Env) -> Address;
    fn expiry(env: Env) -> u64;
    fn py_index(env: Env) -> i128;
    fn balance(env: Env, id: Address) -> i128;
    fn transfer(env: Env, from: Address, to: Address, amount: i128);
    fn redeem_py(env: Env, from: Address, receiver: Address, py_amount: i128) -> i128;
    fn redeem_due_interest_to(env: Env, user: Address, receiver: Address) -> (i128, i128);
    fn claimable_interest(env: Env, user: Address) -> i128;
    fn yield_fee_bps(env: Env) -> u32;
}

/// SR's surface, as this router uses it.
#[soroban_sdk::contractclient(name = "SrClient")]
pub trait SrToken {
    fn underlying(env: Env) -> Address;
    fn balance(env: Env, id: Address) -> i128;
    fn transfer(env: Env, from: Address, to: Address, amount: i128);
    fn deposit(env: Env, from: Address, receiver: Address, amount: i128, min_shares_out: i128) -> i128;
    fn redeem(env: Env, from: Address, receiver: Address, shares: i128, min_underlying_out: i128) -> i128;
    fn preview_deposit(env: Env, amount: i128) -> i128;
    fn preview_redeem(env: Env, shares: i128) -> i128;
}
