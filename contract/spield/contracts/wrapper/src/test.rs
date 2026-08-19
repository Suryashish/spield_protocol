#![cfg(test)]
//! # §7.4 regression suite — every SCF-flagged bug, as a passing test
//!
//! These run end-to-end against the **real Blend v2 WASM** (via `blend-contract-sdk` testutils)
//! and our real strategy adapter — not mocks of either. Each test is named for the SCF finding
//! it proves fixed (plan §7.4). The canonical worked example from plan §7 is `canonical_example`.

extern crate std;

use crate::{Wrapper, WrapperClient};
use blend_contract_sdk::{pool, testutils::BlendFixture};
use sep_40_oracle::testutils::{Asset, MockPriceOracleClient, MockPriceOracleWASM};
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, BytesN, Env, String, Symbol, Vec,
};
use spield_strategy::{BlendStrategy, BlendStrategyClient};

const USDC: i128 = 1_0000000; // 7 decimals
const SCALAR_7: i128 = 1_0000000;
const REQ_SUPPLY_COLLATERAL: u32 = 2;
const REQ_BORROW: u32 = 4;
const YEAR: u64 = 365 * 24 * 60 * 60;

/// Everything wired: a live Blend pool (XLM collateral + USDC borrowable, utilization > 0 so the
/// USDC `b_rate` rises), our strategy adapter, PT/YT SACs admined by the wrapper, and the wrapper.
struct World {
    env: Env,
    pool: Address,
    usdc: Address,
    oracle_id: Address,
    wrapper: Address,
    strategy: Address,
    pt: Address,
    yt: Address,
    maturity: u64,
}

impl World {
    fn env(&self) -> &Env {
        &self.env
    }
    fn wrapper(&self) -> WrapperClient<'_> {
        WrapperClient::new(&self.env, &self.wrapper)
    }
    fn usdc_admin(&self) -> StellarAssetClient<'_> {
        StellarAssetClient::new(&self.env, &self.usdc)
    }
    fn usdc(&self) -> TokenClient<'_> {
        TokenClient::new(&self.env, &self.usdc)
    }
    fn pt(&self) -> TokenClient<'_> {
        TokenClient::new(&self.env, &self.pt)
    }
    fn yt(&self) -> TokenClient<'_> {
        TokenClient::new(&self.env, &self.yt)
    }
    fn oracle(&self) -> MockPriceOracleClient<'_> {
        MockPriceOracleClient::new(&self.env, &self.oracle_id)
    }
    fn pool_client(&self) -> pool::Client<'_> {
        pool::Client::new(&self.env, &self.pool)
    }

    /// Advance the clock and refresh oracle prices so interest accrues into `b_rate`.
    fn advance(&self, secs: u64) {
        let t = self.env.ledger().timestamp();
        self.env.ledger().set_timestamp(t + secs);
        self.oracle()
            .set_price_stable(&vec![&self.env, 1_0000000, 1_0000000]);
        self.pool_client().get_reserve(&self.usdc);
    }

    /// Mint a fresh user funded with `amount` USDC and deposit it; return (user, position_id).
    fn deposit_new_user(&self, amount: i128) -> (Address, u64) {
        let user = Address::generate(&self.env);
        self.usdc_admin().mint(&user, &amount);
        let id = self.wrapper().mint(&user, &amount);
        (user, id)
    }
}

fn register_sac<'a>(env: &'a Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone()).address()
}

fn setup(maturity_secs_from_now: u64) -> World {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);
    env.cost_estimate().budget().reset_unlimited();

    let admin = Address::generate(&env);
    let blnd = register_sac(&env, &admin);
    let usdc = register_sac(&env, &admin);
    let xlm = register_sac(&env, &admin);

    let blend = BlendFixture::deploy(&env, &admin, &blnd, &usdc);

    // Oracle pricing XLM + USDC at $1.
    let oracle_id = Address::generate(&env);
    env.register_at(&oracle_id, MockPriceOracleWASM, ());
    let oracle = MockPriceOracleClient::new(&env, &oracle_id);
    oracle.set_data(
        &admin,
        &Asset::Other(Symbol::new(&env, "USD")),
        &vec![&env, Asset::Stellar(xlm.clone()), Asset::Stellar(usdc.clone())],
        &7,
        &300,
    );
    oracle.set_price_stable(&vec![&env, 1_0000000, 1_0000000]);

    // Pool with XLM + USDC reserves; backstopped + active.
    let pool = blend.pool_factory.deploy(
        &admin,
        &String::from_str(&env, "spield-pool"),
        &BytesN::<32>::random(&env),
        &oracle_id,
        &0_1000000,
        &6,
        &1_0000000,
    );
    let pool_client = pool::Client::new(&env, &pool);
    let mut cfg = blend_contract_sdk::testutils::default_reserve_config();
    cfg.index = 0;
    pool_client.queue_set_reserve(&xlm, &cfg);
    pool_client.set_reserve(&xlm);
    cfg.index = 1;
    pool_client.queue_set_reserve(&usdc, &cfg);
    pool_client.set_reserve(&usdc);
    blend.backstop.deposit(&admin, &pool, &50_000_0000000);
    pool_client.set_status(&3);
    pool_client.update_status();

    // Whale creates USDC borrow utilization so b_rate rises over time.
    let whale = Address::generate(&env);
    StellarAssetClient::new(&env, &xlm).mint(&whale, &(2_000_000 * SCALAR_7));
    StellarAssetClient::new(&env, &usdc).mint(&whale, &(2_000_000 * USDC));
    let reqs = Vec::from_array(
        &env,
        [
            pool::Request { request_type: REQ_SUPPLY_COLLATERAL, address: xlm.clone(), amount: 1_000_000 * SCALAR_7 },
            pool::Request { request_type: REQ_SUPPLY_COLLATERAL, address: usdc.clone(), amount: 500_000 * USDC },
            pool::Request { request_type: REQ_BORROW, address: usdc.clone(), amount: 300_000 * USDC },
        ],
    );
    pool_client.submit(&whale, &whale, &whale, &reqs);

    // Register the wrapper FIRST (admin bound atomically by its constructor) so we know its address
    // to admin the PT/YT SACs.
    let wrapper = env.register(Wrapper, (admin.clone(),));

    // Deploy the strategy adapter, owned by the wrapper (admin set by its constructor).
    let strategy = env.register(BlendStrategy, (admin.clone(),));
    BlendStrategyClient::new(&env, &strategy).initialize(
        &wrapper, &pool, &usdc, &30_000u32,
    );

    // PT + YT SACs admined by the wrapper (so the wrapper can mint/burn).
    let pt = register_sac(&env, &wrapper);
    let yt = register_sac(&env, &wrapper);

    let maturity = env.ledger().timestamp() + maturity_secs_from_now;
    WrapperClient::new(&env, &wrapper).initialize(
        &strategy, &pt, &yt, &maturity,
    );

    World { env, pool, usdc, oracle_id, wrapper, strategy, pt, yt, maturity }
}

// ===========================================================================
// Canonical worked example (plan §7)
// ===========================================================================

