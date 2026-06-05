# Phase 3 — The Yield AMM: Design & Build Plan

> Status: **design** (no code yet). This is the scoping doc for the time-decay AMM —
> the research-grade differentiator described in `plan.md` §6 and the SCF #11 answer.
> It is written against the **deployed** wrapper/strategy/vault (see `TESTNET.md`), reuses
> the existing `spield-shared` fixed-point math, and resolves the open `plan.md` §9
> questions that block this phase.
>
> **Prerequisite reality:** Phases 0–2 are live on testnet. PT/YT are real SACs, the
> wrapper mints/claims/redeems correctly, and the solvency invariant holds. The AMM is the
> **trading layer** — it is *not* required for the Fixed-Rate Vault to work (PT already
> redeems at maturity). That decoupling is what keeps this phase honestly scoped.

---

## 0. What this phase delivers (and what it does not)

**Delivers:**
- A `Market` contract: one fixed-term PT/USDC pool per maturity, trading along a **time-decay
  curve** (PT → 1.0, YT → 0 as maturity nears), with LP shares + fees.
- A read-only `implied_apy()` — the headline UX number, derived from PT price + time-to-maturity.
- A frontend **Markets / Trade / LP** surface exposing two human flows ("Earn Fixed", "Long Yield")
  and LP deposit/withdraw — never raw curve math.
- A standalone, exhaustively-tested **fixed-point `ln`/`exp` math module** (the highest-risk item).

**Explicitly does NOT (deferred to Phase 3.5 / Phase 4):**
- Concentrated liquidity (Exponent-style dynamic concentration near maturity).
- An on-chain limit-order backstop.
- Leveraged YT (RateX-style, §11.7).
- Multi-maturity yield-curve aggregation as a product (§11.4).

We do **not** claim "≥95% AMM coverage in 4 weeks." The math module is separately scheduled.

---

## 1. Resolving the open §9 decisions (locked for this phase)

These were left open in `plan.md` §9; this phase forces them. Proposed resolutions:

| # | Question | Decision for Phase 3 | Why |
|---|---|---|---|
| **#4** | YT trading mechanism: own pool, or derive via `PT+YT=underlying` + router? | **Derive YT via routing.** One real pool: **PT/USDC**. YT trades are routed: *buy YT* = `mint` (USDC→PT+YT) then sell the PT into the pool; *sell YT* = buy PT from the pool then `combine_and_redeem` (PT+YT→USDC). | Fewer pools to seed/secure; one source of price truth; reuses the **already-deployed** wrapper `mint`/`combine_and_redeem`. Pendle's approach. |
| **#5** | One market per maturity vs rolling | **One fixed-term market per maturity**, re-deployed per term. | Matches every comp (Pendle/Exponent/Notional); the curve math assumes a fixed `maturity`. Rolling is a vault on top (§11.3), not the AMM. |
| **#8** | Is YT the hero or an advanced leg? | **PT-as-bond is the hero; YT is the advanced "Long Yield" tab.** | Matches the strategy memo. The Markets page leads with "Earn Fixed X% APY"; YT/leverage is a secondary tab. |
| **#1** | Own Blend pool vs existing | **Out of scope here** — inherited from Phase 0/1 (we use the live wrapper's existing Blend wiring). | The AMM never touches Blend directly; it only moves PT/USDC SACs. |

**Consequence of #4:** the Market contract itself only needs to know about **PT and USDC**. All YT
flows are a *frontend router* composing `market.swap` + the existing `wrapper.mint` /
`wrapper.combine_and_redeem`. This dramatically shrinks the contract's attack surface.

---

## 2. The curve (the differentiating math)

Goal restated: holding yield expectations constant, **PT price drifts to 1.0** and **YT to 0** as
`t → maturity`, *from the curve itself*, so LPs who hold to maturity bear ~no impermanent loss for
the predictable part of the move.

We port the **Pendle V2 / Notional log curve** (the proven design):

