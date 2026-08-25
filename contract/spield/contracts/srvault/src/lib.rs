#![no_std]
//! # spield-srvault — the Fixed-Rate Vault, rebuilt on the SR stack
//!
//! Deposit USDC, get a **guaranteed payout at maturity**. The vault backs every promise with PT it
//! actually holds — each unit of PT redeems for one unit of asset at expiry — so the fixed rate is
//! solvent by construction rather than by forecast.
//!
//! ```text
//! user USDC ──► SR ──mint_py──► PT (vault inventory, backs receipts)
//!                                 + YT (vault keeps; its yield funds future coupons)
//! ```
//!
//! ## Four of v1's open defects are absent here BY CONSTRUCTION, not by patching
//!
//! | `tofix.md` | v1 | here |
//! |---|---|---|
//! | **#18** `redeem` walks an unbounded position list; `seed` is permissionless, so a stranger can prepend dust positions until every receipt is unpayable | P0 | **Gone.** PT is a pure bearer balance, so there is no list to walk — redemption reads one receipt and burns PT. Cost is independent of history. `seed` is admin-gated as well, closing the vector twice. |
//! | **#21** YT yield unclaimable after maturity; `harvest` prunes live YT legs | P1 | **Gone.** `harvest` has no maturity gate and no pruning — pre-expiry yield stays claimable forever through the engine. |
//! | **#22** seed capital and surplus inventory are one-way | P1 | **Gone.** [`Self::sweep`] returns surplus, gated on covering every open liability first. |
//! | **#24** `initialize` does not cross-check `underlying` | P1 | **Not expressible.** The vault takes only the engine's address and *reads* sr/pt/underlying/maturity back from it. There is no argument to get wrong. |
//!
//! ## The solvency invariant
//! ```text
//! pt_inventory >= total_liability
//! ```
//! Asserted after every mutation. PT redeems 1:1 at expiry, so holding at least as much PT face as
//! the sum of outstanding payouts means every receipt is payable — regardless of what the market,
//! the index, or Blend does in between.

mod events;
mod storage;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, panic_with_error, token, Address, BytesN, Env, String};
use spield_shared::{governance, math, Error};

pub use storage::Receipt;

/// PT face burned ABOVE a receipt's payout, to absorb double-flooring on the way out.
///
/// Redemption converts `payout` -> SR -> USDC, and BOTH conversions floor. `payout / index * index`
/// therefore lands up to one stroop below `payout`, which would short the holder by a stroop and
/// trip `WithdrawShortfall`. Burning a two-stroop buffer guarantees the holder receives their exact
/// promised payout; the remainder stays with the vault.
///
/// The buffer is RESERVED, not hoped for: `deposit` requires it on top of the new liability, and
/// `sweep` refuses to release it. So the last receipt out is as redeemable as the first.
const REDEEM_DUST: i128 = 2;

/// Read-only snapshot for the dashboard.
#[derive(Clone, Debug, PartialEq)]
#[soroban_sdk::contracttype]
pub struct SrVaultStats {
    /// PT face the vault holds — its bond inventory. Each unit redeems for one asset at expiry.
    pub pt_inventory: i128,
    /// YT the vault holds; its yield funds future coupons.
    pub yt_inventory: i128,
    /// Sum of `payout` across open receipts.
    pub total_liability: i128,
    /// `pt_inventory - total_liability`: spare PT available to back new coupons.
    pub coupon_capacity: i128,
    pub rate_bps: u32,
    pub maturity: u64,
    pub open_receipts: u64,
}

#[contract]
pub struct SrVault;

#[contractimpl]
impl SrVault {
    pub fn __constructor(env: Env, admin: Address) {
        storage::set_admin(&env, &admin);
        storage::set_paused(&env, false);
        governance::init(&env);
        storage::bump_instance(&env);
    }

