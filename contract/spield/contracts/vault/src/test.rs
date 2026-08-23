#![cfg(test)]
//! # Fixed-Rate Vault test suite — end-to-end vs the real Blend v2 WASM
//!
//! Same harness shape as the wrapper's §7.4 suite: a live Blend pool (XLM collateral + USDC
//! borrowable so the USDC `b_rate` actually rises), the real strategy adapter, the real wrapper
//! with PT/YT SACs it admins, and the vault sitting on top of the wrapper. No mocks of Blend or of
//! our own contracts. We prove the flagship property: **a user locks a fixed return and always gets
//! it, and the vault is solvent (PT inventory ≥ liabilities) after every operation.**

extern crate std;

use crate::{Vault, VaultClient, MAX_HARVEST_BATCH, MIN_HEADROOM_PCT, MIN_REINVEST, REDEEM_DUST};
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
    /// The pool's collateral reserve, needed by tests that drive Blend utilization.
    xlm: Address,
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

    World { env, pool, usdc, xlm, oracle_id, wrapper, vault, pt, yt, maturity }
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
    // The vault held no resting USDC, so the full sweep equals this call's claim.
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

// --------------------------------------------------------------------------
// Post-maturity `redeem` must not strand USDC.
//
// `redeem` collects whatever Blend's withdraw actually returned (`got`) and used to
// forward `min(got, payout)`. Blend's share math rounds in BOTH directions — a withdraw
// burns `ceil(amount / b_rate)` shares and the strategy forwards the real balance delta —
// so `got` can land a stroop or two ABOVE the payout, and that excess was left in the
// vault. Unlike harvest's resting balance (swept by the next harvest, above), this residue
// is unreachable forever: `harvest` is gated BEFORE maturity and `redeem` only runs at or
// after it, so no code path can ever collect it again.
//
// The fix pays the collected amount out whenever it is within the dust band. The invariant
// this pins is the one that matters for a post-maturity balance reconciliation: **winding
// the vault down leaves nothing behind.**
// --------------------------------------------------------------------------

/// Every branch of the settlement rule, directly. The end-to-end test below proves the
/// invariant against real Blend, but real Blend never returns more than it was asked for,
/// so the over-collection branch is dead there — and it is exactly the branch the fix
/// adds. A pure function lets it be pinned without waiting for a pool build that rounds
/// the other way.
#[test]
fn settle_redeem_forwards_dust_in_both_directions() {
    let payout = 100 * USDC;

    // Exact: the overwhelmingly common case.
    assert_eq!(crate::settle_redeem(payout, payout), Ok(payout));

    // Short within the band: pay what was collected, close the receipt.
    for short in 1..=REDEEM_DUST {
        assert_eq!(
            crate::settle_redeem(payout - short, payout),
            Ok(payout - short),
            "a {}-stroop shortfall is rounding and must still settle",
            short
        );
    }
    // Short past the band: an accounting fault, not rounding.
    assert_eq!(
        crate::settle_redeem(payout - REDEEM_DUST - 1, payout),
        Err(spield_shared::Error::WithdrawShortfall)
    );

    // Over within the band: pay it out rather than strand it. THIS is the fix — under the
    // old `min(got, payout)` each of these returned `payout` and left the rest in a vault
    // that nothing can ever sweep again.
    for over in 1..=REDEEM_DUST {
        assert_eq!(
            crate::settle_redeem(payout + over, payout),
            Ok(payout + over),
            "a {}-stroop over-collection must go to the owner, not be stranded",
            over
        );
    }
    // Over past the band: not rounding, so not the owner's.
    assert_eq!(
        crate::settle_redeem(payout + REDEEM_DUST + 1, payout),
        Ok(payout),
        "a larger-than-dust surplus must not be handed over"
    );
    assert_eq!(crate::settle_redeem(payout * 2, payout), Ok(payout));
}

