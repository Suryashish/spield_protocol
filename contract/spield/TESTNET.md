# Spield v2 — Testnet Deployment Guide

This document has everything needed to deploy the Spield contracts to **Stellar testnet** and run
a live end-to-end demo against a **real Blend v2 pool**. The contracts are already fully verified
in unit tests against the real Blend WASM (23 tests pass — see [README.md](README.md)); this is the
on-chain liveness step.

## ✅ LIVE DEPLOYMENT (verified 2026-06-05)

Deployed and exercised on testnet against the real Blend TestnetV2 pool:

| Contract | Address |
| --- | --- |
| **wrapper** | `CB32IGGJ4PKLUBMXJD2VSS3U55XX2U4AQCSKA6QPFGGWZDQBJXMIYZU5` |
| strategy (Blend adapter) | `CBYFCJVZFGX7BIUQMWQ4WXOYC6HZYF7RLC3ZENY5GG6TL37QY5K5KMNA` |
| PT (SAC) | `CAIC4Z6SUN4QGLIQ3CFS4447GMTBV3WJHWZLIDDAZFMUYWZXOIBPV4G2` |
| YT (SAC) | `CDMEEJDXMKR7OH2JLX5OPXLRAGB3UBVEEH6NPTZOBYUPAINNH665V2H3` |
| PT/YT issuer | `GAG6EBUM6ERD5OIAJA53GEFRGS6UYUXHQBTPFTJDAY732Z5ERRRFNU24` (`spield_issuer`) |

**Verified on-chain:** `mint` of 10 USDC → alice's USDC went 10 → 0, received 10 PT + 10 YT,
position 0 recorded with the real Blend `entry_rate = 1.0557` and `shares = 94719428` (real Blend
bTokens; note shares < principal because entry_rate > 1.0 — handled by share-based yield math).
`solvency()` returned `backing=99999999, principal=100000000` (within 1 stroop, invariant holds).
`claim_yield`/`redeem_pt` are callable; on live testnet you must wait for real time to pass before
`b_rate` rises enough to show non-zero claimable yield (unit tests fast-forward a year to prove it).

> ⚠️ One gotcha that bit us: PT/YT must be issued by a **dedicated issuer account**, NOT a user that
> will hold them — a Stellar asset issuer can't receive its own asset ("operation invalid on
> issuer"). The deploy script now uses a separate `spield_issuer` identity. If you re-run it for a
> different holder, that holder needs PT/YT trustlines first (the script adds them for the deployer).

> All commands run through WSL — see [howtoaccesswsl.md](../../howtoaccesswsl.md). Prefix with
> `wsl -e bash -lic "cd '/mnt/f/.../contract/spield' && <cmd>"`.

---

## 1. The blocker right now: test USDC

To supply into the **shared Blend TestnetV2 pool**, our account needs that pool's USDC, which is a
test token **mintable only by the Blend team's issuer key** (we don't have it). So someone has to
*send* us some.

### The two addresses you need

| What | Address |
| --- | --- |
| **Our testnet account (`alice`)** — send USDC here | `GBNK7ZOQIZL3HM2LPY7WWJJL3C5YCOEUIJAF4UBSPIEWCEIC2HFSBVVI` |
| **The USDC asset to send** (classic asset) | `USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56` |
| Same USDC as a Soroban contract (SAC) | `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU` |

✅ **`alice` already has the USDC trustline set up** (so a payment will go through; it won't bounce).
Just send any amount (e.g. 100–1000 USDC) of `USDC:GATALTGT...` to `GBNK7ZOQ...` and the deploy
script below will run end-to-end.

To check alice's balance any time:
```bash
curl -s 'https://horizon-testnet.stellar.org/accounts/GBNK7ZOQIZL3HM2LPY7WWJJL3C5YCOEUIJAF4UBSPIEWCEIC2HFSBVVI' \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);[print(b.get("asset_code"),"=",b["balance"]) for b in d["balances"]]'
```

### Alternative (no waiting): deploy our own pool + USDC
If you'd rather not wait on a transfer, we can have `alice` issue her *own* USDC test asset and
deploy our *own* Blend pool (the Pool Factory is permissionless). Say the word and I'll switch the
deploy script to that path — it's fully self-contained and needs nothing from anyone else.

---

## 2. Blend v2 testnet addresses (verified from `blend-utils/testnet.contracts.json`)

| Name | Address |
| --- | --- |
| Pool Factory v2 | `CDV6RX4CGPCOKGTBFS52V3LMWQGZN3LCQTXF5RVPOOCG4XVMHXQ4NTF6` |
| Backstop v2 | `CBDVWXT433PRVTUNM56C3JREF3HIZHRBA64NB2C3B2UNCKIS65ZYCLZA` |
| **TestnetV2 lending pool** (active, has a USDC reserve) | `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF` |
| Mock oracle (used by the pool) | `CAZOKR2Y5E2OSWSIBRVZMJ47RUTQPIGVWSAQ2UISGAVC46XKPGDG5PKI` |
| USDC test token (SAC) | `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU` |

Pool verified on-chain: status **0 = Active**, USDC reserve index **3**, `enabled: true`, 7 decimals,
live `b_rate ≈ 1.0557` and rising (real borrowing → real interest accruing).

---

## 3. Deploy (once alice has USDC)

A scripted deploy lives at [`scripts/deploy_testnet.sh`](scripts/deploy_testnet.sh). It:

1. Builds the WASMs (`stellar contract build`).
2. Deploys two SACs for **PT** and **YT**, admined by the wrapper.
3. Deploys + initializes the **Blend strategy adapter** (pointed at the TestnetV2 pool + USDC).
4. Deploys + initializes the **wrapper** (strategy + PT + YT + a maturity ~30 days out).
5. Prints all the resulting contract IDs.

Run it:
```bash
wsl -e bash -lic "cd '/mnt/f/Projects Tech/My own thoughts/spield_revamped/v1/contract/spield' && bash scripts/deploy_testnet.sh"
```

Then exercise it (the script prints exact `stellar contract invoke` commands for):
- `mint` 10 USDC → receive 10 PT + 10 YT, a position id is returned
- wait / let `b_rate` move → `position_value` shows claimable yield
- `claim_yield` → receive USDC, YT kept
- at maturity → `redeem_pt` 1:1

---

## 4. Identities available in WSL

`alice` is the default deployer used here (`GBNK7ZOQ...`, ~17,500 XLM). Others present:
`bob`, `abhiraj1`, `pratay1`, etc. (`stellar keys ls`). To use a different one, set `SOURCE=<name>`
before running the script.