    /// One-shot, admin-gated init.
    ///
    /// Takes **only** the engine address. sr, pt, underlying and maturity are read back from it, so
    /// the `tofix.md` #24 class of mismatch — a vault wired to an asset its PT does not redeem into
    /// — cannot be constructed here.
    pub fn initialize(env: Env, yield_contract: Address, rate_bps: u32, max_rate_bps: u32) {
        if storage::is_initialized(&env) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        storage::get_admin(&env).require_auth();
        if rate_bps > max_rate_bps {
            panic_with_error!(&env, Error::RateNotAllowed);
        }
        let y = YieldClient::new(&env, &yield_contract);
        let sr = y.sr_token();
        let pt = y.pt_token();
        let maturity = y.expiry();
        if maturity <= env.ledger().timestamp() {
            panic_with_error!(&env, Error::VaultExpired);
        }
        // The settlement asset comes from SR, which got it from the strategy. Nobody types it in.
        let underlying = SrClient::new(&env, &sr).underlying();

        storage::set_initialized(&env);
        storage::set_yield(&env, &yield_contract);
        storage::set_sr(&env, &sr);
        storage::set_pt(&env, &pt);
        storage::set_underlying(&env, &underlying);
        storage::set_maturity(&env, maturity);
        storage::set_rate_bps(&env, rate_bps);
        storage::set_max_rate_bps(&env, max_rate_bps);
        storage::bump_instance(&env);

        events::initialized(&env, &yield_contract, &pt, &sr, maturity, rate_bps);
    }

    // ================= capacity =================

    /// Add PT coupon capacity: pull `amount` USDC, wrap to SR, strip into PT+YT held by the vault.
    /// Pure capacity — it creates **no liability**.
    ///
    /// **Admin-gated.** v1's `seed` was permissionless, which is what turned a capacity limit into
    /// `tofix.md` #18's denial-of-service: anyone could prepend dust positions until the redeem
    /// walk exceeded the transaction budget and every receipt became unpayable. There is no walk
    /// here, but an open `seed` still lets a stranger write vault state for the price of a
    /// transaction, and nothing needs it to be open.
    pub fn seed(env: Env, from: Address, amount: i128) -> i128 {
        Self::ensure_can_deposit(&env);
        storage::get_admin(&env).require_auth();
        from.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let py = Self::acquire_py(&env, &from, amount);
        storage::bump_instance(&env);
        events::seeded(&env, &from, amount, py);
        Self::assert_solvent(&env);
        py
    }

    // ================= user flow =================

    /// What `amount` USDC would earn: `(payout, coupon, rate_bps)`. Read-only.
    pub fn quote(env: Env, amount: i128) -> (i128, i128, u32) {
        if !storage::is_initialized(&env) || amount <= 0 {
            return (0, 0, storage::rate_bps(&env));
        }
        let rate = storage::rate_bps(&env);
        let term = storage::get_maturity(&env).saturating_sub(env.ledger().timestamp());
        let coupon = math::coupon_amount(&env, amount, rate, term).unwrap_or(0);
        (amount + coupon, coupon, rate)
    }

    /// Lock a fixed rate. Pulls `amount` USDC, mints matching PT+YT into inventory, and issues a
    /// receipt promising `principal + coupon` at maturity.
    ///
    /// The coupon is backed out of **existing** capacity: the deposit itself only creates PT equal
    /// to the principal, so the coupon must come from spare inventory. That is why the capacity
    /// check is the load-bearing line — it is what makes the promise solvent rather than hopeful.
    pub fn deposit(env: Env, user: Address, amount: i128) -> u64 {
        Self::ensure_can_deposit(&env);
        user.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let maturity = storage::get_maturity(&env);
        let now = env.ledger().timestamp();
        if now >= maturity {
            panic_with_error!(&env, Error::VaultExpired);
        }

        let rate = storage::rate_bps(&env);
        let coupon = math::coupon_amount(&env, amount, rate, maturity - now)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        let payout = amount + coupon;

        // Convert the deposit into PT (face == principal) + YT.
        let minted = Self::acquire_py(&env, &user, amount);

        // Every open payout must remain covered by PT the vault actually holds — PLUS the
        // per-receipt redemption buffer, so accepting this deposit can never make an existing
        // receipt unredeemable.
        let liability = storage::total_liability(&env) + payout;
        let receipts_after = storage::open_receipts(&env) as i128 + 1;
        if Self::pt_inventory(&env) < liability + receipts_after * REDEEM_DUST {
            panic_with_error!(&env, Error::InsufficientCapacity);
        }

        let id = storage::next_receipt_id(&env);
        storage::save_receipt(
            &env,
            id,
            &Receipt { owner: user.clone(), principal: amount, payout, rate_bps: rate, maturity, open: true },
        );
        storage::set_total_liability(&env, liability);
        storage::set_open_receipts(&env, storage::open_receipts(&env) + 1);
        storage::bump_instance(&env);

        events::deposited(&env, &user, id, amount, payout, rate);
        Self::assert_solvent(&env);
        let _ = minted;
        id
    }

