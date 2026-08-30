# anyfix.md — workflow testing of the v2 SR stack

**Date:** 2026-08-30. **Scope:** `sr`, `yield`, `srmarket`, `srvault`, `srrouter`, `strategy` —
driven as one system, against real Blend v2 WASM, with no mocks except authorization.

This is a *findings* document, not a plan. Everything below was reproduced in a test that is
committed alongside it. Nothing here is inferred from reading the source alone.

---

## What was done

The existing suites each test one contract with the rest as scenery. They are thorough and green —
**532 pass** across the workspace before any of this. What none of them can see is the seams: the vault and the AMM minting PY from the same
engine, against the same SR, backed by the same Blend position — which is exactly the topology
`deploy_mainnet.sh` produces.

So a new test-only crate, **`contracts/e2e`**, stands the whole stack up at once and drives it
through the journeys a live deployment will actually see.

```
cargo test -p spield-e2e   # 59 pass, 1 ignored
cargo test --workspace     # 591 pass, 1 ignored
```

| File | What it holds |
|---|---|
| `src/harness.rs` | One `World` with all six contracts + Blend + oracle; helpers for time, crunches, seeding |
| `src/workflows.rs` | 20 tests — the user journeys, end to end |
| `src/adversarial.rs` | 16 tests — donations, griefing, dust, slippage, auth, cross-series isolation |
| `src/invariants.rs` | 9 general invariants, plus the tests for each finding |

The finding tests in `invariants.rs` are named `f1_`…`f5_`, and each asserts the property its fix was
supposed to establish **in the scenario that used to break it** — not a narrower one. The single
`#[ignore]`d test is F5's: it asserts what an on-chain fix would have to satisfy, which the keeper
mitigation does not provide, and it is kept failing on purpose as the standing record of that
residual.

---

## Findings

| # | Severity | Where | One line | Status |
|---|---|---|---|---|
| **F1** | **High** | `sr::max_redeemable` / `redeem_partial` | The clamped-exit path reverted, because it sized the clamp with the stale stored rate | **Fixed** |
| **F1b** | **High** | `sr::max_redeemable` | Reported `i128::MAX` — "no constraint" — while a full exit reverted | **Fixed** |
| **F2** | **High** | `srvault::redeem` | `REDEEM_DUST` was reserved per *receipt* but spent per *leg*; the third partial leg reverted with `SolvencyViolation` | **Fixed** |
| **F3** | Medium | `sr::deposit_headroom` | Depositing exactly the advertised headroom always reverted | **Fixed** |
| **F4** | Medium | `sr::deposit` | The cap counted accrued yield as new exposure — the code did the opposite of the comment above it | **Fixed** |
| **F5** | Medium | `yield::stamp_expiry_index` | A matured YT keeps earning until somebody happens to touch the contract | **Mitigated off chain** — see below |

Each section below states the defect, the evidence, and what changed.

---

### F1 — `redeem_partial`, the exit of last resort, reverted under a stale rate — **High** — ✅ fixed

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

#### The fix

`max_redeemable` now calls `sync_rate()` before it does anything, and uses that rate for both the
division and the `avail >= total_assets` comparison.

```rust
// contracts/sr/src/lib.rs
let rate = Self::sync_rate(env.clone());
let avail = strategy.available_liquidity();
```

`exchange_rate()` stays a pure read — nothing about the footprint argument changes, because it is
`sync_rate` that is being called, and `sync_rate` **always writes**. That is the property the whole
`exceeded_limit` fix rests on: the footprint becomes a function of the call graph alone, not of how
much time passed between simulation and execution. `strategy::current_rate` writes its `RateBound`
unconditionally for exactly the same reason, so the chain is deterministic end to end.

**`max_redeemable` is therefore a mutating call now.** Three consequences, all checked:

* **The frontend is unaffected.** `readContract` in `frontend/src/lib/soroban.ts` uses
  `simulateTransaction`, so it gets the corrected number and submits nothing.
