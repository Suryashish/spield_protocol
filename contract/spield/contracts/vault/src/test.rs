#![cfg(test)]
//! # Fixed-Rate Vault test suite — end-to-end vs the real Blend v2 WASM
//!
//! Same harness shape as the wrapper's §7.4 suite: a live Blend pool (XLM collateral + USDC
//! borrowable so the USDC `b_rate` actually rises), the real strategy adapter, the real wrapper
//! with PT/YT SACs it admins, and the vault sitting on top of the wrapper. No mocks of Blend or of
//! our own contracts. We prove the flagship property: **a user locks a fixed return and always gets
//! it, and the vault is solvent (PT inventory ≥ liabilities) after every operation.**

extern crate std;

use crate::{Vault, VaultClient};
use blend_contract_sdk::{pool, testutils::BlendFixture};
use sep_40_oracle::testutils::{Asset, MockPriceOracleClient, MockPriceOracleWASM};
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, BytesN, Env, String, Symbol, Vec,
};
use spield_strategy::{BlendStrategy, BlendStrategyClient};
use spield_wrapper::{Wrapper, WrapperClient};

const USDC: i128 = 1_0000000; // 7 decimals
const SCALAR_7: i128 = 1_0000000;
const REQ_SUPPLY_COLLATERAL: u32 = 2;
const REQ_BORROW: u32 = 4;
const YEAR: u64 = 365 * 24 * 60 * 60;
const RATE_BPS: u32 = 500; // 5% fixed APR
const MAX_RATE_BPS: u32 = 2000; // 20% ceiling

struct World {
    env: Env,
    pool: Address,
    usdc: Address,
    oracle_id: Address,
    wrapper: Address,
    vault: Address,
    pt: Address,
    yt: Address,
    maturity: u64,
}

impl World {
    fn env(&self) -> &Env {
        &self.env
    }
    fn vault(&self) -> VaultClient<'_> {
        VaultClient::new(&self.env, &self.vault)
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

    /// Fund a fresh user with `amount` USDC.
    fn new_user(&self, amount: i128) -> Address {
        let user = Address::generate(&self.env);
        self.usdc_admin().mint(&user, &amount);
        user
    }
}

fn register_sac<'a>(env: &'a Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone()).address()
}

/// Build the full stack. `maturity_secs_from_now` controls the market's term.
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

    // Whale borrows USDC so b_rate rises over time.
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

    // Wrapper first (so we can admin PT/YT to it), then strategy, then PT/YT SACs, then init.
    // Each contract's admin is bound atomically by its constructor (front-run-proof).
    let wrapper = env.register(Wrapper, (admin.clone(),));
    let strategy = env.register(BlendStrategy, (admin.clone(),));
    BlendStrategyClient::new(&env, &strategy).initialize(&wrapper, &pool, &usdc, &30_000u32);

    let pt = register_sac(&env, &wrapper);
    let yt = register_sac(&env, &wrapper);

    let maturity = env.ledger().timestamp() + maturity_secs_from_now;
    WrapperClient::new(&env, &wrapper).initialize(&strategy, &pt, &yt, &maturity);

    // The vault sits on top of the wrapper.
    let vault = env.register(Vault, (admin.clone(),));
    VaultClient::new(&env, &vault).initialize(&wrapper, &usdc, &RATE_BPS, &MAX_RATE_BPS);

    World { env, pool, usdc, oracle_id, wrapper, vault, pt, yt, maturity }
}

// ===========================================================================
// Wiring: init pulls PT/YT/underlying/maturity from the wrapper
// ===========================================================================

#[test]
fn init_inherits_market_from_wrapper() {
    let w = setup(YEAR);
    assert_eq!(w.vault().pt_token(), w.pt);
    assert_eq!(w.vault().yt_token(), w.yt);
    assert_eq!(w.vault().maturity(), w.maturity);
    assert_eq!(w.vault().rate_bps(), RATE_BPS);
    assert!(!w.vault().is_paused());
    let stats = w.vault().stats();
    assert_eq!(stats.pt_inventory, 0);
    assert_eq!(stats.total_liability, 0);
}

// ===========================================================================
// quote: 5% APR for a full year on 100 USDC ≈ 5 USDC coupon
// ===========================================================================

#[test]
fn quote_matches_simple_interest() {
    let w = setup(YEAR);
    let (payout, coupon, rate) = w.vault().quote(&(100 * USDC));
    assert_eq!(rate, RATE_BPS);
    // 5% of 100 for ~1 year ≈ 5 USDC (within floor-rounding of the term fraction).
    assert!(coupon >= 49_000000 && coupon <= 5_0000000, "coupon {} not ~5 USDC", coupon);
    assert_eq!(payout, 100 * USDC + coupon);
}

// ===========================================================================
// Deposit must be backed: with no seed, the coupon has no PT to stand on.
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #64)")] // InsufficientCapacity
fn deposit_without_capacity_is_refused() {
    let w = setup(YEAR);
    let user = w.new_user(100 * USDC);
    // No seed → vault holds 0 PT beyond the 100 it mints, so it can't back the 5 coupon.
    w.vault().deposit(&user, &(100 * USDC));
}

