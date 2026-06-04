# Spield — Existing System Knowledge

> Extracted from the old GitBook docs (`spield gitbook latest download.pdf`).
> Purpose: capture the **idea** and **base logic** of what was already built, so the
> system can be rebuilt cleanly from the ground up with better structure.
>
> **Scope note (rebuild direction):** This version is **Stellar-only**. The original
> design used an EVM (Sepolia) vault + Node.js bridge to move USDC across chains.
> That cross-chain layer has been **removed**. Everything settles in **Stellar-native
> USDC** and runs entirely on Soroban. EVM Vault, the relayer's bridging role, and all
> `×10 / ÷10` cross-chain decimal conversions are gone. The yield oracle remains as a
> trusted Stellar-side index updater (no longer reading from Ethereum).

---

## 1. The Core Idea (in one paragraph)

**Spield is a yield-stripping protocol** (a "Pendle-style" protocol) built on the
**Stellar / Soroban** network. It takes one **yield-bearing token** (`stsUSDe`) and
splits it into **two separate, tradable tokens**:

- **PT (Principal Token)** → the fixed, principal part. Redeems 1:1 for the underlying at maturity.
- **YT (Yield Token)** → the variable, yield part. Pays out whatever yield is actually earned.

Spield does **not** remove yield risk — it **routes** yield risk to the people who want it.
Conservative users buy **PT** (predictable, bond-like). Risk-takers buy **YT** (leveraged bet on yield).

---

## 2. The One Invariant That Governs Everything

```
Value(stsUSDe) = Value(PT) + Value(YT)
```

This "accounting identity" must always hold. The protocol never creates or destroys
capital — it only **reallocates** the yield outcome between PT and YT holders.

Illustrative pricing:
```
Value(stsUSDe) = 1.00 USDe
Value(PT)      = 0.95–0.97 USDe   (trades at a discount, like a zero-coupon bond)
Value(YT)      = 0.03–0.05 USDe   (small upfront cost, leveraged yield exposure)
→ 0.95 + 0.05 = 1.00  ✓
```

**What Spield is NOT:** not risk-free yield, not a yield guarantee, not capital creation.

---

## 3. The Two Tokens

| Token | Represents | At Maturity | Before Maturity | Used For |
|-------|-----------|-------------|-----------------|----------|
| **PT** | Locked principal | Redeems 1:1 for underlying | Trades at a discount (~0.97 USDC) | **Fixed yield** — buy at discount, redeem at par |
| **YT** | Accumulated yield since entry | No principal value | ~0.03 USDC | **Yield speculation/trading** — bet on or lock in yield |

### The three user strategies
1. **Fixed Yield** — Buy PT at a discount → redeem at par at maturity. (Profit = par − discount.)
2. **Yield Speculation** — Hold YT, bet that the yield rate goes up.
3. **Yield Trading** — Sell YT immediately to lock in the current yield value.

---

## 4. Yield Math (the heart of the protocol)

### Yield Index
A single number that tracks **accumulated yield per 1 unit of stsUSDe**. Think of it as
the **share price of stsUSDe in USDe terms** — it trends upward as yield accrues.

- `pastIndex` (a.k.a. `entryIndex`) — index value when the user acquired YT / deposited.
- `currentIndex` — latest index value at claim/settlement time.

**On-chain fixed-point representation** (7-decimal):
```
INDEX_SCALAR = 10_000_000   →  represents 1.0000000
10_000_000   →  1.0000000   (protocol inception)
10_500_000   →  1.0500000   (5% cumulative yield)
11_234_877   →  1.1234877   (~12.35% yield, example live value)
```

### YT Payout Formula (the required formula)
```
Yield owed = (currentIndex − pastIndex) × (total YT held)
```

On-chain (fixed-point) version:
```
profit = ( YT_balance × (currentIndex − entryIndex) ) / INDEX_SCALAR
```
- If `currentIndex < pastIndex` → result is negative. Treat as loss or **clamp at 0** per product rules.
- If a user buys YT multiple times → track **per-lot `pastIndex`**.

