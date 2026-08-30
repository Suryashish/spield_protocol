# anyfix.md — workflow testing of the v2 SR stack

**Date:** 2026-08-30. **Scope:** `sr`, `yield`, `srmarket`, `srvault`, `srrouter`, `strategy` —
driven as one system, against real Blend v2 WASM, with no mocks except authorization.

This is a *findings* document, not a plan. Everything below was reproduced in a test that is
committed alongside it. Nothing here is inferred from reading the source alone.

---

## What was done

The existing suites each test one contract with the rest as scenery. They are thorough and green: **346 pass** across the six v2 crates plus `shared`, and **532**
across the whole workspace. What none of them can see is the seams: the vault and the AMM minting PY from the same
engine, against the same SR, backed by the same Blend position — which is exactly the topology
`deploy_mainnet.sh` produces.

So a new test-only crate, **`contracts/e2e`**, stands the whole stack up at once and drives it
through the journeys a live deployment will actually see.

```
cargo test -p spield-e2e              # 52 tests, all pass
cargo test -p spield-e2e -- --ignored # 6 tests, all FAIL — one per finding, by design
```

| File | What it holds |
|---|---|
| `src/harness.rs` | One `World` with all six contracts + Blend + oracle; helpers for time, crunches, seeding |
| `src/workflows.rs` | 20 tests — the user journeys, end to end |
| `src/adversarial.rs` | 16 tests — donations, griefing, dust, slippage, auth, cross-series isolation |
| `src/invariants.rs` | 16 invariants + 6 defect reproductions |

Each finding appears **twice** in `invariants.rs`:

* an `#[ignore]`d test asserting the **correct** behaviour — it fails today, and it is supposed to;
  it is the reproduction and the acceptance test for the fix, and
* a live **characterization** test pinning what the code does **now**, so the behaviour cannot
  silently drift while the fix is pending. When you fix the defect, the characterization test fails
  — that is the signal to delete the pair and keep the plain invariant.

---

## Findings

| # | Severity | Where | One line |
|---|---|---|---|
| **F1** | **High** | `sr::max_redeemable` / `redeem_partial` | The clamped-exit path reverts, because it sizes the clamp with the stale stored rate |
| **F1b** | **High** | `sr::max_redeemable` | Reports `i128::MAX` — "no constraint" — while a full exit reverts |
| **F2** | **High** | `srvault::redeem` | `REDEEM_DUST` is reserved per *receipt* but spent per *leg*; the third partial leg reverts with `SolvencyViolation` |
| **F3** | Medium | `sr::deposit_headroom` | Depositing exactly the advertised headroom always reverts |
| **F4** | Medium | `sr::deposit` | The cap counts accrued yield as new exposure — the code does the opposite of the comment above it |
| **F5** | Medium | `yield::stamp_expiry_index` | A matured YT keeps earning until somebody happens to touch the contract; nobody is paid to do it |

---

### F1 — `redeem_partial`, the exit of last resort, reverts under a stale rate — **High**

`Sr::exchange_rate()` is a pure read of the stored high-water mark. That is deliberate and correct:
making it call the strategy caused the intermittent `storage: exceeded_limit` footprint failure
documented on the function. Only mutating paths call `sync_rate`.

`max_redeemable()` is a **view**, so it reads that stale rate — and then *divides* available
underlying by it to get shares:

```rust
let rate = storage::rate_high_water(&env);           // stale: only ever lags
math::underlying_to_shares(&env, usable, rate)       // usable * SCALAR / rate
```

A stale rate is always **lower** than the live one, so the division returns **more** shares than the
venue can pay for. `redeem_partial` clamps to that number, burns it, and asks the strategy for
`shares × live_rate` underlying — more than `usable` — and Blend refuses (`#1207`).

`redeem_partial` exists precisely so that "a crunch costs the user extra transactions rather than
the whole exit." Under a stale rate it does not clamp far enough and reverts, which is the failure
it was written to prevent. And the stale state is the **default** for any read-only caller.

**Measured** (`f1_characterize_stale_rate_overstates_max_redeemable`), 30 days unsynced:

