# Sandbox follow-up: addresses, website setup and support

Checked **25 October 2026, approximately 20:21 IST**. Evidence: [setup checks](sandbox-setup-check.json), [cross-chain and direct-ramp quotes](sandbox-followup.json), [exact Solana-mint quote checks](solana-quote-followup.json).

**Clarification from the 20:31 IST recheck:** USTRY is available as a listed, callable Stellar testnet token. The product URL contains a Solana mint, but its catalog entry also includes Stellar. Direct `symbol()` and `decimals()` reads succeeded. The remaining failure is the priced purchase/redemption route. See the [fresh availability confirmation](sandbox-availability-recheck.md).

## Answer

**Email is not required to enable ordinary sandbox testing.** Two self-service prerequisites are incomplete: there is no sandbox bank account, and the registered Stellar wallet does not yet exist on Stellar testnet. Complete those for a first onramp/settlement test.

**There is also a separate unresolved USTRY pricing-path problem.** The earlier probes already used sandbox URLs and the sandbox Stellar issuer. The URL contains the Solana devnet mint for a product also listed on Stellar; testing that mint separately did not make its Solana routes work in the tests below. No dashboard setting that repairs `FailedToGetQuote` or `NoPathsFound` was identified in the public documentation. Support contact is reasonable if the USTRY routes remain unavailable, but email is only one contact channel.

The ordinary sandbox setup can proceed before a support reply. Production pooled PT/YT eligibility remains a separate business/legal question.

## 1. The supplied bond link

