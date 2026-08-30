#![no_std]
//! # spield-sr — **SR: Standardized Return**
//!
//! Spield's answer to Pendle's **SY (Standardized Yield, EIP-5115)**. One token, one interface,
//! in front of *any* yield source.
//!
//! ## What SR is
//! SR is a **share** token, not a 1:1 wrapper. Deposit USDC, receive SR; the number of SR you hold
//! never changes, but each SR is worth more USDC over time. That growth *is* the yield.
//!
//! ```text
//! assets(user) = balance(user) * exchange_rate() / SCALAR_12
//! ```
//!
//! This mirrors EIP-5115's contract exactly — Pendle's own words: *"exchangeRate × syBalance / 1e18
//! must return the asset balance of the account."* SR shares are Blend bTokens 1:1, so
//! `exchange_rate()` is Blend's `b_rate` and there is no second index to keep in sync.
//!
//! ## Why the protocol needs it (this is the point, not the wrapping)
//! 1. **It is the adapter seam.** The PT/YT engine and the AMM above speak *only* SR. Adding a
//!    second yield source is a new SR deployment, not a change to any contract above it.
//! 2. **`exchange_rate()` is the single yield oracle.** PT/YT accounting runs on this one number.
//! 3. **It is half the AMM pool.** The market is PT/SR, so the pool's non-PT side keeps earning
//!    while it sits there. A PT/USDC pool leaves that half dead — measured at ~50k USDC/yr forgone
//!    per 1M seeded (`comparependle.md` §3.2). This is the single biggest LP-economics fix in the
//!    Pendle-shaped stack.
//!
//! ## Monotonic by contract — and the exact limit of that
//! SR clamps `exchange_rate()` to an all-time high-water mark, so it can never go down. A reported
//! dip becomes "SR stops growing for a while" instead of "everything above it reprices downward",
//! and the clamp is safe because payouts honour what the strategy *actually* returns (see
//! [`Sr::redeem`]).
//!
//! **This does NOT close `tofix.md` #3, and the tests say so.** That failure mode is the Blend
//! adapter *panicking* `RateOutOfBounds` inside `current_rate()` when it sees `current < last`.
//! SR never gets a value to clamp — the call reverts first. Measured in
//! `a_guarded_strategy_still_bricks_sr_on_a_rate_dip`: reads and deposits brick exactly as they do
//! in v1.
//!
//! What SR *does* improve is the exit. `redeem` never reads `current_rate`, so **SR redemption
//! survives a dip that bricks everything else** — unlike the v1 wrapper, whose `combine_and_redeem`
//! auto-claims and therefore reads the rate on the way out. Closing #3 properly still needs the
//! adapter-level fix (`strategy::reset_rate_floor`), not this clamp.
//!
//! ## Trust model
//! * **Holder funds: trustless.** SR is redeemable for the strategy's underlying at any time, with
//!   no maturity and no admin path to holder balances.
//! * **Admin: pause deposits only.** Cannot pause redemption, cannot move balances.

mod events;
mod storage;

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, panic_with_error, token, Address, Env, String, BytesN};
use spield_shared::{
    governance,
    math,
    token::{self as tok},
    Error, YieldStrategyClient, SCALAR_12,
};

/// SR carries the underlying's decimals (USDC = 7) so wallets show sane numbers.
const DECIMALS: u32 = 7;

/// Safety margin taken off the venue's reported liquidity before sizing a partial exit.
///
/// The venue's token balance is an **upper** bound on what it will pay: Blend also refuses
/// withdrawals that would push utilization past its ceiling, and its own accounting rounds. 1% is
/// generous next to either. The asymmetry is what sets it — being wrong low costs a user one extra
/// transaction; being wrong high costs them a revert and the information they came for.
const LIQUIDITY_HAIRCUT_BPS: i128 = 100;

#[contract]
pub struct Sr;

