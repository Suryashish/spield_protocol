# tofix.md — what is still open

**v2 only.** The v1 deployment matured unused (zero supply on mainnet, confirmed on chain) and its
items have been removed rather than carried. What remains is only what still needs a **decision**,
an **action**, or a **deploy step** on the SR/yield/srmarket/srvault/srrouter stack.

Item numbers are the originals so `testcando.md` cross-references and git history still line up.

Severity legend — **P0** = must close before the first seed transaction; **P1** = close before
meaningful TVL; **P2** = documentation / belt-and-braces.

---

## Verification basis — 2026-08-27

Everything below was re-tested against the current tree or read from a live network this round.

**Local suite: 510 Rust tests, all green.**

| crate | tests |
|---|---:|
| `sr` | 29 |
| `yield` | 59 |
| `srmarket` | 101 |
| `srvault` | 36 |
| `srrouter` | 29 |
| `strategy` (shared with v1) | 14 |
| `shared` | 56 |

Release WASM (`wasm32v1-none`) builds clean, **zero warnings**, after a forced rebuild.
SDK: **218 tests pass**, through the documented `pnpm run test:unit`.

*(The `wrapper`, `vault` and `market` crates are v1 and still build and test — 186 further tests —
but nothing in this document depends on them. They can be retired with v1.)*

### Fixed 2026-08-26/27

Twelve items were implemented and tested; reasoning and measurements are in
[`V2_WORK.md`](./V2_WORK.md). Marked rather than deleted, because most leave a follow-on.

| # | What was fixed |
|---|---|
| **34** | `sync_implied_rate` anchors pre-trade and prices post-trade — the quote responds to flow and scales with size |
| **26b** | `shares > 0` guard on the follow-on LP branch |
| **26c** | `min_shares` on `add_liquidity`; the 0.1% band is now the `min_shares == 0` default |
| **20** | `srvault::redeem` is resumable — banks progress, invariant widened to `pt + collected >= liability` |
| **20** | `strategy::available_liquidity` computes the real utilization cap; the raw balance overstated it by **12.8%** on the live pool |
| **20** | The residual haircut **measured at 0 bps** across 50–94% utilization — the computed cap is exactly achievable |
| **22** | `srvault::sweep_surplus` recovers SR, YT and USDC, expiry-gated, reserving collected USDC |
| **23** | The watchtower runs from its own package on a protocol-23 SDK; the 11 counterfeit stroops burned; all six invariants holding |
| **30** | Three TTL bump entry points + the full `srvault` SDK surface; `pnpm run test:unit` works |
| **3** | **Description corrected** — a dip **freezes** exits, recovery is admin-gated, and the loss is pro-rata. `RiskDisclosure.tsx` fixed to match |

**Two test-fidelity fixes behind those.** `sr::test`'s mock strategy diverged from the real adapter
on `redeem` — the one path its headline test was named for — which produced the false claim in item
3. And `economics_test::an_idle_participant_cannot_gain_at_anothers_expense` asserted an LP cannot
lose, which held only while `pt_price()` was frozen; it now measures fees and impermanent loss
separately.

