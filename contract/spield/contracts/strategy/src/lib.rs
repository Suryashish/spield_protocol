#![no_std]
//! # spield-strategy — Blend yield-source adapter
//!
//! The only contract in Spield that knows Blend's `submit` / `Request` / `Reserve` shapes.
//! It implements the [`spield_shared::strategy::YieldStrategy`] interface so the wrapper can
//! talk to "the yield source" abstractly (plan §3.2 / §3.5).
//!
//! ## What it does
//! Holds **its own** Blend supply position in one underlying asset (USDC on testnet). Deposits
//! route user USDC into Blend (`RequestType::Supply`); withdrawals pull underlying back out
//! (`RequestType::Withdraw`). "The index" is Blend's real `b_rate`, read live via `get_reserve`
//! — never pushed by a key (this is the SCF-#3 / #8 fix at the source).
//!
//! ## Trust / auth
//! No privileged minting. The only mutating entry points (`deposit`/`redeem`/`redeem_underlying`)
//! require the configured `wrapper` to authorize, and they move only funds the wrapper directs
//! into/out of *this contract's own* Blend position. `initialize` is admin-gated and one-shot.
//!
//! ## Pause (mainnet-readiness #8) — deliberately none here
//! The strategy has **no pause flag of its own** by design. It has no user-facing inflow: deposits
//! can only arrive via the `wrapper` (the sole authorized caller), so pausing the wrapper's `mint`
//! already halts every new inflow into Blend. The strategy's other mutating paths
//! (`redeem`/`redeem_underlying`) are pure *outflows* serving user exits, which must stay open even
//! during an emergency — so there is nothing here a pause should block. Adding a strategy pause would
//! only create a way to trap funds (block exits) with no inflow benefit, so we intentionally omit it.

use blend_contract_sdk::pool::{Client as PoolClient, Request};
use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractimpl, contracttype, panic_with_error, token, Address, BytesN, Env, IntoVal,
    String, Symbol, Vec,
};
use spield_shared::{governance, math, types::RateBound, Error};

/// Blend `RequestType` discriminants (verified from `blend-contracts-v2/pool/src/pool/actions.rs`).
/// Encoded as the plain `u32` `request_type` on the wire.
const REQ_SUPPLY: u32 = 0;
const REQ_WITHDRAW: u32 = 1;

/// Instance-storage keys.
#[derive(Clone)]
#[contracttype]
enum DataKey {
    /// One-shot init guard (SCF #7).
    Initialized,
    /// Admin (can pause/upgrade later; not able to move user funds).
    Admin,
    /// The wrapper contract — the only caller allowed to deposit/redeem.
    Wrapper,
    /// The Blend pool contract address.
    Pool,
    /// The underlying asset (USDC SAC) this strategy supplies.
    Underlying,
    /// The reserve index of `Underlying` within the Blend pool (cached at init; Blend reserve
    /// indices are immutable once assigned).
    ReserveIndex,
    /// Rate sanity bound + last-observed rate (defence-in-depth).
    Bound,
}

const INSTANCE_BUMP_LO: u32 = 30 * 24 * 60 * 60 / 5; // ~30 days in ledgers (5s close)
const INSTANCE_BUMP_HI: u32 = 60 * 24 * 60 * 60 / 5; // ~60 days

/// The supplied asset (USDC) must have exactly 7 decimals (Stellar USDC, testnet + mainnet).
const EXPECTED_UNDERLYING_DECIMALS: u32 = 7;

#[contract]
pub struct BlendStrategy;

