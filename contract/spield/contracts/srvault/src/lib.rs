#![no_std]
//! # spield-srvault — the Fixed-Rate Vault, rebuilt on the SR stack
//!
//! Deposit USDC, get a **fixed payout at maturity while the venue is healthy**. The vault backs every
//! promise with PT it actually holds and applies a transparent, pro-rata venue-loss haircut if the
//! underlying strategy loses value; it never freezes already-collected user proceeds.
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
use spield_shared::{governance, math, Error, SCALAR_12};

pub use storage::Receipt;

/// PT face burned ABOVE a receipt's payout, to absorb double-flooring on the **closing** leg.
///
/// Redemption converts `payout` -> SR -> USDC, and BOTH conversions floor. `payout / index * index`
/// therefore lands up to one stroop below `payout`, which would short the holder by a stroop and
/// trip `WithdrawShortfall`. Burning a two-stroop buffer guarantees the holder receives their exact
/// promised payout; the remainder stays with the vault.
const REDEEM_DUST: i128 = 2;

/// PT face reserved per open receipt for the flooring on its **partial** legs (`anyfix.md` F2).
///
/// `REDEEM_DUST` covers one closing leg. Every partial leg floors too — it burns `take` PT and banks
/// `got <= take` USDC — so a receipt driven through a long liquidity crunch loses roughly a stroop
/// per leg, and the leg count is not bounded by anything the contract controls.
///
/// Reserving only `REDEEM_DUST` was therefore wrong twice over: `sweep` told the operator that
/// releasing inventory down to a two-stroop margin was safe, and `deposit`'s capacity gate agreed.
/// It is not: two partial legs spend that margin and the third trips `assert_solvent`, leaving the
/// holder unable to redeem until the venue can pay the entire remainder in a single call — the
/// all-or-nothing behaviour `tofix.md` #20 exists to prevent.
///
/// 64 stroops is 6.4e-6 USDC. It is a hard per-receipt ceiling, not an accounting allowance that a
/// caller can spend indefinitely. If an observed deficit would exceed the remaining budget, the
/// excess is recognized as a loss haircut instead of bricking the receipt.
const PARTIAL_LEG_BUDGET: i128 = 64;

/// Total PT face held back per open receipt, over and above its unpaid balance.
const RECEIPT_RESERVE: i128 = REDEEM_DUST + PARTIAL_LEG_BUDGET;

/// Ignore the tiny fixed-point discrepancy between the PY and SR rate views. A larger decrease is
/// a venue loss and is recorded as a haircut; this dust band prevents a normal floor from disabling
/// new deposits.
const LOSS_RATE_DUST: i128 = 1_000;

/// Read-only snapshot for the dashboard.
#[derive(Clone, Debug, PartialEq)]
#[soroban_sdk::contracttype]
pub struct SrVaultStats {
    /// PT face the vault holds — its bond inventory. Each unit redeems for one asset at expiry.
    pub pt_inventory: i128,
    /// YT the vault holds; its yield funds future coupons.
    pub yt_inventory: i128,
    /// Current unpaid liability across open receipts. Direct incremental payments and recognized
    /// venue-loss haircuts reduce this value.
    pub total_liability: i128,
    /// Spare PT available to back new coupons: inventory, less every unpaid balance, less the
    /// per-receipt redemption reserve. This is exactly what `deposit` and `sweep` will allow.
    pub coupon_capacity: i128,
    /// Flooring loss already realized by partial redemptions, across open receipts. Expected, tiny,
    /// and excluded from the solvency check rather than absorbed silently (`anyfix.md` F2).
    pub total_residue: i128,
    /// USDC banked against partially-redeemed receipts. Reserved: it backs those payouts in place
    /// of the PT that was burned to obtain it, and no sweep may touch it.
    pub total_collected: i128,
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
        storage::set_loss_factor(&env, SCALAR_12);
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

