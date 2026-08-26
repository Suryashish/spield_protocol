# V2 Remaining Work: What Is Wrong, Why It Matters, and How to Fix It

This document turns the open **v2** findings in [`tofix.md`](./tofix.md) into an implementation-oriented work list. It intentionally excludes work that applies only to the old v1 deployment.

Verification basis: 2026-08-26.

## Scope

The v2 work falls into four groups:

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
| P1 | Reject liquidity additions that mint zero LP shares | Contract fix |
| P1 | Add caller-controlled protection to `add_liquidity` | Contract/API fix |
| P1 | Make `srvault` redemptions resumable | Contract fix |
| P1 | Allow safe recovery of surplus SR, YT, and USDC | Contract fix |
| P1 | Make the monitoring scripts independently runnable | Operations fix |
| P1 | Reconcile the permanent 11-stroop PT alarm | Operations fix |
| P2 | Add TTL keep-alive helpers to the SDK | SDK fix |
| P2 | Add the complete `srvault` interface to the SDK | SDK/product fix |
| P2 | Repair the documented pnpm test command | Tooling fix |
| Decision | Calibrate the redemption-liquidity haircut | Risk parameter |
| Decision | Calibrate the Blend utilization alert | Monitoring parameter |
| Decision | Calibrate `scalar_root` | Market parameter |

---

## 1. Choose and apply an SR deposit cap

### What is wrong

The v2 SR contract already supports an on-chain deposit cap, but the live testnet value is `0`. In this contract, `0` means **uncapped**.

The strategy has a known failure mode: if Blend's backing rate falls far enough below the principal obligation, reads can continue to work while every state-changing operation fails with `SolvencyViolation`. Tests reproduced this with a 12% backing haircut. Full, partial, and very small withdrawals all failed, so withdrawing a smaller amount does not escape the problem.

### Example

Assume users have deposited 5,000,000 USDC and the strategy suffers a sufficiently deep backing loss:

```text
Withdraw 100,000 USDC -> SolvencyViolation
Withdraw   1,000 USDC -> SolvencyViolation
Withdraw       1 USDC -> SolvencyViolation
```

The failure can freeze the whole deposited amount.

### How to address it

Choose a maximum acceptable exposure and set it through `Sr::set_deposit_cap`. Also set `SR_DEPOSIT_CAP` in the deployment configuration so future deployments do not silently return to an uncapped state.

For example, if governance decides the maximum initial exposure is 100,000 USDC:

```text
SR_DEPOSIT_CAP=100000 USDC
```

That number is only an example. The real value must be based on the project's loss appetite.

### Why it must be done

The cap does not prevent a deep-rate failure and does not repair withdrawals after one occurs. It limits how much user money can be exposed while loss allocation remains unresolved. This is the most important pre-launch v2 decision.

### Acceptance criteria

- A non-zero cap has been approved and documented.
- The value is applied on-chain and read back successfully.
- The deployment configuration contains the approved value.
- Deposits above the remaining headroom revert.
- Redemptions continue to work even if the cap is later lowered below existing TVL.
- Monitoring reports the cap, total assets, and remaining headroom.

---

## 2. Reject liquidity additions that mint zero LP shares

### What is wrong

The first-LP branch of `srmarket::add_liquidity` verifies that the calculated share amount is positive. The follow-on LP branch does not.

After trading fees change the relationship between pool reserves and total shares, a sufficiently small deposit can calculate zero new LP shares. The ratio check still passes, the user's PT and SR are transferred, and the user receives no LP ownership.

### Reproduced example

After ordinary swaps grew reserves relative to total LP shares:

```text
PT reserve:    4,792,577,961,655
SR reserve:    5,199,710,318,777
Total shares:  5,000,000,000,000

add_liquidity(1 PT unit, 1 SR unit)
-> PT and SR transferred
-> 0 LP shares minted
```

### How to fix it

Calculate the share result before either token transfer and reject a non-positive result in every branch:

```rust
if shares <= 0 {
    panic_with_error!(&env, Error::InvalidAmount);
}
```

The exact code placement matters: the check must run before transferring PT or SR.

### Why it must be fixed

