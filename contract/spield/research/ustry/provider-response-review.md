# Etherfuse reply: integration assessment

**Superseded checkpoint:** A later provider reply identifies and fixes missing sandbox USTRY liquidity, clarifies Spield's registered-wallet redemption model and confirms no yield-only USTRY product exists. Our 27 October recheck returns 200 for both USDC swaps and both MXN routes. Follow [the latest results and wallet steps](liquidity-fix-recheck-2026-10-27.md); the earlier assessment and unsent reply below are retained as history, not the current support request.

## Decision

Continue with **yield-bearing USTRY as the first RWA integration candidate**. The provider has offered test allocations and engineering assistance, and expressed support for Spield-managed pooled Soroban holdings with PT/YT issuance. That is material progress. It does not yet demonstrate an executed test transfer, a working exit or final production operating terms.

Evidence is separated below: the user supplied the email excerpts; local source/evidence establishes which API we used; public Etherfuse documentation establishes how its principal-token product is described. We have not independently accessed the email thread, contacted the engineering team or obtained a promised delivery date.

## 1. Which API did our tests use?

**v1.** The saved [probe](../../scripts/probe_etherfuse_sandbox.py) fixes its base URL to `https://api.sand.etherfuse.com` and uses:

```text
GET  /ramp/me
GET  /ramp/wallets
GET  /ramp/assets?blockchain=stellar&currency=usd&wallet=...
POST /ramp/quote
```

The [saved observation](sandbox-recheck.json) explicitly labels the version `v1 /ramp (documented alongside v2 beta)`. The quote requests used `customerId`, `blockchain`, `quoteAssets` and `sourceAmount`. Both USTRY directions returned HTTP 424; the CETES control returned 200.

Etherfuse's [v1-to-v2 migration guide](https://docs.etherfuse.com/v2/migration-guide) confirms that v2 removes the `/ramp` prefix and uses `POST /organization/{organizationId}/quote`, with payment-account references, `sourceAsset` and `destinationAsset`. It says v1 remains available during migration and existing keys work with both versions. That general documentation does not establish chain-specific deployment readiness.

**Interpretation:** their email about incomplete Stellar v2 rollout is useful deployment guidance, but it does not by itself explain the v1 failures already recorded. We should send the exact v1 endpoint and ask their engineers to provision or identify the supported v1 route, or supply a supported alternative. Do not describe the earlier issue as a confirmed v2 bug, migrate speculatively, or promise that waiting fixes it.

The stated “week or two” is the provider's estimate from the supplied email, not a verified release date. Ask for a readiness signal and supported endpoints before migrating. Their direct test allocation allows contract testing to proceed independently of the acquisition API.

## 2. What their replies resolve

| Topic | New evidence | Remaining work |
|---|---|---|
| Obtaining sandbox USTRY | Provider says test allocations are available and requests a Stellar testnet address | User sends a public wallet address they control; engineering transfers; verify exact asset and amount on-chain |
| Sandbox exit | Provider says engineering will assist with a working exit route | Get the supported API/version and settlement asset; execute and reconcile an actual exit |
| Pooled Soroban holdings and PT/YT | Provider expresses support if Spield manages the structure | Confirm applicable entity/user eligibility, contract/operating-wallet redemption rights and production terms |
| Alternative infrastructure | Provider points to its principal-token product | Identify the specific product/deployment, who controls the vault and who receives yield |
| Stellar v2 | Provider says full deployment is pending | Ask which flows are ready now and how availability will be announced |

The correct status is **provider support in principle and test allocation offered**. We should no longer say they have not replied or that all PT/YT access questions remain unanswered. Equally, a test allocation offer is not a received balance, and an engineering introduction is not a tested exit.

## 3. Their principal token is a different product

