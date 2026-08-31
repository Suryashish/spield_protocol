# DRILLS.md — the §17 operational rehearsals, executed and timed

`testcando.md` §17 lists eight procedures that `MAINNET.md` documents but nobody had ever executed
under pressure, and asks for them to be "rehearsed on testnet with a stopwatch, then write the timing
into the runbook." **This file is that stopwatch.** Every number below was measured on Stellar
testnet on **2026-08-31**, not estimated.

Reproduce with `scripts/drills_testnet.sh` (drills 1, 3, 4, 5, 7, 8), `scripts/rotate_admins.sh`
(drill 2), and two `FRESH=1` deploys (drill 6).

## Where they were run — and where they were NOT

Drills 1 and 5 deliberately break the protocol: they pause every contract and freeze the rate oracle.
Run against the live testnet stack they would take down `app.spield.live` and the SDK's nightly CI.

So **two throwaway stacks were deployed for this**, and the live deployment was never touched:

| | Stack A (seeded) | Stack B (unseeded) |
|---|---|---|
| SR | `CCB3B2ISUKRIP3STJOTQGQEKOJGYTDTK76AXJQKDG6QU2MXZCD3SAZ4S` | `CC4HYPRMXBC24MBC2B4BDVMKJE64MF2B6JFWP7OYF3DD4NPN65BWC4S7` |
| Vault seed / pool seed | 2 USDC / 2 USDC per side | none — this is the empty-state fixture |
| Used for | drills 1, 3, 4, 5, 8 | drills 2, 6, 7 |

`drills_testnet.sh` refuses to run against `deploy_sr_testnet.state` unless `I_MEAN_IT=1`.

## Results

**8 of 8 drills executed. 0 failures.** One drill (7) is partly blocked by something that does not
exist yet; see its row.

| # | Drill | Result | Measured |
|---|---|---|---|
| 1 | `emergency_pause_drill` | ✅ **17 checks, 0 failed** | **pause all five: 50s** · unpause: 46s |
| 2 | `multisig_rotation_dress_rehearsal` | ✅ **27 checks, 0 failed** | **full six-contract rotation: 108s** |
| 3 | `upgrade_drill_with_live_positions` | ✅ **full path run** | early apply refused · **apply after eta: 7s** (after a 3600s wait) |
| 4 | `cancel_a_scheduled_upgrade` | ✅ 4 checks, 0 failed | **schedule → notice → cancel: 18s** |
| 5 | `set_max_apr_bps_unstick_drill` | ✅ 6 checks, 0 failed | **freeze → one admin call → recovered: 10s** |
| 6 | `deploy_script_fresh_run_repro` | ✅ PASS | two independent FRESH runs |
| 7 | `frontend_against_unseeded_and_seeded` | ✅ 14 views · 🟠 mainnet half not runnable | — |
| 8 | `ttl_upkeep_cron_rehearsal` | ✅ 3 checks, 0 failed | **bump sweep (3 entries): 30s** |

---

## 1. Emergency pause — the number to remember is 50 seconds

From "we suspect a problem" to all five pausable contracts stopped: **50 seconds**, sequential, one
transaction each (`sr`, `yield`, `srmarket`, `srvault`, `srrouter` — `strategy` has no pause and
needs none). Unpausing took 46s.

The half that actually matters is what stays open. Verified **while paused**:

| Inflows — must be blocked | Exits — must still work |
|---|---|
| ✅ `sr.deposit` refused | ✅ `sr.redeem` works |
| ✅ `srvault.deposit` refused | ✅ `yield.redeem_due_interest` works |
| ✅ `srmarket.add_liquidity` refused | ✅ `srmarket.remove_liquidity` works |

Then unpaused, and `sr.deposit` worked again. **Nobody is ever trapped by the emergency brake** —
that is the property, and it is now measured rather than asserted.

> ⚠️ **The first run of this drill silently skipped two of the three exits** — it read LP shares via
> `lp_balance`, which does not exist (the getter is `lp_position`), and the failed read looked like
> "no position". A drill that skips the thing it exists to prove is worse than no drill. Fixed, and
> re-run to a full 17/17.

## 2. Multisig rotation — 108 seconds, and the new key was proven usable

Full `propose ×6 → accept ×6 → verify` against stack B with a real **2-of-3** account (master key
weight 0, three signers of weight 1, thresholds 2/2/2). **108 seconds, 27 checks, 0 failures.**

Rotated **both directions** with a different signer pair each way, so no single pair is load-bearing.

§17 asks for "old key powerless **and** new key functional". Both are now checked:

* **Old key powerless** — a real transaction the network rejects with `TxBadAuth`. Simulation cannot
  prove this: `--send=no` records auth rather than enforcing it, so a simulated call from a dead key
  still "succeeds".
* **New key functional** — added during this rehearsal, because it was missing. Recording an address
  as admin does **not** prove anyone can sign for it: a wrong threshold, a missing signer, or an
  account whose total signing weight is below its own threshold all pass a naive check and still
  leave the protocol with an admin nobody can use. The probe is a deliberate no-op (`propose_admin`
  the current admin, then `cancel_admin_transfer`) so it proves the capability without touching
  anything operational.

## 3. Upgrade with live positions

Scheduled against a stack holding live positions (`total_supply` 58,712,587 · `total_assets`
61,998,943), a seeded vault and a live pool.

