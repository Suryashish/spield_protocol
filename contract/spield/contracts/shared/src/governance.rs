//! # spield-shared::governance — reusable admin rotation + upgrade timelock
//!
//! Every Spield contract (`wrapper`, `strategy`, `vault`, `market`) needs the *same* operational
//! governance: a way to rotate the admin key (so a single hot key is never a permanent single point
//! of failure) and a way to fix bugs after launch (an `upgrade` path). This module implements both
//! once, identically, so the four contracts can't drift apart and each only has to expose thin
//! wrappers that delegate here.
//!
//! ## Design (decided for early-mainnet, see the mainnet-readiness checklist items #1/#2)
//!
//! * **Admin rotation = two-step propose/accept, no time delay.** `propose_admin(new)` records a
//!   pending admin; `accept_admin()` must be called by *that* address to take over. This makes it
//!   impossible to fat-finger the admin to a dead/typo address (the new key proves control before
//!   it gains power). Rotating is itself a privileged, deliberate act — no timelock needed.
//!
//! * **Upgrade = scheduled timelock.** `schedule_upgrade(hash)` records the target WASM hash and an
//!   `eta = now + timelock`. `apply_upgrade()` performs `update_current_contract_wasm` only at/after
//!   `eta`. `cancel_upgrade()` aborts a pending one. The delay gives users a window to exit before
//!   the code under their funds changes — the credibly-neutral default for an upgradeable protocol.
//!
//! * **The timelock delay is on-chain and admin-settable within hard bounds** (`MIN_TIMELOCK` …
//!   `MAX_TIMELOCK`), so ops can tune the exit window without a redeploy, but can never set it to
//!   zero (which would defeat the point) or absurdly long (which would brick the upgrade path).
//!   Changing the delay does **not** retroactively shorten an already-scheduled upgrade's `eta`.
//!
//! ## Storage isolation
//! All keys live in this module's own [`GovKey`] enum. Because Soroban keys are discriminated by
//! their type's symbolic name *and* variant, `GovKey::Admin` never collides with a host contract's
//! `DataKey::Admin` — the two are different types. Host contracts keep using their existing `Admin`
//! key for the *current* admin; governance reads/writes that same logical admin via [`get_admin`]
//! below so there is a single source of truth. To avoid duplicating the admin in two places, the
//! host contract passes its own admin getter/setter in — see [`init`].
//!
//! The clean split: this module owns `PendingAdmin`, `Upgrade` (pending hash+eta), and `Timelock`;
//! the host contract continues to own `Admin`. The helpers here take the *current admin* as an
//! argument (the host reads it from its own storage) so we never assume a key name.

use soroban_sdk::{contractevent, contracttype, panic_with_error, Address, BytesN, Env};

use crate::Error;

// ----------------------------------------------------------------------------
// Governance events (emitted here so all four contracts report identically)
// ----------------------------------------------------------------------------

/// A new admin was proposed (two-step rotation, step 1).
#[contractevent]
#[derive(Clone)]
pub struct AdminProposed {
    #[topic]
    pub current_admin: Address,
    #[topic]
    pub proposed_admin: Address,
}

/// A proposed admin accepted the role (two-step rotation, step 2). `new_admin` is now in control.
#[contractevent]
#[derive(Clone)]
pub struct AdminChanged {
    #[topic]
    pub new_admin: Address,
}

/// A pending admin proposal was cancelled by the current admin.
#[contractevent]
#[derive(Clone)]
pub struct AdminTransferCancelled {
    #[topic]
    pub current_admin: Address,
}

/// An upgrade was scheduled; it may be applied at/after `eta`.
#[contractevent]
#[derive(Clone)]
pub struct UpgradeScheduled {
    pub wasm_hash: BytesN<32>,
    pub eta: u64,
}

/// A scheduled upgrade was cancelled before it was applied.
#[contractevent]
#[derive(Clone)]
pub struct UpgradeCancelled {}

/// A scheduled upgrade was applied — the contract now runs `wasm_hash`.
#[contractevent]
#[derive(Clone)]
pub struct Upgraded {
    pub wasm_hash: BytesN<32>,
}

/// The upgrade timelock delay was changed.
#[contractevent]
#[derive(Clone)]
pub struct TimelockChanged {
    pub secs: u64,
}

