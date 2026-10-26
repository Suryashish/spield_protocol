# Stellar sandbox USTRY: availability confirmed

Rechecked **25 October 2026, 20:31 IST** in response to the supplied [USTRY product URL](https://sandbox.etherfuse.com/bonds/BoTpvjYEDn8esZDrBkipexoUMeSBQ9DDG6A5mtzsDGSt).

**The user is correct: USTRY is listed for Stellar in Etherfuse's sandbox, and its Stellar testnet token contract is callable.** The URL contains the Solana mint, but the corresponding product catalog entry includes multiple chains, including Stellar. Describing the URL simply as “the Solana version” without that qualification was misleading.

The HTML page remains inaccessible to automated requests. These conclusions use fresh public catalog data, authenticated asset discovery and direct Stellar testnet simulations.

| Check | Fresh result |
|---|---|
| Public sandbox USTRY catalog | Includes Stellar and Solana |
| Authenticated Stellar asset discovery | Includes `USTRY:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4` |
| Stellar testnet SAC | `CCUGMX7HX6CH6T4XNPALQ7HCVU37RLUNHAYNSAIALTPFHFQVIRIHALBC` |
| Direct SAC `symbol()` simulation | Success: `USTRY` |
| Direct SAC `decimals()` simulation | Success: `7` |
| RPC ledger reported by both simulations | `5383373` |
| Etherfuse catalog's Stellar supply | `0.0` at inspection; issuer-reported metadata, not an independent reserve/liquidity verification |
| 10 sandbox USDC → USTRY quote | HTTP 424 |
| 10 sandbox USTRY → USDC quote | HTTP 424 |
| Same-account USDC → CETES control quote | HTTP 200 |

The remaining failed check is obtaining a priced USTRY trade/settlement route. It is **not** whether a Stellar USTRY contract exists. A valid token contract, an asset listing and an executable quote are separate checks.

No order was created and no transaction was submitted. Raw evidence:

- [Multi-chain catalog](sandbox-availability-recheck.json)
- [Direct token-contract simulations](sandbox-token-rpc.json)
- [Fresh authenticated quote checks](sandbox-recheck.json)

This confirms that the real sandbox token can be targeted by the contract prototype. Acquiring funded USTRY for an issuer-backed end-to-end test remains unresolved. Wallet bootstrap and the optional sandbox fiat route are described in the [setup notes](sandbox-setup-next-steps.md).
