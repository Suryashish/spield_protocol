# Spield — Instaward Statement of Work
## Second Grant Term

## 1. Project & Team Information

**Project Name:**  
Spield

**Builder / Team Name:**  
Spield

**Primary Contact:**  
Suryashish Kundu / suryashish.k2050@gmail.com

**Product Links:**  
- **GitHub:** [Insert GitHub repository link]
- **Live Site:** [Insert live application link]
- **Product Documentation:** [Insert product documentation link]

**Wallet Address:**  
`GAP3VQBH4ZAOKXPBI6BGRX3FNUVIGGKBX4AM2FKHEENHNQ4CRTGI3AR4`

**Ambassador Chapter:**  
Stellar India

**Ambassador Chapter Lead:**  
Sahitya Roy — Stellar India

**Date Submitted:**  
July 8, 2026

**Suggested Sprint Start Date:**  
July 15, 2026

---

## 2. Instawards Overview & Intent

### 2.1 Instawards Purpose

Instawards are designed to support short, clearly scoped, execution-focused work that helps a project make tangible progress toward building on Stellar. Instawards are intended to fund specific, achievable outcomes that can be completed and demonstrated within 30 days or less.

This Statement of Work represents a shared commitment between the Builder and the Ambassador Chapter Lead regarding what will be delivered, why it matters, and how completion will be verified.

This is Spield’s second Instaward term and builds on the completed first term, during which the core fixed-income protocol, PT/YT architecture, initial mainnet foundations, bridge integration work, user interface improvements, and SDK foundations were developed.

---

# 3. Problem Statement & Objective

## Problem Being Addressed

The first Instaward term established Spield’s core fixed-income infrastructure, but the product is currently still concentrated around Blend as its primary yield source and has a limited market structure. This creates source concentration, restricts the range of available yield opportunities, and prevents users from selecting between multiple investment maturities at the same time.

The next stage is to expand Spield beyond a primarily Blend-based product by integrating real-world asset yield sources, starting with Etherfuse USTRY, a tokenized U.S. Treasury product. This will allow Spield to provide access to a more diversified and RWA-focused yield ecosystem while using the same Principal Token and Yield Token infrastructure.

Spield also needs to support several markets with different maturities concurrently. Users should be able to compare available sources, fixed rates, maturity dates, and market conditions before selecting a position. This is necessary to create a useful fixed-income curve instead of a single-market product.

There are also important user-flow gaps before Spield can scale its real-fund trials:

- Bridging assets and depositing into a Spield market are currently separate actions.
- Users need a single guided bridge-to-deposit journey.
- Users should be able to use their eligible wrapped SR tokens to purchase PT and YT.
- When exiting a PT/YT position, users should be able to select USDC or SR token as their preferred settlement asset.
- The SDK requires complete mainnet configuration so developers can build on top of the live protocol.
- The product needs to be tested with real users and real funds under controlled limits, with initial liquidity and user support provided by the Spield team.

## Objective of This Instaward

At the end of this 30-day Instaward, Spield will support multiple yield sources and concurrent maturity markets, including an Etherfuse USTRY-based RWA market, while allowing users to invest with USDC or eligible wrapped SR tokens and select USDC or SR token as their preferred exit asset.

Spield will also provide a unified bridge-to-deposit user journey, a mainnet-configured SDK, and a controlled real-fund pilot demonstrating that users can bridge, deposit, purchase PT/YT, monitor their position, and exit successfully.

---

# 4. Scope of Work — 30-Day Deliverables

## 4.1 In-Scope Deliverables

### Deliverable 1: Multi-source yield layer and Etherfuse USTRY integration

#### Description

Extend Spield’s yield-source architecture so that Blend and RWA-based sources can operate through a common adapter and market interface.

This deliverable will:

