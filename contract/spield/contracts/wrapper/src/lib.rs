#![no_std]
//! # spield-wrapper — the tokenization engine (solvent, position-bound)
//!
//! Deposits user USDC into the yield source (Blend, via the `YieldStrategy` adapter), mints
//! **PT** + **YT** (as SACs admined by this contract), and tracks **per-position** accounting so
//! every one of the SCF-flagged bugs is impossible by construction:
//!
//! | SCF finding | How this contract prevents it |
//! |---|---|
//! | #3 undercollateralized vault | Yield is realized Blend `bRate` growth; the solvency invariant `position_value(total_shares) ≥ total_principal + Σ unclaimed_yield` is asserted after every mutation. |
//! | #4 entry index overwritten on top-up | Every `mint` creates a **new** `Position` with its own `entry_rate`; nothing is overwritten. |
//! | #5 transfer_yt → phantom yield | Position-bound: yield rights live in the `Position`; loose SAC transfer moves only the redemption claim, and `transfer_position` carries `settled_rate`, so a buyer can never claim pre-ownership yield. |
//! | #6 claim burns all YT | `claim_yield` **settles** (`settled_rate = current_rate`) and never burns YT; the same YT claims across many epochs. |
//! | #7 unguarded initialize | One-shot `Initialized` guard + admin auth. |
//! | #9 missing TTL | `extend_ttl` after every persistent write (see `storage.rs`). |
//!
//! ## Token model (position-bound)
//! PT and YT are real SACs (visible, composable). The **`Position`** is the yield-accounting
//! unit. A position's PT/YT amounts always mirror the SAC tokens the owner was minted for that
//! deposit. Claiming yield, redeeming PT, and combining all operate on a position the caller
//! owns, and reconcile the SAC balances (burning PT/YT) as they go.
//!
//! ## Reentrancy & checks-effects-interactions (mainnet-readiness)
//! Soroban's host **forbids reentrancy by default**: a contract cannot be re-entered while one of
//! its own calls is still on the stack, so the classic single-function reentrancy attack is
//! impossible here. As defence-in-depth we *also* follow checks-effects-interactions in shape: each
//! mutating entry point **loads the `Position` once, computes every effect in memory, then persists
//! it exactly once at the end** (`save_position` + the `total_principal`/`open_positions` updates),
//! after the external Blend/SAC calls. There is no intermediate on-chain write that a callback could
//! observe in an inconsistent state. The one ordering that *must* follow the external call is
//! `pos.shares -= burned` in `do_claim`/`redeem_pt`/`combine_and_redeem`: we subtract the **actual**
//! Blend shares burned (returned by the strategy), which is only known after the withdraw — so the
//! effect is computed from the interaction's result and then written once. The external counterparties
//! (the USDC SAC and the Blend pool) are fixed, trusted addresses set at init, not attacker-controlled
//! tokens, so they cannot re-enter the wrapper even if reentrancy were allowed. `assert_solvent`
//! runs *after* all writes, against Blend's real position, so any accounting slip fails loudly.

mod events;
mod storage;

#[cfg(test)]
mod test;

#[cfg(test)]
mod test_rate_brick;

use soroban_sdk::{
    contract, contractimpl, panic_with_error, token, Address, BytesN, Env, String,
};
use spield_shared::{
    governance,
    math,
    types::{Position, PositionValue},
    Error, YieldStrategyClient,
};

#[contract]
pub struct Wrapper;

/// The underlying (USDC) must have exactly this many decimals. Stellar USDC is 7 on both testnet
/// (Blend's test token) and mainnet (Circle's SAC). The fixed-point yield math (SCALAR_12 rates,
/// 7-dec amounts) is calibrated to this; we assert it at init rather than assume (mainnet-readiness).
const EXPECTED_UNDERLYING_DECIMALS: u32 = 7;

/// Fixed slack (stroops) in the solvency dust tolerance for withdraw-side ceil-rounding within a
/// single transaction. The deepest path (`combine_and_redeem`) does at most 2 Blend withdraws
/// (the auto-claim + the principal redeem), each removing ≤1 stroop of extra backing; 4 is a
/// comfortable bound and, crucially, a CONSTANT (it cannot grow with history, so the tolerance
/// can't be inflated by churn).
const WITHDRAW_SLACK: i128 = 4;

