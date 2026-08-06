# tofix.md — verified defects and their fixes

Findings from **Phase 1** of the `testcando.md` programme (§0 mechanism gaps + §13's
supply-conservation invariant). **Every item below is reproduced by a committed, passing test
against the real Blend v2 WASM** — none is a code-reading hypothesis. The test named on each item
pins today's behavior, so it will go red the moment the fix lands (that is intentional: the test is
the fix's acceptance criterion, and its assertion must be inverted as part of the fix).

Suite went from **151 → 179 tests, all green**. Nothing in the contracts has been changed.

Severity legend — **P0** = must close before the first seed transaction; **P1** = close before
meaningful TVL; **P2** = documentation / belt-and-braces.

Status legend — **OPEN** = fix not started; **DECIDE** = needs a product/design call before coding.

---

## Summary table

| # | Issue | Contract | Sev | Status |
|---|---|---|---|---|
| [1](#1-market-bought-pt-has-no-redemption-path) | Market-bought PT has no redemption path | wrapper / market | P0 | DECIDE |
| [2](#2-a-seller-who-sold-their-pt-leg-cannot-redeem-transfer-or-combine) | Seller who sold their PT leg cannot exit | wrapper | P0 | DECIDE |
| [3](#3-a-b_rate-decrease-freezes-every-exit-with-no-recovery-valve) | `b_rate` dip freezes **every exit**, no valve | strategy | P0 | DECIDE |
| [4](#4-max_harvest_batch--50-is-125x-larger-than-a-mainnet-transaction-allows) | `MAX_HARVEST_BATCH = 50` is 12.5× too large | vault | P0 | OPEN |
| [5](#5-harvest-reverts-when-the-yield-it-claims-is-below-one-blend-share) | `harvest` reverts on a dust-sized reinvest | vault | P0 | OPEN |
| [6](#6-harvest-under-a-wrapper-pause-reverts-instead-of-deferring) | `harvest` reverts under a **wrapper** pause | vault | P1 | OPEN |
| [7](#7-harvested-usdc-that-is-not-reinvested-is-stranded-forever) | Un-reinvested USDC is stranded forever | vault | P1 | OPEN |
| [8](#8-the-vaults-solvency-dust-band-grows-without-bound) | Vault solvency dust band is monotonic | vault | P1 | OPEN |
| [9](#9-wrappermint-has-no-maturity-gate) | `wrapper::mint` has no maturity gate | wrapper | P1 | OPEN |
| [10](#10-market-maturity-is-never-cross-checked-against-the-wrapper) | Market maturity not cross-checked | market | P1 | DECIDE |
| [11](#11-minimum-viable-mint-is-2-stroops-not-1) | Minimum viable mint is 2 stroops, not 1 | wrapper | P2 | OPEN |
| [12](#12-claim_yield-on-a-closed-position-is-a-silent-no-op) | `claim_yield` on a closed position is a no-op | wrapper | P2 | OPEN |

**Two corrections to `testcando.md` itself** are recorded in
[Appendix A](#appendix-a--corrections-to-testcandomd). Read them before working the §18 go/no-go
gate: one of its P0s points at the wrong function, and its ordering is unsafe for items 1 and 2.

---

## 1. Market-bought PT has no redemption path

*`testcando.md` §0 P0 `market_bought_pt_is_redeemable_by_buyer` — **confirmed***

**Tests** — `market::test::market_bought_pt_has_no_wrapper_redemption_path`,
`market::test::transfer_position_is_the_only_exit_for_market_bought_pt`

### The issue

`wrapper::redeem_pt(position_id, amount)` and `combine_and_redeem` are **position-gated**: they load
a `Position`, `require_auth` its `owner`, and burn from `pos.owner`'s SAC balance. A trader who buys
PT on the AMM holds a real PT SAC balance but owns **no position**, so there is no id to redeem
against — `try_redeem_pt` returns `PositionNotFound`. The wrapper exposes no balance-based
redemption entry point at all.

The test walks the headline "Earn Fixed via the AMM" flow end to end: the trader spends 100 USDC on
PT, holds to maturity, and finishes holding redeemable PT and **0 USDC**, with no call available to
convert one into the other.

The only exit that exists today is `transfer_position` from the seller — and the second test shows
that path is *also* broken in the common case: `transfer_position` moves `pos.pt_amount`, but once
an LP has put its PT into the pool and a trader has bought some out, the LP holds strictly less PT
than its position records, so the transfer reverts on the SAC leg.

### ⚠ Fix ordering — this is gated on the issuer lockdown

`redeem_pt` being position-gated is currently **the only thing preventing counterfeit PT from
draining the wrapper**. PT/YT are classic Stellar assets whose issuer
(`GA4R5M7ZWOQZWIYCW246YC5WJ4QHT3H74CAUSTCEUUWIELCWI7IP3MKB`) is still an unlocked signing key —
`scripts/deploy_mainnet.sh` hands SAC admin to the wrapper (lines ~210–222) but never calls
`set-options --master-weight 0`. A classic payment from that key creates PT that bypasses the
wrapper entirely.

Test `wrapper::test::extra_pt_outside_a_position_breaks_conservation_but_not_the_wrapper` pins this:
PT held against no position is unredeemable, so the wrapper survives. **Adding any balance-based
redemption removes that shield.** `testcando.md` §18 lists the §0 P0s before the §13 lockdown; for
this item and item 2 that order must be reversed.

### Candidate fixes (needs a decision)

| Option | Change | Trade-off |
|---|---|---|
| **A. Defer** *(recommended)* | Document the gap; do the §13 issuer lockdown first, then revisit | Safest ordering; the flagship flow stays broken until then |
| **B. Post-maturity swaps at par** | Let the market keep quoting at par after maturity so buyers exit via the pool | No wrapper change, no counterfeit exposure; changes the maturity-halt semantics and needs LP-side thought |
| **C. Balance-based `redeem_pt`** | Burn loose PT 1:1 against a global shares pool | Requires the lockdown **first**, plus a wrapper accounting redesign — there is no position to decrement `principal`/`shares` against |
| **D. `split_position`** | Let a seller hand over a right-sized position with the PT | Small change, but the exit stays a manual off-protocol handoff |

---

## 2. A seller who sold their PT leg cannot redeem, transfer, or combine

*`testcando.md` §0 P0 `seller_with_sold_pt_cannot_redeem_or_transfer` — **confirmed, degrades
gracefully***

**Tests** — `market::test::seller_with_sold_pt_can_still_claim_yield`,
`market::test::seller_with_sold_pt_cannot_redeem_pt`,
`market::test::seller_with_sold_pt_cannot_combine_or_transfer`

### The issue

The mirror image of item 1. A user mints, sells the PT leg on the AMM, and keeps the position + YT.
The position still records `pt_amount = 100 USDC` while the SAC balance is 0, so:

* `claim_yield` — **works** (touches neither SAC). Yield accrues and pays correctly.
* `redeem_pt` — **reverts** on the SAC burn shortfall.
* `combine_and_redeem` — **reverts** (needs the PT leg).
* `transfer_position` — **reverts** (moves `pos.pt_amount`).

The good news, and the reason this is a design gap rather than a bug: every failure is **atomic**.
The test asserts `pos.pt_amount` and ownership are unchanged after each failed attempt, and that the
wrapper stays solvent. Position accounting and SAC balances diverge without corrupting state.

### Fix

Same decision as item 1 — they are one design question, not two. Whichever option is chosen there
resolves this. Note that under option **D** (`split_position`) a seller could split off exactly the
PT they still hold and keep a clean, exitable position.

---

## 3. A `b_rate` decrease freezes every exit, with no recovery valve

*`testcando.md` §0 P0 `brate_decrease_bricks_everything_including_exits` — **confirmed, and worse
than described***

**Tests** — `wrapper::test_rate_brick::brate_decrease_bricks_every_entry_point_including_exits`,
`wrapper::test_rate_brick::set_max_apr_bps_cannot_unstick_a_rate_decrease`,
`wrapper::test_rate_brick::the_freeze_floor_is_the_all_time_high_water_mark`

### The issue

`math::check_rate_bound_timed` rejects `current < last` outright. That check sits under
`strategy::current_rate`, which sits under **every** wrapper entry point. If Blend ever socialises
bad debt and `b_rate` dips by even one stroop, all of these revert `RateOutOfBounds`:

`mint` · `claim_yield` · `combine_and_redeem` · `redeem_pt` (even at maturity) · `position_value` ·
`solvency`

Only `transfer_position` survives, because it never reads the rate — so **a position can be moved
but never exited**. The solvency dashboard and the off-chain monitor go dark at the same moment.

Three findings beyond what `testcando.md` describes:

1. **`set_max_apr_bps` cannot fix it.** That valve widens the *upper* ceiling; the failure is the
   *lower* monotonicity guard. The test calls `set_max_apr_bps(u32::MAX)` and the freeze persists.
2. **The floor is the all-time high-water mark**, not `entry_rate`. A position that entered at 1.0
   is frozen by a rate of 1.15 if the strategy ever observed 1.2 — even though that position is
   deeply solvent.
3. **Recovery is only possible if Blend's rate climbs back** above the stored `last_rate`. There is
   no admin action, no timelock, no upgrade path that shortens the freeze.

Blend's rate cannot be pushed down through `BlendFixture`, so these tests drive the real wrapper
against a **mock strategy** (`contracts/wrapper/src/test_rate_brick.rs`) that reproduces
`current_rate`'s bound logic exactly, with a hook to set the raw rate. The mock is validated by
`mock_strategy_supports_the_full_lifecycle`, which runs mint → claim → redeem through it.

### Candidate fixes (needs a decision)

| Option | Change | Trade-off |
|---|---|---|
| **A. `reset_rate_floor` admin fn** *(recommended)* | Add to the strategy, mirroring `set_max_apr_bps`: lets the admin lower the stored `last_rate` to the live one | Cannot mint value — the wrapper still asserts `backing >= principal` against Blend's **real** position on every mutation. Smallest change that restores exits. Requires a human in the loop during an incident |
| **B. Tolerate a bounded decrease** | Allow `current >= last × (1 − max_drawdown_bps)` | Self-healing, no admin action. Needs `max_drawdown_bps` calibrated against a realistic bad-debt event |
| **C. Accept and document** | State plainly that a Blend bad-debt event freezes Spield until the rate recovers | Zero code; leaves user funds inaccessible for an unbounded period |

Whichever is chosen, consider also splitting the guard so **exit paths** tolerate a decrease (yield
is already clamped at 0 in `math::yield_amount`) while **inflows** keep the strict check. A dip
should never be able to trap funds.

---

## 4. `MAX_HARVEST_BATCH = 50` is 12.5× larger than a mainnet transaction allows

*Refines `testcando.md` §0 P0 `vault_redeem_budget_with_many_harvest_positions` and §9
`harvest_at_max_batch_fits_budget` — **the breach is real, but in `harvest`, not `redeem`***

**Test** — `vault::test::harvest_batch_size_that_fits_mainnet_limits`

### The issue

`vault::harvest(n)` performs `n` cross-contract `claim_yield` calls (each a real Blend pool
withdraw) plus one reinvest `mint`. Each Blend `submit` costs ~8 MB of modelled memory against a
**41,943,040-byte per-transaction ceiling**. Measured against mainnet limits, with a vault holding
60+ tracked positions:

| batch | instructions / 600,000,000 | **memory / 41,943,040** | write entries / 50 | ledger entries / 100 |
|---:|---:|---:|---:|---:|
| 1 | 13,617,110 | 15,202,332 | 13 | 35 |
| 2 | 20,177,889 | 23,303,621 | 14 | 37 |
| 3 | 19,862,961 | 23,202,150 | 15 | 39 |
| **4** | **26,931,928** | **31,312,126** ✅ | 16 | 41 |
| **5** | 39,881,323 | **47,645,324** ❌ | 17 | 43 |
| 10 | 72,716,683 | **88,195,989** ❌ | 22 | 53 |
| 25 | 171,562,525 | **209,876,844** ❌ | 37 | 83 |
| **50** | 312,487,585 | **384,001,178** ❌ (9.2×) | **62** ❌ | **133** ❌ |

**The largest batch that fits every mainnet ceiling is 4.** Memory is the binding constraint —
instructions never come close, which is why this was not caught by reasoning about loop counts.
At batch 50 the write-entry and ledger-entry footprints are also blown.

This is measured with the SDK's `InvocationResourceLimits::mainnet()`, which `Env::default()`
already enforces on every test. The estimate is if anything **conservative**: the SDK underestimates
memory for natively-run contracts, and our contracts run natively here while Blend runs as real
WASM.

### Fix

1. Lower `MAX_HARVEST_BATCH` (`contracts/vault/src/lib.rs:56`) from `50` to **`4`**.
2. Update the doc comment on `harvest`, which currently advises callers to "pass e.g. 20–50" — both
   values are unrunnable on mainnet.
3. Invert the assertion in `harvest_batch_size_that_fits_mainnet_limits`, which currently asserts
   the constant is *unsafe*.

### Follow-on concern (belongs to a later phase)

With a safe batch of 4, sweeping N tracked positions takes ⌈N/4⌉ transactions, and N grows by one
per harvest. Item 7's fix (mint only when the balance is worth a position) is the structural relief:
it creates far fewer positions. Without it, harvest upkeep cost grows without bound over the term.

---

## 5. `harvest` reverts when the yield it claims is below one Blend share

*Not in `testcando.md` — **new finding***

**Tests** — `vault::test::harvest_reverts_when_claimed_yield_is_below_one_blend_share`,
`vault::test::paginated_harvest_can_revert_on_a_dust_sized_position`

### The issue

`harvest` claims yield and then reinvests it via `wrapper::mint(claimed)`. At `b_rate > 1` a
1-stroop supply floors to **0 shares** and **Blend itself rejects the request** (`Error(Contract,
#1216)`), before the wrapper's own `shares <= 0` guard is ever reached. The whole harvest reverts —
including the claim that already succeeded.

There is no lower-bound check and no "skip the reinvest if it's dust" path, so a vault whose harvest
cadence outruns its accrual is **stuck**: every `harvest` call reverts until enough yield piles up.
The test pins the exact boundary — 2 seconds of accrual on a 100 USDC position yields exactly
1 stroop, harvest reverts, the yield stays unclaimed, and a further 60 seconds unblocks it.

Two reasons this matters more than it looks:

* **Mainnet's `b_rate ≈ 1.124`**, so the dust floor is live from block one — this is not a
  far-future edge case.
* **It bites the paginated form hardest.** A `harvest(1)` batch that lands on a small position can
  claim 1 stroop and revert, even when sweeping the whole list would have claimed plenty. The form
  built for bounded cost is the more fragile one, and `harvest` is the permissionless upkeep that
  funds every coupon.

### Fix

In `vault::harvest`, guard the reinvest instead of letting Blend reject it:

```rust
// Reinvest only when the balance is large enough for Blend to credit shares.
// Below that floor, keep the USDC — the next harvest sweeps it (see item 7).
if claimed < MIN_REINVEST {
    storage::bump_instance(&env);
    events::harvested(&env, claimed, 0);
    return (claimed, 0);
}
```

`MIN_REINVEST` must exceed `ceil(b_rate / SCALAR_12)` stroops. A fixed floor of a few hundred
stroops is simple, robust against `b_rate` drift, and has the useful side effect of creating far
fewer tracked positions (see item 4's follow-on). This fix **only works correctly alongside item 7**
— otherwise the skipped USDC is stranded.

---

## 6. `harvest` under a wrapper pause reverts instead of deferring

*`testcando.md` §0 P0 `vault_harvest_reverts_while_wrapper_paused` — **confirmed***

**Tests** — `vault::test::vault_harvest_reverts_while_wrapper_is_paused`,
`vault::test::vault_harvest_with_zero_yield_succeeds_under_wrapper_pause`,
`vault::test::vault_redeem_works_while_wrapper_is_paused`

### The issue

`harvest` is documented "allowed while paused", and the **vault's own** pause gate does let it
through. But its reinvest step calls `wrapper::mint`, which the **wrapper's** pause blocks. So
pausing the wrapper — the natural first move in an emergency — silently disables the vault's
coupon-capacity upkeep entirely, with a `Paused` error that points at the wrong contract.

The tests isolate the mechanism precisely:

* wrapper paused + yield accrued → `harvest` reverts `Paused`; capacity untouched, revert is clean.
* wrapper paused + **zero** yield → `harvest` **succeeds** (the early return fires before the mint),
  proving it is specifically the reinvest leg.
* wrapper unpaused → `harvest` works again immediately.

The good half of the same coupling is also pinned: `vault_redeem_works_while_wrapper_is_paused`
confirms a wrapper pause does **not** trap vault depositors' funds. Keep that test — if it ever
regressed, an emergency pause would strand every receipt.

### Fix

Item 5's guard resolves this too, provided the floor check runs before the mint: with the wrapper
paused, the claim still succeeds, the USDC accumulates in the vault, and the next harvest after the
unpause reinvests it. That is the behavior `testcando.md` asks us to choose between — "harvest waits
out the pause" vs "harvest skips reinvest and holds USDC" — and holding the USDC is strictly better,
because the claimed yield is not lost to a revert.

Whichever way it is resolved, update `harvest`'s doc comment: "allowed while paused" is true of the
vault's pause and false of the wrapper's.

---

## 7. Harvested USDC that is not reinvested is stranded forever

*Not in `testcando.md` — **new finding, found while fixing items 5 and 6***

**Test** — none yet; add one alongside the fix (assert the vault's resting USDC balance is swept by
the next successful `harvest`).

### The issue

`vault::harvest` computes what to reinvest as a **delta**:

```rust
let before = token::Client::new(&env, &usdc).balance(&env.current_contract_address());
// ... claim across the batch ...
let after  = token::Client::new(&env, &usdc).balance(&env.current_contract_address());
let claimed = after - before;
```

`before` is read at the start of each call, so **any USDC already resting in the vault is excluded
from every future harvest**. It can never be reinvested and never becomes coupon capacity.

Today the resting balance is near zero, which is why this has not bitten. But it becomes a real leak
the moment items 5 or 6 are fixed, because both fixes deliberately leave USDC in the vault. It also
already strands the small rounding residue from `redeem` (which collects `got` and forwards
`min(got, payout)`).

### Fix

Reinvest the vault's **full** USDC balance rather than the delta:

```rust
let claimed_yield = after - before;          // for the event / return value
let reinvestable  = after;                   // everything the vault holds
```

This is safe because the vault's resting USDC is *only* un-reinvested yield: `deposit` and `seed`
pull USDC in and mint it within the same call, and `redeem` collects and forwards within the same
call. Keep reporting the newly-claimed figure in the `Harvested` event so the indexer's yield series
stays meaningful, but mint against the full balance.

---

## 8. The vault's solvency dust band grows without bound

*`testcando.md` §0 P0 `vault_dust_tolerance_does_not_grow_with_receipt_churn` — **confirmed***

**Tests** — `vault::test::vault_dust_band_grows_without_bound_under_receipt_churn`,
`vault::test::wrapper_band_stays_flat_where_the_vault_band_grows`

### The issue

`vault::assert_solvent` (`contracts/vault/src/lib.rs:628`) computes its tolerance as:

```rust
let dust = storage::peek_next_receipt_id(env) as i128 + 2;
```

`peek_next_receipt_id` is **monotonic** — it counts every receipt ever issued and never decreases.
So each deposit permanently widens the solvency tolerance by one stroop, even after that receipt is
redeemed and closed.

This is the exact pattern the **wrapper already fixed**. Its band is `open_positions + 4`, anchored
to live state, with a comment explaining that the old `next_position_id + withdraw_ops` form "could
be inflated by an attacker doing many tiny mint/withdraw cycles to widen the band". The vault kept
the old shape.

Measured: 25 deposit→redeem cycles, **every receipt closed and `total_liability == 0`**, and the
band had grown 2 → 27. Correct anchoring would have returned it to 2. The companion test runs
equivalent churn through the wrapper and confirms its band stays flat.

**Severity note, stated honestly:** widening the band by 1 USDC requires 10⁷ deposits, so this is
not practically exploitable at scale — `testcando.md`'s "gameable" framing is directionally right
but the practical bar is very high. It is listed P1 because the fix is trivial and the invariant
should be exact, not because a griefer is likely to grind it.

### Fix

Mirror the wrapper exactly:

1. Add an `OpenReceipts` counter to `vault::storage::DataKey`, with `inc_open_receipts` /
   `dec_open_receipts` (saturating).
2. Increment in `deposit` when a receipt is issued; decrement in `redeem` when one closes.
3. Change `assert_solvent` to `open_receipts(env) as i128 + 2`.
4. Invert `vault_dust_band_grows_without_bound_under_receipt_churn` to assert the band returns to 2.

The test already reads the live band via `env.as_contract(&vault, ...)`, so it will validate the new
anchoring with only the assertion changed.

---

## 9. `wrapper::mint` has no maturity gate

*`testcando.md` §0 P0 `mint_after_maturity_behavior` — **confirmed***

**Tests** — `wrapper::test::mint_after_maturity_is_currently_allowed`,
`wrapper::test::yt_minted_after_maturity_keeps_accruing_forever`

### The issue

The vault (`ensure_before_maturity`) and the market (`ensure_tradeable`) both refuse post-maturity
inflows. `wrapper::mint` does not. The result:

* a post-maturity mint succeeds and creates a normal open position;
* its PT is redeemable **in the same ledger** — a zero-duration round trip;
* `claim_yield` has no maturity cap either, so its YT keeps earning real Blend interest
  indefinitely. The test claims a full year of yield on a position minted *after* maturity.

Solvency is not violated (you get back what you put in), so this is a product-consistency gap rather
than a value leak — but it lets users open positions in a matured market that the rest of the
protocol has already closed.

### Fix

Add the gate to `mint`, alongside the existing `ensure_can_deposit`:

```rust
if env.ledger().timestamp() >= storage::get_maturity(&env) {
    panic_with_error!(&env, Error::NotMatured);  // or a new MarketMatured code
}
```

Safe to add: every internal caller is already maturity-gated upstream — the vault's `seed`,
`deposit` and `harvest` all call `ensure_before_maturity` first. Exits (`redeem_pt`,
`combine_and_redeem`, `claim_yield`) are unaffected.

Decide separately whether `claim_yield` should also cap at maturity. Leaving it uncapped is
defensible — YT holders genuinely own the yield their shares produce — but it should be a stated
choice, not an omission.

---

## 10. Market maturity is never cross-checked against the wrapper

*`testcando.md` §0 P1 `market_maturity_mismatch_with_wrapper` — **confirmed***

**Tests** — `market::test::market_init_does_not_cross_check_wrapper_maturity`,
`market::test::late_dated_market_sells_pt_below_par_after_it_redeems_at_par`,
`market::test::early_dated_market_strands_pt_holders_between_the_two_maturities`

### The issue

`market::initialize` takes `maturity` as a free parameter and never validates it against the wrapper
whose PT it trades. It is a deploy-script promise, not an on-chain invariant. The tests initialize
markets dated 30 days **after** and 30 days **before** the wrapper's maturity — both are accepted
without complaint.

Both directions fail, in opposite ways:

* **Late-dated** — past the wrapper's maturity the curve is still live, so the pool keeps quoting PT
  at a discount while every PT is already redeemable at par. Measured: **100 USDC bought 101.07 PT**,
  a 1.07-USDC-per-100 risk-free draw on the LPs, repeatable until the pool's USDC is gone.
* **Early-dated** — between the market's maturity and the wrapper's, holders have **no venue**
  (`MarketExpired`) and **no redemption** (`NotMatured`). The test confirms `combine_and_redeem`
  still works, so this is a liquidity failure rather than trapped funds — but a PT-only holder
  (item 1) has nothing at all.

### Fix (needs a decision — ABI change)

The one-line version is to read the wrapper like the vault does, which means `initialize` must take
the wrapper's address:

```rust
pub fn initialize(env: Env, wrapper: Address, pt: Address, usdc: Address, maturity: u64, ...) {
    if WrapperContractClient::new(&env, &wrapper).maturity() != maturity {
        panic_with_error!(&env, Error::MaturityMismatch);
    }
```

That changes the market's ABI and `scripts/deploy_mainnet.sh`. **This is the cheapest moment to do
it** — the contracts are deployed but unseeded, so a `FRESH=1` redeploy costs a few XLM; after TVL
it is a 24h-timelocked upgrade.

Cheaper alternative if the ABI must hold: derive `pt` from the wrapper and assert only that, leaving
maturity as a deploy-script invariant covered by the §16 live-verification script. Weaker, but zero
ABI churn.

---

## 11. Minimum viable mint is 2 stroops, not 1

*`testcando.md` §1 P1 `one_stroop_mint_at_elevated_entry_rate` — **confirmed, with a different
mechanism than predicted***

**Test** — `wrapper::test::one_stroop_mint_is_rejected_once_brate_exceeds_one`

### The issue

Once the pool has accrued (`b_rate > 1`), Blend floors the shares credited for a 1-stroop supply to
0 and **rejects the request inside the pool** — so the wrapper's own `shares <= 0` guard is never
reached, and the error surfaced is Blend's, not `SolvencyViolation` as `testcando.md` predicted.
2 stroops is the smallest deposit that succeeds.

The refusal is atomic — the test confirms no PT/YT is minted for the failed attempt and solvency
holds. This is correct behavior; the problem is that it is **undocumented**, and it is the root
cause of item 5.

Mainnet's `b_rate ≈ 1.124` makes this live from block one, which confirms `testcando.md` §12's
arithmetic ("a 1-stroop mint floors to 0 shares and trips the guard — minimum viable mint on mainnet
is 2 stroops").

### Fix

No contract change required. Instead:

1. Document the 2-stroop minimum on `wrapper::mint` and in the frontend's input validation, so users
   get a clear message rather than an opaque Blend error code.
2. Consider catching it earlier with an explicit `InvalidAmount` for amounts below
   `ceil(b_rate / SCALAR_12)`, so the revert reason names Spield's own constraint.

---

## 12. `claim_yield` on a closed position is a silent no-op

*`testcando.md` §0 P2 `claim_on_closed_position_is_noop` — **confirmed, harmless***

**Test** — `wrapper::test::claim_on_closed_position_is_a_noop`

### The issue

`do_claim` never checks `pos.open`. A closed position has `shares == 0`, so `math::yield_amount`
returns 0, nothing is paid, and the position merely re-settles to the current rate.

The test closes a position, lets the rate rise for a full year, then claims: payout is 0, no USDC
moves, `open` stays false, `shares` stays 0, and repeating it is equally inert.

### Fix

No change needed — the behavior is correct. The test exists so that a future refactor (for example,
one that measures yield on `yt_amount` instead of `shares`) cannot quietly turn this into a payout
on a closed position. Keep it.

Optionally add an explicit `if !pos.open { return 0; }` early return in `do_claim` to make the
intent legible rather than emergent.

---

## Appendix A — corrections to `testcando.md`

Two things in the source document should be amended before it is used to drive the §18 go/no-go
gate.

### A1. §0's `vault_redeem_budget_with_many_harvest_positions` points at the wrong function

The document flags `redeem_pt_for`'s unbounded walk as a P0 budget risk: "Months of daily harvests ⇒
hundreds of positions ⇒ a single `redeem` may exceed the tx budget."

**Measured, this is not borne out.** Tests
`vault::test::vault_redeem_cost_grows_with_the_number_of_tracked_positions` and
`vault::test::vault_redeem_with_a_long_harvest_history_fits_mainnet_limits`:

| positions | instructions / 600,000,000 | memory / 41,943,040 | write / 50 | entries / 100 |
|---:|---:|---:|---:|---:|
| 7 | 6,555,524 | 6,868,395 | 13 | 35 |
| 62 | 6,933,317 | 7,176,395 | 13 | 35 |
| **182** | **7,813,359** (1.3%) | 7,932,395 | 13 | 35 |

Marginal cost is **~6,868 instructions per tracked position** — roughly **86,000 positions** of
headroom, or 236 years of daily harvests. Write-entry and ledger-entry footprints are **flat**,
because the `Positions` list lives in a single instance entry.

The walk is cheap because positions past the payout target take a `Vec` push, not a cross-contract
call — only the positions actually needed to cover the payout incur `get_position` + `redeem_pt`.

The real breach is in **`harvest`** — the function that was *built* to be the bounded one. See
item 4. §0's P0 should be re-pointed accordingly, and §9's `harvest_at_max_batch_fits_budget`
promoted from P1 to P0.

### A2. §18's ordering is unsafe for items 1 and 2

§18 lists "Every P0 in §0 is resolved" **before** "§13 issuer lockdown". For the market-bought-PT
gap that order is backwards: the position gate is the only thing currently preventing counterfeit PT
from draining the wrapper, so removing it before the issuer is locked would convert a UX gap into a
drainable exploit. **Lock the issuer first.** See item 1's ordering box.

---

## Appendix B — what Phase 1 did not cover

Scope was `testcando.md` §0 plus §13's on-chain conservation law. Still open, by phase:

* **Phase 2** — §1 wrapper lifecycle edges, §2 strategy/rate-bound edges, §3 vault edges, §6
  systematic auth matrix.
* **Phase 3** — §4 AMM/curve edges, §8 pure-math properties, §9 remaining resource budgets, §12
  mainnet-parameter profile, §14 launch-seed calibration.
* **Phase 4** — §5 ecosystem stateful fuzz, §15 adversarial simulation, §7 event contracts, §10
  chaos drills, §11 mutation testing.

**Not reachable from the test suite** — §16 (live mainnet read-only verification) and §17 (testnet
operational drills) need network access and keys. They will be delivered as a written gap-report in
Phase 4 rather than as tests.

One §13 item is worth flagging now even though it is not Phase 1 scope, because it is a
prerequisite for item 1: **`scripts/deploy_mainnet.sh` never locks the classic PT/YT issuer.** It
hands SAC admin to the wrapper (lines ~210–222) but contains no `set-options`, no master-weight-0,
and no flag lockdown anywhere. Confirmed by reading the script.
