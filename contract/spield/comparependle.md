# comparependle.md — Spield's PT/YT AMM vs Pendle V2

**Companion to [`futureamm.md`](./futureamm.md).** That file asked "does our design work?" (yes,
mechanically). This one asks "**how does it compare to Pendle, who has been doing this for years?**"

Everything Pendle-side below is checked against Pendle's own docs or their published source, not
memory — links at the bottom. Everything Spield-side is a number from a test in
`futureamm-prototype.patch` (**294 tests green**).

---

## The short answer

**Our trading mechanism is fine. Pendle's is basically the same idea, and where it differs, ours is
occasionally simpler. That is not where the gap is.**

The gap is in **four supporting pieces around the trade** that Pendle got right and we have not
built. Three of them are cheap to fix. One is a real refactor.

| | Who wins | How big is the gap |
|---|---|---|
| How a YT trade is plumbed | **Roughly tied** — ours is simpler on Soroban | small |
| How the fee is charged | **Pendle, clearly** | **large — this is the big one** |
| What PT is paired with in the pool | **Pendle** | large |
| How YT yield is tracked per holder | **Pendle** | large |
| How the price curve is anchored | **Pendle** | medium, but expensive in capital |
| Extra trading layers (limit orders) | **Pendle** | they are years ahead; not urgent |
| Who keeps the fees | **Spield** (100% to LPs) | small, in our favour |

---

## 1. The two systems, side by side

You mentioned Pendle has "wrap SY / unwrap SY, then buy and sell PT and YT". Here is the whole map,
with the Spield equivalent.

| Pendle V2 | What it does | Spield equivalent | Status |
|---|---|---|---|
| **SY** (Standardized Yield) | Wraps *any* yield-bearing asset behind one standard interface (EIP-5115). `deposit` / `redeem` / `exchangeRate` / `claimRewards`. | **`strategy`** (`BlendStrategy`) — the Blend adapter behind a `YieldStrategy` trait | ✅ we have this, but it is Blend-only and not a token |
| **Wrap SY / Unwrap SY** | User turns e.g. stETH into SY-stETH and back | *(no user-facing step)* — the wrapper takes raw USDC and deposits to Blend internally | ✅ simpler for users, ❌ costs us elsewhere (see §3) |
| **PT / YT mint & redeem** | SY → PT + YT, and back | `wrapper.mint` / `combine_and_redeem` / `redeem_pt_bearer` | ✅ we have this |
| **PT/SY AMM pool** | The one real pool. PT trades against **SY** | `market` — PT trades against **raw USDC** | ⚠️ different, and it matters (§3) |
| **Buy/Sell PT** | Ordinary swap in that pool | `swap_exact_usdc_for_pt` / `swap_exact_pt_for_usdc` | ✅ we have this |
| **Buy/Sell YT** | No YT pool. Router does a flash-swap: borrow PT, mint pair, sell PT back, keep YT | `buy_yt_exact_out` / `sell_yt_exact_in` in `futureamm.md` — pool funds the split directly | ✅ **prototyped and tested**, ours is simpler |
| **Time-scaled fee** | `feeRate = exp(lnFeeRateRoot × yearsToExpiry)`, applied to the exchange rate | flat `fee_bps` on the notional | ❌ **we do not have this** |
| **Dynamic rate anchor** | Anchor recomputed each state update from `lastLnImpliedRate` | anchor pinned at par (1.0), never moves | ❌ we do not have this |
| **Per-holder YT interest index** | `InterestManagerYT` with `UserInterest {index, accrued}`, updated by a `_beforeTokenTransfer` hook | per-mint `Position` record; the SAC token has no hook | ❌ **structural difference** |
| **Limit order book** | Off-AMM limit orders at a chosen implied APY, zero price impact; router splits between book and AMM | none | ❌ roadmap only |
| **vePENDLE / emissions** | Governance + LP incentives | none | ❌ out of scope |
| **Fixed-rate vault** | *(none — PT is the fixed-rate product)* | `contracts/vault` quotes a fixed rate directly | ✅ **we have something they don't** |

---

## 1b. What "wrap SY / unwrap SY" actually is, and why the button exists

Two things worth pinning down, because the mental model matters for what we copy.

### The exact functions

