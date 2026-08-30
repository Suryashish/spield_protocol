#![cfg(test)]
//! One world holding **every** v2 contract at once.
//!
//! Adapted from `srrouter/src/test.rs`'s setup, extended with the fixed-rate vault so the two
//! products that share a series — the AMM and the vault — can be driven against each other. That
//! sharing is the thing no single-contract suite can see: the vault and the market mint PY from
//! the same engine, against the same SR, backed by the same Blend position.

extern crate std;

use blend_contract_sdk::{pool, testutils::BlendFixture};
use sep_40_oracle::testutils::{Asset, MockPriceOracleClient, MockPriceOracleWASM};
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, BytesN, Env, String, Symbol, Vec,
};
use spield_sr::{Sr, SrClient};
use spield_srmarket::{SrMarket, SrMarketClient};
use spield_srrouter::{SrRouter, SrRouterClient};
use spield_srvault::{SrVault, SrVaultClient};
use spield_strategy::{BlendStrategy, BlendStrategyClient};
use spield_yield::{Yield, YieldClient};

pub const USDC: i128 = 1_0000000;
pub const SCALAR_7: i128 = 1_0000000;
pub const SCALAR_12: i128 = 1_000_000_000_000;
pub const DAY: u64 = 24 * 60 * 60;
const REQ_SUPPLY_COLLATERAL: u32 = 2;
const REQ_BORROW: u32 = 4;
const REQ_REPAY: u32 = 5;

pub const SCALAR_ROOT: i128 = 40 * SCALAR_12;
pub const LN_FEE_ROOT: i128 = 25 * SCALAR_12 / 10_000;
pub const TREASURY_SHARE_BPS: u32 = 2_000;
pub const YIELD_FEE_BPS: u32 = 500;
pub const VAULT_RATE_BPS: u32 = 300;
pub const VAULT_MAX_RATE_BPS: u32 = 2_000;
pub const NO_DEADLINE: u32 = 0;

#[allow(dead_code)] // some fields are only used by a subset of the suites
pub struct World {
    pub env: Env,
    pub pool: Address,
    pub usdc: Address,
    pub xlm: Address,
    pub oracle_id: Address,
    pub strategy: Address,
    pub sr: Address,
    pub pt: Address,
    pub yield_c: Address,
    pub market: Address,
    pub vault: Address,
    pub router: Address,
    pub treasury: Address,
    pub admin: Address,
    pub whale: Address,
    pub expiry: u64,
}

#[allow(dead_code)]
impl World {
    pub fn r(&self) -> SrRouterClient<'_> { SrRouterClient::new(&self.env, &self.router) }
    pub fn m(&self) -> SrMarketClient<'_> { SrMarketClient::new(&self.env, &self.market) }
    pub fn v(&self) -> SrVaultClient<'_> { SrVaultClient::new(&self.env, &self.vault) }
    pub fn y(&self) -> YieldClient<'_> { YieldClient::new(&self.env, &self.yield_c) }
    pub fn sr(&self) -> SrClient<'_> { SrClient::new(&self.env, &self.sr) }
    pub fn st(&self) -> BlendStrategyClient<'_> { BlendStrategyClient::new(&self.env, &self.strategy) }
    pub fn pt(&self) -> TokenClient<'_> { TokenClient::new(&self.env, &self.pt) }
    pub fn usdc_t(&self) -> TokenClient<'_> { TokenClient::new(&self.env, &self.usdc) }
    pub fn usdc_admin(&self) -> StellarAssetClient<'_> { StellarAssetClient::new(&self.env, &self.usdc) }
    pub fn oracle(&self) -> MockPriceOracleClient<'_> { MockPriceOracleClient::new(&self.env, &self.oracle_id) }
    pub fn pool_client(&self) -> pool::Client<'_> { pool::Client::new(&self.env, &self.pool) }

    pub fn now(&self) -> u64 { self.env.ledger().timestamp() }

    /// Move time forward, refresh Blend's oracle and reserve, and re-sync SR's rate — the same
    /// three things a live keeper does between ledgers.
    pub fn advance(&self, secs: u64) {
        let t = self.env.ledger().timestamp();
        self.env.ledger().set_timestamp(t + secs);
        self.oracle().set_price_stable(&vec![&self.env, 1_0000000, 1_0000000]);
        self.pool_client().get_reserve(&self.usdc);
        self.sr().sync_rate();
        self.env.cost_estimate().budget().reset_unlimited();
    }

