# AUDITPREP.md — what an auditor needs, and what we already know

**This is not an audit.** Nobody independent has reviewed this code. What follows is the material a
reviewer would otherwise spend their first two days reconstructing: the trust model, the invariants
and where each is enforced, the sharp edges we already found, and the questions we could not settle
ourselves.

Read it as a self-assessment written to be *disproved*, not as assurance.

Scope: `contracts/{sr,yield,srmarket,srvault,srrouter}` plus the 3-line change to
`contracts/strategy` and one added function on the engine (`redeem_due_interest_to`).
State as of 2026-08-25: **478 tests green**, deployed and exercised on testnet.

---

## 1. The one-paragraph trust model

Users hand USDC to **SR**, which supplies it to Blend and issues a share token. The **yield engine**
splits SR into PT (principal, a bearer SAC) and YT (yield, a hook-bearing SEP-41 contract). The
**market** trades PT against SR on a time-decay curve. The **vault** holds PT as inventory and sells
fixed-rate receipts against it. The **router** composes all of that into single-signature USDC
flows — and is the one contract here with *no* privileges and *no* balances, by construction.

Admins can pause inflows, tune fees within on-chain ceilings, and schedule timelocked upgrades.
**Admins cannot** move user balances, mint unbacked PT/YT, drain reserves, or bypass the timelock.
Everything else is trustless: every exit path stays open while paused.

---

## 2. The invariants, and exactly where each is enforced

An auditor's fastest attack is to find a path that mutates state without passing one of these.

| # | Invariant | Enforced in | Test |
|---|---|---|---|
| **I1** | `sr_held >= pt_cover + total_accrued` | `yield::assert_solvent`, after **every** mutation | `the_contract_stays_solvent_across_a_full_lifecycle` |
| **I2** | No YT balance changes without settling both parties first | `yield::before_yt_change`, called from every mutation site | §3 below |
| **I3** | Stored market reserves ≤ real token balances | `srmarket::assert_sane`, after every mutation | `reserves_stay_backed_through_a_long_mixed_sequence` |
| **I4** | `vault.pt_inventory >= total_liability` | `srvault::assert_solvent` | `the_vault_stays_solvent_through_a_full_lifecycle` |
| **I5** | `SR::exchange_rate` is monotonic non-decreasing | high-water clamp in `Sr::live_rate` / `sync_rate` | `sr_exchange_rate_never_goes_down` |
| **I6** | PY index never decreases; frozen at expiry | `Yield::index_current` / `post_expiry_index` | `the_expiry_index_is_stamped_once_and_never_moves` |
| **I7** | Classic PT supply == `yield.total_py` | **NOT enforceable on chain** — see §5.1 | `sr_solvency_monitor.mjs` check 2 |
| **I8** | The router's balance of USDC/SR/PT/YT is 0 at the end of every entry point | `srrouter::assert_drained` | `the_router_holds_nothing_after_any_path` |

**I7 is the one an auditor should push hardest on.** It is the only invariant with no on-chain
enforcement, because a classic-asset issuer can mint outside the contract entirely.

---

## 3. `before_yt_change` — the most security-sensitive line

```rust
fn before_yt_change(env: &Env, from: &Address, to: &Address, index: i128) {
    interest::settle_two(env, from, tok::balance(env, from), to, tok::balance(env, to), index);
}
```

**The property:** no YT balance may change without both affected parties first being settled at the
current index. If a balance moves first, the settle measures the wrong principal — crediting a
seller for yield they no longer back, or a buyer for yield they never earned.

### Every balance-mutating path, enumerated by hand

| writer | callers | hook |
|---|---|---|
| `yt_mint` | `mint_py` | line above the mint, on the receiver |
| `yt_burn` | `redeem_py`, `burn`, `burn_from` | line above each burn, on the owner |
| `yt_move` | `transfer`, `transfer_from` | **inside** `yt_move`, both parties |

There is no other writer of a YT balance. `tok::set_balance` is called only from those three.

**Verify this yourself with:** `grep -n "tok::set_balance\|yt_mint\|yt_burn\|yt_move" contracts/yield/src/lib.rs`
— if that list ever grows without a matching hook, the property is broken.

### What we tested

`contracts/yield/src/test.rs`, section "SECURITY REVIEW":

* Settlement uses the balance held **before** the change — on the transfer, burn, recombine and
  mint paths separately (four tests, because they are four code paths).
* A second settle at an unchanged index credits nothing (the `ui.index == index` early return).
* Zero balances on both sides are safe.
* Total claims never exceed available backing under hostile interleavings.
* `accrued_between` does not overflow at 10M USDC of face over a year.