#[contractimpl]
impl Sr {
    /// Bind the admin atomically at deploy (no deploy→init front-run window).
    pub fn __constructor(env: Env, admin: Address) {
        storage::set_admin(&env, &admin);
        storage::set_paused(&env, false);
        governance::init(&env);
        storage::bump_instance(&env);
    }

    /// One-shot, admin-gated init. Discovers the underlying from the strategy rather than being
    /// told it, so an SR can never be wired to an asset its strategy does not actually hold.
    pub fn initialize(env: Env, strategy: Address) {
        if storage::is_initialized(&env) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        storage::get_admin(&env).require_auth();

        let s = YieldStrategyClient::new(&env, &strategy);
        let underlying = s.underlying();
        // Seed the high-water mark from the live rate so the first deposit prices correctly.
        let rate = s.current_rate();
        if rate <= 0 {
            panic_with_error!(&env, Error::RateOutOfBounds);
        }

        storage::set_initialized(&env);
        storage::set_strategy(&env, &strategy);
        storage::set_underlying(&env, &underlying);
        storage::set_rate_high_water(&env, rate);
        storage::bump_instance(&env);
    }

    // ================= EIP-5115-shaped surface =================

    /// **Wrap.** Pull `amount` underlying from `from`, supply it to the strategy, and mint the
    /// resulting shares to `receiver`. Returns SR minted.
    ///
    /// Mirrors SY's `deposit(receiver, tokenIn, amountTokenToDeposit, minSharesOut)`. We take one
    /// `token_in` implicitly (the strategy's underlying) — a multi-asset front door is an
    /// aggregator concern that belongs in a router, not here.
    pub fn deposit(
        env: Env,
        from: Address,
        receiver: Address,
        amount: i128,
        min_shares_out: i128,
    ) -> i128 {
        Self::ensure_can_deposit(&env);
        from.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let strategy_addr = storage::get_strategy(&env);
        let strategy = YieldStrategyClient::new(&env, &strategy_addr);
        let underlying = storage::get_underlying(&env);
        let me = env.current_contract_address();

        // Below `ceil(rate)` stroops Blend floors the credited shares to zero and rejects the
        // supply inside the pool. Catch it here so the caller gets our own error.
        let rate = Self::live_rate(&env, &strategy);
        if amount < math::min_mintable(rate) {
            panic_with_error!(&env, Error::DustAmount);
        }

        // ── The launch TVL cap (`tofix.md` #3) ──────────────────────────────────────────────────
        //
        // #3 accepts a real residual: a deep Blend bad-debt event leaves backing below principal, and
        // every mutation then refuses — withdrawals included — until it recovers. The agreed
        // mitigation is a TVL cap that bounds the worst case to a number that can be absorbed or
        // made whole off-protocol.
        //
        // That mitigation was written down as *operational*: "decide the number, write it down,
        // enforce it operationally". A cap that lives in a runbook is not a cap. It is enforced here
        // instead, so exceeding it is impossible rather than merely against policy.
        //
        // ## Measured on COST BASIS, not on mark-to-market value (`anyfix.md` F4)
        //
        // The cap bounds the **loss**, and the loss is denominated in the underlying a depositor
        // could fail to get back — so growth from yield must not count as new exposure. It is the
        // users' own return, and letting it consume headroom would slowly close deposits on a
        // healthy protocol.
        //
        // This used to compare `total_supply x rate`, which is exactly that growth: measured at
        // 66 bps of TVL over 90 days, closing 6% of a 100-USDC headroom on a protocol where nothing
        // had happened but time. [`storage::total_principal`] tracks what was actually deposited
        // instead — it rises by the deposit and falls proportionally as shares are destroyed — so
        // the check is rate-free and cannot drift.
        //
        // Being rate-free is also what makes [`Self::deposit_headroom`] **actionable**
        // (`anyfix.md` F3): the view and this check now read the same stored integer, so depositing
        // exactly the advertised headroom always succeeds.
        let cap = storage::deposit_cap(&env);
        if cap > 0 && storage::total_principal(&env) + amount > cap {
            panic_with_error!(&env, Error::DepositCapExceeded);
        }

        token::Client::new(&env, &underlying).transfer(&from, &me, &amount);
        Self::approve_strategy_pull(&env, &underlying, &strategy_addr, amount);
        let shares = strategy.deposit(&me, &amount);
        if shares <= 0 {
            panic_with_error!(&env, Error::DustAmount);
        }
        if shares < min_shares_out {
            panic_with_error!(&env, Error::MinOutNotMet);
        }

        Self::mint_internal(&env, &receiver, shares);
        storage::set_total_principal(&env, storage::total_principal(&env) + amount);
        events::deposited(&env, &from, &receiver, amount, shares, rate);
        shares
    }