- Integrate Etherfuse USTRY as the first committed RWA yield source.
- Add source configuration, asset and position accounting, valuation, yield tracking, deposit, and redemption flows.
- Add source health status and failure or pause handling.
- Deploy or configure at least one USTRY-backed Spield market.
- Connect the USTRY-backed market to the existing PT/YT lifecycle.
- Preserve the existing Blend integration while making the yield source visible to users at the market level.
- Add documentation for integrating future RWA sources through the same adapter architecture.

#### Why This Matters

This diversifies Spield beyond Blend and introduces tokenized U.S. Treasury exposure as a new source of yield. It creates the foundation for additional RWA sources to be added through adapters without rewriting the core PT/YT protocol.

---

### Deliverable 2: Concurrent maturity markets and flexible asset settlement

#### Description

Add support for multiple markets with different maturity dates operating at the same time. The target is at least three concurrent maturity markets, such as short-, medium-, and long-duration markets, with the final maturity dates shown clearly in the market registry and user interface.

This deliverable will:

- Support at least three distinct maturity markets operating concurrently.
- Include the existing Blend-based product and the Etherfuse USTRY-based product where supported.
- Allow users to compare source, fixed rate, maturity date, available liquidity, and market status.
- Support PT/YT issuance and trading across the different maturity markets.
- Add eligible wrapped SR tokens as an input asset for purchasing PT and YT.
- Allow users to select USDC or SR token as their preferred output asset when selling or redeeming PT/YT, subject to available liquidity and routing for the selected market.
- Add market-level quote, slippage, balance, and liquidity checks.
- Use team treasury funds for initial market and pilot liquidity. This liquidity will not be charged to the grant.

#### Why This Matters

Multiple maturities create a more useful fixed-income market and allow users to select duration according to their objectives. Wrapped SR support expands the addressable user base, while flexible settlement improves usability and allows users to remain within the Stellar ecosystem.

---

### Deliverable 3: Unified bridge-to-deposit journey, mainnet SDK, and real-fund pilot

#### Description

Combine bridging and depositing into one guided user journey. A user should be able to select a supported origin chain and asset, receive a route and transfer status, complete the bridge, establish the required Stellar trustline, select a market, and deposit into a fixed-income position without navigating disconnected workflows.

This deliverable will:

- Combine bridge and deposit into one guided application flow.
- Add bridge status and transfer-history updates.
- Handle trustline creation and transaction-state feedback.
- Allow users to select a maturity market after the bridged funds arrive on Stellar.
- Complete the SDK’s mainnet configuration, including mainnet contract addresses, network configuration, market discovery, rate quotes, deposits, PT/YT purchase and sale, position retrieval, redemption, settlement-asset selection, and solvency or market-status checks.
- Publish updated SDK documentation and a runnable integration example.
- Conduct a controlled real-fund pilot with invited users.
- Use team-funded liquidity and clearly defined transaction limits during the pilot.
- Demonstrate bridge → deposit → PT/YT position → position monitoring → exit or redemption using real funds.

#### Why This Matters

A unified journey reduces the largest onboarding barrier between cross-chain liquidity and Spield markets. Mainnet SDK support turns Spield into an integration primitive for other Stellar applications. The real-fund pilot will validate the product with actual users, identify operational issues, and create a foundation for further growth and ecosystem adoption.

### Specific Implementation Outcomes

The three deliverables will result in the following concrete outcomes:

1. A reusable multi-source yield adapter layer with Etherfuse USTRY integrated.
2. At least three maturity markets available concurrently.
3. Blend and RWA-based markets visible through a common market-selection experience.
4. Wrapped SR available as an investment asset for eligible markets.
5. USDC or SR token available as a user-selected settlement option where supported.
6. A unified bridge-to-deposit flow.
7. Mainnet-ready and mainnet-configured SDK documentation and package configuration.
8. A controlled real-fund pilot with actual user activity, transaction evidence, and operational feedback.

## Out-of-Scope — Explicitly Not Included

The following items are not included in this Instaward:

