# Blend calibration audit

**Date:** 2026-08-29 · **Scope:** every Spield parameter whose correct value depends on how Blend
behaves · **Status:** report only — **no production value was changed by this audit.**

The one thing added to the tree is a test harness,
[`contracts/strategy/src/calibration_test.rs`](./contracts/strategy/src/calibration_test.rs)
(15 tests, all passing), which runs against the **real Blend v2 WASM** driven to the states that
matter. Every number below is measured by it or read from a live pool. Nothing here is recalled.

---

## 1. Verdict at a glance

| # | Parameter | Where | Value | Calibrated? | Verdict |
|---|---|---|---|---|---|
| 1 | `VAULT_RATE_BPS` | deploy scripts | 300 | ✅ **Yes** (2026-08-29) | Correct. Gate in place. |
| 2 | Rate model | `scripts/blend_rate.mjs` | — | ✅ **Yes — upgraded by this audit** | Was validated only near the utilization target. Now **exact at 13 points across all three branches**. See §3. |
| 3 | `MAX_APR_BPS` | deploy scripts | 30000 | ✅ **Now measured AND checked** | Safe for both live pools (2.78x / 2.69x). Was safe *by accident of their config*; a derived gate now enforces it. See §4. |
| 4 | Utilization metric | `sr_solvency_monitor.mjs`, `blend_rate.mjs` | share-based | ✅ **Correct — earlier finding RETRACTED** | I claimed Blend used cash-based utilization. **That was wrong.** A controlled experiment settles it: share-based. See §5. |
| 5 | `ir_mod` assumptions | `blend_rate.mjs` stress | floor 1.0 | ✅ **Yes — now measured** | Real bounds are **[0.1, 10.0]**. Stressing to 1.0 is confirmed a *moderate* stress. See §6. |
| 6 | `available_liquidity()` | `strategy` contract | `min(utilCap, cash)` | ❌ **Wrong constraint — RESOLVED 2026-08-30** | `max_util` does not bind withdrawals; the real bound is **`cash − backstop_credit`**. Reconciles with `tofix.md` #20. Fix in the next deploy. See §7. |
| 7 | Exit-coverage alert | `sr_solvency_monitor.mjs` | 5x warn / 3x crit | ⚠️ **Recalibrate after #6 lands** | Coverage divides by `available_liquidity()`, so it inherits #6's error — a full exit succeeded at **0.05x**. Once #6 is fixed the metric becomes meaningful and 5x/3x can be set against it. See §7. |
| 8 | SR deposit cap | `sr.deposit_cap` | **50 USDC** in the scripts; **5 USDC** live on testnet | ✅ **Set** | A GLOBAL cap — it bounds LPs too, and counts operator seeding. See §8. |
| 9 | `scalar_root` | `srmarket` | 40e12 | ⛔ **Open** | V2_WORK §14. Not Blend-derived; listed for completeness. |
| 10 | `RATE_BOUND_DUST` | `shared::math` | 16 | ✅ Fine | Microscopic next to any real rate; no evidence of false trips. |

**One finding from the first draft is retracted (§5) and one new defect replaces it (§7).** The
`MAX_APR_BPS` gate and the deposit cap are now applied; the `available_liquidity()` defect is
reported, not fixed, because it is a contract change.

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

### ✅ APPLIED — the gate now exists

`blend_rate.mjs` gained `maxSupplyAprCeiling()` and `checkMaxApr()`, and
`calibrate_vault_rate.mjs` gained `--max-apr <bps>`. All three deploy scripts pass
`--max-apr "$MAX_APR_BPS"`, so the bound is validated against the pool's own config on every
deploy and every rate reconciliation — a hard gate on mainnet, advisory on testnet.

`ir_mod`'s ceiling of 10.0 in the formula is the measured value from §6, not an assumption.

Live output against mainnet FixedV2:

```
STRATEGY RATE BOUND (max_apr_bps)
  pool max_util           90.000%
  venue rate ceiling      10801 bps (108.01%)   (at max_util, ir_mod 10)
  configured max_apr_bps  30000 bps (300.00%)
  headroom                2.78x

  PASS  the bound sits above anything this venue can produce.
```

