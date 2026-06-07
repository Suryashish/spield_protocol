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
///
/// The bound is **time-aware**: `b_rate` may rise by at most `max_apr_bps` per year, pro-rated by
/// the seconds elapsed since `last_ts`. This makes the check independent of how often the strategy
/// is read (a long-untouched position no longer false-trips), so only `max_apr_bps` — calibrated
/// against Blend's real max borrow APR — needs tuning. See [`crate::math::check_rate_bound_timed`].
#[derive(Clone)]
#[contracttype]
pub struct RateBound {
    /// Last `b_rate` the strategy observed (SCALAR_12). Used to enforce monotonicity + the ceiling.
    pub last_rate: i128,
    /// Unix-second timestamp at which `last_rate` was observed. The elapsed time since this is what
    /// the allowed increase is pro-rated by. `0` = no observation yet (first read bypasses the cap).
    pub last_ts: u64,
    /// Max allowed **annual** `b_rate` growth, in basis points (e.g. `30_000` = 300% APR). Set
    /// generously above Blend's real max borrow APR so honest reads always pass.
    pub max_apr_bps: u32,
}

/// A single Fixed-Rate Vault deposit (plan §11.2 / §7.5 — the flagship "lock X% fixed" product).
///
/// PT-passthrough model: the user deposits `principal` USDC and is promised exactly `payout`
/// USDC at maturity (`payout = principal + coupon`, the coupon being the fixed return). The
/// vault backs every receipt with **PT it actually holds** (each PT redeems 1:1 at maturity),
/// so the fixed rate is solvent by construction — the same rigor as the wrapper's invariant.
/// There is no per-user yield accounting here: the user's outcome is fixed and known at deposit.
#[derive(Clone)]
#[contracttype]
pub struct FixedReceipt {
    /// Owner of this receipt (the only account that may redeem it).
    pub owner: Address,
    /// USDC principal the user deposited.
    pub principal: i128,
    /// USDC the user is guaranteed at maturity = principal + fixed coupon. Backed by PT the
    /// vault holds 1:1, so it is always redeemable.
    pub payout: i128,
    /// The fixed APR quoted for this receipt, in basis points (for display / events only — the
    /// economically binding figure is `payout`).
    pub rate_bps: u32,
    /// Unix seconds at which `payout` becomes redeemable (the vault's maturity).
    pub maturity: u64,
    /// False once redeemed.
    pub open: bool,
}

/// Read-only snapshot of the Fixed-Rate Vault's health, for the frontend / solvency dashboard.
/// The vault is solvent iff `pt_inventory >= total_liability` (it holds enough PT to honor every
/// outstanding receipt at par).
#[derive(Clone)]
#[contracttype]
pub struct VaultStats {
    /// PT the vault currently holds (its bond inventory). Each unit redeems 1:1 at maturity.
    pub pt_inventory: i128,
    /// YT the vault currently holds (the variable leg whose yield funds future coupons).
    pub yt_inventory: i128,
    /// Sum of `payout` across all open receipts — the vault's total obligation at maturity.
    pub total_liability: i128,
    /// `pt_inventory - total_liability`: spare PT available to back new coupons (the headroom
    /// that lets the vault quote a fixed rate). Negative would mean insolvency (never allowed).
    pub coupon_capacity: i128,
    /// The current fixed APR the vault quotes, in basis points.
    pub rate_bps: u32,
    /// The vault's maturity (unix seconds).
    pub maturity: u64,
}