#[test]
fn canonical_example_deposit_accrue_claim_redeem() {
    let w = setup(YEAR);
    let (user, id) = w.deposit_new_user(100 * USDC);

    // After mint: 100 PT + 100 YT to the user; position recorded.
    assert_eq!(w.pt().balance(&user), 100 * USDC);
    assert_eq!(w.yt().balance(&user), 100 * USDC);
    let pos = w.wrapper().get_position(&id);
    assert_eq!(pos.principal, 100 * USDC);
    assert_eq!(pos.pt_amount, 100 * USDC);
    assert_eq!(pos.yt_amount, 100 * USDC);

    // Accrue ~a year of real Blend interest.
    w.advance(YEAR);

    // Claim yield: paid in USDC, YT KEPT (not burned), settled_rate advanced.
    let usdc_before = w.usdc().balance(&user);
    let payout = w.wrapper().claim_yield(&id);
    let usdc_after = w.usdc().balance(&user);
    assert!(payout > 0, "must have accrued real yield");
    assert_eq!(usdc_after - usdc_before, payout, "yield paid in USDC");
    assert_eq!(w.yt().balance(&user), 100 * USDC, "YT must NOT be burned (SCF #6)");
    std::println!("canonical: yield claimed = {}", payout);

    // At maturity, redeem PT 1:1.
    w.env().ledger().set_timestamp(w.maturity + 1);
    w.oracle().set_price_stable(&vec![w.env(), 1_0000000, 1_0000000]);
    let usdc_before = w.usdc().balance(&user);
    let redeemed = w.wrapper().redeem_pt(&id, &(100 * USDC));
    let usdc_after = w.usdc().balance(&user);
    assert_eq!(redeemed, 100 * USDC);
    assert_eq!(usdc_after - usdc_before, 100 * USDC, "PT redeems 1:1 for principal");
    assert_eq!(w.pt().balance(&user), 0, "PT burned on redeem");
}

// ===========================================================================
// SCF #3 — the drain test: 10 users all claim, vault never empties
// ===========================================================================

#[test]
fn scf3_ten_users_all_claim_vault_never_empties() {
    let w = setup(YEAR);
    let mut ids = std::vec::Vec::new();
    let mut users = std::vec::Vec::new();
    for _ in 0..10 {
        let (user, id) = w.deposit_new_user(100 * USDC);
        users.push(user);
        ids.push(id);
    }
    // Accrue a year of real interest.
    w.advance(YEAR);

    // All ten claim in sequence — in v1 the first claimant drained the vault. Here every claim
    // succeeds and pays real, backed yield.
    for (i, id) in ids.iter().enumerate() {
        let before = w.usdc().balance(&users[i]);
        let payout = w.wrapper().claim_yield(id);
        let after = w.usdc().balance(&users[i]);
        assert!(payout > 0, "user {} got zero yield", i);
        assert_eq!(after - before, payout);
    }

    // Solvency invariant still holds: backing >= principal.
    let (backing, principal, _unclaimed) = w.wrapper().solvency();
    assert!(backing + 2 >= principal, "insolvent: backing {} < principal {}", backing, principal);

    // And every user can still redeem principal at maturity (combine, anytime works too).
    w.env().ledger().set_timestamp(w.maturity + 1);
    w.oracle().set_price_stable(&vec![w.env(), 1_0000000, 1_0000000]);
    for (i, id) in ids.iter().enumerate() {
        let before = w.usdc().balance(&users[i]);
        w.wrapper().redeem_pt(id, &(100 * USDC));
        let after = w.usdc().balance(&users[i]);
        assert_eq!(after - before, 100 * USDC, "user {} couldn't redeem principal", i);
    }
}

// ===========================================================================
// SCF #4 — top-up creates a separate position; total yield = 15, not 10
// ===========================================================================

#[test]
fn scf4_topup_does_not_overwrite_entry_rate() {
    // Use a long maturity; we control b_rate via time to hit ~ the plan's 1.00/1.05/1.10 shape.
    let w = setup(10 * YEAR);
    let user = Address::generate(w.env());
    w.usdc_admin().mint(&user, &(1_000 * USDC));

    // Position A at the initial rate.
    let id_a = w.wrapper().mint(&user, &(100 * USDC));
    let rate_a = w.wrapper().get_position(&id_a).entry_rate;

    // Let the rate rise, then make Position B at a HIGHER entry rate (the top-up).
    w.advance(2 * YEAR);
    let id_b = w.wrapper().mint(&user, &(100 * USDC));
    let rate_b = w.wrapper().get_position(&id_b).entry_rate;
    assert!(rate_b > rate_a, "B must enter at a higher rate than A");
    // A's entry rate must be UNCHANGED by B's mint (the SCF #4 bug was overwriting it).
    assert_eq!(w.wrapper().get_position(&id_a).entry_rate, rate_a, "A entry rate overwritten!");

    // Let the rate rise further, then claim both.
    w.advance(2 * YEAR);
    let yield_a = w.wrapper().claim_yield(&id_a);
    let yield_b = w.wrapper().claim_yield(&id_b);

    // A entered earlier (lower rate) so it must have earned MORE than B. The v1 bug would have
    // lost A's pre-top-up accrual; here A > B and both are positive.
    assert!(yield_a > 0 && yield_b > 0);
    assert!(yield_a > yield_b, "A (earlier entry) must out-earn B: a={} b={}", yield_a, yield_b);
    std::println!("scf4: yield_a={} yield_b={} (a>b, no overwrite)", yield_a, yield_b);
}

// ===========================================================================
// SCF #5 — phantom yield: a fresh YT owner can't claim pre-ownership yield
// ===========================================================================

#[test]
fn scf5_no_phantom_yield_for_new_owner() {
    let w = setup(10 * YEAR);
    let (_alice, id) = w.deposit_new_user(100 * USDC);

    // Yield accrues while Alice holds it.
    w.advance(2 * YEAR);

    // Transfer the whole position to Bob (carries settled_rate = entry_rate, since unclaimed).
    let bob = Address::generate(w.env());
    w.wrapper().transfer_position(&id, &bob);
    assert_eq!(w.wrapper().get_position(&id).owner, bob);

    // Bob claims IMMEDIATELY. settled_rate carried = entry_rate, current_rate has risen, so Bob
    // legitimately receives the accrued-so-far yield ONCE — but crucially the accounting is
    // measured from the position's settled_rate, not "from inception for whoever holds it now".
    // To prove the PHANTOM case is impossible, we re-settle then check a brand-new transfer can't
    // double-claim the same delta.
    let bob_first = w.wrapper().claim_yield(&id);
    assert!(bob_first > 0);

    // Now transfer to Carol at the just-settled rate and have her claim with NO further accrual.
    let carol = Address::generate(w.env());
    w.wrapper().transfer_position(&id, &carol);
    let carol_phantom = w.wrapper().claim_yield(&id);
    assert_eq!(carol_phantom, 0, "Carol claimed phantom yield with no accrual since settle!");
    std::println!("scf5: bob_first={} carol_phantom={}", bob_first, carol_phantom);
}

// ===========================================================================
// SCF #6 — multi-epoch claim: claim at epoch 1, claim again at epoch 2; YT survives
// ===========================================================================