        // SR performs the venue-loss check atomically inside the existing deposit call. This also
        // protects the first receipt after seed capital without adding a separate valuation call
        // to the vault's hot path.
        if storage::loss_factor(&env) < SCALAR_12 {
            panic_with_error!(&env, Error::VaultLossRecognized);
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
        // Any USDC already collected by the legacy all-or-nothing path is backing liability in
        // place of PT. Do not reserve that same obligation twice after an incremental upgrade.
        let uncollected = liability.saturating_sub(storage::total_collected(&env));
        if Self::pt_inventory(&env) < uncollected + receipts_after * RECEIPT_RESERVE {
            panic_with_error!(&env, Error::InsufficientCapacity);
        }

        let id = storage::next_receipt_id(&env);
        storage::save_receipt(
            &env,
            id,
            &Receipt {
                owner: user.clone(),
                principal: amount,
                payout,
                rate_bps: rate,
                maturity,
                open: true,
                collected: 0,
                residue: 0,
            },
        );
        storage::set_receipt_loss_factor(&env, id, storage::loss_factor(&env));
        storage::set_total_liability(&env, liability);
        storage::set_open_receipts(&env, storage::open_receipts(&env) + 1);
        storage::bump_instance(&env);

        events::deposited(&env, &user, id, amount, payout, rate);
        Self::assert_solvent(&env);
        let _ = minted;
        id
    }

    /// Redeem a matured receipt incrementally. Each successful leg pays the owner immediately;
    /// a liquidity crunch or venue loss therefore cannot strand already-collected USDC in the
    /// vault.
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

        // The factor is global, but records are updated lazily. Every receipt receives the same
        // factor when touched, so a venue loss is pro-rata and independent of redemption order.
        Self::observe_loss(&env);
        Self::apply_receipt_loss(&env, receipt_id, &mut r);

        let me = env.current_contract_address();
        let yield_addr = storage::get_yield(&env);
        let sr_addr = storage::get_sr(&env);
        let underlying = storage::get_underlying(&env);

        let mut paid_now = 0i128;
        // Receipts created under the previous all-or-nothing implementation may already have cash
        // banked in `collected`. Release that reserved cash first; new legs pay directly.
        if r.collected > 0 {
            let banked = r.collected;
            token::Client::new(&env, &underlying).transfer(&me, &r.owner, &banked);
            r.collected = 0;
            storage::set_total_collected(
                &env,
                storage::total_collected(&env).saturating_sub(banked),
            );
            storage::set_total_liability(
                &env,
                storage::total_liability(&env).saturating_sub(banked),
            );
            let previous_paid = storage::paid(&env, receipt_id);
            storage::set_paid(&env, receipt_id, previous_paid + banked);
            paid_now += banked;
        }

