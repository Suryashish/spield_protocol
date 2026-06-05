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