**On the SY token itself** (`IStandardizedYield`, Pendle's EIP-5115 interface):

```solidity
// WRAP
function deposit(address receiver, address tokenIn, uint256 amountTokenToDeposit, uint256 minSharesOut)
    external payable returns (uint256 amountSharesOut);

// UNWRAP
function redeem(address receiver, uint256 amountSharesToRedeem, address tokenOut, uint256 minTokenOut,
                bool burnFromInternalBalance) external returns (uint256 amountTokenOut);
```

**On the Router** — this is what the dashboard button actually calls:

| Dashboard action | Router function |
|---|---|
| Wrap sUSDe → SY-sUSDe | `mintSyFromToken` |
| Unwrap SY-sUSDe → sUSDe | `redeemSyToToken` |

The Router version exists because `TokenInput` carries `pendleSwap` + `swapData` — an optional
aggregator leg — so you can wrap starting from *any* token, not only the ones in
`SY.getTokensIn()`.

### Correction: SY is not always 1:1, and "1:1 with what" matters

Pendle's own docs: *"In most cases, 1 SY token represents 1 unit of the underlying yield-bearing
asset... However, there are exceptions (e.g. mPendle, aUSDC) where the ratio is not strictly 1:1."*

And the important distinction even in the 1:1 case:

```
SY-sUSDe   ≈ 1 : 1  with  sUSDe   (the yield-bearing token — the "share")
SY-sUSDe   ≠ 1 : 1  with  USDe    (the base asset — grows over time)
```

From the interface doc comment: *"exchangeRate × syBalance / 1e18 must return the asset balance of
the account."* So SY is a **share**, and `exchangeRate()` is the share→asset rate. That rate rising
**is** the yield.

### SY's real job is not wrapping — it is five other things

Wrapping is the visible part. The reasons SY exists:

1. **It is the adapter layer.** Yield sources have wildly different shapes — rebasing (stETH),
   ERC-4626 (sUSDe), aTokens, cTokens, LP tokens with emissions. **Pendle's core contracts (PT, YT,
   the AMM) speak only SY.** Onboarding a new yield source = writing one new SY contract, zero
   changes to core. *This is exactly what our `YieldStrategy` trait / `BlendStrategy` does.*
2. **`exchangeRate()` is the yield oracle.** It is the single number PT/YT accounting runs on —
   YT's `_pyIndexCurrent()` comes off it. *Direct analogue of our Blend `b_rate`.*
3. **It standardizes secondary rewards.** `getRewardTokens()`, `claimRewards(user)`,
   `accruedRewards(user)`, `rewardIndexesCurrent/Stored()`. Many sources emit extra tokens or points
   (COMP, ARB, campaign points) on top of the rate. SY normalizes that so YT holders receive them.
   **We have no equivalent — Blend's BLND emissions are not surfaced by our strategy at all.**
4. **It is a multi-token front door.** `getTokensIn()` / `getTokensOut()` / `isValidTokenIn` /
   `isValidTokenOut` — one SY can accept several entry assets.
5. **It is half the pool.** The AMM is PT/SY, so LPs *hold* SY. It is not just an intermediate hop.

### So why is there a manual wrap button if the Router does it automatically?

Because the Router path is the *convenience* path, not the only one. The manual button covers:

* **Providing liquidity** — the pool's quote asset is SY, so LPs may want it directly.
* **Zero-price-impact minting** — minting PT+YT from SY has no slippage. A strategy that wants YT
  without paying AMM price impact mints the pair and sells the PT itself.
* **Finishing a post-maturity exit** — redeem PT → SY, then unwrap SY → token.
* **An escape hatch** — if the aggregator route prices badly or fails, do the legs by hand.
* **Integrators** who hold SY for their own accounting.

## 1c. The AMM does *not* do the wrapping — the Router does

You asked whether the wrapping and the PT/YT conversion are handled internally by the AMM. **Nearly
right, but the split matters, and it is the more interesting half of the answer.**

* **`PendleMarket` (the AMM) only knows PT and SY.** Its swaps are literally `swapExactPtForSy` and
  `swapSyForExactPt`. It has never heard of USDC. It does not wrap. It does not mint PT or YT.
* **`PendleRouter` is what makes it feel automatic.** `swapExactTokenForPt` does, in one
  transaction: take USDC → (optional aggregator swap) → `SY.deposit()` → `market.swapSyForExactPt()`
  → deliver PT. Pendle's integration guide is explicit that a user buying PT with a raw token *does
  not* wrap SY themselves.
