#![cfg(test)]
//! Unit tests for the shared `governance` module: two-step admin rotation, the upgrade timelock
//! state machine, and the timelock-delay bounds. These exercise the exact code path the four
//! production contracts delegate into, via a minimal in-crate harness contract that mirrors how
//! they wire it up (current admin in the contract's own instance storage; governance owns the
//! pending-admin / pending-upgrade / timelock keys).
//!
//! The real `update_current_contract_wasm` code-swap is verified separately in the wrapper crate
//! (it needs a second compiled wasm to upgrade *to*); here we cover everything around it — auth,
//! the schedule→wait→apply ordering, cancellation, and the bounds.

extern crate std;

use crate::{governance, Error};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, BytesN as _, Ledger as _},
    Address, BytesN, Env,
};

#[contracttype]
enum HKey {
    Admin,
}

/// Minimal harness mirroring the production wiring: the contract owns `Admin`; everything else
/// delegates to `governance`. (We don't call `apply_upgrade` here — it would need a wasm to swap
/// to; that path is covered in the wrapper crate.)
#[contract]
pub struct Harness;

#[contractimpl]
impl Harness {
    pub fn initialize(env: Env, admin: Address) {
        env.storage().instance().set(&HKey::Admin, &admin);
        governance::init(&env);
    }

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&HKey::Admin).unwrap()
    }

    pub fn propose_admin(env: Env, new_admin: Address) {
        governance::propose_admin(&env, &Self::admin(env.clone()), &new_admin);
    }

    pub fn accept_admin(env: Env) {
        let new_admin = governance::accept_admin(&env);
        env.storage().instance().set(&HKey::Admin, &new_admin);
    }

    pub fn cancel_admin_transfer(env: Env) {
        governance::cancel_admin_transfer(&env, &Self::admin(env.clone()));
    }

    pub fn pending_admin(env: Env) -> Option<Address> {
        governance::pending_admin(&env)
    }

    pub fn schedule_upgrade(env: Env, wasm_hash: BytesN<32>) -> u64 {
        governance::schedule_upgrade(&env, &Self::admin(env.clone()), wasm_hash)
    }

    pub fn cancel_upgrade(env: Env) {
        governance::cancel_upgrade(&env, &Self::admin(env.clone()));
    }

    pub fn pending_upgrade(env: Env) -> Option<governance::PendingUpgrade> {
        governance::pending_upgrade(&env)
    }

    pub fn timelock(env: Env) -> u64 {
        governance::timelock(&env)
    }

    pub fn set_timelock(env: Env, secs: u64) {
        governance::set_timelock(&env, &Self::admin(env.clone()), secs);
    }
}

fn setup() -> (Env, HarnessClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);
    let admin = Address::generate(&env);
    let id = env.register(Harness, ());
    let client = HarnessClient::new(&env, &id);
    client.initialize(&admin);
    (env, client, admin)
}

// --------------------------------------------------------------------------
// Two-step admin rotation
// --------------------------------------------------------------------------

#[test]
fn admin_rotation_two_step_happy_path() {
    let (env, c, admin) = setup();
    let new_admin = Address::generate(&env);

    assert_eq!(c.admin(), admin);
    assert_eq!(c.pending_admin(), None);

    c.propose_admin(&new_admin);
    assert_eq!(c.pending_admin(), Some(new_admin.clone()));
    // Still the old admin until accept.
    assert_eq!(c.admin(), admin);

    c.accept_admin();
    assert_eq!(c.admin(), new_admin, "new admin in control after accept");
    assert_eq!(c.pending_admin(), None, "pending cleared after accept");
}

#[test]
fn admin_default_timelock_is_24h() {
    let (_env, c, _admin) = setup();
    assert_eq!(c.timelock(), governance::DEFAULT_TIMELOCK_SECS);
    assert_eq!(c.timelock(), 24 * 60 * 60);
}

#[test]
fn accept_admin_with_no_pending_fails() {
    let (env, c, _admin) = setup();
    let r = c.try_accept_admin();
    assert_eq!(r, Err(Ok(Error::NoPendingAdmin.into())));
    let _ = env;
}

#[test]
fn cancel_admin_transfer_clears_pending() {
    let (env, c, _admin) = setup();
    let new_admin = Address::generate(&env);
    c.propose_admin(&new_admin);
    assert_eq!(c.pending_admin(), Some(new_admin));
    c.cancel_admin_transfer();
    assert_eq!(c.pending_admin(), None);
    // And now accepting fails (nothing pending).
    assert_eq!(c.try_accept_admin(), Err(Ok(Error::NoPendingAdmin.into())));
}

