# Instaward 2 (first follow-on): Statement of Work, with options

Draft content for every field of the second Instaward SOW, written against what is true on
**2 October 2026** and checked against the chain and the repo, not against status documents.

**How to use this file**

- Text inside a `>` block is the answer to paste into the form. Everything outside a `>` block
  is a note for you and does not go on the form.
- Where a section has options, **the recommended one is always listed first**. If you want one
  answer and no decisions, take the first option in every section: together they make one
  consistent SOW (Package 1).
- The options are not free to mix. Problem, deliverables, budget, timeline and evidence have to
  tell the same story, so choose a **package** in section 0.3 first and then copy the matching
  blocks.
- `[[ ... ]]` marks a blank only you can fill.

---

## 0. Read this first

### 0.1 Where Spield actually stands today

Read from mainnet on 1 October 2026, 19:10 UTC, plus npm and Horizon. These are the facts every
option below is built on.

| Fact | Value | Why it matters for this SOW |
|---|---|---|
| Series 1 maturity | Passed. `is_expired = true` since 30 September 2026, 23:09 UTC | The first series ran its full term on real USDC |
| Can a new user open a fixed-rate position? | **No.** The vault rejects deposits after maturity (`VaultExpired`) and there is no Series 2 | This is the real blocker, and it is new since Instaward 1 |
| Total value held | 4.15 USDC of the 50 USDC cap | Small, and mostly our own seed. Do not describe Series 1 as having "users" |
| Vault receipts | 1 open receipt, 1.00 USDC owed, **not yet redeemed** | The Series 1 redeem hash promised in Instaward 1 does not exist yet |
| PT/SR market | Seeded, about 2 USDC of liquidity in total | Enough to show it works, far too thin to trade against |
| Admin of all six contracts | The 2-of-3 multisig | Unchanged since 1 September |
| Per-address deposit limit | Does not exist. The cap is global only | Committed in Instaward 1, delivered half |
| Property or fuzz tests | None in the workspace | Named as "next" in the Instaward 1 report |
| `@spield/sdk` | 0.4.3 on npm, testnet only, single series. npm shows 623 downloads in the 30 days to 29 September | That counter includes automated mirrors, so quote it with that caveat or not at all |
| Payout wallet `GCZ4…KZ4Y` | Exists on mainnet, funded, USDC trustline present | It is a **different address** from the Instaward 1 form (`GAP3…3AR4`) |

### 0.2 Do these before you submit

| # | Action | Why |
|---|---|---|
| 1 | **Redeem the open Series 1 receipt on mainnet and keep the transaction link.** | Instaward 1 said "the live series' own redeem hash follows on 30 September and we will submit it then". It is two days overdue and takes one transaction. Arriving at a second SOW with that promise already kept is worth more than any sentence in this file. Every option below assumes you do this; if it is done before submission, change "will be published" to "is published" and add the link. |
| 2 | Fix the two dates in section 1. | Your pasted template still says 8 July and 15 July 2026. |
| 3 | Confirm the wallet change is intended. | The reviewer may notice the address differs from Instaward 1. |
| 4 | Fill the Product Doc link. | I could not find a deployed docs URL in the repo, only the `docs/` source. |
| 5 | Check whether the GitHub repo is public. | Several evidence rows are links to code and CI runs. If the repo is private, switch those rows to PDFs and screenshots. |
| 6 | Submit the Customer Development Plan alongside this. | It is required for follow-on funding and is already drafted in `website/contract/spield/secondform.md`. Its numbers (cap, addresses, SDK version) must match this SOW. |

### 0.3 Choose a package

All three packages share the same first deliverable, because reopening the product is not
optional: with no open series there is nothing for a user, an auditor or a builder to look at.

| | Package 1: Always open *(recommended)* | Package 2: Safety first | Package 3: Growth led |
|---|---|---|---|
| Deliverable 1 | Card A: Series 2, repeatable launch, rollover | Card A | Card A |
| Deliverable 2 | Card B: Audit readiness and continuous verification | Card B | Card C: SDK reads mainnet |
| Deliverable 3 | Card C: SDK reads mainnet | none (the form marks it optional) | Card D: Discovery and first depositors |
| Budget | $5,000 | $4,000 | $5,000 |
| My estimate of effort | About 5.5 of 8 available developer-weeks | About 4 of 8 | About 5.5 of 8 |
| Depends on third parties | No | No | Partly (listing maintainers, people agreeing to talk) |
| Best argument for it | Fixes continuity, clears the path to the audit, and opens the builder channel. Everything is in your control | Smallest and hardest to miss. Strong if the Chapter Lead felt Instaward 1 was overscoped | Answers "who is using it?" most directly |
| Weakest point | Three deliverables is the full allowance | Least visible progress for a reviewer | Defers audit preparation, and the audit is what lifts the cap |