- Integration of additional named RWA issuers beyond Etherfuse USTRY. The multi-source adapter layer will make future integrations easier, but a second external issuer integration is not committed in this term.
- Professional third-party security audits or formal legal, regulatory, or issuer due diligence.
- Legal or compliance approval for the underlying RWA issuer or tokenized Treasury product.
- MoneyGram, SEP-24, bank, fiat, or cash on/off-ramp integration.
- Uncapped public liquidity deployment or unrestricted public exposure.
- Guaranteed yield, guaranteed returns, or guaranteed market liquidity.
- Grant-funded deposits, user reimbursements, or market-seeding capital. Initial liquidity and pilot-support funds will come from the Spield team treasury.
- Creation of new lending, collateral, leverage, or derivatives products outside the existing PT/YT architecture.
- A full order-book exchange or a new secondary-market design beyond the existing Spield market and AMM infrastructure.
- Native iOS or Android applications.
- Large-scale marketing campaigns or paid user acquisition.
- Expanding to every possible maturity, asset, bridge route, or RWA source within this 30-day term.

---

## 4.2 Deliverable-Aligned Budget Request

### Requested Budget Amount

**$5,000**

### Rationale for Budget Request

The requested $5,000 supports 30 days of focused engineering, integration, product, SDK, testing, and pilot execution by the Spield team.

The grant funds will support development and delivery work. Market-seeding capital and real-fund pilot liquidity will be provided separately by the Spield team from its own treasury.

#### Deliverable 1 — Multi-source yield layer and Etherfuse USTRY integration: **$2,000**

This covers:

- Multi-source adapter and market configuration work.
- Etherfuse USTRY integration.
- Deposit, valuation, yield accounting, and redemption logic.
- Source health and pause-state handling.
- Blend compatibility and regression testing.
- RWA market configuration and documentation.
- Testnet and mainnet deployment/configuration work where available.

#### Deliverable 2 — Concurrent maturity markets and flexible settlement: **$1,500**

This covers:

- Supporting multiple maturity markets simultaneously.
- Market registry and market-selection updates.
- PT/YT support across different maturity dates.
- Wrapped SR investment support.
- USDC or SR token settlement selection.
- Quote, slippage, balance, and liquidity checks.
- Market-level testing and team-funded liquidity coordination.

#### Deliverable 3 — Unified bridge-to-deposit journey, mainnet SDK, and real-fund pilot: **$1,500**

This covers:

- Combining bridge and deposit into one guided application flow.
- Bridge status and transfer-history updates.
- Trustline and transaction-state handling.
- Mainnet SDK configuration.
- Mainnet contract and market configuration.
- SDK documentation and runnable example.
- Pilot onboarding, transaction monitoring, issue resolution, and evidence preparation.

---

# 5. 30-Day Execution Plan & Timeline

## 5.1 Weekly Breakdown

| Week | Planned Work | Expected Output |
|---|---|---|
| **Week 1** | Finalize the multi-source architecture and define the Etherfuse USTRY integration. Confirm asset mappings, source accounting, market configuration, maturity structure, and settlement requirements. Define the target maturity markets and mainnet SDK configuration. | Technical implementation plan completed. Adapter interfaces, USTRY integration requirements, market configuration, and wrapped SR/PT/YT settlement flows defined. |
| **Week 2** | Implement and test the Etherfuse USTRY adapter and RWA market logic. Begin concurrent maturity market support. Add wrapped SR as an eligible input asset and implement the selected settlement-asset flow for USDC and SR token. | USTRY integration functional in the supported test environment. Multiple maturity markets visible and testable. Wrapped SR purchase and settlement flows working in test conditions. |
| **Week 3** | Complete the bridge-to-deposit journey. Add bridge status tracking, trustline handling, market selection, and deposit confirmation. Complete the SDK’s mainnet configuration and publish updated documentation and an integration example. Run end-to-end testing across the supported sources, maturities, and asset paths. | Complete bridge → deposit flow available for testing. Mainnet SDK configuration and documentation ready. End-to-end test results completed for RWA, Blend, maturity, wrapped SR, and settlement flows. |
| **Week 4** | Deploy or configure the approved markets for the guarded real-fund pilot. Seed initial liquidity using the team treasury. Invite pilot users and validate real transactions, including bridge → deposit, PT/YT purchase, position monitoring, and exit or redemption. Monitor errors, liquidity, transaction completion, and user feedback. Fix critical issues and prepare the final evidence package. | At least three concurrent maturity markets available. Etherfuse USTRY integration demonstrated. Real-fund pilot completed with transaction evidence. Mainnet SDK configuration, live user flow, demo recording, documentation, and final report ready for Ambassador review. |

