#![no_std]
//! # spield-yield — the PT/YT engine, and the YT token itself
//!
//! Spield's `PendleYieldToken`. It is **both** the YT SEP-41 token and the mint/redeem engine,
//! for the same reason Pendle fuses them: YT's transfer path has to settle interest, and the only
//! contract that can do that atomically is the one that owns the ledger.
//!
//! ```text
//!   SR  ──mint_py──►  PT (SAC, bearer)  +  YT (here, hook-bearing)
//!       ◄─redeem_py──
//! ```
//!
//! ## The transfer hook is the whole point
//! Stellar Asset Contracts have **no hooks**. That is why the v1 wrapper had to make yield rights
//! live in a `Position` record instead of in the token, and why a raw YT transfer there strands the
//! claim (`tofix.md` #15): Alice can send Bob every YT she owns and still collect all the yield.
//!
//! Here YT is a custom SEP-41 contract, so [`Yield::transfer`] runs
//! [`Self::before_yt_change`] first — settling **both** parties at the current index before a
//! single unit moves. The consequences:
//!
//! * YT is **freely transferable**. Wallets, OTC, another AMM, a multisig — the yield always
//!   follows the token.
//! * A holder has **one balance**, not one position per purchase. Ten YT buys is still one
//!   `redeem_due_interest` call.
//! * The market needs **no privileged entrypoint**. It mints PY to itself and `transfer`s the YT
//!   out; the hook makes that correct. (The `split_for_market` special case from `futureamm.md`
//!   is deleted, not ported.)
//!
//! ## Expiry
//! Exactly Pendle's rules, verified against their source:
//! * `mint_py` is **refused** at/after expiry.
//! * `redeem_py` **before** expiry burns PT **and** YT; **after** expiry it burns **PT only** —
//!   YT is not required, because a matured YT has no principal claim.
//! * The index freezes at the first post-expiry observation, so a matured YT earns nothing more.
//! * Interest accrued **before** expiry stays claimable forever.
//! * Post-expiry residue that is provably owed to nobody is sweepable to the treasury — but see
//!   [`Yield::sweep_surplus`]: in a share-based design that residue is *small*, and the surplus
//!   above PT cover is **not** free money. Getting this wrong was a real bug caught in testing.
//!
//! ## Solvency
//! Asserted after every mutation: the SR this contract holds must cover PT at par **plus** every
//! stroop of credited-but-unwithdrawn interest.
//!
//! ```text
//! sr_balance >= total_py * SCALAR_12 / index  +  total_accrued
//! ```

mod events;
mod interest;
mod storage;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, panic_with_error, token, Address, Env, String, BytesN};
use spield_shared::{
    governance,
    math,
    token::{self as tok},
    Error, SCALAR_12,
};

use storage::UserInterest;

/// YT carries the underlying's decimals (USDC = 7): 1 YT tracks 1 unit of asset.
const DECIMALS: u32 = 7;

/// Hard ceiling on the yield fee, enforced on chain. Pendle takes 5%; this caps governance at
/// **10%** so the fee can never be raised to something confiscatory by a compromised admin key.
pub const MAX_YIELD_FEE_BPS: u32 = 1_000;

/// Slack for the solvency assertion, in SR stroops. Every payout floors, and each mint can leave
/// up to ~1 stroop of share-rounding, so a tiny one-directional gap is expected. A real accounting
/// fault moves whole units, nowhere near this band.
const SOLVENCY_SLACK: i128 = 10;

#[contract]
pub struct Yield;

#[contractimpl]
impl Yield {
    /// Bind admin + treasury atomically at deploy.
    pub fn __constructor(env: Env, admin: Address, treasury: Address) {
        storage::set_admin(&env, &admin);
        storage::set_treasury(&env, &treasury);
        storage::set_paused(&env, false);
        governance::init(&env);
        storage::bump_instance(&env);
    }