    /// **Unwrap.** Burn `shares` SR from `from` and send the released underlying to `receiver`.
    /// Returns the underlying actually paid out.
    ///
    /// Mirrors SY's `redeem(...)`. The amount returned is what the strategy **actually** paid, not
    /// `shares × rate` — a Blend liquidity shortfall or a rounding difference shows up honestly in
    /// the return value rather than being papered over (`tofix.md` #28).
    pub fn redeem(
        env: Env,
        from: Address,
        receiver: Address,
        shares: i128,
        min_underlying_out: i128,
    ) -> i128 {
        Self::ensure_initialized(&env); // an exit — open while paused
        from.require_auth();
        if shares <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let bal = tok::balance(&env, &from);
        if bal < shares {
            panic_with_error!(&env, Error::InsufficientBalance);
        }

        // Burn first (checks-effects), then pull the value out of the strategy.
        Self::burn_internal(&env, &from, shares);

        let strategy = YieldStrategyClient::new(&env, &storage::get_strategy(&env));
        let out = strategy.redeem(&receiver, &shares);
        if out <= 0 {
            panic_with_error!(&env, Error::WithdrawShortfall);
        }
        if out < min_underlying_out {
            panic_with_error!(&env, Error::MinOutNotMet);
        }
        events::redeemed(&env, &from, &receiver, shares, out);
        out
    }

    /// **The largest redemption that can succeed right now**, in SR shares (`tofix.md` #20).
    ///
    /// Exits do not only fail when the protocol is insolvent. They fail — far more often — because
    /// borrowers have taken the venue's supply and there is nothing on hand to pay with. Before
    /// this, that produced a bare revert: no way to find out in advance, and no way to discover the
    /// smaller amount that would have worked.
    ///
    /// `i128::MAX` when liquidity comfortably covers everything, so the common case needs no
    /// special handling in callers.
    ///
    /// **This is an estimate, and deliberately a conservative one.** The venue's balance is an upper
    /// bound on what it can pay — Blend additionally refuses withdrawals that would push utilization
    /// past its ceiling — so [`LIQUIDITY_HAIRCUT_BPS`] is taken off before converting to shares.
    /// Being wrong low costs a user a second transaction; being wrong high costs them a revert.
    pub fn max_redeemable(env: Env) -> i128 {
        let strategy = YieldStrategyClient::new(&env, &storage::get_strategy(&env));
        // **Refresh the stored rate before using it** (`anyfix.md` F1/F1b).
        //
        // This function divides available underlying by the rate to get shares, so a rate that lags
        // — and the stored one only ever lags — returns MORE shares than the venue can pay for.
        // Measured at 787 bps of over-statement after 30 days unsynced, which is enough to make
        // `redeem_partial` revert: the exit path whose entire purpose is to never revert.
        //
        // The comparison below has the same problem in a sharper form: with both sides valued at a
        // stale rate it can return `i128::MAX` — "no constraint at all" — while a full redemption
        // reverts, which is the worst thing a wallet can be told.
        //
        // Syncing here is safe for the reason `sync_rate` explains: it ALWAYS writes, so the
        // footprint is a function of the call graph alone. That is the property whose absence caused
        // the intermittent `storage: exceeded_limit` failure, and it is preserved. `exchange_rate`
        // stays a pure read; this is not that.
        let rate = Self::sync_rate(env.clone());
        let avail = strategy.available_liquidity();
        if avail <= 0 {
            return 0;
        }
        // No crunch at all: the venue can cover every share this wrapper has issued, so there is
        // nothing to clamp and nothing to be conservative about.
        //
        // This early return is load-bearing, not an optimization. Applying the haircut
        // unconditionally would cap every redemption at 99% of the position — meaning a user could
        // never fully exit through this path even on a completely healthy venue. Caught by
        // `max_redeemable_is_unbounded_when_liquidity_is_healthy`.
        if avail >= Self::total_assets(env.clone()) {
            return i128::MAX;
        }
        let usable = avail - (avail * LIQUIDITY_HAIRCUT_BPS / 10_000);
        if usable <= 0 {
            return 0;
        }
        math::underlying_to_shares(&env, usable, rate).unwrap_or(0)
    }