**Why Package 1.** The honest weakness of Spield today is that it is capped at 50 USDC and has
almost no deposits. The cap only moves after an audit, and the audit only starts well if the
preparation is done. Package 1 is the only one that works on both the product being open and
the cap being lifted, and none of its evidence depends on anyone outside the team. Package 3 is
tempting, but user numbers under a 50 USDC cap will look small whatever you do, and promising
them in an SOW turns an outcome you do not control into a deliverable you can fail.

The estimates in the effort row are mine, from reading the existing scripts and code. They are
not measured. Sanity-check them against how long Instaward 1 really took.

---

# 1. Project & Team Information

> **Project Name:** Spield
>
> **Builder / Team Name:** Spield
>
> **Primary Contact (Name + Email):** Suryashish Kundu / suryashish.k2050@gmail.com
>
> **Product Links:**
> GitHub: https://github.com/Suryashish/spield_protocol
> Live site: https://www.spield.live
> App: https://app.spield.live
> Public solvency page: https://app.spield.live/solvency
> SDK: https://www.npmjs.com/package/@spield/sdk
> Product Doc: `[[ link ]]`
>
> **Wallet Address:** GCZ4OWEMZMQHRA5FQNWVMQ4WTNMIUB4KNMWRY67HKHQZJACYND6PKZ4Y
>
> **Ambassador Chapter:** Stellar India
>
> **Ambassador Chapter Lead:** Sahitya Roy (Stellar India)
>
> **Date Submitted:** `[[ 2 October 2026, or the day you actually submit ]]`
>
> **Suggested Sprint Start Date:** `[[ see options ]]`

**Sprint start options**

| Option | Start | 30-day sprint ends | Note |
|---|---|---|---|
| A *(recommended)* | Monday 12 October 2026 | 10 November 2026 | Ten days for review, and a clean Monday start |
| B | Friday 9 October 2026 | 7 November 2026 | Seven days after submission, the same gap as Instaward 1 |
| C | Monday 19 October 2026 | 17 November 2026 | Use this if the Customer Development Plan review is likely to take longer |

The GitHub link is taken from the notes in `secondform.md`. Confirm it is the one you want
reviewers to open.

---

# 2. Instawards Overview & Intent

Boilerplate supplied by the programme. Leave it exactly as it is on the form.

---

# 3. Problem Statement & Objective

## 3.1 Problem Being Addressed

### Option A *(recommended, pairs with Package 1)*: the first series matured, and there is no second one

> Instaward 1 took Spield from a testnet build to a guarded launch on Stellar mainnet. Six
> contracts have been live since 1 September 2026, custody sits with a 2-of-3 multisig, USDC
> arrives from six EVM chains and Solana through Circle's CCTP, and the solvency page and SDK are
> public. The first fixed-rate series then ran its full 30-day term on real USDC and matured on
> 30 September 2026.
>
> Maturity is where the next problem appeared. A fixed-income product is only useful if a term
> is always open to deposit into, the way a bank always has a term deposit on offer. Spield has
> exactly one series, and it has ended. Three scoped gaps now stand between "one series
> launched" and "a fixed-income market that stays open":
>
> 1. **There is nothing to deposit into, and no way to roll over.** Each series has a maturity
>    that is fixed permanently at deployment, by design, so a matured series refuses new
>    deposits. Launching the next one is today a manual deployment of six contracts, the app
>    knows about one series only, and a depositor whose term has ended has no path into a new
>    term. As of today, a new user arriving at Spield on mainnet cannot open a fixed-rate
>    position.
> 2. **The protocol is not yet ready to hand to an auditor, and the audit is what lifts the
>    cap.** Deposits are capped at 50 USDC on chain until a professional audit clears, and we
>    intend to keep that promise. Our own Instaward 1 report named what an auditor would find
>    first: the 605 automated tests are example-based, with no property or fuzz testing of the
>    pricing curve; the deposit cap is global, and the per-address limit we committed to is
>    still missing; and the live deployment is verified by hand, not continuously. Until these
>    are closed the audit cannot start efficiently and the cap cannot move.
> 3. **Builders can only use Spield on testnet.** The SDK is published on npm, but it reads
>    testnet only and knows about a single series, so a wallet or treasury tool cannot yet show
>    a real Spield rate or a real position.
>
> This is the right moment because Series 1 has just matured: every week without a successor is
> a week the product is closed. The work is finite and reuses almost everything Instaward 1
> built. The deployment scripts, the multisig, the app and the SDK already exist. This sprint
> makes them repeatable, verifiable and ready for an audit.

### Option B *(pairs with Package 2)*: unaudited is the ceiling

