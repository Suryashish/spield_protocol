//! The per-holder interest index — Spield's `InterestManagerYT`.
//!
//! ## The whole idea in one line
//! **1 YT = a claim on the yield of 1 unit of asset.** As the index rises, fewer SR are needed to
//! back that 1 unit of asset — and the SR freed up *is* the yield.
//!
//! ```text
//! interest(SR) = balance * SCALAR_12 / prev_index  −  balance * SCALAR_12 / cur_index
//! ```
//!
//! which is Pendle's `(principal × (cur − prev)) / (prev × cur)`, rearranged so it cannot
//! overflow an `i128` (see [`accrued_between`]).
//!
//! ## Why it is exact, not approximate
//! `mint_py(sr_in)` at index `i` creates `py = sr_in × i` of face. The SR needed to cover that
//! face at index `i'` is `py / i' = sr_in × i / i'`. So the surplus SR sitting in the contract is
//! `sr_in − sr_in × i/i' = sr_in × (i' − i)/i'` — **precisely** the sum of what this formula pays
//! every holder. The contract never has to be topped up: the yield is already there, and paying it
//! out is just recognising which part of the SR balance was never PT's to begin with.
//!
//! ## Accrue is not pay
//! [`settle`] only ever writes into `UserInterest.accrued`. SR moves only in
//! `redeem_due_interest`. That separation is what makes a YT sale safe: the sale settles you first,
//! so nothing is lost, but it does not force a withdrawal you did not ask for.
//!
//! ## Rounding is one-directional
//! Both divisions floor, so a holder is paid **at most** their true entitlement, never more. The
//! stroop-level remainder stays in the contract, is covered by the solvency assertion, and is swept
//! to the treasury after expiry — the same place Pendle sends its post-expiry surplus.

use soroban_sdk::{panic_with_error, Address, Env};
use spield_shared::{math, Error, SCALAR_12};

use crate::storage::{self, UserInterest};

/// SR earned by holding `balance` YT while the index moved `prev → cur`.
///
/// Computed as the difference of two share amounts rather than one fused expression: the fused
/// form `balance × SCALAR_12 × (cur − prev)` reaches ~1e39 for a large position and overflows
/// `i128` (max ≈1.7e38). Splitting it keeps every intermediate under ~1e27.
pub fn accrued_between(env: &Env, balance: i128, prev: i128, cur: i128) -> i128 {
    if balance <= 0 || prev <= 0 || cur <= prev {
        return 0;
    }
    // shares that backed this face at the old index
    let shares_at_prev = match math::mul_div_floor(env, balance, SCALAR_12, prev) {
        Ok(v) => v,
        Err(e) => panic_with_error!(env, e),
    };
    // freed = shares_at_prev × (cur − prev) / cur
    match math::mul_div_floor(env, shares_at_prev, cur - prev, cur) {
        Ok(v) => v,
        Err(e) => panic_with_error!(env, e),
    }
}

/// Settle one holder up to `index`, crediting (not paying) what they earned.
///
/// A holder seen for the first time simply records `index` and accrues nothing — they earn
/// strictly from this moment forward, never retroactively. This is the single most important line
/// in the file: without it, buying YT would hand the buyer the seller's history.
///
/// Returns the SR newly credited (0 if none).
pub fn settle(env: &Env, user: &Address, balance: i128, index: i128) -> i128 {
    let mut ui = storage::get_interest(env, user);
    if ui.index == index {
        return 0; // already settled at this index — no write at all
    }
    // `index == 0` means never seen: record and earn from here, never retroactively.
    let earned = if ui.index == 0 {
        0
    } else {
        accrued_between(env, balance, ui.index, index)
    };
    if earned > 0 {
        ui.accrued += earned;
        storage::set_total_accrued(env, storage::total_accrued(env) + earned);
    }
    // Always advance, even when `earned` floors to zero, so nobody can be pinned to a stale index.
    ui.index = index;
    storage::set_interest(env, user, &ui);
    earned
}

/// Settle two holders at once — the shape every transfer needs (`from` and `to`), and the reason
/// YT can move freely at all. Pendle's `_distributeInterestForTwo`.
pub fn settle_two(
    env: &Env,
    a: &Address,
    a_balance: i128,
    b: &Address,
    b_balance: i128,
    index: i128,
) {
    settle(env, a, a_balance, index);
    if b != a {
        settle(env, b, b_balance, index);
    }
}

/// A holder's claimable SR *as if* settled right now, without writing anything. For views.
pub fn claimable(env: &Env, user: &Address, balance: i128, index: i128) -> i128 {
    let ui: UserInterest = storage::get_interest(env, user);
    if ui.index == 0 {
        return ui.accrued;
    }
    ui.accrued + accrued_between(env, balance, ui.index, index)
}

/// Move `amount` out of a holder's accrued balance (the withdrawal side of the ledger).
pub fn take_accrued(env: &Env, user: &Address, amount: i128) {
    let mut ui = storage::get_interest(env, user);
    if ui.accrued < amount {
        panic_with_error!(env, Error::InsufficientBalance);
    }
    ui.accrued -= amount;
    ui.withdrawn += amount;
    storage::set_interest(env, user, &ui);
    storage::set_total_accrued(env, storage::total_accrued(env) - amount);
}