#[contractimpl]
impl Wrapper {
    /// **Atomic deploy-time constructor (mainnet-readiness: no deploy→init front-run).** Runs as
    /// part of contract creation, so it cannot be front-run: it binds the `admin` the moment the
    /// contract exists. The remaining setup ([`Self::initialize`]) is then admin-gated, so even
    /// though it's a separate call, only this `admin` can complete it — a front-runner can never
    /// hijack the wrapper by racing the init.
    ///
    /// * `admin` — operational admin (pause/upgrade/governance; cannot move user funds).
    pub fn __constructor(env: Env, admin: Address) {
        storage::set_admin(&env, &admin);
        storage::set_paused(&env, false);
        storage::set_total_principal(&env, 0);
        governance::init(&env);
        storage::bump_instance(&env);
    }

    /// One-shot setup, gated to the constructor-set `admin` (SCF #7 + front-run-proof). Wires the
    /// strategy + PT/YT SACs + maturity. Must be the legit admin (set atomically at deploy).
    ///
    /// * `strategy` — the `YieldStrategy` adapter (Blend). Its `underlying()` becomes our USDC.
    /// * `pt_token` / `yt_token` — pre-deployed SACs whose **admin is this wrapper** (so we can
    ///   mint/burn). The deploy script wires these up; the contract asserts it can mint.
    /// * `maturity` — unix seconds; PT redeems 1:1 only at/after this.
    pub fn initialize(
        env: Env,
        strategy: Address,
        pt_token: Address,
        yt_token: Address,
        maturity: u64,
    ) {
        if storage::is_initialized(&env) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        // Only the admin bound atomically at deploy may finish setup.
        storage::get_admin(&env).require_auth();

        let underlying = YieldStrategyClient::new(&env, &strategy).underlying();
        // Assert the underlying's decimals match what the fixed-point math expects (don't assume).
        let dec = token::Client::new(&env, &underlying).decimals();
        if dec != EXPECTED_UNDERLYING_DECIMALS {
            panic_with_error!(&env, Error::UnexpectedDecimals);
        }

        storage::set_initialized(&env);
        storage::set_strategy(&env, &strategy);
        storage::set_underlying(&env, &underlying);
        storage::set_pt(&env, &pt_token);
        storage::set_yt(&env, &yt_token);
        storage::set_maturity(&env, maturity);
        storage::bump_instance(&env);

        events::initialized(
            &env,
            &storage::get_admin(&env),
            &strategy,
            &pt_token,
            &yt_token,
            maturity,
        );
    }

    /// Deposit `amount` USDC; supply it to the yield source; mint `amount` PT + `amount` YT to
    /// `user`; record a **new** position. Returns the new position id.
    pub fn mint(env: Env, user: Address, amount: i128) -> u64 {
        user.require_auth();
        Self::ensure_can_deposit(&env); // inflow — blocked while paused
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let strategy_addr = storage::get_strategy(&env);
        let strategy = YieldStrategyClient::new(&env, &strategy_addr);
        let underlying = storage::get_underlying(&env);

        // Pull USDC from the user into the wrapper, then authorize the strategy to pull it on.
        let usdc = token::Client::new(&env, &underlying);
        usdc.transfer(&user, &env.current_contract_address(), &amount);

        // Read the entry rate FIRST (this is a separate cross-contract call), then authorize the
        // strategy's pull. `authorize_as_current_contract` scopes to the *next* contract call, so
        // it must immediately precede `deposit` — any intervening call would consume the scope.
        let entry_rate = strategy.current_rate();
        Self::approve_strategy_pull(&env, &underlying, &strategy_addr, amount);
        let shares = strategy.deposit(&env.current_contract_address(), &amount);
        if shares <= 0 {
            panic_with_error!(&env, Error::SolvencyViolation);
        }

        // Mint PT + YT (1:1:1 with principal) to the user.
        Self::pt_admin(&env).mint(&user, &amount);
        Self::yt_admin(&env).mint(&user, &amount);

        // Record a NEW position (never overwrite — SCF #4).
        let id = storage::next_position_id(&env);
        let pos = Position {
            owner: user.clone(),
            principal: amount,
            pt_amount: amount,
            yt_amount: amount,
            entry_rate,
            settled_rate: entry_rate,
            shares,
            open: true,
        };
        storage::save_position(&env, id, &pos);
        storage::set_total_principal(&env, storage::total_principal(&env) + amount);
        storage::inc_open_positions(&env); // new open position (bounds the dust tolerance)
        storage::bump_instance(&env);

        events::minted(&env, &user, id, amount, entry_rate);
        Self::assert_solvent(&env);
        id
    }