* **The vault is still correct.** `SrVault::redeem` composes `preview_redeem(max_redeemable())`; both
  halves are now live rather than both stale, so they still agree — and now they are right rather
  than merely consistent.
* **The deploy scripts' `compat` probe now submits.** `read_view` uses `stellar contract invoke`,
  which submits when simulation shows a write. It costs one small fee and only ratchets a floor
  upward. Both deploy scripts carry a note at that line.

*Tests:* `f1_redeem_partial_makes_progress_even_when_the_stored_rate_is_stale`,
`f1_max_redeemable_is_actionable_after_arbitrary_drift` (0 / 1 / 7 / 30 / 90 days of drift, each
redeeming exactly the advertised cap), `f1_max_redeemable_is_stable_once_synced`.

---

### F1b — `max_redeemable` said "unbounded" while the exit reverted — **High** — ✅ fixed

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

#### The fix

The same one line. With the rate synced first, both sides of the comparison are live, the band
closes, and the short circuit only fires when the venue genuinely can cover everything.

*Test:* `f1b_an_unbounded_max_redeemable_means_a_full_exit_actually_clears` — it aims the venue's
free liquidity into the old bad band deliberately, and asserts that an unbounded answer is followed
by an exit that clears.

---

### F2 — a vault receipt could not take a third partial leg — **High** — ✅ fixed

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

#### The fix — track the residue, and reserve for it

Two halves, because the defect had two.

**1. The loss is recorded rather than absorbed.** `Receipt` gains a `residue` field and the vault a
`TotalResidue` total. Every partial leg adds what the flooring actually cost:

```rust
// contracts/srvault/src/lib.rs — the partial branch of `redeem`
let leg_residue = to_burn - banked;
if leg_residue > 0 {
    r.residue += leg_residue;
    storage::set_total_residue(&env, storage::total_residue(&env) + leg_residue);
}
```

and `assert_solvent` counts it as the expected rounding it is:

```rust
pt_inventory + total_collected + total_residue  >=  total_liability
```

It is **per receipt**, not a permanent global figure, so it is released when the receipt closes and
the invariant tightens straight back up. A global counter would have loosened the check for the life
of the contract.

**2. The reserve now covers partial legs, so `sweep` and `coupon_capacity` stop lying.**
`REDEEM_DUST` keeps its meaning — the closing leg's double floor — and a new
`PARTIAL_LEG_BUDGET = 64` covers the partial ones:

```rust
const RECEIPT_RESERVE: i128 = REDEEM_DUST + PARTIAL_LEG_BUDGET;   // 2 + 64
```

used by all three places that had to agree and did not: `deposit`'s capacity gate, `sweep`'s
reserve, and `stats().coupon_capacity`. 64 stroops is 6.4e-6 USDC and covers at least 32 partial
legs — far beyond any crunch a holder would sit through — so the operator's dashboard figure is now
the real edge rather than an optimistic one.

`stats()` also gains `total_residue`, so the rounding is visible on the dashboard instead of being
inferred from a discrepancy.

*Tests:* `f2_a_partially_redeemed_receipt_can_always_take_another_leg` (drives the same natural
operator sequence to completion and asserts it takes more than the old two-leg margin),
`f2_residue_is_recorded_then_released_with_the_receipt`,
`f2_residue_stays_within_the_reserved_budget`,
`f2_sweeping_all_reported_capacity_leaves_receipts_redeemable` (sweeps exactly what the dashboard
reports as free, checks a stroop more is refused, then redeems the receipt to the last stroop),
`f2_seed_is_refused_after_expiry_so_the_admin_cannot_add_capacity`.

---

### F3 — `deposit_headroom()` was not actionable — Medium — ✅ fixed

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

#### The fix

`deposit_headroom()` and `deposit`'s cap check now read **the same stored integer**, with no rate in
either — see F4, which is the same change. So they cannot drift by construction, however stale the
rate is or how long the user takes to sign.

