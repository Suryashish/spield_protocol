#![cfg(test)]
//! # v2 Fixed-Rate Vault — end to end against the real Blend v2 WASM.
//!
//! The whole stack: Blend → strategy → SR → yield engine → this vault. Nothing mocked.
//!
//! The suite is organised around the question that matters: **are v1's four vault defects actually
//! absent, or merely untested?** Each gets a test that would fail loudly if the property regressed.

extern crate std;

use crate::{SrVault, SrVaultClient};
use blend_contract_sdk::{pool, testutils::BlendFixture};
use sep_40_oracle::testutils::{Asset, MockPriceOracleClient, MockPriceOracleWASM};
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, Ledger as _, MockAuth, MockAuthInvoke},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, BytesN, Env, IntoVal, String, Symbol, Vec,
};
use spield_sr::{Sr, SrClient};
use spield_strategy::{BlendStrategy, BlendStrategyClient};
use spield_yield::{Yield, YieldClient};

const USDC: i128 = 1_0000000;
const SCALAR_7: i128 = 1_0000000;
const DAY: u64 = 24 * 60 * 60;
const REQ_SUPPLY_COLLATERAL: u32 = 2;
const REQ_BORROW: u32 = 4;
const RATE_BPS: u32 = 500; // 5%
const MAX_RATE_BPS: u32 = 2000; // 20% ceiling

struct World {
    env: Env,
    pool: Address,
    usdc: Address,
    oracle_id: Address,
    sr: Address,
    pt: Address,
    yield_c: Address,
    vault: Address,
    admin: Address,
    maturity: u64,
}

impl World {
    fn v(&self) -> SrVaultClient<'_> { SrVaultClient::new(&self.env, &self.vault) }
    fn y(&self) -> YieldClient<'_> { YieldClient::new(&self.env, &self.yield_c) }
    fn sr(&self) -> SrClient<'_> { SrClient::new(&self.env, &self.sr) }
    fn pt(&self) -> TokenClient<'_> { TokenClient::new(&self.env, &self.pt) }
    fn usdc(&self) -> TokenClient<'_> { TokenClient::new(&self.env, &self.usdc) }
    fn usdc_admin(&self) -> StellarAssetClient<'_> { StellarAssetClient::new(&self.env, &self.usdc) }
    fn oracle(&self) -> MockPriceOracleClient<'_> { MockPriceOracleClient::new(&self.env, &self.oracle_id) }
    fn pool_client(&self) -> pool::Client<'_> { pool::Client::new(&self.env, &self.pool) }

    fn advance(&self, secs: u64) {
        let t = self.env.ledger().timestamp();
        self.env.ledger().set_timestamp(t + secs);
        self.oracle().set_price_stable(&vec![&self.env, 1_0000000, 1_0000000]);
        self.pool_client().get_reserve(&self.usdc);
        self.sr().sync_rate();
        self.env.cost_estimate().budget().reset_unlimited();
    }

    fn user(&self, amount: i128) -> Address {
        let u = Address::generate(&self.env);
        self.usdc_admin().mint(&u, &amount);
        u
    }

    /// Give the vault `usdc` of PT coupon capacity.
    fn seed(&self, usdc: i128) -> i128 {
        let s = self.user(usdc);
        self.v().seed(&s, &usdc)
    }
}

fn register_sac<'a>(env: &'a Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone()).address()
}

