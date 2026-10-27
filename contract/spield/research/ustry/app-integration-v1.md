# USTRY testnet app integration v1

Work branch: `ustryintegrationv1`. Testnet integration only; the mainnet build offers Blend.

## Run the app

From `website/frontend`:

```sh
npm run dev:testnet
```

Select **Yield source → USTRY**, then **Series / maturity → USTRY Series 1**. The two adjacent selectors are the layout the user approved. The local `.env` currently selects mainnet for ordinary `npm run dev`; `dev:testnet` explicitly overrides it without changing production settings. Use `npm run build:testnet` for a testnet build.

The USTRY workspace uses Blend’s existing sidebar, desktop header, mobile bottom navigation and More sheet. Navigation names and order stay the same across sources, including Overview, Yield, SR Wrapper, Fixed Vault, Deposit, Markets, Liquidity, Bridge, Solvency and Activity. Overview uses the same four-stat/chart/portfolio-and-backing layout; Deposit and SR Wrapper use the same action/position grids and shared amount fields. Cards, typography, buttons, gutters and contextual help use the existing dashboard components. USTRY content keeps token quantities, USD face and NAV distinct. A single NAV observation displays a collecting-history state instead of inventing a price curve.

Unavailable USTRY fixed-vault, PT-pool, LP and bridge capabilities retain the familiar page layout with explicit availability messages and disabled actions. They do not query or reuse Blend contracts. The existing Blend page, sidebar, section components and shared UI primitives were preserved byte-for-byte during this UI correction. Shared header/help/mobile-navigation additions only supply optional USTRY help content; Blend’s default behavior remains the same.

Source and network selection filter contract sets, remember the last series per source, and reset wallet inputs and data. A series change during wallet signing cancels submission even if the user switches back; unexpected wallet changes to the transaction also cancel submission.

## Verified deployment and results

Maturity: **10 November 2026 13:51:24 UTC**. The independent audit verified **37 successful transactions**, matched all **five** app contracts against local release WASM, and confirmed that their actual ledger lifetimes extend beyond maturity.

| Role | Testnet contract |
|---|---|
| series | `CCR6L2GNPIOXR6RZMVFXZ2NXIICCPVWCEXIVOZHAGME3CJ23675XQX5K` |
| oracle | `CAYVM7ND6WHWCPKXMIUY4OFQQIJ2XHF7SMVKAVT2XMXOINRKA3ZW2BWV` |
| receipt | `CCESR7RVYMFTVEGHSQRBKAMHYBVBHKMQIHHJRZSE4C3J63QCNHRT5W7C` |
| pt | `CBABWET2KLLURNJQRKRCSRBVIMEBLXMPVYU4SEPSGMK3S3F2UQWKLA52` |
| yt | `CAYELDAOTHRUDZPV7YRXSEFGZBZI635NJVXNS5UH5T3FRK5CUVEYIFSE` |
| asset | `CCUGMX7HX6CH6T4XNPALQ7HCVU37RLUNHAYNSAIALTPFHFQVIRIHALBC` |

Validation passed: **36 contract tests**, including two compiled-WASM lifecycle tests, **57 operations tests**, the client suite, browser tests and focused frontend lint. Both testnet and mainnet builds pass; the build still reports existing dependency annotation/chunk warnings. The short final fixture returned its original 1.25 USTRY exactly and closed with zero custody.

The actual frontend-client conversion samples were 0.1 GATAL USDC → 0.1518579 USTRY → 0.0993511 GATAL USDC, and 0.1 GBBD USDC → 0.0903600 USTRY → 0.0999500 GBBD USDC. These differences exclude test XLM transaction fees and do not establish executable capacity at larger amounts.

Current audited Alice balances: **3.3111515 USTRY**, **132.9048896 GATAL-USDC**, **0.6044081 GBBD-USDC** and **9206.0870582 test XLM**. The accounting tests collectively left four smallest USTRY units across development/final escrow contracts; their individual amounts and zero outstanding claim supplies are recorded in the evidence.

## Deposits, units and payouts