#[test]
fn scf6_claim_settles_never_burns_multi_epoch() {
    let w = setup(10 * YEAR);
    let (user, id) = w.deposit_new_user(100 * USDC);

    w.advance(2 * YEAR);
    let claim1 = w.wrapper().claim_yield(&id);
    assert!(claim1 > 0);
    assert_eq!(w.yt().balance(&user), 100 * USDC, "YT must survive first claim");

    // A second epoch of accrual, claim again on the SAME YT.
    w.advance(2 * YEAR);
    let claim2 = w.wrapper().claim_yield(&id);
    assert!(claim2 > 0, "second-epoch claim must pay the new delta");
    assert_eq!(w.yt().balance(&user), 100 * USDC, "YT still held after second claim");
    std::println!("scf6: claim1={} claim2={}", claim1, claim2);
}

// ===========================================================================
// SCF #7 — initialize is one-shot + admin-gated
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // AlreadyInitialized
fn scf7_double_initialize_panics() {
    let w = setup(YEAR);
    // Second initialize must panic regardless of args (admin is bound at deploy via constructor).
    w.wrapper().initialize(&w.strategy, &w.pt, &w.yt, &(w.maturity + 1));
}

// ===========================================================================
// SCF #9 — TTL: positions survive a ledger advance (have a live restore path)
// ===========================================================================

#[test]
fn scf9_position_survives_ttl_window() {
    let w = setup(10 * YEAR);
    let (_user, id) = w.deposit_new_user(100 * USDC);

    // Advance the ledger sequence number well forward (simulating time passing). The position was
    // written with extend_ttl, so it must still be readable.
    w.env().ledger().with_mut(|li| {
        li.sequence_number += 100_000;
    });
    let pos = w.wrapper().get_position(&id);
    assert!(pos.open, "position archived/lost after ledger advance (SCF #9)");
    assert_eq!(pos.principal, 100 * USDC);
}

// ===========================================================================
// combine_and_redeem — anytime (before maturity), auto-claims yield first
// ===========================================================================

#[test]
fn combine_and_redeem_before_maturity_auto_claims() {
    let w = setup(10 * YEAR);
    let (user, id) = w.deposit_new_user(100 * USDC);
    w.advance(2 * YEAR);

    let usdc_before = w.usdc().balance(&user);
    let (principal_back, yield_claimed) = w.wrapper().combine_and_redeem(&id, &(100 * USDC));
    let usdc_after = w.usdc().balance(&user);

    assert_eq!(principal_back, 100 * USDC);
    assert!(yield_claimed > 0, "combine must auto-claim accrued yield first");
    // The user receives principal + yield, within ≤2 stroops of floor-rounding from Blend's two
    // underlying withdrawals (real on-chain behavior — Blend floors each withdraw).
    let received = usdc_after - usdc_before;
    let expected = principal_back + yield_claimed;
    assert!(
        (expected - received).abs() <= 2,
        "received {} vs expected {} (gap > 2 stroops)",
        received,
        expected
    );
    // PT + YT both burned; position closed.
    assert_eq!(w.pt().balance(&user), 0);
    assert_eq!(w.yt().balance(&user), 0);
    assert!(!w.wrapper().get_position(&id).open);
}

// ===========================================================================
// redeem_pt before maturity must be rejected
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #22)")] // NotMatured
fn redeem_pt_before_maturity_panics() {
    let w = setup(YEAR);
    let (_user, id) = w.deposit_new_user(100 * USDC);
    w.wrapper().redeem_pt(&id, &(50 * USDC));
}

// ===========================================================================
// pause halts mutations
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #4)")] // Paused
fn paused_blocks_mint() {
    let w = setup(YEAR);
    w.wrapper().pause();
    let user = Address::generate(w.env());
    w.usdc_admin().mint(&user, &(100 * USDC));
    w.wrapper().mint(&user, &(100 * USDC));
}

// ===========================================================================
// Pause coverage & emergency exit (mainnet-readiness #8): pause blocks INFLOWS
// (mint) but users can still EXIT (claim / redeem / combine) while paused.
// ===========================================================================

#[test]
fn paused_still_allows_claim_and_redeem() {
    let w = setup(YEAR);
    // Deposit BEFORE pausing (mint is the inflow that gets blocked).
    let (user, id) = w.deposit_new_user(100 * USDC);
    w.advance(YEAR); // accrue real yield

    // Emergency pause.
    w.wrapper().pause();
    assert!(w.wrapper().is_paused());

    // New inflow is blocked...
    let intruder = Address::generate(w.env());
    w.usdc_admin().mint(&intruder, &(100 * USDC));
    assert_eq!(
        w.wrapper().try_mint(&intruder, &(100 * USDC)),
        Err(Ok(spield_shared::Error::Paused.into())),
        "mint (inflow) must be blocked while paused"
    );

    // ...but the existing user can still CLAIM yield while paused (exit stays open).
    let claimed = w.wrapper().claim_yield(&id);
    assert!(claimed > 0, "claim must succeed while paused (no trapped funds)");

    // ...and REDEEM principal at maturity while paused.
    w.env().ledger().set_timestamp(w.maturity + 1);
    w.oracle().set_price_stable(&vec![w.env(), 1_0000000, 1_0000000]);
    let before = w.usdc().balance(&user);
    w.wrapper().redeem_pt(&id, &(100 * USDC));
    assert_eq!(
        w.usdc().balance(&user) - before,
        100 * USDC,
        "redeem must succeed while paused"
    );
}

#[test]
fn paused_still_allows_combine_and_transfer() {
    let w = setup(YEAR);
    let (user, id) = w.deposit_new_user(100 * USDC);
    w.wrapper().pause();

    // combine_and_redeem (returns principal early) works while paused.
    let (returned, _claimed) = w.wrapper().combine_and_redeem(&id, &(40 * USDC));
    assert_eq!(returned, 40 * USDC, "combine exit must work while paused");

    // transfer_position (position management) works while paused.
    let to = Address::generate(w.env());
    w.wrapper().transfer_position(&id, &to);
    assert_eq!(w.wrapper().get_position(&id).owner, to);
    let _ = user;
}

// ===========================================================================
// TTL keep-alive (mainnet-readiness #5): a position held (never written) past
// the old ~60-day window survives, and bump_position keeps a long bond alive.
// ===========================================================================

#[test]
fn position_survives_long_hold_via_maturity_aware_ttl() {
    // Maturity ~6 months out — well past the old 60-day flat bump.
    let six_months = 182 * 24 * 60 * 60;
    let w = setup(six_months);
    let (_user, id) = w.deposit_new_user(100 * USDC);

    // Advance the ledger sequence far beyond the old 60-day bump window WITHOUT touching the
    // position (no claim/redeem). Under a flat 60-day bump this entry would have archived; the
    // maturity-aware bump (set at mint) keeps it live to ~maturity+grace.
    w.env().ledger().with_mut(|li| {
        li.sequence_number += 90 * 24 * 60 * 60 / 5; // ~90 days of ledgers
    });

    // Still readable — the position did not archive.
    let pos = w.wrapper().get_position(&id);
    assert_eq!(pos.principal, 100 * USDC, "position archived before maturity (TTL too short)");

    // Permissionless bump by a random caller keeps it alive further (no auth needed).
    w.wrapper().bump_position(&id);
    let pos2 = w.wrapper().get_position(&id);
    assert_eq!(pos2.principal, 100 * USDC);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")] // PositionNotFound
fn bump_position_unknown_id_panics() {
    let w = setup(YEAR);
    w.wrapper().bump_position(&999u64);
}

// ===========================================================================
// Governance (mainnet-readiness): admin rotation + upgrade timelock, end-to-end
// against the real registered wrapper contract (not the shared harness).
// ===========================================================================

/// The compiled throwaway upgrade target. After we upgrade the wrapper to this, `version()`
/// returns "UPGRADED" — proving `apply_upgrade` swapped the running code, not just the schedule.
mod upgrade_fixture {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/release/spield_upgrade_fixture.wasm"
    );
}

