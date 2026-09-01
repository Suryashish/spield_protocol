# 90MINUTEMARKET.md — the throwaway lifecycle-test series

**Deployed 2026-09-01 03:14:32 UTC · matures 2026-09-01 04:44:32 UTC (`1788237872`).**

A **second, disposable mainnet deployment** whose only purpose is to walk a complete
deposit → maturity → redeem cycle in 90 minutes. The live series
([`MAINNETCONTRACTADDRESSES.md`](MAINNETCONTRACTADDRESSES.md) §1) cannot be redeemed until
2026-09-30, so it cannot produce a redeem transaction hash inside the submission window. This one can.

> ⚠️ **This is not the protocol.** Same code, different contract instances, on real mainnet with real
> USDC. After maturity the contracts are abandoned. Nothing here should ever be linked to as Spield.

---

## Contract addresses

| Contract | Address |
|---|---|
| **SR** | `CAC5KUVAJENSRWLXH56JYKATIPLQPBYPABRGQERYQWZD4LNAHJZCRFQA` |
| **Strategy** | `CDWLAKWQ3OEIBRHNUN3KHS2WS7SCJF7RY372ZLUQFKJKU4H7XTJKKWTI` |
| **Yield** (*and the YT token*) | `CDAQBKP2AAJJPHAHAUDDLNHIWIVTTWAE3VOKPAWLS3LJCIZHHH6D7P7P` |
| **SR Market** | `CDBVFJ4JAF7EPA4Y54FZKBOEU2WJV5VRJGSZP7JMZHYDQV7S7IPGBSNQ` |
| **SR Vault** | `CBBHJYH4I2IEJINCOAVUE3NRLVLMAXCYKKCCT3APV6D5KG32XJLG37WQ` |
| **SR Router** | `CBZSOMWSXLNVGU6NXME6TLQUGGWHIE4SEWP2PMEJH5GVX7YN5U2VAOGZ` |
| **PT SAC** | `CBYMGIRO4VTTMWRN7G44GLEFPC2QXRWIVVGLBYOX2QW5WLBD34UMMRUY` |
| **PT asset** | `SPLDPTD:GBNXYAM46QXDKPWKHJLONJQFJJMYOAXCHOPL7G344OIKPGSTVD4FPP7P` |
| Blend pool *(external)* | `CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD` |
| USDC SAC *(external)* | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` |

State file: [`scripts/deploy_mainnet_demo.state`](scripts/deploy_mainnet_demo.state) (`DEPLOY_COMPLETE=1`).

> **The PT ticker collides on purpose-adjacent ground.** The live series issues `SPLDPT`; this one
> issues `SPLDPTD` from a **different issuer**. v1 and v2 already share `SPLDPT` under different
> issuers — always compare the full `CODE:ISSUER`, never the code alone.

## Accounts

| Identity | Address | Role |
|---|---|---|
| `spield_deployer` | `GBUPDAQJPIYQWTJGVPYSBAK5BOHC3DP7ED3AKDAEZ7FJD7NOX56Z7YDF` | Reused from the live series — admin and treasury here too. Only the issuer had to be new |
| `spield_pt_issuer_demo` | `GBNXYAM46QXDKPWKHJLONJQFJJMYOAXCHOPL7G344OIKPGSTVD4FPP7P` | Issues `SPLDPTD`. **🔒 Locked** — verified on Horizon, no signer with weight > 0 |

`spield_pt_issuer` (the live series') is locked forever and can never issue another asset, which is
the whole reason a new issuer exists. Secrets are in `wallets.md` — gitignored, mode 600.

## Live parameters, read back off chain

| Parameter | Value |
|---|---|
| Expiry | `1788237872` → **2026-09-01 04:44:32 UTC** |
| Vault fixed rate | **300 bps**, ceiling 2000 bps |
| Vault coupon capacity | **0.1 USDC** — `pt_inventory` = `yt_inventory` = `999999` |
| SR deposit cap | `200000000` = **20 USDC**; headroom `194000000` |
| AMM reserves | `[2499999, 2187494]` — 0.25 USDC per side |
| Implied APY | `29999999993` = **3.0000%** |
| PT price | `999995433468` = **0.999995** |
| Paused? | No |

**27/27 wiring assertions passed.** Issuer lock confirmed against Horizon.

## What it cost

| | |
|---|---|
| XLM | **~1.28** (deployer went 6.03 → 4.76) |
| USDC | **0.60** — 0.10 vault seed + 0.50 AMM (0.25/side) |

Because the six WASMs were already uploaded by the live deployment, the code entries existed and the
uploads were near-free. The first launch paid **217 XLM** for those same uploads; this one paid
**0.146**. Re-deploying an already-published contract costs the price of noticing it is there.

## Using it from the frontend

```
VITE_NETWORK=mainnet
VITE_MAINNET_DEMO=true
```

`NETWORK_KEY` deliberately stays `'mainnet'`. Only the SR addresses swap — passphrase, RPC, explorer
and the v1 contract set are all still real mainnet, because this **is** real mainnet.

A third `NetworkKey` value was the obvious design and the wrong one: four places branch on
`NETWORK_KEY === 'mainnet'` (Solana chain selection, the EVM chain list, the event indexer network,
the bridge's default source) and every one of them would have silently taken its *testnet* path while
the app kept talking to mainnet contracts.

With the flag on, `DemoBanner` renders a permanent banner. A demo build is otherwise
indistinguishable from the real app — same domain, same styling, real USDC, real fees — so the flag
that swaps the addresses also has to say so on screen.

## The lifecycle to walk

The deployer has **0.1 USDC** left, which is one test cycle at a time. A matured receipt redeems back
to you, so run them in sequence.

1. **Deposit page** — deposit `0.1` USDC into the Fixed Vault. Record the tx hash.
2. Wait for maturity (**04:44:32 UTC**).
3. **Redeem** the receipt. Record the tx hash. *This is the pair Deliverable 1 needs.*
4. Optional, before maturity: mint PT+YT, trade against the AMM (it fills up to **0.10 USDC**), or
   add liquidity.

**Trading stops at maturity.** `ensure_can_trade` panics with `SeriesExpired` once
`timestamp >= expiry`, so mint, swap and add-liquidity all close; only redeem remains.

## What the numbers will look like

**The yield reads as zero, and that is correct.** 90 minutes is 0.017% of a year, so at 300 bps a
1 USDC deposit earns **85 stroops** — `0.0000085 USDC`, which renders as `0.0000`. Measured:

| Deposit | Coupon |
|---|---|
| 0.01 USDC | +0 *(floors to zero)* |
| 0.10 USDC | +8 stroops |
| 1.00 USDC | +85 stroops |
| 10.00 USDC | +856 stroops |

Making it visible would need roughly **5,800 bps**, which the calibration gate refuses without
`VAULT_RATE_OVERRIDE=1` and a raised ceiling. Not worth it: this series proves the *mechanics* work
on mainnet, and an invented rate does not help prove that.

## Recovering what you can

The **0.50 USDC in the AMM is recoverable** — Remove Liquidity returns PT + SR; the PT redeems at par
after maturity and the SR unwraps to USDC. Treat the **0.10 vault seed as spent**: `seed` is
admin-only and has no matching withdraw.

## Afterwards

Set `VITE_MAINNET_DEMO=false` (or drop it) and the build points back at the live series with no other
change. Leave this file as the record of the two tx hashes.

---

**Related:** [`MAINNETCONTRACTADDRESSES.md`](MAINNETCONTRACTADDRESSES.md) (the live series) ·
[`MAINNET_LAUNCH.md`](MAINNET_LAUNCH.md) §11 (why this exists) · [`DRILLS.md`](DRILLS.md)