#[test]
fn redeem_strands_no_usdc_in_the_vault() {
    let w = setup(YEAR);
    let seeder = w.new_user(1_000 * USDC);
    w.vault().seed(&seeder, &(1_000 * USDC));

    // Several receipts, and several tracked positions for `redeem_pt_for` to walk — each
    // Blend withdraw it performs is an independent chance to round.
    let mut users = std::vec::Vec::new();
    let mut ids = std::vec::Vec::new();
    let mut payouts = std::vec::Vec::new();
    for _ in 0..5 {
        let user = w.new_user(100 * USDC);
        let (payout, _, _) = w.vault().quote(&(100 * USDC));
        ids.push(w.vault().deposit(&user, &(100 * USDC)));
        users.push(user);
        payouts.push(payout);
    }
    // Harvests add more tracked positions, so a single redeem spans several of them.
    for _ in 0..3 {
        w.advance(30 * 24 * 60 * 60);
        w.env().cost_estimate().budget().reset_unlimited();
        w.vault().harvest(&u32::MAX);
    }
    // Sweep any harvest-resting USDC into PT so the only balance movement left is redeem's.
    w.advance(30 * 24 * 60 * 60);
    w.env().cost_estimate().budget().reset_unlimited();
    w.vault().harvest(&u32::MAX);
    let resting_before = w.usdc().balance(&w.vault);

    w.env().ledger().set_timestamp(w.maturity + 1);
    w.oracle().set_price_stable(&vec![w.env(), 1_0000000, 1_0000000]);

    let mut total_excess = 0i128;
    for (i, id) in ids.iter().enumerate() {
        w.env().cost_estimate().budget().reset_unlimited();
        let before = w.usdc().balance(&users[i]);
        let paid = w.vault().redeem(id);
        let received = w.usdc().balance(&users[i]) - before;

        assert_eq!(paid, received, "receipt {} reported {} but moved {}", i, paid, received);
        // Never short-changed…
        assert!(
            paid >= payouts[i],
            "receipt {} paid {} < its locked payout {}",
            i,
            paid,
            payouts[i]
        );
        // …and never handed more than rounding dust.
        assert!(
            paid - payouts[i] <= REDEEM_DUST,
            "receipt {} paid {} — {} over its payout {}, beyond the {} dust band",
            i,
            paid,
            paid - payouts[i],
            payouts[i],
            REDEEM_DUST
        );
        total_excess += paid - payouts[i];

        // THE POINT: every redeem forwards everything it collected. Nothing accumulates.
        assert_eq!(
            w.usdc().balance(&w.vault),
            resting_before,
            "receipt {} left USDC resting in the vault — post-maturity, nothing can ever \
             sweep it (harvest is gated before maturity)",
            i
        );
    }

    assert_eq!(w.vault().stats().total_liability, 0, "every receipt closed");
    std::println!(
        "redeem rounding excess paid out across {} receipts: {} stroops (vault residue: {})",
        ids.len(),
        total_excess,
        w.usdc().balance(&w.vault) - resting_before,
    );
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
    let mut total_added = 0i128;
    for _ in 0..5 {
        w.env().cost_estimate().budget().reset_unlimited();
        let (claimed, pt_added) = w.vault().harvest(&2u32); // bounded batch
        total_claimed += claimed;
        total_added += pt_added;
    }
    // Conservation across the whole sweep: every stroop claimed is either already reinvested as PT
    // or still resting in the vault awaiting the next harvest. Nothing leaks. (A single call may
    // hold its claim back below MIN_REINVEST; a later call sweeps the full balance, not a delta.)
    let resting = w.usdc().balance(&w.vault);
    assert_eq!(
        total_claimed,
        total_added + resting,
        "claimed {} != reinvested {} + resting {}",
        total_claimed,
        total_added,
        resting
    );
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
// §0 P0 (fixed) — `vault_harvest_reverts_while_wrapper_paused`
//
// `harvest` is upkeep, so the vault's OWN pause lets it through. But its reinvest
// step calls `wrapper::mint`, which the WRAPPER's pause blocks — so pausing the
// wrapper (the natural first move in an emergency) used to revert the whole call,
// throwing away the yield the same call had already claimed, with a `Paused` error
// pointing at the wrong contract.
//
// The fix: harvest CLAIMS as normal and SKIPS the reinvest while the wrapper is
// paused, holding the USDC. The next harvest after the unpause sweeps it into PT
// (it reinvests the full balance, not a delta). A wrapper pause now DEFERS
// coupon-capacity upkeep instead of destroying claimed yield.
// --------------------------------------------------------------------------

#[test]
fn vault_harvest_defers_the_reinvest_while_wrapper_is_paused() {
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

    let cap_before = w.vault().stats().coupon_capacity;

    // Harvest succeeds: the claim goes through, the reinvest is skipped.
    let (claimed, added) = w.vault().harvest(&u32::MAX);
    assert!(claimed > 0, "the claim leg must still run under a wrapper pause");
    assert_eq!(added, 0, "the reinvest leg must be skipped, not attempted");
    assert!(
        claimed >= MIN_REINVEST,
        "precondition: the claim is big enough that only the pause can be holding it back ({})",
        claimed
    );

    // The claimed USDC is held in the vault — not lost to a revert, not yet PT.
    assert_eq!(
        w.usdc().balance(&w.vault),
        claimed,
        "claimed yield rests in the vault while the wrapper is paused"
    );
    assert_eq!(
        w.vault().stats().coupon_capacity,
        cap_before,
        "capacity is unchanged until the USDC can be reinvested"
    );
    let stats = w.vault().stats();
    assert!(stats.pt_inventory >= stats.total_liability, "solvent throughout");

    // Unpausing restores the reinvest, and the HELD balance is swept along with
    // whatever the next call claims — nothing was stranded by the pause.
    w.wrapper().unpause();
    w.env().cost_estimate().budget().reset_unlimited();
    let (claimed2, added2) = w.vault().harvest(&u32::MAX);
    assert_eq!(
        added2,
        claimed + claimed2,
        "the post-unpause harvest must reinvest the held balance plus its own claim"
    );
    assert_eq!(w.usdc().balance(&w.vault), 0, "nothing left resting");
    assert!(
        w.vault().stats().coupon_capacity > cap_before,
        "deferred capacity lands once the wrapper is unpaused"
    );
}

/// The benign half: with **no yield to reinvest** there is no `wrapper::mint` to
/// attempt at all, so harvest is a genuine no-op under a wrapper pause. Pinned to
/// keep the two skip reasons (nothing to invest vs. paused) distinguishable.
#[test]
fn vault_harvest_with_zero_yield_succeeds_under_wrapper_pause() {
    let w = setup(YEAR);
    let seeder = w.new_user(100 * USDC);
    w.vault().seed(&seeder, &(100 * USDC));
    w.wrapper().pause();

    // No time has passed → nothing accrued → nothing to reinvest.
    let (claimed, added) = w.vault().harvest(&u32::MAX);
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

/// How many wrapper positions the vault currently tracks (read from its own storage — the
/// `Positions` Vec has no public view).
/// The vault's tracked wrapper-position ids, read straight from its storage.
fn tracked_position_ids(w: &World) -> std::vec::Vec<u64> {
    w.env().as_contract(&w.vault, || {
        crate::storage::positions(w.env()).iter().collect::<std::vec::Vec<u64>>()
    })
}

fn tracked_positions(w: &World) -> u32 {
    w.env()
        .as_contract(&w.vault, || crate::storage::positions(w.env()).len())
}

/// Run `cycles` harvests spread over the term, each appending a tracked position when its claim
/// clears `MIN_REINVEST`. Resource-limit enforcement is disabled while BUILDING the scenario (the
/// setup itself is not what we are measuring); the measured call re-enables it. Returns the real
/// tracked-position count afterwards, read from storage rather than inferred from return values.
fn build_harvest_positions(w: &World, cycles: u32, step_secs: u64) -> u32 {
    w.env().cost_estimate().disable_resource_limits();
    for _ in 0..cycles {
        w.advance(step_secs);
        w.env().cost_estimate().budget().reset_unlimited();
        w.vault().harvest(&u32::MAX); // clamped to MAX_HARVEST_BATCH internally
    }
    tracked_positions(w)
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
    report(&std::format!("redeem, {} positions", n_few), few);
    report(&std::format!("redeem, {} positions", n_many), many);

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

    // Daily harvest cycles across most of the 1-year term. Note a cycle does not always
    // append a position: the batch only mints when its claim clears `MIN_REINVEST`, and as
    // the list fills with small reinvest positions the round-robin cursor lands on a
    // large one less often. So the cycle count is comfortably above the position count —
    // it is `tracked`, read from real storage below, that the assertions are about.
    let tracked = build_harvest_positions(&w, 340, 24 * 60 * 60);
    assert!(tracked > 100, "the scenario must really build a long list (got {})", tracked);

    warp_to(&w, w.maturity + 1);
    w.env().cost_estimate().disable_resource_limits();
    w.env().cost_estimate().budget().reset_unlimited();
    let paid = w.vault().redeem(&id);
    assert!(paid > 500 * USDC, "the receipt still pays out in full");

    let r = last_resources(&w);
    report(&std::format!("redeem, {} positions", tracked), r);
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
/// of the instruction budget). The real breach was in `harvest`, the function that
/// was *built* to be the bounded one: the old `MAX_HARVEST_BATCH = 50` was far past
/// what a mainnet transaction can carry, because each batch item is a full
/// vault→wrapper→strategy→Blend `claim_yield` with a real pool withdraw, and each
/// Blend `submit` costs ~8 MB of modelled memory against a 40 MiB tx ceiling.
///
/// This is the acceptance test for the fix. It asserts three things about the shipped
/// constant, all from measurement rather than assertion-by-comment:
///   1. **It is safe** — a full `MAX_HARVEST_BATCH` sweep fits every mainnet ceiling.
///   2. **It keeps its margin** — the full batch leaves at least `MIN_HEADROOM_PCT` of
///      the memory ceiling free. "It fits" is not the bar: `harvest` is permissionless
///      upkeep, and the cost of a batch item is set by Blend, so a constant that only
///      just fits today can become un-runnable under a pool upgrade we do not control.
///   3. **It is not needlessly small** — one more batch item *would* breach that margin,
///      so 3 is the largest value satisfying the policy, not an arbitrary retreat.
/// Plus that the clamp is real: no caller-supplied `max_positions` can exceed it.
///
/// (2) and (3) together pin the constant from both sides: the margin cannot be silently
/// eroded, and it cannot be silently over-paid either.
///
/// The scenario is deliberately built as the **worst case**, because harvest cost is
/// not a function of batch size alone: a swept position with no accrued yield skips
/// the Blend withdraw entirely and costs almost nothing, and a claim below
/// `MIN_REINVEST` skips the reinvest `submit` too. Measuring a mixed batch would
/// under-report and let a genuinely unsafe constant pass. So we seed several large,
/// equal positions and let them all accrue: every position in every measured batch
/// performs a real Blend withdraw, plus the one reinvest — which is exactly the
/// shape of the most expensive harvest a mainnet caller can trigger.
#[test]
fn harvest_batch_size_that_fits_mainnet_limits() {
    let w = setup(YEAR);
    // One position per seed, each big enough that a day of accrual is far above the
    // reinvest floor — so no claim in any measured batch can be a cheap no-op.
    let n_positions = MAX_HARVEST_BATCH * 2 + 1;
    for _ in 0..n_positions {
        let seeder = w.new_user(500 * USDC);
        w.vault().seed(&seeder, &(500 * USDC));
    }
    assert_eq!(tracked_positions(&w), n_positions);
    // A month of real Blend interest on every one of them.
    w.advance(30 * 24 * 60 * 60);

    // Measure every batch size up to and including the shipped ceiling.
    let mut mem = std::vec::Vec::new();
    for batch in 1..=MAX_HARVEST_BATCH {
        w.advance(24 * 60 * 60);
        w.env().cost_estimate().disable_resource_limits();
        w.env().cost_estimate().budget().reset_unlimited();
        let (claimed, added) = w.vault().harvest(&batch);
        assert!(claimed > 0, "batch {} claimed nothing", batch);
        assert!(added > 0, "batch {} must also pay the reinvest cost (worst case)", batch);
        let r = last_resources(&w);
        report(&std::format!("harvest({})", batch), r);
        // (1) Every batch up to the ceiling fits a real mainnet transaction.
        assert!(r.0 <= MAINNET_INSTRUCTIONS, "harvest({}) over instructions: {}", batch, r.0);
        assert!(r.1 <= MAINNET_MEM_BYTES, "harvest({}) over memory: {}", batch, r.1);
        assert!(r.2 <= MAINNET_WRITE_ENTRIES, "harvest({}) over write entries: {}", batch, r.2);
        assert!(r.3 <= MAINNET_LEDGER_ENTRIES, "harvest({}) over ledger entries: {}", batch, r.3);
        assert!(r.4 <= MAINNET_WRITE_BYTES, "harvest({}) over write bytes: {}", batch, r.4);
        mem.push(r.1);
    }

    // Memory is the binding constraint — instructions never come close, which is why
    // reasoning about loop counts alone missed this. Extrapolate one more batch item from
    // the measured marginal cost to judge the next size up.
    let full = *mem.last().unwrap();
    let marginal = (full - mem[0]) / (MAX_HARVEST_BATCH as i64 - 1);
    let headroom = MAINNET_MEM_BYTES - full;
    let headroom_pct = headroom * 100 / MAINNET_MEM_BYTES;
    let next = full + marginal;
    let next_headroom_pct = (MAINNET_MEM_BYTES - next) * 100 / MAINNET_MEM_BYTES;
    std::println!(
        "harvest({}) mem {}/{} = {}% of the ceiling | marginal ≈ {} bytes per extra position",
        MAX_HARVEST_BATCH,
        full,
        MAINNET_MEM_BYTES,
        full * 100 / MAINNET_MEM_BYTES,
        marginal,
    );
    // Surface the margin on every run, so erosion is visible long before either assertion
    // below flips.
    std::println!(
        "HEADROOM at a full batch: {} bytes ({}%), policy floor {}%. Batch {} would leave \
         {}% ({}).",
        headroom,
        headroom_pct,
        MIN_HEADROOM_PCT,
        MAX_HARVEST_BATCH + 1,
        next_headroom_pct,
        if next > MAINNET_MEM_BYTES { "over the ceiling outright" } else { "fits, but under the policy floor" },
    );

    // (2) The margin is intact. This is the assertion that fires if Blend's per-`submit`
    // cost rises: it goes red while `harvest` still works, which is the entire point of
    // holding margin rather than shipping the maximal value.
    assert!(
        headroom_pct >= MIN_HEADROOM_PCT,
        "MAX_HARVEST_BATCH = {} now leaves only {}% memory headroom, below the {}% policy \
         floor ({} of {} bytes used). Blend's per-submit cost has risen — lower the constant.",
        MAX_HARVEST_BATCH,
        headroom_pct,
        MIN_HEADROOM_PCT,
        full,
        MAINNET_MEM_BYTES
    );

    // (3) …and it is not over-paid: the next size up would breach the policy, so this is
    // the largest batch that satisfies it. Without this, the constant could drift down to
    // 1 and nothing would notice.
    assert!(
        next_headroom_pct < MIN_HEADROOM_PCT,
        "MAX_HARVEST_BATCH = {} is needlessly small: batch {} would still clear the {}% \
         policy floor ({} of {} bytes, {}% free). Re-measure and raise the constant.",
        MAX_HARVEST_BATCH,
        MAX_HARVEST_BATCH + 1,
        MIN_HEADROOM_PCT,
        next,
        MAINNET_MEM_BYTES,
        next_headroom_pct
    );

    // (3) The clamp is real: an oversized `max_positions` costs exactly a full batch,
    // never more. This is what makes the ceiling a guarantee rather than a suggestion.
    w.advance(24 * 60 * 60);
    w.env().cost_estimate().disable_resource_limits();
    w.env().cost_estimate().budget().reset_unlimited();
    w.vault().harvest(&u32::MAX);
    let clamped = last_resources(&w);
    report("harvest(u32::MAX) [clamped]", clamped);
    assert!(
        clamped.1 <= MAINNET_MEM_BYTES,
        "an oversized max_positions must be clamped to a mainnet-safe batch, got {} bytes",
        clamped.1
    );
}

// --------------------------------------------------------------------------
// §0 P0 (fixed) — `vault_dust_tolerance_does_not_grow_with_receipt_churn`
//
// The vault's `assert_solvent` dust band used to be `peek_next_receipt_id + 2`,
// which is MONOTONIC — the exact gameable pattern the wrapper had already fixed
// (its band is `open_positions + 4`, anchored to live state). Every receipt ever
// issued widened the vault's solvency tolerance by 1 stroop forever, even after it
// was redeemed and closed. It is now `open_receipts + 2`: it rises with live
// obligations and falls back as they close.
// --------------------------------------------------------------------------

/// Read the vault's live solvency dust band from inside its own storage context.
fn vault_dust_band(w: &World) -> i128 {
    w.env()
        .as_contract(&w.vault, || crate::storage::open_receipts(w.env()) as i128 + 2)
}

/// The monotonic quantity the band used to be anchored to — kept so the test can
/// show the two diverging rather than just asserting the new value.
fn receipts_ever_issued(w: &World) -> u64 {
    w.env()
        .as_contract(&w.vault, || crate::storage::peek_next_receipt_id(w.env()))
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
fn vault_dust_band_returns_to_baseline_after_receipt_churn() {
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

    // While they are all open the band DOES widen — that is correct, each live
    // receipt can carry a stroop of mint-floor dust.
    assert_eq!(
        vault_dust_band(&w),
        25 + 2,
        "the band tracks live obligations while they exist"
    );

    warp_to(&w, w.maturity + 1);
    for id in &ids {
        w.env().cost_estimate().budget().reset_unlimited();
        w.vault().redeem(id);
    }

    // Every receipt is closed and the liability is zero…
    assert_eq!(w.vault().stats().total_liability, 0);
    assert_eq!(open_receipts(&w, 25), 0, "no receipt is still open");

    // …so the tolerance falls back to the baseline. Under the old monotonic
    // anchoring it would have stayed at 27 forever.
    let band_end = vault_dust_band(&w);
    assert_eq!(band_end, 2, "band == open_receipts + 2, and none are open");
    assert_eq!(
        band_end, band_start,
        "the band must be a function of LIVE state, not of history: {} -> {}",
        band_start, band_end
    );

    // The monotonic counter kept climbing — proving the band is genuinely no longer
    // anchored to it, rather than the churn having failed to happen.
    let ever = receipts_ever_issued(&w);
    assert_eq!(ever, 25, "the receipts really were issued");
    std::println!(
        "after 25 issued-and-closed receipts: band = {} (open receipts 0); the old \
         next_receipt_id anchoring would give {}",
        band_end,
        ever + 2
    );

    // The tight band is not just cosmetic — the vault still passes its own solvency
    // assertion under it. (`redeem` runs `assert_solvent` after every close above,
    // so reaching this line already proves it; assert the margin explicitly too.)
    let stats = w.vault().stats();
    assert!(
        stats.pt_inventory + band_end >= stats.total_liability,
        "solvency must hold under the TIGHT band: inventory {} liability {}",
        stats.pt_inventory,
        stats.total_liability
    );
}

/// The anchor's two load-bearing properties, checked directly on the counter: it
/// returns to baseline however far it has been driven (so no amount of churn can
/// inflate the band), and its decrement saturates (so an underflow can never wrap
/// into a `u64::MAX`-sized tolerance that would swallow a real accounting bug).
#[test]
fn open_receipt_counter_is_live_state_and_saturates() {
    let w = setup(YEAR);
    w.env().as_contract(&w.vault, || {
        let e = w.env();
        assert_eq!(crate::storage::open_receipts(e), 0);
        for _ in 0..1_000 {
            crate::storage::inc_open_receipts(e);
        }
        assert_eq!(crate::storage::open_receipts(e), 1_000);
        for _ in 0..1_000 {
            crate::storage::dec_open_receipts(e);
        }
        assert_eq!(
            crate::storage::open_receipts(e),
            0,
            "the counter must return to baseline no matter how far it was driven"
        );
        // Defence-in-depth: an extra decrement must not wrap the band wide open.
        crate::storage::dec_open_receipts(e);
        assert_eq!(crate::storage::open_receipts(e), 0, "decrement must saturate at 0");
    });
}

/// The wrapper's equivalent churn leaves ITS band flat too — the direct contrast that
/// showed this was a vault-specific regression, kept now that both agree.
#[test]
fn wrapper_band_stays_flat_under_the_same_churn() {
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
// Surfaced while writing §0.4 (fixed): `harvest` used to REVERT when the yield it
// claimed was too small to mint a Blend share.
//
// `harvest` claims the yield, then reinvests it via `wrapper::mint`. At
// `b_rate > 1` a 1-stroop supply floors to 0 shares and **Blend itself** rejects
// the request, which reverted the whole harvest — including the claim that had
// already succeeded. With no lower-bound check, a vault whose harvest cadence
// outran its accrual was stuck: every call reverted until enough yield piled up.
// On mainnet `b_rate ≈ 1.124`, so this was live from block one, and `harvest` is
// the permissionless upkeep that funds every coupon.
//
// The fix: a `MIN_REINVEST` floor checked BEFORE the mint. Below it the harvest
// keeps the USDC and returns cleanly; the next harvest that clears the floor
// reinvests the whole resting balance.
// --------------------------------------------------------------------------

#[test]
fn harvest_holds_dust_instead_of_reverting_below_one_blend_share() {
    let w = setup(YEAR);
    let seeder = w.new_user(100 * USDC);
    w.vault().seed(&seeder, &(100 * USDC));

    // Two seconds of accrual on a 100 USDC position yields exactly 1 stroop —
    // the exact boundary that used to brick the call.
    w.advance(2);
    w.env().cost_estimate().budget().reset_unlimited();
    assert_eq!(
        w.wrapper().position_value(&0u64).claimable_yield,
        1,
        "precondition: exactly 1 stroop of claimable yield"
    );

    // Harvest now SUCCEEDS: it claims the stroop and skips the dust reinvest.
    let (claimed, added) = w.vault().harvest(&u32::MAX);
    assert_eq!(claimed, 1, "the stroop is claimed, not rolled back");
    assert_eq!(added, 0, "…and not fed to a mint Blend would reject");
    assert_eq!(
        w.wrapper().position_value(&0u64).claimable_yield,
        0,
        "the claim really happened — the position has nothing left to claim"
    );
    assert_eq!(w.usdc().balance(&w.vault), 1, "the stroop rests in the vault");

    // Repeated dust harvests keep accumulating rather than failing — this is the
    // "cadence outruns accrual" case that used to be a permanent revert loop.
    w.advance(2);
    w.env().cost_estimate().budget().reset_unlimited();
    let (claimed2, added2) = w.vault().harvest(&u32::MAX);
    assert_eq!(added2, 0);
    assert_eq!(
        w.usdc().balance(&w.vault),
        1 + claimed2,
        "dust accumulates across calls instead of reverting"
    );

    // Once enough accrues to clear the floor, the whole accumulated balance —
    // including every earlier stroop — is reinvested. Nothing was stranded.
    w.advance(24 * 60 * 60);
    w.env().cost_estimate().budget().reset_unlimited();
    let held = w.usdc().balance(&w.vault);
    let (claimed3, added3) = w.vault().harvest(&u32::MAX);
    assert!(claimed3 >= MIN_REINVEST, "a day of accrual clears the floor");
    assert_eq!(
        added3,
        held + claimed3,
        "the reinvest sweeps the held dust as well as the fresh claim"
    );
    assert_eq!(w.usdc().balance(&w.vault), 0, "nothing left resting");
}

/// The same dust floor used to bite the round-robin cursor hardest: a `harvest(1)`
/// batch landing on a small position could claim 1 stroop and revert, even when
/// sweeping the whole list would have claimed plenty — so the paginated form, the
/// one built for bounded cost, was the more fragile one. It must now be the
/// safest: bounded AND unbrickable.
#[test]
fn paginated_harvest_survives_a_dust_sized_position() {
    let w = setup(YEAR);
    let seeder = w.new_user(100 * USDC);
    w.vault().seed(&seeder, &(100 * USDC)); // position #0, 100 USDC
    // A deliberately tiny second position (a stand-in for a small harvest position).
    let dust_seeder = w.new_user(1 * USDC);
    w.vault().seed(&dust_seeder, &(5000i128)); // position #1, 0.0005 USDC

    // Sweep #0 so the cursor parks on the dust position #1.
    w.advance(24 * 60 * 60);
    w.env().cost_estimate().budget().reset_unlimited();
    w.vault().harvest(&1u32); // claims #0 (large) -> cursor now at #1

    // Two seconds later position #1's accrual is far below one Blend share.
    w.advance(2);
    w.env().cost_estimate().budget().reset_unlimited();
    let (claimed, added) = w.vault().harvest(&1u32);
    assert_eq!(added, 0, "a dust position must not attempt a mint Blend would reject");
    assert!(claimed >= 0);
    assert_eq!(
        w.usdc().balance(&w.vault),
        claimed,
        "whatever the dust position yielded is held, not lost"
    );

    // And the vault is not wedged: a full sweep still works immediately after.
    w.advance(24 * 60 * 60);
    w.env().cost_estimate().budget().reset_unlimited();
    let (_, added2) = w.vault().harvest(&u32::MAX);
    assert!(added2 > 0, "the vault is not stuck behind the dust position");
}

// --------------------------------------------------------------------------
// Harvested USDC that is not reinvested must NOT be stranded.
//
// `harvest` used to compute what to reinvest as a delta (`after - before`), reading
// `before` at the start of every call — so any USDC already resting in the vault was
// excluded from every future harvest and could never become coupon capacity. That was
// latent while the resting balance was always ~zero, and became a real leak the moment
// the MIN_REINVEST floor and the wrapper-pause skip started deliberately leaving USDC
// behind. The fix reinvests the vault's FULL balance.
// --------------------------------------------------------------------------

#[test]
fn resting_usdc_is_swept_by_the_next_successful_harvest() {
    let w = setup(YEAR);
    let seeder = w.new_user(1_000 * USDC);
    w.vault().seed(&seeder, &(1_000 * USDC));

    // Strand a balance the honest way: pause the wrapper, harvest (claim succeeds,
    // reinvest is skipped), unpause. Under the old delta form this USDC would be
    // invisible to every subsequent harvest.
    w.advance(30 * 24 * 60 * 60);
    w.env().cost_estimate().budget().reset_unlimited();
    w.wrapper().pause();
    let (stranded, added) = w.vault().harvest(&u32::MAX);
    w.wrapper().unpause();
    assert!(stranded > 0 && added == 0, "the scenario must really leave USDC behind");
    assert_eq!(w.usdc().balance(&w.vault), stranded);

    let cap_before = w.vault().stats().coupon_capacity;

    // The next successful harvest must mint against the FULL balance: the stranded
    // amount plus whatever it claims itself.
    w.advance(30 * 24 * 60 * 60);
    w.env().cost_estimate().budget().reset_unlimited();
    let (claimed, pt_added) = w.vault().harvest(&u32::MAX);
    assert_eq!(
        pt_added,
        stranded + claimed,
        "reinvest must mint the whole resting balance ({}), not just this call's claim ({})",
        stranded + claimed,
        claimed
    );
    assert_eq!(w.usdc().balance(&w.vault), 0, "the vault holds no un-reinvested USDC");

    // And the recovered dust really became coupon capacity, not just a bigger number.
    let cap_after = w.vault().stats().coupon_capacity;
    assert!(
        cap_after - cap_before >= stranded,
        "recovered USDC must show up as capacity: {} -> {} (stranded {})",
        cap_before,
        cap_after,
        stranded
    );

    // The event/return still reports the newly-claimed figure, so the indexer's yield
    // series stays a yield series and doesn't double-count the swept residue.
    assert!(claimed < pt_added, "yield_claimed ({}) must exclude the residue", claimed);
}

// ==========================================================================
// AUDIT ROUND (2026-08-23) — workflow probes for `tofix.md`
// ==========================================================================

/// **A-4 — a receipt can become permanently un-redeemable.**
///
/// `harvest` is paginated to [`MAX_HARVEST_BATCH`] = 3 precisely because each batch item is a full
/// vault→wrapper→strategy→Blend withdraw costing ~8 MB of modelled memory against mainnet's
/// 41,943,040-byte per-transaction ceiling. `redeem` performs the *same* per-item work in
/// `redeem_pt_for` — one `wrapper::redeem_pt` (hence one Blend `submit`) per position it draws
/// from — and is **not** paginated, has no partial-redeem path, and has no cap at all.
///
/// The existing `vault_redeem_with_a_long_harvest_history_fits_mainnet_limits` measures the case
/// where the payout is satisfied from the *first* position it touches, so cost is dominated by the
/// cheap `get_position` walk. This measures the shape the vault actually converges to: inventory
/// spread across many small positions, which is exactly what a long harvest history builds and
/// what remains once earlier receipts have drained the large ones.
#[test]
fn a_receipt_whose_payout_spans_many_positions_exceeds_the_mainnet_memory_limit() {
    let w = setup(YEAR);

    // Inventory built as many small positions — the steady state after a term of harvesting.
    let n_small = 12;
    for _ in 0..n_small {
        let seeder = w.new_user(10 * USDC);
        w.vault().seed(&seeder, &(10 * USDC));
    }
    assert_eq!(tracked_positions(&w), n_small);

    let user = w.new_user(100 * USDC);
    let id = w.vault().deposit(&user, &(100 * USDC));
    let payout = w.vault().get_receipt(&id).payout;
    assert!(payout > 100 * USDC);

    warp_to(&w, w.maturity + 1);
    w.env().cost_estimate().disable_resource_limits();
    w.env().cost_estimate().budget().reset_unlimited();
    let paid = w.vault().redeem(&id);
    assert_eq!(paid, payout, "the payout itself is correct — the cost is the problem");

    let r = last_resources(&w);
    report("redeem across 11 dust positions", r);
    std::println!(
        "A-4: redeem used {} bytes of memory = {}x the mainnet ceiling of {}",
        r.1,
        r.1 / MAINNET_MEM_BYTES,
        MAINNET_MEM_BYTES
    );
    // The finding: on a real network this transaction is rejected, and because `redeem` is
    // all-or-nothing the receipt can never be paid.
    assert!(
        r.1 > MAINNET_MEM_BYTES,
        "expected the unpaginated redeem walk to breach the memory ceiling, got {}",
        r.1
    );
}

/// **A-4b — the counter-case, recorded so the tracker states the trigger honestly.**
///
/// One big seed, a long daily-harvest history, several receipts. Here every redeem is satisfied
/// out of the *first* position it touches, so all four cost ~20% of the ceiling however long the
/// history is. The conclusion that matters: `redeem`'s cost is set by **inventory shape** — how
/// many positions a payout must be assembled from — and not by the length of the position list.
/// A long list is harmless; a *fragmented head* of the list is fatal (A-8).
#[test]
fn redeem_cost_is_set_by_inventory_shape_not_by_history_length() {
    let w = setup(YEAR);
    let seeder = w.new_user(1_000 * USDC);
    w.vault().seed(&seeder, &(1_000 * USDC));

    // Several receipts, then a realistic harvest history.
    let mut ids = std::vec::Vec::new();
    for _ in 0..4 {
        let u = w.new_user(200 * USDC);
        ids.push(w.vault().deposit(&u, &(200 * USDC)));
    }
    let tracked = build_harvest_positions(&w, 120, 24 * 60 * 60);
    std::println!("A-4b: {} tracked positions after 120 daily harvests", tracked);

    warp_to(&w, w.maturity + 1);
    let mut worst = 0i64;
    for (n, id) in ids.iter().enumerate() {
        w.env().cost_estimate().disable_resource_limits();
        w.env().cost_estimate().budget().reset_unlimited();
        w.vault().redeem(id);
        let r = last_resources(&w);
        report(&std::format!("redeem #{}", n + 1), r);
        worst = worst.max(r.1);
    }
    std::println!(
        "A-4b: worst redeem memory {} vs mainnet ceiling {} ({}%)",
        worst,
        MAINNET_MEM_BYTES,
        worst * 100 / MAINNET_MEM_BYTES
    );
    // Recorded as a measurement, not an assertion of failure: the point is that nothing in the
    // contract bounds this number, so it is set by inventory shape rather than by design.
    assert!(worst > 0);
}

/// **A-5 — yield accrued but not harvested by maturity is stranded forever.**
///
/// `harvest` is the vault's *only* route to `wrapper::claim_yield` (the wrapper auths
/// `pos.owner`, which is the vault), and it is gated `ensure_before_maturity`. So every stroop of
/// YT yield sitting unclaimed at maturity becomes permanently unreachable — not by anyone at the
/// vault, and not by anyone at the wrapper either.
#[test]
fn vault_yield_unclaimed_at_maturity_can_never_be_claimed_by_anyone() {
    let w = setup(YEAR);
    let seeder = w.new_user(2_000 * USDC);
    w.vault().seed(&seeder, &(2_000 * USDC));
    let user = w.new_user(500 * USDC);
    let id = w.vault().deposit(&user, &(500 * USDC));

    // A full term with nobody running upkeep (or, equivalently, upkeep that stopped early).
    w.advance(YEAR - 10);

    // Real, claimable yield is sitting in the vault's positions.
    let positions = tracked_position_ids(&w);
    let mut claimable = 0i128;
    for id in positions.iter() {
        claimable += w.wrapper().position_value(&id).claimable_yield;
    }
    assert!(claimable > 0, "the scenario must actually have accrued yield");
    std::println!("A-5: {} stroops of YT yield unclaimed at maturity", claimable);

    warp_to(&w, w.maturity + 1);

    // The only door is bolted.
    assert_eq!(
        w.vault().try_harvest(&3),
        Err(Ok(spield_shared::Error::VaultExpired.into())),
        "harvest is maturity-gated, so post-maturity upkeep is impossible"
    );

    // And it is still there, visible and unreachable, after the receipt is paid in full.
    let paid = w.vault().redeem(&id);
    assert_eq!(paid, w.vault().get_receipt(&id).payout);
    let mut still_claimable = 0i128;
    for id in positions.iter() {
        still_claimable += w.wrapper().position_value(&id).claimable_yield;
    }
    std::println!("A-5: {} stroops still claimable, by nobody, after redemption", still_claimable);
    assert!(still_claimable > 0, "the yield outlives every path that could reach it");
}

/// **A-6 — seed capital and surplus inventory are one-way.**
///
/// `seed` pulls USDC in and mints PT+YT into the vault. Nothing ever sends PT, YT or USDC back
/// out except `redeem`, which pays exactly a receipt's `payout` to that receipt's owner. Once
/// every receipt is closed the remaining coupon capacity, the entire YT leg, and any resting USDC
/// are locked in the contract permanently.
#[test]
fn the_vault_has_no_path_to_recover_seed_capital_or_surplus_inventory() {
    let w = setup(YEAR);
    w.env().cost_estimate().disable_resource_limits();
    let seeder = w.new_user(2_000 * USDC);
    w.vault().seed(&seeder, &(2_000 * USDC));
    assert_eq!(w.usdc().balance(&seeder), 0);

    let user = w.new_user(100 * USDC);
    let id = w.vault().deposit(&user, &(100 * USDC));
    w.advance(YEAR / 2);
    w.env().cost_estimate().budget().reset_unlimited();
    w.vault().harvest(&3);

    warp_to(&w, w.maturity + 1);
    w.env().cost_estimate().budget().reset_unlimited();
    w.vault().redeem(&id);

    let stats = w.vault().stats();
    assert_eq!(stats.total_liability, 0, "every obligation is settled");
    std::println!(
        "A-6: with zero liabilities the vault still holds {} PT, {} YT, {} USDC — all unrecoverable",
        stats.pt_inventory,
        stats.yt_inventory,
        w.usdc().balance(&w.vault)
    );
    assert!(stats.pt_inventory > 1_500 * USDC, "the seed is still in there");
    assert!(stats.coupon_capacity > 0);
    assert!(stats.yt_inventory > 0, "and so is the whole YT leg");
    // The seeder is never made whole; there is no entry point that could do it.
    assert_eq!(w.usdc().balance(&seeder), 0);
}

/// **A-7 — `redeem_pt_for` drops positions that still hold YT.**
///
/// A position emptied of PT is pruned from `Positions` outright. Its `yt_amount` is untouched by
/// `redeem_pt`, so the vault silently stops tracking a YT leg it still owns — which is what makes
/// A-5 irreversible even if `harvest`'s maturity gate were relaxed.
#[test]
fn redeeming_prunes_positions_that_still_hold_the_vaults_yt() {
    let w = setup(YEAR);
    w.env().cost_estimate().disable_resource_limits();
    // Inventory in two equal parcels, so a payout larger than one of them must fully drain it.
    for _ in 0..2 {
        let seeder = w.new_user(100 * USDC);
        w.vault().seed(&seeder, &(100 * USDC));
    }
    let user = w.new_user(150 * USDC);
    let id = w.vault().deposit(&user, &(150 * USDC));

    let before = tracked_position_ids(&w);
    assert_eq!(before.len(), 3);

    w.advance(YEAR / 2);
    warp_to(&w, w.maturity + 1);
    w.vault().redeem(&id);

    let after = tracked_position_ids(&w);
    std::println!("A-7: tracked positions {} -> {}", before.len(), after.len());
    assert!(after.len() < before.len(), "at least one position was pruned");

    // The pruned position still holds YT the vault owns.
    for id in before.iter() {
        if !after.contains(&id) {
            let pos = w.wrapper().get_position(&id);
            std::println!(
                "A-7: pruned position {} still holds {} YT (pt_amount {})",
                id, pos.yt_amount, pos.pt_amount
            );
            assert_eq!(pos.pt_amount, 0);
            assert!(pos.yt_amount > 0, "a live YT leg was dropped from tracking");
        }
    }
}

/// **A-4c — where the cliff actually is.** Sweeps the number of inventory positions a single
/// `redeem` must draw from and reports the memory cost of each, so the tracker can quote the real
/// bound (and a fix can be calibrated against it rather than guessed).
#[test]
fn how_many_positions_a_single_redeem_can_span_before_it_breaches_mainnet() {
    let mut last_ok = 0u32;
    let mut first_bad = 0u32;
    for parcels in 1..=8u32 {
        let w = setup(YEAR);
        w.env().cost_estimate().disable_resource_limits();
        // `parcels` equal inventory parcels of 20 USDC each…
        for _ in 0..parcels {
            let seeder = w.new_user(20 * USDC);
            w.vault().seed(&seeder, &(20 * USDC));
        }
        // …and a receipt whose payout consumes all of them.
        let principal = 20 * USDC * (parcels as i128);
        let user = w.new_user(principal);
        w.env().cost_estimate().budget().reset_unlimited();
        let id = w.vault().deposit(&user, &principal);

        warp_to(&w, w.maturity + 1);
        w.env().cost_estimate().budget().reset_unlimited();
        w.vault().redeem(&id);
        let r = last_resources(&w);
        let pct = r.1 * 100 / MAINNET_MEM_BYTES;
        std::println!(
            "A-4c: payout spanning {:>2} inventory parcels -> mem {:>9} ({:>3}% of mainnet)",
            parcels, r.1, pct
        );
        if r.1 <= MAINNET_MEM_BYTES {
            last_ok = parcels;
        } else if first_bad == 0 {
            first_bad = parcels;
        }
    }
    std::println!(
        "A-4c: largest safe span = {} positions; first breaching span = {}",
        last_ok, first_bad
    );
    assert!(first_bad > 0, "the sweep must find the cliff");
    assert!(first_bad <= 8, "the cliff is well inside a realistic inventory shape");
}

/// **A-8 — `seed` is permissionless, and every seed appends a tracked position.**
///
/// `redeem_pt_for` walks `Positions` from index 0 and performs one `wrapper::redeem_pt` — one
/// Blend `submit`, ~7 MB of modelled memory — per position it draws from. A-4c puts the cliff at
/// **6**. So anyone can prepend dust positions to the walk for the price of a few stroops and a
/// transaction fee, and every receipt behind them becomes unpayable: `redeem` is all-or-nothing,
/// with no pagination, no partial path, and no way to skip or prune a position.
///
/// The seeds are real deposits that genuinely increase backing — the docstring's argument that
/// seeding "only donates PT to the vault" is true about *value* and false about *cost*.
#[test]
fn anyone_can_make_every_receipt_unpayable_by_prepending_dust_seeds() {
    let w = setup(YEAR);
    w.env().cost_estimate().disable_resource_limits();

    // The vault is live but not yet seeded — the window between `initialize` and the operator's
    // first `seed`. An attacker fills the position list with dust.
    let attacker = w.new_user(1 * USDC);
    for _ in 0..10 {
        w.env().cost_estimate().budget().reset_unlimited();
        w.vault().seed(&attacker, &1_000); // 0.0001 USDC each
    }
    assert_eq!(tracked_positions(&w), 10);
    std::println!(
        "A-8: attacker spent {} stroops total to append 10 tracked positions",
        10 * 1_000
    );

    // The operator seeds for real, and a user takes out a receipt. Everything looks healthy.
    let op = w.new_user(500 * USDC);
    w.env().cost_estimate().budget().reset_unlimited();
    w.vault().seed(&op, &(500 * USDC));
    let user = w.new_user(100 * USDC);
    w.env().cost_estimate().budget().reset_unlimited();
    let id = w.vault().deposit(&user, &(100 * USDC));
    let stats = w.vault().stats();
    assert!(stats.coupon_capacity > 0, "the vault reports itself solvent and well-capitalised");

    // At maturity the receipt is owed, backed, and unpayable.
    warp_to(&w, w.maturity + 1);
    let payout = w.vault().get_receipt(&id).payout;
    w.env().cost_estimate().disable_resource_limits();
    w.env().cost_estimate().budget().reset_unlimited();
    let paid = w.vault().redeem(&id);
    let r = last_resources(&w); // capture BEFORE any further call overwrites it
    assert_eq!(paid, payout);
    report("redeem behind 10 dust seeds", r);
    std::println!(
        "A-8: {} bytes = {}% of the mainnet ceiling — this transaction cannot be submitted",
        r.1,
        r.1 * 100 / MAINNET_MEM_BYTES
    );
    assert!(
        r.1 > MAINNET_MEM_BYTES,
        "the griefed redeem must breach the ceiling, got {}",
        r.1
    );
}

/// **A-9 — the same permissionless append also has a hard ceiling that bricks the vault.**
///
/// `Positions` is a `Vec<u64>` in the vault's **instance** entry, which every mutating call
/// rewrites. Soroban caps a single ledger entry at 64 KiB. The existing suite asserts the entry
/// fits *today*; nothing stops it from being grown on purpose. This measures the marginal cost of
/// one tracked position and projects the point at which no vault operation can be written at all.
#[test]
fn the_positions_vec_grows_without_bound_and_has_a_hard_brick_point() {
    let w = setup(YEAR);
    w.env().cost_estimate().disable_resource_limits();
    let attacker = w.new_user(10 * USDC);

    let measure = |n: u32| -> u32 {
        for _ in 0..n {
            w.env().cost_estimate().budget().reset_unlimited();
            w.vault().seed(&attacker, &1_000);
        }
        last_resources(&w).4
    };
    let at_10 = measure(10);
    let at_60 = measure(50);
    let per_position = (at_60 - at_10) / 50;
    std::println!(
        "A-9: instance write bytes {} @10 positions -> {} @60; ~{} bytes per position",
        at_10, at_60, per_position
    );
    let brick_at = (MAINNET_MAX_ENTRY_BYTES - at_60) / per_position.max(1) + 60;
    std::println!(
        "A-9: the 64 KiB per-entry cap is reached at ~{} tracked positions; past that NO vault \
         operation can write its instance entry",
        brick_at
    );
    assert!(per_position > 0, "each seed permanently enlarges a shared, rewritten entry");
    assert!(tracked_positions(&w) == 60);
}

/// **A-14 — a Blend liquidity crunch turns a vault receipt from "delayed" into "unpayable".**
///
/// The wrapper at least degrades gracefully: a holder who cannot withdraw 200k can withdraw
/// whatever fits (A-13). `Vault::redeem` cannot. It demands the receipt's whole `payout` in one
/// `redeem_pt_for` walk, and `settle_redeem` reverts anything short of it by more than
/// [`REDEEM_DUST`] — so there is no "take what you can now" path at all, and the failure surfaces
/// as an opaque Blend error code rather than a Spield one.
#[test]
fn a_drained_blend_pool_makes_a_vault_receipt_unpayable_with_no_partial_path() {
    let w = setup(YEAR);
    w.env().cost_estimate().disable_resource_limits();
    let seeder = w.new_user(300_000 * USDC);
    w.env().cost_estimate().budget().reset_unlimited();
    w.vault().seed(&seeder, &(300_000 * USDC));
    let user = w.new_user(100_000 * USDC);
    w.env().cost_estimate().budget().reset_unlimited();
    let id = w.vault().deposit(&user, &(100_000 * USDC));
    let payout = w.vault().get_receipt(&id).payout;

    w.advance(30 * 24 * 60 * 60);

    // Drive USDC utilization to Blend's `max_util`.
    let hog = Address::generate(w.env());
    StellarAssetClient::new(w.env(), &w.xlm).mint(&hog, &(50_000_000 * SCALAR_7));
    w.env().cost_estimate().budget().reset_unlimited();
    w.pool_client().submit(
        &hog, &hog, &hog,
        &Vec::from_array(w.env(), [pool::Request {
            request_type: REQ_SUPPLY_COLLATERAL,
            address: w.xlm.clone(),
            amount: 50_000_000 * SCALAR_7,
        }]),
    );
    for step in [100_000i128, 10_000, 1_000, 100] {
        loop {
            w.env().cost_estimate().budget().reset_unlimited();
            let reqs = Vec::from_array(w.env(), [pool::Request {
                request_type: REQ_BORROW, address: w.usdc.clone(), amount: step * USDC,
            }]);
            if w.pool_client().try_submit(&hog, &hog, &hog, &reqs).is_err() { break; }
        }
    }
    let liquid = w.usdc().balance(&w.pool);
    std::println!(
        "A-14: pool free liquidity {} USDC vs a receipt payout of {} USDC",
        liquid / USDC, payout / USDC
    );
    assert!(liquid < payout, "the scenario must make the payout unreachable in one go");

    // The vault still reports itself solvent…
    let stats = w.vault().stats();
    assert!(stats.pt_inventory >= stats.total_liability, "PT inventory covers every receipt");
    std::println!(
        "A-14: stats say inventory {} >= liability {} — the vault believes it is fine",
        stats.pt_inventory, stats.total_liability
    );

    warp_to(&w, w.maturity + 1);
    w.env().cost_estimate().disable_resource_limits();
    w.env().cost_estimate().budget().reset_unlimited();
    let res = w.vault().try_redeem(&id);
    std::println!("A-14: vault redeem -> {:?}", res);
    assert!(res.is_err(), "the receipt cannot be paid");
    assert_eq!(w.usdc().balance(&user), 0, "and there is no partial payout to fall back on");
    assert!(w.vault().get_receipt(&id).open, "the receipt stays open, which is at least correct");
}

/// **A-15 — `Vault::initialize` does not cross-check its `underlying` against the wrapper's.**
///
/// The same omission as the market's (A-1), one contract over. Init reads `pt`, `yt` and
/// `maturity` from the wrapper but takes `underlying` on trust, checking only that it has 7
/// decimals. The doc comment justifies this by saying older wrappers may not expose
/// `underlying()` — they do now. This records which way a mis-wired vault fails.
#[test]
fn vault_init_does_not_cross_check_its_underlying_against_the_wrapper() {
    let w = setup(YEAR);
    let admin = w.wrapper().admin();
    let foreign = register_sac(w.env(), &admin);
    assert_ne!(foreign, w.usdc);
    assert_eq!(w.wrapper().underlying(), w.usdc);

    // A vault wired to the wrong settlement asset initializes without complaint.
    let bad = VaultClient::new(w.env(), &w.env().register(Vault, (admin.clone(),)));
    bad.initialize(&w.wrapper, &foreign, &RATE_BPS, &MAX_RATE_BPS);
    std::println!("A-15: a vault on the wrong underlying initialized cleanly");
    assert_eq!(bad.stats().maturity, w.maturity, "…and inherits the right market");

    // It fails only later, at the first seed, with an error that names neither the vault nor the
    // misconfiguration — the operator finds out after deploying, not at init.
    let seeder = Address::generate(w.env());
    StellarAssetClient::new(w.env(), &foreign).mint(&seeder, &(100 * USDC));
    let res = bad.try_seed(&seeder, &(100 * USDC));
    std::println!("A-15: first seed on the mis-wired vault -> {:?}", res);
    assert!(res.is_err(), "it does at least fail closed rather than drain");
}