    /// Redeem a matured receipt for its full promised payout.
    ///
    /// **O(1) — and that is the headline difference from v1.** v1 walked a list of wrapper
    /// positions, redeeming each until the payout was met, at ~7 MB per position; five positions
    /// exhausted the mainnet transaction budget and a stranger could inflate the list at will
    /// (`tofix.md` #18). Here PT is fungible bearer, so the vault burns `payout` PT face in one
    /// `redeem_py` call. Cost does not depend on history, on how the inventory was assembled, or
    /// on anything an attacker controls.
    pub fn redeem(env: Env, receipt_id: u64) -> i128 {
        Self::ensure_initialized(&env); // an exit — open while paused
        let mut r = storage::get_receipt(&env, receipt_id)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        r.owner.require_auth();
        if !r.open {
            panic_with_error!(&env, Error::ReceiptClosed);
        }
        if env.ledger().timestamp() < r.maturity {
            panic_with_error!(&env, Error::VaultNotMatured);
        }
        // Burn the payout PLUS the rounding buffer. Both are reserved at deposit time.
        let inventory = Self::pt_inventory(&env);
        let to_burn = if inventory >= r.payout + REDEEM_DUST { r.payout + REDEEM_DUST } else { r.payout };
        if inventory < to_burn {
            panic_with_error!(&env, Error::InsufficientCapacity);
        }

        let me = env.current_contract_address();
        let yield_addr = storage::get_yield(&env);

        // Past expiry `redeem_py` needs PT only — the vault's YT is untouched and keeps whatever
        // yield it already accrued.
        Self::authorize_pt_burn(&env, to_burn);
        let sr_out = YieldClient::new(&env, &yield_addr).redeem_py(&me, &me, &to_burn);

        // Unwrap to the VAULT first, then pay the holder EXACTLY what was promised. Redeeming
        // straight to the holder would hand them whatever the flooring produced — which is a
        // stroop short of the promise. The tiny remainder stays as vault inventory.
        let sr_addr = storage::get_sr(&env);
        let got = SrClient::new(&env, &sr_addr).redeem(&me, &me, &sr_out, &0i128);
        if got < r.payout {
            // The strategy genuinely returned less than the promise (a Blend liquidity crunch, not
            // rounding). Refuse rather than short the holder: the receipt stays open and retryable.
            panic_with_error!(&env, Error::WithdrawShortfall);
        }
        token::Client::new(&env, &storage::get_underlying(&env)).transfer(&me, &r.owner, &r.payout);
        let paid = r.payout;

        r.open = false;
        storage::save_receipt(&env, receipt_id, &r);
        storage::set_total_liability(&env, storage::total_liability(&env) - r.payout);
        storage::set_open_receipts(&env, storage::open_receipts(&env).saturating_sub(1));
        storage::bump_instance(&env);

        events::redeemed(&env, &r.owner, receipt_id, paid);
        Self::assert_solvent(&env);
        paid
    }

    // ================= inventory management =================

