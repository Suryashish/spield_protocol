# V2 Remaining Work: What Is Wrong, Why It Matters, and How to Fix It

This document turns the open **v2** findings in [`tofix.md`](./tofix.md) into an implementation-oriented work list. It intentionally excludes work that applies only to the old v1 deployment.

Verification basis: **2026-08-26**. Every claim below was re-tested against the current tree or read from a live network this round. Local suite: **509 Rust tests green**; release WASM builds clean with zero warnings; SDK **218 tests green** through the documented `pnpm run test:unit`.

## Status — what is now done

Eleven of fourteen items are **implemented, tested and green**. The three that remain are the calibration decisions that need numbers rather than code. Completed items keep their reasoning, marked ✅ DONE.

| | Item | Status |
|---|---|---|
| §1 | SR deposit cap | ⬜ **Open — needs a number.** Its *description* was wrong and is corrected below |
| §2 | Market's reported rate frozen | ✅ **DONE** — anchor pre-trade, quote responds and scales |
| §3 | Zero-share LP additions | ✅ **DONE** — guard added, misaimed test replaced |
| §4 | `add_liquidity` tolerance | ✅ **DONE** — `min_shares` added, misaimed test replaced |
| §5 | Resumable `srvault` redeem | ✅ **DONE** — `collected` banking, invariant widened, 8 tests |
| §6 | Recover surplus SR/YT/USDC | ✅ **DONE** — `sweep_surplus`, expiry-gated, 5 tests |
| §7 | Monitors runnable | ✅ **DONE** — own package; vault probe fixed; SDK pinned to 17.x |
| §8 | 11-stroop PT alarm | ✅ **DONE** — burned on testnet; watchtower reports all six invariants holding |
| §9 | TTL keep-alive | ✅ **DONE** — three contract entry points, all four in the SDK |
| §10 | `srvault` SDK surface | ✅ **DONE** — full typed client including the resumable-redeem surface |
| §11 | pnpm test command | ✅ **DONE** — `pnpm run test:unit` passes 218 |
| §12 | Liquidity haircut | 🟡 **The code half is DONE** — `available_liquidity` now computes the real utilization cap. Only the residual haircut *number* is left |
| §13 | Utilization alert | ⬜ **Open** — needs the threshold decision |
| §14 | `scalar_root` | ⬜ **Open, unblocked** — §2 makes it measurable |

**Two extra fixes, not previously listed:**

* The v1 vault probe in `scripts/solvency_monitor.mjs` read `solvency` and `bearer_redeemed` on the vault — neither has ever been a vault function. It reads `stats()` now. Details under §7.
* **`sr::test`'s mock strategy diverged from the real adapter on the one path its headline test was named for.** This produced a false claim about v2's behaviour that reached §1 and the risk disclosure. Details under §1.

## Revision note — what changed since the first draft

The first draft carried several claims that did not survive testing. They are corrected here rather than silently dropped, so anyone holding the old version can reconcile.