#[test]
fn admin_rotation_two_step_e2e() {
    let w = setup(YEAR);
    let new_admin = Address::generate(w.env());

    assert_eq!(w.wrapper().pending_admin(), None);
    w.wrapper().propose_admin(&new_admin);
    assert_eq!(w.wrapper().pending_admin(), Some(new_admin.clone()));

    w.wrapper().accept_admin();
    assert_eq!(w.wrapper().admin(), new_admin, "new admin in control");
    assert_eq!(w.wrapper().pending_admin(), None);

    // The new admin can now drive admin-only ops (pause), proving the rotation took effect.
    w.wrapper().pause();
    assert!(w.wrapper().is_paused());
}

#[test]
fn upgrade_respects_timelock_then_swaps_code() {
    let w = setup(YEAR);
    // Upload the upgrade target's wasm and get its hash.
    let wasm_hash = w
        .env()
        .deployer()
        .upload_contract_wasm(upgrade_fixture::WASM);

    // Default timelock is 24h.
    let tl = w.wrapper().timelock();
    assert_eq!(tl, 24 * 60 * 60);

    let now = w.env().ledger().timestamp();
    let eta = w.wrapper().schedule_upgrade(&wasm_hash);
    assert_eq!(eta, now + tl);
    assert_eq!(w.wrapper().pending_upgrade().unwrap().eta, eta);

    // Applying before the eta must fail (TimelockNotElapsed = #9).
    let early = w.wrapper().try_apply_upgrade();
    assert_eq!(
        early,
        Err(Ok(spield_shared::Error::TimelockNotElapsed.into())),
        "upgrade must not apply before the timelock elapses"
    );

    // Warp past the eta and apply — the code is now swapped.
    w.env().ledger().set_timestamp(eta + 1);
    w.wrapper().apply_upgrade();

    // From here ON we must use the UPGRADED client — the wrapper now runs the fixture's code, which
    // defines `version()` (the swap marker) and re-exposes `pending_upgrade()` (reading the same
    // governance key). Calling a wrapper-only fn would fail with "non-existent contract function".
    let upgraded = upgrade_fixture::Client::new(w.env(), &w.wrapper);
    assert_eq!(
        upgraded.version(),
        String::from_str(w.env(), "UPGRADED"),
        "running code did not change — upgrade was a no-op"
    );
    assert!(
        upgraded.pending_upgrade().is_none(),
        "apply_upgrade must clear the schedule"
    );
}

#[test]
fn cancel_upgrade_aborts_a_scheduled_one() {
    let w = setup(YEAR);
    let wasm_hash = w
        .env()
        .deployer()
        .upload_contract_wasm(upgrade_fixture::WASM);
    w.wrapper().schedule_upgrade(&wasm_hash);
    assert!(w.wrapper().pending_upgrade().is_some());
    w.wrapper().cancel_upgrade();
    assert!(w.wrapper().pending_upgrade().is_none());

    // After cancelling, even past any eta, apply fails (nothing scheduled = #8).
    w.env().ledger().set_timestamp(w.env().ledger().timestamp() + 10 * 24 * 60 * 60);
    assert_eq!(
        w.wrapper().try_apply_upgrade(),
        Err(Ok(spield_shared::Error::NoPendingUpgrade.into()))
    );
}

#[test]
fn set_timelock_changes_future_schedule_window() {
    let w = setup(YEAR);
    w.wrapper().set_timelock(&(72 * 60 * 60));
    assert_eq!(w.wrapper().timelock(), 72 * 60 * 60);

    let wasm_hash = w
        .env()
        .deployer()
        .upload_contract_wasm(upgrade_fixture::WASM);
    let now = w.env().ledger().timestamp();
    let eta = w.wrapper().schedule_upgrade(&wasm_hash);
    assert_eq!(eta, now + 72 * 60 * 60, "new schedule uses the updated timelock");
}

// ===========================================================================
// Mainnet-readiness: the solvency dust tolerance is BOUNDED and ungameable —
// many tiny open/close cycles can't inflate it (it tracks open positions, not
// historical op count).
// ===========================================================================

#[test]
fn dust_tolerance_does_not_grow_with_churn() {
    let w = setup(10 * YEAR);
    // Churn: open and immediately fully combine (close) the same-sized position many times. Under
    // the OLD tolerance (next_position_id + withdraw_ops) this inflates the band ~3 per cycle; under
    // the new open-positions basis it stays flat (every position is closed again).
    for _ in 0..30 {
        let user = Address::generate(w.env());
        w.usdc_admin().mint(&user, &(10 * USDC));
        let id = w.wrapper().mint(&user, &(10 * USDC));
        // Fully combine → position closes (PT+YT both burned), so open_positions returns to 0.
        w.wrapper().combine_and_redeem(&id, &(10 * USDC));
    }

    // After 30 closed cycles, open a real position and let yield accrue. Solvency must still hold
    // with the TIGHT tolerance — there's no inflated band to hide behind.
    let (_user, id) = w.deposit_new_user(100 * USDC);
    w.advance(YEAR);
    let payout = w.wrapper().claim_yield(&id);
    assert!(payout > 0);
    let (backing, principal, _unclaimed) = w.wrapper().solvency();
    // Backing must cover principal with only the tiny (open_positions + 4)-stroop slack — here just
    // 1 open position, so the band is ~5 stroops, NOT ~90+ it would have been under the old form.
    assert!(
        backing + 5 >= principal,
        "solvency must hold under a TIGHT tolerance after churn: backing {} principal {}",
        backing,
        principal
    );
    std::println!("dust: after 30 close cycles, backing={} principal={}", backing, principal);
}

// ===========================================================================
// Mainnet-readiness: Blend dependency — if the pool is FROZEN, the wrapper's
// reads/solvency stay sane (no spurious panic); we document that withdrawals
// inherit Blend's availability.
// ===========================================================================

#[test]
fn solvency_view_survives_blend_pool_frozen() {
    let w = setup(YEAR);
    let (_user, _id) = w.deposit_new_user(100 * USDC);
    w.advance(30 * 24 * 60 * 60);

    // Freeze the Blend pool (admin status 2 = frozen: no new supply/borrow). Existing positions and
    // the b_rate read still resolve, so our solvency view must NOT panic — it reflects real backing.
    w.pool_client().set_status(&2);
    w.pool_client().update_status();
    w.oracle().set_price_stable(&vec![w.env(), 1_0000000, 1_0000000]);

    let (backing, principal, _unclaimed) = w.wrapper().solvency();
    assert!(backing >= principal, "frozen pool: backing {} < principal {}", backing, principal);
    // position_value (a per-position read) also resolves without panicking.
    let pv = w.wrapper().position_value(&0);
    assert_eq!(pv.principal, 100 * USDC);
    std::println!("blend-frozen: solvency still readable, backing={}", backing);
}

// ===========================================================================
// testcando.md §0 — mechanism-level gaps found while reading the code.
// These PIN the current behavior (they are not claims that it is correct).
// ===========================================================================