A successful liquidity deposit must always give the depositor pool ownership. Taking assets for zero shares breaks that invariant, creates silent dust losses, and can confuse applications that treat a successful transaction as proof that liquidity was minted.

### Test work

The existing audit test uses a pool that has never traded. In that state, one unit still produces one share, so it does not reproduce the defect.

The corrected regression test must:

1. Seed a pool.
2. Perform swaps so fees grow the reserves relative to total shares.
3. Submit a dust liquidity addition that would calculate zero shares.
4. Assert that it reverts with `InvalidAmount`.
5. Assert that the user's PT and SR balances are unchanged.
6. Assert that pool reserves and total shares are unchanged.

---

## 3. Add caller-controlled protection to `add_liquidity`

### What is wrong

`srmarket::add_liquidity` currently requires the deposit to match the live pool ratio within a hardcoded band of about 0.1%. It does not accept `min_shares` or another caller-selected tolerance.

The pool ratio can change after a user calculates the deposit but before their transaction executes. A swap that lands first can therefore make an otherwise correct liquidity transaction revert.

This is a liveness and denial-of-service problem. The strict ratio check prevents a bad fill, so the LP's principal is not extracted, but the transaction fails and the LP wastes fees and time.

### Example

Start with:

```text
Pool reserves: 500,000 PT / 500,000 SR
LP prepares:     1,000 PT /   1,000 SR
```

Before the LP transaction executes, another transaction swaps roughly 1% of the pool. The live reserve ratio moves outside the fixed 0.1% band, and the prepared liquidity addition reverts. The LP has no argument that allows a wider acceptable outcome.

### Preferred fix

Add a caller-supplied minimum share result:

```rust
add_liquidity(..., min_shares)
```

The contract should:

1. Calculate shares using current reserves.
2. Reject zero shares as described in the previous item.
3. Revert with `SlippageExceeded` when `shares < min_shares`.
4. Otherwise transfer the assets and mint the calculated shares.

An alternative design is to accept maximum PT and SR inputs, consume only the correct ratio, and refund the unused leg. If that design is selected, both maximum inputs must bind and all refunds must be tested.

### Why it must be fixed

The user should decide the acceptable result for their transaction. A fixed global ratio band makes legitimate liquidity additions easy to disrupt and cannot reflect different users' deadlines, transaction sizes, and risk tolerances.

### API and compatibility work

Changing `add_liquidity` requires coordinated updates to:

- The contract interface.
- Any router call sites.
- The TypeScript SDK.
- Frontend transaction construction.
- Tests and deployment artifacts.

### Test work

The existing audit test checks `remove_liquidity`, which does not cover this defect. New tests should cover:

- A reserve-changing swap followed by `add_liquidity`.
- Success when calculated shares meet `min_shares`.
- `SlippageExceeded` when calculated shares fall below `min_shares`.
- No asset movement on failure.
- The boundary case where calculated shares exactly equal `min_shares`.
- Zero-share rejection even when `min_shares` is zero.

---

## 4. Make `srvault` redemptions resumable

### What is wrong

`Sr::redeem_partial` can redeem as much as venue liquidity permits and burn only the shares actually redeemed. `srvault::redeem`, however, still requires the entire receipt payout to be collected in one call.

Its current shape is effectively:

```rust
let got = sr.redeem(...);
if got < receipt.payout {
    panic_with_error!(&env, Error::WithdrawShortfall);
}
```

If only part of the payout can be collected, the transaction reverts, the receipt remains open, and no progress is stored.

### Example

```text
Receipt payout:                  1,000 USDC
Amount currently collectable:     920 USDC

Current result:
User receives:                       0 USDC
Receipt remains open:                    yes
Progress saved:                          no
```

The user must wait until all 1,000 USDC can be obtained atomically.

### How to fix it

Use a resumable receipt design. Add a `collected` field to each receipt and bank successful partial collections against it.

Example flow:

```text
First redeem call:
  collect 920 USDC
  receipt.collected = 920

Second redeem call:
  collect 80 USDC
  receipt.collected = 1,000

Completion:
  pay the receipt holder
  close the receipt
  update liabilities exactly once
```

