# Customer Development Plan — Spield

> **What this file is.** Fill-ready draft content for every field of the Customer
> Development Plan required of follow-on funding recipients. Written against what is
> actually true on **2 September 2026** — one day after mainnet launch — and checked
> against the repo, the chain, and the live analytics configuration rather than against
> status documents.
>
> **How to use it.** Each numbered section below matches a field on the form. Text inside
> a `>` **PASTE** block is the answer to copy in. Text under **Notes** is for you, not for
> the form. Anything in `[[ ... ]]` is a blank only you can fill.
>
> Companion document: `MAIN_INSTAWARD-DELIVERABLE-SUBMISSION.md` (the deliverable
> submission this plan follows on from).

---

## Blanks to fill before you submit

| # | Field | What is needed | Where to get it |
|---|---|---|---|
| 1 | Primary contact name | Your legal name as registered with SCF | — |
| 2 | Ambassador Chapter | The chapter you are enrolled under | Your SCF/Instaward acceptance email |
| 3 | Ambassador Chapter Lead | Name of the lead who will verify §8 | Same email, or ask in the chapter channel |
| 4 | Waitlist size | Current email count | `GET /waitlist` on the server, or count the `users` collection in Mongo |
| 5 | GA4 numbers (§6.2) | Sessions / users / top pages since the tag went live | GA4 property `G-Y902DS1JCN` → Reports → export PDF |
| 6 | Clarity session count (§6.2) | Recordings available, and how many reached the deposit panel | Clarity project `wjr8mkggic` → Recordings → filter by page |
| 7 | npm downloads (§6.2) | `@spield/sdk` weekly downloads | npmjs.com/package/@spield/sdk → Downloads, or `npm view @spield/sdk` |
| 8 | Live depositor count (§6.2) | Addresses holding SR / PT today | Stellar Expert holders tab on the SR and PT contracts |

Everything else below is filled in and verifiable.

---

# 1. Project & Team Information

> **PASTE**
>
> **Project Name:** Spield — the fixed-income layer for Stellar
>
> **Builder / Team Name:** Spield Protocol
>
> **Primary Contact (Name + Email):** `[[ your name ]]` — contact@spield.live
> (personal: kilitadigital@gmail.com)
>
> **Ambassador Chapter:** `[[ chapter ]]`
>
> **Ambassador Chapter Lead:** `[[ lead name ]]`

**Notes.** Public identifiers a reviewer can check against the name above, useful if the
form has a "links" field: live app https://app.spield.live · site https://www.spield.live ·
GitHub https://github.com/Suryashish/spield_protocol · X https://x.com/spield_ ·
npm https://www.npmjs.com/package/@spield/sdk

---

# 2. Customer Development Plan: Purpose & Intent

### 2.1 Purpose (for Builder Context)

This section is boilerplate supplied by the programme. Reproduced here so the submitted
document is complete; do not rewrite it.

> Customer Development Plans are required of all follow-on funding recipients to confirm
> that capital continues to support projects that are actively engaging with real users and
> validating their core market assumptions, rather than product development in isolation.
>
> This document represents a shared record between the Builder and the Ambassador Chapter
> Lead of the project's target customer, key hypotheses, discovery activities completed to
> date, and the evidence gathered in support of, or against, those hypotheses.
>
> **Note:** This plan is not expected to be complete or final. It is expected to demonstrate
> evidence-based learning and iteration during the follow-on funding period.

**Our reading of it, and one thing we want to state up front.** Spield went live on Stellar
mainnet on **1 September 2026**, one day before this plan was written, behind a deliberate
**50 USDC guarded launch cap** that stays until a professional audit clears. So the honest
position is: our *product* evidence is strong and on-chain, our *pre-launch demand* evidence
is real but indirect (search, waitlist, session analytics, usability recordings), and our
*post-launch customer* evidence is one day old and capped by design. This plan is written
to close exactly that gap during the follow-on period, and §5 and §6 are marked so the
Chapter Lead can see which is which without having to guess.

---

# 3. Target Customer Profile

### 3.1 Who is the target customer

