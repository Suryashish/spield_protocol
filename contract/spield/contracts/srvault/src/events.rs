//! Events for the v2 Fixed-Rate Vault.

use soroban_sdk::{contractevent, Address, Env};

#[contractevent]
#[derive(Clone)]
pub struct Initialized {
    #[topic]
    pub yield_contract: Address,
    #[topic]
    pub pt: Address,
    pub sr: Address,
    pub maturity: u64,
    pub rate_bps: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct Seeded {
    #[topic]
    pub from: Address,
    pub usdc_in: i128,
    pub py_minted: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct Deposited {
    #[topic]
    pub user: Address,
    pub receipt_id: u64,
    pub principal: i128,
    pub payout: i128,
    pub rate_bps: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct Redeemed {
    #[topic]
    pub owner: Address,
    pub receipt_id: u64,
    pub paid: i128,
}

/// A redeem that could only collect part of its payout (`tofix.md` #20). The receipt stays open;
/// `still_owed` is what a later call must still gather before the holder is paid.
#[contractevent]
#[derive(Clone)]
pub struct RedeemedPartial {
    #[topic]
    pub owner: Address,
    pub receipt_id: u64,
    pub collected: i128,
    pub still_owed: i128,
}

/// Surplus SR / YT / USDC returned to the admin at or after expiry (`tofix.md` #22).
#[contractevent]
#[derive(Clone)]
pub struct SurplusSwept {
    #[topic]
    pub to: Address,
    pub sr_amount: i128,
    pub yt_amount: i128,
    pub usdc_amount: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct Harvested {
    pub sr_claimed: i128,
    pub py_minted: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct Swept {
    #[topic]
    pub to: Address,
    pub pt_amount: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct RateSet {
    pub rate_bps: u32,
}

pub fn initialized(env: &Env, y: &Address, pt: &Address, sr: &Address, maturity: u64, rate_bps: u32) {
    Initialized { yield_contract: y.clone(), pt: pt.clone(), sr: sr.clone(), maturity, rate_bps }.publish(env);
}
pub fn seeded(env: &Env, from: &Address, usdc_in: i128, py_minted: i128) {
    Seeded { from: from.clone(), usdc_in, py_minted }.publish(env);
}
pub fn deposited(env: &Env, user: &Address, receipt_id: u64, principal: i128, payout: i128, rate_bps: u32) {
    Deposited { user: user.clone(), receipt_id, principal, payout, rate_bps }.publish(env);
}
pub fn redeemed(env: &Env, owner: &Address, receipt_id: u64, paid: i128) {
    Redeemed { owner: owner.clone(), receipt_id, paid }.publish(env);
}
pub fn redeemed_partial(env: &Env, owner: &Address, receipt_id: u64, collected: i128, still_owed: i128) {
    RedeemedPartial { owner: owner.clone(), receipt_id, collected, still_owed }.publish(env);
}
pub fn harvested(env: &Env, sr_claimed: i128, py_minted: i128) {
    Harvested { sr_claimed, py_minted }.publish(env);
}
pub fn surplus_swept(env: &Env, to: &Address, sr_amount: i128, yt_amount: i128, usdc_amount: i128) {
    SurplusSwept { to: to.clone(), sr_amount, yt_amount, usdc_amount }.publish(env);
}
pub fn swept(env: &Env, to: &Address, pt_amount: i128) {
    Swept { to: to.clone(), pt_amount }.publish(env);
}
pub fn rate_set(env: &Env, rate_bps: u32) {
    RateSet { rate_bps }.publish(env);
}
