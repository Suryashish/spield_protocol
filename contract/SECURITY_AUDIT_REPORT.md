# Spield Protocol Security Audit Report

**Date:** 2026-10-06 (original report), verified and extended the same day  
**Assessment:** **Acceptable for a small, capped mainnet test once the checklist in section 2 is done. Not ready for unrestricted real-value deployment.**  
**Scope:** The SR stack (`shared`, `strategy`, `sr`, `yield`, `srmarket`, `srvault`, `srrouter`, `e2e`), the live mainnet deployments, and the operational setup around them. The legacy `wrapper` / `vault` / `market` stack was run for regressions only.  
**Source revision reviewed:** `dc8afe45dcab38abe1f470632a8b2c88ca732212` (`test 1`). Nothing under `contract/` has changed between that commit and the current `HEAD` (`f9bbc51d`).

> This document replaces the first version of the report. Every finding in that version was
> re-checked independently: by reading all six contracts line by line, by re-running the full test
> suites, by writing new reproduction tests against the real contracts, and by reading the live
> mainnet state. Where the first version was right it says so, where its severity was too high or
> the finding was wrong it says that, and section 6 adds issues the first version missed.

## 1. Bottom line

**Can an outside attacker take depositors' funds?** No permissionless path to other users' funds
was found in the contracts, with one exception that is avoidable in operation: an attacker who
becomes the first liquidity provider in an **empty** AMM pool can take roughly a third of the next
provider's deposit (N-03). A pool that the team seeds properly first is not exposed.

**Can a position be liquidated?** No. The strategy only supplies USDC to Blend as a plain
(non-collateral) deposit and never borrows, so there is no debt and nothing to liquidate. The
external risk that remains is Blend itself: a bad-debt event in the Blend pool would reduce what
every SR share is worth, and the vault handles that case badly (N-02).

**What is the largest real risk today?** Key custody, not contract code. The admin is a 2-of-3
multisig on paper, but all three signer keys, the multisig account key and the deployer key sit in
one plaintext file on one machine and in the same machine's CLI keystore (N-01). Whoever
compromises that machine controls every contract and can replace the code under users' funds after
the upgrade delay.

**What the first version of this report got wrong.**

- **H-04 (source does not match deployed code) is not valid.** A clean build of the current source
  produces all six WASMs byte-identical to the hashes live on mainnet. The first audit built with a
  different compiler and CLI, and both version strings are embedded in the binary.
- **H-01, H-02 and H-03 are real mechanisms but were rated too high.** None of them loses funds.
  H-01 leads to archived entries that are restorable. H-02 is a temporary revert that needs a
  liquidity crunch several weeks after maturity. H-03 needs dozens of redemption legs of a few
  stroops each.
- **M-01 and M-02 are real but small.** M-02 costs a holder less than one stroop per attacker
  transaction.
- **M-03 is real, and it already happened on mainnet:** the September series was stamped about 42
  hours after it expired.

**A fact that changes the plan.** Both mainnet series have matured (the live one on 2026-09-30, the
90-minute demo on 2026-09-01). New PT/YT mints, vault deposits and AMM trades are closed on them by
design. Only wrapping USDC into SR and unwrapping it still works. A test in which outside people
deposit into the fixed-rate vault or the AMM therefore needs a **new series deployment**, and the
checklist below is written for that.

## 2. Checklist before inviting outside depositors

Ordered by how much risk each step removes. Items 1 to 6 need no contract change.

1. **Fix key custody (N-01).** Treat the current three signer keys as exposed, because they have
   lived in a plaintext file. Create new signer keys on separate devices or with separate people
   (hardware wallets if possible), swap them into the multisig account with a `setOptions`
   transaction, and remove the old secrets from the laptop and from the CLI keystore.
2. **Keep the SR deposit cap as the loss bound.** It is 50 USDC today with about 45.9 USDC of
   headroom. Whatever the cap is set to is the most that can be lost in the test. Tell testers the
   contracts are unaudited and that the team can upgrade them (the delay is 24 hours today, see
   N-04 for why that is not a guarantee).
3. **Seed the AMM inside the deploy run, before the series is announced (N-03).** Never leave an
   initialised pool empty. Seed it with a meaningful amount, check `total_shares()` afterwards, and
   never withdraw the team's liquidity down to dust while the series is open.
4. **Do not sweep the vault's spare PT while receipts are open (N-02).** The spare PT is the only
   buffer between a Blend loss and every receipt being frozen.
5. **Run the keeper on a schedule that cannot be missed (M-03, N-05).** Stamp the expiry index
   within minutes of maturity, from two independent schedulers. The keeper's TTL bump jobs currently
   do nothing (H-01), so do not rely on them.
6. **Pause what is not part of the test (N-06).** The retired v1 stack and the demo series are still
   unpaused on mainnet under single-key admins. Pause their deposit paths, or at minimum make sure
   no frontend build points at them.
7. **Deploy the new series from the same pinned toolchain and verify the hashes (N-09).** Then
   repeat the on-chain checks in section 4: admin is the multisig on all contracts, no pending
   admin or upgrade, PT issuer locked with flags clear, PT admin is the yield contract.
8. **If any contract code is changed first** (recommended fixes are listed per finding), re-run the
   full suites and the reproductions in section 8 against the new build. The hash verification in
   this report then no longer applies and must be repeated.

