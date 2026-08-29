# Blend calibration audit

**Date:** 2026-08-29 · **Scope:** every Spield parameter whose correct value depends on how Blend
behaves · **Status:** report only — **no production value was changed by this audit.**

The one thing added to the tree is a test harness,
[`contracts/strategy/src/calibration_test.rs`](./contracts/strategy/src/calibration_test.rs)
(7 tests, all passing), which runs against the **real Blend v2 WASM** driven to the states that
matter. Every number below is measured by it or read from a live pool. Nothing here is recalled.

---

## 1. Verdict at a glance

| # | Parameter | Where | Value | Calibrated? | Verdict |
|---|---|---|---|---|---|
| 1 | `VAULT_RATE_BPS` | deploy scripts | 300 | ✅ **Yes** (2026-08-29) | Correct. Gate in place. |
| 2 | Rate model | `scripts/blend_rate.mjs` | — | ✅ **Yes — upgraded by this audit** | Was validated only near the utilization target. Now **exact at 13 points across all three branches**. See §3. |
| 3 | `MAX_APR_BPS` | deploy scripts | 30000 | ⚠️ **Was a guess; now measured** | **Safe for both live pools** (2.8x / 2.7x headroom). But safe *by accident of their config*, not by construction. See §4. |
| 4 | Utilization metric | `sr_solvency_monitor.mjs`, `blend_rate.mjs` | share-based | ❌ **No — wrong definition** | Blend uses **cash-based** utilization. The two agree in calm markets and diverge badly under stress — exactly when the monitor matters. See §5. |
| 5 | `ir_mod` assumptions | `blend_rate.mjs` stress | floor 1.0 | ✅ **Yes — now measured** | Real bounds are **[0.1, 10.0]**. Stressing to 1.0 is confirmed a *moderate* stress, as documented. See §6. |
| 6 | Exit-coverage alert | `sr_solvency_monitor.mjs` | 5x warn / 3x crit | ⚠️ **Not measured, but defensible** | Live coverage is **356.95x**. Thresholds are untested against a real crunch. See §7. |
| 7 | SR deposit cap | `sr.deposit_cap` | 100 USDC (live) | ⛔ **Open — needs risk appetite, not measurement** | V2_WORK §1. See §8. |
| 8 | `scalar_root` | `srmarket` | 40e12 | ⛔ **Open** | V2_WORK §14. Not Blend-derived; listed for completeness. |
| 9 | `RATE_BOUND_DUST` | `shared::math` | 16 | ✅ Fine | Microscopic next to any real rate; no evidence of false trips. |

**Two changes are worth making. One is a real gap (§5); one is a hardening (§4).** Everything else
is either already correct or a business decision no measurement can make for you.

---

## 2. Method

`calibration_test.rs` deploys a Blend pool from the real WASM with the **live mainnet FixedV2 USDC
reserve config**, read on chain 2026-08-29:

```
util 8000000 (80% target)   max_util 9000000 (90%)   bstop_rate 2000000 (20%)
r_base 300000 (3%)   r_one 400000 (4%)   r_two 1200000 (12%)   r_three 50000000 (500%)
```

That last value is the reason the harness exists. `blend_contract_sdk::testutils::
default_reserve_config()` — which the rest of the strategy suite uses — carries `r_three = 150%`.
**FixedV2's is 500%, 3.3x steeper.** A harness built on the SDK default understates the top of the
rate curve by that factor and would quietly bless a `max_apr_bps` the real pool can breach.

Rates are measured as the annualized growth of `b_rate` and `d_rate` — the supply and borrow
indices themselves — over a **one-hour window** so `ir_mod` barely moves and the reading is the
instantaneous curve rather than a blend of curve and modifier drift.

---

## 3. The rate model is now fully validated (and it was not before)

`scripts/blend_rate.mjs` reconstructs Blend's rate curve from reserve config. When it shipped
yesterday it reconciled against both live pools to within 0.01 pp — but **both pools sat within
0.7 pp of their utilization target**, where the piecewise curve is dominated by its first-branch
endpoint. The second and third branches were never actually exercised. The model's confidence was
overstated, and the `max_apr_bps` question depends entirely on those unexercised branches.

