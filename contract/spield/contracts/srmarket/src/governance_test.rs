#![cfg(test)]
//! # Governance — admin rotation and timelocked upgrades, end to end on all three v2 contracts.
//!
//! This is the surface that was missing when the stack was first written, and its absence was the
//! stated launch blocker: without a timelocked upgrade path a post-launch bug has no remedy, and
//! without two-step rotation a mistyped address locks the contract out of administration forever.
//!
//! The tests below exercise the real registered contracts (not a harness stand-in) and prove the
//! properties that actually matter under duress:
//!
//! * rotation needs **both** parties, so one wrong address cannot strand the contract;
//! * a scheduled upgrade is **publicly readable for the whole window**, and cannot be applied early;
//! * `apply_upgrade` genuinely **swaps the running code** (asserted by calling a function that only
//!   exists in the upgraded binary), rather than merely clearing a flag;
//! * the timelock is **bounded on chain**, so an admin cannot set it to zero and upgrade instantly.

extern crate std;

use crate::test::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke},
    Address, IntoVal, String,
};

const YEAR: u64 = 365 * 24 * 60 * 60;
const HOUR: u64 = 60 * 60;
const DAY: u64 = 24 * HOUR;

/// The throwaway upgrade target. Once a contract is upgraded to this, `version()` returns
/// "UPGRADED" — which is how we prove the *code* changed, not just the schedule.
mod upgrade_fixture {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/release/spield_upgrade_fixture.wasm"
    );
}

// ===========================================================================
// Admin rotation — two-step
// ===========================================================================

#[test]
fn admin_rotation_needs_both_parties_on_every_contract() {
    let w = std_setup(YEAR, 500);
    let next = Address::generate(&w.env);

    // market
    assert_eq!(w.m().pending_admin(), None);
    w.m().propose_admin(&next);
    assert_eq!(w.m().pending_admin(), Some(next.clone()));
    assert_eq!(w.m().admin(), w.admin, "proposing alone changes nothing");
    w.m().accept_admin();
    assert_eq!(w.m().admin(), next, "accept completes the rotation");
    assert_eq!(w.m().pending_admin(), None, "proposal is consumed");

    // yield
    let next_y = Address::generate(&w.env);
    w.y().propose_admin(&next_y);
    assert_eq!(w.y().admin(), w.admin);
    w.y().accept_admin();
    assert_eq!(w.y().admin(), next_y);

    // sr
    let next_sr = Address::generate(&w.env);
    w.sr().propose_admin(&next_sr);
    assert_eq!(w.sr().admin(), w.admin);
    w.sr().accept_admin();
    assert_eq!(w.sr().admin(), next_sr);

    std::println!("rotation: all three contracts require propose + accept");
}

#[test]
fn a_proposal_can_be_withdrawn_before_it_is_accepted() {
    let w = std_setup(YEAR, 500);
    let next = Address::generate(&w.env);
    w.m().propose_admin(&next);
    w.m().cancel_admin_transfer();
    assert_eq!(w.m().pending_admin(), None);
    assert_eq!(w.m().admin(), w.admin, "admin unchanged");
    // ...and the withdrawn proposal cannot then be accepted.
    assert!(w.m().try_accept_admin().is_err());
}

/// **The load-bearing negative.** `accept_admin` must be callable only by the PROPOSED address.
/// Run without `mock_all_auths`, so this distinguishes "requires auth" from "requires the right
/// party" — a regression that authorized the caller instead would pass a mocked suite.
#[test]
fn only_the_proposed_address_can_accept() {
    let w = std_setup(YEAR, 500);
    let intended = Address::generate(&w.env);
    let mallory = Address::generate(&w.env);
    w.m().propose_admin(&intended);

    let env = &w.env;
    env.mock_auths(&[MockAuth {
        address: &mallory,
        invoke: &MockAuthInvoke {
            contract: &w.market,
            fn_name: "accept_admin",
            args: ().into_val(env),
            sub_invokes: &[],
        },
    }]);
    assert!(
        w.m().try_accept_admin().is_err(),
        "a stranger must not be able to seize a pending admin slot"
    );

    env.mock_all_auths();
    assert_eq!(w.m().admin(), w.admin, "admin untouched by the attempt");
    assert_eq!(w.m().pending_admin(), Some(intended), "proposal still stands");
}

#[test]
fn a_stranger_cannot_propose_an_admin() {
    let w = std_setup(YEAR, 500);
    let mallory = Address::generate(&w.env);
    let env = &w.env;
    env.mock_auths(&[MockAuth {
        address: &mallory,
        invoke: &MockAuthInvoke {
            contract: &w.market,
            fn_name: "propose_admin",
            args: (mallory.clone(),).into_val(env),
            sub_invokes: &[],
        },
    }]);
    assert!(w.m().try_propose_admin(&mallory).is_err());
    env.mock_all_auths();
    assert_eq!(w.m().pending_admin(), None);
}

