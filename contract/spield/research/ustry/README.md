# USTRY feasibility: execution record

**GATAL issuer correction, 27 October:** the user was right that `USDC:GATAL...F5V56` can buy USTRY. We confirmed the browser-wallet transaction and executed an Alice round trip: **1 GATAL-USDC → 1.5177264 USTRY → 0.9935162 GATAL-USDC**. It routes through GBBD-USDC in a Stellar DEX path payment. The v1 Ramp API still returns 400 for GATAL as a direct source; that does not rule out the DEX route. Alice already had sufficient funds. See [proof and integration implications](gatal-usdc-route-resolution-2026-10-27.md). Circle's official testnet issuer is GBBD; prior "Etherfuse-issued" labeling was imprecise.

**Execution completed — 27 October 2026:** the local `alice425` wallet is now registered under Spield's sandbox organization with the exact trustlines. A simulated 100-MXN purchase delivered 4.8602504 USTRY; a 1-USTRY MXN redemption and both USDC swap directions settled. Fresh Soroban contracts completed the genuine-USTRY lifecycle through maturity, falling/stale prices, claims and full token reconciliation. See [executed tests, transaction links and remaining work](executed-sandbox-tests-2026-10-27.md). Existing other-issuer USDC was rejected; usable test funds are now held in the registered local wallet.

**Provider reply received by the user:** Etherfuse has offered Stellar testnet USTRY allocations, engineering help for an exit, and support in principle for a Spield-managed pooled PT/YT structure. Our probes used **v1 `/ramp/quote`**, so the reported incomplete Stellar v2 rollout is not a confirmed explanation for their failures. See the [response assessment and reply draft](provider-response-review.md), including why Etherfuse's yield-retaining principal token is not automatically a replacement yield source.

**Local development runbook:** see [prototype.md](prototype.md) for repeatable mock-asset tests, accounting policies and scope. The subsequent genuine-token public-testnet deployment and provider settlement evidence are in [the execution report](executed-sandbox-tests-2026-10-27.md).

Last mainnet oracle verification: **25 October 2026, 19:21 IST**. Full results: [oracle-observation.json](oracle-observation.json). Later sandbox, prototype and provider-response checkpoints are recorded separately below.

## Current decision

**The sandbox access and execution milestone passes.** Genuine USTRY receipt, MXN on/offramp execution, both USDC swaps and a short-lived Soroban accounting series have been demonstrated. The [earlier 424 failures](sandbox-results.md) are historical. Etherfuse identifies Spield as the purchasing/redeeming customer and permits pooled contract holdings and token issuance in between. The prototype still uses controlled prices and internal PT/YT balances: live valuation integration, interoperable tokens, reviewed product semantics, production economics and application integration remain work to complete. See [the execution report](executed-sandbox-tests-2026-10-27.md).

**Historical setup clarification:** the [25 October follow-up](sandbox-setup-next-steps.md) and [27 October quote-only checkpoint](liquidity-fix-recheck-2026-10-27.md) recorded earlier wallet/funding gaps. They are superseded by the executed tests: a locally signable wallet, exact trustlines and a compliant sandbox bank fixture are now prepared. Correct sandbox identifiers were already used in the original API probes.

**Historical Stellar confirmation, 25 October, 20:31 IST:** USTRY was listed for Stellar and direct testnet SAC reads returned `symbol=USTRY`, `decimals=7`; quotes then returned 424. See [availability evidence](sandbox-availability-recheck.md). The URL's Solana mint does not mean the product is Solana-only. Quote failures are superseded by the 27 October successful checks.

| Requested step | Evidence and status |
|---|---|
| 1. Identify and read the actual oracle | **Verified:** provider deployment references, mainnet network identity, exact USTRY asset mapping, USD base, decimals, live/direct prices, timestamps, retained history and historical lookup. |
| 1. Confirm pricing methodology | **Partially verified:** contract plumbing and public price comparison inspected. Exact upstream source composition, NAV effective-time semantics and source-to-deployed-bytecode matching require provider assurance. |
| 2. Confirm redemption and product access | **Sandbox execution verified:** Spield's registered local organization wallet acquired genuine USTRY and completed MXN redemption and both USDC swap directions. Operating model clarified; production-specific economics/terms remain separate. |
| 3. Isolated testnet prototype | **Public testnet lifecycle completed:** genuine USTRY custody, dollar PT/YT accounting, falling/stale prices, claims, maturity and in-kind payout conserve the deposited tokens. Controlled oracle and internal claim ledgers remain prototype limitations. |
| 4. USDC conversion | **Both mechanisms sampled:** provider Ramp swaps settled using GBBD-USDC, and a direct DEX round trip settled using GATAL-USDC via GBBD. Input issuers and route/provider dependencies must remain explicit; production capacity is not established by these samples. |

