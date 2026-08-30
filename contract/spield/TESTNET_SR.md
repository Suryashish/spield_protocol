# TESTNET_SR.md — the SR stack, live on testnet

**Redeployed 2026-08-30** against the real **Blend TestnetV2** pool and real testnet USDC, carrying
every fix from `FINAL_CHECK.md` — V2-01, V2-03, RISK-01 and ECO-02. Seeded to the **planned mainnet
shape**, wired to the frontend, and cleared through the on-chain budget gate.

> **All six router paths fit**, including `buy_yt_with_usdc` and `sell_yt_for_usdc`, which
> `budget.md` had recorded as over budget. See `budget.md` §2.

```
Network passphrase: Test SDF Network ; September 2015
Explorer:           https://stellar.expert/explorer/testnet
```

## Addresses

> **Redeployed 2026-08-30.** The previous deployment predates the whole `FINAL_CHECK.md` round:
> **V2-01** (the market prices on a SYNCHRONIZED index via `yield.py_index_current`), **V2-03** (the
> router compares against its entry snapshot, so a one-stroop donation can no longer deny every
> route), **RISK-01** (`sr.realizable_rate` / `realizable_value`) and **ECO-02**
> (`strategy.claim_emissions`, pointed at the treasury at deploy time). None could be added in place.
> Old addresses: `scripts/deploy_sr_testnet.state.bak.pre-eco02-20260830-210750`.

