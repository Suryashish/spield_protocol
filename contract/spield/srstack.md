# srstack.md — the Pendle-shaped stack, built

**Status:** implemented, tested, building clean. **Not audited, not deployed, not wired to the app.**

Three new contracts implement Pendle V2's architecture on Soroban, with **SR** in place of SY and a
real protocol-revenue model. The v1 `wrapper` / `vault` / `market` are **untouched** — all 251 of
their tests still pass. This is a parallel stack you can evaluate side by side, not a migration.

```
cargo test --workspace     # 409 passed, 0 failed  (251 pre-existing + 158 new)
cargo build --release --target wasm32v1-none   # 8 binaries, no warnings
```

---

## 1. What was built

| Crate | Pendle equivalent | What it is |
|---|---|---|
| **`contracts/sr`** | SY (EIP-5115) | **SR — Standardized Return.** A share token over the Blend strategy. `deposit`/`redeem`/`exchange_rate`. |
| **`contracts/yield`** | `PendleYieldToken` + `InterestManagerYT` | The PT/YT engine **and the YT token**, with the per-holder interest index and the transfer hook. |
| **`contracts/srmarket`** | `PendleMarket` | The **PT/SR** AMM: time-scaled fee, dynamic re-anchoring, LP/treasury fee split, YT trading. |
| **`contracts/srvault`** | — | Fixed-Rate Vault on the SR stack. PT as bearer inventory, so v1's #18/#21/#22/#24 are absent by construction. |
| **`contracts/srrouter`** | `PendleRouter` | **The one-transaction USDC front door.** `USDC → PT/YT` and back in one signature. Holds nothing, privileged over nothing. |
| `contracts/shared/src/token.rs` | — | SEP-41 storage primitives shared by SR and YT (additive; audited code does not read it). |

PT stays a **Stellar Asset Contract** admined by the yield contract — it needs no hook, and keeping
it a SAC preserves Stellar-classic composability.

```
USDC ──deposit──► SR ──mint_py──► PT (SAC) + YT (hook-bearing)
                   │                    │
                   └──── PT/SR AMM ─────┘

        ┌──────────────── srrouter ────────────────┐
USDC ──►│ wrap → swap → deliver, in one signature  │──► PT or YT
        └──────────────────────────────────────────┘
```

### The router, and why the SR hop still exists

The stack speaks SR because that is the right internal unit: it is the only token whose value tracks
Blend's rate, so pricing PT against anything else would put a moving conversion inside the curve.
But *users* do not have SR, they have USDC — and a product that made "wrap first" step one was a
product that asked people to learn its internals before they could use it.

`srrouter` closes that gap without moving any logic into the contracts that hold funds:

| Entry point | Route |
|---|---|
| `buy_pt_with_usdc` | USDC → wrap → `swap_exact_sr_for_pt` → PT to user |
| `buy_yt_with_usdc` | USDC → wrap → `buy_yt_exact_out` → YT to user, change refunded. **Does not fit in one transaction against Blend's pool — see below.** |
| `sell_pt_for_usdc` | PT → `swap_exact_pt_for_sr` → unwrap → USDC to user |
| `sell_yt_for_usdc` | YT → `sell_yt_exact_in` → unwrap → USDC to user |
| `redeem_py_for_usdc` | PT (+YT before expiry) → `redeem_py` → unwrap → USDC. **The post-maturity exit** — the market refuses to trade past expiry. |
| `claim_yield_to_usdc` | accrued SR → unwrap → USDC. Does not consume the YT. |

Three properties make it safe to put in front of everything:

1. **It holds nothing.** Every entry point ends with `assert_drained` — its balance of USDC, SR, PT
   and YT all back at zero. There is no "stuck in the router" state, and nothing for a later trade
   to sweep up.
2. **It is privileged over nothing.** No admin rights on SR, the engine, the market or the vault.
   Compromise it and the worst case is mishandling funds a user authorized inside one call, which is
   why every `min_*_out` guard sits on the user's side.
