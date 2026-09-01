# Feature Plan — Capital-Efficient "Buy YT" (Long Yield) via Flash-Lend Router

> Status: **DESIGN / NOT STARTED**. This is a build-later spec capturing the problem,
> the analysis, the chosen design (Option C), and the full implementation + launch plan.
> Everything here was derived by simulating the live curve (`contracts/market/src/curve.rs`,
> `contracts/shared/src/amm_math.rs`) — the numbers are from that math, not illustrative.

---


## 1. The problem (why we're doing this)

### 1.1 Today's Long Yield flow is capital-inefficient

Going "long yield" = holding **YT**. There is **no YT pool** — YT is always derived:
mint a PT+YT pair from USDC, then sell the PT you don't want. Current implementation
(`website/frontend/src/lib/market.ts` → `buildBuyYtSteps` / `previewBuyYt`) does this as
**two separate transactions**:

1. `wrapper.mint(usdcIn)` → user gets `usdcIn` PT + `usdcIn` YT
2. `market.swap_exact_pt_for_usdc(usdcIn, minOut)` → sell the PT back for USDC

The user keeps the YT; their **net cost = usdcIn − (PT sale proceeds)**.

**The flaw:** `wrapper.mint` (see `contracts/wrapper/src/lib.rs:133`, line 145
`usdc.transfer(user → wrapper, amount)`) pulls the **full notional upfront**. So even
though the *net* cost of the YT is tiny, the user must **hold the entire notional** in
their wallet.

Verified example (deep pool 1,000,000/1,000,000, 1yr, fee 0.30%):

| Gross USDC user must hold | USDC recovered from PT sale | **Net cost of YT** | YT held |
|---|---|---|---|
| 100 | 99.70 | **0.30** | 100 |

So to end up holding 100 YT (net cost ~0.30 USDC) the user must **front 100 USDC**.

### 1.2 The consequence: leverage is capped by wallet balance, not risk