fn setup(term: u64) -> World {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);
    env.cost_estimate().budget().reset_unlimited();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
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
    let pc = pool::Client::new(&env, &pool);
    let mut cfg = blend_contract_sdk::testutils::default_reserve_config();
    cfg.index = 0;
    pc.queue_set_reserve(&xlm, &cfg);
    pc.set_reserve(&xlm);
    cfg.index = 1;
    pc.queue_set_reserve(&usdc, &cfg);
    pc.set_reserve(&usdc);
    blend.backstop.deposit(&admin, &pool, &50_000_0000000);
    pc.set_status(&3);
    pc.update_status();

    let whale = Address::generate(&env);
    StellarAssetClient::new(&env, &xlm).mint(&whale, &(2_000_000 * SCALAR_7));
    StellarAssetClient::new(&env, &usdc).mint(&whale, &(2_000_000 * USDC));
    let reqs = Vec::from_array(&env, [
        pool::Request { request_type: REQ_SUPPLY_COLLATERAL, address: xlm.clone(), amount: 1_000_000 * SCALAR_7 },
        pool::Request { request_type: REQ_SUPPLY_COLLATERAL, address: usdc.clone(), amount: 500_000 * USDC },
        pool::Request { request_type: REQ_BORROW, address: usdc.clone(), amount: 300_000 * USDC },
    ]);
    pc.submit(&whale, &whale, &whale, &reqs);

    let sr = env.register(Sr, (admin.clone(),));
    let strategy = env.register(BlendStrategy, (admin.clone(),));
    BlendStrategyClient::new(&env, &strategy).initialize(&sr, &pool, &usdc, &30_000u32);
    SrClient::new(&env, &sr).initialize(&strategy);

    let yield_c = env.register(Yield, (admin.clone(), treasury.clone()));
    let pt = register_sac(&env, &yield_c);
    let maturity = env.ledger().timestamp() + term;
    YieldClient::new(&env, &yield_c).initialize(&sr, &pt, &maturity, &500u32);

    let vault = env.register(SrVault, (admin.clone(),));
    SrVaultClient::new(&env, &vault).initialize(&yield_c, &RATE_BPS, &MAX_RATE_BPS);

    World { env, pool, usdc, oracle_id, sr, pt, yield_c, vault, admin, maturity }
}

// ===========================================================================
// Wiring — tofix #24 is not expressible
// ===========================================================================

