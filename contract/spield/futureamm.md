# futureamm.md — feasibility review of the PT/YT AMM trading + yield-settlement spec

**What this is:** the result of actually *building* the proposed design against the live contracts
and measuring it, not a paper review. Everything below is a number produced by a test in
`futureamm-prototype.patch`, running against the **real Blend v2 WASM**, the real strategy adapter,
the real wrapper, and the real curve. Nothing in the YT path is mocked.

**Verdict in one line:** the mechanism is **feasible and materially simpler than the flash-lend
router already planned in `FEATUREPLAN_BUY_YT.md`** — but at the **current fee model and the
current deploy parameters it is not economically shippable**, and it needs a wrapper position-model
change that the spec correctly identifies and the codebase does not yet have.

Verified against the working tree on **2026-08-23**.

| | |
|---|---|
| Baseline suite | **251 tests green** |
| With the prototype | **289 tests green** (38 new, **0 regressions**) |
| Contract code added | **403 lines** (wrapper 138, market 204, curve 42, shared trait 8, storage 11) |
| Test code added | **1,008 lines** |
| Release WASM | market 73,853 → **84,159** (+14.0%), wrapper 79,521 → **84,932** (+6.8%) |
| Build | `wasm32v1-none` release clean |

---

## 1. Verdict table

| Question | Answer | Evidence |
|---|---|---|
| Can the AMM fund the notional without a flash loan? | **Yes** | `buy_yt_costs_only_the_yt_price_not_the_notional` |
| Does it work under *enforced* (non-mocked) auth? | **Yes** | `buy_yt_works_with_only_the_users_signature` |
| Does it fit the mainnet per-tx budget? | **Yes, comfortably** | 16.9% / 29.4% of the memory ceiling |
| Does the wrapper stay solvent? | **Yes** | `buy_yt_mints_matched_pt_and_yt_and_leaves_the_wrapper_solvent` |
| Are claims + maturity redemption AMM-independent? | **Yes** (spec §4.6/§4.7 hold) | `yt_selling_is_impossible_once_the_market_has_expired` |
| Is checkpoint-before-amount-change correct? | **Yes** (spec §4.5) | `a_partial_yt_sale_leaves_the_remainder_accruing_from_the_new_index` |
| Is it economically viable **as configured today**? | **No** | round-trip costs **40.5%** of the YT price at the mainnet default |
| Does the existing position model support it? | **No** | needs a real refactor — §4.2 below |

---

## 2. What I built

The spec's §8.2 call direction — `User → Market → Wrapper` — turns out to be the whole trick, and
it is **strictly better than the chosen design in `FEATUREPLAN_BUY_YT.md`**.

```
wrapper:  split_for_market(market, yt_recipient, amount) -> position_id
          merge_for_yt_sale(market, position_id, amount) -> (principal, yield_claimed)
          set_market(market)                                     [admin]

market:   buy_yt_exact_out(user, yt_out, max_usdc_in, deadline)  -> usdc_paid
          sell_yt_exact_in(user, position_id, yt_in, min_out, deadline) -> (usdc_out, yield)
          quote_buy_yt_exact_out(yt_out)   -> (user_in, pool_contribution)
          quote_sell_yt_exact_in(yt_in)    -> (user_out, pool_retained)

curve:    try_usdc_in_for_exact_pt(...)    exact-output mirror of try_swap_usdc_for_pt
```

### 2.1 The insight that makes it cheap

A capital-efficient YT trade is **economically one ordinary swap**. Proven bit-for-bit:

> `buy_yt_moves_reserves_exactly_like_selling_that_pt_into_the_pool` — two identical worlds; in one
> a user buys `N` YT, in the other someone sells `N` PT. **The reserves end identical.**

So the pool never needs to lend itself anything. It just prices the PT leg it is about to receive,
funds the difference out of the reserve it was going to spend anyway, and the wrapper mints the two
legs to two different addresses in the same call.