    /// **Redeem up to `shares`, taking whatever the venue can actually pay.**
    ///
    /// The plain [`Self::redeem`] is all-or-nothing: ask for more than the venue holds and the whole
    /// transaction reverts, leaving the user with nothing and no information. During a liquidity
    /// crunch — the *likely* failure mode, not the exotic one — that is the difference between
    /// getting most of your money out and getting none of it.
    ///
    /// So this clamps to what is available and burns only the shares it actually redeems. The rest
    /// of the position stays untouched and can be withdrawn as liquidity returns.
    ///
    /// Returns `(shares_burned, underlying_paid)`.
    ///
    /// ## Why clamping here is safe to authorize
    ///
    /// `shares` is the user's **ceiling**, not a computed figure — the same shape as every other
    /// amount a wallet signs in this codebase. Burning fewer than authorized can only ever leave the
    /// user with more than they asked to give up.
    ///
    /// `min_underlying_out` still applies to what is actually paid, so a user who would rather fail
    /// than take a partial fill sets it to the full amount and gets exactly today's behaviour.
    pub fn redeem_partial(
        env: Env,
        from: Address,
        receiver: Address,
        shares: i128,
        min_underlying_out: i128,
    ) -> (i128, i128) {
        Self::ensure_initialized(&env); // an exit — open while paused
        from.require_auth();
        if shares <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let bal = tok::balance(&env, &from);
        if bal < shares {
            panic_with_error!(&env, Error::InsufficientBalance);
        }

        let capacity = Self::max_redeemable(env.clone());
        let take = if shares < capacity { shares } else { capacity };
        if take <= 0 {
            // Nothing is withdrawable at all. Fail loudly rather than returning (0, 0), which a
            // caller could easily mistake for success.
            panic_with_error!(&env, Error::WithdrawShortfall);
        }

        Self::burn_internal(&env, &from, take);
        let strategy = YieldStrategyClient::new(&env, &storage::get_strategy(&env));
        let out = strategy.redeem(&receiver, &take);
        if out <= 0 {
            panic_with_error!(&env, Error::WithdrawShortfall);
        }
        if out < min_underlying_out {
            panic_with_error!(&env, Error::MinOutNotMet);
        }
        events::redeemed(&env, &from, &receiver, take, out);
        (take, out)
    }