    /// One-shot, admin-gated init.
    ///
    /// * `sr` — the SR token this series strips. Everything below Blend is its problem, not ours.
    /// * `pt` — the PT SAC, which must already be admined by **this** contract.
    /// * `expiry` — unix seconds.
    /// * `yield_fee_bps` — protocol share of YT interest, ≤ [`MAX_YIELD_FEE_BPS`].
    pub fn initialize(env: Env, sr: Address, pt: Address, expiry: u64, yield_fee_bps: u32) {
        if storage::is_initialized(&env) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        storage::get_admin(&env).require_auth();
        if expiry <= env.ledger().timestamp() {
            panic_with_error!(&env, Error::SeriesExpired);
        }
        if yield_fee_bps > MAX_YIELD_FEE_BPS {
            panic_with_error!(&env, Error::FeeShareTooHigh);
        }
        // Seed the index from SR so the first mint prices against a real rate.
        let index = SrClient::new(&env, &sr).exchange_rate();
        if index <= 0 {
            panic_with_error!(&env, Error::RateOutOfBounds);
        }

        storage::set_initialized(&env);
        storage::set_sr(&env, &sr);
        storage::set_pt(&env, &pt);
        storage::set_expiry(&env, expiry);
        storage::set_yield_fee_bps(&env, yield_fee_bps);
        storage::set_index_stored(&env, index);
        storage::set_init_index(&env, index);
        storage::bump_instance(&env);

        events::initialized(&env, &sr, &pt, expiry, yield_fee_bps, index);
    }

    // ================= mint / redeem =================

    /// **Strip.** Pull `sr_in` SR from `from`, mint `sr_in × index` of PT **and** YT to `receiver`.
    /// Returns the PY face minted. Refused at/after expiry (Pendle's `notExpired`).
    pub fn mint_py(env: Env, from: Address, receiver: Address, sr_in: i128) -> i128 {
        Self::ensure_can_mint(&env);
        from.require_auth();
        if sr_in <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let index = Self::index_current(&env);
        let py_out = math::shares_to_underlying(&env, sr_in, index)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        if py_out <= 0 {
            panic_with_error!(&env, Error::DustAmount);
        }

        // Take the SR first — the backing must exist before the claims against it do.
        let me = env.current_contract_address();
        SrClient::new(&env, &storage::get_sr(&env)).transfer(&from, &me, &sr_in);

        // Settle the receiver BEFORE their YT balance grows, so the new YT earns strictly from
        // now and never inherits their earlier index.
        Self::before_yt_change(&env, &receiver, &receiver, index);

        token::StellarAssetClient::new(&env, &storage::get_pt(&env)).mint(&receiver, &py_out);
        Self::yt_mint(&env, &receiver, py_out);
        storage::set_total_py(&env, storage::total_py(&env) + py_out);
        storage::bump_instance(&env);

        events::minted(&env, &from, &receiver, sr_in, py_out, index);
        Self::assert_solvent(&env);
        py_out
    }

    /// **Recombine.** Burn `py_amount` of face from `from` and send the released SR to `receiver`.
    ///
    /// * **Before expiry** — burns `py_amount` PT **and** `py_amount` YT.
    /// * **At/after expiry** — burns PT **only**. Matching Pendle's
    ///   `if (!isExpired()) _burn(...)`: a matured YT carries no principal claim, so demanding it
    ///   would strand PT holders who sold their YT.
    ///
    /// Returns the SR paid out.
    pub fn redeem_py(env: Env, from: Address, receiver: Address, py_amount: i128) -> i128 {
        Self::ensure_initialized(&env); // an exit — open while paused
        from.require_auth();
        if py_amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let index = Self::index_current(&env);
        let sr_out = math::underlying_to_shares(&env, py_amount, index)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        if sr_out <= 0 {
            panic_with_error!(&env, Error::DustAmount);
        }

        token::StellarAssetClient::new(&env, &storage::get_pt(&env)).burn(&from, &py_amount);
        if !Self::is_expired(&env) {
            // Settle before the balance shrinks — the yield earned on the FULL amount is credited
            // first, then the YT goes away. Getting this order wrong erases earned yield.
            Self::before_yt_change(&env, &from, &from, index);
            Self::yt_burn(&env, &from, py_amount);
        }
        storage::set_total_py(&env, storage::total_py(&env) - py_amount);

        SrClient::new(&env, &storage::get_sr(&env)).transfer(
            &env.current_contract_address(),
            &receiver,
            &sr_out,
        );
        storage::bump_instance(&env);

        events::redeemed(&env, &from, &receiver, py_amount, sr_out, index);
        Self::assert_solvent(&env);
        sr_out
    }

    // ================= interest =================

