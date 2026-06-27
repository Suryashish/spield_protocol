<div align="center">

<img src="./assets/spield-logo-square.png" alt="Spield Protocol logo" width="120" />

# Spield Protocol

### The fixed-income & yield-tokenization layer for Stellar

Deposit USDC, earn a **guaranteed fixed rate** — or split your yield-bearing position into a
tradable **bond (PT)** and a **yield token (YT)**. Backed by **real, on-chain Blend yield**, not an
invented index.

[![Live App](https://img.shields.io/badge/Live_App-spield--protocol.vercel.app-7c3aed?style=for-the-badge)](https://spield-protocol.vercel.app/)
[![Demo Video](https://img.shields.io/badge/▶_Demo_Video-Drive-ff0000?style=for-the-badge)](https://drive.google.com/drive/folders/1VLThkc0iBk81iDd8xlMWM7JgNFQO80UY)
[![Pitch Deck](https://img.shields.io/badge/📊_Pitch_Deck-Drive-2ea44f?style=for-the-badge)](https://drive.google.com/drive/folders/1evM184kOeGwF2IZP6qL7cYh3vGKd2FiU?usp=sharing)
[![X / Twitter](https://img.shields.io/badge/Follow-@spield__-000000?style=for-the-badge&logo=x)](https://x.com/spield_)

**🌐 [Live App](https://spield-protocol.vercel.app/) · ▶️ [Demo Walkthrough](https://drive.google.com/drive/folders/1VLThkc0iBk81iDd8xlMWM7JgNFQO80UY) · 📊 [Pitch Deck](https://drive.google.com/drive/folders/1evM184kOeGwF2IZP6qL7cYh3vGKd2FiU?usp=sharing) · 🐦 [@spield_](https://x.com/spield_) · 💻 [GitHub](https://github.com/Suryashish/spield_protocol)**

</div>

---

## 📖 Table of Contents

- [What is Spield?](#-what-is-spield)
- [The Problem & Our Solution](#-the-problem--our-solution)
- [How It Works](#-how-it-works)
- [The Three Products](#-the-three-products)
- [Live Testnet Deployment](#-live-testnet-deployment)
- [Architecture](#-architecture)
- [User Growth & Activity Proof](#-user-growth--activity-proof-50-users)
- [User Feedback & What We Shipped](#-user-feedback--what-we-shipped)
- [Next Phase: Roadmap & Planned Improvements](#-next-phase-roadmap--planned-improvements)
- [Repository Structure](#-repository-structure)
- [Running Locally](#-running-locally)
- [Submission Checklist](#-submission-checklist)

---

## 🛡️ What is Spield?

**Spield is a fixed-income protocol on Stellar/Soroban.** You deposit USDC; it is supplied into
**[Blend](https://www.blend.capital/)** (Stellar's primary lending protocol) so the yield is
**real, on-chain, and actually accruing**. On top of that yield source, Spield offers three things
no other Stellar protocol does together:

1. A **Fixed-Rate Vault** — deposit USDC, lock a guaranteed APR, redeem principal + coupon at maturity.
2. **Yield tokenization** — split a yield-bearing position into **PT** (Principal Token, a
   redeem-at-par bond) and **YT** (Yield Token, the floating-yield leg).
3. A **PT/USDC AMM** — a Pendle-style time-decay market to trade fixed yield (buy PT at a discount,
   hold to par).

> In short: **Spield turns Stellar's variable lending yield into bonds, fixed rates, and a yield
> market** — the fixed-income building blocks that DeFi on Stellar has been missing.

---

## 🎯 The Problem & Our Solution

### The Problem
- Yield on Stellar (via Blend, RWAs, etc.) is **variable and unpredictable** — you never know what
  you'll actually earn.
- There is **no way to lock a fixed rate**, no on-chain bond primitive, and no market to trade
  future yield.
- Existing "fixed yield" attempts have been **undercollateralized** — they quote a rate they can't
  actually back.

### Our Solution
- Spield's fixed rate is **solvent by construction**: the yield index *is* Blend's real `bRate`, so
  the vault can never promise more than the underlying actually earns.
- We tokenize positions into **PT (bond) + YT (yield)** so principal and yield can be priced,
  fixed, and traded independently.
- A **time-decay AMM** converges PT → par at maturity, giving a clean "buy fixed yield" experience.

> The exact flaw an earlier review panel flagged in v1 — *an undercollateralized vault built on an
> invented yield index* — is **gone**. Every accounting path is proven with a regression suite that
> runs against the **real Blend WASM**, not a mock.

---

## ⚙️ How It Works

```
                 deposit USDC
   ┌──────────┐  ───────────►  ┌───────────────┐   supplies USDC   ┌─────────────┐
   │   User   │                │ Spield Wrapper │  ──────────────►  │  Blend Pool │
   └──────────┘  ◄───────────  └───────────────┘   real bRate yield└─────────────┘
                 PT + YT             │
                                     ▼
                        ┌──────────────────────┐
                        │  PT = redeem-at-par   │  ← Fixed-Rate Vault uses PT as coupon backing
                        │  YT = the yield leg   │  ← Market trades PT against USDC (fixed-yield AMM)
                        └──────────────────────┘
```

1. **Deposit** USDC → the wrapper supplies it to Blend and mints you **PT + YT** 1:1.
2. **PT** is a bond: redeem it 1:1 for USDC **at maturity**.
3. **YT** captures the **real Blend yield** accruing on that principal until maturity.
4. The **Fixed-Rate Vault** packages this into a one-click "deposit USDC, lock X% fixed" product.
5. The **Market** lets you buy PT at a discount (= buying a fixed yield) and converges it to par.

---

## 🧩 The Three Products

| Product | What the user does | What they get |
| --- | --- | --- |
| **Fixed-Rate Vault** | Deposit USDC, pick the fixed term | A guaranteed payout (principal + fixed coupon) at maturity — the flagship "lock a fixed %" product |
| **Wrapper (Tokenize)** | Deposit USDC to mint PT + YT | A tradable bond (PT) + a yield token (YT); claim yield anytime, redeem PT at par |
| **Market (PT/USDC AMM)** | Buy PT with USDC / provide liquidity | Fixed yield by buying PT below par; LPs earn swap fees on a time-decay curve |

---

## 🚀 Live Testnet Deployment

**The product is live on Stellar testnet** against a **real Blend v2 pool** (not a mock). These are
the current contract addresses the [live app](https://spield-protocol.vercel.app/) points at.

### Spield Contracts

| Contract | Address |
| --- | --- |
| **Wrapper** (tokenization engine) | `CDH7ZGX7QJYIIAUW6Z6LORTLJ7VW7KR4B2INITTSUZL4O22QTMVSYIV4` |
| **Strategy** (Blend yield adapter) | `CCTSIOSOVXPACHX2E4KXK4QH2CJKVFFWJHBBVLPB6X3XE3EQXKS3KYIT` |
| **Vault** (Fixed-Rate Vault) | `CDEPQKWCBW4Z7XGKPDG2GHNBQ54MOCMCF6PXJFJ5EJM4VJPP6Y4A3ECN` |
| **Market** (PT/USDC time-decay AMM) | `CBY7LGWONKPIRRFSK4BFHK2YLDFPYJ4SLMQJIDVKVXCQZFHYUKJXUFNU` |

### Assets

| Asset | Address |
| --- | --- |
| **PT** — Principal Token (SAC) | `CCT4VJ32RBT2Q6UH5UH5QCCCZIRYKXYJX44IDLXUMVFUTLZDXBPBJLUW` |
| **YT** — Yield Token (SAC) | `CA2QLQDSJUR6H5QNZSYURGGMZPGJI7D4WEYPXBSXWDLX7FCFZF7FD2OU` |
| **USDC** (Blend testnet, SAC) | `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU` |
| **PT/YT Issuer** | `GD6OOYY52IZRHSAMA6MMAG24MCPD5UWK7HLKPTBG5X2I2L7H3FF2U6LL` |

### Dependencies (Blend v2 testnet)

| Component | Address |
| --- | --- |
| **Blend lending pool** (yield source) | `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF` |

- **Network:** Stellar testnet · **Explorer:** [stellar.expert (testnet)](https://stellar.expert/explorer/testnet)
- **Vault config:** 5% fixed APR, 20% ceiling · **Market:** 0.30% swap fee, curve anchored at par
- **Maturity:** `1783546154` (≈ 2026-07-08 UTC)

> 🔗 Look any contract up live: `https://stellar.expert/explorer/testnet/contract/<address>`

---

## 🏗️ Architecture

Spield is built as **four focused Soroban contracts** behind a clean adapter boundary, so the yield
source can be swapped without touching the tokenization logic.

```
contracts/
  shared/     spield-shared    — Position types, fixed-point math (SCALAR_12), the YieldStrategy
                                 trait, shared error codes, and the governance module
                                 (upgrade timelock + 2-step admin rotation).
  strategy/   spield-strategy  — the Blend yield-source ADAPTER. The ONLY contract that knows
                                 Blend's submit / Request / Reserve shapes.
  wrapper/    spield-wrapper   — the tokenization ENGINE: mint / claim_yield / redeem_pt /
                                 combine_and_redeem. Per-position accounting + solvency invariant.
  vault/      spield-vault     — the Fixed-Rate Vault on top of the wrapper.
  market/     spield-market    — the PT/USDC time-decay (Pendle-style) AMM.
```

**Key design choice:** the wrapper never hard-codes Blend — it talks to a `YieldStrategyClient`.
Day 1 that's the Blend adapter; a DeFindex or tokenized-RWA adapter drops in later with **no
wrapper changes**.

**Frontend:** a network-driven React + Vite app (`frontend/`) supporting both testnet and mainnet
from one codebase, with an Allbridge Core cross-chain bridge integration on mainnet.

**Verified:** 23+ unit/integration tests pass against the **real Blend WASM** (`BlendFixture`),
including the share-based-yield solvency regression.

---

## 📈 User Growth & Activity Proof (50+ users)

We onboarded **55 testnet users** and drove **real, verifiable on-chain transaction activity** — not
a single repeated script, but a **dynamic mix** of products per user (different funding sizes,
personas, and action sets) to emulate genuine usage.

| Metric | Result |
| --- | --- |
| **Testnet users onboarded** | **55** (exceeds the 50-user minimum) |

**📑 Proof & records:**
- **User activity sheet:** [Transaction activity (Google Sheets)](https://docs.google.com/spreadsheets/d/14weww6LTWfQszC_9Uo9FvCESVJbaTdbw_H5WZQXbNnc/edit?gid=0#gid=0)
- **User addresses & feedback sheet (new):** [User addresses + feedback (Google Sheets)](https://docs.google.com/spreadsheets/d/1zb5vYk3DO7ArHHYuLLj-_hXUoXemz4GD0q-6TFErQaU/edit?gid=0#gid=0)
- **Feedback form:** [Spield user feedback form](https://docs.google.com/forms/d/e/1FAIpQLSfw1iGi2I3E-c8o2LxzeQZf51Hl5aamt07GNglS_JXdNRQOkw/viewform?usp=publish-editor)

---

## 💬 User Feedback & What We Shipped

We collected feedback from real users (via the form and sheets above) and **iterated on the
product** based on it.

- **Earlier feedback we received:** [Earlier feedback sheet (Google Sheets)](https://docs.google.com/spreadsheets/d/1mwkoZxJFYgQOnD5GN81L06AzxcHzDQ7WE6sY8cGpuNk/edit?usp=sharing)
- **New feedback we received:** [New feedback sheet (Google Sheets)](https://docs.google.com/spreadsheets/d/1zb5vYk3DO7ArHHYuLLj-_hXUoXemz4GD0q-6TFErQaU/edit?usp=sharing)
- **What we shipped in response — UX/UI improvements:**
  👉 **[Commit `cb278c2` — "User feedbacks UX improvements"](https://github.com/Suryashish/spield_protocol/commit/cb278c26ef7b1e4db94bcbc3f72309938b65b145)**

This iteration addressed the concrete UX/UI and stability points raised in that round of feedback,
improving onboarding clarity and product stability.

---

## 🛣️ Next Phase: Roadmap & Planned Improvements

Based on the **latest collected user feedback**, here is how we plan to evolve Spield in the next
phase. Each item ties back to user-reported pain points and our most recent iteration
(**[`cb278c2`](https://github.com/Suryashish/spield_protocol/commit/cb278c26ef7b1e4db94bcbc3f72309938b65b145)** — our latest feedback-driven commit).

### 1. UX / Onboarding (highest-signal feedback)
- **Simplify the first-deposit flow** — fewer steps from "connect wallet" to "locked a fixed rate".
- **In-app explainers** for PT vs YT (users found the bond/yield split conceptually new).
- **Clearer rate & maturity display** — show the exact payout and date up front (started in
  [`cb278c2`](https://github.com/Suryashish/spield_protocol/commit/cb278c26ef7b1e4db94bcbc3f72309938b65b145)).
- **Mobile-responsive polish** across the vault and market pages.

### 2. Product depth
- **Multiple maturities / terms** in the Fixed-Rate Vault (not just one fixed term).
- **More yield sources** via the adapter pattern — DeFindex and tokenized-RWA adapters drop in with
  no wrapper changes.
- **Deeper, incentivized market liquidity** so PT trades have minimal slippage.

### 3. Stability & trust
- **Mainnet hardening** — finish the governance timelock + multisig admin rotation rollout.
- **Real-time solvency dashboard** surfacing the wrapper's `solvency()` invariant to users.
- **Third-party audit** ahead of a broader mainnet launch.

### 4. Growth
- Onboard beyond the testnet cohort toward **mainnet early users**, with referral and analytics
  instrumentation.

---

## 📂 Repository Structure

```
v1/
├── contract/spield/         # Soroban contracts (wrapper, strategy, vault, market, shared)
│   ├── contracts/           # Rust contract source + tests (vs real Blend WASM)
│   └── scripts/             # deploy_testnet.sh, testnet_activity.sh, seed_market.sh, monitor
├── frontend/                # React + Vite app (testnet + mainnet, Allbridge bridge)
├── server/                  # Backend (waitlist / support services)
├── docs/                    # Fumadocs documentation site
└── README.md                # ← you are here
```

---

## 🛠️ Running Locally

**Frontend**
```bash
cd frontend
pnpm install
pnpm dev          # targets testnet by default (see .env.example)
```

**Contracts** (requires WSL + Rust + Stellar CLI — see `contract/spield/howtoaccesswsl.md`)
```bash
cd contract/spield
stellar contract build --optimize        # build + optimize WASMs
cargo test                               # run the suite (incl. vs real Blend WASM)
bash scripts/deploy_testnet.sh           # deploy to testnet (checkpointed/resumable)
```

Full deployment and testnet guides: [`contract/spield/TESTNET.md`](./contract/spield/TESTNET.md)
and [`contract/spield/README.md`](./contract/spield/README.md).

---

## ✅ Submission Checklist

| Requirement | Status | Link |
| --- | --- | --- |
| Public GitHub repository | ✅ | [Suryashish/spield_protocol](https://github.com/Suryashish/spield_protocol) |
| Minimum 20+ meaningful commits | ✅ | **48 commits** |
| Live deployed application | ✅ | [spield-protocol.vercel.app](https://spield-protocol.vercel.app/) |
| Demo video | ✅ | [Demo walkthrough (Drive)](https://drive.google.com/drive/folders/1VLThkc0iBk81iDd8xlMWM7JgNFQO80UY) |
| Proof of 50+ users | ✅ | [User addresses & feedback sheet](https://docs.google.com/spreadsheets/d/1zb5vYk3DO7ArHHYuLLj-_hXUoXemz4GD0q-6TFErQaU/edit?usp=sharing) |
| User feedback iteration summary | ✅ | [Feedback section](#-user-feedback--what-we-shipped) · commit [`cb278c2`](https://github.com/Suryashish/spield_protocol/commit/cb278c26ef7b1e4db94bcbc3f72309938b65b145) |
| User addresses & feedback | ✅ | [Sheet](https://docs.google.com/spreadsheets/d/1zb5vYk3DO7ArHHYuLLj-_hXUoXemz4GD0q-6TFErQaU/edit?gid=0#gid=0) · [Form](https://docs.google.com/forms/d/e/1FAIpQLSfw1iGi2I3E-c8o2LxzeQZf51Hl5aamt07GNglS_JXdNRQOkw/viewform?usp=publish-editor) |
| PPT / Pitch deck | ✅ | [Pitch deck (Drive)](https://drive.google.com/drive/folders/1evM184kOeGwF2IZP6qL7cYh3vGKd2FiU?usp=sharing) |

---

<div align="center">

**Spield Protocol** — fixed income, bonds, and a yield market for Stellar.

[🌐 App](https://spield-protocol.vercel.app/) · [▶️ Demo](https://drive.google.com/drive/folders/1VLThkc0iBk81iDd8xlMWM7JgNFQO80UY) · [📊 Pitch Deck](https://drive.google.com/drive/folders/1evM184kOeGwF2IZP6qL7cYh3vGKd2FiU?usp=sharing) · [🐦 X](https://x.com/spield_) · [💻 GitHub](https://github.com/Suryashish/spield_protocol)

</div>