        let mut paid_total = storage::paid(&env, receipt_id);
        // How much of the effective promise is still unfunded.
        let remaining = r.payout.saturating_sub(paid_total + r.collected);
        if remaining > 0 {
            // **Size the burn to what the venue can actually pay.**
            //
            // The naive shape — burn the whole payout, then hope `Sr::redeem` covers it — is what
            // `tofix.md` #20 is about: during a liquidity crunch it reverts, the holder gets
            // nothing, and no progress is kept. Sizing first means the withdrawal we attempt is one
            // the venue can satisfy, so a crunch costs the holder extra transactions rather than
            // the whole exit.
            //
            // Redeeming to the VAULT (not the holder) and paying out separately is deliberate: it
            // keeps the flooring remainder as vault inventory and pays exactly what was promised.
            let sr = SrClient::new(&env, &sr_addr);
            // `max_redeemable` is an SR-share ceiling. Convert it to PT face with the frozen PY
            // index. Converting it to USDC and treating that number as PT face is the H-02 rate
            // mismatch: when the live SR rate differs from the frozen index, it over-burns.
            let py_index = YieldClient::new(&env, &yield_addr).py_index_current();
            let realizable_rate = sr.realizable_rate();
            if py_index <= 0 || realizable_rate <= 0 {
                panic_with_error!(&env, Error::InsufficientCapacity);
            }
            let max_shares = sr.max_redeemable();
            let inventory = Self::pt_inventory(&env);
            let max_face = if max_shares == i128::MAX {
                inventory
            } else {
                math::mul_div_floor(&env, max_shares, py_index, SCALAR_12)
                    .unwrap_or_else(|e| panic_with_error!(&env, e))
                    .min(inventory)
            };

            // Burn enough PT face to cover the remaining USDC at the current realizable rate,
            // plus the closing dust guard. If the venue cannot support that face, use its ceiling
            // and make a progress payment instead of reverting.
            let required_face = math::mul_div_ceil(&env, remaining, py_index, realizable_rate)
                .unwrap_or_else(|e| panic_with_error!(&env, e));
            let closing_face = required_face
                .checked_add(REDEEM_DUST)
                .unwrap_or_else(|| panic_with_error!(&env, Error::MathOverflow));
            let to_burn = closing_face.min(max_face);
            if to_burn <= 0 {
                panic_with_error!(&env, Error::InsufficientCapacity);
            }

            Self::authorize_pt_burn(&env, to_burn);
            let sr_out = YieldClient::new(&env, &yield_addr).redeem_py(&me, &me, &to_burn);
            let got = sr.redeem(&me, &me, &sr_out, &0i128);
            if got <= 0 {
                // The venue paid nothing at all. Refuse rather than record phantom progress.
                panic_with_error!(&env, Error::WithdrawShortfall);
            }

            // Pay the leg immediately. Any amount above the effective remaining promise stays in
            // the vault as surplus; it is never attributed to this receipt.
            let credit = got.min(remaining);
            if credit > 0 {
                token::Client::new(&env, &underlying).transfer(&me, &r.owner, &credit);
                paid_total += credit;
                storage::set_paid(&env, receipt_id, paid_total);
                storage::set_total_liability(
                    &env,
                    storage::total_liability(&env).saturating_sub(credit),
                );
                paid_now += credit;
            }

            // Check the actual post-leg invariant. A loss beyond the configured residue budget is
            // recognized as a haircut instead of accumulating unbounded residue or reverting the
            // receipt forever (N-02/H-03).
            let pt_after = Self::pt_inventory(&env);
            let backing = pt_after
                .saturating_add(storage::total_collected(&env))
                .saturating_add(storage::total_residue(&env));
            let gap = storage::total_liability(&env).saturating_sub(backing);
            if gap > 0 {
                let remaining_budget = PARTIAL_LEG_BUDGET.saturating_sub(r.residue);
                let residue_add = gap.min(remaining_budget);
                if residue_add > 0 {
                    r.residue += residue_add;
                    storage::set_total_residue(&env, storage::total_residue(&env) + residue_add);
                }
                let excess_loss = gap - residue_add;
                if excess_loss > 0 {
                    // This fallback covers a venue paying below its conservative liquidity
                    // estimate in the same call. The normal rate-loss path is global and pro-rata;
                    // this call-local excess is written down explicitly rather than frozen.
                    let outstanding = r.payout.saturating_sub(paid_total + r.collected);
                    let haircut = excess_loss.min(outstanding);
                    r.payout = r.payout.saturating_sub(haircut);
                    storage::set_total_liability(
                        &env,
                        storage::total_liability(&env).saturating_sub(haircut),
                    );
                }
            }
        }

        // A global loss may have changed this receipt's effective payout during the leg. Close
        // whenever the direct payments now cover it; otherwise preserve progress for a later call.
        Self::apply_receipt_loss(&env, receipt_id, &mut r);
        paid_total = storage::paid(&env, receipt_id);
        let still_owed = r.payout.saturating_sub(paid_total + r.collected);
        if still_owed > 0 {
            storage::save_receipt(&env, receipt_id, &r);
            storage::bump_instance(&env);
            events::redeemed_partial(&env, &r.owner, receipt_id, paid_now, still_owed);
            Self::assert_solvent(&env);
            return paid_now;
        }

        // The receipt is settled. Its bounded residue can be released now that no claim remains.
        let paid = paid_now;
        storage::set_total_residue(
            &env,
            storage::total_residue(&env).saturating_sub(r.residue),
        );
        r.collected = 0;
        r.residue = 0;
        r.open = false;
        storage::save_receipt(&env, receipt_id, &r);
        storage::set_open_receipts(&env, storage::open_receipts(&env).saturating_sub(1));
        storage::bump_instance(&env);