3. **Users can route around it.** `Sr::deposit`, `SrMarket::swap_*` and `Yield::redeem_py` are
   unchanged and directly callable. Pausing the router removes convenience, never access — which is
   what makes it safe to pause on suspicion rather than on proof.

### The one path that does not fit — diagnosed on chain

`buy_yt_with_usdc` is correct, fully tested, and **cannot execute against Blend's deployed pool**.
It is worth writing down exactly why, because the first three explanations were wrong.

**What fails:**

```
srmarket::buy_yt_exact_out   →  Success            sr::deposit  →  Success
both in one transaction      →  Error(Budget, ExceededLimit)
```

**It is not trade size.** Simulated down the whole range — 20,000,000 face to 50,000 face, the
latter being half a cent of exposure — every size fails identically. The cost is fixed overhead.

**It is not instructions.** Read from the network's own `ConfigSettingContractComputeV0`:

```
txMaxInstructions   400,000,000
txMemoryLimit        41,943,040
```

Measured on chain, the busiest router path that *works* (`sell_yt_for_usdc`) uses 64.5M
instructions — **16% of the CPU budget**. There is no CPU problem, and the several rounds of
instruction-shaving that preceded this measurement were aimed at the wrong resource entirely.

**It is memory, and memory is cumulative.** Soroban's memory budget is not a high-water mark: every
host allocation, module instantiation and ledger read spends it and nothing is returned. So two
operations that each fit comfortably can still sum past 40MB — which is precisely what a Blend
`submit()` plus a `mint_py`-bearing curve trade do.

Where the work goes, measured on chain:

| call | instructions |
|---|---|
| `market.quote_buy_yt` (curve math alone) | 22.3M |
| `market.buy_yt_exact_out` | 55.6M |
| `market.swap_exact_sr_for_pt` | 34.9M |
| `yield.mint_py` | 16.2M |
| `sr.sync_rate` | 7.5M |
| `strategy.current_rate` (a Blend read) | 5.5M |
| `sr.deposit` | 11.5M |

The dominant memory consumer is Blend's own pool contract, which we do not control and cannot slim.
Removing the router's drain check did not help; neither did moving pricing off chain or eliminating
a second Blend round trip. **This is a limit of the underlying pool, not of anything in this repo.**

So the dApp buys YT in **two transactions** — wrap the shortfall, then `buy_yt_exact_out` — and says
so before the first wallet prompt. Note this is not a consolation prize: **a user who already holds
SR buys YT in one signature today**, because only the Blend leg is the problem. That is a real
argument for holding SR, which is why the wrapper has its own section.

The entry point stays in the contract rather than being deleted: it is correct, tested, and a
lighter yield source would run it unchanged.

Every other router path fits with room, measured on chain:

| path | instructions | % of the 400M budget |
|---|---|---|
| `sell_yt_for_usdc` | 64.5M | 16.1% |
| `buy_pt_with_usdc` | 49.5M | 12.4% |
| `sell_pt_for_usdc` | 48.7M | 12.2% |
| `claim_yield_to_usdc` | 26.1M | 6.5% |
| `redeem_py_for_usdc` | 25.4M | 6.4% |

**The reusable lesson**, which cost four wrong turns to learn: a resource measurement taken against
a test fixture is not a bound on the real thing, and *which* limit you are hitting is a fact to read
off the network, not to infer. The local Blend harness reported this path at 22% of memory. On chain
it does not run at all.

A second path, `sell_yt_for_usdc`, later stopped fitting for a different reason — growing the `sr`
and `strategy` contracts spent budget belonging to every path that loads them. Both cases, the live
per-path measurements, and the rule to check before touching a shared contract are in
[`budget.md`](./budget.md).

**Why `buy_yt_with_usdc` is exact-output.** Not a preference — forced. The market derives the YT
price from the live index, and wallets sign authorization entries built at *simulation*. Put an
on-chain-derived figure inside the user's transfer and the entry no longer matches at execution;
the host rejects the transaction (`AUDITPREP.md` §4, item 1 — this is a bug we hit on testnet, not a
hypothetical). So the user names the face they want plus a ceiling they will spend, and the
remainder comes back. The frontend inverts the quote so people can still budget in dollars.