> **PASTE**
>
> **What Spield sells.** Certainty on a yield, not yield itself. Every segment below already
> holds, or is willing to hold, USDC, and every one of them is choosing a *known payout on a
> known date* over a floating rate. That is the single thread running through all three. They
> differ in position size, in who signs for the decision, and in whether they want our
> interface or our code.
>
> Spield is initially targeting three closely related customer segments within the Stellar
> ecosystem.
>
> ---
>
> **3.1.1 DeFi users, traders and yield seekers.** *(Primary segment, live today.)*
>
> - Stellar users holding USDC who want a predictable return instead of exposure to variable
>   DeFi yields.
> - Existing Blend suppliers who want to lock a fixed rate without continuously monitoring or
>   actively managing a lending position.
> - USDC holders on Ethereum, Base, Arbitrum, OP Mainnet, Polygon, Avalanche and Solana who
>   need a simple route for moving liquidity to Stellar. This is the same persona as the group
>   above; the only difference is that their capital sits on another chain, which makes it a
>   distribution problem rather than a separate customer. It is why the product ships a native
>   Circle CCTP V2 on-ramp: 1:1 burn-and-mint USDC, no wrapped asset, no third-party bridge.
>
> *Where they are today:* holding USDC idle, or supplying it to Blend at a floating rate and
> checking on it periodically. Neither gives them a number they can plan around.
>
> *What they hire Spield for:* the shape of a term deposit. Deposit X today, receive exactly Y
> on exactly this date, denominated in a stablecoin, with nothing to manage in between.
>
> *Why they are first:* they already understand wallets, stablecoins and on-chain yield, so
> they are the shortest path to a real test of whether fixed-rate demand exists on Stellar. No
> education about custody is required, only about what certainty is worth to them. Typical
> position size we are building for is roughly 100 to 10,000 USDC: below that, effort and fees
> dominate; above it, the depositor asks audit questions we cannot yet answer.
>
> *How we reach them:* the app itself, a 62-page Learn corpus written against the questions
> this segment already searches for, the Stellar and Blend communities, and the Ambassador
> Chapter.
>
> **Within 3.1.1, a distinct sub-segment: yield traders and liquidity providers.**
>
> More experienced DeFi users do not want a deposit; they want to take a position on the rate
> itself. Splitting a deposit into a Principal Token and a Yield Token makes that possible,
> and the app ships four separate roles for them:
>
> - **PT buyers.** Buy the principal claim at a discount on the AMM and hold it to maturity.
>   The same certainty motive as the vault, reached by a different route: they take a market
>   price rather than a quoted rate, which can beat the vault's headline when PT trades cheap.
> - **YT buyers.** Buy the yield stream on its own. A small outlay controls the yield on a much
>   larger notional, so this is leveraged, stablecoin-denominated exposure to Blend's rate. The
>   buyer is taking a view that realized yield will exceed the rate the market has implied.
> - **Sellers and early exits.** Selling PT before maturity is how a depositor whose plans
>   changed gets out; selling YT is how a holder takes yield off the table after a rate run.
>   This is what stops a fixed position from behaving like a lock-up, and it is a large part of
>   why the market exists at all.
> - **Liquidity providers.** Supply PT and USDC to the pool and earn the swap fee. LPs keep
>   **80% of every fee**, the inverse of Pendle's split, which is our main argument for
>   attracting the first liquidity. Verified on chain: the protocol's share is set to 2000 bps.
>
> *Where they are today:* mostly not on Stellar. Yield tokenization has no market here, so this
> group either does not exist on Stellar yet or does this on Ethereum through Pendle. We are
> partly creating this segment rather than capturing it, and we would rather say that than
> claim a pipeline we do not have.
>
> *What they hire Spield for:* a way to express a view on rates without leaving stablecoins,
> and a way into and out of a fixed position before its maturity date.
>
> *Why they matter well beyond their own volume:* they are the counterparty that makes the
> fixed rate work. A vault alone can only quote a rate an operator has set; a liquid PT/YT
> market lets that rate be discovered, and lets a depositor exit early instead of waiting out
> the term. Without this sub-segment Spield is a term deposit. With it, Spield is a market.
>
> *One honest qualification.* All four roles are built and live in the app, but the PT/SR
> market is not yet seeded, so there is nothing to trade against. Until it fills, this
> sub-segment is a hypothesis we are testing rather than a customer we are serving, and
> seeding the AMM is the first item in the next-steps plan.
>
> ---
>
> **3.1.2 Treasury, payroll and payment businesses.** *(Validated by conversation now, by
> product after the audit.)*
>
> - Startups, DAOs, fintech companies, payment platforms, payroll providers and other
>   ecosystem businesses that periodically hold idle USDC or similar treasury assets.
> - Organizations that value predictable returns, capital preservation, liquidity planning and
>   known maturity dates more than maximizing a speculative APY.
> - Businesses that would use Spield directly for treasury management, or embed fixed-yield
>   functionality into their own products through the Spield SDK, which makes this segment
>   overlap with 3.1.3.
>
> *The job to be done:* park money that is already committed to a date. Payroll runs on a
> schedule, a DAO's next grant tranche has a date, a payment platform knows its settlement
> cycle. USDC sitting idle between those dates is precisely the shape a dated instrument fits,
> and a floating rate gives a finance function nothing to forecast with.
>
> *What we do not yet know, and this is the segment with the most open questions:* what
> position sizes they would actually commit; which maturities match real cash-flow cycles,
> since 30 days may be wrong for payroll; what risk sign-off looks like and who gives it; what
> reporting and accounting artifacts they need; and how much liquidity they require before
> maturity, at what cost.
>
> *Honest gating.* This segment is not reachable today and we are not pretending otherwise. A
> 50 USDC guarded cap on an unaudited protocol is not a treasury product, and approaching a
> finance lead or a DAO treasury before the audit would spend the relationship for nothing.
> They are in this plan as an interview target during the follow-on period and as a product
> target after the audit clears.
>
> ---
>
> **3.1.3 DeFi developers and protocol integrators.** *(Live, published, not yet adopted.)*
>
> - Developers building Stellar wallets, payment applications, treasury-management tools,
>   payroll products, fintech platforms and other DeFi applications.
> - Protocol teams that want to offer fixed-yield products without developing and maintaining
>   the underlying yield-tokenization infrastructure themselves.
> - Integrators that need programmatic access to fixed-rate vaults, PT/YT positions, market
>   quotations, portfolio data, redemptions and protocol-health information.
>
> *What they want:* not our interface, but a dependency. The Spield SDK is intended to make
> fixed-yield and PT/YT functionality available as a reusable financial primitive across the
> Stellar ecosystem, so a team can embed fixed income into their own product while Spield
> manages the underlying protocol interactions.
>
> *What exists:* `@spield/sdk` v0.4.2 on npm, validated the way a prospective integrator would
> validate it rather than the way an author would: a fresh install into an empty project,
> confirmed reading live chain data, with a runnable example shipped alongside.
>
> *Why this segment matters more than its size suggests:* every integrator arrives with their
> own users, so it is the only segment whose customer acquisition is not ours to fund. It is
> also what turns Spield from an application into a primitive that other Stellar products are
> built on, which is a materially different position in the ecosystem.
>
> *What we do not yet know:* whether a builder will take on a dependency for a yield primitive
> rather than integrate Blend directly, and whether the integration surface we guessed at is
> the one they actually need. No design partner has integrated yet; two are targeted this
> period.
>
> ---
>
> **3.1.4 Who we are explicitly not building for.**
>
> Stated because the exclusions are what keep the product coherent, and each one has a
> consequence we accept:
>
> - **Yield maximizers chasing the highest floating APY.** A fixed rate will usually sit below
>   a floating one; someone optimizing for the top number is right to go elsewhere.
> - **Leverage and directional traders.** Spield is stablecoin-denominated and the yield is
>   real Blend lending yield, not emissions or incentives.
> - **Anyone seeking exposure to the XLM price.**
> - **Institutions and regulated funds, for now.** Deferred deliberately until the audit
>   clears, not overlooked.
>
> Building for the first two would pull the interface toward exposing PT/YT primitives and
> away from the plain-language deposit path that 3.1.1 depends on. Those two audiences want
> opposite things from the same screen, and serving both would serve neither.
>
> ---
>
> **Sequencing, and what gates each step.**
>
> | Segment | Status today | What gates the next step |
> |---|---|---|
> | 3.1.1 DeFi users and yield seekers | Live and being served | The 50 USDC guarded cap; raising it requires the audit |
> | 3.1.3 Developers and integrators | SDK published, no integration yet | Recruiting design partners; the SDK points at testnet until the audit |
> | 3.1.2 Treasury, payroll and payment businesses | Interviews only, deliberately | Audit clearance and a materially raised cap |