And it fails where it must — a pool with `max_util = 99%` reports `required 331849 bps,
headroom 0.09x, 3rd-branch true -> TOO LOW`. **The value 30000 is unchanged: it is correct for both
pools. What changed is that nothing has to take that on trust any more.**

---

## 5. RETRACTED — the utilization metric is correct

**The first draft of this document claimed Blend uses cash-based utilization
(`borrowed / (borrowed + cash)`) and that the monitor's share-based
(`borrowed / supplied`) figure was a P1 defect. That was wrong.** It was inferred from a drift
simulation in which the two diverged, without ever testing which one the rate curve follows.

Two things corrected it. First, live data: on mainnet FixedV2 the two definitions differ by 1.47 pp,
and only one of them reproduces the measured rate.

| definition | utilization | model supply APR | measured |
|---|---|---|---|
| **share-based** | 80.68% | **7.255%** | 7.229% |
| cash-based | 79.21% | 6.572% | 7.229% |

Then a controlled experiment (test D) that breaks the tie deliberately — donate USDC straight to the
pool, raising **cash** without touching `b_supply`, so cash-based utilization moves and share-based
does not:

```
control   : util(shares) 80.00%                    -> supply 448 bps
+donation : util(shares) 80.00%  util(cash) 40.00%  -> supply 448 bps

share-based utilization moved 0.00 pp; cash-based moved 40.00 pp
the rate moved 0.00%  =>  Blend's rate curve is driven by SHARE-BASED utilization
```

**Cash-based utilization moved 40 percentage points and the rate did not move at all.** Blend's
interest-rate utilization is `d_supply x d_rate / (b_supply x b_rate)` — exactly what
`sr_solvency_monitor.mjs` and `blend_rate.mjs` already compute.

*No change made.* Making the "fix" would have been a regression. The `utilCap` term is likewise
consistent with share-based utilization, so it is not wrong for the reason the first draft gave —
though §7 finds it wrong for a different reason.

What the drift simulation actually showed is narrower than the claim built on it: in a deeply
unrepaid pool the *accounting* supply can exceed the claim on it, so share-based utilization can
read above 100%. That is a real oddity of a pathological state, not evidence about which quantity
drives the curve.

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

## 7. CONFIRMED — `available_liquidity()` uses the wrong constraint

The adapter computes what Blend can pay as `min(utilCap, pool_cash)` where
`utilCap = supplied - borrowed/max_util`, on the stated premise that *"Blend refuses any withdrawal
that would push utilization past `max_util`"*
([`strategy/src/lib.rs`](./contracts/strategy/src/lib.rs)). Coverage — and therefore the exit
alarm — is built on that number.

**The premise does not hold.** Test F: a pool at 89.56% utilization, Spield holding 20,000 USDC.

```
available_liquidity() reports: 1086.53 USDC
pool cash on hand            : 23000.00 USDC

withdraw attempt    x reported  Blend says
         543.27          0.5x        PAID
        1086.53          1.0x        PAID
        5432.67          5.0x        PAID
       10865.34         10.0x        PAID
       19557.62         18.0x        PAID
       20005.75         20.0x        PAID     <- the entire position

largest withdrawal Blend honoured: 20005.75 USDC = 18.4x what available_liquidity() reported
```

The withdrawal left utilization at ~98.5%, far above `max_util = 90%`, and Blend allowed it. The
`utilCap` term is not a constraint Blend actually applies to withdrawals.

### What this does to the exit-coverage alert

Test E, a real crunch — Spield supplies 20,000 USDC, then the whale draws it back out:

| extra drawn | our position | available | coverage | full exit got | exit ok? |
|---|---|---|---|---|---|
| 0k | 20002.74 | 22210.50 | 1.11x | 20002.74 | full |
| 5k | 20003.48 | 16651.78 | 0.83x | 20003.48 | full |
| 10k | 20004.26 | 11092.90 | 0.55x | 20004.26 | full |
| 15k | 20005.07 | 5533.87 | 0.28x | 20005.07 | full |
| 19k | 20005.75 | 1086.53 | **0.05x** | 20005.75 | **full** |

**A full exit succeeded at 0.05x coverage.** The 5x/3x thresholds are not wrong in the dangerous
direction — they page far too *early*, which is its own failure: an alarm that fires while exits
work perfectly trains operators to ignore it.

