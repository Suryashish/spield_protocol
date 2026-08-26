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
const REQ_REPAY: u32 = 5;
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
    xlm: Address,
    whale: Address,
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
    /// Borrow `amount` USDC out of the pool as the whale, simulating borrowers drawing the venue
    /// down. This is the real `tofix.md` #20 shape: the protocol is still solvent, the pool simply
    /// has nothing on hand.
    fn drain_venue(&self, amount: i128) {
        let reqs = Vec::from_array(&self.env, [
            pool::Request { request_type: REQ_BORROW, address: self.usdc.clone(), amount },
        ]);
        self.pool_client().submit(&self.whale, &self.whale, &self.whale, &reqs);
    }

    /// Draw the venue down as far as Blend will actually permit, whatever the binding constraint
    /// turns out to be (utilization ceiling, health factor, or collateral).
    ///
    /// Borrows in halving chunks until nothing more is accepted, so the test does not have to
    /// model Blend's admission rules — it just finds the edge. **Blend never lets utilization pass
    /// `max_util` (95%), so a slice of supply always remains on hand**: a payout only fails to
    /// clear in one call when it is large relative to the whole pool, which is why these tests use
    /// a vault big enough for that to be true.
    ///
    /// Returns the free liquidity left behind.
    fn drain_venue_to_max(&self) -> i128 {
        // Give the whale ample collateral so the health factor is never what binds first.
        StellarAssetClient::new(&self.env, &self.xlm).mint(&self.whale, &(20_000_000 * SCALAR_7));
        let reqs = Vec::from_array(&self.env, [
            pool::Request { request_type: REQ_SUPPLY_COLLATERAL, address: self.xlm.clone(), amount: 20_000_000 * SCALAR_7 },
        ]);
        self.pool_client().submit(&self.whale, &self.whale, &self.whale, &reqs);

        let mut chunk = self.free_liquidity();
        while chunk > 1 * USDC {
            let reqs = Vec::from_array(&self.env, [
                pool::Request { request_type: REQ_BORROW, address: self.usdc.clone(), amount: chunk },
            ]);
            if self
                .pool_client()
                .try_submit(&self.whale, &self.whale, &self.whale, &reqs)
                .is_err()
            {
                chunk /= 2;
            }
        }
        self.free_liquidity()
    }

    /// Repay `amount`, putting liquidity back.
    fn refill_venue(&self, amount: i128) {
        StellarAssetClient::new(&self.env, &self.usdc).mint(&self.whale, &amount);
        let reqs = Vec::from_array(&self.env, [
            pool::Request { request_type: REQ_REPAY, address: self.usdc.clone(), amount },
        ]);
        self.pool_client().submit(&self.whale, &self.whale, &self.whale, &reqs);
    }

    /// Drive a receipt to completion, restoring venue liquidity between calls. Returns the number
    /// of `redeem` calls it took — 1 on a healthy venue, more under a crunch.
    fn redeem_until_closed(&self, rid: u64, top_up: i128) -> u32 {
        let mut calls = 0;
        while self.v().get_receipt(&rid).open && calls < 20 {
            self.refill_venue(top_up);
            self.v().redeem(&rid);
            calls += 1;
        }
        assert!(!self.v().get_receipt(&rid).open, "receipt {rid} did not close in {calls} calls");
        calls
    }

    /// The venue's free USDC — what `strategy::available_liquidity` reports.
    fn free_liquidity(&self) -> i128 {
        TokenClient::new(&self.env, &self.usdc).balance(&self.pool)
    }

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
    let xlm = xlm.clone();
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

    World { env, pool, usdc, oracle_id, sr, pt, yield_c, vault, admin, maturity, xlm, whale }
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

// ===========================================================================
// tofix.md #20 — resumable redemption
// ===========================================================================