Recommended before raising the cap or running a series longer than about 100 days: the code fixes
for H-01, H-02, N-02 and N-03, and a professional third-party audit. This review is thorough but
it is not a substitute for one.

## 3. Findings at a glance

Severity scale: **High** can lose or indefinitely lock meaningful value, or hands control to an
attacker. **Medium** can lose or lock value under a narrower but realistic precondition. **Low** is
a liveness, dust-level or self-inflicted problem. **Info** is hygiene.

### Findings from the first version, re-checked

| ID | Finding | First rating | Verdict | Verified rating |
|---|---|---|---|---|
| H-01 | TTL keep-alive never extends a live entry | High | Confirmed in a test and on live mainnet entries. No fund loss: archived entries are restorable | **Low** (Medium for series over ~120 days) |
| H-02 | Vault partial redemption mixes live rate and frozen index | High | Confirmed, including against the real Blend fixture. A revert only, and only after more than ~1% post-expiry rate growth during a crunch | **Low** for the test, **Medium** at scale |
| H-03 | Per-receipt residue reserve can be exceeded | High | Confirmed only with legs of a few stroops and inventory swept to its limit. Unstuck by sending the vault PT dust | **Low** |
| M-01 | Raw SR burn strands backing, inflates `realizable_value()` | Medium | Confirmed. Self-inflicted, and only a view is wrong | **Low** |
| M-02 | Permissionless checkpoint floors fractional yield | Medium | Confirmed. Bounded below one stroop per checkpoint per holder | **Low** |
| M-03 | Expiry stamp depends on a keeper | Medium | Confirmed, and **observed on mainnet** (stamped ~42 hours late) | **Medium** |
| H-04 | Source does not build to the deployed hashes | High | **Not valid.** Clean build is byte-identical to mainnet | **Info** (pin the toolchain, N-09) |
| I-01 | Vulnerable packages in the ops scripts | Info | Confirmed: 2 high, 1 moderate | **Info** |

### New findings

| ID | Finding | Rating |
|---|---|---|
| N-01 | All multisig signer keys are stored together in plaintext on one machine | **High** (operational) |
| N-02 | Vault has no loss path: a venue loss beyond the spare-PT buffer locks every receipt's collected USDC | **Medium** |
| N-03 | First liquidity provider can inflate share price and take from the next provider | **Medium** |
| N-04 | Admin powers are wider than documented: 1 hour upgrade floor, instant exit freeze, fees to a hot key | **Medium** (centralisation) |
| N-05 | Keeper is not doing its job: TTL bumps are no-ops and the stamp ran 42 hours late | **Low** |
| N-06 | Retired v1 stack and demo series are live, unpaused, under single-key admins | **Low** |
| N-07 | `approve` reverts when the expiration is beyond the network's maximum TTL | **Low** |
| N-08 | Anyone can stop vault yield from being reinvested | **Info** |
| N-09 | No pinned toolchain, so the build is only reproducible on a matching machine | **Info** |
| N-10 | Deposit cap and coupon capacity are first come, first served | **Info** |

## 4. What was checked, and the live state

### Method

- The production logic of the seven SR-stack contract crates (`shared`, `strategy`, `sr`, `yield`,
  `srmarket`, `srvault`, `srrouter`) was read in full. The event and error definition files were
  skimmed only. The deploy state files, the keeper and monitor scripts and the frontend's network
  config were read as well.
- The complete baseline suites were re-run in an isolated copy: **605 passed, 0 failed, 2 ignored**,
  the same totals the first version reported (shared 56, strategy 33, sr 32, yield 59, srmarket
  107, srvault 36, srrouter 29, e2e 67, wrapper 74, vault 43, market 69). The two ignored tests are
  the late-stamp equivalence test (it fails by design, see M-03) and the BLND emissions payout test.
- Twelve new verification tests were written against the real `Sr`, `Yield`, `SrVault` and
  `SrMarket` contracts, some on the project's real Blend fixture and some on a controlled custody
  venue where an exact liquidity level or a rate drop is needed. Their outputs are in section 8.
  They live outside the project tree. No production source file was modified.
- Release WASMs were built twice from the current source (once in a copied tree, once into an empty
  target directory) and hashed.
- Mainnet was read through Soroban RPC simulation and Horizon. **No transaction was signed or
  submitted.** No secret key was read: the secrets file was only scanned for key-shaped strings,
  with every match redacted before display.
- The ops calibration tests were re-run (29 passed), the read-only SR solvency monitor was run
  against mainnet (all six invariants hold), and `npm audit --omit=dev` was re-run.

### Toolchain

| Tool | This verification | First version |
|---|---|---|
| Rust / Cargo | `1.96.1` | `1.92.0` |
| Stellar CLI | `27.0.0` | `23.4.1` |
| Node | `v26.9.0` | `v24.12.0` |
| Soroban SDK | `25.3.1` | `25.3.1` |
| Blend contract SDK | `2.25.0` | `2.25.0` |

The deployed WASMs carry `rsver 1.96.1` and `cliver 27.0.0` in their metadata, which is the
toolchain on the deploying machine and the one used here. That difference is the whole of H-04.

### Live mainnet state, read 2026-10-06 17:39 UTC