The one thing the router deliberately does **not** do is replace the wrapper as a product. Holding
SR is a legitimate position — a yield-bearing dollar with no maturity and no counterparty — and it
has its own section in the dApp for exactly that reason.

---

## 2. Measured against v1

Every number below is printed by a named test.

### The transfer hook — the bug that started this

`the_v1_stranding_bug_is_gone`, `a_yt_transfer_settles_both_sides_and_the_yield_follows_the_token`

In v1, Alice could send Bob every YT she owned and **still collect all the yield** while Bob
collected none (`tofix.md` #15). Now the hook settles both parties before any balance moves:

```
hook: Alice earned 0.115553 SR over 120d then transferred; Bob earned 0.113159 SR over the next 120d
```

A holder with no YT earns nothing. YT is freely transferable, and **one balance replaces one
position per purchase** — ten buys is still one `redeem_due_interest` call.

### The fee now scales with the yield traded

`the_fee_is_a_constant_share_of_the_yield_at_every_maturity`

| term | fair YT / 10k | fee / 10k | **fee ÷ YT value** |
|---|---|---|---|
| 30d | 40.02 | 2.046 | **5.1%** |
| 90d | 119.58 | 6.087 | **5.1%** |
| 180d | 237.74 | 12.022 | **5.1%** |
| 365d | 476.19 | 23.755 | **5.0%** |

**Spread: 0.12pp across a 12× range of terms.** v1's flat 30 bps spread ~69pp (75% at 30 days,
6.3% at 365). At the 90-day mainnet default a YT round trip costs **13.3%**, against v1's **40.5%**.

### The dynamic anchor — same rate, ~7× less LP capital

`any_seed_ratio_opens_the_pool_at_the_configured_rate`, `pt_still_converges_to_par_with_a_dynamic_anchor`

```
seed 1 : 1  -> implied APY 5.0000%   PT price 0.988042
seed 2 : 1  -> implied APY 5.0000%   PT price 0.988042
seed 1 : 2  -> implied APY 5.0000%   PT price 0.988042
```

v1 needed a **6.96:1** PT-heavy seed for the same 90-day 5% market. And the property the par anchor
was protecting is not lost — PT still walks to par:

```
day 0 → 0.988042   day 30 → 0.992012   day 60 → 0.995998   day 89 → 0.999866
```

This also removes v1's Blend-flooding problem: a 7× smaller PT side is 7× less USDC forced into the
strategy, so the realized rate YT is a claim on is not crushed by our own seed.

### The pool's non-PT half earns now

`the_pools_sr_half_keeps_earning_while_it_sits_there`

```
LP's SR half: 500,000.00 USDC → 502,100.01 USDC after a year, with ZERO trades
```

In a PT/USDC pool that half is dead. (0.42% is the test harness's Blend rate, not a mainnet
forecast — the point is that it is no longer zero.)

### Resource cost — cheaper than the v1 prototype

`every_path_fits_the_mainnet_per_transaction_budget`

| path | instructions | memory | vs mainnet ceiling |
|---|---|---|---|
| `swap_exact_sr_for_pt` | 11.96M | 3.48 MB | 8.3% |
| `swap_exact_pt_for_sr` | 12.70M | 3.52 MB | 8.4% |
| `buy_yt_exact_out` | 15.38M | 7.58 MB | 18.1% |
| `sell_yt_exact_in` | 15.75M | 7.57 MB | **18.0%** |
| `redeem_due_interest` | 3.13M | 2.79 MB | 6.6% |

`sell_yt` was **29.4%** in the `futureamm.md` prototype. The SR layer is why: PT/YT operations move
SR *shares* internally and **never touch Blend**. Only `sr.deposit` / `sr.redeem` do. That is a real
architectural win, not a tuning one.

---

## 3. Protocol revenue

You asked for this explicitly. Two lines, both governed with on-chain ceilings.

