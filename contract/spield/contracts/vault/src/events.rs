//! Contract events for off-chain indexing (frontend vault panel, solvency dashboard), using the
//! `#[contractevent]` macro — the same emission path the wrapper uses.

use soroban_sdk::{contractevent, Address, Env};

#[contractevent]
#[derive(Clone)]
pub struct Deposit {
    #[topic]
    pub user: Address,
    pub receipt_id: u64,
    pub principal: i128,
    pub payout: i128,
    pub rate_bps: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct Redeem {
    #[topic]
    pub user: Address,
    pub receipt_id: u64,
    pub payout: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct Harvest {
    /// Yield claimed from the vault's YT and reinvested as fresh PT this harvest.
    pub yield_claimed: i128,
    /// PT inventory added (the new coupon capacity created).
    pub pt_added: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct Seed {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct RateSet {
    pub rate_bps: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct PausedEvent {
    pub paused: bool,
}

/// Emitted once when `initialize` wires the vault to its wrapper market.
#[contractevent]
#[derive(Clone)]
pub struct Initialized {
    #[topic]
    pub admin: Address,
    pub wrapper: Address,
    pub underlying: Address,
    pub rate_bps: u32,
    pub max_rate_bps: u32,
    pub maturity: u64,
}

pub fn initialized(
    env: &Env,
    admin: &Address,
    wrapper: &Address,
    underlying: &Address,
    rate_bps: u32,
    max_rate_bps: u32,
    maturity: u64,
) {
    Initialized {
        admin: admin.clone(),
        wrapper: wrapper.clone(),
        underlying: underlying.clone(),
        rate_bps,
        max_rate_bps,
        maturity,
    }
    .publish(env);
}

pub fn deposited(env: &Env, user: &Address, id: u64, principal: i128, payout: i128, rate_bps: u32) {
    Deposit {
        user: user.clone(),
        receipt_id: id,
        principal,
        payout,
        rate_bps,
    }
    .publish(env);
}

pub fn redeemed(env: &Env, user: &Address, id: u64, payout: i128) {
    Redeem {
        user: user.clone(),
        receipt_id: id,
        payout,
    }
    .publish(env);
}

pub fn harvested(env: &Env, yield_claimed: i128, pt_added: i128) {
    Harvest {
        yield_claimed,
        pt_added,
    }
    .publish(env);
}

pub fn seeded(env: &Env, from: &Address, amount: i128) {
    Seed {
        from: from.clone(),
        amount,
    }
    .publish(env);
}

pub fn rate_set(env: &Env, rate_bps: u32) {
    RateSet { rate_bps }.publish(env);
}

pub fn paused(env: &Env, paused: bool) {
    PausedEvent { paused }.publish(env);
}
