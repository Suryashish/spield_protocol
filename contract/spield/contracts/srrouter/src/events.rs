//! Router events.
//!
//! Each one records the **end-to-end** trade the user actually asked for — USDC in, PT/YT out —
//! not the SR leg in the middle. The SR hop still emits its own events from `sr`/`srmarket`; these
//! exist so an indexer can reconstruct "what did this user do" without re-deriving the route.

use soroban_sdk::{contractevent, Address, Env};

#[contractevent(topics = ["router", "buy_pt"])]
pub struct BoughtPt {
    #[topic]
    pub user: Address,
    pub usdc_in: i128,
    pub sr_mid: i128,
    pub pt_out: i128,
}

#[contractevent(topics = ["router", "buy_yt"])]
pub struct BoughtYt {
    #[topic]
    pub user: Address,
    pub usdc_spent: i128,
    pub yt_out: i128,
    pub usdc_refund: i128,
    pub sr_refund: i128,
}

#[contractevent(topics = ["router", "sell_pt"])]
pub struct SoldPt {
    #[topic]
    pub user: Address,
    pub pt_in: i128,
    pub sr_mid: i128,
    pub usdc_out: i128,
}

#[contractevent(topics = ["router", "sell_yt"])]
pub struct SoldYt {
    #[topic]
    pub user: Address,
    pub yt_in: i128,
    pub sr_mid: i128,
    pub usdc_out: i128,
}

#[contractevent(topics = ["router", "redeem"])]
pub struct RedeemedForUsdc {
    #[topic]
    pub user: Address,
    pub py_in: i128,
    pub sr_mid: i128,
    pub usdc_out: i128,
    pub after_expiry: bool,
}

#[contractevent(topics = ["router", "claim"])]
pub struct YieldClaimed {
    #[topic]
    pub user: Address,
    pub sr_net: i128,
    pub sr_fee: i128,
    pub usdc_out: i128,
}

pub fn bought_pt(env: &Env, user: &Address, usdc_in: i128, sr_mid: i128, pt_out: i128) {
    BoughtPt { user: user.clone(), usdc_in, sr_mid, pt_out }.publish(env);
}
pub fn bought_yt(
    env: &Env, user: &Address, usdc_spent: i128, yt_out: i128, usdc_refund: i128, sr_refund: i128,
) {
    BoughtYt { user: user.clone(), usdc_spent, yt_out, usdc_refund, sr_refund }.publish(env);
}
pub fn sold_pt(env: &Env, user: &Address, pt_in: i128, sr_mid: i128, usdc_out: i128) {
    SoldPt { user: user.clone(), pt_in, sr_mid, usdc_out }.publish(env);
}
pub fn sold_yt(env: &Env, user: &Address, yt_in: i128, sr_mid: i128, usdc_out: i128) {
    SoldYt { user: user.clone(), yt_in, sr_mid, usdc_out }.publish(env);
}
pub fn redeemed_for_usdc(
    env: &Env, user: &Address, py_in: i128, sr_mid: i128, usdc_out: i128, after_expiry: bool,
) {
    RedeemedForUsdc { user: user.clone(), py_in, sr_mid, usdc_out, after_expiry }.publish(env);
}
pub fn yield_claimed(env: &Env, user: &Address, sr_net: i128, sr_fee: i128, usdc_out: i128) {
    YieldClaimed { user: user.clone(), sr_net, sr_fee, usdc_out }.publish(env);
}