| | rate | `max_redeemable` |
|---|---|---|
| stale | `1.000000000000` | 408,434,317,131 |
| live | `1.078706375022` | 378,633,450,759 |
| | | **overstated by 787 bps** |

Calling `Sr::sync_rate()` first makes the same call succeed — burning 378,633,450,759 shares for
408,434,317,130 USDC. That single difference is the whole proof of cause.

**How stale before it breaks** (`probe`-derived, pinned in the reproduction):

| unsynced for | `redeem_partial` |
|---|---|
| 0 days | ok |
| 1 day | ok |
| 7 days | ok |
| **30 days** | **reverts** |

The 1–7 day cases survive only because `LIQUIDITY_HAIRCUT_BPS` is 1% and absorbs the drift. That
haircut is documented as covering *"Blend also refuses withdrawals that would push utilization past
its ceiling, and its own accounting rounds"* — but in practice it is being spent on staleness, so
**the margin intended for the venue's own behaviour is already gone** by the time drift reaches 1%.

**The vault path is immune, and it is worth knowing why.** `SrVault::redeem` composes
`sr.preview_redeem(sr.max_redeemable())` — underlying → shares → underlying — and the two staleness
errors cancel exactly. Verified. So this is specifically a problem for callers that consume
`max_redeemable` **in shares**: `redeem_partial`, and any dApp that shows it.

**Fix direction.** Either make `max_redeemable` sync (it is already the case that
`redeem_partial` writes, so the footprint argument that forced `exchange_rate` to be pure does not
apply to the mutating path), or have `redeem_partial` re-clamp against the live rate after
`live_rate()` has run. Leaving the view stale and fixing only the mutating path also fixes F1b's
practical impact, but the number a UI reads would still be wrong.

*Tests:* `f1_redeem_partial_makes_progress_even_when_the_stored_rate_is_stale` (ignored),
`f1_characterize_stale_rate_overstates_max_redeemable`.

---

### F1b — `max_redeemable` says "unbounded" while the exit reverts — **High**

Same root cause, sharper shape. The short circuit:

```rust
if avail >= Self::total_assets(env.clone()) {
    return i128::MAX;            // "no crunch at all"
}
```

Both sides use the stale rate. When `stale_assets <= avail < live_assets`, this returns `i128::MAX`
— which callers are told means *no constraint whatsoever* — and the full redeem reverts.

**Reproduced** (`f1b_characterize_unbounded_cap_while_the_exit_reverts`):

```
avail          = 2,010,000,000,000
stale_assets   = 2,000,000,000,000      <- avail is above this
live_assets    = 2,787,064,959,806      <- and below this
max_redeemable = i128::MAX              ("withdraw anything")
full redeem    = reverts
```

The width of the bad band is exactly the accrued drift, so any real drift opens a real band. A UI
showing "you can withdraw your whole position" and then failing is the worst version of this bug,
because the user has no smaller number to fall back to.

*Tests:* `f1b_an_unbounded_max_redeemable_means_a_full_exit_actually_clears` (ignored),
`f1b_characterize_unbounded_cap_while_the_exit_reverts`.

---

### F2 — a vault receipt cannot take a third partial leg — **High**

`REDEEM_DUST` is **2 stroops per receipt**, and its doc explains it as covering the double flooring
of the *closing* leg (`payout → SR → USDC`). But every **partial** leg floors too. A partial leg
burns `take` PT face and banks `got ≤ take` USDC, so

```
pt_inventory + total_collected      <- the exact left-hand side of assert_solvent
```

falls by about one stroop **per leg**. The reserve does not grow with the leg count.

