//! Contract events for off-chain indexing (frontend Markets/Trade/LP pages, dashboard), using the
//! `#[contractevent]` macro — the same emission path the wrapper/vault use. topic[0] is the
//! snake_case event name; the frontend maps it back (see `frontend/src/lib/events.ts`).

use soroban_sdk::{contractevent, Address, Env};

#[contractevent]
#[derive(Clone)]
pub struct AddLiquidity {
    #[topic]
    pub lp: Address,
    pub pt_in: i128,
    pub usdc_in: i128,
    pub shares_minted: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct RemoveLiquidity {
    #[topic]
    pub lp: Address,
    pub shares_burned: i128,
    pub pt_out: i128,
    pub usdc_out: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct Swap {
    #[topic]
    pub trader: Address,
    /// True for PT→USDC, false for USDC→PT.
    pub pt_in: bool,
    pub amount_in: i128,
    pub amount_out: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct FeeSet {
    pub fee_bps: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct PausedEvent {
    pub paused: bool,
}

/// Emitted once when `initialize` configures the market (curve params + maturity).
#[contractevent]
#[derive(Clone)]
pub struct Initialized {
    #[topic]
    pub admin: Address,
    pub pt: Address,
    pub usdc: Address,
    pub maturity: u64,
    pub fee_bps: u32,
    pub scalar_root: i128,
    pub rate_anchor: i128,
}

pub fn initialized(
    env: &Env,
    admin: &Address,
    pt: &Address,
    usdc: &Address,
    maturity: u64,
    fee_bps: u32,
    scalar_root: i128,
    rate_anchor: i128,
) {
    Initialized {
        admin: admin.clone(),
        pt: pt.clone(),
        usdc: usdc.clone(),
        maturity,
        fee_bps,
        scalar_root,
        rate_anchor,
    }
    .publish(env);
}

pub fn added(env: &Env, lp: &Address, pt_in: i128, usdc_in: i128, shares_minted: i128) {
    AddLiquidity {
        lp: lp.clone(),
        pt_in,
        usdc_in,
        shares_minted,
    }
    .publish(env);
}

pub fn removed(env: &Env, lp: &Address, shares_burned: i128, pt_out: i128, usdc_out: i128) {
    RemoveLiquidity {
        lp: lp.clone(),
        shares_burned,
        pt_out,
        usdc_out,
    }
    .publish(env);
}

pub fn swapped(env: &Env, trader: &Address, pt_in: bool, amount_in: i128, amount_out: i128) {
    Swap {
        trader: trader.clone(),
        pt_in,
        amount_in,
        amount_out,
    }
    .publish(env);
}

pub fn fee_set(env: &Env, fee_bps: u32) {
    FeeSet { fee_bps }.publish(env);
}

pub fn paused(env: &Env, paused: bool) {
    PausedEvent { paused }.publish(env);
}
