# Spield v2 — Contracts

Spield v2 is a **fixed-income / yield-stripping protocol on Stellar/Soroban**. Deposit USDC, it's
supplied to **Blend** (Stellar's main lending protocol) so the yield is **real, on-chain, and
actually accruing**, and you get **PT** (a fixed-rate, redeem-at-par bond) + **YT** (the yield leg).

The one fatal flaw the SCF #43 panel found in v1 — *an undercollateralized vault built on an
invented yield index* — is gone: **the index IS Blend's real `bRate`, so the vault is solvent by
construction.** Every accounting bug they flagged is fixed and proven with a regression test that
runs against **real Blend WASM**, not a mock.

See [`../../plan.md`](../../plan.md) for the full design rationale and the SCF mapping.

---

## Workspace layout

```
contracts/
  shared/     spield-shared    — types (Position), fixed-point math (SCALAR_12), the
                                 YieldStrategy trait, error codes. Pure lib. 10 unit tests.
  strategy/   spield-strategy  — the Blend yield-source ADAPTER. The only contract that knows
                                 Blend's submit/Request/Reserve shapes. Implements YieldStrategy.
  wrapper/    spield-wrapper   — the tokenization ENGINE: mint / claim_yield / redeem_pt /
                                 combine_and_redeem / transfer_position. Per-position accounting,
                                 PT+YT as SACs, solvency invariant.
```

The wrapper never hard-codes Blend — it talks to a `YieldStrategyClient`. Day 1 that's the Blend
adapter; a DeFindex or tokenized-RWA adapter drops in later with **no wrapper changes**.

## Versions (important)

| Thing | Version | Why |
| --- | --- | --- |
| `soroban-sdk` | **=25.3.1** | Must match `blend-contract-sdk`'s macros exactly; mixing SDK majors across the cross-contract boundary breaks types. |
| `blend-contract-sdk` | **=2.25.0** | Real Blend v2 clients, types, and **test WASMs** (`BlendFixture`). |
| `sep-40-oracle` | **=1.4.0** | SEP-40 mock oracle for tests (Blend prices collateral through it). |
| Stellar CLI | 26.x | Builds & deploys SDK-25 contracts fine (protocol-compatible). |

## How the yield works (the core fix)

Blend bTokens convert to underlying at a **`b_rate`** (12-decimal fixed point) that **rises as
borrower interest accrues** — like an ERC-4626 share price. The wrapper holds a Blend supply
position; "the index" is that real `b_rate`, read live via a cross-contract `get_reserve` call.
Because the escrowed bTokens genuinely grow, the wrapper can always pay every PT holder principal
*and* every YT holder yield. **The vault cannot be drained.**

Yield is measured on a position's **bToken shares** (`yield = shares × Δb_rate`), the exact
ERC-4626 growth — not on the YT face amount. This is what keeps it solvent for positions minted
after the pool has already accrued (`entry_rate > 1.0`).

### YT is a term instrument: it earns for the term and no longer

`claim_yield` has **no maturity gate** — yield streams continuously and is claimable at any moment
during the term, with no lockup, no fee, and without burning the YT. But the rate it is measured
against is **capped at the `b_rate` observed at maturity**, so a matured YT generates nothing and is
worth 0 — matching Pendle ("matured YT have 0 value as they no longer generate yield").

Both halves matter: new accrual stops at maturity, and yield earned *before* maturity stays
claimable indefinitely — capping the rate rather than refusing the call is what prevents maturity
from confiscating yield a holder had already earned.

Blend publishes no historical `b_rate`, so the maturity rate must be **observed on-chain**. The
first interaction at/after maturity pins it automatically (`redeem_pt` included, since that is what
maturity unlocks), and the permissionless **`stamp_maturity_rate()`** lets a keeper pin it exactly
at maturity. Until it is pinned the ceiling drifts upward slightly, over-paying a little
post-maturity growth — bounded, always funded by real Blend growth, never a solvency risk, and
`an_unstamped_ceiling_drifts_until_the_first_interaction` measures it. Post-maturity growth that no
YT can claim stays in the wrapper as surplus backing.

> Run `stamp_maturity_rate()` at maturity. It is cheap, permissionless, idempotent, and it is the
> difference between an exact cap and a drifting one.

### Selling part of a holding: `split_position` + `transfer_position`

The **position** is the authoritative claim, not the PT/YT token balance — `claim_yield` pays
`pos.owner` and never reads a SAC balance. So moving PT/YT with a raw token transfer moves the
tokens *without* moving the yield claim: the sender keeps earning on tokens they no longer hold.

`split_position(id, amount)` carves a right-sized position out so a partial sale is possible:

```
hold 50 PT + 50 YT as position P, want to sell half on day 15 of a 30-day term:
  split_position(P, 25)       -> Q   (25 PT + 25 YT, still yours; P keeps 25 + 25)
  transfer_position(Q, buyer) ->     buyer owns Q and holds its tokens
days 1-15 on all 50 -> you.   days 15-30 on Q's 25 -> buyer, on P's 25 -> you.
```

The split **settles first**, so it is a clean cut in time: the seller is paid everything earned up
to the split and the new position earns strictly from there. That is the job Pendle's
`_beforeTokenTransfer` interest-index hook does — PT/YT are Stellar Asset Contracts (protocol
built-ins with a fixed interface and no hooks), so the checkpoint happens in the split instead.
Measured in `split_then_transfer_sells_half_a_position_mid_term`: buyer and seller each earn an
identical 169,759 stroops over days 15–30, and the buyer's immediate post-purchase claim is exactly 0.

The slice is **proportional across the whole position** — a position's Blend shares back its
principal *and* generate its YT yield, so PT, YT and shares move together. There is no PT-only or
YT-only split; a buyer wanting pure yield exposure sells the PT leg on the AMM afterwards. The new
position takes the floored share of every field and the original keeps the remainder by subtraction,
so `old + new == original` exactly and splitting is economically neutral (measured: 1 stroop across
a full term vs an unsplit control).

## SCF bug fixes → regression tests

Every fix is a committed test in `contracts/wrapper/src/test.rs`, run against real Blend WASM:

| SCF # | Fix | Test |
| --- | --- | --- |
| #3 undercollateralized vault | yield = realized Blend growth; solvency invariant asserted every mutation | `scf3_ten_users_all_claim_vault_never_empties` |
| #4 entry index overwritten | a new `Position` per deposit; never overwritten | `scf4_topup_does_not_overwrite_entry_rate` |
| #5 phantom yield on transfer | position-bound: `settled_rate` travels with the position | `scf5_no_phantom_yield_for_new_owner` |
| #6 claim burns all YT | claim **settles**, never burns; multi-epoch claims | `scf6_claim_settles_never_burns_multi_epoch` |
| #7 unguarded initialize | one-shot `Initialized` guard + admin auth | `scf7_double_initialize_panics` |
| #9 missing TTL | `extend_ttl` after every persistent write | `scf9_position_survives_ttl_window` |

Plus `canonical_example_*` (the plan §7 worked example), `combine_and_redeem_*`, `paused_*`,
`redeem_pt_before_maturity_*`, and 10 pure math unit tests in `spield-shared`. **23 tests, all pass.**

## Build & test

All commands run through WSL (see [`../../howtoaccesswsl.md`](../../howtoaccesswsl.md)):

```bash
# fast pure-math unit tests
cargo test -p spield-shared

# Phase 0 — supply to real Blend, bRate rises, read gain back (real Blend WASM, ~3 min)
cargo test -p spield-strategy

# the §7.4 regression suite vs real Blend WASM (~4–8 min — each test drives a full Blend pool)
cargo test -p spield-wrapper

# build deployable WASMs (wasm32v1-none): strategy ~14 KB, wrapper ~19 KB
stellar contract build
```

> The Blend-backed tests are slow because each spins up a complete Blend pool (factory, backstop,
> oracle, reserves, a borrowing whale) from real WASM and fast-forwards a year of interest. That
> realism is the point — it's why the solvency claims are trustworthy.

## Deploy to testnet

See [`TESTNET.md`](TESTNET.md) and [`scripts/deploy_testnet.sh`](scripts/deploy_testnet.sh).

## Trust model (honest, per SCF #8)

- **Yield & solvency: trustless** — from Blend's on-chain `b_rate`; no privileged party can inflate it.
- **Admin (init, pause, rate/fee within ceilings, upgrade): trusted single key at launch →
  multisig-pathed.** Pause can only *block new inflows* — it can never move or trap user funds
  (exits stay open while paused; see below).
- **Blend dependency:** we inherit Blend's risk (its oracle, its backstop), documented as an
  explicit named dependency, not hidden.

## Governance (mainnet-readiness)

All four deployed contracts (`wrapper`, `strategy`, `vault`, `market`) share one governance surface,
implemented once in [`shared/src/governance.rs`](contracts/shared/src/governance.rs):

- **Admin rotation — two-step, no fat-finger.** `propose_admin(new)` then `accept_admin()` *by the new
  key* (it must prove control before gaining power). `cancel_admin_transfer()` aborts a pending one.
  View: `pending_admin()`, `admin()`. **Before mainnet, rotate every contract's admin to a multisig.**
- **Upgrades — timelocked.** `schedule_upgrade(wasm_hash)` records an `eta = now + timelock`;
  `apply_upgrade()` runs `update_current_contract_wasm` only at/after `eta`; `cancel_upgrade()` aborts.
  The delay (default **24 h**, admin-settable 1 h…30 d via `set_timelock`) gives users a window to exit
  before the code under their funds changes. Views: `pending_upgrade()`, `timelock()`.
- **Strategy rate-bound — time-aware + safety valve (`set_max_apr_bps`).** The `b_rate` sanity bound
  is an **annual** growth ceiling (`max_apr_bps`) **pro-rated by elapsed time** on each read, not a
  fixed per-read cap. This removes the soft-brick failure mode of a per-read bound (a long-untouched
  position taking one big legitimate jump and tripping the check) — read frequency no longer matters,
  so the only thing to calibrate is `max_apr_bps` against Blend's real max borrow APR (a known
  constant). If Blend's rate ever outpaces the cap anyway, the admin can widen it with no redeploy.
  Widening only *increases tolerance* on an already-trusted, monotonic rate — it can never mint value
  or move funds, and the wrapper still asserts `backing ≥ principal` against Blend's real position on
  every mutation. View: `rate_bound()` → `(last_rate, last_ts, max_apr_bps)`.