// ===========================================================================
// Seed builds capacity; then a deposit locks a fixed payout, redeemable at maturity.
// ===========================================================================

#[test]
fn seed_then_deposit_then_redeem_pays_fixed() {
    let w = setup(YEAR);

    // Protocol seeds the vault with 100 USDC of PT capacity (admin/treasury funds this).
    let seeder = w.new_user(100 * USDC);
    w.vault().seed(&seeder, &(100 * USDC));
    let stats = w.vault().stats();
    assert!(stats.pt_inventory >= 100 * USDC - 2, "seed should add ~100 PT, got {}", stats.pt_inventory);
    assert_eq!(stats.total_liability, 0);
    assert!(stats.coupon_capacity > 0);

    // A user deposits 100 USDC and locks the fixed rate.
    let user = w.new_user(100 * USDC);
    let (expected_payout, coupon, _) = w.vault().quote(&(100 * USDC));
    assert!(coupon > 0);
    let id = w.vault().deposit(&user, &(100 * USDC));

    let receipt = w.vault().get_receipt(&id);
    assert_eq!(receipt.owner, user);
    assert_eq!(receipt.principal, 100 * USDC);
    assert_eq!(receipt.payout, expected_payout);
    assert!(receipt.open);

    // Liability is booked; PT inventory still covers it (solvent).
    let stats = w.vault().stats();
    assert_eq!(stats.total_liability, expected_payout);
    assert!(stats.pt_inventory + 2 >= stats.total_liability, "insolvent after deposit");

    // The user spent their 100 USDC.
    assert_eq!(w.usdc().balance(&user), 0);

    // Fast-forward to maturity and redeem: user gets exactly the fixed payout.
    w.env().ledger().set_timestamp(w.maturity + 1);
    w.oracle().set_price_stable(&vec![w.env(), 1_0000000, 1_0000000]);
    // Reset the host budget before the deep redeem chain (vault→wrapper→strategy→Blend); the
    // default auth-recording budget is exhausted by the extra contract layer the vault adds.
    w.env().cost_estimate().budget().reset_unlimited();
    let before = w.usdc().balance(&user);
    let paid = w.vault().redeem(&id);
    let after = w.usdc().balance(&user);
    assert_eq!(paid, expected_payout, "must pay the locked-in fixed payout");
    assert_eq!(after - before, expected_payout, "user receives principal + fixed coupon");
    assert!(!w.vault().get_receipt(&id).open, "receipt closed after redeem");

    // Liability cleared.
    assert_eq!(w.vault().stats().total_liability, 0);
    std::println!("fixed payout delivered: principal=100 coupon={} payout={}", coupon, expected_payout);
}

// ===========================================================================
// Harvest: the vault's retained YT yield is reinvested into PT, growing capacity.
// ===========================================================================

#[test]
fn harvest_grows_capacity_from_yield() {
    let w = setup(YEAR);
    let seeder = w.new_user(1_000 * USDC);
    w.vault().seed(&seeder, &(1_000 * USDC));

    let cap_before = w.vault().stats().coupon_capacity;

    // Let most of the year of real Blend interest accrue on the vault's YT (staying before
    // maturity so harvesting is allowed), then harvest.
    w.advance(YEAR - 24 * 60 * 60);
    // Reset the host budget before the deep harvest chain (vault→wrapper→strategy→Blend).
    w.env().cost_estimate().budget().reset_unlimited();
    let (claimed, pt_added) = w.vault().harvest(&50u32);
    assert!(claimed > 0, "harvest must claim real accrued yield");
    assert_eq!(claimed, pt_added);

    let cap_after = w.vault().stats().coupon_capacity;
    assert!(cap_after > cap_before, "harvest must grow coupon capacity: {} -> {}", cap_before, cap_after);
    std::println!("harvest: claimed={} capacity {} -> {}", claimed, cap_before, cap_after);
}

// ===========================================================================
// Redeem before maturity is rejected.
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #62)")] // VaultNotMatured
fn redeem_before_maturity_panics() {
    let w = setup(YEAR);
    let seeder = w.new_user(100 * USDC);
    w.vault().seed(&seeder, &(100 * USDC));
    let user = w.new_user(100 * USDC);
    let id = w.vault().deposit(&user, &(100 * USDC));
    w.vault().redeem(&id);
}

// ===========================================================================
// Solvency: many deposits against a big seed all remain backed and redeemable.
// ===========================================================================