> Instaward 1 put Spield on Stellar mainnet as a guarded launch: six contracts live since
> 1 September 2026, a 2-of-3 multisig holding every admin role, and a 50 USDC deposit cap
> enforced on chain. The first 30-day series ran its full term on real USDC and matured on
> 30 September 2026.
>
> The cap is the whole safety argument for an unaudited protocol, and it stays until a
> professional audit clears. That makes audit readiness the one gate on everything else, and
> today Spield is not ready to hand over. Two scoped gaps remain:
>
> 1. **The safety work our own Instaward 1 report listed as unfinished.** The 605 automated
>    tests are example-based, with no property or fuzz testing of the pricing curve, which is
>    the class of test that finds curve bugs. The cap is global, and the per-address limit we
>    committed to is missing. The live contracts are verified by hand, not continuously, and the
>    monitoring has never been forced to raise an alarm to prove that it reaches a person.
> 2. **The product is closed while that work happens.** Maturity is fixed permanently per
>    series, the only series has matured, and opening the next one is a manual six-contract
>    deployment. A new user cannot open a fixed-rate position on mainnet today.
>
> Both are finite and inside our control. Closing them means the audit funded through the SCF
> Build Award can begin without a preparation phase, and the product stays open while it runs.

### Option C *(pairs with Package 3)*: proven mechanics, unproven demand

> Instaward 1 proved that Spield works on Stellar mainnet. Six contracts have been live since
> 1 September 2026 under a 2-of-3 multisig, and the first 30-day fixed-rate series ran its full
> term on real USDC and matured on 30 September 2026.
>
> What it did not prove is demand. Series 1 closed holding about 4 USDC of its 50 USDC cap, most
> of it our own seed. The cap stays until an audit clears, so the question for this sprint is
> not how much is deposited but whether real people and real builders can reach the product at
> all. Today three things stop them:
>
> 1. **There is nothing to deposit into.** Maturity is fixed permanently per series, the only
>    series has ended, and there is no way to roll a matured position into a new term.
> 2. **Builders can only use Spield on testnet.** The published SDK cannot read a real rate or a
>    real position, so no wallet or treasury tool can show Spield to its own users.
> 3. **Spield is invisible where Stellar users look, and has no track record to point to.** It
>    is not listed on the trackers and directories this audience uses, its contracts show up as
>    unlabelled addresses, and the one settled maturity is not published anywhere a newcomer can
>    check it.
>
> Series 1 has just matured, which makes this the moment: there is now a completed term to show,
> and no open term to send anyone to.

**Notes.** Option A is the only one that does not lead with the small TVL, and that is
deliberate, not evasive: the public solvency page shows the number to anyone, and the Customer
Development Plan deals with demand directly. If the Chapter Lead raised usage in the Instaward 1
review, borrow the second paragraph of Option C into Option A.

Every option says a new user cannot open a fixed-rate position today. That is verified
(`srvault` rejects deposits after maturity), and it is the strongest sentence in the document
because the reviewer can confirm it in the app.

## 3.2 Objective of This Instaward

### Option A *(recommended, Package 1)*

> At the end of 30 days, a second fixed-rate series is open on Stellar mainnet under the same
> guarded cap, launched through a repeatable and verified process, and a depositor in a matured
> series can redeem and roll into the open one from the app. The protocol is packaged for audit,
> with property and fuzz testing, a per-address deposit limit and continuous public verification
> of the live contracts, and the SDK reads live mainnet data across every series.

### Option B *(Package 2)*

> At the end of 30 days, Spield is ready to hand to an auditor: property and fuzz testing, a
> per-address deposit limit, continuous public verification of the live contracts, alarms proven
> to fire, and a written audit package. A second fixed-rate series is open on mainnet under the
> same guarded cap, with rollover from the matured one, so the product stays live while the
> audit is arranged.

### Option C *(Package 3)*

> At the end of 30 days, a second fixed-rate series is open on Stellar mainnet with rollover
> from the first, the SDK reads live mainnet data so builders can show real Spield rates and
> positions, and Spield is submitted to the listings Stellar users rely on, with a public
> track record of its settled maturity and a written summary of what its first users told us.

### Shorter form, if the box is small *(Package 1)*

> In 30 days Spield reopens on mainnet with a second series and a rollover path, becomes ready
> for its audit, and lets builders read live mainnet data through the SDK, all under the same
> 50 USDC guarded cap.

---

# 4. Scope of Work (30-Day Deliverables)

## 4.1 In-Scope Deliverables

The deliverables are written as cards. Each card has the two cells the form asks for
(Description, Why this matters). Use the cards your package names in section 0.3, in that order.

---

### Card A: Series 2 on mainnet, with a repeatable launch and rollover

*Deliverable 1 in every package.*

**Description**