**Notes.** If the form gives you a single short box rather than a page, use this compression:

> Stellar USDC holders who want a fixed, dated payout instead of a floating lending rate,
> including existing Blend users and USDC holders on six EVM chains and Solana who reach us
> through a native CCTP on-ramp; treasury, payroll and payment businesses holding periodically
> idle USDC that is already committed to a known date; and Stellar developers who want to
> embed fixed income as a primitive through our npm SDK rather than build a yield engine.
> Institutions and yield maximizers are deliberately out of scope, the former until the
> protocol is audited.

**What changed from your earlier draft, and why.** Kept your three segments and your numbering.
Added: a one-line statement of what Spield sells, so the segments hang off something; a
"where they are today" and "what they hire us for" line per segment, which is what a customer
development reviewer reads for; the open questions per segment, since a plan that lists none
looks unexamined; an explicit not-our-customer section, which is the strongest single addition
because exclusions demonstrate focus; and a sequencing table tying each segment to the audit
gate. Corrected: the chain list is the exact seven, not "and other supported networks", and
Tron is not available on any rail today. Qualified: PT/YT trading is not yet a live market
because the AMM is unseeded.

---

# 4. Key Hypotheses

### 4.1 Core Assumptions About the Problem and the Solution

> **PASTE**
>
> These are stated in the form "if this is wrong, here is what changes" — because an
> assumption that changes nothing when falsified is not worth listing.
>
> **H1 (Problem — the core one).** Stellar USDC holders will trade upside for certainty. A
> known payout on a known date is worth more to them than a variable rate that may average
> higher.
> *If wrong:* Spield's headline product is the wrong one. We would pivot from the Fixed-Rate
> Vault to the YT/leveraged-yield side of the same contracts, which is already built.
>
> **H2 (Problem).** The binding constraint on earning yield on Stellar is not the *absence*
> of yield — Blend exists — but **comprehension and trust**. People do not act because they
> cannot tell what they will receive, and cannot tell whether the contract will still hold
> their money next month.
> *If wrong:* our investment in plain-language UI, the public solvency page and a 62-page
> education corpus is mis-allocated, and we should spend on rate competitiveness and
> incentives instead.
>
> **H3 (Solution).** A one-click deposit that states rate, coupon and maturity in plain
> language converts users who would never touch a PT/YT interface. The PT/YT machinery
> should be invisible to Segment 1.
> *If wrong:* we are a trader product, not a consumer product, and the UI should surface the
> primitives rather than hide them.
>
> **H4 (Solution / go-to-market).** The capital we want is not on Stellar yet, so a native
> cross-chain USDC on-ramp is a **prerequisite** rather than a convenience.
> *If wrong:* CCTP is expensive surface area to maintain for little conversion, and we should
> cut it back to a link out to an exchange and concentrate on Stellar-native demand.
>
> **H5 (Trust).** "Unaudited" is the single largest conversion blocker for Segment 1, and it
> can be *partially* substituted — not removed — by verifiable safety: an on-chain deposit
> cap, byte-verifiable deployed code, a 2-of-3 multisig admin, and a wallet-free public
> solvency page.
> *If wrong in our favour* (people deposit regardless): the cap is costing us more growth
> than it buys in safety, and the audit is less urgent than we have priced it.
> *If wrong against us* (nobody deposits until audited): all growth spend before the audit is
> wasted and should be deferred behind it.
>
> **H6 (Distribution).** Search intent — "how to earn yield on Stellar", "fixed income on
> Stellar", "is Stellar DeFi safe" — is a cheaper and better-qualified acquisition channel
> for this segment than crypto-Twitter, because the intersection of *yield-tokenization
> education* × *Stellar DeFi education* is currently unowned by anyone.
> *If wrong:* the content corpus stops being the growth engine and becomes a credibility
> asset only; budget moves to community, chapter events and partner BD.
>
> **H7 (B2B).** There is a real second market of Stellar builders who will embed fixed yield
> via an SDK rather than build it, and they will adopt before institutions will.
> *If wrong:* deprioritise the SDK, keep it as documentation-by-example, and concentrate all
> effort on the consumer app.
>
> **H8 (Market structure).** A two-sided PT/SR market exists on Stellar — that is, there are
> enough yield buyers and liquidity providers for the time-decay AMM to fill.
> *If wrong:* the AMM is decoration. We ship vault-only and let the Fixed-Rate Vault, which
> does not depend on a counterparty, carry the product.
>
> **H9 (Pricing / product shape).** A single 30-day maturity at a fixed 3.00% is a
> sufficient first product. Users want *one* clear choice, not a maturity ladder.
> *If wrong:* we need multiple concurrent series, which is a real roadmap change — maturity
> is immutable per series, so more choice means more deployments and more liquidity to
> fragment.