One thing E also settled: growing Spield's own position cannot produce a crunch. Our deposit *is*
liquidity, so `available` rises with it and coverage self-corrects to ~1.01x. A crunch is only ever
somebody else drawing down cash we already supplied.

### ✅ RESOLVED 2026-08-30 — both observations were real, the diagnosis was wrong

`tofix.md` #20 is not in conflict with F/G after all. Three more tests settle it.

**J — `max_util` does not bind withdrawals.** A pool sitting exactly at `max_util` (90.01% vs a 90%
ceiling), with `available_liquidity()` reporting **0.00**:

| withdraw | utilization after | vs max_util | Blend says |
|---|---|---|---|
| 100 | 90.04% | ABOVE | PAID |
| 1,000 | 90.31% | ABOVE | PAID |
| 5,000 | 91.54% | ABOVE | PAID |
| 20,000 | 96.44% | ABOVE | PAID |

Four probes, all past the ceiling, all paid. The `utilCap` term is not a constraint Blend applies.

**K — the real bound is `pool_cash − backstop_credit`.** #20 said the raw balance *overstated*
headroom by 12.8%, and if cash alone were the bound the raw balance would be exactly right. The
missing term is `backstop_credit`: accrued interest owed to the backstop that sits inside the pool's
token balance and is not available to suppliers. Probed to the stroop:

| withdraw | vs `cash − backstop_credit` | Blend says |
|---|---|---|
| 29,876.81 | −100 USDC | PAID |
| 29,976.81 | −1 USDC | PAID |
| **29,977.81** | **exactly** | **REFUSED** |
| 29,978.81 | +1 USDC | REFUSED |
| 30,000.00 | = full cash | REFUSED |

### What this means

* **#20's observation was correct.** The raw balance really does overstate headroom, and the
  overstatement "is not a constant" exactly as #20 said — `backstop_credit` grows with time and
  utilization. It was 12.8% on the live pool; it is 0.074% in this young harness, which is why F and
  G never tripped it.
* **#20's fix used the wrong formula.** `utilCap` is conservative enough to avoid `#1207`, which is
  why it worked in practice — but it over-corrects enormously: **0.00 reported against ~29,978 USDC
  actually withdrawable.**
* **The correct formula is `min(position, cash − backstop_credit)`.** The strategy already reads
  `get_reserve`, and `backstop_credit` is in that same payload — no extra call.

### Recommended — now safe to act on

**Change `available_liquidity()` to `min(balance − backstop_credit, …)`.** It is a contract change,
so it belongs in the next deploy rather than a hot patch. The direction of the current error is safe
(under-sizing a withdrawal never fails; over-sizing is what produced `#1207`), but the magnitude is
not: reporting 0 tells users they cannot exit during a crunch, which is the moment a false alarm does
the most damage.

**One caveat.** These are measurements against the Blend v2 WASM shipped in `blend-contract-sdk
2.25.0`. A live pool may run a different build. That said, this model *explains* the live `#1207`
rather than contradicting it, which is corroboration rather than conflict.

---

## 8. SR deposit cap — set to 5 USDC

