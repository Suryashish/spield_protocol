#![no_std]
//! # spield-strategy — Blend yield-source adapter
//!
//! The only contract in Spield that knows Blend's `submit` / `Request` / `Reserve` shapes.
//! It implements the [`spield_shared::strategy::YieldStrategy`] interface so the wrapper can
//! talk to "the yield source" abstractly (plan §3.2 / §3.5).
//!
//! ## What it does
//! Holds **its own** Blend supply position in one underlying asset (USDC on testnet). Deposits
//! route user USDC into Blend (`RequestType::Supply`); withdrawals pull underlying back out
//! (`RequestType::Withdraw`). "The index" is Blend's real `b_rate`, read live via `get_reserve`
//! — never pushed by a key (this is the SCF-#3 / #8 fix at the source).
//!
//! ## Trust / auth
//! No privileged minting. The only mutating entry points (`deposit`/`redeem`/`redeem_underlying`)
//! require the configured `wrapper` to authorize, and they move only funds the wrapper directs
//! into/out of *this contract's own* Blend position. `initialize` is admin-gated and one-shot.

use blend_contract_sdk::pool::{Client as PoolClient, Request};
use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractimpl, contracttype, panic_with_error, token, Address, Env, IntoVal, Symbol,
    Vec,
};
use spield_shared::{math, types::RateBound, Error};

/// Blend `RequestType` discriminants (verified from `blend-contracts-v2/pool/src/pool/actions.rs`).
/// Encoded as the plain `u32` `request_type` on the wire.
const REQ_SUPPLY: u32 = 0;
const REQ_WITHDRAW: u32 = 1;

/// Instance-storage keys.
#[derive(Clone)]
#[contracttype]
enum DataKey {
    /// One-shot init guard (SCF #7).
    Initialized,
    /// Admin (can pause/upgrade later; not able to move user funds).
    Admin,
    /// The wrapper contract — the only caller allowed to deposit/redeem.
    Wrapper,
    /// The Blend pool contract address.
    Pool,
    /// The underlying asset (USDC SAC) this strategy supplies.
    Underlying,
    /// The reserve index of `Underlying` within the Blend pool (cached at init; Blend reserve
    /// indices are immutable once assigned).
    ReserveIndex,
    /// Rate sanity bound + last-observed rate (defence-in-depth).
    Bound,
}

const INSTANCE_BUMP_LO: u32 = 30 * 24 * 60 * 60 / 5; // ~30 days in ledgers (5s close)
const INSTANCE_BUMP_HI: u32 = 60 * 24 * 60 * 60 / 5; // ~60 days

#[contract]
pub struct BlendStrategy;