*Test:* `f3_a_deposit_of_exactly_the_advertised_headroom_succeeds` — runs at 0, 30 and 180 days of
unsynced drift, deposits exactly the advertised headroom each time, then checks one stroop more is
refused.

---

### F4 — the deposit cap counted yield as new exposure, contradicting its own comment — Medium — ✅ fixed

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

#### The fix — measure cost basis

The cap now measures what was actually deposited, which is what the comment always claimed.
`storage::total_principal` is a plain stored integer:

* `deposit` raises it by exactly `amount`;
* **every** path that destroys shares releases it proportionally, because the accounting lives in
  `burn_internal` — so `redeem`, `redeem_partial` and a bare SEP-41 `burn` all behave the same, and
  burning the last share releases exactly the last of the basis.

```rust
let released = math::mul_div_floor(env, principal, amount, supply_before)?;
```

The cap check and `deposit_headroom` both read it, so both are rate-free and exact.
`total_assets()` is unchanged and still reports the mark-to-market value — it is the dashboard
number and what `max_redeemable` compares against; the two are now deliberately different things,
and both are documented as such.

**`left.md` §C's arithmetic is now correct as written.** `cap = what you seed + what you will let
users deposit` holds exactly, and it no longer decays.

*Tests:* `f4_headroom_does_not_shrink_just_because_yield_accrued` (unchanged over a full year, while
`total_assets()` visibly grows), `f4_every_exit_releases_cost_basis_proportionally`,
`f4_the_cap_still_bounds_everything_it_did_before` (the `left.md` §C worked example, to the stroop:
seed 20 + 20, headroom exactly 10).

---

### F5 — a matured YT keeps earning until somebody stamps the index — Medium — 🟡 mitigated off chain

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

#### Why there is no on-chain fix

A real fix would freeze the index *at* the expiry timestamp. Blend exposes only the current rate with
no historical lookup, so the expiry value cannot be reconstructed after the fact — "the first
post-expiry observation" genuinely is the best a contract can do. That is why this one is mitigated
rather than fixed.

#### The mitigation — the keeper stamps at expiry

**`ttl_keeper.mjs`** now checks `yield::expiry()` and `yield::expiry_index()` on every run and, if
the series is expired and unpinned, queues `stamp_expiry_index()` **first** — ahead of every TTL
bump, so a `--max-calls` budget can never starve it. The call is permissionless and write-once, so
running it twice costs nothing.

**A new `--stamp-only` mode** skips holder discovery entirely, which is the expensive half of a
normal pass. That lets the stamp run on a much tighter schedule than the bumps, which is what it
needs: bumps are cheap to defer for a week, the stamp is not.

**`.github/workflows/spield-keeper.yml` now has two schedules:**

| Schedule | What runs |
|---|---|
| Mon 04:15 UTC | the full pass — TTL bumps for every holder, LP and receipt, plus the stamp |
| **Daily 04:45 UTC** | `--stamp-only`. One simulation on almost every day; one transaction once per series |

That bounds the race to **24 hours** instead of leaving it open. At the measured rate, a day of drift
is a fraction of a percent rather than the 2x a weekly-only schedule would allow on a 30-day series.

**`sr_solvency_monitor.mjs` gained check 7** — an independent alarm for "series expired, index still
unstamped", because the failure is otherwise silent: nothing reverts and no invariant breaks, the
split just drifts. It warns immediately and escalates to a problem after 48 hours, so a keeper that
has quietly stopped running is visible rather than merely costly.

**The module doc in `spield-yield` is corrected.** "A matured YT earns nothing more" was true only
after the stamp, and the code cannot make it true before; the module header now says so, carries the
measured numbers, and points at the two scripts that bound the race.

*Tests:* `f5_a_matured_yt_earns_the_same_however_late_the_index_is_stamped` stays `#[ignore]`d as the
standing record of what an on-chain fix would have to satisfy; `f5_the_size_of_the_stamping_race`
pins the multiples so the exposure cannot quietly grow; `f5_a_prompt_stamp_is_permissionless_and_write_once`
asserts the property the keeper relies on — that a prompt stamp is available to anyone and cannot be
raised afterwards.

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

