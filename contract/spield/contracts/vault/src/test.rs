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
    let wrapper = env.register(Wrapper, ());
    let strategy = env.register(BlendStrategy, ());
    BlendStrategyClient::new(&env, &strategy).initialize(&admin, &wrapper, &pool, &usdc, &30_000u32);

    let pt = register_sac(&env, &wrapper);
    let yt = register_sac(&env, &wrapper);

    let maturity = env.ledger().timestamp() + maturity_secs_from_now;
    WrapperClient::new(&env, &wrapper).initialize(&admin, &strategy, &pt, &yt, &maturity);

    // The vault sits on top of the wrapper.
    let vault = env.register(Vault, ());
    VaultClient::new(&env, &vault).initialize(&admin, &wrapper, &usdc, &RATE_BPS, &MAX_RATE_BPS);

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
    let admin = Address::generate(w.env());
    w.vault().initialize(&admin, &w.wrapper, &w.usdc, &RATE_BPS, &MAX_RATE_BPS);
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
