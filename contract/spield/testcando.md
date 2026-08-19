# testcando.md — candidate tests to broaden coverage

A catalog of tests we *could* add, derived from a full read of `shared`, `strategy`, `wrapper`,
`vault`, and `market` (code + all 6 existing test suites). Existing coverage is good on the happy
paths, the SCF regressions, curve properties, governance state-machine, pause semantics, and TTL —
so everything below is **new** ground: boundary values, cross-contract coupling, adversarial
sequences, auth matrices, resource budgets, and stateful fuzzing.

Legend — **P0** = likely exposes a real bug/design gap today; **P1** = hardens an invariant that is
currently asserted but not attacked; **P2** = documentation-of-behavior / belt-and-braces.
**[fast]** = pure, no Blend WASM; **[blend]** = drives a real Blend pool (slow);
**[live-read]** = read-only invoke against mainnet RPC; **[testnet]** = rehearsal on testnet.

**Sections 0–11 = correctness/coverage. Sections 12–19 = mainnet-launch readiness** (added for the
upcoming launch: real deploy parameters, the issuer exploit surface, economic calibration,
adversarial simulation, and go-live drills). If you read one thing, read §0 and §13.

---

## 0. Mechanism-level gaps found while reading (write these first)

These came out of the code read itself. Some of these tests would **fail or surface undefined
behavior today** — that's the point.

- [ ] **P0 [blend] `market_bought_pt_is_redeemable_by_buyer`** — A trader buys PT on the AMM and
  holds it to maturity. Loose PT is a SAC balance, but `wrapper::redeem_pt` is **position-gated**
  (burns from `pos.owner` against a `position_id`). The buyer has no position; the seller's
  position still records `pt_amount` but their SAC balance is gone, so *their* `redeem_pt` burn
  fails too. Today the only exit for market-bought PT is selling it back or receiving a
  `transfer_position`. The existing `full_lifecycle` test explicitly stops at "trader holds
  redeemable PT" without redeeming. Write the test that actually tries to redeem — it documents
  (or forces a fix for) the core "Earn Fixed via AMM" flow.
- [ ] **P0 [blend] `seller_with_sold_pt_cannot_redeem_or_transfer`** — the mirror image: a user
  mints, sells their PT SAC on the market, keeps the position + YT. Then: `redeem_pt` must fail
  (SAC burn shortfall), `transfer_position` must fail (SAC transfer shortfall), but `claim_yield`
  must keep working (it touches neither SAC). Verifies partial-divergence between position
  accounting and SAC balances degrades gracefully instead of corrupting state.
- [ ] **P0 [blend] `vault_harvest_reverts_while_wrapper_paused`** — vault `harvest` is documented
  "allowed while paused", but its reinvest step calls `wrapper::mint`, which the **wrapper's**
  pause blocks. So: accrue yield, pause the *wrapper*, call `vault.harvest` → the claim succeeds
  but the reinvest mint panics `Paused`, reverting the whole harvest. Cross-contract pause
  coupling that no current test exercises. Decide: acceptable (harvest waits out the pause) or
  should harvest skip reinvest and hold USDC? Either way, pin the behavior.
- [x] **P0 [blend] `vault_redeem_budget_with_many_harvest_positions`** — ~~`redeem_pt_for` walks
  the entire tracked-positions list … a single `redeem` may exceed the tx budget~~ **MEASURED — the
  premise was wrong, and the real breach was one function the other way.** `redeem` at 160 tracked
  positions costs 8,152,324 instructions — **1.4%** of the 600M budget — and its write-entry and
  ledger-entry footprints are *flat*, because the `Positions` Vec lives in a single instance entry.
  The walk is cheap because positions past the payout target take a `Vec` push, not a cross-contract
  call: only the positions actually needed to cover the payout incur `get_position` + `redeem_pt`.
  Pinned by `vault::test::vault_redeem_cost_grows_with_the_number_of_tracked_positions` and
  `vault::test::vault_redeem_with_a_long_harvest_history_fits_mainnet_limits`.
  **The budget P0 belongs to `harvest`** — the function that was *built* to be the bounded one —
  because each batch item is a full Blend `submit` costing ~8 MB of modelled memory against a
  41,943,040-byte ceiling. Memory, not instructions, is binding: the old `MAX_HARVEST_BATCH = 50`
  blew memory by 9.2× while sitting at ~52% of the instruction budget. See §9's
  `harvest_at_max_batch_fits_budget`, promoted to P0 accordingly.
- [ ] **P0 [fast] `vault_dust_tolerance_does_not_grow_with_receipt_churn`** — the vault's
  `assert_solvent` dust band is `peek_next_receipt_id + 2`, which is **monotonic** — the exact
  gameable pattern the wrapper just fixed (its band is now `open_positions + 4`). Churn many tiny
  deposit/redeem cycles and show the tolerance widening without bound; then port the wrapper's
  open-receipts-anchored fix.
- [ ] **P0 [blend] `mint_after_maturity_behavior`** — `wrapper::mint` has **no maturity gate**. A
  post-maturity mint creates a position whose PT is instantly redeemable and whose YT accrues
  forever (no maturity cap on `claim_yield` either). Probably harmless economically (you get back
  what you put in) but it interacts oddly with the vault/market which both refuse post-maturity
  inflows. Pin the intended behavior — likely: add the gate, and this test proves it.
- [ ] **P0 [blend] `brate_decrease_bricks_everything_including_exits`** — `check_rate_bound_timed`
  rejects `current < last`. If Blend ever socializes bad debt and `b_rate` dips, **every**
  `current_rate` read panics: mint, claim, redeem, combine, `position_value`, `solvency` — inflows
  *and exits*. `set_max_apr_bps` cannot unstick a decrease; there is no valve for it. Simulate by
  swapping the strategy's stored `last_rate` upward (or a mock strategy) and assert the blast
  radius; then decide if a governance `reset_rate_floor` valve is needed.
- [ ] **P1 [blend] `market_maturity_mismatch_with_wrapper`** — `market::initialize` takes
  `maturity` as a free parameter (deploy-script promise, not checked against the wrapper). Deploy
  a market with maturity ≠ wrapper maturity: PT keeps trading after it's already redeemable at par
  (risk-free arb vs LPs), or halts while PT is still a live bond. Document the failure mode; the
  fix is a one-line cross-check at init (read `wrapper.maturity()` like the vault does).
- [ ] **P2 [blend] `claim_on_closed_position_is_noop`** — `do_claim` never checks `pos.open`; a
  closed position has `shares == 0` so it pays 0 and re-settles. Harmless, but pin it so a future
  refactor doesn't turn it into a payout.

---

## 1. Wrapper — position lifecycle edges

- [ ] **P1 [blend] `partial_redeem_leaves_yt_only_position_still_earning`** — after maturity,
  redeem all PT but keep YT: position stays open (`yt_amount > 0`), later `claim_yield` still pays
  on remaining shares, `combine_and_redeem` then fails (no PT). Exercises the pt=0/yt>0 quadrant
  no test touches.
