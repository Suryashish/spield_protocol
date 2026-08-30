# budget.md — what the deployed network refuses to run, and why

Two of Spield's one-transaction conveniences do not execute against Blend's live pool. Neither is a
bug in the code, both were invisible to the local suite, and one of them **used to work** until we
added features to a shared contract.

This file exists because all three of those facts cost us time to learn, and every one of them is
the kind of thing you only discover by putting a transaction on a real network.

---

## 1. The rule

> **Soroban's memory budget is cumulative, not a high-water mark.** Every host allocation, module
> instantiation and ledger read spends it and nothing is ever returned. Two operations that each fit
> comfortably can still sum past the limit.

And the corollary that bit us second:

> **Adding a function to a shared contract spends the transaction budget of every path that loads
> it** — including paths that have nothing to do with the new function.

The limits, read from the network's own `ConfigSettingContractComputeV0` rather than from memory:

```
txMaxInstructions   400,000,000
txMemoryLimit        41,943,040     <-- the one that actually binds
```

CPU has never been close. The busiest passing path uses ~14% of the instruction budget.

---

## 2. Current state, measured on chain

> ### ⚠️ Re-measured 2026-08-30 — **both failures are gone**
>
> Against a fresh testnet deployment carrying the `FINAL_CHECK.md` fixes (V2-01's synchronized index,
> V2-03's snapshot check, `realizable_rate`, `claim_emissions`), **all six router paths fit**, including
> the two that used to be over budget. The 2026-08-26 table is kept below it for the record.
>
> | router path | instructions | % of cpu | entries | status |
> |---|---|---|---|---|
> | `buy_pt_with_usdc` | 45.9M | 11.5% | 31 | ✅ |
> | `sell_pt_for_usdc` | 44.6M | 11.1% | 30 | ✅ |
> | **`buy_yt_with_usdc`** | **60.3M** | **15.1%** | 37 | ✅ **was ❌** |
> | **`sell_yt_for_usdc`** | **60.7M** | **15.2%** | 35 | ✅ **was ❌** |
> | `claim_yield_to_usdc` | 7.4M | 1.9% | 20 | ✅ |
> | `redeem_py_for_usdc` | 17.9M | 4.5% | 28 | ✅ |
>
> Instruction counts fell across the board (`buy_pt` 55.4M → 45.9M) even though V2-01's fix *adds* a
> Blend `get_reserve` to every trading path. Both effects are real; the reduction is larger.
>
> **Two caveats before treating this as settled.** The probe needs a user holding PT *and* YT — with an
> empty account the YT paths report a balance error that reads like a budget failure, which is what the
> earlier runs in this file may partly have been. And the deployment is freshly seeded at the planned
> mainnet shape (5 USDC per side), so it is not a like-for-like environment with 2026-08-26.
>
> The live workflow suite confirms it independently: `test_sr_testnet.sh` now prints *"one-transaction
> USDC->YT now FITS on this network"* and *"one-transaction YT->USDC now FITS again"*.
>
> **`probe_budget.mjs` itself needed fixing to produce this table** — see §7.

<details><summary>Historical: 2026-08-26, before the FINAL_CHECK round</summary>

Simulated against testnet, 2026-08-26, after the `sr` and `strategy` upgrades:

| router path | instructions | status |
|---|---|---|
| `buy_pt_with_usdc` | 55.4M | ✅ |
| `sell_pt_for_usdc` | 53.8M | ✅ |
| `claim_yield_to_usdc` | 30.1M | ✅ |
| `redeem_py_for_usdc` | 29.3M | ✅ |
| **`sell_yt_for_usdc`** | — | ❌ `Error(Budget, ExceededLimit)` |
| **`buy_yt_with_usdc`** | — | ❌ `Error(Budget, ExceededLimit)` |

Reproduce this table in one command — see §7. Verbatim output at the time of writing:

```
buy_pt_with_usdc       OK           insns  55445219 (13.9% of cpu)  entries 31
sell_pt_for_usdc       OK           insns  53835544 (13.5% of cpu)  entries 30
buy_yt_with_usdc       OVER BUDGET  Error(Budget, ExceededLimit)
sell_yt_for_usdc       OVER BUDGET  Error(Budget, ExceededLimit)
claim_yield_to_usdc    OK           insns  30134180 ( 7.5% of cpu)  entries 28
redeem_py_for_usdc     OK           insns  29295408 ( 7.3% of cpu)  entries 28
```

Note the CPU column: the busiest path uses **13.9%** of the instruction budget. Nothing here is
close to a CPU limit, which is exactly why the first several attempts to fix it — all aimed at
shaving instructions — got nowhere.

Both failures were handled in the dApp by splitting into two transactions. Both legs of each split
work fine alone — this is a limit on *combining* them, not on any single operation.

</details>

**As of 2026-08-30 the dApp no longer needs those splits** — see the re-measurement above. The
two-transaction YT paths still work and remain the safe fallback; switching them off is a UX change,
not a correctness one.

Where the work goes, if you need to shave something:

| call | instructions |
|---|---|
| `market.buy_yt_exact_out` | 55.6M |
| `market.swap_exact_sr_for_pt` | 34.9M |
| `market.quote_buy_yt` (curve math alone) | 22.3M |
| `yield.mint_py` | 16.2M |
| `sr.deposit` | 11.5M |
| `sr.sync_rate` | 7.5M |
| `strategy.current_rate` (one Blend read) | 5.5M |

---

## 3. `buy_yt_with_usdc` — never fitted

A Blend supply plus a `mint_py`-bearing curve trade exceeds one transaction against a pool of
Blend's weight.

**It is not trade size.** Simulated across the whole range — 20,000,000 face down to 50,000, the
latter being half a cent of exposure — every size fails identically. The cost is fixed overhead.

Four rounds of slimming failed to close it:

| attempt | result |
|---|---|
| wrap the ceiling, unwrap the refund (two Blend round trips) | over budget |
| wrap only what the quote needs, refund the rest as USDC (one Blend call) | over budget |
| move pricing off chain entirely, so the router makes no view calls of its own | over budget |
| drop even the PT read from the drain check | over budget |

The dominant consumer is Blend's own pool contract, which we do not control and cannot slim. **This
is a property of the underlying pool, not of anything in this repo** — which is why the entry point
stays rather than being deleted. A lighter yield source would run it unchanged.

Note the consolation is real: **a user who already holds SR buys YT in one signature today**,
because only the Blend leg is the problem. That is a genuine argument for holding SR, and why the
wrapper has its own section in the dApp.

---

## 4. `sell_yt_for_usdc` — a regression we caused

This one **worked**. It was the heaviest passing path at 64.5M instructions, and it stopped working
on 2026-08-26 when we upgraded two contracts:

* **`sr`** grew a TVL cap (`tofix.md` #3) and a partial-exit path (`tofix.md` #20).
* **`strategy`** grew `available_liquidity`, which the partial exit needs.

Neither addition touches this path. Both made the modules bigger, and both modules are loaded by it.
The cumulative budget tipped over. The other paths grew too and survived — `buy_pt_with_usdc` went
49.5M → 55.4M, `claim_yield_to_usdc` 26.1M → 30.1M — but `sell_yt_for_usdc` had the least headroom.

### The trade, stated plainly

Two features that close a P0 and a P1 in the tracker cost one convenience path a second signature.
That is a good trade and we would make it again, but it should be recorded as a trade rather than
discovered later as a mystery.

It also makes the two YT directions symmetric: buying has needed two steps from the beginning.

### What the dApp does instead

Sell YT for SR on the market, then unwrap the SR. Verified live:

```
3,906,250 YT  ->  38,438 SR  ->  40,588 USDC
```

`srstack.sellYtToUsdc` runs both legs and reports progress, so the UI shows "1 of 2" rather than
going quiet between two wallet prompts — which is the moment people cancel.

---

## 5. A write has three outcomes, not two

Unrelated to the budget, discovered in the same session, and the more dangerous of the two lessons.

The live test harness reported YT balances at **exactly 2x**. The cause:

> `stellar contract invoke` returns **non-zero** on `transaction submission timeout` — which happens
> when the transaction **was already included** and the client merely stopped waiting.

The retry saw non-zero and ran it again.

This is the second time the same harness double-executed, each time differently:

| # | Retry keyed on | Why it failed |
|---|---|---|
| 1 | **empty output** | a void-returning `transfer` legitimately prints nothing, so a *successful* transfer looked like a failure and was resubmitted |
| 2 | **exit status** | a timeout after inclusion is also non-zero, so a *successful* transaction was resubmitted |

Exit status is strictly better than output, and still wrong. The actual model:

> A write has three outcomes — **succeeded**, **failed**, and **indeterminate**. Only the second is
> safe to retry.

`scripts/test_sr_testnet.sh` now retries only on errors that provably predate submission (a connect
error, a simulation failure — nothing reached the network). Everything else, timeouts above all, is
reported rather than repeated. Losing a result is recoverable; double-spending is not.

Confirmed minutes later on the same network: a rebalancing trade reported
`transaction submission timeout` and **had landed anyway** — the pool reserves had moved.

**This matters far beyond the test harness.** The same mistake in a frontend retry double-spends
real user funds.

---

## 6. Before you add a function to a shared contract

1. **Simulate every affected path on the target network**, not just the one you changed. `sr` and
   `strategy` are loaded by almost everything.
2. **Watch the paths with the least headroom.** They fail first, and they fail for a reason that has
   nothing to do with your change.
3. **Treat a local `cost_estimate()` figure as a smoke test only.** The local `BlendFixture` is
   dramatically lighter than the deployed pool — it reported `buy_yt_with_usdc` at 22% of memory for
   a path that does not run at all.
4. **Upgrade the callee and the caller in the same cycle.** Each upgrade is its own timelock wait,
   and a caller upgraded alone passes every wiring check while failing on chain
   (`AUDITPREP.md` defect 7). `deploy_sr_testnet.sh` now invokes each cross-boundary call and fails
   closed.

---

## 7. Reproducing any of this

```bash
# Per-path cost against the live network. Simulation only — nothing is signed, sent, or charged.
cd website/contract/spield
node scripts/probe_budget.mjs \
  --state scripts/deploy_sr_testnet.state \
  --user "$(stellar keys address bob425)"
# exits 3 if any path is over budget

# The full live workflow suite, including the two-step YT flows.
cd website/contract/spield
./scripts/test_sr_testnet.sh
```

`probe_budget.mjs` distinguishes **over budget** (a fact about the path) from a call merely being
rejected at the size probed (a balance or liquidity limit). Only the first belongs in the table
above.

**Give `--user` an account holding PT *and* YT.** With an empty account the two YT paths fail on
balance, print `n/a`, and look indistinguishable from the budget failures this file used to record.
Set one up with: a PT trustline (`stellar tx new change-trust --line <PT_ASSET_ID>`), a PT buy
through the router, and a `market.buy_yt_exact_out`.

**Fixed 2026-08-30:** the script crashed with `sim.transactionData.build(...).resources is not a
function`. Across stellar-sdk versions the XDR accessors changed from **methods** to **plain
properties**, so `resources()`, `instructions()` and `footprint()` all had to become version-tolerant
reads. Worth knowing because the failure mode was a hard crash of the release gate itself — a gate
nobody can run is a gate nobody trusts.

Related: [`AUDITPREP.md`](./AUDITPREP.md) §4 (defects 4b, 5, 7), [`srstack.md`](./srstack.md)
§7b, [`tofix.md`](./tofix.md) #3 and #20.