#[contractimpl]
impl BlendStrategy {
    /// One-shot, admin-gated initialization.
    ///
    /// * `admin` — operational admin (pause/upgrade path; cannot move user funds).
    /// * `wrapper` — the Spield wrapper; the sole authorized caller of deposit/redeem.
    /// * `pool` — the Blend pool contract.
    /// * `underlying` — the asset SAC (USDC) to supply.
    /// * `max_apr_bps` — max allowed **annual** `b_rate` growth, in basis points (the sanity bound,
    ///   pro-rated by elapsed time on each read). Set generously above Blend's real max borrow APR
    ///   (e.g. `30_000` = 300%) so honest reads always pass while a wild read is still caught.
    pub fn initialize(
        env: Env,
        wrapper: Address,
        pool: Address,
        underlying: Address,
        max_apr_bps: u32,
    ) {
        let storage = env.storage().instance();
        if storage.has(&DataKey::Initialized) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        // Only the admin bound atomically at deploy (constructor) may finish setup — front-run-proof.
        Self::current_admin(&env).require_auth();

        // The supplied asset must have the decimals the share/rate math expects (don't assume).
        if token::Client::new(&env, &underlying).decimals() != EXPECTED_UNDERLYING_DECIMALS {
            panic_with_error!(&env, Error::UnexpectedDecimals);
        }

        // Discover & cache the reserve index for `underlying` from the live pool.
        let pool_client = PoolClient::new(&env, &pool);
        let reserve = pool_client.get_reserve(&underlying);
        let reserve_index = reserve.config.index;

        storage.set(&DataKey::Initialized, &true);
        storage.set(&DataKey::Wrapper, &wrapper);
        storage.set(&DataKey::Pool, &pool);
        storage.set(&DataKey::Underlying, &underlying);
        storage.set(&DataKey::ReserveIndex, &reserve_index);
        storage.set(
            &DataKey::Bound,
            &RateBound {
                last_rate: reserve.data.b_rate,
                last_ts: env.ledger().timestamp(),
                max_apr_bps,
            },
        );
        storage.extend_ttl(INSTANCE_BUMP_LO, INSTANCE_BUMP_HI);
    }