User reference: [sandbox USTRY bond](https://sandbox.etherfuse.com/bonds/BoTpvjYEDn8esZDrBkipexoUMeSBQ9DDG6A5mtzsDGSt).

Automated access to the HTML page returned HTTP 403, so no claims are made about its currently visible buttons or settings. Etherfuse's public sandbox APIs independently identify the mint in the URL:

| Item | Verified value |
|---|---|
| Product | USTRY, denominated in USD |
| Solana devnet mint in the link | `BoTpvjYEDn8esZDrBkipexoUMeSBQ9DDG6A5mtzsDGSt` |
| Current sandbox Solana USDC/payment mint discovered from the API | `BXTou3CvPxpFVAJvzvEZcAnRLGCHqT1LHKsFTSQft7s` |
| Corresponding Stellar testnet asset | `USTRY:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4` |
| Stellar testnet USDC used in earlier tests | `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |

The current Solana sandbox payment mint differs from an older example in the swap guide. The follow-up used live asset discovery, not that example address. Solana mint strings cannot be substituted into a Stellar quote; identifiers must match the requested chain. [Public sandbox stablebonds](https://api.sand.etherfuse.com/lookup/stablebonds), [public sandbox USTRY price](https://api.sand.etherfuse.com/lookup/tokens/cost/ustry), [chain identifier documentation](https://docs.etherfuse.com/guides/testing-swaps).

The sandbox supply response reported **zero USTRY on Stellar** and approximately **2,882.83 USTRY on Solana** at inspection. This is an issuer API observation, not independent proof of available liquidity or the exact cause of a failed quote.

## 2. Account and wallet setup

| Prerequisite | Observation |
|---|---|
| Business account approval | Already present; no additional sandbox KYB approval is indicated by the account response |
| Registered Stellar wallet | Present; organization-claimed ownership is true |
| Stellar on-chain account | Horizon testnet returned 404; wallet is registered with Etherfuse but not yet activated on-chain |
| Existing Stellar trustlines/token holdings | Not present as a usable account because the account does not yet exist |
| Sandbox bank account | `GET /ramp/bank-accounts` returned zero accounts |

No account identifiers, wallet addresses, bank details or API key were saved in the setup evidence. These were read-only checks.

An unactivated wallet and absent trustlines are prerequisites to address before executing a Stellar swap or redemption. **They are not a demonstrated explanation for the quote errors:** the swap quote requests did not select a wallet, and the same account obtained successful CETES quotes.

## 3. Quote results using sandbox addresses

| Chain | Route | Source amount | HTTP | Interpretation |
|---|---|---|---|---|
| Stellar testnet | USDC → USTRY | 1 USDC | 424 | No valid quote obtained |
| Stellar testnet | USTRY → USDC | 1 USTRY | 424 | No valid quote obtained |
| Stellar testnet | MXN → USTRY | 100 simulated MXN | 424 | Direct onramp quote also unavailable |
| Stellar testnet | USTRY → MXN | 1 USTRY | 424 | Direct offramp quote also unavailable |
| Stellar testnet | MXN → CETES, including first-wallet setup | 100 simulated MXN | **200** | Viable quoted bootstrap path; approximately 78.71 CETES after a 9.69 MXN quoted fee |
| Solana devnet | USDC → exact USTRY mint from link | 1 and 10 USDC | 500 | `Unexpected`; no valid quote |
| Solana devnet | Exact USTRY mint → USDC | 1 and 10 USTRY | 404 | At 10 units the API explicitly returned `NoPathsFound` |
| Solana devnet | MXN → exact USTRY mint | 100 simulated MXN | 404 | `NoPathsFound` |
| Solana devnet | Exact USTRY mint → MXN | 1 USTRY | 500 | `Unexpected` |

All were quotes only. No bank account was created, no deposit simulated, no tokens bought, and no transaction signed/submitted. Quote values are historical observations, not offers that remain executable now.

Etherfuse describes HTTP 424 as an inability to guarantee a price/spread or source liquidity, potentially transient; HTTP 404 `NoPathsFound` means that the requested route has no market, and HTTP 500 is an unexpected service error. These are distinct from a key-authentication error or a terms/KYC rejection. A later retry may change transient results; no permanent unavailability is claimed. [Provider error definitions](https://docs.etherfuse.com/errors).

## 4. What can be completed without emailing

1. **Create an active sandbox bank account** for the business organization. Etherfuse documents the test business RFC `XEX010101000` for automatic sandbox bank-account approval. Use sandbox/test details, not a real transfer. If the website requests onboarding, complete its sandbox flow. The exact current dashboard labels were not inspected. [Sandbox bank-account instructions](https://docs.etherfuse.com/test-environment).
2. **Bootstrap the Stellar wallet through a first CETES onramp.** The tested 100-MXN quote succeeds when its `walletAddress` is supplied. Etherfuse documents funding/account/trustline setup as part of that route, including an additional onboarding cost. It still needs an actual order and the sandbox deposit-simulation step. [First-time wallet flow](https://docs.etherfuse.com/guides/testing-onramps).
3. **Simulate, do not send, the fiat deposit.** The documented sandbox API action is `POST /ramp/order/fiat_received` with the order ID. No particular dashboard simulation button has been verified. The sandbox cap is 500 MXN per quote. After the order settles, sign the claim/authorization required by that wallet type in the sandbox flow. [Sandbox order simulation](https://docs.etherfuse.com/test-environment).
4. **Verify the wallet now exists and has the intended trustlines/balances.** For a later swap to USDC or USTRY, the receiving trustline also needs to exist. A successful CETES claim does not automatically create every other asset's trustline. [Stellar wallet requirements](https://docs.etherfuse.com/guides/chains/stellar).
5. **Retry the intended USTRY quote with backoff.** Wallet setup enables the settlement prerequisites; it is not a guaranteed cure for a missing USTRY price path. If the same errors persist, use the targeted provider enquiry or book a support session.

This CETES route validates wallet/bootstrap mechanics and can provide test assets for development. It is not a substitution of CETES for Spield's intended USD Treasury yield source, and does not prove a USTRY redemption route.

## 5. When provider contact is useful

For USTRY, ask: “Our sandbox organization is approved, correct sandbox assets are used, and the CETES control quote succeeds. Stellar USTRY returns 424 for swaps and direct ramps; the exact Solana mint returns 500/NoPathsFound. Is there a supported USTRY test route, test-liquidity provisioning, or an alternative fixture?”

Use the [updated enquiry](provider-enquiries.md), an existing support channel, or the team-session link in the [error guide](https://docs.etherfuse.com/errors). There is no evidence that email itself is a mandatory activation step. Written confirmation of the eventual pooled PT/YT and beneficiary-redemption arrangement is still needed before production reliance.