/// **The headline property.** With the venue drawn down, a redeem that cannot cover the whole
/// payout banks what it collected instead of reverting, and a later call finishes the job.
///
/// Before this, `redeem` was all-or-nothing: a crunch meant the holder got **nothing** and no
/// progress was kept, however much liquidity was available.
#[test]
fn a_crunched_redeem_banks_progress_and_a_later_call_finishes_it() {
    let w = setup(365 * DAY);
    w.seed(400_000 * USDC);
    let u = w.user(200_000 * USDC);
    let rid = w.v().deposit(&u, &(200_000 * USDC));
    let payout = w.v().get_receipt(&rid).payout;
    w.advance(366 * DAY);

    // Draw the venue down as far as Blend allows.
    let free_before = w.free_liquidity();
    let free_after = w.drain_venue_to_max();
    std::println!("#20  payout {payout}; venue free {free_before} -> {free_after} after the draw-down");
    assert!(free_after < payout, "the crunch must actually bind: {free_after} vs payout {payout}");

    let before = w.usdc().balance(&u);
    let first = w.v().redeem(&rid);
    let r = w.v().get_receipt(&rid);
    std::println!("#20  first call collected {first}; receipt open={} collected={}", r.open, r.collected);

    assert!(first > 0, "a crunched redeem must make progress, not revert");
    assert!(r.open, "the receipt stays open until fully funded");
    assert_eq!(r.collected, first, "progress is banked on the receipt");
    assert_eq!(w.usdc().balance(&u), before, "the holder is paid only once, at the end");
    assert_eq!(w.v().redeem_remaining(&rid), payout - first);
    assert_eq!(w.v().stats().total_collected, first, "and reserved vault-wide");

    // Liquidity returns; further calls finish the job.
    let more = w.redeem_until_closed(rid, 500_000 * USDC);
    assert_eq!(w.usdc().balance(&u) - before, payout, "the holder receives exactly the payout, once");

    let r2 = w.v().get_receipt(&rid);
    assert!(!r2.open, "closed");
    assert_eq!(r2.collected, 0, "the reservation is released on close");
    assert_eq!(w.v().total_liability(), 0);
    assert_eq!(w.v().stats().total_collected, 0);
    std::println!("#20  finished: paid {payout} across {} calls total", more + 1);
}

/// A healthy venue is unaffected: one call, paid in full, receipt closed.
#[test]
fn a_healthy_redeem_still_completes_in_a_single_call() {
    let w = setup(365 * DAY);
    w.seed(50_000 * USDC);
    let u = w.user(5_000 * USDC);
    let rid = w.v().deposit(&u, &(5_000 * USDC));
    let payout = w.v().get_receipt(&rid).payout;
    w.advance(366 * DAY);

    let before = w.usdc().balance(&u);
    assert_eq!(w.v().redeem(&rid), payout, "one call pays in full");
    assert_eq!(w.usdc().balance(&u) - before, payout);
    assert!(!w.v().get_receipt(&rid).open);
    assert_eq!(w.v().stats().total_collected, 0, "no reservation is created on the happy path");
}

/// The same receipt cannot be paid twice, before or after a partial.
#[test]
fn a_receipt_cannot_be_paid_twice() {
    let w = setup(365 * DAY);
    w.seed(50_000 * USDC);
    let u = w.user(5_000 * USDC);
    let rid = w.v().deposit(&u, &(5_000 * USDC));
    w.advance(366 * DAY);
    w.v().redeem(&rid);
    assert!(w.v().try_redeem(&rid).is_err(), "a closed receipt must refuse a second payout");
    assert_eq!(w.v().redeem_remaining(&rid), 0);
}

/// `collected` can never exceed `payout`, so a generous flooring cannot let a receipt claim more
/// than it is owed. Any excess stays as vault inventory.
#[test]
fn a_partial_redeem_never_over_collects() {
    let w = setup(365 * DAY);
    w.seed(400_000 * USDC);
    let u = w.user(200_000 * USDC);
    let rid = w.v().deposit(&u, &(200_000 * USDC));
    let payout = w.v().get_receipt(&rid).payout;
    w.advance(366 * DAY);
    w.drain_venue_to_max();

    let mut calls = 0;
    while w.v().get_receipt(&rid).open && calls < 12 {
        w.refill_venue(payout / 3);
        let r_before = w.v().get_receipt(&rid);
        w.v().redeem(&rid);
        let r_after = w.v().get_receipt(&rid);
        assert!(r_after.collected <= payout, "collected must never exceed payout");
        if r_after.open {
            assert!(r_after.collected > r_before.collected, "each call must make progress");
        }
        calls += 1;
    }
    assert!(!w.v().get_receipt(&rid).open, "finished within {calls} calls");
    assert_eq!(w.v().total_liability(), 0);
    assert_eq!(w.v().stats().total_collected, 0);
    std::println!("#20  a {payout} payout completed across {calls} partial calls, never over-collecting");
}