/// **#24 closed by construction.** `initialize` takes ONLY the engine and reads sr/pt/underlying/
/// maturity back from it, so a vault wired to an asset its PT does not redeem into cannot be built.
#[test]
fn tofix24_the_vault_discovers_its_own_wiring() {
    let w = setup(90 * DAY);
    assert_eq!(w.v().pt_token(), w.y().pt_token());
    assert_eq!(w.v().sr_token(), w.y().sr_token());
    assert_eq!(w.v().maturity(), w.y().expiry());
    assert_eq!(w.v().underlying(), w.sr().underlying());
    assert_eq!(w.v().underlying(), w.usdc, "settlement asset came from the strategy, not an argument");
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // AlreadyInitialized
fn the_vault_cannot_be_initialized_twice() {
    let w = setup(90 * DAY);
    w.v().initialize(&w.yield_c, &RATE_BPS, &MAX_RATE_BPS);
}

#[test]
#[should_panic(expected = "Error(Contract, #65)")] // RateNotAllowed
fn the_initial_rate_cannot_exceed_its_ceiling() {
    let w = setup(90 * DAY);
    let v2 = w.env.register(SrVault, (w.admin.clone(),));
    SrVaultClient::new(&w.env, &v2).initialize(&w.yield_c, &(MAX_RATE_BPS + 1), &MAX_RATE_BPS);
}

// ===========================================================================
// tofix #18 — the P0. Both halves.
// ===========================================================================

/// **Half one: `seed` is admin-gated.** v1's was permissionless, which is what let a stranger
/// prepend dust positions until every receipt became unpayable.
#[test]
fn tofix18a_seed_is_admin_gated() {
    let w = setup(90 * DAY);
    let mallory = Address::generate(&w.env);
    w.usdc_admin().mint(&mallory, &(1_000 * USDC));

    let env = &w.env;
    env.mock_auths(&[MockAuth {
        address: &mallory,
        invoke: &MockAuthInvoke {
            contract: &w.vault,
            fn_name: "seed",
            args: (mallory.clone(), 1_000i128 * USDC).into_val(env),
            sub_invokes: &[],
        },
    }]);
    assert!(
        w.v().try_seed(&mallory, &(1_000 * USDC)).is_err(),
        "a stranger must not be able to write vault inventory"
    );
    env.mock_all_auths();
    assert_eq!(w.v().stats().pt_inventory, 0);
}

/// **Half two — the structural one: redemption cost does not scale with history.**
///
/// v1's `redeem` walked a position list at ~7 MB per position; five exhausted the mainnet budget.
/// Here PT is a fungible bearer balance, so no walk exists. Proven by assembling inventory from
/// MANY separate seeds and showing the redeem footprint is identical to a single-seed vault.
#[test]
fn tofix18b_redeem_cost_is_independent_of_how_the_inventory_was_assembled() {
    let measure = |seeds: usize| -> (u32, u32, i64) {
        let w = setup(90 * DAY);
        // Assemble the same total capacity from `seeds` separate contributions.
        for _ in 0..seeds {
            w.seed(2_000 * USDC / seeds as i128);
        }
        let u = w.user(100 * USDC);
        let id = w.v().deposit(&u, &(100 * USDC));
        w.advance(91 * DAY);
        w.env.cost_estimate().budget().reset_unlimited();
        w.v().redeem(&id);
        let r = w.env.cost_estimate().resources();
        (r.write_entries, r.disk_read_entries + r.memory_read_entries + r.write_entries, r.mem_bytes)
    };
    let (w1, e1, m1) = measure(1);
    let (w20, e20, m20) = measure(20);
    std::println!(
        "#18b  redeem after  1 seed : {w1} write entries, {e1} total, {m1} mem\n      redeem after 20 seeds: {w20} write entries, {e20} total, {m20} mem"
    );
    assert_eq!(w20, w1, "write-entry count must not depend on inventory history");
    assert_eq!(e20, e1, "footprint entry count must not depend on inventory history");
    std::println!("      => O(1). v1 measured ~6.8 MB PER POSITION SPANNED and bricked at 6.");
}

/// And the memory cost fits mainnet with room to spare — the thing v1 could not guarantee.
#[test]
fn tofix18c_redeem_fits_the_mainnet_budget_comfortably() {
    const MAINNET_MEM: i64 = 41_943_040;
    const MAINNET_INSNS: i64 = 600_000_000;
    let w = setup(90 * DAY);
    w.seed(5_000 * USDC);
    let u = w.user(1_000 * USDC);
    let id = w.v().deposit(&u, &(1_000 * USDC));
    w.advance(91 * DAY);
    w.env.cost_estimate().budget().reset_unlimited();
    w.v().redeem(&id);
    let r = w.env.cost_estimate().resources();
    std::println!(
        "#18c  redeem: {} insns ({:.1}%), {} mem ({:.1}%), {} write entries",
        r.instructions, r.instructions as f64 * 100.0 / MAINNET_INSNS as f64,
        r.mem_bytes, r.mem_bytes as f64 * 100.0 / MAINNET_MEM as f64, r.write_entries
    );
    assert!(r.mem_bytes < MAINNET_MEM / 2, "should sit well under half the ceiling");
    assert!(r.instructions < MAINNET_INSNS);
}

// ===========================================================================
// tofix #21 — harvest after maturity
// ===========================================================================

/// **#21 closed.** v1's `harvest` refused to run post-maturity and pruned live YT legs, so yield
/// accrued before maturity became permanently unclaimable. Here it runs whenever called.
#[test]
fn tofix21_harvest_still_works_after_maturity() {
    let w = setup(90 * DAY);
    w.seed(50_000 * USDC);
    w.advance(89 * DAY);
    let pending = w.y().claimable_interest(&w.vault);
    assert!(pending > 0, "the vault's YT must have accrued");

    // Past maturity — v1 would refuse outright.
    w.advance(3 * DAY);
    let (claimed, minted) = w.v().harvest();
    assert!(claimed > 0, "pre-maturity yield must still be claimable after maturity");
    assert_eq!(minted, 0, "no reinvestment past expiry — the engine refuses new mints, correctly");
    std::println!("#21  claimed {claimed} SR of vault yield AFTER maturity (v1: unclaimable forever)");
}

/// Before maturity, harvest reinvests into fresh PT capacity.
#[test]
fn harvest_reinvests_yield_as_new_coupon_capacity_before_maturity() {
    let w = setup(365 * DAY);
    w.seed(200_000 * USDC);
    let before = w.v().stats().pt_inventory;
    w.advance(300 * DAY);
    let (claimed, minted) = w.v().harvest();
    assert!(claimed > 0 && minted > 0, "claimed {claimed}, minted {minted}");
    assert!(w.v().stats().pt_inventory > before, "capacity grew");
    std::println!("harvest: {claimed} SR of yield -> {minted} of new PT capacity");
}

#[test]
fn harvest_is_a_no_op_when_nothing_has_accrued() {
    let w = setup(90 * DAY);
    w.seed(1_000 * USDC);
    let (claimed, minted) = w.v().harvest();
    assert_eq!((claimed, minted), (0, 0));
}

// ===========================================================================
// tofix #22 — seed capital is recoverable
// ===========================================================================

/// **#22 closed.** Surplus above every open liability can be swept out. v1 had no path at all.
#[test]
fn tofix22_surplus_capacity_is_recoverable() {
    let w = setup(90 * DAY);
    w.seed(10_000 * USDC);
    let u = w.user(1_000 * USDC);
    w.v().deposit(&u, &(1_000 * USDC));

    let s = w.v().stats();
    assert!(s.coupon_capacity > 0);
    let treasury = Address::generate(&w.env);
    let swept = w.v().sweep(&treasury, &s.coupon_capacity);
    assert_eq!(swept, s.coupon_capacity);
    assert_eq!(w.pt().balance(&treasury), swept, "the PT really moved");
    // Liability is still fully covered.
    let s2 = w.v().stats();
    assert!(s2.pt_inventory >= s2.total_liability, "sweep must never eat into backing");
    std::println!("#22  swept {swept} PT of surplus; liability {} still covered by {}", s2.total_liability, s2.pt_inventory);
}

/// The sweep is liability-gated: it cannot take one stroop more than the surplus.
#[test]
fn sweeping_more_than_the_surplus_is_refused() {
    let w = setup(90 * DAY);
    w.seed(10_000 * USDC);
    let u = w.user(5_000 * USDC);
    w.v().deposit(&u, &(5_000 * USDC));
    let s = w.v().stats();
    let to = Address::generate(&w.env);
    assert!(w.v().try_sweep(&to, &(s.coupon_capacity + 1)).is_err(), "one stroop over must fail");
    w.v().sweep(&to, &s.coupon_capacity); // exactly the surplus is fine
    let s2 = w.v().stats();
    assert_eq!(s2.coupon_capacity, 0);
    assert!(s2.pt_inventory >= s2.total_liability);
}

#[test]
fn sweep_is_admin_only() {
    let w = setup(90 * DAY);
    w.seed(10_000 * USDC);
    let mallory = Address::generate(&w.env);
    let env = &w.env;
    env.mock_auths(&[MockAuth {
        address: &mallory,
        invoke: &MockAuthInvoke {
            contract: &w.vault,
            fn_name: "sweep",
            args: (mallory.clone(), 1_000i128).into_val(env),
            sub_invokes: &[],
        },
    }]);
    assert!(w.v().try_sweep(&mallory, &1_000i128).is_err());
    env.mock_all_auths();
}

// ===========================================================================
// The core product: a fixed rate that is actually paid
// ===========================================================================

#[test]
fn a_depositor_receives_exactly_the_promised_payout() {
    let w = setup(90 * DAY);
    w.seed(50_000 * USDC);

    let u = w.user(1_000 * USDC);
    let (payout, coupon, rate) = w.v().quote(&(1_000 * USDC));
    assert_eq!(rate, RATE_BPS);
    assert!(coupon > 0 && payout == 1_000 * USDC + coupon);

    let id = w.v().deposit(&u, &(1_000 * USDC));
    let r = w.v().get_receipt(&id);
    assert_eq!(r.payout, payout);
    assert_eq!(r.owner, u);
    assert!(r.open);
    assert_eq!(w.usdc().balance(&u), 0, "principal went in");

    w.advance(91 * DAY);
    let paid = w.v().redeem(&id);
    assert_eq!(paid, payout, "the promise is paid exactly");
    assert_eq!(w.usdc().balance(&u), payout);
    assert!(!w.v().get_receipt(&id).open);

    let annual = (coupon as f64 / (1_000.0 * USDC as f64)) * (365.0 / 90.0) * 100.0;
    std::println!(
        "fixed rate: 1000 USDC -> {:.4} USDC at 90d ({:.3}% annualized, quoted {}bps)",
        paid as f64 / USDC as f64, annual, RATE_BPS
    );
}

#[test]
fn a_deposit_beyond_the_vaults_capacity_is_refused() {
    let w = setup(90 * DAY);
    w.seed(100 * USDC); // tiny capacity
    let u = w.user(100_000 * USDC);
    // The deposit mints PT equal to principal, but the COUPON must come from spare capacity.
    assert!(
        w.v().try_deposit(&u, &(100_000 * USDC)).is_err(),
        "the vault must not promise a coupon it cannot back"
    );
    assert_eq!(w.usdc().balance(&u), 100_000 * USDC, "and the deposit was not taken");
}

#[test]
fn a_receipt_cannot_be_redeemed_before_maturity() {
    let w = setup(90 * DAY);
    w.seed(10_000 * USDC);
    let u = w.user(1_000 * USDC);
    let id = w.v().deposit(&u, &(1_000 * USDC));
    assert!(w.v().try_redeem(&id).is_err(), "before maturity must fail");
    w.advance(91 * DAY);
    assert!(w.v().redeem(&id) > 0);
}

#[test]
fn a_receipt_cannot_be_redeemed_twice() {
    let w = setup(90 * DAY);
    w.seed(10_000 * USDC);
    let u = w.user(1_000 * USDC);
    let id = w.v().deposit(&u, &(1_000 * USDC));
    w.advance(91 * DAY);
    w.v().redeem(&id);
    assert!(w.v().try_redeem(&id).is_err(), "a closed receipt must not pay again");
}

#[test]
fn only_the_owner_can_redeem_their_receipt() {
    let w = setup(90 * DAY);
    w.seed(10_000 * USDC);
    let u = w.user(1_000 * USDC);
    let id = w.v().deposit(&u, &(1_000 * USDC));
    w.advance(91 * DAY);

    let mallory = Address::generate(&w.env);
    let env = &w.env;
    env.mock_auths(&[MockAuth {
        address: &mallory,
        invoke: &MockAuthInvoke {
            contract: &w.vault,
            fn_name: "redeem",
            args: (id,).into_val(env),
            sub_invokes: &[],
        },
    }]);
    assert!(w.v().try_redeem(&id).is_err(), "a stranger must not redeem someone else's receipt");
    env.mock_all_auths();
    assert!(w.v().get_receipt(&id).open, "receipt untouched");
}

#[test]
fn many_depositors_are_all_paid_in_full() {
    let w = setup(90 * DAY);
    w.seed(100_000 * USDC);
    let mut ids = std::vec::Vec::new();
    for i in 1..=8i128 {
        let u = w.user(i * 500 * USDC);
        let id = w.v().deposit(&u, &(i * 500 * USDC));
        ids.push((u, id, w.v().get_receipt(&id).payout));
        let s = w.v().stats();
        assert!(s.pt_inventory >= s.total_liability, "solvent after every deposit");
    }
    w.advance(91 * DAY);
    for (u, id, payout) in &ids {
        let paid = w.v().redeem(id);
        assert_eq!(paid, *payout, "receipt {id} short-paid");
        assert_eq!(w.usdc().balance(u), *payout);
    }
    assert_eq!(w.v().stats().total_liability, 0);
    assert_eq!(w.v().stats().open_receipts, 0);
    std::println!("8 depositors all paid their exact promised payout");
}

// ===========================================================================
// Solvency + guardrails
// ===========================================================================

#[test]
fn the_vault_stays_solvent_through_a_full_lifecycle() {
    let w = setup(180 * DAY);
    w.seed(100_000 * USDC);
    let mut ids = std::vec::Vec::new();
    for step in 0..6 {
        w.advance(25 * DAY);
        let u = w.user(2_000 * USDC);
        if let Ok(Ok(id)) = w.v().try_deposit(&u, &(2_000 * USDC)) {
            ids.push(id);
        }
        if step % 2 == 0 {
            w.v().harvest();
        }
        let s = w.v().stats();
        assert!(s.pt_inventory >= s.total_liability, "step {step}: INSOLVENT {s:?}");
    }
    w.advance(60 * DAY);
    for id in &ids {
        assert!(w.v().redeem(id) > 0);
    }
    let s = w.v().stats();
    assert_eq!(s.total_liability, 0);
    std::println!("full lifecycle: {} receipts paid, {} PT left as surplus", ids.len(), s.pt_inventory);
}

#[test]
fn a_pause_blocks_deposits_but_never_redemption() {
    let w = setup(90 * DAY);
    w.seed(10_000 * USDC);
    let u = w.user(1_000 * USDC);
    let id = w.v().deposit(&u, &(1_000 * USDC));
    w.v().pause();
    let u2 = w.user(1_000 * USDC);
    assert!(w.v().try_deposit(&u2, &(1_000 * USDC)).is_err(), "paused: no new exposure");
    w.advance(91 * DAY);
    assert!(w.v().redeem(&id) > 0, "a pause must never trap a depositor");
}

#[test]
fn the_rate_cannot_be_set_above_its_ceiling() {
    let w = setup(90 * DAY);
    assert!(w.v().try_set_rate(&(MAX_RATE_BPS + 1)).is_err());
    w.v().set_rate(&(MAX_RATE_BPS));
    assert_eq!(w.v().rate_bps(), MAX_RATE_BPS);
}

#[test]
fn zero_and_negative_amounts_are_refused() {
    let w = setup(90 * DAY);
    w.seed(10_000 * USDC);
    let u = w.user(1_000 * USDC);
    for bad in [0i128, -1, -1_000] {
        assert!(w.v().try_deposit(&u, &bad).is_err());
        assert!(w.v().try_seed(&u, &bad).is_err());
        assert!(w.v().try_sweep(&u, &bad).is_err());
    }
    assert_eq!(w.usdc().balance(&u), 1_000 * USDC);
}

#[test]
fn the_vault_carries_the_full_governance_surface() {
    let w = setup(90 * DAY);
    assert_eq!(w.v().timelock(), 24 * 60 * 60);
    assert_eq!(w.v().pending_admin(), None);
    let next = Address::generate(&w.env);
    w.v().propose_admin(&next);
    assert_eq!(w.v().pending_admin(), Some(next.clone()));
    assert_eq!(w.v().admin(), w.admin, "proposing alone changes nothing");
    w.v().accept_admin();
    assert_eq!(w.v().admin(), next);
}

/// A donation of PT straight to the vault increases real capacity — unlike a market donation, this
/// is safe and even useful, because capacity is read from the actual balance rather than a stored
/// figure. Pinned so the behaviour is deliberate rather than accidental.
#[test]
fn a_pt_donation_becomes_real_coupon_capacity() {
    let w = setup(90 * DAY);
    w.seed(1_000 * USDC);
    let before = w.v().stats().coupon_capacity;

    // Somebody mints PY themselves and gifts the PT leg to the vault.
    let d = w.user(5_000 * USDC);
    let sr = w.sr().deposit(&d, &d, &(5_000 * USDC), &0i128);
    let py = w.y().mint_py(&d, &d, &sr);
    w.pt().transfer(&d, &w.vault, &py);

    let after = w.v().stats().coupon_capacity;
    assert_eq!(after - before, py, "donated PT is genuine capacity");
    // And it can now back a deposit it could not have before.
    let u = w.user(4_000 * USDC);
    assert!(w.v().try_deposit(&u, &(4_000 * USDC)).is_ok());
}