> Make launching a new fixed-rate series a repeatable, verified procedure instead of a one-off,
> use it to open Series 2 on Stellar mainnet, and give depositors a way to move from a matured
> series into an open one.
>
> - **Repeatable series launch.** One scripted runbook that creates a fresh, self-locking PT
>   issuer, deploys and wires the series, seeds the Fixed-Rate Vault, verifies the result
>   (wiring checks, and the live code compared byte for byte with the built code), and hands
>   admin to the existing 2-of-3 multisig. Rehearsed end to end on testnet first.
> - **Series 2 live on mainnet**, with its fixed rate set from Blend's current rate through the
>   existing on-chain gate that refuses a rate the yield source cannot fund. It runs under the
>   same Guarded Launch Cap as Series 1.
> - **Per-address deposit limit**, added next to the global cap and changeable only by the
>   multisig. This closes an item we committed to in Instaward 1 and delivered half of: the
>   global cap shipped, the per-address limit did not.
> - **Multi-series app.** A series selector showing which series are open and which have
>   matured, a redemption screen for matured series, and a guided "redeem and roll over" flow
>   that takes a depositor from a matured series into the open one.
> - **Series 1 closed out publicly**: its redeem transaction published, completing the
>   lifecycle evidence promised in Instaward 1.
>
> Series 2 will mature after this sprint ends, so its own redemption is not part of this
> deliverable. Seed liquidity and deployment fees are paid from the team's treasury, not from
> grant funds.

**Why this matters**

> A fixed-income product has to be open continuously. Today the only series has matured and the
> vault correctly refuses new deposits, so a new user cannot open a position on mainnet. This
> deliverable reopens the product and makes reopening it routine, so there is never again a gap
> between one maturity and the next. Rollover is what turns a one-time deposit into a returning
> depositor. The per-address limit stops one wallet from taking the whole capped headroom; the
> global cap remains the safety bound.

**Notes for you**

- **Decide Series 2's maturity before anything is deployed.** This is the Instaward 1 lesson:
  maturity is immutable, and a 30-day series could not produce a redeem hash inside the window.
  The card avoids the trap by taking its redemption proof from Series 1, which has already
  matured. If you would prefer a second full lifecycle inside the sprint, launch Series 2 with a
  14-day term by day 10, or add Card E.
- The per-address limit is a change to the SR contract, so Series 2 runs different code from
  Series 1 and needs a fresh WASM upload on mainnet. At Instaward 1 prices six uploads cost
  217 XLM. Simulate against mainnet before funding; do not extrapolate from testnet.
- A per-address limit is a fairness control, not a security control: one person can use several
  addresses. The card says so in its last sentence. Do not let anyone describe it as more.
- Rollover is scoped as a guided two-step flow (redeem, then deposit, two signatures). A
  single-signature rollover needs a new contract and is listed as out of scope.
- A refused deposit never reaches a ledger, so an over-limit rejection has no transaction link.
  The evidence for the limit is therefore the on-chain value plus a screen recording.

---

### Card B: Audit readiness and continuous verification

*Deliverable 2 in Packages 1 and 2.*

**Description**

> Close the gaps our own Instaward 1 report identified, and package the protocol so that an
> audit can begin without a preparation phase.
>
> - **Property and fuzz testing.** A new test layer that generates thousands of randomised
>   cases against the AMM pricing curve and the PT/YT accounting, checking rules that must
>   always hold: a round trip never creates value, a swap never reduces what liquidity providers
>   are owed, and backing never falls below principal. The existing 605 tests are example-based.
>   This is the class of test that finds the curve bugs they cannot.
> - **Continuous verification of the live contracts.** A read-only check that runs on a
>   schedule against every live series: contracts wired correctly, live code identical to the
>   published build, admin still the multisig, cap and pause state as expected. Results are
>   shown on a public status page next to the solvency dashboard.
> - **Alarms proven to fire.** Solvency, the Blend rate guard and the automated keeper each get
>   an alarm, and each alarm is deliberately triggered on testnet to confirm that it reaches a
>   person, with the response time recorded.
> - **Audit package.** One document covering scope, trust model, the invariants and where each
>   is enforced, known limitations, and the exact code version that is live, ready to hand to an
>   auditor through the SCF Build Award.

**Why this matters**

> The 50 USDC cap stays until a professional audit clears, so the audit is the single gate on
> Spield's growth. An auditor's time is the expensive part. Arriving with property tests, a
> written trust model and an honest list of known limitations shortens the audit and makes its
> findings deeper. Continuous verification also means that anyone, including a reviewer with no
> technical background, can see at any time that the live contracts are the ones we published
> and that the multisig still controls them.

**Notes for you**

- Nothing here touches mainnet state. It is the lowest-risk card and the one most likely to
  finish early, which is why the timeline uses it to absorb slack.
- `AUDITPREP.md` already exists but was written against the pre-launch build (it still says 478
  tests). The audit package is an update of that file, not a new document.
- The keeper matters more than its name suggests: it is the mitigation for a known issue that is
  deliberately not fixed on chain. An alarm on its heartbeat is real risk reduction, and it is
  worth saying so if the reviewer asks why monitoring is in a grant.

---

### Card C: The SDK reads mainnet, across every series

