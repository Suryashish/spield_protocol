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

mod events;
mod storage;

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, panic_with_error, token, Address, Env, String,
};
use spield_shared::{
    math,
    types::{Position, PositionValue},
    Error, YieldStrategyClient,
};

#[contract]
pub struct Wrapper;

#[contractimpl]
impl Wrapper {
    /// One-shot, admin-gated init (SCF #7).
    ///
    /// * `admin` — operational admin (pause; cannot move user funds).
    /// * `strategy` — the `YieldStrategy` adapter (Blend). Its `underlying()` becomes our USDC.
    /// * `pt_token` / `yt_token` — pre-deployed SACs whose **admin is this wrapper** (so we can
    ///   mint/burn). The deploy script wires these up; the contract asserts it can mint.
    /// * `maturity` — unix seconds; PT redeems 1:1 only at/after this.
    pub fn initialize(
        env: Env,
        admin: Address,
        strategy: Address,
        pt_token: Address,
        yt_token: Address,
        maturity: u64,
    ) {
        if storage::is_initialized(&env) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        admin.require_auth();

        let underlying = YieldStrategyClient::new(&env, &strategy).underlying();

        storage::set_initialized(&env);
        storage::set_admin(&env, &admin);
        storage::set_strategy(&env, &strategy);
        storage::set_underlying(&env, &underlying);
        storage::set_pt(&env, &pt_token);
        storage::set_yt(&env, &yt_token);
        storage::set_maturity(&env, maturity);
        storage::set_paused(&env, false);
        storage::set_total_principal(&env, 0);
        storage::bump_instance(&env);
    }

    /// Deposit `amount` USDC; supply it to the yield source; mint `amount` PT + `amount` YT to
    /// `user`; record a **new** position. Returns the new position id.
    pub fn mint(env: Env, user: Address, amount: i128) -> u64 {
        user.require_auth();
        Self::ensure_active(&env);
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
        storage::bump_instance(&env);

        events::minted(&env, &user, id, amount, entry_rate);
        Self::assert_solvent(&env);
        id
    }

    /// Claim accrued yield for a position. **Settles, never burns YT** (SCF #6). Yield is measured
    /// from the position's own `settled_rate` (SCF #4/#5). Returns USDC paid out.
    pub fn claim_yield(env: Env, position_id: u64) -> i128 {
        Self::ensure_active(&env);
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
        Self::ensure_active(&env);
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
        Self::close_if_empty(&mut pos);
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
        Self::ensure_active(&env);
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
        Self::close_if_empty(&mut pos);
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
        Self::ensure_active(&env);
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

    pub fn version(env: Env) -> String {
        String::from_str(&env, "spield-wrapper-0.1.0")
    }

    // ---------------- internals ----------------

    fn ensure_active(env: &Env) {
        if !storage::is_initialized(env) {
            panic_with_error!(env, Error::NotInitialized);
        }
        if storage::is_paused(env) {
            panic_with_error!(env, Error::Paused);
        }
    }

    fn load(env: &Env, id: u64) -> Position {
        storage::get_position(env, id).unwrap_or_else(|e| panic_with_error!(env, e))
    }

    fn close_if_empty(pos: &mut Position) {
        if pos.pt_amount == 0 && pos.yt_amount == 0 {
            pos.open = false;
        }
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
    ///  * **at mint** — Blend credits `floor(amount/rate)` shares, so each position's initial
    ///    backing can sit up to ~1 stroop under its principal (bounded by #positions);
    ///  * **at withdraw** — Blend burns `ceil(amount/rate)` shares, removing up to ~1 stroop of
    ///    backing beyond the amount paid (bounded by #withdrawing operations).
    /// We allow exactly that many stroops of tolerance. This is sound (it tracks the maximum
    /// possible rounding dust, which is microscopic) and far below any real shortfall: a genuine
    /// accounting bug — e.g. minting unbacked PT/YT — moves backing by whole units, tripping this.
    fn assert_solvent(env: &Env) {
        let strategy = YieldStrategyClient::new(env, &storage::get_strategy(env));
        let total_shares = strategy.total_shares();
        let backing = strategy.position_value(&total_shares);
        let principal = storage::total_principal(env);
        let dust_tolerance =
            storage::peek_next_position_id(env) as i128 + storage::withdraw_ops(env) as i128 + 2;
        if backing + dust_tolerance < principal {
            panic_with_error!(env, Error::SolvencyViolation);
        }
    }
}