| | `FEATUREPLAN_BUY_YT.md` (Option C, flash-lend) | This spec (§8.2) |
|---|---|---|
| New contracts | **1** (`PeripheryRouter`) | **0** |
| Flash loan | Yes — advance + repay-or-revert | **None** |
| Router allowlist / `set_router` governance | Required | Not needed |
| Callback re-entry shape | **"UNVALIDATED — prototype first" (§6.2)** | **Eliminated** |
| Reserve bookkeeping across a nested swap | **"the main design question" (§6.1)** | Single update, exact |
| On-chain solver for `N` | Newton/bisection required (§6.5) | **Not needed** for exact-output |
| Touches the audited wrapper | No | **Yes** — 2 new entrypoints |

The last row is the trade: this design buys away every open question in the flash-lend plan by
adding two entrypoints to the wrapper instead. Given that §6.2 was the *only* piece the feature
plan called unvalidated, and it is now gone, that is a good trade.

### 2.2 Exact-output needs no solver

`FEATUREPLAN_BUY_YT.md` §6.5 worried about an on-chain `solve_n_for_budget`. In the exact-output
direction the answer is closed-form: the pool receives exactly `N` PT, so its contribution is just
`quote_pt_for_usdc(N)` and the user pays `N − that`. One curve evaluation, no iteration.

Only the exact-*input* variant (`buy_yt_exact_in(budget)`) needs a solver, and it is optional.

---

## 3. Plus points

**1. It works end to end, against real Blend.** 38 new tests, all green, zero regressions across
the wrapper, vault, strategy and shared suites.

**2. The one previously-unvalidated risk is gone, and I proved it.** Under `mock_auths` with
**only the user's signature** — no `mock_all_auths` — the market successfully pulls the full
notional into the wrapper on its own contract authority. `set_auths(&[])` refuses the trade, and a
stranger cannot force-close someone else's position. The `authorize_as_current_contract` pattern is
a byte-for-byte reuse of the vault's already-deployed `authorize_mint`.

**3. It fits mainnet with room.** Ceilings: 600M instructions, 41,943,040 bytes memory, 50 write
entries, 100 ledger entries, 132,096 write bytes.

| operation | instructions | memory | write | entries | wbytes |
|---|---|---|---|---|---|
| `swap_exact_pt_for_usdc` (baseline) | 3,373,288 (0.6%) | 326,905 (**0.8%**) | 6/50 | 16/100 | 1,844 |
| `buy_yt_exact_out` | 9,458,634 (1.6%) | 7,086,571 (**16.9%**) | 13/50 | 38/100 | 4,416 |
| `sell_yt_exact_in` (partial) | 13,686,500 (2.3%) | 12,325,717 (**29.4%**) | 13/50 | 36/100 | 4,872 |

The cost is dominated by Blend round-trips (~6.8 MB each, matching `tofix.md` §18): a buy does one
supply, a sell does two withdraws (yield claim + principal release).

**4. Reserve accounting is exact, not approximate.** `assert_reserves_backed` checks accounted
against actual after every YT trade, and it holds on the nose:
`buy_yt_keeps_stored_reserves_equal_to_real_token_balances` and its sell counterpart both assert
equality, not a tolerance.

**5. It never weakens the solvency invariant.** Unlike `FEATUREPLAN` Option B, the wrapper is never
in a temporarily-unbacked state — the USDC arrives before the mint, exactly as in `mint`.
`assert_solvent` runs unchanged and passes.

**6. Spec §4.6 and §4.7 hold.** Yield claims and maturity redemption are provably independent of
the AMM: past maturity `quote_sell_yt_exact_in` returns `(0,0)` and the sale reverts, while
`claim_yield` still pays.

**7. Spec §4.5 (checkpoint-before-amount-change) is correct.** A partial sale credits the yield
earned on the **full old amount** before reducing it, then the remainder accrues from the new index
— asserted exactly, not approximately.

**8. Theta comes free from the existing curve.** No new time-decay machinery was needed. A 10,000
YT position bought for 770.96 decays linearly and hits exactly zero at maturity:

```
day   0: resale 712.87     day 180: resale 346.43
day  60: resale 590.72     day 300: resale 102.19
day 120: resale 468.57     day 360: resale   0.00  <- unsellable
```

**9. LPs are never liquidated.** Heavy YT flow pushes LP inventory toward PT (19.36M → 19.76M PT,
1.00M → 0.63M USDC over 8 buys) and the LP can still exit proportionally at any time. The 0.5%–99.5%
proportion band hard-reverts before the pool can be drained.

**10. Donations can't be weaponized.** Stored reserves stay authoritative; a 50,000 PT donation
changes no quote.

**11. Spec §11.5 Rule A is already implemented.** `stamp_maturity_rate` + the write-once maturity
ceiling is exactly Rule A, and it already behaves correctly for market-issued YT: accrual stops at
settlement and stays stopped.

---

## 4. Drawbacks

Ranked by whether they block shipping.

### 4.1 **P0 — the fee model makes YT trading uneconomic**

This is the finding that matters most, and it is not a bug in the spec — it is a collision between
the spec and Spield's existing flat-bps fee.

The fee is charged on the **notional**, but the YT buyer only pays `1 − PT_price` of that notional.
So the fee the YT trader actually feels is **leverage × fee_bps**.

At the `deploy_mainnet.sh` defaults **as of this analysis** — 90-day term, 5.00% target APY, 30 bps
fee, `scalar_root = 40` — buying and immediately reselling 10,000 YT:

> The target APY default has since been calibrated down to **3.00%** (`MAINNET.md` §8). That changes
> the PT price these rows start from, not the shape of the leverage arithmetic.

| term | seed ratio | PT price | 10k YT costs | leverage | instant resale | **round-trip cost** |
|---|---|---|---|---|---|---|
| **90d (the default)** | 7.0:1 | 0.98804 | 149.92 | **66.7×** | 89.16 | **40.5%** |
| 180d | 6.9:1 | 0.97623 | 268.40 | 37.3× | 206.98 | 22.9% |
| 365d | 6.7:1 | 0.95238 | 507.51 | 19.7× | 444.78 | 12.4% |

Sweeping implied APY on a 1-year pool shows the same law — the lower the yield, the higher the
leverage, the worse the fee bites:

| implied APY | PT price | 10k YT costs | leverage | instant resale | round-trip cost |
|---|---|---|---|---|---|
| 0.5% | 0.9950 | 84.11 | 118.9× | 15.26 | **81.9%** |
| 1% | 0.9901 | 132.85 | 75.3× | 65.05 | 51.0% |
| 2% | 0.9804 | 229.07 | 43.7× | 162.98 | 28.8% |
| 4% | 0.9615 | 416.40 | 24.0× | 352.74 | 15.3% |
| 8% | 0.9259 | 770.96 | 13.0× | 710.44 | 7.8% |

Below roughly **0.4% implied APY the fee exceeds the entire value of the YT** and the sale quote
goes to zero from day one — the market is dead on arrival, not merely expensive.

Re-pricing the same 90-day pool across fee levels shows what would actually be needed:

| fee | 10k YT costs | instant resale | round-trip cost |
|---|---|---|---|
| 30 bps (current) | 149.92 | 89.16 | **40.5%** |
| 10 bps | 130.16 | 109.00 | 16.3% |
| 5 bps | 125.22 | 113.95 | 9.0% |
| 2 bps | 122.26 | 116.91 | 4.4% |
| 1 bps | 121.27 | 117.90 | 2.8% |

**A single flat notional fee cannot serve both sides.** PT traders need ≥30 bps to pay LPs for
inventory and rate risk; YT traders need ≤5 bps to not be destroyed. This is precisely why Pendle
V2 charges its fee **on the exchange rate / implied yield** (`feeRate = exp(lnFeeRateRoot ×
timeToExpiry)`) rather than on notional — the fee then scales with the interest component, which is
the thing the YT trader is actually buying.