### a) Yield fee — the primary line

`the_yield_fee_routes_to_the_treasury_and_the_rest_to_the_holder`

5% of YT interest at withdrawal, Pendle's rate. Ceiling **10%** (`MAX_YIELD_FEE_BPS`), so a
compromised admin key cannot make it confiscatory.

```
gross 5.108925 SR -> holder 4.853479 + treasury 0.255446  (exactly 5%)
```

### b) Swap-fee split — LP-favouring

`swap_fees_split_between_lps_and_the_treasury`, `the_treasury_share_is_exactly_the_configured_fraction`

Default **20% treasury / 80% LP** — deliberately the inverse of Pendle, which gives LPs only 20%.
Ceiling **50%** (`MAX_TREASURY_FEE_SHARE_BPS`). Verified 0 bps → zero cut, and 20% is exactly 2× 10%.
YT trades pay the same split as PT trades, so no route is cheaper than another.

### Honest sizing

**The yield fee is the real revenue line; the swap fee is mostly LP compensation.** At the
calibrated 0.25%/yr root, a 50k PT purchase yields ~6 USDC of total fee, of which the treasury takes
~1.2. On 1M TVL at 5%, the yield fee alone is ~2,500/yr. Do not plan around swap fees at launch.

---

## 4. Rate calibration

`calibrate_the_fee_root` — the dial, swept with real numbers at 90d/5%:

| root/yr | PT round trip | YT round trip | treasury per 50k swap |
|---|---|---|---|
| 1.00% | 0.54% | 36.6% | 24.6 SR |
| 0.50% | 0.30% | 21.8% | 12.3 SR |
| **0.25%** | **0.17%** | **13.3%** | **6.2 SR** ← shipped default |
| 0.10% | 0.10% | 7.9% | 2.5 SR |
| 0.05% | 0.08% | 6.0% | 1.2 SR |
| *v1 (flat 30 bps)* | *0.60%* | *40.5%* | *n/a* |

**A YT trader feels `leverage × fee`**, and leverage at 90d/5% is ~67×. So a root that is negligible
to a PT trader is still material to a YT trader. 0.25%/yr beats v1 on *both* sides. Use 0.10% for a
YT-focused market. The *shape* is fixed; only the level is a dial.

Other settings, unchanged in spirit from v1: `scalar_root = 40e12` (price impact only now — it no
longer drives the seed ratio), `initial_apy` set per market (the anchor is derived from it).

---

## 5. A real bug found and fixed during testing

`sweep_surplus` originally swept `held − pt_cover − total_accrued` to the treasury. Testing caught
it: **it paid the treasury out of holders' unsettled interest**, and tripped the solvency assertion
on their next withdrawal.

The conservation identity is exact:

```
mint sr_in at index i0  ⇒  face = sr_in × i0
at index i:  held − pt_cover = sr_in − sr_in×i0/i  ==  EXACTLY what YT holders are owed
```

**Every stroop above PT cover belongs to some YT holder.** There is no growing post-expiry pot in a
share-based design. The fix bounds unsettled claims from below by the index at `initialize` and only
sweeps what is provably owed to nobody. Measured:

```
healthy series: surplus above PT cover = 4,838,130,014 SR (ALL owed to YT), sweepable = 1
abandoned YT:   treasury recovered 2,439,782,625 SR
```

So `tofix.md` #16 ("post-maturity surplus accrues to nobody") is **not** closed by this and is not a
revenue line. It only recovers genuinely abandoned claims. Pinned by
`a_healthy_series_has_almost_nothing_to_sweep` and `abandoned_yt_becomes_sweepable_protocol_revenue`.

---

## 6. Test coverage — 158 new tests

**`spield-yield` (31)** — SR share semantics and monotonicity; mint/redeem PY; the transfer hook
(full, partial, 10-way churn); no retroactive inheritance; top-up checkpoints the old balance;
double-claim; accrued survives disposing of every YT; expiry (mint refused, PT-only redemption,
index frozen, write-once stamp); yield fee + ceiling; surplus sweep safety; solvency across a
5-user lifecycle; non-mocked auth; and the interest math checked against its closed form.

