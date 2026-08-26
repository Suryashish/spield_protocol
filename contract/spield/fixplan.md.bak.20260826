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

> ✅ **VERIFIED ON CHAIN 2026-08-25.** This was previously an unchecked reading from the deploy
> record, and `market.add_liquidity` / `vault.seed` are both permissionless — so it mattered. Queried
> Horizon for everything the v1 mainnet PT/YT issuer has ever done:
>
> ```
> SPLDPT   total supply 0.0000000   accounts=0   claimants=0
> SPLDYT   total supply 0.0000000   accounts=0   claimants=0
> issuer transactions: 7, all on 2026-06-08 (deploy day)
> ```
>
> Zero supply of both tokens, zero holders, and the issuer has not been touched since deploy day.
> **v1 has never been used.** No third party wandered in. Every conclusion below stands.
>
> (Read via Horizon rather than Soroban RPC because the `mainnet` network entry in the CLI still has
> a placeholder RPC URL — worth fixing before anything needs to *write* to mainnet.)

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
| **#3** `b_rate` deep dip (P0) | **Both remaining actions done 2026-08-25 for v2.** The TVL cap is now enforced *on chain* (`Sr::set_deposit_cap`) rather than operationally — opt-in, deposits-only, exposure-not-supply, all pinned by tests. The disclosure is published in the dApp (`RiskDisclosure.tsx`). **Still to decide: the number.** `SR_DEPOSIT_CAP=0` today. |
| **#20** Blend liquidity crunch (P1) | **Closed for v2, 2026-08-25.** `Sr::redeem_partial` takes what the venue can pay instead of reverting: measured with 90% of supply drawn down, the full exit returns **nothing** and the partial returns **90+ of the 100 USDC on hand**, remainder intact. `Sr::max_redeemable()` makes the crunch visible *before* submitting, and the dApp offers "Withdraw what is available". Watchtower live (it fired at once — Blend testnet USDC at **85.4%**) and disclosure published. **The v2 vault still has no partial path of its own.** |

### Group 3 — deploy / ops · must do for **either** stack (2 items)

| # | What is left |
|---|---|
| **#13** issuer lockdown | **Testnet rehearsal done** for the v2 PT SAC — counterfeit demonstrated before the lock, `TxBadAuth` after, engine minting still works. **Mainnet is measurably UNLOCKED** (`GA4R5M7Z…`, master weight 1) — harmless only because v1 was never seeded. Lock before any seed; it is irreversible and burns the identity. |
| **#23** solvency monitor | **Both monitors rewritten.** v2's has six probes plus Blend utilization. v1's now reads the real band from chain, adds PT conservation, and no longer `exit(2)`s itself on the first alarm — but the **deployed** v1 wrapper exposes neither `open_positions()` nor `bearer_redeemed()`, so two probes cannot run against it. It degrades loudly instead of guessing. |

### Group 4 — worse under v2 (1 item)

**#30** SDK surface. ~~v1 has partial coverage; the SR stack has none.~~ **Closed for v2**:
`frontend/src/lib/srstack.ts` is a full typed client — quotes, writes, LP, YT, the router, the yield
claim and the TVL cap. v1's own gaps are untouched, and die with v1.

**Net: 4 items followed you regardless. As of 2026-08-25, three are closed and one is partly closed
— the partial-redeem path under #20 is the only shared-layer code left.**

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

## 5. Where the 14-day plan actually stands

Re-checked 2026-08-25. Original plan, with what happened:

| | Work | Status |
|---|---|---|
| 0 | **Pause the four v1 contracts** | **Not done — and now measurably lower priority.** The reason to pause was that `add_liquidity` and `vault.seed` are permissionless. Horizon confirms nobody has: zero supply, zero holders, no issuer activity since deploy day. Still cheap insurance for the remaining 12 days; still one transaction each. **The mainnet RPC URL in the CLI is a placeholder, so fix that first.** |
| 1 | **Governance on the new contracts** | ✅ Two-step admin rotation + bounded upgrade timelock on all five, verified on chain. **Exercised for real**: the yield engine was upgraded through its own 1h timelock, `code_hash` `a9cdc745…` → `f73e2d91…`, all state intact. |
| 2 | **Rotate admin to multisig** | ❌ **Open.** Every contract in both stacks is still a single hot key (`alice425` on testnet, `spield_deployer` on mainnet). This is now the largest untreated operational risk. |
| 3 | **#20 partial-redeem + watchtower** | 🟡 Watchtower ✅ (and it fired: Blend testnet USDC at 85.4%). Disclosure ✅. **Partial-redeem path ❌ — the one piece of shared-layer code still outstanding.** |
| 4 | **#3 TVL cap + disclosure** | ✅ Both, and the cap went further than the plan asked: enforced on chain, not operationally. **The number is still undecided.** |
| 5 | **Deploy scripts + issuer lockdown rehearsal** | ✅ `deploy_sr_testnet.sh` is resumable and self-verifying; lockdown rehearsed end to end. A resume also caught a real bug in the script — it reconstructed the issuer from a key name that the lockdown had since invalidated, instead of reading the recorded asset. |
| 6 | **#23 monitor for the SR stack** | ✅ Six probes + utilization. Caught counterfeit PT to the stroop during the lockdown rehearsal. |
| 7 | **#30 SDK for the new surface** | ✅ `srstack.ts`, plus a USDC-denominated dApp: router trading, a separate SR wrapper section, a yield panel, and the risk disclosure. |
| 8 | **Audit** | ❌ **Open, and it is the gate.** `AUDITPREP.md` is preparation, not assurance. |
| 9 | **Decide on the vault** | ✅ Ported — `contracts/srvault`, live on testnet. v1's #18/#21/#22/#24 are absent by construction, not patched. |

### What is genuinely left

1. **Rotate the admins to a multisig.** (2) Nothing else on this list matters if one key can be lost.
2. **Get the audit.** (8) Everything else is ready enough to want one.
3. **Decide the TVL cap number.** The mechanism is built and warns when it is 0.
4. ~~Build the partial-redeem path~~ — **done**. What remains of it: `srvault::redeem` still pays a
   receipt in full or not at all. Lower severity (the vault holds PT as bearer inventory, so it is
   not competing for venue liquidity at redemption time) but worth closing before the vault carries
   real money.
5. **Lock the v1 mainnet issuer** before any seed — or, on Path A, simply never seed and let the
   series mature on 2026-09-06.
6. **Fix the mainnet RPC URL** in the CLI config, so mainnet state can be read without falling back
   to Horizon.

---

## 6. The honest summary

* **v2 does not fix v1** — deployed bytecode is the only thing that matters, and v2 does not touch it.
* **You do not need it to.** v1 has no TVL and expires in 14 days. Not seeding it closes 12 of 17
  items for free.
* **4 items followed you regardless** (#3, #20, #13, #23). **As of 2026-08-25 all four are closed
  for the v2 stack** — the last shared-layer code, #20's partial-exit path, landed with
  `Sr::redeem_partial` and `Sr::max_redeemable`. What is left of them is a decision (the cap number),
  an irreversible mainnet action (the issuer lock), and one v1 redeploy (so the monitor's two
  wrapper views exist).
* **v2's blockers have narrowed to two that money cannot be shipped without**: a multisig on the
  admin keys, and an audit. Governance, deploy tooling, the SDK and the vault are all done.
* **The live state is now verified rather than assumed** — and it says v1 has never been used, which
  is the best possible answer. Pausing it is cheap insurance for the remaining 12 days, not urgent.
