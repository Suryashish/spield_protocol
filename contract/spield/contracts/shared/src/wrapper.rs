use soroban_sdk::{contractclient, Address, Env};

use crate::types::Position;

/// The subset of the tokenization wrapper that the Fixed-Rate Vault calls cross-contract.
///
/// The vault is a *power user* of the wrapper: it deposits USDC to mint PT+YT into its own
/// inventory, redeems PT 1:1 at maturity to pay out fixed receipts, and reads PT/YT token
/// addresses + maturity to stay in lock-step with the market it sits on top of.
///
/// `#[contractclient]` generates `WrapperContractClient`, used by the vault for typed
/// cross-contract calls. We deliberately mirror only the methods the vault needs (not the whole
/// wrapper surface), so the dependency stays narrow and the vault never reaches into per-position
/// internals it has no business touching.
#[contractclient(name = "WrapperContractClient")]
pub trait WrapperContract {
    /// Deposit `amount` USDC (pulled from `user`) → mint `amount` PT + `amount` YT to `user`,
    /// recording a new position. Returns the new position id. When the vault is `user`, the
    /// vault must authorize both this call and the nested USDC transfer on its own behalf.
    fn mint(env: Env, user: Address, amount: i128) -> u64;

    /// Redeem `amount` PT from `position_id` for `amount` USDC 1:1 (only at/after maturity).
    /// Returns the USDC paid out. The position owner (the vault) must authorize.
    fn redeem_pt(env: Env, position_id: u64, amount: i128) -> i128;

    /// Claim accrued yield for `position_id` (settles, never burns YT). Returns USDC paid.
    fn claim_yield(env: Env, position_id: u64) -> i128;

    /// Read a position's full record (the vault uses `pt_amount` to know how much PT it can redeem
    /// from a given position).
    fn get_position(env: Env, position_id: u64) -> Position;

    /// The PT Stellar Asset Contract address.
    fn pt_token(env: Env) -> Address;

    /// The YT Stellar Asset Contract address.
    fn yt_token(env: Env) -> Address;

    /// The market maturity (unix seconds) — the vault inherits this from the wrapper.
    fn maturity(env: Env) -> u64;
}
