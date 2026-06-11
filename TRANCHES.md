# Spield — SCF Build Award Proposal (3 Tranches · $30,000)

> **Spield is the fixed-income layer for Stellar.** Deposit USDC, get a Principal Token (PT)
> that redeems 1:1 at a fixed maturity date, plus a Yield Token (YT) for leveraged variable
> yield. The yield is real and on-chain — it comes from **Blend** (Stellar's main lending
> protocol), so the vault is **solvent by construction**, not by trust.

**Track:** Build Award — **Integration Track** (we integrate existing Stellar building blocks —
Blend, Allbridge, MoneyGram, DeFindex — rather than reinventing them).
**Requested:** **$30,000** in XLM · **Timeline:** ~4 months (within the 6-month cap).

---

## How SCF funds this (so the tranches below make sense)

SCF Build Awards pay in four installments tied to deliverables, and the structure is fixed:

| Payment | % | Amount | Tied to |
|--------|----|--------|---------|
| **#0 — on acceptance** | 10% | **$3,000** | Award accepted; kickoff |
| **Tranche 1 — "MVP"** | 20% | **$6,000** | First integration working end-to-end (testnet → mainnet) |
| **Tranche 2 — "Testnet expansion"** | 30% | **$9,000** | Depth: fiat rails + more yield sources |
| **Tranche 3 — "Mainnet launch"** | 40% | **$12,000** | Adoption surface live on mainnet: SDK + integrations |

Deliverables must be **clear, measurable, verifiable, and outcome-based**, and the final tranche
must be **live and usable on mainnet** — under SCF v7, mainnet deployment alone is not enough; the
project must be usable, discoverable, and positioned for adoption. Every deliverable below names
something a reviewer can **test or load**.

---

## Where we are today (the starting line — already built, tested, live)

This is not a wish list. The hard, risky engineering is **done**:

- **Core protocol live on Stellar mainnet** (2026-06-08): four contracts — wrapper, strategy,
  vault, market — initialized against the **real Blend FixedV2 pool** and **real Circle USDC**.
  Live on-chain `code_hash` matches the source-built WASM.
- **Three product layers**, ≈120 tests green **against real Blend WASM** (not mocks):
  PT/YT engine · Fixed-Rate Vault ("lock X% until date D", solvent by construction) ·
  Pendle/Notional-style log-curve **Yield AMM** with implied-vs-realized APY charts.
- **Mainnet-hardened**: upgrade timelock, two-step admin rotation, time-aware rate bounds,
  maturity-aware storage TTL, paginated harvest, pause-blocks-inflows-allows-exits, atomic
  constructor deploy, on-chain `code_hash()` verifiability, off-chain solvency monitor.
- **Cross-chain bridging — first integration already wired**: Allbridge Core
  ([allbridge.ts](frontend/src/lib/allbridge.ts)) with live transfer-status tracking
  ([bridgeHistory.ts](frontend/src/lib/bridgeHistory.ts)).
- **Frontend**: multi-network, full Deposit / Vault / Markets / Liquidity / Activity flows.
- **Public docs site** (Fumadocs) — concepts, guides, developer reference.

**Honest framing for reviewers:** because the *core* is already on mainnet, we apply on the
**Integration Track**. Each tranche delivers a **new integration** (capital rails → fiat rails →
builder SDK) that itself goes testnet → mainnet — so we respect the MVP→testnet→mainnet cadence
without pretending the protocol is unbuilt. That's a *strength*: SCF's risk is lower because the
make-or-break solvency engineering already works on mainnet today.

---

## Tranche 1 (20% · $6,000) — Production Mainnet & Cross-Chain Capital In

**Outcome:** anyone, from any major chain, can move USDC into Spield and earn a fixed rate on
mainnet — protocol seeded, under multisig custody, and publicly monitored for solvency.

**Why first:** the contracts are live but **unseeded** — deposits revert until capital backs them.
This turns "deployed" into "usable," and makes cross-chain the front door.

