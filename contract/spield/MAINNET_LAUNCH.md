# MAINNET_LAUNCH.md — exactly what to fund, and what to run

## Addresses — send funds to these

```
spield_deployer         GBUPDAQJPIYQWTJGVPYSBAK5BOHC3DP7ED3AKDAEZ7FJD7NOX56Z7YDF     60 XLM + 2 USDC
spield_pt_issuer        GDNSUOHJIWYXX6HC6ZVDJNLSIBLZMLJYBG7NAN2CRUSXOG4FIDAOH5KN      6 XLM   (no more — it gets locked)
spield_admin_multisig   GDJ66WMVVH6MWBL4KORY2HOXWLY4UGFCMP64RC474LUJPQCPQUC4RUFL     10 XLM   (only needed at rotation)
```

Created 2026-09-01. Secrets are in `wallets.md` — gitignored, mode 600, **back it up offline before
you send anything**. Everything below explains these three numbers.

---

**The launch-day sheet.** `MAINNET.md` is the reference manual — every parameter, every hardening
option, every recovery path. This file is the short answer to two questions: **how many accounts do I
need, and how much do I put in them.**

Written 2026-08-31. Every XLM figure here was **measured**, not estimated — see
[What it really costs](#what-it-really-costs) for the receipts.

---

## 1. The answer in one table

**Two accounts to launch, three in the plan. 76 XLM + 2 USDC** (plus whatever you later add as an
LP — 10 USDC suggested). Of the XLM, **~3.6 is actually
spent** — the rest is headroom and refundable reserves.

| # | Account | **Address — send funds here** | Fund it with | What it is for | What happens to it |
|---|---|---|---|---|---|
| 1 | `spield_deployer` | `GBUPDAQJPIYQWTJGVPYSBAK5BOHC3DP7ED3AKDAEZ7FJD7NOX56Z7YDF` | **60 XLM** + **2 USDC** (+ LP money later) | Deploys all 6 contracts, becomes admin of each, holds the PT trustline, pays every fee, does the seeding | Keep it. Its admin rights move to the multisig later |
| 2 | `spield_pt_issuer` | `GDNSUOHJIWYXX6HC6ZVDJNLSIBLZMLJYBG7NAN2CRUSXOG4FIDAOH5KN` | **6 XLM** | Issues the PT classic asset, hands PT minting to the yield contract | **Locked forever** at deploy step 6b. Anything left inside is unrecoverable |
| 3 | **`spield_admin_multisig`** | `GDJ66WMVVH6MWBL4KORY2HOXWLY4UGFCMP64RC474LUJPQCPQUC4RUFL` | **10 XLM** | Becomes admin of all six contracts once you rotate | Permanent. Created and funded now, **rotated to after launch** — see [§6](#6-the-multisig-is-a-separate-day) |

> **Created 2026-09-01.** All three exist locally as `stellar keys` identities and hold **no XLM yet** —
> they are not on chain until you fund them. Secrets are in `wallets.md`, which is gitignored and
> mode 600. **Back it up offline before you send anything:** lose `spield_deployer` and you lose admin
> of the protocol, with no recovery.

**Launch needs only 2 USDC** — the vault's coupon capacity. The AMM is seeded separately, by you,
from the dashboard's Liquidity page whenever you like; **10 USDC (5 per side) is the suggested
starting size**. See [§3](#3-usdc--how-much-and-where-it-goes).

**The three multisig signer keys need no accounts and no funding** — `spield_sig_1`, `spield_sig_2`,
`spield_sig_3` are keypairs, nothing more. Only `spield_admin_multisig` is funded.

> **Fund the issuer minimally.** Locking sets its master weight to 0, after which it cannot authorise
> anything — including sending its own XLM out. It spends **0.006 XLM** doing its whole job and needs
> 1 XLM of account reserve. 6 XLM is already generous; 60 would strand 59 of them permanently.

### Do I need more accounts?

| Also needed if… | Accounts | Note |
|---|---|---|
| You run a short validation series first to get a redeem tx hash | **one more issuer** | Each series locks its own issuer irreversibly, so series 2 cannot reuse series 1's. Fund it 6 XLM, and expect to strand ~5 |
| You want fees paid somewhere other than the deployer | a treasury account | `TREASURY_KEY` defaults to `SOURCE`. Optional |

---

## 2. What it really costs

Measured on 2026-08-31, on chain, not taken from the old budget:

| Item | Measured | How |
|---|---|---|
| **WASM install, one time** | **≈ 3.4 XLM** | A 14.6 KB WASM uploaded for **0.198 XLM** (`0.0136 XLM/KB`); the six contracts total **251 KB** |
| **Deploy + initialize all 6** | **≈ 0.15 XLM** | One contract deploy + one invoke measured at **0.0274 XLM**; the run is 6 deploys and ~14 invokes |
| Deployer account reserve | 1.0 XLM | `(2 + 0 subentries) × 0.5` |
| Deployer PT trustline | 0.5 XLM | one subentry |
| Issuer account reserve | 1.0 XLM | |
| Issuer's own transactions | 0.006 XLM | SAC deploy + `set_admin` + the lockdown |
| Classic-asset work (issuance, SAC deploy, `set_admin`, lockdown) | 0.006 XLM | measured on the issuer |
| **Total actually spent** | **≈ 3.6 XLM** | dominated entirely by the one-time WASM install |
| **Total locked in reserves** | **≈ 2.5 XLM** | Comes back if an account is ever merged — except the issuer's, which is locked |

**So why fund 60?** Because a stranded half-deploy on mainnet is expensive to unpick and 60 XLM is
not. That is **~16× the measured spend** — it covers a fee spike, a mid-run retry, a second series,
and the post-launch admin calls. It is **not** because the deploy needs it.

> **Checked, because it is a big claim:** the only extrapolated number here is the WASM install. A
> 14.6 KB upload cost 0.198 XLM and Soroban's upload fee scales with entry size and its initial rent,
> both linear in bytes — so 251 KB across six uploads lands near 3.4 XLM. Everything else in the
> table was measured directly.

> `MAINNET.md` §4 and `left.md` §B quote **≈180 XLM**. That figure predates this measurement and is
> roughly **36× the real cost**. It is not dangerous — unused XLM just sits there — but do not read it
> as a requirement. The deploy script's own preflight now uses the measured figures.

**Fees are protocol-determined, so testnet and mainnet resource costs are the same.** The one thing
that can differ is the *inclusion* fee under network congestion, which is a few stroops.

---

## 3. USDC — how much, and where it goes

**You can deploy and initialise the entire protocol with zero USDC.** Every `initialize` is a config
write paid in XLM. USDC only makes the vault and the market *usable*.

Two seeds, both paid by `spield_deployer`, both scripted — **you never touch the LP page by hand**:

| Seed | How to set it | USDC it spends |
|---|---|---|
| Vault coupon capacity | `VAULT_SEED_AMOUNT=20000000` | **2** |
| AMM liquidity | `SEED=1 SEED_PER_SIDE=100000000` | **20** (`SEED_PER_SIDE × 2`) |
| | **Needed on launch day** | **2 USDC** |

### Why 2 USDC of capacity is enough

**The depositor brings their own principal.** Measured on chain: seeding 5 USDC gave `pt_inventory`
5.0 USDC, then a 1 USDC deposit *raised* inventory to 6.0 and consumed only **86 stroops** of
`coupon_capacity` — the 19-stroop coupon plus a 66-stroop per-receipt reserve. The seed backs
**coupons only**, never principal.

At 3.00% over 30 days a coupon is 0.247% of the deposit. With a 50 USDC cap:

| Vault seed | Room left for users | Coupons those users could owe | Margin |
|---|---|---|---|
| **2 USDC** | 48 | **0.118 USDC** | **17×** |
| 5 USDC | 45 | 0.111 USDC | 45× |

**2 USDC covers the entire cap seventeen times over**, and frees 3 USDC of cap for real users. Going
lower still works arithmetically, but 2 leaves obvious headroom for a second series or a cap raise
without another seeding trip.

### The trap: your own seeding eats the cap

`SR_DEPOSIT_CAP` is a **global TVL ceiling**, and both seeds go through the same `sr::deposit` path as
a user. Verified in the code: `srvault::seed → acquire_py → SrClient::deposit`, and the AMM seed calls
`sr deposit` directly before stripping.

```
cap  =  what you seed  +  what you will let users deposit
```

With the default 50 USDC cap:

| | Vault seed | AMM seed | Consumed | **Left for users** |
|---|---|---|---|---|
| **Launch day** (vault only) | 2 | 0 | 2 | **48 USDC** |
| After you add 10 USDC of LP | 2 | 10 | 12 | **38 USDC** |
| If you add 20 instead | 2 | 20 | 22 | **28 USDC** |

You cannot fix this afterwards by lowering the cap: it compares against *current* TVL, so setting it
below what is already deposited blocks **all** new deposits. Verified live on testnet — cap 5 USDC
against 93.98 TVL, and a 1 USDC deposit reverted with `DepositCapExceeded` (#107).

Check the result with `sr::deposit_headroom()`, which returns exactly what is left for users.

*(7 decimals: 2 USDC = `20000000`, 10 USDC = `100000000`, 50 USDC = `500000000`.)*

### Do I have to seed the AMM at deploy time? **No — you can do it later, from the app.**

**Tested 2026-08-31 on a stack the deploy left empty.** Adding the first liquidity to a pool with
`reserves = [0,0]` succeeded, using exactly the three operations the dApp exposes:

| Step | dApp page | Contract call |
|---|---|---|
| 1 | Deposit / SR Wrapper | `sr.deposit` |
| 2 | Yield | `yield.mint_py` (SR → PT + YT) |
| 3 | Liquidity | `srmarket.add_liquidity` |

Result: `reserves ["4999999","4734961"]`, an LP position was minted, and — importantly — **the implied
APY stayed at exactly 3.0000%**. The market's rate anchor is set at `initialize`, *not* by whoever adds
liquidity first, so seeding late does not open the market at a different rate than the vault quotes.

**So the AMM seed is genuinely optional on launch day.** Launch with 2 USDC, watch it, and provide
liquidity through the app whenever you like.

### How small can the AMM be?

Price impact is a function of **what fraction of the pool one trade consumes**, so a thin pool makes
the headline rate jump around. Measured on testnet 2026-08-31, on a deliberately tiny pool:

> **0.5 USDC per side. A 0.1 USDC trade — about 21% of one side — moved the implied APY
> 3.0000% → 2.7233%: a 28 bps swing from ten cents.**

Scaling that by the fraction consumed (the curve is convex, so bigger bites are worse than linear):

| AMM seed | Per side | A **1 USDC** trade is… | Rate move | Verdict |
|---|---|---|---|---|
| 20 USDC | 10 | 10% of a side | ~13 bps | Comfortable |
| **10 USDC** | **5** | **20% of a side** | **~27 bps** | **Fine for a guarded launch** |
| 6 USDC | 3 | 33% of a side | ~45 bps+ | Visibly jumpy |
| 4 USDC | 2 | 50% of a side | 65 bps+ | The headline becomes noise |

**Why it matters, and why it is cosmetic rather than dangerous:** the dashboard shows the market's
implied APY next to the vault's fixed 3.00%. On a thin pool one small trade drags them visibly apart
— exactly the 3.00%-vs-4.72% mismatch the live testnet stack still shows. Nothing is unsafe: a market
rate is *discovered* and funded by whoever sells PT, while the vault rate is *promised* and funded by
the vault's own inventory. It just looks wrong.

**Recommendation: 10 USDC (5 per side) is a sensible floor**, and it frees 10 USDC of cap versus a 20
USDC seed. Since you are providing it yourself from the Liquidity page, start there and top up if the
rate looks jumpy — adding more later is proven to work and does not move the anchor.

One thing it does **not** avoid: step 1 is `sr.deposit`, so becoming an LP later **still consumes the
deposit cap** exactly as the scripted seed would. It changes *when* you spend the USDC, not whether it
counts.

Without any AMM the vault still works end to end — deposit, fixed receipt, redeem at maturity — but
there is no secondary market, so no one can exit a PT position early and the Markets page is empty.

---

## 4. Before you start

```bash
stellar --version     # >= 22
curl --version ; python3 --version ; node --version ; bc --version
```

**There is no friendbot on mainnet.** Both accounts must already exist on chain with XLM in them,
sent from an exchange or an account you already control. The deploy script checks this up front and
**refuses to start** rather than dying half-deployed — warns below 60/6, refuses below 20/3, and
refuses outright if Horizon is unreachable rather than deploying blind.

**All three identities already exist** (created 2026-09-01, addresses in [§1](#1-the-answer-in-one-table),
secrets in `wallets.md`). Nothing to generate — just fund them:

```
GBUPDAQJPIYQWTJGVPYSBAK5BOHC3DP7ED3AKDAEZ7FJD7NOX56Z7YDF    60 XLM + 2 USDC
GDNSUOHJIWYXX6HC6ZVDJNLSIBLZMLJYBG7NAN2CRUSXOG4FIDAOH5KN     6 XLM  — no more, it gets locked
GDJ66WMVVH6MWBL4KORY2HOXWLY4UGFCMP64RC474LUJPQCPQUC4RUFL    10 XLM — only needed when you rotate
```

Verify they landed before you start:

```bash
for k in spield_deployer spield_pt_issuer spield_admin_multisig; do
  echo "$k $(curl -s https://horizon.stellar.org/accounts/$(stellar keys address $k) \
    | python3 -c 'import sys,json;d=json.load(sys.stdin);print([b["balance"] for b in d.get("balances",[]) if b["asset_type"]=="native"] or "NO ACCOUNT")')"
done
```

**Run the rate calibration by hand first**, so a failure is not a surprise on the day. The deploy runs
it as a hard gate before `vault.initialize` and will stop if 3.00% no longer clears:

```bash
node scripts/calibrate_vault_rate.mjs \
  --pool CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD \
  --underlying CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75 \
  --rpc https://mainnet.sorobanrpc.com \
  --passphrase "Public Global Stellar Network ; September 2015" \
  --yield-fee 500 --rate 300 --max-apr 30000 --check
```

---

## 5. The run

```bash
./scripts/deploy_mainnet.sh
```

`VAULT_SEED_AMOUNT` now **defaults to 2 USDC** (`20000000`), so the plain command is the launch you
want: vault seeded, no AMM, 48 USDC of cap left for users. You add liquidity yourself afterwards from
the dashboard's **Liquidity** page.

If you would rather the script seed the AMM too:

```bash
SEED=1 SEED_PER_SIDE=50000000 ./scripts/deploy_mainnet.sh   # 10 USDC of AMM (5 per side)
```

It prints a summary and waits for you to type `deploy`. It is **resumable** — if a step fails, fix the
cause and re-run; completed steps are skipped from `deploy_mainnet_v2.state`.

**What ships by default** (all overridable):

| | |
|---|---|
| Blend pool | `CAJJZSGMMM…` — FixedV2, not YieldBloxV2 |
| USDC | Circle's real mainnet USDC |
| Deposit cap | 50 USDC (`500000000`) |
| Maturity | **30 days**, fixed once deployed |
| Vault rate / on-chain ceiling | 300 bps / 2000 bps |
| Market opening APY | derives from the vault rate, so the two cannot drift apart at open |
| Yield fee | 500 bps → treasury |
| Issuer lockdown | **on** (`LOCK_ISSUER=0` skips it — never do that on mainnet) |

---

## 6. The multisig is a separate day

**Yes — rotate whenever you like. It is not part of the deploy and nothing about launch day depends
on it.** `deploy_mainnet.sh` leaves `spield_deployer` as admin of all six contracts, which is a
working, fully operational state. Rotation is a later, independent step.

Doing it afterwards is also the *safer* order: you can launch, watch the protocol behave, and hand
over control once you are satisfied — rather than adding a second unfamiliar procedure to the one day
you least want surprises.

### The accounts, named

| Name | Address | Funded? | Role |
|---|---|---|---|
| **`spield_admin_multisig`** | `GDJ66WMVVH6MWBL4KORY2HOXWLY4UGFCMP64RC474LUJPQCPQUC4RUFL` | **yes — 10 XLM** | The account that becomes admin. Its master key gets disabled |
| `spield_sig_1` | `GA7BTFN2P4EXZS4MM4QNGLQBAWUZYLCYNACWDCRW74P3QJT4FUB7TF7Z` | **no** | Signer keypair — never on chain |
| `spield_sig_2` | `GAQ3DLLNUE5HPRKYL5JOCSLCD7RHKE3IRCOEHH7DULGXHZZB3V3SAYWP` | **no** | Signer keypair — never on chain |
| `spield_sig_3` | `GA3ODKNDDTVKGDONUFBRSO4REMGX6JDJTGZ4X5FTRQU3IOFGKTYFU3KP` | **no** | Signer keypair — never on chain |

**Only the first is an account.** The other three are keypairs — tested 2026-08-31: a key that Horizon
returns **404** for (no ledger account at all) was added as a signer and successfully co-signed a real
admin call. Keep the three secrets apart; a 2-of-3 whose keys all live on one laptop is a 1-of-1
wearing a costume.

### Build it (once, any time)

All four identities already exist (created 2026-09-01, secrets in `wallets.md`). Fund
`spield_admin_multisig` with 10 XLM — the signers need nothing — then:

```bash
for k in spield_sig_1 spield_sig_2 spield_sig_3; do
  stellar tx new set-options --source-account spield_admin_multisig --network mainnet \
    --signer "$(stellar keys address $k)" --signer-weight 1
done

# 2-of-3, and the master key stands down. Do this LAST — it is what makes it a multisig.
stellar tx new set-options --source-account spield_admin_multisig --network mainnet \
  --master-weight 0 --low-threshold 2 --med-threshold 2 --high-threshold 2
```

Soroban calls are **medium-threshold** operations, so `med_threshold` is the one that governs admin
actions. `rotate_admins.sh` prints an account's shape before it touches anything — run
`MODE=verify` against it first and confirm it reads `2-of-3` rather than trusting the commands above.

### Then rotate

```bash
NETWORK=mainnet MODE=verify ./scripts/rotate_admins.sh                       # read-only
NETWORK=mainnet MODE=rotate \
  TO=$(stellar keys address spield_admin_multisig) \
  TO_SIGNERS=spield_sig_1,spield_sig_2 \
  ./scripts/rotate_admins.sh
```

Round-trip tested on testnet against a real 2-of-3: **~108 seconds for all six contracts**, 27
checks, and it proves the old key is powerless *and* the new one is functional before it finishes.
Rotating back works too, so this is reversible as long as you hold the multisig's signers.

**What it costs:** `(2 + signers) × 0.5` XLM of reserve — **2.5 XLM for a 2-of-3** — plus fees. 10 XLM
is comfortable.

> One thing rotation does **not** move: `yield.treasury`, `srmarket.treasury` and
> `strategy.emissions_to`. Those are separate destinations; `MODE=payouts` moves them deliberately.

---

## 7. Immediately after the deploy

```bash
NETWORK=mainnet MODE=verify ./scripts/rotate_admins.sh   # reads only, changes nothing
stellar contract invoke --id <SR> ... -- deposit_headroom # what is left for users
```

Then:

1. **Update `frontend/src/lib/config.ts`** — the `mainnet.sr` block is `null` today, which renders the
   whole v2 UI as unavailable. Fill in the six addresses the deploy prints, then build with
   `VITE_NETWORK=mainnet`.
2. **Update `MAINNETCONTRACTADDRESSES.md`** — it still lists the retired v1 addresses.
3. **Rotate admins to the multisig** when ready: `MODE=rotate TO=<G…> TO_SIGNERS=<csv>`.
   Round-trip tested on testnet; takes ~108 seconds for all six contracts.

---

## 8. The irreversible list

Read this once before typing `deploy`.

| Action | Why it cannot be undone |
|---|---|
| **The issuer lockdown** | Master weight → 0. The account can never sign again, and its remaining XLM is gone. This is the *correct* end state — a live issuer could mint counterfeit PT forever — but fund it minimally |
| **The maturity** | `EXPIRY` is set once at `yield.initialize`. There is no `set_maturity` and no roll function. A new maturity means a new stack **and a new issuer** |
| **The PT asset identity** | `SPLDPT:<issuer>`. A new issuer means a different asset |

Everything else is recoverable: the cap is one `set_deposit_cap` call, the rate is forward-only via
`set_rate`, pause is reversible, and upgrades are timelocked with a cancel path.

---

## 9. The honest status

* The contracts are **not audited**. The deposit cap is what makes that survivable, and the UI says so
  in plain words on the risk panel.
* `deposit` is capped globally; `redeem` never consults the cap, so **nobody can be trapped**.
* The cap is **not per-user** — with 10 USDC of headroom, one address can take all of it.
* A deep Blend bad-debt event freezes withdrawals until backing recovers, with no bounded recovery
  time. This is disclosed in the app, not only in the tracker.

**Related:** `MAINNET.md` (full reference) · `left.md` (what is left and why) · `DRILLS.md` (the
rehearsed emergency procedures and their timings) · `notcovered.md` (deliverable-by-deliverable status).
