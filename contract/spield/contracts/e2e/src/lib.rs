#![no_std]
//! # spield-e2e — cross-contract workflow tests for the v2 SR stack.
//!
//! Every other suite in this workspace tests one contract with the rest wired in as scenery. This
//! one exists to test the **seams**: the whole stack — Blend -> strategy -> SR -> yield -> market
//! + vault + router — stood up once, then driven through the workflows a real deployment will
//! actually see, with several actors interleaved.
//!
//! Nothing is registered here; the crate is test-only.

#[cfg(test)]
mod harness;

#[cfg(test)]
mod workflows;

#[cfg(test)]
mod adversarial;

#[cfg(test)]
mod invariants;