    /// Claim the vault's YT yield and reinvest it as fresh PT capacity.
    ///
    /// **No maturity gate and no pruning**, which is `tofix.md` #21. v1's `harvest` refused to run
    /// after maturity and pruned positions that still held live YT, so yield accrued before
    /// maturity became permanently unclaimable. Here the engine keeps pre-expiry yield claimable
    /// forever, and this simply collects it whenever it is called.
    ///
    /// Returns `(sr_claimed, py_minted)`. Reinvestment is skipped past expiry (the engine refuses
    /// `mint_py` then, correctly) — the claimed SR stays as vault inventory instead of reverting
    /// and throwing the claim away with it.
    pub fn harvest(env: Env) -> (i128, i128) {
        Self::ensure_initialized(&env);
        let me = env.current_contract_address();
        let yield_addr = storage::get_yield(&env);
        let y = YieldClient::new(&env, &yield_addr);

        let (net, _fee) = y.redeem_due_interest(&me);
        if net <= 0 {
            return (0, 0);
        }

        // Past expiry the engine refuses new mints. Hold the SR rather than reverting.
        let mut minted = 0i128;
        if env.ledger().timestamp() < storage::get_maturity(&env) && !y.is_paused() {
            let sr_addr = storage::get_sr(&env);
            Self::authorize_sr_pull(&env, &sr_addr, &yield_addr, net);
            minted = y.mint_py(&me, &me, &net);
        }
        storage::bump_instance(&env);
        events::harvested(&env, net, minted);
        Self::assert_solvent(&env);
        (net, minted)
    }

    /// Recover surplus inventory — seed capital and unneeded capacity — to `to`.
    ///
    /// **Liability-gated**, which is `tofix.md` #22: v1 had no path at all, so seed capital and any
    /// over-provisioned inventory were one-way. This releases only PT face **above** every open
    /// payout, so it can never touch a receipt's backing. Admin only.
    pub fn sweep(env: Env, to: Address, pt_amount: i128) -> i128 {
        Self::ensure_initialized(&env);
        storage::get_admin(&env).require_auth();
        if pt_amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        // Reserve the per-receipt redemption buffer as well, so a sweep can never make an open
        // receipt unredeemable by a stroop.
        let reserved = storage::total_liability(&env)
            + storage::open_receipts(&env) as i128 * REDEEM_DUST;
        let capacity = Self::pt_inventory(&env) - reserved;
        if pt_amount > capacity {
            panic_with_error!(&env, Error::InsufficientCapacity);
        }
        let me = env.current_contract_address();
        token::Client::new(&env, &storage::get_pt(&env)).transfer(&me, &to, &pt_amount);
        storage::bump_instance(&env);
        events::swept(&env, &to, pt_amount);
        Self::assert_solvent(&env);
        pt_amount
    }

    // ================= views =================

    pub fn stats(env: Env) -> SrVaultStats {
        let liability = storage::total_liability(&env);
        let pt = Self::pt_inventory(&env);
        // Net of the reserved redemption buffer, so this number matches what `deposit` and `sweep`
        // will actually allow rather than overstating it by a few stroops.
        let reserved = liability + storage::open_receipts(&env) as i128 * REDEEM_DUST;
        SrVaultStats {
            pt_inventory: pt,
            yt_inventory: Self::yt_inventory(&env),
            total_liability: liability,
            coupon_capacity: if pt > reserved { pt - reserved } else { 0 },
            rate_bps: storage::rate_bps(&env),
            maturity: storage::get_maturity(&env),
            open_receipts: storage::open_receipts(&env),
        }
    }

    pub fn get_receipt(env: Env, receipt_id: u64) -> Receipt {
        storage::get_receipt(&env, receipt_id).unwrap_or_else(|e| panic_with_error!(&env, e))
    }

    /// Permissionless TTL keep-alive so a long-dated receipt cannot archive before it matures.
    pub fn bump_receipt(env: Env, receipt_id: u64) {
        Self::ensure_initialized(&env);
        storage::bump_receipt_ttl(&env, receipt_id);
    }