Measured (A1 + A3), `ir_mod ≈ 1.0`, borrow APR in bps:

| utilization | 25% | 50% | 70% | 80% | 85% | 89% | 90% | 93% | 95% | 96% | 97% | 98% | 99% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **measured** | 425 | 550 | 650 | 700 | 1100 | 1420 | 1500 | 1740 | 1900 | 11900 | 21900 | 31900 | 41900 |
| **model** | 425 | 550 | 650 | 700 | 1100 | 1420 | 1500 | 1740 | 1900 | 11900 | 21900 | 31900 | 41900 |

**Exact at all 13 points, across all three branches.** The supply-side conversion
(`borrow x util x (1 - bstop)`) matches exactly too — 41900 x 0.99 x 0.8 = 33185, measured 33185.

*No change needed.* This is the audit upgrading a claim from "reconciled at two nearby points" to
"validated across the whole domain".

---

## 4. `MAX_APR_BPS = 30000` — safe here, but not safe by construction

### What it does

`check_rate_bound_timed` rejects any `b_rate` read that implies annualized growth above
`max_apr_bps`. On rejection `current_rate` panics `RateOutOfBounds` — and `current_rate` is the
first line of `redeem`. **A breach freezes exits**, in exactly the crisis that produced the rate.
Recovery is an admin `set_max_apr_bps`; until then nobody can withdraw.

### The bound IS breachable by a legitimate pool state

Test C: a pool identical to FixedV2 **except `max_util = 99.9%`**, driven to `ir_mod = 10`:

```
pool state      : utilization 112.76%, ir_mod 10.0000
observed rate   : 62239 bps annualized b_rate growth      <- 2.07x the 30000 bound
current_rate()  : PANICKED (RateOutOfBounds) -> deposit AND redeem both revert
=> EXITS ARE FROZEN.
```

No attack, no oracle manipulation, no host bug — just a pool whose config lets borrowers reach the
`r_three` branch.

### But it is NOT reachable on either pool we actually use

Test C2, FixedV2's **real** `max_util = 90%`, 50 simulated years of a fully unrepaid pool:

| elapsed | util (cash) | ir_mod | supply APR bps |
|---|---|---|---|
| 0y | 89.11% | 1.47 | 1011 |
| 10y | 95.16% | 10.00 | 503 |
| 25y | 97.36% | 10.00 | 287 |
| 50y | 98.36% | 10.00 | 182 |

**Peak 1011 bps — 29.7x headroom. Never breached.**

The mechanism is self-limiting and worth understanding: as a pool goes unrepaid, interest is
credited to suppliers that the pool does not actually hold, so `b_supply x b_rate` inflates. The
borrow rate climbs, but the interest is spread over an ever-larger accounting supply, and *realized
supply-index growth falls*. The quantity `max_apr_bps` bounds is the one that self-limits.

### The real finding: the bound is uncalibrated against the pool

30000 is safe for FixedV2 and TestnetV2, but nothing checks that, and the margin depends entirely
on `max_util` sitting below the 95% kink. The principled ceiling is:

```
max_reachable_supply_apr = base_borrow(max_util) x ir_mod_max(10) x max_util x (1 - bstop_rate)
```

| pool | max_util | base(max_util) | ceiling | `MAX_APR_BPS` 30000 |
|---|---|---|---|---|
| mainnet FixedV2 | 90% | 0.15 | **10,800 bps** | 2.78x headroom ✅ |
| testnet TestnetV2 | 95% | 0.1305 | **11,158 bps** | 2.69x headroom ✅ |
| *a pool with max_util 99%* | 99% | 4.19 | **331,900 bps** | **11x too small** ⛔ |

TestnetV2's `max_util` is **exactly 95%** — sitting on the kink. One config change upward by
Blend's admins and the analysis flips.

### Recommended (not applied)