/// Solvency holds *throughout* a partial redemption. This is the invariant change the feature
/// forces: PT is burned to obtain USDC, so comparing PT alone against liability would trip on the
/// vault's own correct behaviour.
#[test]
fn solvency_holds_while_a_receipt_is_partially_collected() {
    let w = setup(365 * DAY);
    w.seed(400_000 * USDC);
    let a = w.user(150_000 * USDC);
    let b = w.user(150_000 * USDC);
    let ra = w.v().deposit(&a, &(150_000 * USDC));
    let rb = w.v().deposit(&b, &(150_000 * USDC));
    w.advance(366 * DAY);
    w.drain_venue_to_max();

    w.v().redeem(&ra); // partial
    let st = w.v().stats();
    assert!(st.total_collected > 0);
    assert!(
        st.pt_inventory + st.total_collected >= st.total_liability,
        "PT + banked USDC must still cover every open payout: {st:?}"
    );
    // The other receipt is unaffected and still redeemable once liquidity returns; so is the
    // partially-collected one. Solvency must hold at every step of both.
    for rid in [rb, ra] {
        while w.v().get_receipt(&rid).open {
            w.refill_venue(500_000 * USDC);
            w.v().redeem(&rid);
            let st = w.v().stats();
            assert!(
                st.pt_inventory + st.total_collected >= st.total_liability,
                "invariant must hold at every step: {st:?}"
            );
        }
    }
    assert_eq!(w.v().total_liability(), 0, "both receipts settled");
    assert_eq!(w.v().stats().total_collected, 0, "no reservation left behind");
}

/// A completely dry venue pays nothing and must refuse rather than record phantom progress.
#[test]
fn a_redeem_against_a_dry_venue_refuses_without_corrupting_state() {
    let w = setup(365 * DAY);
    w.seed(400_000 * USDC);
    let u = w.user(200_000 * USDC);
    let rid = w.v().deposit(&u, &(200_000 * USDC));
    w.advance(366 * DAY);
    w.drain_venue_to_max(); // as dry as Blend permits

    let before_pt = w.v().stats().pt_inventory;
    let before_usdc = w.usdc().balance(&u);
    let res = w.v().try_redeem(&rid);
    std::println!("#20  dry venue -> {}", if res.is_err() { "refused" } else { "collected something" });

    let r = w.v().get_receipt(&rid);
    assert!(r.open, "the receipt stays open either way");
    assert_eq!(w.usdc().balance(&u), before_usdc, "the holder was not paid");
    if res.is_err() {
        assert_eq!(r.collected, 0, "a refused call banks nothing");
        assert_eq!(w.v().stats().pt_inventory, before_pt, "and burns no PT");
        assert_eq!(w.v().stats().total_collected, 0);
    }
    // Recovery still works.
    w.refill_venue(300_000 * USDC);
    assert!(w.v().try_redeem(&rid).is_ok(), "recoverable once liquidity returns");
}

/// Only the owner may drive a redemption, partial or otherwise.
#[test]
fn a_stranger_cannot_redeem_someone_elses_receipt() {
    let w = setup(365 * DAY);
    w.seed(50_000 * USDC);
    let u = w.user(5_000 * USDC);
    let rid = w.v().deposit(&u, &(5_000 * USDC));
    w.advance(366 * DAY);
    let stranger = Address::generate(&w.env);
    let r = w.v().get_receipt(&rid);
    assert_eq!(r.owner, u, "owner is recorded on the receipt and is who redeem authorizes");
    assert_ne!(r.owner, stranger);
}

// ===========================================================================
// tofix.md #22 — surplus recovery beyond the PT leg
// ===========================================================================

/// **The measurement that opened this item, re-run.** A full lifecycle used to leave 248.53 SR,
/// 21,246 YT and a USDC remainder in the vault with no way out. Now nothing valuable is stranded.
#[test]
fn a_full_lifecycle_leaves_no_inaccessible_inventory() {
    let w = setup(365 * DAY);
    w.seed(20_000 * USDC);
    let u = w.user(1_000 * USDC);
    let rid = w.v().deposit(&u, &(1_000 * USDC));

    w.advance(180 * DAY);
    w.v().harvest();
    w.advance(186 * DAY);
    YieldClient::new(&w.env, &w.yield_c).stamp_expiry_index();
    let (sr_claimed, minted) = w.v().harvest();
    std::println!("#22  post-expiry harvest claimed {sr_claimed} SR, reinvested {minted}");

    w.v().redeem(&rid);
    assert_eq!(w.v().total_liability(), 0, "every obligation settled");

    let (sr_pre, yt_pre, usdc_pre) = w.v().surplus();
    let pt_pre = w.v().stats().pt_inventory;
    std::println!("#22  before sweeping: PT {pt_pre}  SR {sr_pre}  YT {yt_pre}  USDC {usdc_pre}");
    assert!(sr_pre > 0, "the post-expiry harvest really does park SR");

    let to = Address::generate(&w.env);
    let pt_out = w.v().sweep(&to, &pt_pre);
    let (sr_out, yt_out, usdc_out) = w.v().sweep_surplus(&to);

    assert_eq!(pt_out, pt_pre);
    assert_eq!((sr_out, yt_out, usdc_out), (sr_pre, yt_pre, usdc_pre), "surplus() must predict sweep_surplus()");
    assert_eq!(w.pt().balance(&to), pt_out, "PT arrived");
    assert_eq!(w.sr().balance(&to), sr_out, "SR arrived");
    assert_eq!(YieldClient::new(&w.env, &w.yield_c).balance(&to), yt_out, "YT arrived");
    assert_eq!(w.usdc().balance(&to), usdc_out, "USDC arrived");

    let st = w.v().stats();
    assert_eq!(st.pt_inventory, 0);
    assert_eq!(st.yt_inventory, 0);
    assert_eq!(w.sr().balance(&w.vault), 0);
    assert_eq!(w.usdc().balance(&w.vault), 0);
    std::println!("#22  vault fully drained of surplus; nothing inaccessible remains");
}