- The backing asset is genuine Etherfuse **Stellar testnet sandbox USTRY**, SAC `CCUGMX7HX6CH6T4XNPALQ7HCVU37RLUNHAYNSAIALTPFHFQVIRIHALBC`, issuer `GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4`.
- Deposit USTRY directly and atomically split into PT/YT, or hold transferable **sUSTRY** unsplit receipts. One receipt withdraws one USTRY. These receipts are not Blend SR.
- Receipt quantities and asset transfers have 7 decimals. PT and YT balances also have 7 decimals, but represent **USD face**, not USTRY quantities. NAV is USD/USTRY at 8 decimals. For example, depositing one USTRY at $1.25 yields approximately 1.25 PT and 1.25 YT; it does not issue one dollar of each.
- The high-water NAV factor allocates token quantities. YT earnings arise only above the previous high, and are paid in USTRY. A NAV loss reduces the dollar value of payouts. A recovery to the old high creates no new yield. New splits are blocked during a drawdown.
- Before maturity, recombine equal PT and YT face. After settlement, redeem PT without YT. Previously credited YT earnings remain claimable after transfer, recombination or voluntary YT burn.
- Unsplit receipt withdrawals and PT/receipt transfers require no oracle. YT transfers settle earnings first. After actual maturity settlement, principal and yield payouts also require no live oracle; the frontend preserves that exit if oracle reads fail.
- New exposure has a 1,000-USTRY custody-accounting cap and an admin pause. Pausing new deposits/splits does not pause existing exits. The app uses a 0.5% minimum-output tolerance for priced split/redemption operations.
- Receipt, PT and YT are separate contract tokens with SEP-41 allowance, transfer, burn, supply and metadata interfaces. Delegated operations consume allowances, including self-spender allowances; zero transfers need no stored allowance. Transfers accept muxed recipients and retain their ID in the event. Binding is immutable after initialization. Core-authenticated mint/burn events describe actual ledger changes. Voluntary token burns abandon the corresponding right and do not withdraw backing.
- Conservative integer rounding can retain 0.0000001 USTRY in escrow on a small round trip. Dust is not swept by the admin.

