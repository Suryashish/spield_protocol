#![no_std]
//! # spield-vault — the Fixed-Rate Vault (the flagship product, plan §11.2 / §7.5)
//!
//! Turns the raw PT/YT machinery into the mass-market promise: **"deposit USDC, get a fixed
//! return by date D."** The user never sees PT or YT — they deposit USDC and receive a
//! **`FixedReceipt`** worth a known `payout` (`principal + coupon`) at maturity.
//!
//! ## PT-passthrough model (truly fixed, solvent by construction)
//! The vault sits on top of one Spield wrapper market (one maturity). It is a *power user* of the
//! wrapper:
//!
//! * **Bond inventory.** The vault holds **PT** (minted via the wrapper). Each PT redeems 1:1 for
//!   USDC at maturity, so PT *is* a zero-coupon bond. The vault's PT balance is its solvency
//!   backing — exactly like the wrapper's Blend position backs its PT.
//! * **A fixed coupon is only ever promised when the PT to honor it already exists.** On
//!   `deposit(amount)`, the vault mints `amount` PT (+ `amount` YT) and computes the term coupon.
//!   It then requires the vault to hold **`amount + coupon` PT** — the extra `coupon` PT coming
//!   from inventory the vault built up earlier (seed + harvested yield). If the inventory can't
//!   cover it, the deposit is **refused** (`InsufficientCapacity`). This is the SCF-#3 fix applied
//!   one level up: the vault can never promise a return it isn't already holding the PT to pay.
//! * **The coupon is funded by retained YT yield.** The vault keeps all the YT it mints; `harvest`
//!   claims that YT's accrued Blend yield (real USDC) and re-deposits it through the wrapper to
//!   mint *fresh* PT — growing coupon capacity organically over the life of the market. A one-time
//!   admin `seed` bootstraps the initial capacity before any yield has accrued.
//!
//! ## Invariant (asserted after every mutation)
//! ```text
//! pt_inventory  >=  total_liability      (Σ payout over open receipts)
//! ```
//! Because every receipt's `payout` is backed by PT the vault holds, and PT redeems 1:1, every
//! receipt is always redeemable. A genuine bug (issuing an unbacked receipt) trips this and the
//! transaction reverts.
//!
//! ## Trust model (honest, per plan §3.6)
//! * **User principal & payout: trustless** — backed by PT the vault provably holds.
//! * **Admin (sets the quoted rate within an on-chain ceiling, pauses, harvests, seeds): trusted,
//!   single-key at launch → multisig-pathed.** The admin can *not* move user funds or reduce a
//!   receipt's payout; the worst a bad rate does is make new deposits uneconomic (and a rate above
//!   the ceiling is rejected on-chain).

mod events;
mod storage;

#[cfg(test)]
mod test;

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractimpl, panic_with_error, token, vec, Address, BytesN, Env, IntoVal, String,
    Symbol, Vec,
};
use spield_shared::{governance, math, types::VaultStats, Error, WrapperContractClient};

/// Hard ceiling on how many positions a single `harvest` call may process, so the per-call work
/// (and thus the tx resource cost) is bounded regardless of the caller-supplied `max_positions`.
const MAX_HARVEST_BATCH: u32 = 50;