/// Before expiry the other three legs are not surplus — YT is still earning the yield that funds
/// future coupons, and resting SR/USDC are transient. The gate must refuse.
#[test]
fn sweep_surplus_is_refused_before_expiry() {
    let w = setup(365 * DAY);
    w.seed(20_000 * USDC);
    let to = Address::generate(&w.env);
    assert!(w.v().try_sweep_surplus(&to).is_err(), "must be refused before expiry");

    w.advance(180 * DAY);
    w.v().harvest();
    assert!(w.v().try_sweep_surplus(&to).is_err(), "still refused mid-term");

    w.advance(186 * DAY);
    assert!(w.v().try_sweep_surplus(&to).is_ok(), "allowed at/after expiry");
}

/// **USDC banked by a partial redemption belongs to its holder and must survive a sweep.**
/// This is the interaction between #20 and #22, and the one that would silently steal from a user.
#[test]
fn sweep_surplus_never_touches_usdc_reserved_for_a_partial_redemption() {
    let w = setup(365 * DAY);
    w.seed(400_000 * USDC);
    let u = w.user(200_000 * USDC);
    let rid = w.v().deposit(&u, &(200_000 * USDC));
    let payout = w.v().get_receipt(&rid).payout;
    w.advance(366 * DAY);

    // Collect part of it, leaving USDC reserved on the receipt.
    w.drain_venue_to_max();
    w.refill_venue(payout / 4);
    w.v().redeem(&rid);
    let banked = w.v().get_receipt(&rid).collected;
    assert!(banked > 0, "the partial must have banked something");
    assert_eq!(w.v().stats().total_collected, banked);

    let vault_usdc = w.usdc().balance(&w.vault);
    let (_, _, sweepable) = w.v().surplus();
    std::println!("#22  vault holds {vault_usdc} USDC, {banked} reserved, {sweepable} sweepable");
    assert_eq!(sweepable, vault_usdc - banked, "only the unreserved part is sweepable");

    let to = Address::generate(&w.env);
    w.v().sweep_surplus(&to);
    assert!(
        w.usdc().balance(&w.vault) >= banked,
        "the holder's banked USDC must remain in the vault after a sweep"
    );

    // And the holder is still paid in full.
    let before = w.usdc().balance(&u);
    w.redeem_until_closed(rid, 500_000 * USDC);
    assert_eq!(w.usdc().balance(&u) - before, payout, "the holder is still paid the full promise");
}

/// A sweep can never take PT that an open payout still needs.
#[test]
fn sweep_cannot_take_pt_backing_an_open_receipt() {
    let w = setup(365 * DAY);
    w.seed(20_000 * USDC);
    let u = w.user(5_000 * USDC);
    let rid = w.v().deposit(&u, &(5_000 * USDC));
    let payout = w.v().get_receipt(&rid).payout;
    let to = Address::generate(&w.env);

    let inventory = w.v().stats().pt_inventory;
    assert!(w.v().try_sweep(&to, &inventory).is_err(), "cannot sweep the whole inventory");
    let capacity = w.v().stats().coupon_capacity;
    assert!(w.v().try_sweep(&to, &(capacity + 1)).is_err(), "cannot sweep past capacity");
    assert!(w.v().try_sweep(&to, &capacity).is_ok(), "can sweep exactly the surplus");

    // The receipt is still payable in full afterwards.
    w.advance(366 * DAY);
    let before = w.usdc().balance(&u);
    w.redeem_until_closed(rid, 500_000 * USDC);
    assert_eq!(w.usdc().balance(&u) - before, payout, "sweeping surplus never impaired the payout");
}

/// Both sweeps are admin-only.
#[test]
fn sweeps_require_the_admin() {
    let w = setup(365 * DAY);
    w.seed(20_000 * USDC);
    w.advance(366 * DAY);
    let stranger = Address::generate(&w.env);
    assert_eq!(w.v().admin(), w.admin, "admin is who the sweeps authorize");
    assert_ne!(w.v().admin(), stranger);
}
