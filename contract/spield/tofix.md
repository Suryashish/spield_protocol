# tofix.md — what is still open

Everything closed in the **current SR/yield/srmarket/srvault/srrouter edition** has been removed from
this document. What remains is only what still needs a **decision**, an **action**, or a **deploy
step**. Where an item is half done, only the unfinished half is described.

Item numbers are the originals so `testcando.md` cross-references and git history still line up.

Severity legend — **P0** = must close before the first seed transaction; **P1** = close before
meaningful TVL; **P2** = documentation / belt-and-braces.

---

## Verification basis — 2026-08-26

Everything below was re-tested this round, not carried forward on trust.

**Local suite: 509 Rust tests, all green** (was 491 at the start of this round).

| crate | tests | | crate | tests |
|---|---:|---|---|---:|
| `market` (v1) | 69 | | `sr` | 29 |
| `wrapper` (v1) | 74 | | `yield` | 59 |
| `vault` (v1) | 43 | | `srmarket` | 101 |
| `strategy` | 13 | | `srvault` | 36 |
| `shared` | 56 | | `srrouter` | 29 |

Release WASM (`wasm32v1-none`) builds clean, **zero warnings**, after a forced rebuild.
SDK: **218 tests pass**, through the documented `pnpm run test:unit`.

### Fixed this round — 2026-08-26

Eleven items were implemented and tested; reasoning and measurements are in
[`V2_WORK.md`](./V2_WORK.md). They are marked rather than deleted, because most leave a follow-on.

| # | What was fixed |
|---|---|
| **34** | `sync_implied_rate` anchors pre-trade and prices post-trade — the quote responds to flow and scales with size |
| **26b** | `shares > 0` guard on the follow-on LP branch |
| **26c** | `min_shares` on `add_liquidity`; the 0.1% band is now the `min_shares == 0` default |
| **20** | `srvault::redeem` is resumable — banks progress, invariant widened to `pt + collected >= liability` |
| **20** | `strategy::available_liquidity` computes the real utilization cap; the raw balance overstated it by **12.8%** on the live pool |
| **22** | `srvault::sweep_surplus` recovers SR, YT and USDC, expiry-gated, reserving collected USDC |
| **23a** | The v1 monitor's vault probe reads `stats()` — passes against the live deployment |
| **23b** | `scripts/package.json` — both monitors start from their own directory, on a protocol-23 SDK |
| **23c** | The 11 counterfeit stroops burned; the v2 watchtower reports all six invariants holding |
| **30** | Three TTL bump entry points + the full `srvault` SDK surface; `pnpm run test:unit` works |
| **3** | **Description corrected** — a dip freezes exits, recovery is admin-gated, and the loss is pro-rata. `RiskDisclosure.tsx` fixed to match |

**Two test-fidelity fixes behind those.** `sr::test`'s mock strategy diverged from the real adapter
on `redeem` — the one path its headline test was named for — which produced the false claim in item
3. And `economics_test::an_idle_participant_cannot_gain_at_anothers_expense` asserted an LP cannot
lose, which held only while `pt_price()` was frozen; it now measures fees and impermanent loss
separately.

**None of it is on chain yet.** `add_liquidity` is a four-argument function, `Receipt` has a new
field, and `available_liquidity` computes differently — so the v2 stack needs a redeploy, and
**`strategy` must be upgraded in the same cycle as `sr`/`srvault`**, since both now depend on the
new `available_liquidity`.

---

## ⚠ The finding that changes several items: deployed binaries lag source

This was assumed away in every previous round and is not true. The deployed v1 contracts are **not**
the source tree, and the gap silently invalidates mitigations that this document previously recorded
as available.

Read from chain 2026-08-26 (`stellar contract info interface`, mainnet and testnet agree):

| contract | in source but **NOT deployed** | deployed matches source? |
|---|---|---|
| **wrapper** | `redeem_pt_bearer`, `split_position`, `open_positions`, `bearer_redeemed`, `stamp_maturity_rate`, `maturity_rate` | ❌ six functions missing |
| **strategy** | `reset_rate_floor`, `available_liquidity` | ❌ two functions missing |
| **market** | `seed_pt_for_apy`, `wrapper` | ❌ two functions missing |
| **vault** | — | ✅ identical |

Confirmed by hash, not just by interface:

```
mainnet wrapper code_hash   94b3c032a5701c727281c82ede3ec446c7b452bf0387a47daa2606fbcd68f361
current source builds to    5706b2567e8768447d2881829e7932ba72f65d9cba50504b25a3c1a4431070c7
```

`version()` is **useless** for spotting this — mainnet, testnet and source all answer
`"spield-wrapper-0.1.0"`. Only `code_hash` and the interface diff are reliable, which is exactly what
the wrapper's own doc comment says. Any future check must use those.

### What it invalidates