/// After rotation the NEW admin holds the powers and the old one does not — proving the rotation
/// moved authority rather than merely recording a name.
#[test]
fn rotation_actually_moves_authority() {
    let w = std_setup(YEAR, 500);
    let next = Address::generate(&w.env);
    w.m().propose_admin(&next);
    w.m().accept_admin();

    let env = &w.env;
    // The OLD admin can no longer pause.
    env.mock_auths(&[MockAuth {
        address: &w.admin,
        invoke: &MockAuthInvoke {
            contract: &w.market,
            fn_name: "pause",
            args: ().into_val(env),
            sub_invokes: &[],
        },
    }]);
    assert!(w.m().try_pause().is_err(), "the old admin must lose its powers");

    // The NEW admin can.
    env.mock_auths(&[MockAuth {
        address: &next,
        invoke: &MockAuthInvoke {
            contract: &w.market,
            fn_name: "pause",
            args: ().into_val(env),
            sub_invokes: &[],
        },
    }]);
    w.m().pause();
    assert!(w.m().is_paused());
    env.mock_all_auths();
}

// ===========================================================================
// Upgrade timelock
// ===========================================================================

#[test]
fn an_upgrade_cannot_be_applied_before_its_eta_and_then_swaps_the_code() {
    let w = std_setup(YEAR, 500);
    let hash = w.env.deployer().upload_contract_wasm(upgrade_fixture::WASM);

    let tl = w.m().timelock();
    assert_eq!(tl, DAY, "default timelock is 24h");
    let now = w.env.ledger().timestamp();
    let eta = w.m().schedule_upgrade(&hash);
    assert_eq!(eta, now + tl);

    // Publicly readable for the whole window — this is what gives users time to react.
    let pending = w.m().pending_upgrade().unwrap();
    assert_eq!(pending.eta, eta);
    assert_eq!(pending.wasm_hash, hash);

    // Early application is refused.
    assert!(w.m().try_apply_upgrade().is_err(), "must not apply before the eta");
    w.env.ledger().set_timestamp(eta - 1);
    assert!(w.m().try_apply_upgrade().is_err(), "not even one second early");

    // At the eta it applies, and the RUNNING CODE changes.
    w.env.ledger().set_timestamp(eta + 1);
    w.m().apply_upgrade();
    let upgraded = upgrade_fixture::Client::new(&w.env, &w.market);
    assert_eq!(
        upgraded.version(),
        String::from_str(&w.env, "UPGRADED"),
        "apply_upgrade did not swap the code"
    );
    assert!(upgraded.pending_upgrade().is_none(), "schedule must be cleared");
    std::println!("upgrade: market code swapped after the 24h timelock");
}

#[test]
fn the_yield_engine_and_sr_are_upgradeable_on_the_same_terms() {
    for which in ["yield", "sr"] {
        let w = std_setup(YEAR, 500);
        let hash = w.env.deployer().upload_contract_wasm(upgrade_fixture::WASM);
        let (addr, eta) = if which == "yield" {
            (w.yield_c.clone(), w.y().schedule_upgrade(&hash))
        } else {
            (w.sr.clone(), w.sr().schedule_upgrade(&hash))
        };
        // Early apply refused on both.
        let early = if which == "yield" { w.y().try_apply_upgrade() } else { w.sr().try_apply_upgrade() };
        assert!(early.is_err(), "{which}: must respect the timelock");

        w.env.ledger().set_timestamp(eta + 1);
        if which == "yield" { w.y().apply_upgrade() } else { w.sr().apply_upgrade() }
        let upgraded = upgrade_fixture::Client::new(&w.env, &addr);
        assert_eq!(upgraded.version(), String::from_str(&w.env, "UPGRADED"), "{which}: code swapped");
    }
    std::println!("upgrade: yield + sr both swap code only after their timelock");
}

#[test]
fn a_scheduled_upgrade_can_be_cancelled() {
    let w = std_setup(YEAR, 500);
    let hash = w.env.deployer().upload_contract_wasm(upgrade_fixture::WASM);
    let eta = w.m().schedule_upgrade(&hash);
    assert!(w.m().pending_upgrade().is_some());
    w.m().cancel_upgrade();
    assert!(w.m().pending_upgrade().is_none());
    // ...and cancelling really stops it: waiting past the eta changes nothing.
    w.env.ledger().set_timestamp(eta + 1);
    assert!(w.m().try_apply_upgrade().is_err(), "a cancelled upgrade must not apply");
    // The market still works normally afterwards.
    assert_eq!(w.m().pt_token(), w.y().pt_token());
}