- [ ] **P1 [blend] `repeated_partial_combines_close_position_exactly_once`** — combine in 3–4
  partial chunks; assert `open_positions` decrements exactly once at the final chunk, and total
  USDC returned equals principal + all yield (± dust).
- [ ] **P1 [blend] `redeem_pt_at_exact_maturity_timestamp`** — `timestamp == maturity` must
  succeed (`<` gate); `maturity - 1` must panic `NotMatured`. Off-by-one boundary on both sides.
- [ ] **P1 [blend] `claim_twice_same_ledger_second_pays_zero`** — two claims at the same
  timestamp: first pays, second returns 0 and doesn't call Blend withdraw (no `withdraw_ops`
  bump). Also covers `settled_rate == current_rate` short-circuit.
- [ ] **P1 [blend] `redeem_more_than_pt_amount_panics`** and
  **`combine_more_than_yt_amount_panics`** — `InsufficientBalance` on both bounds (only maturity
  and amount≤0 are currently tested).
- [ ] **P1 [blend] `one_stroop_mint_at_elevated_entry_rate`** — after the pool accrues
  (`b_rate > 1`), mint `amount = 1`: Blend floors shares to 0 ⇒ the `shares <= 0` guard must
  refuse (currently panics `SolvencyViolation` — arguably the wrong error code; consider
  `InvalidAmount`). Dust-griefing entry check.
- [ ] **P2 [blend] `transfer_position_to_self`** — no-op that must not double-move SACs or corrupt
  the position.
- [ ] **P2 [blend] `transfer_closed_position`** — pt=yt=0: no SAC transfers happen, ownership
  reassigns. Pin as harmless.
- [ ] **P1 [blend] `transfer_after_partial_redeem_moves_exact_remainder`** — redeem half the PT,
  transfer: only the *remaining* pt/yt SAC amounts move, and the recipient can complete the
  lifecycle (claim → mature → redeem).
- [ ] **P1 [blend] `mint_immediately_combine_same_ledger_roundtrip`** — zero-rate-change round
  trip returns exactly `amount` (yield 0), solvency holds, position closes. The tightest
  rounding-neutrality check.
- [ ] **P1 [blend] `flat_rate_whole_term`** — no borrower ever: every claim pays 0 across the full
  year, all PT redeems at par at maturity. The "yield source produced nothing" world.
- [ ] **P1 [blend] `borrower_repays_early_rate_plateaus`** — whale repays at month 2; claims after
  that pay ~0 but principal remains fully redeemable. Rate-plateau world.
- [ ] **P2 [blend] `get_position_unknown_id_panics`** / `position_value_unknown_id_panics` —
  `PositionNotFound` on views.
