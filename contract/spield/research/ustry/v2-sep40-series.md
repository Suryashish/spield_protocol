# USTRY v2: SEP-40 series that cannot be stranded by its oracle

Contracts: `contracts/ustry-series` (series), `contracts/ustry-nav` (testnet relay oracle), with the
unchanged `contracts/rwa-token` claim facade. Series 1 (`contracts/rwa`, `ustry-oracle`) is left
exactly as deployed.

## What changed and why

| Series 1 failure | v2 behaviour |
|---|---|
| Custom `observations()` history; only Spield's relay could feed it | Reads standard **SEP-40** (`base`, `decimals`, `prices`). Testnet: `ustry-nav`. Mainnet: RedStone's wrapper `CBMGLKUQ…`. Same code. |
| Combine, claim and YT transfer reverted once NAV was >13h old | Only **new splits** read the feed. Combine, claim, YT transfer/burn and receipt exits **never call the oracle**; they use the state last folded by `sync()` or a deposit. |
| Finalize needed a fresh pre-expiry sample; one missed relay run would lock PT/YT permanently | Finalizes on a **post-expiry sample**, or after `grace` **without calling the oracle at all**. |
| Any accepted price moved high-water | High-water may rise at most `max_apr_bps` per year, **linear from the seed sample**. |
| One key published and governed; history capped at 256 then full | `ustry-nav`: separate rotatable **publisher**, two-step admin, 64-sample ring buffer, configurable cadence, per-publish move bound. |
| Hard-coded 1,000 USTRY cap, no governance | Admin-set cap; Blend-v2 governance (two-step admin, upgrades behind the ≥24h timelock). |

Why stale exits are safe: a combine pays `face·f_entry` whatever the current factor, so folding
fewer prices only relabels principal vs yield. A claim on unfolded state pays the rest after the
next `sync()`. The relay calls `sync()` after each publish (`--sync`), so stored state stays current.

## Verification

- `cargo test -p spield-ustry-series -p spield-ustry-nav --features spield-ustry-series/fork-tests`:
  37 tests. Includes every failure mode of the feed (trap, wrong base, wrong decimals, `None`,
  out-of-order, duplicate, future-dated, over-length, **budget exhaustion**), maturity on both paths,
  the linear rate bound, dust exits, zero-amount transfers, and multi-user conservation.
- `fork_test.rs` runs the series against **RedStone's real mainnet code and state** (captured by
  `scripts/fetch_redstone_fork.mjs`): seeding, split, claim and combine on the genuine USTRY SAC;
  staleness one day later; grace finalization. `deposit_split` costs about 4.8M CPU instructions,
  under 5% of the mainnet transaction limit.
- Independent adversarial review: no over-payment or theft path found. Its findings (budget
  exhaustion through `try_`, compounding clamp, unredeemable dust, zero-amount transfer settle) are
  fixed and each has a regression test.
- Live testnet: `scripts/live_ustry_v2.mjs` on a 20-minute fixture (`v2-fixture-testnet.json`)
  covering deposit, split, transfers, auth, slippage, cap, sync, claim, boundary finalization and
  PT-only exit.

## Parameters

| | testnet Series 2 | mainnet (prepared, not deployed) |
|---|---|---|
| Feed | `ustry-nav`, 1h min interval, 5% move bound, relay every 4h | RedStone SEP-40, 12h heartbeat / 0.1% |
| `max_age` (new deposits only) | 13h | 13h |
| `grace` | 3 days | 7 days |
| `max_apr_bps` | 2000 | 2000 |
| `cap` | 1,000 USTRY | 1,000 USTRY |
| `window` | 16 records | 16 records |

## Operating it

- Deploy: `node scripts/deploy_ustry_v2.mjs testnet --admin <key> --publisher <key> --label <name>`.
  Mainnet: `node scripts/deploy_ustry_v2.mjs mainnet --admin <key> --label <name> --confirm-mainnet`.
  Resumable; verifies everything on chain; writes `frontend/src/lib/ustry-v2-<network>-<label>.json`.
- Relay (testnet only): `node scripts/ustry_nav_relay.mjs --oracle <C…> --sync <series>`; scheduled by
  `.github/workflows/ustry-nav-relay.yml` (secret `USTRY_PUBLISHER_SECRET`, variables
  `USTRY_ORACLE`, `USTRY_SERIES`). Missing runs pause new deposits only.
- Mainnet needs no relay. Anyone may call `sync()`; a keeper calling it every few hours keeps claims
  current.

## Open decisions

- **Clawback.** USTRY has `auth_clawback_enabled` on both networks. A clawback from the series makes
  `assert_custody` fail every exit until the shortfall is restored (fail-closed, as in Series 1).
  A pro-rata haircut would keep exits open at the reduced ratio. This is a product and legal choice.
- **Upgrade trust.** The 24h timelock lets holders of both legs combine and leave; a holder of only
  PT or only YT cannot exit before finalization. Use a different, multi-signature admin on mainnet.
- **Window flush.** If more than `window` samples arrive between folds, older ones are skipped.
  This only lowers YT yield, is bounded by the rate cap, and the relay's sync keeps it from happening.
