//! The series against RedStone's real mainnet contracts and state. Refresh the fixture with
//! `node scripts/fetch_redstone_fork.mjs`, then
//! `cargo test -p spield-ustry-series --features fork-tests -- --nocapture`.
extern crate std;

use super::*;
use soroban_ledger_snapshot::LedgerSnapshot;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::xdr::{LedgerEntry, LedgerEntryData, LedgerEntryExt, LedgerKey, Limits, ReadXdr};
use std::string::String as S;

const UNIT: i128 = 10_000_000;
const FIXTURE: &str = include_str!("../fixtures/redstone-mainnet.txt");
// sha256("Public Global Stellar Network ; September 2015")
const PUBNET: &str = "7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979";

struct Fork {
    env: Env,
    token: Address,
    oracle: Address,
    now: u64,
}

fn fork() -> Fork {
    let mut seq = 0u32;
    let mut now = 0u64;
    let (mut token, mut oracle) = (S::new(), S::new());
    let mut entries = std::vec::Vec::new();
    for line in FIXTURE.lines().filter(|l| !l.starts_with('#')) {
        let f: std::vec::Vec<&str> = line.split(' ').collect();
        match f[0] {
            "sequence" => seq = f[1].parse().unwrap(),
            "timestamp" => now = f[1].parse().unwrap(),
            "token" => token = f[1].into(),
            "oracle" => oracle = f[1].into(),
            "entry" => {
                let k = LedgerKey::from_xdr_base64(f[1], Limits::none()).unwrap();
                let v = LedgerEntry {
                    last_modified_ledger_seq: f[4].parse().unwrap(),
                    data: LedgerEntryData::from_xdr_base64(f[2], Limits::none()).unwrap(),
                    ext: LedgerEntryExt::V0,
                };
                let live: u32 = f[3].parse().unwrap();
                entries.push((std::boxed::Box::new(k), (std::boxed::Box::new(v), (live > 0).then_some(live))));
            }
            _ => {}
        }
    }
    let mut id = [0u8; 32];
    for i in 0..32 {
        id[i] = u8::from_str_radix(&PUBNET[2 * i..2 * i + 2], 16).unwrap();
    }
    let mut env = Env::from_ledger_snapshot(LedgerSnapshot {
        protocol_version: 25,
        sequence_number: seq,
        timestamp: now,
        network_id: id,
        base_reserve: 5_000_000,
        min_persistent_entry_ttl: 120_960,
        min_temp_entry_ttl: 17_280,
        max_entry_ttl: 3_110_400,
        ledger_entries: entries,
    });
    env.set_config(soroban_sdk::testutils::EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    env.mock_all_auths();
    let token = Address::from_str(&env, &token);
    let oracle = Address::from_str(&env, &oracle);
    Fork { env, token, oracle, now }
}

fn mainnet_params() -> Params {
    Params {
        max_age: 13 * 3_600, // RedStone heartbeat 12h + 1h, the research tolerance
        grace: 7 * 86_400,
        max_apr_bps: 2_000,
        cap: 1_000 * UNIT,
        window: 16,
    }
}

fn deploy(f: &Fork) -> (Address, UstrySeriesClient<'_>) {
    let env = &f.env;
    let admin = Address::generate(env);
    let id = env.register(
        UstrySeries,
        (admin, f.token.clone(), f.oracle.clone(), f.now + 30 * 86_400, mainnet_params()),
    );
    let mut t = std::vec::Vec::new();
    for kind in 0..3u32 {
        t.push(env.register(
            spield_rwa_token::ClaimToken,
            (id.clone(), kind, soroban_sdk::String::from_str(env, "c"), soroban_sdk::String::from_str(env, "c")),
        ));
    }
    let c = UstrySeriesClient::new(env, &id);
    c.bind_tokens(&t[0], &t[1], &t[2]);
    (id, c)
}

#[test]
fn redstone_feed_seeds_and_drives_the_series() {
    let f = fork();
    let feed = Sep40Client::new(&f.env, &f.oracle);
    assert_eq!(feed.base(), Asset::Other(Symbol::new(&f.env, "USD")));
    assert_eq!(feed.decimals(), 8);
    let records = feed.prices(&Asset::Stellar(f.token.clone()), &16).unwrap();
    std::println!("RedStone returned {} records", records.len());
    for i in 1..records.len() {
        assert!(records.get(i).unwrap().timestamp > records.get(i - 1).unwrap().timestamp, "oldest first");
    }
    let newest = records.last().unwrap();
    std::println!("newest ${} at {} ({}s old)", newest.price as f64 / 1e8, newest.timestamp, f.now - newest.timestamp);

    let (series, c) = deploy(&f);
    let st = c.status();
    assert!(st.oracle_ok && st.fresh && st.entry_open);
    assert_eq!(st.state.last_observation, newest);
    assert_eq!(c.state().high_water, newest.price);

    // Real USTRY SAC, real feed: deposit, split, claim, combine.
    let user = Address::generate(&f.env);
    StellarAssetClient::new(&f.env, &f.token).mint(&user, &(20 * UNIT));
    f.env.cost_estimate().budget().reset_default();
    let face = c.deposit_split(&user, &(10 * UNIT), &0);
    let cpu = f.env.cost_estimate().budget().cpu_instruction_cost();
    std::println!("deposit_split: {cpu} CPU instructions (mainnet tx limit 100,000,000)");
    assert!(cpu < 60_000_000, "deposit_split must leave headroom under the mainnet limit");
    let factor = (PRICE_SCALE * FACTOR_SCALE + newest.price - 1) / newest.price;
    assert_eq!(face, 10 * UNIT * FACTOR_SCALE / factor); // $1.0785960 × 10, rounded down
    assert_eq!(c.claim_yield(&user), 0);
    let back = c.redeem(&user, &face, &0);
    assert!((10 * UNIT - 2..=10 * UNIT).contains(&back), "{back}");
    assert!(token::Client::new(&f.env, &f.token).balance(&series) >= c.state().receipts + c.state().backing);
}

#[test]
fn redstone_staleness_blocks_entry_but_not_exit() {
    let f = fork();
    let (_, c) = deploy(&f);
    let user = Address::generate(&f.env);
    StellarAssetClient::new(&f.env, &f.token).mint(&user, &(20 * UNIT));
    let face = c.deposit_split(&user, &(10 * UNIT), &0);
    // RedStone silent for a day: whatever the provider does on a stale read, exits stay open.
    f.env.ledger().set_timestamp(f.now + 86_400);
    let st = c.status();
    std::println!("one day later: oracle_ok={} fresh={} entry_open={}", st.oracle_ok, st.fresh, st.entry_open);
    assert!(!st.fresh && !st.entry_open);
    assert!(c.try_deposit_split(&user, &UNIT, &0).is_err());
    c.claim_yield(&user);
    assert!(c.redeem(&user, &face, &0) > 0);
    c.deposit(&user, &UNIT);
    c.withdraw_receipts(&user, &UNIT);
}

#[test]
fn redstone_series_finalizes_through_grace_when_feed_never_crosses_expiry() {
    let f = fork();
    let (_, c) = deploy(&f);
    let user = Address::generate(&f.env);
    StellarAssetClient::new(&f.env, &f.token).mint(&user, &(20 * UNIT));
    let face = c.deposit_split(&user, &(10 * UNIT), &0);
    // The captured feed never reaches expiry: no boundary, so the grace path must take over.
    f.env.ledger().set_timestamp(f.now + 30 * 86_400 + 1);
    assert!(c.try_finalize().is_err());
    f.env.ledger().set_timestamp(f.now + 37 * 86_400);
    assert!(c.finalize().finalized);
    assert!(c.redeem(&user, &face, &0) > 0);
}
