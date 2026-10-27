# Isolated RWA accounting prototype

**Public-testnet execution completed on 27 October:** the same contracts were deployed with genuine sandbox USTRY, and the lifecycle, falling/stale price checks, yield allocation, maturity and in-kind payouts completed. Provider on/offramps and both USDC swaps also settled. See [execution evidence](executed-sandbox-tests-2026-10-27.md). The local mock-token instructions below remain available for repeatable development.

The local test harness is a runnable Soroban experiment using a freely minted test asset and an admin-controlled oracle, without Etherfuse credentials or funds. It is separate from the existing Blend strategy and PT/YT engine. A subsequent public-testnet run replaced the mock token with genuine sandbox USTRY; that execution is recorded separately above.

## Run it now

From the repository root (`v1`):

```sh
cd website/contract/spield
cargo test --offline --locked -p spield-rwa-prototype
```

The dependencies are already installed in this workspace. On a fresh machine, omit `--offline` for the first dependency download. The fixtures generate throwaway identities, mint a local Stellar Asset Contract token, and advance the simulated ledger clock automatically. They never read `.env` or submit a transaction to a public network.

To see the example lifecycle and its amounts:

```sh
cargo test --offline --locked -p spield-rwa-prototype full_lifecycle -- --nocapture
```

To build both deployable WASM artifacts and run the additional test against their compiled bytecode:

```sh
cargo build --offline --locked --release --target wasm32v1-none -p spield-rwa-prototype -p spield-rwa-mock-oracle
cargo test --offline --locked -p spield-rwa-prototype --features wasm-tests
```

Rebuild the WASM after changing either contract before running `wasm-tests`; that feature reads the release artifacts from this workspace's default `target` directory. The `wasm32v1-none` target is installed here; the [Stellar setup guide](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup) explains installation on another machine.

## What is implemented

- [RWA series contract](../../contracts/rwa-prototype/src/lib.rs): token custody, unsplit receipts, dollar-accounted PT/YT balances, transfers, yield claims, paired exits and maturity settlement.
- [Controlled oracle contract](../../contracts/rwa-mock-oracle/src/lib.rs): a separate admin-authorized fixture with immutable asset/base/precision metadata and append-only observations. It deliberately accepts bad prices and future dates so consumer rejection can be tested. **It is unsuitable for real funds.**
- [Scenario tests](../../contracts/rwa-prototype/src/test.rs): local SAC minting, authorization, ledger time, economic outcomes, failed-call rollback, token conservation and optional compiled-WASM integration.

**Receipts, PT and YT are internal contract balances in this first accounting experiment. They are not standalone SEP-41 tokens and will not appear as separate assets in a wallet or AMM.** PT and YT have independent transfer functions; YT transfers settle both parties before moving the balance. Turning these ledgers into interoperable tokens and connecting Spield's UI/router are later integration work.

## Lifecycle and accounting units

| Quantity | Unit |
|---|---|
| Deposit, unsplit receipt, payout | Backing-token units, 7 decimals |
| PT and YT face | USD units, 7 decimals |
| Oracle price | USD per whole backing token, 8 decimals |
| Oracle timestamp and expiry | Unix seconds |
| Inverse high-water allocation factor | Token units per USD face, scaled by `10^18` |

The following prices are deliberately large artificial moves for easy verification; they are not USTRY yield estimates.

1. The fixture mints **100 mock tokens** to Alice. At **$1.25/token**, they are worth **$125**.
2. `deposit(owner, 100 tokens)` transfers custody and credits 100 unsplit receipts.
3. `split(owner, 100 receipts, min_face)` creates **$125 PT face and $125 YT face**. These are two rights over the same backing, not $250 of assets: PT owns the principal allocation and YT owns eligible appreciation.
4. The oracle publishes **$1.5625/token**. `claim_yield(owner)` pays **20 tokens**, worth $31.25 at that price. The remaining 80 tokens are worth the $125 principal face.
5. Alice can transfer the PT to Bob while keeping YT. Before expiry, redemption requires matching PT and YT. After finalization, Bob can redeem his PT alone for **80 tokens**.
6. Total payouts are exactly **100 tokens**, equal to the original deposit. A second yield claim pays zero.

`value_usd(amount)` uses the fresh current NAV; it does not use the high-water mark. A stored `state()` snapshot is not a freshness guarantee.

The allocation factor is the rounded-up inverse of the highest accepted NAV, with conservative rounding on new face, earnings and payouts. New holders settle at the current factor so they cannot receive earlier holders' yield. Rounding dust stays in the series; there is no admin sweep in this experiment.

## Loss and maturity policies being tested

**PT has nominal USD face, not guaranteed dollar redemption.** If 100 tokens were deposited at $1.25 and NAV falls to $1, their $125 PT face can redeem into 100 tokens worth $100. The contract never manufactures 25 extra tokens. Previously allocated yield remains denominated in tokens and also changes in dollar value. This model does not give YT a first-loss obligation or claw back previously paid yield.

The accrual factor only changes above the previous NAV high. A recovery below that high earns no new yield. New splits are blocked while current NAV is below the high; unsplit receipts can still be returned.