| Check | Result |
|---|---|
| Admin of SR, Strategy, Yield, Market, Vault, Router | The multisig `GDJ66WMV…RUFL` on all six |
| Pending admin / pending upgrade | None on any contract |
| Upgrade timelock | 86,400 s (24 h) on all six |
| Paused | No, on all six |
| On-chain `code_hash` vs recorded hashes vs fresh build | All six identical |
| Multisig account on Horizon | 3 signers of weight 1, master weight 0, thresholds 2 / 2 / 2 |
| PT issuer (live series and demo series) | Master weight 0, no other signer: locked. All asset flags false (no clawback, no auth required) |
| PT SAC admin | The yield contract |
| PT supply on Horizon vs `Yield::total_py` | 3.7997545 on both |
| Strategy Blend shares vs SR total supply | 35,467,470 on both: SR is backed one for one |
| Yield solvency | Holds 33,253,961 SR against 33,031,081 required |
| Market reserves vs token balances | Equal on both legs (17,498,921 PT, 2,212,447 SR) |
| Vault | 0 open receipts, 0 liability. One 0.1 USDC receipt was opened and redeemed after maturity, and the inventory arithmetic matches to the stroop |
| SR totals | 4.08 USDC of assets, deposit cap 50 USDC, cost basis 4.05 USDC |
| Blend pool | About 11.48M USDC withdrawable, utilisation 79.1% |
| Series expiry | 2026-09-30 23:09:09 UTC. Index stamped 2026-10-02 17:14:52 UTC |
| Rate bound | 300% APR ceiling, last observation 2026-10-02 17:14:52 UTC |
| Contract instance and code TTL | About 86 to 90 days left on all six |

The contract accounting on mainnet is consistent and healthy. The points that are not healthy are
the late stamp (M-03), the unextended TTLs (H-01) and the operational items in section 6.

## 5. Findings from the first version, verified

### H-01: TTL keep-alive never extends a live entry

**First rating:** High. **Verified rating:** Low for a series shorter than about 120 days, Medium beyond that.  
**Status:** Confirmed by a host test and by live mainnet entries.  
**Location:** `contracts/shared/src/ttl.rs:46-69`, `contracts/shared/src/token.rs:59-80`, `contracts/yield/src/storage.rs:189-202`, `contracts/srvault/src/storage.rs:150-161`, `contracts/srmarket/src/storage.rs:143-156`

`maturity_aware_bump()` returns `(threshold, extend_to) = (0, desired)`. Soroban's `extend_ttl`
only acts when the entry's remaining TTL is at or below the threshold, so with a threshold of zero
a live entry is never extended. The comment in the code ("threshold 0 means always bump") has the
semantics backwards.

This affects more than the `bump_*` entry points. The same pair is used on every **write**
(`set_balance`, `set_interest`, `save_receipt`, `save_shares`), so writes do not extend either.

Evidence:

```text
test (default host settings)          initial TTL 4095
after 10 ledgers + bump_holder        4085   (unchanged expiry)
after a transfer (a write)            4085   (unchanged expiry)
same call with threshold = extend_to  6311999

mainnet, SR balance of the Yield contract
  created  ~ledger 64,216,289     last written ledger 64,735,102
  liveUntil ledger 66,289,888  =  creation + 2,073,599 (the network minimum, never extended)
```

**Why the rating is lower.** Persistent entries are not deleted when their TTL lapses. They are
archived, and any transaction can restore them (current wallets and simulation do it
automatically, for a fee). Balances, interest records, receipts and LP shares therefore cannot be
lost this way, and an archived entry cannot be overwritten or reset. On mainnet every such entry
lives about 120 to 125 days from the moment it is created, which is longer than a 30 or 90 day
series plus its redemption window.

**What it does cost.** Long-term SR holders and any series longer than about 120 days will hit
archived entries and pay for restores. More importantly, the keeper believes it is extending
entries and is not (N-05).

**Fix.** Use a threshold that actually triggers, for example `(extend_to.saturating_sub(17_280),
extend_to)` so an entry is refreshed whenever it is more than a day short of the target. Add a test
that reads the TTL before and after a bump of a live entry.

### H-02: Vault partial redemption mixes the live SR rate with the frozen maturity index

**First rating:** High. **Verified rating:** Low for the capped test, Medium at scale.  
**Status:** Confirmed on a controlled venue and on the real Blend fixture. The first version left the Blend reproduction open; it is now done.  
**Location:** `contracts/srvault/src/lib.rs:276-300`, `contracts/sr/src/lib.rs:245-281`, `contracts/yield/src/lib.rs:198-218`

During a liquidity crunch the vault sizes its PT burn with
`sr.preview_redeem(sr.max_redeemable())`, which is a USDC amount at the **live** rate. It then
burns that many PT, which the engine converts to SR at the **frozen** expiry index, and SR pays
those shares out at the live rate again. The USDC actually requested is therefore
`cap × live / frozen`. The 1% liquidity haircut absorbs the difference until the live rate has
grown about 1.01% past the frozen index. After that the leg asks the venue for more than it has and
the whole call reverts.

Evidence:

```text
controlled venue, 100 USDC on hand, frozen index 1.0
  live 1.100   sized 99.0 PT -> needs 108.9 USDC   reverted, nothing collected
  live 1.005   sized 99.0 PT -> needs  99.5 USDC   partial leg succeeded
  live 1.020   sized 99.0 PT -> needs 101.0 USDC   reverted
real Blend fixture, 300,739 USDC promised, 45,116 USDC free
  0 days after stamp    +0.00%   partial leg succeeded
  20 days after stamp   +0.26%   partial leg succeeded
  90 days after stamp   +1.18%   reverted
in every case the holder was paid the exact promise once liquidity returned
```

