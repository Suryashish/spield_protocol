# Spield v2 — Build Plan

> **What this is:** a plan to rebuild Spield as a clean, properly-engineered **fixed-income /
> yield-stripping protocol on Stellar/Soroban**, with **Blend as the native, asset-backing yield
> source** and settlement in **Stellar-native USDC**. It is grounded in (a) the existing system
> (`existinginfo.md`), (b) research into how Pendle/Exponent/Notional/Kimia/Boros actually work,
> and (c) **the SCF #43 Build Award reviewer feedback**, which this plan is explicitly engineered to beat.
>
> **Read order:** **§0 how this answers the SCF rejection (read first)** → §1 idea → §2 competitive
> research → §3 design decisions → **§3.5 Blend as the yield source (the core fix)** → §4 architecture
> → §5 contracts & data → §6 the AMM → §7 yield accounting → **§7.4 solvency & the accounting-bug
> fixes (read this)** → §7.5 is classic PT/YT the right primitive? → §8 phases/roadmap → §9 open
> questions → §11 evolving the protocol → §12 the Stellar differentiator → §13 summary.

---

## 0. How This Plan Answers the SCF #43 Rejection (read first)

The SCF Delegate Panel rejected v1. The feedback was detailed and **correct** — it identified
foundational design and accounting flaws, not polish issues. This plan treats every point as a
hard requirement. Summary of what they said and where v2 fixes it:

| # | SCF reviewer finding | Root problem | Where v2 fixes it |
|---|---|---|---|
| 1 | **"Direct port of Pendle, no new primitive — reads like Integration not Open Track."** | No novelty; just an EVM port | §3.5 + §12 — Spield becomes **Stellar's fixed-income layer over Blend + RWA yield**, a *composition* native to Stellar, not a port. The novelty is the integration + the bond product, not the PT/YT math. |
| 2 | **"Yield is bridged Ethereum sUSDe, not Stellar-native; marketplace is hardcoded escrow, not a real AMM."** | Wrong yield source + fake market | §3.5 (**Blend** = native yield) + §6 (**real time-decay AMM**). Bridge deleted entirely. |
| 3 | **"Vault is undercollateralized by design — the index is just a number; nothing backs the rising value. First claimant drains it."** | **The fatal flaw.** Off-chain index with no on-chain asset growth. | **§3.5 + §7.4** — yield now comes from **Blend bTokens whose `bRate` actually rises**, so the escrow *genuinely grows*. The index *is* Blend's real exchange rate. Solvency is an enforced invariant. |
| 4 | **"`UserEntryIndex` overwritten on every mint → silent loss of accrued yield."** | Accounting bug | §7.4 — per-position accounting (mint a fresh position NFT/record per deposit; never overwrite). |
| 5 | **"`transfer_yt` doesn't propagate entry index → phantom yield, exploitable by any buyer."** | Accounting bug | §7.4 — entry index travels *with* the YT (embedded in the position), or YT is fungible with a global accumulator. Settled on transfer. |
| 6 | **"`claim_yield` burns entire YT balance → YT is single-shot, not a tradable derivative."** | Accounting bug | §7.4 — claim settles, **never burns** YT; YT keeps accruing to maturity. |
| 7 | **"`initialize()` has no access control / one-shot guard → anyone can re-init and repoint the oracle."** | Security bug | §7.4 — `if storage.has(Initialized) { panic }` guard + admin-gated init on every contract. |
| 8 | **"Bridge is single-signer, not 'trust-minimized'; compromised key drains the vault."** | Overstated trust model | Bridge **deleted**. Yield source is Blend (no privileged minter). Where any admin exists, it's **honestly described** and on a path to multisig (§3.6). |
| 9 | **"TTL extension missing in wrapper & orderbook → state gets archived, no restore flow."** | Will-break bug | §7.4 — `extend_ttl` after every persistent write, everywhere. Explicit archival/restore tests. |
| 10 | **"Zero test coverage — test files are unmodified `hello-world` scaffolds that don't even compile."** | Misrepresentation | §8 — TDD from Phase 0; the worked examples + every bug above become regression tests. Coverage is real and measured. |
| 11 | **"A Pendle-style AMM is a research project, not a 4-week deliverable; constant-product is the wrong curve."** | Unrealistic scope | §8 — **rebaselined timeline**; AMM is its own multi-week phase with the fixed-point math budgeted; constant-product is explicitly only a throwaway test scaffold, not the product. |
| 12 | **"$90K high for a 2-person undergrad team with no prior Soroban/DeFi shipping, to deliver a clone + bridge + AMM + mainnet in 4 months."** | Scope vs team mismatch | §8 — **narrowed scope** (no bridge; phased; ship the *solvent core* first), honest milestones, realistic timeline. |

**The single most important takeaway:** finding #3 (undercollateralization) was the protocol-killer,
and it has **one clean fix** — *stop inventing an index; let Blend's real bToken exchange rate BE the
index.* When yield comes from an asset that actually grows on-chain, the vault is solvent by
construction. Everything else is correct engineering on top of that. The rest of this document is
written so a reviewer re-reading it sees each of their points answered.

---

## 1. The Idea (unchanged at the core)

Take a **yield-bearing position** and split it into two tradable tokens. (Concretely in v2: the user
deposits **USDC**, the protocol turns it into a yield-bearing **Blend** position, and splits *that*.)

- **PT (Principal Token)** — a zero-coupon-bond-like claim. Redeems **1:1** for the principal (USDC) at maturity. Trades at a **discount** before maturity.
- **YT (Yield Token)** — a claim on **all yield generated** by the position until maturity. Trades for a small price; gives **leveraged** exposure to the yield rate.

The invariant that governs everything:
```
Value(position) = Value(PT) + Value(YT)
```

What we're building is **DeFi fixed income**: let users choose *fixed* (buy/hold PT) or
*variable/leveraged* (buy YT) exposure to a yield they would otherwise be forced to hold as-is —
on top of **real, on-chain Stellar-native yield (Blend)**, not an invented or bridged one.

> **What was wrong with v1 (and what v2 fixes) — see §0 for the full SCF mapping:**
> 1. **Undercollateralized by design** — the index was a number with no backing asset growth; first claimant drained the vault → v2 sources yield from **Blend bTokens that actually accrue** (§3.5, §7.4). *This is the one that mattered.*
> 2. **Hard-coded PT/YT prices** (0.97 / 0.03) → v2 has **market-discovered** pricing via a real AMM.
> 3. **A fake orderbook** (fixed-price escrow) → v2 has a **real yield AMM** with time-decay (§6).
> 4. **Broken accounting** (entry-index overwrite, non-propagating transfers, YT burned on claim) → v2 has **per-position accounting that never loses or fabricates yield** (§7.4).
> 5. **Cross-chain EVM bridge + single trusted relayer** → **deleted**; v2 is **Stellar-native only**, yield from Blend (no privileged minter).
> 6. **`hello-world` crates, zero real tests, no access control / TTL** → **proper structure, TDD, init guards, TTL everywhere** (§7.4, §8).

---

## 2. Competitive Research — How the Leaders Do It

These are the protocols whose design we're learning from. The pattern is remarkably consistent: **SY/PT/YT split + a custom time-aware AMM + an index-based yield accounting model**.

