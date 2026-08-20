# tofix.md — what is still open

Finished work has been removed from this document. What remains is only what still needs a
**decision**, an **action**, or a **deploy step**. Each entry states what is left, not what landed.

Item numbers are unchanged from the original Phase 1 round so `testcando.md` cross-references and
git history still line up. The gaps in the numbering — **1, 2, 4–12, 14** — are defects that closed,
each with an acceptance test that goes red on regression. Item 13's code has shipped; only its
live rehearsal is still open, so it is kept below in reduced form.

Verified against the working tree on **2026-08-20**. Suite: **225 Rust tests + 216 SDK tests, all
green**; release WASM builds clean with no warnings.

Severity legend — **P0** = must close before the first seed transaction; **P1** = close before
meaningful TVL; **P2** = documentation / belt-and-braces.

---

## What is left

| # | Item | Area | Sev | What is left |
|---|---|---|---|---|
| [17](#17-the-amm-seed-ratio-ships-a-losing-trade) | The AMM seed ratio ships a losing trade | seed / launch | **P0** | **Calibrate the seed ratio.** Measured today: 100 USDC → 99.21 USDC |
| [3](#3-b_rate-deep-dip-freezes-exits) | `b_rate` deep dip freezes exits | strategy | **P0** | Residual accepted — **set the TVL cap, publish the disclosure** |
| [13](#13-issuer-lockdown--rehearsal-only) | Issuer lockdown | deploy | P1 | Code shipped — **rehearse on testnet, confirm `✓ VERIFIED` before seeding** |
| [15](#15-a-raw-yt-transfer-strands-the-recipients-claim) | A raw YT transfer strands the recipient's claim | wrapper / dApp | P1 | **dApp must route through split+transfer**; not fixable on-chain |
| [16](#16-post-maturity-surplus-accrues-to-nobody) | Post-maturity surplus accrues to nobody | wrapper | P2 | Nothing yet — **re-measure at the first real maturity** |

Items 15, 16 and 17 are new numbers for findings surfaced while closing 1, 2 and 13.

**Also gating launch, and never `tofix.md`'s scope:** `testcando.md` §18 — the §12
mainnet-parameter profile, proving the solvency monitor fires, the audit decision, and Appendix B.

---

## 17. The AMM seed ratio ships a losing trade

*`testcando.md` §14 — **surfaced concretely by the market-bought-PT fix; NOT CALIBRATED***

Now that PT bought on the AMM can actually be redeemed, the flagship "Earn Fixed" flow runs end to
end — and the measurement is bad. From
`market::test::market_bought_pt_is_redeemable_by_the_buyer`, at the deploy scripts' default
balanced seed:

```
Earn Fixed via AMM (1:1 seed): spent 1000000000 USDC -> 992051784 PT -> 992051784 USDC at maturity
```

**100 USDC in, 99.21 USDC out — a 0.79% loss for holding to maturity.**

The redemption path is correct; the **seed ratio** is not. `MARKET_SEED_AMOUNT` supplies both sides
equally, so the pool opens at proportion 0.5 where `rate_anchor` puts PT at **par**. A buyer
therefore pays ~1.00 per PT for something that redeems at exactly 1.00, and the 0.30% swap fee plus
price impact makes the round trip negative. The venue is quoting ~0% APY by construction.

### What is left

1. **Compute the real seed ratio** — PT must open at a discount that expresses the intended fixed
   APY over the remaining term, not at par. This is the number `testcando.md` §14 calls for, and it
   is *not* the script's 1:1 default.
2. **Assert the opening `implied_apy`** matches the vault's advertised rate before seeding, rather
   than discovering it afterwards.
3. Consider making `MARKET_SEED_AMOUNT` refuse a balanced seed outright, so the default cannot ship
   a 0% venue by accident.

Until this is done, every user who takes the headline product loses money. It is the single most
user-visible item left.

---

## 3. `b_rate` deep dip freezes exits

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

Revisit loss allocation before scaling past the cap.

---

## 13. Issuer lockdown — rehearsal only

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
   bearer_redeemed`. The `bearer_redeemed` view exists for exactly this.

Remember the lockdown **burns the issuer identity**: a future `FRESH=1` deployment needs a
brand-new issuer account.

---

## 15. A raw YT transfer strands the recipient's claim

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
  sending YT directly forfeits the yield claim.
* **Long term:** only revisit if a fungible YT market becomes a product goal.

**Exposure today is latent, not live.** There is no YT pool (`FEATUREPLAN_BUY_YT.md`: "YT is always
derived — mint a PT+YT pair, then sell the PT you don't want"), so every YT holder is also the
position owner and the two cannot drift apart. It goes live the first time anyone sends YT
peer-to-peer.

---

## 16. Post-maturity surplus accrues to nobody

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

---

## Appendix B — what Phase 1 did not cover

Scope was `testcando.md` §0 plus §13's on-chain conservation law. Still open, by phase:

* **Phase 2** — §1 wrapper lifecycle edges, §2 strategy/rate-bound edges, §3 vault edges, §6
  systematic auth matrix.
* **Phase 3** — §4 AMM/curve edges, §8 pure-math properties, §9 remaining resource budgets, §12
  mainnet-parameter profile, §14 launch-seed calibration (**now item 17 above — urgent**).
* **Phase 4** — §5 ecosystem stateful fuzz, §15 adversarial simulation, §7 event contracts, §10
  chaos drills, §11 mutation testing.

**Not reachable from the test suite** — §16 (live mainnet read-only verification) and §17 (testnet
operational drills) need network access and keys. Item 13's testnet rehearsal belongs here too.
