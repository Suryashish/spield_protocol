# Section 4 assumptions: before and after

Companion to [CUSTOMER-DEV-PLAN-REVIEW.md](CUSTOMER-DEV-PLAN-REVIEW.md), item 4.2, which asked for a
falsification clause on every assumption. All twelve now have one. This file reviews those clauses on a
single test: **if the assumption is false, does the stated pivot still exist?**

Three of them fail that test. The rest need sharpening rather than replacing.

| # | Assumption | Verdict on the fallback | What changes |
| --- | --- | --- | --- |
| 1 | Variable yield is a real problem | **Broken** | Pivot dies with the assumption |
| 2 | Demand for fixed yield on Stellar | **Broken** | Same pivot, same failure; reframe as market size |
| 3 | Comprehension and trust are barriers | Sound, false dichotomy | Add the third branch (awareness) |
| 4 | PT/YT is learnable through UX | **Broken** | Fallback is already the assumption |
| 5 | Predictability beats high APY | Sound, fallback unavailable | Cannot compete on rate; narrow the segment |
| 6 | Demand for trading yield separately | **Broken and load-bearing** | Vaults still need the floating counterparty |
| 7 | Builders integrate rather than build | Sound, mis-sequenced | Split the two claims, gate on the audit |
| 8 | Trust and solvency affect adoption | Sound | Do not act on a false reading; measure the ceiling |
| 9 | Cross-chain access matters | Sound, inverted default | Third-party bridges are the default, not the fallback |
| 10 | Stellar is the right environment | Weak as an assumption | Retire the platform half, keep the dependency half |
| 11 | Simple initial offering | Sound, incomplete | Rollover matters more than breadth |
| 12 | Education and distribution as channels | Sound, self-overlapping | Split content from business development |

---

## 1. Variable DeFi yield creates a real problem for some users

**Before**

> If this assumption proves incorrect, Spield may need to place greater emphasis on yield trading and
> higher-upside strategies rather than fixed-rate products.

**Why this fails.** Yield trading is the other side of the same trade. YT is worth buying only because
someone is paying to shed variance, so if nobody values certainty there is no PT bid and no YT market
to pivot into. The clause also scopes the claim to "some users", which is trivially true and therefore
cannot be falsified.

**Modify into**

> We assume some users and businesses will accept a lower expected return in exchange for a known
> return and a known maturity date. The open question is not whether anyone prefers certainty in the
> abstract, but what they will pay for it: the spread between the prevailing Blend variable APY and the
> fixed rate a user will still accept.
>
> **Falsification test.** Across at least 15 qualified conversations, record the maximum discount to
> variable APY each participant will accept. If the median is under 50 bps, certainty is not being
> priced and the assumption is false.
>
> **If this assumption proves incorrect,** the response is not yield trading, which is the counterparty
> side of the same trade and fails with it. The available responses are to treat the underlying rate as
> too stable for variance to be worth hedging and reposition around leverage on yield and access rather
> than predictability, or to accept that adoption is driven by convenience and distribution rather than
> by the rate structure at all.

---

## 2. There is demand for fixed-yield products on Stellar

**Before**

> If this assumption proves incorrect, Spield may need to focus more heavily on yield trading,
> variable-yield strategies, or other DeFi products rather than fixed-yield offerings.

**Why this fails.** Same escape hatch as assumption 1, used a second time, and it cannot rescue both.
As written this assumption is also largely assumption 1 with a chain attached, so the two fail together
and give false independence when counted separately.

**Modify into**