    /// **Atomic deploy-time constructor (no deploy→init front-run).** Binds `admin` the moment the
    /// strategy exists; the remaining [`Self::initialize`] is then gated to this admin.
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        governance::init(&env);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_BUMP_LO, INSTANCE_BUMP_HI);
    }

    /// Pull `amount` USDC from `from` (the wrapper) and supply it to Blend. Returns shares minted.
    pub fn deposit(env: Env, from: Address, amount: i128) -> i128 {
        Self::require_wrapper(&env, &from);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let pool = Self::pool_addr(&env);
        let underlying = Self::underlying(env.clone());
        let index = Self::reserve_index(&env);

        // Pull the underlying from the wrapper into this strategy contract.
        let token_client = token::Client::new(&env, &underlying);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        // Read shares we hold BEFORE supplying, so we can attribute exactly the delta.
        let shares_before = Self::raw_supply_shares(&env, &pool, index);

        // Supply to Blend: from = spender = to = this contract (we own the position).
        let me = env.current_contract_address();
        let requests = Vec::from_array(
            &env,
            [Request {
                request_type: REQ_SUPPLY,
                address: underlying.clone(),
                amount,
            }],
        );
        // Blend's `submit` will, deeper in the stack, invoke
        // `usdc.transfer(from = this contract, to = pool, amount)`. Because *this contract* is
        // the `from`, the token's `from.require_auth()` must be satisfied on our behalf — we
        // pre-authorize exactly that one sub-call. (Required on-chain too, not a test artifact.)
        Self::authorize_supply_transfer(&env, &underlying, &me, &pool, amount);
        let pool_client = PoolClient::new(&env, &pool);
        let positions = pool_client.submit(&me, &me, &me, &requests);

        let shares_after = positions.supply.get(index).unwrap_or(0);
        let minted = shares_after - shares_before;
        if minted <= 0 {
            // Blend credited no shares — refuse rather than silently mint unbacked PT/YT.
            panic_with_error!(&env, Error::NoStrategyPosition);
        }
        Self::bump_instance(&env);
        minted
    }

    /// Withdraw `shares` worth of underlying from Blend and send it to `to`. Returns underlying out.
    pub fn redeem(env: Env, to: Address, shares: i128) -> i128 {
        Self::require_wrapper_any(&env);
        if shares <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        // Convert the share count to an underlying amount at the live rate, then withdraw that.
        let rate = Self::current_rate(env.clone());
        let amount = math::shares_to_underlying(&env, shares, rate)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        Self::withdraw_underlying(&env, &to, amount)
    }

    /// Withdraw exactly `amount` underlying from Blend and send it to `to`. Returns shares burned.
    pub fn redeem_underlying(env: Env, to: Address, amount: i128) -> i128 {
        Self::require_wrapper_any(&env);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let pool = Self::pool_addr(&env);
        let index = Self::reserve_index(&env);
        let shares_before = Self::raw_supply_shares(&env, &pool, index);
        let got = Self::withdraw_underlying(&env, &to, amount);
        let shares_after = Self::raw_supply_shares(&env, &pool, index);
        // Defence-in-depth: ensure Blend actually paid out what we asked.
        if got + 1 < amount {
            panic_with_error!(&env, Error::WithdrawShortfall);
        }
        shares_before - shares_after
    }

    /// Live Blend `b_rate` (SCALAR_12), with the sanity bound applied and `last_rate` advanced.
    pub fn current_rate(env: Env) -> i128 {
        let pool = Self::pool_addr(&env);
        let underlying = Self::underlying(env.clone());
        let reserve = PoolClient::new(&env, &pool).get_reserve(&underlying);
        let rate = reserve.data.b_rate;

        let mut bound: RateBound = env
            .storage()
            .instance()
            .get(&DataKey::Bound)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));

        // Time-aware sanity bound: the allowed `b_rate` rise is pro-rated by the seconds elapsed
        // since `last_ts`, so a long-untouched position never false-trips (the soft-brick fix).
        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(bound.last_ts);
        math::check_rate_bound_timed(&env, bound.last_rate, rate, elapsed, bound.max_apr_bps)
            .unwrap_or_else(|e| panic_with_error!(&env, e));

        // Advance the observation point. `last_rate` rises only when the rate actually rose;
        // `last_ts` always moves to now so the next read's elapsed window is measured from here.
        //
        // The write is **UNCONDITIONAL**, and that is load-bearing rather than wasteful.
        //
        // It used to be guarded by `if rate > bound.last_rate || now > bound.last_ts`. Whether the
        // guard passed therefore depended on how much time elapsed between a transaction's
        // simulation and its execution — so a caller could simulate with no write (entry recorded
        // read-only in the footprint) and then execute needing one, which the host rejects with
        // `storage: exceeded_limit — trying to access contract instance outside of the footprint`.
        // That made every caller above this intermittently unusable on a live network; it cost a
        // day to find on testnet (2026-08-24) and is invisible in the local suite, where simulation
        // and execution are the same ledger.
        //
        // Writing the same value back is cheap (the entry is already in the read set) and makes the
        // footprint a function of the call graph alone, which is what simulation can actually
        // predict.
        if rate > bound.last_rate {
            bound.last_rate = rate;
        }
        bound.last_ts = now;
        env.storage().instance().set(&DataKey::Bound, &bound);
        Self::bump_instance(&env);
        rate
    }

    /// Underlying value of `shares` at the live rate.
    pub fn position_value(env: Env, shares: i128) -> i128 {
        let rate = Self::current_rate(env.clone());
        math::shares_to_underlying(&env, shares, rate).unwrap_or(0)
    }

    /// Total shares this strategy holds in Blend (the wrapper's whole position).
    pub fn total_shares(env: Env) -> i128 {
        let pool = Self::pool_addr(&env);
        let index = Self::reserve_index(&env);
        Self::raw_supply_shares(&env, &pool, index)
    }

    /// The underlying asset SAC.
    pub fn underlying(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Underlying)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    /// The Blend pool address (read-only view, handy for the frontend / dashboard).
    pub fn pool(env: Env) -> Address {
        Self::pool_addr(&env)
    }

    // ---------- rate-bound admin (mainnet-readiness #3) ----------

    /// The current `b_rate` sanity bound: `(last_rate, last_ts, max_apr_bps)`. View for monitoring —
    /// lets ops watch the last observed rate/time and the configured annual-growth ceiling.
    pub fn rate_bound(env: Env) -> (i128, u64, u32) {
        let bound = Self::bound(&env);
        (bound.last_rate, bound.last_ts, bound.max_apr_bps)
    }

    /// Widen (or tighten) the max **annual** `b_rate` growth, in basis points (the bound is then
    /// pro-rated by elapsed time on each read — see `check_rate_bound_timed`). Admin only.
    ///
    /// This is the safety valve for the soft-brick risk: if Blend's real `b_rate` ever rises faster
    /// than the configured annual ceiling, **every** `current_rate` read would otherwise panic and
    /// freeze the whole protocol (no claims/redeems/mints/solvency reads). The admin can raise the
    /// ceiling to unstick it without a redeploy. `last_rate`/`last_ts` are preserved.
    ///
    /// Intentionally *immediate* (not timelocked): it is a liveness safety valve that can only widen
    /// tolerance on an already-trusted, monotonic Blend rate — it can never mint value or move funds.
    /// Raising it does not bypass any solvency check; the wrapper still asserts `backing >= principal`
    /// against Blend's *real* position on every mutation.
    pub fn set_max_apr_bps(env: Env, max_apr_bps: u32) {
        Self::current_admin(&env).require_auth();
        let mut bound = Self::bound(&env);
        bound.max_apr_bps = max_apr_bps;
        env.storage().instance().set(&DataKey::Bound, &bound);
        Self::bump_instance(&env);
    }

    /// **The recovery valve for a `b_rate` DECREASE.** Lowers the stored `last_rate` high-water
    /// mark to the pool's live `b_rate`, re-stamping `last_ts` to now. Admin only. Returns the
    /// floor in effect after the call.
    ///
    /// `check_rate_bound_timed` rejects `current < last` outright, because Blend documents `b_rate`
    /// as monotonic non-decreasing. If Blend ever socialises bad debt and the rate dips by even one
    /// stroop, that guard sits under `current_rate`, which sits under **every** wrapper entry point
    /// — mint, `claim_yield`, `redeem_pt` (even at maturity), `combine_and_redeem`,
    /// `position_value` and `solvency` all revert `RateOutOfBounds`. Only `transfer_position`
    /// survives (it never reads the rate), so a position could be moved but never exited, and the
    /// freeze lasts until Blend's rate climbs back above the high-water mark — with no admin
    /// action, timelock, or upgrade able to shorten it.
    ///
    /// [`Self::set_max_apr_bps`] is **not** a substitute: it widens the *upper* ceiling, and this
    /// failure is the *lower* monotonicity guard. Widening it to `u32::MAX` leaves the freeze
    /// exactly where it was.
    ///
    /// ## Why this cannot mint value
    /// Resetting the floor only lets reads resolve again; it changes no balance and no share count.
    /// The wrapper still asserts `backing >= principal` against Blend's **real** position after
    /// every mutation, so if the dip is deep enough that the backing genuinely no longer covers
    /// outstanding principal, mutations still refuse — with `SolvencyViolation` instead of
    /// `RateOutOfBounds`. That is the honest limit of this valve: it restores exits for the class
    /// of dips the position can still absorb, and correctly declines to paper over the ones it
    /// cannot. Read paths (`position_value`, `solvency`) come back in **both** cases, which is what
    /// the dashboard and the off-chain monitor need during an incident.
    ///
    /// Immediate rather than timelocked, for the same reason as `set_max_apr_bps`: it is a liveness
    /// valve that can only ever *lower* a sanity threshold on an already-trusted pool reading.
    /// It requires a human in the loop during an incident — that is deliberate, not an oversight.
    pub fn reset_rate_floor(env: Env) -> i128 {
        Self::current_admin(&env).require_auth();
        // Read the RAW pool rate, deliberately bypassing `current_rate` — that is the very call
        // the stale floor is bricking, so going through it would make this valve unusable.
        let pool = Self::pool_addr(&env);
        let underlying = Self::underlying(env.clone());
        let raw = PoolClient::new(&env, &pool).get_reserve(&underlying).data.b_rate;
        if raw <= 0 {
            panic_with_error!(&env, Error::RateOutOfBounds);
        }
        let mut bound = Self::bound(&env);
        // Only ever LOWER the floor. If the live rate is already at/above the stored mark there is
        // no freeze to clear, and *raising* it would brick reads that currently pass — the exact
        // failure this exists to undo. So that case is a no-op that reports the unchanged floor.
        if raw < bound.last_rate {
            bound.last_rate = raw;
            bound.last_ts = env.ledger().timestamp();
            env.storage().instance().set(&DataKey::Bound, &bound);
            Self::bump_instance(&env);
        }
        bound.last_rate
    }

    // ---------- governance: admin rotation (two-step) + upgrade timelock ----------

    /// Propose a new admin (step 1 of 2). Current admin authorizes; the proposed admin must then
    /// call `accept_admin` to take control.
    pub fn propose_admin(env: Env, new_admin: Address) {
        governance::propose_admin(&env, &Self::current_admin(&env), &new_admin);
    }

    /// Accept a pending admin proposal (step 2 of 2). Must be called by the proposed admin.
    pub fn accept_admin(env: Env) {
        let new_admin = governance::accept_admin(&env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Self::bump_instance(&env);
    }

    /// Cancel a pending admin proposal. Current admin only.
    pub fn cancel_admin_transfer(env: Env) {
        governance::cancel_admin_transfer(&env, &Self::current_admin(&env));
    }

    pub fn pending_admin(env: Env) -> Option<Address> {
        governance::pending_admin(&env)
    }

    /// Schedule a contract upgrade to `wasm_hash`, applyable after the timelock. Returns the `eta`.
    pub fn schedule_upgrade(env: Env, wasm_hash: BytesN<32>) -> u64 {
        governance::schedule_upgrade(&env, &Self::current_admin(&env), wasm_hash)
    }

    pub fn apply_upgrade(env: Env) {
        governance::apply_upgrade(&env, &Self::current_admin(&env));
    }

    pub fn cancel_upgrade(env: Env) {
        governance::cancel_upgrade(&env, &Self::current_admin(&env));
    }

    pub fn pending_upgrade(env: Env) -> Option<governance::PendingUpgrade> {
        governance::pending_upgrade(&env)
    }

    pub fn timelock(env: Env) -> u64 {
        governance::timelock(&env)
    }

    pub fn set_timelock(env: Env, secs: u64) {
        governance::set_timelock(&env, &Self::current_admin(&env), secs);
    }

    pub fn admin(env: Env) -> Address {
        Self::current_admin(&env)
    }

    /// Human-readable semver of the source build (informational; for verifiable identity use
    /// [`Self::code_hash`]).
    pub fn version(env: Env) -> String {
        String::from_str(&env, "spield-strategy-0.1.0")
    }

    /// The live deployed WASM hash (32-byte SHA-256) of the running code — reflects the current
    /// build even across upgrades.
    pub fn code_hash(env: Env) -> BytesN<32> {
        governance::code_hash(&env)
    }

    // ---- internals ----

    /// The current admin (from instance storage). Internal helper; the public view is `admin`.
    fn current_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    /// The stored rate sanity bound.
    fn bound(env: &Env) -> RateBound {
        env.storage()
            .instance()
            .get(&DataKey::Bound)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    /// Authorize, on this contract's behalf, the single nested `transfer(me, pool, amount)`
    /// that Blend's `submit` performs to pull our supplied underlying into the pool.
    fn authorize_supply_transfer(
        env: &Env,
        underlying: &Address,
        me: &Address,
        pool: &Address,
        amount: i128,
    ) {
        let args: Vec<soroban_sdk::Val> =
            (me.clone(), pool.clone(), amount).into_val(env);
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

    fn withdraw_underlying(env: &Env, to: &Address, amount: i128) -> i128 {
        let pool = Self::pool_addr(env);
        let underlying = Self::underlying(env.clone());
        let me = env.current_contract_address();

        let bal_before = token::Client::new(env, &underlying).balance(&me);
        let requests = Vec::from_array(
            env,
            [Request {
                request_type: REQ_WITHDRAW,
                address: underlying.clone(),
                amount,
            }],
        );
        // from = this contract (owns position), spender = this, to = this (we then forward).
        PoolClient::new(env, &pool).submit(&me, &me, &me, &requests);
        let bal_after = token::Client::new(env, &underlying).balance(&me);
        let withdrawn = bal_after - bal_before;

        // Forward the withdrawn underlying to the recipient.
        if to != &me && withdrawn > 0 {
            token::Client::new(env, &underlying).transfer(&me, to, &withdrawn);
        }
        Self::bump_instance(env);
        withdrawn
    }

    /// Raw supply-share balance this contract holds for `index` (0 if none).
    fn raw_supply_shares(env: &Env, pool: &Address, index: u32) -> i128 {
        let me = env.current_contract_address();
        let positions = PoolClient::new(env, pool).get_positions(&me);
        positions.supply.get(index).unwrap_or(0)
    }

    fn require_wrapper(env: &Env, from: &Address) {
        let wrapper: Address = env
            .storage()
            .instance()
            .get(&DataKey::Wrapper)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
        if from != &wrapper {
            panic_with_error!(env, Error::NotAuthorized);
        }
        from.require_auth();
    }

    fn require_wrapper_any(env: &Env) {
        let wrapper: Address = env
            .storage()
            .instance()
            .get(&DataKey::Wrapper)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
        wrapper.require_auth();
    }

    fn pool_addr(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Pool)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    fn reserve_index(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::ReserveIndex)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    fn bump_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_BUMP_LO, INSTANCE_BUMP_HI);
    }
}

#[cfg(test)]
mod test;
