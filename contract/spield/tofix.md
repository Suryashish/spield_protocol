# tofix.md — what is still open

Finished work has been removed from this document. What remains is only what still needs a
**decision**, an **action**, or a **deploy step**. Each entry states what is left, not what landed.

Item numbers are unchanged from the original Phase 1 round so `testcando.md` cross-references and
git history still line up. The gaps in the numbering — **4, 5, 6, 7, 8, 9, 10, 11, 12, 14** — are
defects that closed cleanly, each with an acceptance test that goes red on regression; they are no
longer tracked here.

Verified against the working tree on **2026-08-19**. Suite: **192 tests, all green**; release WASM
builds clean with no warnings.

Severity legend — **P0** = must close before the first seed transaction; **P1** = close before
meaningful TVL; **P2** = documentation / belt-and-braces.

---

## What is left

| # | Item | Contract / area | Sev | What is left |
|---|---|---|---|---|
| [1](#1-market-bought-pt-has-no-redemption-path) | Market-bought PT has no redemption path | wrapper / market | P0 | **Not fixed** — design decision pending |
| [2](#2-a-seller-who-sold-their-pt-leg-cannot-redeem-transfer-or-combine) | Seller who sold their PT leg cannot exit | wrapper | P0 | **Not fixed** — same decision as item 1 |
| [13](#13-the-classic-ptyt-issuer-is-never-locked) | The classic PT/YT issuer is never locked | deploy script | P0 | **Not started** — prerequisite for item 1 |
| [3](#3-b_rate-decrease--a-deep-dip-still-blocks-exits) | `b_rate` dip: deep dips still block exits | strategy | P0 | Valve landed; **residual gap deferred by decision** |

Everything else from the Phase 1 round is closed. Nothing here is waiting on a deploy: the one item
that was (item 10, the market maturity cross-check) is now handled by the deploy scripts themselves —
see the note directly below — so it happens as part of the next deploy rather than as a checklist
step someone has to remember.

---

## Not a task any more: the market redeploy is part of deploying

Item 10's code landed earlier; only the on-chain redeploy remained, and that is no longer tracked
here because `deploy_mainnet.sh` / `deploy_testnet.sh` now do it and check it:

* **`REDEPLOY=market bash scripts/deploy_mainnet.sh`** replaces one contract in place — every other
  address, both PT/YT SACs and the pinned `SAVED_MATURITY` are kept, the state file is backed up, and
  only the market's deploy + initialize re-run. `REDEPLOY=wrapper|strategy` is refused outright,
  because SAC admin already belongs to the current wrapper and the wrapper's one-shot `initialize()`
  pins the strategy — neither can be swapped alone.
* **`FRESH=1` is the wrong tool** and an earlier revision of this document wrongly recommended it: it
  deletes the state file, so it re-creates the PT/YT SACs and changes *every* address.
* **The binding is asserted from chain on every run**, not just on a redeploy. After the market's
  init step the script reads `market.wrapper()`, `market.maturity()` and `market.pt_token()` back and
  aborts if they don't match the wrapper. The market currently live on mainnet predates the
  cross-check and has no `wrapper()` view, so the next run of the deploy script **fails loudly and
  prints the exact `REDEPLOY=market` command** instead of letting it be seeded.
* The summary block now names the off-chain files that pin the ids
  (`MAINNETCONTRACTADDRESSES.md`, and **both** the hardcoded profile and the `VITE_*` override in
  `website/frontend/src/lib/config.ts`), plus a `grep` to prove nothing stale is left.

Rehearse it on testnet first — `REDEPLOY=market bash scripts/deploy_testnet.sh` runs the identical
code path.

---

## 1. Market-bought PT has no redemption path

*`testcando.md` §0 P0 `market_bought_pt_is_redeemable_by_buyer` — **confirmed, NOT FIXED***

**Tests** — `market::test::market_bought_pt_has_no_wrapper_redemption_path`,
`market::test::transfer_position_is_the_only_exit_for_market_bought_pt`

These two are **deliberately left asserting the broken behavior**, so the gap stays visible in CI
until it is closed. Do not "fix" them; invert them as part of the real fix.

### The issue

`wrapper::redeem_pt(position_id, amount)` and `combine_and_redeem` are **position-gated**: they load
a `Position`, `require_auth` its `owner`, and burn from `pos.owner`'s SAC balance. A trader who buys
PT on the AMM holds a real PT SAC balance but owns **no position**, so there is no id to redeem
against — `try_redeem_pt` returns `PositionNotFound`. The wrapper exposes no balance-based
redemption entry point at all.

The test walks the headline "Earn Fixed via the AMM" flow end to end: the trader spends 100 USDC on
PT, holds to maturity, and finishes holding redeemable PT and **0 USDC**, with no call available to
convert one into the other.

The only exit that exists today is `transfer_position` from the seller — and the second test shows
that path is *also* broken in the common case: `transfer_position` moves `pos.pt_amount`, but once
an LP has put its PT into the pool and a trader has bought some out, the LP holds strictly less PT
than its position records, so the transfer reverts on the SAC leg.

### ⚠ Fix ordering — gated on item 13

`redeem_pt` being position-gated is currently **the only thing preventing counterfeit PT from
draining the wrapper**, because the classic PT/YT issuer is still an unlocked signing key (item 13).
`wrapper::test::extra_pt_outside_a_position_breaks_conservation_but_not_the_wrapper` pins this: PT
held against no position is unredeemable, so the wrapper survives. **Adding any balance-based
redemption removes that shield.** Lock the issuer first.

`testcando.md` §18 and its suggested order of attack have both been amended to put the §13 lockdown
ahead of these §0 P0s.

### Candidate fixes (needs a decision)

| Option | Change | Trade-off |
|---|---|---|
| **A. Defer** *(current state)* | Document the gap; do item 13 first, then revisit | Safest ordering; the flagship flow stays broken until then |
| **B. Post-maturity swaps at par** | Let the market keep quoting at par after maturity so buyers exit via the pool | No wrapper change, no counterfeit exposure; changes the maturity-halt semantics and needs LP-side thought. **Cheaper than it was:** the market↔wrapper cross-check makes the market's maturity provably equal to the wrapper's, so "after maturity" is now a single well-defined instant for both |
| **C. Balance-based `redeem_pt`** | Burn loose PT 1:1 against a global shares pool | Requires item 13 **first**, plus a wrapper accounting redesign — there is no position to decrement `principal`/`shares` against |
| **D. `split_position`** | Let a seller hand over a right-sized position with the PT | Small change, but the exit stays a manual off-protocol handoff |

---

## 2. A seller who sold their PT leg cannot redeem, transfer, or combine

*`testcando.md` §0 P0 `seller_with_sold_pt_cannot_redeem_or_transfer` — **confirmed, NOT FIXED,
degrades gracefully***

**Tests** — `market::test::seller_with_sold_pt_can_still_claim_yield`,
`market::test::seller_with_sold_pt_cannot_redeem_pt`,
`market::test::seller_with_sold_pt_cannot_combine_or_transfer`

Also left asserting the broken behavior on purpose.

### The issue

The mirror image of item 1. A user mints, sells the PT leg on the AMM, and keeps the position + YT.
The position still records `pt_amount = 100 USDC` while the SAC balance is 0, so:

* `claim_yield` — **works** (touches neither SAC). Yield accrues and pays correctly.
* `redeem_pt` — **reverts** on the SAC burn shortfall.
* `combine_and_redeem` — **reverts** (needs the PT leg).
* `transfer_position` — **reverts** (moves `pos.pt_amount`).

The good news, and the reason this is a design gap rather than a bug: every failure is **atomic**.
The test asserts `pos.pt_amount` and ownership are unchanged after each failed attempt, and that the
wrapper stays solvent. Position accounting and SAC balances diverge without corrupting state.

### What is left

Same decision as item 1 — they are one design question, not two. Whichever option is chosen there
resolves this. Under option **D** (`split_position`) a seller could split off exactly the PT they
still hold and keep a clean, exitable position.

When the fix lands, **keep the graceful-degradation assertions** (atomic failure, solvency held,
`claim_yield` unaffected) — they are worth having regardless of which exit path is added.

---

## 13. The classic PT/YT issuer is never locked

*`testcando.md` §13 — **confirmed by reading the script, NOT STARTED***

Promoted out of Appendix B because it directly blocks item 1.

### The issue

`scripts/deploy_mainnet.sh` hands SAC admin to the wrapper (lines ~210–222) but contains **no
`set-options`, no master-weight-0, and no flag lockdown anywhere**. The PT/YT issuer
(`GA4R5M7ZWOQZWIYCW246YC5WJ4QHT3H74CAUSTCEUUWIELCWI7IP3MKB`) therefore remains a live signing key: a
plain classic payment from it creates PT that bypasses the wrapper entirely.

Today the damage is contained only because `redeem_pt` is position-gated (item 1's gap acting as an
accidental shield). That is not a security design — it is a coincidence that items 1 and 2 are
scheduled to remove.

### What is left

1. Add the issuer lockdown to `deploy_mainnet.sh` — `set-options --master-weight 0` plus the auth
   flags — after SAC admin has been transferred to the wrapper and verified.
2. Verify on chain that the issuer can no longer sign, before any balance-based redemption ships.
3. Only then work items 1 and 2.

Not reachable from the test suite (needs network access and keys), so this lands as a script change
plus a §16 live-verification step, not as a unit test.

---

## 3. `b_rate` decrease — a deep dip still blocks exits

*`testcando.md` §0 P0 `brate_decrease_bricks_everything_including_exits` — **option A landed; the
residual is deliberately deferred, not resolved***

Already landed (not to be re-done): `strategy::reset_rate_floor()`, an admin-gated, immediate
valve that lowers the stored `last_rate` high-water mark to the pool's raw `b_rate`. It only ever
lowers, refuses a non-positive rate, and is covered by seven tests including one against real Blend.
`set_max_apr_bps` is not a substitute — it widens the *upper* ceiling; this is the *lower*
monotonicity guard.

### ⚠ The residual gap — deferred by decision (2026-08-19)

`reset_rate_floor` restores **reads unconditionally** and **exits for shallow dips**. It cannot
conjure backing, and it must not: the wrapper still asserts `backing >= principal` against Blend's
real position after every mutation (`wrapper::lib.rs::assert_solvent`).

* **Shallow dip** (backing still covers principal — e.g. a one-stroop dip, absorbed by the
  tolerance): the valve fully restores `claim_yield`, `combine_and_redeem`, `redeem_pt` and `mint`.
  Verified end to end, including that the user is really paid.
* **Deep dip** (backing genuinely below principal — tested at a 12% haircut with two positions
  outstanding): reads come back, so the dashboard and the off-chain monitor work and the size of the
  shortfall is visible — but **every mutation still refuses**, now with `SolvencyViolation` instead
  of `RateOutOfBounds`. Pinned for full, half and 1-USDC exits, so this is not a size threshold a
  small enough withdrawal slips under.

So for a real bad-debt event, option A converts *"frozen, cause unknown, dashboard dark"* into
*"visibly under-backed, and the shortfall is the thing blocking exits."* That is a genuine
operational improvement and it is **not** a general unfreeze. Funds stay inaccessible until the
backing recovers or a deliberate loss-allocation mechanism ships.

### What is left

**This was consciously deferred rather than decided** — it is still a live P0 for the §18 gate, and
none of the four options has been implemented:

| Option | Change | Trade-off |
|---|---|---|
| **Accept** | State plainly that a deep Blend bad-debt event freezes exits until backing recovers | Zero code. Leaves user funds inaccessible for an unbounded period in the worst case |
| **B. Tolerate a bounded decrease** | Allow `current >= last × (1 − max_drawdown_bps)` in `check_rate_bound_timed` | Self-healing, no admin action needed. Needs `max_drawdown_bps` calibrated against a realistic bad-debt event. **Does not clear the solvency assertion**, so a deep dip still blocks exits — this fixes the freeze, not the shortfall |
| **Split the guard** | Let **exit paths** tolerate a decrease (yield is already clamped at 0 in `math::yield_amount`) while **inflows** keep the strict check | Removes the human-in-the-loop for shallow dips. Same caveat: does not clear the solvency assertion |
| **Loss allocation** | Let a deep dip socialise the shortfall pro-rata across positions instead of refusing | The only option that actually restores exits in a deep dip. Much larger change: it means PT stops being a strict 1:1 claim, which touches the vault's solvency model too |

Note that the first three all leave the deep-dip case blocked. If restoring exits under real
bad debt is a launch requirement, only the fourth achieves it.

---

## Appendix B — what Phase 1 did not cover

Scope was `testcando.md` §0 plus §13's on-chain conservation law. Still open, by phase:

* **Phase 2** — §1 wrapper lifecycle edges, §2 strategy/rate-bound edges, §3 vault edges, §6
  systematic auth matrix.
* **Phase 3** — §4 AMM/curve edges, §8 pure-math properties, §9 remaining resource budgets, §12
  mainnet-parameter profile, §14 launch-seed calibration.
* **Phase 4** — §5 ecosystem stateful fuzz, §15 adversarial simulation, §7 event contracts, §10
  chaos drills, §11 mutation testing.

**Not reachable from the test suite** — §16 (live mainnet read-only verification) and §17 (testnet
operational drills) need network access and keys. They will be delivered as a written gap-report in
Phase 4 rather than as tests. Item 13's lockdown verification belongs here too.
