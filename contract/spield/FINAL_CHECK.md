# Spield Protocol Contracts — Final Economic, Financial, and Logic Check

**Original review:** 2026-08-30 against commit `26f8fd8a`
**Re-verified:** 2026-08-30 against commit `bde087bd` (HEAD) — every finding below was re-tested, and
the ones already fixed by `fix 2.3` / `fix 2.4` were removed rather than left standing.
**Primary scope:** current V2 stack — `strategy`, `sr`, `yield`, `srmarket`, `srvault`, `srrouter`
**Secondary scope:** retired V1 `wrapper`/`vault`/`market`, deploy scripts/state, invariants, tests

> **Why this file was rewritten.** The original pass reviewed `26f8fd8a`, three commits behind HEAD.
> `fix 2.3` and `fix 2.4` landed the `e2e` crate and the `anyfix.md` F1–F5 fixes, and four of the
> original eleven findings were already closed before the report was committed. Those are listed under
> [Closed as findings](#closed-as-findings) with the evidence, and are gone from the checklist.
>
> **`fix 2.3`/`fix 2.4` did not close V2-01 or V2-03.** Both were re-tested at `bde087bd` using the
> repository's **own** `e2e` harness and its `advance_unsynced()` primitive — not an ad-hoc rig — and
> both still reproduce. `contracts/srmarket/src/lib.rs` and `contracts/srrouter/src/lib.rs` are byte
> for byte unchanged since `26f8fd8a`. The measured figures throughout are from that re-test, at HEAD.

## Final verdict

**Both code defects are fixed. What blocks launch is now a single measurement.**

`V2-01` — the market prices on a synchronized index; five regressions, verified to fail against the
unfixed tree at one day of drift, hold it there.
`V2-03` — the router compares against its entry snapshot instead of zero; four regressions, all
verified to fail against the old rule.

Neither is *closed*, for one reason: together they add **~1.40 MB of transaction memory to every
trading path**, and `budget.md` records the local Blend fixture as understating the deployed pool by
at least 4x. `buy_pt_with_usdc` and `sell_pt_for_usdc` pass on chain today and are the paths at risk.
**Running `probe_budget.mjs` against a real deployment is the remaining gate**, and it is the one
thing that cannot be answered locally.

No unrestricted admin-free path that drains `strategy`, `sr`, or `yield` principal was found under the
intended assumptions.

**RISK-01 is deliberately not in the table below.** It is not a defect and it never closes — it is the
standing consequence of building on a lending venue, and it is stated in
[Standing risk](#standing-risk--not-a-finding-and-it-does-not-close) instead. Both actionable halves
(loss accounting, disclosure) are complete; the risk itself is permanent and is disclosed, not fixed.

## Severity summary

| ID | Severity | Status | Finding |
|---|---|---|---|
| V2-01 | **High / P0** | **Fixed and cleared** | `srmarket` priced value-moving trades on a stale SR index. Now prices on the mutating `yield.py_index_current()`; 5 regressions pin it. **The on-chain budget gate has been run and passed — all six router paths fit**, including two that used to be over budget |
| V2-03 | **Medium** (was Low) | **Fixed** | One stroop bricked every router route. `assert_drained` now compares against an entry snapshot (`after <= before`) instead of zero; 4 regressions, all verified to fail against the old rule. Costs ~68 KB/path |
| ECO-01 | Low / design | **Addressed (UX + calibration)** | Splitting a large trade beats one fill by **≈2.15 bps per 1% of the pool consumed** — measured, not assumed. The dApp now warns above a 0.1% gain and suggests 5 slices; slippage is user-selectable. Router-side auto-splitting was rejected on budget grounds |
| ECO-02 | Informational | **Built, currently dormant** | **Verified on mainnet: BLND emissions are OFF for USDC *supply*** — Blend pays XLM suppliers and USDC borrowers, so Spield's side has never accrued. `strategy.claim_emissions()` (permissionless, treasury-fixed) is built for when that rotates, and the monitor now says the day it does |

## V2-01 — FIXED, and the budget gate has been cleared on chain

**The defect:** `srmarket::index()` read `yield.py_index()`, a pure **view** of SR's stored
high-water rate, while the `mint_py`/`redeem_py` those same paths went on to call synchronized
first. One transaction therefore ran on two different indices. Measured before the fix, at 30 days
of unsynced drift on a 10,000-face trade:

| route | stale vs synced | who paid |
|---|---|---|
| `swap_exact_pt_for_sr` | seller took **+75,811,165** SR | LPs |
| `swap_exact_sr_for_pt` | buyer got **−78,529,349** PT | the user |
| `sell_yt_exact_in` | seller took **+533,691** SR | LPs |
| `buy_yt_exact_out` | **72,538,390 YT stranded**, owned by nobody | stranded |

### The fix

`Yield` now exposes the mutating index as a contract method, and the market prices on it:

```text
srmarket::index()  ->  yield.py_index_current()  ->  index_current()
                                                 ->  live_index_synced()
                                                 ->  sr.sync_rate()      [ writes, always ]
```

**Two implementations were built and measured**, because the choice is a budget question:

| | approach | market mem, `swap_exact_pt_for_sr` |
|---|---|---|
| A | `sr.sync_rate()` directly inside `SrMarket::index()` | 2,273,012 |
| **B** ✅ | **mutating index exposed through `Yield`** | **2,257,564** |

B is marginally cheaper and is the one shipped: A makes srmarket enter *two* contracts (`sr` to
sync, `yield` to read), B enters one and lets `yield` do what it already does internally. The
difference is small because the cost is not the call frames — see below.

**One rate throughout the transaction.** Each of the four paths binds `let index = Self::index(&env)`
exactly once, and every subsequent conversion uses that binding: curve params, `asset_to_sr`,
`sr_to_asset`, `asset_to_sr_ceil`, the fee, the treasury cut, the reserve updates and the event
values. The nested `mint_py`/`redeem_py` re-synchronize, which is **consistent rather than doubled**
— the ledger timestamp is fixed for a transaction, so the second observation of `b_rate` returns the
same index. That equality is not assumed: `v6_buying_yt_prices_the_same_and_strands_nothing` asserts
the market ends with **zero** YT, which can only happen if `mint_py` minted exactly the requested
face — i.e. if both indices agreed to the stroop.

### ⚠ Budget — measured, and the reason this is not yet closed

The Soroban budget is **memory-bound, not CPU-bound** ([`budget.md`](budget.md) §1). Every path that
prices a trade now performs one additional Blend `get_reserve`:

| path | baseline mem | fixed mem | Δ | of limit |
|---|---|---|---|---|
| `market.swap_exact_sr_for_pt` | 841,365 | 2,175,303 | +1,333,938 | 2.0% → 5.2% |
| `market.swap_exact_pt_for_sr` | 922,935 | 2,257,564 | +1,334,629 | 2.2% → 5.4% |
| `market.buy_yt_exact_out` | 3,813,893 | 5,146,992 | +1,333,099 | 9.1% → 12.3% |
| `market.sell_yt_exact_in` | 3,733,171 | 5,082,651 | +1,349,480 | 8.9% → 12.1% |
| `router.buy_pt_with_usdc` | 5,163,831 | 6,495,274 | +1,331,443 | **12.3% → 15.5%** |
| `router.sell_pt_for_usdc` | 3,868,835 | 5,202,085 | +1,333,250 | **9.2% → 12.4%** |
| `router.buy_yt_with_usdc` | 9,484,332 | 10,817,679 | +1,333,347 | 22.6% → 25.8% |
| `router.sell_yt_for_usdc` | 8,047,445 | 9,382,424 | +1,334,979 | 19.2% → 22.4% |

**The increment is the same ~1.333 MB on every path**, which identifies the cost precisely: it is
**one Blend `get_reserve`**, not module loading and not call frames. That is why options A and B
differ by so little, and it bounds what any cleverer implementation could save.

WASM growth, the part that costs at instantiation on chain:

```text
spield_srmarket   91,932 -> 92,033    +101 bytes
spield_yield      79,509 -> 80,633  +1,124 bytes
spield_sr         72,850 -> 74,920  +2,070 bytes   (realizable_rate, RISK-01)
spield_strategy   60,453 -> 61,584  +1,131 bytes   (position_value_unguarded, RISK-01)
```

**A cheaper variant exists and was deliberately rejected.** The YT paths now perform *two* Blend
reads — one to price, one inside the nested `mint_py` — so eliminating the second would recover
~1.33 MB there. Doing so requires either threading a caller-supplied index into `mint_py`, which
puts a trust boundary in the wrong place, or caching the index per ledger inside `yield`, whose
footprint would then depend on whether simulation and execution land in the same ledger — precisely
the failure that cost a day on testnet in 2026-08-24. Neither is worth 1.33 MB on paths that are
already over budget for other reasons.

**Why this is still open.** `budget.md` §2 records `buy_yt_with_usdc` and `sell_yt_for_usdc` as
**already over budget against the deployed pool** while showing only 22.6% / 19.2% locally — so the
local Blend fixture understates the real one by at least a factor of four. Applying that factor to
`buy_pt_with_usdc` at 15.5% puts it uncomfortably close to the limit, and it is a path that
currently **passes** on chain.

> ### ✅ Gate cleared — measured on testnet, 2026-08-30
>
> A fresh deployment carrying this fix was probed with `scripts/probe_budget.mjs`. **All six router
> paths fit**, and the two that `budget.md` recorded as over budget now pass:
>
> ```text
>   buy_pt_with_usdc       OK   insns 45,898,074 (11.5% of cpu)  entries 31
>   sell_pt_for_usdc       OK   insns 44,582,333 (11.1% of cpu)  entries 30
>   buy_yt_with_usdc       OK   insns 60,258,363 (15.1% of cpu)  entries 37   <- was OVER BUDGET
>   sell_yt_for_usdc       OK   insns 60,732,803 (15.2% of cpu)  entries 35   <- was OVER BUDGET
>   claim_yield_to_usdc    OK   insns  7,441,246 ( 1.9% of cpu)  entries 20
>   redeem_py_for_usdc     OK   insns 17,925,999 ( 4.5% of cpu)  entries 28
> ```
>
> The worry driving this gate was that the fix's ~1.33 MB per path would tip `buy_pt_with_usdc` or
> `sell_pt_for_usdc` over. It did not. Instruction counts actually **fell** versus 2026-08-26
> (`buy_pt` 55.4M → 45.9M); the fix's cost is real and the reduction is larger.
>
> Confirmed independently by the live workflow suite, which now prints *"one-transaction USDC->YT now
> FITS on this network"* and *"one-transaction YT->USDC now FITS again"*.
>
> **Two honest caveats.** The probe needs a user holding PT *and* YT — with an empty account the YT
> paths fail on balance and print `n/a`, which is easy to misread as a budget failure. And the
> deployment is freshly seeded at the planned mainnet shape, so it is not a like-for-like environment
> with the 2026-08-26 numbers. Re-run on the exact release commit before mainnet.

### Verified on the live network, not only in tests

On the fresh testnet deployment, `market.buy_yt_exact_out` for 20,000,000 YT face delivered **exactly
20,000,000 YT**, and the market's own YT balance afterwards was **0**. Under the defect a drifted index
made `mint_py` produce more face than the trade asked for and the surplus YT was stranded in the
contract, unreachable. Zero stranded YT on a real Blend pool is the property, observed rather than
asserted.

### Regressions

Five tests in [`contracts/e2e/src/invariants.rs`](contracts/e2e/src/invariants.rs), using the
`advance_unsynced()` primitive that already existed but had never been pointed at the market. Each
drives a route at 1, 7, 30 and 90 days of drift and asserts the result is identical to the same
route run after an explicit `sync_rate()`:

- `v6_selling_pt_prices_the_same_synced_or_not`
- `v6_buying_pt_prices_the_same_synced_or_not`
- `v6_selling_yt_prices_the_same_synced_or_not`
- `v6_buying_yt_prices_the_same_and_strands_nothing` — also asserts zero stranded YT
- `v6_reserves_still_track_balances_exactly_after_drift`

**They were verified to fail against the unfixed tree**, at just **one day** of drift:

```text
1d of drift changed what a PT purchase delivers   left 104,444,858,906  right 104,447,570,002
1d of drift changed what a PT sale pays            left  94,771,271,981  right  94,768,856,649
1d of drift changed a YT purchase        left (5,228,728,019, 2,417,946)  right (5,228,598,602, 0)
1d of drift changed what a YT sale pays            left   4,266,623,998  right   4,266,518,027
```

> **The first version of these tests was a false green** and passed against the unfixed tree. The
> funding helpers (`user_with_sr`, `mint_py`) all route through `sr::deposit`, which synchronizes —
> so doing the setup *after* the drift refreshed the rate and the trade ran on a fresh index. The
> helper now takes the setup and the trade as separate closures with the drift between them. This is
> the third time in this repository that an audit test has asserted something true about a nearby
> situation (`tofix.md` 26b/26c); the precondition has to be built deliberately.

### The quote views — fixed on the frontend side

`quote_sell_pt` and friends are views and **cannot** synchronize, so they still price on the stored
rate and therefore **overstate a sale**. Sizing `min_out` from a quote means a trade can trip its own
slippage bound and revert for no visible reason.

The dApp no longer trusts them for that. [`soroban.ts`](../../frontend/src/lib/soroban.ts) gained
`simulateCall`, and the four router write paths (`buy_pt_with_usdc`, `sell_pt_for_usdc`,
`sell_yt_for_usdc`, `redeem_py_for_usdc`) now **simulate the real entry point** with `min_out = 0`,
and floor the returned figure by the existing 1% exit slippage. Simulation runs the same
synchronized code the submission runs, signs nothing and sends nothing.

The `quote_*` views remain for display, and simulation falls back to them whenever it cannot run —
an unaffordable size, a route the pool cannot fill, an older deployment — so the change can never
block a trade that works today.

## V2-03 — FIXED (snapshot-and-compare)

`assert_drained()` required all four token balances to be **exactly zero** at the end of every entry
point. The intent was right — refusing to trade while holding somebody's funds beats quietly spending
them — but the absolute made the router trivially deniable. Reproduced at HEAD:

```text
router holdings after a 1-stroop USDC donation : (sr 0, pt 0, yt 0, usdc 1)
buy_pt_with_usdc      -> refused
sell_pt_for_usdc      -> refused
redeem_py_for_usdc    -> refused
admin sweep(usdc)     -> 1 stroop recovered, routes restored
```

One stroop of any of the four, from anybody, for the price of a transaction fee — repeatable
indefinitely, and only an admin could clear it. [`a4_the_router_refuses_to_be_a_custodian`](contracts/e2e/src/adversarial.rs)
could not see it because it donates **100 USDC**, and at 100 USDC the griefer is the one paying.

### The fix

Each entry point snapshots its holdings on the way in; the exit check compares against that snapshot
rather than against zero:

```text
  before:  assert  sr == 0  &&  pt == 0  &&  yt == 0  &&  usdc == 0
  after:   assert  sr <= before.sr  &&  pt <= before.pt  &&  yt <= before.yt  &&  usdc <= before.usdc
```

This keeps the whole of the original property. Dust resting on the contract from an earlier
transaction is carried through untouched and changes nothing. A donation made *during* the
transaction, or a leg that forgets to forward a balance, still raises a balance above where it
started and still fails. The router remains non-custodial in the sense that actually matters — **it
never ends a transaction richer than it began** — and `sweep` still recovers anything left on it.

### Regressions

Four tests, all verified to **fail against the old `== 0` rule**:

| test | asserts |
|---|---|
| `a4_the_router_refuses_to_be_a_custodian` | *(updated)* a 100-USDC donation is carried, not spent, and still fully recoverable by `sweep` |
| `a4b_one_stroop_of_dust_cannot_deny_the_router` | one stroop denies nothing; buy and sell both still work; the stroop is untouched afterwards |
| `a4c_dust_in_every_token_at_once_still_cannot_deny_the_router` | a stroop of SR **and** PT **and** YT **and** USDC at once — the cheapest total denial available — still denies nothing |
| `a4d_the_router_still_refuses_to_end_a_transaction_richer` | the half that must not be relaxed: a clean route leaves nothing behind, and a resting donation is neither spent nor accumulated |

`a4`'s assertion was deliberately changed, with the reasoning recorded inline at the call site so a
future reader does not mistake it for a weakened invariant.

### Budget

Two extra balance reads per token (snapshot plus check). Measured:

| path | V2-01 only | + V2-03 | Δ |
|---|---|---|---|
| `buy_pt_with_usdc` | 6,495,274 | 6,564,193 | +68,919 |
| `sell_pt_for_usdc` | 5,202,085 | 5,266,688 | +64,603 |
| `buy_yt_with_usdc` | 10,817,679 | 10,883,154 | +65,475 |
| `sell_yt_for_usdc` | 9,382,424 | 9,449,961 | +67,537 |

**~68 KB per path — 0.16% of the memory limit, and about 5% of what the V2-01 fix costs.** Token
balance reads are cheap next to a Blend reserve read. This does not meaningfully change the on-chain
budget question, which remains V2-01's.

## Solvency and asset-depletion analysis

### Standing risk — not a finding, and it does not close

**This is the one thing in this document that no amount of work removes.** Spield's principal sits in
Blend. If Blend takes a real loss, Spield holders take it too — there is no insurance capital, no junior
tranche, and no backstop fund. That is a design consequence, not a bug, and it is why the launch is
capped and the disclosure is a product surface rather than a footnote.

It is recorded here permanently so that a reader of this assessment cannot miss it, and so that a future
pass does not mistake “no open findings” for “no risk”. It has no owner elsewhere: `left.md` D1 covers
*rate decay*, which is the benign case where “every promise already made still pays in full” — a
different thing from principal loss.

#### Strategy and SR — conditionally solvent, not principal-guaranteed

- `strategy.current_rate()` rejects a falling Blend rate ([`strategy/src/lib.rs:208-228`](contracts/strategy/src/lib.rs#L208-L228)).
- Any fall freezes deposits, syncs and redemptions at every size.
- Recovery needs the admin-only `strategy.reset_rate_floor()`.
- After reset, `sr.redeem()` pays what the strategy actually returns, so loss is socialized pro rata.
- SR's public high-water rate stays nondecreasing, so a preview can over-state the post-reset payout.

No first-withdrawer advantage in the tested loss case, but a real user loss and an admin-dependent exit
freeze, with no insurance capital or junior tranche. Blend utilization can also make solvent assets
temporarily illiquid; `max_redeemable` and resumable vault redemption reduce but do not remove
simulation-to-execution liquidity races.

**Documentation and UI must not describe SR/PT/vault payouts as unconditionally guaranteed in USDC.**

##### Addressed 2026-08-30 — loss accounting is now answerable on chain

The residual risk is unchanged and unfixable in code: a Blend principal loss is borne by users, and
clearing the freeze needs an admin. What *was* missing is that nothing could answer **“how much money
actually exists, and what is my share worth?”** while it was happening — every SR value view
(`assets_of`, `preview_redeem`, `total_assets`) is built on `exchange_rate`, a high-water mark that
never falls and therefore over-promises after a loss.

Two pure views now answer it, and keep answering **during** the freeze:

| | |
|---|---|
| `strategy.position_value_unguarded()` | What the whole Blend position is really worth — live `b_rate`, **no** monotonicity guard, **no** write. The only rate path here that can report below the high-water mark |
| `sr.realizable_rate()` | `total assets that actually exist / total SR shares × 1e12` — the honest twin of `exchange_rate` |
| `sr.realizable_value(shares)` | A holder's actual pro-rata claim |

Neither is on a deposit or redemption path; the monotonicity guard is untouched and still freezes
exits, which is correct.

**Regressions** (`contracts/sr/src/test.rs`) — the pro-rata property is now pinned rather than assumed:

- `realizable_rate_reports_the_loss_while_exchange_rate_still_over_promises` — after a 20% haircut,
  `exchange_rate` holds at `1.0e12` while `realizable_rate` reports `0.8e12`; `preview_redeem` quotes
  1,000 USDC and `realizable_value` says 800. The gap is asserted at exactly the loss.
- `realizable_value_predicts_what_redemption_actually_pays` — the figure quoted **during** the freeze
  equals what the venue paid after the reset. The view is actionable, not decorative.
- `a_loss_lands_pro_rata_across_many_holders_in_any_exit_order` — four unequal holders, one splitting
  their exit in two, 25% haircut: every holder realises the same per-share value. Extends the existing
  two-holder `resetting_the_rate_floor_unfreezes_exits_and_the_loss_lands_pro_rata`, which already
  proved first-exit confers no advantage.

**Budget cost, measured** — these are additions to the two most-loaded modules, which `budget.md` §4
warns spends the transaction budget of every path that loads them:

```text
spield_sr.wasm        72,850 -> 74,920   +2,070 bytes  (+2.8%)
spield_strategy.wasm  60,453 -> 61,584   +1,131 bytes  (+1.9%)
```

Local per-path memory and ledger-entry counts are unchanged, but that is **weak evidence** — locally
contracts register natively, so module size costs nothing; the cost appears on chain at instantiation.
Fold this into the same `probe_budget.mjs` run the V2-01 fix requires.

**UI copy** — the dApp described the vault payout as *guaranteed* in six user-facing places, directly
contradicting its own `RiskDisclosure`. Now “fixed rate” / “fixed payout”: the rate genuinely is fixed
and locked; the payout is a claim on PT, which redeems from the Blend position. `frontendnew` (the
marketing site) carried no guarantee claims and was not touched.

The existing [`RiskDisclosure.tsx`](../../frontend/src/components/dashboard/sections/RiskDisclosure.tsx)
already discloses this well — the freeze, the admin dependency, reopening at reduced value, *“the loss
is shared in proportion to what you hold, and exiting first does not protect you”*, no backstop fund,
and that the displayed value is an upper bound rather than a quote. It needed no change.

**Wired into the UI, degrading gracefully.** `getRealizableRate()` / `getValueGap()` in
[`srstack.ts`](../../frontend/src/lib/srstack.ts) return **`null`** when the deployed contracts predate
the method — the same graceful degradation `srRead` already uses for the deposit cap — and
`RiskDisclosure` simply omits the comparison until then. Both failure modes reach `null` safely: a
simulation error throws and is caught, and a missing return value yields `0n`, which the `> 0n` guard
rejects. **No frontend change is needed at redeploy; the panel lights up on its own.**

The panel follows the component's own stated convention — *“it shows the live TVL cap next to the risk
it bounds… a number the user can read makes it a commitment rather than a claim.”* It renders quoted
rate, actually-backed rate and the shortfall in bps, turns destructive-red above zero, and states
plainly that the loss is pro rata and exiting first does not avoid it. A zero shortfall is shown too:
*“we checked, and today they agree”* is the reassuring half of the same fact.

#### Yield / PT / YT

Sound in shape: PT and YT minted equally against SR; pre-expiry recombination burns both legs;
post-expiry PT alone redeems principal; YT transfers settle both parties before balances move; credited
interest counts toward required backing; surplus sweep excludes PT backing and credited claims. The
suite covers hostile transfer ordering, repeated claims, slicing, abandoned YT, overflow-sized amounts,
fees and full-lifecycle solvency. No double-claim, free-mint or arbitrary-burn route found.

The guarantee is denominated in **SR shares**, inheriting the Blend-loss condition above, and depends
absolutely on the PT issuer being locked — the deploy script enforces this fail-closed, so it is a
deploy-time step rather than an open finding.

#### SR market

The reserve invariant at [`srmarket/src/lib.rs:989-1000`](contracts/srmarket/src/lib.rs#L989-L1000)
correctly requires actual balances to cover stored reserves, and exact-output/input checks, fee
ceilings, deadlines, min-outs and maturity gates are present. That invariant proves token coverage but
not that the conversion index is current — which is exactly how V2-01 moves value without tripping it.

One-sided PT or SR donations are not credited to reserves and have no market sweep path. They cannot
steal LP reserves, but donated assets are permanently stranded. Document this rather than presenting it
as recoverable liquidity.

#### SR vault

Principal model is sound and the rounding gap identified in the original pass is **closed** — see
[Closed as findings](#closed-as-findings).

Vault solvency still treats PT face as USDC par. After an actual Blend principal loss a PT burn may
return less cash than face; `assert_solvent()` correctly reverts rather than recording insolvency, but
the receipt then cannot receive its nominal payout without recapitalization. The fixed payout is
conditional, not guaranteed.

#### Router

Non-custodial after successful calls, which sharply limits custody risk — but see V2-03 for what that
strictness costs in availability. Pausing the router blocks convenience sell routes as well as entries;
direct exits in SR/Yield remain callable, so assets are not trapped, but comments and UI should
distinguish “protocol exit available” from “every router exit available”.

## Remaining smaller items

### Governance and upgrade risk

All contracts are upgradeable behind a configurable timelock. A compromised admin cannot upgrade
instantly but can schedule hostile code and move parameters within hard ceilings, and the same admin is
required to recover from a rate decrease. Production needs multisig administration, independent watchers
for scheduled upgrades and parameter changes, and a rehearsed rate-floor reset process.

### ECO-01 — market microstructure, calibrated and surfaced

The curve prices a trade at its **post-trade** proportion, so one large fill is charged conservatively
(in the LP's favour) while a split one converges on the true integral. Splitting therefore gets a
better price. That is inherited from Pendle's convention rather than an implementation fault, and a
round trip still loses the fee — `a_sandwich_round_trip_cannot_extract_value_from_the_pool` holds. But
it is real money to a large trader, so it is now measured and disclosed instead of left to be
discovered.

**Measured** — `srmarket::economics_test::eco01_how_the_slicing_gain_scales_with_trade_size`, balanced
500k/500k pool, one trade vs five slices:

```text
   trade   % of pool        1 trade     5 slices         gain
    5000          1%    52340818164  52352042022      0.0214%
   10000          2%   104625497122 104670359467      0.0429%
   25000          5%   261143212127 261423151317      0.1072%
   50000         10%   520884835097 522003844290      0.2148%
  100000         20%  1036115360770 1040619546929      0.4347%
```

The gain is **linear in the fraction of the pool consumed: ≈2.15 bps per 1%**. Five slices capture
~81% of everything available (100 slices reach +0.2659% where 5 reach +0.2148%), so there is no reason
to suggest more.

**What was built**

- `splitAdvice()` in [`srstack.ts`](../../frontend/src/lib/srstack.ts) applies that formula to the
  live reserves and returns `null` unless the estimated gain clears **0.1%**. Most trades say nothing.
- Above the threshold, the trade panel names the trade's share of the pool, the estimated gain, and
  suggests five pieces — with the reason, so it reads as an explanation rather than a scold.
- The denominator is the **smaller** reserve, so a lopsided pool warns earlier. Safe direction.

**Slippage is now the user's choice.** `min_out` was already enforced on every contract path, but the
frontend hardcoded a 1% floor. The trade panel now offers 0.1 / 0.5 / 1 / 3 / 5%, threaded through to
`min_out`, and the floor is applied to the **simulated executable amount** rather than to a `quote_*`
view (see V2-01). Tight protects the price and risks a revert; loose fills but accepts a worse rate —
that trade-off belongs to the user.

**Router-side auto-splitting was considered and rejected.** Five slices means roughly five times the
market work in one transaction, and the budget is already the binding constraint: `buy_pt_with_usdc`
sits at 15.7% of the memory limit *locally*, on a fixture that `budget.md` shows understating the
deployed pool by at least 4x, and two YT router paths are over budget today. Splitting is free when
the user does it across transactions and unaffordable when the contract does it inside one.

### ECO-02 — BLND emissions: verified absent, mechanism built anyway

**Checked against mainnet on 2026-08-30**, pool `CAJJZSGM…`, reading
`get_reserve_emissions(reserve_index * 2 + res_type)`:

| idx | asset | side | emissions |
|---|---|---|---|
| 0 | XLM | borrow | OFF |
| 1 | XLM | **supply** | **ON** |
| 2 | USDC | borrow | ON |
| **3** | **USDC** | **supply** | **OFF ← Spield's side** |
| 4 | asset[2] | borrow | ON |
| 5 | asset[2] | supply | OFF |

Blend allocates emissions to XLM *suppliers* and USDC *borrowers*. Spield supplies USDC, so it earns
nothing — and `get_user_emissions` on the deployed v1 strategy returns `null`: **not one stroop has
ever accrued.** The original finding ("rewards may be forgone") was right that nothing is claimed and
wrong to imply value is being lost.

The allocation is not permanent — configs carry an `expiration` (the live one ends 2026-09-03) and are
re-gulped each cycle, so USDC supply can be switched on without announcement. The mechanism is
therefore built, and the monitoring is the half that earns its keep now.

**What was built**

| where | what |
|---|---|
| `strategy.claimable_emissions()` | Pure view. `0` when nothing is allocated — the case today |
| `strategy.claim_emissions()` | **Permissionless**, destination fixed to `emissions_to()`. Returns `0` quietly when there is nothing; a keeper calls it on a schedule and an empty claim is the normal case |
| `strategy.set_emissions_to(addr)` | Admin-only. The destination is fixed *precisely so* the claim can be open — a stuck keeper key cannot strand the rewards, and an attacker cannot redirect them. Same shape as `Yield::sweep_surplus` |
| `sr_solvency_monitor.mjs` check 8 | Warns the moment `claimable_emissions` stops being zero. **Nothing else in the stack would notice** |
| `ttl_keeper.mjs` | Reads first, queues a claim only if there is something. Costs one simulation per weekly run while emissions are off |

**Why BLND is not reinvested for SR holders.** SR is minted one-for-one with the b_tokens Blend
returns, and its exchange rate is Blend's own `b_rate` — not `position / supply`. Re-supplying BLND
proceeds would mint b_tokens no SR is entitled to: `b_rate` would not move, no redemption could reach
the extra value, and `Sr::realizable_rate` would begin reporting above `Sr::exchange_rate` — a number
users could see and never realise. Delivering emissions to holders would require converting SR to
proportional accounting, which touches the high-water mark, the deposit cap, `max_redeemable` and every
preview. That is a redesign, not a rewards feature. Routing to the treasury leaves every SR invariant
exactly as it is.

**Tests** (`contracts/strategy/src/test.rs`)

- `eco02_claiming_with_no_emissions_configured_is_a_quiet_zero` — the mainnet case today: a keeper hits
  this weekly and it must be a no-op, not a revert. Passes.
- `eco02_the_claim_is_permissionless_but_the_destination_is_not` — defaults to the admin, admin can
  retarget, a stranger can trigger. Passes.
- `eco02_when_emissions_are_switched_on_the_treasury_is_paid` — **`#[ignore]`d, honestly.**
  `pool.gulp_emissions()` reverts with Blend's `Error(Contract, #1200)` regardless of how the
  emitter/backstop steps are ordered; Blend gates gulping on weekly cycle bookkeeping that
  `BlendFixture` does not set up. The allocation, wiring and assertions are correct and only the three
  priming lines need solving, so it is kept as a running start rather than deleted.
  **The paying path is therefore unproven locally and should be exercised on testnet with emissions
  enabled before anyone relies on it.**

## Closed as findings

Re-verified at `bde087bd`. **None of these is an open defect in this report**, for one of two reasons:

- **Fixed in code** by `fix 2.3` / `fix 2.4` — nothing further to do.
- **Owned elsewhere** — a real deploy-time or operational step, tracked in the file that owns it
  ([`left.md`](left.md) §A for launch steps) rather than duplicated here as an audit finding.

The distinction matters: “closed as a finding” is not the same as “done”. The rows below say which.

| Original ID | What it claimed | Why it is closed |
|---|---|---|
| **V2-02** | `srvault` reserves only two stroops per receipt; many partial legs could exhaust it | `fix 2.3` added `PARTIAL_LEG_BUDGET = 64` and `RECEIPT_RESERVE = REDEEM_DUST + PARTIAL_LEG_BUDGET` ([`srvault/src/lib.rs:47-67`](contracts/srvault/src/lib.rs#L47-L67)), reserved by `deposit`, refused by `sweep`, netted out of `stats().coupon_capacity`. This is `anyfix.md` F2 and is exactly the fix requested |
| **CFG-01** | Cap semantics counted accrued yield as new exposure; separately, prose described the cap as 5 USDC | **Both halves closed.** Semantics: `fix 2.3` moved the cap to cost basis — [`sr/src/lib.rs`](contracts/sr/src/lib.rs) gates on `total_principal`, not `total_supply × rate` (`anyfix.md` F4). Value: confirmed correct at **50 USDC** (`500000000`) by the owner, unchanged; the three stale “5 USDC” references (`deploy_mainnet.sh:25`, `blendcalibration.md:481` and `:607`) were corrected on 2026-08-30. The remaining “5 USDC” mentions in `blendcalibration.md` §8 are the **live testnet** cap and are correct as written |
| **OPS-03** | Long-lived holder/LP/receipt records depend on keeper calls nobody runs | `.github/workflows/spield-keeper.yml` runs a weekly full TTL pass with a solvency watchtower step. *Operational precondition: `STELLAR_KEEPER_SECRET` must be set in repo secrets* |
| **OPS-04** | A late first post-expiry sync folds post-expiry growth into the maturity index | Documented honestly in the `yield` module docs with measured impact (21.37 / 42.65 / 147.69 USDC at expiry / +30d / +180d), shown to be unfixable on chain because Blend exposes no historical rate, and bounded to 24h by the **daily** `--stamp-only` cron plus `sr_solvency_monitor.mjs` check 7. `anyfix.md` F5 |
| **OPS-02** | PT solvency depends on irreversibly locking the classic PT issuer; the original pass called the lock “procedural” | **Handled by tooling, fail-closed.** [`deploy_mainnet.sh:499-548`](scripts/deploy_mainnet.sh#L499-L548) defaults `LOCK_ISSUER=1`, refuses to lock unless the PT SAC admin is already the yield contract, refuses if any extra signer exists, sets master weight to 0, and **re-verifies against Horizon on every subsequent run**, hard-exiting if any signer with positive weight remains. The 2026-08-25 resume bug (checking a regenerated key instead of the recorded `PT_ASSET_ID`) is fixed. The lock executes during the mainnet deploy; it is not a code defect. *Note: `deploy_sr_testnet.sh` defaults `LOCK_ISSUER=0` by design, so the testnet issuer is deliberately left live, and no V2 deploy touches V1's separate mainnet issuer* |
| **OPS-01** | `MAINNETCONTRACTADDRESSES.md` labels the retired V1 deployment “V2”; no `deploy_mainnet_v2.state` exists | **Tracked as a deploy step, not an audit finding — owned by [`left.md`](left.md) A5** (“Point the frontend at the new contracts”), which is in that file's *Blockers — mainnet cannot launch without these* section and already covers both the `config.ts` mainnet block and the address doc. `deploy_mainnet_v2.state` is created automatically by `deploy_mainnet.sh:169`. Note for whoever executes A5: `mainnet.contracts` in `config.ts` still holds the live V1 wrapper/vault/market, `VAULT_DEPLOYED` is derived from `CONTRACTS.vault.length > 0`, and 65 call sites consume those values — so the V1 block must be emptied or explicitly retired, not just have `sr` filled in |

Also closed by `fix 2.3`/`2.4` and worth knowing: `anyfix.md` F1 (`redeem_partial` reverted under a
stale rate) and F1b (`max_redeemable` claimed “unbounded” while the exit reverted) — both the same
stale-rate seam as V2-01, fixed on the SR side but **not** on the market side.

## Retired V1 must remain retired

V1's tests intentionally demonstrate severe defects. A green result does not mean they are fixed;
several pass *because* they reproduce them. Confirmed V1 issues include a market initializable with a
foreign settlement asset ([`market/src/test.rs:1372-1421`](contracts/market/src/test.rs#L1372-L1421)),
post-maturity liquidity adds (`:1431`), dust adds minting zero LP shares (`:1470`), no caller-controlled
minimum shares (`:1602`), fragmented vault positions exceeding transaction-memory limits, wrapper views
mutating strategy rate-bound state, exits accounting for requested rather than actual withdrawals, no
pre-maturity principal exit for YT-only holders, permanently widened dust tolerance, and stranded yield.

The addresses in `scripts/deploy_mainnet.state` are documented as zero-TVL and unseeded. **Do not seed,
advertise or reuse them.** The live classic PT/YT issuer remains an operational concern.

> Note: the deployed V1 binaries also **lag** `contracts/`, and `version()` cannot see the difference.
> Reasoning about live V1 behaviour from source is unsafe — compare `code_hash` on chain.

## Verification performed

| Check | Result |
|---|---|
| Manual contract/accounting review | Completed for all six V2 contracts, shared math/governance/TTL, and material V1 paths |
| `cargo test --workspace` | **Passed: 605 tests, 0 failures, 2 ignored** (591 at `bde087bd`, plus loss-accounting, stale-index, router-dust, ECO-01 calibration and ECO-02 emissions tests) |
| Mainnet emission read | **BLND emissions are OFF for USDC supply** on pool `CAJJZSGM…`; the deployed strategy has never accrued. Read-only, via `mainnet.sorobanrpc.com` |
| Source drift `26f8fd8a` → `bde087bd` | `sr`, `srvault`, `strategy`, `yield` changed. **`srmarket` and `srrouter` unchanged** — which is why V2-01 and V2-03 survive |
| V2-01 fix, two implementations | A (`sr.sync_rate` in the market) and B (mutating index via `Yield`) both built and measured; **B shipped**, marginally cheaper |
| V2-01 regressions | 5 tests at 1/7/30/90 days of drift. **Verified to FAIL against the unfixed tree at 1 day** — the first draft was a false green and was rebuilt |
| V2-01 budget delta | **Measured: +~1.333 MB on every trading path**, identified as one Blend `get_reserve`. Local only — **the on-chain probe is the remaining gate** |
| Quote-view overstatement | Fixed on the frontend: 4 router write paths now size `min_out` by simulating the real entry point, falling back to `quote_*` |
| V2-03 fix | Snapshot-and-compare. 4 regressions **verified to fail against the old `== 0` rule**. Two pre-existing tests (`a4`, `donations_are_sweepable_…`) encoded the old behaviour and were updated deliberately, with the reasoning recorded inline |
| V2-03 budget delta | **+~68 KB per path** — 0.16% of the limit, ~5% of what V2-01 costs |
| RISK-01 loss accounting | `realizable_rate` / `realizable_value` added and pinned by 3 regressions; WASM cost measured at +3,201 bytes across `sr` + `strategy` |
| `tsc --noEmit` (dApp) | **Passed** — no error in any file touched here |
| `npm run build` (dApp) | **Fails, and fails identically at HEAD** — `@solana/web3.js` and `@reown/appkit-adapter-solana` are declared in `package.json` but absent from `node_modules`, from the CCTP bridge work. Pre-existing and unrelated; an `npm install` is the likely fix. **The dApp does not currently build on this checkout** |
| `cargo fmt --all -- --check` | **Failed** — 874 diffs of pre-existing formatting drift; nothing reformatted during review |
| Live-chain verification | **Not performed.** Local state/docs only. Absence of a local V2 state file is not proof that no external deployment exists |

Test success is evidence, not a financial-security proof. The suite uses mocks, does not model all
Stellar authorization/footprint races, and several V1 tests deliberately encode known failures.

The sharpest lesson from this pass: **591 green tests, including a purpose-built `advance_unsynced`
primitive, did not catch V2-01** — because that primitive was pointed at SR and the vault and never at
the market. Coverage is not the same as coverage *of the seam*. When a defect class is found in one
contract, the fix is not done until the same probe has been run against every other contract that
shares the seam.

## Required pre-launch checklist

**Code**

- [x] ~~Fix V2-01: synchronize SR before the market prices anything.~~ **Done** — `yield.py_index_current()`, one index per transaction.
- [x] ~~Add stale-index regressions for all four market routes.~~ **Done** — 5 `v6_*` tests in `contracts/e2e/src/invariants.rs`, verified to fail against the unfixed tree.
- [x] ~~Decide and implement the quote-view policy so `quote_*` cannot over-state execution.~~ **Done** — the dApp sizes `min_out` from a simulation of the real entry point.
- [x] ~~**THE REMAINING GATE.** Run `probe_budget.mjs` against a live deployment.~~ **Done 2026-08-30 — all six router paths fit**, including the two `budget.md` recorded as over budget. Re-run on the exact release commit before mainnet, with a `--user` holding PT and YT.
- [ ] Rewrite `the_markets_untracked_yt_residue_stays_at_dust` to drift the rate before buying, and assert no non-dust YT remains (the `v6_` test covers the behaviour; this one still asserts the old bound).
- [x] ~~Fix V2-03: snapshot-and-compare in `assert_drained`. Extend `a4` with a 1-stroop case.~~ **Done** — `after <= before` on all four tokens; `a4b`/`a4c`/`a4d` added, `a4` updated.
- [ ] **Sweep the rest of the stack for the same stale-rate seam.** F1/F1b/F3 fixed it in `sr`, V2-01 is the same bug in `srmarket`. Point `advance_unsynced` at every remaining read path that divides by a rate.

**Deployment**

- [ ] Deploy with `LOCK_ISSUER=1` and retain the script's on-chain lock verification with the deployment record.
- [ ] Set `STELLAR_KEEPER_SECRET` so the keeper workflow actually runs, and monitor both schedules.
- [ ] Rotate every admin to multisig; monitor upgrades, parameters, rate decreases, utilization and solvency.
- [ ] Execute [`left.md`](left.md) §A, in particular A5 — and empty or explicitly retire `config.ts`'s `mainnet.contracts` V1 block rather than only filling in `sr`.

**Disclosure**

- [x] ~~State explicitly that Blend principal loss is borne by users and can require an admin action to unfreeze exits.~~ **Done** — `RiskDisclosure.tsx` covers it; the vault's “guaranteed” copy that contradicted it is corrected; `sr.realizable_rate()` makes the honest number readable on chain.
- [x] ~~After redeploy, wire `realizable_rate` into the UI so the "displayed value is an upper bound" warning can show the actual figure.~~ **Done ahead of the redeploy** — the panel returns `null` and hides itself against contracts that predate the method, so it needs no change at deploy time. Verify it appears after the V2 deploy.
- [ ] Document that direct donations to the market are permanently stranded, not recoverable liquidity.
- [ ] Decide and publish a BLND reward policy, or state that emissions are forgone.

**Sign-off**

- [ ] Re-run the full Rust suite, release/WASM build, budget simulations and live-network smoke tests on the exact release commit.
- [ ] Obtain an independent third-party audit and resolve every high/critical finding before meaningful TVL.

## Final sign-off status

**NOT APPROVED FOR REAL-VALUE V2 LAUNCH OR SEEDING.**

**Both code defects are fixed, and the budget gate that was blocking them has been cleared on chain.**
A fresh testnet deployment carrying every fix in this document passes all six router paths, executes
the previously-stranding YT route with zero residue, and runs the fixed-rate vault end to end.

The remaining blockers are no longer technical findings from this review — they are the standing
pre-launch items: an independent audit, multisig admin rotation, and the `left.md` §A deploy steps.

Once both are settled, repeat this assessment against the exact deployment commit and on-chain
configuration. Deploy-time and operational steps are tracked in [`left.md`](left.md) §A, not here.

`fix 2.3` and `fix 2.4` were substantial and closed four of the original findings outright, but did not
touch `srmarket` or `srrouter` — which is where both remaining items live.

Under a no-loss, liquid Blend venue; a locked PT issuer; current TTL state; correct wiring; and honest
admin operation, the remaining V2 core accounting appears internally coherent. Those are material
assumptions, not unconditional guarantees.
