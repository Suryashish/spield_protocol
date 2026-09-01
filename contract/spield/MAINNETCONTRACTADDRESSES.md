# Spield — Mainnet Contract Addresses

**The canonical record of what Spield has live on Stellar mainnet (Public network).**

There are **two** deployments on mainnet. Read the first one; the second is kept only so the old
addresses resolve to an explanation instead of a mystery.

| | Stack | Deployed | Status |
|---|---|---|---|
| [**§1**](#1-v2--the-sr-stack-live) | **v2 — the SR stack** (6 contracts) | **2026-09-01** | 🟢 **Live. This is Spield.** |
| [§2](#2-v1--the-original-wrapper-stack-retired) | v1 — the wrapper stack (4 contracts) | 2026-06-08 | ⚪ Retired, unseeded, superseded |

> Network passphrase: `Public Global Stellar Network ; September 2015`
> Explorer base: `https://stellar.expert/explorer/public`

---

# 1. v2 — the SR stack (LIVE)

Deployed **2026-09-01** via [`scripts/deploy_mainnet.sh`](scripts/deploy_mainnet.sh) against the real
**Blend FixedV2** pool and real **Circle USDC**. State file:
[`scripts/deploy_mainnet_v2.state`](scripts/deploy_mainnet_v2.state). Launch record and funding
receipts: [`MAINNET_LAUNCH.md`](MAINNET_LAUNCH.md).

All six contracts verified on chain after deploy: initialized, correctly wired (**24/24 assertions**),
solvent, PT issuer **locked**, and every live WASM byte-identical to the built artifact.

## Deployed contracts

| Contract | What it is | Address | Explorer |
| --- | --- | --- | --- |
| **SR** | Standardized Return share token over the Blend strategy. **The only mint path — the deposit cap lives here** | `CCOZ2JGQAPLUOG5RVU3TLPGSS7WA356BWCOEWFBJU44DKHDRZTQPABBS` | [↗](https://stellar.expert/explorer/public/contract/CCOZ2JGQAPLUOG5RVU3TLPGSS7WA356BWCOEWFBJU44DKHDRZTQPABBS) |
| **Strategy** | Blend adapter. Holds the actual USDC position | `CAJKHGY3J2XSZHI3TFDFMXJ2GDFFUPUPPTUOP6UOBHSY6FW66J6YYBP7` | [↗](https://stellar.expert/explorer/public/contract/CAJKHGY3J2XSZHI3TFDFMXJ2GDFFUPUPPTUOP6UOBHSY6FW66J6YYBP7) |
| **Yield** | PT/YT engine — **and the YT token itself**, since YT needs a transfer hook no SAC can provide | `CDILIYN4IXUL5H7PJ4TW3GLZ2U6LIZYX35SNN4BGYZWPIXFLJZEFMRLP` | [↗](https://stellar.expert/explorer/public/contract/CDILIYN4IXUL5H7PJ4TW3GLZ2U6LIZYX35SNN4BGYZWPIXFLJZEFMRLP) |
| **SR Market** | PT/SR time-decay AMM | `CDRQJ7EYKTJV3W4BE2U4HIAWSVZB675MHTCBDGCXMKVR5VCURMNSEZ7O` | [↗](https://stellar.expert/explorer/public/contract/CDRQJ7EYKTJV3W4BE2U4HIAWSVZB675MHTCBDGCXMKVR5VCURMNSEZ7O) |
| **SR Vault** | Fixed-Rate Vault — the flagship product | `CDNRQ4YLW4RA4LB4J4M5S3X4SEXXR3Z6TR7336VKOG3FPX3PBFAMVZ6P` | [↗](https://stellar.expert/explorer/public/contract/CDNRQ4YLW4RA4LB4J4M5S3X4SEXXR3Z6TR7336VKOG3FPX3PBFAMVZ6P) |
| **SR Router** | Single-signature USDC front door. **No privileges and no balances, by construction** | `CB7O72TTK7OISNS53HXTLCZ2EAY2F5KKYBPGI7ADSIX5KMPGVVDXAALN` | [↗](https://stellar.expert/explorer/public/contract/CB7O72TTK7OISNS53HXTLCZ2EAY2F5KKYBPGI7ADSIX5KMPGVVDXAALN) |

## Assets

| Asset | SAC (Soroban contract id) | Classic asset |
| --- | --- | --- |
| **PT** (Principal Token) | `CBGA2TFTSF236VYPI5TVYQ2Z53DKD6LQHIR5DCGKSNIUJ4NAPNBI6VJM` | `SPLDPT:GDNSUOHJIWYXX6HC6ZVDJNLSIBLZMLJYBG7NAN2CRUSXOG4FIDAOH5KN` |
| **YT** (Yield Token) | *is the Yield contract* — `CDILIYN4IXUL5H7PJ4TW3GLZ2U6LIZYX35SNN4BGYZWPIXFLJZEFMRLP` | none — YT is not a classic asset |

> **YT has no SAC of its own.** It is the yield contract, because settling interest on transfer
> requires a hook a Stellar Asset Contract cannot expose. Code that treats YT as an ordinary SAC
> address is wrong; point it at the yield contract.
>
> **PT SAC admin is the yield contract** — only it can mint. The issuer account holds no signing
> weight at all (see below), so PT supply cannot be inflated by any key.

## External dependencies (not ours)

| What | Address |
| --- | --- |
| **Circle USDC** (SAC) | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` |
| Circle USDC (classic) | `USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |
| **Blend FixedV2 pool** (yield source) | `CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD` |

## Accounts

| Identity | Address | Role |
| --- | --- | --- |
| `spield_deployer` | `GBUPDAQJPIYQWTJGVPYSBAK5BOHC3DP7ED3AKDAEZ7FJD7NOX56Z7YDF` | Deployer, **current admin AND treasury of all six contracts**, holder of the PT trustline. A single hot key — rotate before real TVL |
| `spield_pt_issuer` | `GDNSUOHJIWYXX6HC6ZVDJNLSIBLZMLJYBG7NAN2CRUSXOG4FIDAOH5KN` | PT classic issuer. **🔒 Locked forever** at deploy step 6b — verified on Horizon: no signer with weight > 0 |
| `spield_admin_multisig` | `GDJ66WMVVH6MWBL4KORY2HOXWLY4UGFCMP64RC474LUJPQCPQUC4RUFL` | The 2-of-3 admin account. Funded and ready, **not yet rotated to** |
| `spield_sig_1` | `GA7BTFN2P4EXZS4MM4QNGLQBAWUZYLCYNACWDCRW74P3QJT4FUB7TF7Z` | Future signer. Signer keypairs need no ledger account and no funding |
| `spield_sig_2` | `GAQ3DLLNUE5HPRKYL5JOCSLCD7RHKE3IRCOEHH7DULGXHZZB3V3SAYWP` | Future signer |
| `spield_sig_3` | `GA3ODKNDDTVKGDONUFBRSO4REMGX6JDJTGZ4X5FTRQU3IOFGKTYFU3KP` | Future signer |

Secrets live in `wallets.md` — gitignored, mode 600, **never committed**.

## Deployment parameters (as deployed, read back off chain)

| Param | Value |
| --- | --- |
| Series expiry | `1790809749` — **2026-09-30 23:09 UTC**, 30 days from deploy |
| Vault `rate_bps` / `max_rate_bps` | `300` (3.00%) / `2000` (20% ceiling) |
| Vault coupon capacity | **2 USDC seeded** — `pt_inventory` = `yt_inventory` = `19999999` |
| SR `deposit_cap` | `500000000` = **50 USDC** global TVL ceiling |
| SR headroom at launch | `480000000` — the vault seed consumed 2 USDC of the cap |
| SR `total_assets` | `20000034` — the seed, already earning in Blend |
| `is_paused` | `false` |
| Emissions destination | `spield_deployer` (treasury) |
| Market reserves | `[0, 0]` — **the AMM is unseeded**; liquidity gets added from the dashboard |

**Maturity is immutable.** `set_expiry` is reachable only from the one-shot `initialize`, and there is
no roll function. A new series means a new deployment.

## Verified WASM code hashes (live == built)

Each contract's on-chain code was fetched back with `stellar contract fetch` and hashed. All six are
**byte-identical** to `target/wasm32v1-none/release/spield_*.wasm` — the deployed code is exactly what
was compiled from this tree.

| Contract | `version()` | sha256 |
| --- | --- | --- |
| SR | `spield-sr-0.1.0` | `4fc2cb87faa5c119bf5c37c6fc45f80849140cba1fa47ff4ab9b338411d1e078` |
| Strategy | `spield-strategy-0.1.0` | `d9d159816210ca2655944a398f20f1b297f2d8b6764925634a9e94ba91150745` |
| Yield | `spield-yield-0.1.0` | `d5e9038212741f84510ec2ee0b614af4a8b4f8c34632e83f7ec8be4c5e82beb1` |
| SR Market | `spield-srmarket-0.1.0` | `0b3f0a36006e8335d0436689d5c052e79ce6d8c90ed4f202a944724be45b5f5b` |
| SR Vault | `spield-srvault-0.1.0` | `c0cdeaf7c36a5268c7882ccda2aac8f7250eb525270c7b7bd0bf023337f30fb9` |
| SR Router | `spield-srrouter-0.1.0` | `a78d10c9c45e13b3e2f36255ac34e3f61159e178083121f0843fa29318b5838e` |

Reproduce it:

```bash
source scripts/deploy_mainnet_v2.state
for p in sr:$SR strategy:$STRATEGY yield:$YIELD srmarket:$SRMARKET srvault:$SRVAULT srrouter:$SRROUTER; do
  f="${p%%:*}"; id="${p##*:}"
  stellar contract fetch --id "$id" \
    --network-passphrase "Public Global Stellar Network ; September 2015" \
    --rpc-url https://mainnet.sorobanrpc.com --out-file "/tmp/$f.wasm" >/dev/null 2>&1
  diff -q "/tmp/$f.wasm" "target/wasm32v1-none/release/spield_$f.wasm" \
    && echo "$f ✓ identical"
done
```

## Status & next steps

- [x] All 6 contracts deployed + initialized on mainnet (2026-09-01).
- [x] Live code hashes verified byte-identical to the built WASMs.
- [x] **PT issuer locked** — irreversible, confirmed on Horizon. PT is mintable only by the engine.
- [x] **Vault seeded** with 2 USDC of coupon capacity — `deposit` works.
- [x] Deposit cap set to 50 USDC. This is the mitigation for shipping unaudited.
- [x] Frontend wired to these addresses (`frontend/src/lib/config.ts`, `mainnet.sr`).
- [ ] **Seed the AMM** (`market.add_liquidity`) — reserves are `[0, 0]`. Being done from the dashboard
      Liquidity page as an ordinary LP, not from the deploy script.
- [ ] **Rotate admins to the multisig** — `scripts/rotate_admins.sh rotate`, drilled on testnet
      (`DRILLS.md`). All six admins are currently `spield_deployer`, a hot key; keep its secret
      offline until this is done.
- [ ] **Security audit.** Not started. See `MAINNET.md` §7.

## Frontend env block

The defaults in `frontend/src/lib/config.ts` already carry these, so this block is only needed to
override a build:

```
VITE_NETWORK=mainnet
VITE_SR=CCOZ2JGQAPLUOG5RVU3TLPGSS7WA356BWCOEWFBJU44DKHDRZTQPABBS
VITE_SR_STRATEGY=CAJKHGY3J2XSZHI3TFDFMXJ2GDFFUPUPPTUOP6UOBHSY6FW66J6YYBP7
VITE_SR_YIELD=CDILIYN4IXUL5H7PJ4TW3GLZ2U6LIZYX35SNN4BGYZWPIXFLJZEFMRLP
VITE_SR_MARKET=CDRQJ7EYKTJV3W4BE2U4HIAWSVZB675MHTCBDGCXMKVR5VCURMNSEZ7O
VITE_SR_VAULT=CDNRQ4YLW4RA4LB4J4M5S3X4SEXXR3Z6TR7336VKOG3FPX3PBFAMVZ6P
VITE_SR_ROUTER=CB7O72TTK7OISNS53HXTLCZ2EAY2F5KKYBPGI7ADSIX5KMPGVVDXAALN
VITE_SR_PT=CBGA2TFTSF236VYPI5TVYQ2Z53DKD6LQHIR5DCGKSNIUJ4NAPNBI6VJM
VITE_SR_PT_ASSET=SPLDPT:GDNSUOHJIWYXX6HC6ZVDJNLSIBLZMLJYBG7NAN2CRUSXOG4FIDAOH5KN
VITE_SR_USDC=CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75
```

---

# 2. v1 — the original wrapper stack (RETIRED)

Deployed **2026-06-08**. Superseded by §1 and **never seeded** — the vault has zero coupon capacity
and the AMM pool is empty, so nothing can be deposited or traded and no user funds are at risk. It is
documented here only so these addresses resolve to an explanation.

> ⚠️ **Do not point anything new at these.** Two further caveats, both recorded the hard way:
> its maturity `1788722911` (≈ 2026-09-06) is nearly here and cannot be moved, and the deployed
> binaries **lag** the current `contracts/` source in ways `version()` cannot see.

| Contract | Address |
| --- | --- |
| Wrapper (tokenization engine) | `CDLQY72EFRTNGNXT4PSINHGA4ET5CW3I6FHUSYUOL2HIWV6I55WW46WW` |
| Strategy (Blend adapter) | `CCTRXF5U2P2IMANRH5B54UJGV53APU4IID2QTINFQBZZWOPB765QZVW4` |
| Vault (Fixed-Rate Vault) | `CDWNGJDYZ7VUYRG73WOU6PR6HCYPHO77UICJO642OWSP7LQGRRYPFLX6` |
| Market (PT/USDC time-decay AMM) | `CBTO72XLCM2HV2MW64GMGWQB57NQFDXO3BZJTW3Y5ENTXBAJQ7Z7G5FV` |

| Asset | SAC | Classic asset |
| --- | --- | --- |
| PT | `CDDYIUGAZBSJNYAR2WYPRNHEGOFS25GPY22W7SHHQHIMTMKX5WQ25IXD` | `SPLDPT:GA4R5M7ZWOQZWIYCW246YC5WJ4QHT3H74CAUSTCEUUWIELCWI7IP3MKB` |
| YT | `CDGQLIJVMKRFTYUXOMQAG4YFUN22OKXMOT2K4JA33KDM6P2FCBZTV6CU` | `SPLDYT:GA4R5M7ZWOQZWIYCW246YC5WJ4QHT3H74CAUSTCEUUWIELCWI7IP3MKB` |

> In **v1**, YT *is* a SAC and both legs share one issuer. In **v2**, YT is the yield contract and PT
> has its own dedicated issuer per series. The two designs use the same ticker `SPLDPT` with different
> issuers, which is exactly the kind of thing that gets confused — always compare the full
> `CODE:ISSUER`, never the code alone.

| Identity | Address | Role |
| --- | --- | --- |
| `spield_deployer` (v1 key — a different account from v2's) | `GCRBHHWXSJQHOG6A34MYPVQMQB3J5GOP572TR3YLKB4OBBQHFQG24SFS` | Admin of all 4 v1 contracts |
| `spield_issuer_mainnet` | `GA4R5M7ZWOQZWIYCW246YC5WJ4QHT3H74CAUSTCEUUWIELCWI7IP3MKB` | v1 PT/YT issuer. **Not locked** — unlike v2's |

Parameters as deployed: maturity `1788722911`; strategy `max_apr_bps` `30000`; vault `rate_bps` `500` /
`max_rate_bps` `2000`; market `fee_bps` `30` / `max_fee_bps` `100`; `rate_anchor` `1e12`,
`scalar_root` `40e12`; **vault seed and market seed both 0**.

Live code hashes at v1 deploy: wrapper `94b3c032a5701c727281c82ede3ec446c7b452bf0387a47daa2606fbcd68f361`,
strategy `d867a50a5b2c237924e356ca09f88748285dcf30426f42c216e19d54c6cc5039`,
vault `7e5e4a6bf2517b01ab6606462b15efebc4051d14cd43dbdc36b9d1b0c85042a3`,
market `db8bf67ae190be073f1c172dfe9f4f7e4c7bf4aa294f82338913cdf2744796fe`.

The v1 frontend addresses remain in `frontend/src/lib/config.ts` under `mainnet.contracts`, separate
from `mainnet.sr`, so both stacks stay addressable from one build.

---

**Related:** [`MAINNET_LAUNCH.md`](MAINNET_LAUNCH.md) (launch sheet + funding receipts) ·
[`MAINNET.md`](MAINNET.md) (full reference) · [`DRILLS.md`](DRILLS.md) (rehearsed emergency
procedures) · [`notcovered.md`](../../../notcovered.md) (deliverable status).