## What changed

| File | Change |
|---|---|
| `contracts/sr/src/lib.rs` | `max_redeemable` syncs the rate first (F1/F1b); cap and headroom measure `total_principal` (F3/F4); `burn_internal` releases cost basis proportionally |
| `contracts/sr/src/storage.rs` | `TotalPrincipal` |
| `contracts/srvault/src/lib.rs` | residue recorded per leg and counted by `assert_solvent`; `RECEIPT_RESERVE` used by `deposit`, `sweep` and `coupon_capacity` (F2) |
| `contracts/srvault/src/storage.rs` | `Receipt::residue`, `TotalResidue` |
| `scripts/ttl_keeper.mjs` | stamps the expiry index, queued first; `--stamp-only` mode (F5) |
| `scripts/sr_solvency_monitor.mjs` | check 7 — expired series with an unstamped index (F5) |
| `.github/workflows/spield-keeper.yml` | daily `--stamp-only` schedule alongside the weekly full pass (F5) |
| `scripts/deploy_mainnet.sh`, `scripts/deploy_sr_testnet.sh` | note that the `max_redeemable` compat probe now submits |
| `contracts/yield/src/lib.rs` | module doc corrected — the freeze is at first observation, not at expiry (F5) |
| `contracts/e2e/` | the suite, rewritten so each finding's tests assert the fixed property |

**Storage layout changed in two places** — `Sr` gained an instance key and `Receipt` gained a field.
Both are additive and neither stack is deployed yet (`left.md` A2), so nothing needs migrating. The
frontend decodes `SrVaultStats` and `Receipt` field by field, so the additions are transparent to it.

## What is left

1. **Set `STELLAR_KEEPER_SECRET`** if it is not already set, or the daily stamp job cannot submit.
   See "Do I need to run anything?" below.
2. **F5's on-chain residual stands.** The keeper bounds it to a day; it does not remove it. If YT
   ever carries meaningful size, the freeze wants to move on chain, which needs a rate oracle Blend
   does not currently provide.

## Do I need to run anything?

**No script to run by hand, and no new file to create — but one thing to check.**

* **The contract fixes are in the source.** They take effect when the stack is next deployed, which
  for mainnet is `left.md` A2. Nothing to run now.
* **The keeper fix is automatic** *if* the GitHub Actions workflow is live. It already existed and
  already ran weekly; this adds a second daily schedule to the same file. GitHub picks up new `cron`
  entries as soon as the change is on the repository's **default branch** — scheduled workflows only
  run from the default branch, so a change sitting on a feature branch will not fire.
* **The one thing to verify:** `STELLAR_KEEPER_SECRET` must be set under *Settings → Secrets and
  variables → Actions*, funded with a little XLM. The keeper already needed it for the TTL bumps, so
  if those have been running it is set. If it is missing, the stamp job fails loudly rather than
  silently.
* **To check it works right now**, without waiting for 04:45 UTC: Actions → "Spield keeper" → Run
  workflow, tick `stamp_only`, leave `dry_run` ticked. It will print either `nothing to stamp` or
  `series expired Nh ago … stamping first`. Untick `dry_run` to actually submit.
* **Running it outside GitHub** — a cron box, or by hand — is one line:

  ```bash
  node scripts/ttl_keeper.mjs --stamp-only --source <KEY_NAME_OR_SECRET> --dry-run
  ```

## Running it

```bash
cargo test -p spield-e2e                 # workflows, adversarial, invariants
cargo test -p spield-e2e -- --ignored    # F5's on-chain residual — fails by design
cargo test --workspace                   # everything
```

`cargo test -p spield-e2e -- --ignored` runs exactly one test, and it is **supposed to fail**: it is
the standing record of F5's on-chain residual, which the keeper mitigates rather than removes.

The crate is registered in the workspace `Cargo.toml` and depends on the six contracts as
dev-dependencies only. It registers no contract of its own and ships nothing.