Governance is covered by tests in `shared/src/governance_test.rs` (the state machine + bounds), a real
code-swap end-to-end in `wrapper/src/test.rs` (schedule → too-early-fails → warp → apply → behavior
changed), the soft-brick valve in `strategy/src/test.rs`, and rotation/timelock wiring in the vault &
market suites.

## Operational safety (mainnet-readiness #5, #6, #8)

- **Pause blocks inflows, never traps funds (#8).** A pause halts only the *inflow* paths — wrapper
  `mint`, vault `seed`/`deposit`, market `add_liquidity` + swaps. Every *exit* stays open while paused:
  wrapper `claim_yield`/`redeem_pt`/`combine_and_redeem`/`transfer_position`, vault `redeem`, market
  `remove_liquidity`. So an emergency pause stops new money entering but existing users can always
  leave — the credibly-neutral behavior. The **strategy has no pause by design**: it has no
  user-facing inflow (deposits only arrive via the wrapper, whose `mint` pause already gates them) and
  its other paths are pure exits that must stay open. Proven by `paused_still_allows_*` tests.
- **Maturity-aware TTL — bonds can't archive before they mature (#5).** Per-position and per-receipt
  persistent entries are bumped to **`maturity + 30d grace`** (clamped to the network max-TTL), not a
  flat ~60-day window that could lapse mid-bond. A held-to-maturity position that's never written
  would otherwise archive; now it survives. For bonds longer than the network max-TTL, a
  **permissionless** `bump_position(id)` / `bump_receipt(id)` lets anyone top the entry up — keeping
  long-dated positions alive across the whole term. Logic in `shared/src/ttl.rs`.
- **Paginated vault harvest — no unbounded loop (#6).** The vault tracks a growing list of wrapper
  positions; `harvest(max_positions)` sweeps it a **bounded chunk at a time** via a stored round-robin
  cursor (clamped to `MAX_HARVEST_BATCH = 3`), so a single call can never exceed the tx resource
  budget no matter how many positions accumulate. Repeated calls cover the whole list. Proven by
  `harvest_pagination_sweeps_all_positions`.
  The batch ceiling is **measured, not assumed**: each item is a real Blend `submit` costing ~8 MB
  of modelled memory against mainnet's 40 MiB per-transaction limit. 4 is the largest batch that
  fits, but only at ~93% of the memory ceiling; we ship **3** (~74%) on purpose, because `harvest`
  is permissionless upkeep that must never become un-runnable and the per-item cost is set by
  Blend, not by us. `harvest_batch_size_that_fits_mainnet_limits` pins the constant from both
  sides — that a full batch keeps ≥20% memory headroom, and that the next size up would not — so
  the margin can neither silently erode nor be silently over-paid.
- **Harvest never bricks (#6, cont).** Two cases used to revert the whole call and discard the yield
  it had already claimed: a reinvest below Blend's one-share floor, and a **wrapper** pause blocking
  the reinvest `mint`. Both now skip the reinvest and hold the USDC; because harvest reinvests the
  vault's *full* balance rather than the newly-claimed delta, held USDC is swept by the next
  successful call instead of being stranded.

## AMM curve hardening (the highest-risk math)

The Pendle/Notional log curve (`exchangeRate = anchor − ln(p/(1−p))/rateScalar`) and its fixed-point
swap solver are the riskiest components, so they get the deepest validation:

- **Views never panic (graceful degradation).** Every read-only analytics endpoint —
  `pt_price`, `implied_apy`, `quote_pt_for_usdc`, `quote_usdc_for_pt` — returns a **safe `0`** for any
  state where a price is undefined: an empty pool, a pool too thin/imbalanced for the curve
  (proportion outside the 0.5%…99.5% band), an output exceeding reserves, or at/after maturity. They
  can no longer revert, divide by zero, or return garbage — frontends/integrations treat `0` as "no
  price / amount exceeds liquidity". Implemented via non-panicking `try_*` curve cores
  (`try_proportion` / `try_exchange_rate` / `try_pt_price` / `try_params` / `try_swap_*` /
  `try_implied_apy`); the panicking wrappers remain for the swap path, where a revert is correct.
  Proven by `views_safe_on_empty_pool`, `views_safe_on_imbalanced_pool`, `views_safe_after_maturity`,
  `quote_returns_zero_when_amount_exceeds_liquidity`.
- **Property / fuzz suite** (`market/src/curve_test.rs`, ~15 tests, thousands of cases, no Blend so
  it's fast): no-panic across all pool states; price strictly positive and `== anchor` at proportion
  0.5; **monotonic** (more PT ⇒ cheaper PT); PT-heavy below par / USDC-heavy above par; steeper scalar
  pulls price toward par (the convergence property); swap output **bounded by reserves**; solver
  **self-consistency** (3-pass converges to <~8 base-unit dust); **round-trip unprofitability** (no
  risk-free extraction); larger trades get worse unit prices (slippage); and **overflow-safety at
  mainnet scale** (1e15 base-unit reserves, via the i256-backed math layer).
- **LPs can never be trapped.** `remove_liquidity` is gated only by `ensure_initialized` (no maturity
  halt, no pause gate), so an LP exits in full under **every** combination of matured + paused.
  Conservation holds: summed LP withdrawals equal the reserves (down to flooring dust) and all shares
  burn. Proven by `lp_exit_works_even_when_matured_and_paused`, `full_lp_exit_conserves_reserves`.

## Production-readiness & security hardening

- **Verifiable versioning.** Alongside the human `version()` string, every contract exposes
  `code_hash() -> BytesN<32>` — the **live deployed WASM hash** read from the host
  (`Address::executable()`), so anyone can confirm on-chain exactly which build is running and that an
  `apply_upgrade` actually swapped the code.
- **Atomic deploy (no init front-run).** Each contract has a `__constructor(admin)` that binds the
  admin the instant the contract is created. The remaining `initialize(...)` is gated to that admin,
  so even though setup is a second call, a front-runner can never hijack a freshly-deployed contract.
- **Decimals asserted, not assumed.** Init reads the underlying token's `decimals()` and rejects
  anything other than 7 (`UnexpectedDecimals`) — the fixed-point math is calibrated to 7-dec USDC.
- **Bounded, ungameable solvency tolerance.** The dust band is now `open_positions + 4` (a small
  constant), not the old monotonic `next_position_id + withdraw_ops`. It tracks only the rounding dust
  that can exist in *live* positions, so it can't be inflated by an attacker churning tiny
  mint/withdraw cycles. Proven by `dust_tolerance_does_not_grow_with_churn`.
- **Checks-effects-interactions.** Soroban forbids reentrancy by default; on top of that every mutating
  path loads the position once, computes effects in memory, and persists exactly once after the
  external Blend/SAC calls, with `assert_solvent` re-checking against Blend's real position last. The
  counterparty tokens (USDC SAC, Blend pool) are fixed trusted addresses. Documented in the wrapper
  module doc.
- **Complete events.** Every economic state change emits a `#[contractevent]` (mint/claim/redeem/
  combine/transfer, deposit/redeem/harvest/seed, add/remove/swap, fee/rate/pause, all governance ops),
  plus an `Initialized` event per contract — enough for a dashboard/indexer to reconstruct full state.
- **Off-chain solvency monitor.** `scripts/solvency_monitor.mjs` polls the wrapper's `solvency()` and
  pages (exit 2 / optional webhook) if backing ever falls below principal — an out-of-band watchtower
  independent of the on-chain `assert_solvent`.
- **Blend dependency, stated.** Spield inherits Blend's availability: if the Blend pool freezes
  withdrawals, payouts wait on it. The solvency view stays readable through a frozen pool (proven by
  `solvency_view_survives_blend_pool_frozen`); it does not paper over Blend being down.
- **Mainnet-scale fuzz.** The share/yield/coupon math is fuzzed at up to ~1e17 base units across wide
  rate ranges (`*_no_overflow_at_mainnet_scale_fuzz`) — the i256 intermediates never overflow i128.
