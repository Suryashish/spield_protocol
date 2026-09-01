# MAINNET_LAUNCH.md — exactly what to fund, and what to run

# 🟢 LIVE ON MAINNET — deployed 2026-09-01

**All six contracts are deployed, initialized, wired and verified on the Stellar public network.**
The PT issuer is **locked forever**. The vault is seeded and open. Nothing below is a plan any more —
these are the live addresses.

## Contract addresses

| Contract | Mainnet address |
|---|---|
| **SR** | `CCOZ2JGQAPLUOG5RVU3TLPGSS7WA356BWCOEWFBJU44DKHDRZTQPABBS` |
| **STRATEGY** | `CAJKHGY3J2XSZHI3TFDFMXJ2GDFFUPUPPTUOP6UOBHSY6FW66J6YYBP7` |
| **YIELD** | `CDILIYN4IXUL5H7PJ4TW3GLZ2U6LIZYX35SNN4BGYZWPIXFLJZEFMRLP` |
| **SRMARKET** | `CDRQJ7EYKTJV3W4BE2U4HIAWSVZB675MHTCBDGCXMKVR5VCURMNSEZ7O` |
| **SRVAULT** | `CDNRQ4YLW4RA4LB4J4M5S3X4SEXXR3Z6TR7336VKOG3FPX3PBFAMVZ6P` |
| **SRROUTER** | `CB7O72TTK7OISNS53HXTLCZ2EAY2F5KKYBPGI7ADSIX5KMPGVVDXAALN` |
| **PT_SAC** | `CBGA2TFTSF236VYPI5TVYQ2Z53DKD6LQHIR5DCGKSNIUJ4NAPNBI6VJM` |
| **PT_ASSET_ID** | `SPLDPT:GDNSUOHJIWYXX6HC6ZVDJNLSIBLZMLJYBG7NAN2CRUSXOG4FIDAOH5KN` |
| Blend pool *(external)* | `CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD` |
| USDC SAC *(external)* | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` |

Copy-pasteable, straight from the ledger rather than from this file:

```bash
source scripts/deploy_mainnet_v2.state
for c in SR STRATEGY YIELD SRMARKET SRVAULT SRROUTER PT_SAC PT_ASSET_ID; do
  printf '%-12s %s\n' "$c" "${!c}"
done
```

## Accounts

| Identity | Address | Role now |
|---|---|---|
| `spield_deployer` | `GBUPDAQJPIYQWTJGVPYSBAK5BOHC3DP7ED3AKDAEZ7FJD7NOX56Z7YDF` | **Admin and treasury of all six contracts.** Holds the PT trustline. 92.03 XLM left |
| `spield_pt_issuer` | `GDNSUOHJIWYXX6HC6ZVDJNLSIBLZMLJYBG7NAN2CRUSXOG4FIDAOH5KN` | **🔒 Locked** — every signer weight is 0. PT can only be minted by `YIELD` |
| `spield_admin_multisig` | `GDJ66WMVVH6MWBL4KORY2HOXWLY4UGFCMP64RC474LUJPQCPQUC4RUFL` | Funded, **not yet the admin.** Rotation is a separate day — see [§6](#6-the-multisig-is-a-separate-day) |
| `spield_sig_1` | `GA7BTFN2P4EXZS4MM4QNGLQBAWUZYLCYNACWDCRW74P3QJT4FUB7TF7Z` | Future 2-of-3 signer. Needs no account and no funding |
| `spield_sig_2` | `GAQ3DLLNUE5HPRKYL5JOCSLCD7RHKE3IRCOEHH7DULGXHZZB3V3SAYWP` | Future 2-of-3 signer |
| `spield_sig_3` | `GA3ODKNDDTVKGDONUFBRSO4REMGX6JDJTGZ4X5FTRQU3IOFGKTYFU3KP` | Future 2-of-3 signer |
| `spield_pt_issuer_demo` | `GBNXYAM46QXDKPWKHJLONJQFJJMYOAXCHOPL7G344OIKPGSTVD4FPP7P` | *(lifecycle test only)* Issues `SPLDPTD` for the 90-minute demo series, then locks. **Not part of the live protocol** — see [§11](#11-the-90-minute-demo-series) |

## Live parameters, read back off chain

| Parameter | Value |
|---|---|
| Series expiry | `1790809749` → **2026-09-30 23:09 UTC** (30 days) |
| Vault fixed rate | **300 bps (3.00%)**, ceiling 2000 bps |
| Vault coupon capacity | **2 USDC** seeded — `pt_inventory` / `yt_inventory` both `19999999` |
| SR deposit cap | `500000000` = **50 USDC** TVL ceiling; headroom `480000000` |
| SR total assets | `20000034` (the vault seed, already earning) |
| Paused? | **No** — `sr.is_paused == false` |
| Emissions destination | `spield_deployer` (treasury) |

**Verified after deploy:** 24/24 wiring assertions green, issuer lock confirmed against Horizon
(*"no signer with weight > 0"*), vault rate calibration passed. Total spend ≈ 188 XLM of the
280 funded.

**Still to do, both deliberately manual:** seed the AMM from the dashboard Liquidity page
([§5](#5-the-run)), and rotate admin to the multisig ([§6](#6-the-multisig-is-a-separate-day)).

---

## Original funding sheet — send funds to these

> Kept for the record. These are the numbers that were funded on launch day; the deploy is done.

```
spield_deployer         GBUPDAQJPIYQWTJGVPYSBAK5BOHC3DP7ED3AKDAEZ7FJD7NOX56Z7YDF    280 XLM + 2 USDC
spield_pt_issuer        GDNSUOHJIWYXX6HC6ZVDJNLSIBLZMLJYBG7NAN2CRUSXOG4FIDAOH5KN      6 XLM   (no more — it gets locked)
spield_admin_multisig   GDJ66WMVVH6MWBL4KORY2HOXWLY4UGFCMP64RC474LUJPQCPQUC4RUFL      4 XLM   (only needed at rotation)
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

