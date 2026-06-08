# Spield v2 — Mainnet Contract Addresses

**The canonical record of the live Spield v2 deployment on Stellar mainnet (Public network).**
Deployed **2026-06-08** via [`scripts/deploy_mainnet.sh`](scripts/deploy_mainnet.sh) against the real
**Blend FixedV2** pool and real **Circle USDC**. All four contracts verified on-chain: initialized,
correctly wired, solvent, and their live `code_hash` matches the built WASMs (see below).

> Network passphrase: `Public Global Stellar Network ; September 2015`
> Explorer base: `https://stellar.expert/explorer/public`

---

## Deployed Spield contracts

| Contract | Address | Explorer |
| --- | --- | --- |
| **Wrapper** (tokenization engine) | `CDLQY72EFRTNGNXT4PSINHGA4ET5CW3I6FHUSYUOL2HIWV6I55WW46WW` | [↗](https://stellar.expert/explorer/public/contract/CDLQY72EFRTNGNXT4PSINHGA4ET5CW3I6FHUSYUOL2HIWV6I55WW46WW) |
| **Strategy** (Blend adapter) | `CCTRXF5U2P2IMANRH5B54UJGV53APU4IID2QTINFQBZZWOPB765QZVW4` | [↗](https://stellar.expert/explorer/public/contract/CCTRXF5U2P2IMANRH5B54UJGV53APU4IID2QTINFQBZZWOPB765QZVW4) |
| **Vault** (Fixed-Rate Vault) | `CDWNGJDYZ7VUYRG73WOU6PR6HCYPHO77UICJO642OWSP7LQGRRYPFLX6` | [↗](https://stellar.expert/explorer/public/contract/CDWNGJDYZ7VUYRG73WOU6PR6HCYPHO77UICJO642OWSP7LQGRRYPFLX6) |
| **Market** (PT/USDC time-decay AMM) | `CBTO72XLCM2HV2MW64GMGWQB57NQFDXO3BZJTW3Y5ENTXBAJQ7Z7G5FV` | [↗](https://stellar.expert/explorer/public/contract/CBTO72XLCM2HV2MW64GMGWQB57NQFDXO3BZJTW3Y5ENTXBAJQ7Z7G5FV) |

## Spield assets (PT / YT)

| Asset | SAC (Soroban contract id) | Classic asset |
| --- | --- | --- |
| **PT** (Principal Token) | `CDDYIUGAZBSJNYAR2WYPRNHEGOFS25GPY22W7SHHQHIMTMKX5WQ25IXD` | `SPLDPT:GA4R5M7ZWOQZWIYCW246YC5WJ4QHT3H74CAUSTCEUUWIELCWI7IP3MKB` |
| **YT** (Yield Token) | `CDGQLIJVMKRFTYUXOMQAG4YFUN22OKXMOT2K4JA33KDM6P2FCBZTV6CU` | `SPLDYT:GA4R5M7ZWOQZWIYCW246YC5WJ4QHT3H74CAUSTCEUUWIELCWI7IP3MKB` |

> PT/YT SAC admin is the **wrapper** (only it mints/burns). They are issued by `spield_issuer_mainnet`.

## External dependencies (not ours)

| What | Address |
| --- | --- |
| **Circle USDC** (SAC) | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` |
| Circle USDC (classic) | `USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |
| **Blend FixedV2 pool** (yield source) | `CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD` |

## Accounts

| Identity | Address | Role |
| --- | --- | --- |
| `spield_deployer` | `GCRBHHWXSJQHOG6A34MYPVQMQB3J5GOP572TR3YLKB4OBBQHFQG24SFS` | Deployer + **current admin of all 4 contracts** (single hot key — rotate to multisig for real TVL) |
| `spield_issuer_mainnet` | `GA4R5M7ZWOQZWIYCW246YC5WJ4QHT3H74CAUSTCEUUWIELCWI7IP3MKB` | PT/YT asset issuer (SAC admin already handed to the wrapper) |

---

## Deployment parameters (as deployed)

| Param | Value |
| --- | --- |
| Maturity | `1788722911` (unix) — ~90 days from deploy (≈ 2026-09-06) |
| Strategy `max_apr_bps` | `30000` (300% APR ceiling; time-aware bound) |
| Vault `rate_bps` / `max_rate_bps` | `500` (5%) / `2000` (20% ceiling) |
| Market `fee_bps` / `max_fee_bps` | `30` (0.30%) / `100` (1% ceiling) |
| Market `rate_anchor` / `scalar_root` | `1e12` (par) / `40e12` |
| Vault seed / Market seed | **0 / 0** — deployed UNSEEDED (no USDC spent). Vault has 0 coupon capacity and the AMM pool is empty until seeded. |

## Verified WASM code hashes (live == built)

The optimized (`wasm-opt`) WASMs deployed. Each contract's live `code_hash()` was confirmed to equal
the hash from the build — i.e. the on-chain code is exactly what was compiled.

| Contract | code_hash |
| --- | --- |
| Wrapper | `94b3c032a5701c727281c82ede3ec446c7b452bf0387a47daa2606fbcd68f361` |
| Strategy | `d867a50a5b2c237924e356ca09f88748285dcf30426f42c216e19d54c6cc5039` |
| Vault | `7e5e4a6bf2517b01ab6606462b15efebc4051d14cd43dbdc36b9d1b0c85042a3` |
| Market | `db8bf67ae190be073f1c172dfe9f4f7e4c7bf4aa294f82338913cdf2744796fe` |

## On-chain state at deploy (verified)

- **Wrapper:** `version="spield-wrapper-0.1.0"`, admin = deployer, PT/YT/underlying/maturity wired,
  `is_paused=false`, `solvency=[0,0,0]` (empty & solvent).
- **Strategy:** `version="spield-strategy-0.1.0"`, `pool=`FixedV2, `underlying=`USDC.
- **Vault:** `version="spield-vault-0.1.0"`, `rate_bps=500`, stats all 0 (unseeded, solvent).
- **Market:** `version="spield-market-0.1.0-stageC-curve"`, `fee_bps=30`, `reserves=[0,0]`,
  `pt_token` == wrapper PT.

---

## Status & next steps

- [x] All 4 contracts deployed + initialized on mainnet (2026-06-08).
- [x] Live code hashes verified == built WASMs.
- [ ] **Seed the vault** (`vault.seed`) — needs USDC on the deployer (+ a USDC trustline). Until then the
      vault quotes a rate but `deposit` reverts (no coupon capacity).
- [ ] **Seed the market** (`market.add_liquidity`) — needs USDC (~2× per-side) on the deployer.
- [ ] **Rotate admins to a multisig** (recommended for real TVL — see MAINNET.md §6). All 4 admins are
      currently `spield_deployer` (a hot key); keep its secret offline until rotated.
- [ ] **Wire the frontend** to these mainnet addresses (env-driven config — planned).
- [ ] **Security audit** (MAINNET.md §7).

## Frontend env block

```
VITE_NETWORK=mainnet
VITE_WRAPPER=CDLQY72EFRTNGNXT4PSINHGA4ET5CW3I6FHUSYUOL2HIWV6I55WW46WW
VITE_STRATEGY=CCTRXF5U2P2IMANRH5B54UJGV53APU4IID2QTINFQBZZWOPB765QZVW4
VITE_VAULT=CDWNGJDYZ7VUYRG73WOU6PR6HCYPHO77UICJO642OWSP7LQGRRYPFLX6
VITE_MARKET=CBTO72XLCM2HV2MW64GMGWQB57NQFDXO3BZJTW3Y5ENTXBAJQ7Z7G5FV
VITE_PT=CDDYIUGAZBSJNYAR2WYPRNHEGOFS25GPY22W7SHHQHIMTMKX5WQ25IXD
VITE_YT=CDGQLIJVMKRFTYUXOMQAG4YFUN22OKXMOT2K4JA33KDM6P2FCBZTV6CU
VITE_USDC=CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75
```