- [ ] **P1 [blend] `initialize_rejects_wrong_decimal_underlying`** — the wrapper's
  `UnexpectedDecimals` path (only the market's is tested today).
- [ ] **P1 [blend] `upgrade_preserves_open_positions_and_balances`** — extend the existing
  code-swap test: open 3 positions with accrued yield *before* the upgrade, assert every field of
  every position, `total_principal`, and PT/YT balances are byte-identical after `apply_upgrade`,
  then claim + redeem through the new code.

## 2. Strategy — adapter & rate-bound edges

- [ ] **P0 [blend] `non_wrapper_cannot_deposit_or_redeem`** — call `deposit`/`redeem`/
  `redeem_underlying` from a random address (and from a second, unauthorized contract):
  `NotAuthorized` / auth failure. The strategy's only real security boundary has no negative
  test.
- [ ] **P1 [blend] `strategy_double_initialize_panics`** — `AlreadyInitialized` (wrapper + vault +
  market have this test; strategy doesn't).
- [ ] **P1 [blend] `redeem_underlying_more_than_position_holds`** — ask for more than the whole
  Blend position: expect Blend revert or `WithdrawShortfall`, never a silent partial that breaks
  wrapper bookkeeping.
- [ ] **P0 [blend] `withdraw_at_high_utilization_shortfall_path`** — the whale borrows ~all
  liquidity, then a user exits: Blend can't pay full ⇒ `got + 1 < amount` must trip
  `WithdrawShortfall`, and the whole tx (including SAC burns) reverts atomically — no state where
  PT burned but USDC not paid. This is the "Blend is illiquid" day-one operational risk.
- [ ] **P1 [fast] `rate_bound_no_overflow_with_extreme_params`** — fuzz `check_rate_bound_timed`
  at `max_apr_bps = u32::MAX`, `last_rate ~ 1e18`, `elapsed ~ u64::MAX` — the i256 path must
  error/pass cleanly, never wrap.
- [ ] **P1 [blend] `same_ledger_rate_jump_beyond_dust_trips`** — two reads in one timestamp where
  the second fabricates a jump > `RATE_BOUND_DUST` (mock strategy or direct math test): elapsed=0
  allows only dust.
- [ ] **P2 [blend] `set_max_apr_bps_to_zero_then_widen`** — cap=0 freezes on the next real accrual
  (only dust allowed), widening unfreezes; complements the existing tiny-cap test with the
  degenerate bound.

## 3. Vault — fixed-rate product edges

- [ ] **P0 [blend] `deposit_exactly_consumes_capacity_next_refused`** — size a deposit so
  `pt_inventory == total_liability` lands exactly; the next 1-stroop deposit must be
  `InsufficientCapacity`. Exact-boundary of the flagship guarantee.
- [ ] **P1 [blend] `deposit_one_second_before_maturity_zero_coupon`** — term=1s floors the coupon
  to 0: receipt issued with `payout == principal`. Pin that a zero-coupon receipt is legal (or
  gate it).
- [ ] **P1 [blend] `redeem_at_exact_maturity_timestamp`** — boundary on `<` vs `>=` (redeem at
  `maturity` succeeds, `maturity - 1` panics `VaultNotMatured`).
- [ ] **P1 [blend] `double_redeem_panics_receipt_closed`** — `ReceiptClosed` has no test.
- [ ] **P1 [blend] `redeem_walks_multiple_positions`** — build inventory across ≥3 positions
  (seed + harvests), then redeem a receipt larger than any single position's PT: `redeem_pt_for`
  must stitch the payout across positions and prune emptied ones. Then a *second* receipt redeems
  from what's left (checks the rebuilt `still_open` list and cursor sanity).
- [ ] **P1 [blend] `harvest_cursor_survives_position_pruning`** — harvest to mid-list cursor, then
  a redeem prunes positions (list shrinks below the cursor), then harvest again: the `% n` wrap
  must not skip or double-claim.
- [ ] **P1 [blend] `unharvested_yield_at_maturity_is_stranded_but_solvent`** — accrue yield, never
  harvest, cross maturity: `harvest` now panics `VaultExpired`, yet every receipt still redeems in
  full. Documents that post-maturity YT yield is unrecoverable by the vault (a real economic
  leak — maybe worth a post-maturity sweep function).
- [ ] **P1 [blend] `seed_after_maturity_panics`** — `VaultExpired` on the seed path.
- [ ] **P1 [blend] `each_receipt_locks_its_own_rate`** — deposit at 5%, admin sets 3%, deposit
  again: first receipt still pays 5%, second pays 3%. (Rate-change front-run between `quote` and
  `deposit` is inherent — document it here too.)
- [ ] **P2 [blend] `set_rate_zero_deposits_still_work`** — payout == principal, capacity barely
  consumed.
- [ ] **P1 [blend] `vault_redeem_works_while_wrapper_paused`** — the good half of the coupling in
  §0: `wrapper::redeem_pt` is exit-side, so the vault's user exit must survive a wrapper pause.
- [ ] **P2 [fast] `deposit_near_i128_max_overflows_cleanly`** — `payout` / `new_liability`
  `checked_add` paths return `MathOverflow`, not wrap.
- [ ] **P1 [blend] `stats_coupon_capacity_matches_invariant_after_every_op`** — sweep
  seed→deposit→harvest→redeem asserting `stats()` self-consistency (`coupon_capacity ==
  pt_inventory - total_liability`) after each mutation.

## 4. Market / AMM — pool & swap edges

- [ ] **P1 [blend] `full_drain_then_reseed_takes_first_lp_path`** — last LP removes everything
  (reserves 0, shares 0), then a new LP seeds at a *different* ratio: the `total == 0` branch must
  re-run and re-price the pool cleanly.
- [ ] **P1 [blend] `swap_pushing_proportion_out_of_band_reverts`** — a buy that would leave
  `pt_reserve/(pt+usdc)` outside 0.5%…99.5% must revert `InsufficientLiquidity` at the *swap*
  level (curve-level is fuzzed; the contract path isn't).
- [ ] **P1 [blend] `fee_100_percent_edge`** — init with `max_fee_bps = 10_000`, set fee 10 000:
  `try_apply_fee` keeps 0 ⇒ swaps revert `InvalidAmount`; quotes return 0. Also
  `fee_bps > 10_000` at init (nothing forbids `max_fee_bps = 20_000`!) — keep-rate clamps at 0;
  decide whether init should reject `max_fee_bps > 10_000`.
- [ ] **P1 [blend] `one_stroop_swap_rounds_to_zero_gracefully`** — 1-stroop input with a fee:
  after-fee floors to 0 ⇒ `InvalidAmount`, quote gives 0, never a free trade.
- [ ] **P1 [blend] `min_out_exact_boundary`** — `out == min_out` passes; `min_out = out + 1`
  panics `SlippageExceeded`. Off-by-one on the user's only price protection.
- [ ] **P1 [blend] `quote_matches_swap_for_usdc_to_pt_direction`** — quote/exec equality is only
  tested PT→USDC; cover the other direction.
- [ ] **P1 [blend] `trade_seconds_before_maturity`** — 60s left: `rate_scalar` is enormous, price
  ≈ anchor; swap must still converge and settle (stress the `years_to_mat → 0` end of `params`).
- [ ] **P1 [blend] `paused_blocks_add_liquidity`** — pause coverage exists for swaps only.
- [ ] **P1 [blend] `second_lp_within_tolerance_but_off_ratio_mints_lo`** — deposit 0.05% off
  ratio: accepted, shares = `min(by_pt, by_usdc)`, the excess silently benefits the pool.
  Quantify LP rounding-favoring so it can't regress into a leak.
- [ ] **P1 [fast] `isqrt_property_fuzz`** — `isqrt(n)² ≤ n < (isqrt(n)+1)²` over random i128 and
  the powers-of-two seams; also `add_liquidity` first-LP at mainnet scale where `pt*usdc`
  approaches i256→i128 conversion limits (expect clean `MathOverflow`).
- [ ] **P1 [fast] `zero_fee_roundtrip_still_unprofitable`** — the round-trip fuzz with
  `fee_bps = 0` isolates curve-asymmetry as the only protection.
- [ ] **P1 [fast] `swap_path_dependence_bound`** — swapping A then B vs a single A+B swap: bound
  the difference (fee-on-input makes splits slightly *worse*, never better — assert direction).
- [ ] **P1 [fast] `solver_3_pass_vs_10_pass_divergence_fuzz`** — strengthen self-consistency:
  across random pools/sizes/times, extra Newton passes change the output by < a few stroops
  (proves 3 iterations is genuinely converged, not just self-consistent at one point).
- [ ] **P2 [fast] `amm_math_range_reduction_seams`** — `ln` at mantissa ≈ 2.0∓1ULP and `exp` at
  `x ≈ k·ln2 ± ln2/2 ∓ 1ULP` — the branch boundaries of both range reductions, vs f64 reference.

## 5. Cross-contract & whole-protocol scenarios

- [ ] **P0 [blend] `ecosystem_stateful_fuzz`** — the big one: wrapper + strategy + vault + market,
  5–10 actors, a scripted PRNG driving hundreds of random ops (mint/claim/redeem/combine/transfer/
  seed/deposit/vault-redeem/harvest/add/remove/swap/pause/unpause/rate-set/time-warp/whale
  borrow-repay). After **every** op assert the global invariants: wrapper backing ≥ principal
  (±band), vault PT ≥ liability (±band), market reserves ≥ 0 and Σ LP claims == reserves,
  PT SAC total supply == Σ position pt_amounts + market/vault inventory. At the end, everyone
  exits and final USDC across actors ≈ initial + real Blend interest. One test, most of the bug
  surface.
- [ ] **P1 [blend] `pt_discount_arb_equals_implied_apy`** — buy PT at a discount on the market,
  hold to maturity, redeem at par (via `transfer_position` from an LP, given §0's gap): realized
  return ≈ `implied_apy()` quoted at purchase (± fee + dust). Proves the headline number is
  honest.
- [ ] **P1 [blend] `yt_holder_full_lifecycle`** — mint, sell the PT leg (market), keep YT: claim
  across 4–5 epochs; after maturity YT claims keep paying 0-or-residual as rate flattens; combine
  impossible. The "Earn Variable" persona end-to-end.
- [ ] **P1 [blend] `all_four_contracts_admin_rotated_old_admin_powerless`** — rotate every
  contract to a new admin in one scenario; the old key's `pause`/`set_rate`/`set_fee`/
  `schedule_upgrade` all fail; the new key's all work. Ops runbook rehearsal for the multisig
  cutover.
- [ ] **P1 [blend] `strategy_upgrade_preserves_wrapper_backing`** — timelocked strategy code-swap
  while the wrapper holds live shares; positions/claims unchanged across it.
- [ ] **P2 [blend] `second_wrapper_cannot_use_strategy`** — deploy a rogue second wrapper pointing
  at the same strategy: every call refused (single-wrapper binding).
- [ ] **P2 [blend] `vault_unaffected_by_market_price_swings`** — huge swaps move PT price ±20%;
  vault receipts, capacity, and redemption are numerically untouched (fixed leg is fixed).

## 6. Auth matrix (systematic negative tests)

Existing suites run `mock_all_auths()` almost everywhere, so *unauthorized-caller* coverage is
thin. One parametrized test per contract that, **without** auth mocking for the caller, hits every
mutating entry point and asserts auth failure:

- [ ] **P0 [blend] wrapper**: `mint`(other user), `claim_yield`/`redeem_pt`/`combine_and_redeem`/
  `transfer_position`(non-owner), `pause`/`unpause`/`initialize`/`propose_admin`/`set_timelock`/
  `schedule_upgrade`/`apply_upgrade`/`cancel_*`(non-admin), `accept_admin`(not the pending one).
- [ ] **P0 [blend] vault**: `deposit`(other user), `redeem`(non-owner), `set_rate`/`pause`/
  `initialize`(non-admin). (`seed`/`harvest`/`bump_*` are intentionally permissionless — assert
  they *succeed* from a rando, pinning that choice.)
- [ ] **P0 [blend] market**: `add_liquidity`/`remove_liquidity`/swaps (wrong `lp`/`trader`),
  `set_fee`/`pause`/`initialize`(non-admin).
- [ ] **P0 [blend] strategy**: covered in §2 first item + governance calls (non-admin).

## 7. Event-contract tests (indexer correctness)

- [ ] **P1 [blend] `every_economic_op_emits_exact_event`** — one sweep per contract using
  `env.events()`: assert topic + payload of `Minted/Claimed/RedeemedPT/Combined/Transferred`,
  `Seeded/Deposited/Redeemed/Harvested/RateSet`, `Added/Removed/Swapped/FeeSet`, `Paused`,
  `Initialized`, and all 7 governance events carry the values the dashboard will reconstruct
  state from. Today events are emitted but (governance aside) never asserted — a renamed field
  would silently break the indexer.
- [ ] **P2 [blend] `zero_yield_claim_emits_zero_paid_event`** — edge payloads (paid=0) are still
  emitted with correct amounts.

## 8. Pure-math property additions (fast, thousands of cases)

- [ ] **P1 [fast] `claim_splitting_neutrality_fuzz`** — the economically load-bearing property no
  test states: over random rate paths, claiming at N random intermediate points pays (within
  N stroops of flooring) the same total as one final claim. Pins "no advantage/penalty to claim
  frequency" — i.e. yield accounting is path-independent.
- [ ] **P1 [fast] `shares_underlying_roundtrip_loss_bound_fuzz`** — `underlying_to_shares` →
  `shares_to_underlying` loses ≤ 1 stroop across random amounts/rates (currently only rate=1.0 is
  round-tripped).
- [ ] **P1 [fast] `coupon_amount_properties_fuzz`** — monotone in each argument; additive in
  principal (`c(a)+c(b) ≤ c(a+b) ≤ c(a)+c(b)+1`); `term = SECONDS_PER_YEAR` ⇒ exactly
  `principal·bps/10⁴` floored; u32/u64 extremes don't overflow.
- [ ] **P1 [fast] `mul_div_floor_adversarial_inputs`** — `denom = 1` at i128-scale products
  (i256→i128 conversion boundary), `a·b` straddling `i128::MAX` by ±1, zero cases.
- [ ] **P2 [fast] `ttl_bump_fuzz`** — random `now/maturity/max_live_until`: result never exceeds
  `max_extend`, never below `MIN_BUMP_LEDGERS` unless clamped by network max; maturity in the past
  still yields the grace floor.

## 9. Resource-budget tests (Soroban limits)

- [x] **P0 [blend] `vault_redeem_budget…`** — see §0: measured, and the premise did not hold.
  `redeem`'s walk is cheap; the budget risk was in `harvest`, immediately below.
- [x] **P0 [blend] `harvest_at_max_batch_fits_budget`** *(promoted from P1 — this, not `redeem`,
  is where the budget actually broke)* — **done as
  `vault::test::harvest_batch_size_that_fits_mainnet_limits`.** `MAX_HARVEST_BATCH` lowered 50 → 3.
  Measure a deliberate **worst case** (equal, well-funded, all-accrued positions, so every item
  performs a real Blend withdraw plus the reinvest `submit`) — a mixed batch under-reports, because
  a position with no accrued yield skips the withdraw and a claim below `MIN_REINVEST` skips the
  reinvest. Memory is the binding ceiling, not instructions:

  | batch | memory / 41,943,040 | headroom |
  |---:|---:|---:|
  | 1 | 14,856,424 | 64% |
  | 2 | 22,821,125 | 45% |
  | **3** *(shipped)* | **30,789,740** | **26%** |
  | 4 | 38,851,613 | 7% |
  | 5 | ~46,836,638 ❌ | — |

  4 is the largest value that *fits*; 3 ships instead, on a stated ≥20% headroom policy, because
  `harvest` is permissionless upkeep that must never become un-runnable and the per-item cost is set
  by Blend. The test pins the constant from **both** sides — a full batch keeps ≥20% memory
  headroom, and the next size up would not — so the margin can neither erode silently nor be
  over-paid silently.
- [ ] **P1 [blend] `worst_case_single_ops_fit_budget`** — meter `combine_and_redeem` (2 Blend
  withdraws + 2 burns + solvency), `deposit`(vault, capacity check), and a max-size swap; record
  the numbers so regressions show up in review.

## 10. Chaos / dependency-failure drills

- [ ] **P1 [blend] `blend_pool_frozen_matrix`** — pool frozen (status flip): every wrapper/vault
  *exit* fails loudly-but-cleanly (funds wait, no state corruption), views stay readable
  (solvency-view half exists), and after unfreezing every exit completes. The full "Blend is
  down" runbook as a test.
- [ ] **P1 [blend] `oracle_price_collapse_during_term`** — crash the mock oracle price of the
  collateral mid-term: b_rate keeps accruing? liquidations? — assert Spield's invariants hold
  through Blend's own stress (we inherit Blend's risk; show the inheritance boundary).
- [ ] **P2 [blend] `ttl_actually_lapses_without_bump`** — advance the ledger sequence beyond the
  bumped TTL with no touches: entry archives (read panics), demonstrating exactly what
  `bump_position` prevents — the negative control for the TTL tests.

## 11. Suite-quality tooling (meta)

- [ ] **P1 `cargo-mutants` run** — mutation-test the fast crates (`shared`, `market::curve`): every
  surviving mutant is a hole in the suite; §8's property tests should kill most.
- [ ] **P2 snapshot/golden tests** — commit `plan.md §7` worked-example numbers as exact golden
  outputs (the canonical test asserts relations; goldens catch ±1-stroop drift from refactors).
- [ ] **P2 deploy-script rehearsal** — a test (or CI script vs local RPC) that runs
  `__constructor → initialize → SAC-admin handover → code_hash == built wasm` for all four
  contracts in the deploy script's exact order, so the script can't rot.

---
---

# Part II — Mainnet launch readiness

> **Where we actually are.** All four contracts are **already live on mainnet** (deployed
> 2026-06-08, `MAINNETCONTRACTADDRESSES.md`) against the real Blend FixedV2 pool and Circle USDC —
> but **unseeded**: vault capacity 0, market reserves `[0,0]`, no user funds. So "launch" = seeding
> + opening the frontend, not deploying.
>
> **This is the cheapest moment in the protocol's life to fix anything.** Right now a fix is a
> fresh redeploy (`FRESH=1`) costing a few XLM. The instant real TVL lands, every fix becomes a
> 24h-timelocked upgrade executed over live user funds. **Every P0 in §0 and §13 should be closed
> before the first seed transaction.**

The tests below all run against the **real deployed parameters**, not the test-suite defaults. The
gap matters — the existing suites almost all use a 1-year maturity and a fresh Blend pool at
`b_rate ≈ 1.0`, while mainnet is a **90-day** maturity on a pool at **`b_rate ≈ 1.124`** with
**~80% utilization**.

### The deployed parameter set (test against these)

| Param | Mainnet value | What the test suites use instead |
| --- | --- | --- |
| Maturity | `1788722911` — **90 days** (~2026-09-06) | `YEAR` (365d) almost everywhere |
| Blend pool | FixedV2, `b_rate ≈ 1.124`, ~80% util, 43.5M USDC | fresh pool, `b_rate ≈ 1.0`, low util |
| Strategy `max_apr_bps` | `30000` (300%/yr) | 30000, and tiny-cap tests |
| Vault `rate_bps` / ceiling | `500` (5%) / `2000` | 500/2000 |
| Market `fee_bps` / ceiling | `30` (0.30%) / `100` | 30/100 |
| Market `rate_anchor` | `1e12` — **exactly par** | 1e12 |
| Market `scalar_root` | `40e12` | 40e12 |
| Seeds | **0 / 0** (unseeded) | seeded in every test |

Derived numbers these tests should assert (worked from the table above — **verify my arithmetic in
code, don't trust the prose**):

- `years_to_maturity = 90/365 = 0.24658` ⇒ `rate_scalar = 40 / 0.24658 = **162.2**` — a very *flat*
  curve (tiny price impact per trade).
- Vault coupon on a 90-day term `= 5% × 0.24658 = **1.2329%**`. A 1,000 USDC deposit needs
  **12.33 PT** of spare inventory ⇒ **a seed of S USDC supports ≈ 81 × S of deposits** (100 USDC
  seed ⇒ ~8,100 USDC of vault TVL before `InsufficientCapacity`).
- Entry at `b_rate = 1.124` ⇒ `shares = amount / 1.124`. A 1-stroop mint floors to **0 shares** and
  trips the guard — minimum viable mint on mainnet is 2 stroops.
- TTL target `= maturity + 30d grace = 120 days = 2,073,600 ledgers` at 5s.

---

## 12. Deploy-parameter replication (re-run the suite as mainnet actually is)

The single highest-value mainnet change: **parameterize the test harnesses** and add a mainnet
profile, so every existing test also runs at the real numbers.

- [ ] **P0 [blend] `mainnet_profile_harness`** — extend `setup()` in the wrapper/vault/market
  suites to take a profile (`maturity_secs`, `initial_b_rate`, `utilization`, `rate_bps`,
  `fee_bps`, `scalar_root`, `rate_anchor`), and add `MAINNET` = the table above. Then re-run the
  full existing suite under it. **This alone may surface more than any single new test** — none of
  the current tests have ever executed a 90-day term at an elevated entry rate.
- [ ] **P0 [blend] `ninety_day_full_lifecycle_at_real_brate`** — the canonical end-to-end (mint →
  accrue → claim → mature → redeem) with maturity 90d and the pool pre-accrued to `b_rate ≈ 1.124`
  *before* the first mint. This is the exact configuration of the very first real user deposit.
- [ ] **P0 [blend] `entry_at_elevated_brate_yield_is_not_overstated`** — the SCF-#3 solvency
  argument's load-bearing case: at `entry_rate = 1.124`, 1 YT ≠ 1 share, so measuring yield on the
  YT face amount would over-pay by 12.4%. Assert `claim_yield` pays `shares × Δrate` and that
  backing never dips below principal. Existing tests mint at ≈1.0 where the two coincide — **the
  bug this design prevents is literally invisible in the current suite.**
- [ ] **P1 [blend] `ninety_day_ttl_fits_network_max`** — read the live
  `max_live_until_ledger()`; assert the 120-day (2,073,600-ledger) target is *not* clamped. If it
  is clamped, `bump_position`/`bump_receipt` become **mandatory** operational upkeep, not a
  nice-to-have — that flips a documentation claim and needs a cron job before launch.
- [ ] **P1 [blend] `mainnet_maturity_is_consistent_across_all_four`** — wrapper, vault, and market
  all report the same maturity (`1788722911`). Guards the §0 market-maturity-mismatch gap at the
  actual deployed values. Also **[live-read]**-verifiable today.
- [ ] **P1 [fast] `max_apr_bps_30000_is_calibrated`** — at 300%/yr, the permitted rise over the
  90-day term is ~74%, against a real supply APR of single digits (~1.2% over the term). Document
  that the bound is ~60× looser than reality: it catches *catastrophic garbage only*, never a
  plausible-but-wrong rate. Decide whether to tighten to e.g. 5000 bps (50%) — still 40× headroom
  over reality — and assert honest reads pass at that tighter value.

## 13. Issuer & token-supply integrity — **the largest untested attack surface**

**P0 finding from reading `deploy_mainnet.sh`.** PT and YT are **classic Stellar assets**
(`SPLDPT`/`SPLDYT`, issuer `GA4R5M7ZWOQZWIYCW246YC5WJ4QHT3H74CAUSTCEUUWIELCWI7IP3MKB`) wrapped as
SACs. The script hands **SAC admin** to the wrapper (script lines ~210–222), so only the wrapper
can call the SAC's `mint`. **But it never locks the classic issuer account** — no `set-options`,
no master-weight-0, no flag lockdown anywhere in the script.

A Stellar asset issuer creates supply by making an ordinary **classic payment**, which needs no SAC
admin rights. So `spield_issuer_mainnet` remains an **unbounded PT/YT minting key that bypasses the
wrapper entirely** — no deposit, no Blend shares, no solvency check. Newly-issued PT is the same
asset the SAC represents, so it can be transferred straight into the market contract.

Blast radius if that key is compromised (it currently lives on the deploy machine):
- **The AMM pool is fully drainable** — sell counterfeit PT for the pool's entire USDC reserve.
- The wrapper is *incidentally* shielded, because `redeem_pt` is position-gated (the §0 gap that's
  a bug for users is accidentally a mitigation here) — but do not rely on that.
- The vault reads `pt_inventory` from the SAC balance; donated PT inflates capacity, letting the
  vault under-collateralize by its own accounting.

Tests + actions:

- [ ] **P0 [testnet] `classic_issuance_bypasses_wrapper_poc`** — on **testnet**, reproduce it end
  to end: after SAC admin is handed to the wrapper, use the issuer key to classic-pay PT to a
  fresh account, then sell that PT into the market and walk away with USDC the pool held. Confirms
  the vector is real before you spend effort on the fix. **Never run this on mainnet.**
- [ ] **P0 [testnet] `locked_issuer_cannot_issue_but_wrapper_can_still_mint`** — the fix
  rehearsal: after `set-options --master-weight 0` on the issuer, assert (a) classic issuance now
  fails, and (b) the wrapper's SAC `mint`/`burn` still work for the full mint→claim→redeem cycle.
  **(b) is the critical half — verify it on testnet before touching mainnet, because locking an
  issuer is irreversible.** My reading is that SAC mint is authorized at the contract layer and is
  unaffected by the issuer's signing weight, but that must be *proven*, not assumed.
- [ ] **P0 [live-read] `issuer_flags_are_safe`** — read the live issuer account's flags from
  Horizon. If `auth_revocable` is set, the issuer can **freeze** PT/YT trustlines; if
  `auth_clawback_enabled` is set, it can **claw back** user PT. Both should be **off**. Assert it,
  and record the result in `MAINNETCONTRACTADDRESSES.md`.
- [ ] **P0 [blend] `pt_supply_equals_sum_of_position_pt`** — the missing global conservation law:
  PT SAC `total_supply` == Σ open-position `pt_amount` (equivalently, no PT exists that the wrapper
  did not mint). Assert after every op in the §5 ecosystem fuzz. This is the on-chain invariant
  that would *detect* counterfeit PT; add the same for YT.
- [ ] **P1 [live-read] `usdc_issuer_powers_are_documented`** — Circle's USDC issuer retains
  authorization powers on Stellar. Read the live flags and document precisely what Circle could do
  to Spield-held or Blend-held USDC (freeze / claw back). This is an inherited dependency exactly
  like Blend's oracle risk, and it belongs in the trust model in `README.md`, stated rather than
  discovered later.
- [ ] **P1 [blend] `donated_pt_does_not_corrupt_vault_accounting`** — send PT directly to the vault
  from outside (anyone can, it's a SAC): `stats()` capacity rises without a matching liability.
  Confirm this is safe-by-direction (over-collateralized, never under) and that it can't be used to
  trick `deposit`'s capacity gate into issuing a receipt the vault can't honor.
- [ ] **P2 [blend] `donated_pt_usdc_to_market_does_not_move_price`** — the market prices off stored
  reserves, not balances, so a direct token donation should be inert (and unrecoverable by the
  donor). Pin it.

## 14. Launch-economics calibration — **the seed parameters are wrong as scripted**

**P0 finding from reading the curve math against the deploy script.** `rate_anchor = 1e12` is
*exactly par*, and `deploy_mainnet.sh` seeds the market **1:1** (it mints `MARKET_SEED_AMOUNT` PT
and adds `MARKET_SEED_AMOUNT` USDC). At a 1:1 ratio the proportion is 0.5, the logit term is 0, so
`exchangeRate = rate_anchor = 1.0` — **PT opens at par, and `implied_apy()` returns 0.**

A fixed-income venue whose headline number reads 0% APY at launch is a launch-blocking economic
bug, even though every contract is behaving exactly as written.

Working the curve backwards for a 5% opening APY (matching the vault's quoted rate) on the 90-day
term: target price `= 1.05^-0.24658 = 0.98811`, so the needed logit `= (1 − 0.98811) × 162.2
= 1.9285`, giving `p/(1−p) = e^1.9285 = 6.88` ⇒ **proportion ≈ 0.873**. The pool must be seeded
roughly **87% PT / 13% USDC** — e.g. **873 PT + 127 USDC**, not 500/500.

- [ ] **P0 [fast] `opening_implied_apy_for_deploy_params`** — a pure table test over candidate seed
  ratios at the real `scalar_root`/`anchor`/90-day term, printing the opening `pt_price` and
  `implied_apy` for each. Assert the 1:1 seed yields **0%** and locate the ratio that yields the
  target APY. **This test picks the launch seed numbers** — run it before the seed tx, then put the
  chosen ratio in the deploy script (or seed by hand).
- [ ] **P0 [blend] `seeded_pool_quotes_the_advertised_rate`** — seed at the §14 ratio, then assert
  `implied_apy()` ≈ the vault's `rate_bps` within tolerance, so the "Earn Fixed" page can't show
  two contradictory rates for the same maturity.
- [ ] **P1 [fast] `scalar_root_40_price_impact_profile`** — at `rate_scalar = 162`, quantify price
  impact for trades of 1%/10%/50% of reserves. A curve this flat means a large trade barely moves
  the price — good for traders, but it means **the pool's USDC can be bought out at near-par**,
  which is only safe because output is reserve-bounded. Decide whether `scalar_root = 40` is right
  for the intended depth, or whether a lower root (steeper curve) protects LPs better.
- [ ] **P1 [blend] `vault_capacity_runway_at_5pct_90d`** — assert the 81× multiplier: seed S, then
  deposit until `InsufficientCapacity` and check the total lands at ≈ 81 × S. **This is the number
  that decides the launch seed size** — publish it in MAINNET.md ("a 500 USDC seed supports ~40k of
  deposits").
- [ ] **P1 [blend] `capacity_exhaustion_is_graceful_not_stuck`** — at exactly 0 capacity: `deposit`
  reverts cleanly with `InsufficientCapacity`, `quote` still returns a number (so the UI can show
  "capacity full"), existing receipts still redeem, and one `harvest` restores capacity and unblocks
  deposits. The most likely week-one support ticket.
- [ ] **P1 [blend] `unseeded_contracts_behave_sanely`** — **the current live state.** With capacity
  0 and reserves `[0,0]`: `vault.deposit` reverts `InsufficientCapacity`, `quote` returns a rate,
  `market.pt_price`/`implied_apy`/both quotes return `0`, swaps revert, `solvency` reads `[0,0,0]`.
  Pin it so the frontend's empty-state rendering has a contract to code against.
- [ ] **P1 [blend] `first_depositor_is_not_disadvantaged`** — classic vault-inflation check adapted:
  the very first depositor into a freshly-seeded vault and the first LP into a fresh pool get
  economically fair terms; a griefer front-running with a 1-stroop deposit/LP can't skew share or
  capacity math.
- [ ] **P2 [fast] `rate_anchor_par_means_zero_yield_by_construction`** — a documentation test
  asserting `pt_price == SCALAR_12` and `implied_apy == 0` at proportion 0.5, so nobody "fixes" the
  1:1 seed later without re-deriving §14.

## 15. Adversarial simulation (attacker-driven, real money assumptions)

Everything above assumes honest actors. These are written from the attacker's seat — each asks
"can I extract value?" and asserts **no**.

- [ ] **P0 [blend] `attacker_cannot_extract_via_any_single_op_fuzz`** — a fuzzer whose oracle is
  purely economic: a hostile actor with a fixed USDC budget runs random op sequences (including
  rate-timing, ordering, dust, and self-transfers); assert their **final USDC ≤ initial + legitimate
  yield earned**, for thousands of sequences. Catches value leaks no invariant names in advance.
- [ ] **P0 [blend] `sandwich_a_vault_harvest`** — `harvest` mints PT at the current rate and is
  permissionless. Try: deposit immediately before a large harvest and redeem after; try calling
  harvest yourself to time capacity. Assert no profit beyond honest yield.
- [ ] **P0 [blend] `flash_style_same_ledger_attack_matrix`** — Soroban has no flash loans, but a
  single tx can chain many calls. Script the worst same-ledger sequences (mint → swap → combine →
  redeem in one invocation, both directions) and assert solvency + no extraction. `elapsed == 0`
  means the rate can't move, which is the property that should make these all fail.
- [ ] **P1 [blend] `dust_griefing_campaign`** — 1,000 minimum-size mints/burns from an attacker:
  assert the wrapper's dust band stays at `open_positions + 4` (the §0 fix holds under real churn),
  storage growth is bounded, and no honest op gets bricked or priced out.
- [ ] **P1 [blend] `pt_price_manipulation_before_vault_deposit`** — move the AMM price violently,
  then interact with the vault. The vault must be numerically independent of market price (it prices
  off `rate_bps` and PT inventory, never a market quote) — prove there's no oracle coupling.
- [ ] **P1 [blend] `rounding_direction_always_favors_protocol_fuzz`** — assert *every* floor/ceil in
  mint/claim/redeem/combine/swap/LP rounds toward the protocol, never the user, across thousands of
  random amounts. A single mis-signed rounding step is a slow drain at scale.
- [ ] **P1 [blend] `admin_key_compromise_blast_radius`** — assume the admin key is fully
  compromised, then attempt everything it can do: pause forever, fee/rate to ceiling, widen the rate
  bound, schedule a malicious upgrade. Assert user funds remain withdrawable throughout (exits stay
  open under pause) and that the upgrade is 24h-delayed and cancellable. **This test is the evidence
  for the "admin cannot steal funds" claim in MAINNET.md §2** — that claim is currently asserted in
  prose but never tested as an attack.
- [ ] **P1 [blend] `griefer_cannot_block_others_exits`** — under adversarial load (position spam,
  cursor manipulation, capacity exhaustion), an honest user's `claim_yield` / `redeem_pt` /
  `vault.redeem` / `remove_liquidity` always succeeds within budget.
- [ ] **P2 [blend] `reentrancy_via_malicious_token_is_impossible`** — wire a hostile token that
  attempts re-entry on transfer; confirm the host rejects it. Documents the reentrancy claim in the
  wrapper module doc with a test rather than a comment.

## 16. Live-deployment verification (read-only, run against mainnet RPC today)

Cheap, safe, and repeatable — a script (`scripts/verify_mainnet.mjs`) that fails loudly on drift.
Everything here is a **read-only invoke**; no keys, no fees.

- [ ] **P0 [live-read] `verify_mainnet_wiring`** — assert on-chain: wrapper's `strategy`/`pt_token`/
  `yt_token`/`underlying`/`maturity`; strategy's `pool` == FixedV2 and `underlying` == Circle USDC;
  vault's `wrapper`/`pt`/`yt`/`maturity` match the wrapper; market's `pt_token` == wrapper PT and
  `maturity` == wrapper maturity. **Catches the §0 maturity-mismatch gap on the live deployment.**
- [ ] **P0 [live-read] `verify_sac_admin_is_wrapper`** — confirm PT and YT SAC admin is the wrapper
  contract and not the issuer. The single most important post-deploy fact; currently verified only
  by the deploy script having not errored.
- [ ] **P0 [live-read] `verify_code_hashes_match_built_wasm`** — re-check all four `code_hash()`
  against the four hashes recorded in `MAINNETCONTRACTADDRESSES.md`, and against a fresh
  reproducible build. Turn this into CI so an unexpected upgrade is detected within the hour.
- [ ] **P1 [live-read] `verify_admin_and_governance_state`** — all four `admin()` are the expected
  address; `pending_admin()` is `None`; `pending_upgrade()` is `None`; `timelock()` == 86400. Any
  non-`None` here means someone scheduled something — page immediately.
- [ ] **P1 [live-read] `verify_blend_pool_health_preflight`** — before seeding, read the live
  FixedV2 USDC reserve: `b_rate`, total supplied, and **utilization**. At ~80% util only ~20% of
  supply is withdrawable; assert the intended seed + expected TVL is small relative to available
  liquidity, so exits aren't gated on Blend liquidity from day one.
- [ ] **P1 `solvency_monitor_alerts_on_a_real_breach`** — the monitor has never been shown to
  actually fire. Point it at a local/testnet deployment, force `backing < principal`, and assert
  exit code 2 + the webhook POST. Also test its failure modes: RPC down (exit 1), malformed
  response, and the `--tolerance` boundary. **An untested watchtower is not a watchtower.**
- [ ] **P2 [live-read] `verify_no_unexpected_token_supply`** — PT/YT `total_supply` should be 0 while
  unseeded, and after launch should equal Σ position `pt_amount`. Run continuously; a divergence is
  the §13 counterfeit-PT alarm.

## 17. Operational runbook rehearsals (do these on testnet before launch)

Each is a procedure MAINNET.md documents but nobody has executed under pressure. Rehearse on
testnet with a stopwatch, then write the timing into the runbook.

- [ ] **P0 [testnet] `emergency_pause_drill`** — from "we suspect a problem" to all four contracts
  paused: run it, time it, and confirm during the pause that **every** exit still works
  (`claim_yield`, `redeem_pt`, `combine_and_redeem`, `transfer_position`, `vault.redeem`,
  `remove_liquidity`) and every inflow is blocked. Then unpause and confirm full function returns.
- [ ] **P0 [testnet] `multisig_rotation_dress_rehearsal`** — the full §6.1 procedure on all four
  contracts with a real multisig: propose → accept → old key powerless → new key functional. Do
  this **before** it's urgent; a failed rotation with live TVL is the worst possible time to learn
  the flow. (MAINNET.md flags this as recommended-not-required — but "recommended" should still be
  rehearsed.)
- [ ] **P0 [testnet] `upgrade_drill_with_live_positions`** — with open positions, accrued yield, a
  seeded vault, and a live pool: schedule an upgrade, observe it in `pending_upgrade()`, attempt to
  apply early (must fail), wait out the timelock, apply, then verify every position/receipt/LP
  balance survived and all flows still work. The §1 test covers this in-suite; this covers it as a
  *procedure*, including the "users see the pending upgrade and exit" path.
- [ ] **P1 [testnet] `cancel_a_scheduled_upgrade_under_time_pressure`** — the abort path, timed.
- [ ] **P1 [testnet] `set_max_apr_bps_unstick_drill`** — simulate the rate bound tripping in
  production (deploy with a tight cap so it really trips), confirm the protocol is fully frozen
  (mint/claim/redeem/views all panic), then unstick with `set_max_apr_bps` and verify recovery. This
  is the one documented single-command production fix — **prove it works end to end on a live
  network before you need it.**
- [ ] **P1 [testnet] `deploy_script_fresh_run_reproducibility`** — `FRESH=1` on testnet twice;
  assert identical wiring and identical code hashes both times, and that resume-after-interruption
  still skips completed steps (MAINNET.md claims this was tested — re-verify after any script edit).
- [ ] **P1 `frontend_against_unseeded_and_seeded_mainnet`** — point the frontend at the live mainnet
  addresses in both states. Unseeded must render empty states (not spinners, NaN, or crashes) given
  the `0`-returning views; seeded must show the real rate, price, and APY. MAINNET.md §7 lists
  env-driven config as still outstanding — this is the test for it.
- [ ] **P2 [testnet] `ttl_upkeep_cron_rehearsal`** — if §12's TTL test shows clamping, rehearse the
  permissionless `bump_position`/`bump_receipt` sweep as a scheduled job over many ids within budget.

## 18. Pre-seed go/no-go gate

Concrete, checkable conditions. **Do not send the first seed transaction until every box is
ticked.**

> **⚠ Ordering.** The first two boxes below are listed in dependency order, not in the order they
> were written. **The §13 issuer lockdown must be done BEFORE the market-bought-PT §0 P0s**, not
> after. `redeem_pt` being position-gated is currently the only thing stopping counterfeit PT from
> draining the wrapper while the PT/YT issuer remains a live signing key
> (`wrapper::test::extra_pt_outside_a_position_breaks_conservation_but_not_the_wrapper` pins this).
> Adding any balance-based redemption removes that shield, so shipping the §0 fix first would turn a
> UX gap into a drainable exploit. Lock the issuer, verify on chain that it can no longer sign, then
> work the redemption gap.

- [ ] **§13 issuer lockdown** rehearsed on testnet and executed on mainnet; issuer flags verified
      safe; PT/YT supply conservation asserted in the suite and monitored live. **Do this first —
      see the ordering note above.**
- [ ] Every **P0 in §0** is resolved (fixed, or consciously accepted and written down) — especially
      market-bought-PT redemption (blocked on the lockdown above), harvest-under-pause, the vault's
      monotonic dust band, and the b_rate-decrease brick. (The "unbounded `redeem_pt_for` walk" is
      no longer on this list: it was measured and the premise did not hold — see §0. The budget P0
      it was standing in for is `harvest`'s batch ceiling, now closed.)
- [ ] **§14 seed ratio** computed and agreed — **not** the script's 1:1 default — and the opening
      `implied_apy` matches the vault's advertised rate.
- [ ] §12 mainnet-profile suite green: 90-day term, `b_rate ≈ 1.124` entry, all existing tests.
- [ ] §16 live verification script written, green, and running in CI.
- [ ] §17 pause + rotation + upgrade + rate-unstick drills rehearsed on testnet, with timings in the
      runbook.
- [ ] Solvency monitor **proven to fire** (§16), running under a supervisor, alerting a human.
- [ ] Any code change since 2026-06-08 redeployed and `MAINNETCONTRACTADDRESSES.md` + code hashes
      updated. **Redeploy now while it's free; after TVL it's a 24h timelock.** Use
      `REDEPLOY=market[,vault]` to replace a single contract in place — **not** `FRESH=1`, which
      re-creates the PT/YT SACs and changes every address. The market's `wrapper`/`maturity`/`pt`
      binding is asserted from chain by the deploy script itself, so a stale market fails the run
      instead of being seeded.
- [ ] Security audit commissioned or explicitly deferred in writing (MAINNET.md §7 — still open, and
      a sibling Blend pool lost $10.8M in Feb 2026).
- [ ] Launch TVL cap decided and enforced operationally (start small; §16's Blend-liquidity preflight
      bounds how much can exit at once).

## 19. Post-launch continuous testing

- [ ] **P1 CI: mainnet-fork smoke test** — nightly, pin the live Blend pool state into a test fixture
      and run the §5 ecosystem fuzz against it, so drift in Blend's real parameters (rate, util,
      reserve config) surfaces as a failing build rather than a production surprise.
- [ ] **P1 invariant monitor, not just solvency** — extend `solvency_monitor.mjs` to also check PT/YT
      supply conservation (§13), vault `pt_inventory ≥ total_liability`, and market reserves ≥ 0. The
      current monitor watches one of four invariants.
- [ ] **P1 maturity-day rehearsal** — 7 days before the real 2026-09-06 maturity, replay the exact
      maturity transition on testnet at the same scale: trading halts, everyone redeems, LPs exit,
      unharvested yield is stranded (§3), and nothing archives. Maturity day is the highest-risk day
      in a fixed-term protocol's life and it arrives on a known date — rehearse it.
- [ ] **P2 rolling next-maturity deployment** — the whole stack is single-maturity. Test standing up
      a second market (90 days later) alongside the first: two wrappers, two vaults, two pools,
      shared strategy? *(The strategy binds to exactly one wrapper — so a second market needs a
      second strategy. Confirm that and document it; it's a launch-cadence constraint, not a bug.)*

---

### Suggested order of attack

**Before the first seed tx (launch-blocking):**
1. **§13 issuer lockdown** — the biggest single exploit surface; PoC on testnet, then lock. **This
   comes first**: the position gate on `redeem_pt` is the only thing currently containing
   counterfeit PT, and the §0 market-bought-PT fix removes that gate (see §18's ordering note).
2. **§0 P0s** — each is a design decision, not just a test. Fix now while a redeploy is free. The
   market-bought-PT and sold-PT-leg pair are one design question and are gated on step 1.
3. **§14 seed calibration** — the scripted 1:1 seed ships a 0% APY venue.
4. **§12 mainnet-profile suite** — 90-day + elevated `b_rate`; may surface more than any new test.
5. **§16 live verification** + **§17 pause/rotation drills** + a **proven** solvency monitor.

**Then, hardening (can run in parallel with a small-TVL launch):**
6. §6 auth matrix and §2's wrapper-only-caller test (cheap, closes the biggest untested boundary).
7. §5 + §15 fuzzers (one harness, most of the residual bug surface).
8. §8 fast properties + §11 mutation run (hardens the math and measures the suite itself).
9. §19 continuous testing, then everything else opportunistically.
