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

/// The `b_rate` capping all YT yield was pinned at maturity. Emitted once, on the first
/// interaction at/after maturity (or by `stamp_maturity_rate`). Indexers can treat this as the
/// instant every YT stopped earning.
#[contractevent]
#[derive(Clone)]
pub struct MaturityRateStamped {
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

/// A position was split into two. `amount` is the principal carved into `new_id`; `settled` is the
/// yield paid to the owner by the mandatory pre-split settlement, which is what makes the new
/// position start earning from this instant rather than carrying the seller's unclaimed yield.
/// Nothing is minted or burned — indexers should treat this as a re-partition, not a supply change.
#[contractevent]
#[derive(Clone)]
pub struct Split {
    #[topic]
    pub owner: Address,
    pub position_id: u64,
    pub new_position_id: u64,
    pub amount: i128,
    pub settled: i128,
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

/// Emitted once when `initialize` wires the market — lets indexers record the market going live
/// (strategy + PT/YT + maturity) without scraping deploy txs.
#[contractevent]
#[derive(Clone)]
pub struct Initialized {
    #[topic]
    pub admin: Address,
    pub strategy: Address,
    pub pt: Address,
    pub yt: Address,
    pub maturity: u64,
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

pub fn split(
    env: &Env,
    owner: &Address,
    position_id: u64,
    new_position_id: u64,
    amount: i128,
    settled: i128,
) {
    Split {
        owner: owner.clone(),
        position_id,
        new_position_id,
        amount,
        settled,
    }
    .publish(env);
}

pub fn maturity_rate_stamped(env: &Env, rate: i128) {
    MaturityRateStamped { rate }.publish(env);
}

pub fn initialized(
    env: &Env,
    admin: &Address,
    strategy: &Address,
    pt: &Address,
    yt: &Address,
    maturity: u64,
) {
    Initialized {
        admin: admin.clone(),
        strategy: strategy.clone(),
        pt: pt.clone(),
        yt: yt.clone(),
        maturity,
    }
    .publish(env);
}