### APY Formula
```
APY = ( (currentIndex / sevenDaysOldIndex) ^ (365 / 7) ) − 1
```
Annualizes a 7-day index change into a compounded yearly rate.

### Worked Example
```
Deposit 100 stsUSDe at index 10_000_000  → receive 100 PT + 100 YT, entryIndex = 10_000_000
Oracle pushes new index 10_500_000 (5% gain)
claim_yield():
  profit = (100 × (10_500_000 − 10_000_000)) / 10_000_000 = 5 stsUSDe
  → 100 YT burned, 5 stsUSDe paid out
  → 100 PT still held (redeemable at maturity for 100 stsUSDe)
```

### Leverage intuition
YT controls the yield of 1.00 USDe of principal but only costs ~0.05 USDe →
**Leverage = 1.00 / 0.05 = 20×**.

---

## 5. System Architecture (Stellar-only)

> No EVM chain, no cross-chain bridge. The whole protocol lives on Soroban and
> settles in **Stellar-native USDC**.

```
┌─ Off-chain Yield Updater (lightweight, Node.js) ───────────────┐
│  @stellar/stellar-sdk                                          │
│  - Reads the underlying stsUSDe strategy's share price          │
│    from a verifiable source                                     │
│  - Calls Oracle.update_yield_index() periodically              │
│  Security: dotenv secrets, single trusted updater key          │
└────────────────────────────────────────────────────────────────┘
              │  Soroban XDR transactions
              ▼
┌─ Stellar Soroban (Public Network) ─────────────────────────────┐
│  Yield Oracle Contract    (holds + serves the yield index)     │
│  stsUSDe Token (SAC)      (the yield-bearing underlying)       │
│  USDC (Stellar-native)    (settlement currency for trades)     │
│  Wrapper Contract         (PT/YT derivative engine)            │
│  Marketplace Orderbook    (P2P PT/YT trading, USDC settled)    │
│  Frontend: React/Vite + Freighter wallet + stellar-sdk         │
└────────────────────────────────────────────────────────────────┘
```

### Why Stellar Soroban was chosen
- **Sub-cent fees** → micro-yield claims are economically viable.
- **~5s ledger close** → fast finality vs minutes on Ethereum.
- **Rust-native (WASM)** → type-safe complex yield math.
- **Stellar Asset Contract (SAC)** → native token standard.
- **`require_auth()` auth model** → per-invocation signatures, no session state.
- **Built-in storage TTLs** → automatic state-expiry management.

---

## 6. The Three Soroban Contracts (Rust, `#![no_std]`, `wasm32v1-none`)

> The original design had **four** contracts because the Bridge Oracle doubled as a
> cross-chain bridge. With bridging removed, that contract collapses into a pure
> **Yield Oracle**, leaving three: **Oracle**, **Wrapper**, **Marketplace** (plus the
> stsUSDe and USDC SAC tokens, which are standard assets, not custom logic).

### A. Yield Oracle Contract — *holds and serves the yield index*
Single role: be the on-chain source of truth for the yield index. (The old EVM-bridge
role — `mint`/`withdraw` with replay protection — is gone, since there is no longer a
cross-chain peg to maintain.)

**State:**
- Instance: `Updater → Address` (authorized index updater), `YieldIndex → i128`

**Functions:**
- `update_yield_index(index)` — updater-only; stores latest index.
- `get_yield_index() → i128` — public read; called cross-contract by the Wrapper.

### B. Wrapper Contract — *the derivative engine (core DeFi logic)*
Manages the PT/YT lifecycle from mint through maturity.

**State:**
- Persistent (per-user): `UserPT(Address)`, `UserYT(Address)`, `UserEntryIndex(Address)`
- Instance (global): `TotalPT`, `TotalYT`, `OracleAddr`, `Maturity (u64)`, `StsusdcAddr`