*Deliverable 3 in Package 1, Deliverable 2 in Package 3.*

**Description**

> - **A new `@spield/sdk` release that reads live mainnet data**: the list of series with their
>   rates and maturities, a wallet's positions and receipts, the deposit cap and remaining
>   headroom, and solvency. Mainnet is read-only in the SDK. Transactions stay on testnet until
>   the audit clears, as committed in Instaward 1.
> - **Multi-series support**, so an integrator does not need a new SDK version each time a
>   series opens.
> - **Public developer documentation**: a quick start, the API reference, contract addresses
>   for each series, and the error codes.
> - **One small reference app**, separate from the Spield dashboard and built only on the SDK.
>   It shows live mainnet rates and a wallet's position, and completes a deposit on testnet. It
>   is published with its source as a starting template for other teams.

**Why this matters**

> Every integrator arrives with their own users, which makes builders the one distribution
> channel Spield does not have to pay for. Today a wallet or treasury tool cannot show a real
> Spield rate or position, because the SDK only sees testnet. Read-only mainnet access is the
> safe half of that problem: builders can display real data now, without unaudited write paths
> being placed inside third-party apps.

**Notes for you**

- Instaward 1 listed "mainnet support for the SDK before the audit" as out of scope. This card
  stays inside that line by being read-only on mainnet, and says so. Do not widen it to writes.
- The docs source already exists in `docs/` and the SDK already has `customNetwork()`, so this
  is packaging and wiring more than new engineering.
- The card deliberately promises no design partner. Recruiting one belongs to the Customer
  Development Plan, where a miss is a finding and not a failed deliverable.

---

### Card D: Discovery and first depositors

*Deliverable 3 in Package 3 only.*

**Description**

> - **Listings submitted where Stellar users already look**: a DefiLlama adapter for Spield's
>   TVL, contract labels on Stellar Expert so the addresses read as Spield and not as unknown
>   contracts, and an entry in the Stellar ecosystem directory.
> - **A public track-record page**: for every matured series, the rate promised, the amount
>   paid, the date, and the transactions, readable without a wallet.
> - **Guided onboarding for first depositors in Series 2**: an open offer of a 15-minute shared
>   screen session for a first deposit, with the reason recorded whenever someone starts and
>   stops.
> - **A written findings summary** from at least 8 recorded user conversations, run under the
>   Customer Development Plan already filed with the Chapter.

**Why this matters**

> Series 1 proved that the mechanics work. It did not prove that anyone wants them. For a
> protocol that is not yet audited, the most persuasive thing we can offer is a claim a reader
> can check without trusting us: a settled maturity with its transactions, on a page anyone can
> open, reachable from the places this audience already uses.

**Notes for you**

- The listings are worded as "submitted" on purpose. Whether a maintainer merges inside 30 days
  is not yours to promise.
- Eight conversations is a commitment to other people's calendars. If the waitlist is small,
  lower it to five before submitting; do not leave a number you might miss.
- This card overlaps the Customer Development Plan. A reviewer may ask why the same activity is
  in two documents, which is one more reason Package 1 is the recommendation.

---

### Swap-in cards

Use one of these only as a replacement for Card C or Card D. Do not add a fourth deliverable.

**Card E: Two maturities live, the first yield curve on Stellar**

> Launch a second concurrent series with a different maturity through the same runbook, and show
> rate by maturity in the app. Both series run under the guarded cap.
>
> *Why this matters:* one maturity is a product; two are the beginning of a yield curve, which
> does not exist anywhere on Stellar today. It also tests, with real behaviour, whether
> depositors want a choice of terms.

Notes: cheap once Card A exists, since the code is already uploaded and only new instances are
needed (the 90-minute series cost 1.28 XLM). The cost is that it splits already tiny liquidity
across two series, and it contradicts hypothesis H9 in the Customer Development Plan (one
maturity is enough), so update that plan if you choose this.

**Card F: A second yield source (DeFindex) on testnet**

> Add DeFindex as a second yield source behind the existing strategy adapter, working end to end
> on testnet, with a written plan for mainnet after the audit.
>
> *Why this matters:* Spield currently depends on one Blend pool. A second source is the first
> step towards diversified yield, and was named as a follow-on in Instaward 1.

Notes: I do **not** recommend this for the current sprint. It adds a new trust surface before
the audit, it depends on a third party, and I have not verified DeFindex's current USDC vault
availability. Check that before choosing it. Instaward 1 called it "targeted as a follow-on", so
if the Chapter Lead expects it, the better answer is to name it in out of scope with the reason.

---

### Out-of-Scope (Explicitly Not Included)

**Base list, use in every package**