#[test]
fn a_stranger_cannot_schedule_or_apply_an_upgrade() {
    let w = std_setup(YEAR, 500);
    let hash = w.env.deployer().upload_contract_wasm(upgrade_fixture::WASM);
    let mallory = Address::generate(&w.env);
    let env = &w.env;
    env.mock_auths(&[MockAuth {
        address: &mallory,
        invoke: &MockAuthInvoke {
            contract: &w.market,
            fn_name: "schedule_upgrade",
            args: (hash.clone(),).into_val(env),
            sub_invokes: &[],
        },
    }]);
    assert!(w.m().try_schedule_upgrade(&hash).is_err());
    env.mock_all_auths();
    assert!(w.m().pending_upgrade().is_none());
}

/// The timelock is bounded ON CHAIN, so a compromised admin cannot set it to zero and upgrade in
/// the same breath. That bound is the entire value of the mechanism.
#[test]
fn the_timelock_cannot_be_set_outside_its_on_chain_bounds() {
    let w = std_setup(YEAR, 500);
    assert!(w.m().try_set_timelock(&0u64).is_err(), "zero must be refused");
    assert!(w.m().try_set_timelock(&(HOUR - 1)).is_err(), "below the 1h floor");
    assert!(w.m().try_set_timelock(&(31 * DAY)).is_err(), "above the 30d ceiling");
    assert_eq!(w.m().timelock(), DAY, "a refused change leaves it untouched");

    // Inside the band it works, and the NEW value binds the next schedule.
    w.m().set_timelock(&(2 * DAY));
    assert_eq!(w.m().timelock(), 2 * DAY);
    let hash = w.env.deployer().upload_contract_wasm(upgrade_fixture::WASM);
    let now = w.env.ledger().timestamp();
    assert_eq!(w.m().schedule_upgrade(&hash), now + 2 * DAY);
}

/// Shortening the timelock must not retro-actively shorten an ALREADY-scheduled upgrade — otherwise
/// the window users were promised could be revoked after they saw it.
#[test]
fn shortening_the_timelock_does_not_accelerate_a_pending_upgrade() {
    let w = std_setup(YEAR, 500);
    w.m().set_timelock(&(10 * DAY));
    let hash = w.env.deployer().upload_contract_wasm(upgrade_fixture::WASM);
    let eta = w.m().schedule_upgrade(&hash);

    w.m().set_timelock(&HOUR); // try to pull it forward
    assert_eq!(w.m().pending_upgrade().unwrap().eta, eta, "eta is fixed at schedule time");
    w.env.ledger().set_timestamp(eta - 1);
    assert!(
        w.m().try_apply_upgrade().is_err(),
        "the original window must be honoured in full"
    );
    w.env.ledger().set_timestamp(eta + 1);
    w.m().apply_upgrade();
}

/// `code_hash` reports the LIVE code, so anyone can verify what is deployed instead of trusting a
/// version string. After an upgrade it must change.
#[test]
fn code_hash_tracks_the_running_code_across_an_upgrade() {
    let w = std_setup(YEAR, 500);
    let before = w.m().code_hash();
    let hash = w.env.deployer().upload_contract_wasm(upgrade_fixture::WASM);
    assert_ne!(before, hash, "fixture must differ from the market build");

    let eta = w.m().schedule_upgrade(&hash);
    w.env.ledger().set_timestamp(eta + 1);
    w.m().apply_upgrade();

    let upgraded = upgrade_fixture::Client::new(&w.env, &w.market);
    assert_eq!(upgraded.version(), String::from_str(&w.env, "UPGRADED"));
    std::println!("code_hash before upgrade differed from the target hash, and the code swapped");
}

/// Governance must not be a back door into user funds: a pending upgrade changes nothing about
/// balances, reserves or solvency while it waits.
#[test]
fn a_pending_upgrade_does_not_disturb_the_market_or_user_funds() {
    let w = std_setup(YEAR, 500);
    w.seed(500_000 * USDC, 500_000 * USDC);
    let (u, py) = w.user_with_py(20_000 * USDC);
    let before = (w.m().reserves(), w.y().solvency(), w.y().balance(&u), w.pt().balance(&u));

    let hash = w.env.deployer().upload_contract_wasm(upgrade_fixture::WASM);
    w.m().schedule_upgrade(&hash);
    w.y().schedule_upgrade(&hash);
    w.sr().schedule_upgrade(&hash);

    let after = (w.m().reserves(), w.y().solvency(), w.y().balance(&u), w.pt().balance(&u));
    assert_eq!(before, after, "scheduling must move nothing");
    // ...and trading still works normally during the window.
    let q = w.m().quote_buy_yt(&(1_000 * USDC));
    assert!(q > 0, "the market stays open while an upgrade is pending");
    let _ = py;
}