After a `sweep` — which the contract itself permits down to `uncollected + open_receipts × 2` — the
slack is exactly 2. Two partial legs spend it. The third reverts with **`SolvencyViolation` (#24)**.

**Reproduced through the natural operator sequence**, no contrived state
(`f2_characterize_the_third_partial_leg_reverts`): seed the vault, two savers deposit, the series
matures, one saver redeems, the admin recovers exactly what `coupon_capacity` reports as free, and
the straggler meets a crunch.

```
after sweep: pt_inventory = 501,232,876,714   total_liability = 501,232,876,712   capacity = 0
  leg 0: inv=1,002,465,753,426  rem=1,002,465,753,424   ok      <- slack 2
  leg 1:   inv=680,256,244,340    rem=680,256,244,339   ok      <- slack 1
  leg 2:   inv=647,334,149,249    rem=647,334,149,249   Error(Contract, #24)
final: open=true  collected=355,131,604,175  paid_to_holder=0  promised=1,002,465,753,424
```

The holder has 35,513 USDC of their own money banked inside the vault, 64,733 PT of backing sitting
in inventory, and **nothing in their wallet**.

**It is not permanent — but it is a regression to the behaviour `tofix.md` #20 says was fixed.**
Once the venue can pay the *entire* remainder in a single call, the receipt closes normally
(verified). So after the buffer is spent, the receipt is back to all-or-nothing on the remainder,
which is the exact failure `redeem`'s partial path was built to eliminate.

**The admin cannot help.** `seed` is the only way to add PT inventory, and it routes through
`mint_py`, which is refused at/after expiry — while a stuck receipt is by definition post-maturity.
Verified in `f2_seed_is_refused_after_expiry_so_the_admin_cannot_add_capacity`.

**Fix direction.** Three options, smallest first:

1. Give `assert_solvent` a bounded slack the way the yield engine already does
   (`spield-yield`'s `SOLVENCY_SLACK = 10`). `srvault::assert_solvent` has **no** slack at all,
   which is the asymmetry that makes this bite. Cheap, but only buys ~10 legs.
2. Track the cumulative flooring residue in its own storage field and exclude it from the invariant.
   Exact, and it makes the leak visible rather than absorbed.
3. Reserve per-leg: store a leg counter on the `Receipt` and reserve `(legs + 2) × 1`. Correct, but
   it changes the receipt layout.

Whichever is chosen, `sweep`'s reserve formula and `stats().coupon_capacity` must be updated in the
same change — today they both tell the operator that sweeping to a 2-stroop margin is safe, and it
is not.

*Tests:* `f2_a_partially_redeemed_receipt_can_always_take_another_leg` (ignored),
`f2_characterize_the_third_partial_leg_reverts`, `f2_seed_is_refused_after_expiry_...`.

---

### F3 — `deposit_headroom()` is not actionable — Medium

`left.md` §C: *"`sr::deposit_headroom()` exists precisely so a frontend can show 'X USDC of Y
remaining'."* A max button built on it **fails every time**, because the view reads the stored rate
and `deposit` syncs to the live rate before checking the cap.

**Reproduced** (`f3_characterize_headroom_overstates_what_deposit_will_accept`): cap 1,000 USDC,
500 deposited, 30 days elapsed. `deposit_headroom()` returns exactly 500 USDC; depositing 500 USDC
reverts with `DepositCapExceeded (#107)`. Calling `sync_rate()` first lowers the reported headroom
and the deposit then succeeds.

This is low-stakes in absolute terms — the overshoot is the accrued drift, ~0.2 USDC on 500 over
30 days — but it is the **normal** case, not an edge one, and on the guarded launch (50 USDC cap,
~10 USDC of user headroom) it is the difference between the UI working and not.

**Fix direction.** Either have `deposit_headroom` be honest about the direction of its own error
(the same `sync_rate`-or-not decision as F1), or document that a caller must pad down, and have the
dApp subtract a margin. The second is free; the first is correct.

*Tests:* `f3_a_deposit_of_exactly_the_advertised_headroom_succeeds` (ignored),
`f3_characterize_headroom_overstates_what_deposit_will_accept`.

---

### F4 — the deposit cap counts yield as new exposure, contradicting its own comment — Medium

From `sr::deposit`:

> *Growth from yield is deliberately **NOT** counted as new exposure: it is the users' own return,
> and letting it consume headroom would slowly close deposits on a healthy protocol.*

The line directly beneath it:

```rust
let principal_after = math::shares_to_underlying(&env, tok::total_supply(&env), rate) + amount;
```

`rate` is the live rate, so this is total supply **valued at today's rate** — which is precisely the
growth the comment says is excluded. Headroom does shrink on a protocol where nothing has happened
but time.

**Measured** (`f4_characterize_yield_consumes_headroom`), cap 1,000 USDC with 900 deposited:

| elapsed | headroom | `total_assets` |
|---|---|---|
| 0 | 100.0000000 | 900.0000000 |
| 15d | 99.0045957 | 900.9954043 |
| 45d | 97.0137869 | 902.9862131 |
| 90d | **94.0275738** | 905.9724262 |

**~66 bps of TVL over 90 days** at this fixture's Blend rate — 6% of the *headroom* in the example.

This is not dangerous; it is a documentation/behaviour contradiction with a real operational effect
that grows with the cap. Someone reading the comment while sizing the launch will get the arithmetic
in `left.md` §C wrong by the accrued yield. Either the code should measure cost basis (track
deposited principal), or the comment should be deleted and `left.md` §C should say that headroom
decays.

*Tests:* `f4_headroom_does_not_shrink_just_because_yield_accrued` (ignored),
`f4_characterize_yield_consumes_headroom`.

---

### F5 — a matured YT keeps earning until somebody stamps the index — Medium

`spield-yield`'s module docs:

> *The index freezes at the first post-expiry observation, so a matured YT earns nothing more.*

The freeze happens on the first post-expiry **touch**, not at expiry. `stamp_expiry_index` is
permissionless and there is nothing that makes anyone call it. So a matured YT keeps earning for as
long as the contract is left alone, and the size of a YT holder's payout is decided by who happens
to touch the contract first.

**Measured** (`f5_characterize_a_late_stamp_multiplies_the_yt_claim`), identical 30-day series,
10,000 USDC of face, only the stamp time varying:

| index stamped | frozen index | YT claim |
|---|---|---|
| at expiry | 1.002141538134 | 21.3696174 USDC |
| +30 days | 1.004283075443 | 42.6480894 USDC — **2.0x** |
| +180 days | 1.014990761987 | 147.6935805 USDC — **6.9x** |

Where the extra comes from: after expiry the contract's SR keeps appreciating, but PT is owed only
face. Higher index ⇒ *less* SR needed to cover PT ⇒ more shares freed ⇒ all of it credited to YT.
So the post-expiry yield on the **whole** pot, including the part backing PT, goes to YT holders.

**Not a solvency problem.** PT still redeems at face; the engine's invariant holds throughout
(`a5_sweeping_can_never_take_pt_backing_or_an_unsettled_claim`, `i1`). And the vault is a YT holder
itself, so it benefits rather than suffers.

**It is a fairness and predictability problem, and it is adversarially exploitable.** A YT holder is
directly incentivised to be the last person to touch the contract. On a quiet series — which is
exactly what a guarded launch produces — waiting is free and pays 7x. It also makes `sweepable`
smaller, so the treasury is the party that funds it.

**Fix direction.** Either make the freeze happen *at* the expiry timestamp rather than at first
observation — cap the index used post-expiry to what a rate model says it was at expiry, which Blend
cannot supply, so this is genuinely hard — or accept it and (a) fix the module doc, and (b) have the
watchtower call `stamp_expiry_index` the moment a series expires, which is one line in
`sr_solvency_monitor.mjs` and turns an unbounded race into a bounded one.

*Tests:* `f5_a_matured_yt_earns_the_same_however_late_the_index_is_stamped` (ignored),
`f5_characterize_a_late_stamp_multiplies_the_yt_claim`.

---

## What was attacked and held

These are the things worth recording as *not* broken, because each was a real attempt.

| Attempt | Result |
|---|---|
| Donate SR to the market to move price, mint shares, or extract it later | Reserves are bookkeeping, not balance reads. Price, rate and LP shares all unmoved; the donation is stranded (`a1`) |
| Donate to a 1-USDC pool to round the next LP to zero shares | The next LP still gets real shares and a full exit (`a2`) |
| Donate raw USDC to the vault to manufacture coupon capacity | Capacity is PT face; USDC does not register (`a3`) |
| Leave a donation on the router and trade through it | The router refuses to trade rather than spend it; `sweep` recovers it and trading resumes (`a4`) |
| `sweep_surplus` on the engine to reach PT backing or an unsettled YT claim | Both survive; solvency holds (`a5`) |
| Trigger somebody else's yield claim and redirect it | Permissionless to trigger, holder-signed to redirect (`a6`) |
| Burn YT to release principal backing | Abandons the claim only; backing and PT untouched; pre-burn yield still paid (`a7`) |
| Mint PT as anyone but the engine | Refused, with the attacker signing properly rather than `mock_all_auths` hiding it (`a14`) |
| Reach across two series sharing one SR | Each engine refuses the other's PT (`a13`) |
| Zero / negative / one-stroop amounts on every entry point | Refused without taking money (`a8`, `a9`) |
| Beat a slippage bound or a past deadline | Both honoured; over-authorized SR refunded exactly (`a10`, `a11`) |
| Admin functions as a stranger who signs correctly | Refused on `sr`, `srvault`, `yield`, `srmarket`; `seed` and `sweep` admin-gated (`a12`, `a12b`, `a12c`) |
| Make AMM flow move a vault payout | 8 rounds of two-sided flow + YT trades; the receipt paid to the stroop (`w5`) |
| Trap funds by pausing all five contracts | Every entry closed, every exit open, nothing trapped (`w8c`) |
| Find unaccounted value in the market after mixed trading | `pt_balance == pt_reserve`, `sr_balance == sr_reserve`, YT held = 0 (`i2`) |
| Find value stranded in a settled vault | `sweep` + `sweep_surplus` empties it completely (`i4`) |
| Break a vault that is never harvested | All five receipts paid in full; the yield stays claimable (`i5`) |

**Conservation** (`i1`): across a 60-day term with the vault, AMM, router and engine all in play,
users put in 11,000 USDC and took out 11,029.86 — the difference is Blend yield, and the engine
ended solvent.

**The market's quoted rate responds to flow** — `tofix.md` #34 really is fixed, and it is symmetric:

```
seeded          50.00%
after 5 buys    21.12%
after 5 sells   49.77%   (the 23 bps gap is retained fee, correctly)
```

---

## Two observations, not defects

**Trading YT costs ~25% of the YT price per round trip.** Measured 36.97 USDC lost on a 150.43 USDC
purchase of 10,000 USDC of YT notional. That is **37 bps of notional** — entirely reasonable next to
PT's 24 bps — but YT's price is ~1.5% of its notional, so the same fee is a quarter of what the user
paid. This is inherent to pricing YT off PT notional (Pendle has it too), and it is correct. It is
also a number a first-time YT buyer will not expect, and the UI should show it before the trade, not
after. Pinned in `i7`.

**`left.md` E4 does not reproduce on a fresh deploy.** Initializing the market at the vault's rate
opens it at 299 bps against the vault's 300 — the divergence is a testnet liquidity artifact, and a
clean mainnet deploy will not have it, as `left.md` already predicts.

---

## Suggested order

1. **F1 + F1b together** — one root cause, and it is the exit path during the failure mode the whole
   partial-redemption design exists for. It is also the only finding a *user* can hit with no
   operator involvement.
2. **F2** — reachable through the documented seed-recovery operation, with no way for the admin to
   undo it. Fix `assert_solvent`'s slack, `sweep`'s reserve, and `coupon_capacity` in one change.
3. **F5's cheap half** — have the watchtower stamp the index at expiry. One line, and it bounds the
   race immediately, whether or not the harder fix ever happens.
4. **F3 and F4** — both are one decision each (sync or document), and both are cosmetic next to the
   above. F4 also needs a correction to `left.md` §C's arithmetic.

---

## Running it

```bash
cargo test -p spield-e2e                 # 52 pass — workflows, adversarial, invariants
cargo test -p spield-e2e -- --ignored    # 6 FAIL — one reproduction per finding
cargo test --workspace                   # 584 pass, 6 ignored (532 pre-existing + 52 new)
```

The crate is registered in the workspace `Cargo.toml` and depends on the six contracts as
dev-dependencies only. It registers no contract of its own and ships nothing.