    /// Advance without syncing SR — leaves SR's stored rate deliberately stale, which is the state
    /// every pure view runs in between mutations.
    pub fn advance_unsynced(&self, secs: u64) {
        let t = self.env.ledger().timestamp();
        self.env.ledger().set_timestamp(t + secs);
        self.oracle().set_price_stable(&vec![&self.env, 1_0000000, 1_0000000]);
        self.pool_client().get_reserve(&self.usdc);
        self.env.cost_estimate().budget().reset_unlimited();
    }

    pub fn new_user(&self, usdc_amount: i128) -> Address {
        let u = Address::generate(&self.env);
        if usdc_amount > 0 {
            self.usdc_admin().mint(&u, &usdc_amount);
        }
        self.env.cost_estimate().budget().reset_unlimited();
        u
    }

    pub fn user_with_sr(&self, usdc_amount: i128) -> (Address, i128) {
        let u = self.new_user(usdc_amount);
        let sr = self.sr().deposit(&u, &u, &usdc_amount, &0i128);
        self.env.cost_estimate().budget().reset_unlimited();
        (u, sr)
    }

    /// Seed the AMM with `pt_face` PT and whatever SR `sr_side_usdc` buys.
    pub fn seed_market(&self, pt_face: i128, sr_side_usdc: i128) -> (Address, i128) {
        let (lp, _) = self.user_with_sr(pt_face + sr_side_usdc);
        let sr_for_pt = self.sr().preview_deposit(&pt_face);
        let py = self.y().mint_py(&lp, &lp, &sr_for_pt);
        let sr_left = self.sr().balance(&lp);
        let shares = self.m().add_liquidity(&lp, &py, &sr_left, &0i128);
        self.env.cost_estimate().budget().reset_unlimited();
        (lp, shares)
    }

    /// Give the vault coupon capacity, the way `deploy_mainnet.sh` does.
    pub fn seed_vault(&self, usdc_amount: i128) -> i128 {
        let funder = self.new_user(usdc_amount);
        let py = self.v().seed(&funder, &usdc_amount);
        self.env.cost_estimate().budget().reset_unlimited();
        py
    }

    /// USDC the pool itself is holding — the hard ceiling on what any exit can pay.
    pub fn free_liquidity(&self) -> i128 {
        self.usdc_t().balance(&self.pool)
    }

    /// Draw the venue down as far as Blend will actually permit, whatever the binding constraint
    /// turns out to be (utilization ceiling, health factor, or collateral).
    ///
    /// Borrowing in halving chunks means the test never has to model Blend's admission rules — it
    /// finds the edge instead. **Blend caps utilization at 95%**, so a slice of supply always
    /// remains: a withdrawal only fails to clear in one call when it is large relative to the whole
    /// pool, which is why the crunch tests use positions of that size.
    ///
    /// Returns the free liquidity left behind.
    pub fn drain_venue_to_max(&self) -> i128 {
        StellarAssetClient::new(&self.env, &self.xlm).mint(&self.whale, &(20_000_000 * SCALAR_7));
        let reqs = Vec::from_array(
            &self.env,
            [pool::Request {
                request_type: REQ_SUPPLY_COLLATERAL,
                address: self.xlm.clone(),
                amount: 20_000_000 * SCALAR_7,
            }],
        );
        self.pool_client().submit(&self.whale, &self.whale, &self.whale, &reqs);

        let mut chunk = self.free_liquidity();
        while chunk > 1 * USDC {
            let reqs = Vec::from_array(
                &self.env,
                [pool::Request { request_type: REQ_BORROW, address: self.usdc.clone(), amount: chunk }],
            );
            if self
                .pool_client()
                .try_submit(&self.whale, &self.whale, &self.whale, &reqs)
                .is_err()
            {
                chunk /= 2;
            }
        }
        self.env.cost_estimate().budget().reset_unlimited();
        self.free_liquidity()
    }

