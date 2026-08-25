# fixplan.md — how the v1 issues actually get closed

**Short answer to "does building v2 fix them?": no, and it never could.** But you are in a far
better position than that sounds, because of two facts worth checking before anything else.

---

## 1. Why v2 cannot fix v1

The bugs are not in the repo. They are in **deployed bytecode** on Stellar mainnet:

| Contract | Live address |
|---|---|
| Wrapper | `CDLQY72EFRTNGNXT4PSINHGA4ET5CW3I6FHUSYUOL2HIWV6I55WW46WW` |
| Strategy | `CCTRXF5U2P2IMANRH5B54UJGV53APU4IID2QTINFQBZZWOPB765QZVW4` |
| Vault | `CDWNGJDYZ7VUYRG73WOU6PR6HCYPHO77UICJO642OWSP7LQGRRYPFLX6` |
| Market | `CBTO72XLCM2HV2MW64GMGWQB57NQFDXO3BZJTW3Y5ENTXBAJQ7Z7G5FV` |

Nothing written in `contracts/sr`, `contracts/yield` or `contracts/srmarket` changes what runs at
those four addresses. Only two things ever change deployed behaviour:

1. **an upgrade** (`schedule_upgrade` → 24h timelock → `apply_upgrade`), or
2. **retirement** — the contract stops being used, and the issue becomes moot.

Building a second, better house does not rewire the first one.

---

## 2. The two facts that change everything

**(a) v1 has zero TVL.** It was deployed 2026-06-08 **unseeded**:
`reserves=[0,0]`, `solvency=[0,0,0]`, vault stats all `0`, `VAULT_SEED_AMOUNT`/`MARKET_SEED_AMOUNT`
both `0`. **The "first seed transaction" that every P0 in `tofix.md` gates has never happened.**

**(b) The live series matures in 14 days** — `2026-09-06 19:28 UTC`.

> ⚠️ **Verify (a) on chain before acting.** That reading comes from the deploy record in
> `MAINNETCONTRACTADDRESSES.md`, not a live query. `market.add_liquidity` and `vault.seed` are both
> **permissionless**, so a third party could have touched them since June. Read `market.reserves()`,
> `wrapper.solvency()`, `wrapper.open_positions()` and `vault.stats()` first. Everything below
> assumes they are still zero.

So this is not "a live protocol with broken code holding user money". It is **an unused deployment
that expires in two weeks**. That is the cheapest possible position to be in.

---

## 3. The 17 items, sorted by who actually has to fix them

The list is much shorter than it looks, because most items die with v1.

### Group 1 — moot if you never seed v1 (12 items) · cost: **zero**

#15, #16, #18, #19, #21, #22, #24, #25, #26, #27, #28, #29.

Every one is wrapper/vault/market-specific. If v1 is never seeded and matures unused, they are
closed by construction — and 7 of them are already structurally absent from the SR stack anyway
(see the table at the top of `tofix.md`).

### Group 2 — the shared strategy layer · must fix for **either** stack (2 items)

**This is the part people miss:** `contracts/strategy` is used *unchanged* by v2. `Sr::initialize`
takes any `YieldStrategy` address, and that is the same `BlendStrategy`. So these follow you:

| # | What is left |
|---|---|
| **#3** `b_rate` deep dip (P0) | The **code fix already shipped** — `strategy::reset_rate_floor` exists (`lib.rs:326`). What remains is ops: set the TVL cap, publish the disclosure. Note SR's high-water clamp does **not** substitute for it — measured in `a_guarded_strategy_still_bricks_sr_on_a_rate_dip`. |
| **#20** Blend liquidity crunch (P1) | Partial-redeem path + utilization watchtower + disclosure. Applies to `Sr::redeem` exactly as it does to v1 exits. |

### Group 3 — deploy / ops · must do for **either** stack (2 items)

