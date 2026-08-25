# tofix.md — what is still open

Finished work has been removed from this document. What remains is only what still needs a
**decision**, an **action**, or a **deploy step**. Each entry states what is left, not what landed.

Item numbers **1–17** are from the original Phase 1 round, unchanged so `testcando.md`
cross-references and git history still line up. The gaps in that numbering — **1, 2, 4–12, 14, 17** —
are defects that closed, each with an acceptance test that goes red on regression.

Items **18 onward** are the **2026-08-23 workflow audit**: a fresh end-to-end walk of the whole
PT/YT lifecycle (mint → accrue → claim → split → trade → redeem, plus the vault and market layers
on top), looking for logic that is wrong or missing rather than for regressions of anything already
fixed. Every one of them has a new acceptance test that **passes today by asserting the broken
behaviour**, so a fix flips the assertion rather than deleting the test.

Verified against the working tree on **2026-08-23**. Suite: **251 Rust tests + 218 SDK tests, all
green**; release WASM (`wasm32v1-none`) builds clean with no warnings.

Severity legend — **P0** = must close before the first seed transaction; **P1** = close before
meaningful TVL; **P2** = documentation / belt-and-braces.

---

## Re-verified 2026-08-24 — nothing has been removed, and here is why

The SR/yield/srmarket stack (`srstack.md`) landed on 2026-08-24. It does **not** close any item
below, because it does not touch v1: `contracts/{wrapper,vault,market,strategy}` are byte-for-byte
unchanged, `Error::UnderlyingMismatch` is declared but referenced nowhere in v1, and
`WrapperContract` still does not declare `underlying()`.

**Every acceptance test in this document was re-run and still passes — i.e. still asserts the
broken behaviour.** All 20 were checked individually. So every item stays open.

What the new stack does is make some of these **structurally unreachable in v2**, which matters only
for the migration decision. Recorded so they are not re-litigated as "already fixed":