    /// Settle `user` and pay out their accrued SR, minus the protocol yield fee.
    ///
    /// Returns `(paid_to_user, fee_to_treasury)`, both in SR. Callable by anyone on anyone's
    /// behalf — it only ever moves value **to** the holder, so there is nothing to gate. That also
    /// makes it safe for a keeper to sweep dust claims.
    pub fn redeem_due_interest(env: Env, user: Address) -> (i128, i128) {
        Self::redeem_due_interest_to(env, user.clone(), user)
    }

    /// `redeem_due_interest`, but paying the holder's SR to `receiver` instead of to themselves.
    ///
    /// This exists so a router can claim on the user's behalf and unwrap the proceeds to USDC in the
    /// same transaction. Without it the router would have to claim (paying the *user*), then pull
    /// the SR back — and the pull amount is only known on chain, which is exactly the
    /// simulate-vs-execute authorization drift that bit us on testnet (`AUDITPREP.md` §4, item 1).
    ///
    /// ## Why the auth split is what it is
    ///
    /// Paying a holder their own yield is safe for anyone to trigger — it only ever moves value
    /// **to** them. **Redirecting** that payment is not: it moves their value to a third party. So
    /// the permissionless case stays permissionless, and only the redirect requires the holder's
    /// signature. Note this deliberately checks `receiver != user` rather than trusting the caller.
    pub fn redeem_due_interest_to(env: Env, user: Address, receiver: Address) -> (i128, i128) {
        Self::ensure_initialized(&env); // an exit — open while paused
        if receiver != user {
            user.require_auth();
        }
        let index = Self::index_current(&env);
        interest::settle(&env, &user, tok::balance(&env, &user), index);

        let ui: UserInterest = storage::get_interest(&env, &user);
        let gross = ui.accrued;
        if gross <= 0 {
            return (0, 0);
        }
        interest::take_accrued(&env, &user, gross);

        let fee = math::mul_div_floor(&env, gross, storage::yield_fee_bps(&env) as i128, 10_000)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        let net = gross - fee;

        let sr = SrClient::new(&env, &storage::get_sr(&env));
        let me = env.current_contract_address();
        if net > 0 {
            sr.transfer(&me, &receiver, &net);
        }
        if fee > 0 {
            sr.transfer(&me, &storage::get_treasury(&env), &fee);
        }
        storage::bump_instance(&env);

        events::interest_paid(&env, &user, net, fee, index);
        Self::assert_solvent(&env);
        (net, fee)
    }

    /// Settle `user` without paying — Pendle's "accrue, don't pay". Useful before an off-protocol
    /// transfer, and as the explicit version of what every balance change does implicitly.
    pub fn checkpoint(env: Env, user: Address) -> i128 {
        Self::ensure_initialized(&env);
        let index = Self::index_current(&env);
        let earned = interest::settle(&env, &user, tok::balance(&env, &user), index);
        storage::bump_instance(&env);
        earned
    }

    /// SR `user` could withdraw right now, gross of the yield fee. Panic-free view; never writes.
    pub fn claimable_interest(env: Env, user: Address) -> i128 {
        if !storage::is_initialized(&env) {
            return 0;
        }
        let index = Self::index_view(&env);
        interest::claimable(&env, &user, tok::balance(&env, &user), index)
    }

    /// A holder's full interest record.
    pub fn interest_of(env: Env, user: Address) -> UserInterest {
        storage::get_interest(&env, &user)
    }

    // ================= expiry / settlement =================

    /// Freeze the index at expiry. Permissionless — anyone may pin it, and the earlier it is
    /// pinned the tighter the ceiling. Write-once: a later call can never raise it.
    ///
    /// Blend exposes only the *current* rate with no historical lookup, so the expiry index cannot
    /// be reconstructed after the fact — it has to be observed on chain. This is `futureamm.md`'s
    /// "Rule A", made explicit and callable rather than left to whoever happens to touch the
    /// contract first.
    pub fn stamp_expiry_index(env: Env) -> i128 {
        Self::ensure_initialized(&env);
        if !Self::is_expired(&env) {
            panic_with_error!(&env, Error::SeriesNotExpired);
        }
        if let Some(i) = storage::post_expiry_index(&env) {
            return i;
        }
        let live = Self::live_index_synced(&env);
        storage::set_post_expiry_index(&env, live);
        storage::set_index_stored(&env, live);
        storage::bump_instance(&env);
        events::expiry_stamped(&env, live);
        live
    }

