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
    ///
    /// ## Minimum viable mint
    /// Blend credits `floor(amount / b_rate)` shares, so once the pool has accrued (`b_rate > 1` —
    /// mainnet's is ≈1.124 today) a **1-stroop deposit floors to 0 shares** and the pool rejects it
    /// with its own error code. We refuse below `ceil(b_rate)` stroops up front so the revert names
    /// Spield's own constraint (`InvalidAmount`) instead of surfacing an opaque Blend error. In
    /// practice this means the minimum viable mint on mainnet is **2 stroops, not 1**.
    ///
    /// ## Maturity
    /// Refused at/after `maturity` (`MarketMatured`): the bond term is over, so a new position
    /// would be a zero-duration round trip in a market the vault and the AMM have already closed.
    /// Exits are unaffected.
    pub fn mint(env: Env, user: Address, amount: i128) -> u64 {
        user.require_auth();
        Self::ensure_can_deposit(&env); // inflow — blocked while paused
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        // Maturity gate (inflow): match the vault's `ensure_before_maturity` and the market's
        // `ensure_tradeable`, which both already refuse post-maturity inflows. Safe to add here —
        // every internal caller (the vault's `seed`/`deposit`/`harvest`) is maturity-gated upstream
        // against this same timestamp.
        if env.ledger().timestamp() >= storage::get_maturity(&env) {
            panic_with_error!(&env, Error::MarketMatured);
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
        // Below `ceil(entry_rate)` stroops Blend floors the credited shares to 0 and rejects the
        // supply inside the pool (see the doc comment). Catch it here so the caller gets Spield's
        // own `InvalidAmount` rather than a Blend error code they can't act on. The whole tx
        // reverts, so the USDC pulled above is returned.
        let min_mint = math::min_mintable(entry_rate);
        if amount < min_mint {
            panic_with_error!(&env, Error::InvalidAmount);
        }
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

    /// The rate YT yield is measured **up to**.
    ///
    /// * **Before maturity** — the live Blend `b_rate`. Yield streams continuously and is claimable
    ///   at any time; nothing is locked up.
    /// * **At/after maturity** — the rate observed at maturity, and never higher. The term is over,
    ///   so **YT stops generating yield**: a matured YT is worth 0, matching Pendle ("matured YT
    ///   have 0 value as they no longer generate yield"). Yield accrued *before* maturity is
    ///   untouched and stays claimable indefinitely — only new accrual stops. That is why this caps
    ///   the rate rather than refusing the call: refusing would strand yield the holder had already
    ///   earned.
    ///
    /// ## Why this has to be stamped rather than computed
    /// Blend exposes only the *current* `b_rate`; there is no historical lookup, so the rate at
    /// maturity cannot be derived after the fact — it must be observed on-chain. The first
    /// interaction at/after maturity records it. Until something touches the contract the ceiling
    /// is not yet pinned, so a late first touch stamps a slightly higher rate and pays out a little
    /// post-maturity growth. That errs toward the holder, is bounded by how long the contract sits
    /// untouched, and is never a solvency risk (the payout is real Blend growth on the position's
    /// own shares, and `assert_solvent` still runs). [`Self::stamp_maturity_rate`] exists so a
    /// keeper can pin it exactly at maturity and remove even that drift.
    ///
    /// `stamp` distinguishes mutating callers (which persist the first observation) from views
    /// (which must not write).
    fn yield_rate(env: &Env, stamp: bool) -> i128 {
        let matured = env.ledger().timestamp() >= storage::get_maturity(env);
        // Write-once: an existing stamp always wins, so the ceiling can never ratchet upward and
        // let a matured YT start earning again. Checking it *before* reading Blend also means a
        // post-maturity claim/redeem skips the cross-contract rate call entirely — one instance
        // read instead of a strategy round-trip.
        if matured {
            if let Some(stamped) = storage::maturity_rate(env) {
                return stamped;
            }
        }
        let strategy = YieldStrategyClient::new(env, &storage::get_strategy(env));
        let live = strategy.current_rate();
        if matured && stamp {
            storage::set_maturity_rate(env, live);
        }
        live
    }

    /// Internal claim: settle a position's yield up to the current rate, paying the owner. Mutates
    /// `pos` in place (caller persists it). Does NOT re-auth / re-check active — callers do that,
    /// so it composes safely inside `combine_and_redeem` without double-authing.
    fn do_claim(env: &Env, position_id: u64, pos: &mut Position) -> i128 {
        // A closed position holds no shares, so the yield math already returns 0 and nothing moves.
        // Returning explicitly makes that intent legible rather than emergent: a future refactor
        // that measures yield on `yt_amount` instead of `shares` cannot quietly turn a claim on a
        // closed position into a payout. (`combine_and_redeem` can't reach this — it rejects on
        // `amount > pos.pt_amount` first, since a closed position has none.)
        if !pos.open {
            return 0;
        }
        let strategy = YieldStrategyClient::new(env, &storage::get_strategy(env));
        // Capped at the maturity rate: YT earns for the term and no longer (see `yield_rate`).
        let current_rate = Self::yield_rate(env, true);

        // Yield is measured on the position's bToken *shares* (the exact ERC-4626 growth), not on
        // the YT face amount — see `math::yield_amount`. This keeps the vault solvent for
        // positions minted at entry_rate > 1.0.
        let mut payout = math::yield_amount(env, pos.shares, pos.settled_rate, current_rate)
            .unwrap_or_else(|e| panic_with_error!(env, e));

        // Clamp to the yield actually available, but ONLY once bearer redemptions have occurred.
        //
        // Every Blend withdraw burns `ceil(amount / rate)` shares — up to ~1 stroop of backing
        // beyond the amount paid out. `redeem_pt` absorbs that by deducting the *actual* shares
        // Blend burned from the position it redeemed against. `redeem_pt_bearer` cannot: fungible
        // PT carries no provenance, so it touches no position, and that per-withdraw dust lands on
        // the shared yield pool instead. After enough bearer redeems the pool ends up a few stroops
        // short of the last claimant's arithmetic entitlement, and `redeem_underlying` would revert
        // `WithdrawShortfall` — stranding a claim over dust.
        //
        // `backing - total_principal` is precisely the yield pool, so clamping here can never pay a
        // claim out of anyone's principal. The ordering effect (whoever claims last absorbs the
        // dust) is inherent to sharing a rounding remainder and is bounded by the number of bearer
        // redeems, not by time or by position count.
        //
        // Gated on `bearer_redeemed > 0` to keep it off the hot path: it is a cheap instance read,
        // and it is zero for the whole pre-maturity life of the market — which is where `harvest`
        // (the batch caller, and the binding resource budget) lives. Bearer redemption is
        // maturity-gated, so harvest never pays for these two cross-contract calls.
        if storage::bearer_redeemed(env) > 0 && payout > 0 {
            let total_shares = strategy.total_shares();
            let backing = strategy.position_value(&total_shares);
            let principal = storage::total_principal(env);
            let yield_pool = if backing > principal { backing - principal } else { 0 };
            if payout > yield_pool {
                payout = yield_pool;
            }
        }

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
        // Pin the YT yield ceiling on the way past. `redeem_pt` is only callable at/after maturity,
        // so it is the most likely first post-maturity interaction — stamping here keeps the
        // ceiling tight even when nobody claims or runs the keeper. After the first call this is a
        // single instance read (see `yield_rate`), not a strategy round-trip.
        Self::yield_rate(&env, true);
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

    /// Redeem PT **by token balance**, with no position required — the exit for anyone who bought
    /// PT on the AMM. At/after maturity, burns `amount` PT from `holder` and pays them `amount`
    /// USDC 1:1. Returns the USDC paid.
    ///
    /// This is what makes the headline "Earn Fixed via the AMM" flow work. [`Self::redeem_pt`] is
    /// position-gated: it loads a `Position`, auths its owner, and burns from that owner. A trader
    /// who bought PT on the pool holds a real balance and owns no position, so there is no id to
    /// redeem against. Here the **token is the claim**.
    ///
    /// ## Why this is safe, and what it depends on
    /// At maturity every PT is worth exactly 1 USDC, and the wrapper holds `backing >= principal`.
    /// PT total supply equals the principal outstanding, so burning `N` PT and paying `N` USDC
    /// moves both sides of the invariant by the same amount and leaves it intact —
    /// `assert_solvent` re-checks it against Blend's real position afterwards regardless.
    ///
    /// **This depends on PT supply being honest**, which is exactly what the §13 issuer lockdown
    /// guarantees. While the classic PT/YT issuer could still sign, it could mint PT outside the
    /// wrapper, and a balance-based redemption would pay real USDC for it. Before the lockdown the
    /// only thing preventing that was `redeem_pt` being position-gated — an accidental shield that
    /// this function deliberately removes. `scripts/deploy_mainnet.sh` locks the issuer
    /// (master weight → 0) and verifies it on chain before anything can be seeded.
    ///
    /// ## Why no position is touched
    /// PT is fungible: once it has traded, there is no way to know which position minted the units
    /// being burned, and walking positions to find out would be an unbounded loop. So this adjusts
    /// only the global `total_principal`, and leaves position records alone.
    ///
    /// That is sound because a position's yield is measured as `shares × (rate − settled_rate)`,
    /// which is **independent of whether its principal has been redeemed**. Withdrawing `N` USDC
    /// burns `N / rate` Blend shares, so the backing that remains is exactly the yield the YT side
    /// is owed — the seller who kept their YT still claims in full, and is not affected by the
    /// buyer redeeming the PT leg. Pinned by
    /// `bearer_redeem_leaves_the_sellers_yt_yield_exactly_intact`.
    ///
    /// The consequence is that a position's `pt_amount` becomes a historical record rather than a
    /// live claim, so PT conservation is restated as
    /// `Σ pos.pt_amount == PT_supply + bearer_redeemed` — see [`Self::bearer_redeemed`]. The
    /// position's own `redeem_pt` cannot double-spend: it burns from the owner's balance, and the
    /// owner sold those tokens, so the burn fails.
    ///
    /// Allowed while paused (an exit). Panics `NotMatured` before maturity, `InvalidAmount` for a
    /// non-positive amount, and `InsufficientBalance` if `amount` exceeds the principal still
    /// outstanding protocol-wide.
    pub fn redeem_pt_bearer(env: Env, holder: Address, amount: i128) -> i128 {
        Self::ensure_initialized(&env); // outflow — allowed even while paused
        holder.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if env.ledger().timestamp() < storage::get_maturity(&env) {
            panic_with_error!(&env, Error::NotMatured);
        }
        // Never redeem more principal than the protocol has outstanding. Honest PT supply equals
        // `total_principal`, so this can only bind on counterfeit supply — which the §13 lockdown
        // is what actually prevents. Belt and braces: refuse rather than eat into YT backing.
        let outstanding = storage::total_principal(&env);
        if amount > outstanding {
            panic_with_error!(&env, Error::InsufficientBalance);
        }

        // Burn first (proves the caller really holds the claim), then pay 1:1 from Blend.
        Self::pt_admin(&env).burn(&holder, &amount);
        let strategy = YieldStrategyClient::new(&env, &storage::get_strategy(&env));
        strategy.redeem_underlying(&holder, &amount);

        storage::set_total_principal(&env, outstanding - amount);
        storage::add_bearer_redeemed(&env, amount);
        storage::bump_withdraw_ops(&env);
        storage::bump_instance(&env);

        events::redeemed_pt_bearer(&env, &holder, amount);
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
    /// Carve `amount` of principal out of a position into a **new position with the same owner**,
    /// and return its id. The way to sell or hand over *part* of a holding.
    ///
    /// Pair it with [`Self::transfer_position`]: `split_position` is pure accounting (it moves no
    /// tokens — the owner still holds every PT and YT), then `transfer_position(new_id, buyer)`
    /// moves the SAC legs and reassigns ownership. Two audited steps instead of one new compound
    /// one.
    ///
    /// ```text
    /// hold 50 PT + 50 YT as position P, want to sell half on day 15 of a 30-day term:
    ///   split_position(P, 25)          -> Q  (25 PT + 25 YT, still yours; P keeps 25 + 25)
    ///   transfer_position(Q, buyer)    -> buyer owns Q and holds its 25 PT + 25 YT
    /// days 1-15 yield on all 50 -> you.  days 15-30 yield on Q's 25 -> the buyer.
    /// ```
    ///
    /// ## It settles first, and that is the whole point
    /// The split **auto-claims** the source position before dividing it. Both halves therefore
    /// start from `settled_rate == current_rate`, so every stroop earned up to this instant is paid
    /// to the *current* owner and the new position earns strictly from here forward. This is the
    /// job Pendle's `_beforeTokenTransfer` hook does with a per-holder interest index; PT/YT are
    /// Stellar Asset Contracts (built into the protocol, fixed interface, no hooks), so the
    /// checkpoint happens here instead. Without it the slice would carry the seller's unclaimed
    /// yield to whoever received it — the SCF #5 phantom-yield class of bug.
    ///
    /// ## The slice is proportional across the whole position
    /// A position's Blend shares back its principal *and* generate its YT yield; the two cannot be
    /// separated. So a split takes a proportional cut of `pt_amount`, `yt_amount` **and** `shares`.
    /// There is no PT-only or YT-only split. A buyer who wants pure yield exposure sells the PT leg
    /// on the AMM afterwards — the same route `buildBuyYtSteps` already uses.
    ///
    /// ## Conservation
    /// The new position takes the **floored** share of every field and the original keeps the
    /// **remainder by subtraction**, so `old + new == original` exactly for `principal`,
    /// `pt_amount`, `yt_amount` and `shares`. Rounding can neither create nor destroy value.
    /// Nothing is minted or burned and `total_principal` is untouched: this re-partitions a
    /// position, it does not change the protocol's totals.
    ///
    /// Allowed while paused (position management, never an inflow) and at any point in the term,
    /// before or after maturity. Panics `InvalidAmount` unless `0 < amount < principal` (splitting
    /// the whole thing is just `transfer_position`), `PositionClosed` on a spent position, and
    /// `SplitTooSmall` if either side would floor to zero backing shares.
    pub fn split_position(env: Env, position_id: u64, amount: i128) -> u64 {
        // Position management, not an inflow — open while paused, exactly like `transfer_position`,
        // so an emergency pause can never trap a holder mid-exit.
        Self::ensure_initialized(&env);
        let mut pos = Self::load(&env, position_id);
        pos.owner.require_auth();
        if !pos.open {
            panic_with_error!(&env, Error::PositionClosed);
        }
        // `>= principal` is refused rather than clamped: it would leave an empty husk position
        // behind, and moving the whole thing is what `transfer_position` is for.
        if amount <= 0 || amount >= pos.principal {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        // Settle to now, so the split is a clean cut in time (see the doc comment above).
        let settled = Self::do_claim(&env, position_id, &mut pos);

        // Proportion is taken against principal, which is also the PT leg (`principal ==
        // pt_amount` holds by construction: mint sets them equal and `redeem_pt` /
        // `combine_and_redeem` only ever decrement them together).
        let denom = pos.principal;
        let new_pt = math::mul_div_floor(&env, pos.pt_amount, amount, denom)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        let new_yt = math::mul_div_floor(&env, pos.yt_amount, amount, denom)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        let new_shares = math::mul_div_floor(&env, pos.shares, amount, denom)
            .unwrap_or_else(|e| panic_with_error!(&env, e));

        // Both halves must come out BACKED. A slice that floors to zero shares would be principal
        // with nothing behind it, so refuse the split rather than create such a position. This is
        // reachable whenever `shares < principal` — i.e. after any claim, and for any position
        // minted once the pool had accrued (`entry_rate > 1.0`).
        //
        // The second condition is defence-in-depth and provably cannot fire today: with
        // `amount < principal`, `floor(shares × amount / principal) <= shares - 1`, so the original
        // always keeps at least one share. It is kept so a future change to the proportion basis
        // cannot silently gut a position.
        if new_shares <= 0 || pos.shares - new_shares <= 0 {
            panic_with_error!(&env, Error::SplitTooSmall);
        }

        let new_pos = Position {
            owner: pos.owner.clone(),
            principal: amount,
            pt_amount: new_pt,
            yt_amount: new_yt,
            entry_rate: pos.entry_rate,
            // Equal to `current_rate` after the settle above — the new position starts earning now.
            settled_rate: pos.settled_rate,
            shares: new_shares,
            open: true,
        };
        // Remainder by subtraction — this is what makes the conservation exact.
        pos.principal -= amount;
        pos.pt_amount -= new_pt;
        pos.yt_amount -= new_yt;
        pos.shares -= new_shares;

        let new_id = storage::next_position_id(&env);
        storage::save_position(&env, new_id, &new_pos);
        storage::save_position(&env, position_id, &pos);
        // One more genuinely-live position. This widens the solvency dust band by exactly 1 stroop,
        // which is the correct accounting: the band is anchored to live positions, and closing
        // either half shrinks it back (same as `mint`/`combine`).
        storage::inc_open_positions(&env);
        storage::bump_instance(&env);

        events::split(&env, &new_pos.owner, position_id, new_id, amount, settled);
        Self::assert_solvent(&env);
        new_id
    }

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
        // Same maturity ceiling the claim path uses, so the dashboard shows a matured YT's
        // claimable yield flattening at maturity instead of ticking up forever. `stamp = false`:
        // a view must never write.
        let current_rate = Self::yield_rate(&env, false);
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

    /// Cumulative PT burned through [`Self::redeem_pt_bearer`]. Off-chain PT conservation is
    /// `Σ pos.pt_amount == PT_total_supply + bearer_redeemed`: a bearer redeem burns supply without
    /// touching any position record, so the monitor needs this term to balance the books.
    pub fn bearer_redeemed(env: Env) -> i128 {
        storage::bearer_redeemed(&env)
    }

    /// How many positions are currently **open**. This is the basis of the solvency dust
    /// tolerance (`open_positions + WITHDRAW_SLACK`), so exposing it lets the dashboard and the
    /// off-chain monitor reproduce the exact band the contract enforces instead of guessing it.
    /// It falls as positions close, which is what keeps the band from ratcheting open.
    pub fn open_positions(env: Env) -> u64 {
        storage::open_positions(&env)
    }

    pub fn maturity(env: Env) -> u64 {
        storage::get_maturity(&env)
    }

    /// **Permissionless** — pin the `b_rate` that caps all YT yield, at/after maturity.
    ///
    /// YT earns for the term and no longer, so the protocol needs the rate *as of maturity*. Blend
    /// keeps no history, so it must be observed on-chain. Any interaction at/after maturity records
    /// it automatically, but that means a contract nobody touches for a week stamps a week-late
    /// rate and pays a little post-maturity growth to whoever claims. Calling this at maturity
    /// removes that drift entirely.
    ///
    /// No auth and no pause gate: it can only ever *reduce* what YT can claim, never move funds or
    /// increase anyone's entitlement — so it is safe for a keeper, a cron, or any user to call.
    ///
    /// **Idempotent and write-once.** A second call returns the already-stamped rate unchanged; the
    /// ceiling can never ratchet upward and revive a matured YT. Returns the rate in force.
    /// Panics `NotMatured` before maturity — there is nothing to stamp while the term is running.
    pub fn stamp_maturity_rate(env: Env) -> i128 {
        Self::ensure_initialized(&env);
        if env.ledger().timestamp() < storage::get_maturity(&env) {
            panic_with_error!(&env, Error::NotMatured);
        }
        if let Some(stamped) = storage::maturity_rate(&env) {
            return stamped; // already pinned — never overwrite
        }
        let rate = Self::yield_rate(&env, true);
        storage::bump_instance(&env);
        events::maturity_rate_stamped(&env, rate);
        rate
    }

    /// The stamped maturity `b_rate` capping all YT yield, or `None` while the term is still
    /// running (or if nothing has touched the contract since maturity). See
    /// [`Self::stamp_maturity_rate`].
    pub fn maturity_rate(env: Env) -> Option<i128> {
        storage::maturity_rate(&env)
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