#[test]
fn cancel_admin_transfer_with_none_pending_fails() {
    let (_env, c, _admin) = setup();
    assert_eq!(
        c.try_cancel_admin_transfer(),
        Err(Ok(Error::NoPendingAdmin.into()))
    );
}

#[test]
fn proposing_again_overwrites_pending() {
    let (env, c, _admin) = setup();
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    c.propose_admin(&a);
    c.propose_admin(&b);
    assert_eq!(c.pending_admin(), Some(b), "latest proposal wins");
}

// --------------------------------------------------------------------------
// Upgrade timelock state machine
// --------------------------------------------------------------------------

#[test]
fn schedule_upgrade_sets_eta_at_now_plus_timelock() {
    let (env, c, _admin) = setup();
    let hash = BytesN::<32>::random(&env);
    let now = env.ledger().timestamp();
    let eta = c.schedule_upgrade(&hash);
    assert_eq!(eta, now + governance::DEFAULT_TIMELOCK_SECS);

    let pending = c.pending_upgrade().unwrap();
    assert_eq!(pending.wasm_hash, hash);
    assert_eq!(pending.eta, eta);
}

#[test]
fn cancel_upgrade_clears_schedule() {
    let (env, c, _admin) = setup();
    let hash = BytesN::<32>::random(&env);
    c.schedule_upgrade(&hash);
    assert!(c.pending_upgrade().is_some());
    c.cancel_upgrade();
    assert!(c.pending_upgrade().is_none());
}

#[test]
fn cancel_upgrade_with_none_fails() {
    let (_env, c, _admin) = setup();
    assert_eq!(
        c.try_cancel_upgrade(),
        Err(Ok(Error::NoPendingUpgrade.into()))
    );
}

#[test]
fn rescheduling_resets_the_clock() {
    let (env, c, _admin) = setup();
    let h1 = BytesN::<32>::random(&env);
    c.schedule_upgrade(&h1);

    // Advance partway, then reschedule with a new hash — eta should be from the new `now`.
    env.ledger().set_timestamp(env.ledger().timestamp() + 1000);
    let h2 = BytesN::<32>::random(&env);
    let now2 = env.ledger().timestamp();
    let eta2 = c.schedule_upgrade(&h2);
    assert_eq!(eta2, now2 + governance::DEFAULT_TIMELOCK_SECS);
    let pending = c.pending_upgrade().unwrap();
    assert_eq!(pending.wasm_hash, h2, "new hash replaces old");
    assert_eq!(pending.eta, eta2);
}

// --------------------------------------------------------------------------
// Timelock-delay bounds
// --------------------------------------------------------------------------

#[test]
fn set_timelock_within_bounds_works() {
    let (_env, c, _admin) = setup();
    c.set_timelock(&(72 * 60 * 60));
    assert_eq!(c.timelock(), 72 * 60 * 60);
}

#[test]
fn set_timelock_below_min_fails() {
    let (_env, c, _admin) = setup();
    let r = c.try_set_timelock(&(governance::MIN_TIMELOCK_SECS - 1));
    assert_eq!(r, Err(Ok(Error::TimelockOutOfBounds.into())));
    // Unchanged.
    assert_eq!(c.timelock(), governance::DEFAULT_TIMELOCK_SECS);
}

#[test]
fn set_timelock_above_max_fails() {
    let (_env, c, _admin) = setup();
    let r = c.try_set_timelock(&(governance::MAX_TIMELOCK_SECS + 1));
    assert_eq!(r, Err(Ok(Error::TimelockOutOfBounds.into())));
}

#[test]
fn set_timelock_at_exact_bounds_works() {
    let (_env, c, _admin) = setup();
    c.set_timelock(&governance::MIN_TIMELOCK_SECS);
    assert_eq!(c.timelock(), governance::MIN_TIMELOCK_SECS);
    c.set_timelock(&governance::MAX_TIMELOCK_SECS);
    assert_eq!(c.timelock(), governance::MAX_TIMELOCK_SECS);
}

#[test]
fn changing_timelock_does_not_alter_existing_schedule_eta() {
    let (env, c, _admin) = setup();
    let hash = BytesN::<32>::random(&env);
    let eta = c.schedule_upgrade(&hash);
    // Now shrink the timelock; the already-scheduled upgrade keeps its original eta.
    c.set_timelock(&governance::MIN_TIMELOCK_SECS);
    assert_eq!(
        c.pending_upgrade().unwrap().eta,
        eta,
        "existing schedule's eta is immutable to later timelock changes"
    );
}