The linked [What is a Principal Token?](https://support.etherfuse.com/articles/3677042367-what-is-a-principal-token) article was retrieved directly from Etherfuse's public support site. Its example is **MEXe backed by CETES**. It describes a fixed-denomination claim backed by wrapped Stablebonds; appreciation stays in Etherfuse's vault instead of accruing to the holder. On unwrapping, fewer appreciated bond tokens can satisfy the same nominal principal value. It also describes emergency pauses.

**Engineering consequence:** buying this principal token alone would not give Spield the retained bond yield to distribute to its YT holders. The article does not establish an external yield-right token or a Spield-controlled vault interface. It also does not establish a deployed USD-denominated USTRY principal token on Stellar. Its principal-protection language is a provider product claim, not independent proof of loss handling or uninterrupted redemption.

| Design | Who receives underlying yield? | Fit for the current prototype |
|---|---|---|
| Spield escrows appreciating USTRY and issues its own PT/YT | Spield allocates eligible yield to YT holders under its own rules | Continue this path; preserves the source and accounting we have tested |
| Spield holds an existing Etherfuse fixed-denomination principal token | Article says retained yield stays with Etherfuse | Not a sufficient YT yield source by itself |
| Etherfuse supplies a vault or arrangement where Spield controls or receives the retained yield | Unknown until engineering/commercial details are confirmed | Possible alternative; evaluate as a separate integration with explicit yield rights and loss/exit rules |

MEXe is a peso/CETES example, so it should not be substituted for USD/USTRY exposure. Ask which product the provider intended before changing assets or architecture.

## 4. Reply to send in the existing thread

This draft is **not sent by the agent**. Replace the wallet placeholder with the public `G...` address of a Stellar **testnet** wallet whose signing key you control. A Soroban token contract address or the issuer address is not the requested recipient wallet. Only share the public address.

**Subject:** Re: Spield — Stellar USTRY sandbox integration

Hi team,

Thank you for offering the test allocation and supporting the Spield-managed PT/YT structure.

Our calls were made through **v1**, using `https://api.sand.etherfuse.com/ramp/quote`, with `blockchain: "stellar"`. Both USDC → USTRY and USTRY → USDC returned HTTP 424 (`FailedToGetQuote`); a USDC → CETES control quote succeeded on the same account. We have not used the v2 quote interface in these probes.

Our Stellar testnet recipient wallet is:

`[YOUR PUBLIC STELLAR TESTNET WALLET ADDRESS]`

Could engineering please:

1. Send a small USTRY test allocation and confirm its asset code/issuer, token contract and transfer transaction hash? Our current verified token contract is `CCUGMX7HX6CH6T4XNPALQ7HCVU37RLUNHAYNSAIALTPFHFQVIRIHALBC`; please confirm this is still the intended sandbox asset.
2. Confirm the supported v1 sandbox exit workflow while Stellar v2 is being completed, including whether payout is USDC or simulated fiat? If v1 is not supported for this route, please identify the available alternative and its prerequisites.
3. Confirm whether USTRY can move from this wallet into our Soroban series contract and back, and which onboarding or authorization steps apply when redeeming pooled contract holdings through Spield's operating wallet?

On the principal-token option: the article describes a token such as MEXe where Etherfuse retains the yield. Our YT needs a right to the underlying USTRY yield. Were you suggesting a USTRY-specific principal token, or a vault/integration that Spield could manage while directing the retained yield to our YT holders? Please share the relevant Stellar deployments, interface and yield-ownership model if available.

We will continue testing deposits and payouts in USTRY first, with USDC conversion evaluated separately.

Thanks,
Spield team

## 5. Execution order after replying

1. **Prepare and share the recipient wallet.** Check Stellar testnet activation and the exact USTRY trustline before a direct classic-asset payment, or confirm with engineering that their delivery uses an appropriate claimable-balance/bootstrap flow. The last saved wallet activation check was from 25 October; it is not a current assertion about the wallet.
2. **Verify receipt.** Match network, issuer and SAC; record balance and transaction hash. Recheck discovery if the provider names a different sandbox deployment. No real-money purchase is required for their offered test allocation.
3. **Run a small actual-token contract cycle.** Deploy a fresh isolated series and clearly labeled controlled oracle bound to genuine sandbox USTRY, and exercise deposit, split, claims and in-kind payout. The current prototype has internal PT/YT ledgers, not standalone SEP-41 tokens. It must not be presented as a completed wallet/AMM integration.
4. **Prove the provider exit separately.** Take returned USTRY through the engineering-supported sale/redemption flow. Record actual settlement token/currency, balances, timing, fees and failure behavior. The local prototype and oracle reads alone do not prove this.
5. **Close production questions and price integration.** Obtain the specific operator/user/contract permissions and redemption terms, confirm loss/issuer-control handling and supported NAV/oracle inputs, then implement interoperable tokens and application integration. The live RedStone interface still requires an adapter to this prototype's observation interface.

Keep USDY as a fallback research candidate; there is no evidence in these replies requiring a switch away from USTRY. Prioritize the provider now offering both test allocations and direct engineering assistance, then choose the production source by demonstrated settlement and agreed terms.

## References

- User-supplied Etherfuse email excerpts: test allocation and engineering assistance; conditional support for Spield-managed pooled PT/YT; Stellar v2 rollout estimate. Email timestamps and full headers were not supplied.
- Local [v1 sandbox probe](../../scripts/probe_etherfuse_sandbox.py), [saved API evidence](sandbox-recheck.json) and [scenario prototype](prototype.md).
- Etherfuse [v1-to-v2 migration guide](https://docs.etherfuse.com/v2/migration-guide), [principal-token article](https://support.etherfuse.com/articles/3677042367-what-is-a-principal-token), and [Stellar integration guide](https://docs.etherfuse.com/guides/chains/stellar).
