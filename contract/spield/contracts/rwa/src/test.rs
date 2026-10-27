extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient,
};
use spield_rwa_mock_oracle::{MockOracle, MockOracleClient};

const UNIT: i128 = 10_000_000;
const START: u64 = 1_700_000_000;
const TERM: u64 = 1_000;
const AGE: u64 = 300;
const ENTRY: i128 = 125_000_000; // $1.25/token, intentionally not $1.
const UP: i128 = 156_250_000; // $1.5625, artificial large move for exact assertions.

struct World {
    env: Env,
    admin: Address,
    asset: Address,
    oracle: Address,
    series: Address,
}

impl World {
    fn new() -> Self {
        Self::with_metadata(false, "USD", 8)
    }

    fn with_metadata(wrong_asset: bool, base: &str, decimals: u32) -> Self {
        Self::build(wrong_asset, base, decimals, false)
    }

    fn build(wrong_asset: bool, base: &str, decimals: u32, wasm: bool) -> Self {
        let env = Env::new_with_config(soroban_sdk::testutils::EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.mock_all_auths();
        env.cost_estimate().budget().reset_unlimited();
        env.ledger().set_timestamp(START);
        let admin = Address::generate(&env);
        let asset_fixture = env.register_stellar_asset_contract_v2(admin.clone());
        asset_fixture
            .issuer()
            .set_flag(soroban_sdk::testutils::IssuerFlags::RevocableFlag);
        asset_fixture
            .issuer()
            .set_flag(soroban_sdk::testutils::IssuerFlags::ClawbackEnabledFlag);
        let asset = asset_fixture.address();
        let bound = if wrong_asset {
            Address::generate(&env)
        } else {
            asset.clone()
        };
        let oracle_args = (admin.clone(), bound, Symbol::new(&env, base), decimals);
        let oracle = if wasm {
            let bytes = std::fs::read(std::concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../target/wasm32v1-none/release/spield_rwa_mock_oracle.wasm"
            ))
            .expect("build release WASM before running --features wasm-tests");
            env.register(bytes.as_slice(), oracle_args)
        } else {
            env.register(MockOracle, oracle_args)
        };
        MockOracleClient::new(&env, &oracle).publish(&ENTRY, &START);
        let series_args = (
            admin.clone(),
            asset.clone(),
            oracle.clone(),
            START + TERM,
            AGE,
        );
        let series = if wasm {
            let bytes = std::fs::read(std::concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../target/wasm32v1-none/release/spield_rwa.wasm"
            ))
            .expect("build release WASM before running --features wasm-tests");
            env.register(bytes.as_slice(), series_args)
        } else {
            env.register(UstrySeries, series_args)
        };
        let mut tokens = std::vec::Vec::new();
        for kind in 0..3u32 {
            let args = (
                series.clone(),
                kind,
                soroban_sdk::String::from_str(&env, "Claim"),
                soroban_sdk::String::from_str(&env, "CLM"),
            );
            let id = if wasm {
                let bytes = std::fs::read(std::concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../target/wasm32v1-none/release/spield_rwa_token.wasm"
                ))
                .unwrap();
                env.register(bytes.as_slice(), args)
            } else {
                env.register(spield_rwa_token::ClaimToken, args)
            };
            tokens.push(id);
        }
        UstrySeriesClient::new(&env, &series).bind_tokens(&tokens[0], &tokens[1], &tokens[2]);
        Self {
            env,
            admin,
            asset,
            oracle,
            series,
        }
    }

    fn c(&self) -> UstrySeriesClient<'_> {
        UstrySeriesClient::new(&self.env, &self.series)
    }
    fn facade(&self, kind: u32) -> spield_rwa_token::ClaimTokenClient<'_> {
        let id = self.c().config().tokens.get(kind).unwrap();
        spield_rwa_token::ClaimTokenClient::new(&self.env, &id)
    }
    fn o(&self) -> MockOracleClient<'_> {
        MockOracleClient::new(&self.env, &self.oracle)
    }
    fn t(&self) -> token::Client<'_> {
        token::Client::new(&self.env, &self.asset)
    }

    fn user(&self, tokens: i128) -> Address {
        let user = Address::generate(&self.env);
        StellarAssetClient::new(&self.env, &self.asset).mint(&user, &tokens);
        user
    }

    fn split(&self, user: &Address, tokens: i128) -> i128 {
        self.c().deposit(user, &tokens);
        self.c().split(user, &tokens, &0)
    }

    fn publish(&self, offset: u64, price: i128) {
        self.env.ledger().set_timestamp(START + offset);
        self.o().publish(&price, &(START + offset));
    }

    fn mature(&self, price: i128) {
        self.publish(TERM - 10, price);
        self.publish(TERM + 10, price);
        self.c().finalize();
    }
}

