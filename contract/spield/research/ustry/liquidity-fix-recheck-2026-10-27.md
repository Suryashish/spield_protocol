# USTRY liquidity fix and wallet readiness

**Issuer-route clarification:** the GATAL-USDC rejection in this historical checkpoint applies to the provider's Ramp API. An independent Stellar DEX path through GBBD-USDC now has verified purchases and reverse trades; see [the correction and execution proof](gatal-usdc-route-resolution-2026-10-27.md). Circle's published testnet USDC is GBBD, which is also the asset this sandbox's Ramp API accepts.

**Historical quote-only checkpoint, superseded later on 27 October:** a locally signable wallet has since been registered, funded and used to complete provider and Soroban contract round trips. Follow [the executed test report](executed-sandbox-tests-2026-10-27.md) for the current wallet/fund status; the earlier browser-wallet instructions below remain a snapshot of the initial check.

Verified **27 October 2026, approximately 00:12–00:14 IST** (the saved UTC timestamps are 26 October, 18:42–18:44). Sources: [swap quote evidence](sandbox-liquidity-recheck-2026-10-27.json), [wallet and fiat quote evidence](wallet-readiness-2026-10-27.json), and the latest Etherfuse reply supplied by the user.

## Result

**The earlier sandbox quote blocker is fixed.** All four requested v1 routes now return HTTP 200 with quote IDs. A completed trade or redemption has not yet been executed. There are no USTRY or Etherfuse-issued USDC balances in the registered wallet, and its signer is not among the configured local Stellar CLI identities.

| Route | Source amount | HTTP | Quoted destination amount |
|---|---:|---:|---:|
| Etherfuse sandbox USDC → USTRY | 10 USDC | 200 | 9.018099105 USTRY |
| USTRY → Etherfuse sandbox USDC | 10 USTRY | 200 | 11.044500501 USDC |
| MXN → USTRY | 100 simulated MXN | 200 | 4.865180426 USTRY |
| USTRY → MXN | 1 USTRY | 200 | 20.472087660 simulated MXN |

These are separate sampled quotes, not one matched-size round trip. Their rates are historical observations; regenerate a quote before creating an order. All quote calls used `POST https://api.sand.etherfuse.com/ramp/quote`, the v1 interface. A control USDC → CETES quote also succeeded.

The earlier API probes already used the correct Etherfuse USDC issuer. Etherfuse's new explanation identifies **two separate issues**: its missing USTRY liquidity caused our prior API quote failures, and the user's wallet currently holds another issuer's USDC, which is not usable for this sandbox route.

## Registered wallet versus the local signing identity

| Wallet | Public Stellar address | Current observations |
|---|---|---|
| Etherfuse-registered organization wallet | `GBMV57BAYM6DK25OB2U63HXLLUCVECINC5APEKNIELGSTEM5QCGSMLEQ` | Active, organization ownership claimed; 4.9999800 test XLM; USTRY trustline present with zero balance; 100 USDC from the other issuer; no Etherfuse-USDC trustline |
| Existing local CLI identity `alice425` | `GDXHBXYT23MUJWOKNZLTRBYJA2H6LDIL2DVHJCVITEFKQK5QUT2LPBJF` | Active and locally signable; 9424.4913844 test XLM; neither Etherfuse-USDC nor USTRY trustline; not listed in the Etherfuse Stellar wallet inventory |
| Local CLI identity `spield_deployer` | `GBUPDAQJPIYQWTJGVPYSBAK5BOHC3DP7ED3AKDAEZ7FJD7NOX56Z7YDF` | Address exists locally, but Horizon testnet returns 404; not listed in the Etherfuse Stellar wallet inventory |

The local CLI identity inventory was compared by deriving **public addresses only** and checking active account signers. No configured CLI identity matched a positive-weight signer on the registered wallet. This does not establish that its key is absent from a browser wallet or some other file; it means the current CLI setup cannot sign for it. No private key was displayed or saved.

## What the user should do first

Keep the existing registered wallet for the first Etherfuse round trip. **There is no need to transfer USTRY to a local-machine wallet merely to buy or redeem it through the website.**

1. In the wallet controlling `GBMV57...SMLEQ`, select **Stellar testnet** and add a custom asset/trustline for:

   ```text
   Asset code: USDC
   Issuer: GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
   ```

   Its USTRY trustline is already present and authorized. The wallet already has approximately 5 test XLM; additional XLM funding is not the immediate issue. Existing USDC from `GATALT...F5V56` can remain for other tests, but it cannot fund the Etherfuse-USDC route simply because it has the same symbol.