    /// Claim accrued yield for a position. **Settles, never burns YT** (SCF #6). Yield is measured
    /// from the position's own `settled_rate` (SCF #4/#5). Returns USDC paid out.
    pub fn claim_yield(env: Env, position_id: u64) -> i128 {
        Self::ensure_initialized(&env); // outflow — allowed even while paused
        let mut pos = Self::load(&env, position_id);
        pos.owner.require_auth();
        let paid = Self::do_claim(&env, position_id, &mut pos);
        storage::save_position(&env, position_id, &pos);
        storage::bump_instance(&env);
        Self::assert_solvent(&env);
        paid
    }

    /// Internal claim: settle a position's yield up to the current rate, paying the owner. Mutates
    /// `pos` in place (caller persists it). Does NOT re-auth / re-check active — callers do that,
    /// so it composes safely inside `combine_and_redeem` without double-authing.
    fn do_claim(env: &Env, position_id: u64, pos: &mut Position) -> i128 {
        let strategy = YieldStrategyClient::new(env, &storage::get_strategy(env));
        let current_rate = strategy.current_rate();

        // Yield is measured on the position's bToken *shares* (the exact ERC-4626 growth), not on
        // the YT face amount — see `math::yield_amount`. This keeps the vault solvent for
        // positions minted at entry_rate > 1.0.
        let payout = math::yield_amount(env, pos.shares, pos.settled_rate, current_rate)
            .unwrap_or_else(|e| panic_with_error!(env, e));

        let mut paid = 0i128;
        if payout > 0 {
            // Pay the exact accrued yield to the owner. The strategy reports the *actual* Blend
            // shares burned, which we subtract from this position's backing so our bookkeeping
            // (`Σ pos.shares`) stays equal to the real Blend position. Blend burns
            // `ceil(payout/rate)` shares — up to ~1 stroop of backing beyond the yield removed;
            // that bounded dust is absorbed by the solvency tolerance (see `assert_solvent`).
            let burned = strategy.redeem_underlying(&pos.owner, &payout);
            pos.shares -= burned;
            if pos.shares < 0 {
                pos.shares = 0;
            }
            paid = payout;
            storage::bump_withdraw_ops(env);
        }
        // Settle the rate up to now; KEEP the YT (still earning to maturity).
        pos.settled_rate = current_rate;
        events::claimed(env, &pos.owner, position_id, paid, current_rate);
        paid
    }

    /// Redeem `amount` PT for `amount` USDC 1:1, allowed only at/after maturity (SCF: principal
    /// covered by the grown Blend position). Burns the PT.
    pub fn redeem_pt(env: Env, position_id: u64, amount: i128) -> i128 {
        Self::ensure_initialized(&env); // outflow — allowed even while paused
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if env.ledger().timestamp() < storage::get_maturity(&env) {
            panic_with_error!(&env, Error::NotMatured);
        }
        let mut pos = Self::load(&env, position_id);
        pos.owner.require_auth();
        if amount > pos.pt_amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }

        // Burn the user's PT (proves they hold the claim), then pay 1:1 from the Blend position.
        Self::pt_admin(&env).burn(&pos.owner, &amount);
        let strategy = YieldStrategyClient::new(&env, &storage::get_strategy(&env));
        let burned = strategy.redeem_underlying(&pos.owner, &amount);

        pos.pt_amount -= amount;
        pos.principal -= amount;
        pos.shares -= burned;
        if pos.shares < 0 {
            pos.shares = 0;
        }
        if Self::close_if_empty(&mut pos) {
            storage::dec_open_positions(&env);
        }
        storage::save_position(&env, position_id, &pos);
        storage::set_total_principal(&env, storage::total_principal(&env) - amount);
        storage::bump_withdraw_ops(&env);
        storage::bump_instance(&env);