> Distinct from assumption 1, which is about the preference itself, this assumption is about market
> size: we assume the population currently supplying USDC to Stellar lending markets is large enough,
> and underserved enough, to support a fixed-income layer on top of it. Stellar has lending and
> yield-generating infrastructure but limited access to products separating predictable principal
> returns from exposure to future yield.
>
> **Falsification test.** Once capacity exists (see the status note below), measure fixed-rate deposits
> as a share of the deposit cap over a defined window, and the conversion rate from Blend suppliers
> contacted directly. State both numbers before the window opens.
>
> **If this assumption proves incorrect,** the constraint is the size of the addressable Stellar DeFi
> base rather than the product, and yield trading does not escape it because it draws on the same
> population. The responses are to widen the funnel through cross-chain onboarding (assumption 9) and
> business integrations (assumption 7), or to treat Stellar as the deployment venue while sourcing
> demand from users who do not choose their chain.
>
> **Status.** SR `deposit_cap` is 50 USDC and vault coupon capacity bounds total fixed-rate deposits at
> roughly 2 USDC. This assumption cannot be tested at any meaningful size until the cap is raised and
> the vault reseeded.

---

## 3. Comprehension and trust are significant barriers to DeFi yield adoption

**Before**

> If this is incorrect, product development may need to prioritize rate competitiveness and incentives
> more heavily than education and transparency.

**Why this needs work.** The logic is valid but the choice is false. If comprehension is not the
constraint, the most likely explanation is not that rates are: it is that nobody has heard of Spield.
The clause also bundles trust, which assumption 8 already covers, so a result here cannot tell you
which of the two was binding.

**Modify into**

> We assume comprehension is a binding constraint on adoption, separately from trust, which assumption
> 8 addresses. Users may hesitate because they do not clearly understand what return they will receive,
> where the yield originates, or what risks they are taking, independently of whether they believe the
> protocol is solvent.
>
> **Falsification test.** In usability sessions, compare conversion between participants who can
> correctly restate what they receive at maturity and those who cannot. If the two groups convert at
> similar rates, comprehension is not binding.
>
> **If this assumption proves incorrect,** do not default to rate competitiveness and incentives. The
> third explanation, which must be ruled out first, is that awareness rather than understanding is the
> constraint. Rate competition is in any case not available to Spield, for the reason given in
> assumption 5.

---

## 4. Users can understand the PT/YT model when presented through appropriate UX

**Before**

> If this assumption proves incorrect, Spield may need to abstract PT/YT mechanics almost entirely from
> the user experience and focus on simpler vault-based fixed-yield products.

**Why this fails.** The assumption already concedes its own fallback: it states that "much of the PT/YT
complexity may be abstracted behind a simple deposit experience". A test that fails into the thing you
had already planned to do is not a test. The real risk is also mis-stated. The hard part is not the
terminology, it is a term that cannot be abstracted away: the fixed rate holds only to maturity, and an
early exit prices at market and can return less than principal.

**Modify into**

> We assume users do not need to understand PT and YT mechanics to use the fixed-yield product safely,
> provided the deposit flow states the expected return, the maturity date, and the consequences of
> exiting before maturity. The distinction that matters is between vocabulary, which can be abstracted,
> and economics, which cannot: "fixed" holds to maturity, and an early exit is a sale at market price.
>
> **Falsification test.** After completing the deposit flow in a usability session, ask participants
> what happens if they need their money before the maturity date. If they cannot answer correctly, the
> abstraction is concealing a material term rather than simplifying an unfamiliar one.
>
> **If this assumption proves incorrect,** the response is not further abstraction, because the failure
> is economic rather than terminological. Either surface an explicit early-exit disclosure with a live
> exit quote inside the flow, or remove early exit from the retail product and offer hold-to-maturity
> only, which is a defensible product and an honest one.

---

## 5. Predictability can be a stronger value proposition than a high APY

**Before**

> If this assumption proves incorrect, Spield may need to compete more heavily on yield levels,
> incentives, and higher-return strategies rather than positioning predictability as the primary value
> proposition.

**Why this needs work.** The assumption is fine; the fallback is not an option Spield holds. The fixed
rate is sourced from Blend, so it is bounded above by Blend's own variable rate net of protocol
revenue. Out-yielding the variable alternative requires a subsidy by construction.

**Modify into**

