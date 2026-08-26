# V2 Remaining Work: What Is Wrong, Why It Matters, and How to Fix It

This document turns the open **v2** findings in [`tofix.md`](./tofix.md) into an implementation-oriented work list. It intentionally excludes work that applies only to the old v1 deployment.

Verification basis: **2026-08-26**. Every claim below was re-tested against the current tree or read from a live network this round. Local suite: **491 Rust tests green**; release WASM builds clean; SDK **218 tests green**.

## Revision note — what changed since the first draft

The first draft carried several claims that did not survive testing. They are corrected here rather than silently dropped, so anyone holding the old version can reconcile.

| Item | Was | Now |
|---|---|---|
| Deposit cap | Justified with `SolvencyViolation` freezing all withdrawals | **That is v1's failure, not v2's.** v2 exits survive a dip. Rewritten around the real risk — see [§1](#1-choose-and-apply-an-sr-deposit-cap) |
| `scalar_root` | Justified with a 4.990% → 4.406% measurement | **Measured on the v1 market, a different curve.** Rewritten and now blocked on §2 — see [§14](#14-calibrate-the-markets-scalar_root) |
| pnpm fix | `pnpm.onlyBuiltDependencies` in `sdk/package.json` | **Tested and it does not work.** pnpm 11 ignores that field — see [§11](#11-repair-the-documented-pnpm-test-command) |
| TTL helpers | Framed as an SDK-only omission | **Three of five entry types have no contract-level bump at all** — see [§9](#9-add-ttl-keep-alive-coverage-contract--sdk) |
| Resumable redeem | Eight safety properties | **Missing the solvency invariant**, which the change breaks — see [§5](#5-make-srvault-redemptions-resumable) |
| `add_liquidity` compat | Listed "router call sites" | **`srrouter` never calls the LP functions.** Removed |
| 11-stroop alarm | Two equally-weighted options | **Burning is feasible and strictly better** — see [§8](#8-reconcile-the-permanent-11-stroop-pt-alarm) |
| — | — | **New:** the market's reported rate never responds to trading — see [§2](#2-the-markets-reported-rate-and-price-never-respond-to-trading) |

## Scope

1. On-chain contract fixes.
2. Operational monitoring fixes.
3. SDK and developer-tooling fixes.
4. Risk and market-parameter decisions.

Terms used below:

- **SR** is the yield-bearing share token.
- **PT** is the principal token, representing principal due at maturity.
- **YT** is the yield token, representing the right to yield.
- **LP shares** represent ownership of the PT/SR liquidity pool.
- **TVL** is the total value deposited in the protocol.

## Priority summary

| Priority | Work | Type |
|---|---|---|
| P0 | Choose and apply an SR deposit cap | Risk/deployment decision |
| P1 | Fix the market's frozen implied rate and PT price | Contract fix |
| P1 | Reject liquidity additions that mint zero LP shares | Contract fix |
| P1 | Add caller-controlled protection to `add_liquidity` | Contract/API fix |
| P1 | Make `srvault` redemptions resumable | Contract fix |
| P1 | Allow safe recovery of surplus SR, YT, and USDC | Contract fix |
| P1 | Make the monitoring scripts independently runnable | Operations fix |
| P1 | Reconcile the permanent 11-stroop PT alarm | Operations fix |
| P2 | Add TTL keep-alive coverage | Contract + SDK fix |
| P2 | Add the complete `srvault` interface to the SDK | SDK/product fix |
| P2 | Repair the documented pnpm test command | Tooling fix |
| Decision | Calibrate the redemption-liquidity haircut | Risk parameter |
| Decision | Calibrate the Blend utilization alert | Monitoring parameter |
| Decision (blocked) | Calibrate `scalar_root` | Market parameter |

---

## 1. Choose and apply an SR deposit cap

### What is wrong

The v2 SR contract supports an on-chain deposit cap, but the live testnet value is `0`, which in this contract means **uncapped**.

```text
deposit_cap    0
total_assets   3433.2304105 USDC
```

The strategy has a known failure mode when Blend's backing rate dips. **The v2 behaviour is not the same as v1's, and this item was previously justified with v1's.** Measured this round in `sr::test::a_guarded_strategy_still_bricks_sr_on_a_rate_dip`:

| Operation | Result under a dip |
|---|---|
| `exchange_rate` and other reads | **Survive** — `exchange_rate` is a pure read of SR's stored high-water mark |
| `sync_rate` | Bricks (`RateOutOfBounds`, raised by the adapter) |
| `deposit` | Bricks (same cause) |
| **`redeem`** | **Survives** — it never reads the live rate |

```text
guarded dip: sync + deposits brick, but reads AND redeem survive — redeem paid 9999999999
```

A 1,000 USDC deposit still redeemed 999.9999999 USDC. **Exits are not frozen in v2.** There is no `SolvencyViolation` in the SR contract at all; that error belongs to the yield engine and to v1's wrapper.

### The risk the cap actually bounds

SR clamps its exchange rate to a high-water mark so the stack above it cannot reprice downward. The cost of that clamp is that SR **promises more underlying than the strategy can pay**. Measured in `sr::test::a_clamped_rate_never_promises_more_than_the_strategy_pays`, after a 50% collapse:

```text
clamped preview   1,000.0000000 USDC   (preview_redeem, uses the clamped rate)
actual payout       500.0000000 USDC   (redeem, honours what the strategy really returns)
```

So the real exposure is a **first-mover advantage**, not a freeze: redemptions are honoured in the order they arrive, out of a pool that is worth less than the sum of its promises. There is no pro-rata queue and no loss-allocation mechanism. Whoever exits last absorbs the shortfall.

### How to address it

Choose a maximum acceptable exposure and set it through `Sr::set_deposit_cap`. Also set `SR_DEPOSIT_CAP` in the deployment configuration so future deployments do not silently return to an uncapped state.

```text
SR_DEPOSIT_CAP=<approved value>
```

The number must come from the project's loss appetite. It bounds how much user money is exposed to an unallocated haircut while loss allocation remains unresolved.

### Why it must be done

The cap does not prevent a rate dip, does not repair the over-promise, and does not make redemption fair. It limits the size of the problem. **This remains the most important pre-launch v2 decision** — the reasoning changed, the conclusion did not.

### Acceptance criteria

- A non-zero cap has been approved and documented.
- The value is applied on-chain and read back successfully.
- The deployment configuration contains the approved value.
- Deposits above the remaining headroom revert.
- Redemptions continue to work even if the cap is later lowered below existing TVL (already pinned by `the_cap_can_never_trap_a_depositor`).
- A user's own yield does not consume headroom (already pinned by `yield_growth_does_not_eat_the_cap`).
- Monitoring reports the cap, total assets, and remaining headroom.
- **The disclosure describes the over-promise correctly** — that a dip degrades payout, not availability, and that exits are first-come-first-served.

---

## 2. The market's reported rate and price never respond to trading

**New finding, 2026-08-26.** Not present in `tofix.md`; found while attempting to calibrate `scalar_root`.

### What is wrong

`srmarket::implied_apy()` and `srmarket::pt_price()` return the same values no matter how much the pool is traded. Measured across four trade sizes on an identical 500,000/500,000 pool:

```text
size%  |    exec px (SR/PT) |  pt_price view |    implied_apy
     1 |        0.955277387 |   952380952309 |    50000000075
     2 |        0.955789963 |   952380952309 |    50000000075
     5 |        0.957329114 |   952380952309 |    50000000075
    10 |        0.959905081 |   952380952309 |    50000000075
    25 |        0.967833557 |   952380952309 |    50000000075
    50 |        0.982709845 |   952380952309 |    50000000075
```

**Execution is correct.** The realised price rises from 0.9553 to 0.9827 with size — real slippage, the curve works, there is no free arbitrage. **Only the reported views are frozen**, and identically so at every size: the 40-unit change in `implied_apy` is fixed-point rounding, not a response.

Confirmed on the live testnet market, whose reserves are heavily skewed after real trading:

```text
reserves      PT 58.937365 / SR 44.8906318      (a ~1.31:1 skew)
implied_apy   5.0000050221%                     (still exactly its seeded rate)
```

### Why it happens

`curve::try_params` derives the anchor so that the price at the proportion it is given is *by definition* the target price:

```rust
// contracts/srmarket/src/curve.rs
let target_price = exp_fixed(env, -fmul(env, last_ln_implied_rate, years)?)?;
// rate_anchor = target_price + logit(prop)/rate_scalar, so price(prop) == target_price now.
let rate_anchor = target_price
    .checked_add(fdiv(env, logit(env, prop)?, rate_scalar)?)?;
```

`try_price_at(prop, p) = anchor - logit(prop)/rate_scalar = target_price`. That is an identity for whatever reserves are passed in.

`Self::sync_implied_rate` (`contracts/srmarket/src/lib.rs:899`) then passes it the **post-trade** reserves and reads the price back at **that same** proportion:

```rust
let p = curve::try_params(env, pt_res, sr_res, ..., storage::last_ln_implied_rate(env), ...);
let asset_res = Self::sr_to_asset(env, sr_res, index);
curve::try_new_ln_implied_rate(env, pt_res, asset_res, &p)   // -> target_price -> the old rate
```

The stored rate is therefore a **fixpoint** and the update is a mathematical no-op. `pt_price()` is pinned the same way, because it also builds params from current reserves and the same stored rate.

This defeats the curve's stated intent. Its own module docs open with:

> **The anchor is recomputed, not pinned at par.** v1 pins `rate_anchor` at 1.0 forever ... Pendle re-derives the anchor.

### How to fix it

Pendle's `_updateMarketState` anchors on the **pre-trade** state and reads the price at the **post-trade** proportion. `sync_implied_rate` must do the same:

1. Build `Params` from the reserves **as they were before the trade** (and the stored `last_ln_implied_rate`).
2. Compute the post-trade proportion from the **new** reserves.
3. Read `try_price_at(post_trade_prop, pre_trade_params)`.
4. Derive and store the new implied rate from that price.

The asymmetry between which state anchors and which state is priced is the entire mechanism. Today both come from post-trade.

`add_liquidity` and `remove_liquidity` are a separate case: a proportional liquidity change should **not** move the implied rate. Confirm that the fix leaves them rate-neutral rather than assuming it.

### Why it must be fixed

`implied_apy()` and `pt_price()` are the numbers the dashboard headline, `srstack.ts`, and any external integrator read. Today they report the seeded rate forever. Consequences:

- The advertised APY stops matching the price users actually trade at.
- `pt_price()` is unusable as a valuation oracle for a PT position.
- The market cannot perform price discovery in any observable way, so nothing signals that PT is rich or cheap.
- **§14 cannot be started**: you cannot calibrate curve sensitivity against a quote that never moves.

### Test work

No existing test covers this. `srmarket::test::pt_still_converges_to_par_with_a_dynamic_anchor` only advances **time** and never trades, so it passes on `target_price = exp(-rate * years)` walking to par as `years -> 0`. It never exercises the anchor's response to flow.

New tests must:

1. Seed a pool and record `implied_apy` and `pt_price`.
2. Execute a buy and assert the implied rate **falls** and the PT price **rises**.
3. Execute a sell and assert both move the other way.
4. Assert the size of the move scales with the size of the trade.
5. Assert a proportional `add_liquidity` / `remove_liquidity` leaves the implied rate unchanged.
6. Assert the reported price stays consistent with the realised execution price of a marginal trade.
7. Keep `pt_still_converges_to_par_with_a_dynamic_anchor` green, and extend it to converge to par **after** trading, not only after idling.

---

## 3. Reject liquidity additions that mint zero LP shares

### What is wrong

The first-LP branch of `srmarket::add_liquidity` verifies that the calculated share amount is positive. The follow-on LP branch does not — it returns `lo` unchecked (`contracts/srmarket/src/lib.rs:189`).

After trading fees change the relationship between pool reserves and total shares, a sufficiently small deposit calculates zero new LP shares. Both legs floor to zero, so `hi - lo == 0` and the ratio check passes. The user's PT and SR are transferred and the user receives no LP ownership.

### Reproduced example

After two ordinary round trips grew reserves relative to total LP shares:

```text
PT reserve:    4,792,577,961,655
SR reserve:    5,199,710,318,777
Total shares:  5,000,000,000,000

add_liquidity(1 PT unit, 1 SR unit)
-> PT and SR transferred (pt=1, sr=1)
-> 0 LP shares minted
```

### How to fix it

Shares are already calculated before either transfer, so the guard is a straight insertion after the `let shares = …` block and before the `token::…transfer` calls:

```rust
if shares <= 0 {
    panic_with_error!(&env, Error::InvalidAmount);
}
```

`Error::InvalidAmount = 5` already exists in `spield-shared`, and is what the first-LP branch uses, so the two branches become consistent.

### Why it must be fixed

A successful liquidity deposit must always give the depositor pool ownership. Taking assets for zero shares breaks that invariant, creates silent dust losses, and can mislead applications that treat a successful transaction as proof that liquidity was minted.

### Test work

The existing audit test `tofix_26b_a_dust_add_cannot_swallow_the_deposit_for_zero_shares` uses a pool that has **never traded**. In that state `total_shares == pt_reserve`, so one unit still produces one share and the defect cannot occur. The test passes for the wrong reason.

The corrected regression test must:

1. Seed a pool.
2. Perform swaps so fees grow the reserves relative to total shares.
3. Submit a dust liquidity addition that would calculate zero shares.
4. Assert that it reverts with `InvalidAmount`.
5. Assert that the user's PT and SR balances are unchanged.
6. Assert that pool reserves and total shares are unchanged.

---

## 4. Add caller-controlled protection to `add_liquidity`

### What is wrong

`srmarket::add_liquidity` requires the deposit to match the live pool ratio within a hardcoded band of about 0.1% (`hi - lo > (hi / 1000) + 1`). It does not accept `min_shares` or any other caller-selected tolerance.

The pool ratio can change after a user calculates the deposit but before their transaction executes. A swap that lands first therefore makes an otherwise correct liquidity transaction revert.

This is a liveness and denial-of-service problem. The strict ratio check prevents a bad fill, so the LP's principal is not extracted, but the transaction fails and the LP wastes fees and time.

### Reproduced example

```text
Pool reserves: 500,000 PT / 500,000 SR
LP computes:   sr_in = pt_in * sr_reserve / pt_reserve    (an exact match)
```

A swap of roughly 1% of the pool lands first. The prepared, exactly ratio-matched addition **reverts**, and the LP has no argument that would accept a slightly different outcome.

### Preferred fix

Add a caller-supplied minimum share result:

```rust
add_liquidity(..., min_shares: i128)
```

The contract should:

1. Calculate shares using current reserves.
2. Reject zero shares as described in §3.
3. Revert with `SlippageExceeded` when `shares < min_shares`.
4. Otherwise transfer the assets and mint the calculated shares.

`Error::SlippageExceeded = 81` already exists in `spield-shared`.

An alternative design is to accept maximum PT and SR inputs, consume only the correct ratio, and refund the unused leg. If that design is selected, both maximum inputs must bind and all refunds must be tested.

### Why it must be fixed

The user should decide the acceptable result for their transaction. A fixed global ratio band makes legitimate liquidity additions easy to disrupt and cannot reflect different users' deadlines, transaction sizes, and risk tolerances.

### API and compatibility work

Changing `add_liquidity` requires coordinated updates to:

- The contract interface.
- The TypeScript SDK (`frontend/src/lib/srstack.ts` exports `addLiquidity`).
- Frontend transaction construction.
- Tests and deployment artifacts.

**`srrouter` does not call `add_liquidity` or `remove_liquidity`** and needs no change — verified this round.

### Test work

The existing audit test `tofix_26c_remove_liquidity_has_working_slippage_guards` exercises **`remove_liquidity`**, a different function that genuinely did gain `min_pt_out` / `min_sr_out`. It does not cover this defect at all.

New tests should cover:

- A reserve-changing swap followed by `add_liquidity`.
- Success when calculated shares meet `min_shares`.
- `SlippageExceeded` when calculated shares fall below `min_shares`.
- No asset movement on failure.
- The boundary case where calculated shares exactly equal `min_shares`.
- Zero-share rejection even when `min_shares` is zero.

---

## 5. Make `srvault` redemptions resumable

### What is wrong

`Sr::redeem_partial` can redeem as much as venue liquidity permits and burn only the shares actually redeemed. `srvault::redeem` still requires the entire receipt payout to be collected in one call (`contracts/srvault/src/lib.rs:247`):

```rust
let got = SrClient::new(&env, &sr_addr).redeem(&me, &me, &sr_out, &0i128);
if got < r.payout {
    panic_with_error!(&env, Error::WithdrawShortfall);
}
```

If only part of the payout can be collected, the transaction reverts, the receipt remains open, and no progress is stored.

### Example

```text
Receipt payout:                  1,000 USDC
Amount currently collectable:      920 USDC

Current result:
User receives:                       0 USDC
Receipt remains open:                    yes
Progress saved:                          no
```

### How to fix it

Use a resumable receipt design. Add a `collected` field to each receipt and bank successful partial collections against it.

```text
First redeem call:   collect 920 USDC   -> receipt.collected = 920
Second redeem call:  collect  80 USDC   -> receipt.collected = 1,000
Completion:          pay the holder, close the receipt, update liabilities exactly once
```

The final design must define where partially collected assets are held, who can continue the receipt, and when the user is paid.

### The solvency invariant must change with it

`srvault::assert_solvent` (`contracts/srvault/src/lib.rs:466`) is currently:

```rust
if Self::pt_inventory(env) < storage::total_liability(env) {
    panic_with_error!(env, Error::SolvencyViolation);
}
```

A resumable redeem burns PT while holding the proceeds as USDC, so PT inventory falls without liability falling and **every subsequent call would trip this assertion**. The invariant must become something equivalent to:

```text
pt_inventory + total_collected >= total_liability
```

This is not optional cleanup — the feature cannot ship without it. It also interacts directly with §6: collected USDC must be reserved, not sweepable.

### Why it must be fixed

Partial venue liquidity is useful. Discarding partial progress can keep receipt holders stuck even when most of their payout is available. Resumable collection also removes the requirement that full liquidity exist at one instant.

### Required safety properties

- A partial attempt never over-collects beyond the receipt's remaining payout.
- The same receipt cannot be paid twice.
- `collected` only increases by assets actually received.
- Failed calls do not corrupt `collected`, liabilities, or ownership.
- Receipt transfer semantics remain correct while funds are partially collected.
- The vault cannot sweep assets reserved for a partially collected receipt.
- The final payout and receipt closure are atomic.
- **The solvency invariant accounts for collected USDC**, as above.
- TTL bumping covers receipts that remain open across several collection attempts.

---

## 6. Allow safe recovery of surplus SR, YT, and USDC

### What is wrong

`srvault::sweep` can recover surplus PT, subject to a liability gate. It cannot recover any other token the vault owns.

A full lifecycle test — 20,000 USDC seed, one 1,000 USDC receipt, harvest, expiry, `stamp_expiry_index`, post-expiry harvest, redeem — left this inventory after `total_liability` reached 0:

| Asset | Remaining amount | Recoverable today? |
|---|---:|---|
| PT | 20,196.7086960 | Yes — `sweep()` recovered all of it |
| **SR** | **248.5274157** | **No** |
| **YT** | **21,246.7086962** | **No** |
| **USDC** | **0.0000001** | **No** |

### Why these assets remain

- **SR:** post-expiry `harvest` correctly remains available, but `mint_py` refuses to mint after expiry, so the claimed SR is parked in the vault. Observed: `post-expiry harvest: claimed 2485274157 SR, reinvested 0`. **This is created by the fix for `tofix.md` #21** — allowing post-expiry harvest is right, and it produces an asset with no exit.
- **YT:** the vault still owns YT after expiry. It is economically dead but is still inventory.
- **USDC:** `redeem` deliberately pays the promised amount and keeps the flooring remainder, which accumulates one receipt at a time.

In the measured run the stranded SR was about **1.2% of the seed**, and it is real value.

### How to fix it

Two reasonable approaches:

1. Extend sweeping with `sweep_token(to, token, amount)`, applying a per-asset capacity rule.
2. Change post-expiry harvesting so harvested SR is unwrapped to USDC, then provide a safe way to sweep surplus USDC. Note this does **not** remove the need for a USDC sweep path — it only consolidates the problem into one asset.

The existing PT liability gate is already stronger than originally requested, since it releases surplus above open payouts plus a per-receipt buffer rather than requiring zero liability. New paths must preserve that principle: no sweep may remove assets needed for open receipts, redemption buffers, or partially collected receipts (§5).

### YT must be post-expiry only

Before expiry the vault's YT is what generates the harvest yield that funds coupons. A pre-expiry YT sweep would silently degrade the vault's ability to meet future payouts without tripping `assert_solvent`, which only compares PT face against liability. **The YT rule must be gated at or after expiry, explicitly.**

### Acceptance criteria

- Surplus SR can be recovered after all applicable liabilities are protected.
- Surplus USDC can be recovered without touching receipt backing.
- YT can be removed only at or after expiry, under an explicitly documented rule.
- A pre-expiry YT sweep is rejected.
- Unauthorized callers cannot sweep.
- Sweeping at or above reserved capacity reverts.
- Partial receipt collections are included in reserve accounting.
- A full lifecycle test finishes without inaccessible valuable inventory.

---

## 7. Make the monitoring scripts independently runnable

### What is wrong

The monitoring scripts import `@stellar/stellar-sdk`, but `scripts/` has no package manifest and no local dependency installation. Running either monitor as documented fails before any protocol check runs:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@stellar/stellar-sdk'
  imported from …/scripts/sr_solvency_monitor.mjs
```

Node resolves ESM imports from the **script's own directory**, not the working directory, so `cd`-ing into a project that has the dependency installed does not help. Both monitors had to be copied next to a `node_modules` tree to run at all this round.

### How to fix it

Add a reproducible package definition for the monitor scripts:

```json
{
  "type": "module",
  "dependencies": {
    "@stellar/stellar-sdk": "<pinned-compatible-version>"
  }
}
```

Document clean install and run commands. Pin the SDK using the repository's dependency policy and commit the appropriate lockfile.

### Why it must be fixed

A watchtower that cannot be started from its documented path provides no protection. During an incident, operators must not need to discover an accidental dependency environment before they can inspect solvency.

### Acceptance criteria

- A clean checkout can install the monitor dependencies.
- Both monitors start using the documented commands.
- One-shot and daemon modes work.
- Dependency or RPC failures produce explicit unhealthy output.
- The runbook specifies required environment variables and network selection.

---

## 8. Reconcile the permanent 11-stroop PT alarm

### What is wrong

The issuer-lockdown rehearsal deliberately created counterfeit PT. The v2 watchtower correctly detects it, and therefore fires on **every** run:

```text
✗ PT COUNTERFEIT: classic PT supply 16887669292 exceeds engine total_py 16887669281 by 11.
```

The probe is working exactly as designed. The problem is that its alarm is now permanent and benign.

### How to fix it

**Preferred: burn the 11 excess stroops.** This restores exact conservation (`pt_supply` falls to `total_py`; PT is fungible, so any 11 stroops will do) and costs 0.0000011 PT.

It is feasible today. Sending a classic asset to its issuer burns it and **does not require the issuer to sign**, so the completed lockdown is not an obstacle. Verified this round: of the five testnet SPLDPT5 holders, three are locally controlled identities, including `alice425` holding 758.4426049.

**Fallback: a signed baseline offset** of 11, alarming on any difference beyond that exact baseline:

```text
Observed 11, baseline 11 -> unexpected 0  -> healthy
Observed 21, baseline 11 -> unexpected 10 -> alarm
```

This is strictly worse and should be used only if burning proves impossible. It writes a permanent exception into the conservation identity, so every future audit and every future operator has to know about it, and the identity stops being self-evident. It would not be acceptable on mainnet.

Do not widen the check with an arbitrary tolerance under either option. Exact conservation is what makes this probe useful.

### Why it must be fixed

A permanently red monitor causes alert fatigue and can hide a real future counterfeit mint behind a known discrepancy.

### Acceptance criteria

- The reconciliation choice is documented and auditable.
- Normal testnet state reports healthy.
- A one-stroop change above the reconciled baseline triggers an alarm.
- If an offset is used, the monitor prints both the raw difference and the approved offset.

---

## 9. Add TTL keep-alive coverage (contract + SDK)

### What is wrong

Soroban persistent entries are archived when their TTL lapses. Every entry is bumped on write, but an entry that is simply **held and never touched** depends on a permissionless top-up call — and most of them do not have one.

Current coverage:

| Entry | Bumped on write | Permissionless bump function |
|---|---|---|
| `srvault` Receipt | maturity-aware | `srvault::bump_receipt` |
| `yield` Interest | maturity-aware | `yield::bump_holder` |
| **`yield` YT balance** | 1-year rolling | **none** |
| **`Sr` SR balance** | 1-year rolling | **none** |
| **`srmarket` LP shares** | expiry-aware | **none** |

`yield::bump_holder` extends only the `Interest` entry (`storage::bump_interest_ttl`), not the holder's YT balance.

Separately, neither of the two that do exist is reachable from `frontend/src/lib/srstack.ts`, so no shipped client code calls them.

SR is the most exposed of the three gaps: `Sr::bump_horizon` requests a one-year extension on every balance write, but that is clamped to the network's `max_live_until_ledger`, and SR has **no maturity of its own** to bound the holding period. A depositor who wraps USDC and does nothing for longer than the network TTL ceiling has no supported way to keep their balance alive.

PT is unaffected — it is a classic Stellar Asset Contract, so its balances are trustlines in the classic ledger and are not subject to archival.

### How to fix it

**Contract work (three additions):**

```rust
Sr::bump_holder(user)             // extend an SR balance entry
Yield::bump_yt_balance(user)      // extend a YT balance entry (or fold into bump_holder)
SrMarket::bump_lp(lp)             // extend an LP share entry
```

All should be permissionless, matching the existing pattern — they only prolong an entry and never mutate accounting.

**SDK work:** expose every bump function as a typed helper, plus enough read surface for the caller to decide whether a bump is needed and skip pointless transactions when TTL is already sufficient.

```ts
bumpVaultReceipt(receiptId)
bumpYieldHolder(holder)
bumpSrHolder(holder)
bumpLpPosition(lp)
```

Define when the application calls them: on position creation, when loading state near its TTL threshold, and before maturity or redemption operations.

### Why it must be fixed

Long-dated financial positions must stay accessible through maturity, and an SR position has no maturity at all. Contract functions alone do not solve this if no supported client invokes them — and for three of the five entry types, the contract function does not exist either.

### Acceptance criteria

- Every archivable per-holder entry has a permissionless bump function.
- All bump functions are available through typed SDK methods.
- Tests verify the correct contract, account/receipt, and transaction arguments.
- A test confirms `yield::bump_holder` (or its replacement) extends the YT balance entry, not only the interest entry.
- The application has a documented keep-alive policy.
- Failure and restoration guidance is documented.

---

## 10. Add the complete `srvault` interface to the SDK

### What is wrong

The fixed-rate vault is deployed and seeded on v2 testnet (`SRVAULT_INIT=1`, `VAULT_SEEDED=1`) but has no supported client surface. `srstack.ts` contains no vault calls at all — no deposit, quote, receipt read, redemption, statistics, or harvest.

The product exists on-chain and is effectively unavailable to the shipped application.

### How to fix it

Add a typed `srvault` client covering at least:

- `deposit`
- `redeem`
- `quote`
- Receipt lookup and ownership
- `stats`
- `harvest`
- `bump_receipt`
- Transaction simulation and submission
- Contract error decoding

Sequence this **after** §5 and §6: resumable redemption changes the receipt structure and the redeem result, and the sweep work changes the admin surface. Design the SDK against the final interface.

### Why it must be fixed

Without a supported SDK, each frontend or integrator must construct Soroban transactions by hand. That increases integration errors and prevents ordinary users from accessing a deployed product.

### Acceptance criteria

- Every intended user-facing vault operation has a typed SDK method.
- Read methods decode receipt and vault state correctly, including `collected` once §5 lands.
- Write methods simulate, expose fees, and submit transactions consistently with the rest of `srstack.ts`.
- Contract errors map to useful SDK/application errors.
- Unit tests cover successful calls, validation, and contract failures.
- A lifecycle integration test covers quote, deposit, receipt read, harvest, TTL bump, and redemption.

---

## 11. Repair the documented pnpm test command

### What is wrong

The SDK's tests pass when Vitest is invoked directly, but the documented command fails before tests begin:

```text
pnpm run test:unit
-> [ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.21.5, esbuild@0.27.7
-> [ERROR] Command failed with exit code 1: pnpm install
```

A direct `npx vitest run …` passes all 218 tests, so the problem is the package-manager entry path, not the suite.

### The fix

**Not** `pnpm.onlyBuiltDependencies` in `sdk/package.json`. That was tested this round and does not work — pnpm 11.9.0 rejects it explicitly:

```text
[WARN] The "pnpm" field in package.json is no longer read by pnpm.
       The following keys were ignored: "pnpm.onlyBuiltDependencies".
```

The setting now lives in `sdk/pnpm-workspace.yaml`, where a stub already exists with an **unfilled placeholder value**:

```yaml
allowBuilds:
  esbuild: set this to true or false
```

The fix is to complete it:

```yaml
allowBuilds:
  esbuild: true
```

Verified: with that one line, `pnpm run test:unit` runs and passes **15 test files / 218 tests**.

If the repository must also support pnpm 10 or older, keep the `package.json` field as well — it is ignored rather than fatal on 11 — but `pnpm-workspace.yaml` is what actually resolves it on the installed toolchain.

### Why it must be fixed

CI and contributors must be able to trust the documented test command. A hidden direct-Vitest workaround can cause skipped validation or make a healthy test suite appear broken.

### Acceptance criteria

- A clean pnpm install succeeds without the ignored-build failure.
- `pnpm run test:unit` starts and passes the complete intended suite.
- CI uses the same command documented for contributors.

---

## 12. Calibrate the redemption-liquidity haircut

### What is wrong

`strategy::available_liquidity()` reports Blend's raw token balance. That is an upper bound: Blend may refuse a withdrawal that would push utilization beyond its allowed ceiling.

`Sr::max_redeemable` applies a fixed 1% safety haircut:

```rust
const LIQUIDITY_HAIRCUT_BPS: i128 = 100;
```

The 1% is an unmeasured guess. It is applied only when liquidity actually binds — when the venue covers everything, `max_redeemable` returns `i128::MAX`, so the haircut cannot prevent a full exit on a healthy venue. Live testnet reading this round confirms the healthy path:

```text
max_redeemable                 i128::MAX
strategy.available_liquidity   38356.8771733 USDC
```

### Example

If raw liquidity is 100,000 USDC, the protocol estimates 99,000 USDC is safely redeemable. If Blend's utilization rule permits only 92,000 USDC, `max_redeemable()` is still too optimistic and a supposedly safe redemption fails. If Blend can actually release 99,900 USDC, the haircut is unnecessarily restrictive.

### How to address it

Measure, across representative utilization levels:

- Raw underlying balance.
- Maximum withdrawal Blend actually accepts.
- The difference between the two.
- Behaviour close to Blend's maximum utilization.

Use those observations to choose a documented safety margin. Re-test if the selected Blend pool or its parameters change.

### Why it must be done

`max_redeemable()` should be a useful pre-transaction bound. An optimistic bound still produces unexpected reverts; an excessively conservative one delays withdrawals for no reason.

---

## 13. Calibrate the Blend utilization alert

### What is wrong

The watchtower warns above 85% utilization. Its first live testnet run observed 85.4% and warned immediately. It is not yet known whether 85% is a genuine danger zone or normal operation for this venue.

### How to address it

Relate utilization to actual withdrawal headroom, then choose meaningful warning and critical levels. A multi-stage alert is likely more useful than one threshold, but its numbers must come from measurement rather than convenience.

Illustrative only:

```text
Below 85%: healthy
85%-90%:   warning
Above 90%: critical
```

This work shares its measurement with §12 — both need the same "what will Blend actually pay at utilization X" data.

### Why it must be done

A threshold that is always active causes alert fatigue. Raising it without measuring the true liquidity danger point could instead hide an approaching redemption freeze.

### Acceptance criteria

- The selected threshold is tied to measured withdrawal headroom.
- Normal operation is not permanently alarming unless it is genuinely unsafe.
- Warning and critical messages explain the expected operator response.

---

## 14. Calibrate the market's `scalar_root`

**Blocked on §2.** Do not start this until the anchor fix lands.

### What is wrong

`scalar_root` controls how strongly trades move the market's implied yield. The live testnet value is **40** (SCALAR_12), alongside `ln_fee_root` 0.0025 and a 2,000 bps treasury fee share.

Whether that value is right is currently **unmeasurable**. Per §2, `implied_apy()` and `pt_price()` do not move in response to trading, so the observable sensitivity of the curve is zero at every trade size. There is no signal to calibrate against.

### Correction to the previous draft

The earlier version of this item cited a measurement of 4.990% → 4.406% after a single 2,000 USDC buy, persisting at 4.361% six months later, and attributed the persistence to a fixed anchor that never re-anchors.

**That measurement is from the v1 market**, `contracts/market/src/test.rs`, which is a different contract with a different curve implementation and a PT/USDC pool rather than PT/SR. v1 does pin `rate_anchor` at par forever; `srmarket` was written specifically to re-derive it. Those numbers say nothing about `srmarket` and must not be used to size its `scalar_root`.

### How to address it, once §2 is fixed

Choose `scalar_root` against:

- Expected seed liquidity.
- Typical and large trade sizes.
- Expected balance of PT and YT flow.
- Maximum acceptable quote movement per trade.
- How far the market rate may reasonably diverge from the vault rate.

Then re-run the sensitivity measurement on `srmarket` itself — buy and sell sweeps across sizes, at several times to expiry — and select the deployment value from that data.

### Why it must be done

If the curve is too sensitive, moderate trades cause large rate changes. If it is too insensitive, pricing responds too slowly and more liquidity is needed to reflect demand. Neither can be judged until the reported rate reflects reality.

---

## Recommended implementation order

1. Approve and apply the deposit cap (§1).
2. **Fix the anchor so the reported rate and price respond to trading (§2)** — it blocks §14 and makes every other market measurement trustworthy.
3. Fix zero-share liquidity additions and their regression test (§3).
4. Add caller-controlled `add_liquidity` protection and update the SDK and frontend call sites (§4).
5. Implement resumable vault redemption, including the solvency-invariant change (§5).
6. Extend safe surplus recovery to SR, YT, and USDC (§6).
7. Make the monitoring scripts reproducibly runnable (§7).
8. Burn the 11 counterfeit stroops so normal monitoring is green (§8).
9. Add the missing contract bump functions and expose all of them in the SDK (§9).
10. Add the final `srvault` interface to the SDK (§10).
11. Complete `sdk/pnpm-workspace.yaml` and verify the documented command (§11) — a one-line change that can be done at any point.
12. Measure and approve the liquidity haircut and utilization thresholds (§12, §13).
13. Re-measure and approve `scalar_root` (§14).
14. Rebuild, test, deploy, and verify the new contract code hashes and interfaces on-chain.

## Definition of done for the v2 work

- All contract fixes have regression tests that reproduce the old defect and prove the new behaviour.
- **Every test that claims an item is closed reproduces that item's actual preconditions.** Three tests in the current tree failed this bar (`tofix_26b_*` on a never-traded pool, `tofix_26c_*` on the wrong function, `pt_still_converges_to_par_with_a_dynamic_anchor` without trading) and each hid a live defect.
- The full Rust and SDK suites pass using documented commands.
- Release WASM builds cleanly.
- Updated contracts are deployed or upgraded through the approved process.
- Live code hashes and interfaces match the intended builds.
- The deposit cap and all calibrated parameters are approved, applied, and read back.
- Monitoring starts from a clean checkout and reports a healthy baseline.
- The SDK exposes the complete supported vault lifecycle and TTL maintenance paths.
- Deployment and operations documentation reflects the final interfaces and settings.

## Out of scope

The following findings in `tofix.md` are v1-only and are intentionally not part of this v2 work list:

- Locking the old v1 mainnet PT issuer.
- Repairing v1 market/vault initialization cross-checks.
- Redeploying the v1 wrapper to expose missing monitoring views.
- Correcting the v1-only vault monitor probe (which reads `solvency`/`bearer_redeemed` on the vault instead of `stats()`).

Note that `tofix.md` also records a systemic v1 finding worth carrying as a habit here: **deployed binaries can differ from source, and `version()` cannot detect it.** Verify v2 deployments with `code_hash` and the on-chain interface, never by reading `contracts/`.

The separate launch gates referenced by `tofix.md` — the mainnet parameter profile, the audit decision, and `testcando.md` Appendix B — remain required but are not expanded here.