**Notes.** H1, H5 and H8 are the three that would most change the business. If the form asks
you to rank or pick a subset, submit those three. H5 is also the one the Chapter Lead is
most likely to probe, because it is the one that touches user funds.

---

# 5. Customer Discovery Activities

### 5.1 Activities Completed to Date

> **PASTE**
>
> Activities are marked **[Direct]** where we spoke with or observed a specific person, and
> **[Indirect]** where we measured revealed behaviour at scale. We are stating the difference
> rather than blurring it, because the honest summary of our position is: strong indirect
> evidence, thinner direct evidence, and a plan in §7 that fixes the direct side first.
>
> **1. [Indirect] Instrumented both live surfaces with analytics and session recording.**
> Google Analytics 4 (`G-Y902DS1JCN`) and Microsoft Clarity (`wjr8mkggic`) run on the
> marketing site *and* the dApp, with cross-domain session stitching so a visitor who reads a
> guide and then clicks through to the app is one session, not two. Route-level pageviews are
> sent manually on every client-side navigation, so all 62 static pages report individually
> rather than collapsing into one entry. Clarity gives us **session replays and heatmaps of
> real, unprompted visitors** — including where they abandon the deposit flow.
>
> **2. [Indirect] Published a 62-page education corpus as a demand instrument.**
> 24 guides, 20 glossary terms, 2 comparisons and 3 hub pages, targeting a 300+ keyword map
> built from the *observed* search demand for these questions on other chains. This is a
> deliberate test of H6: rather than asking people what they want to know, we published
> answers to what they are already searching for and measured which ones get traffic.
>
> **3. [Direct] Moderated usability session on the core deposit journey.**
> Recorded a **non-technical user** completing the full journey unaided — connect wallet →
> create PT trustline → deposit → read the fixed receipt. This is the session that produced
> the plain-language rewrite of the rate/coupon/maturity copy and the one-click trustline.
>
> **4. [Direct] Recorded end-to-end product walkthroughs for review.**
> A detailed product walkthrough, plus a separate screen recording of the cross-chain on-ramp
> flow showing a real Base → Stellar transfer landing in the app's transfer history. Both are
> the artefacts we use in conversations with prospective users and reviewers.
>
> **5. [Direct] Ran a multi-device usability pass.**
> All 10 app routes verified in a real browser at 320, 375 and 414 px, plus the marketing
> site. Before-and-after screenshots of the deposit → fixed-yield journey were captured and
> are submitted as evidence.
>
> **6. [Indirect] Operated an email waitlist ahead of launch.**
> A live waitlist endpoint collecting emails from the landing page, backed by a database —
> the earliest signal of intent we have, gathered before there was a product to deposit into.
> `[[ insert current count ]]` addresses to date.
>
> **7. [Direct/B2B] Shipped and validated a builder SDK against the developer segment.**
> `@spield/sdk` v0.4.2 published on npm and pointed at testnet. We validated it the way a
> prospective builder would rather than the way an author would: fresh install into an empty
> project, then confirmed the installed package reads live testnet data. A runnable example
> ships with it. Public download counts are the ongoing signal for H7.
>
> **8. [Indirect] Launched to real users behind a guarded cap.**
> Mainnet launch on 1 September 2026 with a 50 USDC global TVL ceiling enforced on chain, a
> seeded vault so the first deposit succeeds rather than bouncing on empty capacity, and a
> public solvency dashboard that reads backing versus principal straight from the contract
> with no wallet required. Every deposit from here is a real customer signal, and every one is
> publicly auditable.
>
> **9. [Direct] Programme review cycles.**
> Deliverable review under the award programme, which put the product in front of reviewers
> who are not us and produced written feedback we acted on.
>
> **Deliberately not yet done, and why.** We have not yet run a structured interview
> programme, a survey, or a design-partner pilot. Until 1 September there was no mainnet
> product to interview anyone about, and interviewing people about a testnet deployment
> produces stated preference rather than revealed preference. That constraint is now gone,
> and §7 puts interviews first.

**Notes for you.** Item 6 needs the real number before submission — see the blanks table.
Do not inflate item 3 into "multiple user tests"; one recorded session is what exists, and a
Chapter Lead who watches it will see that. The strength of the answer is that it is checkable.

---

# 6. Key Learnings & Evidence

### 6.1 Validated / Invalidated Assumptions