| Item | Was | Now |
|---|---|---|
| Deposit cap | Justified with `SolvencyViolation` freezing all withdrawals | **That is v1's failure, not v2's.** v2 exits survive a dip. Rewritten around the real risk — see [§1](#1-choose-and-apply-an-sr-deposit-cap) |
| `scalar_root` | Justified with a 4.990% → 4.406% measurement | **Measured on the v1 market, a different curve.** Rewritten and now blocked on §2 — see [§14](#14-calibrate-the-markets-scalar_root) |
| pnpm fix | `pnpm.onlyBuiltDependencies` in `sdk/package.json` | **Tested and it does not work.** pnpm 11 ignores that field — see [§11](#11-repair-the-documented-pnpm-test-command---done) |
| TTL helpers | Framed as an SDK-only omission | **Three of five entry types have no contract-level bump at all** — see [§9](#9-add-ttl-keep-alive-coverage-contract--sdk---done) |
| Resumable redeem | Eight safety properties | **Missing the solvency invariant**, which the change breaks — see [§5](#5-make-srvault-redemptions-resumable---done) |
| `add_liquidity` compat | Listed "router call sites" | **`srrouter` never calls the LP functions.** Removed |
| 11-stroop alarm | Two equally-weighted options | **Burning is feasible and strictly better** — see [§8](#8-reconcile-the-permanent-11-stroop-pt-alarm---done) |
| — | — | **New:** the market's reported rate never responds to trading — see [§2](#2-the-markets-reported-rate-and-price-never-respond-to-trading---done) |

## Scope

1. On-chain contract fixes.
2. Operational monitoring fixes.
3. SDK and developer-tooling fixes.
4. Risk and market-parameter decisions.

Terms used below:

- **SR** is the yield-bearing share token.
- **PT** is the principal token, representing principal due at maturity.
- **YT** is the yield token, representing the right to yield.
- **LP shares** represent ownership of the PT/SR liquidity pool.
- **TVL** is the total value deposited in the protocol.

## Priority summary

| Priority | Work | Type | Status |
|---|---|---|---|
| P0 | Choose and apply an SR deposit cap | Risk/deployment decision | ⬜ needs a number |
| P1 | Fix the market's frozen implied rate and PT price | Contract fix | ✅ done |
| P1 | Reject liquidity additions that mint zero LP shares | Contract fix | ✅ done |
| P1 | Add caller-controlled protection to `add_liquidity` | Contract/API fix | ✅ done |
| P1 | Make `srvault` redemptions resumable | Contract fix | ⬜ open |
| P1 | Allow safe recovery of surplus SR, YT, and USDC | Contract fix | ⬜ open |
| P1 | Make the monitoring scripts independently runnable | Operations fix | ✅ done |
| P1 | Reconcile the permanent 11-stroop PT alarm | Operations fix | ⬜ needs a live tx |
| P2 | Add TTL keep-alive coverage | Contract + SDK fix | ✅ done |
| P2 | Add the complete `srvault` interface to the SDK | SDK/product fix | ⬜ blocked on §5 |
| P2 | Repair the documented pnpm test command | Tooling fix | ✅ done |
| Decision | Calibrate the redemption-liquidity haircut | Risk parameter | ⬜ needs measurement |
| Decision | Calibrate the Blend utilization alert | Monitoring parameter | ⬜ needs measurement |
| Decision | Calibrate `scalar_root` | Market parameter | ⬜ unblocked by §2 |

---

## 1. Choose and apply an SR deposit cap

**Still open — it needs a number, not code.** But its *description* was wrong in both earlier drafts, and the correction changes what the number means.

### The correction

The first draft justified this with v1's `SolvencyViolation` freeze. The second replaced that with "v2 exits survive a dip; the risk is a first-come-first-served over-promise." **That was also wrong**, and it came from an unfaithful test.

`sr::test`'s mock strategy resolved its rate straight from storage. The real [`spield-strategy::redeem`](./contracts/strategy/src/lib.rs) opens with `let rate = Self::current_rate(env.clone());`, and `check_rate_bound_timed` returns `RateOutOfBounds` on **any** downward move. Making the mock faithful flipped the result immediately:

```
redeem -> HostError: Error(Contract, #40)   // RateOutOfBounds
```

Same defect class as the misaimed §3 and §4 tests: the mock diverged from the real adapter on the one path the test was named for, and the false claim propagated into `tofix.md` #3 and into the user-facing risk disclosure.

### What actually happens

1. **A dip freezes everything, exits included.** `sync_rate`, `deposit` and `redeem` all revert. Reads survive, because `Sr::exchange_rate` is a pure read of SR's own stored high-water mark. Pinned at every exit size by `a_dip_freezes_exits_at_every_size` — a holder cannot slip under the freeze by withdrawing less.
2. **Clearing it is an admin action.** `strategy::reset_rate_floor()` lowers the stored floor to the live rate. Until an admin calls it, **nobody can exit at all.** That is a live operational obligation on a key that is still a single hot key.
3. **After the reset the loss is pro-rata.** Measured in `resetting_the_rate_floor_unfreezes_exits_and_the_loss_lands_pro_rata`: two equal holders, a 20% haircut, and the one who exits first receives exactly what the one who exits second receives — 800 USDC each on a 1,000 USDC deposit. **Exiting first confers no advantage.**
4. **SR's quoted rate still over-promises.** The high-water mark does not fall, so `preview_redeem` reports the old value while `redeem` pays the real one — 1,000 vs 500 on a 50% collapse (`a_clamped_rate_never_promises_more_than_the_strategy_pays`).

### Who bears it

**Users, pro-rata by shares.** The protocol holds no buffer — no insurance fund, no equity tranche, no protocol capital subordinated to depositors. The strategy simply holds user deposits in Blend; a 20% socialised loss makes every SR share worth 20% less.

The operator bears no *financial* loss by design, beyond whatever they hold as a depositor themselves — seed capital counts. What the operator does bear is the freeze: it persists until they act.

### So what the cap actually bounds

Not your loss. **The maximum depositor loss that can occur uncompensated, with recovery gated on your key.** At a 100,000 USDC cap and a 20% haircut that is up to 20,000 USDC of user losses, spread evenly, plus a freeze of unbounded duration.

Pick the depositor-loss figure you are willing to have happen and explain, then divide by your planning haircut.

### Current state

```
deposit_cap    0            <- uncapped
total_assets   3433.2304105 USDC
```

`SR_DEPOSIT_CAP=0` in `deploy_sr_testnet.sh`; the script warns loudly but deploys anyway.

### Acceptance criteria

- A non-zero cap is approved and documented.
- The value is applied on-chain and read back.
- The deployment configuration contains the approved value.
- Deposits above the remaining headroom revert.
- Redemptions keep working if the cap is later lowered below TVL (pinned by `the_cap_can_never_trap_a_depositor`).
- A user's own yield does not consume headroom (pinned by `yield_growth_does_not_eat_the_cap`).
- Monitoring reports cap, total assets and headroom.
- **The disclosure describes the freeze, the admin-gated recovery, and the pro-rata loss** — done, see below.

### Already done alongside this

`RiskDisclosure.tsx` has been corrected. It previously said the freeze lasts "until backing recovers" (omitting that an admin must act) and that "there is no partial-withdrawal path" (no longer true after §5). It now states the freeze, who clears it, that the loss is shared in proportion and exiting first does not help, and that the displayed position value is an upper bound rather than a quote.

---

## 2. The market's reported rate and price never respond to trading — ✅ DONE

**New finding, 2026-08-26.** Not present in the first draft of `tofix.md`; found while attempting to calibrate `scalar_root`. **Fixed the same day.**

### What was wrong

`srmarket::implied_apy()` and `srmarket::pt_price()` return the same values no matter how much the pool is traded. Measured across four trade sizes on an identical 500,000/500,000 pool:

```text
size%  |    exec px (SR/PT) |  pt_price view |    implied_apy
     1 |        0.955277387 |   952380952309 |    50000000075
     2 |        0.955789963 |   952380952309 |    50000000075
     5 |        0.957329114 |   952380952309 |    50000000075
    10 |        0.959905081 |   952380952309 |    50000000075
    25 |        0.967833557 |   952380952309 |    50000000075
    50 |        0.982709845 |   952380952309 |    50000000075
```

**Execution is correct.** The realised price rises from 0.9553 to 0.9827 with size — real slippage, the curve works, there is no free arbitrage. **Only the reported views are frozen**, and identically so at every size: the 40-unit change in `implied_apy` is fixed-point rounding, not a response.

Confirmed on the live testnet market, whose reserves are heavily skewed after real trading:

```text
reserves      PT 58.937365 / SR 44.8906318      (a ~1.31:1 skew)
implied_apy   5.0000050221%                     (still exactly its seeded rate)
```

### Why it happens

`curve::try_params` derives the anchor so that the price at the proportion it is given is *by definition* the target price:

```rust
// contracts/srmarket/src/curve.rs
let target_price = exp_fixed(env, -fmul(env, last_ln_implied_rate, years)?)?;
// rate_anchor = target_price + logit(prop)/rate_scalar, so price(prop) == target_price now.
let rate_anchor = target_price
    .checked_add(fdiv(env, logit(env, prop)?, rate_scalar)?)?;
```

`try_price_at(prop, p) = anchor - logit(prop)/rate_scalar = target_price`. That is an identity for whatever reserves are passed in.

`Self::sync_implied_rate` (`contracts/srmarket/src/lib.rs:899`) then passes it the **post-trade** reserves and reads the price back at **that same** proportion:

```rust
let p = curve::try_params(env, pt_res, sr_res, ..., storage::last_ln_implied_rate(env), ...);
let asset_res = Self::sr_to_asset(env, sr_res, index);
curve::try_new_ln_implied_rate(env, pt_res, asset_res, &p)   // -> target_price -> the old rate
```

The stored rate is therefore a **fixpoint** and the update is a mathematical no-op. `pt_price()` is pinned the same way, because it also builds params from current reserves and the same stored rate.

This defeats the curve's stated intent. Its own module docs open with:

> **The anchor is recomputed, not pinned at par.** v1 pins `rate_anchor` at 1.0 forever ... Pendle re-derives the anchor.

### What was done

`sync_implied_rate` now takes the pre-trade reserves and prices the post-trade proportion:

```rust
fn sync_implied_rate(env: &Env, pre_pt_res: i128, pre_sr_res: i128) {
    let index = Self::index_view(env);
    // Anchor on the PRE-trade state.
    if let Ok(p) = curve::try_params(env, pre_pt_res, pre_sr_res, index, ..., last_ln, expiry, now) {
        // Price the POST-trade proportion under that anchor.
        let pt_res = storage::pt_reserve(env);
        let sr_res = storage::sr_reserve(env);
        let asset_res = Self::sr_to_asset(env, sr_res, index);
        if let Some(r) = curve::try_new_ln_implied_rate(env, pt_res, asset_res, &p) {
            storage::set_last_ln_implied_rate(env, r);
        }
    }
}
```

All five call sites capture their pre-trade reserves and pass them. `pt_price()` is fixed by the
same change, since it derives from `last_ln_implied_rate`.

### Measured after the fix

```
#34  buy  1% of the SR side: apy 49999999992 -> 49436133719, pt_price 952380952384 -> 952892670517
#34  buy  5% of the SR side: apy 49999999992 -> 47184936738, pt_price 952380952384 -> 954941161694
#34  buy 25% of the SR side: apy 49999999992 -> 35810448899, pt_price 952380952384 -> 965427604115
#34  quote response scales with size: [563866273, 2815063254, 14189551093]
#34b sell: apy 49999999992 -> 60881755768, pt_price 952380952384 -> 942612119174
```

Buying lowers the implied yield and raises the price; selling does the reverse; the size of the move
scales with the size of the trade. A 5% buy now moves the quote ~1.1 percentage points where it
previously moved 4e-11.

### Tests added

- `tofix_34_the_quote_moves_with_flow_and_scales_with_size` — direction and monotonic size response.
- `tofix_34b_selling_moves_the_quote_the_other_way` — the opposite direction.
- `tofix_34c_proportional_liquidity_changes_are_rate_neutral` — a proportional add/remove must not
  move the quote. This is the property the fix could plausibly have broken, so it is pinned
  explicitly. `pt_add * rs / rp` floors, so it is bounded at 1 ppm rather than asserted exact —
  three orders of magnitude tighter than the ~1.1% a 5% trade produces, so a regression to real
  movement cannot hide inside the tolerance.

`pt_still_converges_to_par_with_a_dynamic_anchor` is unchanged and still green.

### One existing test had to change, and it is worth understanding why

`economics_test::an_idle_participant_cannot_gain_at_anothers_expense` failed after the fix, on:

```
the LP absorbing the flow must not lose: 9813853345250 -> 9811475992306
```

That assertion was **only ever true because the price was frozen**. It marked the LP's pre-trade and
post-trade bundles at the same number, so it silently measured fee accrual. With a working price it
became a mark-to-market comparison, and an LP that absorbs one-way flow is down against holding —
which is impermanent loss, not a defect.

The test now measures both properly:

```
LP after 100k SR of one-way flow (pt_price 952380952384 -> 962770669050):
  fees, at constant prices:       +8434389306
  vs holding, both at exit price: -2377352944  <- impermanent loss, expected
```

The idle-participant assertions the test is named for were always correct and are unchanged.

**This is a real behavioural change to be aware of before deploying**: the pool now has visible
impermanent loss. It always had it economically; it was simply unobservable through the contract's
own views.

---

## 3. Reject liquidity additions that mint zero LP shares — ✅ DONE

### What was wrong

The first-LP branch of `srmarket::add_liquidity` verifies that the calculated share amount is positive. The follow-on LP branch does not — it returns `lo` unchecked (`contracts/srmarket/src/lib.rs:189`).

After trading fees change the relationship between pool reserves and total shares, a sufficiently small deposit calculates zero new LP shares. Both legs floor to zero, so `hi - lo == 0` and the ratio check passes. The user's PT and SR are transferred and the user receives no LP ownership.

### Reproduced example

After two ordinary round trips grew reserves relative to total LP shares:

```text
PT reserve:    4,792,577,961,655
SR reserve:    5,199,710,318,777
Total shares:  5,000,000,000,000

add_liquidity(1 PT unit, 1 SR unit)
-> PT and SR transferred (pt=1, sr=1)
-> 0 LP shares minted
```

### What was done

The guard runs after the share calculation and before either transfer, covering both branches:

```rust
if shares <= 0 {
    panic_with_error!(&env, Error::InvalidAmount);
}
```

`Error::InvalidAmount = 5` is what the first-LP branch already used, so the two are now consistent.

### Test replaced

`tofix_26b_a_dust_add_cannot_swallow_the_deposit_for_zero_shares` previously added dust to a pool
that had **never traded**, where `total_shares == pt_reserve`, so one unit still produced one share
and the defect could not occur. It passed for the wrong reason while the defect was live.

It now trades first (asserting a reserve actually grew past `total_shares`), then confirms the dust
add reverts and that PT balance, SR balance, reserves and total shares are all unchanged — and that
an ordinary ratio-matched add still mints.

---

## 4. Add caller-controlled protection to `add_liquidity` — ✅ DONE

### What was wrong

`srmarket::add_liquidity` requires the deposit to match the live pool ratio within a hardcoded band of about 0.1% (`hi - lo > (hi / 1000) + 1`). It does not accept `min_shares` or any other caller-selected tolerance.

The pool ratio can change after a user calculates the deposit but before their transaction executes. A swap that lands first therefore makes an otherwise correct liquidity transaction revert.

This is a liveness and denial-of-service problem. The strict ratio check prevents a bad fill, so the LP's principal is not extracted, but the transaction fails and the LP wastes fees and time.

### Reproduced example

```text
Pool reserves: 500,000 PT / 500,000 SR
LP computes:   sr_in = pt_in * sr_reserve / pt_reserve    (an exact match)
```

A swap of roughly 1% of the pool lands first. The prepared, exactly ratio-matched addition **reverts**, and the LP has no argument that would accept a slightly different outcome.

### What was done — and one design decision worth reviewing

`add_liquidity` now takes `min_shares: i128`:

```rust
pub fn add_liquidity(env: Env, lp: Address, pt_in: i128, sr_in: i128, min_shares: i128) -> i128
```

**`min_shares` alone does not fix the DoS**, which is the part that needed a decision. The 0.1% band
and `min_shares` are two different checks; adding the second while keeping the first leaves the
pre-quoted deposit rejected exactly as before. That was the first attempt here and the test caught
it with `ImbalancedLiquidity (#84)`.

The band and the bound therefore had to be made alternatives, and the shipped rule is:

```rust
if min_shares == 0 && hi - lo > (hi / 1000) + 1 {
    panic_with_error!(&env, Error::ImbalancedLiquidity);
}
...
if shares < min_shares {
    panic_with_error!(&env, Error::SlippageExceeded);
}
```

- **`min_shares == 0`** — the caller stated no bound, so the pool's 0.1% band still applies. This is
  exactly today's behaviour, so every existing caller is unaffected.
- **`min_shares > 0`** — the caller stated their own bound, which replaces the band. The contract
  mints `min(by_pt, by_sr)` (the standard AMM shape) and reverts `SlippageExceeded` below the bound.

**The trade-off, stated plainly:** under a stated bound the over-supplied leg is donated to the pool
rather than refunded, which is what Uniswap V2 does and what routers exist to avoid. The alternative
— dropping the band unconditionally — would have removed that protection from every caller who
passes `0`, including all current ones. **If you would rather the band go away entirely, or rather
have `max_pt_in`/`max_sr_in` with a refund instead, this is the line to change.**

### Test replaced

`tofix_26c` previously exercised **`remove_liquidity`**, a different function that genuinely did have
`min_pt_out`/`min_sr_out`. It is now `tofix_26c_add_liquidity_has_a_caller_chosen_tolerance`, which
lands a swap between the LP's quote and their add, then asserts: the unbounded add still reverts
(the default is preserved), the bounded add succeeds, `min_shares` binds above the achievable amount
without consuming anything, and the exact boundary passes.

### API and compatibility work — done

- Contract interface: `add_liquidity` now takes four arguments.
- `frontend/src/lib/srstack.ts`: `addLiquidity(wallet, ptIn, srIn, minShares = 0n)`. The default
  keeps `v2adapters.addLiquidity` and every existing caller on today's behaviour; `tsc --noEmit`
  passes.
- Test call sites across `srmarket` and `srrouter` updated.
- **`srrouter` does not call `add_liquidity` or `remove_liquidity`** in contract code and needed no
  change — only its test harness did.

**Not yet done:** the deployed testnet market still has the old three-argument ABI. This needs a
redeploy or upgrade before the SDK change is usable against it.

---

## 5. Make `srvault` redemptions resumable — ✅ DONE

### What was wrong

`srvault::redeem` required the whole payout in one call. Short of it, the transaction reverted, the receipt stayed open, and no progress was stored — the holder got nothing however much liquidity was available.

### What was done

`Receipt` gained a `collected: i128` field and the vault a `TotalCollected` counter. `redeem` now **sizes its PT burn to what the venue can actually pay** rather than burning the full payout and hoping:

```rust
let cap  = sr.preview_redeem(&sr.max_redeemable());
let take = if cap > 0 && cap < remaining { cap } else { remaining };
// ... burn `take` (+ the rounding buffer on the closing leg only), convert, bank the proceeds
```

Sizing first — rather than attempting the full amount and accepting a partial fill — is what keeps this clean: no leftover SR is stranded mid-conversion. Progress is banked on the receipt, capped at `payout` so a generous flooring can never let a receipt claim more than it is owed, and the holder is paid exactly `payout` on the closing call.

`redeem_remaining(receipt_id)` reports what is still outstanding. Receipts are not transferable in `srvault`, so "who may continue a partially-collected receipt" never arises — it is the owner, and `require_auth` is unchanged.

### The invariant had to move with it, and this was not optional

```rust
// before: pt_inventory >= total_liability
if Self::pt_inventory(env) + storage::total_collected(env) < storage::total_liability(env) {
    panic_with_error!(env, Error::SolvencyViolation);
}
```

A partial redemption burns PT to obtain USDC, so that portion of a receipt's backing is now cash rather than bond face. Without widening the invariant, the vault would trip on its own correct behaviour on the second call. `sweep` and `stats` reserve the same way — only the *uncollected* part of the liability still needs PT behind it.

### It surfaced a hard dependency on §12

The first working build still failed under a crunch with Blend's `#1207`. The withdrawal had been sized against `max_redeemable()`, which was sized against the pool's raw balance — and the pool was already at its utilization ceiling, so the true headroom was near zero. **§5 could not work until `available_liquidity` computed the real cap.** See §12.

### Tests — 8, covering the cases that matter

| Test | Property |
|---|---|
| `a_crunched_redeem_banks_progress_and_a_later_call_finishes_it` | The headline: partial banks, receipt stays open, holder paid once at the end |
| `a_healthy_redeem_still_completes_in_a_single_call` | No regression on the happy path; no reservation created |
| `a_receipt_cannot_be_paid_twice` | Closed receipts refuse |
| `a_partial_redeem_never_over_collects` | `collected <= payout` at every step, and every call makes progress |
| `solvency_holds_while_a_receipt_is_partially_collected` | The invariant holds at **every step** of two concurrent redemptions |
| `a_redeem_against_a_dry_venue_refuses_without_corrupting_state` | A refused call banks nothing, burns no PT, and recovery still works |
| `a_stranger_cannot_redeem_someone_elses_receipt` | Ownership |
| `sweep_surplus_never_touches_usdc_reserved_for_a_partial_redemption` | The §6 interaction (listed there) |

Measured on a 210,000 USDC payout with the venue drawn to Blend's ceiling:

```
venue free 800,000 -> 56,230 USDC after the draw-down
first call collected 0.93 USDC     <- the true headroom at max_util is near zero
finished: paid 210,000 across 2 calls total
```

That first figure is worth keeping: at the utilization ceiling a pool pays out almost nothing, which is exactly why the raw-balance estimate was dangerous.

---

## 6. Allow safe recovery of surplus SR, YT, and USDC — ✅ DONE

### What was wrong

`sweep` recovered surplus PT only. A full lifecycle left SR, YT and a USDC remainder with no exit path — measured at **248.53 SR** on a 20,000 USDC seed, about 1.2% of it. The SR is *created by* the fix for `tofix.md` #21: post-expiry `harvest` correctly claims yield, but `mint_py` refuses past expiry, so the proceeds park in the vault.

### What was done

`sweep_surplus(to) -> (sr, yt, usdc)`, admin-only and **gated at/after expiry**, plus a read-only `surplus()` that predicts it.

The expiry gate is the design decision, and it differs per leg for a reason:

* **YT** is what earns the yield funding future coupons. Before expiry it has forward value that `assert_solvent` cannot see — that invariant compares PT face against liability and says nothing about future capacity. A pre-expiry YT sweep would quietly degrade the vault's ability to meet later payouts while every check still passed.
* **SR** resting pre-expiry is transient; `harvest` reinvests it in the same call. It only accumulates after expiry.
* **USDC** pre-expiry is indistinguishable from cash a partial redemption has banked.

At/after expiry all three objections lapse. `total_collected` is reserved unconditionally regardless — that USDC belongs to partially-redeemed receipts.

`sweep`, `stats` and `deposit` all changed to reserve only the **uncollected** part of the liability in PT, so a partial redemption cannot make previously sweepable PT look reserved twice.

### Tests — 5

| Test | Property |
|---|---|
| `a_full_lifecycle_leaves_no_inaccessible_inventory` | The original measurement, re-run: nothing valuable stranded |
| `sweep_surplus_is_refused_before_expiry` | Refused at deploy, refused mid-term, allowed after |
| `sweep_surplus_never_touches_usdc_reserved_for_a_partial_redemption` | **The §5 interaction** — the holder's banked USDC survives a sweep and they are still paid in full |
| `sweep_cannot_take_pt_backing_an_open_receipt` | Capacity binds exactly; the receipt still pays in full afterwards |
| `sweeps_require_the_admin` | Authorization |

Measured:

```
before sweeping: PT 201967086960  SR 2485274157  YT 212467086962  USDC 1
after:           vault fully drained of surplus; nothing inaccessible remains

with a partial in flight: vault holds 547114561434 USDC, 547114561434 reserved, 0 sweepable
```

---

## 7. Make the monitoring scripts independently runnable — ✅ DONE

### What was wrong

The monitoring scripts import `@stellar/stellar-sdk`, but `scripts/` has no package manifest and no local dependency installation. Running either monitor as documented fails before any protocol check runs:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@stellar/stellar-sdk'
  imported from …/scripts/sr_solvency_monitor.mjs
```

Node resolves ESM imports from the **script's own directory**, not the working directory, so `cd`-ing into a project that has the dependency installed does not help. Both monitors had to be copied next to a `node_modules` tree to run at all this round.

### What was done

`scripts/package.json` now exists, with `"type": "module"` and its own installed dependency, plus
`monitor:v1` / `monitor:v2` / `budget` run scripts. Both monitors now start from `scripts/`.

**A second cause turned up while fixing the first.** With the dependency resolving, the v1 vault
probe still failed:

```
⚠ vault probe unavailable: Bad union switch: 1
```

That was not the probe — **every** vault view failed the same way, including `rate_bps` and
`maturity`, while the wrapper's `solvency` worked. The vault's simulation response carries
`stateChanges`, which `@stellar/stellar-sdk` 13.x cannot decode. The scripts package therefore pins
**`^17.0.1`**, which decodes it. The published SDK in `sdk/` still pins 13.x for its own reasons;
the scripts are deliberately an independent package, and the reason is recorded in its
`description` so nobody "tidies" the versions back together.

### And the vault probe was reading functions the vault has never had

Separately from the dependency problem, the probe asked for `solvency` and `bearer_redeemed` **on
the vault**. Neither has ever been a vault function on any build, so it always fell through to:

```
— vault: no aggregate solvency view on this contract (v1 exposes per-receipt reads only)
```

which was simply wrong — the view exists, the probe was asking for the wrong name. The vault's
aggregate view is `stats()`. It now reads that, and `pt_inventory >= total_liability` is exactly the
invariant `assert_solvent` enforces on chain.

### Verified against the live deployment

```
✓ solvency: backing=345.4900098 principal=345.4400376 headroom=0.0499722
  band=64 (⚠ ESTIMATED — this deployment predates open_positions(); redeploy the wrapper …)
✓ vault: pt_inventory=65.2677677 total_liability=60.3659222 coupon_capacity=4.9018455
✓ market_reserves: pt=175.9636909 usdc=13.2726393
```

The v2 monitor also starts from `scripts/` and runs its six probes.

**Still degraded, and correctly so:** the wrapper's estimated band and its unavailable
`pt_conservation` probe both need the v1 wrapper redeployed so `open_positions()` and
`bearer_redeemed()` exist. That is v1 work and out of scope here; the monitor says so loudly rather
than guessing, which is the behaviour this item wanted.

---

## 8. Reconcile the permanent 11-stroop PT alarm — ✅ DONE

### What was wrong

The issuer-lockdown rehearsal deliberately created 11 stroops of counterfeit PT. The watchtower correctly detected it, and therefore fired on **every** run — a permanently red monitor, which causes alert fatigue and can hide a real future counterfeit mint behind a known discrepancy.

### What was done

**Burned**, rather than papered over with a baseline offset. Sending a classic asset to its issuer destroys it and does not require the issuer to sign, so the completed lockdown was no obstacle:

```
stellar tx new payment --source-account alice425 --network testnet \
  --destination GCCDH7PS…ASN5EEAYX \
  --asset SPLDPT5:GCCDH7PS…ASN5EEAYX --amount 11
```

Before and after, from the watchtower:

```
before:  total_py=17007722855  pt_supply=17007722866   ✗ PT COUNTERFEIT … exceeds … by 11
after:   total_py=17007722855  pt_supply=17007722855   ✓ all six invariants hold
```

A signed baseline offset was the alternative and is strictly worse: it writes a permanent exception into the conservation identity, so every future operator and audit has to know about it and the identity stops being self-evident. Burning cost 0.0000011 PT.

---

## 9. Add TTL keep-alive coverage (contract + SDK) — ✅ DONE

### What was wrong

Soroban persistent entries are archived when their TTL lapses. Every entry is bumped on write, but an entry that is simply **held and never touched** depends on a permissionless top-up call — and most of them do not have one.

Current coverage:

| Entry | Bumped on write | Permissionless bump function |
|---|---|---|
| `srvault` Receipt | maturity-aware | `srvault::bump_receipt` |
| `yield` Interest | maturity-aware | `yield::bump_holder` |
| **`yield` YT balance** | 1-year rolling | **none** |
| **`Sr` SR balance** | 1-year rolling | **none** |
| **`srmarket` LP shares** | expiry-aware | **none** |

`yield::bump_holder` extends only the `Interest` entry (`storage::bump_interest_ttl`), not the holder's YT balance.

Separately, neither of the two that do exist is reachable from `frontend/src/lib/srstack.ts`, so no shipped client code calls them.

SR is the most exposed of the three gaps: `Sr::bump_horizon` requests a one-year extension on every balance write, but that is clamped to the network's `max_live_until_ledger`, and SR has **no maturity of its own** to bound the holding period. A depositor who wraps USDC and does nothing for longer than the network TTL ceiling has no supported way to keep their balance alive.

PT is unaffected — it is a classic Stellar Asset Contract, so its balances are trustlines in the classic ledger and are not subject to archival.

### What was done

**Contract work — three additions, all permissionless, all value-neutral:**

| New entry point | Covers |
|---|---|
| `Sr::bump_holder(user)` | an SR balance entry |
| `SrMarket::bump_lp(lp)` | an LP share entry |
| `Yield::bump_holder(user)` — **extended** | now bumps the YT **balance** entry as well as the `Interest` record |

Backed by two new storage helpers: `spield_shared::token::bump_balance` (extend a balance entry
without writing it) and `srmarket::storage::bump_shares_ttl`. Both no-op when the address holds
nothing, so none of these can create an entry.

The `Yield::bump_holder` change matters as much as the two new functions: it bumped only the
interest record, so a dormant YT holder had the accounting kept alive while the balance it referred
to was left to archive — exactly the wrong half.

**SDK work:** `bumpSrHolder`, `bumpYieldHolder`, `bumpLpPosition` and `bumpVaultReceipt` are all
exposed from `srstack.ts`, plus `bumpAll(wallet)` which fires the three holder-side bumps together.
Each takes an optional subject address defaulting to the caller, since the calls are permissionless
and a keeper may run them for someone else.

Coverage is now complete:

| Entry | Bumped on write | Permissionless bump |
|---|---|---|
| `srvault` Receipt | maturity-aware | `srvault::bump_receipt` |
| `yield` Interest | maturity-aware | `yield::bump_holder` |
| `yield` YT balance | 1-year rolling | `yield::bump_holder` ✅ new |
| `Sr` SR balance | 1-year rolling | `Sr::bump_holder` ✅ new |
| `srmarket` LP shares | expiry-aware | `SrMarket::bump_lp` ✅ new |

PT needs nothing — it is a classic Stellar Asset Contract, so its balances are trustlines in the
classic ledger and are not subject to archival.

### Test added

`tofix_30_every_holder_entry_has_a_permissionless_keep_alive` calls all three against a real holder
and asserts SR, YT, PT and LP-share balances are all unchanged, then calls them against an address
holding nothing and asserts no entry is created.

**Still to define:** the application's keep-alive *policy* — when the frontend actually calls these.
The mechanism exists and is reachable; nothing schedules it yet.

---

## 10. Add the complete `srvault` interface to the SDK — ✅ DONE

### What was wrong

The fixed-rate vault was deployed and seeded on testnet with no supported client surface at all — no deposit, quote, receipt read, redemption, stats or harvest. The product existed on chain and was unreachable from the app.

### What was done

A typed client in `frontend/src/lib/srstack.ts`, written against the **post-§5** receipt shape so it does not need revisiting:

| Export | Purpose |
|---|---|
| `getVaultStats()` | inventory, liability, capacity, **`totalCollected`** |
| `quoteVaultDeposit(usdc)` | `(payout, coupon, rateBps)` before committing |
| `vaultDeposit(wallet, usdc)` | open a receipt |
| `getVaultReceipt(id)` | full receipt including **`collected`** |
| `vaultRedeemRemaining(id)` | what a receipt still needs — `0n` when ready |
| `vaultRedeem(wallet, id)` | redeem; **may be partial**, documented as such |
| `vaultHarvest(wallet)` | permissionless upkeep |
| `bumpVaultReceipt(wallet, id)` | TTL keep-alive |
| `getVaultSurplus()` | what an admin sweep would release |
| `SR_VAULT_AVAILABLE` | deployment guard, matching the rest of the module |

Every read is failure-tolerant (returns `null`/`0n` rather than throwing) to match the existing module's conventions. `tsc --noEmit` passes.

The resumable-redeem surface is the part that matters for the UI: after `vaultRedeem`, check `vaultRedeemRemaining` — a non-zero result means the venue was short and the user should return later, with their progress already safe.

**Still to define:** the application's *policy* — when the UI prompts a user to complete a partial redemption, and when it calls the TTL bumps. The surface exists; the scheduling does not.

---

## 11. Repair the documented pnpm test command — ✅ DONE

### What was wrong

The SDK's tests pass when Vitest is invoked directly, but the documented command fails before tests begin:

```text
pnpm run test:unit
-> [ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.21.5, esbuild@0.27.7
-> [ERROR] Command failed with exit code 1: pnpm install
```

A direct `npx vitest run …` passes all 218 tests, so the problem is the package-manager entry path, not the suite.

### The fix — applied

**Not** `pnpm.onlyBuiltDependencies` in `sdk/package.json`. That was tried and does not work; pnpm
11.9.0 rejects it outright:

```
[WARN] The "pnpm" field in package.json is no longer read by pnpm.
       The following keys were ignored: "pnpm.onlyBuiltDependencies".
```

The setting lives in `sdk/pnpm-workspace.yaml`, which already had a stub with an **unfilled
placeholder**:

```yaml
allowBuilds:
  esbuild: set this to true or false
```

Completed to:

```yaml
allowBuilds:
  esbuild: true
```

Verified: `pnpm run test:unit` now runs and passes **15 test files / 218 tests** through the
documented command.

---

## 12. Calibrate the redemption-liquidity haircut — 🟡 code fixed, number still open

### What was wrong — and it was worse than "an unmeasured guess"

`available_liquidity()` reported Blend's raw token balance, and `Sr::max_redeemable` took a flat 1% off it. Measured against the live testnet pool:

```
total supplied     128,939.10 USDC
total borrowed      90,708.92 USDC
utilization             70.35%   (max_util 95%)

raw pool balance    38,356.88 USDC   <- what available_liquidity() reported
true max withdrawal 33,456.03 USDC   <- supplied - borrowed/max_util
max_redeemable()    37,973.31 USDC   <- balance - 1%
```

**Overstated by 4,517 USDC — wrong in the dangerous direction.** A user told 37,973 was safely withdrawable would have had the transaction revert. And no fixed percentage can fix it: the gap is ~0 at low utilization and unbounded as utilization approaches the cap.

`srvault`'s resumable-redeem tests hit this directly — a withdrawal sized against the estimate still reverted with Blend's `#1207`, because the pool was at its ceiling.

### What was done

`available_liquidity()` now computes the binding constraint instead of guessing it:

```rust
let util_cap = supplied - borrowed / max_util;   // in Blend's 1e7 fixed point
if util_cap < balance { util_cap } else { balance }
```

Every input comes from the `get_reserve()` call the strategy already makes for `b_rate` — `config.max_util`, `data.b_supply`, `data.b_rate`, `data.d_supply`, `data.d_rate`. No new dependency.

### What is left — the number

`LIQUIDITY_HAIRCUT_BPS` is still 100 (1%). With the utilization cap computed rather than approximated, it no longer has to carry that error and should become a small rounding buffer. Choosing its new value is the remaining decision, and it wants one measurement: sweep the gap between the computed cap and what Blend actually accepts, across utilization levels, and size the buffer to the residual.

---

## 13. Calibrate the Blend utilization alert

### What is wrong

The watchtower warns above 85% utilization. Its first live testnet run observed 85.4% and warned immediately. It is not yet known whether 85% is a genuine danger zone or normal operation for this venue.

### How to address it

Alarm on `available_liquidity() / total_assets()` — a coverage ratio — rather than on raw utilization. Choose warning and critical levels for that ratio. A multi-stage alert is likely more useful than one threshold, but its numbers must come from measurement rather than convenience.

Illustrative only:

```text
Below 85%: healthy
85%-90%:   warning
Above 90%: critical
```

This work shares its measurement with §12 — both need the same "what will Blend actually pay at utilization X" data.

### Why it must be done

A threshold that is always active causes alert fatigue. Raising it without measuring the true liquidity danger point could instead hide an approaching redemption freeze.

### Acceptance criteria

- The selected threshold is tied to measured withdrawal headroom.
- Normal operation is not permanently alarming unless it is genuinely unsafe.
- Warning and critical messages explain the expected operator response.

---

## 14. Calibrate the market's `scalar_root`

**Unblocked 2026-08-26** — §2 is fixed, so the curve's sensitivity is now measurable. This is the remaining work.

### What is wrong

`scalar_root` controls how strongly trades move the market's implied yield. The live testnet value is **40** (SCALAR_12), alongside `ln_fee_root` 0.0025 and a 2,000 bps treasury fee share.

Whether that value is right was **unmeasurable** until §2 was fixed: `implied_apy()` and `pt_price()` did not move in response to trading, so the observable sensitivity of the curve was zero at every trade size.

With the anchor fixed there is now a signal. First measurements at `scalar_root = 40` on a 500,000/500,000 pool, one year to expiry:

| buy, as % of the SR side | implied APY | move |
|---:|---:|---:|
| — | 5.0000% | — |
| 1% | 4.9436% | −5.6 bps |
| 5% | 4.7185% | −28.2 bps |
| 25% | 3.5810% | −142 bps |

Whether that is the right sensitivity is the open question — these numbers are the input to the decision, not the decision.

### Correction to the previous draft

The earlier version of this item cited a measurement of 4.990% → 4.406% after a single 2,000 USDC buy, persisting at 4.361% six months later, and attributed the persistence to a fixed anchor that never re-anchors.

**That measurement is from the v1 market**, `contracts/market/src/test.rs`, which is a different contract with a different curve implementation and a PT/USDC pool rather than PT/SR. v1 does pin `rate_anchor` at par forever; `srmarket` was written specifically to re-derive it. Those numbers say nothing about `srmarket` and must not be used to size its `scalar_root`.

### How to address it — now possible

Choose `scalar_root` against:

- Expected seed liquidity.
- Typical and large trade sizes.
- Expected balance of PT and YT flow.
- Maximum acceptable quote movement per trade.
- How far the market rate may reasonably diverge from the vault rate.

Then re-run the sensitivity measurement on `srmarket` itself — buy and sell sweeps across sizes, at several times to expiry — and select the deployment value from that data.

### Why it must be done

If the curve is too sensitive, moderate trades cause large rate changes. If it is too insensitive, pricing responds too slowly and more liquidity is needed to reflect demand. Neither can be judged until the reported rate reflects reality.

---

## Recommended implementation order

**Done 2026-08-26** — §2 anchor fix · §3 zero-share guard · §4 `min_shares` · §5 resumable redeem · §6 surplus sweep · §7 monitors runnable (plus the v1 vault-probe correction) · §8 counterfeit burned · §9 TTL keep-alive · §10 `srvault` SDK · §11 pnpm command · §12's code half. Also: the `sr` mock made faithful, and `RiskDisclosure.tsx` corrected.

**Remaining — three decisions and a deploy:**

1. **Approve and apply the deposit cap (§1).** Now that its description is right, the question is concrete: how much uncompensated depositor loss, with recovery gated on your key, is acceptable.
2. **Review the `min_shares` design decision in §4** — keep the 0.1% band as the `min_shares == 0` default, or drop it entirely. One line either way, easier settled before deploying.
3. **Measure and set the residual haircut (§12) and the coverage-ratio thresholds (§13).** One measurement exercise covers both.
4. **Re-measure and approve `scalar_root` (§14)**, now that the quote responds to flow.
5. **Define the two policies the mechanisms are waiting on** — when the app prompts a user to finish a partial redemption, and when it calls the TTL bumps.
6. **Redeploy.** `add_liquidity` is a four-argument function, `Receipt` has a new field, and `available_liquidity` computes differently. None of this round's contract work is live until the v2 stack is upgraded — and note the `sr` ↔ `strategy` dependency: `Sr::max_redeemable` and `srvault::redeem` both rely on the new `available_liquidity`, so **`strategy` must be upgraded in the same cycle**, not after.

## Definition of done for the v2 work

| | Criterion | Status |
|---|---|---|
| ✅ | All contract fixes have regression tests that reproduce the old defect and prove the new behaviour | 509 Rust tests green |
| ✅ | The full Rust and SDK suites pass using documented commands | incl. `pnpm run test:unit` |
| ✅ | Release WASM builds cleanly | zero warnings after a forced rebuild |
| ✅ | Monitoring starts from a clean checkout and reports a healthy baseline | both monitors; all six invariants holding |
| ✅ | The SDK exposes the complete supported vault lifecycle and TTL maintenance paths | §9, §10 |
| ⬜ | Updated contracts are deployed or upgraded through the approved process | **not yet — nothing is on chain** |
| ⬜ | Live code hashes and interfaces match the intended builds | follows the deploy |
| ⬜ | The deposit cap and all calibrated parameters are approved, applied, and read back | §1, §12, §13, §14 |
| ⬜ | Deployment and operations documentation reflects the final interfaces and settings | follows the deploy |
| ⬜ | The two application policies are defined | §5's partial-redeem prompt, §9's bump schedule |

### The criterion that earned its place

**Every test that claims an item is closed must reproduce that item's actual preconditions.** Four tests in this repo failed that bar, and each one hid a live defect:

| Test | How it passed without testing the thing |
|---|---|
| `tofix_26b_*` | added dust to a pool that had never traded, so the flooring never happened |
| `tofix_26c_*` | exercised `remove_liquidity` — a different function |
| `pt_still_converges_to_par_with_a_dynamic_anchor` | advanced only time, never traded |
| `a_guarded_strategy_still_bricks_sr_on_a_rate_dip` | ran against a mock whose `redeem` skipped `current_rate` |

The last one is the worst of the four: its false conclusion reached `tofix.md` #3, this document's §1, and the user-facing risk disclosure before anything caught it. All four are fixed.

## Out of scope

The following findings in `tofix.md` are v1-only and are intentionally not part of this v2 work list:

- Locking the old v1 mainnet PT issuer.
- Repairing v1 market/vault initialization cross-checks.
- Redeploying the v1 wrapper to expose missing monitoring views.

One item that *was* listed here has been done anyway, because it was a one-line script fix and left the v1 watchtower reporting a false negative: the vault probe in `scripts/solvency_monitor.mjs` read `solvency` and `bearer_redeemed` on the vault — neither has ever been a vault function — and now reads `stats()`. See §7.

Note that `tofix.md` also records a systemic v1 finding worth carrying as a habit here: **deployed binaries can differ from source, and `version()` cannot detect it.** Verify v2 deployments with `code_hash` and the on-chain interface, never by reading `contracts/`.

The separate launch gates referenced by `tofix.md` — the mainnet parameter profile, the audit decision, and `testcando.md` Appendix B — remain required but are not expanded here.
