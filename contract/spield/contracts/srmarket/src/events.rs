//! Events for the PT/SR market. Fee events carry BOTH halves of the split, so revenue and LP
//! earnings are reconstructable from the log alone.

use soroban_sdk::{contractevent, Address, Env};

#[contractevent]
#[derive(Clone)]
pub struct Initialized {
    #[topic]
    pub yield_contract: Address,
    #[topic]
    pub pt: Address,
    pub sr: Address,
    pub expiry: u64,
    pub scalar_root: i128,
    pub ln_fee_root: i128,
    pub ln_implied_rate: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct AddLiquidity {
    #[topic]
    pub lp: Address,
    pub pt_in: i128,
    pub sr_in: i128,
    pub shares_minted: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct RemoveLiquidity {
    #[topic]
    pub lp: Address,
    pub shares_burned: i128,
    pub pt_out: i128,
    pub sr_out: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct Swap {
    #[topic]
    pub trader: Address,
    /// True for PT→SR, false for SR→PT.
    pub pt_in: bool,
    pub amount_in: i128,
    pub amount_out: i128,
    /// Total fee charged, in SR.
    pub fee_sr: i128,
    /// The part of `fee_sr` sent to the treasury. `fee_sr - fee_to_treasury` stayed with LPs.
    pub fee_to_treasury: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct YtTrade {
    #[topic]
    pub user: Address,
    /// True for a buy, false for a sale.
    pub is_buy: bool,
    pub yt_amount: i128,
    pub sr_amount: i128,
    pub fee_sr: i128,
    pub fee_to_treasury: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct FeeRootSet {
    pub ln_fee_root: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct TreasuryShareSet {
    pub bps: u32,
}

#[allow(clippy::too_many_arguments)]
pub fn initialized(
    env: &Env,
    yield_contract: &Address,
    pt: &Address,
    sr: &Address,
    expiry: u64,
    scalar_root: i128,
    ln_fee_root: i128,
    ln_implied_rate: i128,
) {
    Initialized {
        yield_contract: yield_contract.clone(),
        pt: pt.clone(),
        sr: sr.clone(),
        expiry,
        scalar_root,
        ln_fee_root,
        ln_implied_rate,
    }
    .publish(env);
}

pub fn added(env: &Env, lp: &Address, pt_in: i128, sr_in: i128, shares_minted: i128) {
    AddLiquidity { lp: lp.clone(), pt_in, sr_in, shares_minted }.publish(env);
}

pub fn removed(env: &Env, lp: &Address, shares_burned: i128, pt_out: i128, sr_out: i128) {
    RemoveLiquidity { lp: lp.clone(), shares_burned, pt_out, sr_out }.publish(env);
}

pub fn swapped(
    env: &Env,
    trader: &Address,
    pt_in: bool,
    amount_in: i128,
    amount_out: i128,
    fee_sr: i128,
    fee_to_treasury: i128,
) {
    Swap {
        trader: trader.clone(),
        pt_in,
        amount_in,
        amount_out,
        fee_sr,
        fee_to_treasury,
    }
    .publish(env);
}

pub fn yt_traded(
    env: &Env,
    user: &Address,
    is_buy: bool,
    yt_amount: i128,
    sr_amount: i128,
    fee_sr: i128,
    fee_to_treasury: i128,
) {
    YtTrade {
        user: user.clone(),
        is_buy,
        yt_amount,
        sr_amount,
        fee_sr,
        fee_to_treasury,
    }
    .publish(env);
}

pub fn fee_root_set(env: &Env, ln_fee_root: i128) {
    FeeRootSet { ln_fee_root }.publish(env);
}

pub fn treasury_share_set(env: &Env, bps: u32) {
    TreasuryShareSet { bps }.publish(env);
}