**Functions:**
- `mint_split(user, amount)` — user supplies stsUSDe (escrowed into the Wrapper); fetch entry_index from oracle; mint PT + YT 1:1.
- `claim_yield(user)` — compute profit from index delta; burn ALL YT; pay out yield in stsUSDe; emit `yield_pay`.
- `redeem_pt(user, amount)` — **gated by `ledger.timestamp() ≥ maturity`**; burn PT; return principal 1:1 in stsUSDe.
- `combine_and_redeem(user, amount)` — early exit; burn equal PT + YT; return principal (no yield captured).
- `transfer_pt / transfer_yt` — used by the Marketplace for escrow moves.

### C. Marketplace Orderbook Contract — *P2P trading*
Non-custodial peer-to-peer orderbook with **automatic best-price fill matching**.
Settles in **Stellar-native USDC**.

**Pricing (no-arbitrage parity):**
```
PT price = 0.97 USDC/unit
YT price = 0.03 USDC/unit
PT + YT  = 1.00 USDC
```

**State:**
- Persistent: `SellOrderPT(Address)`, `SellOrderYT(Address)`
- Instance: `SellersListPT → Vec<Address>`, `SellersListYT → Vec<Address>`

**Functions:**
- `list_pt / list_yt(seller, amount)` — escrow tokens from Wrapper into Marketplace.
- `buy_market_pt / buy_market_yt(buyer, amount)` — iterate sellers, auto-match fills, pay USDC buyer→seller directly (no fee), transfer PT/YT to buyer. Panics if depth insufficient.

> **Note on the doc set's design intent:** the *conceptual* docs describe a richer
> orderbook (limit orders, price-time priority, bids/asks crossing). The *built MVP*
> simplified this to **fixed-price sell listings with auto-match buys**. A rebuild should
> decide which model to target.

### The two SAC tokens (standard assets, not custom logic)

**stsUSDe** — the yield-bearing underlying. Issued as a Stellar Asset Contract (SAC) so
it lives in native Stellar accounts and is transactable on Stellar's base layer. Users
hold it directly (no cross-chain mint/burn peg anymore). The Wrapper escrows and returns
it during mint/claim/redeem.

**USDC (Stellar-native)** — the settlement currency for PT/YT trades on the Marketplace.
The canonical Circle-issued Stellar USDC asset (a SAC), used directly — no bridging.

```rust
// Both tokens are used via the standard token client (transfers only — no bridge mint/burn)
TokenClient::new(&env, &stsusde_addr).transfer(&from, &to, &amount); // Wrapper escrow/payout
TokenClient::new(&env, &usdc_addr).transfer(&buyer, &seller, &amount); // Marketplace settlement
```

---

## 7. Core Flows (Stellar-native)

> The original cross-chain deposit/withdraw flows (EVM Vault → relayer → Soroban) are
> **removed**. Users hold **Stellar-native** stsUSDe and USDC directly, so there is no
> lock/unlock, no `TokensLocked`/`withdraw` event bridge, and no `×10 / ÷10` conversion.

### Getting in / out
- **In:** A user simply holds **stsUSDe** in their Stellar wallet (acquired natively on
  Stellar) and calls `Wrapper.mint_split(user, amount)` to split it into PT + YT.
- **Out:** `claim_yield`, `redeem_pt` (after maturity), or `combine_and_redeem` (early
  exit) return stsUSDe directly to the user — all within Stellar. No bridge step.

### Yield Oracle (periodic)
```
Every update interval:
  Updater → read the underlying stsUSDe strategy's share price
            from a verifiable source (the live yield index)
  Express it as a 7-decimal fixed-point i128 (INDEX_SCALAR = 10_000_000)
  Updater → Oracle.update_yield_index(index)   [updater-auth]
            → stored in instance storage, served to the Wrapper on demand
```
*(No Ethereum `convertToAssets` read and no cross-chain decimal scaling — the updater
publishes a Stellar-native index directly. Where that index is sourced from is an
implementation choice for the rebuild.)*

---

## 8. Soroban-specific Mechanics