### Deliverables (verifiable)
- **Seed mainnet for real use.** Seed the Fixed-Rate Vault (PT capacity) and the Market (PT/USDC
  liquidity) so a first external user completes deposit → fixed receipt → redeem end-to-end on
  mainnet. **Seed sizing (explicit):** initial seed of **$2,000–$3,000 USDC total** split across
  the vault and the market — deliberately small and **funded from the project's own treasury, NOT
  from grant XLM** (grant funds cover development, not protocol liquidity). This is a
  bootstrap/demonstration depth that proves the full lifecycle; deeper liquidity scales with real
  demand after launch. *Verifiable: a public deposit + redeem tx on mainnet.*
- **Multisig custody.** Rotate all four contract admins from the single hot deployer key to a
  multisig (capability already built; this executes it). *Verifiable: on-chain admin = multisig.*
- **Cross-chain on-ramp, productionized.** Promote Allbridge from "wired" to "production":
  mainnet routes from EVM + Solana + Tron USDC → Stellar USDC, trustline + Soroban-restore edge
  cases handled, live status in the UI. *Verifiable: a bridge-in transfer landing on mainnet,
  shown in the app's transfer history.*
- **Native-USDC route (CCTP-ready).** Add Circle CCTP / native-USDC swap alongside the pooled
  route (1:1 burn-and-mint, no wrapped-asset slippage) — wired the moment Allbridge's CCTP-on-
  Stellar route is live, with a "any token → Stellar USDC" fallback meanwhile. *Verifiable: route
  selector in the bridge UI; a CCTP transfer on a supported corridor.*
- **Public solvency dashboard.** Surface the on-chain solvency view + off-chain monitor as a
  public page (backing ≥ principal, per contract). *Verifiable: public URL.*

### Polish that compounds
- One-click "bridge then deposit" combined flow (kill the two-step friction).
- Mainnet `max_apr_bps` calibrated against Blend's real historical max borrow APR.
- Bridge fee + ETA preview before signing; failed-transfer recovery copy.
- Seed/monitor runbook committed (reproducible operations).

**Success signal:** ≥1 external wallet completes a cross-chain-funded fixed-rate deposit on
mainnet; solvency dashboard public; admin = multisig on-chain.

---

## Tranche 2 (30% · $9,000) — Fiat Rails + More Yield (Depth)

**Outcome:** a user with **cash or a bank account and no crypto** can fund a fixed-rate position;
and the protocol stops being single-source — users choose among **multiple Stellar-native yield
sources**, across **multiple maturities** (a real yield curve).

**Why second:** crypto-in is solved in T1; the adoption unlock is **fiat-in** + **more yield to
strip**. Payments/remittance and RWA are the two categories SCF funds most — this tranche hits
both. The `YieldStrategy` adapter trait was built on day one precisely so new sources drop in
without a rewrite.

### Deliverables (verifiable)
- **MoneyGram on-ramp (cash/bank → USDC → PT).** Integrate MoneyGram Ramps (Ramps/Access API +
  SEP-24 interactive flow): auth + funds keypairs, USDC trustline, allowlisting, sandbox →
  production. User buys USDC with fiat and lands in a deposit flow. *Verifiable: a sandbox
  on-ramp completing into a Spield deposit + demo video; then a small real mainnet run.*
- **MoneyGram off-ramp (PT redemption → USDC → cash/bank).** At maturity, redeem PT → USDC →
  cash via MoneyGram. *Verifiable: sandbox off-ramp from a redeemed position.* MoneyGram Ramps
  reaches cash deposits in 30+ countries and withdrawals in 170+.
- **Second live yield source via the existing adapter.** Add at least one more source behind
  `YieldStrategy` — **DeFindex** (yield aggregator) and/or a second Blend pool — earning on
  mainnet. *Verifiable: a position backed by the new strategy, solvency holding.*