#[test]
fn many_deposits_stay_solvent_and_all_redeem() {
    let w = setup(YEAR);
    // Seed generously so all coupons are backed.
    let seeder = w.new_user(1_000 * USDC);
    w.vault().seed(&seeder, &(1_000 * USDC));

    let mut users = std::vec::Vec::new();
    let mut ids = std::vec::Vec::new();
    let mut payouts = std::vec::Vec::new();
    for _ in 0..5 {
        let user = w.new_user(100 * USDC);
        let (payout, _, _) = w.vault().quote(&(100 * USDC));
        let id = w.vault().deposit(&user, &(100 * USDC));
        users.push(user);
        ids.push(id);
        payouts.push(payout);
        // Solvent after every deposit.
        let s = w.vault().stats();
        assert!(s.pt_inventory + 8 >= s.total_liability, "insolvent mid-sequence");
    }

    // At maturity every receipt redeems for its exact locked payout.
    w.env().ledger().set_timestamp(w.maturity + 1);
    w.oracle().set_price_stable(&vec![w.env(), 1_0000000, 1_0000000]);
    for (i, id) in ids.iter().enumerate() {
        w.env().cost_estimate().budget().reset_unlimited();
        let before = w.usdc().balance(&users[i]);
        let paid = w.vault().redeem(id);
        let after = w.usdc().balance(&users[i]);
        assert_eq!(paid, payouts[i], "user {} fixed payout wrong", i);
        assert_eq!(after - before, payouts[i], "user {} didn't receive payout", i);
    }
    assert_eq!(w.vault().stats().total_liability, 0);
}

// ===========================================================================
// Admin: set_rate within ceiling works; above ceiling is rejected; pause halts deposits.
// ===========================================================================

#[test]
fn set_rate_within_ceiling() {
    let w = setup(YEAR);
    w.vault().set_rate(&1000); // 10%, under the 20% ceiling
    assert_eq!(w.vault().rate_bps(), 1000);
}

