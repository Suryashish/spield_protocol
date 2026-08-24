//! SEP-41 token primitives — storage + the mechanical half of a fungible token.
//!
//! ## Why this exists
//! PT and the underlying stay **Stellar Asset Contracts** (SACs): built into the protocol, fixed
//! interface, composable with Stellar classic. That is the right call for a pure bearer claim.
//!
//! But a SAC **has no transfer hook**, and two of the Pendle-shaped contracts need one:
//!
//! * **YT** must settle both parties' accrued interest *before* any balance moves, or a transfer
//!   silently moves the yield claim away from whoever earned it (the `tofix.md` #15 stranding
//!   class of bug).
//! * **SR** must be able to report `exchange_rate()` on the token itself, so everything above it
//!   can read one number without knowing which yield source is underneath.
//!
//! So those two are custom SEP-41 contracts. This module is the part they share: balance,
//! allowance and total-supply storage, plus `spend_allowance`. It deliberately does **not**
//! implement `transfer`/`mint`/`burn` — each contract writes those itself so its own pre-transfer
//! hook is impossible to forget.
//!
//! Additive: nothing in the audited `wrapper`/`vault`/`market` path reads this module.

use soroban_sdk::{contracttype, panic_with_error, Address, Env};

use crate::{ttl, Error};

/// Allowances are short-lived by design; balances live as long as the series. Both are persistent
/// entries bumped on write.
#[derive(Clone)]
#[contracttype]
pub struct AllowanceKey {
    pub from: Address,
    pub spender: Address,
}

#[derive(Clone)]
#[contracttype]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[derive(Clone)]
#[contracttype]
pub enum TokenKey {
    Balance(Address),
    Allowance(AllowanceKey),
    TotalSupply,
}

// ---------- balances ----------

pub fn balance(env: &Env, addr: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&TokenKey::Balance(addr.clone()))
        .unwrap_or(0)
}

/// Write a balance and bump its TTL past `maturity` (+ grace), so a holder who simply *holds*
/// across a long term can never have their balance entry archived out from under them.
pub fn set_balance(env: &Env, addr: &Address, amount: i128, maturity: u64) {
    if amount < 0 {
        panic_with_error!(env, Error::InsufficientBalance);
    }
    let key = TokenKey::Balance(addr.clone());
    env.storage().persistent().set(&key, &amount);
    let (lo, hi) = ttl::maturity_aware_bump(env, maturity);
    env.storage().persistent().extend_ttl(&key, lo, hi);
}

pub fn total_supply(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&TokenKey::TotalSupply)
        .unwrap_or(0)
}

pub fn set_total_supply(env: &Env, amount: i128) {
    env.storage().instance().set(&TokenKey::TotalSupply, &amount);
}

// ---------- allowances ----------

pub fn allowance(env: &Env, from: &Address, spender: &Address) -> i128 {
    let key = TokenKey::Allowance(AllowanceKey {
        from: from.clone(),
        spender: spender.clone(),
    });
    match env.storage().temporary().get::<_, AllowanceValue>(&key) {
        Some(v) if v.expiration_ledger >= env.ledger().sequence() => v.amount,
        _ => 0,
    }
}

pub fn set_allowance(
    env: &Env,
    from: &Address,
    spender: &Address,
    amount: i128,
    expiration_ledger: u32,
) {
    if amount < 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }
    // SEP-41: an allowance that is already expired may only be set to zero.
    if amount > 0 && expiration_ledger < env.ledger().sequence() {
        panic_with_error!(env, Error::InvalidAmount);
    }
    let key = TokenKey::Allowance(AllowanceKey {
        from: from.clone(),
        spender: spender.clone(),
    });
    env.storage().temporary().set(
        &key,
        &AllowanceValue {
            amount,
            expiration_ledger,
        },
    );
    if amount > 0 {
        let live_for = expiration_ledger.saturating_sub(env.ledger().sequence());
        env.storage().temporary().extend_ttl(&key, live_for, live_for);
    }
}

/// Consume `amount` from `spender`'s allowance over `from`, or panic. No-op when the two are the
/// same address (an owner never needs an allowance over itself).
pub fn spend_allowance(env: &Env, from: &Address, spender: &Address, amount: i128) {
    if from == spender {
        return;
    }
    let current = allowance(env, from, spender);
    if current < amount {
        panic_with_error!(env, Error::InsufficientAllowance);
    }
    let key = TokenKey::Allowance(AllowanceKey {
        from: from.clone(),
        spender: spender.clone(),
    });
    let existing: AllowanceValue = env.storage().temporary().get(&key).unwrap();
    env.storage().temporary().set(
        &key,
        &AllowanceValue {
            amount: current - amount,
            expiration_ledger: existing.expiration_ledger,
        },
    );
}
