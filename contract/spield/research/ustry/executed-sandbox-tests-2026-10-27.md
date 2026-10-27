# Executed USTRY sandbox tests

**Later issuer-route correction:** the API rejection recorded below applies to Etherfuse's v1 Ramp interface. We subsequently reproduced the user's successful **GATAL-USDC → GBBD-USDC → USTRY** Stellar DEX route and its reverse from Alice. See [the follow-up with transaction proof](gatal-usdc-route-resolution-2026-10-27.md). GBBD is Circle's published testnet issuer; "Etherfuse USDC" below refers to the asset accepted by that sandbox, not a separate issuer owned by Etherfuse.

Execution date: **27 October 2026, IST**. Evidence: [provider execution journal](sandbox-execution-2026-10-27.json) and [public-testnet prototype journal](testnet-prototype-execution-2026-10-27.json). These supersede the earlier quote-only wallet instructions.

## Provider round trips completed

The user authorized funding, transactions and integration testing. We registered the already locally controlled `alice425` identity as an additional organization-owned Stellar wallet under Spield's approved Etherfuse sandbox account:

```text
GDXHBXYT23MUJWOKNZLTRBYJA2H6LDIL2DVHJCVITEFKQK5QUT2LPBJF
```

The original browser wallet remains separate. The new local wallet is now a provider-registered operating wallet itself, so it can purchase/redeem directly without transferring tokens back to the browser wallet.

| Executed action | Verified result |
|---|---|
| Register local wallet with organization ownership | Registration returned `claimedOwnership=true` |
| Add exact sandbox USTRY and Etherfuse-USDC trustlines | Successful signed testnet transaction; both trustlines authorized |
| Test existing USDC issuer `GATALT...F5V56` | HTTP 400; supported `GBBD47...LFLA5` control returned 200 on the same now-registered wallet |
| Request simulated funds and buy USTRY | 100 simulated MXN produced **4.8602504 USTRY**, delivered on-chain |
| Redeem USTRY to simulated fiat | **1 USTRY → 20.51 simulated MXN**, provider order completed |
| Sell USTRY for Etherfuse USDC | **1 USTRY → 1.1044581 USDC**, on-chain settlement and completed status |
| Buy USTRY with Etherfuse USDC | **0.5 USDC → 0.4509015 USTRY**, on-chain delivery and completed status |

Both USD-token routes quoted 20 bps. Their source amounts differ, so these are execution samples in both directions rather than a matched-notional profitability comparison. Testnet liquidity/fees do not establish production capacity or economics.

The GATAL issuer's **132.9120223 USDC** in the local wallet was not used by these initial provider-API tests. It was subsequently used successfully in the separately recorded DEX-route test. Sharing the symbol does not make the issuers interchangeable; an explicit conversion path is required.

## Funding and settlement details

No real money or real bank details were needed. The documented sandbox business RFC `XEX010101000` was used with a synthetic checksum-valid test CLABE. Etherfuse rejected its documentation's `646...` STP example; a non-STP fixture succeeded and was marked compliant. We created a 100-MXN sandbox onramp order and called its sandbox-only fiat-received simulation endpoint.

The swap instructions were received over **Etherfuse's own authenticated first-party WebSocket**. Actual frames use `type: "SwapUpdate"` and `data.swap`, alongside `OrderUpdate` messages. This is useful integration evidence beyond the documentation's order-only stream description.

The USTRY sale used a single transaction with the user's payment and a provider-pre-signed path payment back to the wallet. The reverse purchase used a path payment to the same verified provider settlement wallet, followed by a separate token-delivery transaction. Its completed status and actual receipt were checked separately: not every supported swap is an atomic payout to the user's wallet.

Before signing, the executor validates the exact source wallet, issuers, maximum spend, fee, expected destination/output and, for the atomic counterparty operation, the provider's existing testnet signature. Expired transaction instructions were refreshed through the provider endpoint instead of modifying the pre-signed transaction.

Automatic approval review rejected a proposed Cloudflare callback tunnel because it would introduce an additional external recipient for order/wallet/transaction data. The tests were completed through the first-party stream instead. No tunnel or external webhook subscription was created; the unused local receiver was stopped and its code removed.

## Public transaction evidence

