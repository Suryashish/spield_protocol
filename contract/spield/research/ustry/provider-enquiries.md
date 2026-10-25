# USTRY provider enquiries

Prepared 25 October 2026. **Drafts only; not sent.** Spield currently has no Etherfuse business account or existing provider contact. Primary access and product approval are unconfirmed.

## 1. Etherfuse: redemption, eligibility and sandbox access

Suggested route: the demo/contact route on [Etherfuse](https://etherfuse.com/products/stablebonds), with legal questions directed to `legal+stablebonds@etherfuse.com`, the address published in the [current customer agreement](https://api.etherfuse.com/legal/customer-agreement/plaintext). Confirm the contact is current before sending business documents.

**Subject: Spield — Stellar USTRY integration, pooled redemption and PT/YT eligibility**

Hello Etherfuse team,

We are evaluating USTRY as a Treasury yield source for Spield, a Stellar/Soroban protocol that separates principal and future yield into PT and YT claims. Our first proposed integration would accept USTRY and return USTRY, with explicit USD accounting. USDC conversion would be a separate service evaluated later.

We have verified the USTRY Stellar asset and RedStone's live USD oracle. Before proceeding beyond an isolated prototype, please help us establish:

1. **Product eligibility:** Can an approved operating entity hold pooled USTRY in a Soroban contract and issue SR, principal, yield and LP interests? Your holder terms address equivalent derivative positions. Which restrictions must apply to the entity, beneficiaries and subsequent PT/YT transfers?
2. **Redemption rights:** Who may redeem USTRY held in a contract for multiple users? Does onboarding the operator suffice, or must every beneficiary be identified and eligible? How are claims handled if the operator is unavailable?
3. **Settlement:** Which primary USTRY redemption routes are available on Stellar today? Please specify USTRY-to-USDC versus fiat, payout currencies, supported wallet types, contract-address support, order cutoffs, normal/worst-case timing, weekends/holidays, and suspension policies.
4. **Economics and capacity:** What are USTRY-specific minimums, per-order/daily limits, spreads, commissions and redemption fees? Does the published rate/NAV already include commissions and withholding? Can you provide the applicable commercial schedule and redemption SLA?
5. **Issuer controls:** Horizon currently reports `auth_required=false`, `auth_revocable=true` and `auth_clawback_enabled=true` for the issuer. What policy governs deauthorization/clawback of contract balances? Which controls apply to new contract holdings, and what notice/recovery process exists?
6. **NAV and legal claims:** Which legal entity owes the USTRY claim on Stellar? Please provide the current governing documents, custody chain, latest USTRY reserve reconciliation, valuation policy, NAV effective timestamps, and the treatment of valuation revisions/losses.
7. **Sandbox:** Is USTRY available through your Stellar sandbox? Please identify the supported API version, asset discovery endpoint, test token, acquisition flow, redemption flow and test limitations. If it is not available, is there a supported fixture?
8. **Onboarding:** What KYB/KYC and distribution/integration process should Spield follow? We can provide operating-entity and intended-market information through the appropriate onboarding channel.

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

1. The Spield account owner signs up at the [Etherfuse sandbox](https://sandbox.etherfuse.com/), creates a business organization and follows the documented sandbox KYB approval workflow. [Initial setup](https://docs.etherfuse.com/initial-setup).
2. Obtain the current API version and read the supported Stellar assets. Confirm **USTRY**, its issuer, and both purchase/redemption pair availability before building authenticated order logic.
3. Use server-side credentials through the project's normal secret-management process. The oracle probe requires no API key or wallet secret.
4. Complete production onboarding only after entity, jurisdiction and beneficiary requirements have been established. A sandbox approval does not grant production eligibility.
5. Record the provider replies and the exact approved design here. Until then, primary redemption and PT/YT eligibility remain **unconfirmed**.

## 4. Evidence required to close step 2

| Required answer | Current status |
|---|---|
| Pooled contract holding and PT/YT terms accepted | Awaiting provider response |
| Eligible entity, users, countries and transfer policy | Awaiting provider response |
| Party entitled to primary redemption | Awaiting provider response |
| Stellar payout currency, minimum, fees, capacity and timing | Awaiting provider response |
| Contract-address or operating-wallet settlement process | Awaiting provider response |
| USTRY sandbox token and round-trip order results | Awaiting account setup and authenticated verification |
| Controls, NAV effective time and current USTRY reserve evidence | Awaiting provider response |