A user with only **10 USDC cannot buy 100 YT**, even though 100 YT only *costs* ~0.30.
Their max is ~10 YT. This defeats the entire point of YT ("a small amount of USDC
controls a much larger position"). It also means two signatures + an intermediate state
where the user briefly holds unwanted PT (failure surface if step 2 reverts).

### 1.3 Goal

Let a user spend a **small budget** (e.g. 5 USDC) and receive the **full leveraged YT**
(~1,600 YT on a deep pool) in **one atomic transaction**, holding only the budget —
with **zero idle protocol capital** and **without weakening the wrapper's audited
solvency invariant**.

---

## 2. Design options considered

The root issue: `mint` needs the full notional USDC *before* the offsetting PT sale can
happen. Something must bridge the notional momentarily. The three options differ only in
**who provides that bridge**.

| Option | Who bridges the notional | Idle capital | Touches audited wrapper? | Verdict |
|---|---|---|---|---|
| **A** — pre-seeded router buffer | Router's own USDC | **~300× max budget** (huge) | No | ❌ capital drag |
| **B** — deferred-payment mint | Wrapper mints before USDC arrives | Zero | **Yes — weakens solvency-by-construction** | ❌ erodes core invariant |
| **C** — pool flash-lends USDC | The AMM's own USDC reserve | **Zero** | **No** | ✅ **CHOSEN** |

### Why Option A was rejected

The buffer must be ~300× the max per-call budget because YT is ~300× leveraged. To let
users spend up to 5 USDC on a deep pool, the router would need to hold **~1,618 USDC**
idle *per concurrent call*. Dead capital + a throughput cap. (Simulated:
`scratchpad/router_sim.py`.)

### Why Option B was rejected

It works with zero buffer, but it requires the wrapper to mint PT+YT **before** the USDC
backing exists (paid back later in the same tx). That introduces a temporarily-unbacked
state — directly contradicting the wrapper's core promise (`contracts/wrapper/src/lib.rs`
docstring lines 23–36: "load position once, compute effects, persist once, backing always
≥ principal"). `assert_solvent` (line 602) would fail mid-tx. Defensible via atomicity but
it weakens a property auditors specifically verified. Not worth it.

### Why Option C was chosen

- **Zero idle capital** — the pool already holds a large USDC reserve; it lends from that
  and is repaid atomically.
- **Wrapper untouched** — `mint` runs with its exact current semantics (real USDC in →
  Blend deposit → mint pair). Solvency invariant never sees an unbacked state.
- **Battle-tested** — this is exactly Pendle V2's `swapExactTokenForYt` architecture
  (router + market flash-swap hook + untouched tokenizer). We're copying a proven,
  audited separation, not inventing one.

---

## 3. Chosen design — Option C (pool flash-lends USDC)

### 3.1 One-line summary

The **market** grows a `flash_lend` hook that advances USDC from its own reserve to a
**new PeripheryRouter** and requires repayment before the call ends. The router uses that
USDC (+ the user's budget) to mint a PT+YT pair, sells the PT back into the pool, repays
the flash loan, and hands the YT to the user. All atomic; any failed leg reverts everything.

### 3.2 What gets built

| Contract | Change | Reason |
|---|---|---|
| **market** (`contracts/market`) | **UPDATE** — add `flash_lend` entrypoint (additive; does not modify swap/add/remove) | The pool is the only holder of USDC that can lend + enforce repayment |
| **PeripheryRouter** (`contracts/router`) | **CREATE** — orchestrates `buy_yt` + the flash callback | Isolates the new/risky atomic logic away from audited money-paths |
| **wrapper** (`contracts/wrapper`) | **NO CHANGE** | `mint` is called via its normal front door |
| **frontend** (`website/frontend/src/lib/market.ts`) | **UPDATE** — replace 2-tx `buildBuyYtSteps` with 1 `router.buy_yt(...)` call + thin-pool quote/gate | UX |

**Net: 1 new contract, 1 additive market update, 0 changes to the tokenizer.**

### 3.3 The atomic `buy_yt` sequence (verified token trace)

Example: user has **5 USDC**, deep pool 1,000,000 PT / 1,000,000 USDC, 1yr, fee 0.30%.
Solver picks **N = 1,623.03** (PT to mint & sell = YT to deliver). PT sale fetches
**1,618.03 USDC**; net cost **5.00 == budget**.

| Step | Action | Router holds after | Pool PT | Pool USDC |
|---|---|---|---|---|
| 0. start | — | empty; user has 5 | 1,000,000 | 1,000,000 |
| 1. pull budget | take 5 USDC from user | 5 USDC | 1,000,000 | 1,000,000 |
| 2. **flash-borrow** | pool lends router 1,618 USDC (owed back) | 1,623 USDC | 1,000,000 | 998,382 |
| 3. **mint(1,623)** | wrapper deposits 1,623 → Blend, mints pair | 1,623 PT + 1,623 YT | 1,000,000 | 998,382 |
| 4. **sell 1,623 PT** | sell minted PT into pool (real swap) | 1,618 USDC + 1,623 YT | 1,001,623 | 998,382 |
| 5. **repay loan** | return 1,618 USDC to pool | 1,623 YT | 1,001,623 | 998,382 |
| 6. deliver | send 1,623 YT to user | empty | 1,001,623 | 998,382 |

> ⚠️ **Accounting note (do not repeat an earlier mistake):** the pool does **NOT** end
> back at 1,000,000 USDC. There are THREE USDC moves: (A) flash-lend −1,618, (B) pool
> pays −1,618 to buy the PT in step 4, (C) repay +1,618. A and C cancel; **B does not**.
> Net pool change = **−1,618 USDC, +1,623 PT**. Economically the whole `buy_yt` collapses
> to **one ordinary swap: the pool bought 1,623 PT for 1,618 USDC** (and earned the fee).
> The flash loan is just plumbing to fund the mint-before-sale; it nets to zero.

### 3.4 The conservation law (why nothing is created from nothing)

```
every 1 PT in existence + every 1 YT in existence  ⟷  1 USDC deposited in Blend
```

`buy_yt` mints 1,623 **new** PT + 1,623 **new** YT, backed by a **real** 1,623 USDC Blend
deposit (`wrapper.mint` semantics unchanged). The new YT → user; the new PT → pool (it
bought it). Supply of both rose by 1,623, fully backed. `wrapper.assert_solvent` enforces
this after the mint or the tx reverts.

---

## 4. Contract interfaces (draft)

### 4.1 market — new `flash_lend`

```rust
/// Advance `usdc_amount` from the pool's USDC reserve to `router`, invoke the router's
/// flash callback, then REQUIRE the reserve is restored (repaid) before returning.
/// Additive: does not touch swap/add_liquidity/remove_liquidity.
pub fn flash_lend(
    env: Env,
    router: Address,          // must be an allow-listed router (see 6.4)
    usdc_amount: i128,
    callback_data: Bytes,     // opaque; passed to router.on_flash_lend
) {
    Self::ensure_can_trade(&env);           // blocked while paused
    // (auth: the router authorizes; or gate to an allow-listed router set by admin)
    let usdc_before = storage::usdc_reserve(&env);
    if usdc_amount <= 0 || usdc_amount >= usdc_before {
        panic_with_error!(&env, Error::InsufficientLiquidity);   // 80
    }
    // Advance USDC to the router.
    let me = env.current_contract_address();
    token::Client::new(&env, &storage::get_underlying(&env))
        .transfer(&me, &router, &usdc_amount);
    // NOTE: do NOT decrement usdc_reserve here — the router returns it via a real
    // deposit/repay; we re-read the actual balance/repayment below. (Exact reserve
    // bookkeeping is a design decision — see §6.1.)

    // Invoke the router callback (it mints, sells PT into THIS pool, repays USDC).
    RouterClient::new(&env, &router).on_flash_lend(&usdc_amount, &callback_data);

    // Require repayment: the pool's USDC reserve must be >= before the loan.
    let usdc_after = storage::usdc_reserve(&env);
    if usdc_after < usdc_before {
        panic_with_error!(&env, Error::InsufficientLiquidity);   // repayment not made
    }
    Self::assert_reserves_sane(&env);       // existing invariant (lib.rs:280 area)
}
```

> **Open question (resolve at build):** whether repayment is a direct `transfer` back to
> the pool that the pool *counts as reserve*, vs. the router's PT sale (`swap_exact_pt_for_usdc`)
> being the thing that moves the reserve. Cleanest model: the flash-lend and the PT sale
> are independent; the router repays the flash USDC with a plain transfer, and `flash_lend`
> checks the reserve is whole. Must decide how `usdc_reserve` storage is updated across the
> nested `swap_exact_pt_for_usdc` call (which itself updates the reserve). See §6.1.

### 4.2 PeripheryRouter — new contract

```rust
/// Buy YT with a small budget in one atomic tx. Returns YT delivered.
pub fn buy_yt(env: Env, user: Address, usdc_budget: i128, min_yt_out: i128) -> i128 {
    user.require_auth();
    // 1. Solve N (= YT out = PT to mint/sell) s.t. net_cost(N) ≈ usdc_budget.
    //    net_cost(N) = N − quote_pt_for_usdc(N).  Newton/bisection on-chain using the
    //    market's quote (curve is monotonic → converges fast). Bounds-check N < pt_reserve.
    let n = solve_n_for_budget(&env, usdc_budget);
    if n <= 0 { panic_with_error!(&env, Error::InvalidAmount); }
    // 2. Pull ONLY the budget from the user.
    pull_usdc(&env, &user, usdc_budget);
    // 3. Flash-borrow the rest of N from the market, which calls back into on_flash_lend.
    //    on_flash_lend does: mint(N) via wrapper, sell N PT into market, repay flash USDC.
    market.flash_lend(&router, n - usdc_budget, encode(n, user, min_yt_out));
    // 4. After the callback: router holds N YT. Enforce slippage and deliver.
    //    (yt delivered to user; require yt_out >= min_yt_out or revert)
}

/// Flash callback — ONLY callable by the market mid-flash (guard on caller == market).
pub fn on_flash_lend(env: Env, usdc_amount: i128, data: Bytes) {
    // require caller is the market; require we are inside a live buy_yt (reentrancy shape)
    let (n, user, min_yt_out) = decode(data);
    // router now holds (budget + usdc_amount) == N USDC
    wrapper.mint(&router, n);                       // → N PT + N YT to router
    let proceeds = market.swap_exact_pt_for_usdc(&router, n, /*min*/ 0);
    // repay the flash loan (transfer usdc_amount back so the pool reserve is whole)
    repay(&env, usdc_amount);
    // leftover ~0; N YT retained for delivery in buy_yt step 4
}

/// Read-only preview for the frontend (§5, Layer 5). Never reverts.
pub fn quote_buy_yt(env: Env, usdc_budget: i128)
    -> (i128 /*yt_out*/, i128 /*effective_price_per_yt*/, i128 /*vs_fair_bps*/, bool /*capped*/);
```

### 4.3 Existing entrypoints reused (no change)

- `wrapper.mint(user, amount)` — `contracts/wrapper/src/lib.rs:133`
- `market.swap_exact_pt_for_usdc(trader, pt_in, min_usdc_out)` — `contracts/market/src/lib.rs:250`
- `market.quote_pt_for_usdc(pt_in)` — `contracts/market/src/lib.rs:326` (for the solver)
- `market.reserves()` / `market.pt_price()` — for the solver & quote view

---

## 5. The BIGGER picture — this feature alone does NOT fix low liquidity

**Critical:** `buy_yt` fixes *capital efficiency* (front 5 not 100). It does **NOT** fix
*thin liquidity*. On a shallow pool the fills are still bad — that's the AMM, not the
router. The full solution is a **layered liquidity strategy**. Build order matters.

### Verified pricing thresholds (first 5-USDC YT buyer, balanced pool)

| Pool/side | YT for 5 USDC | Cost vs deep pool | Verdict |
|---|---|---|---|
| 5 (current demo default) | ~5 | 24× overpriced | unusable — dies in ~2 trades |
| 200 | ~128 | 13× | unusable |
| 1,000 | 286 | 5.7× | poor |
| 5,000 | 574 | 2.8× | usable |
| **50,000** | **1,194** | **1.4×** | **good** |
| 200,000+ | 1,484 | 1.1× | great |

**Threshold: ~$5k/side to be usable, ~$50k+/side to be good.** (Sim: `scratchpad/small_pool.py`.)

### Depletion is real (many buyers, shallow pool)

Each `buy_yt` is a real swap: pool USDC ↓, pool PT ↑. On a 5/5 pool, buyer #1 nearly
drains it and #4+ **revert**. On a 1M/1M pool, 6 buyers move USDC <1%. Self-corrects via:
(a) each successive buy gets worse (built-in throttle), (b) cheap PT opens a counter-arb
that refills USDC, (c) the 0.5%–99.5% proportion band **hard-reverts** further buys —
worst case is "YT buying pauses," never "LPs wiped." (Sim: `scratchpad/depletion.py`.)

### The layered launch/liquidity plan (do in this order)

| Layer | What | Effort | When |
|---|---|---|---|
| **1. Seed the pool** | Launch with **~$50k+/side** protocol/treasury liquidity. Fix deploy defaults: `MARKET_SEED_AMOUNT` is **0** on mainnet (`scripts/deploy_mainnet.sh:82`), 5 USDC on testnet — both launch-blockers. | Hours (config + treasury) | **Before any real launch** |
| **2. Lead with PT** | Market "earn fixed yield" (PT) first. PT is fairly priced from day one AND PT buying *adds* USDC to the pool. YT ("long yield") is a later-stage product promoted once depth exists. | Zero code (GTM) | Launch |
| **3. LP incentives** | Reward early LPs (emissions / fee share). Route the fixed-rate **vault** (`contracts/vault`) activity to also seed market depth — it already holds PT. | Medium | Weeks post-launch |
| **4. buy_yt router** | THIS spec — the flash-lend router. Gate it on depth. | Medium-high | Once pool is deep |
| **5. Quote + gate UI** | `quote_buy_yt` view + "pool is thin, YT is Nx overpriced" warning; soft-disable Long Yield below a liquidity floor, redirect to PT. Keep `min_yt_out` mandatory. | Low-med | **Ship WITH Layer 4** |
| **6. Order book / RFQ** | Off-curve YT limit orders for the thin-AMM regime (what Pendle does at scale). Net-new; roadmap only. | High | Scale |

---

## 6. Risks & open questions (resolve at build time)

### 6.1 Reserve bookkeeping across the nested swap ⚠️ (the main design question)

`flash_lend` transfers USDC out, then the router calls `swap_exact_pt_for_usdc` which
**itself** mutates `usdc_reserve` (`lib.rs:310`). Decide precisely how the flash advance,
the nested swap's reserve update, and the repayment compose so the final `usdc_reserve`
storage value exactly matches the real token balance. Recommended: keep `flash_lend`'s
advance as a **pure token transfer that does not touch `usdc_reserve` storage**, let the
PT sale update the reserve as normal, and have the router repay via a plain transfer that
`flash_lend` verifies by re-reading. Write the invariant test first.

### 6.2 Soroban reentrancy / callback shape ⚠️ (UNVALIDATED — prototype first)

The flow is pool → router → pool (`swap` + repay) within one host call. Soroban **forbids
true reentrancy by default** (see wrapper docstring lines 23–36), so this must be
implemented as an explicit "transfer out, call router, require repaid on return" — NOT a
re-entrant callback. **This is the one piece not yet validated against the host.** Build a
minimal `flash_lend` + dummy router and prove "loan-or-revert" on testnet/sandbox BEFORE
building the full router.

### 6.3 Flash-lend price manipulation

Ensure the flash-lent USDC can't be used to manipulate the pool's own price against other
traders mid-loan (e.g. the router doing extra swaps). Mitigation: the router is a fixed,
allow-listed, audited contract that does exactly one PT sale; no arbitrary calls.

### 6.4 Router allow-listing / auth

`flash_lend` should only be callable by (or only call back into) an **admin-set,
allow-listed router address** — not an arbitrary contract. Add `set_router` (admin,
governed) to the market, mirroring the existing governance pattern.

### 6.5 The solver

`solve_n_for_budget` must be robust: monotone curve → bisection converges, but bound N <
`pt_reserve`, handle the CAPPED case (budget can't be fully spent on a thin pool — return
the max feasible N and let the UI show "capped"), and never revert in the read-only quote.

### 6.6 Slippage / MEV

`min_yt_out` is mandatory (mirror `SlippageExceeded` = 81). The whole tx is atomic so
there's no cross-tx sandwich, but the solver reads live reserves — pin the quote and
enforce `min_yt_out` at delivery.

---

## 7. Test matrix (write these)

Contract (Rust, mirror `contracts/market/src/test.rs` style):

- `buy_yt_deep_pool_5usdc_gives_~1623_yt` — the headline number, zero buffer.
- `buy_yt_reverts_if_flash_not_repaid` — router that doesn't repay → whole tx reverts.
- `buy_yt_respects_min_yt_out` — too-high min → `SlippageExceeded`.
- `buy_yt_capped_on_thin_pool` — 5/5 pool → returns max feasible, doesn't drain past band.
- `buy_yt_reverts_past_proportion_band` — can't push pool outside 0.5%–99.5%.
- `flash_lend_only_callable_by_allowlisted_router` — auth gate.
- `flash_lend_cannot_manipulate_price_for_other_swaps` — no mid-loan price abuse.
- `wrapper_solvency_intact_after_buy_yt` — `assert_solvent` holds (backing == minted).
- `quote_buy_yt_never_reverts` — read-only view degrades to (0,…,capped=true) on bad state.
- `sequential_buyers_deplete_then_band_reverts` — N buyers, pool skews, hard-reverts safely.

Frontend:

- Replace `buildBuyYtSteps` (2-tx) with single `router.buy_yt(budget, minYtOut)`.
- Wire `quote_buy_yt` → show yt_out / effective price / vs-fair / capped warning.
- Thin-pool gate: soft-disable Long Yield below the liquidity floor, redirect to PT.

---

## 8. Reference — how Pendle (the proven implementation) structures this

Same split we chose:

- **PendleRouter** (peripheral) orchestrates `swapExactTokenForYt` (mint + flash-swap + repay).
  → our **PeripheryRouter**.
- **PendleMarket** (AMM) exposes the flash-swap callback hook that lends + requires repayment.
  → our **market `flash_lend`**.
- **SY/YT tokenizer** is **not modified** by the buy-YT flow.
  → our **wrapper (untouched)**.

Docs:
- Pendle Router integration: https://docs.pendle.finance/pendle-v2-dev/Contracts/PendleRouter/ContractIntegrationGuide
- Mechanism teardown: https://mixbytes.io/blog/yield-tokenization-protocols-how-they-re-made-pendle

---

## 9. TL;DR for future-me

- **Build:** a new **PeripheryRouter** contract + one **additive `flash_lend`** on the
  **market**. **Do not touch the wrapper.** Update the frontend to a single `buy_yt` call.
- **Why C not A/B:** A wastes ~300× idle capital; B weakens the wrapper's solvency
  invariant. C is zero-buffer, wrapper-safe, and is the proven Pendle architecture.
- **Prototype FIRST:** the Soroban flash-callback "loan-or-revert" shape (§6.2) — it's the
  only unvalidated piece.
- **This feature ≠ liquidity fix.** It fixes capital efficiency. Thin-pool pricing is fixed
  by the **launch/liquidity strategy in §5** — above all, **seed the pool ~$50k+/side at
  launch** (Layer 1) and **lead with PT** (Layer 2). Do those regardless of when the router
  ships.
- **All numbers here are from the live curve.** Re-run `scratchpad/*.py` (router_sim,
  small_pool, depletion, optc_trace) if you want to re-derive them.
```