**`spield-srmarket` (35)** — seed-ratio independence; par convergence; fee flatness; fee-root
calibration; PT buy/sell and redemption at par; YT buy/sell/partial-sale; round trips cannot extract
value; bought YT is transferable and resellable; LP SR half earns; fee split (incl. 0 bps and the
ceiling); LP exit while paused; imbalanced-deposit rejection; slippage, deadline, expiry; panic-free
quotes (empty pool, past expiry, `i128::MAX`); oversized sale refused without touching the position;
reserves ≤ actual balances; sequential-buyer depletion refusing cleanly; two non-mocked auth tests;
and the mainnet resource budget.

---

## 6b. Second testing pass — adversarial (2026-08-24)

30 more tests written specifically to break the new code. **347 total workspace tests, 0 failures.**

### Two real findings

**1. My SR doc comment overclaimed on `tofix.md` #3, and a test proved it.**
`a_guarded_strategy_still_bricks_sr_on_a_rate_dip` — the Blend adapter panics `RateOutOfBounds`
*inside* `current_rate()`, so SR never receives a value to clamp. Reads and deposits brick exactly
as in v1. The only genuine improvement is that `Sr::redeem` never reads the rate, so **the exit
survives a dip that bricks everything else**. Doc corrected; #3 stays open.

**2. Path dependence is real but not exploitable.**
The curve prices at the post-trade proportion, so slicing gets a better fill:

| slices | vs one 50k trade (5% of pool) |
|---|---|
| 2 | +0.268% |
| 5 | +0.430% |
| 25 | +0.517% |
| 100 | +0.533% |

The decisive test (`a_sliced_round_trip_still_cannot_extract_value`) shows a sliced **round trip**
still loses, converging to exactly 2× the fee, and **LP value rises in every case**:

```
  5 slices each way: trader -3,565,950,799 SR, LP value +3,067,735,485
 25 slices each way: trader -2,708,577,739 SR, LP value +2,209,933,219
100 slices each way: trader -2,547,484,603 SR, LP value +2,048,759,505
```

So the single-trade price is a conservative bound in the LP's favour; slicing converges on the fair
integral. Inherited from Pendle's convention, not an implementation fault. Worth disclosing to LPs.

### Probed and found sound

Self-transfer aliasing (YT and SR) · interest conservation under 12-step adversarial churn ·
hammering `checkpoint` 25× credits one settlement · slicing transfers/claims cannot manufacture
yield · direct SR donation does not inflate any holder's claim · burning YT releases no backing ·
`i128::MAX` and zero/negative amounts revert cleanly everywhere · allowance paths settle identically
and cannot be replayed · expired allowances are dead · matured-YT transfers move no yield · a
dormant holder can still claim after a full term · permissionless claim pays only the holder ·
sub-dust mints never consume SR without giving face.

Market: **untracked YT residue measured at 0 stroops** after 12 buys (the suspected ceil leak does
not materialise) · sandwich round trips lose and LP value rises · donations never become reserves ·
a 100-unit first LP holds 0.0999% against a 100k deposit · LP round trip returns ≤ deposit · reserves
stayed backed and the engine solvent across a 10-step mixed sequence · the expiry boundary is exact
to the second, with exits still open · trading at 48h/12h/3h/1h before expiry stays in band
(PT → 0.999994) · the treasury cut never exceeds the fee.

---

## 6c. Economic model — measured, not asserted (2026-08-25)

14 tests in `economics_test.rs` ask whether the thing actually pays, and to whom. All at the
shipped parameters, against real Blend.

### A PT buyer receives the rate they were quoted

| term | quoted | realized (held to expiry) |
|---|---|---|
| 90d @ 5% | 5.000% | **4.631%** |
| 180d @ 5% | 5.000% | **4.629%** |
| 365d @ 5% | 5.000% | **4.625%** |
| 365d @ 8% | 8.000% | **7.610%** |