2. Obtain a small allocation in that registered wallet. The simplest route is to take up Etherfuse's earlier test-allocation offer and request **5 test USTRY** at `GBMV57BAYM6DK25OB2U63HXLLUCVECINC5APEKNIELGSTEM5QCGSMLEQ`. It already has the required USTRY trustline. Request the transfer hash and verify the issuer and received balance. Alternatively, use their now-working simulated MXN → USTRY onramp.

3. Once tokens arrive, execute a small USTRY → Etherfuse-USDC swap in the sandbox website with that wallet and sign the requested transaction. Confirm the correct USDC actually arrives. Use part of it to test the reverse swap; record actual amounts, fees and transaction hashes. A signed and settled result, not a successful quote alone, closes the round-trip checkpoint.

There are currently **zero linked sandbox bank accounts** according to the latest account-count check. The simulated MXN route therefore still needs its bank-account/order/deposit-simulation setup. Etherfuse's direct test allocation avoids that setup for the first token swap. Swaps themselves do not require a bank account. [Swap prerequisites](https://docs.etherfuse.com/guides/testing-swaps), [simulated onramp workflow](https://docs.etherfuse.com/guides/testing-onramps).

No real-money bank transfer is needed for sandbox testing. If using MXN, follow the sandbox deposit simulation rather than sending funds. There is no public faucet for Etherfuse's own sandbox USDC; ordinary test-USDC faucets issue a different asset. [Sandbox reference](https://docs.etherfuse.com/test-environment), [Stellar asset and funding guide](https://docs.etherfuse.com/guides/chains/stellar).

## If the user wants CLI-based Soroban prototype testing

After the website round trip, a separate transfer to a locally controlled test wallet is useful because our current prototype has no browser signing UI.

1. Establish the USTRY trustline on `alice425` **before** transferring tokens there. The following is a user-run signing/submission command; it was not executed during this check:

   ```sh
   stellar tx new change-trust \
     --source-account alice425 \
     --network testnet \
     --line USTRY:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4
   ```

2. Transfer a small test amount, such as **1 USTRY**, from the registered wallet to the public `alice425` address above. This is a normal Stellar testnet token transfer, not an Etherfuse redemption. Verify the exact issuer on receipt.
3. Use `alice425` to sign deposits into a **fresh isolated RWA series**, not the existing Blend/USDC contracts. A series must be deployed and configured before any contract deposit; do not send tokens directly to an existing contract address in place of calling its deposit method. Public-testnet RWA series deployment remains unperformed.
4. For an Etherfuse exit, return the withdrawn USTRY to the registered organization wallet, then execute the provider swap/offramp there. Do not assume the unregistered `alice425` address is entitled to use the account's provider redemption API. Registering it as another organization-owned wallet would be a separate alternative requiring provider onboarding confirmation.

Only USTRY's trustline is needed on the local wallet for an USTRY-in/USTRY-out contract test. The Etherfuse-USDC trustline is needed wherever USDC will actually be received.

## Operating-model clarification from the new provider reply

Etherfuse identifies **Spield as the KYB'd customer** and requires provider purchases/redemptions from Spield's own registered `G...` wallet. It permits Spield to hold USTRY in its Soroban contracts and issue tokens or provide liquidity in between. It says it has no product giving users just USTRY's yield portion.

This supports the current design: Spield holds yield-bearing USTRY and implements its own principal/yield accounting. Its end users should not be assumed to have direct provider redemption access. Any Spield-operated USDC or fiat exit has to return assets to the registered organization wallet and handle the off-chain order/signing/settlement process. The existing prototype demonstrates in-kind token payouts; that is distinct from this operator-mediated cash exit.

## Actions performed and remaining checkpoint

Performed: authenticated asset/quote reads, four successful USTRY route quotes, local public-identity comparison, public Horizon balances/trustlines/signers and a sandbox bank-account count. API credentials, account IDs and quote IDs were excluded from saved evidence; relevant public wallet addresses were intentionally retained so the transfer guidance is usable.

**No order was created, no transaction signed/submitted, and no trustline or token balance was changed by the agent.** A full execution could not be performed from this machine because the registered wallet has no compatible funding tokens and no matching configured CLI signer. The user can complete the missing wallet signature and acquisition steps in the wallet already connected to Etherfuse. No additional liquidity-support email is needed to establish that quotes work; the allocation request is optional if using the simulated onramp instead.