### What this review already found

`burn_from` delegated to the public `burn`, which calls `from.require_auth()` — so a spender with a
valid allowance still needed the **owner's** signature and no allowance was ever spendable. Fixed by
extracting `burn_checked` (no auth) and having each entry point establish authority its own way.
Pinned by `a_spender_can_burn_on_an_allowance_without_the_owners_signature`.

### The engine's new redirect — `redeem_due_interest_to`

Added so the router can claim a holder's yield and unwrap it to USDC in one transaction. The auth
split is the whole of its security surface:

```rust
if receiver != user { user.require_auth(); }
```

Paying a holder their own yield stays permissionless (it only ever moves value *to* them, so a
keeper can sweep dust claims). **Redirecting** it moves their value to a third party, so it requires
their signature. Note the check is on the *addresses*, not on who called — a caller cannot opt out
of it. Pinned by `redirecting_a_holders_yield_requires_the_holder_but_self_claim_does_not` and, from
the other side, `redirecting_someone_elses_yield_requires_their_signature` in the router suite.

**Please attack this specifically.** It is the newest privileged path in the engine.

### Where we would look next if we were the auditor

1. **The `settle` early-return.** `if ui.index == index { return 0 }`. Is there any way to make a
   holder's stored index equal the current index while their balance is stale?
2. **First-sighting semantics.** `ui.index == 0` means "never seen" and accrues nothing. Address `0`
   is not constructible in Soroban, but confirm no path can reset a live holder's index to 0.
3. **TTL eviction of a `UserInterest` entry.** It is bumped maturity-aware on every write, but a
   holder who never transacts across a very long term — is the bump horizon always sufficient?
   **We consider this the highest-residual-risk item in the engine.**
4. **`settle_two` aliasing.** Guarded by `if b != a`. Confirm the guard cannot be bypassed by an
   address that compares unequal but resolves to the same account.

---

## 4. Sharp edges we already hit (so you do not have to)

Four defects that were invisible in the local suite and only appeared on a live network. Each is
fixed with a regression test; each is a category worth re-checking elsewhere.

| # | Defect | Category |
|---|---|---|
| 1 | `buy_yt_exact_out` computed the user's payment from the live index; wallets sign against **simulation** amounts, so the authorization no longer matched at execution | **Any amount derived on-chain inside a user-authorized transfer.** Fixed by pulling `max_sr_in` and refunding. |
| 2 | `strategy::current_rate` wrote its RateBound only *conditionally*, so the transaction footprint depended on wall-clock timing between simulate and execute | **Any conditional write on a read path.** Fixed by making it unconditional and making `Sr::exchange_rate` a pure read. |
| 3 | Frontend `setupTrustlines` added v1's PT+YT for a v2 flow | **Asset identity reconstructed rather than recorded.** |
| 4 | A test-harness retry keyed on *empty output*, so a successful void-returning `transfer` was resubmitted and moved funds twice | **Retry logic keyed on output rather than exit status.** Called out because the same mistake in a frontend retry double-spends real funds. |
| 5 | `srrouter::buy_yt_with_usdc` fits the mainnet caps against the local Blend fixture and **fails on chain** with `Error(Budget, ExceededLimit)` | **Transaction budget measured against a fixture rather than the real pool.** Each leg succeeds alone; the combination does not. Four rounds of slimming did not close it. |
| 6 | A resumed deploy aborted with "the issuer is NOT locked", naming an account that had never issued anything — the lockdown burns the issuer identity, so the key name was regenerated and no longer resolved to the real issuer | **Asset identity reconstructed from parts instead of read from where it was recorded.** Same class as #3, one layer up. Fail-closed behaviour was correct; the account it checked was not. |

`mock_all_auths()` hides category 1 entirely, a single-ledger test host hides category 2, and a
lightweight Blend fixture hides category 5. An auditor should assume the local suite cannot see any
of them — and that a resource measurement taken against the fixture is an underestimate of unknown
size, not a bound.

---

## 5. Known limitations — please attack these

### 5.1 PT counterfeiting is prevented by an *operational* step, not by code

PT is a classic asset. Handing SAC admin to the engine governs the contract mint path and nothing
else: until the issuer's master key weight is set to 0, the issuer can mint PT with a plain payment.

**We demonstrated this on testnet**: the issuer minted 10 base units of PT out of thin air while
`yield.total_py` stayed put. After the lockdown the same payment failed `TxBadAuth`, and the engine's
own `mint_py` still worked (2,000,000,006 PT minted) — i.e. the lock closes the hole without
bricking the protocol.

