# fixplan.md — how the v1 issues actually get closed

**Short answer to "does building v2 fix them?": no, and it never could.** But you are in a better
position than that sounds, and the reasons have now been checked on chain rather than assumed.

Re-verified **2026-08-26** against v1 mainnet, v1 testnet and the full v2 testnet stack.

---

## 1. Why v2 cannot fix v1

The bugs are in **deployed bytecode** on Stellar mainnet:

| Contract | Live address |
|---|---|
| Wrapper | `CDLQY72EFRTNGNXT4PSINHGA4ET5CW3I6FHUSYUOL2HIWV6I55WW46WW` |
| Strategy | `CCTRXF5U2P2IMANRH5B54UJGV53APU4IID2QTINFQBZZWOPB765QZVW4` |
| Vault | `CDWNGJDYZ7VUYRG73WOU6PR6HCYPHO77UICJO642OWSP7LQGRRYPFLX6` |
| Market | `CBTO72XLCM2HV2MW64GMGWQB57NQFDXO3BZJTW3Y5ENTXBAJQ7Z7G5FV` |

Nothing in `contracts/sr`, `contracts/yield`, `contracts/srmarket`, `contracts/srvault` or
`contracts/srrouter` changes what runs at those four addresses. Only an **upgrade** (24h timelock)
or **retirement** changes deployed behaviour.

### And the deployed bytecode is not even the v1 source tree

This is new, and it matters more than the rest of this section:

```
mainnet wrapper code_hash   94b3c032a5701c727281c82ede3ec446c7b452bf0387a47daa2606fbcd68f361
current source builds to    5706b2567e8768447d2881829e7932ba72f65d9cba50504b25a3c1a4431070c7
```

The deployed **wrapper** is missing six source functions (`redeem_pt_bearer`, `split_position`,
`open_positions`, `bearer_redeemed`, `stamp_maturity_rate`, `maturity_rate`), the **strategy** two
(`reset_rate_floor`, `available_liquidity`), the **market** two (`seed_pt_for_apy`, `wrapper`). The
vault matches exactly. `version()` answers `"spield-wrapper-0.1.0"` on mainnet, testnet **and**
source, so it is no help — only `code_hash` and the interface diff are.

Practical consequence: several v1 mitigations recorded as "available" are not. Full breakdown in
`tofix.md`.

---

## 2. The two facts that change everything — both re-confirmed

**(a) v1 has zero TVL**, re-read from Horizon 2026-08-26:

```
SPLDPT   1 trustline, balance 0.0000000, 0 claimable balances
SPLDYT   1 trustline, balance 0.0000000, 0 claimable balances
issuer transactions: 7, all on 2026-06-08 (deploy day), none since
```

Zero supply of both tokens, zero real holders, and the issuer untouched since deploy day.
`market.add_liquidity` and `vault.seed` are both permissionless, so this needed re-checking — and
nobody has wandered in. **The "first seed transaction" that every P0 gates has never happened.**

**(b) The live series matures in 11 days** — `2026-09-06 19:28 UTC`.

So this is not "a live protocol with broken code holding user money". It is **an unused deployment
that expires in a week and a half**.

---

## 3. Where the 17 original items now stand

The list is much shorter than it was, and for a better reason than last round: **ten of them are now
closed in the current edition, verified by test rather than by argument.**

### Group 1 — closed by the current edition (10 items) · cost: **already paid**

**#15, #16, #18, #21, #24, #25, #26a, #27, #28, #29** — each re-verified 2026-08-26 against the SR
stack, with the evidence recorded in `tofix.md`'s "Closed and removed" table. These do not follow a
migration.

### Group 2 — moot if v1 is never seeded (v1-only remainder) · cost: **zero**

**#19** (market/vault settlement cross-check) is wrapper/vault/market-specific and **not expressible**
in v2. If v1 matures unused it is closed by construction.

### Group 3 — followed you into the current stack (5 items)