---

# 6. Evidence of Completion

## 6.1 Planned Evidence to Be Submitted

| Deliverable | Evidence Type | Description |
|---|---|---|
| **Deliverable 1** | GitHub links, contract or market addresses, Stellar explorer links, screenshots, test report, transaction hashes | Source adapter implementation, Etherfuse USTRY integration, market configuration, and documentation. Evidence will include USTRY market addresses or configuration links, sample deposit and redemption transactions, source accounting screenshots, and test results showing that the RWA source connects correctly to the PT/YT lifecycle. |
| **Deliverable 2** | Market registry link, explorer links, screenshots, demo video, transaction hashes | Evidence of at least three concurrently available maturity markets, including their source, maturity date, fixed rate, and liquidity status. Demonstration of investing with USDC and eligible wrapped SR. Demonstration of selling or redeeming PT/YT with USDC or SR token selected as the output asset. |
| **Deliverable 3** | Live application URL, screen recording, bridge transaction hash, deposit transaction hash, SDK/npm link, documentation link, pilot report | Short recording of the complete bridge → trustline → deposit journey. Evidence of mainnet SDK configuration, package or repository link, runnable example, and documentation. Pilot summary containing successful real-fund transaction hashes, user-flow screenshots, issues found, fixes applied, and user feedback. |

### Minimum Pilot Evidence

The real-fund pilot evidence will aim to include:

- At least one successful bridge-to-Stellar transfer.
- At least one successful bridge-to-deposit journey.
- At least one PT/YT purchase using USDC.
- At least one PT/YT purchase using eligible wrapped SR.
- At least one exit or redemption settled in USDC.
- At least one exit or redemption settled in SR token where supported.
- Screenshots or recordings showing the user journey and transaction status.
- Public explorer links for the relevant transactions.

## 6.2 Evidence Verification Checklist — For Ambassador Use

| Deliverable | Evidence Present | Evidence Partial | Evidence Missing | Comments |
|---|---:|---:|---:|---|
| **Deliverable 1: Multi-source yield layer and Etherfuse USTRY integration** | ☐ | ☐ | ☐ |  |
| **Deliverable 2: Concurrent maturity markets and flexible settlement** | ☐ | ☐ | ☐ |  |
| **Deliverable 3: Bridge-to-deposit journey, mainnet SDK, and real-fund pilot** | ☐ | ☐ | ☐ |  |

---

# 7. Next-Step Alignment

## 7.1 Anticipated Next Step After Completion

After this Instaward, the most likely next step is:

☑ **Apply to SCF Build Award**  
☑ **Continue development independently**  
☐ **Apply for a follow-on Instaward, if eligible**  
☑ **Seek other ecosystem support**  
☐ **Other:** ______________________________

The primary next step will be to pursue SCF Build Award support for broader security review, additional RWA integrations, deeper liquidity, and continued product growth. Spield will also continue operating and improving the product independently based on feedback from the real-fund pilot.

---

# 8. Instawards Constraints Acknowledgement

By submitting this SOW, the Builder acknowledges:

☑ This scope will be completed within 30 days or less.  
☑ Instawards support execution, not open-ended exploration.  
☑ A project may receive no more than two follow-on Instawards.  
☑ Each Instaward is capped at $5,000.  
☑ Total Instawards funding may not exceed $15,000.

---

# 9. Submission Confirmation

Once finalized, this Statement of Work will be submitted by the Ambassador Chapter Lead through the Instawards Airtable submission form for review and approval.