### Ethereum — **Pendle** (the category leader, the reference design)
- **3-token standard: SY → PT + YT.** `SY` (Standardized Yield) is a wrapper that normalizes any yield-bearing token into one interface. It is then split into `PT` + `YT`. Minting always produces **equal amounts** of PT and YT.
- **`pyIndex` (the core accounting primitive).** A monotonically-increasing exchange rate between SY and PT/YT. As the underlying earns yield, the index rises. Redeeming `PT + YT` returns *more* SY than was deposited — the difference is the accrued yield.
- **Real-time YT yield, claimable anytime.** 1 YT = the right to all yield of 1 unit of underlying until maturity. Yield streams continuously and can be claimed **without** touching PT.
- **A purpose-built AMM** (not Uniswap-style): a **log-normal curve** where PT price **converges to par (1.0)** and YT price **decays to 0** as maturity approaches. Curve steepness scales with time-to-maturity (`rateScalar`, `rateAnchor`). Because of the fixed maturity, **LPs who stay to maturity have ~zero impermanent loss**.
- **"Ratchet" oracle protection.** The PT index **never decreases** even if the underlying is hacked/slashed — losses are pushed onto YT holders, protecting principal.
- **Hybrid liquidity.** V2 added a **limit orderbook** alongside the AMM; the router sources from both for best execution.
- **Implied APY** is the headline UX number — derived from the PT price + time-to-maturity.

### Solana — the "Pendle comps" (closest to our Stellar situation)
- **Exponent** — the Solana market leader for fixed yield. Same PT/YT stripping. Key innovation: a **"Time-Dynamic AMM"** that **concentrates liquidity dynamically as assets approach maturity** to optimize execution and cut IL. Productizes two flows: **"Income"** (sell variable → get fixed PT) and **"Farm"** (lever up on YT at an implied APY). LPs supply via **Liquidity Vaults**.
- **RateX** — positions as **leveraged YT trading** (up to **10×**). Capital-efficient bets on yield direction. Good model for an "advanced/degen" tier later.
- **Sandglass** — first pool-based yield trading on Solana; pool-based PT/YT. Lower liquidity; mainly a proof the model ports off-Ethereum.

### Solana — **Kimia** (the one you flagged; a different, instructive twist)
- **Yield source = perp funding rates, not lending/staking yield.** Kimia runs its own **CLOB for perpetuals**, runs **delta-neutral vaults**, and the yield is the **funding longs pay shorts** ("real funding," not repackaged borrow rates).
- **Same PT/YT split on the vault shares:** PT locks the funding rate to maturity; YT captures everything above the fixed rate.
- **A yield AMM where price converges to par at maturity** — same convergence principle as Pendle/Exponent.
- **Risk infra worth copying:** an **insurance fund** and an **auto-pause** (pauses after 24h if the insurance fund depletes), plus T+1 settlement on its `kUSD`.
- **Takeaway for us:** Kimia shows the model generalizes beyond staking yield to *any* rate stream — and that **risk management (insurance fund, circuit breakers)** is a first-class feature, not an afterthought.

### The cross-protocol pattern (our blueprint)
| Concern | How everyone solves it | Spield v2 |
|---|---|---|
| Token model | Wrap underlying → split into equal PT + YT | Same |
| Yield accounting | A **monotonic index** (`pyIndex`); yield = index delta × balance | **Index = Blend's real `bRate`** (not invented) |
| Backing | Underlying SY token actually accrues value on-chain | **Blend bTokens actually accrue** → solvent by construction |
| Trading | A **custom AMM** where PT→par and YT→0 as maturity nears (time-decay) | Same (Phase 3) |
| LP IL | Killed by the **fixed-maturity** structure (hold-to-maturity = no IL) | Same |
| UX headline | **Implied APY / Fixed APY**, derived from PT price + time | Same; PT-as-bond is the hero |
| Risk | Insurance fund + circuit breaker (Kimia) | Reserve buffer + breaker + public solvency view |

---

## 3. Key Design Decisions for Spield v2

Decisions made up-front so the build is coherent. (Genuinely open ones are in §9.)

1. **Stellar-native, single chain.** No EVM, no bridge. Underlying + settlement (USDC) both live on Stellar as SACs. This deletes an entire class of v1 bugs and the biggest trust hole.

2. **Yield source = Blend, behind a thin Strategy Adapter.** Day-one yield is a **Blend** supply position (real, on-chain-accruing — §3.5). It sits behind a **`YieldStrategy` adapter** trait so a second source (DeFindex, tokenized RWA) drops in later **without a rewrite**. This is the SY-style abstraction, made concrete around Stellar-native yield.

3. **Replace the fake orderbook with a real yield AMM.** This is the single biggest upgrade. PT/YT prices become **market-discovered**, an **implied APY** falls out naturally, and LPs earn fees. (Curve details in §6.)

4. **Index-based yield accounting (Pendle-style `pyIndex`).** Adopt the monotonic-index model so YT yield is **claimable in real-time without redeeming PT**, and the `PT + YT = underlying` invariant holds by construction.

5. **Markets are fixed-term and re-deployable.** Each market has an immutable `maturity`. After maturity, settlement only. New terms = new markets (new PT/YT). This matches every comparable and keeps accounting clean.

6. **No yield oracle to harden — because there's no yield to push.** The #1 v1 weakness (a trusted
   key feeding an index) is *deleted*, not patched: the yield index is **Blend's real on-chain
   `bRate`** (§3.5), read live. Nothing to fake, no key to compromise.
   - A price oracle (**Reflector** — Pulse free/5-min, Beam paid/faster) is needed **only later**, to *value PT as collateral on Blend* (§11.1) — not for the core yield.
   - Where the wrapper reads `bRate`, apply a **sanity bound** (reject absurd jumps) as defence-in-depth, even though Blend's state is trusted.

7. **Risk management is a feature, not a TODO.** Borrow from Kimia: an **insurance/reserve buffer** and a **circuit breaker / pause** authority, plus a documented solvency invariant the contracts enforce.

8. **Clean contract boundaries.** Separate concerns: **Tokenization (wrapper)**, **AMM/Market**, **Token assets (SAC)**, **strategy adapter**. No `hello-world` crates. Shared types in a workspace crate.

9. **🔑 Yield comes from a real, on-chain-accruing asset — not an off-chain number.** This is the decision that fixes the SCF #3 flaw. The wrapper holds a *genuinely growing* asset (Blend bTokens), and "the index" is that asset's *real* exchange rate. See §3.5. **This single change makes the vault solvent by construction.**

---

## 3.5 Blend as the Yield Source — The Core Fix (answers SCF #2 & #3)

> **This is the most important section of the whole plan.** The v1 fatal flaw was: deposit N
> `stsUSDe` → mint N PT + N YT, then `update_yield_index` just bumps a *number* while **no asset is
> actually accruing inside the contract**. At maturity the wrapper owes N (PT) + yield (YT) but
> holds only N. First claimant paid; everyone after hits an empty vault. **We fix this by making the
> escrowed asset actually grow — using Blend.**