> For treasury managers, businesses, and users planning around future cash requirements, we assume
> certainty about return and maturity is worth more than the highest available variable yield.
>
> **Falsification test.** Reuse the accepted-discount number from assumption 1, segmented by user type.
> If business and treasury respondents do not accept a larger discount than retail respondents, the
> segment thesis behind this assumption is false even if assumption 1 holds.
>
> **If this assumption proves incorrect,** Spield cannot respond by competing on yield levels. The
> fixed rate is derived from Blend's variable rate less protocol revenue, so exceeding the variable
> alternative requires a subsidy and is not a durable position for a protocol of this size. The
> response is to narrow to users for whom predictability is a requirement rather than a preference
> (payroll runway, escrow, invoice and vendor terms, scheduled disbursements) and to accept a smaller
> addressable market with a stronger reason to buy.

---

## 6. There is demand for trading future yield separately from principal

**Before**

> If this demand does not develop, Spield can place greater emphasis on vault-based fixed-yield
> products that do not depend on active secondary-market participation.

**Why this fails, and why it is the most important one to fix.** It reads as graceful degradation and
is not. A fixed rate for depositors requires some party to absorb the variance. If YT demand does not
appear, that party is the protocol. The clause quietly converts a market-making problem into a
balance-sheet problem while presenting it as a simplification.

**Modify into**

> We assume advanced DeFi users will buy or sell Yield Tokens to adjust exposure to changes in the
> underlying rate, and that yield traders and liquidity providers will support a functional secondary
> market for these positions.
>
> **Falsification test.** Named LP or trader commitments, and realised two-sided volume once the market
> is seeded. Intent expressed without a seeded market is not evidence.
>
> **If this demand does not develop,** vault-based fixed yield is not a free fallback. Someone must
> absorb the variance, and without YT demand that party is the protocol, funded from reserves or from
> the spread. The fallback is therefore to underwrite the fixed rate deliberately: an explicit reserve,
> a deposit cap sized to that reserve, a conservative quoted rate, and a public statement that the
> protocol is the counterparty. Presenting a protocol-underwritten vault as market-neutral would
> contradict assumption 8.
>
> **Status.** Market reserves are `[0, 0]`. PT and YT cannot currently be traded on mainnet, so this
> assumption cannot be validated or invalidated in section 6.1 until the AMM is seeded.

---

## 7. Businesses and developers may prefer integrating rather than building

**Before**

> If this assumption proves incorrect, Spield may need to prioritize direct user acquisition and
> development of the standalone application rather than SDK integrations and ecosystem distribution.

**Why this needs work.** The fallback is a genuine alternative, so the clause is sound. Two structural
problems remain: the assumption bundles two separable claims, and it is gated on an assumption being
tested in parallel with it.

**Modify into**

> We assume, separately, that (a) Stellar builders in payroll, treasury, wallet, remittance and payment
> applications want fixed-yield functionality in their products at all, and (b) those who do would
> rather integrate Spield's SDK than build the underlying infrastructure. Only (a) determines whether
> the market exists. (b) determines whether Spield captures it.
>
> **Dependency.** This assumption is gated on assumption 8. A company routing customer funds will not
> integrate an unaudited protocol regardless of SDK quality, so a negative result before the audit
> tests trust rather than build-versus-buy and must not be recorded as invalidating (b).
>
> **If this assumption proves incorrect,** prioritise direct user acquisition and the standalone
> application, and treat the SDK as a post-audit workstream rather than a parallel one.

---

## 8. Trust, solvency, and transparency will materially affect adoption

**Before**

> If this assumption proves incorrect, Spield may be able to place relatively less emphasis on
> additional transparency mechanisms and prioritize product functionality, rates, liquidity, and
> distribution instead.

**Why this needs work.** The clause is logically sound and the listed mitigations are the right ones.
The problem is that the assumption is near-certainly true, so testing it validates a foregone
conclusion, and a false reading here would be produced by selection bias rather than by evidence.