- **Storage tiers:** *Instance* storage for global state (updater addr, asset addrs, yield index,
  seller lists — cheap, extended per invocation). *Persistent* storage for per-user data
  (balances, entry index, sell orders — survives upgrades). **TTL is extended
  explicitly after every write** so data doesn't expire between interactions.
- **Authorization:** Every state-mutating function calls `require_auth()`. There is no implicit
  `msg.sender` like EVM — auth is embedded in the signed XDR and validated against the stored address.
- **Cross-contract calls:** synchronous, stack-based → **re-entrancy is impossible by design**.
  - Wrapper → Yield Oracle: `get_yield_index()` (during `mint_split`, `claim_yield`).
  - Marketplace → Wrapper: `transfer_pt/yt()` (during list/buy).
- **Events:** `env.events().publish(...)` for `yield_pay` (and any trade events); queried via
  `sorobanServer.getEvents()`.

---

## 9. Transaction Lifecycle (frontend → chain)

```
1. Frontend builds Soroban operation (XDR)
2. simulateTransaction()  → estimate fee, build footprint
3. assembleTransaction()  → attach auth entries + resource fee
4. signTransaction()      → Freighter popup (user approves)
5. sendTransaction()      → broadcast
6. pollTransaction()      → until SUCCESS / FAILED
```
- Signing backend: **Freighter** browser extension (supports API v5 & v6).
- Read-only views use `simulateTransaction` against a **static demo address** → no wallet needed.

---

## 10. Security Model

| Threat | Mitigation | Future path |
|--------|-----------|-------------|
| Maturity bypass | `ledger.timestamp() < maturity` enforced on-chain | — |
| Yield index manipulation | `update_yield_index` requires updater auth | Decentralized oracle feeds |
| Unauthorized PT/YT transfers | `require_auth()` on all state-mutating calls | — |
| Re-entrancy | Impossible by Soroban's synchronous, stack-based design | — |

> The original cross-chain threats (replay attacks via `Processed(BytesN<32>)`,
> unauthorized bridge minting, double withdrawal processing) **no longer exist** — there
> is no bridge to mint unbacked tokens, no EVM tx hashes to replay, and no off-chain
> withdrawal queue to double-process.

**Key trust assumption / weakness:** the **yield index updater is a single trusted
key**. A compromised updater could push a false yield index and distort YT payouts. The
**multi-sig / decentralized oracle** path remains the right future fix. *(This is the #1
thing a rebuild should address.)*

---

## 11. Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart contracts | Rust `#![no_std]`, Soroban SDK, target `wasm32v1-none` |
| Token standard | Stellar Asset Contract (SAC) via `token::Client` — stsUSDe + Stellar-native USDC |
| Yield updater | Node.js ≥18, @stellar/stellar-sdk; periodic `update_yield_index()` only (no EVM, no ethers.js, no bridge listener) |
| Frontend | React 18 + Vite, Freighter API (v5/v6), @stellar/stellar-sdk, custom CSS (glassmorphism dark + neon) |

---

## 12. Project Structure (old layout)

> Old layout shown with the **bridge/EVM pieces struck out** (removed in the rebuild).

```
stellar-pendle/
├── client/                    # React/Vite frontend
│   └── src/
│       ├── lib/
│       │   ├── stellar.js          # read helpers (simulate only)
│       │   └── stellar-wrapper.js  # write helpers (sign + send via Freighter)
│       ├── pages/
│       │   ├── LandingPage.jsx
│       │   ├── MarketsPage.jsx     # PT/YT market overview & rates
│       │   ├── MarketplacePage.jsx # buy/sell PT & YT (USDC-settled)
│       │   ├── TradePage.jsx       # mint split, redeem PT, claim yield, combine
│       │   ├── AdminPage.jsx       # dev utilities
│       │   └── ⌫ VaultPage.jsx     # REMOVED — was EVM ↔ Stellar bridge deposit/withdraw
│       └── components/  (Navbar, TradeModal, TransactionModal, ReturnToggle)
│
├── contracts/                 # Soroban contracts (Rust)
│   ├── yieldOracle/           # Yield index store + server  (was bridgeContract, bridge role removed)
│   ├── wrapper/               # Derivative engine (PT/YT lifecycle)
│   └── marketplace/           # P2P marketplace (USDC-settled)
│
├── token/                     # Soroban token utility / SAC helpers (stsUSDe + USDC references)
│   └── src/ (contract, balance, allowance, admin, metadata, storage_types)
│
├── admin/
│   └── yield-updater/         # Node.js: periodic update_yield_index() only
│                              # ⌫ REMOVED: relayer bridge listener + EVM Vault + bridge-frontend
│
└── README.md
```