| Item | Status in v1 | Structurally absent in the SR stack? |
|---|---|---|
| [15](#15-p1--a-raw-yt-transfer-strands-the-recipients-claim) raw YT transfer strands the claim | **open** | **Yes** — YT is a hook-bearing contract; `the_v1_stranding_bug_is_gone` |
| [19](#19-p0--marketinitialize-never-cross-checks-the-settlement-asset) market init cross-check | **open** | **Yes** — `srmarket` reads pt/sr/expiry from the engine; `the_market_is_wired_to_the_yield_contracts_own_tokens` |
| [25](#25-p1--the-solvency-dust-band-ratchets-with-lifetime-users-not-live-dust) dust band ratchets | **open** | **Yes** — fixed `SOLVENCY_SLACK`, not a per-position band |
| [26](#26-p2--market-lifecycle-and-lp-path-gaps) market lifecycle + LP gaps | **open** | **Yes** — all three: maturity-gated `add_liquidity`, `shares > 0`, `min_pt_out`/`min_sr_out` |
| [27](#27-p2--the-wrappers-read-only-views-write-to-chain-state) views write to state | **open** | **Yes** — `index_view` (pure) is split from `index_current` (stamping) |
| [28](#28-p2--exits-account-the-requested-amount-not-the-amount-blend-paid) exits account the requested amount | **open** | **Yes** — `Sr::redeem` returns what the strategy actually paid |
| [29](#29-p2--a-yt-only-holder-has-no-principal-exit-before-maturity) YT-only holder has no exit | **open** | **Yes** — YT is independent of PT; sell it on the market |
| [3](#3-p0--b_rate-deep-dip-freezes-exits) `b_rate` deep dip | **open** | **Partially.** Measured: reads and deposits still brick identically (`a_guarded_strategy_still_bricks_sr_on_a_rate_dip`) because the *adapter* panics before SR can clamp. Only the **exit** survives, since `Sr::redeem` never reads the rate. The adapter-level `reset_rate_floor` is still the real fix. |
| [16](#16-p2--post-maturity-surplus-accrues-to-nobody) post-maturity surplus | **open** | **No — and the premise is wrong.** In a share-based design every stroop above PT cover is owed to a YT holder (conservation identity in `srstack.md` §5). There is no pot to capture; only *abandoned* claims are recoverable. A first attempt to sweep it paid the treasury out of holders' unsettled interest and was caught in testing. |
| [18](#18-p0--vault-redeem-is-unpaginated-and-seed-is-permissionless-so-anyone-can-strand-every-receipt), [20](#20-p1--a-blend-liquidity-crunch-halts-exits-and-the-vault-has-no-partial-path), [21](#21-p1--vault-yt-yield-is-unclaimable-after-maturity-and-live-yt-legs-are-pruned), [22](#22-p1--vault-seed-capital-and-surplus-inventory-are-one-way), [24](#24-p1--vaultinitialize-does-not-cross-check-its-underlying-either) vault items | **open** | **N/A** — the SR stack has no vault. Porting the fixed-rate product forward re-opens all of them. |
| [13](#13-p1--issuer-lockdown--rehearsal-only) issuer lockdown | **open** | **No** — the new PT SAC needs the same rehearsal. |
| [23](#23-p1--the-solvency-monitor-does-not-enforce-the-invariant-the-contract-enforces) monitor | **open** | **No** — and it now has a second stack to cover. |
| [30](#30-p2--sdk-surface-gaps) SDK gaps | **open** | **No — worse.** The SR stack has no SDK surface at all. |

**Bottom line: this list shortens when v1 is fixed or retired, not when v2 is built.**

### Update 2026-08-25 — the SR stack now covers more of the list

Re-verified again: **v1 is still byte-for-byte unchanged**, so nothing below is fixed *in v1*. What
changed is how much of the list a migration to v2 would carry, and three of the "N/A — the SR stack
has no vault" rows no longer apply, because it now has one (`contracts/srvault`).

| Item | Status in v1 | In the SR stack (2026-08-25) |
|---|---|---|
| **[18](#18-p0--vault-redeem-is-unpaginated-and-seed-is-permissionless-so-anyone-can-strand-every-receipt)** | **open** | **Absent by construction.** PT is a fungible bearer balance, so `srvault::redeem` has no list to walk: measured at **15 write entries / 39 footprint entries, identical whether inventory came from 1 seed or 20**, and 10.5% of the mainnet memory ceiling. v1 measured ~6.8 MB *per position spanned* and bricked at 6. `seed` is admin-gated as well, closing the DoS vector twice. |
| **[21](#21-p1--vault-yt-yield-is-unclaimable-after-maturity-and-live-yt-legs-are-pruned)** | **open** | **Absent.** `srvault::harvest` has no maturity gate and no pruning; pre-expiry yield stays claimable through the engine forever. |
| **[22](#22-p1--vault-seed-capital-and-surplus-inventory-are-one-way)** | **open** | **Absent.** `srvault::sweep` returns surplus, gated on covering every open liability plus its redemption buffer. |
| **[24](#24-p1--vaultinitialize-does-not-cross-check-its-underlying-either)** | **open** | **Not expressible.** The vault takes only the engine's address and reads sr/pt/underlying/maturity back from it. |
| **[13](#13-p1--issuer-lockdown--rehearsal-only)** | **open** | **Rehearsed end to end on testnet.** Before the lock the issuer minted 10 base units of counterfeit PT while `total_py` stayed put; after it the same payment failed `TxBadAuth` **and the engine still minted 2,000,000,006 PT** — the lock closes the hole without bricking the protocol. Now a step in `deploy_sr_testnet.sh` with two fail-closed pre-flights. Still a *procedural* control, not a contract invariant — see `AUDITPREP.md` §5.1. |
| **[23](#23-p1--the-solvency-monitor-does-not-enforce-the-invariant-the-contract-enforces)** | **open** | **Written for v2**: `scripts/sr_solvency_monitor.mjs`, six invariants. One of them — classic PT supply vs `total_py`, read from Horizon — caught the counterfeit above **to the stroop** (`exceeds engine total_py by 11`) and exits 2 to page. |
| **[3](#3-p0--b_rate-deep-dip-freezes-exits)** | **open** | Unchanged, and the 3-line `strategy` change does **not** weaken it: the dip guards in `wrapper::test_rate_brick` and `sr::test` still fire. Argument and tests in `AUDITPREP.md` §5.2. |
| **[30](#30-p2--sdk-surface-gaps)** | **open** | Improved for v2 — `frontend/src/lib/srstack.ts` is a full typed client — but v1's own SDK gaps are untouched. |

Everything else in the table above this section is unchanged.


---

## What is left

| # | Item | Area | Sev | What is left |
|---|---|---|---|---|
| [18](#18-p0--vault-redeem-is-unpaginated-and-seed-is-permissionless-so-anyone-can-strand-every-receipt) | `redeem` unpaginated + `seed` open ⇒ receipts strandable | vault | **P0** | **Cap the walk, gate `seed`, add a partial/resumable redeem** |
| [19](#19-p0--marketinitialize-never-cross-checks-the-settlement-asset) | Market never cross-checks the settlement asset | market | **P0** | **Add the `underlying()` cross-check + a deploy read-back** |
| [3](#3-p0--b_rate-deep-dip-freezes-exits) | `b_rate` deep dip freezes exits | strategy | **P0** | Residual accepted — **set the TVL cap, publish the disclosure** |
| [20](#20-p1--a-blend-liquidity-crunch-halts-exits-and-the-vault-has-no-partial-path) | Blend liquidity crunch halts exits | strategy / vault | **P1** | **Partial-redeem path + a utilization watchtower + disclosure** |
| [21](#21-p1--vault-yt-yield-is-unclaimable-after-maturity-and-live-yt-legs-are-pruned) | Vault YT yield unclaimable after maturity | vault | **P1** | **Let `harvest` run post-maturity; stop pruning live YT legs** |
| [22](#22-p1--vault-seed-capital-and-surplus-inventory-are-one-way) | Seed capital + surplus inventory are one-way | vault | **P1** | **Add a liability-gated sweep** |
| [23](#23-p1--the-solvency-monitor-does-not-enforce-the-invariant-the-contract-enforces) | Monitor doesn't track the real band, or conservation | ops | **P1** | **Read `open_positions()`; add the PT/YT conservation check** |
| [13](#13-p1--issuer-lockdown--rehearsal-only) | Issuer lockdown | deploy | P1 | Code shipped — **rehearse on testnet, confirm `✓ VERIFIED`** |
| [24](#24-p1--vaultinitialize-does-not-cross-check-its-underlying-either) | Vault init doesn't cross-check `underlying` | vault | P1 | **Same cross-check, one contract over** |
| [15](#15-p1--a-raw-yt-transfer-strands-the-recipients-claim) | A raw YT transfer strands the recipient's claim | wrapper / dApp | P1 | **Still unenforced — the SDK has no split+transfer helper** |
| [25](#25-p1--the-solvency-dust-band-ratchets-with-lifetime-users-not-live-dust) | Dust band ratchets with lifetime users | wrapper | P1 | **Close a position when its principal is gone** |
| [26](#26-p2--market-lifecycle-and-lp-path-gaps) | Market lifecycle + LP path gaps (3 defects) | market | P2 | **Maturity gate, `shares > 0` guard, `min_shares` arg** |
| [27](#27-p2--the-wrappers-read-only-views-write-to-chain-state) | "Read-only" views write to chain state | wrapper / strategy | P2 | **Split the rate read into a pure and a stamping form** |
| [28](#28-p2--exits-account-the-requested-amount-not-the-amount-blend-paid) | Exits account the requested, not the paid, amount | wrapper | P2 | **Return and emit what actually moved** |
| [29](#29-p2--a-yt-only-holder-has-no-principal-exit-before-maturity) | YT-only holders have no pre-maturity exit | wrapper / product | P2 | **Disclose it; it is a design consequence, not a bug** |
| [30](#30-p2--sdk-surface-gaps) | SDK surface gaps | sdk | P2 | **LP methods, `buyYt`, TTL bumps, a guarded partial-sale helper** |
| [16](#16-p2--post-maturity-surplus-accrues-to-nobody) | Post-maturity surplus accrues to nobody | wrapper | P2 | Nothing yet — **re-measure at the first real maturity** |

**Probed this round and found SOUND** — recorded so they are not re-litigated: the curve holds its
implied rate over a full term without re-anchoring ([31](#31-probed-and-sound)); position ownership
auth is correctly scoped, not merely present ([32](#32-probed-and-sound)); `redeem` cost is set by
inventory *shape*, not by history *length* ([33](#33-probed-and-sound)).

**Also gating launch, and never `tofix.md`'s scope:** `testcando.md` §18 — the §12
mainnet-parameter profile, proving the solvency monitor fires, the audit decision, and Appendix B.

---

## 18. P0 — `Vault::redeem` is unpaginated, and `seed` is permissionless, so anyone can strand every receipt

*Acceptance tests: `vault::test::a_receipt_whose_payout_spans_many_positions_exceeds_the_mainnet_memory_limit`,
`how_many_positions_a_single_redeem_can_span_before_it_breaches_mainnet`,
`anyone_can_make_every_receipt_unpayable_by_prepending_dust_seeds`,
`the_positions_vec_grows_without_bound_and_has_a_hard_brick_point`*

### The logic that is wrong

`harvest` is capped at `MAX_HARVEST_BATCH = 3` for a carefully measured reason: each batch item is
a full vault→wrapper→strategy→Blend withdraw costing **~7 MB** of modelled memory against mainnet's
**41,943,040-byte** per-transaction ceiling, and the constant was deliberately set *sub-maximal*
(73.6% of the ceiling, ~26% headroom) because "it fits today" is not a good enough bar for
permissionless upkeep.

`Vault::redeem` → `redeem_pt_for` does **exactly the same per-item work** — one
`wrapper::redeem_pt`, hence one Blend `submit`, per position it draws from — and has:

* no pagination,
* no cap of any kind,
* no partial-redeem path (it is all-or-nothing: `settle_redeem` reverts anything short of `payout`
  by more than `REDEEM_DUST = 2`),
* no way to skip, prune or reorder a position.

The existing `vault_redeem_with_a_long_harvest_history_fits_mainnet_limits` measures the case where
the payout is satisfied out of the *first* position touched, so its cost is dominated by the cheap
`get_position` walk. That is the safe shape, not the general one.

### Measured

Sweeping the number of inventory positions a single payout must be assembled from:

| positions spanned | memory | vs mainnet ceiling |
|---:|---:|---:|
| 1 | 14,832,208 | 35% |
| 3 | 28,295,198 | 67% |
| 4 | 35,053,288 | 83% |
| **5** | **41,829,108** | **99%** ← largest that fits, with ~1% margin |
| **6** | **48,622,658** | **115%** ← first breach |
| 8 | 62,262,948 | 148% |
| 11 | 76,177,686 | **182%** |

Marginal cost ≈ **6.8 MB per position spanned**. So `redeem` has an unenforced hard limit of
**5 positions**, reached with 1% headroom — against a sibling function that was capped at 3 to keep
26%.

### Why this is P0, not a capacity note

**`seed` is permissionless** ("Anyone may seed (it only donates PT to the vault)"), and every seed
appends a tracked position. That docstring is true about *value* and false about *cost*.

`anyone_can_make_every_receipt_unpayable_by_prepending_dust_seeds` runs the attack end to end: an
attacker spends **10,000 stroops (0.001 USDC)** across ten `seed(1_000)` calls in the window between
`initialize` and the operator's first real seed. The vault then looks perfectly healthy —
`stats()` reports positive coupon capacity, `assert_solvent` passes, a deposit is accepted. At
maturity the receipt is owed, fully backed, and **unpayable**: the redeem costs **75,528,790 bytes
= 180% of the ceiling**, so the transaction cannot be submitted at all. The receipt stays open
forever and the user's principal never comes back.

The default deploy makes this window wide: `VAULT_SEED_AMOUNT` and `MARKET_SEED_AMOUNT` both default
to `0`, so a freshly deployed vault sits unseeded until an operator acts.

There is a second, slower version of the same lever. `Positions` is a `Vec<u64>` living in the
vault's **instance** entry, which *every* mutating call rewrites, and Soroban caps one ledger entry
at 64 KiB. Measured cost is **~12 bytes per tracked position**, so the cap is reached at
**~5,106 positions** — after which no vault operation can write its instance entry at all and the
contract is bricked outright. A year of daily harvesting alone reaches ~365; an attacker reaches
5,106 for the cost of the transactions.

### Possible fixes

1. **Gate `seed` to the admin.** This is the single highest-value change and costs nothing: `seed`
   is described as "typically called once by the admin/protocol at launch". Nothing needs it to be
   open, and being open is what turns a capacity limit into an attack. `storage::get_admin(&env)
   .require_auth()` at the top, and keep `from.require_auth()` for the USDC pull.
2. **Bound the redeem walk, the way `harvest` is bounded.** Add `MAX_REDEEM_SPAN` — **3**, matching
   `MAX_HARVEST_BATCH` and its ~26% headroom policy, not 5 — and refuse past it with a named error
   rather than an out-of-budget transaction.
3. **Make `redeem` resumable, which (2) requires.** Split it: `redeem` draws up to `MAX_REDEEM_SPAN`
   positions, accumulates the USDC it collected against the receipt (a new `collected` field on
   `FixedReceipt`), and closes + pays only once `collected >= payout`. Repeated calls finish the
   job. This is the same pagination shape `harvest` already uses, and it also fixes item 20's
   "no partial path" for free.
4. **Stop fragmenting inventory in the first place.** `harvest` currently mints a *new* position per
   call. Consolidating — reinvesting into a single long-lived "inventory" position, or only minting
   when the reinvest clears a much higher floor than `MIN_REINVEST` — keeps the head of the list
   large and the span at 1. This is complementary to (2)/(3), not a substitute: it reduces the
   likelihood, while (1)–(3) remove the reachability.
5. **Bound `Positions` itself.** Refuse to append past a hard cap (e.g. 512) and require the caller
   to consolidate first, so the 64 KiB entry limit can never be reached. Log the cap in the event
   stream so the operator sees it coming.

---

## 19. P0 — `market::initialize` never cross-checks the settlement asset

*Acceptance test: `market::test::market_init_does_not_cross_check_the_settlement_asset`*

### The logic that is wrong

`market::initialize` was hardened to assert `pt == wrapper.pt_token()` and
`maturity == wrapper.maturity()` — the doc comment explains at length why a mismatch in either is a
live economic failure rather than a cosmetic one. It also asserts the settlement token has 7
decimals. It never asserts the one remaining thing that matters: that the settlement token is
**the asset PT actually redeems into**, i.e. `usdc == wrapper.underlying()`.

The wrapper exposes `underlying()` precisely so contracts above it can discover the settlement
asset. `WrapperContract` (the `#[contractclient]` trait the market and vault call through) does not
declare it, so the check is not merely omitted — it is currently not expressible.

The deploy script's on-chain read-back verification has the same hole: it re-reads `market.wrapper()`,
`market.maturity()` and `market.pt_token()` on every run and aborts on a mismatch, but never reads
`market.underlying()`.

### Measured

The test wires a market to an ordinary, well-formed, 7-decimal SAC that simply is not the wrapper's
USDC. It initializes cleanly, reports the right wrapper, and trades. Then:

* An LP seeds it with **real PT** (minted with real USDC through the wrapper) plus 1,000 of the
  foreign token.
* A trader holding only the foreign token buys PT: pays **500.0 FOREIGN**, receives 485.5 PT.
* At maturity they call `redeem_pt_bearer` and walk away with **485.53 real USDC** out of the
  wrapper's Blend position.
* The LP is left holding 1,500 of the foreign token where they expected USDC.

This is a one-way valve out of the protocol, and it is a *configuration* failure — one wrong
argument in a nine-argument constructor, with no on-chain and no deploy-time guard.

### Possible fixes

1. **Declare `underlying()` on the `WrapperContract` trait** (`contracts/shared/src/wrapper.rs`).
   The wrapper already implements it; the trait is just narrower than the wrapper.
2. **Assert it at market init**, next to the existing two cross-checks:
   ```rust
   if w.underlying() != usdc {
       panic_with_error!(&env, Error::UnderlyingMismatch); // new code, 88
   }
   ```
   A distinct error code matters here: `PtTokenMismatch` and `MaturityMismatch` already exist for
   exactly this reason, so the operator gets told *which* argument is wrong.
3. **Add the read-back** to `deploy_mainnet.sh` / `deploy_testnet.sh` step [7]: read
   `market.underlying()` and `wrapper.underlying()` and abort before seeding if they differ. The
   contract check makes a bad init impossible; the read-back is what catches a *stale state file*
   pointing at a pool built against a different wrapper — which is exactly the argument the script
   already makes for the other three views.
4. **Belt and braces:** have the market read the settlement asset from the wrapper instead of
   taking it as an argument at all. That removes the failure mode rather than detecting it, at the
   cost of the ABI-decoupling the vault's doc comment cites. Given the wrapper now exposes
   `underlying()`, that argument no longer holds.

---

## 3. P0 — `b_rate` deep dip freezes exits

*`testcando.md` §0 P0 `brate_decrease_bricks_everything_including_exits` — **residual ACCEPTED
2026-08-20; the mitigation is operational, not code***

`reset_rate_floor()` restores reads unconditionally and exits for shallow dips. In a **deep** dip
(backing genuinely below principal — tested at a 12% haircut) reads come back, so the dashboard and
monitor work and the shortfall is visible, but **every mutation still refuses** with
`SolvencyViolation`. Pinned for full, half and 1-USDC exits, so it is not a size threshold a small
enough withdrawal slips under.

Accepted because the three cheap options (accept / bounded tolerance / split the guard) all leave
deep dips blocked — they fix the *freeze*, not the *shortfall*. Only loss allocation restores exits,
and it means PT stops being a strict 1:1 claim and touches the vault's solvency model too. That is
not a pre-launch change.

### What is left — two actions, neither of them code

1. **Set and enforce a launch TVL cap.** This is the actual mitigation: it bounds the worst case to
   an amount that can be absorbed or made whole off-protocol. Decide the number, write it down,
   enforce it operationally.
2. **Publish the disclosure** in user-facing docs, not only here: a deep Blend bad-debt event
   freezes withdrawals until backing recovers, with no bounded recovery time. Users cannot consent
   to a risk that is only recorded in an internal tracker.

Revisit loss allocation before scaling past the cap. Note that item **20** is a *second*, more
likely Blend-dependency freeze with the same user-visible shape and a different cause — the
disclosure should cover both.

---

## 20. P1 — A Blend liquidity crunch halts exits, and the vault has no partial path

*Acceptance tests: `wrapper::test::blend_utilization_gates_every_spield_exit`,
`vault::test::a_drained_blend_pool_makes_a_vault_receipt_unpayable_with_no_partial_path`*

### The logic that is wrong

`assert_solvent` compares `shares × b_rate` against principal. That is a claim about **value**, not
about **withdrawability**. Blend caps utilization at `max_util` (0.95 in the reference config), and
`strategy::withdraw_underlying` forwards whatever the pool actually paid; `redeem_underlying` then
reverts if it is short. Every Spield exit runs through that call — `claim_yield`, `redeem_pt`,
`redeem_pt_bearer`, `combine_and_redeem`, and therefore every vault `redeem`.

Nothing in the protocol reads or reports Blend's free liquidity, and nothing in the docs states
that a Spield exit is rationed by Blend's borrowers.

### Measured

Wrapper (a 200,000 USDC position, pool driven to `max_util`):

* Free pool liquidity: **35,200 USDC**.
* `solvency()` reports backing **200,244.56** ≥ principal **200,000** — the protocol declares
  itself healthy, correctly, because the value *is* there.
* Full `redeem_pt(200,000)` → **reverts with Blend error `#1207`**. Not a Spield error code: the
  holder gets an opaque number from a contract they have never heard of.
* `claim_yield` still paid **9,039 USDC** (it fits), and a partial `redeem_pt(17,600)` succeeded.

So the wrapper degrades gracefully-ish: a holder can extract at most the free liquidity per
transaction, with no bound on how long the remaining 182,400 USDC stays locked.

Vault (a 100,000 USDC receipt, payout 105,000, free liquidity 45,200): **`redeem` simply fails**,
same `#1207`. There is no partial path at all — `settle_redeem` reverts anything short of the full
`payout` — so a vault receipt goes from "delayed" to "unpayable" while `stats()` reports
`pt_inventory (400,000) >= total_liability (105,000)`.

### Possible fixes

1. **Give the vault the partial path the wrapper has.** This is the same work as item 18's fix (3):
   a resumable `redeem` that banks what it collected and finishes later turns a hard failure into a
   delay. Do them together.
2. **Surface free liquidity as a first-class view.** Add `strategy::available_liquidity()` (the
   pool's USDC balance, or `min(balance, max_util headroom)`) and expose it through
   `wrapper::solvency()` as a fourth term. Then the dashboard can say "backed, but only 35,200
   withdrawable right now" instead of a green tick, and the SDK can pre-check a redeem before the
   user pays for a transaction that will revert.
3. **Translate the Blend error.** Catch the short-withdraw case in `strategy::redeem_underlying` and
   panic with Spield's own `WithdrawShortfall` (#42) rather than letting `#1207` escape. The error
   type already exists and is currently only reachable on a different path.
4. **Monitor it.** `solvency_monitor.mjs` should alarm on utilization approaching `max_util`, since
   that is the leading indicator of an exit freeze and is invisible in the current output. See
   item 23.
5. **Disclose it.** Same document as item 3's disclosure: exits depend on Blend having liquidity,
   which depends on Blend's borrowers, and neither Spield nor its admin can force it.

---

## 21. P1 — Vault YT yield is unclaimable after maturity, and live YT legs are pruned

*Acceptance tests: `vault::test::vault_yield_unclaimed_at_maturity_can_never_be_claimed_by_anyone`,
`redeeming_prunes_positions_that_still_hold_the_vaults_yt`*

### The logic that is wrong

The vault owns its wrapper positions, so `wrapper::claim_yield` requires **the vault** to
authorize — and the vault's only route to that call is `harvest`, which is gated
`ensure_before_maturity`. The moment the market matures, every stroop of YT yield still sitting
unclaimed in the vault's positions becomes unreachable. Not by the vault, not by the admin, not by
anyone.

`redeem_pt_for` then makes it irreversible: a position emptied of PT is dropped from `Positions`
outright, even though `redeem_pt` never touches `yt_amount`. The vault silently stops tracking a
YT leg it still owns.

This is not the same as item 16. Item 16 is *post*-maturity growth that belongs to nobody by
design. This is *pre*-maturity yield that the vault genuinely earned, which funds the coupon, and
which is lost to a gate.

### Measured

A 2,500 USDC vault (2,000 seed + 500 deposit) over a one-year term with upkeep that stops early:

* **668,968,443 stroops (66.9 USDC)** of YT yield claimable at maturity.
* `harvest` at maturity + 1 → `VaultExpired`.
* After the receipt is paid in full, **532,146,446 stroops (53.2 USDC)** is still sitting there,
  visible in `position_value`, reachable by no one — **~2.1% of the vault's TVL**.

Position pruning confirmed separately: a seed position redeemed to `pt_amount = 0` is dropped from
tracking while still holding its full 100 USDC YT leg.

### Possible fixes

1. **Let `harvest` run after maturity.** The `ensure_before_maturity` gate exists because the
   *reinvest* leg calls `wrapper::mint`, which is maturity-gated. But `harvest` already has a
   "claim, then skip the reinvest and hold the USDC" branch for the wrapper-paused case — reuse it:
   ```rust
   // replace ensure_before_maturity with:
   let matured = env.ledger().timestamp() >= storage::get_maturity(&env);
   ...
   if matured || reinvestable < MIN_REINVEST || w.is_paused() { /* claim only, hold the USDC */ }
   ```
   The claimed USDC then rests in the vault and is swept by the fix in (3). Yield stops accruing at
   maturity anyway (the wrapper's `maturity_rate` ceiling), so this is a finite, one-shot sweep.
2. **Stop pruning positions that still hold YT.** In `redeem_pt_for`, keep the id whenever
   `pos.yt_amount > 0`, not only when `pos_pt > take`. Pair it with (1) so the retained ids are
   actually useful, and with item 18's cap so a longer list cannot make `redeem` more expensive.
3. **Run a post-maturity harvest in the runbook.** Even with (1) and (2) shipped, someone has to
   call it. Add it to `MAINNET.md`'s maturity checklist alongside `stamp_maturity_rate`.

---

## 22. P1 — Vault seed capital and surplus inventory are one-way

*Acceptance test: `vault::test::the_vault_has_no_path_to_recover_seed_capital_or_surplus_inventory`*

### The logic that is wrong

`seed` pulls USDC in and mints PT+YT into the vault. Nothing ever sends PT, YT or USDC back out
except `redeem`, which pays exactly one receipt's `payout` to that receipt's owner. There is no
sweep, no `unseed`, no admin withdrawal — deliberately, since "the admin cannot move user funds" is
a load-bearing part of the trust model. But the consequence is that the protocol's own bootstrap
capital is burned.

### Measured

Seed 2,000 USDC, one 100 USDC receipt, one harvest, redeem at maturity:

* `total_liability` = **0** — every obligation settled.
* The vault still holds **2,023.14 PT**, **2,128.14 YT**, and any resting USDC.
* The seeder's USDC balance is **0** and there is no entry point that could change that.

At a real launch seed this is the largest single sum in the system, locked permanently in a contract
whose only remaining job is finished.

### Possible fixes

1. **Add a liability-gated sweep.** The safe form is narrow enough to be obviously correct:
   ```rust
   pub fn sweep(env: Env, to: Address) {
       storage::get_admin(&env).require_auth();
       if storage::total_liability(&env) != 0 { panic_with_error!(&env, Error::InsufficientCapacity); }
       if env.ledger().timestamp() < storage::get_maturity(&env) { panic_with_error!(&env, Error::VaultNotMatured); }
       // …then move PT / YT / USDC to `to`.
   }
   ```
   Two conditions — **zero outstanding liability** *and* **at/after maturity** — mean it can never
   touch funds anyone is owed, in the same shape item 16 already proposes for the wrapper. Ship
   them as one change if item 16 is ever actioned.
2. **Sweep the YT leg through `combine_and_redeem`, not a raw transfer**, so the wrapper's
   accounting stays consistent and the positions close properly (which also helps item 25).
3. **If a sweep is judged too much admin power:** at minimum, document that seed capital is
   non-recoverable so it is sized as an expense rather than as working capital, and consider a
   `beneficiary` address fixed at init that the sweep must pay to, so the admin chooses *when* but
   not *where*.

---

## 23. P1 — The solvency monitor does not enforce the invariant the contract enforces

*No test — `scripts/solvency_monitor.mjs` is an operational script. Reviewed against the contract.*

### The logic that is wrong

Three separate mismatches between the watchtower and the thing it is watching:

1. **The tolerance is a hardcoded constant.** The monitor alarms when
   `backing + 8 < principal`. The contract's actual band is `open_positions + WITHDRAW_SLACK(4)`,
   which grows with live positions. The wrapper exposes `open_positions()` *specifically* so the
   monitor can "reproduce the exact band the contract enforces instead of guessing it" — and the
   monitor guesses. At any real scale (≥5 open positions) the monitor **false-alarms** on states
   the contract considers healthy. Because daemon mode calls `process.exit(2)` on the first breach,
   a false alarm does not just page — it **kills the watchtower**.
2. **PT/YT supply conservation is not checked at all.** Item 13 lists it as required, the
   `bearer_redeemed()` view exists for exactly this, and the monitor never reads it. The invariant
   `Σ pos.pt_amount == PT_total_supply + bearer_redeemed` is the thing that would catch counterfeit
   PT — which is the whole point of the issuer lockdown that `redeem_pt_bearer` depends on.
3. **Only the wrapper is watched.** The vault's `pt_inventory >= total_liability`, the market's
   reserves, and Blend's utilization (item 20) have no watchtower.

### Possible fixes

1. **Read the band from chain.** Add `open_positions()` to the polled views and compute
   `tolerance = open_positions + 4`; keep `--tolerance` as an *additional* slack, not the whole
   budget.
2. **Do not exit on breach in daemon mode.** Alarm, POST the webhook, set a sticky unhealthy flag,
   and keep polling — a watchtower that dies on the first alert is worse than one that repeats.
   Reserve `exit 2` for `--once`.
3. **Add the conservation check.** Poll `bearer_redeemed()` plus the PT and YT SAC `total_supply`,
   and sum `pos.pt_amount` over open positions (the same id-scan the SDK's `getPositions` already
   does). Alarm on any drift. This closes item 13's third bullet.
4. **Add vault, market and utilization checks** as separate probes with their own thresholds, so one
   noisy signal cannot silence the others.
5. Make the monitor's own acceptance test part of `testcando.md` §18 ("proving the solvency monitor
   fires") — it is currently listed as open there and this is the natural place to close it.

---

## 13. P1 — Issuer lockdown — rehearsal only

*`testcando.md` §13 — **code shipped; the live steps are outstanding***

The lockdown is scripted and self-verifying (`deploy_*.sh` step [3c]): master weight → 0 after the
SAC-admin handover, two fail-closed pre-flights, and an on-chain re-verification on every later run
that aborts the deploy if any key can still sign. Nothing more to build.

### What is left

1. **Rehearse it once on testnet** — end to end, including that minting still works afterwards
   (`LOCK_ISSUER=0` is the escape hatch while iterating; it must never be used on mainnet).
2. **Confirm the mainnet run prints `✓ VERIFIED on chain`** before anything is seeded. This is now
   load-bearing: `redeem_pt_bearer` pays out on PT balance alone, so an unlocked issuer would mean
   counterfeit PT redeemable for real USDC.
3. **Monitor PT/YT supply conservation live** (§13 / §19) — `Σ pos.pt_amount == PT_supply +
   bearer_redeemed`. The `bearer_redeemed` view exists for exactly this. **Confirmed unimplemented
   this round** — see item 23.

Remember the lockdown **burns the issuer identity**: a future `FRESH=1` deployment needs a
brand-new issuer account.

---

## 24. P1 — `Vault::initialize` does not cross-check its `underlying` either

*Acceptance test: `vault::test::vault_init_does_not_cross_check_its_underlying_against_the_wrapper`*

The same omission as item 19, one contract over. `Vault::initialize` reads `pt`, `yt` and `maturity`
from the wrapper but takes `underlying` on trust, checking only that it has 7 decimals. The doc
comment justifies this by saying older deployed wrappers may not expose an `underlying()` view —
they do now.

### Measured

A vault wired to the wrong 7-decimal SAC **initializes cleanly** and reports the correct inherited
maturity. It fails only at the first `seed`, and it fails with `Error(Context, InvalidAction)` — a
host error naming neither the vault nor the misconfiguration. So it does fail closed (no drain, in
contrast to item 19), but the operator discovers a bad deploy after deploying, from an error they
cannot act on.

### Possible fixes

Same as item 19: declare `underlying()` on the `WrapperContract` trait, assert
`w.underlying() == underlying` at init with a named error, and add the read-back to the deploy
scripts. One change closes both items.

---

## 15. P1 — A raw YT transfer strands the recipient's claim

*Not in `testcando.md` — **found while implementing `split_position`; not enforceable on-chain***

The **position** is the authoritative claim, not the token balance: `claim_yield` pays `pos.owner`
and never reads a YT SAC balance. `split_position` + `transfer_position` gives a *correct* path for
partial sales, but nothing *prevents* the wrong one. Send YT peer-to-peer and the recipient holds YT
that can claim **nothing**, while the sender **keeps earning** on tokens they no longer hold.

**There is no contract-level fix.** Pendle prevents this with a `_beforeTokenTransfer` hook that
checkpoints both parties. A Stellar Asset Contract cannot: it is built into the protocol
(`CONTRACT_EXECUTABLE_STELLAR_ASSET`, not a Wasm hash), with a fixed interface and no callbacks. We
are SAC *admin*, which grants mint and burn — admin is not a hook. **No code of ours can run on a YT
transfer.** Enforcement would mean replacing the YT SAC with a custom SEP-41 token holding a
per-holder interest index, costing YT its classic-asset nature (trustlines, path payments, classic
DEX and wallets) and adding a new audited surface exactly where yield bugs live (SCF #4 and #5 were
both interest-index bugs).

### What is left

* **Short term (do this):** the dApp must route every partial sale through `split_position` +
  `transfer_position`, so the bad state is unreachable through the UI, and the docs must warn that
  sending YT directly forfeits the yield claim. **Still not done as of this round** — the SDK
  exposes `splitPosition` and `transferPosition` as two independent methods with no composed,
  guarded helper, so nothing in shipped code enforces the ordering. See item 30.
* **Long term:** only revisit if a fungible YT market becomes a product goal.

**Exposure today is latent, not live.** There is no YT pool (`FEATUREPLAN_BUY_YT.md`: "YT is always
derived — mint a PT+YT pair, then sell the PT you don't want"), so every YT holder is also the
position owner and the two cannot drift apart. It goes live the first time anyone sends YT
peer-to-peer.

---

## 25. P1 — The solvency dust band ratchets with lifetime users, not live dust

*Acceptance test: `wrapper::test::the_solvency_dust_band_never_shrinks_after_the_ordinary_maturity_exit`*

### The logic that is wrong

`assert_solvent`'s tolerance was deliberately moved from the monotonic `next_position_id +
withdraw_ops` to `open_positions + WITHDRAW_SLACK`, with the reasoning that "closed positions carry
zero dust (their principal is gone too), so anchoring to `open_positions` is both tighter and
ungameable by churn."

But `close_if_empty` requires `pt_amount == 0 **&&** yt_amount == 0`, and the mainstream maturity
exit — `redeem_pt` — burns only the PT leg. A position redeemed down to zero principal therefore
stays **open**, and `open_positions` never decrements.

`dust_tolerance_does_not_grow_with_churn` proves the band is flat under `combine_and_redeem`, which
burns both legs. It does not exercise the ordinary path.

### Measured

Ten positions minted, every one fully redeemed at maturity:

* Each ends with `pt_amount = 0`, `principal = 0`, and `open = true`.
* `open_positions` stays at **10** — the band is **14 stroops** against **zero** outstanding
  principal.

So the band is bounded by *lifetime users*, not by live dust. Not currently exploitable (a stroop
per user is far below any meaningful theft, and each position still costs a real deposit), but it is
a monotonically loosening safety check on the protocol's central invariant — the exact property the
previous refactor was done to remove.

### Possible fixes

1. **Close on zero principal, not on zero tokens.** The dust a position can carry is mint-floor
   rounding on its *principal*; once `principal == 0` there is nothing left to round.
   ```rust
   fn close_if_empty(pos: &mut Position) -> bool {
       if pos.open && pos.principal == 0 && pos.pt_amount == 0 { pos.open = false; return true; }
       false
   }
   ```
   A residual YT leg on a zero-principal position earns nothing anyway once `shares` is spent, and
   `do_claim` already returns 0 for a closed position.
2. **Or count a separate `backed_positions`** incremented on mint and decremented when
   `principal` first hits 0, and use *that* for the band — leaving `open` as the user-facing
   lifecycle flag. Slightly more storage, no behaviour change for holders.
3. Either way, extend `dust_tolerance_does_not_grow_with_churn` to cover the `redeem_pt`-only path
   so the gap cannot reopen.

---

## 26. P2 — Market lifecycle and LP path gaps

*Acceptance tests: `market::test::add_liquidity_is_not_gated_on_maturity`,
`a_dust_liquidity_add_mints_zero_shares_and_keeps_the_deposit`,
`an_lp_deposit_is_dossed_by_any_swap_that_lands_first`*

Three independent defects on the same function, all P2, all cheap to fix.

### 26a — `add_liquidity` has no maturity gate

Swaps stop at maturity (`ensure_tradeable`); the wrapper (`MarketMatured`) and the vault
(`VaultExpired`) both refuse post-maturity inflows. `add_liquidity` calls only `ensure_can_trade`
(initialized + not paused), so liquidity still flows into a pool that can never quote again.
Measured: at maturity + 1, `pt_price()` and `quote_usdc_for_pt()` both return 0 and swaps revert,
yet a 100 PT / 100 USDC add succeeds and mints 1,000,000,000 shares.

It is value-neutral (the add is proportional and `remove_liquidity` gives it straight back), so this
is a lifecycle inconsistency rather than a loss — but the "ratio" it is validated against no longer
means a price, and every sibling contract refuses the same class of inflow.

**Fix:** call `Self::ensure_tradeable(&env)` in `add_liquidity`. One line. `remove_liquidity` must
stay open (LPs must always be able to exit), which it already does.

### 26b — no `shares > 0` guard on the follow-on LP path

Shares are `min(by_pt, by_usdc)` and the ratio guard only compares the two legs *against each
other*. While `total_shares == sqrt(pt_res · usdc_res)` exactly, both legs cannot floor to zero at
once. But `total_shares` only ever moves on a liquidity event while reserves grow with every swap
fee — so after the **first** trades, both legs floor to zero for a smallest-possible add, agree with
each other, pass the ratio check, and mint nothing. The tokens are transferred in regardless.

Measured after two ordinary round trips: reserves 10,010,914,562 / 10,004,222,881 against
`total_shares` 10,000,000,000; `add_liquidity(1, 1)` returns **0 shares**, the depositor's balances
each fall by 1, the reserves each rise by 1, and `total_shares` is unchanged.

The loss is dust (bounded by roughly `reserve / total_shares` stroops per leg), so this is P2 — but
"deposit accepted, zero shares minted, funds donated" is not a state the function should be able to
reach.

**Fix:** `if shares <= 0 { panic_with_error!(&env, Error::InvalidAmount); }` before the transfers,
covering both branches. The first-LP branch already has its own `s <= 0` check; this makes the two
consistent.

### 26c — LP deposits have no tolerance parameter and are trivially DoSed

`add_liquidity` requires the deposit to match the live reserve ratio to within ~0.1%. Any swap
landing between the LP's quote and their transaction moves that ratio and the add reverts
`ImbalancedLiquidity` (#84). There is no `min_shares` argument the LP can widen, and no
"add what fits, refund the rest" path.

Measured: a single swap of **1% of the pool** is enough to make a pre-computed, exactly-matching
100/100 deposit revert.

Note this is a *liveness* problem, not an extraction one — the strict ratio check is precisely what
stops a sandwich from re-pricing the LP's entry. The cost is a wasted fee, not a bad fill.

**Fix:** take the pool's own tolerance from the caller. Add a `min_shares: i128` argument (the
standard AMM shape), mint `lo` as today, and revert `SlippageExceeded` if `lo < min_shares` —
replacing the fixed 0.1% ratio band with a bound the LP actually chose. Alternatively keep the band
and add `max_pt_in` / `max_usdc_in` so the contract can trim the over-supplied leg and refund it.

---

## 27. P2 — The wrapper's "read-only" views write to chain state

*Acceptance test: `wrapper::test::wrapper_views_mutate_the_strategys_rate_bound`*

`Wrapper::position_value` and `Wrapper::solvency` are documented as views, and `yield_rate(stamp =
false)` is careful not to write the wrapper's own maturity stamp — the comment even says "a view
must never write". One level down, both reach `strategy::current_rate`, which advances the
`RateBound` high-water mark, re-stamps `last_ts`, and bumps the strategy's instance TTL.

Measured: a single `position_value` call moved the bound from `(1000000000000, 1700000000)` to
`(1002218383775, 1702592000)`. `solvency()` does the same.

Consequences: every dashboard read is a state-changing invocation (so it cannot be served from a
plain read-only simulation footprint without surfacing writes), and because `last_ts` is re-stamped
by *anyone* reading, the rate-bound's allowed rise is measured from the last **observation** rather
than the last **rate change** — a read in the current ledger leaves only `RATE_BOUND_DUST` of
headroom for the next one.

Not currently harmful (the rate cannot rise within a ledger either, and any caller who reads
frequently also sees the rate move in correspondingly small steps), but the stated contract and the
actual behaviour disagree, and the divergence is invisible from the ABI.

### Possible fixes

1. **Split the strategy's rate read in two:** `current_rate()` keeps today's checking-and-stamping
   behaviour for mutating paths; add `peek_rate()` that applies the same bound check and returns the
   rate **without writing**. Point `Wrapper::position_value` / `solvency` / `Market`'s views at
   `peek_rate`.
2. **Or make the write conditional on an existing mutation:** only persist `Bound` when the rate
   actually rose (drop the `now > bound.last_ts` arm). That keeps `last_ts` anchored to the last
   *rate change*, which is the semantically correct anchor for a time-pro-rated growth ceiling, and
   removes the read-frequency coupling entirely.
3. Either way, correct the doc comments on `position_value`, `solvency` and `yield_rate` so they
   describe what the call actually does.

---

## 28. P2 — Exits account the requested amount, not the amount Blend paid

*Acceptance test: `wrapper::test::exit_paths_account_the_requested_amount_not_the_amount_blend_paid`*

`strategy::redeem_underlying` accepts a one-stroop shortfall (`got + 1 < amount` is the revert
condition) and `withdraw_underlying` forwards only what Blend actually paid. Meanwhile `redeem_pt`
returns `amount`, emits `amount`, and decrements `pos.principal` / `total_principal` by `amount`;
`do_claim` sets `paid = payout` regardless of what moved.

The two can differ by a stroop. Today they do not — the test pins delta 0 on the standard path —
but nothing in the code *makes* them agree, and the divergence would be silent: the event stream
and the indexer would both record a payment larger than the transfer.

**Fix:** have `strategy::redeem_underlying` return `(shares_burned, underlying_paid)`, and have the
wrapper account, return and emit the *paid* figure. Where the paid figure is short, either revert
(strict) or reduce `principal` by the paid amount so the position keeps a claim on the remainder —
the strict form is simpler and the shortfall is already bounded at one stroop.

---

## 29. P2 — A YT-only holder has no principal exit before maturity

*Acceptance test: `wrapper::test::a_yt_only_holder_has_no_principal_exit_before_maturity`*

The "Earn Yield" flow is: mint a PT+YT pair, sell the PT you don't want. That leaves a holder with
YT and no PT — and no way to get their principal back before maturity:

* `redeem_pt` is maturity-gated,
* `combine_and_redeem` needs the PT leg back,
* `claim_yield` returns yield but never principal,
* `split_position` re-partitions but releases nothing (verified: neither half can be combined).

The AMM trades PT, and `FEATUREPLAN_BUY_YT.md` states there is deliberately no YT pool. So the exit
requires buying PT back on the market at whatever it costs — which is the economically correct
answer, but it is not stated anywhere a user will read.

This is a **design consequence, not a defect** — it is exactly how Pendle behaves — and it is listed
here because the tracker should say so explicitly rather than leave it to be rediscovered.

**Fix:** disclosure, not code. The dApp's "Earn Yield" flow should state, before the position is
opened, that principal is committed until maturity unless the user buys PT back. If a pre-maturity
exit ever becomes a product requirement, the honest implementation is a YT venue, not a contract
change.

---

## 30. P2 — SDK surface gaps

*Reviewed against `sdk/src/`; 218 SDK unit tests pass.*

The SDK is the layer several of this document's mitigations are supposed to live in, and it is
missing the surface to hold them:

1. **No LP methods at all.** `MarketClient` has quotes, stats, `buyPt`, `sellPt` and
   `seedPtForApy` — but no `addLiquidity` / `removeLiquidity`, even though `seedPtForApy`'s own doc
   comment says "call before `addLiquidity`". The whole LP side of the AMM is unreachable from the
   SDK.
2. **No `buyYt` executor.** `previewBuyYt` computes the route; nothing executes the mint-then-sell
   pair it previews.
3. **No `bumpPosition` / `bumpReceipt`.** Both contracts ship a permissionless TTL keep-alive
   specifically so a long-dated position cannot archive before maturity (mainnet-readiness #5), and
   neither is callable from the SDK — so nothing in shipped client code ever calls them.
4. **No guarded partial-sale helper.** Item 15's entire mitigation is "route every partial sale
   through `split_position` + `transfer_position`". The SDK exposes both as independent methods with
   no composed helper and no warning, so the guidance is documentation only.
5. **Tooling note:** `pnpm run test:unit` currently fails at pnpm's install pre-check
   (`ERR_PNPM_IGNORED_BUILDS` for `esbuild`) before any test runs. `npx vitest run …` passes all
   218. Worth fixing the documented entry point (a `pnpm.onlyBuiltDependencies` entry) so CI and
   contributors do not have to know the workaround.

**Fix:** add (1)–(3) as thin wrappers over the existing contract calls, and (4) as a single
`sellPartOfPosition({ positionId, amount, to })` that performs split-then-transfer in order and
documents why a raw YT transfer must never be used.

---

## 16. P2 — Post-maturity surplus accrues to nobody

*Not in `testcando.md` — **side effect of the YT maturity cap; no action needed yet***

YT stops earning at maturity (Pendle parity), but the wrapper's Blend position keeps growing. That
growth accrues to no YT holder and no PT holder, so it sits as **surplus backing**. Measured by
`post_maturity_growth_becomes_wrapper_surplus_not_yt_yield`.

Benign: it can only ever make the protocol *more* solvent — `backing >= principal` holds with more
room, never less. Nothing is at risk; it is value with no owner.

### What is left

Nothing, for now. **Re-measure at the first real maturity**, since the amount grows with
time-since-maturity and TVL. If it becomes material, add an admin sweep gated on
`total_liability == 0` **and** at/after maturity, so it can never touch funds anyone is owed. Adding
it sooner means a new fund-moving admin function for an amount that is currently rounding error.
Item 22 proposes the same shape for the vault — ship them together if either is actioned.

Note that item 21's stranded vault yield **lands here too**: once the vault can no longer claim it,
it becomes wrapper surplus. Fixing 21 shrinks this figure rather than growing it.

---

## Probed this round and found sound

Recorded so they are not re-investigated. Each has a passing acceptance test that will go red if the
property ever breaks.

### 31. Probed and sound

**The fixed par anchor holds the implied rate across a full term.**
*`market::test::the_pools_implied_apy_holds_its_rate_over_the_term_without_re_anchoring`*

The concern: `rate_anchor` is pinned at par and never re-anchored (Pendle's `_updateMarketState` is
the deferred Stage C.1 refinement), while `rateScalar = scalar_root / yearsToMaturity` grows without
bound — so the price is dragged onto the anchor whatever the pool proportion is. If the price
converges to par while the quoted rate is read off the price, the headline APY would decay to zero
on the calendar alone.

Measured on a pool seeded at exactly 5.000% and then left completely untouched:

| elapsed | implied APY | PT price |
|---|---:|---:|
| seed | 5.000% | — |
| +1 month | 4.990% | 0.956295 |
| +3 months | 4.969% | 0.964123 |
| +6 months | 4.938% | 0.976125 |
| +11 months | 4.887% | 0.995956 |

Total idle drift: **11.3 bps over eleven months**. The price's march to par and the shrinking time
base cancel almost exactly, which is the property the curve is supposed to have. The test asserts a
<25 bps bound.

What Stage C.1 is still for, recorded in the same test: a single 2,000 USDC buy (2% of the USDC
side) moves the quote from 4.990% to **4.406%**, and six months later it is still 4.361% — with a
fixed anchor nothing pulls the quoted rate back toward the market's view of it until someone trades
in the other direction. That is normal AMM behaviour, and it means the shipped `SCALAR_ROOT` sets
how much flow the venue absorbs before its headline number stops matching the vault's. Worth
calibrating against expected volume in `testcando.md` §12, not a defect.

### 32. Probed and sound

**Position ownership auth is correctly scoped, not merely present.**
*`wrapper::test::a_stranger_cannot_act_on_someone_elses_position`*

The whole suite runs under `mock_all_auths()`, and the three existing negative auth tests use
`set_auths(&[])`, which removes *all* authorization. That distinguishes "requires auth" from
"requires none"; it cannot distinguish "requires the owner" from "requires the caller". A regression
that authorized the invoker instead of `pos.owner` would have passed every test in the repo.

The new test signs as a stranger only (via `mock_auths` with a single `MockAuth` entry) and confirms
`claim_yield`, `split_position`, `transfer_position` and `combine_and_redeem` all refuse, then
confirms the same calls succeed with the owner's auth — so the failures are the ownership check
firing, not the harness being unusable. This closes the load-bearing case of `testcando.md` §6's
systematic auth matrix; the rest of §6 (admin functions, strategy, vault, market) is still Phase 2.

### 33. Probed and sound

**`redeem` cost is set by inventory shape, not by history length.**
*`vault::test::redeem_cost_is_set_by_inventory_shape_not_by_history_length`*

With one large seed, 120 daily harvests (53 tracked positions) and four receipts, every redeem is
satisfied out of the *first* position it touches and costs ~8.6 MB — **20% of the mainnet ceiling**,
flat across all four. A long position list is harmless. What is fatal is a *fragmented head* of the
list, which is why item 18 is about `seed` being permissionless rather than about harvest history.

---

## Appendix B — what Phase 1 did not cover

Scope was `testcando.md` §0 plus §13's on-chain conservation law. Still open, by phase:

* **Phase 2** — §1 wrapper lifecycle edges, §2 strategy/rate-bound edges, §3 vault edges, §6
  systematic auth matrix (**partially closed** — item 32 covers the wrapper's position-ownership
  case; admin, strategy, vault and market auth are untouched).
* **Phase 3** — §4 AMM/curve edges, §8 pure-math properties, §9 remaining resource budgets
  (**re-opened** — item 18 shows §9 was closed against `harvest` only, and `redeem` has the same
  budget problem), §12 mainnet-parameter profile (**now also needs a `SCALAR_ROOT` depth
  calibration** — item 31), §14 launch-seed calibration (**closed** — `seed_pt_for_apy` derives the
  ratio on chain and the deploy scripts verify the opening rate).
* **Phase 4** — §5 ecosystem stateful fuzz, §15 adversarial simulation, §7 event contracts, §10
  chaos drills, §11 mutation testing.

**Not reachable from the test suite** — §16 (live mainnet read-only verification) and §17 (testnet
operational drills) need network access and keys. Item 13's testnet rehearsal belongs here too.

---

## Appendix C — the 2026-08-23 audit's new tests

21 tests added; the suite goes from 230 to **251**, all green. Each asserts the *current* behaviour,
so a fix flips the assertion rather than deleting the test.

| Test | Crate | Item |
|---|---|---|
| `a_receipt_whose_payout_spans_many_positions_exceeds_the_mainnet_memory_limit` | vault | 18 |
| `how_many_positions_a_single_redeem_can_span_before_it_breaches_mainnet` | vault | 18 |
| `anyone_can_make_every_receipt_unpayable_by_prepending_dust_seeds` | vault | 18 |
| `the_positions_vec_grows_without_bound_and_has_a_hard_brick_point` | vault | 18 |
| `redeem_cost_is_set_by_inventory_shape_not_by_history_length` | vault | 33 |
| `market_init_does_not_cross_check_the_settlement_asset` | market | 19 |
| `blend_utilization_gates_every_spield_exit` | wrapper | 20 |
| `a_drained_blend_pool_makes_a_vault_receipt_unpayable_with_no_partial_path` | vault | 20 |
| `vault_yield_unclaimed_at_maturity_can_never_be_claimed_by_anyone` | vault | 21 |
| `redeeming_prunes_positions_that_still_hold_the_vaults_yt` | vault | 21 |
| `the_vault_has_no_path_to_recover_seed_capital_or_surplus_inventory` | vault | 22 |
| `vault_init_does_not_cross_check_its_underlying_against_the_wrapper` | vault | 24 |
| `the_solvency_dust_band_never_shrinks_after_the_ordinary_maturity_exit` | wrapper | 25 |
| `add_liquidity_is_not_gated_on_maturity` | market | 26a |
| `a_dust_liquidity_add_mints_zero_shares_and_keeps_the_deposit` | market | 26b |
| `an_lp_deposit_is_dossed_by_any_swap_that_lands_first` | market | 26c |
| `wrapper_views_mutate_the_strategys_rate_bound` | wrapper | 27 |
| `exit_paths_account_the_requested_amount_not_the_amount_blend_paid` | wrapper | 28 |
| `a_yt_only_holder_has_no_principal_exit_before_maturity` | wrapper | 29 |
| `the_pools_implied_apy_holds_its_rate_over_the_term_without_re_anchoring` | market | 31 |
| `a_stranger_cannot_act_on_someone_elses_position` | wrapper | 32 |

Two test-harness additions support them: an `xlm` field on the wrapper and vault `World` structs
(needed to drive Blend utilization), and `tracked_position_ids()` in the vault suite (reads the
vault's `Positions` Vec straight from storage).

### Suggested order of work

1. **Gate `seed` to the admin** (item 18 fix 1) — one line, removes the P0's reachability today.
2. **Add `underlying()` to the `WrapperContract` trait + both init cross-checks + deploy read-backs**
   (items 19 and 24) — one change, closes a P0 and a P1.
3. **Bound and paginate `Vault::redeem`** (item 18 fixes 2–3) — also gives item 20 its partial path.
4. **Let `harvest` run post-maturity and stop pruning live YT legs** (item 21).
5. **Fix the monitor's tolerance and add the conservation check** (item 23) — also closes item 13's
   third bullet.
6. The P2 batch (items 25–30) is small and independent; 26a, 26b and 25 are one line each.