* ✅ `pending_upgrade()` is visible to users — the exit window is observable, not just documented.
* ✅ **`apply_upgrade` REFUSED before the eta.** This is the security property, and it holds.
* ✅ Every balance survived the scheduling unchanged.

The **complete** path was then run, not just the safety half. The default timelock is 86,400s (24h),
which would make a real wait-then-apply a day long; the floor (`MIN_TIMELOCK_SECS`) is 3,600s, and
lowering to it is itself part of the procedure. `UPGRADE_WAIT=1` sets the timelock to the floor,
waits it out, applies, and restores 86,400s. Never do that on a live stack — it shortens users' real
exit window.

After the full 3,600s wait:

* ✅ **applied in 7s** once the eta passed
* ✅ `code_hash` is exactly the scheduled hash
* ✅ `pending_upgrade` cleared
* ✅ deposits still worked afterwards
* ✅ `total_assets` still readable

> **The full run reported one ✗, and it was the drill's own bug, not the protocol's.** The assertion
> "total_supply survived unchanged" was evaluated *after* the drill's own `sr.deposit` probe, which
> mints SR — so the drill moved the number it was checking and then failed itself. Fixed two ways:
> the exact comparison now runs immediately after `apply_upgrade` and before any probe, and the
> end-of-drill check asserts only that **no shares were destroyed** (supply may legitimately grow,
> because the drill deposits on purpose). Re-verified: 4 passed, 0 failed.
>
> This is the second time a drill's own bookkeeping produced a wrong answer — see the pause drill's
> `lp_balance` note. Both were caught by running the drills, which is the argument for running them.

## 4. Cancelling a scheduled upgrade — 18 seconds

Schedule → confirm it is publicly visible → cancel → confirm nothing pending. **18 seconds**, which
is the number that matters: this is the abort you reach for when an upgrade turns out to be wrong.

## 5. Rate-oracle freeze and recovery — 10 seconds

The one documented single-command production fix, proven end to end on a live network for the first
time.

`set_max_apr_bps 0` makes any `b_rate` rise beyond 16 stroops trip the bound. After 45s of Blend's
real rate movement the protocol **genuinely froze**:

* ✅ `strategy.current_rate` reverts `RateOutOfBounds`
* ✅ deposits refused
* ℹ️ `sr.exchange_rate` **keeps answering** — it reads a stored high-water mark. This is deliberate
  and useful: the dashboard and the off-chain monitor keep reporting during an incident.

One `set_max_apr_bps 30000` call restored it in **10 seconds**; `current_rate` answered again and
deposits resumed.

> `set_max_apr_bps` is the fix for the **upper** bound only. A `b_rate` **decrease** is a different
> failure with a different valve (`reset_rate_floor`) — see `tofix.md` #3.

## 6. Two fresh deploys are identical

Two independent `FRESH=1` runs, separate issuers, separate state files:

* ✅ **All six code hashes identical** across both runs.
* ✅ Wiring is per-stack — `SR.strategy`, `SRVAULT.yield_contract` and `SRVAULT.sr_token` each point
  at their **own** stack in both. No cross-contamination between two simultaneous deployments.
* ✅ **Resume is a true no-op**: re-running over a complete state file exited 0 and left the state
  file **byte-identical**.

## 7. Empty-deployment behaviour

All 14 views answer on a completely unseeded stack — no panics, no missing values, nothing a
frontend would render as `NaN` or spin on forever:

```
SR.total_assets 0 · total_supply 0 · exchange_rate 1055973662665 · deposit_headroom 500000000
SR.realizable_rate 0 · YIELD.solvency [0,0,0] · SRMARKET.reserves [0,0]
SRMARKET.implied_apy 29999999993  (3.0000% — the market opens at the vault's rate)
SRVAULT.stats {coupon_capacity:0, open_receipts:0, …, rate_bps:300}
```

Two things worth recording:

* `SRMARKET.implied_apy` opens at **exactly** the vault's 3.00%, confirming the `MARKET_APY_BPS`
  fix. The live testnet stack's 3%-vs-4.7% mismatch cannot recur on a fresh deploy.
* `SR.realizable_rate` returns **0** on an empty stack, meaning "no quote" — not "worth zero". That
  is a trap for a naive UI: rendered directly it would show a 100% shortfall on the risk panel.
  **The frontend already guards it** (`getRealizableRate` returns `null` for a non-positive rate, so
  `getValueGap` returns `null` and the panel hides). Checked, not assumed.

🟠 **The other half of this drill is not runnable.** §17 asks to point the frontend at the live
**mainnet** addresses in both unseeded and seeded states. There is no v2 mainnet deployment, so this
half completes on launch day.

## 8. TTL upkeep — 30 seconds for a three-entry sweep

`sr.bump_holder`, `yield.bump_holder` and `srmarket.bump_lp` all succeeded, permissionlessly, well
inside budget. **30 seconds for three entries** — the figure to scale when sizing the keeper's
schedule against a real holder set.

---

## What to carry into the mainnet runbook

| If this happens | Do this | It takes |
|---|---|---|
| Suspected exploit or bad Blend state | pause all five | **~50s** |
| An upgrade needs aborting | `cancel_upgrade` | **~18s** |
| `RateOutOfBounds` freezes everything | `set_max_apr_bps` wider | **~10s** |
| Handing control to the multisig | `rotate_admins.sh MODE=rotate` | **~108s** |

Exits stay open through a pause, and the cap can never trap a depositor — both verified on chain, not
inferred from the code.