**None of it is on chain yet.** See [Deploying this](#deploying-this).

---

## What is left

| # | Item | Area | Sev | What is left |
|---|---|---|---|---|
| [3](#3-p0--b_rate-deep-dip-freezes-exits) | `b_rate` deep dip freezes exits | strategy | **P0** | **Decide the TVL cap number.** Mechanism built and live; `deposit_cap` reads `0` on chain |
| [26](#26-p1--two-lp-path-defects-survived-into-srmarket---fixed) | LP path: dust add + add-liquidity DoS | srmarket | ~~P1~~ | ✅ **FIXED.** Left: review the band-vs-bound decision before deploying |
| [34](#34-p1--the-markets-reported-rate-and-price-never-respond-to-trading---fixed) | Reported rate/price frozen — the anchor was a fixpoint | srmarket | ~~P1~~ | ✅ **FIXED.** Left: impermanent loss is now visible in the views |
| [20](#20-p1--srvaultredeem-had-no-partial-path---fixed) | Vault redeem all-or-nothing | srvault | ~~P1~~ | ✅ **FIXED.** Also forced — and settled — the liquidity-estimate work |
| [22](#22-p1--srvaultsweep-recovered-pt-only---fixed) | SR / YT / USDC inventory is one-way | srvault | ~~P1~~ | ✅ **FIXED** |
| [23](#23-p1--the-watchtower---fixed) | Watchtower gaps | ops | ~~P1~~ | ✅ **FIXED.** Left: the coverage-ratio thresholds, below |
| [13](#13-p2--the-v1-mainnet-pt-issuer-is-still-unlocked) | v1 mainnet PT issuer unlocked | deploy | P2 ↓ | **One irreversible mainnet action.** Severity reduced — see the item |
| [30](#30-p2--remaining-sdk--tooling-gaps---mechanisms-done-policies-open) | SDK / tooling gaps | sdk | P2 | 🟡 **All mechanisms done.** Left: two application *policies* |

**Needs a number, not code:** see [Calibration](#calibration--decisions-nobody-has-made-yet).

**Also gating launch, and never `tofix.md`'s scope:** `testcando.md` §18 — the §12
mainnet-parameter profile and the audit decision.

---

## 3. P0 — `b_rate` deep dip freezes exits

*`testcando.md` §0 P0 — **residual ACCEPTED 2026-08-20; the mitigation is operational, not code***

### ⚠ Corrected 2026-08-26 — the previous description was wrong

An earlier revision said v2's exits **survive** a dip, on the strength of
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

### What actually happens

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

**The number is still undecided.** The question it answers is concrete: *how much uncompensated
depositor loss, recoverable only by an admin action, is acceptable.* At a 100,000 cap and a 20%
haircut that is up to 20,000 of user losses spread evenly, plus a freeze of unbounded duration.

`RiskDisclosure.tsx` has been corrected to say all of this — it previously claimed the freeze lasts
"until backing recovers" (omitting the admin step) and that there is "no partial-withdrawal path"
(no longer true after item 20).

Revisit loss allocation before scaling past the cap. Item **20** is a *second*, more likely
Blend-dependency freeze with the same user-visible shape and a different cause.

---

## 26. ~~P1~~ — Two LP-path defects survived into `srmarket` — ✅ FIXED

*Reproduced 2026-08-26, then fixed the same day. Implementation detail in
[`V2_WORK.md`](./V2_WORK.md) §3 and §4.*

Three defects were recorded against this item. **26a** (`add_liquidity` had no maturity gate) was
genuinely absent in `srmarket` — `ensure_can_trade` includes the expiry check. The other two were
recorded as closed and were not.

### 26b — no `shares > 0` guard on the follow-on LP path

Only the *first-LP* branch checked its result. With `by_pt = by_sr = 0`, `hi - lo == 0` passes the
ratio check, shares are zero, and the tokens are transferred anyway.

Measured after two ordinary round trips on a 500,000/500,000 pool:

```
reserves pt=4792577961655  sr=5199710318777   total_shares=5000000000000
add_liquidity(1, 1) -> 0 shares; took pt=1 sr=1
```

**Fixed** with `if shares <= 0 { panic_with_error!(&env, Error::InvalidAmount); }` before the
transfers, covering both branches — the same error the first-LP branch already used.

### 26c — `add_liquidity` had no tolerance parameter and was trivially DoSed

The deposit had to match the live reserve ratio to within ~0.1%, with no argument the LP could
widen, so any swap landing between quote and execution reverted an otherwise correct add.

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

`tofix_26b_*` and `tofix_26c_*` asserted green on live defects — 26b added dust to a pool that had
never traded (so the flooring never happened), and 26c exercised `remove_liquidity`, a different
function. Both are replaced with tests that reproduce the defects' actual preconditions.

---

## 34. P1 — The market's reported rate and price never respond to trading — ✅ FIXED

*Found 2026-08-26 while attempting the `scalar_root` calibration; fixed the same day.
Implementation detail in [`V2_WORK.md`](./V2_WORK.md) §2.*

### The logic that was wrong

`srmarket::implied_apy()` and `pt_price()` returned the same values no matter how much the pool
traded. Measured across six trade sizes on an identical 500,000/500,000 pool:

```
size%  |    exec px (SR/PT) |  pt_price view |    implied_apy
     1 |        0.955277387 |   952380952309 |    50000000075
     5 |        0.957329114 |   952380952309 |    50000000075
    25 |        0.967833557 |   952380952309 |    50000000075
    50 |        0.982709845 |   952380952309 |    50000000075
```

**Execution was correct** — realised price rose with size, so slippage was real and there was no
free arbitrage. **Only the reported views were frozen**, identically at every size.

### Why

`curve::try_params` derives the anchor so that the price at the proportion it is handed is *by
definition* the target price — the comment says so:

```rust
// rate_anchor = target_price + logit(prop)/rate_scalar, so price(prop) == target_price now.
```

`sync_implied_rate` then handed it the **post-trade** reserves and read the price back at **that
same** proportion. The stored rate was a **fixpoint** and the update a mathematical no-op.
`pt_price()` was pinned the same way.

### The fix

`sync_implied_rate(env, pre_pt_res, pre_sr_res)` now anchors on the pre-trade reserves and prices
the post-trade proportion; all five call sites capture and pass their pre-trade state.

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

`pt_still_converges_to_par_with_a_dynamic_anchor` advances only **time** and never trades, so it
passed on `target_price = exp(-rate · years)` walking to par as `years → 0` and never exercised the
anchor's response to flow. It is unchanged and still green; the three new tests cover what it could
not.

---

## 20. ~~P1~~ — `srvault::redeem` had no partial path — ✅ FIXED

### The logic that was wrong

`assert_solvent` compares value, not withdrawability. Blend caps utilization at `max_util`, and
every Spield exit runs through a withdrawal from it. `srvault::redeem` required the entire payout in
one call: short of it, the transaction reverted, the receipt stayed open, and no progress was
stored — the holder got **nothing** however much liquidity was available.

### The wrapper half — closed earlier

`Sr::redeem_partial(from, receiver, shares, min_out)` clamps to what the venue can pay and burns
only the shares it redeems. `shares` is a **ceiling**, so burning fewer than authorized can only
leave the user better off; `min_out` set to the full amount reproduces all-or-nothing exactly.

### The vault half — fixed 2026-08-26

`srvault::redeem` is now resumable. `Receipt` gained `collected`, the vault a `TotalCollected`
counter, and the call **sizes its PT burn to what the venue can actually pay** rather than
attempting the full payout and reverting. Progress is banked; the holder is paid exactly `payout` on
the closing call. `redeem_remaining(id)` reports what is outstanding.

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

### It surfaced — and settled — the liquidity estimate

The first build still failed with Blend's `#1207`, because it sized against `max_redeemable()` →
`available_liquidity()` → the pool's raw balance, and the pool was already at its utilization
ceiling. On the live testnet pool the balance overstated true headroom by **12.8%**, far more than
the 1% safety haircut covered — and the gap is not a constant, so no fixed percentage could stand in
for it.

`available_liquidity()` now computes the binding constraint:

```rust
min(balance, supplied - borrowed / max_util)
```

And the residual was then **measured** rather than guessed
(`measure_the_haircut_available_liquidity_actually_needs`):

```
   util |      probe ceiling |   largest accepted |    haircut
 50.00% |      1000000000000 |               100% |       0 bps
 70.00% |       789473684211 |               100% |       0 bps
 85.00% |       315789473685 |               100% |       0 bps
 94.00% |        31578947369 |               100% |       0 bps
```

**0 bps needed at every level** — the computed cap is exactly achievable. `LIQUIDITY_HAIRCUT_BPS`
stays at 100 as documented conservatism (wrong low costs a second transaction; wrong high costs a
revert), and the test asserts it remains sufficient.

---

## 22. ~~P1~~ — `srvault::sweep` recovered PT only — ✅ FIXED

### The logic that was wrong

`sweep` recovered surplus PT only. A full lifecycle left SR, YT and a USDC remainder with no exit
path — measured at **248.53 SR** on a 20,000 USDC seed, about 1.2% of it. The SR is *created by* the
post-expiry harvest being allowed: `harvest` correctly claims yield, but `mint_py` refuses past
expiry, so the proceeds park in the vault.

### The fix

`sweep_surplus(to) -> (sr, yt, usdc)`, admin-only and **gated at/after expiry**, with a read-only
`surplus()` that predicts it. The expiry gate differs per leg for a reason:

* **YT** earns the yield that funds future coupons. Pre-expiry it has forward value
  `assert_solvent` cannot see — that invariant compares PT face against liability and says nothing
  about future capacity — so a pre-expiry YT sweep would degrade the vault's ability to pay later
  receipts while every check still passed.
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

Five tests, including the item-20 interaction: with a partial in flight the vault held 547,114 USDC
of which **547,114 was reserved and 0 sweepable**, and the holder was still paid in full afterwards.

---

## 23. P1 — The watchtower — ✅ FIXED

### The logic that was wrong

Three mismatches between the watchtower and the thing it watches: a hardcoded tolerance instead of
the contract's real band, no PT/YT supply conservation check, and `process.exit(2)` on the first
breach — so a false alarm did not just page, it **killed the watchtower**.

All three are fixed in the scripts. `scripts/sr_solvency_monitor.mjs` covers the v2 stack with six
probes plus Blend utilization.

### Two further problems found by actually running it

**It could not be started as documented.** `scripts/` had no package manifest, and Node resolves ESM
imports from the *script's* directory, so `cd`-ing somewhere with the dependency installed did not
help. Fixed with a `scripts/package.json`.

**A second cause sat behind the first.** With the dependency resolving, some views still failed with
`Bad union switch: 1` — a simulation response that carries `stateChanges` cannot be decoded by
`@stellar/stellar-sdk` 13.x, and **any** contract can produce one: every view on the affected
contract failed identically, including trivial ones like `rate_bps` and `maturity`, while views on a
contract that produced none worked fine. The scripts package pins **`^17.0.1`**. The published SDK
in `sdk/` still pins 13.x for its own reasons; the scripts are deliberately an independent package
and the reason is recorded in its `description`, so the versions do not get "tidied" together.

### The latched false alarm — cleared

The monitor fired on every run against the 11 stroops of counterfeit PT minted during the
issuer-lockdown rehearsal. The probe was right; the alarm was permanent and benign, which is its own
failure mode.

**Burned**, rather than papered over with a baseline offset — sending a classic asset to its issuer
destroys it and does not require the issuer to sign, so the completed lockdown was no obstacle.

```
before:  total_py=17007722855  pt_supply=17007722866   ✗ PT COUNTERFEIT … by 11
after:   total_py=17007722855  pt_supply=17007722855   ✓ all six invariants hold
```

An offset would have written a permanent exception into the conservation identity that every future
operator and audit had to know about. Burning cost 0.0000011 PT.

### What is left

The **coverage-ratio thresholds** — see [Calibration](#calibration--decisions-nobody-has-made-yet).

---

## 13. P2 — The v1 mainnet PT issuer is still unlocked

*Severity reduced from P1 to P2 2026-08-26, and retained after the v1 prune because it does not
expire with the series.*

The lockdown itself is **done for v2**: rehearsed end to end on testnet, both directions verified
(counterfeit PT minted before the lock; `TxBadAuth` after, with the engine still minting), and it is
a step in `deploy_sr_testnet.sh` with two fail-closed pre-flights. `ISSUER_LOCKED=1`.

What remains is the **old v1 mainnet issuer**, re-measured 2026-08-27:

```
GA4R5M7ZWOQZWIYCW246YC5WJ4QHT3H74CAUSTCEUUWIELCWI7IP3MKB
  signer weight 1, thresholds 0/0/0     *** UNLOCKED ***
SPLDPT / SPLDYT: zero supply, no holders — v1 was never used
```

### Why it is only P2, and why it is not zero

The original rationale — "`redeem_pt_bearer` pays on PT balance alone, so counterfeit PT is
redeemable for real USDC" — **does not hold**: that function was never deployed to mainnet. Every
exit on the live binary goes through a *position*, which only the wrapper can create. Counterfeit
SPLDPT has **no drain path into the pool**.

But the mint capability does not expire when the series does. Someone holding that key can mint
SPLDPT indefinitely and sell it to a buyer who recognises the name. That is a reputational risk
attached to a real mainnet asset, and the only way to end it is to lock the account.

**One irreversible mainnet action, deliberately not performed here** — it permanently burns the
issuer identity.

---

## 30. P2 — Remaining SDK / tooling gaps — 🟡 mechanisms done, policies open

### ✅ Fixed — TTL keep-alive

Only **two of five** archivable entry types had a permissionless bump at all, and
`yield::bump_holder` covered only the `Interest` record, not the YT balance beside it — keeping the
accounting alive while letting the balance archive.

| Entry | Bumped on write | Permissionless bump |
|---|---|---|
| `srvault` Receipt | maturity-aware | `srvault::bump_receipt` |
| `yield` Interest | maturity-aware | `yield::bump_holder` |
| `yield` YT balance | 1-year rolling | `yield::bump_holder` ✅ new |
| `Sr` SR balance | 1-year rolling | `Sr::bump_holder` ✅ new |
| `srmarket` LP shares | expiry-aware | `SrMarket::bump_lp` ✅ new |

SR was the most exposed: it has no maturity bounding how long a holder may sit dormant. PT needs
nothing — it is a classic SAC, so its balances are trustlines and not subject to archival.

All four are exposed from `srstack.ts`, plus `bumpAll(wallet)`.

### ✅ Fixed — the `srvault` surface

A full typed client, written against the post-item-20 receipt shape: `getVaultStats`,
`quoteVaultDeposit`, `vaultDeposit`, `getVaultReceipt`, `vaultRedeemRemaining`, `vaultRedeem`,
`vaultHarvest`, `bumpVaultReceipt`, `getVaultSurplus`, and an `SR_VAULT_AVAILABLE` guard.

The resumable surface is what matters for the UI: after `vaultRedeem`, a non-zero
`vaultRedeemRemaining` means the venue was short and the user should return later, progress safe.

### ✅ Fixed — the pnpm entry point

Not `pnpm.onlyBuiltDependencies` in `package.json`; pnpm 11.9.0 ignores that field outright. The
setting lives in `sdk/pnpm-workspace.yaml`, which already held a stub with an unfilled placeholder
(`esbuild: set this to true or false`). Completed to `esbuild: true`; `pnpm run test:unit` now runs
and passes all 218.

### Still open — two policies, not mechanisms

Both surfaces exist. What is undefined is *when the application uses them*:

1. **When the UI prompts a user to finish a partial redemption.**
2. **When the app calls the TTL bumps.**

---

## Calibration — decisions nobody has made yet

Every one of these is a **number**, not code. The mechanism around each is built and tested.

| # | Constant / setting | Today | What it needs to be set against |
|---|---|---|---|
| **3** | `SR_DEPOSIT_CAP` → `Sr::set_deposit_cap` | **`0` = uncapped** on chain | How much uncompensated depositor loss, recoverable only by an admin action, is acceptable. **The blocking one.** |
| **23** | Watchtower coverage thresholds | warns above **85%** utilization | Utilization alone is the wrong signal — it read 85.4% on the first run and 70.35% later, so the threshold is not permanently tripped but says nothing useful either. Alarm on `available_liquidity() / total_assets()` instead: at the numbers above that is 9.7× cover. Pick warning and critical levels for the ratio. |
| **34** | `scalar_root` | **40** (SCALAR_12) live on testnet | Now measurable — item 34 is fixed. At 40, one year out on a 500k/500k pool: a 1% buy moves the quote **−5.6 bps**, 5% **−28.2 bps**, 25% **−142 bps**. How far may one trade move the headline before it stops resembling the vault's rate? |
| **26c** | LP ratio band `(hi/1000)+1` = 0.1% | now the `min_shares == 0` default | Keep the band as the zero-bound default (shipped, backwards-compatible, but a stated bound donates the over-supplied leg) or drop it entirely. One line either way. |
| ~~20~~ | `LIQUIDITY_HAIRCUT_BPS` = 100 | ✅ **settled** | Measured at **0 bps** needed across 50–94% utilization. 100 stays as conservatism, with a test asserting it remains sufficient. |

Live v2 testnet curve parameters, for reference when calibrating:

```
scalar_root  40.000000000000     ln_fee_root  0.002500000000
implied_apy   5.0000050221%      treasury_fee_share  2000 bps
reserves      PT 58.937365 / SR 44.8906318      expiry 1795384166
```

---

## Deploying this

**Nothing from this round is on chain.** Three things changed shape:

* `add_liquidity` is now a **four-argument** function.
* `Receipt` has a new `collected` field.
* `available_liquidity` computes differently.

**`strategy` must be upgraded in the same cycle as `sr` and `srvault`.** Both now call the new
`available_liquidity`; upgrading a caller without its callee passes every address-comparison wiring
check and fails at runtime. This repo has already hit that exact failure once —
`deploy_sr_testnet.sh` has a `compat()` gate that invokes each cross-contract call and exits
non-zero, and it should be trusted over the address checks.

Verify the result with `code_hash` and the on-chain interface, never by reading `contracts/`.
`version()` cannot detect drift: it returned the same string on mainnet, testnet and source for a
binary that was missing six functions.

---

## Testing standard

**Every test that claims an item is closed must reproduce that item's actual preconditions.** Four
tests in this repo failed that bar, and each one hid a live defect:

| Test | How it passed without testing the thing |
|---|---|
| `tofix_26b_*` | added dust to a pool that had never traded, so the flooring never happened |
| `tofix_26c_*` | exercised `remove_liquidity` — a different function |
| `pt_still_converges_to_par_with_a_dynamic_anchor` | advanced only time, never traded |
| `a_guarded_strategy_still_bricks_sr_on_a_rate_dip` | ran against a mock whose `redeem` skipped `current_rate` |

The last is the worst: its false conclusion reached this document's item 3, `V2_WORK.md` §1, and the
user-facing risk disclosure before anything caught it. All four are fixed.

A related trap, from the same round: `set_auths(&[])` removes *all* authorization, so it
distinguishes "requires auth" from "requires none" but **cannot** distinguish "requires the owner"
from "requires the caller". A regression that authorized the invoker instead of the owner would pass
such a test. Use `mock_auths` with a single entry signed by a stranger.

---

## Suggested order of work

1. **Decide `SR_DEPOSIT_CAP`** (item 3). The one blocking number; nothing gates it.
2. **Review the band-vs-bound decision in 26c.** One line either way, and easier settled before
   deploying than after.
3. **Set the watchtower's coverage thresholds** (item 23).
4. **Re-measure `scalar_root`** (item 34) now that the quote responds to flow.
5. **Define the two application policies** (item 30) — the partial-redeem prompt and the bump
   schedule.
6. **Redeploy the v2 stack**, per [Deploying this](#deploying-this).
7. **Lock the old v1 mainnet issuer** (item 13) whenever convenient — it does not expire.