**Applied 2026-08-29**: `set_deposit_cap(50000000)` on
`CCOXZUKCZGNJQYNWRLWD3TZFBQH2GNF4SKP65WAN5I63JXEKBAAT7QRX`
([tx a4ef1362](https://stellar.expert/explorer/testnet/tx/a4ef1362ad3e4f6352740bc970b516d828916862d0bc733265d13d1b5c3f4c15)),
down from 100 USDC.

**Read the consequence carefully.** The cap is checked against assets *already deployed*, and
`total_assets` is **93.98 USDC** — well above the new 5 USDC cap. So this does not "limit deposits
to 5 USDC"; it **closes deposits entirely** until TVL falls below 5. Verified live: a 1 USDC deposit
now reverts with `Error(Contract, #107)` = `DepositCapExceeded`.

That is the safest possible state and matches the stated intent, but it is a deposit freeze rather
than a small cap. If the goal is instead "let a little more in", the cap has to sit above current
TVL.

**Exits are unaffected**, by contract design — `redeem` never consults the cap, and
`set_deposit_cap`'s own docstring notes that setting one below TVL "can never trap a user".
Confirmed live: `max_redeemable` still returns `i128::MAX`.

### What the cap actually bounds

As V2_WORK §1 states: not your loss, but *"the maximum depositor loss that can occur uncompensated,
with recovery gated on your key"*. At 5 USDC and a 20% planning haircut that is at most ~1 USDC of
uncompensated user loss, plus a freeze of unbounded duration. This audit adds that the freeze half
has a second independent trigger — §4's rate bound — now gated.

**`scalar_root` (V2_WORK §14)** remains open: a market-curve parameter, not Blend-derived, listed
only so the inventory is complete.

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
| `calibration_d_which_utilization_drives_the_rate` | share- vs cash-based, settled by experiment |
| `calibration_e_exit_coverage_under_a_real_crunch` | coverage vs what a full exit actually returns |
| `calibration_f_does_available_liquidity_predict...` | whether `available_liquidity()` is real |
| `calibration_g_where_does_blend_actually_refuse...` | the `max_util` boundary, vs `tofix.md` #20 |
| `calibration_j_does_blend_refuse_a_withdrawal...` | does `max_util` bind a withdrawal? (no) |
| `calibration_k_what_actually_bounds_a_withdrawal` | the real bound: `cash − backstop_credit` |
| `calibration_h_mainnet_exact_pool_parameters...` | FixedV2's exact knobs, full 90-day cycle |
| `calibration_i_what_fixedv2_pays_with_ir_mod...` | what mainnet pays at the `ir_mod` floor |

---

## 10. Summary

### Applied

| Change | Where | Status |
|---|---|---|
| `MAX_APR_BPS` validated against the pool's own rate ceiling; `max_util > 95%` flagged | `blend_rate.mjs`, `calibrate_vault_rate.mjs`, all 3 deploy scripts | ✅ Gate live. Value 30000 unchanged — it was already correct. |
| SR deposit cap → **50 USDC** in both v2 scripts; **5 USDC** live on testnet | scripts + on-chain testnet SR | ✅ Live testnet cap sits below its 93.98 TVL, so testnet deposits are closed. Exits unaffected. |
| Calibration harness | `contracts/strategy/src/calibration_test.rs` | ✅ 15 tests |

### Retracted

| Claim | Why |
|---|---|
| "Blend uses cash-based utilization; the monitor is wrong" (old §5) | **False.** Test D: cash-based utilization moved 40 pp, the rate moved 0.00%. The monitor was right; making the change would have been a regression. |

### Still open

| Pri | Change | Why |
|---|---|---|
| **P1** | **Fix `available_liquidity()`** to `min(balance − backstop_credit, …)` | Resolved 2026-08-30: `max_util` does not bind withdrawals; the real bound is `cash − backstop_credit`, probed to the stroop. Reconciles with `tofix.md` #20. Contract change — next deploy (§7). |
| **P2** | Retune the 5x/3x exit-coverage thresholds | Blocked on P1 — retuning against a metric wrong by 18x achieves nothing (§7). Direction is currently safe: pages early, never late. |
| — | `scalar_root` | V2_WORK §14, not Blend-derived. |

### Verified correct, no change

`VAULT_RATE_BPS` (300), the rate model, the share-based utilization metric, the `ir_mod` stress
floor, `RATE_BOUND_DUST`, and `MAX_APR_BPS`'s value.


---

## 11. Mainnet readiness

Everything above was calibrated **against mainnet FixedV2's live config** from the start — the
harness uses its reserve parameters, not the SDK defaults, and the live checks run against
`CAJJZSGMMM...`. So the numbers are mainnet numbers. What this section adds is the pool-level and
deployment differences that no testnet run can exercise.

### Verified: the mainnet-exact pool works end to end

Test H pins every knob to what FixedV2 reports on chain — `max_util 90%`, `max_positions 6`,
`min_collateral 5 USDC`, `bstop_rate 20%` — and runs a full 90-day series (the mainnet
`MATURITY_DAYS` default) through the real adapter:

```
deposited      25000.00 USDC
b_rate         1000000000000 -> 1009195744439
redeemed       25229.89 USDC
realized over 90d: 0.9196%  (annualized 3.729%)
```

`min_collateral` is the difference worth naming: **0 on testnet, 5 USDC on mainnet**, so no testnet
run touches it. It gates *borrowing*, and the adapter only ever issues `Supply` (0) and `Withdraw`
(1) — there is no `REQ_BORROW` in `strategy/src/lib.rs` — but that is now a test rather than a
comment. `max_positions 6` is likewise fine: the strategy holds exactly one position.

Pool `status` differs too (**1** on mainnet, **0** on testnet). Both are operational — the harness
pool reports status 1 throughout, with deposits and withdrawals working at every step.

### ⚠️ The `ir_mod` floor — see §12. It is the main pre-launch risk.

Short version: at Blend's `ir_mod` floor a 3% promise is **not funded**, the floor is a state a real
pool sits in today, and the calibration's stress does not reach it. Full treatment in §12.

### ⛔ Deployment gaps — these block a v2 mainnet launch

| # | Gap | Detail |
|---|---|---|
| 1 | ~~`deploy_mainnet.sh` deploys v1 only~~ | ✅ **FIXED.** `deploy_mainnet.sh` is now the **v2 SR stack**, derived from the working `deploy_sr_testnet.sh` with mainnet config and hardening. The v1 script is kept as `deploy_mainnet_v1.sh.retired` because an inert v1 deployment still exists on chain. |
| 2 | ~~v1 has no deposit cap at all~~ | ✅ **FIXED by #1.** v2 carries `SR_DEPOSIT_CAP`, defaulted to **5 USDC (50000000)** in the new mainnet script — matching the testnet posture. |
| 3 | **The live mainnet vault is stale** | `rate_bps = 500` (the uncalibrated value), maturity `1788722911` = **2026-09-06**, `coupon_capacity = 0`. It is inert — zero capacity means every deposit reverts — but the rate is wrong and the series expires in days. The reconciliation added to `deploy_mainnet.sh` fixes the rate on the next run. |

### What to change before a mainnet launch

1. **Create and fund the issuer account.** There is no friendbot; the script now refuses rather
   than generating an unfunded key. It is locked irreversibly during the run (`LOCK_ISSUER=0` to
   skip).
2. **Seed the vault before the UI offers it** (`VAULT_SEED_AMOUNT` defaults to 0 — a vault with zero
   `coupon_capacity` reverts every deposit), and **size that seed against §12**, not as launch
   liquidity.
3. Re-run `calibrate_vault_rate.mjs --check` on the day — the gate does it automatically, but the
   rate should not be a surprise. Under v2's 5% yield fee the mainnet ceiling is **312 bps**, not
   the 336 bps the fee-free v1 path showed.
4. The maturity is set per run from `MATURITY_DAYS` (90), so nothing is inherited from the expiring
   v1 series.

**No parameter needs a different value for mainnet.** `VAULT_RATE_BPS = 300` and
`MAX_APR_BPS = 30000` are both correct for FixedV2 and both now gated. The mainnet work is
deployment coverage and seed sizing, not recalibration.


---

## 12. The `ir_mod` floor — the risk to understand before launching

This is the one finding that is not a parameter to fix. It is a property of the venue that the
product has to be sized around, and the calibration rule deliberately does **not** cover it.

### How it surfaced

By accident. Test H ran a 90-day mainnet-exact series purely to check the pool's knobs work, and
`ir_mod` decayed to **0.1000** during the run. Test I then measured what FixedV2 pays sitting there:

```
utilization 74.53%   ir_mod 0.1000 (floor 0.1)
steady-state supply APR: 224 bps (2.236%)
vault promises 300 bps (3.00%)
=> UNDER WATER by 76 bps; the vault earns 0.75x what it owes
```

The model, at the floor and at target utilization, gives a much harsher figure:

```
supply = base(0.80) x ir_mod x util x (1 - bstop) = 0.07 x 0.1 x 0.80 x 0.80 = 0.448%
net of the 5% engine fee                                                    = 0.426%
```

**The two disagree on magnitude — 224 bps vs 43 bps — and agree on sign.** At the `ir_mod` floor a
3% promise is not funded, somewhere between 0.75x and 0.14x coverage. I have not reconciled the gap;
the 224 bps comes out of a long-run simulation carrying accrual distortion, and the 43 bps is a
clean steady-state calculation. Both are below 300 bps, which is the decision-relevant fact.

### What `ir_mod` is, and how a pool reaches the floor

`ir_mod` is Blend's rate modifier: a multiplier the pool moves up when utilization runs above the
reserve's target and down when it runs below, nudging borrow demand back toward target. Measured
bounds (test B): **[0.1, 10.0]**.

A pool reaches the floor by having borrow demand sit below the utilization target for a sustained
stretch. Nothing exotic — a quiet lending market does it. There is no attack, no exploit, no bad
debt involved.

### It is not hypothetical

**TestnetV2's live `ir_mod` is 0.1067 — a real Blend pool is on the floor right now**, and has been
throughout this work. That is why testnet's USDC reserve pays ~0.2%: not a low reading, the
*minimum the curve can produce*. Mainnet FixedV2 is at 1.4899 today, but the same mechanism governs
both.

### Where the line actually is

For a 3% promise under v2's economics (5% yield fee, FixedV2's curve, utilization at target):

| | `ir_mod` | net supply APR | vs a 3.00% promise |
|---|---|---|---|
| live mainnet today | **1.4899** | 6.34% | funded, 2.1x |
| calibration stress | 1.0000 | 4.26% | funded, 1.4x |
| **break-even** | **0.705** | **3.00%** | **the line** |
| measured floor | 0.1000 | 0.43% | **not funded, 0.14x** |

**`ir_mod` must fall 53% from today's value to reach break-even, and it can fall 7x below it.**

### Why the calibration does not cover this, on purpose

`blend_rate.mjs` stresses `ir_mod` down to `min(now, 1.0)`. That is documented as a *moderate*
stress and §6 confirms it is: the floor is 10x lower. Extending the stress to 0.1 would be
mathematically honest and practically useless — the maximum fundable rate would collapse to ~43 bps,
and no fixed-rate product exists at that number. The rule stops at 1.0 because that is the boundary
between "price this conservatively" and "do not offer this product".

So the tail is handled somewhere else, and it is handled well.

### What bounds the damage — this is the part that works

The on-chain capacity check, exactly as designed. `srvault::deposit` refuses any coupon that is not
already backed by PT the vault holds:

```rust
if Self::pt_inventory(&env) < liability + receipts_after * REDEEM_DUST {
    panic_with_error!(&env, Error::InsufficientCapacity);
}
```

So even at the floor:

* **Every promise already made stays payable.** PT redeems 1:1; a receipt cannot be repriced.
* **The vault cannot promise more than it can back.** As the seed drains, capacity shrinks, and
  deposits start reverting with `InsufficientCapacity`. The product closes itself.
* **Total loss is capped at the seed.** There is no path to a shortfall beyond it.

The failure mode is a bounded, self-limiting subsidy — not insolvency.

### The practical implication

**Size the mainnet seed as the subsidy you are willing to fund if Blend's modifier decays, not as
launch liquidity.** They are different numbers and the seed is doing the second job by default.

A worked bound, at the floor, over a 90-day series:

* coupon owed per USDC deposited = `3.00% x 90/365` = **0.740%**
* yield earned per USDC at the floor = `0.426% x 90/365` = **0.105%**
* net drain ≈ **0.635% of deposits per series**

So a seed of `S` funds roughly `S / 0.00635` USDC of deposits before capacity is exhausted — a
100 USDC seed covers ~15,700 USDC of deposits for one series in the worst modifier state. Note the
`SR_DEPOSIT_CAP` of 5 USDC binds long before that, which is the point of setting it low.

### Recommended before launch

1. **Watch `ir_mod`, not just the rate.** `sr_solvency_monitor.mjs` already reads the reserve on
   every poll; `ir_mod` is in the same payload. Alarm approaching **0.705** — that is the break-even
   for a 3% rate, and it is a number, not a feeling.
2. **Re-run the calibration every series.** The rate is fixed *within* a series, and `set_rate`
   moves it forward-only. A decayed `ir_mod` is exactly the case the per-series gate catches.
3. **Decide the subsidy in advance.** If `ir_mod` halves, is the answer to lower the rate for the
   next series, or to keep 3% and fund the gap? Both are defensible; deciding during the event is
   not.
4. Do not raise `SR_DEPOSIT_CAP` above the seed you have actually funded.