        events::redeemed(&env, &r.owner, receipt_id, paid);
        Self::assert_solvent(&env);
        paid
    }

    /// How much more USDC a receipt still needs before it can be paid. `0` = ready (or closed).
    pub fn redeem_remaining(env: Env, receipt_id: u64) -> i128 {
        match storage::get_receipt(&env, receipt_id) {
            Ok(mut r) if r.open => {
                Self::apply_receipt_loss_view(&env, receipt_id, &mut r);
                let rem = r.payout - storage::paid(&env, receipt_id) - r.collected;
                if rem > 0 { rem } else { 0 }
            }
            _ => 0,
        }
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
        Self::observe_loss(&env);
        if pt_amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        // Reserve the per-receipt redemption buffer as well, so a sweep can never make an open
        // receipt unredeemable by a stroop.
        //
        // That buffer is [`RECEIPT_RESERVE`], not [`REDEEM_DUST`] (`anyfix.md` F2). It used to be
        // the two-stroop closing-leg figure, which told the operator that recovering seed capital
        // down to that margin was safe. It was not: two partial legs under a crunch spend it and the
        // third reverts. The reserve now covers the partial legs too.
        //
        // Only the **uncollected** part of the liability still needs PT behind it: whatever a
        // partial redemption already banked is held as USDC instead (`tofix.md` #20), and is
        // reserved separately by `sweep_surplus`. Subtracting it here is what stops a partial
        // redemption from making previously sweepable PT look reserved twice over.
        let uncollected = storage::total_liability(&env) - storage::total_collected(&env);
        let reserved = uncollected + storage::open_receipts(&env) as i128 * RECEIPT_RESERVE;
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

    /// Recover surplus **SR, YT and USDC** to `to`, at or after expiry (`tofix.md` #22).
    ///
    /// `sweep` handles the PT leg. This handles everything else the vault ends up holding, which
    /// the PT-only sweep left permanently stranded — measured at **248.53 SR** on a 20,000 USDC
    /// seed, about 1.2% of it, plus the USDC flooring remainder.
    ///
    /// ## Why this is gated at expiry and `sweep` is not
    ///
    /// PT face is directly comparable to a payout, so surplus PT can be identified — and released —
    /// at any time. The other three legs cannot:
    ///
    /// * **YT** is what *earns* the yield that funds future coupons. Before expiry it has real
    ///   forward value that `assert_solvent` cannot see, because that invariant compares PT face
    ///   against liability and says nothing about future capacity. A pre-expiry YT sweep would
    ///   quietly degrade the vault's ability to meet later payouts while every check still passed.
    /// * **SR** resting in the vault before expiry is transient — `harvest` reinvests it in the
    ///   same call. It only accumulates *after* expiry, when `mint_py` refuses and the claimed
    ///   yield has nowhere to go.
    /// * **USDC** is the redemption flooring remainder, and before every receipt is settled it is
    ///   indistinguishable from cash a partial redemption has banked.
    ///
    /// At/after expiry all three of those objections lapse: nothing further accrues, and what is
    /// left over and above open payouts is genuinely surplus.
    ///
    /// **`total_collected` is reserved unconditionally.** That USDC belongs to partially-redeemed
    /// receipts, and this returns 0 for it rather than dipping in.
    ///
    /// Returns `(sr_out, yt_out, usdc_out)`. Admin only.
    pub fn sweep_surplus(env: Env, to: Address) -> (i128, i128, i128) {
        Self::ensure_initialized(&env);
        storage::get_admin(&env).require_auth();
        Self::observe_loss(&env);
        if env.ledger().timestamp() < storage::get_maturity(&env) {
            panic_with_error!(&env, Error::VaultNotMatured);
        }

        let me = env.current_contract_address();
        let sr_addr = storage::get_sr(&env);
        let underlying = storage::get_underlying(&env);

        // USDC: everything except what partial redemptions have banked for their holders.
        let usdc_held = token::Client::new(&env, &underlying).balance(&me);
        let usdc_out = usdc_held - storage::total_collected(&env);
        let usdc_out = if usdc_out > 0 { usdc_out } else { 0 };

        let sr_out = SrClient::new(&env, &sr_addr).balance(&me);
        let yt_out = Self::yt_inventory(&env);

        if sr_out > 0 {
            SrClient::new(&env, &sr_addr).transfer(&me, &to, &sr_out);
        }
        if yt_out > 0 {
            YieldClient::new(&env, &storage::get_yield(&env)).transfer(&me, &to, &yt_out);
        }
        if usdc_out > 0 {
            token::Client::new(&env, &underlying).transfer(&me, &to, &usdc_out);
        }

        storage::bump_instance(&env);
        events::surplus_swept(&env, &to, sr_out, yt_out, usdc_out);
        // PT is untouched here, so the invariant cannot have moved — assert anyway, cheaply, so a
        // future edit to this function cannot quietly break it.
        Self::assert_solvent(&env);
        (sr_out, yt_out, usdc_out)
    }

    /// What [`Self::sweep_surplus`] would release right now, without moving anything.
    pub fn surplus(env: Env) -> (i128, i128, i128) {
        if !storage::is_initialized(&env) {
            return (0, 0, 0);
        }
        let me = env.current_contract_address();
        let usdc = token::Client::new(&env, &storage::get_underlying(&env)).balance(&me)
            - storage::total_collected(&env);
        (
            SrClient::new(&env, &storage::get_sr(&env)).balance(&me),
            Self::yt_inventory(&env),
            if usdc > 0 { usdc } else { 0 },
        )
    }

    // ================= views =================

    pub fn stats(env: Env) -> SrVaultStats {
        let liability = storage::total_liability(&env);
        let collected = storage::total_collected(&env);
        let pt = Self::pt_inventory(&env);
        // Net of the reserved redemption buffer, so this number matches what `deposit` and `sweep`
        // will actually allow rather than overstating it by a few stroops. Only the uncollected
        // part of the liability still needs PT behind it — see `sweep`.
        let reserved = liability.saturating_sub(collected)
            + storage::open_receipts(&env) as i128 * RECEIPT_RESERVE;
        SrVaultStats {
            pt_inventory: pt,
            yt_inventory: Self::yt_inventory(&env),
            total_liability: liability,
            coupon_capacity: if pt > reserved { pt - reserved } else { 0 },
            total_collected: collected,
            total_residue: storage::total_residue(&env),
            rate_bps: storage::rate_bps(&env),
            maturity: storage::get_maturity(&env),
            open_receipts: storage::open_receipts(&env),
        }
    }

    pub fn get_receipt(env: Env, receipt_id: u64) -> Receipt {
        let mut r = storage::get_receipt(&env, receipt_id)
            .unwrap_or_else(|e| panic_with_error!(&env, e));
        Self::apply_receipt_loss_view(&env, receipt_id, &mut r);
        r
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
    /// Flooring loss realized by partial redemptions across open receipts (`anyfix.md` F2).
    pub fn total_residue(env: Env) -> i128 { storage::total_residue(&env) }
    /// Lowest realized SR value relative to the frozen PY index. `SCALAR_12` means no loss.
    pub fn loss_factor(env: Env) -> i128 { storage::loss_factor(&env) }

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
        let sr = SrClient::new(env, &sr_addr).deposit_checked(&me, &me, &usdc_amount, &0i128);
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

    /// Observe a venue loss without iterating receipts. Receipt payouts are reduced lazily when
    /// each owner touches them, using the same global factor.
    fn observe_loss(env: &Env) {
        let yield_client = YieldClient::new(env, &storage::get_yield(env));
        let sr_client = SrClient::new(env, &storage::get_sr(env));
        // An empty vault is not a zero-value loss. There is no PT capacity to mark, so leave the
        // loss factor at its loss-free default until seed/deposit creates actual exposure. This
        // local balance check is cheaper than a cross-contract total-supply query on every entry.
        if Self::pt_inventory(env) <= 0 {
            return;
        }
        // This observation is intentionally pure. Value-moving redemption performs the mutating
        // sync once when it sizes the PT burn; deposits only need to detect an already-realized loss
        // without adding a second strategy/Blend call to every user entry.
        let (high_water, realizable) = sr_client.rate_snapshot();
        // Healthy growth can leave the pure realizable view slightly below the frozen PY index due
        // to fixed-point floors, but it cannot be a venue loss while it is at or above SR's own
        // high-water mark. Avoid the extra Yield call on the common deposit path; only a suspected
        // decrease needs the exact PT/PY denominator below.
        if realizable.saturating_add(LOSS_RATE_DUST) >= high_water {
            return;
        }
        let py_index = yield_client.py_index();
        let Some(factor) = Self::loss_factor_from_observation(env, py_index, realizable) else {
            return;
        };
        if factor < storage::loss_factor(env) {
            storage::set_loss_factor(env, factor);
            events::loss_recognized(env, factor);
        }
    }

    /// Convert a live venue observation into the global receipt haircut. `None` means the
    /// observation is within the fixed-point dust band and must not change accounting. A zero
    /// realizable rate is explicitly `Some(0)`: a total venue loss must close claims at zero rather
    /// than leaving every receipt permanently retryable.
    fn loss_factor_from_observation(env: &Env, py_index: i128, realizable: i128) -> Option<i128> {
        if py_index <= 0 || realizable <= 0 {
            return Some(0);
        }
        if realizable.saturating_add(LOSS_RATE_DUST) >= py_index {
            return None;
        }
        Some(
            math::mul_div_floor(env, realizable, SCALAR_12, py_index)
                .unwrap_or(0)
                .min(SCALAR_12),
        )
    }

    /// Apply the current global loss factor to one receipt and update the aggregate liability by
    /// exactly that receipt's haircut. This lazy form is storage-compatible and avoids an
    /// unbounded migration loop on upgrade.
    fn apply_receipt_loss(env: &Env, receipt_id: u64, r: &mut Receipt) {
        let global = storage::loss_factor(env);
        let applied = storage::receipt_loss_factor(env, receipt_id);
        if global >= applied || applied <= 0 {
            return;
        }
        let paid = storage::paid(env, receipt_id);
        let protected = paid.saturating_add(r.collected);
        let outstanding = r.payout.saturating_sub(protected);
        let remaining = math::mul_div_floor(env, outstanding, global, applied).unwrap_or(0);
        let next_payout = protected.saturating_add(remaining);
        let haircut = r.payout.saturating_sub(next_payout);
        r.payout = next_payout;
        storage::set_receipt_loss_factor(env, receipt_id, global);
        if haircut > 0 {
            storage::set_total_liability(
                env,
                storage::total_liability(env).saturating_sub(haircut),
            );
        }
    }

    /// Pure counterpart used by dashboards and `get_receipt`.
    fn apply_receipt_loss_view(env: &Env, receipt_id: u64, r: &mut Receipt) {
        let global = storage::loss_factor(env);
        let applied = storage::receipt_loss_factor(env, receipt_id);
        if global >= applied || applied <= 0 {
            return;
        }
        let protected = storage::paid(env, receipt_id).saturating_add(r.collected);
        let outstanding = r.payout.saturating_sub(protected);
        let remaining = math::mul_div_floor(env, outstanding, global, applied).unwrap_or(0);
        r.payout = protected.saturating_add(remaining);
    }

    /// **The invariant.** PT redeems 1:1 at expiry, so holding at least as much PT face as the sum
    /// of open payouts means every receipt is payable no matter what happens in between.
    /// **The invariant.** Every open payout must be covered.
    ///
    /// `total_collected` is in here because a partially-redeemed receipt has had PT burned to
    /// obtain USDC (`tofix.md` #20): that portion of its backing is now cash sitting in the vault
    /// rather than bond face. Comparing PT alone against liability would trip on the vault's own
    /// correct behaviour the moment any receipt is partially collected.
    fn assert_solvent(env: &Env) {
        // `total_residue` is the third term for the reason `Receipt::residue` explains: PT face that
        // a partial redemption burned and the flooring ate, rather than value that went missing. It
        // is bounded by `PARTIAL_LEG_BUDGET` per open receipt — which `deposit` and `sweep` both
        // hold back — and it is released when the receipt closes, so this stays a real check and not
        // an ever-widening one.
        if Self::pt_inventory(env) + storage::total_collected(env) + storage::total_residue(env)
            < storage::total_liability(env)
        {
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
    fn py_index_current(env: Env) -> i128;
    fn py_index(env: Env) -> i128;
    fn redeem_due_interest(env: Env, user: Address) -> (i128, i128);
    fn transfer(env: Env, from: Address, to: Address, amount: i128);
}

/// SR's surface.
#[soroban_sdk::contractclient(name = "SrClient")]
pub trait SrToken {
    fn underlying(env: Env) -> Address;
    fn balance(env: Env, id: Address) -> i128;
    fn deposit_checked(env: Env, from: Address, receiver: Address, amount: i128, min_shares_out: i128) -> i128;
    fn rate_snapshot(env: Env) -> (i128, i128);
    fn deposit(env: Env, from: Address, receiver: Address, amount: i128, min_shares_out: i128) -> i128;
    fn redeem(env: Env, from: Address, receiver: Address, shares: i128, min_underlying_out: i128) -> i128;
    /// The largest redemption the venue can currently satisfy, in SR shares. `i128::MAX` when
    /// liquidity comfortably covers everything — `redeem` sizes its burn against this so a
    /// liquidity crunch costs the holder extra transactions rather than the whole exit.
    fn transfer(env: Env, from: Address, to: Address, amount: i128);
    fn max_redeemable(env: Env) -> i128;
    /// Current realizable underlying per SR share, including a venue loss and ignoring the
    /// monotonic high-water guard. This is used only to size a loss-aware vault redemption.
    fn realizable_rate(env: Env) -> i128;
    /// Underlying that `shares` SR would release at the current rate. Panic-free (`0` = no quote).
    fn preview_redeem(env: Env, shares: i128) -> i128;
}