The gap is the entry fee amortized over the term. And it is **tenor-independent** — 30d 4.633%,
90d 4.631%, 180d 4.629%, 365d 4.625%: a **0.007pp spread across a 12x range of tenors**. A venue
whose annualized rate depended on tenor would only work for one maturity.

### LPs come out ahead

* **+1.0806%** over 160 days of balanced two-way flow (PT valued at market price, not face).
* **+0.4189%** on the SR half alone over a year with **zero trades** — pure strategy yield on the
  half that earns *exactly nothing* in a PT/USDC pool. That is the structural win of pairing
  against SR.

### The two revenue lines, sized

| | measured |
|---|---|
| Swap fees | 250,000 USDC of volume -> **30.81 USDC** to treasury (**1.23 bps of volume**); LPs kept ~123.25 |
| Yield fee | 500k face for a year -> gross 4,038.90 USDC -> holder 3,836.96 + **treasury 201.95** (exactly 5%) |

**The yield fee is ~6.5x the swap revenue at these volumes.** It scales with TVL rather than with
trading, which is the more reliable base. Do not plan around swap fees at launch — that conclusion
now has numbers behind it.

Treasury SR is real: `treasury_revenue_is_actually_withdrawable` unwraps it to USDC.

### Nothing leaks

* **PT buy:** user paid 500,000,000,000 SR -> pool 499,750,312,240 + treasury 249,687,760. Exact.
* **YT buy (incl. the refund leg):** user 10,388,328,941 + pool 189,706,595,500 = engine
  200,000,000,000 + treasury 94,924,441. Exact.
* **PT + YT = 10,016.89 vs 10,000 face (+0.169%)** — the two legs track the underlying inside the
  fee band, so there is no arbitrage against the pool.

### YT is winnable, not a trap

Break-even realized APY vs. the pool's implied rate: **5.231% vs 5.000%** at 180d, **5.097% vs
5.000%** at 365d. A YT buyer needs realized yield ~0.1–0.23pp above the implied rate. If break-even
sat far above the implied rate the product would be structurally unwinnable; it does not.

### It survives a busy term

`the_model_survives_a_full_term_of_mixed_activity` runs 9 rounds of PT buys, YT buys, YT sales with
claims, and PT sales, asserting at **every step** that the engine is solvent, both reserves stay
backed by real balances, and `treasury_earned` never goes backwards. It also proves an idle account
cannot gain at anyone's expense.

---

## 7. What is deliberately NOT done

Be clear-eyed about the gap between "works" and "shippable":

1. **No migration path.** v1 and this stack coexist. Moving TVL is unspecified.
2. ~~No deploy scripts~~ — **done.** `deploy_sr_testnet.sh` is resumable and self-verifying, with
   the issuer lockdown rehearsed end to end (`TESTNET_SR.md`).
3. ~~No SDK or frontend wiring~~ — **done, and the whole dApp now runs on this stack.**
   `frontend/src/lib/srstack.ts` is a full typed client, and the dashboard was migrated off v1
   entirely (see below).
4. **No secondary rewards.** SY standardizes `claimRewards` / `getRewardTokens`; SR does not. Blend's
   BLND emissions are still unsurfaced.
5. ~~No router / zap~~ — **done 2026-08-25.** `contracts/srrouter` gives one-signature
   `USDC → PT/YT` in both directions plus `claim_yield_to_usdc`, matching Pendle's
   `swapExactTokenForPt` shape. 28 tests, including explicitly-authorized ones that `mock_all_auths`
   cannot see.
6. **No limit order book.**
7. **Exit liquidity is surfaced, not solved.** `Sr::max_redeemable` and `Sr::redeem_partial` let a
   user see a venue crunch coming and take what is available instead of reverting — but they do not
   create liquidity. If Blend is fully drawn down, the remainder waits. The vault has no partial
   path of its own at all.