/// Default upgrade timelock: **24 hours** (in seconds). Long enough for users to notice and exit
/// before an upgrade lands, short enough to ship real fixes promptly. Admin-settable within bounds.
pub const DEFAULT_TIMELOCK_SECS: u64 = 24 * 60 * 60;

/// Hard lower bound on the timelock (1 hour). The admin can shorten the window but never to a value
/// that would make the exit window meaningless.
pub const MIN_TIMELOCK_SECS: u64 = 60 * 60;

/// Hard upper bound on the timelock (30 days). Stops the admin (or a typo) from setting a delay so
/// long the upgrade path is effectively bricked.
pub const MAX_TIMELOCK_SECS: u64 = 30 * 24 * 60 * 60;

/// ~30 / ~60 days in 5-second ledgers — matches the contracts' instance-storage bump window so
/// governance state ages in lock-step with the rest of each contract's instance storage.
const BUMP_LO: u32 = 30 * 24 * 60 * 60 / 5;
const BUMP_HI: u32 = 60 * 24 * 60 * 60 / 5;

/// Governance keys, isolated in their own type so they can never collide with a host contract's
/// `DataKey` (different enum type ⇒ different storage key, even for same-named variants).
#[derive(Clone)]
#[contracttype]
enum GovKey {
    /// The admin proposed via `propose_admin`, awaiting `accept_admin`. Absent when none pending.
    PendingAdmin,
    /// A scheduled upgrade: the target WASM hash and the earliest ledger time it may be applied.
    Upgrade,
    /// The current upgrade timelock delay, in seconds. Defaults to `DEFAULT_TIMELOCK_SECS`.
    Timelock,
}

/// A pending, scheduled upgrade.
#[derive(Clone)]
#[contracttype]
pub struct PendingUpgrade {
    /// The WASM hash the contract will be upgraded to.
    pub wasm_hash: BytesN<32>,
    /// Earliest unix-second timestamp at which `apply_upgrade` may run (`scheduled_at + timelock`).
    pub eta: u64,
}

// ----------------------------------------------------------------------------
// Init
// ----------------------------------------------------------------------------

/// Initialize governance state (call once, from the host contract's `initialize`). Sets the
/// timelock to the default. The current admin is owned by the host contract's own storage — this
/// module never sets it, so there is a single source of truth for "who is admin".
pub fn init(env: &Env) {
    env.storage()
        .instance()
        .set(&GovKey::Timelock, &DEFAULT_TIMELOCK_SECS);
    bump(env);
}

// ----------------------------------------------------------------------------
// Admin rotation (two-step propose/accept)
// ----------------------------------------------------------------------------

/// Propose a new admin. Requires the *current* admin's auth. Records `new_admin` as pending; it
/// does not gain any power until it calls [`accept_admin`]. Re-calling overwrites the pending
/// proposal (and can be used to cancel by proposing the current admin, though `accept_admin` by the
/// current admin is the explicit path).
pub fn propose_admin(env: &Env, current_admin: &Address, new_admin: &Address) {
    current_admin.require_auth();
    env.storage()
        .instance()
        .set(&GovKey::PendingAdmin, new_admin);
    bump(env);
    AdminProposed {
        current_admin: current_admin.clone(),
        proposed_admin: new_admin.clone(),
    }
    .publish(env);
}

/// Accept a pending admin proposal. Requires the *pending* admin's auth (proving it controls the
/// key before it gains power — the anti-fat-finger guarantee). Returns the new admin so the host
/// contract can write it into its own `Admin` storage. Clears the pending proposal.
pub fn accept_admin(env: &Env) -> Address {
    let pending: Address = env
        .storage()
        .instance()
        .get(&GovKey::PendingAdmin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NoPendingAdmin));
    pending.require_auth();
    env.storage().instance().remove(&GovKey::PendingAdmin);
    bump(env);
    AdminChanged {
        new_admin: pending.clone(),
    }
    .publish(env);
    pending
}

/// The currently-proposed (not yet accepted) admin, if any. View for the frontend / monitoring.
pub fn pending_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&GovKey::PendingAdmin)
}