The spec never mentions this. It says (§6.2) "user_usdc_in = N − pt_sale_value + YT fees" and leaves
"YT fees" undefined. **That undefined term is the whole product.**

> Tests: `the_swap_fee_is_charged_on_the_notional_not_on_the_yt_price`,
> `below_a_minimum_implied_apy_the_notional_fee_exceeds_the_whole_yt_value`,
> `yt_economics_at_the_actual_mainnet_deploy_parameters`, `what_fee_a_90_day_yt_market_would_need`

### 4.2 **P0 — the wrapper's position model cannot express what the spec needs**

The spec's §5 wants one aggregate `YieldPosition {owner, active_yt, settled_index, claimable_yield}`
per (series, user), with PT as a pure bearer claim. The wrapper's `Position` instead bundles
**PT + YT + principal + Blend shares** into one record per mint, and `split_position` says so
explicitly: *"There is no PT-only or YT-only split."*

I found a YT-only position **is** representable (`pt_amount = 0`, `principal = yt_amount`), and
Blend's share math still gives exactly the right yield — the wrapper's own `redeem_pt_bearer`
doc-comment proves why. But four things break:

**(a) Bundled positions cannot use the sale path at all.** `merge_for_yt_sale` reduces
`pos.principal`; a bundled position would then have `principal < pt_amount`, and `principal ==
pt_amount` is load-bearing for `redeem_pt` and `split_position`. My prototype **refuses** bundled
positions rather than corrupt them. Consequence: **an ordinary `wrapper.mint` user cannot sell
their YT on the AMM.** Only market-issued YT is sellable. Two incompatible classes of YT.
> Test: `a_bundled_pt_yt_position_cannot_be_sold_through_the_yt_path`

**(b) PT conservation has to be restated.** Today `Σ pos.pt_amount == PT_supply + bearer_redeemed`.
Market-issued PT increments supply with no position to match, so this becomes
`Σ pos.pt_amount + market_issued_pt == PT_supply + bearer_redeemed`. That directly affects the
conservation check `tofix.md` **#23** is asking the solvency monitor to add — it must be written
against the *new* form, or it will fire spuriously the moment the first YT is bought.

**(c) Every buy opens another position.** Five YT buys by one user produce position ids
`[1,2,3,4,5]`, one fungible YT balance of 10,000 — and **five separate `claim_yield` calls**. The
spec's §5 explicitly warns about this ("dozens of independent positions that must later be selected
and reconciled") and warns that the same SAC balance can appear to back several independent claims.
It also feeds `tofix.md` **#18/#25**, which are already about unbounded position growth.
> Test: `every_yt_buy_opens_another_position_the_user_must_manage_separately`

**(d) `ClaimMode::CreditOnly` is not expressible.** `Position` has no `claimable_yield`
accumulator; `do_claim` pays out immediately via `strategy.redeem_underlying`. So the spec's §9.1
`CreditOnly` — checkpoint without withdrawing — cannot be built without a new field. That matters
for the spec's own §9.5 failure story: if Blend withdrawal liquidity is short, the **entire sale
reverts** instead of degrading to credit-only.

### 4.3 **P0 — the seed the curve demands floods Blend and destroys the yield being sold**

To open the pool at a target implied APY, `seed_pt_for_apy` requires a very PT-heavy pool. Every PT
in that seed is a **real USDC deposit into Blend**.

Opening a 1,000,000-USDC-side pool at **8% / 1 year** requires **17,343,601 PT** — i.e. 17.34M USDC
pushed into the Blend pool. Measured effect on realized yield for an ordinary 100k depositor:

```
1-year realized yield on 100k:   no seed  1,923.29 USDC (1.923%)
                                with seed     16.50 USDC (0.016%)   <- 117x collapse
```

Two separate problems here:

* **Capital requirement.** 7:1 PT:USDC at the 90-day default, ~17:1 at 1 year / 8%. The LP must
  source that PT by depositing that much USDC through the wrapper. This is a *pre-existing* property
  of `scalar_root = 40`, but PT trading tolerates it and YT does not.
* **Reflexivity.** The seed suppresses the utilization of the underlying Blend pool, which suppresses
  `b_rate`, which is the only thing YT is a claim on. The bigger the market, the worse the product it
  sells. Severity on mainnet depends entirely on Spield's seed size relative to Blend's live USDC
  pool — **that ratio must be measured before sizing anything.**

> Test: `the_seed_needed_to_open_the_curve_floods_blend_and_kills_the_yield_it_sells`

### 4.4 **P1 — nothing on chain reconciles implied APY with realized APY**

The pool's implied APY is chosen by hand at seed time. Blend's realized APY is whatever Blend does.
Nothing ties them.

```
pool IMPLIED APY 8.297%   |   Blend REALIZED over the term 0.0149%
YT buyer paid 7,938.71 and earned 14.89  ->  TOTAL LOSS
```

(That specific realized figure is dominated by 4.3's flooding effect, not a mainnet forecast — but
the *structural* point stands independently: the two numbers are unlinked.)

PT tolerates a mispriced seed — it is a fixed claim redeemable at par, and the LP absorbs the error.
**YT is pure leveraged exposure to exactly that gap**, so a seed set 2 points above Blend's real rate
transfers the entire YT premium from buyers to LPs, systematically, every trade. The spec's §6.1
insistence that the price is "an economic relationship, not permission to hardcode" is right, and
the current seed calibration is the hardcode.

### 4.5 **P1 — market-issued YT widens the transfer-stranding hazard (`tofix.md` #15)**

The wrapper's ledger, not the token, is the claim. Proved end to end:

> Alice buys 10,000 YT, transfers **all of it** to Bob, waits 90 days, and **still claims every
> stroop**. Bob's YT is inert and claims 0. Worse, Alice can no longer *sell* either — the merge
> burns from `pos.owner`, whose balance is now zero — so she is stuck holding a claim she cannot
> exit.
> Test: `a_raw_yt_transfer_still_strands_the_claim_and_the_market_path_does_not_fix_it`

The spec acknowledges this (§3.3, §10.5, §12.14) and says "the app must not expose a generic YT
transfer feature". That is a product control over a *token* anyone can move. Today the exposure is
bounded by how many people mint; market-issued YT multiplies the holder count, and every one of them
is one wallet action away from stranding themselves.

### 4.6 **P1 — the spec's entire liquidity-safety layer is unbuilt**

Sections §12.5.2, §12.5.3 and §12.5.6 specify hard USDC floors, per-trade caps
(`max_trade_bps`), rolling-window outflow limits, four `MarketLiquidityMode` states, and monitoring.
**None of it exists**, in the prototype or in `market`. What exists today is the curve's 0.5%–99.5%
proportion band, which does hard-revert — so the failure mode is "YT buying stops", never "LPs
wiped" — but it is a blunt instrument that fires only at the very edge.

Also unbuilt: the spec's `Quote` struct with `price_impact_bps` / `implied_yield` /
`valid_until_ledger`, the §17 error taxonomy (my prototype reuses `InsufficientLiquidity` and
`NotAuthorized` where the spec wants `InsufficientUsdcLiquidity`, `ReserveFloorBreached`,
`InsufficientActiveYtPosition`, …), and the §11 five-state `SeriesState` machine (the wrapper has a
binary pause plus a maturity gate).

`assert_reserves_backed` is also **one-sided** — it catches accounted > actual but not a donation
making actual > accounted, which the spec's §12.5.5 wants surfaced.

### 4.7 **P2 — `buy_yt_exact_out` hands back no position handle**

It returns only the USDC paid. The caller has no idea which `position_id` was opened, so the
frontend cannot claim or sell against it without scanning. I had to add a `next_position_id()` view
just to write the tests. Either return the id, or adopt the spec's aggregate model where there is no
id to return.