```text
timeToMaturity  = maturity − now                       // seconds, > 0 before maturity
yearsToMaturity = timeToMaturity / SECONDS_PER_YEAR    // SCALAR_12 fixed point

proportion = PT_reserve / (PT_reserve + totalAsset)    // fraction of pool that is PT, in (0,1)
             // totalAsset = USDC_reserve expressed in PT terms (both 7-dec underlying units)

rateScalar = scalarRoot / yearsToMaturity              // curve STEEPENS as maturity nears
rateAnchor : tracked in state, re-anchored on each liquidity event (see §3.4)

// exchangeRate = price of 1 PT in USDC, in SCALAR_12:
lnTerm       = ln( proportion / (1 − proportion) )     // signed; 0 at proportion=0.5
exchangeRate = (1 / rateScalar) * lnTerm + rateAnchor  // monotonic in proportion
PT_price     = 1 / exchangeRate                          // → 1.0 as the implied rate → 0 near maturity
```

- **Implied APY** falls straight out:
  `impliedApy = exchangeRate^(1 / yearsToMaturity) − 1` (continuous-comp variant decided in §2.2).
- As `t → 0`, `yearsToMaturity → 0`, `rateScalar → ∞`, the curve flattens around `proportion`'s
  current point and `PT_price → 1.0`. This is the IL-minimizing property — the curve *is* the
  expected price path.
