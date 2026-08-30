use soroban_sdk::{contractclient, Address, Env};

/// The yield-source abstraction (plan §3.2 / §3.5). The wrapper never hard-codes Blend — it
/// holds a `YieldStrategyClient` pointed at *some* address implementing this interface. Day 1
/// that address is the Blend adapter; later it can be a DeFindex or tokenized-RWA adapter with
/// **no wrapper changes**.
///
/// The contract that implements this is the only thing that knows about Blend's `submit` /
/// `Request` / `Reserve` shapes. Everything above it speaks in (underlying amount, shares, rate).
///
/// `#[contractclient]` generates `YieldStrategyClient`, used by the wrapper for typed
/// cross-contract calls.
#[contractclient(name = "YieldStrategyClient")]
pub trait YieldStrategy {
    /// Pull `amount` of the underlying (USDC) from `from` and supply it to the yield source.
    /// Returns the number of *shares* (Blend bTokens) credited for this deposit, computed from
    /// the live rate at the moment of the call. The strategy must `require_auth` on `from` for
    /// the token transfer (the SAC `transfer` does this).
    ///
    /// Caller contract (the wrapper) is responsible for its own auth; this moves only funds the
    /// caller directs, into the strategy's own Blend position.
    fn deposit(env: Env, from: Address, amount: i128) -> i128;

    /// Withdraw `shares` worth of the underlying from the yield source and send the resulting
    /// underlying to `to`. Returns the actual underlying amount withdrawn (may differ from a
    /// naive `shares * rate` by rounding, or be short in a Blend liquidity edge case — the
    /// caller checks the return value).
    fn redeem(env: Env, to: Address, shares: i128) -> i128;

    /// Withdraw exactly `amount` of the underlying (USDC) from the yield source and send it to
    /// `to`. Returns the number of *shares* burned to do so. Used by the wrapper to pay out a
    /// precise yield/principal figure without the caller needing to know the live rate.
    fn redeem_underlying(env: Env, to: Address, amount: i128) -> i128;

    /// Underlying this strategy's **entire** position is really worth right now, read live from
    /// the venue with **no monotonicity guard**.
    ///
    /// This is the loss-accounting view, and it is deliberately the only rate path that survives a
    /// venue principal loss. [`Self::deposit`]/[`Self::redeem`] sit behind `current_rate`, which
    /// refuses a fallen rate and freezes the stack until an admin resets the floor — correct as a
    /// safety guard, useless for answering "how much money actually exists?". This answers it, and
    /// keeps answering it during the freeze.
    ///
    /// **Pure.** No writes, so it is safe from any context and its footprint never depends on
    /// timing (see `Sr::exchange_rate` for the testnet failure that rule exists to prevent).
    fn position_value_unguarded(env: Env) -> i128;

    /// The current exchange rate (Blend `b_rate`), SCALAR_12. Monotonic non-decreasing. This is
    /// "the index" — read live, never pushed by a key. Applies the sanity bound internally.
    fn current_rate(env: Env) -> i128;

    /// The live underlying value of `shares` at the current rate: `shares * current_rate /
    /// SCALAR_12`. Convenience used by the wrapper's solvency check.
    fn position_value(env: Env, shares: i128) -> i128;

    /// Total shares the strategy currently holds in the yield source (the wrapper's whole Blend
    /// position). Used by the solvency invariant.
    fn total_shares(env: Env) -> i128;

    /// The underlying token (USDC SAC) this strategy supplies. Lets the wrapper discover it.
    fn underlying(env: Env) -> Address;

    /// **Underlying the venue can pay out right now** (`tofix.md` #20).
    ///
    /// An exit failing for lack of venue liquidity is a different thing from the protocol being
    /// insolvent, and it is by far the more likely of the two. This is what lets a caller find that
    /// out *before* submitting, and size a withdrawal that will actually succeed.
    ///
    /// Implementations should return an honest **upper** bound; callers take their own haircut.
    fn available_liquidity(env: Env) -> i128;
}
