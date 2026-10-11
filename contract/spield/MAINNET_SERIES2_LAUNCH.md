# MAINNET_SERIES2_LAUNCH.md — Spield Series 2 Launch Record

# 🟢 LIVE ON MAINNET — Series 2 (Deployed 2026-10-12)

**All six contracts for Series 2 are deployed, initialized, wired, and verified on the Stellar public network.**
The PT issuer `spield_pt_issuer_v2` is **irreversibly locked** (master weight 0). The vault is seeded with 2 USDC and open.

## Contract Addresses & Assets

| Contract / Asset | Mainnet Address / Identifier | Stellar Expert Explorer |
|---|---|---|
| **SR** (Standardized Return) | `CDTAPBUE2JWXT4F3PTAFQRYTLC6IF4K736ISGIFNLJQBC7AWAHPU6HWM` | [View Contract](https://stellar.expert/explorer/public/contract/CDTAPBUE2JWXT4F3PTAFQRYTLC6IF4K736ISGIFNLJQBC7AWAHPU6HWM) |
| **STRATEGY** (Blend FixedV2) | `CDD2HYLUHT2HWI2L2ZMYM4NYPFDZMYDDMYH2V6ZOE32G6KFZMQKKKA24` | [View Contract](https://stellar.expert/explorer/public/contract/CDD2HYLUHT2HWI2L2ZMYM4NYPFDZMYDDMYH2V6ZOE32G6KFZMQKKKA24) |
| **YIELD** (PT/YT Engine, YT Token) | `CAALMLLE4COVQE33RTZOKKFJ3FYEAOONOAGKOUST26P23FE4HX5Q7XZB` | [View Contract](https://stellar.expert/explorer/public/contract/CAALMLLE4COVQE33RTZOKKFJ3FYEAOONOAGKOUST26P23FE4HX5Q7XZB) |
| **SRMARKET** (AMM Pool) | `CC7UQOKGYQLYZY4RALIAPBA4IH2TOMEJENQ6OWWIOSTTUDRZ5VYUERIW` | [View Contract](https://stellar.expert/explorer/public/contract/CC7UQOKGYQLYZY4RALIAPBA4IH2TOMEJENQ6OWWIOSTTUDRZ5VYUERIW) |
| **SRVAULT** (Fixed-Rate Vault) | `CA6TSYNLREIBJP37MD6LUPXKXHC6WB5ZK6YD3PTCQUDZ7XDJUD7AN66C` | [View Contract](https://stellar.expert/explorer/public/contract/CA6TSYNLREIBJP37MD6LUPXKXHC6WB5ZK6YD3PTCQUDZ7XDJUD7AN66C) |
| **SRROUTER** (USDC Gateway) | `CASPAY3DKWQQSZORJVEF44576OK3DODYOZQ74R4NLZT2YTVBNTO7RQNW` | [View Contract](https://stellar.expert/explorer/public/contract/CASPAY3DKWQQSZORJVEF44576OK3DODYOZQ74R4NLZT2YTVBNTO7RQNW) |
| **PT SAC** (Contract) | `CALAMDCCXSBWPJWOKUH6CHVVQMBPLJBUU4GVPETHY2FLNZGXFI2FNYUB` | [View Contract](https://stellar.expert/explorer/public/contract/CALAMDCCXSBWPJWOKUH6CHVVQMBPLJBUU4GVPETHY2FLNZGXFI2FNYUB) |
| **PT Classic Asset** | `SPLDPT:GBBRKYFRHSDUQ3YQRIFR42GZ4OKFMVKCZN7JYFPESVNSRU3WEE4JPI7Q` | [View Asset](https://stellar.expert/explorer/public/asset/SPLDPT-GBBRKYFRHSDUQ3YQRIFR42GZ4OKFMVKCZN7JYFPESVNSRU3WEE4JPI7Q) |
| **USDC SAC** *(Circle)* | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` | [View Contract](https://stellar.expert/explorer/public/contract/CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75) |
| **Blend Pool** *(FixedV2)* | `CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD` | [View Contract](https://stellar.expert/explorer/public/contract/CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD) |

## Accounts & Roles

| Identity | Address | Role | Status |
|---|---|---|---|
| `spield_admin_multisig` | `GDJ66WMVVH6MWBL4KORY2HOXWLY4UGFCMP64RC474LUJPQCPQUC4RUFL` | Admin of all 6 Series 2 contracts | Active Admin |
| `spield_deployer` | `GBUPDAQJPIYQWTJGVPYSBAK5BOHC3DP7ED3AKDAEZ7FJD7NOX56Z7YDF` | Deployer & Treasury (receives protocol fees & BLND emissions) | Active Treasury |
| `spield_pt_issuer_v2` | `GBBRKYFRHSDUQ3YQRIFR42GZ4OKFMVKCZN7JYFPESVNSRU3WEE4JPI7Q` | Series 2 PT Issuer | 🔒 **Locked** (`master-weight 0`) |

## Live Parameters

| Parameter | Configured Value | On-Chain Verification |
|---|---|---|
| **Series Duration** | 15 days | Expiry `1793056349` (verified on `yield`, `market`, `vault`, `router`) |
| **Launch TVL Cap** | 160 USDC | `1600000000` base units (verified on SR deposit cap) |
| **Fixed-Rate Vault APY** | 3.00% (`300 bps`) | Verified on `vault` (ceiling `2000 bps`) |
| **Vault Seed Capacity** | 2 USDC (`20000000`) | Seeded and verified |
| **AMM Pool Seed** | 0 (Unseeded at deploy) | Reserves `[0, 0]` (to be seeded from dashboard) |
| **PT Asset Code** | `SPLDPT` | `SPLDPT:GBBRKYFRHSDUQ3YQRIFR42GZ4OKFMVKCZN7JYFPESVNSRU3WEE4JPI7Q` |
| **YT Yield Fee** | 5.00% (`500 bps`) | Verified on `yield` engine |

## On-Chain Verification Passed

- **Rate Calibration Gate**: Passed cleanly against live Blend FixedV2 (measured 6.72% supply APR > 3.00% vault APY).
- **Wiring Assertions**: 21/21 cross-contract address references verified on-chain.
- **Compatibility Suite**: 6/6 live RPC compatibility checks passed:
  - `sr.max_redeemable -> strategy.available_liquidity`
  - `sr.total_assets`
  - `sr.deposit_cap`
  - `strategy.available_liquidity`
  - `market.asset_reserve -> sr.exchange_rate`
  - `router.quote_buy_pt_with_usdc -> sr + market`
- **PT Mint Path Security**:
  - PT SAC admin set to Yield contract: `CAALMLLE4COVQE33RTZOKKFJ3FYEAOONOAGKOUST26P23FE4HX5Q7XZB`.
  - Classic issuer master key weight irreversibly set to 0. No signers remain on `spield_pt_issuer_v2`. PT can only be minted via the Yield contract backed by SR.