* Same shape for YT: `swapExactTokenForYt` = wrap to SY → flash-borrow PT → mint the pair → sell the
  PT back → keep the YT.

So the correct statement is: **not "the AMM handles it internally", but "the Router handles it in
one transaction, so the user never sees it."**

### Why this matters for us

The separation is deliberate and load-bearing for Pendle:

| | Pendle | Spield (`futureamm.md` as prototyped) |
|---|---|---|
| Holds LP funds | `PendleMarket` | `market` |
| Knows about raw USDC | Router only | `market` |
| Mints/burns PT+YT | Router (via YT contract) | `market` calls `wrapper.split_for_market` |
| Where YT trade logic lives | **Router — peripheral, replaceable, holds no funds** | **`market` — the contract holding LP money** |

`FEATUREPLAN_BUY_YT.md` §3.2 originally chose Pendle's shape ("isolates the new/risky atomic logic
away from audited money-paths") and only abandoned it because the flash-lend callback is awkward on
Soroban.

Our direct design is still the right call for Soroban — it removes the callback entirely. But we
should be honest about what we gave up: **every future change to YT trading is now a change to the
contract custodying LP funds**, and that contract needs re-auditing each time. Pendle can ship a new
router without touching the pool.

A middle path exists — a Spield router that calls `market` and `wrapper` in sequence, with the
market exposing a narrow market-only funding entrypoint. It needs no callback, because our flow is
already one-directional. Worth considering before this ships, not after.

## 2. The trade mechanism itself — we are fine here

Both protocols solve the same problem the same way, and the core identity is identical:

```
1 PT + 1 YT  =  1 unit of the underlying
so   price(YT) = 1 − price(PT)
```

Neither has a YT pool. Both derive YT from the PT pool.

**Pendle's route:** the Router "flash-borrows" PT from the market, mints a PT+YT pair, sells the PT
back to repay, keeps the YT. It needs an on-chain approximation routine
(`approxSwapExactSyForYtV2`) to work out how much to borrow.

**Our route (`futureamm.md` §2):** the pool just funds the missing part of the notional directly and
receives the freshly minted PT in the same call. No borrow, no repay, no callback.

Proven bit-for-bit in the prototype:

> `buy_yt_moves_reserves_exactly_like_selling_that_pt_into_the_pool` — two identical worlds; in one
> a user buys `N` YT, in the other someone sells `N` PT. **The pool reserves end identical.**

Two places ours is genuinely simpler on Soroban:

* **No flash-swap callback.** Soroban forbids re-entrancy by default, which is exactly why
  `FEATUREPLAN_BUY_YT.md` §6.2 flagged the flash-lend callback as its one *"UNVALIDATED — prototype
  first"* risk. Our direction (`User → Market → Wrapper`) removes the callback entirely, and the
  prototype proves it works under real (non-mocked) authorization.