The final design must define where partially collected assets are held, who can continue the receipt, and when the user is paid. The approach in `tofix.md` is to bank collections and pay only when `collected >= payout`.

### Why it must be fixed

Partial venue liquidity is useful. Discarding partial progress can keep receipt holders stuck even when most of their payout is available. Resumable collection also reduces the chance that every retry fails because full liquidity is never available at one instant.

### Required safety properties

- A partial attempt never over-collects beyond the receipt's remaining payout.
- The same receipt cannot be paid twice.
- `collected` only increases by assets actually received.
- Failed calls do not corrupt `collected`, liabilities, or ownership.
- Receipt transfer semantics remain correct while funds are partially collected.
- The vault cannot sweep assets reserved for a partially collected receipt.
- The final payout and receipt closure are atomic.
- TTL bumping covers receipts that remain open across several collection attempts.

---

## 5. Allow safe recovery of surplus SR, YT, and USDC

### What is wrong

`srvault::sweep` can recover surplus PT, subject to a liability gate. It cannot recover other tokens owned by the vault.

A complete lifecycle test left the following inventory after all liabilities were settled:

| Asset | Remaining amount | Recoverable today? |
|---|---:|---|
| PT | 20,196.7086960 | Yes |
| SR | 248.5274157 | No |
| YT | 21,246.7086962 | No |
| USDC | 0.0000001 | No |

### Why these assets remain

- **SR:** post-expiry `harvest` correctly remains available, but `mint_py` refuses to mint new PT/YT after expiry. The harvested SR is therefore parked in the vault.
- **YT:** the vault still owns YT after expiry. It may be economically dead, but it remains token inventory.
- **USDC:** redemption rounding can leave a one-stroop remainder, which may accumulate across receipts.

In the measured run, 248.5274157 SR represented real value of about 1.2% of the seed and had no exit path.

### How to fix it

Two reasonable approaches are described in the source finding:

1. Extend sweeping with a function such as `sweep_token(to, token, amount)`, applying a safe capacity rule for each supported asset.
2. Change post-expiry harvesting so harvested SR is unwrapped to USDC, then provide a safe way to sweep surplus USDC.

The PT liability gate is already stronger than originally requested. The new paths must preserve the same principle: no sweep may remove assets needed for open receipts, redemption buffers, or partially collected receipts.

### Why it must be fixed

SR and USDC are real protocol value. Without a recovery path, treasury assets and operational remainders can become permanently inaccessible. The lack of a cleanup path also makes accounting and incident recovery harder.

### Acceptance criteria

- Surplus SR can be recovered after all applicable liabilities are protected.
- Surplus USDC can be recovered without touching receipt backing.
- YT can be removed under an explicitly documented maturity/liability rule.
- Unauthorized callers cannot sweep.
- Sweeping at or above reserved capacity reverts.
- Partial receipt collections are included in reserve accounting.
- A full lifecycle test finishes without inaccessible valuable inventory.

---

## 6. Make the monitoring scripts independently runnable

### What is wrong

The monitoring scripts import `@stellar/stellar-sdk`, but `scripts/` has no package manifest or local dependency installation. Running the v2 monitor as documented fails before any protocol check runs:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@stellar/stellar-sdk'
```

Copying the scripts beside an unrelated `node_modules` directory is only a workaround and is not an operational setup.

### How to fix it

Add a reproducible package definition for the monitor scripts, including:

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

## 7. Reconcile the permanent 11-stroop PT alarm

### What is wrong

The issuer-lockdown rehearsal deliberately created 11 stroops of counterfeit PT. The v2 watchtower correctly detects that classic PT supply exceeds the yield engine's `total_py` by 11.

As a result, every run is permanently red:

```text
PT supply - engine total_py = 11 stroops
```

### How to fix it

Use one of these explicit reconciliation paths:

1. Burn the 11 excess stroops and restore exact conservation.
2. Record a signed baseline offset of 11 and alarm on any difference beyond that exact baseline.

Do not widen the check with an arbitrary tolerance. Exact conservation is what makes this probe useful.

Example with a baseline:

```text
Observed difference:    11
Approved baseline:      11
Unexpected difference:   0 -> healthy