| # | What is left |
|---|---|
| **#3** `b_rate` deep dip (P0) | Cap enforced **on chain** (`Sr::set_deposit_cap`), disclosure published. **Left: the number.** `deposit_cap` reads **`0`** on the live testnet SR. ⚠ Also corrected: `reset_rate_floor` — the recovery lever this item is written around — **is not on any deployed v1 binary**. |
| **#20** Blend liquidity crunch (P1) | Closed for the wrapper: `Sr::redeem_partial` + `Sr::max_redeemable` + `strategy::available_liquidity`, all live on testnet (`max_redeemable` = `i128::MAX` today, venue healthy). **Left: `srvault::redeem` is still all-or-nothing.** |
| **#22** one-way inventory (P1) | `srvault::sweep` recovers PT above liability — better than the original proposal. **Left: SR, YT and USDC have no exit path.** Measured **248.53 SR stranded** after full settlement on a 20,000 USDC seed — created by #21's own fix, which parks post-expiry harvest proceeds as SR. |
| **#23** watchtower (P1) | Both monitors rewritten and both run. **Left: four items** — the v1 vault probe reads functions the vault never had (`stats()` works today, one-line fix); neither monitor can start from `scripts/` (no `package.json`); the v2 monitor is latched permanently red on 11 stroops of rehearsal counterfeit; the v1 wrapper still needs a redeploy. |
| **#30** SDK surface (P2) | `srstack.ts` is a full typed client. **Left: no TTL bump helpers, no `srvault` surface at all** (the vault is deployed and seeded on testnet and unreachable from the app), and `pnpm run test:unit` still fails at the install pre-check. |

### Group 4 — reopened (1 item)

**#26b and #26c.** Previously recorded as "structurally absent in the SR stack". **They are not.**
Both reproduce in `srmarket` today:

* `add_liquidity(1, 1)` on a pool that has traded mints **0 shares and takes the deposit** — the
  follow-on LP branch has no `shares > 0` guard.
* A pre-quoted, exactly ratio-matched add **reverts** when any swap lands first, and there is no
  `min_shares` to widen.

The audit tests that were supposed to prove otherwise do not test the defect: the 26b test never
trades first (so the flooring never happens), and the 26c test checks `remove_liquidity`, a different
function. Severity raised **P2 → P1** — not because the loss grew, but because it was on the closed
list and is not closed.