---

## 13. Deployed Addresses (for reference)

> These are the **old** deployments. The rebuild is Stellar-only, so the EVM (Sepolia)
> Vault and the Ethereum-mainnet `sUSDe` yield source are **dropped**. The old
> "Bridge / Yield Oracle" contract's relevant part is now just the **Yield Oracle**.

**Stellar Mainnet (Public) — old deployments, for reference:**
| Contract | Address |
|----------|---------|
| Yield Oracle (was Bridge / Yield Oracle) | `CDNOZGG2ZT6J2ZBI6AVX3JLNSOSPMLCB6AFR7E4YOLPBRK3J3JYM33WW` |
| stsUSDe Token (SAC) | `CDO7QZPI2OYXEAD2KMKMJ3744DMUYGSUQSRUFEVDYSDXCGDFGI2CMHY4` |
| Marketplace / OrderBook | `CDHHGWGBGT6APB3CDODQJPGUXLYPIU34VV6PBT7SRRHBY3KEWYJVOQHS` |
| Wrapper | `CA4B534BCYQQ2D6S46XEC4WGGL2J5M7347XABEXAG4SU4I4QULJPCMQT` |

**New in the rebuild:** add the canonical **Stellar-native USDC** asset (Circle-issued
SAC) as the marketplace settlement token. *(No EVM addresses needed anymore.)*

**Links:** Live app `https://spield.vercel.app` · Docs `https://spield.gitbook.io/self-docs`

---

## 14. MVP Assumptions & Simplifications (worth re-evaluating in the rebuild)

- Underlying yield range over the term assumed **~4–5%**.
- PT/YT prices **hard-coded** at 0.97 / 0.03 in the marketplace (not market-discovered).
- Orderbook is **fixed-price sell + auto-match buy**, not a true bid/ask limit-order book.
- Yield index pushed periodically by a **single trusted updater** (central point of trust).
- Read-only views use a **static demo address**.
- Contract crates still named `hello-world` (Soroban template leftovers).

**Removed vs. the old design (no longer assumptions to worry about):**
- ~~Cross-chain bridge (EVM Sepolia Vault ↔ Stellar) and the relayer's bridging role.~~
- ~~Hard `×10 / ÷10` decimal conversions tied to EVM vs Soroban token decimals.~~
- ~~Replay protection / `Processed(BytesN<32>)` for bridged EVM tx hashes.~~
- Settlement and the underlying are now **Stellar-native** (USDC + stsUSDe), single-chain.

---

## 15. The Essential Logic, Distilled (for the rebuild)

If you strip away the infrastructure, the protocol is just these rules:

1. **Mint:** Lock 1 `stsUSDe` → get 1 PT + 1 YT. Record the **entry yield index**.
2. **Yield:** `YT_payout = (currentIndex − entryIndex) × YT_amount` (clamp negatives at 0).
3. **Maturity:** PT redeems 1:1 for the underlying (time-gated on-chain).
4. **Early exit:** Burn equal PT + YT → recover principal (forfeit pending yield).
5. **Invariant:** `Value(underlying) = Value(PT) + Value(YT)` — always.
6. **Trade:** PT and YT move freely on a secondary market before maturity, settled in **Stellar-native USDC**.
7. **Oracle:** A trusted updater publishes the yield index from a verifiable source.

Everything else (the SAC tokens, Freighter, the index updater) is **plumbing** to make
those 7 rules work — now entirely on **Stellar**, no cross-chain bridge.