Later observed:         21
Approved baseline:      11
Unexpected difference:  10 -> alarm
```

### Why it must be fixed

A permanently red monitor causes alert fatigue and can hide a real future counterfeit mint behind a known discrepancy. Healthy operation needs a clean, meaningful baseline.

### Acceptance criteria

- The reconciliation choice is documented and auditable.
- Normal testnet state reports healthy.
- A one-stroop change above the reconciled baseline triggers an alarm.
- The monitor prints both the raw difference and any approved offset.

---

## 8. Add TTL keep-alive helpers to the SDK

### What is wrong

Soroban storage entries have a time-to-live. The contracts provide `srvault::bump_receipt` and `yield::bump_holder` so long-dated state can be kept alive, but `frontend/src/lib/srstack.ts` does not expose either operation.

The mechanism exists on-chain, but shipped client code never calls it.

### Example

A user opens a position that matures in one year and does not interact with it for several months. If its storage entry archives before maturity, the normal application may be unable to read or operate it without a restoration flow.

### How to fix it

Add typed helpers such as:

```ts
bumpVaultReceipt(receiptId)
bumpYieldHolder(holder)
```

Define when the application calls them, for example when creating a position, when loading state close to its TTL threshold, and before important maturity or redemption operations.

The SDK should expose enough information for the caller to decide whether a bump is required and avoid pointless transactions when TTL is already sufficient.

### Why it must be fixed

Long-dated financial positions must stay accessible through maturity. Contract functions alone do not solve this if no supported client invokes them.

### Acceptance criteria

- Both bump functions are available through typed SDK methods.
- Tests verify the correct contract, account/receipt, and transaction arguments.
- The application has a documented keep-alive policy.
- Failure and restoration guidance is documented.

---

## 9. Add the complete `srvault` interface to the SDK

### What is wrong

The fixed-rate vault is deployed on v2 testnet but has no supported client surface. The application cannot use normal typed SDK calls for vault deposits, quotes, receipt reads, redemption, statistics, or harvesting.

The product exists on-chain but is effectively unavailable to the shipped application.

### How to fix it

Add a typed `srvault` client covering at least:

- `deposit`
- `redeem`
- Quote/read methods
- Receipt lookup and ownership
- `stats`
- `harvest`
- `bump_receipt`
- Transaction simulation and submission
- Contract error decoding

If resumable redemption changes the receipt structure or redeem result, implement the contract fix first and design the SDK against the final interface.

### Why it must be fixed

Without a supported SDK, each frontend or integrator must manually construct Soroban transactions. That increases integration errors and prevents ordinary users from accessing a deployed product.

### Acceptance criteria

- Every intended user-facing vault operation has a typed SDK method.
- Read methods decode receipt and vault state correctly.
- Write methods simulate, expose fees, and submit transactions consistently with the rest of `srstack.ts`.
- Contract errors map to useful SDK/application errors.
- Unit tests cover successful calls, validation, and contract failures.
- A lifecycle integration test covers quote, deposit, receipt read, harvest, TTL bump, and redemption.

---

## 10. Repair the documented pnpm test command

### What is wrong

The SDK's tests pass when Vitest is invoked directly, but the documented command fails before tests begin:

```text
pnpm run test:unit
-> ERR_PNPM_IGNORED_BUILDS
-> esbuild build scripts were ignored
```

The verified direct Vitest run passes 218 tests, so the problem is the package-manager entry path rather than the unit tests themselves.

### How to fix it

Add the required pnpm configuration to `sdk/package.json`:

```json
{
  "pnpm": {
    "onlyBuiltDependencies": ["esbuild"]
  }
}
```

Then verify the documented workflow from a clean dependency installation.

### Why it must be fixed

CI and contributors must be able to trust the documented test command. A hidden direct-Vitest workaround can cause skipped validation or make a healthy test suite appear broken.

### Acceptance criteria

- A clean pnpm install succeeds without the ignored-build failure.
- `pnpm run test:unit` starts and passes the complete intended suite.
- CI uses the same command documented for contributors.

---

## 11. Calibrate the redemption-liquidity haircut

### What is wrong

`strategy::available_liquidity()` reports Blend's raw token balance. That is an upper bound: Blend may refuse a withdrawal that would push utilization beyond its allowed ceiling.

The current code applies a 1% safety haircut:

```text
LIQUIDITY_HAIRCUT_BPS = 100
```

The document records that 1% as an unmeasured guess.

### Example

If raw liquidity is 100,000 USDC, the protocol estimates that 99,000 USDC is safely redeemable. If Blend's utilization rule permits only 92,000 USDC, `max_redeemable()` remains too optimistic and a supposedly safe redemption can fail.

If Blend can actually release 99,900 USDC, the 1% haircut may be unnecessarily restrictive.

### How to address it

Measure, across representative utilization levels:

- Raw underlying balance.
- Maximum withdrawal accepted by Blend.
- Difference between the two.
- Behaviour close to Blend's maximum utilization.

Use those observations to choose a documented safety margin. Re-test if the selected Blend pool or its parameters change.

### Why it must be done

`max_redeemable()` should provide a useful pre-transaction bound. An optimistic bound still produces unexpected reverts, while an excessively conservative bound unnecessarily delays withdrawals.

---

## 12. Calibrate the Blend utilization alert

### What is wrong

The watchtower warns above 85% utilization. Its first live testnet run observed 85.4%, so it immediately warned.

It is not yet known whether 85% is a genuine danger zone or normal operation for this venue.

### How to address it

Relate utilization to actual withdrawal headroom, then choose meaningful warning and critical levels. A multi-stage alert may be more useful than one threshold, but its numbers must come from measurement rather than convenience.

Illustrative only:

```text
Below 85%: healthy
85%-90%: warning
Above 90%: critical
```

### Why it must be done

A threshold that is always active causes alert fatigue. Raising it without measuring the true liquidity danger point could instead hide an approaching redemption freeze.

### Acceptance criteria

- The selected threshold is tied to measured withdrawal headroom.
- Normal operation is not permanently alarming unless it is genuinely unsafe.
- Warning and critical messages explain the expected operator response.

---

## 13. Calibrate the market's `scalar_root`

### What is wrong

`scalar_root` controls how strongly trades move the market's implied yield. The live testnet value is 40.

Testing showed that a single 2,000 USDC buy, around 2% of the USDC side in the measured setup, moved the quote from approximately 4.990% to 4.406%. Six months later it remained around 4.361% because the fixed anchor does not automatically pull the quote back; it moves back only through opposing flow.

### Example

```text
Vault headline rate:       about 5.0%
Market implied rate after one moderate buy: about 4.4%
```

The market rate can therefore stop resembling the vault's headline rate after modest one-way demand.

### How to address it

Choose `scalar_root` against:

- Expected seed liquidity.
- Typical and large trade sizes.
- Expected balance of PT and YT flow.
- Maximum acceptable quote movement per trade.
- How far the market rate may reasonably diverge from the vault rate.

Run scenario tests for several trade sequences and times to maturity before selecting the deployment value.

### Why it must be done

If the curve is too sensitive, moderate trades cause large and persistent rate changes. If it is too insensitive, pricing may respond too slowly and require more liquidity to reflect demand and risk.

---

## Recommended implementation order

1. Approve and apply the deposit cap.
2. Fix zero-share liquidity additions and their regression test.
3. Add caller-controlled `add_liquidity` protection and update all call sites.
4. Implement resumable vault redemption.
5. Extend safe surplus recovery to SR, YT, and USDC.
6. Make the monitoring scripts reproducibly runnable.
7. Reconcile the 11-stroop PT baseline so normal monitoring is green.
8. Add TTL helpers to the SDK.
9. Add the final `srvault` contract interface to the SDK.
10. Repair and verify the documented pnpm test command.
11. Measure and approve the liquidity haircut, utilization thresholds, and `scalar_root`.
12. Rebuild, test, deploy, and verify the new contract code hashes and interfaces on-chain.

## Definition of done for the v2 work

The work in this document is complete when:

- All contract fixes have regression tests that reproduce the old defect and prove the new behaviour.
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
- Correcting the v1-only vault monitor probe.

The separate launch gates referenced by `tofix.md`—the mainnet parameter profile, audit decision, and `testcando.md` Appendix B—remain required but are not expanded here.