    /// Sweep genuinely-unowed SR to the treasury.
    ///
    /// ## Read this before assuming it is a revenue line — it usually is not
    /// In a share-based design the surplus is **not** free money. The conservation identity is
    /// exact: minting `sr_in` at index `i0` creates `face = sr_in × i0` and leaves
    /// `held − pt_cover = sr_in − sr_in × i0/i`, which is *precisely* what YT holders are owed.
    /// **Every stroop above PT cover belongs to some YT holder** — settled or not.
    ///
    /// So this can only ever sweep what is provably owed to nobody:
    /// * rounding remainder from the one-directional floors in the interest math, and
    /// * claims **abandoned** by burning YT without withdrawing.
    ///
    /// The unsettled part of holders' claims cannot be enumerated on chain, so it is bounded from
    /// above: no holder's settlement index can be below [`storage::init_index`], so the worst-case
    /// unsettled total is what the entire YT supply would have earned from that floor. That bound
    /// is deliberately loose — a healthy series sweeps ≈0, which is the correct answer, not a bug.
    ///
    /// An earlier version swept `held − pt_cover − total_accrued`, which paid the treasury out of
    /// holders' unsettled interest and tripped the solvency assertion on their next withdrawal.
    /// Pinned by `sweeping_can_never_take_pt_backing_or_a_credited_claim`.
    ///
    /// Permissionless; the destination is fixed at the treasury.
    pub fn sweep_surplus(env: Env) -> i128 {
        Self::ensure_initialized(&env);
        if !Self::is_expired(&env) {
            panic_with_error!(&env, Error::SeriesNotExpired);
        }
        Self::stamp_expiry_index(env.clone());
        let sweepable = Self::sweepable(&env);
        if sweepable <= 0 {
            return 0;
        }
        SrClient::new(&env, &storage::get_sr(&env)).transfer(
            &env.current_contract_address(),
            &storage::get_treasury(&env),
            &sweepable,
        );
        storage::bump_instance(&env);
        events::surplus_swept(&env, sweepable);
        Self::assert_solvent(&env);
        sweepable
    }

    /// SR held beyond PT cover. **All of this is owed to YT holders** — see [`Self::sweep_surplus`].
    /// Exposed for dashboards, never as a claim on the protocol's behalf.
    pub fn surplus(env: &Env) -> i128 {
        let held = Self::sr_balance(env);
        let cover = Self::pt_cover(env);
        if held > cover {
            held - cover
        } else {
            0
        }
    }

    /// The provably-unowed residue: surplus, minus credited claims, minus a conservative upper
    /// bound on every claim that could still be unsettled.
    pub fn sweepable(env: &Env) -> i128 {
        let held = Self::sr_balance(env);
        let cover = Self::pt_cover(env);
        let index = Self::index_view(env);
        let floor_index = storage::init_index(env);
        // Worst case: the entire outstanding YT supply is still sitting at the earliest index the
        // contract has ever seen.
        let max_unsettled = if floor_index > 0 {
            interest::accrued_between(env, tok::total_supply(env), floor_index, index)
        } else {
            0
        };
        let owed = cover + storage::total_accrued(env) + max_unsettled;
        if held > owed {
            held - owed
        } else {
            0
        }
    }

    pub fn is_expired(env: &Env) -> bool {
        env.ledger().timestamp() >= storage::get_expiry(env)
    }

    /// The live PY index — `max(SR.exchange_rate(), stored)` before expiry, frozen after.
    /// **Mutating**: ratchets the stored index. The swap/mint paths use this.
    pub fn index_current(env: &Env) -> i128 {
        if Self::is_expired(env) {
            if let Some(i) = storage::post_expiry_index(env) {
                return i;
            }
            // First touch after expiry pins the ceiling on the way past.
            let live = Self::live_index_synced(env);
            storage::set_post_expiry_index(env, live);
            storage::set_index_stored(env, live);
            events::expiry_stamped(env, live);
            return live;
        }
        let live = Self::live_index_synced(env);
        if live > storage::index_stored(env) {
            storage::set_index_stored(env, live);
        }
        live
    }

    /// Non-mutating twin of [`Self::index_current`], for views and quotes.
    fn index_view(env: &Env) -> i128 {
        if Self::is_expired(env) {
            if let Some(i) = storage::post_expiry_index(env) {
                return i;
            }
        }
        Self::live_index_view(env)
    }

    /// Public read of the index (no writes) — the number every quote above should use.
    pub fn py_index(env: Env) -> i128 {
        Self::index_view(&env)
    }