Maturity uses a discrete observation policy, rather than interpolating the existing Blend rate:

- Process the append-only history through expiry, preserving any earlier peak even if no series call happened at that peak.
- Include an observation exactly at expiry; exclude later prices from YT accrual.
- Require history reaching at least expiry to establish that the last pre-expiry record cannot be replaced by a subsequently appended backdated entry.
- Require that last observation at/before expiry to be within `max_age` of expiry. A delayed keeper can finalize from retained history without assigning post-expiry gains to YT.
- Freeze the token allocation once. Thereafter PT redemption and remaining YT payouts need no live price. Further appreciation or losses change the USD value of the fixed token allocations, rather than continuously resizing PT's token payout to maintain its USD face.

This maturity policy is an explicit prototype choice requiring product review; it is not a claim that the existing Spield maturity semantics have been preserved.

## Failure behavior and limits

| Scenario | Expected result |
|---|---|
| Stale price before finalization | Split, YT transfer, yield claim, paired redemption and USD valuation fail without consuming claims |
| Unsplit receipt withdrawal during an oracle outage | Returns the original token quantity, provided the token transfer itself remains permitted |
| Missing post-expiry coverage | Finalization waits; no guessed expiry price |
| Stale observation at the expiry boundary | Finalization fails; the experiment has no emergency settlement override |
| Oracle outage after finalization | Frozen token payouts still work |
| Zero/negative price, future timestamp or milliseconds supplied as seconds | Consumer rejects the observation |
| Wrong oracle token, currency or precision | Constructor rejects configuration |
| Issuer freezes the series' SAC balance | Payout fails atomically, retaining claims; unfreezing permits retry |
| Issuer claws back part of the backing | Custody check rejects partial payouts atomically; claims remain recorded but no recovery or haircut settlement is implemented |
| Failed slippage check or missing authorization | No balance or custody change |

The series can remain unable to settle split claims if valid maturity history never becomes available. There is no unilateral oracle-free split-claim escape, loss socialization mechanism or recovery from issuer clawback. Tests establish only the listed behaviors; they do not establish a production-ready reliable exit.

The controlled history is capped at **256 observations**, with no pruning or adapter migration. Ledger storage uses TTL extensions but production restoration/keeper operations have not been implemented. Pricing bounds, production oracle governance, audits, fees, real issuer permissions, standalone tokens, frontend integration and USDC conversion are outside this milestone.

## Repeat with genuine sandbox USTRY

After Etherfuse supplies test tokens or a working acquisition route:

1. Activate a dedicated Stellar testnet wallet and establish the exact sandbox USTRY trustline. Confirm the allocation arrives in that wallet. Do not use production funds or copy the Solana mint into Stellar configuration.
2. Use the verified testnet USTRY SAC `CCUGMX7HX6CH6T4XNPALQ7HCVU37RLUNHAYNSAIALTPFHFQVIRIHALBC` and recheck its identity/decimals against discovery. The issuer asset is `USTRY:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4`.
3. Deploy a **new** controlled oracle bound to that SAC, USD and 8-decimal prices, then a **new** series bound to the same token and oracle. No configuration switch modifies the existing Blend contracts. Use clearly labeled sandbox valuations; mainnet and sandbox NAVs have differed in our observations.
4. Repeat the lifecycle using a small genuine token allocation, signed transactions and a short experimental maturity. Record each transaction, wallet balance and custody reconciliation. The mock token mint step is replaced by Etherfuse's allocation; the controlled oracle remains a testing component.
5. Separately build and verify a provider-oracle adapter. This prototype expects `asset/base/decimals/observations`, which is **not** the raw RedStone SEP-40 interface. An actual adapter needs retained maturity observations and a reviewed update/freshness policy. Changing the oracle address alone is insufficient.
6. Run a separate actual Etherfuse redemption or executable sale for the token returned to the user. Record proceeds, fees, timing, eligibility and failure cases. A successful contract payout into USTRY does not prove USTRY can be redeemed for cash or USDC.

The WASM contracts have now been deployed and exercised on public testnet, and separate provider sandbox round trips completed. Live oracle integration and production implementation/terms remain independent acceptance conditions. The provider has expressed support for Spield-managed pooled holdings and its own token issuance.

## Verification completed

| Check | Result |
|---|---|
| Local scenario tests | 26 passed |
| Scenarios plus `--features wasm-tests` | 27 passed, including the compiled series and oracle communicating through the Soroban host |
| Release build for `wasm32v1-none` | Both contracts built successfully |
| WASM interface inspection with Stellar CLI | Unique function and type names verified; series exposes 13 functions, fixture oracle 6 |
| Clippy, both crates, all targets/features, warnings denied | Passed |
| Rust formatting and working-tree whitespace checks | Passed |

The local lifecycle conserves deposited tokens, and the fractional multi-user scenario reconciles payouts plus residual dust. Those automated tests use SDK-hosted execution, including one compiled-WASM scenario. The separate [public-testnet run](executed-sandbox-tests-2026-10-27.md) adds genuine-token custody and settlement evidence; neither establishes production capacity or economics.