> **PASTE**
>
> **Validated.**
>
> - **H2 (comprehension and trust are the constraint) — validated by our own build.** Every
>   change that moved the usability session forward was a *comprehension* change, not a yield
>   change: plain-language rate/coupon/maturity, one-click trustline, explicit pending /
>   success / error states on every transaction, and a risk disclosure that shows the live
>   deposit cap next to the risk it bounds and says plainly that the protocol is unaudited.
>   None of it altered the return; all of it altered whether someone finished.
>
> - **H3 (hide the primitives) — validated in the usability session.** A non-technical user
>   completed connect → trustline → deposit → receipt unaided once PT/YT were removed from the
>   deposit path. The correction we had to make was mechanical rather than conceptual: PT
>   needs a trustline, YT does not (it is a contract with a transfer hook, not a classic
>   asset), and surfacing that asymmetry to the user was pure confusion. It is now one click.
>
> - **H4 (the on-ramp is a prerequisite) — validated, and re-validated the hard way.** Our
>   original bridge supplier, Allbridge, discontinued their service mid-integration. Rather
>   than treat the on-ramp as optional and cut it, we rebuilt it on Circle's own rail, CCTP V2,
>   and proved it with a real Base → Stellar mainnet transfer. Rebuilding rather than dropping
>   it is the decision that shows how load-bearing we believe this hypothesis to be. Six EVM
>   mainnets plus Solana are live; **Tron is not, and cannot be** — CCTP has no Tron domain
>   and Allbridge was the only route that had one.
>
> - **H6 (search is the channel) — early validation, not yet proven.** The gap analysis holds:
>   the "explained for beginners" results in this category are owned by third parties, not by
>   protocols, and nobody currently owns the Stellar variant of any of it. The corpus is
>   published and indexed. What we do **not** yet have is ranking and traffic data over a
>   meaningful window — the tag has been live on the marketing site for a matter of weeks. This
>   is reported as *in progress*, not as validated.
>
> **Invalidated, or corrected.**
>
> - **"Testnet behaviour predicts mainnet economics" — invalidated, expensively.** We estimated
>   3.4 XLM for the six contract uploads from testnet measurements. Mainnet quoted **217 XLM,
>   64× higher**, because large persistent entries carry rent that testnet does not price the
>   same way. Read-only calls cost the same on both networks, which is exactly what made the
>   first estimate look reasonable. Direct customer consequence: our cost-to-serve model, and
>   therefore any fee we would ever charge, had to be rebuilt on mainnet-simulated numbers.
>
> - **"Suppliers are stable infrastructure" — invalidated.** Allbridge disappeared mid-build.
>   The correction is now a standing rule: prefer the asset issuer's own rail over any
>   intermediary. Circle issues the USDC; CCTP is Circle's.
>
> - **"Test breadth equals test class" — corrected.** 605 automated tests pass, 198 of them
>   AMM-specific, but they are example-based. Property and fuzz tests over the time-decay curve
>   are a different class and are the one that finds curve bugs. Breadth was giving us false
>   confidence; that layer is now on the roadmap rather than assumed present.
>
> **Not yet tested — and this is the honest centre of this plan.**
>
> - **H1 (certainty beats upside)** — the actual core hypothesis. It cannot be settled by
>   analytics. It needs people saying, in their own words, what they would give up for a dated
>   payout. This is the first thing §7 does.
> - **H5 (unaudited is the blocker, and verifiable safety partly substitutes)** — untestable
>   until deposits accumulate against a 50 USDC cap. One day of live data is not an answer.
> - **H7 (builders will embed rather than build)** — the SDK is published; no design partner
>   has integrated it yet.
> - **H8 (a two-sided PT/SR market exists)** — the AMM reserves are still `[0, 0]`. Nothing can
>   be learned from an unseeded market.
> - **H9 (one maturity is enough)** — one series has existed for one day.

### 6.2 Supporting Evidence

> **PASTE — evidence table**

| Evidence Type | Description | Link / Reference |
|---|---|---|
| **Loom recording of a product demo with a potential customer** | ⚠️ **Partial.** We have a recorded product demo and a recorded non-technical-user run of the full deposit journey, but not yet a demo *conducted with a named prospective customer*. Both recordings below are the artefact we use in those conversations; scheduled customer-facing demos begin Week 1 of this period (§7). | Non-technical user demo (connect → trustline → deposit → fixed receipt): https://drive.google.com/file/d/1Vrq5jr_CJpVCV47Gf-3hI5qYrxJMkwd2/view?usp=sharing<br>Detailed product walkthrough: https://drive.google.com/file/d/1fnFtfJVUT1XrPF8QEx_r7vjESrVF6Ur1/view?usp=sharing |
| **User testing recording or UX session video** | ✅ **Present, two kinds.** (a) The moderated session above — an unaided non-technical user completing the core journey, which drove the plain-language and one-click-trustline changes. (b) **Microsoft Clarity is live on both hosts**, recording unprompted real visitor sessions with heatmaps and rage-click detection. Clarity project `wjr8mkggic`. `[[ N ]]` recordings available; `[[ N ]]` reached the deposit panel. | Session video: https://drive.google.com/file/d/1Vrq5jr_CJpVCV47Gf-3hI5qYrxJMkwd2/view?usp=sharing<br>On-ramp flow recording: https://drive.google.com/file/d/19bB6HPY84GRHNxCg_vJr5cSbO33ItYMj/view?usp=sharing<br>Before/after UI screenshots: https://drive.google.com/drive/folders/1cpiEMAlggtkVrRb36BRZUeSeM9n1033o?usp=sharing<br>Clarity dashboard: `[[ share link — see appendix A2 ]]` |
| **Google Analytics or website traffic report** | ✅ **Present.** GA4 property `G-Y902DS1JCN` on both `www.spield.live` and `app.spield.live`, with cross-domain session stitching and per-route pageviews across all 62 static pages. Reporting window begins when the tag went live on the marketing site, so it is short — state the window on the export rather than letting the reviewer assume it is a year of data. | Exported traffic report (PDF): `[[ attach — see appendix A1 ]]`<br>Live site: https://www.spield.live |
| **Customer interview summary or feedback documentation** | ⚠️ **Partial → the main gap.** What exists today: written reviewer feedback from the award programme's deliverable review, and the usability findings from the session above. What does not exist yet: a structured interview programme. Eight to ten interviews are scheduled for Weeks 1–2 (§7) with the summary document produced from them. | Interview log + summary: `[[ to be produced — see appendix A3 ]]`<br>Usability findings, as shipped changes: https://drive.google.com/drive/folders/1cpiEMAlggtkVrRb36BRZUeSeM9n1033o?usp=sharing |
| **Other — live product, on chain and publicly verifiable** | ✅ Spield is live on Stellar mainnet as of 1 September 2026: six contracts deployed, 24/24 wiring assertions passed, every live WASM fetched back and confirmed byte-identical to the built binary, admin held by a 2-of-3 multisig, and a 50 USDC guarded cap enforced on chain. The full lifecycle — deposit, redeem at maturity, claim yield — has been walked on mainnet with real USDC. | Solvency dashboard (no wallet needed): https://app.spield.live/solvency<br>Live app: https://app.spield.live<br>Deposit tx: https://stellar.expert/explorer/public/tx/275816022291398656#275816022291398657<br>Redeem tx: https://stellar.expert/explorer/public/tx/275838884402204672#275838884402204673<br>Claim-yield tx: https://stellar.expert/explorer/public/tx/275838927352209408#275838927352209409 |
| **Other — cross-chain on-ramp proven with real funds** | ✅ A real Base → Stellar USDC transfer on mainnet, burn and mint, landing in the app's transfer history. | Burn on Base: https://basescan.org/tx/0xc03074fa4c140eccccce151aa8561a97942957b4ee572c0eab086c91651c2eda<br>Mint on Stellar: https://stellar.expert/explorer/public/tx/275407794239995904#275407794239995905 |
| **Other — B2B / developer segment traction** | ✅ `@spield/sdk` v0.4.2 published on npm, verified by fresh install into an empty project reading live testnet data. `[[ N ]]` weekly downloads. | https://www.npmjs.com/package/@spield/sdk |
| **Other — pre-launch demand signal** | ✅ Email waitlist collected from the landing page before the product existed. `[[ N ]]` addresses. | Export: `[[ attach CSV — see appendix A5 ]]` |
| **Other — content / search demand instrument** | ✅ 62 indexed pages (24 guides, 20 glossary terms, 2 comparisons, 3 hubs) built against a 300+ keyword demand map, plus machine-readable endpoints (`llms.txt`, `ai.txt`) for AI-engine citation. | https://www.spield.live/learn · https://www.spield.live/glossary · https://www.spield.live/compare |

