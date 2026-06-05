use soroban_sdk::{contracttype, Address};

/// A single deposit's accounting record — the unit that makes Spield's yield math correct.
///
/// **Per-position, never overwritten** (fixes SCF #4): every `mint` creates a *new* `Position`
/// with its own `entry_rate`, so topping up never clobbers an earlier tranche's entry point.
///
/// **`settled_rate` travels with the YT** (fixes SCF #5/#6): yield is always measured from
/// `settled_rate`, which starts at `entry_rate` and is bumped to the current rate on every
/// `claim_yield` *without burning YT*. A position transferred to a new owner carries its
/// `settled_rate`, so the buyer can only ever claim yield accrued *after* they held it.
#[derive(Clone)]
#[contracttype]
pub struct Position {
    /// Current owner of this position (and of the PT + YT it represents).
    pub owner: Address,
    /// Underlying principal deposited for this position, in the underlying's decimals (USDC).
    /// Equal to the PT amount still outstanding and the YT amount still outstanding (1:1:1 at
    /// mint; PT and YT are only reduced by `redeem_pt` / `combine_and_redeem`).
    pub principal: i128,
    /// PT still held in this position. Burned on `redeem_pt` (after maturity) and on `combine`.
    pub pt_amount: i128,
    /// YT still held in this position. **Never burned by `claim_yield`** — only by `combine`.
    pub yt_amount: i128,
    /// Blend `b_rate` (SCALAR_12) at the moment this position was minted. Immutable.
    pub entry_rate: i128,
    /// Blend `b_rate` (SCALAR_12) up to which yield has already been settled/paid. Starts equal
    /// to `entry_rate`; advanced to `current_rate` on each claim. Yield owed is measured from
    /// here, so the same YT can be claimed across many epochs.
    pub settled_rate: i128,
    /// Blend bToken shares this position is backed by (its slice of the wrapper's total Blend
    /// position). `principal = shares * entry_rate / SCALAR_12` at mint.
    pub shares: i128,
    /// False once the position is fully redeemed/closed (all PT + YT gone).
    pub open: bool,
}

/// A read-only snapshot returned to the frontend / solvency dashboard: the live, Blend-backed
/// value of a position, split into its principal and currently-claimable yield.
#[derive(Clone)]
#[contracttype]
pub struct PositionValue {
    pub position_id: u64,
    pub principal: i128,
    /// Yield claimable right now: `yt_amount * (current_rate - settled_rate) / SCALAR_12`.
    pub claimable_yield: i128,
    pub pt_amount: i128,
    pub yt_amount: i128,
    pub open: bool,
}

/// Defence-in-depth bound on `b_rate` reads, stored in the strategy adapter's config.
#[derive(Clone)]
#[contracttype]
pub struct RateBound {
    /// Last `b_rate` the strategy observed (SCALAR_12). Used to enforce monotonicity.
    pub last_rate: i128,
    /// Max allowed per-read increase, in basis points of `last_rate`.
    pub max_jump_bps: u32,
}
