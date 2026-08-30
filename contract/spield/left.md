# What's left before mainnet

Last updated **2026-08-29**. Everything below is either not done, or is a decision only you can make.
Anything already finished is deliberately not in this file.

**A** blocks launch. **B** is what it costs. **C** is how to keep the launch small and safe while the
contracts are unaudited. **D** needs your judgement. **E** can ship after launch.

If you only read two things:

* **A3 — seed the vault.** Most likely to be missed, and it breaks the product silently.
* **C — your own seeding consumes the deposit cap.** With the cap at 50 USDC, whatever you seed
  comes out of the same 50.

---

## A. Blockers — mainnet cannot launch without these

### A1. Create and fund two accounts

Neither exists yet. They must be **separate** accounts.

```bash
stellar keys generate spield_deployer      # deploys + owns admin
stellar keys generate spield_pt_issuer     # issues PT, then gets locked forever
```

Then send XLM to both from a funded account. There is **no friendbot on mainnet** — the deploy
script now refuses to run rather than generating an unfunded key that fails halfway through.

The issuer is locked irreversibly during the deploy (`LOCK_ISSUER=0` skips it, but don't).

**Budget:** see `MAINNET.md` §4. Its XLM figures are stack-agnostic and still accurate.

---

### A2. Run the deploy

```bash
./scripts/deploy_mainnet.sh
```

This now deploys the **v2 SR stack**. It will show you a summary and ask you to type `deploy`
before it writes anything.

It is resumable — if a step fails, fix it and re-run; it picks up where it stopped.

Costs XLM only. It spends **no USDC** unless you explicitly pass a seed amount.

---

### A3. Seed the vault — otherwise the product does not work

**This is the one most likely to be missed.** `VAULT_SEED_AMOUNT` defaults to `0`, and a vault with
zero coupon capacity **rejects every single deposit** with `InsufficientCapacity`. The UI will show
a rate nobody can take.

```bash
VAULT_SEED_AMOUNT=<usdc base units> ./scripts/deploy_mainnet.sh
# or afterwards:
stellar contract invoke --id <SRVAULT> ... -- seed --from <admin> --amount <base units>
```

**How much?** The seed is not launch liquidity — it is the subsidy you are agreeing to fund. Size it
using the arithmetic in `blendcalibration.md` §12. Short version: in the worst case the vault drains
about **0.635% of deposits per 90-day series**, so a seed of `S` covers roughly `S / 0.00635` of
deposits. The 50 USDC deposit cap (A4) binds long before that, which is the point.

*(7 decimals: 50 USDC = `500000000`, 20 USDC = `200000000`.)*

---

### A4. Confirm the deposit cap — now 50 USDC by default

`SR_DEPOSIT_CAP` now defaults to **50 USDC** (`500000000`) in both v2 scripts, up from 5. That is a
sensible guarded-launch number *if* your seeding fits inside it — **the cap counts your own seeding
too**, so:

```
cap  =  what you seed  +  what you will let users deposit
```

With a 50 USDC cap, seeding 20 (vault) + 20 (AMM) leaves **10 USDC of user headroom**. Check it with
`sr::deposit_headroom()` after seeding. §C has the full mechanism and worked example.

The cap gates **deposits only** — withdrawals always work, even when the cap sits below current TVL.
Verified on chain. Raising it later is one call:

```bash
stellar contract invoke --id <SR> ... -- set_deposit_cap --cap <base units>
```

*(7 decimals: 50 USDC = `500000000`.)*

### A5. Point the frontend at the new contracts

`website/frontend/src/lib/config.ts` currently has, under `mainnet:`

* the **v1** contract addresses (wrapper / vault / market), and
* `sr: null` — meaning the whole v2 UI renders as unavailable.

After A2, replace those with the addresses the deploy prints, and fill in the `sr` block. Then build
with `VITE_NETWORK=mainnet`.

Also update `MAINNETCONTRACTADDRESSES.md`, which still lists the v1 addresses.

---

### A6. Maturity — ✅ already set to 30 days

`MATURITY_DAYS` now defaults to **30** in both `deploy_mainnet.sh` and `deploy_sr_testnet.sh`.
Nothing to do unless you want a different term; it is fixed once deployed and cannot be changed
mid-series.

A 30-day series cuts the worst-case subsidy by two thirds versus 90 days — see the cost table in §B.

## B. What it costs to launch

All figures are **estimates**, derived by scaling `MAINNET.md` §3 — a budget written for the v1
stack that was itself deliberately 3–4x generous. Nothing here has been measured on mainnet.

### XLM — the only thing deploying actually costs

v2 deploys **6 contracts** (`sr`, `strategy`, `yield`, `srmarket`, `srvault`, `srrouter`) against
v1's 4, and ~242 KB of WASM against v1's ~159 KB. So roughly **1.5x** the v1 budget on both counts.
The issuer does *less* work than in v1 — v2 issues one classic asset (PT) instead of two, because YT
is a contract, not a SAC.

| Account | Comfortable | Bare minimum | What it covers |
|---|---|---|---|
| `spield_deployer` | **≈ 180 XLM** | ~45 XLM | 6 WASM installs + 6 deploys + ~14 init/admin invokes, 1 PT trustline, account reserve, post-deploy admin invokes |
| `spield_pt_issuer` | **≈ 10 XLM** | ~3 XLM | Account reserve, 1 classic-asset issuance + SAC deploy, `set_admin`, the issuer lockdown |
| **Total** | **≈ 190 XLM** | ~50 XLM | |

Fund the comfortable figure. Most of it is **not spent** — account and trustline reserves are
*locked* and come back if you ever merge the account, and unused XLM just sits there. The headroom
exists so a fee spike or a mid-deploy re-run never strands you.

Costs come from three places: base reserves (0.5 XLM per ledger entry), the per-transaction base fee
(negligible), and **Soroban resource + rent fees** for installs/deploys/invokes — which is the real
cost and scales with WASM size. The script runs `wasm-opt` first, so actual spend should land below
these estimates.

### USDC — everything optional, but read §C before choosing amounts

**You can deploy and initialize the entire protocol with zero USDC.** Deploy and every `initialize`
are pure config writes paid in XLM.

| Step | Env var | Default | What it does |
|---|---|---|---|
| Vault coupon capacity | `VAULT_SEED_AMOUNT` | `0` | **Required for the vault to work at all** (A3) |
| AMM liquidity | `SEED=1` + `SEED_PER_SIDE` | off | Spends `SEED_PER_SIDE x 2` |

### The subsidy, at 30 days

From `blendcalibration.md` §12, in Blend's worst modifier state, per series:

| Series length | Coupon owed | Yield earned at the `ir_mod` floor | **Net drain** |
|---|---|---|---|
| 90 days | 0.740% of deposits | 0.105% | **0.635%** |
| **30 days** | **0.247%** | **0.035%** | **0.212%** |

So at 30 days a seed of `S` covers roughly `S / 0.00212` USDC of deposits in the worst case — about
**3x further than a 90-day series**, which is a real argument for the shorter term.

In practice the deposit cap binds long before the seed does, which is exactly what it is for.

---

## C. Guarded launch — how to stay small while unaudited

The goal: run the real thing on mainnet, with real Blend and real USDC, while making it **impossible**
for anyone to put in more than you have decided to risk.

### The good news: one cap already covers everything

I traced this rather than assuming it. **`sr::deposit` is the only path that mints SR** — there is no
other mint function in the contract. And every way into the protocol goes through it:

* **Vault depositors** — `srvault::deposit` calls `acquire_py`, which calls `SrClient::deposit`.
* **Liquidity providers** — adding liquidity needs PT and SR. PT is made by stripping SR. SR only
  comes from `sr::deposit`.
* **Direct SR holders** — obviously.

So `SR_DEPOSIT_CAP` is a **global TVL cap in USDC**, not just a vault cap. **You asked whether LPs
are capped too: they are**, transitively, by the same number. There is no separate LP cap to add.

Secondary trading on the AMM is not capped and does not need to be — it moves existing claims
between people and brings no new USDC into the protocol.

### The trap: your own seeding eats the cap

**This is the thing to get right, and it is easy to get wrong.**

The cap is checked against *total* TVL, and the operator's seeding goes through the same
`sr::deposit` path as everyone else. Both seeds count:

* `vault.seed` → `acquire_py` → `SrClient::deposit` → **counts against the cap**
* the AMM seed → the script calls `sr deposit` first, then strips → **counts against the cap**

So if you deploy with a 50 USDC cap and then seed 50 USDC, **you consume the entire cap and users get
nothing.** Whatever you seed comes out of the same 50.

And you cannot simply lower the cap afterwards to fix it: the cap compares against *current* TVL, so
setting it below what is already deposited blocks **all** new deposits. Verified live on testnet —
cap 5 USDC against 93.98 TVL, and a 1 USDC deposit reverted with `DepositCapExceeded` (#107).

### The order that works

```
cap  =  what you seed  +  what you will let users deposit
```

1. **Deploy** with the cap already set to the final number (seed + user allowance).
2. **Seed** the vault and, if you want one, the AMM.
3. **Check the headroom** — `sr::deposit_headroom()` returns exactly what is left for users.
4. Users can now deposit up to that headroom, and not a stroop more.

A worked example for a deliberately tiny launch:

| | USDC |
|---|---|
| Vault coupon capacity (`VAULT_SEED_AMOUNT`) | 20 |
| AMM seed (`SEED_PER_SIDE` 10, both sides) | 20 |
| **Room left for users** | **10** |
| **`SR_DEPOSIT_CAP`** | **50** (`500000000`) — now the default |

Raising the cap later is a single `set_deposit_cap` call, so start smaller than feels right.

### What the cap does and does not do

| | |
|---|---|
| ✅ Bounds **total** protocol USDC | it is a global TVL ceiling |
| ✅ Covers vault users **and** LPs | same chokepoint, verified |
| ✅ Can never trap anyone | `redeem` never consults it — withdrawals work even when the cap is below TVL |
| ✅ Raisable any time | one admin call, takes effect immediately |
| ❌ **Not** per-user | it is first-come-first-served; one person could take the whole headroom |
| ❌ Does not stop secondary trading | correct — that moves claims, not new money |

**If per-user limits matter to you, the cap does not provide them.** With a 10 USDC headroom one
address can take all of it. For a test launch that is probably fine — it bounds total exposure, which
is what matters — but it is worth knowing before someone asks why they could not deposit.

### Other guards already available

* **`pause`** — the vault and the yield engine both have it. Exits stay open while paused; only new
  entries stop. This is your emergency brake and it does not need a redeploy.
* **A 30-day series (A6)** — the subsidy is committed for 30 days rather than 90, and the whole
  lifecycle can be observed inside a month.
* **`VAULT_MAX_RATE_BPS = 2000`** — a hard on-chain ceiling; even a compromised admin key cannot
  quote more than 20%.
* **The vault's capacity check** — the vault physically cannot promise a coupon it does not already
  hold PT for, so the worst case is that deposits stop, not that someone is short-paid.

### Say it publicly

The contracts are **unaudited** (D2). A cap makes that survivable; it does not make it disclosed.
Whatever the UI says about risk should say that plainly, and the deposit cap should be visible in the
UI — `sr::deposit_headroom()` exists precisely so a frontend can show "X USDC of Y remaining".

---

## D. Decisions only you can make

### D1. What happens if Blend's rate decays

The full explanation is `blendcalibration.md` §12. The one number to know:

> **A 3% promise stops being funded below `ir_mod` = 0.705.**
> Mainnet is at **1.4899** today. The floor is **0.1** — 7x below break-even.
> A real Blend pool (TestnetV2) is sitting on that floor right now.

Nothing breaks if it happens — the vault simply stops accepting deposits once the seed is used up,
and every promise already made still pays in full. But you have two options and it is much better to
pick now than during the event:

* **Lower the rate** for the next series (`set_rate` is forward-only; existing receipts keep theirs), or
* **Keep 3%** and fund the gap out of the seed.

**Also worth doing:** alarm when `ir_mod` approaches **0.705**. `sr_solvency_monitor.mjs` already
reads it on every poll — it is in the same payload it already fetches.

### D2. Security audit

Still open, and `MAINNET.md` flags it as strongly advised — a sibling Blend pool lost $10.8M in
Feb 2026. Your call whether it blocks launch.

### D3. Multisig and admin rotation

Recommended for real TVL, not required to operate. Four admin roles to rotate. The capability is
built; see `MAINNET.md` §6.1. A single offline key is defensible for a small launch.

---

## E. Engineering still open — can follow the launch

### E1. Settle the `available_liquidity()` dispute — do this first

There is a genuine unresolved contradiction, written up in `blendcalibration.md` §7:

* the test harness says the function under-reports what Blend will pay by **18.4x**, but
* `tofix.md` #20 records a real live Blend rejection (`#1207`) that says the opposite.

**I could not reproduce `#1207`.** Until someone does, do not change the function — the current
behaviour is the conservative side of the disagreement.

**What to do:** try to reproduce `#1207` against the live testnet pool. That is the missing
experiment.

### E2. Exit-coverage alert thresholds

Currently 5x warn / 3x critical. Measurement showed a full exit still succeeding at **0.05x**, so
they page far too early. **Blocked on E1** — retuning against a metric whose accuracy is disputed by
18x achieves nothing. (V2_WORK §13.)

### E3. `scalar_root`

Still uncalibrated at 40e12. Not Blend-related — it controls how far a trade moves the market's
quoted rate. (V2_WORK §14.)

### E4. Testnet: the market and the vault disagree

Testnet's AMM quotes **~4.72%** while the vault quotes **3.00%**, so PT currently looks like a better
deal than the vault on the same screen. Not a solvency problem — a market rate is discovered and
funded by whoever sells PT; a vault rate is promised and funded by the vault. But it looks wrong.

Fixing it means reseeding or trading the pool — a liquidity operation, not a config change. **A fresh
mainnet deploy will not have this problem**: the market now opens at the vault's rate automatically.

---

## Quick reference

| Thing | Value | Note |
|---|---|---|
| Vault rate | 300 bps (3.00%) | gate ceiling **312 bps** under v2 |
| Maturity | **30 days** | ✅ set in both v2 scripts |
| Deposit cap | **50 USDC** (`500000000`) | ✅ set in both v2 scripts; counts your seeding too (§C) |
| `ir_mod` break-even | **0.705** | alarm below this |
| XLM to fund | **≈ 190 total** | 180 deployer + 10 issuer, comfortable |
| USDC to deploy | **0** | seeds are opt-in |
| Worst-case subsidy | **0.212% of deposits** | per 30-day series |
| Blend pool | FixedV2 `CAJJZSGMMM…` | not YieldBloxV2 |
| Deploy state file | `deploy_mainnet_v2.state` | separate from the retired v1 run |
| Audit status | **not audited** | §D2 — the cap is what makes this survivable |

**Re-run the rate calibration on the day.** The deploy does it automatically and will stop if the
rate no longer clears, but you do not want that to be a surprise:

```bash
node scripts/calibrate_vault_rate.mjs \
  --pool CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD \
  --underlying CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75 \
  --rpc https://mainnet.sorobanrpc.com \
  --passphrase "Public Global Stellar Network ; September 2015" \
  --yield-fee 500 --rate 300 --max-apr 30000 --check
```