    /// Repay `amount`, putting liquidity back on hand.
    pub fn refill_venue(&self, amount: i128) {
        StellarAssetClient::new(&self.env, &self.usdc).mint(&self.whale, &amount);
        let reqs = Vec::from_array(
            &self.env,
            [pool::Request { request_type: REQ_REPAY, address: self.usdc.clone(), amount }],
        );
        self.pool_client().submit(&self.whale, &self.whale, &self.whale, &reqs);
        self.env.cost_estimate().budget().reset_unlimited();
    }

    pub fn assert_router_empty(&self, ctx: &str) {
        let h = (
            self.sr().balance(&self.router),
            self.pt().balance(&self.router),
            self.y().balance(&self.router),
            self.usdc_t().balance(&self.router),
        );
        assert_eq!(h, (0, 0, 0, 0), "router held value after {}: (sr,pt,yt,usdc)={:?}", ctx, h);
    }
}

fn register_sac<'a>(env: &'a Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone()).address()
}

pub struct Cfg {
    pub term: u64,
    pub initial_apy_bps: u32,
    pub ln_fee_root: i128,
    pub treasury_bps: u32,
    pub yield_fee_bps: u32,
    pub vault_rate_bps: u32,
    pub deposit_cap: i128,
}

impl Default for Cfg {
    fn default() -> Self {
        Cfg {
            term: 90 * DAY,
            initial_apy_bps: 500,
            ln_fee_root: LN_FEE_ROOT,
            treasury_bps: TREASURY_SHARE_BPS,
            yield_fee_bps: YIELD_FEE_BPS,
            vault_rate_bps: VAULT_RATE_BPS,
            deposit_cap: 0,
        }
    }
}

pub fn setup(cfg: Cfg) -> World {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);
    // A non-zero sequence so deadline tests can name a ledger in the past; the market treats 0 as
    // "no bound", which is unreachable from sequence 0.
    env.ledger().set_sequence_number(1_000_000);
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
    let pool_client = pool::Client::new(&env, &pool);
    let mut c = blend_contract_sdk::testutils::default_reserve_config();
    c.index = 0;
    pool_client.queue_set_reserve(&xlm, &c);
    pool_client.set_reserve(&xlm);
    c.index = 1;
    pool_client.queue_set_reserve(&usdc, &c);
    pool_client.set_reserve(&usdc);
    blend.backstop.deposit(&admin, &pool, &50_000_0000000);
    pool_client.set_status(&3);
    pool_client.update_status();

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

    let sr = env.register(Sr, (admin.clone(),));
    let strategy = env.register(BlendStrategy, (admin.clone(),));
    BlendStrategyClient::new(&env, &strategy).initialize(&sr, &pool, &usdc, &30_000u32);
    SrClient::new(&env, &sr).initialize(&strategy);
    if cfg.deposit_cap > 0 {
        SrClient::new(&env, &sr).set_deposit_cap(&cfg.deposit_cap);
    }

    let yield_c = env.register(Yield, (admin.clone(), treasury.clone()));
    let pt = register_sac(&env, &yield_c);
    let expiry = env.ledger().timestamp() + cfg.term;
    YieldClient::new(&env, &yield_c).initialize(&sr, &pt, &expiry, &cfg.yield_fee_bps);

    let market = env.register(SrMarket, (admin.clone(), treasury.clone()));
    let apy = (cfg.initial_apy_bps as i128) * SCALAR_12 / 10_000;
    SrMarketClient::new(&env, &market).initialize(
        &yield_c, &SCALAR_ROOT, &cfg.ln_fee_root, &apy, &cfg.treasury_bps,
    );

    let vault = env.register(SrVault, (admin.clone(),));
    SrVaultClient::new(&env, &vault).initialize(&yield_c, &cfg.vault_rate_bps, &VAULT_MAX_RATE_BPS);

    let router = env.register(SrRouter, (admin.clone(),));
    SrRouterClient::new(&env, &router).initialize(&market);

    env.cost_estimate().budget().reset_unlimited();
    World {
        env, pool, usdc, xlm, oracle_id, strategy, sr, pt, yield_c, market, vault, router,
        treasury, admin, whale, expiry,
    }
}

pub fn std_world() -> World {
    setup(Cfg::default())
}