| # | What is left |
|---|---|
| **#13** issuer lockdown | Rehearse on testnet, confirm `✓ VERIFIED`. **The new PT SAC needs the same treatment** — v2 does not inherit the rehearsal. |
| **#23** solvency monitor | Read `open_positions()`, add the conservation check — and it now has a second stack to cover. |

### Group 4 — worse under v2 (1 item)

**#30** SDK surface. v1 has partial coverage; the SR stack has **none**.

**Net: 4 items must be fixed no matter what you ship. Not 17.**

---

## 4. The three paths

### Path A — mothball v1, ship v2 for the next term ✅ **recommended**

Do not seed v1. Let it mature 2026-09-06. Deploy v2 for the next series.

* Closes 12 of 17 items at zero cost.
* No migration — there are no users to move.
* Avoids seeding an architecture measured at **3× worse YT round-trip cost** (40.5% vs 13.3%),
  **~7× more LP capital** to open the same market, and carrying the YT-stranding bug.
* The 4 remaining items are v2 prerequisites anyway.

### Path B — fix v1 in place, then seed it

Close 2 P0s + 6 P1s, then one upgrade cycle per contract (24h timelock each), then re-audit. You
end up shipping the design you already measured as worse on every axis. **Only rational if v2
cannot be made launch-ready and you must ship something this quarter.**

### Path C — hybrid

Ship v2 for PT/YT (the flagship). Keep the fixed-rate vault on v1 **only if** you close #18/#21/#22/#24
first — #18 is a P0 where a permissionless `seed` lets anyone brick every receipt. Realistically this
means porting the vault to v2 rather than propping up v1.

---

## 5. Concrete next 14 days (Path A)

**Do this first — it is one transaction per contract and removes the only live risk:**

0. **Pause all four v1 contracts.** `add_liquidity` and `vault.seed` are permissionless today, so a
   third party can still wander in. Pause blocks inflows while leaving `remove_liquidity` and every
   redemption path open — exactly the right mothball semantics. Verify on-chain state (§2) first.

Then, in rough dependency order:

| | Work | Why it blocks launch |
|---|---|---|
| 1 | **Add governance to the three new contracts** | The one place v2 is *behind* v1: it has no two-step admin rotation and **no upgrade timelock**. `spield_shared::governance` already exists — wire it in. Do not deploy without this. |
| 2 | **Rotate admin to multisig** | Flagged for v1 too; all four admins are one hot key (`spield_deployer`). |
| 3 | **#20** strategy partial-redeem + watchtower | Shared layer; blocks both stacks. |
| 4 | **#3** ops: TVL cap + disclosure | Code shipped; only the policy is missing. |
| 5 | **Deploy scripts for sr/yield/srmarket** + **#13** issuer-lockdown rehearsal for the new PT SAC | Cannot deploy safely without either. |
| 6 | **#23** solvency monitor rewritten for the SR stack | Needs the conservation identity from `srstack.md` §5, which is different from v1's. |
| 7 | **#30** SDK for the new surface | Frontend cannot integrate otherwise. |
| 8 | **Audit** | New token contracts, a new interest ledger, a new curve. `before_yt_change` is now the most security-sensitive line in the codebase. |
| 9 | **Decide on the vault** | v2 has no fixed-rate product. Port it (re-opening #18/#21/#22/#24 in new code) or launch PT/YT only. |

Items 1–2 are small and should happen regardless of which path you choose.

---

## 6. The honest summary

* **v2 does not fix v1** — deployed bytecode is the only thing that matters, and v2 does not touch it.
* **You do not need it to.** v1 has no TVL and expires in 14 days. Not seeding it closes 12 of 17
  items for free.
* **4 items follow you regardless** (#3, #20, #13, #23) because they live in the shared strategy and
  in ops, not in the tokenization layer.
* **v2's real blocker is not those 4 items** — it is governance, deploy tooling, an SDK, and an
  audit, none of which exist yet.
* **The one thing to do today** is verify the live state and pause v1, so an unused deployment
  cannot quietly become a used one.