- **RWA yield track — testnet integration + mainnet plan (deliberately scoped honestly).** Wire a
  tokenized-treasury / yield-bearing-RWA source (BENJI-class, or a yield-bearing stablecoin such
  as Figure's YLDS / MGUSD) through a thin strategy wrapper. **We commit to a *working testnet*
  integration plus a written mainnet rollout plan — NOT a live mainnet RWA position in this
  grant.** Reason stated plainly: BENJI-class and regulated-RWA assets carry real
  **availability, permissioning, KYC, and jurisdictional/regulatory constraints** that are
  outside our unilateral control, so we will not over-promise a mainnet date we can't guarantee.
  *Verifiable: a testnet position backed by the RWA strategy + the documented mainnet plan with
  its constraints.*
- **Multiple maturities = a yield curve.** Deploy ≥2 fixed-term markets (e.g. 30 / 90 day) and
  render implied-APY-by-maturity. *Verifiable: the curve chart with ≥2 live maturities.*

### Polish that compounds
- KYC handoff, country/asset availability gating, fee/ETA disclosure in the ramp flow.
- Persisted ramp history alongside bridge history (same pattern).
- Strategy registry view (source, current rate, plain-language risk tier).
- Auto-rollover option (roll a matured position into the next term).
- "Fiat → fixed yield" and "Compare yield sources" guides in docs.

**Success signal:** a fiat→PT path demonstrated end-to-end (sandbox, then small mainnet);
≥2 yield sources live on mainnet; ≥2 maturities tradeable; RWA strategy proven on testnet with a
public, constraint-aware mainnet plan.

---

## Tranche 3 (40% · $12,000) — Spield as Infrastructure: Embeddable Builder SDK (Mainnet Launch)

**Outcome:** other developers embed Spield's fixed-rate yield into **their own** software in an
afternoon. Payroll/treasury platforms park idle balances in PT for safe fixed returns; payment
processors vest funds in fixed-receipt coupons; traders get a clean leveraged yield-trading
surface. Spield stops being one app and becomes a **primitive** — the SCF v7 "positioned for
adoption" bar, met concretely.

**Why this is the final (mainnet) tranche:** it's the highest-leverage outcome and depends on
everything before it being real (live, funded, fiat-connected, multi-source). Developer
infrastructure / SDKs is one of the three categories SCF most consistently funds, because it
multiplies ecosystem impact.

### Deliverables (verifiable)
- **`@spield/sdk` — a typed TypeScript client, published.** Package the existing client libs
  (`spield.ts`, `vault.ts`, `market.ts`) into a documented, versioned npm SDK: quote a fixed
  rate, deposit, fetch positions/receipts, check solvency, redeem — a handful of functions, no
  Soroban expertise required, **pointed at mainnet by default**. *Verifiable: published npm
  package + a runnable example repo.*
- **Three integration recipes (the three audiences).** Copy-pasteable worked guides:
  1. **Treasury / payment management** — "park held funds in PT for fixed, low-risk returns."
  2. **Payroll / accounts** — "vest payroll into fixed-receipt coupons for safer growth."
  3. **Yield traders** — "trade YT with leverage" via the Market + router helpers.
  *Verifiable: three docs pages, each with a minimal working sample.*
- **Reference integration / demo dApp on mainnet.** A small standalone app (not the main
  dashboard) consuming the SDK end-to-end against mainnet, proving a third party's path.
  *Verifiable: deployed demo + source.*
- **"Integrate Spield" developer docs.** API reference, mainnet contract addresses, events, error
  codes, the solvency-read pattern, typedoc. *Verifiable: the docs section.*
- **(Stretch) PT as Blend collateral.** Spec + testnet spike for using Spield PT as Blend
  collateral — the composability lever behind Pendle's growth. *Verifiable: design doc + spike if
  time allows.*

### Polish that compounds
- SDK quick-start runnable against testnet in <5 minutes (SCF's UX bar).
- Semver discipline + changelog on the public surface.
- OpenAPI/Postman-style collection for the read endpoints.
- "Why fixed income for builders" explainer aimed at non-DeFi product teams.

**Success signal:** `@spield/sdk` published and installable; the reference dApp completes a
deposit→redeem against **mainnet** via the SDK; three integration recipes live; Spield discoverable
and usable by an external builder.

---

## Budget — what the $30,000 funds

Grant funds cover **development of the integrations above** (future work, per SCF rules — not past
work, not protocol liquidity, not general operations):

| Area | Share | Covers |
|------|-------|--------|
| Cross-chain rails (Allbridge prod + CCTP) | ~20% | Route hardening, edge cases, status UX, RPC/relayer costs |
| Fiat rails (MoneyGram on/off-ramp) | ~25% | Ramps/SEP-24 integration, compliance UX, sandbox→prod |
| Yield-source expansion (DeFindex + RWA + curve) | ~25% | New `YieldStrategy` adapters, multi-maturity markets, registry |
| Builder SDK + recipes + reference dApp | ~25% | `@spield/sdk`, docs, three recipes, demo app |
| Audit prep / monitoring / ops hardening | ~5% | Solvency monitor ops, multisig setup, runbooks |

> **Protocol seed liquidity (the ~$2–3k USDC in Tranche 1) is funded from the project's own
> treasury, NOT from grant XLM** — grant money builds the product; the team bootstraps the pool.

---

## The throughline (the strategy, not a feature list)

Each tranche removes a different barrier between **a user's money** and **safe, fixed on-chain
yield**, and widens *who* Spield is for:

1. **Capital can get in** — crypto, any chain (Allbridge + CCTP) →
2. **Cash can get in, and there's real diverse yield to strip** — fiat (MoneyGram, 170+ countries)
   + Blend + DeFindex + RWA, multi-maturity →
3. **Anyone can build on it** — SDK → payroll, treasury, payments, and yield traders.

After this grant: not a demo, but a **live, funded, fiat-connected, multi-source fixed-income
primitive on Stellar that other teams ship inside their own products.**

---

## How this proposal is stronger than typical SCF submissions

Lessons applied from recent funded rounds (SCF #33–#41; ~25% of submissions awarded, avg ~$93K):

- **Lower execution risk than peers.** Most applicants are mid-build; Spield's core is *already on
  mainnet with ~120 real-Blend tests*. The grant funds integration + distribution, not the risky
  part — a reviewer-friendly position.
- **Hits SCF's top-funded categories at once.** Payments/remittance (MoneyGram), RWA/institutional
  yield (BENJI/DeFindex track), and developer infrastructure (SDK) are exactly the buckets that
  dominate recent awards (Rubic, Meria, MugglePay, Spydra, Neovestor, the SDK projects).
- **Integration Track fit is clean.** We compose Blend + Allbridge + MoneyGram + DeFindex rather
  than reinventing — the Track's stated intent.
- **Every deliverable is verifiable**, and we **scope honestly** (RWA is testnet+plan, seed is
  team-funded and sized) — credibility over hype, which the v7 reviewer rubric rewards.

---

### Sources / references
- SCF Build structure, tracks, budget rules —
  [budget & deliverable guidelines](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines) ·
  [submission criteria](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria) ·
  [SCF v7 launch (Open / Integration / RFP tracks)](https://stellar.org/blog/ecosystem/introducing-scf-v7) ·
  [funded projects](https://communityfund.stellar.org/projects) ·
  [2025 impact report](https://medium.com/stellar-community/stellar-community-fund-2025-impact-report-6f6c6361aaca)
- MoneyGram Ramps —
  [Stellar docs](https://developers.stellar.org/docs/tools/ramps/moneygram) ·
  [MoneyGram developer docs](https://developer.moneygram.com/moneygram-developer/docs/integrate-moneygram-ramps) ·
  [API launch](https://www.pymnts.com/cryptocurrency/2025/moneygram-launches-api-for-embedding-crypto-on-off-ramp-functionality/)
- Yield / RWA landscape —
  [Messari Stellar ecosystem overview (Blend, DeFindex)](https://messari.io/report/stellar-ecosystem-overview) ·
  [BENJI five years](https://stellar.org/press/franklin-templeton-stellar-development-foundation-mark-five-years-of-benji-the-first-u-s-registered-tokenized-money-market-fund) ·
  [yield-bearing assets on Soroban](https://stellar.org/blog/developers/yield-bearing-assets-stellar-soroban)
- Cross-chain — [Allbridge Core docs](https://docs-core.allbridge.io/) ·
  [Circle CCTP](https://www.circle.com/cross-chain-transfer-protocol)