> - **Raising or removing the Guarded Launch Cap.** The 50 USDC cap stays in force until a
>   professional audit clears. This sprint prepares for that audit; it does not replace it.
> - **The professional third-party audit itself.** It is sought through the SCF Build Award,
>   which this Instaward is a step towards.
> - **Mainnet transactions through the SDK.** The SDK gains read-only mainnet access at most.
>   Write support follows the audit.
> - **Redemption of Series 2.** Its maturity falls after the sprint ends. The lifecycle evidence
>   in this SOW comes from Series 1, which has already matured.
> - **Single-signature rollover and an on-chain series registry.** Rollover ships as a guided
>   two-step flow in the app. A dedicated contract for it is future scope.
> - **Deep market liquidity, liquidity incentives and capital-efficient YT buying.** These need
>   pool depth that a 50 USDC cap does not allow. They follow the audit.
> - **DeFindex as a second yield source, the MoneyGram fiat on and off ramp, and the RWA yield
>   track.** All three remain deferred, as in Instaward 1.
> - **A Tron route.** Circle's CCTP has no Tron domain and no other rail is available to us.
> - **Seed liquidity and on-chain deployment fees.** Both are paid from the team's treasury, not
>   from grant funds.
> - **Any TVL or user-count target.** While deposits are capped at 50 USDC, TVL is not a
>   meaningful measure. User engagement is tracked under the Customer Development Plan.

**Add for Package 2**

> - **SDK changes and developer documentation.** The SDK stays at its current testnet release
>   for this sprint.

**Add for Package 3**

> - **Property and fuzz testing, continuous verification and the audit package.** These are the
>   scope of the next step, immediately before the audit.

If you drop the last base bullet for Package 3 (it names no user-count target, and Card D has a
conversation count), keep the TVL sentence.

---

## 4.2 Deliverable-Aligned Budget Request

### Option A *(recommended, Package 1)*: $5,000

> **Requested Budget Amount:** $5,000
>
> **Rationale:** Covers 30 days of work by a two-developer team, allocated across the three
> deliverables in proportion to engineering effort and risk.
>
> - **Deliverable 1, Series 2, repeatable launch and rollover: $2,000.** The only deliverable
>   that changes contract code and touches mainnet: the series-launch runbook, the per-address
>   deposit limit and its tests, the Series 2 deployment and verification, the multisig
>   handover, and the multi-series app with redemption and rollover.
> - **Deliverable 2, audit readiness and continuous verification: $1,750.** The property and
>   fuzz test layer, the scheduled verification check and public status page, the alarm drills,
>   and the audit package.
> - **Deliverable 3, the SDK reads mainnet: $1,250.** The SDK release with read-only mainnet
>   access and multi-series support, the developer documentation, and the reference app.
>
> Seed liquidity and all on-chain deployment fees are funded by the team, not by this grant.

### Option B *(Package 2)*: $4,000

> **Requested Budget Amount:** $4,000
>
> **Rationale:** Covers 30 days of work by a two-developer team across two deliverables. The
> request is below the cap because the scope is deliberately narrower than Instaward 1.
>
> - **Deliverable 1, Series 2, repeatable launch and rollover: $2,250.**
> - **Deliverable 2, audit readiness and continuous verification: $1,750.**
>
> Seed liquidity and all on-chain deployment fees are funded by the team, not by this grant.

### Option C *(Package 3)*: $5,000

> **Requested Budget Amount:** $5,000
>
> **Rationale:** Covers 30 days of work by a two-developer team, allocated across the three
> deliverables in proportion to effort.
>
> - **Deliverable 1, Series 2, repeatable launch and rollover: $2,000.**
> - **Deliverable 2, the SDK reads mainnet: $1,500.**
> - **Deliverable 3, discovery and first depositors: $1,500.**
>
> Seed liquidity and all on-chain deployment fees are funded by the team, not by this grant.

**Notes.** Instawards total $15,000 across at most three awards. Instaward 1 used $5,000, so
either $5,000 option leaves exactly one $5,000 follow-on. Option B leaves $6,000 of headroom you
cannot fully use, since each award is capped at $5,000. Ask for less only if you are choosing
the smaller scope for its own sake.

Instaward 1's rationale quoted "40+ hours a week, 320+ combined hours". I left the hours out. If
the Chapter Lead liked that line, add it back, but only if it is true for this sprint.

---

# 5. 30-Day Execution Plan & Timeline

## 5.1 Weekly Breakdown

All three plans put the mainnet launch in Week 2, not Week 4. In Instaward 1 the mainnet step
sat in the final week and the evidence that depended on it slipped past the window.

### Option A *(recommended, Package 1)*