/// Cancel a pending admin proposal. Requires the current admin's auth.
pub fn cancel_admin_transfer(env: &Env, current_admin: &Address) {
    current_admin.require_auth();
    if !env.storage().instance().has(&GovKey::PendingAdmin) {
        panic_with_error!(env, Error::NoPendingAdmin);
    }
    env.storage().instance().remove(&GovKey::PendingAdmin);
    bump(env);
    AdminTransferCancelled {
        current_admin: current_admin.clone(),
    }
    .publish(env);
}

// ----------------------------------------------------------------------------
// Upgrade timelock
// ----------------------------------------------------------------------------

/// The current upgrade timelock delay (seconds).
pub fn timelock(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&GovKey::Timelock)
        .unwrap_or(DEFAULT_TIMELOCK_SECS)
}

/// Set the upgrade timelock delay (seconds), bounded to `[MIN_TIMELOCK_SECS, MAX_TIMELOCK_SECS]`.
/// Requires the current admin's auth. Takes effect immediately for *future* schedules; it does not
/// change the `eta` of an already-scheduled upgrade.
pub fn set_timelock(env: &Env, current_admin: &Address, secs: u64) {
    current_admin.require_auth();
    if secs < MIN_TIMELOCK_SECS || secs > MAX_TIMELOCK_SECS {
        panic_with_error!(env, Error::TimelockOutOfBounds);
    }
    env.storage().instance().set(&GovKey::Timelock, &secs);
    bump(env);
    TimelockChanged { secs }.publish(env);
}

/// Schedule an upgrade to `wasm_hash`, applyable no earlier than `now + timelock`. Requires the
/// current admin's auth. Overwrites any previously-scheduled-but-not-applied upgrade (re-scheduling
/// resets the clock). Returns the computed `eta` so the host can emit it in an event.
pub fn schedule_upgrade(env: &Env, current_admin: &Address, wasm_hash: BytesN<32>) -> u64 {
    current_admin.require_auth();
    let eta = env
        .ledger()
        .timestamp()
        .checked_add(timelock(env))
        .unwrap_or_else(|| panic_with_error!(env, Error::MathOverflow));
    env.storage().instance().set(
        &GovKey::Upgrade,
        &PendingUpgrade {
            wasm_hash: wasm_hash.clone(),
            eta,
        },
    );
    bump(env);
    UpgradeScheduled { wasm_hash, eta }.publish(env);
    eta
}

/// Cancel a scheduled upgrade. Requires the current admin's auth. No-op semantics: panics
/// `NoPendingUpgrade` if there is nothing scheduled (so a cancel can't silently appear to succeed).
pub fn cancel_upgrade(env: &Env, current_admin: &Address) {
    current_admin.require_auth();
    if !env.storage().instance().has(&GovKey::Upgrade) {
        panic_with_error!(env, Error::NoPendingUpgrade);
    }
    env.storage().instance().remove(&GovKey::Upgrade);
    bump(env);
    UpgradeCancelled {}.publish(env);
}

/// Apply a scheduled upgrade once its timelock has elapsed. Requires the current admin's auth.
/// Performs `update_current_contract_wasm` to the scheduled hash, then clears the schedule. Panics
/// `NoPendingUpgrade` if none scheduled, or `TimelockNotElapsed` if called before `eta`.
pub fn apply_upgrade(env: &Env, current_admin: &Address) {
    current_admin.require_auth();
    let pending: PendingUpgrade = env
        .storage()
        .instance()
        .get(&GovKey::Upgrade)
        .unwrap_or_else(|| panic_with_error!(env, Error::NoPendingUpgrade));
    if env.ledger().timestamp() < pending.eta {
        panic_with_error!(env, Error::TimelockNotElapsed);
    }
    env.deployer()
        .update_current_contract_wasm(pending.wasm_hash.clone());
    // Clear the schedule so the same upgrade can't be re-applied; the new code starts clean.
    env.storage().instance().remove(&GovKey::Upgrade);
    bump(env);
    Upgraded {
        wasm_hash: pending.wasm_hash,
    }
    .publish(env);
}

/// The currently-scheduled upgrade, if any. View for the frontend / monitoring so users can see a
/// pending upgrade and its `eta` (the whole point of the timelock).
pub fn pending_upgrade(env: &Env) -> Option<PendingUpgrade> {
    env.storage().instance().get(&GovKey::Upgrade)
}

fn bump(env: &Env) {
    env.storage().instance().extend_ttl(BUMP_LO, BUMP_HI);
}
