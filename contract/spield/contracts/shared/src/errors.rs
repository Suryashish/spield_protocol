use soroban_sdk::contracterror;

/// Spield error codes, shared across contracts. Numbering leaves gaps so each contract's
/// domain stays grouped: 1–19 generic/lifecycle, 20–39 wrapper accounting, 40–59 strategy.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    // --- Generic / lifecycle (1–19) ---
    /// `initialize` called a second time (SCF #7: one-shot init guard).
    AlreadyInitialized = 1,
    /// A function needing prior `initialize` was called first.
    NotInitialized = 2,
    /// Caller is not the configured admin.
    NotAuthorized = 3,
    /// Contract is paused by the circuit breaker; mutating calls are halted.
    Paused = 4,
    /// A supplied amount was zero or negative where a positive value is required.
    InvalidAmount = 5,
    /// Arithmetic overflowed (should be unreachable with i128 + overflow-checks, but asserted).
    MathOverflow = 6,

    // --- Wrapper accounting (20–39) ---
    /// The referenced position id does not exist.
    PositionNotFound = 20,
    /// Caller does not own the referenced position.
    NotPositionOwner = 21,
    /// `redeem_pt` called before `maturity`.
    NotMatured = 22,
    /// Tried to redeem/split more PT or YT than the position holds.
    InsufficientBalance = 23,
    /// The solvency invariant would be violated by this operation — refuse it.
    /// (SCF #3: the vault can never promise value Blend hasn't actually accrued.)
    SolvencyViolation = 24,
    /// The position has already been fully redeemed/closed.
    PositionClosed = 25,

    // --- Strategy / Blend adapter (40–59) ---
    /// Blend returned a `bRate` outside the configured sanity bound (defence-in-depth).
    RateOutOfBounds = 40,
    /// Blend reported no supplied position for the asset we expected to hold.
    NoStrategyPosition = 41,
    /// Withdrawal from Blend returned less underlying than required (liquidity edge case).
    WithdrawShortfall = 42,

    // --- Fixed-Rate Vault (60–79) ---
    /// The referenced fixed-rate receipt id does not exist.
    ReceiptNotFound = 60,
    /// Caller does not own the referenced receipt.
    NotReceiptOwner = 61,
    /// `redeem` called before the vault's maturity.
    VaultNotMatured = 62,
    /// The receipt has already been redeemed.
    ReceiptClosed = 63,
    /// The vault lacks enough spare PT (coupon capacity) to back the coupon for this deposit.
    /// Refusing keeps the vault solvent by construction (the SCF #3 bar): a fixed coupon is only
    /// ever promised when the vault already holds the PT to honor it.
    InsufficientCapacity = 64,
    /// The quoted fixed rate is out of the allowed range (e.g. above the admin-set ceiling).
    RateNotAllowed = 65,
    /// Deposit rejected because the market has already matured (no time left to earn the coupon,
    /// and PT can no longer be accumulated). Vault maturity is inherited from the wrapper.
    VaultExpired = 66,
}
