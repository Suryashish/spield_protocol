#![no_std]
//! Test-only upgrade target. After a contract is upgraded to this wasm, its `version()` returns a
//! distinctive marker — so a test can prove `apply_upgrade` actually swapped the running code. It
//! also re-exposes the shared `governance::pending_upgrade` view (reading the SAME governance
//! storage key the pre-upgrade contract wrote), so a test can confirm the schedule was cleared as
//! part of `apply_upgrade` even after the swap. Represents a realistic "v2" that keeps governance.

use soroban_sdk::{contract, contractimpl, Env, String};
use spield_shared::governance;

#[contract]
pub struct UpgradedContract;

#[contractimpl]
impl UpgradedContract {
    /// Distinctive post-upgrade marker.
    pub fn version(env: Env) -> String {
        String::from_str(&env, "UPGRADED")
    }

    /// Re-exposed governance view — reads the same key the old code used, so a post-swap test can
    /// confirm `apply_upgrade` cleared the pending-upgrade schedule.
    pub fn pending_upgrade(env: Env) -> Option<governance::PendingUpgrade> {
        governance::pending_upgrade(&env)
    }
}