- `scalarRoot` and the initial `rateAnchor` are set at market creation from a **target initial
  implied APY** (e.g. seed the pool so it opens at ~the vault's fixed rate).

### 2.1 Why not constant-product
`x*y=k` has no notion of time or par-convergence: PT would *not* drift to 1.0, so LPs eat
guaranteed IL as PT naturally appreciates to par. This is exactly the SCF #11 critique. We keep a
constant-product pool **only as an internal test harness** (§5), never as the venue.

### 2.2 Fixed-point representation
- All curve math at **SCALAR_12** (same as `b_rate`) so it composes with the existing
  `spield-shared` helpers and Blend's scale — no scale-mismatch class of bugs.
- Reserves/amounts in the underlying's 7-dec units (USDC), exactly as the wrapper uses.
- Every `a*b/denom` goes through the existing **`mul_div_floor`** (i256 intermediate, overflow-proof).
- **Open sub-decision (decide in the math spike):** simple vs continuous compounding for
  `implied_apy`. Pendle uses continuous (`exp`/`ln`); Notional uses a per-period rate. We'll match
  whichever the math module proves stable first; the UI label is identical either way.

---

## 3. The `Market` contract

New 5th crate: `contracts/market` (`spield-market`). Depends on `spield-shared` for math/types.

### 3.1 State
```rust
struct MarketConfig {
    admin:        Address,
    pt:           Address,   // PT SAC  (from wrapper.pt_token())
    usdc:         Address,   // settlement asset (wrapper.underlying())
    maturity:     u64,       // unix secs (must equal wrapper.maturity())
    scalar_root:  i128,      // SCALAR_12 curve param, set at init
    fee_bps:      u32,       // swap fee, e.g. 30 = 0.30%
}
// Persistent, TTL-extended after every write (SCF #9):
PtReserve(i128) · UsdcReserve(i128) · LastRateAnchor(i128) · TotalLpShares(i128)
LpShares(Address) -> i128
```

### 3.2 Public interface
```rust
// --- liquidity ---
fn add_liquidity(env, lp: Address, pt_in: i128, usdc_in: i128) -> i128;   // returns LP shares minted
fn remove_liquidity(env, lp: Address, shares: i128) -> (i128, i128);      // returns (pt_out, usdc_out)

// --- trading (PT/USDC only; YT is routed off-chain, §4) ---
fn swap_exact_pt_for_usdc(env, trader: Address, pt_in: i128, min_usdc_out: i128) -> i128;
fn swap_exact_usdc_for_pt(env, trader: Address, usdc_in: i128, min_pt_out: i128) -> i128;

// --- views (read-only sims; no auth) ---
fn quote_pt_for_usdc(env, pt_in: i128) -> i128;
fn quote_usdc_for_pt(env, usdc_in: i128) -> i128;
fn pt_price(env) -> i128;          // SCALAR_12, → 1.0 near maturity
fn implied_apy(env) -> i128;       // SCALAR_12 fraction, the headline number
fn reserves(env) -> (i128, i128);  // (pt, usdc)
fn lp_position(env, lp: Address) -> (i128, i128, i128); // (shares, pt_share, usdc_share)

// --- admin ---
fn initialize(env, admin, pt, usdc, maturity, scalar_root, fee_bps, initial_anchor);
fn set_fee(env, fee_bps: u32);     // ceiling-bounded like the vault's set_rate
fn pause(env, paused: bool);
```

### 3.3 Swap mechanics (per trade)
1. Read `(pt_reserve, usdc_reserve)`, `now = env.ledger().timestamp()`.
2. Require `now < maturity` (after maturity, **no trading** — PT just redeems 1:1 via the wrapper).
3. Compute `proportion`, `rateScalar`, `exchangeRate` from the curve (§2) using the math module.
4. Solve for the output amount that moves `proportion` to its post-trade value (Newton iteration in
   the math module, §6). Apply `fee_bps` to the input.
5. Enforce `min_out` (slippage guard). Move tokens via the PT/USDC SAC clients with
   `authorize_as_current_contract` for the nested transfers (the auth pattern already proven in the
   vault — balance read *before* authorize, scope = next call only).
6. Write new reserves, **re-anchor** if needed (§3.4), `extend_ttl`.

### 3.4 Re-anchoring (the IL-minimizing step)
`rateAnchor` is recomputed on **liquidity events** (not swaps) so the curve keeps passing through the
current market rate as `timeToMaturity` shrinks — this is what makes the time-decay automatic. On
`add_liquidity`/`remove_liquidity`: hold `exchangeRate` constant, solve for the `rateAnchor` that
reproduces it at the new `rateScalar(now)`. (Pendle's `_updateMarketState`.) Documented + tested as
its own unit.

### 3.5 Invariants (asserted after every mutation, à la the wrapper/vault)
- `pt_reserve ≥ 0 && usdc_reserve ≥ 0`.
- `proportion ∈ (0, 1)` strictly — reject trades that would empty a side.
- LP share math: `shares_minted / total = min(pt_in/pt_reserve, usdc_in/usdc_reserve)` (no
  free value extraction; first LP sets the ratio).
- `pt_price ≤ 1 / scalar-bounded-min` and monotonic toward 1.0 as `now → maturity` (property test).
- TTL extended on every persistent write (SCF #9).

---

## 4. YT trading via routing (frontend, no new pool)

Per decision #4, the contract has no YT pool. The frontend `lib/market.ts` router composes the
**already-deployed** wrapper calls with a market swap, in one UX action:

| User action ("Long Yield" tab) | Route (atomic from the user's view; 1–2 txs) |
|---|---|
| **Buy YT** (bet yield > implied) | `wrapper.mint(usdc)` → get PT+YT → `market.swap_exact_pt_for_usdc(PT)` → keep YT, recover most USDC. Net: cheap YT exposure. |
| **Sell YT** | `market.swap_exact_usdc_for_pt` to get the matching PT → `wrapper.combine_and_redeem(PT+YT)` → USDC. |
| **Earn Fixed** ("Income" flow) | `market.swap_exact_usdc_for_pt` → hold PT to maturity → fixed return locked at today's implied APY. |

This reuses `mint` and `combine_and_redeem` exactly as they exist on-chain today. A later phase can
fold multi-step routes into a thin on-chain `Router` contract if the 2-tx UX proves clumsy, but
**v1 of Phase 3 ships with the off-chain router** to minimize new contract risk.

---

## 5. Build strategy — de-risked, three stages (the SCF #11 answer)

**Stage A — constant-product scaffold (throwaway harness). ✅ DONE (2026-06-05).**
A plain `x*y=k` PT/USDC pool, **never deployed to mainnet**. Proves the full
`mint → add_liquidity → swap → claim → redeem` plumbing + the SAC token wiring end-to-end against
real Blend WASM, *before* the curve math exists. Crate `contracts/market` (`spield-market`),
**18/18 tests green**, release WASM 44 KB.

**Stage B — the fixed-point math module (the highest-risk item). ✅ DONE (2026-06-06).**
Standalone `spield-shared::amm_math` with its own exhaustive test suite (§6): `ln_fixed`,
`exp_fixed`, `pow_fixed` at SCALAR_12, pure `no_std`, all multiplies via the i256-backed
`mul_div_floor`. **32/32 shared tests green** (was 17; +15 amm). Proven bounds: `ln` abs error
≤ ~1e-9 over `(0,50]`; `exp` rel error ≤ ~5e-9 *where resolvable* (the fixed-point floor near zero
is documented honestly — `exp(-20)≈2e-9` only has ~3 significant digits in 12-dp). A single
`ln`+`exp` pair fits the **default** Soroban budget (the per-call gas-budget test), so a swap can
afford the curve on-chain. `exp` input capped at 44.0 so the SCALAR_12 result stays in i128.

**Stage C — integrate + property-test. ✅ DONE (2026-06-06).** The Pendle log curve (`market/src/
curve.rs`) replaces the constant-product swap core, built on the Stage-B `amm_math`. `initialize`
gained `scalar_root` + `rate_anchor` (anchor = par 1.0); swaps/quotes/`pt_price` now use the curve;
added `implied_apy()` + `curve_config()`. **24/24 market tests green** (was 18; +6 curve property
tests) — incl. the differentiator `pt_price_drifts_toward_par_near_maturity`, price-discovery
monotonicity, positive implied APY below par, and unprofitable round-trips. The property suite caught
a real **sign bug**: the curve must be `exchangeRate = anchor − ln(p/(1−p))/rateScalar` (a PT-heavy
pool ⇒ *cheaper* PT); the `+` form priced it backwards. Release WASM still builds for
`wasm32v1-none`. Deploy-script + frontend router/Markets UI remain.

Until B/C are audit-quality, the **Fixed-Rate Vault keeps shipping value on the solvent core alone**.

---

## 6. The fixed-point math module (the crux — `no_std` WASM)

The genuinely hard part: `ln`, `exp`, and Newton-style root-finding at SCALAR_12 on `wasm32v1-none`,
with no float and a tight CPU budget.

**Functions needed:**
- `ln_fixed(x: i128) -> i128` for `x` in SCALAR_12, `x > 0`. Used in `proportion/(1-proportion)`.
- `exp_fixed(x: i128) -> i128` (signed exponent) for `implied_apy` / continuous comp.
- `solve_swap(reserves, params, amount_in) -> amount_out` — Newton iteration on the curve.

**Approach (port Pendle's, adapted to i256 intermediates):**
- `ln` via range-reduction (`ln(x) = ln(m) + k·ln2`, `m ∈ [1,2)`) + a minimax polynomial / Taylor
  on the reduced range. All terms through `mul_div_floor`.
- `exp` symmetric: range-reduce, polynomial, recompose.
- Newton: 3–5 iterations with a good initial guess (the constant-product output is a decent seed);
  cap iterations and assert convergence within an epsilon, else revert (no silent bad fills).
- **Convergence aids** (Pendle's tricks): cache the anchor; bound `proportion` away from {0,1};
  precompute `1/rateScalar`.

**Test plan for the module (this is where the rigor budget goes):**
- Golden-value tests vs a high-precision reference (Python `mpmath`) across the domain.
- Monotonicity + bound property tests (`proptest`-style) — `ln` increasing, `pt_price` ∈ (0,1],
  `pt_price` increasing as `t → maturity`.
- Max-error bound assertion across the full input range (state the worst-case ULP error honestly).
- Gas/CPU-budget tests: each swap stays within Soroban's instruction budget (the real ship blocker).
- Adversarial inputs: `proportion` near 0/1, `timeToMaturity` near 0, huge reserves.

**Honest risk statement (for SCF):** this module is the single highest-risk line item. It is
budgeted as its own multi-week deliverable with the test suite above. We do not gate the fixed-rate
product on it.

---

## 7. Contract test plan (mirrors the existing 35-test discipline)

Reuse the existing harness style: `BlendFixture` for the wrapper side, real PT/YT SACs, no mocks
for value math. New tests (target ~20, bringing the workspace to ~55):
- LP: first-LP sets ratio; proportional add/remove; no value extraction; rounding always favors pool.
- Swaps: quote == executed; fee applied; slippage guard reverts; reserves conserve PT+USDC value.
- Curve: `pt_price → 1.0` as `now → maturity` (fast-forward time); `implied_apy` matches a reference.
- Re-anchor: `exchangeRate` preserved across liquidity events at shifted `timeToMaturity`.
- Auth: nested SAC transfers authorized via `authorize_as_current_contract` (the vault gotcha).
- TTL: archival/restore across all persistent entries (SCF #9).
- Integration: full `mint → add_liquidity → swap → claim → redeem` vs real Blend WASM.
- Math module: the §6 suite (golden, property, budget, adversarial).

---

## 8. Frontend (the product surface)

New under `frontend/src`:
- `lib/market.ts` — typed Market client (`quote*`, `swap*`, `add/remove_liquidity`, `pt_price`,
  `implied_apy`) + the **YT router** (§4) composing wrapper calls.
- **Markets page** — headline **implied/fixed APY** + a live PT-price / implied-APY chart that
  updates as trades land (reuse the `YieldChart`/recharts patterns already in the dashboard).
- **Trade panel** — two tabs: **Earn Fixed** (Income flow, the hero) and **Long Yield** (YT, advanced).
  Live quote from `quote_*`, slippage setting, route preview, all through `useTxAction` (so the
  success-popup + refresh lifecycle we just fixed applies automatically).
- **LP page** — add/remove liquidity, pool share, fees earned, an "IL if you exit now vs at maturity"
  explainer (turns the curve's main selling point into UX).

All reads are free simulations; all writes go through the existing `writeContract` → Freighter →
poll lifecycle and the `useTxAction` toast/refresh hook. No new tx infrastructure needed.

---

## 9. Versions, deploy, sequencing

- **Pin parity:** `soroban-sdk = "=25.3.1"`, reuse `spield-shared`; the Market crate adds no new
  external deps beyond the SAC token client (`mul_div_floor`/i256 already in shared).
- **Deploy:** extend `scripts/deploy_testnet.sh` with a step `[8/8]` that deploys `Market`,
  initializes it against the live `pt`/`usdc`/`maturity`, and **seeds** it (admin `add_liquidity`)
  so the pool opens near the vault's fixed rate — mirrors the vault's `seed` bootstrap.
- **Build order:** Stage A (scaffold + plumbing tests) → Stage B (math module + its suite, in
  parallel) → Stage C (integrate, property-test, deploy testnet, wire frontend router + Markets UI).

## 10. Exit criteria

- PT/YT trade on the curve; `implied_apy()` is live and matches the reference within the stated error.
- LP IL behaves as designed (hold-to-maturity ≈ principal + fees; verified by the curve property test).
- Full mint→trade→claim→redeem verified on testnet against real Blend, exercised through the UI.
- Math module ships with a published worst-case error bound and within-budget gas.
- **No "≥95% in 4 weeks" claim.** This phase takes as long as the curve's correctness needs.
```