#[test]
fn full_lifecycle_dollar_face_yield_and_pt_only_maturity_exit() {
    let w = World::new();
    let alice = w.user(100 * UNIT);
    let bob = w.user(0);
    w.c().deposit(&alice, &(100 * UNIT));
    assert_eq!(w.c().balance(&alice).receipt, 100 * UNIT);
    assert_eq!(w.c().value_usd(&(100 * UNIT)), 125 * UNIT);
    let face = w.c().split(&alice, &(100 * UNIT), &(125 * UNIT));
    assert_eq!(face, 125 * UNIT);
    assert_eq!(w.c().balance(&alice).pt, face);
    assert_eq!(w.c().balance(&alice).yt, face);
    w.publish(100, UP);
    assert_eq!(w.c().claim_yield(&alice), 20 * UNIT);
    assert_eq!(w.c().claim_yield(&alice), 0);
    w.facade(1).transfer(&alice, &bob, &face);
    w.mature(UP);
    assert!(w.c().state().finalized);
    assert_eq!(w.c().balance(&bob).yt, 0);
    assert_eq!(w.c().redeem(&bob, &face, &(80 * UNIT)), 80 * UNIT);
    assert_eq!(w.t().balance(&alice), 20 * UNIT);
    assert_eq!(w.t().balance(&bob), 80 * UNIT);
    assert_eq!(w.t().balance(&w.series), 0);
    assert_eq!(w.c().state().face, 0);
    assert_eq!(w.c().state().backing, 0);
    std::println!("100 mock USTRY at $1.25 -> $125 PT + $125 YT; NAV $1.5625 -> 20 USTRY yield + 80 USTRY principal; custody reconciles to 100 USTRY");
}

#[cfg(feature = "wasm-tests")]
#[test]
fn compiled_wasm_contracts_complete_cross_contract_lifecycle() {
    let w = World::build(false, "USD", 8, true);
    let alice = w.user(100 * UNIT);
    let face = w.split(&alice, 100 * UNIT);
    assert_eq!(face, 125 * UNIT);
    w.publish(100, UP);
    assert_eq!(w.c().claim_yield(&alice), 20 * UNIT);
    w.mature(UP);
    assert_eq!(w.c().redeem(&alice, &face, &0), 80 * UNIT);
    assert_eq!(w.t().balance(&alice), 100 * UNIT);
    assert_eq!(w.t().balance(&w.series), 0);
}

#[test]
fn paired_exit_keeps_earned_yield_claimable() {
    let w = World::new();
    let alice = w.user(100 * UNIT);
    let face = w.split(&alice, 100 * UNIT);
    w.publish(100, UP);
    assert_eq!(w.c().redeem(&alice, &face, &0), 80 * UNIT);
    assert_eq!(w.c().balance(&alice).yt, 0);
    assert_eq!(w.c().claim_yield(&alice), 20 * UNIT);
    assert_eq!(w.t().balance(&alice), 100 * UNIT);
}

#[test]
fn falling_nav_reduces_dollar_value_without_inventing_tokens() {
    let w = World::new();
    let alice = w.user(100 * UNIT);
    let face = w.split(&alice, 100 * UNIT);
    w.publish(100, PRICE_SCALE); // $1: the $125 face is not a guarantee.
    assert_eq!(w.c().claim_yield(&alice), 0);
    assert_eq!(w.c().state().high_water, ENTRY);
    let paid = w.c().redeem(&alice, &face, &0);
    assert_eq!(paid, 100 * UNIT);
    assert_eq!(w.c().value_usd(&paid), 100 * UNIT);
    assert!(w.c().value_usd(&paid) < face);
    assert_eq!(w.t().balance(&w.series), 0);
}