| Week | Planned Work | Expected Output |
|---|---|---|
| Week 1 | Redeem the Series 1 receipt on mainnet and publish the transaction. Build the repeatable series-launch runbook and the per-address deposit limit, with tests, and rehearse a full series launch on testnet. Fix Series 2's maturity and rate before anything is deployed. Start the property and fuzz test layer. | Series 1 redeem transaction published. A complete series launch rehearsed on testnet from one runbook. Per-address limit passing its tests. Series 2 parameters decided and written down. |
| Week 2 | Launch Series 2 on mainnet through the runbook: deploy, verify, seed (team-funded) and hand admin to the multisig. Ship the series selector and the matured-series redemption screen in the app. Finish the property and fuzz suite. Turn on the scheduled verification check. | Series 2 open for deposits on mainnet, verified, and under the multisig. The app shows both series. Property and fuzz suite passing. First scheduled verification run recorded. |
| Week 3 | Ship the guided redeem-and-roll-over flow and complete a real rollover from Series 1 into Series 2. Publish the status page. Run the alarm drills on testnet. Release the SDK with read-only mainnet access and multi-series support. | A real rollover on mainnet with transaction links. Status page live. Drill record with response times. New SDK version on npm. |
| Week 4 | Publish the developer documentation and the reference app. Finalise the audit package against the code that is live. Record the demo and assemble the evidence. The second half of the week is kept free as a buffer. | Documentation and reference app live. Audit package complete. Demo video and evidence package ready for Ambassador review. |

### Option B *(Package 2)*

| Week | Planned Work | Expected Output |
|---|---|---|
| Week 1 | Redeem the Series 1 receipt on mainnet and publish the transaction. Build the repeatable series-launch runbook and the per-address deposit limit, with tests, and rehearse a full series launch on testnet. Fix Series 2's maturity and rate. Start the property and fuzz test layer. | Series 1 redeem transaction published. Series launch rehearsed on testnet. Per-address limit passing its tests. Series 2 parameters decided. |
| Week 2 | Launch Series 2 on mainnet through the runbook: deploy, verify, seed (team-funded) and hand admin to the multisig. Ship the series selector and the matured-series redemption screen. Finish the property and fuzz suite. | Series 2 open for deposits on mainnet, verified, and under the multisig. The app shows both series. Property and fuzz suite passing. |
| Week 3 | Ship the guided redeem-and-roll-over flow and complete a real rollover. Turn on the scheduled verification check and publish the status page. Run the alarm drills on testnet. | A real rollover on mainnet with transaction links. Status page live. Drill record with response times. |
| Week 4 | Finalise the audit package against the code that is live. Record the demo and assemble the evidence. Most of this week is buffer. | Audit package complete. Demo video and evidence package ready for Ambassador review. |

### Option C *(Package 3)*

| Week | Planned Work | Expected Output |
|---|---|---|
| Week 1 | Redeem the Series 1 receipt on mainnet and publish the transaction. Build the repeatable series-launch runbook and the per-address deposit limit, with tests, and rehearse a full series launch on testnet. Fix Series 2's maturity and rate. Start recruiting for user conversations. | Series 1 redeem transaction published. Series launch rehearsed on testnet. Per-address limit passing its tests. Series 2 parameters decided. First conversations booked. |
| Week 2 | Launch Series 2 on mainnet through the runbook: deploy, verify, seed (team-funded) and hand admin to the multisig. Ship the series selector and the matured-series redemption screen. Add read-only mainnet access and multi-series support to the SDK. Prepare the listing submissions. | Series 2 open for deposits on mainnet, verified, and under the multisig. The app shows both series. SDK changes complete and tested. |
| Week 3 | Ship the guided redeem-and-roll-over flow and complete a real rollover. Release the SDK. Submit the listings. Publish the track-record page. Begin guided onboarding sessions for Series 2. | A real rollover on mainnet with transaction links. New SDK version on npm. Listing submissions made. Track-record page live. |
| Week 4 | Publish the developer documentation and the reference app. Complete the user conversations and write the findings summary. Record the demo and assemble the evidence. | Documentation and reference app live. Findings summary complete. Demo video and evidence package ready for Ambassador review. |

---

# 6. Evidence of Completion (Required)

## 6.1 Planned Evidence to Be Submitted

Every row is something the Chapter Lead can open and judge without technical help. Lessons from
Instaward 1 are built in: nothing here depends on a maturity that falls outside the sprint, and
nothing claims a link for a transaction that was refused and so never reached a ledger.

### Option A *(recommended, Package 1)*

| Deliverable | Evidence Type | Description |
|---|---|---|
| Deliverable 1 | Explorer links, transaction links, live app URL, short screen recording | The Series 2 contract addresses as links anyone can open in a Stellar explorer. A deposit into Series 2 on mainnet. The Series 1 redeem transaction. A rollover from Series 1 into Series 2 (the redeem and the deposit, from the same wallet). The live app showing both series. A short recording of the app refusing a deposit above the per-address limit, with the limit shown as read from the contract. |
| Deliverable 2 | Public URL, test output, documents | The public status page showing the latest verification result for each live series. The property and fuzz test run, showing the number of generated cases and the result. A record of each alarm drill, with a screenshot of the alarm arriving and the response time. The audit package as a document. |
| Deliverable 3 | npm link, documentation URL, live demo URL, repository link, short recording | The published `@spield/sdk` version with mainnet read access. The developer documentation URL. The reference app, live, with its source. A short recording of the reference app showing live mainnet rates and a wallet's position. |