**Two accounts to launch, three in the plan. ~290 XLM + 2 USDC** (plus whatever you later add as an
LP — 10 USDC suggested). Almost all of it is the deployer's, and almost all of that is the one-time
WASM upload. Of the XLM, **~3.6 is actually
spent** — the rest is headroom and refundable reserves.

| # | Account | **Address — send funds here** | Fund it with | What it is for | What happens to it |
|---|---|---|---|---|---|
| 1 | `spield_deployer` | `GBUPDAQJPIYQWTJGVPYSBAK5BOHC3DP7ED3AKDAEZ7FJD7NOX56Z7YDF` | **280 XLM** + **2 USDC** (+ LP money later) | Deploys all 6 contracts, becomes admin of each, holds the PT trustline, pays every fee, does the seeding | Keep it. Its admin rights move to the multisig later |
| 2 | `spield_pt_issuer` | `GDNSUOHJIWYXX6HC6ZVDJNLSIBLZMLJYBG7NAN2CRUSXOG4FIDAOH5KN` | **6 XLM** | Issues the PT classic asset, hands PT minting to the yield contract | **Locked forever** at deploy step 6b. Anything left inside is unrecoverable |
| 3 | **`spield_admin_multisig`** | `GDJ66WMVVH6MWBL4KORY2HOXWLY4UGFCMP64RC474LUJPQCPQUC4RUFL` | **4 XLM** | Becomes admin of all six contracts once you rotate | Permanent. Created and funded now, **rotated to after launch** — see [§6](#6-the-multisig-is-a-separate-day) |

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

**Quoted by mainnet itself on 2026-09-01** — each upload built and simulated against
`mainnet.sorobanrpc.com`, nothing submitted. These are the network's own numbers, not an extrapolation.

| Contract | Size | Upload fee |
|---|---|---|
| `sr` | 43,005 B | 33.60 XLM |
| `strategy` | 35,474 B | 26.23 XLM |
| `yield` | 45,880 B | 37.89 XLM |
| `srmarket` | 52,996 B | 54.55 XLM |
| `srvault` | 44,111 B | 36.95 XLM |
| `srrouter` | 35,680 B | 28.01 XLM |
| **Six uploads** | **251 KB** | **217.23 XLM** |

| Everything else | |
|---|---|
| 6 contract deploys + ~14 init invokes | **~12 XLM** — the one item still estimated |
| Deployer reserve (2 base + PT + USDC trustlines) | **2.0 XLM** locked |
| Issuer's whole job | **0.006 XLM** |
| **Total** | **≈ 231 XLM**, of which ~2 is locked rather than spent |

**Fund 280.** That is the 231 plus ~20% for a fee move or a resumed run. Unused XLM stays yours.

### Two caveats, stated plainly

* **217.23 is the assembled *max* fee.** Actual charged runs lower — on testnet a quote of 0.2280
  was charged 0.1981, about 15% less. Expect the real spend nearer **190 XLM**.
* **The ~12 XLM for deploys is the only unmeasured number here.** A contract instance is a small
  entry, but a deploy cannot be simulated until its WASM is on chain, so this one is inference.

### Why an earlier version of this file said 60 XLM

It was wrong, and the mistake is worth recording so it is not repeated. An earlier pass measured a
WASM upload **on testnet** and scaled it. Resource fees are not uniform across networks — checked
directly, both ways:

```
read-only invoke   testnet 0.0013 XLM   mainnet 0.0014 XLM   <- effectively identical
WASM upload / KB   testnet 0.0136 XLM   mainnet 0.865  XLM   <- 64x
```

Mainnet prices **rent on large persistent entries** far higher; invokes are unaffected. Because
uploads dominate a deploy, the whole figure collapsed. `MAINNET.md` §4's original ~180 XLM was much
closer to correct than the "corrected" 60 — a conservative estimate was replaced with a confidently
derived wrong one, which is the worse failure.

**Re-quote before you fund**, rather than trusting the table above. Fees are network config and can
change:

```bash
D=$(stellar keys address spield_deployer)
MAIN=(--network-passphrase "Public Global Stellar Network ; September 2015" --rpc-url https://mainnet.sorobanrpc.com)
for c in sr strategy yield srmarket srvault srrouter; do
  stellar contract upload --wasm target/wasm32v1-none/release/spield_$c.wasm \
    --source-account "$D" "${MAIN[@]}" --build-only 2>/dev/null \
  | stellar tx simulate --source-account "$D" "${MAIN[@]}" 2>/dev/null \
  | stellar tx decode --output json 2>/dev/null \
  | python3 -c "import sys,json;d=json.load(sys.stdin);t=d['tx']['tx'] if 'tx' in d.get('tx',{}) else d['tx'];print('$c',int(t['fee'])/1e7,'XLM')"
done
```

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
GBUPDAQJPIYQWTJGVPYSBAK5BOHC3DP7ED3AKDAEZ7FJD7NOX56Z7YDF   280 XLM + 2 USDC
GDNSUOHJIWYXX6HC6ZVDJNLSIBLZMLJYBG7NAN2CRUSXOG4FIDAOH5KN     6 XLM  — no more, it gets locked
GDJ66WMVVH6MWBL4KORY2HOXWLY4UGFCMP64RC474LUJPQCPQUC4RUFL     4 XLM — only needed when you rotate
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
| **`spield_admin_multisig`** | `GDJ66WMVVH6MWBL4KORY2HOXWLY4UGFCMP64RC474LUJPQCPQUC4RUFL` | **yes — 4 XLM** | The account that becomes admin. Its master key gets disabled |
| `spield_sig_1` | `GA7BTFN2P4EXZS4MM4QNGLQBAWUZYLCYNACWDCRW74P3QJT4FUB7TF7Z` | **no** | Signer keypair — never on chain |
| `spield_sig_2` | `GAQ3DLLNUE5HPRKYL5JOCSLCD7RHKE3IRCOEHH7DULGXHZZB3V3SAYWP` | **no** | Signer keypair — never on chain |
| `spield_sig_3` | `GA3ODKNDDTVKGDONUFBRSO4REMGX6JDJTGZ4X5FTRQU3IOFGKTYFU3KP` | **no** | Signer keypair — never on chain |

**Only the first is an account.** The other three are keypairs — tested 2026-08-31: a key that Horizon
returns **404** for (no ledger account at all) was added as a signer and successfully co-signed a real
admin call. Keep the three secrets apart; a 2-of-3 whose keys all live on one laptop is a 1-of-1
wearing a costume.

### Build it (once, any time)

All four identities already exist (created 2026-09-01, secrets in `wallets.md`). Fund
`spield_admin_multisig` with 4 XLM — the signers need nothing — then:

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

## 7. Deployed contracts

**Deployed 2026-09-01.** This is the table anyone else will look for first, and the one
Deliverable 1 needs as explorer links, so it lives here rather than only in a state file.

| Contract | What it is | Mainnet address |
|---|---|---|
| `SR` | Standardized Return — the share token over the Blend strategy. **The only mint path, so the deposit cap lives here** | `CCOZ2JGQAPLUOG5RVU3TLPGSS7WA356BWCOEWFBJU44DKHDRZTQPABBS` |
| `STRATEGY` | Blend adapter. Holds the actual USDC position | `CAJKHGY3J2XSZHI3TFDFMXJ2GDFFUPUPPTUOP6UOBHSY6FW66J6YYBP7` |
| `YIELD` | PT/YT engine — **and the YT token itself**, because YT needs a transfer hook a SAC cannot provide | `CDILIYN4IXUL5H7PJ4TW3GLZ2U6LIZYX35SNN4BGYZWPIXFLJZEFMRLP` |
| `SRMARKET` | The PT/SR time-decay AMM | `CDRQJ7EYKTJV3W4BE2U4HIAWSVZB675MHTCBDGCXMKVR5VCURMNSEZ7O` |
| `SRVAULT` | The Fixed-Rate Vault — the flagship | `CDNRQ4YLW4RA4LB4J4M5S3X4SEXXR3Z6TR7336VKOG3FPX3PBFAMVZ6P` |
| `SRROUTER` | Single-signature USDC flows. **No privileges, no balances, by construction** | `CB7O72TTK7OISNS53HXTLCZ2EAY2F5KKYBPGI7ADSIX5KMPGVVDXAALN` |
| `PT_SAC` | PT as a Stellar Asset Contract | `CBGA2TFTSF236VYPI5TVYQ2Z53DKD6LQHIR5DCGKSNIUJ4NAPNBI6VJM` |
| `PT_ASSET_ID` | The classic asset, `CODE:ISSUER` | `SPLDPT:GDNSUOHJIWYXX6HC6ZVDJNLSIBLZMLJYBG7NAN2CRUSXOG4FIDAOH5KN` |
| Blend pool | FixedV2 — an external dependency, not ours | `CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD` |
| USDC | Circle's mainnet USDC SAC — external | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` |

**Do not transcribe these by hand.** The deploy writes every address to
`scripts/deploy_mainnet_v2.state`; this prints the rows ready to paste, so a typo cannot creep in
between the ledger and the doc:

```bash
source scripts/deploy_mainnet_v2.state
for c in SR STRATEGY YIELD SRMARKET SRVAULT SRROUTER PT_SAC; do
  printf '| `%s` | | `%s` |\n' "$c" "${!c}"
done
printf '| `PT_ASSET_ID` | | `%s` |\n' "$PT_ASSET_ID"
```

Explorer links for the evidence pack (Deliverable 1 asks for these as openable links):

```bash
source scripts/deploy_mainnet_v2.state
for c in SR STRATEGY YIELD SRMARKET SRVAULT SRROUTER PT_SAC; do
  echo "$c  https://stellar.expert/explorer/public/contract/${!c}"
done
```

The same addresses must also land in **`frontend/src/lib/config.ts`** (the `mainnet.sr` block, `null`
today) and **`MAINNETCONTRACTADDRESSES.md`** (still listing the retired v1 stack). Three places, one
source — copy from the state file to all three in one sitting rather than from memory later.

---

## 8. Immediately after the deploy

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

## 9. The irreversible list

Read this once before typing `deploy`.

| Action | Why it cannot be undone |
|---|---|
| **The issuer lockdown** | Master weight → 0. The account can never sign again, and its remaining XLM is gone. This is the *correct* end state — a live issuer could mint counterfeit PT forever — but fund it minimally |
| **The maturity** | `EXPIRY` is set once at `yield.initialize`. There is no `set_maturity` and no roll function. A new maturity means a new stack **and a new issuer** |
| **The PT asset identity** | `SPLDPT:<issuer>`. A new issuer means a different asset |

Everything else is recoverable: the cap is one `set_deposit_cap` call, the rate is forward-only via
`set_rate`, pause is reversible, and upgrades are timelocked with a cancel path.

---

## 10. The honest status

* The contracts are **not audited**. The deposit cap is what makes that survivable, and the UI says so
  in plain words on the risk panel.
* `deposit` is capped globally; `redeem` never consults the cap, so **nobody can be trapped**.
* The cap is **not per-user** — with 48 USDC of live headroom (50 cap, 2 consumed by the vault seed),
  one address can take all of it.
* A deep Blend bad-debt event freezes withdrawals until backing recovers, with no bounded recovery
  time. This is disclosed in the app, not only in the tracker.

---

## 11. The 90-minute demo series

A **second, throwaway mainnet deployment** whose only job is to walk a complete
deposit → maturity → redeem cycle in 90 minutes, because the live series cannot be redeemed until
2026-09-30. Same six contracts, same code, separate instances. **Not part of the live protocol.**

**No new script.** `deploy_mainnet.sh` is fully parameterized; the demo is the same script with
different env:

```bash
STATE_FILE=scripts/deploy_mainnet_demo.state \
EXPIRY=$(( $(date +%s) + 5400 )) \
ISSUER=spield_pt_issuer_demo PT_CODE=SPLDPTD \
SR_DEPOSIT_CAP=200000000 \
VAULT_SEED_AMOUNT=5000000 SEED=1 SEED_PER_SIDE=2500000 \
MIN_DEPLOYER_XLM=5 WANT_DEPLOYER_XLM=6 MIN_ISSUER_XLM=2 WANT_ISSUER_XLM=2 \
CONFIRM=1 bash ./scripts/deploy_mainnet.sh
```

Five of those are load-bearing:

| Variable | Why it is not optional |
|---|---|
| `EXPIRY` | The script derives expiry from `MATURITY_DAYS*86400`, which cannot express 90 minutes. `EXPIRY` overrides it outright |
| `STATE_FILE` | Without it the script reads `deploy_mainnet_v2.state`, finds `DEPLOY_COMPLETE=1`, and skips the entire run |
| `ISSUER` | `spield_pt_issuer` is **locked forever** and can never issue another asset. Only the issuer must be new — `spield_deployer` is reused, it is just a fee payer and admin holder |
| `PT_CODE` | v1 and v2 already share `SPLDPT` under different issuers. A third collision is not worth the confusion |
| `MIN_DEPLOYER_XLM` | The preflight sums `q_upload()` per undeployed contract and would demand **~220 XLM** for uploads that are now free. It must be told otherwise |

### It costs ~1.3 XLM, not 280

The 217 XLM of the first launch was **WASM uploads**. Those code entries now exist on mainnet and a
second deployment reuses them — you pay to notice they are there, not to store them again. Measured
by simulation against `mainnet.sorobanrpc.com` on 2026-09-01:

| | First deploy | Demo deploy |
|---|---|---|
| Six WASM uploads | 217.23 XLM | **0.146 XLM** |
| Six contract instances | (included above) | **0.321 XLM** |
| ~22 config/init writes @ 0.0165 | — | ~0.36 XLM |
| PT SAC, trustline, issuer lock, seeds | — | ~0.6 XLM |
| **Total** | ~190 XLM | **~1.3 XLM** |

Fund **6 XLM** to the deployer (it holds 3.03, and the new `SPLDPTD` trustline raises its locked
reserve to 2.5) and **2 XLM** to the demo issuer, of which 1 XLM is account reserve that locks with
it and ~0.99 is simply lost. Plus **1.5 USDC** to the deployer: 0.5 vault seed, 0.5 AMM seed
(0.25/side), 0.5 to deposit as a test user.

### 90 minutes is tradeable — verified, not assumed

The concern was `rate_scalar = scalar_root / years_to_expiry`, which "steepens without bound as
expiry nears": at 90 minutes that divisor is ~250,000x smaller than at 30 days. Probed locally
against the srmarket suite:

```
30 days     implied APY   3.0000%  PT price 0.99757346
            swap 5000000 SR -> 5005860 PT   (rate after 1.6895%)
90 minutes  implied APY   3.0000%  PT price 0.99999494
            swap 5000000 SR -> 5000011 PT   (rate after 3.0000%, round-trip loss 29 stroops)
```

No overflow, opens at exactly the configured rate, swaps round-trip cleanly. The curve simply goes
flat, which is correct — PT is 90 minutes from par.

### The yield will read as zero, and that is not a bug

90 minutes is 0.017% of a year. At 300 bps a 10 USDC deposit earns **0.000051 USDC** — it renders as
`0.0000` everywhere in the UI. Seeing a number move would need roughly **5,800 bps**, which the
calibration gate refuses without `VAULT_RATE_OVERRIDE=1` and a raised `VAULT_MAX_RATE_BPS`. Do not
bother: what this series proves is that deposit → receipt → maturity → redeem works on mainnet, and
an invented rate does not help prove it.

**The clock starts at deploy.** `ensure_can_trade` panics with `SeriesExpired` once
`timestamp >= expiry`, so trading and minting stop after 90 minutes and the stack becomes
redeem-only — which is the half being tested.

### Frontend

A boolean, not a third network. `VITE_MAINNET_DEMO=true` swaps the contract addresses while
`NETWORK_KEY` stays `'mainnet'`, so every `NETWORK_KEY === 'mainnet'` branch — Solana chain
selection, EVM chain list, the event indexer, the bridge default — keeps behaving correctly. A third
`NetworkKey` value would have silently sent all four down their testnet paths.

**Related:** `MAINNET.md` (full reference) · `left.md` (what is left and why) · `DRILLS.md` (the
rehearsed emergency procedures and their timings) · `notcovered.md` (deliverable-by-deliverable status).