- [USTRY onramp delivery](https://stellar.expert/explorer/testnet/tx/b44eae45e9c69c6ae7648fce26f63800ef2aaa15140286270c80bd9376dbef81)
- [1-USTRY source transaction for MXN redemption](https://stellar.expert/explorer/testnet/tx/4571502fd1d0923ce48d09117ae9ca8d82a2f13d4a998cd4f40aac5870277c75)
- [USTRY → USDC atomic swap](https://stellar.expert/explorer/testnet/tx/14c6e9553965409d17713353266d519b0cc28c58b7e056ba3f323e40bdc8a7f0)
- [USDC → USTRY send/path transaction](https://stellar.expert/explorer/testnet/tx/97ea1ac035adc80d94fd001e72bfefefe939cccb23cd993bc6d45923440b16ee)
- [USDC → USTRY final delivery](https://stellar.expert/explorer/testnet/tx/26658e2f823e0e9dbf94c20ec62325b8ce9b2abc3b3a39c256cee3d4d0749139)

The API's `confirmedTxSignature` is treated as an opaque provider reference; the Stellar source transaction hashes above come from submission/Horizon, rather than assuming that every provider confirmation reference is a Stellar hash.

## Genuine-token Soroban prototype

Fresh contracts were deployed to **Stellar testnet**:

| Component | Address |
|---|---|
| Genuine sandbox USTRY SAC | `CCUGMX7HX6CH6T4XNPALQ7HCVU37RLUNHAYNSAIALTPFHFQVIRIHALBC` |
| Controlled test oracle | `CB5MTAPG536AKZIHV67HA4P24R4FIRV2CCIMVLBS3GN7POM2NXWEA7BZ` |
| Isolated RWA series | `CCP4Q22ZP7BR7F6MRVRN22FYMDIFY2MYBWJ4GVUY2WGQZSPTV5SWKQ7B` |

The test deposits **1.25 actual sandbox USTRY**, retaining 0.25 as unsplit receipts and splitting 1 USTRY at a controlled $1.25 price into $1.25 PT face and $1.25 YT face. These are internal contract balances, not standalone wallet/AMM tokens.

- Falling controlled NAV to $1.00 produced no yield and valued one token at $1, while nominal PT face remained $1.25. The high-water index did not become a dollar principal guarantee.
- After the 90-second freshness limit elapsed, PT redemption failed with contract error 9. The user's claims remained unchanged.
- The unsplit **0.25 USTRY** was returned despite the stale oracle.
- Recovery to the previous NAV high produced no new yield. A subsequent controlled rise to $1.5625 allocated **0.2 USTRY** to YT, leaving **0.8 USTRY** principal backing.
- Maturity finalized successfully. A post-expiry controlled price rise to $2.50 did not increase YT's allocation; PT redeemed for the remaining **0.8 USTRY**, with no additional YT payout.
- The **0.25 receipt withdrawal + 0.2 YT allocation + 0.8 principal payout = 1.25 USTRY deposited**. Contract custody ended at zero and the wallet's USTRY balance returned exactly to its pre-prototype amount, **3.3111519 USTRY**.

The controlled prices are deliberately artificial. The 0.2-token payout demonstrates accounting allocation from escrow; it is not an assertion that Etherfuse generated that yield during the test. Actual provider-NAV integration, production source validation and standalone PT/YT token integration remain separate work.

## Reproducibility and next work

Execution helpers: [provider steps](../../scripts/execute_etherfuse_sandbox.mjs), [transaction checks](../../scripts/etherfuse_sandbox_tx.mjs), [testnet contract lifecycle](../../scripts/execute_ustry_testnet_prototype.mjs), and [independent final audit](../../scripts/audit_ustry_testnet_execution.mjs).

These are checkpointed scripts for this one-shot fixture, not a daemon to replay automatically. Provider IDs and raw instructions are kept in a mode-0600 temporary journal; API keys and private keys are never written to the public research files. The signer secret is used in memory only, and host/network/asset selection is fixed to sandbox/testnet.

Validation completed: **27 contract scenario/WASM tests** and **54 operational-script tests**, including **8 transaction-signing guard tests**, pass. The final audit independently verified **23 recorded transaction hashes** as successful against public testnet Horizon. The live lifecycle, final balances and audit results are recorded in the linked execution journals.

No further funding request or manual token transfer is needed from the user for these tests. The local registered wallet now holds usable sandbox tokens. Continue toward the live NAV adapter, reviewed loss/maturity semantics, interoperable PT/YT tokens and application integration; production access and economics remain separate from this successful sandbox execution.

At the end of this initial provider/prototype run, balances were **3.3111519 sandbox USTRY**, **0.6044581 Circle-listed GBBD testnet USDC**, and 132.9120223 GATAL-USDC. They are held by the registered `alice425` public address above. The later DEX round trip changed GATAL-USDC to **132.9055385** while leaving those USTRY and GBBD-USDC balances unchanged; its [separate journal](gatal-usdc-execution-2026-10-27.json) is the newer snapshot.