### Option B *(Package 2)*

| Deliverable | Evidence Type | Description |
|---|---|---|
| Deliverable 1 | Explorer links, transaction links, live app URL, short screen recording | Same as Deliverable 1 in Option A. |
| Deliverable 2 | Public URL, test output, documents | Same as Deliverable 2 in Option A. |
| Deliverable 3 | Not applicable | This SOW has two deliverables. |

### Option C *(Package 3)*

| Deliverable | Evidence Type | Description |
|---|---|---|
| Deliverable 1 | Explorer links, transaction links, live app URL, short screen recording | Same as Deliverable 1 in Option A. |
| Deliverable 2 | npm link, documentation URL, live demo URL, repository link, short recording | Same as Deliverable 3 in Option A. |
| Deliverable 3 | Submission links, public URL, document | The link to each listing submission, and to the live listing where it has been accepted inside the sprint. The public track-record page. The findings summary, stating how many conversations took place, how the people were found, and what they said, with recordings linked where consent was given. |

**Notes.** For the form, paste the full text into each cell and do not write "same as". The
cross-references are only here to keep this file short.

The demo video from Week 4 is supporting material for all deliverables, as in Instaward 1. One
recording of a user going from the series selector through a deposit, then redeem and roll over,
covers Deliverable 1 on its own.

## 6.2 Evidence Verification Checklist (For Ambassador Use)

Leave this blank. The Ambassador Chapter Lead completes it.

| Deliverable | Evidence Present | Evidence Partial | Evidence Missing | Comments |
|---|---|---|---|---|
| Deliverable 1 | ☐ | ☐ | ☐ | |
| Deliverable 2 | ☐ | ☐ | ☐ | |
| Deliverable 3 | ☐ | ☐ | ☐ | |

---

# 7. Next-Step Alignment

## 7.1 Anticipated Next Step After Completion

### Option A *(recommended)*

> ☑ Apply to SCF Build Award
> ☐ Continue development independently
> ☑ Apply for a follow-on Instaward (if eligible)
> ☐ Seek other ecosystem support
> ☐ Other:

The form asks for the most likely next step. Two ticks say something specific: the Build Award
for the audit, and the one remaining Instaward for what the audit unlocks. With Package 1 or 2
the audit package is the direct input to the Build Award application, so the two documents
reinforce each other.

### Option B: the same three ticks as Instaward 1

> ☑ Apply to SCF Build Award
> ☐ Continue development independently
> ☑ Apply for a follow-on Instaward (if eligible)
> ☑ Seek other ecosystem support
> ☐ Other:

Consistent with last time, but three ticks out of five reads as undecided.

### Option C: name the audit explicitly

> ☑ Apply to SCF Build Award
> ☐ Continue development independently
> ☐ Apply for a follow-on Instaward (if eligible)
> ☐ Seek other ecosystem support
> ☑ Other: Professional security audit through the SCF Build Award, then a staged increase of
> the Guarded Launch Cap.

The strongest signal of direction, at the cost of not flagging the third Instaward. Choose this
only if you would be content not to apply for one.

---

# 8. Instawards Constraints Acknowledgement

> ☑ This scope will be completed within 30 days or less.
> ☑ Instawards support execution, not open-ended exploration.
> ☑ A project may receive no more than two follow-on Instawards.
> ☑ Each Instaward is capped at $5,000.
> ☑ Total Instawards funding may not exceed $15,000.

This is Spield's first follow-on. After it, cumulative Instaward funding is $10,000 (or $9,000
with Package 2) of the $15,000 limit, and one follow-on remains.

---

# 9. Submission Confirmation

Boilerplate supplied by the programme. The Ambassador Chapter Lead submits the finalised SOW
through the Instawards Airtable form.

---

## Final check before you hand it to the Chapter Lead

- [ ] The Series 1 redeem is done and the wording says "is published", with the link.
- [ ] Problem, deliverables, budget, timeline and evidence all come from the same package.
- [ ] The deliverable count is the same in sections 4.1, 4.2, 5 and 6 (two for Package 2).
- [ ] Both dates in section 1 are real, and the sprint start leaves time for review.
- [ ] The cap is described as 50 USDC everywhere, and nothing implies it will be raised.
- [ ] No sentence says Series 2 will be redeemed inside the sprint.
- [ ] No sentence says the SDK will transact on mainnet.
- [ ] The test count (605) and SDK version match the Customer Development Plan. The plan says
      0.4.2; npm's latest is 0.4.3.
- [ ] Every "same as" cross-reference in section 6.1 has been replaced with the full text.
- [ ] If the GitHub repo is private, the code and CI evidence rows are PDFs or screenshots.