#[test]
fn recovery_below_previous_peak_pays_no_new_yield() {
    let w = World::new();
    let alice = w.user(100 * UNIT);
    w.split(&alice, 100 * UNIT);
    w.publish(100, UP);
    assert_eq!(w.c().claim_yield(&alice), 20 * UNIT);
    for (offset, price) in [(200, 140_000_000), (300, 150_000_000), (400, UP)] {
        w.publish(offset, price);
        assert_eq!(w.c().claim_yield(&alice), 0);
    }
    w.publish(500, 195_312_500);
    assert_eq!(w.c().claim_yield(&alice), 16 * UNIT);
}

#[test]
fn drawdown_blocks_new_splits_but_receipts_can_exit() {
    let w = World::new();
    let alice = w.user(100 * UNIT);
    w.split(&alice, 100 * UNIT);
    w.publish(100, PRICE_SCALE);
    let bob = w.user(20 * UNIT);
    w.c().deposit(&bob, &(20 * UNIT));
    assert_eq!(
        w.c().try_split(&bob, &(20 * UNIT), &0),
        Err(Ok(RwaError::Drawdown.into()))
    );
    w.c().withdraw_receipts(&bob, &(20 * UNIT));
    assert_eq!(w.t().balance(&bob), 20 * UNIT);
    assert_eq!(w.c().state().backing, 100 * UNIT);
}

#[test]
fn stale_prices_block_valuation_actions_and_preserve_receipt_exit() {
    let w = World::new();
    let alice = w.user(120 * UNIT);
    let face = w.split(&alice, 100 * UNIT);
    w.c().deposit(&alice, &(20 * UNIT));
    let bob = w.user(0);
    w.env.ledger().set_timestamp(START + AGE + 1);
    let before = w.c().state();
    assert_eq!(
        w.c().try_split(&alice, &(20 * UNIT), &0),
        Err(Ok(RwaError::OracleStale.into()))
    );
    assert_eq!(
        w.c().try_redeem(&alice, &face, &0),
        Err(Ok(RwaError::OracleStale.into()))
    );
    assert_eq!(
        w.c().try_claim_yield(&alice),
        Err(Ok(RwaError::OracleStale.into()))
    );
    assert_eq!(
        w.facade(2).try_transfer(&alice, &bob, &face),
        Err(Ok(RwaError::OracleStale.into()))
    );
    assert_eq!(
        w.c().try_value_usd(&UNIT),
        Err(Ok(RwaError::OracleStale.into()))
    );
    assert_eq!(w.c().state(), before);
    w.c().withdraw_receipts(&alice, &(20 * UNIT));
    assert_eq!(w.t().balance(&alice), 20 * UNIT);
    assert_eq!(w.c().balance(&alice).pt, face);
}

#[test]
fn freshness_boundary_is_inclusive_and_refresh_recovers_operations() {
    let w = World::new();
    w.env.ledger().set_timestamp(START + AGE);
    w.c().sync();
    w.env.ledger().set_timestamp(START + AGE + 1);
    assert_eq!(w.c().try_sync(), Err(Ok(RwaError::OracleStale.into())));
    w.o().publish(&ENTRY, &(START + AGE + 1));
    w.c().sync();
}