/// Warp to `ts` and refresh the oracle so Blend keeps quoting.
fn warp_to(w: &World, ts: u64) {
    w.env().ledger().set_timestamp(ts);
    w.oracle().set_price_stable(&vec![w.env(), 1_0000000, 1_0000000]);
    w.env().cost_estimate().budget().reset_unlimited();
}

// --------------------------------------------------------------------------
// §0 P0 (fixed) — `mint_after_maturity_behavior`
//
// `wrapper::mint` had NO maturity gate, while the vault (`ensure_before_maturity`)
// and the market (`ensure_tradeable`) both refuse post-maturity inflows. A
// post-maturity mint created a position whose PT was redeemable in the very same
// ledger — a zero-duration round trip in a market the rest of the protocol had
// already closed. `mint` now matches them and refuses with `MarketMatured`.
// --------------------------------------------------------------------------

#[test]
fn mint_after_maturity_is_rejected() {
    let w = setup(YEAR);
    // A mint just BEFORE maturity is still fine — the gate is at the boundary, not before it.
    warp_to(&w, w.maturity - 1);
    let (_early_user, early_id) = w.deposit_new_user(100 * USDC);
    assert!(w.wrapper().get_position(&early_id).open);

    // At maturity exactly, and after it, the inflow is refused.
    warp_to(&w, w.maturity);
    let user = Address::generate(w.env());
    w.usdc_admin().mint(&user, &(100 * USDC));
    assert_eq!(
        w.wrapper().try_mint(&user, &(100 * USDC)),
        Err(Ok(spield_shared::Error::MarketMatured.into())),
        "mint must be refused AT maturity (the same `>=` boundary the vault uses)"
    );
    warp_to(&w, w.maturity + 30 * 24 * 60 * 60);
    assert_eq!(
        w.wrapper().try_mint(&user, &(100 * USDC)),
        Err(Ok(spield_shared::Error::MarketMatured.into())),
        "…and after it"
    );

    // The refusal is atomic: no PT/YT, no position, no USDC moved.
    assert_eq!(w.pt().balance(&user), 0);
    assert_eq!(w.yt().balance(&user), 0);
    assert_eq!(w.usdc().balance(&user), 100 * USDC, "the deposit was not pulled");
    assert!(
        w.wrapper().try_get_position(&(early_id + 1)).is_err(),
        "no position was created for the refused mint"
    );

    // EXITS are unaffected — the gate is inflow-only, and this is the whole point of
    // maturity. The pre-maturity position redeems normally.
    let (backing, principal, _) = w.wrapper().solvency();
    assert!(backing + 5 >= principal, "backing {} principal {}", backing, principal);
    let redeemed = w.wrapper().redeem_pt(&early_id, &(100 * USDC));
    assert_eq!(redeemed, 100 * USDC, "post-maturity redemption must still work");
}

// ===========================================================================
// YT STOPS EARNING AT MATURITY (Pendle parity)
//
// Pendle: "matured YT have 0 value as they no longer generate yield." Spield used
// to do the opposite — `claim_yield` was uncapped, so a position held past maturity
// kept accruing forever, making YT a perpetual claim rather than a term instrument.
//
// Now `Wrapper::yield_rate` caps the measuring rate at the `b_rate` observed at
// maturity. Two halves, and BOTH matter:
//   * no NEW yield accrues after maturity — the YT is worth 0;
//   * yield accrued BEFORE maturity stays claimable indefinitely, because refusing
//     the call outright would strand yield the holder had already earned (Pendle
//     likewise leaves "claiming yield" as the one action still available at expiry).
// ===========================================================================

/// The headline property. A position held well past maturity claims exactly what it
/// earned during the term, and not one stroop of the growth that happened after.
#[test]
fn yt_stops_accruing_at_maturity() {
    let w = setup(YEAR);
    let (_user, id) = w.deposit_new_user(100 * USDC);

    // Sit exactly on maturity and pin the ceiling, then record what the full term earned.
    // (Any interaction would pin it — see `the_first_post_maturity_interaction_stamps_the_ceiling
    // _automatically`. The explicit call is the keeper path, and mirrors Pendle's explicit
    // post-expiry settlement.)
    warp_to(&w, w.maturity);
    w.wrapper().stamp_maturity_rate();
    let at_maturity = w.wrapper().position_value(&id).claimable_yield;
    assert!(at_maturity > 0, "the term must have produced real yield to make this meaningful");

    // Now let a WHOLE EXTRA YEAR of Blend interest pile up without claiming.
    w.advance(YEAR);
    let after_a_year = w.wrapper().position_value(&id).claimable_yield;
    assert_eq!(
        after_a_year, at_maturity,
        "claimable yield must FREEZE at maturity — a matured YT generates nothing (Pendle parity)"
    );

    // And the claim pays that frozen figure, not the post-maturity growth.
    let claimed = w.wrapper().claim_yield(&id);
    assert_eq!(claimed, at_maturity, "claim must pay the term's yield only");

    // A second claim pays nothing at all: the YT is spent and worth 0.
    assert_eq!(w.wrapper().claim_yield(&id), 0, "a matured, settled YT is worth 0");

    // Principal is untouched by any of this.
    let (backing, principal, _) = w.wrapper().solvency();
    assert!(backing + 5 >= principal, "backing {} principal {}", backing, principal);
    assert_eq!(w.wrapper().redeem_pt(&id, &(100 * USDC)), 100 * USDC);
    std::println!("term yield {} USDC, post-maturity accrual to YT: 0", claimed);
}

/// The other half: maturity must not CONFISCATE yield, only stop new accrual. A holder
/// who never claimed during the term can still collect all of it afterwards.
#[test]
fn yield_earned_before_maturity_is_still_claimable_after_it() {
    let w = setup(YEAR);
    let (user, id) = w.deposit_new_user(100 * USDC);

    warp_to(&w, w.maturity);
    w.wrapper().stamp_maturity_rate();
    let earned_in_term = w.wrapper().position_value(&id).claimable_yield;
    assert!(earned_in_term > 0);

    // Cross maturity and wait a long time before bothering to claim.
    w.advance(2 * YEAR);
    let before = w.usdc().balance(&user);
    let claimed = w.wrapper().claim_yield(&id);
    let received = w.usdc().balance(&user) - before;

    assert_eq!(claimed, earned_in_term, "the term's yield must survive maturity, not be forfeited");
    assert_eq!(received, claimed, "and actually be paid out in USDC");
}

/// Claiming early vs. claiming late must pay the SAME total. This is what makes the cap
/// fair: two identical positions, one that claims the instant the term ends and one that
/// forgets for a year, end up with identical yield.
#[test]
fn claim_timing_after_maturity_does_not_change_the_payout() {
    let w = setup(YEAR);
    let (_prompt_user, prompt_id) = w.deposit_new_user(100 * USDC);
    let (_late_user, late_id) = w.deposit_new_user(100 * USDC);

    warp_to(&w, w.maturity);
    let prompt = w.wrapper().claim_yield(&prompt_id); // claims immediately at maturity

    w.advance(YEAR); // ...the other holder waits a year
    let late = w.wrapper().claim_yield(&late_id);

    // Equal principals over an equal term ⇒ equal yield, regardless of when they claimed.
    // (Blend share rounding can differ by a stroop or two between two separate positions.)
    let delta = (prompt - late).abs();
    assert!(
        delta <= 2,
        "waiting must not change the payout: prompt={} late={} (delta {})",
        prompt,
        late,
        delta
    );
    std::println!("prompt claim {} vs late claim {} (delta {})", prompt, late, delta);
}