**Modify into**

> Because Spield manages user funds and maturity-based claims, we assume users need clear information
> about how positions are backed, where yield comes from, contract risks, and protocol solvency, and
> that the absence of a formal audit is a material adoption barrier for larger positions.
>
> **Already in place as of 2026-09-01:** contracts deployed to Stellar Public and verified
> byte-identical to the built artifacts, admin rotated to a 2-of-3 multisig, an on-chain deposit cap,
> and a locked PT issuer.
>
> **Falsification test.** The informative measure is not whether users say trust matters, which they
> will. It is the maximum position size each user will take before an audit exists. That number is the
> pre-audit TVL ceiling and should be collected in every conversation.
>
> **If this assumption proves incorrect,** do not reduce transparency. Early users declining to ask
> about solvency at sub-1 USDC positions is selection bias from position size, not evidence that
> transparency is unnecessary at scale. A genuine negative result would be large depositors arriving
> without asking, which the current deposit cap makes impossible to observe.

---

## 9. Cross-chain access to Stellar USDC may materially affect user acquisition

**Before**

> If Stellar-native users provide sufficient demand, maintaining native cross-chain infrastructure may
> become less important and third-party bridges or exchanges could instead handle this part of the user
> journey.

**Why this needs work.** Framed backwards. Third-party bridges are the correct starting position, not
the fallback. Native cross-chain infrastructure is expensive to operate and adds attack surface and a
second trust burden, which works directly against assumption 8.

**Modify into**

> We assume some potential users do not currently hold assets on Stellar, and that third-party bridges,
> exchanges and existing on-ramps are sufficient to get them there. Native cross-chain infrastructure
> is not the default: it is costly to operate and adds an attack surface and a second trust burden that
> works against assumption 8.
>
> **Falsification test.** Measured drop-off at the funding step. If more than half of users who reach
> the deposit screen without a Stellar USDC balance fail to complete within 48 hours, third-party
> routes are insufficient and native onboarding earns its cost.
>
> **If this assumption proves incorrect,** invest in a native path only for the specific source chains
> the drop-off data implicates, rather than for the full CCTP surface.
>
> **Status.** Analytics on both hosts is pageviews only, so this drop-off cannot currently be measured.
> Funnel instrumentation is a prerequisite for testing this assumption at all.

---

## 10. Stellar is an appropriate environment for this product

**Before**

> If this assumption proves incorrect, Spield may need to reconsider its underlying yield sources,
> infrastructure design, or potentially its dependence on Stellar as the sole environment for the
> product.

**Why this needs work.** Half of it is already answered and half is misfiled. The technical question
was settled when six contracts went live on 2026-09-01 and the full fixed-yield lifecycle ran on
Soroban with USDC and Blend. That belongs in section 6.1 as a finding with the deployment as evidence,
not in section 4 as an open assumption. What remains open is not a platform question at all: it is a
single-source dependency.

**Modify into**

> **Move the platform claim to section 6.1** as validated, citing the 2026-09-01 deployment.
>
> **Replace it with the dependency assumption, which is still open:** we assume Blend can absorb
> Spield's deposits without materially moving the rate the fixed quote was priced against, and that a
> single underlying yield source is an acceptable concentration for the launch period.
>
> **Falsification test.** Simulate a deposit at target size against the deployed Blend pool on chain,
> not against local fixtures, which understate the real pool. If a deposit at the intended cap moves
> the supply APY by more than the spread the fixed rate is priced on, capacity rather than demand is
> the binding constraint on the product.
>
> **If this assumption proves incorrect,** the response is a second yield source or a lower cap, not a
> different chain.

---

## 11. A simple initial product offering may be preferable to many maturities

**Before**

> If this assumption proves incorrect, Spield may need to introduce a broader range of maturity periods
> and concurrent fixed-yield series earlier in the product roadmap.