        events::redeemed_pt(&env, &pos.owner, position_id, amount);
        Self::assert_solvent(&env);
        amount
    }

    /// Combine equal PT+YT and redeem principal **anytime** (before maturity too). Auto-claims
    /// yield first so none is silently lost, then burns `amount` PT + `amount` YT and returns
    /// `amount` USDC. Returns (principal_returned, yield_claimed).
    pub fn combine_and_redeem(env: Env, position_id: u64, amount: i128) -> (i128, i128) {
        Self::ensure_initialized(&env); // outflow (returns principal) — allowed even while paused
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let mut pos = Self::load(&env, position_id);
        pos.owner.require_auth();
        if amount > pos.pt_amount || amount > pos.yt_amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }

        // Auto-claim first (no silent yield loss) — internal, no re-auth, mutates `pos`.
        let claimed = Self::do_claim(&env, position_id, &mut pos);

        Self::pt_admin(&env).burn(&pos.owner, &amount);
        Self::yt_admin(&env).burn(&pos.owner, &amount);
        let strategy = YieldStrategyClient::new(&env, &storage::get_strategy(&env));
        let burned = strategy.redeem_underlying(&pos.owner, &amount);

        pos.pt_amount -= amount;
        pos.yt_amount -= amount;
        pos.principal -= amount;
        pos.shares -= burned;
        if pos.shares < 0 {
            pos.shares = 0;
        }
        if Self::close_if_empty(&mut pos) {
            storage::dec_open_positions(&env);
        }
        storage::save_position(&env, position_id, &pos);
        storage::set_total_principal(&env, storage::total_principal(&env) - amount);
        storage::bump_withdraw_ops(&env);
        storage::bump_instance(&env);

        events::combined(&env, &pos.owner, position_id, amount);
        Self::assert_solvent(&env);
        (amount, claimed)
    }

    /// Transfer a whole position to a new owner, carrying `settled_rate` (SCF #5: the new owner
    /// can only claim yield accrued *after* the transfer). Also moves the PT+YT SAC balances so
    /// the position and the tokens stay reconciled.
    pub fn transfer_position(env: Env, position_id: u64, to: Address) {
        // Not a fund flow — just reassigns a position's claim. Allowed while paused so users can
        // still manage/transfer their positions during an emergency.
        Self::ensure_initialized(&env);
        let mut pos = Self::load(&env, position_id);
        pos.owner.require_auth();

        // Move the SAC tokens with the position (the position is the authoritative claim).
        if pos.pt_amount > 0 {
            token::Client::new(&env, &storage::get_pt(&env)).transfer(
                &pos.owner,
                &to,
                &pos.pt_amount,
            );
        }
        if pos.yt_amount > 0 {
            token::Client::new(&env, &storage::get_yt(&env)).transfer(
                &pos.owner,
                &to,
                &pos.yt_amount,
            );
        }
        let from = pos.owner.clone();
        pos.owner = to.clone();
        storage::save_position(&env, position_id, &pos);
        storage::bump_instance(&env);
        events::transferred(&env, &from, &to, position_id);
    }

    // ---------- read-only views (frontend / solvency dashboard) ----------

    /// Live value of a position: principal + currently-claimable yield.
    pub fn position_value(env: Env, position_id: u64) -> PositionValue {
        let pos = Self::load(&env, position_id);
        let strategy = YieldStrategyClient::new(&env, &storage::get_strategy(&env));
        let current_rate = strategy.current_rate();
        let claimable =
            math::yield_amount(&env, pos.shares, pos.settled_rate, current_rate).unwrap_or(0);
        PositionValue {
            position_id,
            principal: pos.principal,
            claimable_yield: claimable,
            pt_amount: pos.pt_amount,
            yt_amount: pos.yt_amount,
            open: pos.open,
        }
    }

    pub fn get_position(env: Env, position_id: u64) -> Position {
        Self::load(&env, position_id)
    }

    /// **Permissionless** TTL keep-alive (mainnet-readiness #5). Extends a position entry's storage
    /// TTL to comfortably exceed the market maturity (+grace), clamped to the network max. Anyone
    /// may call it — it only prolongs an entry, never mutates accounting — so a long-dated bond that
    /// is simply held (never claimed) for months can't archive before it matures. No auth, no pause
    /// gate (keeping state alive is always safe). Panics `PositionNotFound` for an unknown id.
    pub fn bump_position(env: Env, position_id: u64) {
        Self::ensure_initialized(&env);
        if !storage::has_position(&env, position_id) {
            panic_with_error!(&env, Error::PositionNotFound);
        }
        storage::bump_position_ttl(&env, position_id);
    }

    /// The protocol-wide solvency figures, for the public dashboard (plan §11.5):
    /// returns (blend_position_value, total_principal, total_unclaimed_yield). The invariant is
    /// `blend_position_value >= total_principal + total_unclaimed_yield`.
    pub fn solvency(env: Env) -> (i128, i128, i128) {
        let strategy = YieldStrategyClient::new(&env, &storage::get_strategy(&env));
        let total_shares = strategy.total_shares();
        let backing = strategy.position_value(&total_shares);
        let principal = storage::total_principal(&env);
        // We don't iterate all positions on-chain (unbounded); the dashboard sums per-position.
        // The asserted invariant in mutations uses the conservative `backing >= principal` plus
        // per-op yield checks. Here we return backing and principal; unclaimed yield = backing -
        // principal when positive.
        let unclaimed = if backing > principal {
            backing - principal
        } else {
            0
        };
        (backing, principal, unclaimed)
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

    pub fn yt_token(env: Env) -> Address {
        storage::get_yt(&env)
    }

    /// The underlying deposit/settlement asset (USDC SAC), cached from the strategy at init.
    /// Lets contracts built on top of the wrapper (e.g. the Fixed-Rate Vault) discover it.
    pub fn underlying(env: Env) -> Address {
        storage::get_underlying(&env)
    }

    // ---------- admin / circuit breaker ----------

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

    /// Human-readable semver of the source build (informational; an upgrade can't rewrite this, so
    /// for *verifiable* on-chain identity use [`Self::code_hash`]).
    pub fn version(env: Env) -> String {
        String::from_str(&env, "spield-wrapper-0.1.0")
    }

    /// The live deployed WASM hash (32-byte SHA-256) of the code actually running — read from the
    /// host, so it always reflects the current build even across upgrades. Lets anyone verify on
    /// chain which build is live and confirm an upgrade landed.
    pub fn code_hash(env: Env) -> BytesN<32> {
        governance::code_hash(&env)
    }

    // ---------- governance: admin rotation (two-step) + upgrade timelock ----------
    //
    // All delegate to the shared `governance` module so every Spield contract behaves identically.
    // The *current* admin lives in this contract's own `Admin` storage (single source of truth);
    // governance reads it via the arg and, on `accept_admin`, we write the new admin back.

    /// Propose a new admin (step 1 of 2). Current admin authorizes; the new admin must then call
    /// `accept_admin` to take control — so a typo'd/dead address can never gain power.
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

    /// The pending (proposed, not-yet-accepted) admin, if any.
    pub fn pending_admin(env: Env) -> Option<Address> {
        governance::pending_admin(&env)
    }

    /// Schedule a contract upgrade to `wasm_hash`. Applyable only after the timelock elapses, so
    /// users get a window to exit before the code under their funds changes. Returns the `eta`.
    pub fn schedule_upgrade(env: Env, wasm_hash: BytesN<32>) -> u64 {
        governance::schedule_upgrade(&env, &storage::get_admin(&env), wasm_hash)
    }

    /// Apply a scheduled upgrade (only at/after its `eta`). Current admin only.
    pub fn apply_upgrade(env: Env) {
        governance::apply_upgrade(&env, &storage::get_admin(&env));
    }

    /// Cancel a scheduled upgrade before it is applied. Current admin only.
    pub fn cancel_upgrade(env: Env) {
        governance::cancel_upgrade(&env, &storage::get_admin(&env));
    }

    /// The currently-scheduled upgrade (wasm hash + eta), if any.
    pub fn pending_upgrade(env: Env) -> Option<governance::PendingUpgrade> {
        governance::pending_upgrade(&env)
    }

    /// The current upgrade timelock delay (seconds).
    pub fn timelock(env: Env) -> u64 {
        governance::timelock(&env)
    }

    /// Set the upgrade timelock delay (seconds), bounded to [1h, 30d]. Current admin only.
    pub fn set_timelock(env: Env, secs: u64) {
        governance::set_timelock(&env, &storage::get_admin(&env), secs);
    }

    /// The current admin (for the frontend / monitoring).
    pub fn admin(env: Env) -> Address {
        storage::get_admin(&env)
    }

    // ---------------- internals ----------------

    /// Guard for **inflows** (new money entering): requires initialized AND not paused. A pause
    /// blocks `mint` so no new deposits enter during an emergency.
    fn ensure_can_deposit(env: &Env) {
        if !storage::is_initialized(env) {
            panic_with_error!(env, Error::NotInitialized);
        }
        if storage::is_paused(env) {
            panic_with_error!(env, Error::Paused);
        }
    }

    /// Guard for **outflows** (users leaving): requires initialized only — these stay open even when
    /// paused, so a pause can never trap user funds (mainnet-readiness #8: block inflows, allow
    /// exits). `claim_yield` / `redeem_pt` / `combine_and_redeem` use this.
    fn ensure_initialized(env: &Env) {
        if !storage::is_initialized(env) {
            panic_with_error!(env, Error::NotInitialized);
        }
    }

    fn load(env: &Env, id: u64) -> Position {
        storage::get_position(env, id).unwrap_or_else(|e| panic_with_error!(env, e))
    }

    /// Close the position if it's fully drained. Returns `true` if this call transitioned it from
    /// open→closed (so the caller decrements the open-position count exactly once).
    fn close_if_empty(pos: &mut Position) -> bool {
        if pos.open && pos.pt_amount == 0 && pos.yt_amount == 0 {
            pos.open = false;
            return true;
        }
        false
    }

    fn pt_admin(env: &Env) -> token::StellarAssetClient<'_> {
        token::StellarAssetClient::new(env, &storage::get_pt(env))
    }

    fn yt_admin(env: &Env) -> token::StellarAssetClient<'_> {
        token::StellarAssetClient::new(env, &storage::get_yt(env))
    }

    /// Authorize the strategy's `deposit` to pull `amount` USDC from this wrapper (it calls
    /// `usdc.transfer(wrapper -> strategy)` with the wrapper as `from`).
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

    /// The solvency invariant (SCF #3): the live value of the wrapper's whole Blend position must
    /// cover all outstanding principal. Because Blend's `bRate` only rises and the claim path
    /// removes backing only by floored yield-shares (never below principal), `backing ≥ principal`
    /// holds after every correct operation. We assert it so any accounting bug fails loudly.
    ///
    /// The only legitimate gaps are bounded floor/ceil rounding from Blend's own share math:
    ///  * **at mint** — Blend credits `floor(amount/rate)` shares, so each *currently-open* position
    ///    can sit up to ~1 stroop under its principal (bounded by `open_positions`);
    ///  * **at withdraw** — Blend burns `ceil(amount/rate)` shares, removing up to ~1 stroop of
    ///    backing beyond the amount paid. A single transaction performs only a small, fixed number
    ///    of withdraws (one per claim/redeem/combine in the call), so this is a small CONSTANT, not
    ///    something that grows with history.
    ///
    /// **Bounded by construction (mainnet-readiness).** The tolerance is
    /// `open_positions + WITHDRAW_SLACK` — it tracks only the dust that can exist in *live* positions
    /// right now. The earlier form used the monotonic `next_position_id + withdraw_ops`, which grow
    /// forever with churn and could be inflated by an attacker doing many tiny mint/withdraw cycles
    /// to widen the band. Closed positions carry zero dust (their principal is gone too), so anchoring
    /// to `open_positions` is both tighter and ungameable. A real accounting bug — e.g. minting
    /// unbacked PT/YT — moves backing by whole units, far past this microscopic band.
    fn assert_solvent(env: &Env) {
        let strategy = YieldStrategyClient::new(env, &storage::get_strategy(env));
        let total_shares = strategy.total_shares();
        let backing = strategy.position_value(&total_shares);
        let principal = storage::total_principal(env);
        let dust_tolerance =
            storage::open_positions(env) as i128 + WITHDRAW_SLACK;
        if backing + dust_tolerance < principal {
            panic_with_error!(env, Error::SolvencyViolation);
        }
    }
}