**Residual risk:** the lockdown is a deploy-script step (`LOCK_ISSUER=1`) with two pre-flights, not a
contract invariant. If an operator skips it, nothing on chain notices. `sr_solvency_monitor.mjs`
check 2 is the compensating control, and it caught the counterfeit to the stroop.

**Question for the auditor:** is there a way to make this structural rather than procedural?

### 5.2 The `strategy` change is not byte-identical to the audited v1 build

Three lines: the RateBound write became unconditional. Our argument that this is safe:

> The old guard could only be false when `rate <= last_rate && now <= last_ts`. Ledger timestamps
> are non-decreasing and `last_ts` was a past `now`, so `now <= last_ts` implies `now == last_ts` —
> a second call in the **same ledger** with a non-rising rate. In exactly that case the new code
> writes `last_rate` unchanged and `last_ts = now == last_ts`: byte-identical values.

Pinned by `repeated_same_ledger_rate_reads_leave_the_bound_identical` and
`the_bound_still_advances_correctly_across_ledgers`. The *check* is untouched — the dip guards in
`wrapper::test_rate_brick` and `sr::test` still fire. Cost: 1 write entry, 636 bytes.

**Please verify this argument independently.** It is the only change to a contract shared with the
live v1 deployment.

### 5.3 Things we know are missing

* **YT is not transferable across a rate dip** — `Sr::sync_rate` and every value-moving path still
  revert when the strategy refuses to report (`tofix.md` #3). Only reads and `Sr::redeem` survive.
* **No secondary-reward handling.** SY standardizes `claimRewards`; SR does not. Blend's BLND
  emissions are unclaimed.
* **No limit-order book.** (The router/zap gap is closed — `contracts/srrouter`.)
* **The router's `assert_drained` is strict.** A donation arriving mid-transaction reverts the
  route. Deliberate — the router declines to be a custodian even briefly — but it means a stranger
  can grief individual transactions for the cost of a dust transfer, until `sweep` is called. We
  judged a self-inflicted revert better than a silent custody window; a reviewer may disagree.
* **The market's `assert_sane` is one-sided** (actual ≥ stored). A donation inflates the actual side
  and is not recoverable. Deliberate — but worth a second opinion.
* **Path dependence in the curve** — slicing a 50k trade gains up to +0.53% versus one trade. We
  proved a sliced *round trip* still loses and LP value rises, but the property is real.

---

## 6. Reproducing everything

```bash
cd website/contract/spield
cargo test --workspace                          # 478 green
cargo build --release --target wasm32v1-none    # 9 binaries, no warnings

# the security-critical suites, with output
cargo test -p spield-yield  -- --nocapture settlement_uses_the_balance
cargo test -p spield-srvault -- --nocapture tofix18
cargo test -p spield-srmarket -- --nocapture economics_test
cargo test -p spield-strategy -- --nocapture the_unconditional_write
cargo test -p spield-srrouter -- --nocapture the_only_thing_a_pt_buyer_signs

# the live deployment
./scripts/test_sr_testnet.sh                    # 34 live workflow checks
node scripts/sr_solvency_monitor.mjs --state scripts/deploy_sr_testnet.state --once
```

Testnet addresses and the full deployment history: [`TESTNET_SR.md`](./TESTNET_SR.md).
Architecture and design rationale: [`srstack.md`](./srstack.md).
Comparison against Pendle, with measurements: [`comparependle.md`](./comparependle.md).

---

## 7. What we would want an audit to cover, in priority order

1. **`before_yt_change` and the interest ledger** (§3) — the four open questions especially.
2. **The auth model across contract boundaries** — every `authorize_as_current_contract` call site.
   There are six, and each grants a narrowly-scoped nested transfer. Category-1 bugs live here.
3. **Rounding direction throughout.** We floor everywhere and reserve explicit dust buffers
   (`SOLVENCY_SLACK = 10`, `REDEEM_DUST = 2`). Are those bounds actually sufficient, or merely
   sufficient for the sizes we tested?
4. **The curve math** (`srmarket/curve.rs`) — `exp`/`ln` fixed-point error bounds, and whether the
   3-iteration fixed-point solve always converges.
5. **The governance surface** — particularly that shortening a timelock cannot accelerate an
   already-scheduled upgrade (we test this; please try to break it).
6. **Economic soundness** of the fee/anchor calibration (`economics_test.rs`), which is our own
   analysis and has had no outside scrutiny at all.