#[test]
#[should_panic(expected = "Error(Contract, #65)")] // RateNotAllowed
fn set_rate_above_ceiling_panics() {
    let w = setup(YEAR);
    w.vault().set_rate(&(MAX_RATE_BPS + 1));
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")] // Paused
fn paused_blocks_deposit() {
    let w = setup(YEAR);
    let seeder = w.new_user(100 * USDC);
    w.vault().seed(&seeder, &(100 * USDC));
    w.vault().pause();
    let user = w.new_user(100 * USDC);
    w.vault().deposit(&user, &(100 * USDC));
}

// ===========================================================================
// Pause coverage & emergency exit (mainnet-readiness #8): pause blocks deposits
// but a matured receipt can still be REDEEMED while paused (no trapped funds).
// ===========================================================================

#[test]
fn paused_still_allows_redeem() {
    let w = setup(YEAR);
    let seeder = w.new_user(100 * USDC);
    w.vault().seed(&seeder, &(100 * USDC));
    let user = w.new_user(100 * USDC);
    let id = w.vault().deposit(&user, &(100 * USDC));
    let payout = w.vault().get_receipt(&id).payout;

    // Warp to maturity, then pause (emergency).
    w.advance(YEAR + 1);
    w.vault().pause();

    // Deposit (inflow) is blocked while paused — the pause guard runs first in `ensure_can_deposit`.
    let intruder = w.new_user(100 * USDC);
    assert_eq!(
        w.vault().try_deposit(&intruder, &(100 * USDC)),
        Err(Ok(spield_shared::Error::Paused.into())),
        "deposit (inflow) must be blocked while paused"
    );

    // ...but the user can still REDEEM their matured receipt while paused.
    w.env().cost_estimate().budget().reset_unlimited();
    let before = w.usdc().balance(&user);
    let paid = w.vault().redeem(&id);
    assert_eq!(paid, payout, "redeem must pay the full fixed payout while paused");
    assert_eq!(w.usdc().balance(&user) - before, payout, "user received funds while paused");
}

// ===========================================================================
// Harvest pagination (mainnet-readiness #6): with many positions, a bounded
// harvest(max_positions) sweeps the list a chunk at a time via a cursor and
// still claims yield across all of them — no unbounded loop that could brick.
// ===========================================================================

#[test]
fn harvest_pagination_sweeps_all_positions() {
    let w = setup(YEAR);
    // Build several positions: one seed + several deposits each open a wrapper position the vault
    // tracks. (deposit needs capacity; seed generously first.)
    let seeder = w.new_user(1_000 * USDC);
    w.vault().seed(&seeder, &(1_000 * USDC)); // position #0
    for _ in 0..4 {
        let u = w.new_user(50 * USDC);
        w.vault().deposit(&u, &(50 * USDC)); // positions #1..#4
    }

    // Accrue real yield, staying before maturity.
    w.advance(YEAR - 24 * 60 * 60);
    w.env().cost_estimate().budget().reset_unlimited();

    let cap_before = w.vault().stats().coupon_capacity;

    // Harvest only 2 positions per call. Several calls must, together, sweep every position and
    // claim real yield (each call advances the stored cursor). We loop a few times to cover all 5+.
    let mut total_claimed = 0i128;
    for _ in 0..5 {
        w.env().cost_estimate().budget().reset_unlimited();
        let (claimed, pt_added) = w.vault().harvest(&2u32); // bounded batch
        assert_eq!(claimed, pt_added);
        total_claimed += claimed;
    }
    assert!(total_claimed > 0, "paginated harvest must claim real yield across positions");

    let cap_after = w.vault().stats().coupon_capacity;
    assert!(cap_after > cap_before, "paginated harvest grew capacity: {} -> {}", cap_before, cap_after);

    // The vault stays solvent throughout (asserted inside harvest, re-checked here).
    let stats = w.vault().stats();
    assert!(stats.pt_inventory >= stats.total_liability);
}

#[test]
fn harvest_clamps_batch_and_handles_empty_list() {
    let w = setup(YEAR);
    // No positions yet → harvest is a no-op (claims 0), never panics.
    let (claimed, pt_added) = w.vault().harvest(&50u32);
    assert_eq!((claimed, pt_added), (0, 0));

    // A huge max_positions is clamped internally (MAX_HARVEST_BATCH) — must not error.
    let seeder = w.new_user(100 * USDC);
    w.vault().seed(&seeder, &(100 * USDC));
    w.advance(YEAR - 24 * 60 * 60);
    w.env().cost_estimate().budget().reset_unlimited();
    let (claimed2, _) = w.vault().harvest(&u32::MAX);
    assert!(claimed2 >= 0);
}

// ===========================================================================
// TTL keep-alive (mainnet-readiness #5): a receipt held past the old ~60-day
// window survives, and bump_receipt keeps a long-dated receipt alive.
// ===========================================================================

#[test]
fn receipt_survives_long_hold_via_maturity_aware_ttl() {
    let six_months = 182 * 24 * 60 * 60;
    let w = setup(six_months);
    let seeder = w.new_user(1_000 * USDC);
    w.vault().seed(&seeder, &(1_000 * USDC));
    let user = w.new_user(100 * USDC);
    let id = w.vault().deposit(&user, &(100 * USDC));

    // Advance ~90 days of ledgers without touching the receipt — would archive under a flat 60-day
    // bump; the maturity-aware bump (to ~maturity+grace) keeps it live.
    w.env().ledger().with_mut(|li| {
        li.sequence_number += 90 * 24 * 60 * 60 / 5;
    });
    let r = w.vault().get_receipt(&id);
    assert!(r.open && r.principal == 100 * USDC, "receipt archived before maturity (TTL too short)");

    // Permissionless bump keeps it alive further.
    w.vault().bump_receipt(&id);
    assert!(w.vault().get_receipt(&id).open);
}

#[test]
#[should_panic(expected = "Error(Contract, #60)")] // ReceiptNotFound
fn bump_receipt_unknown_id_panics() {
    let w = setup(YEAR);
    w.vault().bump_receipt(&999u64);
}

// ===========================================================================
// Double-initialize is rejected (SCF #7).
// ===========================================================================

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // AlreadyInitialized
fn double_initialize_panics() {
    let w = setup(YEAR);
    w.vault().initialize(&w.wrapper, &w.usdc, &RATE_BPS, &MAX_RATE_BPS);
}

// ===========================================================================
// TTL: a receipt survives a ledger advance (SCF #9).
// ===========================================================================

#[test]
fn receipt_survives_ttl_window() {
    let w = setup(YEAR);
    let seeder = w.new_user(100 * USDC);
    w.vault().seed(&seeder, &(100 * USDC));
    let user = w.new_user(100 * USDC);
    let id = w.vault().deposit(&user, &(100 * USDC));

    w.env().ledger().with_mut(|li| {
        li.sequence_number += 100_000;
    });
    let r = w.vault().get_receipt(&id);
    assert!(r.open, "receipt archived/lost after ledger advance (SCF #9)");
    assert_eq!(r.principal, 100 * USDC);
}

// ===========================================================================
// Governance: admin rotation + upgrade timelock wiring (mainnet-readiness)
// ===========================================================================

#[test]
fn vault_admin_rotation_two_step() {
    let w = setup(YEAR);
    let new_admin = Address::generate(w.env());

    assert_eq!(w.vault().pending_admin(), None);
    w.vault().propose_admin(&new_admin);
    assert_eq!(w.vault().pending_admin(), Some(new_admin.clone()));
    w.vault().accept_admin();
    assert_eq!(w.vault().admin(), new_admin);
    assert_eq!(w.vault().pending_admin(), None);

    // New admin can drive an admin-only op (set_rate within the ceiling).
    w.vault().set_rate(&600u32);
    assert_eq!(w.vault().rate_bps(), 600u32);
}

#[test]
fn vault_upgrade_timelock_schedule_and_default() {
    let w = setup(YEAR);
    assert_eq!(w.vault().timelock(), 24 * 60 * 60);
    let hash = BytesN::<32>::random(w.env());
    let now = w.env().ledger().timestamp();
    let eta = w.vault().schedule_upgrade(&hash);
    assert_eq!(eta, now + 24 * 60 * 60);
    assert_eq!(w.vault().pending_upgrade().unwrap().eta, eta);
    // Too-early apply is rejected.
    assert_eq!(
        w.vault().try_apply_upgrade(),
        Err(Ok(spield_shared::Error::TimelockNotElapsed.into()))
    );
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
// §0 P0 — `vault_harvest_reverts_while_wrapper_paused`
//
// `harvest` is documented "allowed while paused" and its OWN pause gate does let
// it through. But its reinvest step calls `wrapper::mint`, which the WRAPPER's
// pause blocks. So pausing the wrapper — the natural first move in an emergency —
// silently disables the vault's coupon-capacity upkeep entirely.
// --------------------------------------------------------------------------

#[test]
fn vault_harvest_reverts_while_wrapper_is_paused() {
    let w = setup(YEAR);
    let seeder = w.new_user(1_000 * USDC);
    w.vault().seed(&seeder, &(1_000 * USDC));

    // Real yield accrues on the vault's retained YT.
    w.advance(YEAR - 24 * 60 * 60);
    w.env().cost_estimate().budget().reset_unlimited();

    // Emergency: pause the WRAPPER (the vault itself is left unpaused).
    w.wrapper().pause();
    assert!(w.wrapper().is_paused());
    assert!(!w.vault().is_paused(), "the vault's own pause is NOT set");

    // The vault's own gate would allow harvest, but the reinvest `wrapper::mint`
    // panics `Paused` and reverts the whole call — including the claim that
    // already succeeded.
    assert_eq!(
        w.vault().try_harvest(&50u32),
        Err(Ok(spield_shared::Error::Paused.into())),
        "harvest must be documented as blocked by a WRAPPER pause, not a vault pause"
    );

    // Nothing was half-applied: capacity is untouched, so the revert is clean.
    let stats = w.vault().stats();
    assert!(stats.pt_inventory >= stats.total_liability);

    // Unpausing the wrapper restores harvest immediately.
    w.wrapper().unpause();
    w.env().cost_estimate().budget().reset_unlimited();
    let (claimed, _) = w.vault().harvest(&50u32);
    assert!(claimed > 0, "harvest works again once the wrapper is unpaused");
}

/// The benign half: with **no yield to reinvest** there is no `wrapper::mint`, so
/// harvest is a genuine no-op and succeeds even under a wrapper pause. Pinning
/// this shows the failure is specifically the reinvest leg, not the claim leg.
#[test]
fn vault_harvest_with_zero_yield_succeeds_under_wrapper_pause() {
    let w = setup(YEAR);
    let seeder = w.new_user(100 * USDC);
    w.vault().seed(&seeder, &(100 * USDC));
    w.wrapper().pause();

    // No time has passed → nothing accrued → the early return fires before mint.
    let (claimed, added) = w.vault().harvest(&50u32);
    assert_eq!((claimed, added), (0, 0));
}

/// The GOOD half of the same coupling (§3): `wrapper::redeem_pt` is exit-side, so
/// the vault's user exit must survive a wrapper pause. If this ever regressed,
/// a wrapper pause would trap every vault depositor's funds.
#[test]
fn vault_redeem_works_while_wrapper_is_paused() {
    let w = setup(YEAR);
    let seeder = w.new_user(100 * USDC);
    w.vault().seed(&seeder, &(100 * USDC));
    let user = w.new_user(100 * USDC);
    let id = w.vault().deposit(&user, &(100 * USDC));
    let payout = w.vault().get_receipt(&id).payout;

    warp_to(&w, w.maturity + 1);
    w.wrapper().pause(); // emergency pause of the *wrapper*

    let before = w.usdc().balance(&user);
    let paid = w.vault().redeem(&id);
    assert_eq!(paid, payout, "vault redeem must survive a wrapper pause");
    assert_eq!(w.usdc().balance(&user) - before, payout);
}

// --------------------------------------------------------------------------
// §0 P0 — `vault_redeem_budget_with_many_harvest_positions`
//
// `redeem_pt_for` walks the ENTIRE tracked-positions list, and every
// `harvest`/`seed`/`deposit` appends to it. Months of daily harvests ⇒ hundreds
// of positions ⇒ a single `redeem` can exceed the tx budget — the exact
// unbounded-loop class `harvest(max_positions)` was built to avoid, one function
// over. This measures the real cost growth.
// --------------------------------------------------------------------------

/// Run `cycles` harvests spread over the term so each appends a tracked position.
/// Resource-limit enforcement is disabled while BUILDING the scenario (the setup
/// itself is not what we are measuring); the measured call re-enables it.
/// Uses a full-sweep batch so the claim always clears the dust floor — this
/// isolates the *walk length* question from the *dust reinvest* question.
fn build_harvest_positions(w: &World, cycles: u32, step_secs: u64) -> u32 {
    w.env().cost_estimate().disable_resource_limits();
    let mut n = 0u32;
    for _ in 0..cycles {
        w.advance(step_secs);
        w.env().cost_estimate().budget().reset_unlimited();
        let (claimed, _) = w.vault().harvest(&50u32);
        if claimed > 0 {
            n += 1;
        }
    }
    n
}

/// Mainnet's per-transaction ceilings, as the SDK models them.
const MAINNET_INSTRUCTIONS: i64 = 600_000_000;
const MAINNET_MEM_BYTES: i64 = 41_943_040;
const MAINNET_WRITE_ENTRIES: u32 = 50;
const MAINNET_LEDGER_ENTRIES: u32 = 100;
const MAINNET_WRITE_BYTES: u32 = 132_096;
/// Per-entry ceiling — the `Positions` Vec lives in ONE instance entry.
const MAINNET_MAX_ENTRY_BYTES: u32 = 65_536;

/// `(instructions, mem_bytes, write_entries, ledger_entries, write_bytes)` for the
/// last call. `ledger_entries` is the transaction-footprint total the network
/// bounds: disk reads + in-memory reads + writes.
fn last_resources(w: &World) -> (i64, i64, u32, u32, u32) {
    let r = w.env().cost_estimate().resources();
    let ledger_entries = r.disk_read_entries + r.memory_read_entries + r.write_entries;
    (r.instructions, r.mem_bytes, r.write_entries, ledger_entries, r.write_bytes)
}

fn report(label: &str, r: (i64, i64, u32, u32, u32)) {
    std::println!(
        "{:<34} insns {:>11}/{}  mem {:>9}/{}  write {:>3}/{}  entries {:>3}/{}  wbytes {:>6}/{}",
        label,
        r.0,
        MAINNET_INSTRUCTIONS,
        r.1,
        MAINNET_MEM_BYTES,
        r.2,
        MAINNET_WRITE_ENTRIES,
        r.3,
        MAINNET_LEDGER_ENTRIES,
        r.4,
        MAINNET_WRITE_BYTES
    );
}

#[test]
fn vault_redeem_cost_grows_with_the_number_of_tracked_positions() {
    // Two identical vaults, differing only in how many harvest positions exist.
    let measure = |cycles: u32| -> (u32, (i64, i64, u32, u32, u32)) {
        let w = setup(YEAR);
        let seeder = w.new_user(2_000 * USDC);
        w.vault().seed(&seeder, &(2_000 * USDC));
        let user = w.new_user(100 * USDC);
        let id = w.vault().deposit(&user, &(100 * USDC));

        // ~daily harvests across the term; each one appends a tracked position.
        let added = build_harvest_positions(&w, cycles, 24 * 60 * 60);

        warp_to(&w, w.maturity + 1);
        w.env().cost_estimate().disable_resource_limits();
        w.env().cost_estimate().budget().reset_unlimited();
        w.vault().redeem(&id);
        (added, last_resources(&w))
    };

    let (n_few, few) = measure(5);
    let (n_many, many) = measure(60);
    report(&std::format!("redeem, {} positions", n_few + 2), few);
    report(&std::format!("redeem, {} positions", n_many + 2), many);

    // The finding: `redeem_pt_for`'s cost is NOT constant in the tracked-position
    // count — the walk is unbounded by construction, so it scales with history.
    assert!(
        many.0 > few.0,
        "redeem instruction cost must grow with position count: {} -> {}",
        few.0,
        many.0
    );
    // Record the per-position marginal cost so a regression is visible in review.
    let per_position = (many.0 - few.0) / (n_many as i64 - n_few as i64).max(1);
    std::println!("marginal redeem cost ≈ {} instructions per tracked position", per_position);
    let headroom = (MAINNET_INSTRUCTIONS - many.0) / per_position.max(1);
    std::println!(
        "at this rate ~{} more tracked positions would exhaust the mainnet instruction limit",
        headroom
    );
}

/// The hard question §0 asks: does a single `redeem` still fit a real mainnet
/// transaction after a realistic harvest history? This asserts it against the
/// **mainnet** ceilings the SDK models, so it goes red the day it stops fitting.
#[test]
fn vault_redeem_with_a_long_harvest_history_fits_mainnet_limits() {
    let w = setup(YEAR);
    let seeder = w.new_user(5_000 * USDC);
    w.vault().seed(&seeder, &(5_000 * USDC));
    let user = w.new_user(500 * USDC);
    let id = w.vault().deposit(&user, &(500 * USDC));

    // ~180 daily harvest cycles — half a year of upkeep on a 1-year market.
    let added = build_harvest_positions(&w, 180, 24 * 60 * 60);
    assert!(added > 100, "the scenario must really build a long list (got {})", added);

    warp_to(&w, w.maturity + 1);
    w.env().cost_estimate().disable_resource_limits();
    w.env().cost_estimate().budget().reset_unlimited();
    let paid = w.vault().redeem(&id);
    assert!(paid > 500 * USDC, "the receipt still pays out in full");

    let r = last_resources(&w);
    report(&std::format!("redeem, {} positions", added + 2), r);
    assert!(r.0 <= MAINNET_INSTRUCTIONS, "redeem exceeds the mainnet instruction limit: {}", r.0);
    assert!(r.1 <= MAINNET_MEM_BYTES, "redeem exceeds the mainnet memory limit: {}", r.1);
    assert!(r.2 <= MAINNET_WRITE_ENTRIES, "redeem exceeds the mainnet write-entry limit: {}", r.2);
    assert!(r.3 <= MAINNET_LEDGER_ENTRIES, "redeem exceeds the mainnet ledger-entry limit: {}", r.3);
    assert!(r.4 <= MAINNET_WRITE_BYTES, "redeem exceeds the mainnet write-byte limit: {}", r.4);
    // The `Positions` Vec shares one instance entry with all vault config, and
    // that entry is rewritten by every op — so its size is the real ceiling on
    // how many positions the vault can ever track.
    assert!(
        r.4 <= MAINNET_MAX_ENTRY_BYTES,
        "the instance entry (holding the Positions Vec) exceeds the per-entry limit: {}",
        r.4
    );
}

/// §9 / §0.4 (corrected) — the harvest side is where the budget actually breaks.
///
/// `redeem`'s walk turns out to be cheap (see above: 182 tracked positions ⇒ ~1.3%
/// of the instruction budget). The real breach is in `harvest`, the function that
/// was *built* to be the bounded one: `MAX_HARVEST_BATCH = 50` is far past what a
/// mainnet transaction can carry, because each batch item is a full
/// vault→wrapper→strategy→Blend `claim_yield` with a real pool withdraw, and each
/// Blend `submit` costs ~8 MB of modelled memory against a 40 MiB tx ceiling.
///
/// This scans batch sizes and pins the largest one that fits every mainnet ceiling,
/// so `MAX_HARVEST_BATCH` (and whatever ops passes) can be set from a measured
/// number instead of a guess.
#[test]
fn harvest_batch_size_that_fits_mainnet_limits() {
    let w = setup(YEAR);
    let seeder = w.new_user(5_000 * USDC);
    w.vault().seed(&seeder, &(5_000 * USDC));
    let added = build_harvest_positions(&w, 60, 24 * 60 * 60);
    assert!(added >= 50, "need >=50 positions to fill a max batch (got {})", added);

    let mut largest_ok = 0u32;
    let mut smallest_bad = u32::MAX;
    for batch in [1u32, 2, 3, 4, 5, 10, 25, 50] {
        w.advance(24 * 60 * 60);
        w.env().cost_estimate().disable_resource_limits();
        w.env().cost_estimate().budget().reset_unlimited();
        let (claimed, _) = w.vault().harvest(&batch);
        assert!(claimed > 0, "batch {} claimed nothing", batch);
        let r = last_resources(&w);
        report(&std::format!("harvest({})", batch), r);
        let fits = r.0 <= MAINNET_INSTRUCTIONS
            && r.1 <= MAINNET_MEM_BYTES
            && r.2 <= MAINNET_WRITE_ENTRIES
            && r.3 <= MAINNET_LEDGER_ENTRIES
            && r.4 <= MAINNET_WRITE_BYTES;
        if fits {
            largest_ok = largest_ok.max(batch);
        } else {
            smallest_bad = smallest_bad.min(batch);
        }
    }
    std::println!(
        "LARGEST harvest batch fitting every mainnet limit: {} | smallest failing: {} | \
         MAX_HARVEST_BATCH is {}",
        largest_ok,
        smallest_bad,
        50
    );

    // The finding, asserted so it cannot silently regress: the contract's own
    // documented ceiling is NOT a safe batch size on a mainnet transaction.
    assert!(largest_ok >= 1, "even a 1-position harvest must fit a mainnet tx");
    assert!(
        smallest_bad <= 50,
        "MAX_HARVEST_BATCH = 50 now fits mainnet limits — update this test and the constant"
    );
}

// --------------------------------------------------------------------------
// §0 P0 — `vault_dust_tolerance_does_not_grow_with_receipt_churn`
//
// The vault's `assert_solvent` dust band is `peek_next_receipt_id + 2`, which is
// MONOTONIC — the exact gameable pattern the wrapper already fixed (its band is
// now `open_positions + 4`, anchored to live state). Every receipt ever issued
// widens the vault's solvency tolerance by 1 stroop, forever, even after it is
// redeemed and closed.
// --------------------------------------------------------------------------

/// Read the vault's live solvency dust band from inside its own storage context.
fn vault_dust_band(w: &World) -> i128 {
    w.env()
        .as_contract(&w.vault, || crate::storage::peek_next_receipt_id(w.env()) as i128 + 2)
}

/// Count receipts that are still open — what the band SHOULD be anchored to.
fn open_receipts(w: &World, next_id: u64) -> i128 {
    let mut n = 0i128;
    for id in 0..next_id {
        if let Ok(Ok(r)) = w.vault().try_get_receipt(&id) {
            if r.open {
                n += 1;
            }
        }
    }
    n
}

#[test]
fn vault_dust_band_grows_without_bound_under_receipt_churn() {
    let w = setup(YEAR);
    let seeder = w.new_user(5_000 * USDC);
    w.vault().seed(&seeder, &(5_000 * USDC));

    let band_start = vault_dust_band(&w);
    assert_eq!(band_start, 2, "a fresh vault's band is just the fixed slack");

    // Churn: 25 deposit → (mature) → redeem cycles. Every receipt is CLOSED again,
    // so the live obligation returns to zero each time.
    let mut ids = std::vec::Vec::new();
    for _ in 0..25 {
        let u = w.new_user(20 * USDC);
        ids.push(w.vault().deposit(&u, &(20 * USDC)));
    }
    warp_to(&w, w.maturity + 1);
    for id in &ids {
        w.env().cost_estimate().budget().reset_unlimited();
        w.vault().redeem(id);
    }

    // Every receipt is closed and the liability is zero…
    assert_eq!(w.vault().stats().total_liability, 0);
    assert_eq!(open_receipts(&w, 25), 0, "no receipt is still open");

    // …yet the solvency tolerance has widened by one stroop per receipt EVER
    // issued and never shrinks back. This is the ungameable-band property the
    // wrapper has and the vault does not.
    let band_end = vault_dust_band(&w);
    assert_eq!(band_end, 25 + 2, "band == peek_next_receipt_id + 2");
    assert!(
        band_end > band_start,
        "the band is monotonic in history: {} -> {}",
        band_start,
        band_end
    );
    std::println!(
        "vault dust band after 25 closed receipts: {} (open receipts: {}) — wrapper-style \
         anchoring would give {}",
        band_end,
        open_receipts(&w, 25),
        open_receipts(&w, 25) + 2
    );
}

/// The wrapper's equivalent churn leaves ITS band flat — the direct contrast that
/// shows this is a vault-specific regression, not an accepted protocol-wide rule.
#[test]
fn wrapper_band_stays_flat_where_the_vault_band_grows() {
    let w = setup(YEAR);
    // 10 open-then-close wrapper cycles via the vault's seed path would leave
    // positions open, so drive the wrapper directly.
    for _ in 0..10 {
        let u = w.new_user(10 * USDC);
        let id = w.wrapper().mint(&u, &(10 * USDC));
        w.wrapper().combine_and_redeem(&id, &(10 * USDC));
    }
    // Every position closed → the wrapper's `open_positions` basis is back to 0,
    // so its tolerance is unchanged. Solvency still holds under the tight band.
    let (backing, principal, _) = w.wrapper().solvency();
    assert!(
        backing + 5 >= principal,
        "wrapper stays solvent under a TIGHT band after churn: {} vs {}",
        backing,
        principal
    );
}


// --------------------------------------------------------------------------
// Surfaced while writing §0.4: `harvest` REVERTS when the yield it claims is
// too small to mint a Blend share.
//
// `harvest` claims the yield, then reinvests it via `wrapper::mint(claimed)`.
// At `b_rate > 1` a 1-stroop supply floors to 0 shares and **Blend itself**
// rejects the request, reverting the whole harvest. There is no lower bound
// check and no "skip the reinvest if it's dust" path, so a vault whose harvest
// cadence outruns its accrual is stuck: every `harvest` call reverts until
// enough yield piles up. On mainnet `b_rate ≈ 1.124`, so this is live from
// block one, and `harvest` is the permissionless upkeep that funds all coupons.
// --------------------------------------------------------------------------

#[test]
fn harvest_reverts_when_claimed_yield_is_below_one_blend_share() {
    let w = setup(YEAR);
    let seeder = w.new_user(100 * USDC);
    w.vault().seed(&seeder, &(100 * USDC));

    // Two seconds of accrual on a 100 USDC position yields exactly 1 stroop.
    w.advance(2);
    w.env().cost_estimate().budget().reset_unlimited();
    assert_eq!(
        w.wrapper().position_value(&0u64).claimable_yield,
        1,
        "precondition: exactly 1 stroop of claimable yield"
    );

    // Harvest claims that 1 stroop and then tries to reinvest it — Blend refuses
    // to mint 0 shares for a 1-stroop supply and the whole call reverts.
    let r = w.vault().try_harvest(&50u32);
    assert!(
        r.is_err(),
        "harvest must be shown to revert on a dust-sized reinvest, not silently succeed"
    );

    // Nothing was applied — the claim is rolled back with the reinvest.
    assert_eq!(
        w.wrapper().position_value(&0u64).claimable_yield,
        1,
        "the claim reverted with the mint; the yield is still unclaimed"
    );

    // Once enough yield accrues (≥ 2 stroops of mintable size), it works again.
    w.advance(60);
    w.env().cost_estimate().budget().reset_unlimited();
    let (claimed, added) = w.vault().harvest(&50u32);
    assert!(claimed > 1, "harvest recovers once the yield exceeds the dust floor");
    assert_eq!(claimed, added);
}

/// The same dust floor bites the round-robin cursor: a `harvest(1)` batch that
/// lands on a small position can claim 1 stroop and revert, even when sweeping
/// the whole list at once would have claimed plenty. So the paginated form —
/// the one built for bounded cost — is the more fragile one.
#[test]
fn paginated_harvest_can_revert_on_a_dust_sized_position() {
    let w = setup(YEAR);
    let seeder = w.new_user(100 * USDC);
    w.vault().seed(&seeder, &(100 * USDC)); // position #0, 100 USDC
    // A deliberately tiny second position (a stand-in for a small harvest position).
    let dust_seeder = w.new_user(1 * USDC);
    w.vault().seed(&dust_seeder, &(5000i128)); // position #1, 0.0005 USDC

    // Sweep both so the cursor lands back on #0, then park it on #1.
    w.advance(24 * 60 * 60);
    w.env().cost_estimate().budget().reset_unlimited();
    w.vault().harvest(&1u32); // claims #0 (large) -> cursor now at #1

    // Two seconds later position #1's accrual is far below one share.
    w.advance(2);
    w.env().cost_estimate().budget().reset_unlimited();
    let r = w.vault().try_harvest(&1u32);
    // Either it claims 0 (clean early return) or it reverts on the dust mint —
    // both are pinned here; the point is it can never claim a useful amount.
    match r {
        Ok(Ok((claimed, _))) => assert_eq!(
            claimed, 0,
            "a dust position can only ever yield 0 or a reverting dust mint"
        ),
        Ok(Err(_)) | Err(_) => { /* reverted on the dust reinvest — the finding */ }
    }
}