1. **Derive the ceiling at deploy time** rather than hardcoding 30000. `scripts/blend_rate.mjs`
   already has `baseBorrowRate`; the ceiling above is three lines on top of it. Fail the deploy if
   `MAX_APR_BPS` is below it.
2. **Refuse a pool with `max_util > 95%`** outright, or require `MAX_APR_BPS` to cover the
   `r_three` branch when it is. This is the single condition that separates "29.7x headroom" from
   "exits freeze".
3. Keep 30000 as the value for both current pools — it is correct. The change is the *check*, not
   the number.

---

## 5. The utilization metric is the wrong definition — the one real defect

`sr_solvency_monitor.mjs` (and `blend_rate.mjs`'s `utilizationOf`) compute:

```js
supplied = b_supply * b_rate;  borrowed = d_supply * d_rate;  util = borrowed / supplied
```

**Blend's own utilization is cash-based**: `borrowed / (borrowed + pool_cash)`. Measured side by
side (A5), on a pool going unrepaid:

| elapsed | util (share-based, what we compute) | util (cash-based, what Blend uses) |
|---|---|---|
| 0y | 89.89% | 89.34% |
| 3y | 97.90% | 92.20% |
| 6y | 102.94% | 93.85% |
| 9y | **106.40%** | 94.93% |

They agree to within ~0.5 pp in a healthy pool — which is why this was never caught — and diverge
without bound under stress. **The share-based figure exceeds 100%**, which is not a utilization at
all, and it is wrong in the *alarming* direction: it will report a crisis worse than Blend sees, at
exactly the moment an operator is deciding whether to pause deposits.

This does not affect any calibration in this report (every measurement above sets utilization by
borrowing, where the two agree exactly, and the model validated against Blend's own behaviour). It
affects the **monitor's headline number** and any future use of `utilizationOf`.

### Recommended (not applied)

Compute utilization as `borrowed / (borrowed + cash)`, where `cash` is the pool's balance of the
underlying — which `sr_solvency_monitor.mjs` **already reads** for its coverage check
(`read(CFG.underlying, 'balance', [pool])`). The fix is arithmetic, not a new call.

### One caveat, in the dangerous direction

The monitor's *alarm* fires on coverage, not utilization — `tofix.md` #23 correctly moved off raw
utilization — so the headline `utilization X%` is a displayed diagnostic, not a live trigger. **But
the same share-based `supplied` also feeds the coverage calculation:**

```js
const utilCap   = supplied - (borrowed * 10_000_000n) / maxUtil;   // supplied is share-based
const available = utilCap < balance ? (utilCap > 0 ? utilCap : 0) : balance;
```

Blend's withdrawal ceiling is set against `borrowed + cash`, not the accounting supply. Under stress
`supplied > borrowed + cash`, so `utilCap` is **overstated**, which would overstate `available` and
therefore overstate coverage — the alarm would fire *late*, in the direction that hurts.

What limits the damage is the `min(utilCap, balance)`: `balance` is the pool's real cash, and in the
stressed case cash is low and binds first, masking the error. So this is a latent correctness bug
with a partial natural guard, not a demonstrated alarm failure — I did not produce a scenario where
coverage is materially misreported, and I am not claiming one. The fix is the same one-line change
(`borrowed + cash` in place of `supplied`) and removes the need to reason about the guard at all.

---

## 6. `ir_mod` bounds: measured [0.1, 10.0]

Test B, by sustaining utilization above and below target:

```
sustained ABOVE target: ir_mod reached 10.0000
sustained BELOW target: ir_mod fell to  0.1000
live 2026-08-29: mainnet FixedV2 1.4899, testnet TestnetV2 0.1067
```

Two consequences, both confirming existing decisions rather than overturning them:

* **The vault-rate stress is honest.** `blend_rate.mjs` stresses `ir_mod` down to 1.0. With a real
  floor of 0.1, that is 10x above the worst case — which is exactly what `MAINNET.md` §8 claims
  ("a *moderate* stress, not a worst case"). That claim is now measured rather than asserted.
* **Testnet is pinned at the floor.** 0.1067 against a floor of 0.1000. Testnet's ~0.2% supply rate
  is not a low reading, it is the *minimum the curve can produce*. Reinforces the standing rule
  that a testnet rate is never evidence for a mainnet parameter.

---

## 7. Exit-coverage thresholds (5x warn / 3x critical) — V2_WORK §13

Live testnet reading: **356.95x** (`exit_coverage=356.95x, blend_util=70.3%`). Spield's position is
tiny relative to the pool, so the thresholds have never been approached, let alone tested.

The thresholds are *defensible* — `tofix.md` #23 reasoned them out properly, and coverage is the
right signal — but they are **reasoned, not measured**. Measuring them honestly needs a scenario
this harness cannot produce: it needs Spield's own position to be material relative to Blend's
available liquidity, which is a function of TVL you do not have yet.

### Recommended (not applied)

Leave 5x/3x. Revisit when Spield's deployed position exceeds ~1% of the pool's available liquidity
— below that, coverage is dominated by Blend's size and the ratio carries no information about
Spield. Add that trigger to the monitoring runbook rather than changing a number now.

---

## 8. What measurement cannot settle

**SR deposit cap (V2_WORK §1).** Live value 100 USDC, with `total_assets` at 93.98 — **94% of the
cap**, so this binds *today*. But as §1 correctly states, the cap bounds "the maximum depositor loss
that can occur uncompensated, with recovery gated on your key". That is a risk-appetite figure:
pick the depositor-loss number you are willing to have happen and explain, divide by your planning
haircut. No Blend measurement produces it. What this audit adds is only that the *freeze* half of
that exposure is real and reachable — §4 shows a second, independent way to trigger it.

**`scalar_root` (V2_WORK §14).** A market-curve parameter, not Blend-derived. Listed only so the
inventory is complete.

---

## 9. Reproducing this

```bash
# the harness (7 tests, ~12s)
cargo test -p spield-strategy --lib calibration -- --nocapture --test-threads=1

# the live-pool side
node scripts/calibrate_vault_rate.mjs --state scripts/deploy_sr_testnet.state --rate 300 --advisory
node scripts/sr_solvency_monitor.mjs --state scripts/deploy_sr_testnet.state --once
```

| test | question it answers |
|---|---|
| `calibration_a_rate_curve_sweep` | the curve from 25–89% util, and what passive drift does |
| `calibration_a3_third_branch_...` | the `r_three` branch — where the ceiling lives |
| `calibration_a4_raw_reserve_fields` | every scale used above, verifiable |
| `calibration_a5_is_the_steep_branch_reachable...` | share- vs cash-based utilization |
| `calibration_b_ir_mod_bounds` | `ir_mod` floor and ceiling |
| `calibration_c_a_legitimate_rate_spike_freezes_exits` | the consequence: exits freeze |
| `calibration_c2_reachability_at_the_real_max_util` | whether that can happen on FixedV2 |

---

## 10. Summary of proposed changes

None applied. In priority order:

| Pri | Change | Where | Why |
|---|---|---|---|
| **P1** | Utilization = `borrowed / (borrowed + cash)`, in the displayed figure AND in `utilCap` | `sr_solvency_monitor.mjs`, `blend_rate.mjs` | Not Blend's definition; misreports without bound under stress and feeds coverage in the late-firing direction (§5). Data already fetched. |
| **P2** | Derive `MAX_APR_BPS` from the pool's config; refuse `max_util > 95%` unless the bound covers `r_three` | deploy scripts + `blend_rate.mjs` | 30000 is right for both pools but unchecked; a pool config change silently turns 29.7x headroom into frozen exits (§4). |
| **P3** | Note in the monitoring runbook that coverage thresholds carry no signal below ~1% of pool liquidity | runbook | Avoids false confidence in an untested threshold (§7). |
| — | `VAULT_RATE_BPS`, rate model, `ir_mod` stress, `RATE_BOUND_DUST` | — | Verified correct. No change. |