| Contract | Address |
|---|---|
| **SR** (Standardized Return) | `CDYAM3NGY5I3SUGPCDQUS25MGCIWT2YOBDSWYT6SJNIPN6A6OOUSSCZY` |
| **Strategy** (Blend adapter) | `CDPNSWSBVBRF52SED6UD7T2VQH6XODLEHXSCFTZHQP73SNYTKIHP5R2B` |
| **Yield engine** — *this is also the YT token* | `CDS2Q6L3QCUK4KX633M7QH53GC76EVOUAK7WJ54T3AP3J6IGXIM3LURD` |
| **PT/SR Market** | `CBL7Z3BONITNSWO7NJLT67464HLVVQF5G3REI3XT6KUCK7YNHPICJX5A` |
| **Fixed-Rate Vault** | `CDKV7Z7FF3DA57LSO2JA6GFKAIDDIDMZD5XWCMV7G5I3E4ZA3NN2NMH7` |
| **SR Router** | `CDP3VUYH3GEGNOF4XUHKMP5GBTH3SBCL5R3GM5ZTVQAGV7FOAPAQJTGE` |
| **PT SAC** | `CB3T6FOMAH77Z2FMSA2IEVLQEIYOQRRFP7JMJMJGMUCO6HGOOZJZJ7OC` |
| PT classic asset | `SPLDPT7:GDTM2UMJEO6LV5HE2SI56IEWNX5OAF5HV2XNZMVZEDXMMPHZUWXSSLQU` |
| USDC SAC (Blend's testnet USDC) | `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU` |
| Blend pool | `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF` |

> **There is no YT asset and no YT trustline.** The yield engine *is* the YT token — a custom
> SEP-41 contract, because YT needs a transfer hook to settle interest and a SAC has none.
> Only PT needs a trustline.

## Parameters as deployed

| | |
|---|---|
| Expiry | `1790696291` (**30 days**, matching the mainnet plan) |
| Opening implied APY | **5.00%** — and the pool opened at exactly `50000000358` (5.0000%) |
| PT price at open | `0.988042` — matching the unit test to 6 dp |
| `scalar_root` | `40e12` |
| `ln_fee_root` | `2500000000` (**0.25%/yr**, from `calibrate_the_fee_root`) |
| Yield fee | **500 bps (5%)** → treasury |
| Treasury swap-fee share | **2000 bps (20%)** → treasury, 80% to LPs |
| Seed | 200 USDC/side, added at ~1:1 |
| Vault fixed rate | **300 bps (3.00%)** — was 500 at deploy; `set_rate` 2026-08-29, see below |

> **The vault rate was changed on chain after this deploy.** 500 bps was never calibrated against
> Blend (`V2_WORK.md` §15); the calibrated default is now 300 and the live vault was moved to match
> ([tx 35ae9c42](https://stellar.expert/explorer/testnet/tx/35ae9c42a7605e9bfea53a636dcb94b1c4e97c8cc8dd681c928bb5117b819eac)).
> Open receipts kept their original payout and rate — `set_rate` is forward-only.
>
> **The market was NOT moved with it.** Its implied APY is a function of its reserves, not an admin
> setting: it read **4.72%** after the vault change (having drifted from its 5.00% open through
> trading). So the dashboard now shows a 3.00% vault rate beside a ~4.7% market rate. That is not a
> solvency problem — a market rate is *discovered* and funded by whoever sells PT, while a vault rate
> is *promised* and funded by the vault's own inventory — but it does mean PT currently locks a
> better fixed rate than the vault does. Realigning them means reseeding or trading the pool, which
> is a liquidity operation, not a config change. Fresh deploys open the market at the vault's rate
> (`MARKET_APY_BPS` now derives from `VAULT_RATE_BPS`); see also `tofix.md` #34 on how far a trade
> may move the headline before it stops resembling the vault's rate.

## Accounts

| Alias | Address |
|---|---|
| `alice425` (deployer / LP / treasury) | `GDXHBXYT23MUJWOKNZLTRBYJA2H6LDIL2DVHJCVITEFKQK5QUT2LPBJF` |
| `bob425` (counterparty) | `GBZGY75ICY4LQEWEBW4EI77VCRHH44CSDOPXCSLXLDOFQTNA456R6VV3` |
| `spield_sr_issuer4` (PT issuer) | `GCCDH7PSRAB6SKZPKBGTJYKKUCPSR3SNI3GCCFLTHR2Z6E6ASN5EEAYX` |

Fund a test account (XLM + 1000 USDC + BLND, from Blend's faucet):

```bash
stellar keys generate NAME --network testnet --fund
curl -s "https://ewqw4hx7oa.execute-api.us-east-1.amazonaws.com/getAssets?userId=$(stellar keys address NAME)" \
  | tr -d '"' | stellar tx sign --sign-with-key NAME --network testnet | stellar tx send --network testnet
```

## Reproduce

```bash
cd website/contract/spield
FRESH=1 SEED=1 SEED_PER_SIDE=2000000000 ISSUER=<new-issuer> PT_CODE=<new-code> \
  ./scripts/deploy_sr_testnet.sh      # deploy + verify + seed
./scripts/test_sr_testnet.sh          # exercise every user workflow
```

A `FRESH=1` rerun needs a **new issuer or asset code**: the existing PT SAC's admin is permanently
the current yield contract, so a replacement engine could never mint it.

---

## Four real bugs this deployment found

None were reachable from the local suite. All are fixed, with regression tests.

### 1. Auth-amount drift — `buy_yt_exact_out`

```
SR: "Unauthorized function call for address" GBZGY75I…
    on transfer(bob, market, 7594949)
```

The user's payment is derived from the live index *inside* the transaction. Wallets sign
authorization entries against **simulation** amounts, and Blend's `b_rate` moves between simulate
and execute — so the signed `transfer(user, market, X)` no longer matched and the host rejected it.

**Fix:** pull `max_sr_in` (the user's own parameter, identical in simulation and execution) and
refund the remainder. Invisible locally because `mock_all_auths()` authorizes any amount.
Regression: `buy_yt_charges_the_quote_and_refunds_the_over_authorized_remainder`.

### 2. Timing-dependent footprint — `strategy::current_rate`

```
storage: exceeded_limit
"trying to access contract instance outside of the footprint"  (the strategy)
```

`current_rate` wrote its `RateBound` and bumped its instance TTL only **conditionally**
(`if rate > last_rate || now > last_ts`). Whether a write happened therefore depended on how much
time passed between simulation and execution, so simulation could record the entry read-only and
execution then need it read-write. Intermittent, and fatal to every YT purchase.

**Fix, in two parts:**
* `Sr::exchange_rate` is now a **pure** read of stored state and never calls the strategy. Mutating
  paths refresh through `sync_rate`, which always writes.
* `strategy::current_rate` now writes **unconditionally**. Writing the same value back is free (the
  entry is already in the read set) and makes the footprint a function of the call graph alone.

Before: 3 of 3 fresh users failed their first YT buy. After: **4 of 4 succeeded first attempt**,
across 10–80 USDC of face at 49–80× leverage, each charged within a few stroops of the quote.

Side effect worth noting: the claim path got ~40% cheaper (3.24 MB → 1.90 MB), because the read
path no longer traverses into Blend. And SR *reads* now survive a strategy brick, which is partial
relief on `tofix.md` #3 — see `a_guarded_strategy_still_bricks_sr_on_a_rate_dip`.

### 3. Wrong-asset trustline in the frontend

`setupTrustlines` adds **v1's** PT *and* YT. v2's PT is a different code *and* issuer, and its YT is
a contract with nothing to trust. A user would have opened a trustline to an asset that never
arrives.

**Fix:** `setupSrPtTrustline`, which reads the exact `CODE:ISSUER` pair recorded at deploy time
(`PT_ASSET_ID` in the state file, `SR_CONTRACTS.ptAsset` in the frontend). Never reconstruct it.

### 4. A double-execute in the test harness's own retry logic

The public testnet RPC intermittently returns `client error (Connect)`, so `test_sr_testnet.sh`
grew a retry. The first version retried whenever the output was **empty** — and `transfer` returns
void, so a *successful* transfer looked like a failure and was submitted again. It silently moved
150,000,000 YT twice and produced a confusing "sender's YT halved: got 0" failure.

**Fix:** retry on **exit status**, never on empty output. Worth stating plainly because the same
mistake in a frontend retry would double-spend a user's funds rather than a test account's.

---

## Verified on chain

Live reads through the frontend's own SDK path:

```
sr.exchange_rate               1.055931378372
yield.solvency                 held 5,066,617,530 >= needed 5,066,617,174   (solvent)
yield.yield_fee_bps            500
market.reserves                1,164,293,419 PT / 1,102,655,005 SR
market.pt_price                0.988046611190
market.implied_apy             5.0000007931%
market.treasury_earned         907,943 SR        (real revenue from test trades)
market.treasury_fee_share_bps  2000
```

Workflows exercised with real transactions — **`test_sr_testnet.sh`: 34 passed, 0 failed**:

* **Fixed yield** — 50 USDC -> 473,515,638 SR -> **503,600,330 PT face** (bought at a discount,
  redeems 1:1 at expiry).
* **Long yield** — 30 USDC of YT face for 4.22 SR, **71.1x leverage**, charged 4,218,486 against a
  12,655,473 authorization: the refund works.
* **tofix #15 (the headline)** — transferred half the YT to another wallet: the sender's balance
  halved, the receiver's rose, and the receiver's interest record was created with `accrued: 0` and
  a fresh index. **The yield follows the token.** In v1 the sender keeps all of it and the receiver
  gets none.
* **Exits** — YT sold mid-term for 1,441,080 SR; PT sold back for 468,678,314 SR.
* **Revenue** — treasury accrued swap fees at exactly the configured 20%; yield fee exactly 5%.
* **Guardrails** — an oversized YT sale quotes `0` (refused, not mispriced); absurd quotes return
  `0` rather than reverting; solvency held at every step.

Also verified separately: **three consecutive brand-new users each bought YT on their first
attempt** (20 / 50 / 90 USDC of face, 62–79x leverage), each charged within ~20 stroops of the
quote. That is the fix for bug #2 holding under real conditions.

One behaviour worth flagging as *correct*, not a bug: repeated YT buying drained the pool's SR side
(1.89B → 320M) until further YT buys were refused. That is exactly the documented reserve dynamic —
YT buying consumes SR the same way a PT sale does. The pool was rebalanced by withdrawing and
re-seeding.

---

## Frontend

`website/frontend` now carries the SR stack alongside v1:

| File | What |
|---|---|
| `src/lib/config.ts` | `SR_CONTRACTS` + `SR_DEPLOYED`; `null` on mainnet, so every SR path no-ops |
| `src/lib/srstack.ts` | Full typed client — reads, quotes, writes, USDC⇄SR conversion, leverage |
| `src/lib/horizon.ts` | `setupSrPtTrustline` — the v2 PT asset only |
| `src/components/dashboard/sections/SrPanel.tsx` | Wrap/unwrap, buy/sell PT, buy/sell YT, claim |
| `src/components/dashboard/sections/SrPortfolioPanel.tsx` | Balances, market state, engine solvency |
| `DashboardPage` / `DashboardApp` / `data.ts` | New **Spield v2** section at `/v2` |

Typechecks clean (`tsc -p tsconfig.app.json`) and builds clean. Note the repo's root
`tsconfig.json` is a project-reference stub with `files: []` — `tsc -p tsconfig.json` checks
**nothing**. Use `tsconfig.app.json`.

## Governance — added 2026-08-25, verified on chain

All three contracts now carry the same surface v1 has, via `spield_shared::governance`:

```
sr      timelock=86400s  version=spield-sr-0.1.0         code_hash=6d182ec2765c2290…
yield   timelock=86400s  version=spield-yield-0.1.0      code_hash=a9cdc745611fc38b…
market  timelock=86400s  version=spield-srmarket-0.1.0   code_hash=14335cdb1860b22c…
```

Verified against the live deployment, not just in tests:

* **Two-step rotation** — `propose_admin` set `pending_admin` while `admin` stayed put;
  `cancel_admin_transfer` cleared it. Rotation needs both parties, so a mistyped address cannot
  strand the contract.
* **Upgrade timelock** — `schedule_upgrade` returned `eta = now + 86400` exactly, the pending hash
  was publicly readable for the whole window, `apply_upgrade` before the eta failed with
  **`Error(Contract, #9)`** (`TimelockNotElapsed`), and `cancel_upgrade` cleared it.
* **Bounds enforced** — `set_timelock(0)`, `(3599)` and `(2592001)` all rejected with
  **`Error(Contract, #10)`** (`TimelockOutOfBounds`); the value stayed at 86400.

14 dedicated tests in `governance_test.rs` cover the rest: only the *proposed* address can accept
(run without `mock_all_auths`, so it distinguishes "requires auth" from "requires the right
party"), rotation actually moves authority, `apply_upgrade` genuinely swaps the running code,
shortening the timelock does not accelerate an already-scheduled upgrade, and a pending upgrade
disturbs no balances.

## Closed 2026-08-25 (second pass) — the one-transaction USDC front door

* **`contracts/srrouter`** — `USDC → PT/YT` and back in a single signature, plus
  `claim_yield_to_usdc` and a post-maturity `redeem_py_for_usdc`. 29 tests. Measured against the
  **mainnet** per-transaction caps, worst path first:

  | path | instructions | memory | ledger entries |
  |---|---|---|---|
  | `buy_yt_with_usdc` | 3.7% | **29.1%** | 56/100 |
  | `sell_yt_for_usdc` | 3.0% | 19.1% | 54/100 |
  | `buy_pt_with_usdc` | 2.5% | 12.4% | 48/100 |
  | `sell_pt_for_usdc` | 2.4% | 9.2% | 43/100 |
  | `claim_yield_to_usdc` | 0.9% | 10.6% | 40/100 |
  | `redeem_py_for_usdc` | 1.0% | 10.5% | 37/100 |

  Those are LOCAL measurements. On chain, five of the six run fine — and **`buy_yt_with_usdc` does
  not**, which the local numbers gave no hint of. See "The one path that does not fit" in
  `srstack.md`: each leg succeeds alone, the combination returns `Error(Budget, ExceededLimit)`, and
  four rounds of slimming did not close it. The dApp buys YT in two transactions instead.

  The lesson is the reusable part: **a resource measurement taken against a test fixture is not a
  bound on the real thing.** Blend's local harness is dramatically lighter than the deployed pool.

* **The engine was upgraded through its own timelock**, on chain, as the first real exercise of the
  governance we shipped: `set_timelock(3600)` → `schedule_upgrade` → wait the full hour →
  `apply_upgrade`. `code_hash` moved `a9cdc745…` → `f73e2d91…` (exactly the scheduled hash), and
  every piece of state survived: `total_py` 13650000027, `py_index` 1055935163943, balances and
  solvency all intact, `pending_upgrade` cleared. Timelock restored to 24h afterwards.

* **`Yield::redeem_due_interest_to`** — the engine's one new function, so a router can claim on a
  holder's behalf and unwrap the proceeds without putting an on-chain-derived amount inside a
  wallet-signed transfer. Self-claim stays permissionless; redirecting requires the holder.

* **The v1 monitor was rewritten too** (`scripts/solvency_monitor.mjs`, `tofix.md` #23) — real band
  from chain, PT conservation probe, vault/market probes, and it no longer kills itself on the first
  alarm. Running it revealed that the **deployed** v1 wrapper exposes neither `open_positions()` nor
  `bearer_redeemed()`, so it now degrades loudly rather than guessing silently.

## Closed 2026-08-25

* **Issuer lockdown — rehearsed end to end.** Before: the issuer minted 10 base units of counterfeit
  PT while `total_py` stayed put. After `LOCK_ISSUER=1`: `✓ VERIFIED on chain: no signer with weight
  > 0`, the same payment fails **`TxBadAuth`**, and the engine still mints (2,000,000,006 PT). The
  lock closes the hole without bricking the protocol. Two fail-closed pre-flights guard it.
* **Solvency monitor.** `scripts/sr_solvency_monitor.mjs` — six invariants, exits 2 to page. Its
  PT-conservation check (Horizon vs `total_py`) caught the counterfeit above to the stroop.
* **Fixed-Rate Vault.** `contracts/srvault` — 24 tests. Live on testnet: 100 USDC quoted a
  1,012,317,708 payout (a 1.23 USDC coupon = exactly 5% APR over 90 days), inventory
  5,999,999,998 ≥ liability. v1's #18/#21/#22/#24 are absent by construction, not patched.
* **Strategy diff re-reviewed.** The 3-line change writes byte-identical values in the only case the
  old guard skipped; the dip guards still fire. Cost: 1 write entry, 636 bytes. See `AUDITPREP.md` §5.2.
* **Audit preparation.** `AUDITPREP.md` — trust model, seven invariants and where each is enforced,
  the four live-network defect classes, and the open questions we could not settle ourselves.

## Still open before mainnet

1. **Independent audit.** `AUDITPREP.md` is preparation, *not* assurance — nobody outside this work
   has reviewed the code.
2. ~~Issuer lockdown~~ for the new PT SAC (`tofix.md` #13).
3. **Not audited.** `before_yt_change` is the most security-sensitive line in the codebase.
4. ~~No solvency monitor~~ for this stack (`tofix.md` #23).
5. ~~No fixed-rate vault~~ — v2 has no equivalent of v1's flagship product.
6. ~~The `strategy` change~~ in fix #2 means the v2 strategy is no longer byte-identical to the audited
   v1 one. The diff is three lines and is documented in place, but it needs re-review.


---

## Known testnet artifacts — expected, not bugs

Two things this deployment reports that would be alarming on mainnet and are deliberate here:

* **`PT COUNTERFEIT: ... exceeds engine total_py by 11`.** Those 11 base units are the counterfeit PT
  minted **on purpose** during the issuer-lockdown rehearsal, to prove the hole was real before
  closing it. The monitor catching them to the stroop is the rehearsal's result, not a new problem.
  A fresh deployment starts clean.

* **`BLEND UTILIZATION 85.4%`.** Blend's testnet USDC reserve genuinely sits near its ceiling. This
  is `tofix.md` #20's condition occurring naturally, which is the best argument for why
  `Sr::redeem_partial` exists: at this utilization a large withdrawal reverts, and the partial path
  turns that into a smaller withdrawal that succeeds.