This checkpoint does not establish a reliable cash exit. In-kind token return, primary redemption and secondary sale are separate mechanisms with different failure conditions.

## 1. Exact mainnet deployments

| Component | Address |
|---|---|
| USTRY token SAC | `CBLV4ATSIWU67CFSQU2NVRKINQIKUZ2ODSZBUJTJ43VJVRSBTZYOPNUR` |
| Direct RedStone USTRY price feed | `CAEGYZFAJ3HLSDBUIVJ77SK5HLLS4MPE4LO5OB2W3L2TEDMAS6RCTMZ4` |
| RedStone multi-feed adapter | `CA526Y2NQWGWVVQ7RFFPGAZMU66PSYJ3UC2MTVAV4ZU7OM5BOPHDXUSG` |
| RedStone SEP-40 wrapper | `CBMGLKUQZVSAIL5CPDDAWSUY7MAKXISHMOZEVLMBUWBMFGHRJSR4WYRF` |

The probe checks the oracle addresses against a pinned RedStone repository commit and its relayer manifests, and the token SAC against Horizon's genuine `USTRY` + issuer asset record. It also reads the SEP-40 `AssetToFeed` storage mapping to verify that the exact SAC maps to `USTRY`.

Provider source commit: `1c2c0da53ea8607f6dc1caa8cd95dc8f0fe3c8be`.

