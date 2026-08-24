//! Events for the PT/YT engine, via `#[contractevent]`.

use soroban_sdk::{contractevent, Address, Env};

#[contractevent]
#[derive(Clone)]
pub struct Initialized {
    #[topic]
    pub sr: Address,
    #[topic]
    pub pt: Address,
    pub expiry: u64,
    pub yield_fee_bps: u32,
    pub index: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct MintPy {
    #[topic]
    pub from: Address,
    #[topic]
    pub receiver: Address,
    pub sr_in: i128,
    pub py_out: i128,
    pub index: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct RedeemPy {
    #[topic]
    pub from: Address,
    #[topic]
    pub receiver: Address,
    pub py_in: i128,
    pub sr_out: i128,
    pub index: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct InterestPaid {
    #[topic]
    pub user: Address,
    pub net_to_user: i128,
    pub fee_to_treasury: i128,
    pub index: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct YtTransfer {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct YtBurn {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

/// The index was pinned at expiry. After this, YT accrues nothing.
#[contractevent]
#[derive(Clone)]
pub struct ExpiryStamped {
    pub index: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct SurplusSwept {
    pub sr_amount: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct YieldFeeSet {
    pub bps: u32,
}

pub fn initialized(env: &Env, sr: &Address, pt: &Address, expiry: u64, fee: u32, index: i128) {
    Initialized {
        sr: sr.clone(),
        pt: pt.clone(),
        expiry,
        yield_fee_bps: fee,
        index,
    }
    .publish(env);
}

pub fn minted(env: &Env, from: &Address, receiver: &Address, sr_in: i128, py_out: i128, index: i128) {
    MintPy {
        from: from.clone(),
        receiver: receiver.clone(),
        sr_in,
        py_out,
        index,
    }
    .publish(env);
}

pub fn redeemed(env: &Env, from: &Address, receiver: &Address, py_in: i128, sr_out: i128, index: i128) {
    RedeemPy {
        from: from.clone(),
        receiver: receiver.clone(),
        py_in,
        sr_out,
        index,
    }
    .publish(env);
}

pub fn interest_paid(env: &Env, user: &Address, net: i128, fee: i128, index: i128) {
    InterestPaid {
        user: user.clone(),
        net_to_user: net,
        fee_to_treasury: fee,
        index,
    }
    .publish(env);
}

pub fn yt_transferred(env: &Env, from: &Address, to: &Address, amount: i128) {
    YtTransfer {
        from: from.clone(),
        to: to.clone(),
        amount,
    }
    .publish(env);
}

pub fn yt_burned(env: &Env, from: &Address, amount: i128) {
    YtBurn {
        from: from.clone(),
        amount,
    }
    .publish(env);
}

pub fn expiry_stamped(env: &Env, index: i128) {
    ExpiryStamped { index }.publish(env);
}

pub fn surplus_swept(env: &Env, sr_amount: i128) {
    SurplusSwept { sr_amount }.publish(env);
}

pub fn yield_fee_set(env: &Env, bps: u32) {
    YieldFeeSet { bps }.publish(env);
}
