# USTRY provider enquiries

**Latest response and verification, 27 October:** Etherfuse says its missing Stellar sandbox liquidity is fixed; our four USTRY quote routes now return 200. It identifies Spield as the KYB'd customer using its registered `G...` wallet for provider purchases/redemptions, with Spield managing pooled contracts and its own tokens. There is no provider product giving users only USTRY yield. See [verified results and required wallet actions](liquidity-fix-recheck-2026-10-27.md); the earlier drafts below are historical references.

**Status update:** The user has contacted Etherfuse and shared replies offering test allocations and engineering assistance, and supporting Spield-managed pooled PT/YT in principle. The original drafts below are retained for reference; the exact sent message was not supplied. The RedStone enquiry remains unsent by the agent. Use the [provider response assessment and focused reply](provider-response-review.md) for the next message. Production terms and a working issuer exit remain unverified.

**Setup follow-up:** Email is not required for standard sandbox activation. There is no sandbox bank account yet, and the registered Stellar wallet is not activated on-chain. A first simulated CETES onramp has a successful quote and can address those wallet prerequisites. This does not establish the cause of the USTRY quote failures. See [website/setup next steps](sandbox-setup-next-steps.md).

## 1. Etherfuse: redemption, eligibility and sandbox access

Suggested route: the demo/contact route on [Etherfuse](https://etherfuse.com/products/stablebonds), with legal questions directed to `legal+stablebonds@etherfuse.com`, the address published in the [current customer agreement](https://api.etherfuse.com/legal/customer-agreement/plaintext). Confirm the contact is current before sending business documents.

**Subject: Spield — Stellar USTRY integration, pooled redemption and PT/YT eligibility**

Hello Etherfuse team,

We are evaluating USTRY as a Treasury yield source for Spield, a Stellar/Soroban protocol that separates principal and future yield into PT and YT claims. Our first proposed integration would accept USTRY and return USTRY, with explicit USD accounting. USDC conversion would be a separate service evaluated later.

We have verified the USTRY Stellar asset and RedStone's live USD oracle. Before proceeding beyond an isolated prototype, please help us establish:

**Current sandbox issue:** Our approved business account has a Stellar wallet with claimed organization ownership. `GET /ramp/me`, `GET /ramp/wallets` and `GET /ramp/assets?blockchain=stellar&currency=usd&wallet=...` return HTTP 200. USTRY is listed as `USTRY:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4`. However, `POST /ramp/quote` returns HTTP 424 / `FailedToGetQuote` for both 10 USDC → USTRY and 10 USTRY → USDC, using sandbox USDC `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`. A 10 USDC → CETES control quote succeeds on the same account. Please confirm whether the USTRY sandbox path needs provisioning/liquidity, the supported test-funding route, and any account-specific requirements. These were quote-only checks; no order or swap was executed.

Further checks: the Stellar wallet is registered but not yet activated on-chain, and no sandbox bank account is linked. We have a successful 100-MXN CETES quote for its documented first-onramp bootstrap. Smaller USTRY swaps and direct Stellar USTRY onramp/offramp quotes still return 424. The exact Solana devnet mint from the bond page (`BoTpvjYEDn8esZDrBkipexoUMeSBQ9DDG6A5mtzsDGSt`), paired with the live-discovered sandbox payment mint, returns 500 for purchase and 404 `NoPathsFound` for reverse swaps. Are there supported USTRY test-liquidity/issuance paths distinct from the ordinary wallet bootstrap?

1. **Product eligibility:** Can an approved operating entity hold pooled USTRY in a Soroban contract and issue SR, principal, yield and LP interests? Your holder terms address equivalent derivative positions. Which restrictions must apply to the entity, beneficiaries and subsequent PT/YT transfers?
2. **Redemption rights:** Who may redeem USTRY held in a contract for multiple users? Does onboarding the operator suffice, or must every beneficiary be identified and eligible? How are claims handled if the operator is unavailable?
3. **Settlement:** Which primary USTRY redemption routes are available on Stellar today? Please specify USTRY-to-USDC versus fiat, payout currencies, supported wallet types, contract-address support, order cutoffs, normal/worst-case timing, weekends/holidays, and suspension policies.
4. **Economics and capacity:** What are USTRY-specific minimums, per-order/daily limits, spreads, commissions and redemption fees? Does the published rate/NAV already include commissions and withholding? Can you provide the applicable commercial schedule and redemption SLA?
5. **Issuer controls:** Horizon currently reports `auth_required=false`, `auth_revocable=true` and `auth_clawback_enabled=true` for the issuer. What policy governs deauthorization/clawback of contract balances? Which controls apply to new contract holdings, and what notice/recovery process exists?
6. **NAV and legal claims:** Which legal entity owes the USTRY claim on Stellar? Please provide the current governing documents, custody chain, latest USTRY reserve reconciliation, valuation policy, NAV effective timestamps, and the treatment of valuation revisions/losses.
7. **Sandbox:** USTRY asset discovery now works, but its quote routes do not. Please identify the supported acquisition/redemption workflow, test limitations and whether an alternative supported fixture or API version is required.
8. **Onboarding:** Our sandbox account reports approval. What production KYB/KYC and distribution/integration process should Spield follow? We can provide operating-entity and intended-market information through the appropriate onboarding channel.

Please identify which answers can be relied upon for this specific operating model and which require additional legal or commercial approval.

Thank you,
Spield team

## 2. RedStone: USTRY source methodology and deployment assurance

Suggested contact: `core@redstone.finance`, published in the [provider repository](https://github.com/redstone-finance/redstone-oracles-monorepo). This enquiry is also unsent.

**Subject: Spield — production USTRY/USD SEP-40 methodology and consumer requirements**

Hello RedStone team,

We are evaluating USTRY/USD for a Stellar principal/yield product. We have read these mainnet contracts:

- USTRY feed: `CAEGYZFAJ3HLSDBUIVJ77SK5HLLS4MPE4LO5OB2W3L2TEDMAS6RCTMZ4`
- Adapter: `CA526Y2NQWGWVVQ7RFFPGAZMU66PSYJ3UC2MTVAV4ZU7OM5BOPHDXUSG`
- SEP-40: `CBMGLKUQZVSAIL5CPDDAWSUY7MAKXISHMOZEVLMBUWBMFGHRJSR4WYRF`
- Asset: `Stellar(CBLV4ATSIWU67CFSQU2NVRKINQIKUZ2ODSZBUJTJ43VJVRSBTZYOPNUR)`

Live reads show a USD base, 8 decimals and 43,200-second resolution. The published USTRY relayer overrides specify a 0.1% deviation trigger and 12-hour heartbeat. Our observed price agreed closely with Etherfuse's public token-cost API.

Please confirm:

1. Are these the supported production contracts and asset mapping? Where are deployment changes and code upgrades announced? Is there a reproducible build/audit mapping for their deployed WASM hashes?
2. What exact upstream sources and calculation are used for USTRY: issuer NAV/API, Solana BondPrice account, market prices, or a composite? How are data-provider independence, outliers, unavailable sources and NAV revisions handled?
3. Does a fresh signed package timestamp represent a newly valued NAV, or can unchanged/stale underlying NAV be republished with a new timestamp? Is there a separate NAV effective-time or reserve-status signal?
4. Are the 0.1%/12h settings the supported current policy? What delays are normal during weekends/holidays, and what consumer staleness policy do you recommend?
5. The source permits owner-controlled feed mapping, decimal precision, resolution and code changes. What current ownership, signing, notice and incident-response arrangements apply?
6. History currently returns ten chronological records. What retention, ordering, exact timestamp lookup and maturity-valuation guarantees are supported? Can historical valuation changes be queried after a revision?
7. Is a USTRY-specific Stellar testnet feed available, and what behavior differs from mainnet?

We will keep source valuation and executable redemption liquidity separate. We would appreciate written consumer requirements for this use case.

Thank you,
Spield team

## 3. Account setup sequence

1. **Completed:** a business account/API key is available; sandbox authentication and approval were verified. [Initial setup](https://docs.etherfuse.com/initial-setup).
2. **Partially completed:** authenticated Stellar asset discovery confirms USTRY and its testnet issuer. Both USTRY quote directions returned HTTP 424; ask Etherfuse to resolve the route before attempting funded orders.
3. Use server-side credentials through the project's normal secret-management process. The oracle probe requires no API key or wallet secret.
4. Complete production onboarding only after entity, jurisdiction and beneficiary requirements have been established. A sandbox approval does not grant production eligibility.
5. The [provider reply review](provider-response-review.md) now records support in principle for Spield-managed pooled PT/YT and an offered test allocation. Confirm the precise production design, rights and settlement terms; no completed primary redemption is recorded.

## 4. Evidence required to close step 2

| Required answer | Current status |
|---|---|
| Pooled contract holding and PT/YT terms accepted | Provider supports Spield-managed structure in principle; detailed production terms pending |
| Eligible entity, users, countries and transfer policy | Awaiting provider response |
| Party entitled to primary redemption | Provider identifies Spield's KYB'd organization as the customer; its own registered wallet buys/redeems |
| Stellar payout currency, minimum, fees, capacity and timing | Sandbox USDC and MXN routes both quote successfully; actual settlement and production economics/timing remain unverified |
| Contract-address or operating-wallet settlement process | Provider purchases/redemptions use registered `G...` wallet; Spield may hold/issue against USTRY in its contracts in between |
| USTRY sandbox token and round-trip order results | All four quote routes now verified; registered wallet still holds zero USTRY; receipt and signed round trip pending |
| Controls, NAV effective time and current USTRY reserve evidence | Awaiting provider response |