    pub fn rate_bps(env: Env) -> u32 { storage::rate_bps(&env) }
    pub fn max_rate_bps(env: Env) -> u32 { storage::max_rate_bps(&env) }
    pub fn maturity(env: Env) -> u64 { storage::get_maturity(&env) }
    pub fn is_paused(env: Env) -> bool { storage::is_paused(&env) }
    pub fn pt_token(env: Env) -> Address { storage::get_pt(&env) }
    pub fn sr_token(env: Env) -> Address { storage::get_sr(&env) }
    pub fn underlying(env: Env) -> Address { storage::get_underlying(&env) }
    pub fn yield_contract(env: Env) -> Address { storage::get_yield(&env) }
    pub fn admin(env: Env) -> Address { storage::get_admin(&env) }
    pub fn total_liability(env: Env) -> i128 { storage::total_liability(&env) }

    // ================= admin =================

    pub fn set_rate(env: Env, rate_bps: u32) {
        storage::get_admin(&env).require_auth();
        if rate_bps > storage::max_rate_bps(&env) {
            panic_with_error!(&env, Error::RateNotAllowed);
        }
        storage::set_rate_bps(&env, rate_bps);
        storage::bump_instance(&env);
        events::rate_set(&env, rate_bps);
    }

    pub fn pause(env: Env) {
        storage::get_admin(&env).require_auth();
        storage::set_paused(&env, true);
        storage::bump_instance(&env);
    }

    pub fn unpause(env: Env) {
        storage::get_admin(&env).require_auth();
        storage::set_paused(&env, false);
        storage::bump_instance(&env);
    }

    // ---------- governance: two-step rotation + timelocked upgrades ----------

    pub fn propose_admin(env: Env, new_admin: Address) {
        governance::propose_admin(&env, &storage::get_admin(&env), &new_admin);
    }
    pub fn accept_admin(env: Env) {
        let a = governance::accept_admin(&env);
        storage::set_admin(&env, &a);
        storage::bump_instance(&env);
    }
    pub fn cancel_admin_transfer(env: Env) {
        governance::cancel_admin_transfer(&env, &storage::get_admin(&env));
    }
    pub fn pending_admin(env: Env) -> Option<Address> { governance::pending_admin(&env) }
    pub fn schedule_upgrade(env: Env, wasm_hash: BytesN<32>) -> u64 {
        governance::schedule_upgrade(&env, &storage::get_admin(&env), wasm_hash)
    }
    pub fn apply_upgrade(env: Env) { governance::apply_upgrade(&env, &storage::get_admin(&env)); }
    pub fn cancel_upgrade(env: Env) { governance::cancel_upgrade(&env, &storage::get_admin(&env)); }
    pub fn pending_upgrade(env: Env) -> Option<governance::PendingUpgrade> {
        governance::pending_upgrade(&env)
    }
    pub fn timelock(env: Env) -> u64 { governance::timelock(&env) }
    pub fn set_timelock(env: Env, secs: u64) {
        governance::set_timelock(&env, &storage::get_admin(&env), secs);
    }
    pub fn code_hash(env: Env) -> BytesN<32> { governance::code_hash(&env) }
    pub fn version(env: Env) -> String { String::from_str(&env, "spield-srvault-0.1.0") }

    // ================= internals =================

    fn ensure_initialized(env: &Env) {
        if !storage::is_initialized(env) {
            panic_with_error!(env, Error::NotInitialized);
        }
    }

    fn ensure_can_deposit(env: &Env) {
        Self::ensure_initialized(env);
        if storage::is_paused(env) {
            panic_with_error!(env, Error::Paused);
        }
    }

    /// USDC -> SR -> PT+YT into the vault's own inventory. Returns the PY face minted.
    fn acquire_py(env: &Env, from: &Address, usdc_amount: i128) -> i128 {
        let me = env.current_contract_address();
        let underlying = storage::get_underlying(env);
        let sr_addr = storage::get_sr(env);
        let yield_addr = storage::get_yield(env);

        // Pull the user's USDC into the vault, then wrap it on the vault's own behalf.
        token::Client::new(env, &underlying).transfer(from, &me, &usdc_amount);
        Self::authorize_underlying_pull(env, &underlying, &sr_addr, usdc_amount);
        let sr = SrClient::new(env, &sr_addr).deposit(&me, &me, &usdc_amount, &0i128);
        if sr <= 0 {
            panic_with_error!(env, Error::DustAmount);
        }
        Self::authorize_sr_pull(env, &sr_addr, &yield_addr, sr);
        let py = YieldClient::new(env, &yield_addr).mint_py(&me, &me, &sr);
        if py <= 0 {
            panic_with_error!(env, Error::DustAmount);
        }
        py
    }