**Notes.** The evidence bar for this form is *"clear, verifiable, and reviewable by the
Chapter Lead with minimal technical expertise."* That is why the solvency dashboard leads the
on-chain row — it is the one link that requires no wallet, no explorer literacy and no trust
in us. Put it first in conversation too.

Two rows are honestly marked ⚠️. Do not upgrade them. A Chapter Lead who clicks through and
finds a demo recorded alone when the row claims a customer call will discount every other row
on the page; a row that says "partial, and here is the date it closes" costs nothing.

---

# 7. Next Steps

### 7.1 Planned Customer Development Activities

> **PASTE**
>
> Every activity below is an activity with a customer: someone we talk to, watch, recruit,
> survey, or sell to. The ordering is deliberate. The two things this plan is missing are
> direct conversations and customer-facing demos, so those run in Week 1 and nothing waits
> behind them.
>
> **Target for the period: 10 recorded interviews, 5 customer-facing demos, 1 survey with
> 20+ responses, 2 signed design partners, and every one of them producing a document or a
> recording the Chapter Lead can open.**

| Timeline | Planned Activity | Expected Outcome |
|---|---|---|
| **Week 1** | **Recruiting push for the interview programme.** Direct email to the full waitlist, a recruiting post from `@spield_`, a request in the Ambassador Chapter, and outreach in the Stellar and Blend community channels. Waitlist first, since they already raised a hand, then the Chapter, then community channels. Offer is 20 to 30 minutes, no pitch, something real for their time. | A booked calendar of 8 to 10 interviews with Segment 3.1.1, plus a recruiting log showing response rate per channel. Which channel actually produces a conversation is itself a finding about where this customer lives. |
| **Week 1–2** | **8 to 10 structured customer interviews, recorded with consent.** Run from the fixed 12-question script in appendix A3, which withholds any description of Spield until question 9 so comprehension is tested rather than coached. Questions 7 and 8 put **H1** directly (what would you give up for certainty); question 11 puts **H5** directly (does unaudited and capped change your answer). Recruited from the waitlist, the Chapter, Blend users, and any existing depositor. | An interview summary document: count, recruiting source, segment split, a validated or invalidated verdict on **H1** and **H5**, objections ranked by how many people raised them, and 5 to 8 verbatim quotes, with raw recordings linked. This is the single highest-value artefact of the period and it closes the §6.2 row currently marked partial. |
| **Week 1–2** | **5 live product demos with named prospective customers**, screen shared and recorded, not a pre-recorded walkthrough sent as a link. Three from Segment 3.1.1 (USDC holders and Blend suppliers), two from Segment 3.1.2 (treasury, payroll and payment businesses) approached through the Chapter and SCF developer channels. The person is asked what they think the product does before we tell them. | Genuine customer-facing demo recordings, which closes the first evidence row in §6.2, plus an objection list ranked by frequency and a direct read on **H2** and **H3** (whether comprehension, not yield, is the constraint). |
| **Week 1–2** | **Behavioural read of real, unprompted visitors.** Publish a fixed-window GA4 and Clarity baseline across both hosts: top pages, source and medium, the site to app cross-domain conversion rate, and the funnel from landing page to deposit panel. This is customer development by observation, and it covers the visitors who will never answer an email. | A numeric baseline every later activity is measured against, the first quantitative read on **H6** (search is the channel), and a named drop-off point in the deposit journey to fix in Week 3. |
| **Week 3–4** | **Waitlist survey, 8 questions, under two minutes** (appendix A4). Question 4 forces a choice between 4% floating and 3% fixed, which is **H1** in one line; question 7 asks whether an unaudited protocol is usable at a capped size. One link, mailed to the full waitlist. | A quantitative check on whether the qualitative interview finding holds at a sample size interviews cannot reach: reported count, the split on Q4 and Q7, and the ranking on Q6. |
| **Week 3–4** | **Friction pass driven by watching real sessions.** Review every Clarity recording of a visitor who reached the deposit panel and did not deposit, ship fixes for the top three drop-off points, then measure the same funnel again. Revealed preference rather than stated preference. | A measured before and after completion rate on the deposit panel, with the three shipped changes named. Evidence for **H2** and **H3** from behaviour rather than opinion. |
| **Week 3–4** | **Recruit 2 B2B design partners for `@spield/sdk`**, each with a scoped integration written together on a recorded call. Approach Stellar wallets, payment apps and Soroban teams through the Ambassador Chapter and SCF developer channels. A builder integrating the SDK live is simultaneously a design partner and a demo with a potential customer. | Two signed scoped integrations and the recorded integration calls. First real test of **H7**: does a builder embed rather than build? |
| **Week 3–4** | **Recruit the first PT and YT counterparties by hand.** Rather than waiting for a market to arrive, approach the yield-trading sub-segment directly: talk to prospective LPs about the 80% fee split that favours them, and ask PT and YT buyers what would make them take the other side of a fixed rate. | Conversation notes on why a counterparty would or would not take the trade, plus whatever reserves and volume actually appear. First data on **H8**, which nothing can be learned about while reserves are `[0, 0]`. |
| **Week 4–5** | **Post-maturity depositor interviews.** After the 30 September redeem settles, return to the people who deposited and ask what the experience was worth to them and whether they are rolling into a second series. | Post-outcome evidence on **H1** in its strongest available form, because the person has now received the payout they were promised, plus a stated roll-forward rate. |
| **Beyond current period** | **Segment 3.1.2 discovery interviews on treasury terms**, once an audit exists to answer the first question this segment asks. Position sizes, approval process, who signs, and what maturity dates a treasury actually plans around. | A treasury segment interview summary and a maturity requirement list, which is what decides **H9** (whether one 30-day maturity is enough or the product needs a ladder). |
| **Beyond current period** | **Second-series cohort follow-up.** Do first-series depositors roll into the next maturity, and where they do not, ask each of them why not. | A cohort retention number with a stated reason behind every non-renewal, rather than a churn rate with no explanation attached. |