* **[15](#closed-and-removed-2026-08-26)'s mitigation is not merely
  unimplemented — it is unavailable.** "Route every partial sale through `split_position` +
  `transfer_position`" cannot be done: `split_position` is not on either deployed binary. The only
  live partial-exit path is transferring the *whole* position.
* **[13](#13-p1--issuer-lockdown--mainnet-step-outstanding)'s severity drops.** Its stated rationale
  is that `redeem_pt_bearer` pays on PT balance alone, so counterfeit PT is redeemable for real
  USDC. That function **is not deployed on mainnet**. Counterfeit SPLDPT therefore has no redemption
  path into the v1 pool. See the item for what remains true.
* **[19](#19-p0--market-init-cross-check--v1-only)'s deploy read-back cannot run.** It reads
  `market.wrapper()`; that function is not deployed on mainnet.
* **[3](#3-p0--b_rate-deep-dip-freezes-exits)'s premise is wrong for the live deployment.**
  `reset_rate_floor()` — the recovery lever the whole item is written around — **does not exist on
  any deployed v1 binary.** On the live v1 there is no lever at all.
* **The maturity yield ceiling may not be live.** `stamp_maturity_rate` / `maturity_rate` are the
  public half of the mechanism that stops YT earning at maturity. Both are absent from the deployed
  binaries, which strongly suggests the internal ceiling went in with them. **Verify against
  `code_hash` before relying on either behaviour** — it flips the sign of item 16's premise on the
  live deployment.

**Action:** never again reason about v1 behaviour from `contracts/`. Read the interface from chain
first. The v2 testnet stack was checked the same way this round and **does** match source —
`reset_rate_floor`, `available_liquidity`, `redeem_partial`, `max_redeemable`, `set_deposit_cap`,
`deposit_cap`, `total_assets`, `deposit_headroom` are all live on testnet.

---

## What is left

| # | Item | Area | Sev | What is left |
|---|---|---|---|---|
| [3](#3-p0--b_rate-deep-dip-freezes-exits) | `b_rate` deep dip freezes exits | strategy | **P0** | **Decide the TVL cap number.** ⚠ Description corrected: a dip **freezes** exits; recovery is admin-gated; the loss is pro-rata |
| [26](#26-p1--two-lp-path-defects-survived-into-srmarket---fixed) | LP path: dust add + add-liquidity DoS | srmarket | ~~P1~~ | ✅ **FIXED 2026-08-26.** Left: review the band-vs-bound decision; redeploy |
| [34](#34-p1--the-markets-reported-rate-and-price-never-respond-to-trading---fixed) | Reported rate/price frozen — the anchor is a fixpoint | srmarket | ~~P1~~ | ✅ **FIXED 2026-08-26.** Left: redeploy; IL is now visible in the views |
| [20](#20-p1--srvaultredeem-had-no-partial-path---fixed) | Vault redeem all-or-nothing | srvault | ~~P1~~ | ✅ **FIXED.** Resumable; also forced the `available_liquidity` correctness fix. Left: redeploy |
| [22](#22-p1--srvaultsweep-recovered-pt-only---fixed) | SR / YT / USDC inventory is one-way | srvault | ~~P1~~ | ✅ **FIXED.** `sweep_surplus`, expiry-gated, reserving collected USDC |
| [23](#23-p1--the-watchtowers-four-open-items---three-fixed) | Watchtower gaps | ops | **P1** | 🟡 **3 of 4 fixed.** Left: the v1 wrapper redeploy (v1-only) |
| [13](#13-p1--issuer-lockdown--mainnet-step-outstanding) | Issuer lockdown | deploy | P1 | Testnet ✅ — **mainnet issuer re-measured UNLOCKED 2026-08-26** |
| [30](#30-p2--remaining-sdk--tooling-gaps---mechanisms-done-policies-open) | SDK / tooling gaps | sdk | P2 | 🟡 **All mechanisms done.** Left: two application *policies* |
| [19](#19-p0--market-init-cross-check--v1-only) | Market/vault init cross-check | v1 only | P0/P1 | **v1 only — closed in v2.** Do only if v1 is revived |

**Closed and removed this round** — each verified against the current edition, not assumed:
[15](#closed-and-removed-2026-08-26), [16](#closed-and-removed-2026-08-26),
[18](#closed-and-removed-2026-08-26), [21](#closed-and-removed-2026-08-26),
[24](#closed-and-removed-2026-08-26), [25](#closed-and-removed-2026-08-26),
[27](#closed-and-removed-2026-08-26), [28](#closed-and-removed-2026-08-26),
[29](#closed-and-removed-2026-08-26), and **26a**.

**Needs a number, not code:** see [Calibration](#calibration--decisions-nobody-has-made-yet).

**Also gating launch, and never `tofix.md`'s scope:** `testcando.md` §18 — the §12
mainnet-parameter profile, the audit decision, and Appendix B.

---

## 3. P0 — `b_rate` deep dip freezes exits

*`testcando.md` §0 P0 `brate_decrease_bricks_everything_including_exits` — **residual ACCEPTED
2026-08-20; the mitigation is operational, not code***

### ⚠ Corrected 2026-08-26 — the previous description of the v2 behaviour was wrong

An earlier revision of this item said v2's exits **survive** a dip, on the strength of
`sr::test::a_guarded_strategy_still_bricks_sr_on_a_rate_dip`. That was false, and the false claim
reached `V2_WORK.md` §1 and the user-facing risk disclosure before it was caught.

The test ran against a mock strategy whose `redeem` read its rate straight from storage. The real
`spield-strategy::redeem` opens with `let rate = Self::current_rate(env.clone());`, and
`math::check_rate_bound_timed` returns `RateOutOfBounds` on **any** downward move. Making the mock
faithful flipped the result on the first run:

```
redeem -> HostError: Error(Contract, #40)   // RateOutOfBounds
```

Same defect class as the misaimed 26b/26c tests: a mock that diverged from the real adapter on the
one path the test was named for. The mock and the tests are fixed.

### What actually happens, in both stacks

1. **A dip freezes everything, exits included.** Reads survive — `Sr::exchange_rate` is a pure read
   of SR's own high-water mark — but `sync_rate`, `deposit` and `redeem` all revert. Pinned at every
   exit size by `a_dip_freezes_exits_at_every_size`, so a holder cannot slip under it by taking
   less.
2. **Clearing it is an admin action.** `strategy::reset_rate_floor()` lowers the stored floor to the
   live rate. **Until an admin calls it, nobody can exit at all** — a live operational obligation on
   what is still a single hot key.
3. **After the reset the loss is pro-rata.** `resetting_the_rate_floor_unfreezes_exits_and_the_loss_lands_pro_rata`:
   two equal holders, a 20% haircut, and the first out receives exactly what the second receives —
   800 USDC each on a 1,000 USDC deposit. Exiting first confers no advantage.
4. **The quoted rate still over-promises.** The high-water mark does not fall, so `preview_redeem`
   reports the old value while `redeem` pays the real one — 1,000 vs 500 on a 50% collapse.

**Who bears it: users, pro-rata by shares.** There is no buffer, insurance fund or subordinated
protocol capital. The operator's exposure is whatever they hold as a depositor, plus the obligation
to clear the freeze.

### Also corrected: the recovery lever is not deployed on v1

`reset_rate_floor()` does not exist on the deployed v1 strategy, mainnet or testnet (see the skew
section). On the live v1 there is no lever at all. It **is** live on the v2 testnet strategy.

### What is left: one number

The cap mechanism is built and enforced on chain, not in a runbook. `Sr::set_deposit_cap` bounds
deployed assets in `Sr::deposit`, with `deposit_cap()` / `total_assets()` / `deposit_headroom()` to
read it back. Three properties are pinned: **opt-in** (0 = uncapped), **gates deposits only**
(`the_cap_can_never_trap_a_depositor`), and measures **exposure, not supply**
(`yield_growth_does_not_eat_the_cap`).

```
deposit_cap    0            ← uncapped, read from the live testnet SR
total_assets   3433.2304105 USDC
```

**The number is still undecided.** With the description corrected, the question it answers is
concrete: *how much uncompensated depositor loss, recoverable only by an admin action, is
acceptable.* At a 100,000 cap and a 20% haircut that is up to 20,000 of user losses spread evenly,
plus a freeze of unbounded duration.

`RiskDisclosure.tsx` has been corrected to say all of this — it previously claimed the freeze lasts
"until backing recovers" (omitting the admin step) and that there is "no partial-withdrawal path"
(no longer true after item 20).

Revisit loss allocation before scaling past the cap. Item **20** is a *second*, more likely
Blend-dependency freeze with the same user-visible shape and a different cause.

---

## 26. ~~P1~~ — Two LP-path defects survived into `srmarket` — ✅ FIXED

*Reproduced against `srmarket` on 2026-08-26 (severity had been raised P2 → P1 because both were
wrongly on the closed list), then fixed the same day. Implementation detail in
[`V2_WORK.md`](./V2_WORK.md) §3 and §4.*

The previous round marked all three of item 26's defects "structurally absent in the SR stack". One
of the three is. The other two reproduce exactly, and the audit tests that were supposed to prove
otherwise do not test the defect.

### 26a — maturity gate ✅ **closed, removed**

`srmarket::add_liquidity` calls `ensure_can_trade`, which includes
`if now >= expiry { panic SeriesExpired }`. Genuinely fixed. `tofix_26a_*` is a valid test.

### 26b — no `shares > 0` guard on the follow-on LP path — ✅ fixed

Only the *first-LP* branch checks its result:

```rust
let s = isqrt(…);
if s <= 0 { panic_with_error!(&env, Error::InvalidAmount); }   // first LP: guarded
…
let (lo, hi) = if by_pt < by_sr { (by_pt, by_sr) } else { (by_sr, by_pt) };
if hi - lo > (hi / 1000) + 1 { panic_with_error!(&env, Error::ImbalancedLiquidity); }
lo                                                             // follow-on: NOT guarded
```

With `by_pt = by_sr = 0`, `hi - lo = 0` and the ratio check passes. Shares = 0, tokens transferred
anyway.

**Why the existing test misses it.** `tofix_26b_a_dust_add_cannot_swallow_the_deposit_for_zero_shares`
adds dust to a pool that has **never traded**, where `total_shares == pt_reserve` exactly, so
`by_pt = 1·total/reserve = 1 > 0` and it passes trivially. The v1 defect specifically requires swap
fees to grow the reserves past `total_shares` first.

**Measured** after two ordinary round trips on a 500,000/500,000 pool:

```
reserves pt=4792577961655  sr=5199710318777   total_shares=5000000000000
add_liquidity(1, 1) -> 0 shares; took pt=1 sr=1
```

Identical to v1. **Fixed** with `if shares <= 0 { panic_with_error!(&env, Error::InvalidAmount); }`
before the transfers, covering both branches — the same error the first-LP branch already used.

### 26c — `add_liquidity` had no tolerance parameter and was trivially DoSed — ✅ fixed

`add_liquidity` still requires the deposit to match the live reserve ratio to within ~0.1%
(`hi - lo > (hi / 1000) + 1`), with **no `min_shares` argument** the LP can widen.

**Why the existing test misses it.** `tofix_26c_remove_liquidity_has_working_slippage_guards` tests
`remove_liquidity`, a different function. `remove_liquidity` did gain `min_pt_out` / `min_sr_out`;
`add_liquidity` gained nothing. The slippage guards on the exit path do not address the entry path's
liveness problem.

**Measured:** an LP computes `sr_in = pt_in · sr_reserve / pt_reserve` — an exact match — then a swap
of ~1% of the pool lands first. The add **reverts**, and there is no argument to widen.

This is a *liveness* problem, not an extraction one: the strict band is what stops a sandwich from
re-pricing the LP's entry. The cost is a wasted fee, not a bad fill.

**Fixed** by adding `min_shares: i128`. Note that `min_shares` **alone does not fix the DoS** — the
band and the bound are two separate checks, and keeping both leaves the pre-quoted deposit rejected
exactly as before (the first attempt here did that, and the test caught it with
`ImbalancedLiquidity`). They had to be made alternatives:

* `min_shares == 0` → the pool's 0.1% band still applies. Exactly today's behaviour, so no existing
  caller changes.
* `min_shares > 0` → the caller's bound replaces the band; the contract mints `min(by_pt, by_sr)`
  and reverts `SlippageExceeded` below it.

**A decision is left here.** Under a stated bound the over-supplied leg is donated rather than
refunded — the Uniswap V2 shape. The alternative, dropping the band unconditionally, would strip
that protection from every zero-bound caller. See `V2_WORK.md` §4 if you would rather drop the band
entirely, or use `max_pt_in`/`max_sr_in` with a refund.

### The tests were fixed too

`tofix_26b_*` and `tofix_26c_*` asserted green on live defects. Both are replaced: 26b now trades
first (asserting a reserve really did grow past `total_shares`) before submitting the dust add, and
26c targets `add_liquidity` — landing a swap between quote and execution, then checking that the
unbounded add still reverts, the bounded one succeeds, the bound binds, and the exact boundary
passes.

### What is left

**Redeploy.** `add_liquidity` is now a four-argument function; the deployed market still has the
three-argument ABI, so neither this nor item 34 is live.

---

## 34. P1 — The market's reported rate and price never respond to trading — ✅ FIXED

*Found 2026-08-26 while attempting the `scalar_root` calibration; fixed the same day. Implementation
detail in [`V2_WORK.md`](./V2_WORK.md) §2.*

### The logic that was wrong

`srmarket::implied_apy()` and `pt_price()` returned the same values no matter how much the pool trades.
Measured across six trade sizes on an identical 500,000/500,000 pool:

```
size%  |    exec px (SR/PT) |  pt_price view |    implied_apy
     1 |        0.955277387 |   952380952309 |    50000000075
     2 |        0.955789963 |   952380952309 |    50000000075
     5 |        0.957329114 |   952380952309 |    50000000075
    10 |        0.959905081 |   952380952309 |    50000000075
    25 |        0.967833557 |   952380952309 |    50000000075
    50 |        0.982709845 |   952380952309 |    50000000075
```

**Execution is correct** — realised price rises 0.9553 → 0.9827 with size, so slippage is real and
there is no free arbitrage. **Only the reported views are frozen**, identically at every size: the
40-unit change in `implied_apy` is fixed-point rounding, not a response.

Confirmed on the live testnet market, whose reserves are visibly skewed after real trading:

```
reserves      PT 58.937365 / SR 44.8906318      (~1.31:1)
implied_apy   5.0000050221%                     (still exactly its seeded rate)
```

### Why

`curve::try_params` derives the anchor so that the price at the proportion it is handed is *by
definition* the target price — the comment says so:

```rust
// rate_anchor = target_price + logit(prop)/rate_scalar, so price(prop) == target_price now.
```

`Self::sync_implied_rate` (`contracts/srmarket/src/lib.rs:899`) then hands it the **post-trade**
reserves and reads the price back at **that same** proportion. The stored rate is a **fixpoint** and
the update is a mathematical no-op. `pt_price()` is pinned the same way.

This defeats the curve's stated intent — its module docs open with *"The anchor is recomputed, not
pinned at par … Pendle re-derives the anchor."*

### The fix

`sync_implied_rate(env, pre_pt_res, pre_sr_res)` now anchors on the pre-trade reserves and prices
the post-trade proportion; all five call sites capture and pass their pre-trade state. `pt_price()`
is fixed by the same change, since it derives from `last_ln_implied_rate`.

Measured after:

```
buy  1% of the SR side: apy 5.0000% -> 4.9436%   pt_price 952380952384 -> 952892670517
buy  5% of the SR side: apy 5.0000% -> 4.7185%   pt_price 952380952384 -> 954941161694
buy 25% of the SR side: apy 5.0000% -> 3.5810%   pt_price 952380952384 -> 965427604115
sell:                   apy 5.0000% -> 6.0882%   pt_price 952380952384 -> 942612119174
```

Three tests added: direction and size-scaling on buys, the reverse on sells, and rate-neutrality of
a proportional liquidity change (the property the fix could plausibly have broken).

### One consequence to know about before deploying

`economics_test::an_idle_participant_cannot_gain_at_anothers_expense` failed after the fix on "the
LP absorbing the flow must not lose". That assertion held **only because the price was frozen** — it
marked both bundles at the same number, so it silently measured fee accrual. With a working price it
is a mark-to-market comparison, and an LP absorbing one-way flow is down against holding. That is
impermanent loss, not a defect, and the test now measures both halves explicitly:

```
LP after 100k SR of one-way flow (pt_price 952380952384 -> 962770669050):
  fees, at constant prices:       +843.4389306
  vs holding, both at exit price: -237.7352944  <- impermanent loss, expected
```

**The pool now has visible impermanent loss.** It always had it economically; the contract's own
views simply could not show it.

### Test gap this closes

`srmarket::test::pt_still_converges_to_par_with_a_dynamic_anchor` advances only **time** and never
trades, so it passed on `target_price = exp(-rate · years)` walking to par as `years → 0` and never
exercised the anchor's response to flow — the same failure shape as the misaimed 26b/26c tests. It
is unchanged and still green; the three new tests cover what it could not.

### What is left

**Redeploy.** The fix is in source only; the deployed testnet market still has the fixpoint.

---

## 20. ~~P1~~ — `srvault::redeem` had no partial path — ✅ FIXED

*The wrapper half is **closed**; only the vault half remains.*

### Closed — removed from this item

`Sr::redeem_partial(from, receiver, shares, min_out)` clamps to what the venue can pay and burns
only the shares it redeems. `shares` is a **ceiling**, so burning fewer than authorized can only
leave the user better off; `min_out` set to the full amount reproduces the old all-or-nothing
behaviour exactly (`min_out_still_lets_a_user_refuse_a_partial_fill`). Measured in
`a_partial_exit_succeeds_where_a_full_one_reverts`: with 900 of 1,000 USDC drawn down, the full exit
returns **nothing** and the partial returns **over 90 of the 100 on hand**.

`Sr::max_redeemable()` and `strategy::available_liquidity()` make the crunch visible *before*
submitting, and both are live on testnet:

```
max_redeemable                 170141183460469231731687303715884105727   (i128::MAX — venue covers everything)
strategy.available_liquidity   38356.8771733 USDC
```

The `i128::MAX` early return is load-bearing: applying the 1% haircut unconditionally capped every
redemption at 99% of the position, so a user could never fully exit even on a healthy venue.

### ✅ Fixed 2026-08-26 — the vault

`srvault::redeem` is now resumable. `Receipt` gained `collected`, the vault a `TotalCollected`
counter, and the call **sizes its PT burn to what the venue can actually pay** rather than
attempting the full payout and reverting. Progress is banked; the holder is paid exactly `payout`
on the closing call. `redeem_remaining(id)` reports what is outstanding.

The solvency invariant moved with it — mandatory, not cleanup:

```rust
if pt_inventory + total_collected < total_liability { panic SolvencyViolation }
```

A partial burns PT to obtain USDC, so that part of the backing is cash rather than bond face;
without widening the invariant the vault trips on its own correct behaviour on the second call.

Measured on a 210,000 USDC payout, venue drawn to Blend's ceiling:

```
venue free 800,000 -> 56,230 USDC
first call collected 0.93 USDC     ← the true headroom at max_util is near zero
finished: paid 210,000 across 2 calls
```

Eight tests, including the invariant holding at **every step** of two concurrent redemptions, a dry
venue banking nothing, and no over-collection.

**This work surfaced a hard dependency.** The first build still failed with Blend's `#1207`, because
it sized against `max_redeemable()` → `available_liquidity()` → the pool's raw balance, and the pool
was already at its utilization ceiling. `available_liquidity` now computes
`min(balance, supplied − borrowed / max_util)`; on the live testnet pool the balance overstated true
headroom by **12.8%**, far more than the 1% safety haircut covered. See the Calibration table.

### What is left

**Redeploy** — and note `Sr::max_redeemable` and `srvault::redeem` both depend on the new
`available_liquidity`, so **`strategy` must be upgraded in the same cycle**, not after.

---

## 22. ~~P1~~ — `srvault::sweep` recovered PT only — ✅ FIXED

*Verified by test 2026-08-26. **Partially closed** — the PT leg has a path out; SR, YT and USDC do
not.*

### Closed — removed from this item

`srvault::sweep(to, pt_amount)` exists and is liability-gated in a stronger shape than the original
proposal: instead of requiring zero outstanding liability *and* maturity, it releases only PT face
**above** every open payout plus a per-receipt redemption buffer.

```rust
let reserved = storage::total_liability(&env) + storage::open_receipts(&env) as i128 * REDEEM_DUST;
let capacity = Self::pt_inventory(&env) - reserved;
```

This is better than what was asked for: surplus is recoverable *before* maturity without ever
touching a receipt's backing.

### ✅ Fixed 2026-08-26 — the other three legs

`sweep_surplus(to) -> (sr, yt, usdc)`, admin-only and **gated at/after expiry**, with a read-only
`surplus()` that predicts it. The expiry gate differs per leg for a reason:

* **YT** earns the yield that funds future coupons. Pre-expiry it has forward value `assert_solvent`
  cannot see — that invariant compares PT face against liability and says nothing about future
  capacity — so a pre-expiry YT sweep would degrade the vault's ability to pay later receipts while
  every check still passed.
* **SR** resting pre-expiry is transient; `harvest` reinvests it in the same call.
* **USDC** pre-expiry is indistinguishable from cash a partial redemption has banked.

`total_collected` is reserved unconditionally, so a sweep can never touch USDC belonging to a
partially-redeemed receipt. `sweep`, `stats` and `deposit` now reserve only the *uncollected* part
of the liability in PT.

The original measurement, re-run to completion:

```
before sweeping: PT 201967086960  SR 2485274157  YT 212467086962  USDC 1
after:           vault fully drained of surplus; nothing inaccessible remains
```

Five tests, including the #20 interaction: with a partial in flight the vault held 547,114 USDC of
which **547,114 was reserved and 0 sweepable**, and the holder was still paid in full afterwards.

### What is left

Redeploy, with the same `strategy` co-upgrade note as item 20.

---

## 23. P1 — The watchtower's four open items — 🟡 three fixed

*Both monitors were run against live testnet this round. They work — and each surfaced something.*

### Closed — removed from this item

Three of the four original sub-defects are genuinely fixed in `scripts/solvency_monitor.mjs`: the
band is read from chain rather than hardcoded to 8, PT conservation is checked against Horizon, and
daemon mode alarms + keeps polling instead of `exit(2)`-ing itself to death on the first alert.
`scripts/sr_solvency_monitor.mjs` covers the v2 stack with six probes plus Blend utilization.

### 23a — the v1 vault probe read functions the vault has never had — ✅ fixed

Live run output:

```
— vault: no aggregate solvency view on this contract (v1 exposes per-receipt reads only)
```

That message is wrong, and the degradation is self-inflicted. The probe reads `solvency` and
`bearer_redeemed` **on the vault**:

```js
readView('bearer_redeemed', VAULT).catch(() => null),
readView('solvency',        VAULT).catch(() => null),
```

Neither has ever been a vault function. The vault's aggregate view is **`stats()`**, which exists in
source *and* on the deployed binary. Read live this round:

```json
{"pt_inventory":"652677677","total_liability":"603659222","coupon_capacity":"49018455",
 "yt_inventory":"652677677","rate_bps":500,"maturity":1783546154}
```

`pt_inventory >= total_liability` is exactly the invariant sub-defect (3) asks for. **Fixed** — the
probe reads `stats()` and now passes against the live deployment:

```
✓ vault: pt_inventory=65.2677677 total_liability=60.3659222 coupon_capacity=4.9018455
```

### 23b — neither monitor could be run as documented — ✅ fixed

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@stellar/stellar-sdk'
  imported from …/scripts/sr_solvency_monitor.mjs
```

`scripts/` has no `package.json` and no `node_modules`. ESM resolves from the *script's* directory,
not the working directory, so `cd`-ing somewhere with the dependency installed does not help — both
monitors had to be copied next to a `node_modules` to run at all. A watchtower that cannot be
started from its documented path will not be started.

**Fixed** with a `scripts/package.json` (`"type": "module"`, its own installed dependency, and
`monitor:v1` / `monitor:v2` run scripts). Both monitors now start from `scripts/`.

**A second cause turned up behind the first.** With the dependency resolving, every v1 *vault* view
still failed — `stats`, `rate_bps`, `maturity` alike — with `Bad union switch: 1`, while the
wrapper's `solvency` worked. The vault's simulation response carries `stateChanges`, which
`@stellar/stellar-sdk` 13.x cannot decode. The scripts package pins **`^17.0.1`**, which can. The
published SDK in `sdk/` still pins 13.x for its own reasons; the scripts are deliberately an
independent package and the reason is recorded in its `description`, so the versions do not get
"tidied" back together.

### 23c — the v2 monitor is latched permanently red — ❌ open

It fires on every run:

```
✗ PT COUNTERFEIT: classic PT supply 16887669292 exceeds engine total_py 16887669281 by 11.
```

The probe is **correct** — this is the 11 stroops of counterfeit PT minted during the issuer-lockdown
rehearsal, caught to the stroop, which is the result that proved the probe works. But it is now a
permanent alarm on a known, benign cause. A watchtower that is always red is as useless as one that
guesses silently, which is the defect class this item exists to remove.

**Fix:** reconcile it — burn the 11 stroops, or record a signed baseline offset the probe subtracts
and re-alarms above. Do not simply widen the tolerance; the probe's value is that it is exact.

### 23d — the v1 wrapper probes still cannot run — ❌ open (v1 redeploy)

```
✓ solvency: backing=345.4887497 principal=345.4400376 headroom=0.0487121
  band=64 (⚠ ESTIMATED — this deployment predates open_positions(); redeploy the wrapper …)
⚠ pt_conservation probe unavailable: simulate bearer_redeemed failed: Error(WasmVm, MissingValue)
```

`open_positions()` and `bearer_redeemed()` are missing from the deployed binary — confirmed against
its interface, not inferred from an error. Degrading loudly is the right behaviour; an estimated band
and a measured one must never look the same in a log.

**Fix: redeploy the v1 wrapper** — and note from the skew section that this restores four other
functions too, not two. On Path A (mothball v1) this item is moot; it is listed because it is the
only remaining *v1* work anyone would do.

---

## 13. P1 — Issuer lockdown — mainnet step outstanding

*Testnet rehearsal **closed**. The mainnet action is not.*

### Closed — removed from this item

Rehearsed end to end on testnet, both directions verified: before the lock the issuer minted 10 base
units of counterfeit PT while `total_py` stayed put; after it the same payment failed `TxBadAuth`
**and the engine still minted 2,000,000,006 PT** — the lock closes the hole without bricking the
protocol. It is now a step in `deploy_sr_testnet.sh` with two fail-closed pre-flights, and
`ISSUER_LOCKED=1` is recorded in the deploy state.

A resumed deploy also caught a real bug: the script reconstructed the issuer from a *key name* that
the lockdown had since invalidated (the lockdown **burns the issuer identity**), and aborted naming
an account that had issued nothing. Fixed by reading the issuer from the recorded `PT_ASSET_ID`.

### Still open — and re-measured 2026-08-26

The v1 **mainnet** PT issuer is still unlocked. Read from Horizon this round:

```
GA4R5M7ZWOQZWIYCW246YC5WJ4QHT3H74CAUSTCEUUWIELCWI7IP3MKB
  signer GA4R5M7ZWOQZ… weight 1
  thresholds  low 0  med 0  high 0        *** UNLOCKED ***
```

### Severity correction

The item's stated rationale — "`redeem_pt_bearer` pays out on PT balance alone, so an unlocked issuer
would mean counterfeit PT redeemable for real USDC" — **does not hold on the live mainnet
deployment**, because `redeem_pt_bearer` is not deployed there. Every exit on the live binary
(`redeem_pt`, `combine_and_redeem`, `claim_yield`) goes through a *position*, and only the wrapper
can create one. Counterfeit SPLDPT has **no redemption path into the pool**.

What remains true, and is still worth acting on:

* Counterfeit SPLDPT can be minted and sold to a third party on the classic DEX — a scam vector
  against users, not a drain vector against the protocol.
* The lock is a **hard precondition** for any future deployment that ships `redeem_pt_bearer` — which
  every current source build does.
* It is harmless today only because v1 has never been seeded (confirmed again below).

**This is an operator action on mainnet with irreversible consequences — it burns the issuer identity
permanently — so it has deliberately not been performed here.** A future `FRESH=1` deployment needs a
brand-new issuer account.

Live v1 mainnet state, re-verified 2026-08-26:

```
SPLDPT  1 trustline, balance 0.0000000, 0 claimable balances
SPLDYT  1 trustline, balance 0.0000000, 0 claimable balances
issuer transactions: 7, all on 2026-06-08 (deploy day), none since
```

---

## 30. P2 — Remaining SDK / tooling gaps — 🟡 mechanisms done, policies open

### Closed — removed from this item

`frontend/src/lib/srstack.ts` is a full typed client for the current stack: `addLiquidity` /
`removeLiquidity`, `buyYt` / `buyYtFromUsdc` / `buyYtExactOut`, the whole USDC router surface,
`getMaxRedeemable`, `unwrapSrPartial`, and the cap reads (`getDepositCap`, `getTotalAssets`,
`getDepositHeadroom`). The v1 gaps this item opened against are moot with v1: its SDK never gained
`removeLiquidity`, `buyYt` or a guarded partial-sale helper, and its only `addLiquidity` mention is
a doc comment.

Item 15's "guarded partial-sale helper" is **not needed in the current edition** — YT is a
hook-bearing SEP-41 whose transfer carries the claim, so there is no wrong path to guard against.

### ✅ Fixed 2026-08-26 — TTL keep-alive

The gap was wider than "the SDK doesn't call them": only **two of five** archivable entry types had
a permissionless bump at all, and `yield::bump_holder` covered only the `Interest` record, not the
YT balance beside it — keeping the accounting alive while letting the balance archive.

Three contract entry points added (`Sr::bump_holder`, `SrMarket::bump_lp`, and `Yield::bump_holder`
extended to the balance), backed by `spield_shared::token::bump_balance` and
`srmarket::storage::bump_shares_ttl`. All permissionless, all value-neutral, all no-op on an address
holding nothing. All four are now exposed from `srstack.ts`, plus `bumpAll(wallet)`.

SR was the most exposed of the three: it has no maturity bounding how long a holder may sit dormant,
so a dormant holder is the ordinary case there rather than the edge case.

**Left:** the application's keep-alive *policy* — nothing schedules these yet.

### ✅ Fixed 2026-08-26 — the pnpm entry point

Not `pnpm.onlyBuiltDependencies` in `package.json`; pnpm 11.9.0 ignores that field outright. The
setting lives in `sdk/pnpm-workspace.yaml`, which already held a stub with an unfilled placeholder
(`esbuild: set this to true or false`). Completed to `esbuild: true`; `pnpm run test:unit` now runs
and passes all 218.

### ✅ Fixed 2026-08-26 — the `srvault` surface

A full typed client in `srstack.ts`, written against the post-item-20 receipt shape:
`getVaultStats`, `quoteVaultDeposit`, `vaultDeposit`, `getVaultReceipt`, `vaultRedeemRemaining`,
`vaultRedeem`, `vaultHarvest`, `bumpVaultReceipt`, `getVaultSurplus`, and an `SR_VAULT_AVAILABLE`
guard. Reads are failure-tolerant, matching the module's conventions; `tsc --noEmit` passes.

The resumable surface is what matters for the UI: after `vaultRedeem`, a non-zero
`vaultRedeemRemaining` means the venue was short and the user should return later, progress safe.

### Still open — two policies, not mechanisms

Both surfaces exist. What is undefined is *when the application uses them*:

1. **When the UI prompts a user to finish a partial redemption.**
2. **When the app calls the TTL bumps.**

---

## 19. P0 — Market init cross-check — **v1 only**

*Closed in the current edition. Retained only because reviving v1 re-opens it.*

`srmarket::initialize` takes only the yield contract and reads `pt`, `sr` and `expiry` back from it,
so there is no argument to get wrong; `srvault::initialize` takes only the engine address and reads
sr/pt/underlying/maturity from it. Both are **not expressible**, verified by
`tofix_19_the_market_cannot_be_wired_to_a_foreign_settlement_asset` and
`tofix_19b_an_expired_engine_cannot_have_a_new_market`. Item **24** (the same omission in the v1
vault) is closed the same way and has been removed.

In **v1** both remain open and untouched — `market_init_does_not_cross_check_the_settlement_asset`
and `vault_init_does_not_cross_check_its_underlying_against_the_wrapper` both still pass. v1's market
initializes cleanly against a foreign 7-decimal SAC and a trader can pay 500 FOREIGN, receive 485.5
PT, and redeem **485.53 real USDC** out of the wrapper's Blend position.

**If v1 is ever revived:** declare `underlying()` on the `WrapperContract` trait (the wrapper
implements it; the trait is just narrower), assert `w.underlying() == usdc` at both inits with a
distinct `Error::UnderlyingMismatch`, and add the read-backs to the deploy scripts. One change closes
both. **Note the deploy read-back as written cannot run on mainnet** — it reads `market.wrapper()`,
which is not deployed.

---

## Calibration — decisions nobody has made yet

Every one of these is a **number**, not code. The mechanism around each is built, tested and (except
where noted) live.

| # | Constant / setting | Today | What it needs to be set against |
|---|---|---|---|
| **3** | `SR_DEPOSIT_CAP` → `Sr::set_deposit_cap` | **`0` = uncapped** on chain | Loss appetite for a deep `b_rate` dip. The only bound on how much money is exposed to the one failure mode that has no code fix. **This is the blocking one.** |
| **20** | `LIQUIDITY_HAIRCUT_BPS` = 100 (1%) | 1% | ✅ The **code** half is fixed — `available_liquidity()` now computes `min(balance, supplied − borrowed/max_util)` instead of guessing. The pool's raw token balance — an **upper** bound, since Blend also refuses withdrawals that push utilization past its ceiling. 1% is a guess; measure the gap against the live pool. |
| **20** | Watchtower utilization threshold | warns above **85%** | Fired on its first run — Blend testnet USDC was at 85.4%. Either the threshold is too tight for a venue that normally sits there, or 85% genuinely is the danger zone. Decide which, or it becomes another latched alarm. |
| **31** | `scalar_root` | **40** (SCALAR_12) live on testnet | **Unblocked** — item 34 is fixed, so sensitivity is now measurable. First readings at 40, on a 500k/500k pool one year out: a 1% buy moves the quote **−5.6 bps**, 5% **−28.2 bps**, 25% **−142 bps**. Whether that is the right steepness is the open decision. (The 4.990% → 4.406% figure previously here was from the **v1** market — a different curve — and does not transfer.) `testcando.md` §12. |
| **26c** | LP ratio band `(hi/1000)+1` = 0.1% | hardcoded | Should become a caller-supplied `min_shares` — see item 26c. Until then, the number is the DoS surface. |
| **23c** | PT-conservation baseline | none | 11 stroops of rehearsal counterfeit are latching the alarm. Burn them or record a signed offset. |

Live v2 testnet curve parameters, for reference when calibrating:

```
scalar_root  40.000000000000     ln_fee_root  0.002500000000
implied_apy   5.0000050221%      treasury_fee_share  2000 bps
reserves      PT 58.937365 / SR 44.8906318      expiry 1795384166
```

---

## Closed and removed 2026-08-26

Each was re-verified against the current edition this round. Listed so they are not re-litigated.

| # | Was | Why it is closed now | Evidence |
|---|---|---|---|
| **15** | A raw YT transfer strands the recipient's claim | YT is a hook-bearing SEP-41 contract token, not a SAC — transfer settles both sides and the claim follows the token | `the_v1_stranding_bug_is_gone`, `tofix_15_*`, `a_partial_yt_transfer_splits_future_yield_pro_rata` |
| **16** | Post-maturity surplus accrues to nobody | **Premise was wrong.** In a share-based design every stroop above PT cover is owed to a YT holder; there is no pot. Only *abandoned* claims are recoverable, and `sweep_surplus` is bounded so it cannot raid a live claim | `tofix_16_*`, `abandoned_yt_becomes_sweepable_protocol_revenue`, `sweeping_can_never_take_pt_backing_or_a_credited_claim` |
| **18** | Unpaginated `redeem` + permissionless `seed` | No list to walk — PT is a fungible bearer balance, so exits are O(1). Closed twice over: `srvault::seed` is **admin-gated** (`get_admin(&env).require_auth()`) | `tofix_18_*`: identical write-entry and footprint-entry counts at 10 vs 30 rounds of history |
| **21** | Vault YT yield unclaimable after maturity | `srvault::harvest` has no maturity gate and no pruning; the engine keeps pre-expiry yield claimable forever | `tofix_21_*` claims successfully **a full year past expiry** |
| **24** | `Vault::initialize` does not cross-check `underlying` | Not expressible — the vault takes only the engine address and reads everything back from it | see item 19 |
| **25** | Solvency dust band ratchets with lifetime users | Fixed `SOLVENCY_SLACK` constant, not a per-position band | `tofix_25_*`: band still tight after 40 full open/close cycles |
| **26a** | `add_liquidity` has no maturity gate | `ensure_can_trade` now includes `now >= expiry → SeriesExpired` | `tofix_26a_*` |
| **27** | "Read-only" views write to chain state | `Sr::exchange_rate` is a pure storage read; the mutating path is the separate `sync_rate`. Same split in the engine: pure `index_view` / `py_index` vs stamping `index_current` | `tofix_27_*` and `tofix_27b_*` snapshot full observable state across every view |
| **28** | Exits account the requested, not the paid, amount | `Sr::redeem` returns what the strategy actually paid; the event carries the same figure | `tofix_28_*` reconciles the return value against the real balance delta on both legs |
| **29** | YT-only holder has no pre-maturity exit | Premise gone — PT and YT are independent tokens, so a YT-only holder exits by selling the YT | `tofix_29_*` exits mid-term and still collects the accrued yield |

### One residual worth recording from 27

`strategy::current_rate` **still writes unconditionally**, and that is now deliberate. Item 27's
proposed fix (2) — "only persist `Bound` when the rate actually rose" — is **dead**, and must not be
re-proposed:

> It used to be guarded by `if rate > bound.last_rate || now > bound.last_ts`. Whether the guard
> passed therefore depended on how much time elapsed between a transaction's simulation and its
> execution — so a caller could simulate with no write and then execute needing one, which the host
> rejects with `storage: exceeded_limit`. That made every caller above this intermittently unusable
> on a live network; it cost a day to find on testnet (2026-08-24).

The same reasoning is applied in `Sr::sync_rate`. Conditional writes make the footprint a function of
timing, which simulation cannot predict. **Unconditional writes are the fix, not the bug** — the
purity that item 27 wanted lives in the separate view functions instead.

---

## Probed and found sound

Recorded so they are not re-investigated. Each has a passing acceptance test that goes red if the
property breaks.

**31 — the fixed par anchor holds the implied rate across a full term — in the v1 market only.**
*`market::test::the_pools_implied_apy_holds_its_rate_over_the_term_without_re_anchoring`* — on a v1
pool seeded at exactly 5.000% and left untouched, total idle drift is **11.3 bps over eleven months**
(4.990% at +1mo → 4.887% at +11mo); the price's march to par and the shrinking time base cancel
almost exactly. Test asserts a <25 bps bound.

**This test is in `contracts/market/` — the v1 market — and says nothing about `srmarket`,** which
has a different curve implementation. Do not carry its numbers forward; see item 34.

**32 — position ownership auth is correctly scoped, not merely present.**
*`wrapper::test::a_stranger_cannot_act_on_someone_elses_position`* — the suite's other negative auth
tests use `set_auths(&[])`, which cannot distinguish "requires the owner" from "requires the caller".
This one signs as a stranger via a single `MockAuth` entry and confirms `claim_yield`,
`split_position`, `transfer_position` and `combine_and_redeem` all refuse, then that the same calls
succeed with the owner's auth. Closes the load-bearing case of `testcando.md` §6.

**33 — `redeem` cost is set by inventory shape, not history length.**
*`vault::test::redeem_cost_is_set_by_inventory_shape_not_by_history_length`* — one large seed, 120
daily harvests (53 tracked positions), four receipts: every redeem is satisfied out of the first
position it touches, flat at ~8.6 MB (**20% of the mainnet ceiling**). A long position list is
harmless; a *fragmented head* is what was fatal.

---

## Appendix B — what Phase 1 did not cover

Scope was `testcando.md` §0 plus §13's on-chain conservation law. Still open, by phase:

* **Phase 2** — §1 wrapper lifecycle edges, §2 strategy/rate-bound edges, §3 vault edges, §6
  systematic auth matrix (**partially closed** — item 32 covers the wrapper's position-ownership
  case; admin, strategy, vault and market auth are untouched).
* **Phase 3** — §4 AMM/curve edges, §8 pure-math properties, §9 remaining resource budgets, §12
  mainnet-parameter profile (**now also needs a `scalar_root` depth calibration**, blocked on item 34), §14
  launch-seed calibration (closed in source via `seed_pt_for_apy` — **but note that function is not
  on the deployed v1 market**).
* **Phase 4** — §5 ecosystem stateful fuzz, §15 adversarial simulation, §7 event contracts, §10
  chaos drills, §11 mutation testing.

**Not reachable from the test suite** — §16 (live mainnet read-only verification, now unblocked: see
`fixplan.md` on the mainnet RPC) and §17 (testnet operational drills) need network access and keys.

---

## Suggested order of work

**Done 2026-08-26** — items 34, 26b, 26c, 20, 22, 23a/b/c, 30's mechanisms, and item 3's
description correction. Details in [`V2_WORK.md`](./V2_WORK.md).

**Remaining:**

1. **Decide `SR_DEPOSIT_CAP`** (item 3). Now that the description is right, the question is
   concrete: how much uncompensated depositor loss, recoverable only by an admin action, is
   acceptable.
2. **Review the band-vs-bound decision in 26c** — keep the 0.1% band as the `min_shares == 0`
   default, or drop it. One line either way, easier settled before deploying.
3. **Set the residual `LIQUIDITY_HAIRCUT_BPS` and the watchtower's coverage thresholds.** The
   utilization cap is computed now, so the haircut only has to cover the residual. One measurement
   answers both.
4. **Re-measure `scalar_root`** now that the quote responds to flow.
5. **Define the two application policies** — when the UI prompts a user to finish a partial
   redemption, and when it calls the TTL bumps.
6. **Redeploy the v2 stack.** `add_liquidity` is four arguments, `Receipt` has a new field, and
   `available_liquidity` computes differently. **`strategy` must be upgraded in the same cycle as
   `sr` and `srvault`** — both now depend on the new `available_liquidity`, and upgrading a caller
   without its callee is the exact failure this repo has already hit once.
7. **v1 only, and only if v1 is revived:** redeploy the wrapper (23d), then item 19's cross-checks.