#[test]
fn invalid_prices_and_future_timestamps_fail_without_mutation() {
    for (price, timestamp, expected) in [
        (0, START + 1, RwaError::OraclePrice),
        (-1, START + 1, RwaError::OraclePrice),
        (ENTRY, START + 3, RwaError::OracleFuture),
        (ENTRY, (START + 1) * 1000, RwaError::OracleFuture),
    ] {
        let w = World::new();
        let alice = w.user(100 * UNIT);
        w.c().deposit(&alice, &(100 * UNIT));
        w.env.ledger().set_timestamp(START + 2);
        let before = w.c().state();
        w.o().publish(&price, &timestamp);
        assert_eq!(
            w.c().try_split(&alice, &(100 * UNIT), &0),
            Err(Ok(expected.into()))
        );
        assert_eq!(w.c().state(), before);
        assert_eq!(w.c().balance(&alice).receipt, 100 * UNIT);
        w.c().withdraw_receipts(&alice, &(100 * UNIT));
    }
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn wrong_asset_is_rejected() {
    World::with_metadata(true, "USD", 8);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn wrong_base_is_rejected() {
    World::with_metadata(false, "EUR", 8);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn wrong_precision_is_rejected() {
    World::with_metadata(false, "USD", 7);
}

#[test]
fn unobserved_peak_is_not_lost_when_nav_has_already_fallen() {
    let w = World::new();
    let alice = w.user(100 * UNIT);
    w.split(&alice, 100 * UNIT);
    w.publish(100, UP);
    w.publish(200, 140_000_000);
    // There was no series call at the peak. Append-only history preserves it.
    assert_eq!(w.c().claim_yield(&alice), 20 * UNIT);
    assert_eq!(w.c().state().high_water, UP);
}

#[test]
fn late_maturity_uses_pre_expiry_history_without_interpolating_post_expiry_gain() {
    let w = World::new();
    let alice = w.user(100 * UNIT);
    let face = w.split(&alice, 100 * UNIT);
    w.publish(900, UP);
    w.publish(1100, 250_000_000);
    w.env.ledger().set_timestamp(START + 5000);
    let state = w.c().finalize();
    assert_eq!(state.high_water, UP);
    assert_eq!(state.last_observation.timestamp, START + 900);
    assert_eq!(w.c().claim_yield(&alice), 20 * UNIT);
    assert_eq!(w.c().redeem(&alice, &face, &0), 80 * UNIT);
    // Post-maturity USD gains/losses belong to the fixed token allocations.
    assert_eq!(w.c().state().backing, 0);
}

#[test]
fn maturity_waits_for_history_coverage_and_rejects_stale_boundary_price() {
    let w = World::new();
    let alice = w.user(100 * UNIT);
    w.split(&alice, 100 * UNIT);
    w.publish(900, UP);
    w.env.ledger().set_timestamp(START + TERM);
    assert_eq!(
        w.c().try_finalize(),
        Err(Ok(RwaError::MaturityPending.into()))
    );
    w.publish(1100, UP);
    assert!(w.c().finalize().finalized);

    let stale = World::new();
    stale.publish(500, UP);
    stale.publish(1100, UP);
    assert_eq!(
        stale.c().try_finalize(),
        Err(Ok(RwaError::OracleStale.into()))
    );
    assert!(!stale.c().state().finalized);
}

#[test]
fn finalized_payouts_survive_oracle_outage_and_do_not_change_allocation() {
    let w = World::new();
    let alice = w.user(100 * UNIT);
    let face = w.split(&alice, 100 * UNIT);
    w.mature(UP);
    let frozen = w.c().state();
    w.env.ledger().set_timestamp(START + 5000);
    w.o().publish(&0, &(START + 6000)); // Broken and future-dated; no longer needed for payouts.
    assert_eq!(w.c().finalize(), frozen);
    assert_eq!(w.c().claim_yield(&alice), 20 * UNIT);
    assert_eq!(w.c().redeem(&alice, &face, &0), 80 * UNIT);
    assert_eq!(w.t().balance(&alice), 100 * UNIT);
}

#[test]
fn new_depositor_does_not_receive_existing_holders_yield() {
    let w = World::new();
    let alice = w.user(100 * UNIT);
    w.split(&alice, 100 * UNIT);
    w.publish(100, UP);
    let bob = w.user(100 * UNIT);
    assert_eq!(w.split(&bob, 100 * UNIT), 156 * UNIT + UNIT / 4);
    assert_eq!(w.c().claim_yield(&bob), 0);
    assert_eq!(w.c().claim_yield(&alice), 20 * UNIT);
    w.publish(200, 195_312_500);
    assert_eq!(w.c().claim_yield(&alice), 16 * UNIT);
    assert_eq!(w.c().claim_yield(&bob), 20 * UNIT);
}

#[test]
fn yt_transfer_settles_both_parties_and_preserves_sellers_prior_earnings() {
    let w = World::new();
    let alice = w.user(100 * UNIT);
    let bob = w.user(0);
    let face = w.split(&alice, 100 * UNIT);
    w.publish(100, UP);
    w.facade(2).transfer(&alice, &bob, &face);
    assert_eq!(w.c().claim_yield(&bob), 0);
    assert_eq!(w.c().claim_yield(&alice), 20 * UNIT);
    w.publish(200, 195_312_500);
    assert_eq!(w.c().claim_yield(&alice), 0);
    assert_eq!(w.c().claim_yield(&bob), 16 * UNIT);
    assert_eq!(
        w.c().try_redeem(&alice, &face, &0),
        Err(Ok(RwaError::Balance.into()))
    );
    w.facade(2).transfer(&bob, &alice, &face);
    assert_eq!(w.c().redeem(&alice, &face, &0), 64 * UNIT);
    assert_eq!(w.t().balance(&w.series), 0);
}

#[test]
fn slippage_failure_is_atomic_and_invalid_amounts_cannot_mint_or_withdraw() {
    let w = World::new();
    let alice = w.user(100 * UNIT);
    w.c().deposit(&alice, &(100 * UNIT));
    let before = w.c().state();
    assert_eq!(
        w.c().try_split(&alice, &(100 * UNIT), &(126 * UNIT)),
        Err(Ok(RwaError::Slippage.into()))
    );
    assert_eq!(w.c().state(), before);
    let face = w.c().split(&alice, &(100 * UNIT), &0);
    let h = w.c().balance(&alice);
    assert_eq!(
        w.c().try_redeem(&alice, &face, &(101 * UNIT)),
        Err(Ok(RwaError::Slippage.into()))
    );
    assert_eq!(w.c().balance(&alice), h);
    for amount in [0, -1] {
        assert_eq!(
            w.c().try_deposit(&alice, &amount),
            Err(Ok(RwaError::Amount.into()))
        );
        assert_eq!(
            w.c().try_withdraw_receipts(&alice, &amount),
            Err(Ok(RwaError::Amount.into()))
        );
        assert_eq!(
            w.c().try_split(&alice, &amount, &0),
            Err(Ok(RwaError::Amount.into()))
        );
        assert_eq!(
            w.c().try_redeem(&alice, &amount, &0),
            Err(Ok(RwaError::Amount.into()))
        );
    }
}

#[test]
fn users_cannot_spend_others_claims_or_publish_prices_without_auth() {
    let w = World::new();
    let alice = w.user(100 * UNIT);
    let bob = w.user(0);
    let face = w.split(&alice, 100 * UNIT);
    w.env.mock_auths(&[]);
    assert!(w.c().try_redeem(&alice, &face, &0).is_err());
    assert!(w.c().try_claim_yield(&alice).is_err());
    assert!(w.facade(1).try_transfer(&alice, &bob, &face).is_err());
    assert!(w.facade(2).try_transfer(&alice, &bob, &face).is_err());
    assert!(w.c().try_deposit(&alice, &UNIT).is_err());
    assert!(w.c().try_withdraw_receipts(&alice, &UNIT).is_err());
    w.env.ledger().set_timestamp(START + 1);
    assert!(w.o().try_publish(&UP, &(START + 1)).is_err());
    assert_eq!(w.c().balance(&alice).pt, face);
    assert_eq!(w.o().observations().len(), 1);
    assert_ne!(w.admin, alice);
}

#[test]
fn unsplit_receipts_are_separate_from_yield_backing() {
    let w = World::new();
    let alice = w.user(100 * UNIT);
    let bob = w.user(50 * UNIT);
    let face = w.split(&alice, 100 * UNIT);
    w.c().deposit(&bob, &(50 * UNIT));
    w.publish(100, UP);
    assert_eq!(w.c().claim_yield(&alice), 20 * UNIT);
    assert_eq!(w.c().redeem(&alice, &face, &0), 80 * UNIT);
    assert_eq!(w.t().balance(&w.series), 50 * UNIT);
    w.c().withdraw_receipts(&bob, &(50 * UNIT));
    assert_eq!(w.t().balance(&w.series), 0);
}

#[test]
fn self_transfers_do_not_duplicate_balances() {
    let w = World::new();
    let alice = w.user(100 * UNIT);
    let face = w.split(&alice, 100 * UNIT);
    w.publish(100, UP);
    w.facade(2).transfer(&alice, &alice, &face);
    w.facade(1).transfer(&alice, &alice, &face);
    assert_eq!(w.c().balance(&alice).pt, face);
    assert_eq!(w.c().balance(&alice).yt, face);
    assert_eq!(w.c().claim_yield(&alice), 20 * UNIT);
}

#[test]
fn deposits_and_splits_close_exactly_at_expiry() {
    let w = World::new();
    let alice = w.user(100 * UNIT);
    w.c().deposit(&alice, &(100 * UNIT));
    assert_eq!(w.c().try_finalize(), Err(Ok(RwaError::NotExpired.into())));
    w.env.ledger().set_timestamp(START + TERM);
    assert_eq!(
        w.c().try_deposit(&alice, &UNIT),
        Err(Ok(RwaError::Expired.into()))
    );
    assert_eq!(
        w.c().try_split(&alice, &UNIT, &0),
        Err(Ok(RwaError::Expired.into()))
    );
    w.c().withdraw_receipts(&alice, &(100 * UNIT));
}

#[test]
fn issuer_freeze_blocks_payout_without_burning_claims_and_unfreeze_recovers() {
    let w = World::new();
    let alice = w.user(100 * UNIT);
    let face = w.split(&alice, 100 * UNIT);
    let asset_admin = StellarAssetClient::new(&w.env, &w.asset);
    asset_admin.set_authorized(&w.series, &false);
    w.publish(100, UP);
    let state = w.c().state();
    let claims = w.c().balance(&alice);
    assert!(w.c().try_claim_yield(&alice).is_err());
    assert!(w.c().try_redeem(&alice, &face, &0).is_err());
    assert_eq!(w.c().state(), state);
    assert_eq!(w.c().balance(&alice), claims);
    asset_admin.set_authorized(&w.series, &true);
    assert_eq!(w.c().claim_yield(&alice), 20 * UNIT);
    assert_eq!(w.c().redeem(&alice, &face, &0), 80 * UNIT);
}

#[test]
fn issuer_clawback_causes_custody_failure_without_erasing_claims() {
    let w = World::new();
    let alice = w.user(100 * UNIT);
    let face = w.split(&alice, 100 * UNIT);
    StellarAssetClient::new(&w.env, &w.asset).clawback(&w.series, &UNIT);
    let state = w.c().state();
    let claims = w.c().balance(&alice);
    // A partial transfer could physically succeed, but the custody invariant
    // rejects it atomically: an early claimant cannot drain impaired reserves.
    assert_eq!(
        w.c().try_redeem(&alice, &(face / 2), &0),
        Err(Ok(RwaError::Insolvent.into()))
    );
    assert_eq!(
        w.c().try_claim_yield(&alice),
        Err(Ok(RwaError::Insolvent.into()))
    );
    assert_eq!(w.c().state(), state);
    assert_eq!(w.c().balance(&alice), claims);
    assert_eq!(w.t().balance(&w.series), 99 * UNIT);
    assert_eq!(w.t().balance(&alice), 0);
}

#[test]
fn price_at_exact_expiry_is_included_but_later_prices_are_excluded() {
    let w = World::new();
    let alice = w.user(100 * UNIT);
    w.split(&alice, 100 * UNIT);
    w.publish(TERM, UP);
    assert_eq!(w.c().finalize().high_water, UP);
    w.publish(TERM + 1, 250_000_000);
    assert_eq!(w.c().finalize().high_water, UP);
    assert_eq!(w.c().claim_yield(&alice), 20 * UNIT);
}

#[test]
fn fractional_rounding_multiple_entries_transfers_and_exits_conserve_tokens() {
    let w = World::new();
    let mut users = std::vec::Vec::new();
    let mut deposited = 0;
    let mut paid = 0;
    // Different entry NAVs and non-round token quantities exercise rounding and
    // independent interest checkpoints; prices include a drawdown and recovery.
    for i in 0..6 {
        w.publish(10 + i * 10, ENTRY + i as i128 * 123_457);
        let amount = (10 + i as i128) * UNIT + 137;
        let user = w.user(amount);
        w.split(&user, amount);
        users.push(user);
        deposited += amount;
    }
    for (i, price) in [130_000_007, 127_000_003, 131_111_119, 133_333_337]
        .into_iter()
        .enumerate()
    {
        w.publish(100 + i as u64 * 50, price);
        for user in &users {
            paid += w.c().claim_yield(user);
        }
        let from = &users[i];
        let to = &users[i + 1];
        let amount = w.c().balance(from).yt / 7;
        w.facade(2).transfer(from, to, &amount);
    }
    w.mature(134_567_891);
    for user in &users {
        paid += w.c().claim_yield(user);
        let face = w.c().balance(user).pt;
        let half = face / 2;
        paid += w.c().redeem(user, &half, &0);
        paid += w.c().redeem(user, &(face - half), &0);
    }
    assert_eq!(w.c().state().face, 0);
    assert!(paid <= deposited);
    let dust = w.t().balance(&w.series);
    assert_eq!(paid + dust, deposited);
    assert_eq!(w.c().state().backing, dust);
    assert!(dust < 100); // <0.00001 tokens across this whole lifecycle.
}

#[test]
fn atomic_deposit_slippage_rolls_back_and_cap_is_enforced() {
    let w = World::new();
    let user = w.user(2_000 * UNIT);
    assert!(w.c().try_deposit_split(&user, &UNIT, &(2 * UNIT)).is_err());
    assert_eq!(w.t().balance(&user), 2_000 * UNIT);
    assert_eq!(w.c().balance(&user).receipt, 0);
    assert!(w.c().try_deposit(&user, &(1_001 * UNIT)).is_err());
    w.c().deposit_split(&user, &UNIT, &UNIT);
    assert_eq!(w.facade(1).balance(&user), w.c().balance(&user).pt);
}

#[test]
fn pause_blocks_new_exposure_but_not_receipt_exit_or_recombination() {
    let w = World::new();
    let user = w.user(3 * UNIT);
    w.c().deposit(&user, &(2 * UNIT));
    let face = w.c().split(&user, &UNIT, &0);
    w.c().set_paused(&true);
    assert!(w.c().try_deposit(&user, &UNIT).is_err());
    assert!(w.c().try_split(&user, &UNIT, &0).is_err());
    w.c().withdraw_receipts(&user, &UNIT);
    w.c().redeem(&user, &face, &0);
    assert_eq!(w.t().balance(&user), 3 * UNIT);
    assert_eq!(w.facade(2).total_supply(), 0);
}

#[test]
fn facade_allowance_auth_is_only_spender_and_expiry_is_enforced() {
    use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
    use soroban_sdk::IntoVal;
    let w = World::new();
    let owner = w.user(2 * UNIT);
    let spender = w.user(0);
    let to = w.user(0);
    let face = w.c().deposit_split(&owner, &UNIT, &0);
    let pt_id = w.c().config().tokens.get(1).unwrap();
    w.facade(1).approve(&owner, &spender, &face, &1000);
    // Switch off blanket mocks: delegated transfer must need only spender, not owner.
    let invoke = MockAuthInvoke {
        contract: &pt_id,
        fn_name: "transfer_from",
        args: (spender.clone(), owner.clone(), to.clone(), face).into_val(&w.env),
        sub_invokes: &[],
    };
    w.facade(1)
        .mock_auths(&[MockAuth {
            address: &spender,
            invoke: &invoke,
        }])
        .transfer_from(&spender, &owner, &to, &face);
    assert_eq!(w.facade(1).balance(&to), face);
    assert_eq!(w.facade(1).allowance(&owner, &spender), 0);
    w.env.set_auths(&[]);
    assert!(w.c().try_transfer_claim(&to, &owner, &face, &1).is_err());
    w.env.mock_all_auths();
    w.facade(0).approve(&owner, &spender, &UNIT, &10);
    w.env.ledger().set_sequence_number(11);
    assert_eq!(w.facade(0).allowance(&owner, &spender), 0);
    assert!(w
        .facade(0)
        .try_transfer_from(&spender, &owner, &to, &UNIT)
        .is_err());
}

#[test]
fn yt_burn_retains_prior_earnings_and_rebinding_fails() {
    let w = World::new();
    let owner = w.user(UNIT);
    let face = w.c().deposit_split(&owner, &UNIT, &0);
    let t = w.c().config().tokens;
    assert!(w
        .c()
        .try_bind_tokens(&t.get(0).unwrap(), &t.get(1).unwrap(), &t.get(2).unwrap())
        .is_err());
    w.publish(10, UP);
    w.facade(2).burn(&owner, &face);
    assert_eq!(w.facade(2).total_supply(), 0);
    assert_eq!(w.c().claim_yield(&owner), 2_000_000);
    w.mature(UP);
    assert_eq!(w.c().redeem(&owner, &face, &0), 8_000_000);
    assert_eq!(w.t().balance(&owner), UNIT);
}