**Impact.** No funds are lost and no state is corrupted. The holder cannot make partial progress
until liquidity returns. Three things must coincide: the receipt is redeemed long after maturity
(at the current pool rate of about 6.7% a year, 1.01% of growth takes about 55 days), the Blend pool
is short of cash at that moment, and the receipt is larger than the cash on hand. With 11.48M USDC
withdrawable against a 50 USDC cap this is not reachable in the planned test.

**Fix.** Size the burn in PT face, in one unit: `cap_face = max_redeemable_shares × py_index /
SCALAR_12`, so `redeem_py(cap_face)` releases at most the shares the venue can pay. Keep the
`i128::MAX` case as "no constraint". Add the 90 day case above as a regression test.

### H-03: Per-receipt residue reserve can be exceeded by repeated partial redemptions

**First rating:** High for availability. **Verified rating:** Low.  
**Status:** Confirmed, but only with dust-sized legs.  
**Location:** `contracts/srvault/src/lib.rs:49-67`, `:306-328`, `:674-684`

Each partial leg can lose up to two stroops of PT to flooring. The vault reserves 64 stroops per
receipt for this and does not enforce the bound.

Evidence:

```text
vault swept to its stated limit, venue liquidity forced to 3 stroops per leg
  70 dust legs        residue 70 (budget 64)
  liquidity restored  collected 1002465748 of 1002465753, vault PT 0, receipt open, holder paid 0
  next redeem         InsufficientCapacity (#64)
  200 stroops of PT sent to the vault by a third party -> holder paid 1002465753 in full

same receipt size, legs of ~20 USDC, live rate two minutes past the stamp
  51 legs, receipt closed, residue outstanding 0
```

**Why the rating is lower.** Only the receipt owner can trigger legs on their receipt. A leg only
loses PT when it is tiny or when the live rate has not moved since the stamp: once the rate is a
couple of minutes past the frozen index, each leg of realistic size returns slightly more USDC than
the PT it burned. Reaching the stuck state needs more than 32 legs of a few stroops each, against a
pool that currently holds 11.48M USDC, with the operator having swept every spare stroop of PT
first. And the state is not permanent: PT is a bearer token, so anyone can send the vault a few
stroops and the receipt then closes.

**What is real here** is the design underneath it: a receipt pays nothing until it is fully
collected, and collected USDC has no way out except a full close. That design becomes a material
problem under a venue loss (N-02), and the two should be fixed together.

**Fix.** See N-02.

### M-01: Raw SR burns strand backing and make `realizable_value()` overstate the remaining claim

**First rating:** Medium. **Verified rating:** Low.  
**Status:** Confirmed.  
**Location:** `contracts/sr/src/lib.rs:455-469`, `:557-568`, `:776-795`

```text
deposit 100, burn half the SR directly
  realizable_value(remaining) = 100.0000000     preview_redeem = 50.0000000
  redeem actually paid        =  50.0000000     stranded in the venue = 50.0000000
```

The burner destroys only their own SR, so this is not a theft path, and nobody else's redemption
changes: redemptions pay on Blend's rate, not on `realizable_rate`. `realizable_rate` and
`realizable_value` are not read by any other contract. The practical harm is to the monitor and the
UI: after any raw burn `realizable_rate` sits above the true per-share claim, which would hide a
real loss of the same size.

**Fix.** Either drop `burn` / `burn_from` from SR (nothing in the stack calls them), or track
burned shares and subtract their value in `realizable_rate`.

### M-02: Permissionless checkpoints can suppress fractional yield

**First rating:** Medium. **Verified rating:** Low.  
**Status:** Confirmed, and bounded.  
**Location:** `contracts/yield/src/interest.rs:64-82`, `contracts/yield/src/lib.rs:284-291`

`settle()` advances the holder's index even when the earned amount floors to zero, and
`checkpoint(user)` is open to anyone.

```text
2,000 consecutive per-ledger checkpoints at 5% APY (about 2.8 hours)
  holder of     10 YT   accrued 0        untouched control 1,378 stroops     (all of it lost)
  holder of    100 YT   accrued 12,000   untouched control 13,785            (13% lost)
  holder of 10,000 YT   accrued 1,378,000 untouched control 1,378,579        (0.04% lost)
```

The loss is always less than one SR stroop per checkpoint. Holders below roughly 10 to 15 YT can
lose all of their yield while the spam lasts, but that yield is itself a fraction of a stroop per
ledger. The ceiling is about 0.0017 USDC per victim per day, and the attacker pays one transaction
fee per ledger per victim and receives nothing: the floored value becomes surplus that the treasury
can sweep after expiry.

**Fix.** Carry the remainder in `UserInterest` rather than dropping it.

