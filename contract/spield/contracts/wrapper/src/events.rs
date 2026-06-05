//! Contract events for off-chain indexing (frontend, solvency dashboard), using the
//! `#[contractevent]` macro (the modern, non-deprecated emission path in soroban-sdk 25).

use soroban_sdk::{contractevent, Address, Env};

#[contractevent]
#[derive(Clone)]
pub struct Mint {
    #[topic]
    pub user: Address,
    pub position_id: u64,
    pub amount: i128,
    pub entry_rate: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct Claim {
    #[topic]
    pub user: Address,
    pub position_id: u64,
    pub payout: i128,
    pub rate: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct RedeemPt {
    #[topic]
    pub user: Address,
    pub position_id: u64,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct Combine {
    #[topic]
    pub user: Address,
    pub position_id: u64,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct TransferPosition {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub position_id: u64,
}

#[contractevent]
#[derive(Clone)]
pub struct PausedEvent {
    pub paused: bool,
}

pub fn minted(env: &Env, user: &Address, id: u64, amount: i128, entry_rate: i128) {
    Mint {
        user: user.clone(),
        position_id: id,
        amount,
        entry_rate,
    }
    .publish(env);
}

pub fn claimed(env: &Env, user: &Address, id: u64, payout: i128, rate: i128) {
    Claim {
        user: user.clone(),
        position_id: id,
        payout,
        rate,
    }
    .publish(env);
}

pub fn redeemed_pt(env: &Env, user: &Address, id: u64, amount: i128) {
    RedeemPt {
        user: user.clone(),
        position_id: id,
        amount,
    }
    .publish(env);
}

pub fn combined(env: &Env, user: &Address, id: u64, amount: i128) {
    Combine {
        user: user.clone(),
        position_id: id,
        amount,
    }
    .publish(env);
}

pub fn transferred(env: &Env, from: &Address, to: &Address, id: u64) {
    TransferPosition {
        from: from.clone(),
        to: to.clone(),
        position_id: id,
    }
    .publish(env);
}

pub fn paused(env: &Env, paused: bool) {
    PausedEvent { paused }.publish(env);
}
