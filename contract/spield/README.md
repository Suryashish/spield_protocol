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
  multisig-pathed.** Pause can only *halt*, never move user funds.
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