**Notes.** Every row names a person or a group, how they are reached, and what document or
recording exists at the end of it. Week 1 opens with recruiting rather than building, which is
the answer to the form's stated purpose: capital going to a project that engages users, not one
that develops in isolation.

Kept out of the table on purpose: seeding the PT and SR pool, the third-party audit and staged
cap increases, pointing the SDK at mainnet, and the fuzz and property test layer. These are
engineering work, not customer development, and listing them here is what made the earlier
draft read as a roadmap. Two of them are still dependencies you should track privately. The
counterparty conversations in Week 3 need the pool seeded first, and the design partners want
a mainnet SDK.

If the form gives you less room than this, submit the first four rows and the two Beyond rows.
Interviews, demos, the behavioural baseline and the survey are the ones that close the two
gaps §6.2 marks as partial.

---

# 8. Evidence Verification Checklist (for Chapter Leader use)

### 8.1 Evidence Assessment

**Leave this section blank.** It is completed by the Ambassador Chapter Lead, not by you.
Reproduced here so the submitted document contains the full form.

| Evidence Category | Present | Partial | Missing | Comments |
|---|---|---|---|---|
| Loom recording of a product demo with a potential customer | | | | |
| User testing recording or UX session video | | | | |
| Google Analytics or website traffic report | | | | |
| Customer interview summary or feedback documentation | | | | |
| Other | | | | |

**Our own honest self-assessment**, offered so the Lead is not surprised — put this in the
covering note or say it in the review call rather than filling their table in for them:

| Evidence Category | Our assessment | Why |
|---|---|---|
| Product demo with a potential customer | **Partial** | Recordings exist; customer-facing sessions are scheduled for Week 1–2. |
| User testing / UX session video | **Present** | One moderated session, plus continuous Clarity session replay on both hosts. |
| Google Analytics / traffic report | **Present** | GA4 live on both hosts with cross-domain stitching; the reporting window is short and is stated as such. |
| Customer interview summary | **Partial** | Programme reviewer feedback and usability findings exist; the structured interview programme starts Week 1. |
| Other | **Present** | Live mainnet protocol, public solvency page, verified cross-chain transfer, published SDK, 62-page corpus. |

---

# Appendix — how to produce the evidence that is still missing

Written as instructions, not as intentions. Each one is a few hours of work at most.

### A1 — Google Analytics traffic report (needed for §6.2 row 3)

1. Open GA4 for property **`G-Y902DS1JCN`**.
2. **Reports → Reports snapshot**, set the date range to the full window since the tag went
   live on `www.spield.live`. Do not use a rolling "last 28 days" — state the true window.
3. Capture four views and export each with **Share → Download file → PDF**:
   - Reports snapshot (users, sessions, engagement).
   - **Engagement → Pages and screens** — this shows which of the 62 content pages get traffic,
     which is the direct read on **H6**.
   - **Acquisition → Traffic acquisition** by source/medium — organic vs direct vs social.
   - **Explore → Funnel exploration** if you have time: landing page → any `/learn/*` →
     outbound to `app.spield.live`. This is the cross-domain number that matters and the whole
     reason the linker was wired up.
