# Etherfuse sandbox account and USTRY checks

Verified **25 October 2026, 20:04 IST**. API run: [sandbox-observation.json](sandbox-observation.json). Public token verification: [sandbox-token.json](sandbox-token.json).

**Later follow-up, approximately 20:21 IST:** [Address and setup investigation](sandbox-setup-next-steps.md) confirms the supplied bond link is the Solana devnet mint, while the earlier tests used correct Stellar sandbox identifiers. It also finds no sandbox bank account and an unactivated Stellar wallet. A 100-MXN CETES onramp quote succeeds; USTRY routes still fail across the tested paths. Ordinary sandbox setup can proceed without email.

## Result

**The supplied key authenticates successfully against Etherfuse's sandbox. The account reports approval, and USTRY exists in the supported Stellar asset list. Both USTRY quote directions currently fail with HTTP 424, while the USDC-to-CETES control succeeds.**

This closes the account-creation and sandbox-token-discovery questions. It does not establish a completed USTRY purchase/redemption, production access, or approval of pooled PT/YT products.

## Checks performed

| Check | Result |
|---|---|
| Local credential | `etherfusekey` loaded directly from the contract directory's ignored `.env`; not included in output/evidence |
| `GET /ramp/me` on sandbox | HTTP 200; `approvedAt` present; default partner fee 0 bps |
| Existing wallet inventory | One Stellar and one Solana wallet; Stellar wallet reports claimed organization ownership |
| `GET /ramp/assets` with Stellar, USD sorting and wallet | HTTP 200; USTRY and USDC listed |
| Quote: 10 sandbox USDC → USTRY | HTTP 424, quote path unavailable |
| Quote: 10 sandbox USTRY → USDC | HTTP 424, quote path unavailable |
| Control quote: 10 sandbox USDC → CETES | HTTP 200; approximately 162.38648139 CETES, quoted fee 0.02 USDC / 20 bps |
| Public testnet USTRY asset identity | Found; SAC `CCUGMX7HX6CH6T4XNPALQ7HCVU37RLUNHAYNSAIALTPFHFQVIRIHALBC` |
| Orders, swaps, signing and funding | None performed |

The USTRY error returned by Etherfuse was: `FailedToGetQuote`. This is a route-pricing failure, not evidence that the key is invalid. The [swap guide](https://docs.etherfuse.com/guides/testing-swaps) describes HTTP 424 as a potentially transient sandbox liquidity/path issue. The tests do not determine its exact cause or establish that the production route has the same problem.

The CETES control supports the conclusion that this account, authentication and request shape can obtain a quote. Its fee must **not** be treated as a verified USTRY fee. A quote is not a completed trade or proof of future liquidity.

## Exact sandbox assets

```text
USTRY:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4
USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
```

These are sandbox/testnet identifiers. They differ from the mainnet assets in the oracle report. USTRY's `currency` metadata was null in the authenticated asset response; that observation alone does not explain the quote failure.

## Repeat the check

From `website/contract/spield/scripts`:

```sh
npm run probe:etherfuse-sandbox
npm run test:etherfuse-sandbox
```

The probe uses Python's standard library. Its authenticated host is fixed to `https://api.sand.etherfuse.com`, and its endpoint allowlist contains account/wallet/asset reads and quote creation only. It has no order, swap, wallet-registration, signing or production mode. Account and wallet IDs, API keys, quote IDs and arbitrary provider response bodies are excluded from saved evidence.

For GET-only verification, run:

```sh
python3 -B probe_etherfuse_sandbox.py --read-only --out ../research/ustry/sandbox-readonly.json
```

Exit 0 from the normal probe means both USTRY quote directions returned quotes. Exit 2 records incomplete checks, including the observed HTTP 424 failures. It does not turn a partially successful discovery run into a successful redemption result.

**Validation:** 11 new offline Python tests pass. They exercise local key parsing, evidence redaction, endpoint restrictions, credential-redirect rejection, quote/control classification and failed-route behavior. The 46 existing/new JavaScript operational tests remain separate from these API checks.

## What to do next

1. **Complete the self-service sandbox bootstrap** described in [the follow-up](sandbox-setup-next-steps.md): an active test bank account, a first simulated CETES onramp, and wallet activation/trustlines. If USTRY quote errors persist, use the [updated Etherfuse enquiry](provider-enquiries.md) to request a supported USTRY test path. Email is not a mandatory sandbox activation step.
2. **Continue the isolated contract prototype.** Use the discovered testnet token identity where appropriate, with a clearly labeled controlled oracle for falling-NAV and stale-feed cases. Issuer replies are needed for production decisions, not for local accounting experiments.
3. **Complete a sandbox purchase and redemption after quotes work.** That will require available test tokens, wallet signing and settlement observation. No full round trip has been completed yet.
4. **Resolve production terms separately.** Sandbox approval, a functioning API key and a successful control quote do not establish the legal beneficiary/redemption structure or production USTRY liquidity.

The RedStone enquiry remains useful for NAV effective-time and source-methodology questions before production. It need not delay local prototype work.
