# GATAL USDC can buy USTRY through a Stellar DEX path

Verified **27 October 2026**. The user's website purchase is supported by on-chain evidence, and we reproduced a purchase and reverse sale using Alice's existing GATAL-issued USDC. **No additional funds or user-to-Alice transfer were needed.**

## Corrected conclusion

The earlier statement that this issuer's USDC could not be used to buy USTRY was too broad. The observed HTTP 400 establishes that Etherfuse's **v1 Ramp quote interface** rejects it as a source. It does not establish that the token cannot be exchanged on Stellar or used by a website that builds a DEX path payment.

| Route tested | Result |
|---|---|
| Etherfuse v1 `/ramp/quote`, GATAL-USDC → USTRY | Still HTTP 400 in the fresh recheck |
| Same API, GBBD-USDC → USTRY control | HTTP 200 |
| Stellar DEX path payment, GATAL-USDC → USTRY | Executed successfully from Alice |
| Stellar DEX path payment, USTRY → GATAL-USDC | Executed successfully from Alice |

The path is:

```text
USDC:GATAL...F5V56  →  USDC:GBBD47...LFLA5  →  USTRY:GC3CW7...V7UPS4
```

This is a single path-payment operation per leg, with the wallet as both sender and final recipient. The intermediate token is converted inside the payment; there is no manual intermediate transfer or requirement to hold an intermediate GBBD balance for this route. This differs from the provider's asynchronous Ramp swap service.

## Evidence from the user's browser wallet

Registered browser wallet:

```text
GBMV57BAYM6DK25OB2U63HXLLUCVECINC5APEKNIELGSTEM5QCGSMLEQ
```

Its [successful purchase transaction](https://stellar.expert/explorer/testnet/tx/1bbb8a28581a75f5914683163c7160e4e9a8a6d11d3cbe7a06b836481c50649f), timestamped **27 October, 17:37:45 IST**, contains a self-directed `path_payment_strict_send` spending **10 GATAL-USDC** and receiving **15.2833013 USTRY**. Its explicit intermediate path is GBBD-USDC.

The wallet snapshot after that transaction contains 90 GATAL-USDC and 15.2833013 USTRY. This matches the purchase the user described. Blockchain data establishes its assets, amounts and route; attribution to the website itself comes from the user's report.

Raw proof: [website transaction and path](website-gatal-usdc-proof-2026-10-27.json), [wallets and live path discovery](usdc-issuer-route-check-2026-10-27.json), [fresh Ramp API control](usdc-issuer-api-recheck-2026-10-27.json).

## Reproduced with the existing local Alice wallet

Local CLI identity: `alice425`.

```text
GDXHBXYT23MUJWOKNZLTRBYJA2H6LDIL2DVHJCVITEFKQK5QUT2LPBJF
```

It already held **132.9120223 GATAL-USDC**, plus the USTRY trustline prepared in the earlier work. The authorized test used only **1 GATAL-USDC** and sold back only the USTRY newly acquired by that purchase.

| Executed leg | Actual result | Public transaction |
|---|---|---|
| Buy USTRY | **1 GATAL-USDC → 1.5177264 USTRY** | [Purchase](https://stellar.expert/explorer/testnet/tx/e14a8546a4d7313bdbb8b81f1b9750c3aa48fb90273c4328944d36248486e9b4) |
| Sell that USTRY back | **1.5177264 USTRY → 0.9935162 GATAL-USDC** | [Reverse sale](https://stellar.expert/explorer/testnet/tx/cb404b729b3dfc2199e9a2c9d1fcb6086988d985ae9810773963334f9aeda739) |

Both transactions were confirmed successful and their actual operations independently reread from public testnet Horizon. Each used a fresh path quote, a 1% minimum-output tolerance, the exact source/destination issuers and a self-directed recipient. The reverse leg also required a minimum quote above 0.95 GATAL-USDC for this bounded test. No mainnet endpoint or real funds were used.

The observed round-trip difference is **0.0064838 GATAL-USDC**, or **0.64838%** of the initial amount, plus **0.00002 test XLM** in network fees. This difference does not separate liquidity fees, spread and price movement between the two trades; it is not a guaranteed future trading cost.

Final local balances after this test:

- **132.9055385 GATAL-USDC**
- **0.6044581 GBBD-USDC**, unchanged by the path-payment round trip
- **3.3111519 USTRY**, unchanged after buying and reselling the acquired amount

Execution evidence: [settled route journal](gatal-usdc-execution-2026-10-27.json). Reproducible bounded executor: [execute_gatal_usdc_route.mjs](../../scripts/execute_gatal_usdc_route.mjs). It requires an explicit `--execute` flag and records submitted hashes before sending; an already completed fixture is not traded again.

## Circle naming correction

Circle's own [USDC contract-address registry](https://developers.circle.com/stablecoins/usdc-contract-addresses) lists **GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5** as its Stellar testnet issuer. GATAL is a separate test asset used by this project's Blend setup. The earlier description of GBBD-USDC as "Etherfuse-issued" was imprecise: it is the Circle-listed testnet asset that Etherfuse's sandbox accepts.

The symbols do not make them the same asset. In this test's observed liquidity, 1 GATAL-USDC quoted approximately 1.68 GBBD-USDC; do not value both as an interchangeable dollar merely because they share a symbol. These are testnet liquidity observations, not production FX rates.

## Integration consequence

Spield can support the GATAL test token as a user input by explicitly quoting and executing the Stellar DEX conversion to genuine USTRY before the RWA deposit. Its reverse conversion can return GATAL-USDC on exit while liquidity is available. Keep this conversion service distinct from issuer redemption and from the RWA contract's token-in/token-out accounting.

Implementation should preserve code **and issuer**, check a fresh route and its executable size, use a user-accepted minimum output, reconcile actual received balances and handle disappearing paths. Native path payments can consume liquidity across their intermediate assets; current success is not an assurance that every size or future ledger will have a route. [Stellar path-payment parameters](https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#path-payment-strict-send).

The existing Etherfuse v1 adapter should continue using assets its API accepts. Do not bypass the unsupported-input error by relabeling GATAL-USDC as GBBD-USDC; the explicit DEX conversion is what makes the alternative input work.