    /// Underlying per 1e12 SR (SCALAR_12) — **the** yield oracle for everything above.
    ///
    /// **A genuinely pure read of stored state.** It does NOT call the strategy.
    ///
    /// That is not a micro-optimization, it is a correctness requirement discovered on testnet
    /// (2026-08-24). `strategy::current_rate()` writes its `RateBound` *only when the rate has
    /// moved*. A transaction that reaches it through a read path therefore has a footprint that
    /// depends on timing: simulation sees no write and records the strategy read-only, then a
    /// ledger passes, the rate moves, and execution needs to write — so the host rejects the whole
    /// transaction with `storage: exceeded_limit — trying to access contract instance outside of
    /// the footprint`. Intermittent, unreproducible locally, and fatal to `buy_yt_exact_out`.
    ///
    /// So the split is explicit: this view reads the stored high-water mark and nothing else, while
    /// every mutating path refreshes it through [`Self::sync_rate`], which ALWAYS writes and is
    /// therefore deterministic in the footprint.
    ///
    /// The value is monotonic non-decreasing by construction (see the module docs), and can only
    /// ever lag the strategy — never lead it. Lagging is the safe direction: it under-states yield
    /// and under-mints PY. `mint_py` / `redeem_py` / `redeem_due_interest` all sync first, so no
    /// value-moving path ever runs on a stale rate.
    pub fn exchange_rate(env: Env) -> i128 {
        storage::rate_high_water(&env)
    }

    /// The underlying value of `user`'s SR right now.
    pub fn assets_of(env: Env, user: Address) -> i128 {
        let rate = Self::exchange_rate(env.clone());
        math::shares_to_underlying(&env, tok::balance(&env, &user), rate).unwrap_or(0)
    }

    /// SR that `amount` underlying would mint at the current rate. Panic-free (`0` = no quote).
    pub fn preview_deposit(env: Env, amount: i128) -> i128 {
        if amount <= 0 {
            return 0;
        }
        let rate = Self::exchange_rate(env.clone());
        math::underlying_to_shares(&env, amount, rate).unwrap_or(0)
    }

    /// Underlying that `shares` SR would release at the current rate. Panic-free (`0` = no quote).
    pub fn preview_redeem(env: Env, shares: i128) -> i128 {
        if shares <= 0 {
            return 0;
        }
        let rate = Self::exchange_rate(env.clone());
        math::shares_to_underlying(&env, shares, rate).unwrap_or(0)
    }

    /// The asset SR is denominated in (SY's `assetInfo`, reduced to the one field we need).
    pub fn underlying(env: Env) -> Address {
        storage::get_underlying(&env)
    }

    /// The yield source behind this SR (SY's `yieldToken`).
    pub fn strategy(env: Env) -> Address {
        storage::get_strategy(&env)
    }

    /// **Permissionless TTL keep-alive for an SR holder's balance entry** (`tofix.md` #30).
    ///
    /// SR balances are bumped on every write, but a holder who deposits and then simply *holds* is
    /// never written to. SR has no maturity of its own, so unlike a receipt or an LP share there is
    /// no natural end date bounding the exposure — a dormant holder is the normal case, not the
    /// edge case. Anyone may call this: it only ever prolongs an entry, never mutates accounting.
    ///
    /// No-ops for an address with no balance entry.
    pub fn bump_holder(env: Env, user: Address) {
        Self::ensure_initialized(&env);
        tok::bump_balance(&env, &user, Self::bump_horizon(&env));
        storage::bump_instance(&env);
    }

    /// Advance the stored high-water mark to the live rate. Permissionless — it only ever raises a
    /// floor, never lowers it, and never moves funds. Keeps the clamp tight without needing a
    /// deposit to happen.
    pub fn sync_rate(env: Env) -> i128 {
        Self::ensure_initialized(&env);
        let strategy = YieldStrategyClient::new(&env, &storage::get_strategy(&env));
        let live = strategy.current_rate();
        let hw = storage::rate_high_water(&env);
        let next = if live > hw { live } else { hw };
        if live < hw {
            events::rate_clamped(&env, live, hw);
        }
        // ALWAYS write, even when the value is unchanged. A conditional write makes the
        // transaction footprint depend on timing, which is exactly the failure documented on
        // `exchange_rate`. Writing unconditionally costs one ledger entry we are already touching.
        storage::set_rate_high_water(&env, next);
        storage::bump_instance(&env);
        next
    }

    // ================= SEP-41 =================

    pub fn balance(env: Env, id: Address) -> i128 {
        tok::balance(&env, &id)
    }