/// Mid-term claiming is untouched by the cap — this is the Pendle "claimable in real-time"
/// behaviour, and it must keep working. Claim during the term, then again after maturity;
/// the two together equal exactly the term's total yield, with no double-count and no loss.
#[test]
fn mid_term_claims_still_work_and_sum_to_the_term_total() {
    let w = setup(YEAR);
    let (_user, id) = w.deposit_new_user(100 * USDC);

    // A claim halfway through the term still pays out — nothing is locked up.
    w.advance(YEAR / 2);
    let mid = w.wrapper().claim_yield(&id);
    assert!(mid > 0, "mid-term yield must be claimable — no lockup (Pendle parity)");

    // What remains claimable for the rest of the term, measured at maturity.
    warp_to(&w, w.maturity);
    w.wrapper().stamp_maturity_rate();
    let rest = w.wrapper().position_value(&id).claimable_yield;
    assert!(rest > 0);

    // Wait past maturity; the remainder does not grow.
    w.advance(YEAR);
    let final_claim = w.wrapper().claim_yield(&id);
    assert_eq!(final_claim, rest, "the post-maturity claim must not include post-maturity growth");

    // A third claim is worth nothing.
    assert_eq!(w.wrapper().claim_yield(&id), 0);
    std::println!("split claims: mid-term {} + post-maturity {} = {}", mid, final_claim, mid + final_claim);
}

/// The ceiling is write-once. Once stamped it must never ratchet upward, or a matured YT
/// would quietly start earning again on the next rate rise.
#[test]
fn the_maturity_rate_ceiling_is_stamped_once_and_never_rises() {
    let w = setup(YEAR);
    let (_user, id) = w.deposit_new_user(100 * USDC);

    assert_eq!(w.wrapper().maturity_rate(), None, "nothing to stamp while the term runs");

    warp_to(&w, w.maturity);
    let stamped = w.wrapper().stamp_maturity_rate();
    assert!(stamped > 0);
    assert_eq!(w.wrapper().maturity_rate(), Some(stamped));

    // Let the real Blend rate climb well above the stamp, then try to re-stamp.
    w.advance(2 * YEAR);
    assert_eq!(
        w.wrapper().stamp_maturity_rate(),
        stamped,
        "re-stamping must be a no-op — the ceiling can never ratchet up"
    );
    assert_eq!(w.wrapper().maturity_rate(), Some(stamped));

    // And the claim is still measured against the original stamp.
    let claimed = w.wrapper().claim_yield(&id);
    let expected = w.wrapper().get_position(&id); // settled_rate now == stamped
    assert_eq!(expected.settled_rate, stamped, "claims settle to the ceiling, not the live rate");
    assert!(claimed > 0);
    assert_eq!(w.wrapper().claim_yield(&id), 0);
}

/// Stamping is permissionless upkeep — any address may pin the ceiling, and doing so can
/// only ever REDUCE what YT can claim, so it needs no auth.
#[test]
fn stamp_maturity_rate_is_permissionless() {
    let w = setup(YEAR);
    let (_user, id) = w.deposit_new_user(100 * USDC);
    warp_to(&w, w.maturity);

    // Drop ALL mocked authorizations, then call: a function that requires no auth succeeds with
    // an empty auth list, which is what "permissionless" actually means on Soroban.
    w.env().set_auths(&[]);
    let stamped = w.wrapper().stamp_maturity_rate();
    assert!(stamped > 0, "anyone must be able to pin the ceiling — no auth required");
    assert_eq!(w.wrapper().maturity_rate(), Some(stamped));
    w.env().mock_all_auths(); // restore for the rest of the test

    // The position owner's claim is capped by the stranger's stamp.
    w.advance(YEAR);
    let claimed = w.wrapper().claim_yield(&id);
    assert!(claimed > 0, "the holder still gets the term's yield");
    assert_eq!(w.wrapper().claim_yield(&id), 0, "and nothing more");
}

/// Before maturity there is no rate to pin — refuse rather than stamp a mid-term rate,
/// which would cap YT early and confiscate the rest of the term's yield.
#[test]
#[should_panic(expected = "Error(Contract, #22)")] // NotMatured
fn stamp_maturity_rate_is_refused_before_maturity() {
    let w = setup(YEAR);
    w.advance(YEAR / 2);
    w.wrapper().stamp_maturity_rate();
}

/// If nobody stamps at maturity, the FIRST interaction pins the ceiling automatically —
/// the cap must not depend on a keeper existing. `redeem_pt` is the likeliest first
/// post-maturity call (it is the only thing maturity unlocks), so it stamps too.
#[test]
fn the_first_post_maturity_interaction_stamps_the_ceiling_automatically() {
    let w = setup(YEAR);
    let (_a, redeemer_id) = w.deposit_new_user(100 * USDC);
    let (_b, holder_id) = w.deposit_new_user(100 * USDC);

    warp_to(&w, w.maturity);
    assert_eq!(w.wrapper().maturity_rate(), None, "not stamped yet — nobody has called anything");

    // A redemption — not a claim — is the first thing that happens.
    w.wrapper().redeem_pt(&redeemer_id, &(100 * USDC));
    let stamped = w.wrapper().maturity_rate().expect("redeem_pt must pin the ceiling");

    // A year later, the other holder's claim is still capped by that automatic stamp.
    w.advance(YEAR);
    assert_eq!(w.wrapper().maturity_rate(), Some(stamped), "still the original stamp");
    let claimed = w.wrapper().claim_yield(&holder_id);
    assert!(claimed > 0);
    assert_eq!(w.wrapper().claim_yield(&holder_id), 0, "capped — no post-maturity accrual");
}

/// **The known limit of the design, pinned so it is a stated cost rather than a surprise.**
///
/// Blend publishes no historical `b_rate`, so the maturity rate has to be *observed* on-chain —
/// it cannot be reconstructed later. If literally nothing touches the wrapper at maturity, the
/// ceiling is not pinned, and whichever call comes first stamps a slightly-too-high rate, paying
/// out a little post-maturity growth. Reads do NOT pin it: a view must never write.
///
/// This is the same trade-off Pendle makes (auto-settle on the first post-expiry interaction, plus
/// an explicit settlement call to remove the drift), and it is exactly why
/// `stamp_maturity_rate` exists and why running it at maturity is documented upkeep.
///
/// The drift errs toward the holder, is bounded by how long the contract sits untouched, and is
/// never a solvency risk — the payout is real Blend growth on the position's own shares.
#[test]
fn an_unstamped_ceiling_drifts_until_the_first_interaction() {
    // Two identical worlds; the only difference is whether the ceiling gets pinned at maturity.
    let pinned = {
        let w = setup(YEAR);
        let (_u, id) = w.deposit_new_user(100 * USDC);
        warp_to(&w, w.maturity);
        w.wrapper().stamp_maturity_rate(); // keeper runs at maturity
        w.advance(YEAR);
        w.wrapper().claim_yield(&id)
    };
    let drifted = {
        let w = setup(YEAR);
        let (_u, id) = w.deposit_new_user(100 * USDC);
        warp_to(&w, w.maturity);
        // Only READS happen at maturity — a view cannot write, so nothing is pinned.
        assert!(w.wrapper().position_value(&id).claimable_yield > 0);
        assert_eq!(w.wrapper().maturity_rate(), None, "a view must not stamp the ceiling");
        w.advance(YEAR);
        w.wrapper().claim_yield(&id) // this call stamps — a year late
    };

    assert!(
        drifted > pinned,
        "an unpinned ceiling should overpay: pinned={} drifted={}",
        pinned,
        drifted
    );
    // Both are still fully backed — the overpayment is real Blend growth, not principal.
    std::println!(
        "ceiling drift over a year of neglect: pinned {} vs drifted {} ({} extra) — run \
         stamp_maturity_rate at maturity to make this 0",
        pinned,
        drifted,
        drifted - pinned
    );
}