    /// Mutating: refresh SR from the strategy first, then take the max with our stored index.
    /// Used by every value-moving path, so none of them can run on a stale rate.
    fn live_index_synced(env: &Env) -> i128 {
        let live = SrClient::new(env, &storage::get_sr(env)).sync_rate();
        let stored = storage::index_stored(env);
        if live > stored { live } else { stored }
    }

    /// Pure: read SR's stored rate. May lag by at most one sync, which under-states yield —
    /// the safe direction for a view.
    fn live_index_view(env: &Env) -> i128 {
        let live = SrClient::new(env, &storage::get_sr(env)).exchange_rate();
        let stored = storage::index_stored(env);
        if live > stored { live } else { stored }
    }

    // ================= YT as SEP-41 =================

    pub fn balance(env: Env, id: Address) -> i128 {
        tok::balance(&env, &id)
    }

    pub fn total_supply(env: Env) -> i128 {
        tok::total_supply(&env)
    }

    /// Move YT. **Settles both parties first** — this is the line that makes YT tradeable at all.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        Self::yt_move(&env, &from, &to, amount);
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        tok::spend_allowance(&env, &from, &spender, amount);
        Self::yt_move(&env, &from, &to, amount);
    }

    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        Self::burn_checked(&env, &from, amount);
    }

    /// Burn on a spender's authority, consuming their allowance.
    ///
    /// This must NOT route through [`Self::burn`]: that calls `from.require_auth()`, so delegating
    /// to it would demand the OWNER's signature as well and make every allowance unusable. Both
    /// entry points share [`Self::burn_checked`], which does the work and no auth, so each caller
    /// establishes authority in its own correct way.
    pub fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        tok::spend_allowance(&env, &from, &spender, amount);
        Self::burn_checked(&env, &from, amount);
    }

    /// The shared burn body. **Performs no authorization** — callers must have established it.
    fn burn_checked(env: &Env, from: &Address, amount: i128) {
        if amount <= 0 {
            panic_with_error!(env, Error::InvalidAmount);
        }
        let index = Self::index_current(env);
        // Settle BEFORE the balance shrinks, like every other mutation path.
        Self::before_yt_change(env, from, from, index);
        Self::yt_burn(env, from, amount);
        // Burning YT without the matching PT abandons a yield claim; it does NOT release backing.
        // The abandoned SR becomes surplus and is swept to the treasury after expiry.
        events::yt_burned(env, from, amount);
        Self::assert_solvent(env);
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
        String::from_str(&env, "Spield Yield Token")
    }

    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "YT")
    }

    // ================= views =================

    pub fn sr_token(env: Env) -> Address {
        storage::get_sr(&env)
    }

    pub fn pt_token(env: Env) -> Address {
        storage::get_pt(&env)
    }

    pub fn expiry(env: Env) -> u64 {
        storage::get_expiry(&env)
    }

    pub fn total_py(env: Env) -> i128 {
        storage::total_py(&env)
    }

    pub fn total_accrued(env: Env) -> i128 {
        storage::total_accrued(&env)
    }

    pub fn yield_fee_bps(env: Env) -> u32 {
        storage::yield_fee_bps(&env)
    }

    pub fn treasury(env: Env) -> Address {
        storage::get_treasury(&env)
    }

    pub fn admin(env: Env) -> Address {
        storage::get_admin(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        storage::is_paused(&env)
    }

    pub fn expiry_index(env: Env) -> Option<i128> {
        storage::post_expiry_index(&env)
    }

    /// `(sr_held, sr_required, surplus)` — the solvency dashboard for this series.
    pub fn solvency(env: Env) -> (i128, i128, i128) {
        let held = Self::sr_balance(&env);
        let need = Self::required_sr(&env);
        (held, need, if held > need { held - need } else { 0 })
    }

    /// Permissionless TTL keep-alive for a holder's entries.
    ///
    /// Covers **both** the `Interest` record and the YT **balance** entry. It used to bump only the
    /// former (`tofix.md` #30): a dormant YT holder's balance is a separate persistent entry with
    /// its own TTL, refreshed only when the balance is written, so keeping the interest record
    /// alive while letting the balance archive kept exactly the wrong half.
    pub fn bump_holder(env: Env, user: Address) {
        Self::ensure_initialized(&env);
        storage::bump_interest_ttl(&env, &user);
        tok::bump_balance(&env, &user, Self::bump_horizon(&env));
    }

    // ================= admin =================

    pub fn set_yield_fee(env: Env, bps: u32) {
        storage::get_admin(&env).require_auth();
        if bps > MAX_YIELD_FEE_BPS {
            panic_with_error!(&env, Error::FeeShareTooHigh);
        }
        storage::set_yield_fee_bps(&env, bps);
        storage::bump_instance(&env);
        events::yield_fee_set(&env, bps);
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
        String::from_str(&env, "spield-yield-0.1.0")
    }

    // ================= internals =================

    fn ensure_initialized(env: &Env) {
        if !storage::is_initialized(env) {
            panic_with_error!(env, Error::NotInitialized);
        }
    }

    fn ensure_can_mint(env: &Env) {
        Self::ensure_initialized(env);
        if storage::is_paused(env) {
            panic_with_error!(env, Error::Paused);
        }
        if Self::is_expired(env) {
            panic_with_error!(env, Error::SeriesExpired);
        }
    }

    /// **The hook.** Settle both parties at `index` before any YT balance changes.
    fn before_yt_change(env: &Env, from: &Address, to: &Address, index: i128) {
        interest::settle_two(
            env,
            from,
            tok::balance(env, from),
            to,
            tok::balance(env, to),
            index,
        );
    }

    fn bump_horizon(env: &Env) -> u64 {
        storage::get_expiry(env)
    }

    fn yt_move(env: &Env, from: &Address, to: &Address, amount: i128) {
        if amount <= 0 {
            panic_with_error!(env, Error::InvalidAmount);
        }
        let index = Self::index_current(env);
        Self::before_yt_change(env, from, to, index);

        let fb = tok::balance(env, from);
        if fb < amount {
            panic_with_error!(env, Error::InsufficientBalance);
        }
        let h = Self::bump_horizon(env);
        tok::set_balance(env, from, fb - amount, h);
        tok::set_balance(env, to, tok::balance(env, to) + amount, h);
        events::yt_transferred(env, from, to, amount);
    }

    fn yt_mint(env: &Env, to: &Address, amount: i128) {
        let h = Self::bump_horizon(env);
        tok::set_balance(env, to, tok::balance(env, to) + amount, h);
        tok::set_total_supply(env, tok::total_supply(env) + amount);
    }

    fn yt_burn(env: &Env, from: &Address, amount: i128) {
        let b = tok::balance(env, from);
        if b < amount {
            panic_with_error!(env, Error::InsufficientBalance);
        }
        let h = Self::bump_horizon(env);
        tok::set_balance(env, from, b - amount, h);
        tok::set_total_supply(env, tok::total_supply(env) - amount);
    }

    fn sr_balance(env: &Env) -> i128 {
        SrClient::new(env, &storage::get_sr(env)).balance(&env.current_contract_address())
    }

    /// SR needed to redeem every outstanding PT at par, at the current index.
    fn pt_cover(env: &Env) -> i128 {
        let index = Self::index_view(env);
        math::underlying_to_shares(env, storage::total_py(env), index).unwrap_or(0)
    }

    /// SR needed to cover PT at par plus every credited interest claim.
    fn required_sr(env: &Env) -> i128 {
        Self::pt_cover(env) + storage::total_accrued(env)
    }

    /// The invariant, asserted after every mutation.
    fn assert_solvent(env: &Env) {
        let held = Self::sr_balance(env);
        let need = Self::required_sr(env);
        if held + SOLVENCY_SLACK < need {
            panic_with_error!(env, Error::SolvencyViolation);
        }
    }
}

/// Typed client for the SR token. Declared here rather than imported so this crate depends on
/// SR's *interface*, not its implementation — the same seam Pendle keeps between YT and SY.
#[soroban_sdk::contractclient(name = "SrClient")]
pub trait SrToken {
    /// PURE read of SR's stored rate. Never calls the strategy.
    fn exchange_rate(env: Env) -> i128;
    /// Refresh SR's stored rate from the strategy. ALWAYS writes, so the footprint is
    /// deterministic — see `Sr::exchange_rate` for why that matters.
    fn sync_rate(env: Env) -> i128;
    fn balance(env: Env, id: Address) -> i128;
    fn transfer(env: Env, from: Address, to: Address, amount: i128);
    fn underlying(env: Env) -> Address;
}

pub const INDEX_SCALAR: i128 = SCALAR_12;