4. Merge into one PDF, name it `spield-ga4-<start>-to-<end>.pdf`, attach it and put the same
   Drive link in the table.
5. **Also connect Google Search Console** if it is not already, and export the Performance
   report. For a content-led strategy, GSC impressions and average position are better early
   evidence than GA sessions, because the corpus will be earning impressions before it earns
   clicks.

### A2 — Clarity session recordings (strengthens §6.2 row 2)

1. Open Clarity project **`wjr8mkggic`**.
2. **Recordings** → filter to sessions that visited the deposit route on `app.spield.live`.
3. Pick 3–5 that show real friction — rage clicks, dead clicks, or a visit to the deposit
   panel that ends without a transaction. Those are worth more than smooth ones.
4. Use **Share** on each recording to produce a link the Chapter Lead can open without a
   Clarity account. If sharing is restricted, screen-record playback instead and put it in the
   same Drive folder as the other evidence.
5. Export the **Heatmap** for the landing page and the deposit page as images.
6. In the table, state the recording count and how many reached the deposit panel. A small
   honest number with a link beats a large unverifiable one.

### A3 — Customer interview programme (closes §6.2 row 4 — do this first)

**Recruiting, in descending order of quality.** Waitlist emails (they already raised a hand —
highest intent) → the Ambassador Chapter itself, which is the single best source here and is
already obligated to help you → Stellar community channels and Blend users → replies to a
recruiting post from `@spield_` → existing depositors, once there are any.

Offer 20–30 minutes and something real for their time. Say plainly that you are not selling.

**Script — 12 questions, ordered so the sell never comes before the learning.** Do not
describe Spield until question 9.

1. Do you hold USDC on Stellar today? Roughly how long?
2. What is it doing right now — sitting, lent on Blend, something else?
3. Walk me through the last time you tried to earn yield on it. What happened?
4. *(if they stopped)* What made you stop or not start?
5. When you last saw an APY quoted, what did you actually expect to receive?
6. Has a variable rate ever moved in a way that changed a decision you had made?
7. If you could lock a rate for 30 days, what would you need it to be? — *listen for whether
   they name a number at all; "I'd just want to know" is the H1 signal.*
8. What would you give up for that certainty — upside, liquidity, both?
9. *(now show the product — screen share, do not send a link)* Here is what we built. Tell me
   what you think this does, in your words. — *this is the H2/H3 comprehension test; stay
   silent while they read.*
10. What is the first thing that makes you hesitate?
11. This is not audited yet and deposits are capped at 50 USDC. Does that change your answer?
    — *the H5 question, asked directly.*
12. What would have to be true for you to put in 500 USDC?

**Recording and consent.** Ask at the start, on the recording: *"Is it OK if I record this so
I don't have to take notes?"* Loom, Zoom or Meet are all fine — the form says Loom but means
"a watchable recording."

**Output.** One summary document with: how many interviews, how recruited, the segment split,
a verdict line on H1 and H5, the top objections ranked by how many people raised them, and
5–8 verbatim quotes. **Verbatim quotes are what make it credible** — a paraphrase reads as
your opinion. Then link the raw recordings.

**Ten interviews is enough.** Patterns repeat by the sixth or seventh. Do not delay the
summary waiting for a round number.

### A4 — Waitlist survey (Week 3–4)

Google Form, 8 questions, under two minutes, one link mailed to the waitlist. Say what you
will do with the answers.

1. Do you currently hold USDC on Stellar? (Yes / No / I hold USDC on another chain)
2. If another chain — which?
3. What do you do with stablecoins today? (Nothing / Lend for variable yield / Trade /
   Something else)
4. Which would you pick: 4% floating, or 3% fixed for 30 days? — *this is H1 in one question,
   and it is the most important line in the survey.*
5. What is the smallest amount you would try a new protocol with?
6. What stops you from using a new DeFi protocol? (multi-select: not audited / don't
   understand it / too many steps / gas and fees / no way to get funds there / other)
7. Would you use a fixed-rate product before it has been audited, if deposits were capped?
   (Yes / No / Only with a small amount)
8. Anything you would want us to explain better? (free text)

Report the count, the split on Q4 and Q7, and the ranking on Q6. Even 20 responses is
publishable evidence when you state the sample size honestly.

### A5 — Waitlist export

`GET /waitlist` on the server returns the collected emails, or read the `users` collection in
Mongo directly. **Export a count and a signup-date histogram for the form — not the address
list.** Emails are personal data and the form does not need them; a Chapter Lead does not need
to see them and you should not hand them over.

### A6 — On-chain traction numbers (once deposits exist)

- **Depositors:** the holders tab on the SR contract
  `CCOZ2JGQAPLUOG5RVU3TLPGSS7WA356BWCOEWFBJU44DKHDRZTQPABBS` and the PT contract
  `CBGA2TFTSF236VYPI5TVYQ2Z53DKD6LQHIR5DCGKSNIUJ4NAPNBI6VJM` on Stellar Expert.
- **TVL against the cap:** the solvency dashboard at https://app.spield.live/solvency — the
  reviewer-friendly version of the same fact, no wallet required.
- Note that the vault seed of 2 USDC consumes part of the 50 USDC cap, so headroom for real
  users started at 48 USDC. Say that rather than reporting TVL as if it were all customer
  money — a reviewer who works it out themselves will trust the rest of the document less.

### A7 — B2B design partners (tests H7)

Two integrations beat twenty stars. Approach Stellar wallets, payment apps and Soroban teams
through the Ambassador Chapter and the SCF developer channels. Offer to write the integration
with them on a call, record it, and the recording doubles as the product demo the form asks
for — a builder integrating your SDK live *is* a demo with a potential customer.
