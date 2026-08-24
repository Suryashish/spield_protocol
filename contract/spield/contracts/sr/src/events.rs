//! SR events, via `#[contractevent]` — the same emission path the wrapper/vault/market use.

use soroban_sdk::{contractevent, Address, Env};

#[contractevent]
#[derive(Clone)]
pub struct SrDeposit {
    #[topic]
    pub from: Address,
    #[topic]
    pub receiver: Address,
    pub underlying_in: i128,
    pub shares_out: i128,
    pub rate: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct SrRedeem {
    #[topic]
    pub from: Address,
    #[topic]
    pub receiver: Address,
    pub shares_in: i128,
    pub underlying_out: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct Transfer {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub amount: i128,
}

/// Emitted when the monotonic clamp actually bites — i.e. the strategy's live rate came back
/// BELOW the high-water mark. Rare and worth alerting on.
#[contractevent]
#[derive(Clone)]
pub struct RateClamped {
    pub live: i128,
    pub high_water: i128,
}

pub fn deposited(
    env: &Env,
    from: &Address,
    receiver: &Address,
    underlying_in: i128,
    shares_out: i128,
    rate: i128,
) {
    SrDeposit {
        from: from.clone(),
        receiver: receiver.clone(),
        underlying_in,
        shares_out,
        rate,
    }
    .publish(env);
}

pub fn redeemed(
    env: &Env,
    from: &Address,
    receiver: &Address,
    shares_in: i128,
    underlying_out: i128,
) {
    SrRedeem {
        from: from.clone(),
        receiver: receiver.clone(),
        shares_in,
        underlying_out,
    }
    .publish(env);
}

pub fn transferred(env: &Env, from: &Address, to: &Address, amount: i128) {
    Transfer {
        from: from.clone(),
        to: to.clone(),
        amount,
    }
    .publish(env);
}

pub fn rate_clamped(env: &Env, live: i128, high_water: i128) {
    RateClamped { live, high_water }.publish(env);
}