#[contractimpl]
impl BlendStrategy {
    /// One-shot, admin-gated initialization.
    ///
    /// * `admin` — operational admin (pause/upgrade path; cannot move user funds).
    /// * `wrapper` — the Spield wrapper; the sole authorized caller of deposit/redeem.
    /// * `pool` — the Blend pool contract.
    /// * `underlying` — the asset SAC (USDC) to supply.
    /// * `max_jump_bps` — max allowed `b_rate` increase per read (sanity bound).
    pub fn initialize(
        env: Env,
        admin: Address,
        wrapper: Address,
        pool: Address,
        underlying: Address,
        max_jump_bps: u32,
    ) {
        let storage = env.storage().instance();
        if storage.has(&DataKey::Initialized) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        admin.require_auth();

        // Discover & cache the reserve index for `underlying` from the live pool.
        let pool_client = PoolClient::new(&env, &pool);
        let reserve = pool_client.get_reserve(&underlying);
        let reserve_index = reserve.config.index;

        storage.set(&DataKey::Initialized, &true);
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::Wrapper, &wrapper);
        storage.set(&DataKey::Pool, &pool);
        storage.set(&DataKey::Underlying, &underlying);
        storage.set(&DataKey::ReserveIndex, &reserve_index);
        storage.set(
            &DataKey::Bound,
            &RateBound {
                last_rate: reserve.data.b_rate,
                max_jump_bps,
            },
        );
        storage.extend_ttl(INSTANCE_BUMP_LO, INSTANCE_BUMP_HI);
    }

    /// Pull `amount` USDC from `from` (the wrapper) and supply it to Blend. Returns shares minted.
    pub fn deposit(env: Env, from: Address, amount: i128) -> i128 {
        Self::require_wrapper(&env, &from);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let pool = Self::pool_addr(&env);
        let underlying = Self::underlying(env.clone());
        let index = Self::reserve_index(&env);

        // Pull the underlying from the wrapper into this strategy contract.
        let token_client = token::Client::new(&env, &underlying);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        // Read shares we hold BEFORE supplying, so we can attribute exactly the delta.
        let shares_before = Self::raw_supply_shares(&env, &pool, index);

        // Supply to Blend: from = spender = to = this contract (we own the position).
        let me = env.current_contract_address();
        let requests = Vec::from_array(
            &env,
            [Request {
                request_type: REQ_SUPPLY,
                address: underlying.clone(),
                amount,
            }],
        );
        // Blend's `submit` will, deeper in the stack, invoke
        // `usdc.transfer(from = this contract, to = pool, amount)`. Because *this contract* is
        // the `from`, the token's `from.require_auth()` must be satisfied on our behalf — we
        // pre-authorize exactly that one sub-call. (Required on-chain too, not a test artifact.)
        Self::authorize_supply_transfer(&env, &underlying, &me, &pool, amount);
        let pool_client = PoolClient::new(&env, &pool);
        let positions = pool_client.submit(&me, &me, &me, &requests);

        let shares_after = positions.supply.get(index).unwrap_or(0);
        let minted = shares_after - shares_before;
        if minted <= 0 {
            // Blend credited no shares — refuse rather than silently mint unbacked PT/YT.
            panic_with_error!(&env, Error::NoStrategyPosition);
        }
        Self::bump_instance(&env);
        minted
    }

    /// Withdraw `shares` worth of underlying from Blend and send it to `to`. Returns underlying out.
    pub fn redeem(env: Env, to: Address, shares: i128) -> i128 {
        Self::require_wrapper_any(&env);
        if shares <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        // Convert the share count to an underlying amount at the live rate, then withdraw that.
        let rate = Self::current_rate(env.clone());
        let amount = math::shares_to_underlying(&env, shares, rate)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        Self::withdraw_underlying(&env, &to, amount)
    }

    /// Withdraw exactly `amount` underlying from Blend and send it to `to`. Returns shares burned.
    pub fn redeem_underlying(env: Env, to: Address, amount: i128) -> i128 {
        Self::require_wrapper_any(&env);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let pool = Self::pool_addr(&env);
        let index = Self::reserve_index(&env);
        let shares_before = Self::raw_supply_shares(&env, &pool, index);
        let got = Self::withdraw_underlying(&env, &to, amount);
        let shares_after = Self::raw_supply_shares(&env, &pool, index);
        // Defence-in-depth: ensure Blend actually paid out what we asked.
        if got + 1 < amount {
            panic_with_error!(&env, Error::WithdrawShortfall);
        }
        shares_before - shares_after
    }

    /// Live Blend `b_rate` (SCALAR_12), with the sanity bound applied and `last_rate` advanced.
    pub fn current_rate(env: Env) -> i128 {
        let pool = Self::pool_addr(&env);
        let underlying = Self::underlying(env.clone());
        let reserve = PoolClient::new(&env, &pool).get_reserve(&underlying);
        let rate = reserve.data.b_rate;

        let mut bound: RateBound = env
            .storage()
            .instance()
            .get(&DataKey::Bound)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        math::check_rate_bound(&env, bound.last_rate, rate, bound.max_jump_bps)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        if rate > bound.last_rate {
            bound.last_rate = rate;
            env.storage().instance().set(&DataKey::Bound, &bound);
            Self::bump_instance(&env);
        }
        rate
    }

    /// Underlying value of `shares` at the live rate.
    pub fn position_value(env: Env, shares: i128) -> i128 {
        let rate = Self::current_rate(env.clone());
        math::shares_to_underlying(&env, shares, rate).unwrap_or(0)
    }

    /// Total shares this strategy holds in Blend (the wrapper's whole position).
    pub fn total_shares(env: Env) -> i128 {
        let pool = Self::pool_addr(&env);
        let index = Self::reserve_index(&env);
        Self::raw_supply_shares(&env, &pool, index)
    }

    /// The underlying asset SAC.
    pub fn underlying(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Underlying)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    /// The Blend pool address (read-only view, handy for the frontend / dashboard).
    pub fn pool(env: Env) -> Address {
        Self::pool_addr(&env)
    }

    // ---- internals ----

    /// Authorize, on this contract's behalf, the single nested `transfer(me, pool, amount)`
    /// that Blend's `submit` performs to pull our supplied underlying into the pool.
    fn authorize_supply_transfer(
        env: &Env,
        underlying: &Address,
        me: &Address,
        pool: &Address,
        amount: i128,
    ) {
        let args: Vec<soroban_sdk::Val> =
            (me.clone(), pool.clone(), amount).into_val(env);
        env.authorize_as_current_contract(Vec::from_array(
            env,
            [InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: underlying.clone(),
                    fn_name: Symbol::new(env, "transfer"),
                    args,
                },
                sub_invocations: Vec::new(env),
            })],
        ));
    }

    fn withdraw_underlying(env: &Env, to: &Address, amount: i128) -> i128 {
        let pool = Self::pool_addr(env);
        let underlying = Self::underlying(env.clone());
        let me = env.current_contract_address();

        let bal_before = token::Client::new(env, &underlying).balance(&me);
        let requests = Vec::from_array(
            env,
            [Request {
                request_type: REQ_WITHDRAW,
                address: underlying.clone(),
                amount,
            }],
        );
        // from = this contract (owns position), spender = this, to = this (we then forward).
        PoolClient::new(env, &pool).submit(&me, &me, &me, &requests);
        let bal_after = token::Client::new(env, &underlying).balance(&me);
        let withdrawn = bal_after - bal_before;

        // Forward the withdrawn underlying to the recipient.
        if to != &me && withdrawn > 0 {
            token::Client::new(env, &underlying).transfer(&me, to, &withdrawn);
        }
        Self::bump_instance(env);
        withdrawn
    }

    /// Raw supply-share balance this contract holds for `index` (0 if none).
    fn raw_supply_shares(env: &Env, pool: &Address, index: u32) -> i128 {
        let me = env.current_contract_address();
        let positions = PoolClient::new(env, pool).get_positions(&me);
        positions.supply.get(index).unwrap_or(0)
    }

    fn require_wrapper(env: &Env, from: &Address) {
        let wrapper: Address = env
            .storage()
            .instance()
            .get(&DataKey::Wrapper)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
        if from != &wrapper {
            panic_with_error!(env, Error::NotAuthorized);
        }
        from.require_auth();
    }

    fn require_wrapper_any(env: &Env) {
        let wrapper: Address = env
            .storage()
            .instance()
            .get(&DataKey::Wrapper)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
        wrapper.require_auth();
    }

    fn pool_addr(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Pool)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    fn reserve_index(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::ReserveIndex)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    fn bump_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_BUMP_LO, INSTANCE_BUMP_HI);
    }
}

#[cfg(test)]
mod test;