**Net: 6 items follow you regardless (#3, #20, #22, #23, #26, #30), and every one is now a small,
well-specified piece of work rather than a design question.**

---

## 4. The three paths

### Path A — mothball v1, ship v2 for the next term ✅ **recommended, and more clearly so than before**

Do not seed v1. Let it mature 2026-09-06. Deploy v2 for the next series.

* Closes everything v1-specific at zero cost.
* No migration — there are no users to move.
* Avoids seeding an architecture measured at **3× worse YT round-trip cost** (40.5% vs 13.3%) and
  **~7× more LP capital** to open the same market.
* **Newly decisive:** the deployed v1 binaries are not the v1 source. Fixing v1 means fixing a
  codebase you would then have to *re-derive* from chain to know what you are patching.

### Path B — fix v1 in place, then seed it

Close the P0s, then one upgrade cycle per contract (24h timelock each), then re-audit. You ship the
design already measured as worse on every axis, **and** you first have to reconcile source against
four deployed binaries that differ from it. **Only rational if v2 cannot be made launch-ready and
you must ship something this quarter.**

### Path C — hybrid

Ship v2 for PT/YT. The fixed-rate vault question is now settled by the port existing: `srvault` is
live on testnet with #18/#21/#22/#24 absent or improved by construction. Keeping v1's vault means
propping up the strictly worse of two implementations of the same product.

---

## 5. Where the plan stands

| | Work | Status |
|---|---|---|
| 0 | **Pause the four v1 contracts** | **Not done — and confirmed low priority.** The reason to pause was that `add_liquidity` and `vault.seed` are permissionless. Horizon re-confirms nobody has: zero supply, zero holders, no issuer activity since deploy day. Cheap insurance for the remaining 11 days. **The mainnet RPC is no longer a blocker — see item 6 below.** |
| 1 | **Governance on the new contracts** | ✅ Two-step admin rotation + bounded upgrade timelock on all five, verified on chain and asserted by `tofix_governance_*` (24h default, no pending admin, no pending upgrade at deploy). **Exercised for real**: the yield engine was upgraded through its own 1h timelock, `code_hash` `a9cdc745…` → `f73e2d91…`, all state intact. |
| 2 | **Rotate admin to multisig** | ❌ **Open.** Every contract in both stacks is still a single hot key (`alice425` on testnet, `spield_deployer` on mainnet). **Still the largest untreated operational risk.** |
| 3 | **#20 partial-redeem + watchtower** | 🟡 Wrapper path ✅ and **live on testnet**. Watchtower ✅ (and runs). Disclosure ✅. **`srvault::redeem` partial path ❌.** |
| 4 | **#3 TVL cap + disclosure** | 🟡 Mechanism ✅, enforced on chain rather than in a runbook. **The number is still `0`.** |
| 5 | **Deploy scripts + issuer lockdown rehearsal** | ✅ `deploy_sr_testnet.sh` is resumable and self-verifying; lockdown rehearsed end to end, `ISSUER_LOCKED=1`. A resume caught a real bug — the script reconstructed the issuer from a key name the lockdown had already invalidated, instead of reading the recorded asset. |
| 6 | **#23 monitor for the SR stack** | 🟡 Six probes + utilization, and it **fires correctly** — it caught the rehearsal counterfeit to the stroop. But it now fires *every run* on that same known cause, and it cannot be started from `scripts/`. |
| 7 | **#30 SDK for the new surface** | 🟡 `srstack.ts` + a USDC-denominated dApp (router trading, SR wrapper section, yield panel, risk disclosure). **No `srvault` surface and no TTL bump helpers.** |
| 8 | **Audit** | ❌ **Open, and it is the gate.** `AUDITPREP.md` is preparation, not assurance. |
| 9 | **Decide on the vault** | ✅ Ported — `contracts/srvault`, live and seeded on testnet. v1's #18/#21/#24 are absent by construction; #22 is improved but incomplete. |

### What is genuinely left

1. **Rotate the admins to a multisig.** Nothing else matters if one key can be lost.
2. **Get the audit.** Everything else is ready enough to want one.
3. **Decide the TVL cap number.** The mechanism warns when it is 0, and it is 0.
4. **Close the six carried-over items** — all small, all specified: `tofix.md`'s "Suggested order of
   work" puts the two one-liners (the monitor's vault probe, `scripts/package.json`) first.
5. **Lock the v1 mainnet issuer** before any seed — or, on Path A, never seed and let the series
   mature on 2026-09-06. Note the severity correction below.
6. ~~Fix the mainnet RPC URL in the CLI config~~ — **not a misconfiguration.** The CLI ships
   `mainnet` with a deliberate placeholder (`RPC url: Bring Your Own: …`) because SDF runs no public
   mainnet RPC. Verified working this round:

   ```
   https://mainnet.sorobanrpc.com   →  protocolVersion 27, public passphrase
   ```

   All mainnet reads in this round went through it. To make it permanent:
   `stellar network add mainnet --rpc-url https://mainnet.sorobanrpc.com --network-passphrase "Public Global Stellar Network ; September 2015"`.
   (CLI is now 27.0.0; `Cargo.toml`'s comment still says 26.1.0.)

---

## 6. Severity correction — the unlocked mainnet issuer

The v1 mainnet PT issuer is **still unlocked**, re-measured 2026-08-26:

```
GA4R5M7ZWOQZWIYCW246YC5WJ4QHT3H74CAUSTCEUUWIELCWI7IP3MKB
  signer GA4R5M7ZWOQZ… weight 1     thresholds low/med/high = 0/0/0     *** UNLOCKED ***
```

But its stated consequence does not hold on the live deployment. The rationale was
"`redeem_pt_bearer` pays out on PT balance alone, so counterfeit PT is redeemable for real USDC" —
and **`redeem_pt_bearer` is not deployed on mainnet**. Every exit on the live binary goes through a
*position*, which only the wrapper can create.

So: counterfeit SPLDPT can be minted and sold to a third party on the classic DEX — a scam vector
against users — but it has **no drain path into the pool**. The lock remains a hard precondition for
any deployment that *does* ship `redeem_pt_bearer`, which every current source build does.

**Not performed here: it is an irreversible mainnet action that permanently burns the issuer
identity.**

---

## 7. The honest summary

* **v2 does not fix v1** — deployed bytecode is the only thing that matters, and v2 does not touch it.
* **You do not need it to.** v1 has no TVL and expires in 11 days. Not seeding it closes everything
  v1-specific for free.
* **Ten of the seventeen are now genuinely closed** in the current edition, verified by test this
  round rather than argued.
* **Six followed you** (#3, #20, #22, #23, #26, #30), and one of those — #26b/#26c — was wrongly on
  the closed list and had to be reopened. That is the useful lesson from this round: *a passing test
  is not evidence unless it tests the defect's actual shape.* Both misaimed tests are named in
  `tofix.md`.
* **What is left is small and specified.** Two one-line fixes, one contract argument, two `srvault`
  extensions, three SDK gaps, and one number.
* **The blockers money cannot ship without are still two**: a multisig on the admin keys, and an
  audit.
* **A new systemic finding:** deployed v1 binaries differ from the v1 source, and `version()` cannot
  see it. Any future statement about live behaviour must be read from chain via `code_hash` and the
  interface, never from `contracts/`.