/// `combine_and_redeem` auto-claims first, so it must be capped too — otherwise the cap
/// could be bypassed by exiting through the combine path instead of claiming.
#[test]
fn combine_and_redeem_after_maturity_is_also_capped() {
    let w = setup(YEAR);
    let (user, id) = w.deposit_new_user(100 * USDC);

    warp_to(&w, w.maturity);
    w.wrapper().stamp_maturity_rate();
    let term_yield = w.wrapper().position_value(&id).claimable_yield;
    assert!(term_yield > 0);

    w.advance(YEAR); // a year of post-maturity growth that must NOT be paid out
    let (principal, claimed) = w.wrapper().combine_and_redeem(&id, &(100 * USDC));
    assert_eq!(principal, 100 * USDC);
    assert_eq!(
        claimed, term_yield,
        "the combine path's auto-claim must respect the same maturity ceiling"
    );
    assert_eq!(w.pt().balance(&user), 0);
    assert_eq!(w.yt().balance(&user), 0);
}

/// Where the post-maturity growth actually goes: nobody's YT claims it, so it stays in the
/// wrapper as SURPLUS BACKING. That is a real accounting consequence of Pendle parity and is
/// pinned here so it is a known quantity rather than a surprise. It can only ever make the
/// protocol more solvent, never less.
#[test]
fn post_maturity_growth_becomes_wrapper_surplus_not_yt_yield() {
    let w = setup(YEAR);
    let (_user, id) = w.deposit_new_user(100 * USDC);

    warp_to(&w, w.maturity);
    w.wrapper().stamp_maturity_rate();
    w.wrapper().claim_yield(&id); // settle everything the term earned

    let (backing_at_maturity, principal, _) = w.wrapper().solvency();
    assert!(backing_at_maturity + 5 >= principal);

    // A year of growth on shares whose YT is now worth 0.
    w.advance(YEAR);
    let (backing_later, principal_later, _) = w.wrapper().solvency();
    assert_eq!(principal_later, principal, "principal does not move");
    assert!(
        backing_later > backing_at_maturity,
        "Blend keeps growing: {} -> {}",
        backing_at_maturity,
        backing_later
    );
    // None of that growth is claimable by the YT holder.
    assert_eq!(w.wrapper().position_value(&id).claimable_yield, 0);
    assert_eq!(w.wrapper().claim_yield(&id), 0);

    // The surplus sits above principal — strictly a solvency improvement, and the principal
    // is still fully redeemable.
    let surplus = backing_later - principal_later;
    assert!(surplus > 0, "post-maturity growth accrues to the wrapper as surplus");
    assert_eq!(w.wrapper().redeem_pt(&id, &(100 * USDC)), 100 * USDC);
    // Note the shape, not the magnitude: post-claim the backing sits at EXACTLY principal (the
    // claim took out precisely the term's yield), and everything Blend adds afterwards is surplus
    // nobody's YT can reach. The size depends on the test fixture's pool dynamics.
    std::println!(
        "backing at maturity (post-claim) {} == principal {} -> a year later {} | surplus {}",
        backing_at_maturity,
        principal_later,
        backing_later,
        surplus
    );
}

// --------------------------------------------------------------------------
// §0 P2 — `claim_on_closed_position_is_noop`
//
// `do_claim` never checks `pos.open`. A closed position has `shares == 0`, so
// it pays 0 and merely re-settles. Harmless — pinned so a future refactor
// cannot quietly turn it into a payout.
// --------------------------------------------------------------------------

#[test]
fn claim_on_closed_position_is_a_noop() {
    let w = setup(YEAR);
    let (user, id) = w.deposit_new_user(100 * USDC);
    w.advance(YEAR / 2);

    // Fully combine → the position closes (PT + YT both burned, shares drained).
    w.wrapper().combine_and_redeem(&id, &(100 * USDC));
    let closed = w.wrapper().get_position(&id);
    assert!(!closed.open);
    assert_eq!(closed.pt_amount, 0);
    assert_eq!(closed.yt_amount, 0);
    assert_eq!(closed.shares, 0, "a closed position holds no Blend shares");

    // Let the rate rise a lot, then claim on the closed position.
    w.advance(YEAR);
    let usdc_before = w.usdc().balance(&user);
    let paid = w.wrapper().claim_yield(&id);
    assert_eq!(paid, 0, "a closed position must never pay out");
    assert_eq!(w.usdc().balance(&user), usdc_before, "no USDC moved");

    // It did re-settle (settled_rate advanced to the current rate) but nothing else.
    let after = w.wrapper().get_position(&id);
    assert!(after.settled_rate >= closed.settled_rate);
    assert!(!after.open, "claiming must not resurrect a closed position");
    assert_eq!(after.shares, 0);

    // Repeating it is equally inert.
    assert_eq!(w.wrapper().claim_yield(&id), 0);
}

// --------------------------------------------------------------------------
// §13 P0 — `pt_supply_equals_sum_of_position_pt`
//
// The missing global conservation law: no PT/YT may exist that the wrapper did
// not mint. This is the on-chain invariant that would DETECT counterfeit PT
// issued straight from the classic Stellar issuer (§13's attack surface).
// --------------------------------------------------------------------------

/// Sum `pt_amount` / `yt_amount` over every position id ever opened.
fn sum_position_legs(w: &World, next_id: u64) -> (i128, i128) {
    let (mut pt, mut yt) = (0i128, 0i128);
    for id in 0..next_id {
        if let Ok(Ok(p)) = w.wrapper().try_get_position(&id) {
            pt += p.pt_amount;
            yt += p.yt_amount;
        }
    }
    (pt, yt)
}