#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    /// One-shot, admin-gated init (SCF #7). Reads the PT/YT token addresses and the maturity from
    /// `wrapper` so the vault is always in lock-step with the market it sits on. The `underlying`
    /// (USDC) is passed explicitly rather than read from the wrapper: it must equal the wrapper's
    /// deposit/settlement asset, but passing it keeps the vault decoupled from any specific wrapper
    /// ABI version (older deployed wrappers may not expose an `underlying()` view). All three are
    /// SACs, so no trustlines are needed for the vault to hold balances.
    ///
    /// * `admin` — operational admin (sets rate, pauses, harvests; cannot move user funds).
    /// * `wrapper` — the Spield wrapper market this vault wraps.
    /// * `underlying` — the wrapper's USDC SAC (what users deposit and PT redeems into).
    /// * `rate_bps` — the initial fixed APR to quote (basis points), must be ≤ `max_rate_bps`.
    /// * `max_rate_bps` — the hard ceiling on any future quoted rate (a guardrail).
    pub fn initialize(
        env: Env,
        admin: Address,
        wrapper: Address,
        underlying: Address,
        rate_bps: u32,
        max_rate_bps: u32,
    ) {
        if storage::is_initialized(&env) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        admin.require_auth();
        if rate_bps > max_rate_bps {
            panic_with_error!(&env, Error::RateNotAllowed);
        }

        // Pull the PT/YT addresses and the maturity from the wrapper (single source of truth for
        // the market); take `underlying` from the caller (decouples us from the wrapper's ABI).
        let w = WrapperContractClient::new(&env, &wrapper);
        let pt = w.pt_token();
        let yt = w.yt_token();
        let maturity = w.maturity();

        storage::set_initialized(&env);
        storage::set_admin(&env, &admin);
        storage::set_wrapper(&env, &wrapper);
        storage::set_pt(&env, &pt);
        storage::set_yt(&env, &yt);
        storage::set_underlying(&env, &underlying);
        storage::set_maturity(&env, maturity);
        storage::set_rate_bps(&env, rate_bps);
        storage::set_max_rate_bps(&env, max_rate_bps);
        storage::set_paused(&env, false);
        storage::set_total_liability(&env, 0);
        governance::init(&env);
        storage::bump_instance(&env);
    }

    /// Bootstrap (or top up) the vault's PT inventory: pull `amount` USDC from `from`, mint
    /// `amount` PT (+ `amount` YT) into the vault via the wrapper. This is **pure coupon capacity**
    /// — it creates no receipt and no liability, so it strictly raises `coupon_capacity`. Typically
    /// called once by the admin/protocol at launch (and optionally to widen capacity later).
    /// Anyone may seed (it only donates PT to the vault); we still require `from` to authorize the
    /// USDC pull.
    pub fn seed(env: Env, from: Address, amount: i128) -> u64 {
        Self::ensure_can_deposit(&env); // inflow — blocked while paused
        from.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        Self::ensure_before_maturity(&env);

        let usdc = storage::get_underlying(&env);
        // Pull USDC from the seeder into the vault, then mint PT+YT into the vault's inventory.
        token::Client::new(&env, &usdc).transfer(&from, &env.current_contract_address(), &amount);
        let position_id = Self::wrapper_mint(&env, &usdc, amount);
        Self::track_position(&env, position_id);

        storage::bump_instance(&env);
        events::seeded(&env, &from, amount);
        Self::assert_solvent(&env);
        position_id
    }

    /// Deposit `amount` USDC and lock the current fixed rate. Mints `amount` PT (+`amount` YT) into
    /// the vault, computes the term coupon, and — **only if the vault holds enough PT to back the
    /// full payout** — issues the user a receipt for `payout = amount + coupon`. Returns the
    /// receipt id.
    ///
    /// The capacity check is what makes the fixed rate solvent by construction: the `amount` PT
    /// just minted covers the principal, and the `coupon` PT must already exist in inventory (from
    /// seed/harvest). If it doesn't, we revert rather than promise an unbacked return.
    pub fn deposit(env: Env, user: Address, amount: i128) -> u64 {
        Self::ensure_can_deposit(&env); // inflow — blocked while paused
        user.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let maturity = storage::get_maturity(&env);
        let now = env.ledger().timestamp();
        if now >= maturity {
            panic_with_error!(&env, Error::VaultExpired);
        }

        let rate_bps = storage::get_rate_bps(&env);
        let term = maturity - now;
        let coupon = math::coupon_amount(&env, amount, rate_bps, term)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        let payout = amount.checked_add(coupon).unwrap_or_else(|| {
            panic_with_error!(&env, Error::MathOverflow)
        });

        let usdc = storage::get_underlying(&env);
        // Pull the user's USDC into the vault and mint `amount` PT (+ YT) against it.
        token::Client::new(&env, &usdc).transfer(&user, &env.current_contract_address(), &amount);
        let position_id = Self::wrapper_mint(&env, &usdc, amount);
        Self::track_position(&env, position_id);

        // Capacity gate (SCF #3, one level up): after this mint the vault must hold at least the
        // full `payout` in PT *beyond* what already backs every other open receipt. Equivalent to
        // `pt_inventory >= total_liability_after`. We check it explicitly so the revert reason is
        // the precise `InsufficientCapacity`, then `assert_solvent` re-checks as a backstop.
        let new_liability = storage::total_liability(&env)
            .checked_add(payout)
            .unwrap_or_else(|| panic_with_error!(&env, Error::MathOverflow));
        if Self::pt_inventory(&env) < new_liability {
            panic_with_error!(&env, Error::InsufficientCapacity);
        }

        let id = storage::next_receipt_id(&env);
        let receipt = spield_shared::types::FixedReceipt {
            owner: user.clone(),
            principal: amount,
            payout,
            rate_bps,
            maturity,
            open: true,
        };
        storage::save_receipt(&env, id, &receipt);
        storage::set_total_liability(&env, new_liability);
        storage::bump_instance(&env);

        events::deposited(&env, &user, id, amount, payout, rate_bps);
        Self::assert_solvent(&env);
        id
    }

    /// Redeem a matured receipt: at/after maturity, redeem `payout` PT from the vault's inventory
    /// 1:1 and pay the owner `payout` USDC. Closes the receipt and clears its liability.
    pub fn redeem(env: Env, receipt_id: u64) -> i128 {
        Self::ensure_initialized(&env); // user exit — allowed even while paused
        let mut receipt = storage::get_receipt(&env, receipt_id)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        receipt.owner.require_auth();
        if !receipt.open {
            panic_with_error!(&env, Error::ReceiptClosed);
        }
        if env.ledger().timestamp() < receipt.maturity {
            panic_with_error!(&env, Error::VaultNotMatured);
        }

        // Redeem `payout` USDC worth of PT from the vault's positions (PT → USDC 1:1 at maturity),
        // collecting the USDC into the vault, then forward exactly `payout` to the owner.
        let usdc = storage::get_underlying(&env);
        let got = Self::redeem_pt_for(&env, receipt.payout);
        // `got` should equal `payout` (PT is 1:1); guard the rare Blend floor-rounding shortfall.
        if got + 2 < receipt.payout {
            panic_with_error!(&env, Error::WithdrawShortfall);
        }
        let pay = if got < receipt.payout { got } else { receipt.payout };
        token::Client::new(&env, &usdc).transfer(
            &env.current_contract_address(),
            &receipt.owner,
            &pay,
        );

        receipt.open = false;
        storage::save_receipt(&env, receipt_id, &receipt);
        storage::set_total_liability(&env, storage::total_liability(&env) - receipt.payout);
        storage::bump_instance(&env);

        events::redeemed(&env, &receipt.owner, receipt_id, pay);
        Self::assert_solvent(&env);
        pay
    }

    /// Claim the vault's accrued YT yield across **up to `max_positions`** of its tracked positions
    /// (starting from a stored round-robin cursor) and reinvest it as fresh PT, growing coupon
    /// capacity. **Paginated** so the per-call work is bounded no matter how many positions the vault
    /// has accumulated — repeated calls sweep the whole list a chunk at a time (mainnet-readiness #6:
    /// an un-paginated loop over an ever-growing list would eventually exceed the tx budget and
    /// permanently revert). Permissionless (it only ever *increases* backing) and allowed while
    /// paused (it's an upkeep/outflow-side op, never an inflow of new user money). `max_positions`
    /// is clamped to a sane ceiling; pass e.g. 20–50. Returns (yield_claimed_usdc, pt_added).
    pub fn harvest(env: Env, max_positions: u32) -> (i128, i128) {
        Self::ensure_initialized(&env);
        Self::ensure_before_maturity(&env);
        let usdc = storage::get_underlying(&env);
        let wrapper = storage::get_wrapper(&env);
        let w = WrapperContractClient::new(&env, &wrapper);

        let positions = storage::positions(&env);
        let n = positions.len();
        if n == 0 {
            events::harvested(&env, 0, 0);
            return (0, 0);
        }

        // Bound the batch: at least 1, at most `n`, capped at MAX_HARVEST_BATCH so one call is cheap.
        let batch = max_positions.clamp(1, MAX_HARVEST_BATCH).min(n);
        // Resume from the stored cursor (wrapped into range), claiming `batch` positions.
        let start = storage::harvest_cursor(&env) % n;

        let before = token::Client::new(&env, &usdc).balance(&env.current_contract_address());
        let mut processed = 0u32;
        let mut idx = start;
        while processed < batch {
            let id = positions.get(idx).unwrap();
            // claim_yield requires the position owner (the vault) to authorize; it pays USDC to us.
            w.claim_yield(&id);
            idx = (idx + 1) % n;
            processed += 1;
        }
        // Advance + persist the cursor so the next call continues where this one stopped.
        storage::set_harvest_cursor(&env, idx);

        let after = token::Client::new(&env, &usdc).balance(&env.current_contract_address());
        let claimed = after - before;
        if claimed <= 0 {
            storage::bump_instance(&env);
            events::harvested(&env, 0, 0);
            return (0, 0);
        }

        // Reinvest the claimed USDC as fresh PT (+YT) → new coupon capacity.
        let position_id = Self::wrapper_mint(&env, &usdc, claimed);
        Self::track_position(&env, position_id);
        storage::bump_instance(&env);

        events::harvested(&env, claimed, claimed);
        Self::assert_solvent(&env);
        (claimed, claimed)
    }

    // ---------- read-only views (frontend / dashboard) ----------

    /// Quote the payout a `amount`-USDC deposit would lock in right now: returns
    /// (payout, coupon, rate_bps). Pure read — does not check capacity (the UI shows the quote;
    /// `deposit` enforces capacity). Returns a zero coupon at/after maturity.
    pub fn quote(env: Env, amount: i128) -> (i128, i128, u32) {
        let rate_bps = storage::get_rate_bps(&env);
        let maturity = storage::get_maturity(&env);
        let now = env.ledger().timestamp();
        let term = if now >= maturity { 0 } else { maturity - now };
        let coupon = math::coupon_amount(&env, amount, rate_bps, term).unwrap_or(0);
        (amount + coupon, coupon, rate_bps)
    }

    /// The vault's health snapshot for the solvency dashboard.
    pub fn stats(env: Env) -> VaultStats {
        let pt_inventory = Self::pt_inventory(&env);
        let yt_inventory = Self::yt_inventory(&env);
        let total_liability = storage::total_liability(&env);
        VaultStats {
            pt_inventory,
            yt_inventory,
            total_liability,
            coupon_capacity: pt_inventory - total_liability,
            rate_bps: storage::get_rate_bps(&env),
            maturity: storage::get_maturity(&env),
        }
    }

    pub fn get_receipt(env: Env, receipt_id: u64) -> spield_shared::types::FixedReceipt {
        storage::get_receipt(&env, receipt_id).unwrap_or_else(|e| panic_with_error!(&env, e))
    }

    /// **Permissionless** TTL keep-alive (mainnet-readiness #5). Extends a receipt entry's storage
    /// TTL to comfortably exceed the vault maturity (+grace), clamped to the network max. Anyone may
    /// call it — it only prolongs the entry, never mutates accounting — so a receipt held to maturity
    /// can't archive before its owner redeems. No auth, no pause gate. Panics `ReceiptNotFound` for
    /// an unknown id.
    pub fn bump_receipt(env: Env, receipt_id: u64) {
        Self::ensure_initialized(&env);
        if !storage::has_receipt(&env, receipt_id) {
            panic_with_error!(&env, Error::ReceiptNotFound);
        }
        storage::bump_receipt_ttl(&env, receipt_id);
    }

    pub fn rate_bps(env: Env) -> u32 {
        storage::get_rate_bps(&env)
    }

    pub fn maturity(env: Env) -> u64 {
        storage::get_maturity(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        storage::is_paused(&env)
    }

    pub fn pt_token(env: Env) -> Address {
        storage::get_pt(&env)
    }

    pub fn yt_token(env: Env) -> Address {
        storage::get_yt(&env)
    }

    pub fn version(env: Env) -> String {
        String::from_str(&env, "spield-vault-0.1.0")
    }

    // ---------- admin / circuit breaker ----------

    /// Set the fixed APR quoted to *new* deposits (existing receipts are unaffected — their payout
    /// is locked). Bounded by the on-chain `max_rate_bps` ceiling set at init.
    pub fn set_rate(env: Env, rate_bps: u32) {
        storage::get_admin(&env).require_auth();
        if rate_bps > storage::get_max_rate_bps(&env) {
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
        events::paused(&env, true);
    }

    pub fn unpause(env: Env) {
        storage::get_admin(&env).require_auth();
        storage::set_paused(&env, false);
        storage::bump_instance(&env);
        events::paused(&env, false);
    }

    // ---------- governance: admin rotation (two-step) + upgrade timelock ----------

    /// Propose a new admin (step 1 of 2). Current admin authorizes; the proposed admin must then
    /// call `accept_admin` to take control.
    pub fn propose_admin(env: Env, new_admin: Address) {
        governance::propose_admin(&env, &storage::get_admin(&env), &new_admin);
    }

    /// Accept a pending admin proposal (step 2 of 2). Must be called by the proposed admin.
    pub fn accept_admin(env: Env) {
        let new_admin = governance::accept_admin(&env);
        storage::set_admin(&env, &new_admin);
        storage::bump_instance(&env);
    }

    /// Cancel a pending admin proposal. Current admin only.
    pub fn cancel_admin_transfer(env: Env) {
        governance::cancel_admin_transfer(&env, &storage::get_admin(&env));
    }

    pub fn pending_admin(env: Env) -> Option<Address> {
        governance::pending_admin(&env)
    }

    /// Schedule a contract upgrade to `wasm_hash`, applyable after the timelock. Returns the `eta`.
    pub fn schedule_upgrade(env: Env, wasm_hash: BytesN<32>) -> u64 {
        governance::schedule_upgrade(&env, &storage::get_admin(&env), wasm_hash)
    }

    pub fn apply_upgrade(env: Env) {
        governance::apply_upgrade(&env, &storage::get_admin(&env));
    }

    pub fn cancel_upgrade(env: Env) {
        governance::cancel_upgrade(&env, &storage::get_admin(&env));
    }

    pub fn pending_upgrade(env: Env) -> Option<governance::PendingUpgrade> {
        governance::pending_upgrade(&env)
    }

    pub fn timelock(env: Env) -> u64 {
        governance::timelock(&env)
    }

    pub fn set_timelock(env: Env, secs: u64) {
        governance::set_timelock(&env, &storage::get_admin(&env), secs);
    }

    pub fn admin(env: Env) -> Address {
        storage::get_admin(&env)
    }

    // ---------------- internals ----------------

    /// Guard for **inflows** (new money entering): initialized AND not paused. A pause blocks
    /// `seed` / `deposit` so no new deposits enter during an emergency. (mainnet-readiness #8)
    fn ensure_can_deposit(env: &Env) {
        if !storage::is_initialized(env) {
            panic_with_error!(env, Error::NotInitialized);
        }
        if storage::is_paused(env) {
            panic_with_error!(env, Error::Paused);
        }
    }

    /// Guard for **outflows / keep-alive ops** (users leaving, capacity upkeep): initialized only —
    /// these stay open even when paused so a pause can never trap user funds. `redeem` (the user
    /// exit) and `harvest` (permissionless, only grows backing) use this.
    fn ensure_initialized(env: &Env) {
        if !storage::is_initialized(env) {
            panic_with_error!(env, Error::NotInitialized);
        }
    }

    fn ensure_before_maturity(env: &Env) {
        if env.ledger().timestamp() >= storage::get_maturity(env) {
            panic_with_error!(env, Error::VaultExpired);
        }
    }

    /// PT the vault currently holds (its bond inventory), read from the PT SAC.
    fn pt_inventory(env: &Env) -> i128 {
        token::Client::new(env, &storage::get_pt(env)).balance(&env.current_contract_address())
    }

    fn yt_inventory(env: &Env) -> i128 {
        token::Client::new(env, &storage::get_yt(env)).balance(&env.current_contract_address())
    }

    /// Mint `amount` PT+YT into the vault via the wrapper, returning the new position id. Handles
    /// the contract-as-caller auth: the wrapper does `vault.require_auth()` and then a nested
    /// `usdc.transfer(vault -> wrapper)`, both of which we authorize on our own behalf.
    fn wrapper_mint(env: &Env, usdc: &Address, amount: i128) -> u64 {
        let wrapper = storage::get_wrapper(env);
        let me = env.current_contract_address();
        // Authorize the wrapper's nested `usdc.transfer(me -> wrapper, amount)`. The wrapper's
        // `mint` calls `usdc.transfer(user=me, wrapper, amount)`; because *we* are `from`, that
        // token transfer needs our auth. Scope is the next call only, so authorize immediately
        // before invoking mint.
        Self::authorize_mint(env, usdc, &wrapper, amount);
        WrapperContractClient::new(env, &wrapper).mint(&me, &amount)
    }

    /// Authorize, on this contract's behalf, the nested `usdc.transfer(me, wrapper, amount)` that
    /// the wrapper's `mint` performs to pull our deposit in.
    fn authorize_mint(env: &Env, usdc: &Address, wrapper: &Address, amount: i128) {
        let me = env.current_contract_address();
        let args: Vec<soroban_sdk::Val> = (me.clone(), wrapper.clone(), amount).into_val(env);
        env.authorize_as_current_contract(Vec::from_array(
            env,
            [InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: usdc.clone(),
                    fn_name: Symbol::new(env, "transfer"),
                    args,
                },
                sub_invocations: Vec::new(env),
            })],
        ));
    }

    /// Authorize, on this contract's behalf, the nested `pt.burn(me, amount)` that the wrapper's
    /// `redeem_pt` performs to burn the vault's PT before paying out the principal.
    fn authorize_pt_burn(env: &Env, amount: i128) {
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

    /// Redeem `target` USDC worth of PT from the vault's tracked positions (PT redeems 1:1 at
    /// maturity). Walks positions, redeeming each position's available PT until `target` is met.
    /// Returns the total USDC collected into the vault. Prunes positions that are emptied.
    fn redeem_pt_for(env: &Env, target: i128) -> i128 {
        let wrapper = storage::get_wrapper(env);
        let w = WrapperContractClient::new(env, &wrapper);
        let usdc = storage::get_underlying(env);
        let me = env.current_contract_address();

        let positions = storage::positions(env);
        let mut remaining = target;
        let mut collected = 0i128;
        let mut still_open: Vec<u64> = vec![env];

        for id in positions.iter() {
            if remaining <= 0 {
                still_open.push_back(id);
                continue;
            }
            // How much PT does this position still hold?
            let pos_pt = w.get_position(&id).pt_amount;
            if pos_pt <= 0 {
                continue; // already empty — drop it
            }
            let take = if pos_pt < remaining { pos_pt } else { remaining };
            // Read our USDC balance BEFORE authorizing (the authorize scope covers only the very
            // next sub-call, so no other contract call may intervene before `redeem_pt`).
            let before = token::Client::new(env, &usdc).balance(&me);
            // The wrapper's `redeem_pt` burns OUR PT (`pt.burn(vault, take)`); because the vault is
            // the token holder and earlier in the call stack, authorize that nested burn on our
            // behalf right before the call (scope = next call only).
            Self::authorize_pt_burn(env, take);
            w.redeem_pt(&id, &take);
            let after = token::Client::new(env, &usdc).balance(&me);
            collected += after - before;
            remaining -= take;
            // Keep the position if it still has PT left.
            if pos_pt > take {
                still_open.push_back(id);
            }
        }
        storage::set_positions(env, &still_open);
        collected
    }

    /// Track a new wrapper position id the vault owns.
    fn track_position(env: &Env, id: u64) {
        let mut positions = storage::positions(env);
        positions.push_back(id);
        storage::set_positions(env, &positions);
    }

    /// The vault solvency invariant: PT inventory must cover every open receipt's payout. Because
    /// PT redeems 1:1, holding `pt_inventory >= total_liability` guarantees every receipt is
    /// payable. We allow a tiny dust tolerance for Blend's floor-rounding on the PT mints that
    /// build inventory (bounded by the number of positions opened).
    fn assert_solvent(env: &Env) {
        let pt_inventory = Self::pt_inventory(env);
        let liability = storage::total_liability(env);
        let dust = storage::peek_next_receipt_id(env) as i128 + 2;
        if pt_inventory + dust < liability {
            panic_with_error!(env, Error::SolvencyViolation);
        }
    }
}