### How Blend makes the vault solvent by construction
**Blend** is the most widely-integrated lending protocol on Stellar (used by Meru, Lobstr, Airtm).
Critically for us: when you **supply** an asset to a Blend pool, you receive **`bTokens`**, and
*Blend `bTokens` convert to the underlying at a `bRate` that **rises as interest accrues***
(the same rising-share-price mechanism as ERC-4626 / Pendle's SY). This is the property v1 was
missing entirely.

**The new deposit flow:**
```
User deposits  N USDC
      │
      ▼
Wrapper supplies N USDC to a Blend pool  ──►  receives bTokens (worth N USDC now)
      │                                          (bRate = entry rate)
      ▼
Wrapper mints  N PT  +  N YT  to the user, records entry bRate
      │
      ⏳  time passes — borrowers pay interest — Blend's bRate RISES
      │       the wrapper's bTokens are now worth N + realYield USDC  ← REAL on-chain growth
      ▼
At maturity:
   redeem_pt  → withdraw N USDC-worth from Blend, pay PT holders 1:1      (principal: covered)
   claim_yield→ the extra (bRate growth × YT) is REALLY THERE in the bTokens (yield: covered)
```
Because the yield is **realized interest sitting in the bTokens**, the wrapper can always pay every
PT holder their principal *and* every YT holder their yield. **The vault cannot be drained, because
every unit of promised value corresponds to a unit of value that Blend actually accrued.**

### "The index" is no longer invented — it IS Blend's bRate
- v1: `update_yield_index(number)` pushed by a trusted relayer → fictitious, unbacked, exploitable.
- v2: the index = **Blend's on-chain `bRate`**, read via cross-contract call. It rises **only because real interest was paid into the pool**. No relayer can fake it; there is nothing to push.
- This **also fixes SCF #8** (the single-signer trust problem): there's no privileged "yield updater" key to compromise, because yield isn't pushed — it's *pulled* from Blend's real state.

### Yield accounting against Blend (precise)
```
entry_bRate  = Blend bRate at mint            (per position — see §7.4)
current_bRate= Blend bRate now (cross-contract read)
yield_per_YT = current_bRate − entry_bRate    (in underlying terms, fixed-point)
YT payout    = yield_per_YT × YT_amount       (always backed by realized bToken growth)
PT redeem    = withdraw principal-equivalent from Blend, 1:1 in USDC
```
This is the *same shape* as the §7 index math — but now the index is real and the assets exist.

### Why this also answers "no new primitive" (SCF #1)
We're no longer "porting Pendle." We're building **the first native fixed-income / rate-stripping
layer on top of Blend** — turning a *variable* Blend supply rate into a **tradable fixed rate (PT)**
and a **yield position (YT)**. That composition (Blend → Spield → a fixed-rate bond + an AMM) is a
**Stellar-native primitive**: it gives Blend suppliers something they cannot get today (lock a fixed
rate; sell future yield; trade the rate). The PT/YT *math* is borrowed; the *primitive* — fixed
income over Stellar's lending market — is new to the ecosystem.

### Strategy-adapter abstraction (keep the door open, don't over-build)
Wrap the Blend interaction behind a thin **`YieldStrategy` adapter** trait:
`deposit(amount) → shares`, `redeem(shares) → amount`, `current_rate() → bRate`,
`position_value(shares) → amount`. Day-one implementation = **Blend**. Later implementations =
**DeFindex** (vault aggregator) or a **tokenized-RWA** wrapper (§12) — *without touching the
wrapper/AMM*. This is the §3.2 adapter, now concretely defined around Blend.

### What we must verify during Phase 0 (de-risk the dependency)
- Exact Blend v2 `submit`/supply/withdraw call interface and request types (from `blend-contracts-v2`).
- How to read `bRate` / position value on-chain for a cross-contract call.
- Withdrawal liquidity edge cases (Blend utilization high → withdrawal may need to wait); design the maturity/redeem flow to tolerate it (e.g. partial withdrawals, a small reserve buffer).
- Whether we supply **directly** to an existing Blend pool or deploy **our own** Blend pool (Blend is permissionless — deploying our own gives us parameter control and is itself a point of novelty).

---

## 4. Target Architecture (Stellar-only)

```
┌─ Stellar Soroban (Public Network) — everything on one chain, no bridge ─────────┐
│                                                                                │
│   User deposits USDC                                                           │
│        │                                                                       │
│        ▼                                                                       │
│  ┌──────────────────────────────────────┐   supply/withdraw   ┌────────────┐  │
│  │ Tokenization (Wrapper) Contract       │────────────────────►│  BLEND     │  │
│  │  - deposit → Blend, mint PT + YT       │                     │  pool      │  │
│  │  - per-POSITION entry bRate (no over-  │◄────read bRate──────│ (bTokens,  │  │
│  │    write), claim settles (no burn)     │   (the real index)  │  rising    │  │
│  │  - redeem_pt / claim_yield / combine   │                     │  bRate)    │  │
│  │  - enforces solvency invariant         │                     └────────────┘  │
│  │  - init guard + TTL on every write     │      ▲ REAL yield accrues here       │
│  └───────────────────┬──────────────────┘       │ (borrower interest)           │
│                      │ transfer PT/YT (SAC)                                     │
│                      ▼                                                          │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │ Market / Yield AMM Contract   (one per (market, maturity))                │ │
│  │  - PT/USDC pricing via time-decay curve · implied APY · LP shares · fees  │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                                │
│  Strategy adapter:  Blend (day 1)  →  DeFindex / tokenized-RWA (later, §12)     │
│  SAC assets:  USDC (native, the deposit + settlement asset)  ·  PT  ·  YT       │
│  Risk:  reserve buffer  ·  pause/circuit-breaker  ·  public solvency view       │
│  Frontend: React/Vite + Freighter + @stellar/stellar-sdk                       │
└────────────────────────────────────────────────────────────────────────────────┘
```

**Why this shape:** the yield isn't pushed by a trusted key — it's **pulled from Blend's real,
rising `bRate`**, so the escrowed assets genuinely grow and the vault is solvent by construction
(fixes SCF #3). Each contract has one job, talks via Soroban's synchronous (re-entrancy-safe)
cross-contract calls, and can be tested/upgraded independently. **Note there is no off-chain index
updater and no oracle-push** — that whole trust surface (and the v1 single-signer risk, SCF #8) is
gone. A price oracle (Reflector) is only needed later for *valuing PT as collateral on Blend* (§11.1),
not for the core yield.

---

## 5. Contracts, State & Functions

> **Note vs v1/the SCF feedback:** there is **no "Yield Oracle" yield-pushing contract** anymore.
> The yield index is Blend's real `bRate`, read live. The contract that *was* the oracle is replaced
> by a thin **Strategy Adapter**. Every contract below has an **init guard**, **access control**, and
> **TTL extension on every persistent write** (fixes SCF #7, #9).

### A. Strategy Adapter — *the bridge to real yield (Blend)*
**Job:** abstract "where yield comes from" so the wrapper never hard-codes Blend. Day-1 impl = Blend.

- **Trait:** `deposit(amount) → shares`, `redeem(shares) → amount`, `current_rate() → bRate`, `position_value(shares) → amount`.
- **Blend impl:** wraps Blend pool `submit`/supply/withdraw; reads `bRate` / position value via cross-contract call. No privileged keys — it only moves the wrapper's own funds in/out of Blend.
- **Later impls:** DeFindex (vault aggregator), tokenized-RWA wrapper (§12) — drop-in, no wrapper changes.

### B. Tokenization (Wrapper) Contract — *the derivative engine (rewritten to be solvent & correct)*
**Job:** deposit user USDC into Blend, mint PT+YT, track **per-position** entry rate, pay real yield.

- **State (instance):** `Admin → Address`, `Initialized → bool` (one-shot guard), `Maturity (u64)`, `StrategyAddr`, `PtAsset`, `YtAsset`, `Usdc`, `TotalPrincipal`, `TotalShares` (Blend shares held), `Paused → bool`.
- **State (persistent, per-position — NOT per-user-overwritten):** a `Position { owner, principal, entry_rate, settled_rate }` keyed by a **position id** (fixes SCF #4 — never overwrite a prior entry rate). PT/YT issued as **SACs** so they're freely transferable.
- **`initialize(admin, maturity, strategy, ...)`** — **`if Initialized { panic }`**; admin-auth (fixes SCF #7).
- **`mint(user, amount)`** — `user.require_auth()`; pull `amount` USDC; **`strategy.deposit(amount)`** → shares; read `entry_rate = strategy.current_rate()`; create a **new Position** (never overwrite); mint `amount` PT + `amount` YT; **`extend_ttl`**.
- **`claim_yield(position_id)`** — read `current_rate`; `yield = (current_rate − settled_rate) × YT_in_position`; withdraw `yield`-worth from Blend; pay user; **set `settled_rate = current_rate`** and **DO NOT burn YT** (fixes SCF #6); clamp ≥0; `extend_ttl`.
- **`redeem_pt(position, amount)`** — gated `now ≥ maturity`; burn PT; withdraw principal-equiv from Blend; return `amount` USDC 1:1; `extend_ttl`.
- **`combine_and_redeem(position, amount)`** — anytime; auto-`claim_yield` first (no silent yield loss), then burn equal PT+YT, withdraw + return principal; `extend_ttl`.
- **Solvency invariant (enforced & asserted in tests):** `strategy.position_value(TotalShares) ≥ TotalPrincipal + Σ unclaimed_yield`. Because Blend really accrued it, this holds by construction (fixes SCF #3).

> **On YT transfer & "phantom yield" (SCF #5):** two clean options, decided in Phase 1 —
> **(i) position-bound YT:** yield accrual lives in the `Position`; transferring YT means transferring/splitting the position, so entry rate always travels with it. **(ii) fungible YT + global accumulator:** a Pendle-style global `yieldIndex` accumulator with per-holder `userIndex` checkpoints updated on every transfer (mint/burn/move settles first). Either way, **a fresh buyer can never claim yield from before they held the YT.**

### C. Market / Yield AMM Contract — *price discovery + trading*
**Job:** let users trade PT and YT against USDC at market-discovered, time-aware prices; let LPs earn fees.

- **State:** reserves (`PT`, `USDC`), `Maturity`, curve params (`rateScalar` base, `rateAnchor`), `totalLpShares`, `feeBps`, optional `OrderBook` entries.
- **`add_liquidity` / `remove_liquidity`** — LP share accounting; IL-minimized by maturity convergence.
- **`swap_exact_pt_for_usdc` / `swap_exact_usdc_for_pt`** — trade PT along the time-decay curve.
- **YT trading** — either a parallel PT-style pool, or derived via the `PT + YT = underlying` identity + a router that mints/combines (Pendle's flash-style routing). **Decision in §9.**
- **`implied_apy() → i128`** — read-only; derived from PT price + time-to-maturity, for the UI headline.
- **(Phase 2) limit-order backstop** — price discovery when the curve range is exceeded.

### D. SAC Token Assets
- **USDC** — canonical **Stellar-native** Circle USDC. The **deposit asset, the settlement asset, and what PT redeems into**. Used via the standard token client; **no bridging**.
- **PT, YT** — issued as SACs so wallets/explorers see real balances and they're freely transferable/composable (and usable as Blend collateral later, §11.1). The Wrapper is the only mint/burn admin.
- *(There is no separate "underlying yield token" to hold — the yield-bearing position is the wrapper's **Blend bTokens**, held internally, not user-facing.)*

### Cross-contract call graph
```
Wrapper  ──deposit/withdraw/read bRate──►  Blend (via Strategy Adapter)   (mint, claim_yield, redeem)
Market   ──transfer_pt/yt (SAC)─────────►  PT/YT SAC                       (swaps, add/remove liquidity)
Frontend ──read-only sim────────────────►  all                            (balances, prices, implied APY)
```
All synchronous & stack-based → **re-entrancy impossible by design** (Soroban property we keep). The
Blend calls are the only external dependency; they move only the wrapper's own funds.

---

## 6. The Yield AMM (the hard, differentiating part)

This is what turns v1's fake marketplace into a real protocol. The math is the crux.

**Goal:** an AMM where, holding yield expectations constant, **PT price drifts toward 1.0** and
**YT price drifts toward 0** as `maturity` approaches — automatically, from the curve, so LPs
don't suffer impermanent loss for the predictable part of the price move.

**Approach (Pendle/Exponent-style log curve):**
```
proportion = PT / (PT + USDC_in_PT_terms)
rate       = rateAnchor − rateScalar × ln( proportion / (1 − proportion) )
PT_price   = f(rate, timeToMaturity)        // → 1.0 as t → 0
rateScalar = scalarRoot / timeToMaturity    // curve steepens near maturity
```
- **Implied APY** falls straight out of `PT_price` + `timeToMaturity` — the headline UX number.
- **IL minimization:** because the anchor/scalar shift the curve to track PT's natural march to par, LPs who stay to maturity get principal + fees back, ~no IL (the key selling point for liquidity).
- **Exponent's refinement** (later): *concentrate* liquidity dynamically as maturity nears for better execution.

**Build strategy (de-risked) — and a direct answer to SCF #11:**
The panel correctly said *"a Pendle-style AMM is a research project, not a 4-week deliverable, and
constant-product is the wrong curve for time-sensitive yield assets."* We agree. So:
1. **Internal scaffold only — constant-product.** A plain `x*y=k` PT/USDC pool exists **purely as a test harness** to validate the mint→trade→claim→redeem plumbing end-to-end. **It is never presented as the product or shipped to mainnet as the trading venue.** We say this explicitly, because v1's application gestured at constant-product as if it were the AMM.
2. **The real AMM — the time-decay curve — is its own multi-week phase** with the fixed-point math budgeted as the highest-risk line item (below), not a throwaway deliverable. This is where the "real yield AMM" claim is earned.
3. **Later — orderbook backstop + concentrated liquidity** (Pendle V2 / Exponent-style).

> **Implementation note (the highest-risk item in the project, stated honestly for the panel):** the
> log/`ln` + Newton-style approximations are genuinely hard on a `no_std` WASM target. We **budget a
> dedicated, separately-scheduled fixed-point math module + test suite** for it — and we do **not**
> claim "≥95% AMM coverage in 4 weeks." Pendle solves convergence with caching + approximation hints;
> we'll port an equivalent. Until the curve is audited-quality, the **fixed-rate product can ship on
> the solvent core alone** (PT redeemable at maturity) — the AMM is the *trading* layer, not a
> prerequisite for the *bond* working. This decoupling is what makes the timeline realistic.

---

## 7. Yield Accounting (get this exactly right)

The whole protocol's correctness rests on the index math. **The index is Blend's real `bRate`** (§3.5)
— monotonic because borrower interest only accrues, and *backed* because it reflects real assets. Rules:

1. **The index = `strategy.current_rate()` (Blend `bRate`).** Not a stored number, not pushed by a key. Read live via cross-contract call; apply a sanity bound as defence-in-depth.
2. **On mint:** record the position's **entry rate** in a **new Position** (never overwrite — SCF #4).
3. **YT payout:** `yield = (current_rate − settled_rate) × YT_amount`. **Clamp at 0** if negative (defence-in-depth; `bRate` only rises).
4. **Claiming does NOT burn YT.** After a claim, set `settled_rate = current_rate`; the YT keeps accruing until maturity (SCF #6 fix).
5. **Multiple deposits → multiple positions**, each with its own entry rate, so every tranche's yield is computed from its own entry point (SCF #4 fix). Transfers settle/carry the entry rate so a buyer can't claim pre-purchase yield (SCF #5 fix).
6. **APY headline:** derive an annualized rate from `bRate` change over a window; the AMM additionally surfaces a forward-looking **implied** APY from PT price.
7. **Solvency invariant, always:** `strategy.position_value(TotalShares) ≥ TotalPrincipal + Σ unclaimed_yield`. It is impossible to mint PT/YT not backed by a real Blend position. Asserted in tests after every operation (SCF #3 fix).

**Worked example (the canonical test case — now backed by real Blend yield):**
```
Deposit 100 USDC → wrapper supplies to Blend, bRate = 1.0000000 → mint 100 PT + 100 YT
Blend accrues interest, bRate rises to 1.0500000 (5% real interest paid by borrowers)
claim_yield(): profit = 100 × (1.0500000 − 1.0000000) = 5 USDC
  → withdraw 5 USDC-worth from Blend (it's really there), pay user,
    set settled_rate = 1.0500000, KEEP 100 YT (still earning)
At maturity: redeem 100 PT → withdraw 100 USDC-worth from Blend → user. Solvent. ✓
```

---

## 7.4 Solvency & the Accounting-Bug Fixes (the SCF teardown, point by point)

> The reviewers found six concrete financial/correctness bugs. This section shows the exact fix for
> each **and the regression test that proves it** — because "we fixed it" is worthless without the
> test the reviewers said didn't exist (SCF #10). Every one of these becomes a committed test.

**SCF #3 — Undercollateralization (the fatal one).**
*Fix:* yield is realized Blend interest, not an invented number (§3.5). *Invariant test:* after any
sequence of mints/claims/transfers/redeems, assert `strategy.position_value(TotalShares) ≥
TotalPrincipal + Σ unclaimed_yield`. *Drain test:* 10 users mint, index rises, **all 10** claim in
sequence → every claim succeeds, vault never empties (the v1 "first claimant drains it" scenario, now passing).

**SCF #4 — Entry index overwritten on top-up → silent yield loss.**
*Fix:* each deposit creates a **separate Position**; nothing is overwritten. *Test (the reviewers'
exact example):*
```
mint 100 YT at bRate 1.00  → Position A (entry 1.00)
mint 100 YT at bRate 1.05  → Position B (entry 1.05)   ← does NOT touch Position A
bRate → 1.10, claim both:
  A: 100 × (1.10 − 1.00) = 10
  B: 100 × (1.10 − 1.05) =  5
  total = 15 USDC   ✓  (v1 gave 10 — silently lost 5)
```

**SCF #5 — `transfer_yt` doesn't propagate entry → phantom yield.**
*Fix:* entry rate travels with the YT (position-bound) or is checkpointed on transfer (fungible +
accumulator) — §5/B. *Test:* fresh wallet buys YT on the AMM at bRate 1.08, immediately
`claim_yield` → **gets 0** until bRate exceeds 1.08 (v1 paid yield from inception — phantom, now zero).

**SCF #6 — `claim_yield` burns all YT → single-shot.**
*Fix:* claim **settles** (`settled_rate = current_rate`), never burns. *Test:* claim at 1.05, then
again at 1.10 on the **same** YT → second claim pays the 1.05→1.10 delta; YT still held and tradable
across multiple epochs.

**SCF #7 — `initialize()` unguarded → anyone re-inits, repoints strategy.**
*Fix:* `if storage.has(Initialized) { panic }` + admin-auth on every contract. *Test:* second
`initialize` call panics; non-admin `initialize` panics.

**SCF #9 — Missing TTL extension → state archived, no restore.**
*Fix:* `extend_ttl` after **every** persistent write in wrapper and AMM (the SAC and Blend already do
this correctly). *Test:* simulate ledger advance past TTL → positions and LP shares still readable /
have a restore path; no silent archival.

**Plus the two trust/quality findings:**
- **SCF #8 (single-signer "trust-minimized" overclaim):** there is **no yield-pushing key** at all now — yield is pulled from Blend. Any remaining admin (pause, init) is **honestly labeled "trusted admin, multisig-pathed"** in docs, never called "trust-minimized." (§3.6 below.)
- **SCF #10 (zero tests / `hello-world` scaffolds):** every example above is a committed test from Phase 0; coverage is real and measured, not asserted in a milestone.

---

## 3.6 Honest Trust Model (answers SCF #8's "framing doesn't hold up")

We will **not** call anything "trust-minimized" that isn't. The honest statement:
- **Yield & solvency: trustless.** Comes from Blend's on-chain `bRate`; no privileged party can inflate it.
- **Admin functions (init, pause, parameter set): trusted, single-key at launch → multisig-pathed.** Stated plainly. Pause can only *halt*, never *move user funds*.
- **Blend dependency:** we inherit Blend's risk (its oracle, its backstop). Documented as an explicit, named dependency rather than hidden.
This honesty is itself a response to the panel: the v1 application *over-claimed*, and that was called out.

---

## 7.5 Is Classic PT/YT Enough? — Rethinking the Primitive

> **The honest answer: classic "wrap a token → PT + YT" is the right *starting* primitive, but it
> is NOT the whole product, and for Spield's strategic goal (Stellar RWA / fixed income) the YT
> speculation leg is probably *not* where the value is.** This section reasons it out, because
> getting the primitive right matters more than any feature.

### What the research actually shows
1. **Classic PT/YT only works on tokens that are *already yield-bearing.*** Pendle wraps `stETH`/`aUSDC` — assets that already accrue. If the yield isn't already "inside" a token, you have nothing to strip. **Notional, Term, Swivel** take the *opposite* approach: they build fixed rates **from scratch on plain USDC** using **zero-coupon bonds (`fCash`) + an AMM or orderbook** — lenders and borrowers meet directly, no underlying yield-token required.
2. **Institutional RWA demand is for fixed-rate *bond products*, not speculation tokens.** The research is blunt: the $6B→$31B RWA wave is *"not for speculative yield tokens — it's for actual fixed-rate bond products."* Treasuries/MMFs dominate precisely because they're **simple, fixed, low-risk**. The **YT** (the leveraged-speculation leg) is the *exciting* half for DeFi-natives but the *irrelevant* half for the institutional capital that is Spield's moat (§12).
3. **Even Pendle is evolving past pure PT/YT.** **Boros** tokenizes the **rate itself** as a margined derivative (`Yield Unit`) with **no underlying asset at all** — "potentially removing the need for an underlying asset in the first place." The frontier is moving from *"strip a yield-bearing token"* to *"trade an interest rate directly."*
4. **Fixed maturity is a double-edged sword.** It's what *creates* certainty (PT→par at a known date), but it also causes **fragmented liquidity** (every maturity is a separate market/token) and **rollover friction** (the user must redeem + re-enter). This is the structural tax of the classic model.

### So the question isn't "PT/YT yes/no" — it's "which of three primitives, and when"
There are really **three different ways to manufacture fixed income on-chain.** They are not competitors so much as tools for different situations:

| Primitive | How it works | Best when | Cost |
|---|---|---|---|
| **A. Yield stripping (PT/YT)** — *classic* | Wrap an already-yield-bearing token, split into PT + YT, trade on time-decay AMM | The underlying **already accrues** (stsUSDe, a yield-bearing RWA token like YLDS/BENJI) | Needs a yield-bearing token to exist; YT leg adds complexity most RWA users don't want |
| **B. Zero-coupon bond / fixed-rate lending** — *Notional/Term style* | Mint a transferable claim ("receive 1 USDC on date D"), priced at a discount; lenders buy, borrowers mint | You want **fixed rate on plain USDC** with **no pre-existing yield token**; cleanest "bond" UX | You must source the yield/borrow demand yourself (need borrowers or a yield engine behind it) |
| **C. Rate derivative / yield swap** — *Boros style* | Tokenize the *rate* directly as a margined position; long/short implied vs realized APR | **Hedging/speculating on a rate** with capital efficiency; no underlying needed | Margin/liquidation engine = much heavier to build and risk-manage |

### Recommendation for Spield (concrete)
- **Build A (classic PT/YT) as the engine — it's the correct foundation and the §1–§7 plan stands.** It's the most proven, the least risky to build, and it's exactly right when the underlying *is* a yield-bearing token (which Stellar increasingly has: **YLDS** is a *yield-bearing stablecoin*; tokenized MMFs accrue).
- **But frame the *product* as B (a fixed-rate bond), not as "PT/YT trading."** The mass-market and institutional surface should be: **"lock X% fixed on your USDC/RWA until date D."** PT *is* a zero-coupon bond — so expose **PT as the hero product** (the Fixed-Rate Vault from §11.2 already does this) and treat **YT as an advanced/optional leg**, not the headline. This sidesteps "institutions don't want speculation tokens" while reusing the exact same engine.
- **Keep the door open to C (rate swap) as a later, separate track** — only if/when Stellar gets perps or a funding-rate stream worth trading (the SCF "Perpetuals on Stellar" proposal). Don't build the margin engine now; it's a different, heavier protocol.
- **The one thing to add to the core design *now*** so we're not boxed in: a **clean separation between "the bond/PT" and "the yield source,"** i.e. the **underlying-adapter interface** (§3.2). If PT can be backed by *either* a yield-bearing token (model A) *or* a yield engine that pays into an escrow (a step toward model B), we can serve plain-USDC fixed rates later **without a rewrite**.

### What this changes in the plan (small but important reframes)
- **§11.2 Fixed-Rate Vault is promoted from "a feature" to "the flagship product"** — PT-as-a-bond is the headline, YT is advanced.
- **Maturity friction (§11.3 auto-rollover) becomes higher priority**, because the bond framing makes "deposit once, earn fixed" the core promise.
- **A new open question (added to §9): do we ever need model B (zero-coupon-from-scratch) for plain USDC, or is wrapping a yield-bearing RWA token always sufficient?** This depends entirely on what yield sources Stellar actually offers — the same dependency as §9.3.

> **Bottom line:** Classic PT/YT is *sufficient as the engine* and you should build it — but **don't
> stop at "wrap a token and trade PT/YT."** Think one level up: Spield is a **fixed-income
> protocol** whose hero product is a **tokenized bond (PT) with a fixed rate**, the yield-stripping
> machinery is the implementation detail underneath, and YT/rate-swaps are the advanced tier. That
> framing is what makes it land with Stellar's RWA/institutional capital instead of being
> "Pendle clone #9."

---

## 8. Build Phases / Roadmap (rebaselined for honesty — answers SCF #11 & #12)

> The panel said the v1 scope ($90K, 4 months, 2 undergrads, no prior Soroban/DeFi shipping, for a
> clone + bridge + AMM + mainnet) was unrealistic and the milestones were misrepresented. This
> roadmap is **narrowed and honestly sequenced**: ship the **solvent fixed-rate core first**, treat
> the AMM as a separate research-grade phase, and never claim coverage that doesn't exist. Each phase
> is independently demoable and has a *real, testable* exit criterion.

### Phase 0 — Foundations & Blend de-risking
- Clean Cargo workspace (wrapper / market / strategy-adapter / shared-types) — **no `hello-world`; delete the scaffold tests**.
- **Spike the Blend integration** (§3.5 "what we must verify"): supply/withdraw call interface, reading `bRate`, withdrawal-liquidity edge cases, own-pool vs existing-pool.
- Fixed-point conventions + **math module test stub**. PT/YT-as-SAC decided.
- **Exit:** a test that supplies USDC to Blend on testnet, lets `bRate` move, and reads the gain back. *(Proves the yield source is real before building on it.)*

### Phase 1 — The Solvent Core (this is the make-or-break phase — it's what v1 got wrong)
- Strategy Adapter (Blend) + Wrapper: `mint`, `claim_yield` (settles, never burns), `redeem_pt`, `combine_and_redeem`.
- **Per-position accounting**, init guard, TTL everywhere, solvency invariant enforced.
- **Every §7.4 bug becomes a passing regression test** (the multi-epoch claim, the top-up, the phantom-yield-buyer, the drain test).
- Minimal frontend: deposit USDC → see PT+YT, claim, redeem.
- **Exit:** the "10 users all claim, vault never empties" + "top-up yields 15 not 10" tests pass on testnet. **This is the deliverable that proves the protocol is solvent — demo it loudly.**

### Phase 2 — The Fixed-Rate Product (ship value without the hard AMM yet)
- **Fixed-Rate Vault** (§11.2): deposit USDC → hold PT to maturity → redeem for a known fixed return. *No AMM required* — PT redeems against Blend at maturity. This is a **shippable, useful product** built only on the solvent core.
- Frontend: "lock X% fixed until date D" as the hero flow.
- **Exit:** a user can earn a real, fixed, Blend-backed return end-to-end.

### Phase 3 — The Yield AMM (the research-grade differentiator, separately scoped)
- Time-decay curve + fixed-point math module (the budgeted high-risk item, §6).
- `implied_apy`, LP add/remove + fees, market-discovered PT/YT pricing.
- Frontend: Markets page (implied/fixed APY), trade PT/YT, LP page.
- **Exit:** PT/YT trade on the curve with implied APY; LP IL behaves as designed. **No "≥95% in 4 weeks" claim** — this phase takes as long as correctness needs.

### Phase 4 — Risk, hardening, audit-prep
- Reserve buffer + **circuit-breaker/pause** (Kimia-style); **public solvency dashboard** (§11.5).
- Admin → **multisig**; honest trust-model docs finalized (§3.6).
- Invariant + fuzz tests (solvency, no-unbacked-mint, archival/restore); external review.

### Phase 4 — Evolution & "wow" features (the §11/§12 layers)
> These are what turn the working protocol into a *product*. Pick based on traction; not all are needed.
- **One-click UX** — Zap router + a **Fixed-Rate Vault** (the mass-market "deposit USDC, earn fixed %"). *(§11.2 — highest adoption leverage.)*
- **Composability** — make **PT usable as collateral on Blend**; publish a PT price oracle. *(§11.1 — biggest TVL multiplier.)*
- **Auto-rollover vault** — "deposit once, earn fixed forever" despite discrete maturities. *(§11.3)*
- **The yield curve** — multiple maturities of one underlying → a displayed term structure + ladder strategies. *(§11.4)*
- **Visible risk** — insurance fund + circuit breaker + public solvency dashboard. *(§11.5, also Phase 3)*
- **Fees & (later) vote-escrow incentives** — the revenue + liquidity flywheel. *(§11.6)*
- **Leveraged YT** trading (RateX-style, up to N×) for the advanced tier. *(§11.7)*
- **🚩 RWA / tokenized-Treasury yield stripping** — the flagship differentiator: strip the yield of Stellar's regulated RWA tokens. *(§12 — the moat.)*
- **Orderbook backstop + concentrated liquidity** (Pendle V2 / Exponent-style) for execution.
- **Multiple underlyings** via the adapter interface (becomes a real "yield exchange").

---

## 9. Open Questions (decide before / during the relevant phase)

1. **Own Blend pool vs supply to an existing one?** Deploying our own Blend pool (it's permissionless) gives parameter control + is itself novelty; using an existing pool is faster + deeper liquidity. — *decide in Phase 0 (spike both).*
2. **Blend withdrawal-liquidity handling.** If Blend utilization is high, withdrawal at redeem/maturity may be constrained. Design: reserve buffer? partial withdrawals? queued redemption? — *Phase 0/1, hard requirement.*
3. **YT accounting model:** position-bound vs fungible-YT-with-global-accumulator (§5/B). Position-bound is simplest to make correct (kills SCF #5 trivially); fungible is more composable/tradable. — *decide in Phase 1.*
4. **YT trading mechanism.** Separate YT/USDC pool, or **derive YT via `PT+YT=underlying`** + a mint/combine router (Pendle's approach, fewer pools, more routing)? — *decide in Phase 3.*
5. **One market per maturity vs rolling.** Confirm fixed-term, re-deployed markets (matches all comps) vs a perpetual rolling design.
6. **Reserve/insurance buffer funding source.** Protocol fees? Spread? Seed capital? — *Phase 4.*
7. **Do we ever need "model B" (zero-coupon bonds from scratch on plain USDC, Notional/Term-style)?** With Blend as the yield source we already have model A working on plain USDC (Blend turns USDC into a yield-bearing position). So model B is likely **unnecessary** — but revisit if we want fixed rates on an asset with no Blend market. See §7.5. — *revisit after Phase 1.*
8. **Is YT a headline product or an advanced/hidden leg?** §7.5 argues PT-as-a-bond is the hero and YT is the advanced tier (institutions want fixed, not speculation). Confirm before designing the UI. — *decide before Phase 3.*

---

## 11. Evolving the Protocol — What Surrounds & Grows the Core

> The §1–§10 core (split → trade → claim → redeem) is the *engine*. These are the layers that
> turn an engine into a **product people return to and build on**. Sequenced from "natural next
> step" to "out-of-the-box." Each is a real feature observed in the leading protocols (Pendle's
> ecosystem, Exponent, Kimia, Boros) — adapted to Stellar.

### 11.1 Composability — make PT *useful* outside Spield (the biggest growth multiplier)
The single biggest reason Pendle PT crossed **$2B**: PT got accepted as **collateral** in money
markets (Aave Horizon, Morpho, Euler), creating a "fixed yield × leverage" loop. The token isn't
the product — the **composability** is. **And we're already integrated with Blend** (it's our yield
source, §3.5), so this is the *natural* next step, not a cold integration:
- **PT as collateral on Blend.** A PT holder borrows against their fixed-income position → "fixed yield × leverage." Closes a beautiful loop: USDC → Blend → Spield PT → *back into Blend as collateral*. This deepens Blend TVL too, which strengthens the SCF "unlocks value for the ecosystem" case.
- **PT/YT as SAC** (§5/D) is the *enabler* — being a real Stellar asset is what lets Blend (and others) accept it.
- **Publish a PT price oracle** (Reflector-fed: PT price → implied discount → collateral value) so Blend/others can value PT safely.

### 11.2 One-click UX — abstract the complexity away (the adoption layer)
The raw flow (wrap → split → choose PT/YT → trade on AMM → claim → roll at maturity) is too much
for most users. Every leader hides it behind **one transaction**.
- **"Zap" router** — deposit plain USDC → router auto-converts to PT (or LP position) in one click. (Pendle/Exponent's killer UX.)
- **Fixed-Rate Vault** — "deposit USDC, earn a fixed X% APY" — the vault buys PT under the hood, the user never sees PT/YT. This is the **mass-market product**; PT/YT becomes plumbing.
- **One-click LP (Zap-to-LP)** — supply a single asset, the router splits and balances the pool.
- **Leveraged-YT one-click** (later) — RateX-style "long the yield rate at N×."

### 11.3 Auto-rollover / strategy vaults — solve the fixed-maturity friction
PT's fixed maturity is a UX wart: at maturity the user must manually redeem and re-enter. Solve it.
- **Smart Auto-Rollover vault.** At maturity, automatically redeem and re-deploy into the next term — *but only if* Spield's fixed rate beats the floating alternative (Blend lending rate), else park in the money market. Avoids "blind rollover." → turns Spield into a **"deposit once, earn fixed forever"** product despite discrete maturities.
- **Auto-compounding YT vault** — periodically claims YT yield and re-mints, compounding without user action.

### 11.4 The yield curve as a product — multiple maturities = a term structure
With several live maturities (1M / 3M / 6M / 12M) of the same underlying, the PT prices form a
**yield curve** — exactly like a Treasury curve. This is a *data product* and a *trading surface*.
- **Display the curve** in the UI (fixed APY vs maturity) — instantly legible to any TradFi user.
- **Curve-based strategies** — "ladder" capital across maturities (e.g. 50/30/20 across short/mid/money-market PT), auto-rebalanced quarterly.
- **Term-structure speculation** — bet on the curve steepening/flattening.

### 11.5 Risk & solvency as visible product features (trust = TVL)
Borrowing Kimia's stance: risk infra is a feature, and *showing it* is marketing.
- **Insurance / reserve buffer** with a public, on-chain balance and a clear waterfall (who's protected, in what order).
- **Circuit breaker / auto-pause** (Kimia pauses after 24h if the insurance fund depletes) — a documented, automatic kill-switch on anomalies (index staleness, depeg, solvency breach).
- **Public solvency dashboard** — live proof that the **Blend position value ≥ PT principal + pending YT yield** (the §7.4 invariant). This is the antidote to v1's trust hole; make it visible.
- **Oracle transparency** — show feed source, last-update time, staleness state.

### 11.6 Governance & incentives — align liquidity and growth (when there's something to govern)
Pendle's **vePENDLE** (lock token → vote on which pools get incentives, earn 80% of those pools' fees, boost LP rewards up to 250%) is the canonical liquidity-flywheel.
- **Fee model first.** Take a small cut of YT yield (Pendle takes **5%**) and/or AMM swap fees — the revenue that makes everything else fundable.
- **(Later) vote-escrow incentives** to direct liquidity to the maturities/underlyings that need depth. Only worth it once there are multiple markets competing for liquidity.

### 11.7 Out-of-the-box directions (Stellar-native bets, beyond copying Pendle)
- **Generalize the yield source beyond staking (Boros-style).** Pendle's Boros tokenizes **perp funding rates** as yield. On Stellar, the *same engine* could strip the yield of **any** rate stream: a Blend supply rate, an RWA coupon, even a Kimia-style funding stream if perps land on Stellar (there's already an SCF "Perpetuals on Stellar" proposal). The PT/YT machinery is **source-agnostic** if we keep the adapter interface clean (§3.2).
- **Tokenized-Treasury / RWA yield stripping (the Stellar superpower — see §12).** Strip the yield of tokenized T-bills (Franklin Templeton BENJI, Ondo, WisdomTree, Figure's YLDS) that already live on Stellar. Sell **fixed-rate Treasury exposure** (PT) and **leveraged-rate-bet** (YT) on regulated, real yield. This is a product **no Solana/ETH protocol can easily replicate** because the assets are here.
- **Payments-native fixed income.** Stellar's sub-cent fees + native cross-border rails mean a remittance/treasury app could let a user **lock a fixed yield on idle USDC for exactly N days** at negligible cost — micro-duration fixed income that's uneconomical on higher-fee chains.
- **Cross-asset "swap variable for fixed" primitive (Strips/Boros-style).** A direct "I have a floating-rate position, give me fixed" instant swap, built on the same PT machinery — a cleaner mental model than "go buy PT" for non-DeFi-native users.

---

## 12. Strategic Differentiator — Why *Stellar* (and not just "Pendle clone #9")

This is the part that makes Spield defensible rather than derivative. **Don't position Spield as
"Pendle on Stellar." Position it as "the fixed-income / yield-stripping layer for Stellar's
RWA & Treasury economy."**

**The insight:** Stellar is one of the most concentrated **regulated-RWA** ecosystems in crypto.
Tokenized Treasuries and yield funds from **Franklin Templeton (BENJI), WisdomTree, Ondo**, and
**Figure's YLDS** (SEC-registered yield-bearing stablecoin) already run natively on Stellar. RWA
on-chain grew ~$6B → ~$31B in a year, driven by institutional demand for **on-chain yield** — and
USDC, the clean payment rail, **carries no yield itself**.

**The progression — two real Stellar-native yield sources, same engine:**
- **Day 1 — Blend** (§3.5): a real, on-chain lending yield. Proves the engine, ships the solvent core, and unlocks fixed rates for every Blend supplier (a thing they can't get today).
- **Flagship — RWA / Treasury yield:** those RWA/Treasury tokens have **real, regulated yield** → the **ideal underlying** for yield stripping. Spield becomes the **interest-rate market** *on top of* Stellar's RWA base: turn a tokenized T-bill into **fixed-rate PT** (lock a Treasury yield) + **YT** (trade the rate). Both sources plug into the **same `YieldStrategy` adapter** — the RWA version is a new adapter impl, not a rewrite.
- Institutions/treasuries get a familiar instrument — **a tokenized zero-coupon bond with a clear maturity and fixed APY** — natively, with daily settlement and sub-cent fees.
- This is the **moat**: the underlying assets, the regulatory posture, and the institutional capital are *already on Stellar*. A yield-stripping protocol's value is bounded by the quality of yield it can strip — and Stellar's yield (Blend's real rates today, regulated RWA tomorrow) is uniquely real.

**Practical implication for the build:** the **Strategy Adapter** (§3.2, §3.5) is what makes this
work — Blend on day 1, a tokenized-Treasury wrapper later, **same wrapper/AMM untouched**. This also
turns the SCF "no new primitive / not Stellar-native" critique on its head: composing **Blend +
fixed-rate bonds + RWA** is a primitive that *only exists on Stellar* and doesn't exist there yet.

---

## 13. One-paragraph summary (the elevator pitch for the rebuild)

> Spield v2 is **Stellar's fixed-income layer**: deposit USDC, it's supplied to **Blend** (so the
> yield is **real, on-chain, and actually accruing**), and you get **PT** — a tokenized **fixed-rate
> bond** that redeems at par at maturity — plus **YT**, an optional yield/rate-trading leg. The v1
> fatal flaw the SCF panel found — *an undercollateralized vault built on an invented index* — is
> gone: **the index IS Blend's real `bRate`, so the vault is solvent by construction.** The six
> accounting bugs are fixed and turned into regression tests; the bridge and single-signer trust
> surface are deleted; PT/YT trade on a purpose-built **time-decay AMM** (a separately-scoped,
> research-grade phase, not a 4-week claim); and the trust model is described **honestly**. Its
> strategic edge: it's not "Pendle on Stellar" — it's the **first native fixed-income primitive over
> Blend**, extensible to Stellar's **regulated RWA & Treasury yield** (Franklin Templeton, Ondo,
> WisdomTree, YLDS already live there), a moat no Solana/Ethereum competitor can reach.

> **Why this beats the SCF rejection (§0):** real Stellar-native yield (Blend, not bridged sUSDe) ·
> solvent-by-construction vault (the #1 fix) · all 6 accounting bugs fixed + tested · a real AMM,
> honestly scoped · honest trust model · narrowed, realistic, demoable phases.

> **Evolution at a glance (§11):** PT as Blend collateral → one-click Fixed-Rate Vault → auto-rollover →
> the yield curve as a product → visible solvency → fees & governance → RWA yield stripping as the flagship.

---

### Sources
**Core mechanics (§2–§7):**
- Pendle (architecture deep-dive): [mixbytes.io](https://mixbytes.io/blog/yield-tokenization-protocols-how-they-re-made-pendle) · [docs.pendle.finance](https://docs.pendle.finance/pendle-v2/Introduction) · [Pendle AMM/Orderbook](https://docs.pendle.finance/pendle-v2/ProtocolMechanics/LiquidityEngines/OrderBook)
- Exponent (Solana): [exponent.finance](https://www.exponent.finance/) · [docs.exponent.finance](https://docs.exponent.finance/starthere) · [RockawayX analysis](https://www.rockawayx.com/insights/exponent-is-coming-for-solana-defi----at-just-the-right-time)
- RateX (Solana leveraged YT): [solanacompass.com/projects/ratex](https://solanacompass.com/projects/ratex)
- Kimia (Solana, perp-funding yield): [kimia.live](https://kimia.live/)
- Solana comps overview: [wrpro.substack.com](https://wrpro.substack.com/p/exploring-pendle-comps-on-solana)

**Rethinking the primitive (§7.5):**
- Fixed-rate design review (PT/YT vs fCash vs orderbook): [statemind.io](https://statemind.io/blog/fixed-rate-design) · [pmayr.xyz — In search of DeFi fixed rates](https://www.pmayr.xyz/in-search-of-defi-fixed-rates/)
- Notional fCash / zero-coupon model: [docs.notional.finance](https://docs.notional.finance/notional-v3/fcash/what-is-fcash) · [Pendle vs Notional](https://www.okx.com/en-us/learn/pendle-vs-notional-yield-strategies)
- Boros (rate-as-derivative, no underlying): [OAK Research](https://oakresearch.io/en/analyses/innovations/boros-funding-rate-futures-on-pendle) · [Boros docs](https://pendle.gitbook.io/boros/boros-docs)
- RWA demand = fixed-rate bonds, not speculation: [Yellow.com RWA $31B](https://yellow.com/research/tokenized-rwas-31b-market-growth-real-race-starting) · [The Block 2026 DeFi outlook](https://www.theblock.co/post/383120/2026-defi-outlook)
- PT/YT model limitations: [earnpark.com Pendle 2026 guide](https://earnpark.com/en/posts/what-is-pendle-finance-the-complete-2026-guide-to-yield-tokenisation-pt-yt-mechanics-and-boros/)

**Evolution & ecosystem (§11):**
- PT as collateral / $2B composability loop: [Coin Bureau Pendle review](https://coinbureau.com/review/pendle-finance-review) · [Gate: rise of Pendle PT](https://www.gate.com/learn/articles/the-rise-of-pendle-pt-from-de-fi-experiment-to-fixed-income-empire/11312)
- One-click Zap & Fixed-Rate Vaults: [Pendle Zap handbook](https://handbook.pendle.finance/liquidity-provision/zap-to-provide-liquidity) · [Venus Pendle Fixed-Rate Vault](https://blockchainreporter.net/venus-unveils-pendle-fixed-rate-vault-simplifying-fixed-yield-on-bnb-chain)
- Auto-rollover & yield-curve laddering: [Enzyme one-click looping](https://medium.com/@enzymefinance/one-click-looping-solution-with-pendle-815817e29364)
- vePENDLE governance / fees: [OAK Research Pendle overview](https://oakresearch.io/en/reports/protocols/pendle-pendle-comprehensive-overview-leading-platform-on-chain-yield)
- Boros (funding-rate yield, source-agnostic engine): [OAK Research Boros](https://oakresearch.io/en/analyses/innovations/boros-funding-rate-futures-on-pendle) · [Blockworks](https://blockworks.co/news/boros-pendle-tokenizes-funding-rates)
- Fixed-income / rate-swap landscape: [Messari: Fixed Income Protocols](https://messari.io/report/fixed-income-protocols-the-next-wave-of-defi-innovation) · [Chainlink: Tokenized Yield](https://chain.link/article/tokenized-yield-guide)

**Blend — the yield source (§3.5, the core fix):**
- Blend v2 docs / FAQ: [docs.blend.capital](https://docs.blend.capital/) · [General FAQ](https://docs.blend.capital/users/general-faq) · [Whitepaper](https://docs.blend.capital/blend-whitepaper)
- Blend contracts (for the integration spike): [blend-contracts-v2 (GitHub)](https://github.com/blend-capital/blend-contracts-v2) · [bToken / protocol tokens (v1 tech docs)](https://docs-v1.blend.capital/tech-docs/core-contracts/lending-pool/protocol-tokens)
- Blend overview & adoption (Meru/Lobstr/Airtm): [Introducing Blend](https://medium.com/script3/introducing-blend-95aaf66bdf41) · [Stellar Blend/Meru case study](https://stellar.org/case-studies/meru-wallet-uses-blend-defi-protocol-for-yield)

**Stellar-specific (§4, §11 oracle, §12 differentiator):**
- Stellar oracles / Reflector (only for valuing PT as collateral, §11.1): [Stellar oracle providers](https://developers.stellar.org/docs/data/oracles/oracle-providers) · [Reflector V3 audit](https://code4rena.com/audits/2025-10-reflector-v3)
- Stellar DeFi composability (Blend, Soroswap, DeFindex): [stellar.org/blog](https://stellar.org/blog/developers/composability-on-stellar-from-concept-to-reality)
- Stellar RWA / Treasury moat: [RWA.xyz Stellar](https://app.rwa.xyz/networks/stellar) · [Figure YLDS on Stellar](https://eco.com/support/en/articles/14982160-ylds-on-stellar-figure-s-yield-bearing-stablecoin-explained) · [Stellar's RWA role](https://future.forem.com/roan911/stellars-role-in-the-tokenized-real-world-assets-rwa-boom-4721)