* **No solver.** Pendle needs a binary-search approximation because it prices *exact-input* ("spend
  X, get as much YT as possible"). We price *exact-output* ("I want exactly N YT"), which is
  closed-form — one curve evaluation, no iteration.

**Verdict on the mechanism: tied, with a small edge to us on Soroban.** Pendle's is more general
(it also handles exact-input and routes through the order book). Ours is cheaper and has fewer
moving parts. Neither is wrong.

---

## 3. The four things Pendle does better

### 3.1 The fee — this is the big one

**What Pendle does.** From their source (`MarketMathCore.sol`):

```
res.feeRate = _getExchangeRateFromImpliedRate(market.lnFeeRateRoot, timeToExpiry);
// buying PT:  postFeeExchangeRate = preFeeExchangeRate / feeRate
//             fee = preFeeAssetToAccount × (1 − feeRate)
```

`feeRate = exp(lnFeeRateRoot × yearsToExpiry)`. In plain English: **the fee shrinks as maturity
approaches**, and it shrinks at the same rate the yield does. Pendle's own docs put it as *"the AMM
fee is calculated relative to the yield being traded"* and *"a trade made one year before maturity
will incur a significantly higher fee than the same size trade made one month before maturity."*

**What we do.** A flat `fee_bps` on the notional, the same 30 bps whether the bond has 30 days or
365 days left.

**Why this matters so much for YT.** A YT buyer only pays `1 − PT_price` — a thin slice of the
notional. But our fee is charged on the *whole* notional. So the fee the YT trader actually feels is
**leverage × fee_bps**, and leverage goes up as the term gets shorter.

Measured, at 5% implied APY, on the fee-independent fair YT value (`1 − pt_price`):

| term | fair YT value per 10,000 | **Spield** flat 30 bps | **Pendle** 1%/yr root | **Pendle** 0.5%/yr | **Pendle** 0.25%/yr |
|---|---|---|---|---|---|
| 30d | 40.02 | **75.0%** | 20.0% | 10.0% | 5.0% |
| 90d | 119.58 | **25.1%** | 20.9% | 10.0% | 5.0% |
| 180d | 237.74 | **12.6%** | 20.6% | 10.5% | 5.0% |
| 365d | 476.19 | **6.3%** | 21.0% | 10.5% | 5.3% |

> Test: `fee_as_a_fraction_of_the_yield_being_traded`

Read the columns downward. **Every Pendle column is flat. Ours is not.** That is the whole point:

* Pendle's fee is a **constant share of the yield being traded**, at every maturity. The level is a
  free dial (`lnFeeRateRoot`) — they can set it to 5%, 10%, whatever — and it stays that share
  everywhere.
* Ours is a constant share of *notional*, so as a percentage of what the YT trader pays it goes
  **75% → 25% → 12.6% → 6.3%** depending only on how long the bond is.

**One flat number cannot be correct for both a 30-day and a 365-day market.** Our mainnet default
term is **90 days** — the bad end of that range.

Note honestly: at 365 days our flat 30 bps is actually *cheaper* than a 1%/yr Pendle root. Pendle
isn't universally cheaper — it's **predictable**, and it can be tuned to one target that holds
across every maturity. We can't tune one number to fit them all.

Round-trip cost at our actual mainnet defaults (90d, 5%, 30 bps): **40.5%** of the YT price.

### 3.2 What PT is paired with — SY vs raw USDC

**Pendle pools are PT/SY.** SY is the yield-bearing wrapper, so the "cash" half of the pool **keeps
earning the underlying yield while it sits there**. Pendle LPs earn swap fees + PENDLE incentives +
**SY yield on their non-PT half** + PT's pull to par.

**Our pool is PT/USDC.** The USDC half sits in the market contract earning **exactly nothing**.

Concretely, at the mainnet default seed (1,000,000 USDC on the cash side, 90-day term): at a ~5%
Blend rate, that idle half forgoes roughly **12,300 USDC over one term** (~50,000/yr). That's a pure
subsidy from our LPs to nobody — and it's the yield we are simultaneously trying to sell.

Your own spec already spotted this (§14: *"Spield may evaluate a PT/standardized-yielding-base pool
rather than PT/raw-USDC, similar in purpose to a PT/SY market"*). Pendle's answer is that it isn't
optional — it's the default, and it's a large part of why LPs show up.

**Pendle's IL story is also better because of this.** Both halves of a PT/SY pool are denominated in
the same asset and highly correlated, and at maturity PT redeems 1:1, so IL is near-zero before
maturity and zero at it. Our PT/USDC pool gets the maturity part right (PT → par) but the pre-maturity
half is worse, because one side is drifting up with yield and the other is frozen.

### 3.3 How YT yield is tracked — the stranding bug

**Pendle's YT is a custom ERC-20 with a transfer hook.** `_beforeTokenTransfer` calls
`_distributeInterest`, which settles both parties' accrued interest against a global index before
the balance moves. State lives in `InterestManagerYT` as `UserInterest { index, accrued }` per
holder. **Result: YT is freely transferable, sellable anywhere, and the yield always follows the
token.**

**Our PT and YT are Stellar Asset Contracts.** SACs are built into the protocol with a fixed
interface — **there is no transfer hook.** So the wrapper keeps a separate `Position` ledger, and
*the ledger, not the token, is the claim*. Our own wrapper doc-comment says exactly this, and it is
the honest workaround, not a mistake.

But the consequence is severe, and the prototype demonstrates it end to end:

> Alice buys 10,000 YT, transfers **all of it** to Bob, waits 90 days, and **still claims every
> stroop of yield**. Bob's YT is inert and claims 0. Worse, Alice can no longer sell either — the
> merge burns YT from the position owner, whose balance is now zero — so she's stuck.
> Test: `a_raw_yt_transfer_still_strands_the_claim_and_the_market_path_does_not_fix_it`

This is already tracked as `tofix.md` **#15**. The spec's answer (§3.3, §10.5) is *"the app must not
expose a generic YT transfer feature"* — which is a **product control over a token anyone can move
from any wallet**. Today the blast radius is bounded by how many people mint. Market-issued YT
multiplies the number of holders, and every one of them is one wallet action away from stranding
themselves.

There is a second cost. Pendle's model is one balance per user. Ours is one `Position` per mint, so
five YT buys means **five positions and five separate `claim_yield` calls** for one fungible balance
of 10,000 YT (test: `every_yt_buy_opens_another_position_the_user_must_manage_separately`). The spec's
own §5 asks for one aggregate position per user — and the wrapper can't currently do that.

**This is the one gap that is a real refactor, not a parameter change.** Fixing it properly means
either (a) moving PT/YT off SACs onto custom Soroban token contracts with hooks — losing SAC
composability and classic-asset interop — or (b) restructuring `Position` into a per-user YT ledger
with PT as a pure bearer liability, and accepting that raw YT transfers stay unsupported.

### 3.4 The rate anchor — why our pool costs 7× the capital to open

**Pendle recomputes the anchor.** Their `_getRateAnchor` derives it each state update from the
stored `lastLnImpliedRate`, so the implied rate stays continuous over time *and* the price still
converges to par at maturity.

**We pin the anchor at par (1.0) forever** (`MARKET_RATE_ANCHOR=1000000000000`, never updated).
Because the anchor is par, **the entire PT discount has to come from making the pool lopsided.**
Measured, for the same 5% target rate at 90 days:

| anchor | PT:USDC seed needed | PT price at open |
|---|---|---|
| **1.0000 (par — what we ship)** | **6.96 : 1** | 0.98804 |
| 0.9950 | 3.09 : 1 | 0.98804 |
| 0.9900 | 1.37 : 1 | 0.98804 |
| 0.9880 (≈ fair) | **1.00 : 1** | 0.98800 |

> Test: `moving_the_anchor_off_par_collapses_the_seed_requirement`

**Same market, same rate, 7× the LP capital** — purely because of where the anchor sits. And it gets
worse for longer terms: opening a 1-year pool at 8% needs a **17:1** seed.

**But you cannot just lower the anchor.** It is load-bearing:

| anchor | PT price at day 0 | day 45 | day 80 | day 89 |
|---|---|---|---|---|
| par 1.0000 | 0.98804 | 0.99402 | 0.99867 | **0.99987** ✅ |
| 0.9880 | 0.98800 | 0.98800 | 0.98800 | **0.98800** ❌ |

> Test: `a_below_par_static_anchor_breaks_par_convergence`

A static below-par anchor freezes PT at 0.988 while every PT still redeems at **1.000** — a standing
risk-free draw on LPs right up to maturity. So the cheap seed is not free.

**Pendle gets both** (cheap seeding *and* par convergence) precisely because the anchor is dynamic.
Our own `PHASE3_AMM_DESIGN.md` §3.4 already identifies this as "Stage C.1 — dynamic re-anchoring",
and it was never built. `tofix.md` #31 correctly found the *static* curve holds its implied rate
soundly over a term — that's true and not in conflict; the cost isn't correctness, it's **capital**.

This also directly worsens `futureamm.md` §4.3: the 7:1 seed is what forces ~17M USDC into Blend,
which crushes utilization and destroys the realized yield YT is a claim on. **Fixing the anchor
fixes the flooding too.**

---

## 4. Where *we* are better

Not everything favours Pendle.

**1. Simpler YT plumbing on Soroban.** No flash-swap callback, no router contract, no repayment
check, no allowlist. Soroban's no-re-entrancy default makes Pendle's flash pattern awkward; our
direction sidesteps it. Proven under enforced auth.

**2. No solver needed for exact-output.** Pendle runs a binary-search approximation on chain. Ours
is closed-form.

**3. 100% of swap fees go to LPs.** Pendle sends only **20%** of swap fees to LPs; the other 80% is
split 80/10/10 to PENDLE buyback / treasury / operations. Pendle also takes **5% of all YT yield**.
We take **0%** of yield and give **all** swap fees to LPs. That's better for users and LPs — and it
also means we currently have **no protocol revenue at all**, which is a business question, not a
technical one.

**4. A real fixed-rate vault.** `contracts/vault` quotes a fixed rate directly and backs every
receipt with PT it actually holds. Pendle has no direct equivalent — on Pendle you buy PT yourself.
For a retail "lock 5% for 90 days" product, ours is a nicer front door.

**5. Solvency is asserted on chain, every mutation.** `assert_solvent` checks the live Blend
position against outstanding principal after every state change, with a bounded dust band. That is
stricter than anything Pendle documents publicly.

**6. Simpler user model — no wrap/unwrap step.** Users deposit raw USDC. Pendle users deal with an
SY layer (even if the UI hides it). Ours is genuinely easier to explain — though §3.2 shows we pay
for that simplification on the LP side.

---

## 5. Where Pendle is better — the honest scorecard

| Dimension | Pendle | Spield (with `futureamm.md` built) | Gap |
|---|---|---|---|
| YT trade plumbing | flash-swap + solver | direct split/merge, no callback | **we win, slightly** |
| Fee shape | scales with yield & time | flat on notional | **large** |
| Fee cost to a 90d YT round trip | tunable, term-independent | **40.5%** | **large** |
| Pool's cash side | SY — earns yield | USDC — idle | **large** |
| YT transferability | free, hook-settled | strands the claim | **large** |
| Positions per user | 1 balance | 1 per mint | medium |
| Anchor | dynamic | pinned at par → 7× seed | medium |
| IL for LPs | near-zero pre-maturity, zero at | zero at maturity, worse before | medium |
| Limit orders / RFQ | yes, router splits book+AMM | none | medium (not urgent) |
| Multi-asset support | any asset via SY | Blend USDC only | medium |
| Fee split to LPs | 20% | 100% | **we win** |
| Yield fee | 5% | 0% | **we win** for users |
| Protocol revenue | substantial | none | they win commercially |
| Fixed-rate vault product | none | yes | **we win** |
| On-chain solvency assertion | not documented | every mutation | **we win** |
| Battle-testing | years, billions, many audits | pre-launch | **they win, enormously** |

---

## 6. What to copy, in order

Ranked by (value ÷ effort). The first two are cheap and fix most of the damage.

| # | Copy this from Pendle | Fixes | Effort |
|---|---|---|---|
| **1** | **Time-scaled fee**: `feeRate = exp(lnFeeRateRoot × yearsToMaturity)` applied to the exchange rate | §3.1 — the 40.5% round trip; makes YT tradeable at *any* term | **small** — one function in `curve.rs` + recalibration. Biggest single win. |
| **2** | **Dynamic re-anchoring** (`lastLnImpliedRate` → recompute anchor) | §3.4 — cuts seed capital ~7×, and with it the Blend-flooding problem in `futureamm.md` §4.3 | **medium** — already specced as `PHASE3_AMM_DESIGN.md` §3.4 |
| **3** | **Pair PT against a yield-bearing base, not raw USDC** | §3.2 — stops burning ~50k/yr of LP capital per 1M seeded | **medium-large** — needs a tokenized strategy share |
| **4** | **Per-user YT ledger** (their `InterestManagerYT` shape, minus the hook we can't have) | §3.3 — one position per user instead of one per mint; makes the spec's §5 model real | **large — real refactor + re-audit** |
| **5** | Limit orders / order book | thin-pool pricing | **large** — roadmap, after launch |

**What NOT to copy:** vePENDLE-style tokenomics, the 80/20 fee split away from LPs, and the 5% YT
yield tax. Those are Pendle's business model, not their engineering. Keeping 100% of fees with LPs
is a real differentiator while we're small.

**Also do not copy the flash-swap router.** It's correct for the EVM; on Soroban our direct
split/merge is simpler and avoids a re-entrancy shape the host discourages. This is the one place
where copying Pendle would make things worse.

---

## 7. So which is better?

**Pendle is better today, and it is not close** — but almost none of that lead is in the part we
prototyped.

Think of it as three layers:

* **Layer 1 — how a YT trade physically executes.** We are level with Pendle, arguably ahead on
  Soroban. This is what `futureamm.md` built and tested. It works.
* **Layer 2 — the economic parameters around the trade** (fee shape, anchor, what PT is paired
  with). Pendle is clearly ahead, we know exactly why, and items 1–3 above close most of it without
  touching the trade logic. **This is where all the leverage is.**
* **Layer 3 — the token model** (transferable YT with a transfer hook). Pendle is ahead because the
  EVM lets them own the token contract. Stellar SACs have no hooks, so this is a genuine platform
  constraint, not sloppiness. We either build custom token contracts and lose SAC composability, or
  we accept "YT is position-bound, transfers unsupported" and make the UI enforce it loudly.

**The fair reading: Pendle thought hard about exactly the problems we just measured, and their
answers are good.** The time-scaled fee in particular is not a detail — it is the difference between
a YT market people use twice and one they use once. We should copy it more or less verbatim.

**But "Pendle is ahead" is not an argument against building this.** Pendle doesn't exist on Stellar.
Our mechanism is sound, cheaper to run, and gives LPs a better deal on fees. Fix the fee shape and
the anchor first — both are small, both are contained in `curve.rs`, and together they turn a
40.5% round trip into something competitive. Then decide whether the YT token model is worth a
refactor or whether "position-bound YT, no transfers" is an acceptable v1 limitation you disclose
clearly.

---

## 8. Reproducing the Spield-side numbers

```bash
cd website/contract/spield
patch -p1 < futureamm-prototype.patch
cargo test --workspace                       # 294 green
cargo test -p spield-market -- --nocapture \
  fee_as_a_fraction_of_the_yield_being_traded \
  pendle_time_scaled_fee_vs_spield_flat_fee \
  moving_the_anchor_off_par_collapses_the_seed_requirement \
  a_below_par_static_anchor_breaks_par_convergence
```

**Caveat on the fee comparison:** Pendle applies its fee multiplicatively to the exchange rate; we
reproduce it by computing Pendle's effective bps for each term
(`10_000 × (1 − (1−F)^t)`) and feeding it through the existing fee machinery. For fees this small
the two are the same to first order. The *shape* conclusion — flat column vs sloped column — does
not depend on that approximation.

---

## Sources

Pendle-side claims are from:

- [Pendle Documentation — Introduction](https://docs.pendle.finance/pendle-v2/Introduction)
- [Pendle Documentation — SY (Standardized Yield)](https://docs.pendle.finance/pendle-v2/ProtocolMechanics/YieldTokenization/SY)
- [Pendle Documentation — AMM](https://docs.pendle.finance/pendle-v2/ProtocolMechanics/LiquidityEngines/AMM)
- [`IStandardizedYield.sol` — Pendle core V2 (public source)](https://github.com/pendle-finance/pendle-core-v2-public/blob/main/contracts/interfaces/IStandardizedYield.sol) — the exact `deposit`/`redeem`/`exchangeRate` signatures
- [Pendle Documentation — Router Contract Integration Guide](https://docs.pendle.finance/pendle-v2-dev/Contracts/PendleRouter/ContractIntegrationGuide) — `mintSyFromToken`, `swapExactTokenForPt`, and who does the wrapping
- [`IPAllActionTypeV3.sol` — Router action types incl. `TokenInput`](https://github.com/pendle-finance/pendle-core-v2-public/blob/main/contracts/interfaces/IPAllActionTypeV3.sol)
- [Pendle Documentation — Fees](https://docs.pendle.finance/pendle-v2/ProtocolMechanics/Mechanisms/Fees)
- [Pendle Documentation — Order Book](https://docs.pendle.finance/pendle-v2/ProtocolMechanics/LiquidityEngines/OrderBook)
- [Pendle Documentation — Chapter 7: Providing Liquidity while Trading Yield](https://docs.pendle.finance/pendle-academy/yield-trading-deep-dives/chapter-7-providing-liquidity-while-trading-yield)
- [`MarketMathCore.sol` — Pendle core V2 (public source)](https://github.com/pendle-finance/pendle-core-v2-public/blob/main/contracts/core/Market/MarketMathCore.sol) — fee rate, exchange rate, rate anchor
- [Pendle V2 AMM Whitepaper](https://github.com/pendle-finance/pendle-v2-resources/blob/main/whitepapers/V2_AMM.pdf)
- [MixBytes — Yield Tokenization Protocols, How They're Made: Pendle](https://mixbytes.io/blog/yield-tokenization-protocols-how-they-re-made-pendle) — YT interest manager, router flash-swap
- [Pendle Limit Order (Pendle Team, Medium)](https://medium.com/pendle/pendle-limit-order-134f4c09b580)
- [Pendle V2 (Part 1/3) — Foundation](https://medium.com/pendle/pendle-v2-part-1-3-foundation-6e1773a1d2f4)

Spield-side numbers are from `futureamm-prototype.patch` against the tree of 2026-08-24, running
the real Blend v2 WASM.