**Do not apply the alternative suggested in the first version** ("only advance the index when the
rounding preserves the entitlement") on any path that changes a balance. `settle()` runs before
every transfer and mint. If it leaves the index stale and the balance then grows, the next
settlement pays the larger balance interest for a period in which the holder did not own it. That
would turn a dust-level rounding issue into a real theft path.

### M-03: Expiry stamping is keeper-dependent and late stamping changes YT payouts

**First rating:** Medium. **Verified rating:** Medium.  
**Status:** Confirmed, and observed on mainnet.  
**Location:** `contracts/yield/src/lib.rs:310-330`, `:414-429`, `contracts/e2e/src/invariants.rs:450-480`

The engine cannot read Blend's rate as of the expiry timestamp, so it freezes the index at the
first interaction after expiry. Until then post-expiry growth of the whole SR backing is credited
to YT holders. The ignored equivalence test still fails as described:

```text
promptly stamped claim        213696174 stroops
180 days late stamped claim  1476935805 stroops
```

**On mainnet.** The live series expired at 2026-09-30 23:09:09 UTC. Its index was stamped at
2026-10-02 17:14:52 UTC, about 42 hours later. That is the same ledger in which the first vault
receipt was redeemed, so the stamp was most likely a side effect of that user transaction rather
than of a keeper. Nothing stamped it in between: the frozen index equals Blend's rate at that
later moment. With 3.9 YT outstanding the amount moved was a fraction of a cent, but the control
the documentation relies on ("the keeper stamps daily, as soon as a series expires") did not run in
time.

PT holders are not short-changed: PT redeems at face in any case. What moves is the split between
YT holders and the post-expiry surplus.

**Fix.** Operationally, run the stamp from two independent schedulers and alert when a matured
series is unstamped for more than a few minutes. On chain, the dependence can be removed without a
historical lookup: store the timestamp alongside `index_stored` on every pre-expiry sync, and at the
first post-expiry touch interpolate between that observation and the live rate to the expiry
timestamp instead of taking the live rate outright.

### H-04: Source-to-deployment WASM provenance (not valid)

**First rating:** High release blocker. **Verified rating:** Info.  
**Status:** Refuted.

The first version built the source with Rust 1.92.0 and Stellar CLI 23.4.1 and obtained different
hashes. The deployed binaries were built with Rust 1.96.1 and CLI 27.0.0, and the contract metadata
records both versions (`rsver`, `cliver`), so a build with any other toolchain cannot match even
when the source is identical.

Built here with the matching toolchain, from the reviewed revision, into an empty target directory:

| Contract | Fresh build | Live on mainnet |
|---|---|---|
| SR | `4fc2cb87…11d1e078` | identical |
| Strategy | `d9d15981…91150745` | identical |
| Yield | `d5e90382…5e82beb1` | identical |
| SR Market | `0b3f0a36…e45b5f5b` | identical |
| SR Vault | `c0cdeaf7…37f30fb9` | identical |
| SR Router | `a78d10c9…18b5838e` | identical |

The reviewed source is the code running on mainnet. The only thing left of this finding is that
nothing in the repository pins the toolchain, which is why the first audit could not reproduce it
(N-09).

### I-01: Operations dependency tree contains known vulnerabilities

**Rating:** Info for contract custody. **Status:** Confirmed.

`npm audit --omit=dev` in `scripts/` reports 2 high and 1 moderate: `axios` (pulled in by
`@stellar/stellar-sdk` 17.0.1) and `smol-toml`. `npm audit fix` resolves them. These do not touch
the contracts. They matter because the keeper and the monitor run on this tree and the keeper holds
a signing key. `cargo-audit` is still not installed, so Rust advisories remain unscanned.

## 6. New findings

### N-01: All multisig signer keys are stored together in plaintext on one machine

**Rating:** High (operational).

The admin of all six contracts is a 2-of-3 multisig, correctly built on chain. Off chain, the
secret keys for all three signers, for the multisig account itself and for the deployer are in a
single plaintext file in the project directory, and the same identities are present in the Stellar
CLI keystore on the same machine. The file is gitignored, mode 600 and has never been committed,
and no secret-shaped string exists in any tracked file. That prevents an accidental push. It does
not change the fact that one compromised laptop, one malicious dependency run on it, or one backup
that includes the project folder gives an attacker two of three signatures.

With those two signatures an attacker can schedule a contract upgrade and, after the delay in N-04,
run arbitrary code over every balance. This is the most direct "a hacker drains it" path that
exists today, and it does not need a contract bug.

The deployer key in the same file is still the treasury of the yield engine and the market and the
BLND emissions destination, and it is the sole admin of the demo series (N-06).

**Fix.** Generate new signer keys on separate devices held by separate people, replace the signer
set on the multisig account, and delete the old secrets. Keep at most one signer on any one
machine. Move the treasury and emissions destination off the deployer key.

### N-02: The vault has no loss path

**Rating:** Medium. Conditional on a Blend loss, but when it triggers it locks funds rather than reducing them.  
**Location:** `contracts/srvault/src/lib.rs:306-334`, `:337-355`, `:470-505`, `:674-684`

The vault assumes every PT redeems for one USDC. If Blend socialises bad debt, each PT redeems for
less. The vault then behaves as follows:

- A receipt pays out only when `collected == payout`. There is no partial payout and no way for the
  owner to withdraw what has been collected.
- Legs that come back short are recorded as rounding "residue", which has no upper bound, so the
  solvency assertion keeps passing while receipts burn more PT than their payout.
- When the shortfall exceeds the vault's spare PT, the first receipt to reach full collection has
  its closing call reverted by the solvency assertion, later receipts run the inventory to zero,
  and every receipt is left open with its USDC inside the vault.
- That USDC is counted in `total_collected`, which `sweep_surplus` deliberately never touches. Not
  even the admin can release it.

Evidence (two receipts of 100 USDC each, loss applied after maturity):

```text
seed 20 USDC, 20% loss
  A: collected 100.2465750 of 100.2465753, closing call reverted SolvencyViolation (#24), paid 0
  B: collected  75.7534244, then InsufficientCapacity (#64), paid 0
  vault: 0 PT, 175.9999994 USDC held, all of it "collected", admin-sweepable USDC 0
seed 1 USDC, 1% loss
  A and B both unpaid, 198.9899997 USDC locked the same way
seed 60 USDC, 20% loss      both paid in full (the spare PT absorbed the loss)
seed 20 USDC, 1% loss       both paid in full
```

So the spare PT (seed capital plus harvested yield, minus coupons) is a first-loss buffer, and past
it the vault does not degrade: it freezes entirely. A loss that exceeds the buffer by a fraction of
a percent locks close to 100% of depositors' money until someone donates enough PT to cover the
whole shortfall or the contract is upgraded. If the operator has swept the spare PT down to the
reported capacity, the buffer is 66 stroops per receipt and any loss at all triggers this.

In the live system a Blend rate drop first freezes everything behind the strategy's rate guard
until the admin calls `reset_rate_floor`. The behaviour above is what follows that reset.

**Fix.** Let a receipt owner withdraw collected USDC as it accrues, or pay each leg straight
through. Bound per-receipt residue to the budget and treat anything larger as a loss. Define the
loss case explicitly, for example a pro-rata haircut across open receipts, so that it does not
depend on who redeems first. Until then, keep a spare-PT buffer in the vault and do not sweep it
while receipts are open.

### N-03: First liquidity provider can inflate the share price and take from the next provider

**Rating:** Medium. Direct loss of user funds, but only while the pool is empty or nearly empty.  
**Location:** `contracts/srmarket/src/lib.rs:180-210`, `:227-234`

The first `add_liquidity` mints `sqrt(pt × sr)` shares with no minimum and no locked liquidity. A
later add with `min_shares > 0` skips the ratio band and adds the **whole** over-supplied leg to
the reserves while minting `min(by_pt, by_sr)` shares. Together these let the first provider hold
a handful of shares that are each worth a large amount. The next provider's shares then floor to a
very small integer and the remainder of their deposit accrues to the first provider.

Evidence (real contracts, real Blend fixture):

```text
attacker   adds 1 stroop of PT and 1 of SR, then 500 PT + 1 stroop SR with min_shares = 1
           reserves (5000000001, 2) for 2 shares
victim     adds 499 PT + 1 stroop SR at the pool's own ratio, min_shares = 0 (the frontend default)
           receives 1 share worth 333 PT: lost 166 PT, 33% of the deposit
attacker   withdraws 666 PT for the 500 put in: profit 166 PT

same victim deposit into a pool seeded with 1,000 + 1,000: lost 0
```

The existing test `a2_a_donation_cannot_round_the_next_lp_down_to_zero_shares` passes because it
donates by direct transfer, which the market correctly ignores. It does not exercise the
`min_shares` path, which is the one that reaches the reserves.

The pool is only exposed while `total_shares` is tiny. The September market on mainnet holds
9,354,146 shares, so it is not exposed now. A new series is exposed from the moment the
market is initialised until the team's own seed lands, because anyone can mint PT and add first.
The frontend passes `min_shares = 0` by default, which does not protect against this.

**Fix.** On the first add, mint a fixed minimum (for example 1,000 shares) to an address nobody
controls and require the first deposit to clear it. In the `min_shares` branch, pull only the
proportional amount of each leg instead of donating the excess. Operationally: seed inside the
deploy script, and have the frontend refuse to add liquidity when `total_shares` is below a floor.

### N-04: Admin powers are wider than the documentation says

**Rating:** Medium (centralisation). These are trust assumptions rather than bugs, and testers
should be told about them.  
**Location:** `contracts/shared/src/governance.rs:105`, `:227-235`, `contracts/strategy/src/lib.rs:179-189`, `:464-470`

- **The effective upgrade delay is one hour, not 24.** `set_timelock` takes effect immediately and
  its floor is one hour. An admin can lower the delay and then schedule an upgrade, so the exit
  window users can rely on is the floor, not the current setting.
- **The admin can freeze every exit instantly.** The SR documentation says the admin can pause
  deposits only. But `Strategy::redeem` reads `current_rate`, and `set_max_apr_bps(0)` makes that
  read revert as soon as Blend's rate moves. Verified: after `set_max_apr_bps(0)` an SR redemption
  reverts, and it works again when the bound is restored. It is reversible and moves no funds, but
  it is an undocumented pause on withdrawals.
- **Exits depend on the admin after a Blend rate drop.** Any decrease in Blend's rate reverts every
  deposit and redemption until the admin calls `reset_rate_floor` (this is the known `tofix` #3).
  If the admin keys were lost, that freeze would be permanent.
- **Fees flow to a single hot key.** Treasury and emissions destination are still the deployer
  account on every contract.

**Fix.** Raise the timelock floor to the value users are promised, or make a reduction of the delay
itself subject to the current delay. Document the exit-freeze and the rate-floor dependency in the
risk panel. Move the treasury.

### N-05: The keeper is not doing its job

**Rating:** Low.

Two independent observations. The keeper's TTL jobs call `bump_holder`, `bump_lp` and
`bump_receipt`, which are no-ops on live entries (H-01), so it reports success while extending
nothing. It does not use the network-level extend operation either. And the one time-critical job
it has, stamping the expiry index, did not happen until 42 hours after the live series expired
(M-03).

**Fix.** After H-01 is fixed, have the keeper read each entry's `liveUntilLedgerSeq` before and
after and fail loudly when it did not move. Until then, extend entries with the network-level
`ExtendFootprintTTL` operation, which works regardless of the contract.

### N-06: Retired and demo deployments are live, unpaused and under single-key admins

**Rating:** Low.

- The **v1 stack** (wrapper `CDLQY72E…`, vault, market, strategy) is unpaused on mainnet. Its admin
  is a single key (`GCRBHHWX…4SFS`), it holds no funds, and it carries the known v1 defects. Its
  addresses are still in the frontend's mainnet config.
- The **demo series** is unpaused, its admin is the deployer hot key rather than the multisig, and
  its SR still holds 0.61 USDC and accepts deposits up to a 20 USDC cap.

Anyone sent to the wrong address, or a frontend build with the demo flag set, would deposit into
contracts with weaker controls than the ones this report describes.

**Fix.** Pause the deposit paths on both, and remove the v1 addresses from the production config.

### N-07: `approve` reverts when the expiration is beyond the maximum TTL

**Rating:** Low.  
**Location:** `contracts/shared/src/token.rs:108-137`

Allowances are temporary entries, and `set_allowance` extends the entry to the requested
expiration. The host refuses to extend a temporary entry past the network's maximum TTL (about 180
days on mainnet), so `approve` on SR or YT with a far-future `expiration_ledger` reverts. Verified:
an approval 1,000 ledgers out succeeds, one past the maximum fails. Integrations that pass a large
expiration by habit will see failed approvals. No funds are at risk.

**Fix.** Clamp the extension to the maximum TTL, or reject the value with a named error.

### N-08: Anyone can stop vault yield from being reinvested

**Rating:** Info.  
**Location:** `contracts/srvault/src/lib.rs:381-403`

`Yield::redeem_due_interest(vault)` is permissionless and pays the vault its accrued SR. `harvest`
only reinvests the amount returned by its own claim, so SR that a stranger's call delivered stays
idle in the vault until expiry, when the admin can sweep it. Coupon capacity then does not grow
from yield. No user loses anything, and the idle SR still earns.

**Fix.** Have `harvest` reinvest the vault's whole SR balance.

### N-09: No pinned toolchain

**Rating:** Info.

There is no `rust-toolchain.toml`, and the deploy script builds with whatever Rust and CLI are
installed. The build is reproducible only on a machine that happens to match, which is exactly what
produced H-04. A third party cannot verify the deployment from the repository alone.

**Fix.** Pin the Rust version in `rust-toolchain.toml`, record the CLI version next to the hashes
in `MAINNETCONTRACTADDRESSES.md`, and build releases in a container.

### N-10: Deposit cap and coupon capacity are first come, first served

**Rating:** Info.

The SR cap is global, so one depositor can fill it and keep everyone else out at no cost beyond
parking capital they can withdraw at any time. The vault's coupon capacity is consumed the same
way. In a public test with a small cap, expect the first participants to take all of it. A
per-address limit in the frontend is enough for a test.

## 7. What held up

These were checked directly, not carried over from the first version.

- **No permissionless path to other users' funds** was found in SR, the strategy, the yield engine,
  the vault or the router. Every value-moving entry point requires the owner's authorisation, and
  the nested-call authorisations each cover exactly one transfer of a contract's own funds.
- **Share accounting is not inflatable at the SR level.** SR shares are Blend b-tokens one for one
  and the rate is Blend's own, so the classic first-depositor attack does not apply there. Direct
  donations to the market do not enter its reserves.
- **Rounding is in the protocol's favour** on every mint, redeem, interest and swap path that was
  traced. Dust round trips lose value for the caller.
- **Yield conservation is exact.** The SR freed by index growth equals what YT holders are owed,
  settlement is path independent, and the post-expiry sweep uses a sound upper bound on unsettled
  claims.
- **The YT transfer hook settles both sides before any balance moves**, including self-transfers
  and transfers through the market and the router.
- **Re-entrancy is not reachable.** The call graph is one-directional and the host forbids it.
- **Initialisation cannot be front-run.** Admins are bound in constructors and every `initialize`
  is admin-gated and one-shot.
- **PT cannot be minted outside the engine.** The issuer account is locked, the asset flags are
  clear, the SAC admin is the yield contract, and the supply on Horizon equals `total_py`.
- **The strategy never borrows**, so there is no liquidation risk, and nobody but SR can direct it.
- **A full lifecycle has already run on mainnet** with consistent accounting: mints, an LP position,
  a vault deposit and its redemption after maturity.
- All 605 baseline tests pass, and the read-only solvency monitor reports all six invariants healthy.

## 8. Reproduction outputs

All from the verification tests described in section 4, run against unmodified contract code.

```text
H-01  initial TTL: SR balance 4095, YT balance 4095
      after 10 ledgers + bump_holder: SR 4085, YT 4085
      after a transfer (write): SR 4085
      with threshold = extend_to: SR 6311999 (target 6311999)

H-02  rate 1.100: max_redeemable 900000000 SR -> vault sizes 990000000 PT face; needs 1089000000 vs 1000000000 on hand; reverted
      rate 1.005: sized 989999999 PT face; needs 994949998; collected 994949998
      rate 1.020: sized 989999999 PT face; needs 1009799998; reverted
      real Blend, 0d after stamp:  +0.0000%  free 45116  promised 300739  ok, collected 44586
      real Blend, 20d after stamp: +0.2623%  ok, collected 44442
      real Blend, 90d after stamp: +1.1805%  reverted, collected 0

H-03  dust legs taken: 70; residue 70 (budget 64); collected 70
      after liquidity returns: open, collected 1002465748 / promised 1002465753; vault PT 0; paid 0
      after a 200-stroop PT donation: paid 1002465753
      realistic: 51 legs of ~20 USDC, receipt closed, residue outstanding 0

M-01  realizable_value 1000000000, preview_redeem 500000000, paid 500000000, stranded 500000000

M-02  10 YT: victim 0, control 1378 (lost 1378)
      100 YT: victim 12000, control 13785 (lost 1785)
      10,000 YT: victim 1378000, control 1378579 (lost 579)

M-03  stamping 180 days late paid 1476935805 instead of 213696174

N-02  seed 20, loss 20%: A collected 1002465750 end #24; B collected 757534244 end #64; vault PT 0, USDC 1759999994, sweepable 0
      seed 60, loss 20%: A paid 1002465753, B paid 1002465753
      seed 20, loss 1%:  A paid 1002465753, B paid 1002465753
      seed 1,  loss 1%:  A collected 1002465744 end #24; B collected 987434253 end #64; vault USDC 1989899997, sweepable 0

N-03  reserves (5000000001, 2) for 2 shares
      victim added 4990000000 PT + 1 SR, got 1 share worth 3330000000 PT: lost 1660000000 (33%)
      attacker withdrew 6660000000 PT for 5000000001 put in: profit 1659999999
      seeded pool: victim added 4990000000 PT, claim 4990000000 (lost 0)

N-04  redeem reverted after set_max_apr_bps(0): true
N-07  approve near expiration ok; beyond max TTL reverted

baseline  605 passed, 0 failed, 2 ignored
build     six fresh WASMs identical to the six live code hashes
monitor   all six invariants hold (mainnet, read-only)
```

## 9. Coverage limitations

- This is a source review with reproduction tests, not a formal verification and not a
  professional third-party audit. It should not be presented as one.
- The Blend pool, Circle USDC and the Stellar host are trusted as they are. A Blend bad-debt event,
  a pool freeze or an issuer action on USDC is outside what these contracts can prevent.
- The unit and integration suites run with mocked authorisation and unlimited budgets. Real
  authorisation trees and resource limits are covered only by what has actually executed on mainnet
  and testnet. A path that fits the local fixture can still exceed the budget against the real pool,
  as `buy_yt_with_usdc` already does.
- The controlled-venue tests isolate accounting behaviour. They do not model Blend's utilisation,
  backstop or oracle rules, which is why H-02 was also run on the real fixture.
- The frontend, the SDK, the server, the bridge and the legacy v1 contracts were not reviewed beyond
  what is cited here.
- Mainnet readings are a snapshot from 2026-10-06 17:39 UTC. Nothing was submitted to any network.
- A new series will be new contract instances. The state checks in section 4 must be repeated on
  them, and if the code is changed first, so must everything else.
- `cargo-audit` is not installed, so Rust dependency advisories were not scanned.

## 10. Remediation order

1. **Key custody (N-01).** New signers on separate devices, old secrets deleted, treasury moved.
2. **Operational controls for the test:** cap as the loss bound, AMM seeded in the deploy run
   (N-03), vault buffer left in place (N-02), stamp keeper on two schedulers (M-03), legacy and demo
   deployments paused (N-06).
3. **Vault redemption redesign (N-02, H-03, H-02):** pay or release collected USDC per leg, bound
   the residue, define the loss case, and size partial legs in PT face.
4. **AMM first-deposit protection (N-03):** locked minimum liquidity and no donated excess.
5. **TTL threshold (H-01)** and a keeper that verifies its own effect (N-05).
6. **Governance (N-04):** timelock floor, documented exit-freeze and rate-floor dependency.
7. **Expiry stamp (M-03):** interpolated on-chain stamp, or accept it as an operational control with
   monitoring.
8. **Smaller items:** carry the interest remainder (M-02), remove or account for raw SR burns
   (M-01), clamp allowance TTL (N-07), reinvest the vault's whole SR balance (N-08), pin the
   toolchain (N-09), patch the ops dependencies and install `cargo-audit` (I-01).
9. Re-run the baseline suites and the section 8 reproductions against the fixed build, deploy to a
   throwaway series, and walk a full lifecycle including a forced liquidity crunch before raising
   the cap.

## 11. Conclusion

The contracts are in better shape than the first version of this report concluded. The deployed
code is the reviewed code, the accounting on mainnet is consistent, and none of the first version's
contract findings lets anyone take or permanently lose depositors' funds. Three of its four "High"
findings are liveness or dust-level problems, and the fourth was a build-environment artefact.

What the first version missed matters more. The admin keys are effectively a single point of
compromise, an empty AMM pool can be used to take from the next liquidity provider, and the vault
freezes completely rather than degrading if Blend ever takes a loss larger than the vault's spare
buffer.

For a small test with a hard deposit cap, with the keys separated first and the pool seeded by the
team before anyone else can reach it, the remaining exposure is bounded by the cap and is
dominated by Blend's own risk. For anything larger, the vault redemption path and the AMM's first
deposit need code changes, and the stack needs an external audit.