8. ~~No governance surface~~ — **done 2026-08-25.** All three contracts now expose two-step admin
   rotation and a bounded 24h upgrade timelock via `spield_shared::governance`, verified on chain
   (see `TESTNET_SR.md`). 14 dedicated tests in `governance_test.rs`.
9. **Not audited.** New token contracts, a new interest ledger, and a new curve. The single most
   security-sensitive line in the codebase is now `before_yt_change`, and it has never been reviewed
   by anyone but this test suite.
10. **The harness's Blend rate is low** (~0.4–1.9%/yr). Every yield figure above is a mechanism check,
   not a mainnet forecast.

---

## 7b. The dApp migration — one file, not twenty

The dashboard was built against v1: every chart, stat tile, panel and feed. Pointing all of it at
the SR stack could have meant editing twenty-odd components. It did not, because none of them talk
to a contract — they consume a **shape**, supplied by `ProtocolContext`.

So `frontend/src/lib/v2adapters.ts` keeps the shapes and swaps what fills them. Every export has the
same signature and return type as its v1 counterpart and reads the SR stack instead; the context
imports from there, and the components are untouched.

Where the two models genuinely differ, the mapping is documented at the function rather than papered
over:

| v1 concept | v2 reality | What the adapter does |
|---|---|---|
| A numbered position per deposit | PT/YT are fungible bearer tokens — there is no position, which is exactly what makes `tofix.md` #18 inexpressible | Returns **one synthetic row** for the wallet's whole holding. The panel labels it "Your PT + YT position" rather than showing a meaningless `#0`. |
| USDC everywhere | SR is a *share*, and `1 SR ≠ 1 USDC` | Converts at the live rate before any figure reaches a component, because every component's label says USDC. |
| PT **and** YT trustlines | YT is a contract, not a classic asset | Reports `yt: true`, so `ready` keeps meaning "this wallet can receive what it is about to be sent". |
| Blend position value vs principal | SR held vs SR owed | Converts, and uses `total_py` for principal rather than the engine's `needed` — which folds in credited yield and would overstate the principal leg. |

What moved with it: the yield chart now reads SR's rate history, the market chart reads the PT/SR
pool's swaps, the activity feed watches sr/yield/market/vault (deliberately **not** the router — its
events would double every row, since a routed trade already appears as the `sr_deposit` and `swap`
it actually performed), and the solvency card links to the engine that enforces the invariant.

Two flows are honestly two transactions — minting PY and adding liquidity, because both need SR and
wrapping does not fit alongside them. They return **step lists** so the UI shows "1 of 2" instead of
one spinner spanning two wallet prompts, which is the moment people cancel.

The v1 modules stay in the tree. They still address the live mainnet deployment, which exists and
can be read; nothing in the dashboard points at them any more.

---

## 8. Files

```
contracts/sr/          Cargo.toml  src/{lib,storage,events,test}.rs
contracts/yield/       Cargo.toml  src/{lib,storage,interest,events,test}.rs
contracts/srmarket/    Cargo.toml  src/{lib,storage,curve,events,test}.rs
contracts/srvault/     Cargo.toml  src/{lib,storage,events,test}.rs
contracts/srrouter/    Cargo.toml  src/{lib,storage,events,test}.rs
contracts/shared/src/token.rs              (new, additive)
contracts/shared/src/{errors,lib}.rs       (new error codes 88, 100–106; module registration)
Cargo.toml                                 (three new workspace members)
```

Reproduce:

```bash
cd website/contract/spield
cargo test --workspace
cargo test -p spield-srmarket -- --nocapture calibrate_the_fee_root \
  any_seed_ratio_opens_the_pool_at_the_configured_rate \
  the_fee_is_a_constant_share_of_the_yield_at_every_maturity \
  every_path_fits_the_mainnet_per_transaction_budget
cargo test -p spield-yield -- --nocapture the_v1_stranding_bug_is_gone \
  a_healthy_series_has_almost_nothing_to_sweep
```

See [`comparependle.md`](./comparependle.md) for what each of these fixes was measured against, and
[`futureamm.md`](./futureamm.md) for the earlier PT/USDC prototype this supersedes.