    fn pt_inventory(env: &Env) -> i128 {
        token::Client::new(env, &storage::get_pt(env)).balance(&env.current_contract_address())
    }

    fn yt_inventory(env: &Env) -> i128 {
        YieldClient::new(env, &storage::get_yield(env)).balance(&env.current_contract_address())
    }

    /// **The invariant.** PT redeems 1:1 at expiry, so holding at least as much PT face as the sum
    /// of open payouts means every receipt is payable no matter what happens in between.
    fn assert_solvent(env: &Env) {
        if Self::pt_inventory(env) < storage::total_liability(env) {
            panic_with_error!(env, Error::SolvencyViolation);
        }
    }

    fn authorize_underlying_pull(env: &Env, underlying: &Address, spender: &Address, amount: i128) {
        Self::auth_transfer(env, underlying, spender, amount);
    }

    fn authorize_sr_pull(env: &Env, sr: &Address, spender: &Address, amount: i128) {
        Self::auth_transfer(env, sr, spender, amount);
    }

    /// Authorize, on the vault's behalf, a nested `token.transfer(me -> spender, amount)`.
    /// Scope is the NEXT call only, so each of these must immediately precede its invocation.
    fn auth_transfer(env: &Env, tokenc: &Address, spender: &Address, amount: i128) {
        use soroban_sdk::{
            auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
            IntoVal, Symbol, Vec,
        };
        let me = env.current_contract_address();
        let args: Vec<soroban_sdk::Val> = (me.clone(), spender.clone(), amount).into_val(env);
        env.authorize_as_current_contract(Vec::from_array(
            env,
            [InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: tokenc.clone(),
                    fn_name: Symbol::new(env, "transfer"),
                    args,
                },
                sub_invocations: Vec::new(env),
            })],
        ));
    }

    /// Authorize the nested `pt.burn(me, amount)` the engine performs during `redeem_py`.
    fn authorize_pt_burn(env: &Env, amount: i128) {
        use soroban_sdk::{
            auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
            IntoVal, Symbol, Vec,
        };
        let me = env.current_contract_address();
        let pt = storage::get_pt(env);
        let args: Vec<soroban_sdk::Val> = (me.clone(), amount).into_val(env);
        env.authorize_as_current_contract(Vec::from_array(
            env,
            [InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: pt,
                    fn_name: Symbol::new(env, "burn"),
                    args,
                },
                sub_invocations: Vec::new(env),
            })],
        ));
    }
}

/// The engine's surface, as this vault uses it.
#[soroban_sdk::contractclient(name = "YieldClient")]
pub trait YieldContract {
    fn pt_token(env: Env) -> Address;
    fn sr_token(env: Env) -> Address;
    fn expiry(env: Env) -> u64;
    fn is_paused(env: Env) -> bool;
    fn balance(env: Env, id: Address) -> i128;
    fn mint_py(env: Env, from: Address, receiver: Address, sr_in: i128) -> i128;
    fn redeem_py(env: Env, from: Address, receiver: Address, py_amount: i128) -> i128;
    fn redeem_due_interest(env: Env, user: Address) -> (i128, i128);
}

/// SR's surface.
#[soroban_sdk::contractclient(name = "SrClient")]
pub trait SrToken {
    fn underlying(env: Env) -> Address;
    fn balance(env: Env, id: Address) -> i128;
    fn deposit(env: Env, from: Address, receiver: Address, amount: i128, min_shares_out: i128) -> i128;
    fn redeem(env: Env, from: Address, receiver: Address, shares: i128, min_underlying_out: i128) -> i128;
}
