#![no_std]
//! # spield-shared
//!
//! Shared types, fixed-point math, the `YieldStrategy` adapter interface, and error
//! definitions used across the Spield v2 contracts (`strategy`, `wrapper`).
//!
//! Spield v2 is a fixed-income / yield-stripping protocol on Stellar/Soroban. The yield
//! source is **Blend** (a real, on-chain-accruing lending position) — see `plan.md` §3.5.
//! "The index" is Blend's real `bRate`, so the vault is solvent by construction. The two
//! design pillars that make the SCF-flagged bugs impossible live here:
//!
//! * **Fixed-point convention** — rates are 12-decimal fixed point (`SCALAR_12`), matching
//!   Blend v2's `b_rate`/`d_rate` exactly, so there is never a scale-mismatch in the yield math.
//! * **The `YieldStrategy` trait** — the wrapper never hard-codes Blend; it talks to whatever
//!   address implements this interface (Blend day 1; DeFindex / tokenized-RWA later).

pub mod errors;
pub mod math;
pub mod strategy;
pub mod types;
pub mod wrapper;

#[cfg(test)]
mod test;

pub use errors::Error;
pub use strategy::YieldStrategyClient;
pub use types::{FixedReceipt, Position, RateBound, VaultStats};
pub use wrapper::WrapperContractClient;

/// Fixed-point scalar for exchange rates — **12 decimals**, identical to Blend v2's
/// `b_rate`/`d_rate` scale (`SCALAR_12` in `blend-contracts-v2/pool/src/constants.rs`).
/// All rate arithmetic in Spield uses this scale so there is never a unit mismatch when we
/// read Blend's `bRate` via a cross-contract call.
pub const SCALAR_12: i128 = 1_000_000_000_000;

/// Fixed-point scalar for ratios/percentages — 7 decimals (Blend's `SCALAR_7`). Used for
/// the `bRate` sanity-bound (a defence-in-depth max per-call jump), never for value math.
pub const SCALAR_7: i128 = 1_0000000;