    pub fn total_supply(env: Env) -> i128 {
        tok::total_supply(&env)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        Self::move_tokens(&env, &from, &to, amount);
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        tok::spend_allowance(&env, &from, &spender, amount);
        Self::move_tokens(&env, &from, &to, amount);
    }

    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        Self::burn_internal(&env, &from, amount);
    }

    pub fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        tok::spend_allowance(&env, &from, &spender, amount);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        Self::burn_internal(&env, &from, amount);
    }

    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        tok::allowance(&env, &from, &spender)
    }

    pub fn approve(env: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        from.require_auth();
        tok::set_allowance(&env, &from, &spender, amount, expiration_ledger);
    }

    pub fn decimals(_env: Env) -> u32 {
        DECIMALS
    }

    pub fn name(env: Env) -> String {
        String::from_str(&env, "Spield Standardized Return")
    }

    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "SR")
    }

    // ================= admin =================

    /// Set the TVL cap, in underlying units. `0` lifts it.
    ///
    /// **This gates deposits only.** `redeem` never consults it, so lowering the cap — or setting one
    /// below current TVL — can never trap a user. That is the whole reason it is safe to hand an
    /// admin: the worst they can do with it is stop new money coming in, which they can already do
    /// with `pause`.
    pub fn set_deposit_cap(env: Env, cap: i128) {
        storage::get_admin(&env).require_auth();
        if cap < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        storage::set_deposit_cap(&env, cap);
        storage::bump_instance(&env);
        events::deposit_cap_set(&env, cap);
    }

    /// The current TVL cap in underlying. `0` = uncapped.
    pub fn deposit_cap(env: Env) -> i128 {
        storage::deposit_cap(&env)
    }

    /// Underlying currently deployed through this wrapper, **marked to market** — supply valued at
    /// the stored rate. This is the dashboard number; it is NOT what the cap measures.
    ///
    /// It may lag by one sync, which under-states it. See [`Self::total_principal`] for the cap's
    /// measure and why the two are deliberately different.
    pub fn total_assets(env: Env) -> i128 {
        math::shares_to_underlying(&env, tok::total_supply(&env), storage::rate_high_water(&env))
            .unwrap_or(0)
    }

    /// **Cost basis** — underlying deposited and not yet withdrawn. This is what the deposit cap is
    /// measured against (`anyfix.md` F4).
    ///
    /// It rises by the exact amount deposited and falls proportionally as shares are destroyed, so
    /// it is unaffected by yield: a protocol where nothing happens but time does not slowly close
    /// its own deposits. It is a plain stored integer, which is what makes
    /// [`Self::deposit_headroom`] exact rather than an estimate.
    pub fn total_principal(env: Env) -> i128 {
        storage::total_principal(&env)
    }

    /// Underlying that could still be deposited before the cap bites. `i128::MAX` when uncapped.
    ///
    /// **Actionable**: this is computed from the same stored integer [`Self::deposit`] checks, with
    /// no rate in either, so depositing exactly this number always succeeds (`anyfix.md` F3). It
    /// used to be derived from a mark-to-market valuation while `deposit` synced the rate first, so
    /// a max button built on it failed every time.
    pub fn deposit_headroom(env: Env) -> i128 {
        let cap = storage::deposit_cap(&env);
        if cap == 0 {
            return i128::MAX;
        }
        let used = storage::total_principal(&env);
        if used >= cap { 0 } else { cap - used }
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

    pub fn is_paused(env: Env) -> bool {
        storage::is_paused(&env)
    }

    pub fn admin(env: Env) -> Address {
        storage::get_admin(&env)
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
        String::from_str(&env, "spield-sr-0.1.0")
    }

    // ================= internals =================

    fn ensure_initialized(env: &Env) {
        if !storage::is_initialized(env) {
            panic_with_error!(env, Error::NotInitialized);
        }
    }

    fn ensure_can_deposit(env: &Env) {
        Self::ensure_initialized(env);
        if storage::is_paused(env) {
            panic_with_error!(env, Error::Paused);
        }
    }

    /// The live strategy rate, also ratcheting the high-water mark. Used on the mutating paths
    /// where a write is already happening.
    fn live_rate(env: &Env, strategy: &YieldStrategyClient) -> i128 {
        let live = strategy.current_rate();
        let hw = storage::rate_high_water(env);
        let next = if live > hw { live } else { hw };
        if live < hw {
            // The clamp bit: the strategy came back BELOW its own high-water mark. Rare, and the
            // exact condition `tofix.md` #3 describes — surface it loudly rather than absorbing it.
            events::rate_clamped(env, live, hw);
        }
        // Unconditional write — see `sync_rate`.
        storage::set_rate_high_water(env, next);
        next
    }

    /// SR balances have no maturity of their own — bump them on the long window.
    fn bump_horizon(env: &Env) -> u64 {
        env.ledger().timestamp() + 365 * 24 * 60 * 60
    }

    fn move_tokens(env: &Env, from: &Address, to: &Address, amount: i128) {
        if amount <= 0 {
            panic_with_error!(env, Error::InvalidAmount);
        }
        let fb = tok::balance(env, from);
        if fb < amount {
            panic_with_error!(env, Error::InsufficientBalance);
        }
        let h = Self::bump_horizon(env);
        tok::set_balance(env, from, fb - amount, h);
        tok::set_balance(env, to, tok::balance(env, to) + amount, h);
        events::transferred(env, from, to, amount);
    }

    fn mint_internal(env: &Env, to: &Address, amount: i128) {
        let h = Self::bump_horizon(env);
        tok::set_balance(env, to, tok::balance(env, to) + amount, h);
        tok::set_total_supply(env, tok::total_supply(env) + amount);
        storage::bump_instance(env);
    }

    /// Destroy `amount` shares and release the matching slice of cost basis.
    ///
    /// Every path that destroys shares comes through here — `redeem`, `redeem_partial`, and the
    /// SEP-41 burns — so the cap's exposure figure is released proportionally no matter how the
    /// shares leave. Proportional rather than "the amount paid out" on purpose: the cap measures
    /// what was put in, and a holder taking out half their shares has withdrawn half their
    /// exposure whatever the rate has done since.
    ///
    /// Burning the last share releases exactly the remaining principal, because
    /// `principal * shares / shares == principal`.
    fn burn_internal(env: &Env, from: &Address, amount: i128) {
        let b = tok::balance(env, from);
        if b < amount {
            panic_with_error!(env, Error::InsufficientBalance);
        }
        let supply_before = tok::total_supply(env);
        let h = Self::bump_horizon(env);
        tok::set_balance(env, from, b - amount, h);
        tok::set_total_supply(env, supply_before - amount);

        let principal = storage::total_principal(env);
        if principal > 0 {
            let released = if supply_before > 0 {
                math::mul_div_floor(env, principal, amount, supply_before).unwrap_or(0)
            } else {
                principal
            };
            storage::set_total_principal(env, principal - released);
        }
        storage::bump_instance(env);
    }

    /// Authorize the strategy's `deposit` to pull `amount` underlying from this contract.
    /// Scope is the *next* call only, so this must immediately precede `strategy.deposit`.
    fn approve_strategy_pull(env: &Env, underlying: &Address, strategy: &Address, amount: i128) {
        use soroban_sdk::{
            auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
            IntoVal, Symbol, Vec,
        };
        let me = env.current_contract_address();
        let args: Vec<soroban_sdk::Val> = (me.clone(), strategy.clone(), amount).into_val(env);
        env.authorize_as_current_contract(Vec::from_array(
            env,
            [InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: underlying.clone(),
                    fn_name: Symbol::new(env, "transfer"),
                    args,
                },
                sub_invocations: Vec::new(env),
            })],
        ));
    }
}

/// Re-export for downstream crates that need the scalar without depending on shared directly.
pub const RATE_SCALAR: i128 = SCALAR_12;