### 4.8 **P2 — a YT sale burns two Blend round-trips in one transaction**

29.4% of the mainnet memory ceiling. Fine for a single user action, but it forecloses ever batching
sales, and it sits in the same territory that made `tofix.md` §18 cap `MAX_HARVEST_BATCH` at 3.

---

## 5. What would have to change before this ships

In dependency order.

| # | Change | Why | Size |
|---|---|---|---|
| 1 | **Replace the flat notional fee with a rate-based fee** (Pendle's `exp(lnFeeRateRoot × t)` on the exchange rate) | §4.1 — without this the product is 40% round-trip and nobody trades it twice | curve rewrite + recalibration |
| 2 | **Refactor `Position` into a YT-side yield ledger with PT as pure bearer liability** | §4.2 — otherwise there are two incompatible classes of YT and bundled holders are locked out | invasive; re-audit |
| 3 | Add `claimable_yield` to the position record | §4.2(d) — makes `CreditOnly` and graceful Blend-liquidity degradation possible | small, but part of 2 |
| 4 | **Size the seed against Blend's live USDC pool, and lower `scalar_root`** | §4.3 — 17:1 seeds are both unaffordable and self-defeating | config + simulation |
| 5 | Tie the seed's implied APY to an observed Blend rate, or publish the gap | §4.4 | design decision |
| 6 | Build §12.5.2/§12.5.3 floors, caps, window limits, liquidity modes | §4.6 | medium |
| 7 | Restate the PT conservation check before `tofix.md` #23 lands | §4.2(b) | small, but ordering matters |
| 8 | Return the position id from `buy_yt_exact_out` | §4.7 | trivial |
| 9 | Make `assert_reserves_backed` two-sided | §4.6 | trivial |
| 10 | Rehearse the whole path on testnet | mocked-Blend ≠ real Blend liquidity | ops |

**Also unchanged from `FEATUREPLAN_BUY_YT.md` §5 and still true:** this feature fixes *capital
efficiency*, not *thin liquidity*. Seeding the pool properly and leading with PT remain the
prerequisites regardless of when YT trading ships.

---

## 6. Where the spec is right, and where it is silent

**Right, and worth keeping:**

* §8.2's call direction is the correct one and removes the flash-lend design's only unvalidated risk.
* §4.5 checkpoint-before-amount-change — implemented and verified.
* §4.6 / §4.7 AMM-independence of claims and redemption — implemented and verified.
* §12.17's one-direction call graph — satisfied naturally.
* §12.11's "stored reserves are authoritative" — already the market's policy; verified.
* §11.5 Rule A — already implemented as `stamp_maturity_rate`.
* §5's warning about per-position fragmentation — correct, and §4.2(c) is the measurement.
* §12.5.1's insistence that USDC depletion is a *liquidity condition, not liquidation* — correct,
  and the proportion band already enforces it.

**Silent, and it matters:**

* **The fee.** §6.2 writes "+ YT fees" and never defines it. That term is the difference between a
  product and a toy (§4.1).
* **Where the implied yield comes from.** §6.1 forbids hardcoding the YT price but never says what
  sets the curve's anchor against the strategy's real rate (§4.4).
* **The cost of the seed.** No section connects AMM seed depth to the yield source's utilization
  (§4.3).
* **Migration.** No section addresses what happens to YT already minted under the bundled model
  (§4.2a).

---

## 7. Reproducing

The prototype is a single patch against the tree as of 2026-08-23:

```bash
cd website/contract/spield
patch -p1 < futureamm-prototype.patch
cargo test --workspace                      # 289 green
cargo test -p spield-market -- --nocapture \
  the_swap_fee_is_charged \
  yt_economics_at_the_actual_mainnet_deploy_parameters \
  what_fee_a_90_day_yt_market_would_need \
  the_seed_needed_to_open \
  yt_trades_fit_the_mainnet_per_transaction_budget
```

**The patch is a feasibility probe, not a merge candidate.** It deliberately guards rather than
solves §4.2 (bundled positions are refused, not migrated), and it implements none of §4.6's safety
layer. Its value is the 38 tests and the numbers in §3 and §4.

### The 38 tests, by what they establish

| Area | Tests |
|---|---|
| Capital efficiency works | `buy_yt_costs_only_the_yt_price_not_the_notional`, `buy_yt_leverage_ratio_is_reported` |
| A YT trade *is* a PT swap | `buy_yt_moves_reserves_exactly_like_selling_that_pt_into_the_pool`, `yt_buying_and_pt_selling_consume_the_same_reserve` |
| Accounting matches reality | `buy_yt_keeps_stored_reserves_equal_to_real_token_balances`, `sell_yt_keeps_...`, `buy_yt_mints_matched_pt_and_yt_and_leaves_the_wrapper_solvent` |
| Yield correctness | `the_bought_yt_position_is_yt_only_and_earns_only_from_the_purchase_onward`, `bought_yt_accrues_and_claims_real_blend_yield`, `sell_yt_pays_the_yt_value_and_checkpoints_yield_on_the_old_amount_first`, `a_partial_yt_sale_leaves_the_remainder_accruing_from_the_new_index` |
| No value extraction | `an_immediate_buy_then_sell_round_trip_cannot_extract_value` |
| Guardrails | `buy_yt_reverts_when_the_price_exceeds_max_usdc_in`, `sell_yt_reverts_below_min_usdc_out`, `buy_yt_reverts_past_its_deadline`, `selling_more_yt_than_the_position_holds_reverts`, `a_yt_sale_larger_than_the_pools_pt_reserve_reverts_and_changes_nothing` |
| Auth, unmocked | `buy_yt_works_with_only_the_users_signature`, `a_stranger_cannot_sell_someone_elses_yt_position`, `no_signature_at_all_means_no_yt_trade`, `an_unregistered_caller_cannot_split_for_a_market` |
| Lifecycle | `a_yt_only_position_settles_correctly_at_maturity`, `yt_selling_is_impossible_once_the_market_has_expired`, `pt_bought_by_the_pool_in_a_yt_trade_still_redeems_at_par_at_maturity` |
| Liquidity behaviour | `repeated_yt_buying_raises_the_price_and_eventually_the_band_refuses`, `heavy_yt_buying_turns_the_lp_position_into_mostly_pt`, `a_pt_donation_does_not_become_tradeable_yt_capacity` |
| **The drawbacks** | `the_swap_fee_is_charged_on_the_notional_not_on_the_yt_price`, `below_a_minimum_implied_apy_...`, `yt_economics_at_the_actual_mainnet_deploy_parameters`, `what_fee_a_90_day_yt_market_would_need`, `how_long_a_yt_position_stays_sellable`, `the_seed_needed_to_open_the_curve_floods_blend_and_kills_the_yield_it_sells`, `the_pools_implied_apy_is_not_reconciled_with_blends_realized_apy`, `a_bundled_pt_yt_position_cannot_be_sold_through_the_yt_path`, `every_yt_buy_opens_another_position_the_user_must_manage_separately`, `a_raw_yt_transfer_still_strands_the_claim_and_the_market_path_does_not_fix_it` |
| Budget | `yt_trades_fit_the_mainnet_per_transaction_budget`, `how_fast_the_harness_blend_rate_actually_grows` |

---

## 8. Bottom line

**Build it — but not in this order.**

The plumbing is sound, cheaper than the flash-lend router, and already passes 38 tests against real
Blend. The mechanism is not the risk.

The risk is that shipping it as specified produces a market where a round trip costs **40.5%** of
the position, where **only market-issued YT can be sold**, and where the liquidity needed to open
the pool **suppresses the yield the product exists to sell**. Those three are all fixable, none are
in the AMM code, and all three are cheaper to fix *before* the contracts are written than after.

Fix the fee model first (§5.1). Everything else follows from having a market anyone would use twice.