Primary references: [USTRY deployment](https://github.com/redstone-finance/redstone-oracles-monorepo/blob/1c2c0da53ea8607f6dc1caa8cd95dc8f0fe3c8be/packages/stellar-connector/deployments/stellarMultiFeed/redstone_price_feed-USTRY-id.mainnet), [SEP-40 deployment](https://github.com/redstone-finance/redstone-oracles-monorepo/blob/1c2c0da53ea8607f6dc1caa8cd95dc8f0fe3c8be/packages/stellar-connector/deployments/stellarMultiFeed/redstone_sep_40-id.mainnet), [relayer manifest](https://github.com/redstone-finance/redstone-oracles-monorepo/blob/1c2c0da53ea8607f6dc1caa8cd95dc8f0fe3c8be/packages/relayer-remote-config/main/relayer-manifests-non-evm/stellarMultiFeed.json).

## 2. Live observation

The recorded run completed at **19:21:00 IST**, with read simulations reporting ledgers around **65130092**. The ledger referenced in the evidence closed at **19:20:43 IST**. Individual reads are retained with their own reported ledger; this is not an atomic historical snapshot.

| Check | Observed result |
|---|---|
| Network | Public Stellar mainnet passphrase verified through RPC |
| Feed ID | `USTRY` |
| SEP-40 base | `Other(USD)` |
| Direct and SEP-40 decimals | `8` |
| Direct raw price | `107815400` |
| SEP-40 raw price | `107815400` |
| Oracle USD value per whole USTRY | **1.07815400** |
| Etherfuse public token-cost USD value | **1.07816100** |
| Absolute difference / issuer value | **0.064925 basis points**, approximately **0.00064925%** |
| Package timestamp | `1792930250000` milliseconds |
| SEP-40 timestamp | `1792930250` seconds = **25 October, 17:40:50 IST** |
| Write timestamp | `1792930258000` milliseconds |
| Package-to-write delay | **8 seconds** |
| Oracle age at assessment | **6,010 seconds**, approximately **1h 40m** |
| Published/live resolution | **43,200 seconds**, or **12 hours** |
| Exact historical lookup | `price(asset, 1792930250)` reproduced the same sampled price and timestamp |

The direct feed is not the SEP-40 interface: it exposes `read_price_data()` with a `U256` price and millisecond timestamps. The wrapper exposes `lastprice(Asset)` and seconds. An implementation that mixes these timestamp units can silently defeat freshness checks.

The NAV comparison used [Etherfuse's public USTRY token-cost endpoint](https://api.etherfuse.com/lookup/tokens/cost/ustry), documented in its [price-feed guide](https://docs.etherfuse.com/price-feeds). The response is an issuer-published token cost/NAV proxy. This comparison does not independently audit reserves, prove price independence or establish a firm redemption quote. `current_time` is the API response time; FX-provider `updated_at` fields do not prove the underlying bond NAV's effective valuation time.

## 3. Update behavior and retained history

RedStone's pinned USTRY relayer overrides specify a **0.1% deviation trigger** and a **43,200,000 ms / 12h heartbeat**. The retained live history was consistent with that intended cadence, with some additional updates.

Ten records were returned even though the probe requested twenty. They were chronological, oldest first. The first two and latest observations were:

| Time (IST) | Raw price at 8 decimals |
|---|---|
| 22 October, 15:08:40 | `107782600` |
| 22 October, 15:13:50 | `107782700` |
| 25 October, 17:40:50 | `107815400` |

The largest retained interval was **43,210 seconds**, ten seconds beyond the configured heartbeat. A heartbeat is an update target, not a hard delivery guarantee. `resolution()` is not an assurance that every price timestamp lands on a perfectly aligned 12-hour boundary.

The probe uses a **13-hour research freshness tolerance**, allowing one hour beyond the published heartbeat, and a **10 bps research NAV-comparison tolerance**. These are explicit investigation thresholds, not approved production risk parameters. It rejects future timestamps beyond 60 seconds and detects excessive retained-history gaps.

Source review identifies separate signed-package timestamp checks, updater permissions and a read-staleness limit. Those checks address different stages of the pipeline. The consumer still needs its own freshness policy. [Adapter configuration](https://github.com/redstone-finance/redstone-oracles-monorepo/blob/1c2c0da53ea8607f6dc1caa8cd95dc8f0fe3c8be/packages/stellar-connector/deployments/stellarMultiFeed/contracts/redstone-adapter/src/config/mod.rs), [timestamp conversion](https://github.com/redstone-finance/redstone-oracles-monorepo/blob/1c2c0da53ea8607f6dc1caa8cd95dc8f0fe3c8be/packages/stellar-connector/deployments/stellarMultiFeed/contracts/redstone-sep-40/src/utils.rs).

## 4. Source methodology and governance: what is established

Reviewed source describes signed RedStone data packages persisted by the multi-feed adapter, with the direct USTRY feed and SEP-40 wrapper reading those stored observations. The adapter configuration specifies a three-signer threshold from five permitted signers and trusted updater accounts. These signer checks authenticate supplied prices; they do not independently establish the economic value of the reserve assets. [Adapter signer configuration](https://github.com/redstone-finance/redstone-oracles-monorepo/blob/1c2c0da53ea8607f6dc1caa8cd95dc8f0fe3c8be/packages/stellar-connector/deployments/stellarMultiFeed/contracts/redstone-adapter/src/config/config_prod.rs), [direct feed implementation](https://github.com/redstone-finance/redstone-oracles-monorepo/blob/1c2c0da53ea8607f6dc1caa8cd95dc8f0fe3c8be/packages/stellar-connector/deployments/stellarMultiFeed/contracts/redstone-price-feed/src/lib.rs).

All three live contract instances name owner `GCXYXZHRDYGY56JTAQX4EKURGGJLIW2RSIMFADVS5BDK3AT6GZWPLUFY`. The probe records the instance storage and deployed WASM hashes:

| Component | Deployed WASM hash |
|---|---|
| Direct USTRY feed | `3e464b6dda26a8d5b0bf13d2cb7781a6142bf2c2e4b64edcba093911fa16df5c` |
| Adapter | `f0ccdffc29931abed6d77eef359450b183584103a3665be1f080f5f712b1542e` |
| SEP-40 | `5700be217a7b5d91324bdc529fd1e8047c275647c9c576aaa5a2ca46f64fd04a` |

The reviewed SEP-40 code permits owner-controlled mapping, decimal, resolution and code changes. The probe rejects unexpected precision or deployment identity changes rather than silently repricing assets. **A shared owner address does not by itself establish the current signer threshold, operational policy or timelock of that account.** [SEP-40 implementation](https://github.com/redstone-finance/redstone-oracles-monorepo/blob/1c2c0da53ea8607f6dc1caa8cd95dc8f0fe3c8be/packages/stellar-connector/deployments/stellarMultiFeed/contracts/redstone-sep-40/src/lib.rs).

Unresolved provider questions:

- The exact upstream USTRY source composition and calculation, including whether issuer API, Solana BondPrice or market data is involved.
- Whether a newly signed package can repeat a NAV whose underlying valuation has become stale, and how a consumer detects that condition.
- Handling of NAV revisions, market closures, reserve incidents and issuer redemption suspensions.
- Provider-supported upgrade notices, operational controls and source/audit-to-deployed-WASM assurance.
- Historical retention and a defensible maturity observation policy beyond the short retained window.

Close spot agreement alone cannot resolve these questions. The enquiries ask for explicit answers.

## 5. Consequences for the prototype

1. Keep **USTRY quantities**, **USD face value**, **SR shares**, and **oracle timestamps** distinct throughout the interface. One USTRY is not one dollar.
2. Prefer a source-specific SR implementation. Reuse existing PT/YT components only after checking their assumptions against dollar-accounted, token-settled claims.
3. Price changes arrive in steps. A rate bound measured only against time since the last user call can reject a legitimate 12-hour NAV update immediately after a deposit. Use validated source observation times and define unchanged-price observations carefully.
4. A high-water accrual index is separate from live realizable value. Falling NAV must reduce the economic value of backing; it must not become an invented principal guarantee or create fresh yield during recovery below the prior high-water mark.
5. Raw SR redemption for its backing token can be designed to remain available during an oracle outage. PT/YT recombination and maturity settlement have additional valuation dependencies that must be exercised explicitly.
6. The existing yield engine's interpolation of late expiry observations must be evaluated against this stepped feed. A successful exact historical lookup at a retained timestamp does not establish a price for every arbitrary maturity timestamp or after history expires.
7. Free testnet tokens and a mock oracle can validate accounting and transaction behavior, but cannot prove issuer redemption or approve the legal product structure. Keep those acceptance criteria separate.

## 6. Reproduce and test

From `website/contract/spield`:

```sh
node scripts/probe_ustry_oracle.mjs --out research/ustry/oracle-observation.json
```

The probe uses the existing scripts package's Stellar SDK. It performs read-only RPC simulations and public HTTP reads. It has no signing or transaction-submission path. Requests use bounded concurrency/retries; failure leaves a failed assessment and exits with code 2. Successful technical checks exit 0 and explicitly retain `productionApproved: false`.

The JSON retains request times, pinned provider commit and file hashes, exact contract identifiers, raw return-value XDR, per-call ledger numbers, contract-instance XDR/WASM hashes, issuer responses, history and assessment thresholds. Re-running replaces the output file; choose a different `--out` path to retain another dated sample.

From `website/contract/spield/scripts`:

```sh
npm run test:ustry-oracle
npm test
```

**Validation completed:** 17 new oracle-check tests pass; all 46 operational-script tests pass. Tests cover incorrect asset/base/mapping, changed precision, stale/future timestamps, millisecond/second confusion, NAV divergence, zero/missing prices, inconsistent samples, history gaps, and legitimate downward NAV observations. Both new JavaScript modules pass syntax checks. Existing protocol contracts have not been modified or deployed.

## 7. Next checkpoint

Use the [completed execution record](executed-sandbox-tests-2026-10-27.md) as the baseline. No further manual funding/transfer is needed for this fixture. Next work is live NAV/oracle adaptation, reviewed loss and maturity rules, standalone PT/YT token behavior and application integration, with production economics and operating terms evaluated separately.

The [prototype](prototype.md) has now completed deposit → split PT/YT → claim yield → maturity → in-kind redemption using genuine sandbox USTRY on public testnet, with a deliberately controlled oracle. Actual provider purchase/redemption and both USDC swap directions also completed through v1. No speculative v2 release date or external callback tunnel was required.