**Why this needs work.** The clause is sound and cheap to act on. What is missing matters more: the
only live series matures 2026-09-30, maturity is immutable, there is no roll function, and a new series
means a new deployment. Breadth is the second question. Continuity is the first.

**Modify into**

> We assume early users benefit from a small number of clear maturity and rate choices rather than a
> maturity ladder, which lets Spield test demand without fragmenting liquidity.
>
> **The prior question is continuity, not breadth.** The only live series matures 2026-09-30 and cannot
> be extended, so a depositor arriving in late September buys a few days of term and there is nothing
> to deposit into afterwards until a second series ships. A rollover path is required rather than
> optional and belongs in the plan as a Week 1-2 deployment item with a date and an owner.
>
> **Falsification test.** The share of maturing depositors who ask for or accept a rollover into the
> next series, and the number who ask for a maturity other than the one offered.
>
> **If this assumption proves incorrect,** introduce additional maturities and concurrent series
> earlier in the roadmap. The rollover path is needed either way.

---

## 12. Education and ecosystem distribution can become meaningful acquisition channels

**Before**

> If these channels generate limited conversion, distribution efforts may need to shift toward
> partnerships, community programs, and direct business development.

**Why this fails as a test.** Community participation, developer outreach and ecosystem partnerships
appear in the assumption and again in the fallback, so a negative result cannot distinguish between
them. The clause points back at itself.

**Modify into**

> We assume two distinct channels, with different timelines and different failure signals:
>
> **(a) Search and content.** Users actively searching for how to earn yield on Stellar, fixed income,
> and Stellar DeFi safety. Slow, compounding, measured in impressions, qualified sessions and assisted
> conversions.
>
> **(b) Ecosystem business development.** Stellar community participation, developer outreach and
> partnerships. Relationship-driven, lumpy, measured in named opportunities and integration
> conversations started.
>
> **Falsification test.** Set a target per channel before the window opens, and evaluate them
> separately.
>
> **If (a) generates limited conversion,** shift effort to (b). **If (b) does,** shift to direct
> acquisition. **If both fail,** the constraint is not the channel: it is the product's trust position
> before an audit (assumption 8), and no channel will fix that.
>
> **Status.** Analytics is pageviews only on both hosts, so channel (a) cannot currently be attributed.
> Instrument before claiming a result.

---

## Assumptions that should be added

**A. The fixed rate can be sourced profitably.** The plan assumes demand for a fixed rate but never
states that Spield can pay one. The assumption is that the spread between the quoted fixed rate and
realised Blend yield over the full term, net of protocol revenue, stays positive under adverse rate
movement. This is the assumption whose failure ends the product, and it is the only one not currently
listed.

**B. Regulatory framing.** A defined return with a defined maturity, marketed to businesses, is the
shape a regulator reads as a deposit or a fixed-income security in several jurisdictions. The payroll
and treasury customer in assumption 7 is precisely the counterparty who will ask first. If this
applies, the B2B path needs a compliance answer before it needs an SDK.

---

## Cross-cutting fixes

1. **The yield-trading fallback appears in assumptions 1, 2 and 6.** It is the counterparty side of the
   same trade in all three, so it cannot rescue any of them, let alone all three. Each needs its own
   distinct pivot, written above.

2. **Twelve assumptions are really about seven.** Assumptions 1, 2 and 5 are one preference claim in
   three forms; 3 and 8 are one trust claim. The redundancy makes the validation surface look broader
   than it is. Either merge them or state on each what distinguishes it from its neighbour, as done
   above for 1 and 2.

3. **No thresholds anywhere.** Every clause is hedged with "may be" and scoped to "some users", which
   makes the set unfalsifiable by construction. Each assumption now carries an observable, a magnitude,
   and a window. Keep that shape.

4. **Three assumptions cannot currently be measured at all:** 6 (market reserves are `[0, 0]`), 9 and
   12(a) (pageview-only analytics). Fix the instrument or remove the claim from the plan window. Do not
   report either as validated.
