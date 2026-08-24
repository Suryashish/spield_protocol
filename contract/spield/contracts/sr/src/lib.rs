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
    contract, contractimpl, panic_with_error, token, Address, Env, String,
};
use spield_shared::{
    math,
    token::{self as tok},
    Error, YieldStrategyClient, SCALAR_12,
};

/// SR carries the underlying's decimals (USDC = 7) so wallets show sane numbers.
const DECIMALS: u32 = 7;

#[contract]
pub struct Sr;

#[contractimpl]
impl Sr {
    /// Bind the admin atomically at deploy (no deploy→init front-run window).
    pub fn __constructor(env: Env, admin: Address) {
        storage::set_admin(&env, &admin);
        storage::set_paused(&env, false);
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

    /// Underlying per 1e12 SR (SCALAR_12) — **the** yield oracle for everything above.
    ///
    /// Clamped to an all-time high-water mark, so it is monotonic non-decreasing even across a
    /// strategy rate dip. Read-only: never writes, so views and quotes are honest
    /// (`tofix.md` #27 is about exactly this class of bug in the old wrapper).
    pub fn exchange_rate(env: Env) -> i128 {
        let strategy = YieldStrategyClient::new(&env, &storage::get_strategy(&env));
        let live = strategy.current_rate();
        let hw = storage::rate_high_water(&env);
        if live > hw {
            live
        } else {
            hw
        }
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

    /// Advance the stored high-water mark to the live rate. Permissionless — it only ever raises a
    /// floor, never lowers it, and never moves funds. Keeps the clamp tight without needing a
    /// deposit to happen.
    pub fn sync_rate(env: Env) -> i128 {
        Self::ensure_initialized(&env);
        let strategy = YieldStrategyClient::new(&env, &storage::get_strategy(&env));
        let live = strategy.current_rate();
        if live > storage::rate_high_water(&env) {
            storage::set_rate_high_water(&env, live);
            storage::bump_instance(&env);
        }
        storage::rate_high_water(&env)
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
        if live > hw {
            storage::set_rate_high_water(env, live);
            return live;
        }
        if live < hw {
            // The clamp bit: the strategy came back BELOW its own high-water mark. Rare, and the
            // exact condition `tofix.md` #3 describes — surface it loudly rather than absorbing it.
            events::rate_clamped(env, live, hw);
        }
        hw
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

    fn burn_internal(env: &Env, from: &Address, amount: i128) {
        let b = tok::balance(env, from);
        if b < amount {
            panic_with_error!(env, Error::InsufficientBalance);
        }
        let h = Self::bump_horizon(env);
        tok::set_balance(env, from, b - amount, h);
        tok::set_total_supply(env, tok::total_supply(env) - amount);
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