The current registry is [frontend/src/lib/ustry-deployment.json](../../../..//frontend/src/lib/ustry-deployment.json). Exact public addresses, transaction hashes, starting/ending balances and release-artifact checks belong in the execution/audit JSON files linked below.

## Obtain USTRY and convert USDC

The registered, locally signable operator wallet is `alice425`, public `GDXHBXYT23MUJWOKNZLTRBYJA2H6LDIL2DVHJCVITEFKQK5QUT2LPBJF`. It already has genuine sandbox USTRY and both test USDC assets. No new funds or provider email are needed for this wallet's tests. Connecting a different wallet does not move Alice's balances into it: fund that exact wallet or acquire USTRY using its own supported USDC.

The app's **Convert USDC** section uses Stellar SDEX path payments to the connected wallet itself:

- Existing Blend test USDC: `USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56`.
- Circle-listed testnet USDC: `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.
- GATAL routes may use GBBD USDC as the intermediate asset. The provider v1 Ramp API's rejection of GATAL is separate from SDEX availability; both identities remain explicit.

Quotes expire after 30 seconds, carry a 1% minimum-output limit, and limit one conversion to at most 1,000 input units. Lack of liquidity is an error, not a fabricated conversion. Quotes and input state are invalidated when selection or wallet changes. Swap output goes to the same wallet, and destination trustlines must match exact issuers. Test XLM is needed for fees and trustline reserves. The two test USDC assets need not trade at par. Conversion is a separate transaction from the subsequent USTRY deposit.

Etherfuse's fiat on/offramp remains an operator process using Spield's registered KYB wallet, as the provider specified. No customer-facing API key, automatic fiat redemption promise, or direct redemption by arbitrary Soroban contracts has been added. Previously executed provider purchase/redemption and swap evidence remains in [executed-sandbox-tests-2026-10-27.md](executed-sandbox-tests-2026-10-27.md).

## NAV relay and keeper

This sandbox series uses `spield-ustry-oracle`: an **authenticated operator NAV relay**, not the mainnet RedStone feed and not a controlled mock. The relay reads the public sandbox [USTRY price endpoint](https://api.sand.etherfuse.com/lookup/tokens/cost/ustry) following [Etherfuse's price-feed documentation](https://docs.etherfuse.com/price-feeds). It validates the sandbox mint, USTRY/bond identity, USD currency, positive bounded decimal price and a recent API response timestamp. Precision is converted conservatively without floating-point arithmetic. **An API response timestamp or relay observation timestamp is not a verified Treasury NAV effective timestamp.** This integration does not establish independent pricing or a production oracle SLA.

From `website/contract/spield/scripts`, keep one operator process running:

```sh
npm run ustry:keeper
```

For a single health/publication attempt:

```sh
npm run ustry:relay
```

The process polls every minute, publishing after 12 hours, a NAV move of at least 0.1%, or the first observation crossing expiry. The consumer freshness limit is 13 hours. Publication can go down as well as up. Contract history is append-only and bounded at 256 samples; monitor capacity for this 14-day experiment. Failed API/RPC reads must not be converted into invented observations. A submitted transaction with uncertain status blocks further publication until its recorded hash is resolved.

The keeper was started and returned `NAV healthy; next publication not yet due` during this implementation session. Keep one instance running on an always-on machine through maturity. A sleeping laptop or closed terminal is not a reliable scheduler. A reboot may clear the private `/tmp` journal: the relay can reconstruct public configuration from the tracked deployment after checking it against chain. The operator still needs the local `alice425` signer; no private key is put in the frontend. The testnet series is not ready for unattended public use without durable keeper hosting and monitoring.

Maturity requires a valid observation reaching expiry and a sufficiently recent last observation at/before expiry. The first later price proves the time boundary; it does not create post-expiry yield. The keeper retires once that boundary is observed. Finalization is permissionless and can be submitted from **Backing** when the series becomes ready. Missing maturity history may delay or prevent settlement; do not assume that a later fabricated/backdated sample repairs it.

## Verification and evidence

- [app-v1-execution.json](app-v1-execution.json): final app deployment, closure of empty development deployments and bounded genuine-USTRY receipt/split/transfer/claim/recombine execution.
- [app-frontend-client-execution.json](app-frontend-client-execution.json): actual frontend client/SDK16 transactions with a CLI signer substituted only in a temporary Node test harness. This does not claim a manual Freighter extension test.
- [app-v1-audit.json](app-v1-audit.json): independent successful-transaction checks, exact deployed-WASM/release-artifact comparisons, storage lifetimes beyond maturity and wallet balances.
- [app-final-adversarial-execution.json](app-final-adversarial-execution.json): genuine-USTRY loss, yield and maturity fixture using the final release artifacts, with a controlled oracle and a wider deployment freshness window. An earlier unfunded setup failure is retained in its evidence.
- [app-adversarial-execution.json](app-adversarial-execution.json): earlier short-lived fixture proving stale-price rejection, unchanged claims, oracle-free receipt exit and full token conservation. Compiled-WASM tests also cover stale and invalid-price scenarios.

Repeat local verification:

```sh
# website/contract/spield
cargo build --target wasm32v1-none --release -p spield-rwa -p spield-rwa-token -p spield-ustry-oracle
cargo test -p spield-rwa -p spield-ustry-oracle --features spield-rwa/wasm-tests --lib
cargo fmt -p spield-rwa -p spield-rwa-token -p spield-ustry-oracle -- --check

# website/contract/spield/scripts
npm test
node audit_ustry_app.mjs

# website/frontend
npm run test:ustry
npm run test:ustry:browser
npm run build:testnet
```

The client suite tests exact quantities, source/network isolation, wrong series identity, stale synchronization, offline-oracle finalized exits, issuer-specific routes, minimum outputs, quote expiry, wallet mutation and signing-time cancellation. Browser tests use deterministic wallet/RPC fixtures for direct Blend/USTRY sidebar and mobile-navigation comparisons, computed typography/gutter/card-style checks, all ten routes at desktop and 375px widths, shared light/dark themes, collapse/expand, contextual help, source filtering, persistence, input reset, contract isolation, priced-action gating, stale-price receipt withdrawal and RPC error states. Separate genuine-token executions establish chain integration; mock tests alone do not establish issuer redemption reliability.

Clippy is checked for the new crates with `-D warnings`, allowing only the existing shared crate's `manual_clamp` and `manual_range_contains` warnings. No Blend governance change is implied.

The initial development deployments are retained in the `app-v1-superseded-*.json` evidence files. New exposure is paused on those contracts and their receipt/PT/YT supplies were checked as zero before replacing the registry. The deployment helper refuses to replace an active deployment or one with outstanding claims. Do not blindly replay funding, deployment or smoke commands after a timeout; inspect the recorded transaction hash first.