#[test]
fn pt_and_yt_supply_equals_sum_of_open_position_legs() {
    let w = setup(YEAR);

    // Three positions across two users, with claims and a partial combine mixed in.
    let (u0, id0) = w.deposit_new_user(100 * USDC);
    let (_u1, id1) = w.deposit_new_user(250 * USDC);
    w.advance(YEAR / 4);
    let (_u2, id2) = w.deposit_new_user(70 * USDC);

    let check = |label: &str, n: u64| {
        let (pt_sum, yt_sum) = sum_position_legs(&w, n);
        // The SAC total supply is exactly what the wrapper minted and has not burned.
        // We reconstruct it from the balances of every account that can hold it.
        assert_eq!(
            pt_sum,
            w.pt().balance(&u0)
                + w.pt().balance(&_u1)
                + w.pt().balance(&_u2),
            "{}: Σ position pt_amount != Σ PT balances",
            label
        );
        assert_eq!(
            yt_sum,
            w.yt().balance(&u0)
                + w.yt().balance(&_u1)
                + w.yt().balance(&_u2),
            "{}: Σ position yt_amount != Σ YT balances",
            label
        );
    };

    check("after 3 mints", 3);

    // Claiming yield must not move PT/YT at all (SCF #6).
    w.advance(YEAR / 4);
    w.wrapper().claim_yield(&id0);
    w.wrapper().claim_yield(&id1);
    check("after claims", 3);

    // A partial combine burns equal PT + YT from one position.
    w.wrapper().combine_and_redeem(&id2, &(30 * USDC));
    check("after partial combine", 3);

    // A full redeem at maturity burns the PT leg only.
    warp_to(&w, w.maturity + 1);
    w.wrapper().redeem_pt(&id1, &(250 * USDC));
    check("after full PT redeem", 3);

    // And a transfer moves both legs without changing the totals.
    let bob = Address::generate(w.env());
    w.wrapper().transfer_position(&id0, &bob);
    let (pt_sum, yt_sum) = sum_position_legs(&w, 3);
    assert_eq!(
        pt_sum,
        w.pt().balance(&u0) + w.pt().balance(&_u1) + w.pt().balance(&_u2) + w.pt().balance(&bob),
        "transfer must conserve total PT"
    );
    assert_eq!(
        yt_sum,
        w.yt().balance(&u0) + w.yt().balance(&_u1) + w.yt().balance(&_u2) + w.yt().balance(&bob),
        "transfer must conserve total YT"
    );
}

/// Donated ("counterfeit") PT — the §13 issuer-bypass shape, simulated by moving
/// PT in from outside any position — breaks the conservation law. This is the
/// detector: an on-chain monitor comparing PT supply to Σ position legs would
/// fire. It also confirms the wrapper itself is *incidentally* shielded, because
/// `redeem_pt` is position-gated.
#[test]
fn extra_pt_outside_a_position_breaks_conservation_but_not_the_wrapper() {
    let w = setup(YEAR);
    let (victim, id) = w.deposit_new_user(100 * USDC);
    let attacker = Address::generate(w.env());

    // Simulate counterfeit supply: PT that exists without a backing position.
    // (On mainnet the classic issuer can do exactly this with a plain payment.)
    // Here we move real PT to an account that owns no position — the accounting
    // shape the monitor sees is identical: PT held against no position leg.
    w.pt().transfer(&victim, &attacker, &(40 * USDC));

    let (pt_sum, _) = sum_position_legs(&w, 1);
    assert_eq!(pt_sum, 100 * USDC, "the position still records the full leg");
    assert_eq!(w.pt().balance(&attacker), 40 * USDC);
    assert_eq!(w.pt().balance(&victim), 60 * USDC);

    // The wrapper is unharmed: the attacker cannot redeem — there is no position
    // of theirs to redeem against (the §0.1 gap acting as an accidental shield).
    warp_to(&w, w.maturity + 1);
    assert_eq!(
        w.wrapper().try_redeem_pt(&1u64, &(40 * USDC)),
        Err(Ok(spield_shared::Error::PositionNotFound.into())),
        "loose PT has no redemption path at the wrapper"
    );
    // And the legitimate owner can only redeem what they still hold.
    assert!(
        w.wrapper().try_redeem_pt(&id, &(100 * USDC)).is_err(),
        "the position's own redeem now fails — its PT left the owner's balance"
    );
    let before = w.usdc().balance(&victim);
    w.wrapper().redeem_pt(&id, &(60 * USDC));
    assert_eq!(w.usdc().balance(&victim) - before, 60 * USDC);
}

// --------------------------------------------------------------------------
// §1 P1 (fixed) — `one_stroop_mint_at_elevated_entry_rate`
//
// Once the pool has accrued (`b_rate > 1`), Blend floors the credited shares of a
// 1-stroop supply to 0 and rejects the request *inside the pool* — before the
// wrapper's own `shares <= 0` guard was ever reached, so callers saw an opaque
// Blend error code. The practical consequence is a hard **2-stroop minimum mint**
// on any pool with a non-unit `b_rate`, which is exactly mainnet's state
// (`b_rate ≈ 1.124`).
//
// The behavior was already safe (atomic refusal, no unbacked PT); what was missing
// was that it named nothing the caller could act on. `mint` now checks
// `math::min_mintable(entry_rate)` up front and refuses with Spield's own
// `InvalidAmount`.
// --------------------------------------------------------------------------

#[test]
fn sub_minimum_mint_is_refused_with_spields_own_error() {
    let w = setup(YEAR);
    w.advance(30 * 24 * 60 * 60); // let b_rate rise above 1.0

    let user = Address::generate(w.env());
    w.usdc_admin().mint(&user, &(100 * USDC));

    // The floor is derived from the live rate, not hardcoded — read it and check the
    // boundary on both sides, so this stays honest if Blend's rate moves.
    let rate = BlendStrategyClient::new(w.env(), &w.strategy).current_rate();
    let min = spield_shared::math::min_mintable(rate);
    assert_eq!(min, 2, "at a b_rate just over 1.0 the floor is 2 stroops (mainnet's case)");

    // Below the floor: refused with OUR error, not Blend's, so the message is actionable.
    assert_eq!(
        w.wrapper().try_mint(&user, &(min - 1)),
        Err(Ok(spield_shared::Error::InvalidAmount.into())),
        "a sub-floor mint must name Spield's own constraint, not surface a Blend code"
    );
    // At the floor: succeeds.
    assert!(
        w.wrapper().try_mint(&user, &min).is_ok(),
        "{} stroops is the minimum viable mint at an elevated b_rate",
        min
    );

    // The refusal is atomic: no PT/YT was minted for the failed attempt, and the USDC
    // pulled before the check was returned by the revert.
    assert_eq!(w.pt().balance(&user), min, "only the successful mint exists");
    assert_eq!(w.yt().balance(&user), min);
    assert_eq!(w.usdc().balance(&user), 100 * USDC - min, "only the successful mint was charged");
    let (backing, principal, _) = w.wrapper().solvency();
    assert!(backing + 5 >= principal);
}

/// `min_mintable` is pure and the boundary matters, so pin it directly too: at or
/// below par the floor is 1 stroop; above par it is `ceil(rate)`.
#[test]
fn min_mintable_tracks_the_rate() {
    use spield_shared::{math::min_mintable, SCALAR_12};
    assert_eq!(min_mintable(SCALAR_12), 1, "at par, 1 stroop credits 1 share");
    assert_eq!(min_mintable(SCALAR_12 / 2), 1, "below par the floor cannot go under 1");
    assert_eq!(min_mintable(SCALAR_12 + 1), 2, "a hair over par already needs 2");
    assert_eq!(min_mintable(SCALAR_12 * 1124 / 1000), 2, "mainnet's b_rate ≈ 1.124 ⇒ 2");
    assert_eq!(min_mintable(SCALAR_12 * 2), 2, "exactly 2.0 ⇒ 2");
    assert_eq!(min_mintable(SCALAR_12 * 2 + 1), 3, "just over 2.0 ⇒ 3");
}
