# USTRY app integration v1 — implementation work record

Work branch: `ustryintegrationv1`. The user explicitly authorized testnet implementation, public testnet transactions and thorough testing. No production deployment or push is implied. Keep all existing user commits and changes.

## Intended behavior

- Two adjacent selectors are recommended: **Yield source** (Blend/USTRY), then **Series / maturity**, filtered by source and network. A single optional layout question has been sent to the user; do not ask it again. Source-specific series selection should persist and must reset pending inputs/quotes and data when changed.
- Blend continues using its existing stack. USTRY uses a separate immutable deployment and source client; no global Blend contract override may silently replace a USTRY address.
- Complete USTRY vertical slice: genuine token balance/custody, direct deposits and atomic deposit/split, transferable receipt/PT/YT tokens, yield claims, pre-maturity recombination, maturity settlement and in-kind token withdrawals, source-specific portfolio/health views and conversion through explicitly quoted SDEX paths.
- Do not show unsupported USTRY PT AMM, LP or fixed-vault actions as if they existed. Filter/describe capabilities using source metadata. USTRY denomination and payout units must remain separate from USD face; no USD principal guarantee or invented fixed APR.

## Contract implementation design

Use a new `spield-rwa` crate based on the proven `rwa-prototype` accounting, leaving historical fixtures untouched. Add an immutable admin and one-time token binding, actual SEP-41 token facades backed by the engine's existing claim ledger, total YT supply tracking, oracle-free receipts/PT transfers, allowance-authorized facade-to-core transfers/burns, atomic `deposit_split`, config views, deposit cap and pause for new exposure (exits remain open).

A separate `rwa-token` facade is deployed three times (receipt/PT/YT), delegating balance/supply to the engine and using its own standard allowances. Only bound facade addresses may call delegated core transfer/burn entrypoints. YT movement must settle both owners first; `transfer_from` must not also demand the owner's signature. Bind validates engine, kind and decimals for all three addresses. Burning claims abandons the corresponding right without paying it out; do not strand credited YT earnings.

A separate `ustry-oracle` contract must use genuine **sandbox** NAV, not the already matured controlled-price fixture or mainnet NAV. Proposed adapter interface matches the accounting engine (`asset/base/decimals/observations`). An explicitly labeled server-side relay reads Etherfuse's public sandbox token-cost endpoint and publishes authenticated on-chain observations. Price is USD/token at 8 decimals and observation times are seconds. The API response time is NOT proven underlying bond NAV effective time; document this limitation. Reject invalid/zero/future/backdated samples and wrong source metadata. Keep append-only history bounded; use a per-series oracle and 12h heartbeat / 10 bps price-change policy (13h consumer freshness), plus an explicit observation crossing maturity. This bounds a 14–30 day experiment to a small history. Retire/rotate at series end. A production RedStone oracle integration/independent methodology remains separate.

Existing core loss policy remains: inverse high-water NAV token allocations, live NAV for USD value, no fresh yield on recovery below the old high; block new splits in drawdown. Maturity freezes token allocation from retained observations at/before expiry, with later history proving the boundary and no interpolation. Frozen payouts need no live oracle. Exits can fail during issuer freeze/clawback or unavailable maturity history; do not claim principal protection.

## Frontend integration map

- Registry: `frontend/src/lib/series.ts`, global config: `frontend/src/lib/config.ts`.
- Selection provider: `frontend/src/context/SeriesContext.tsx`.
- Header: `components/dashboard/layout/Header.tsx`, existing `SeriesHeaderControl.tsx` already combines series with maturity.
- Dashboard: `pages/DashboardApp.tsx`, `pages/DashboardPage.tsx`; source-specific USTRY sections should prevent any Blend panel/client mounting under a USTRY selection.
- Current `ProtocolContext.tsx` imports Blend `v2adapters` directly; guard its loads when USTRY is selected, and invalidate requests/data on a source/series change. Use a dedicated USTRY context/client with series-identity cache keys.
- Existing write/read helpers: `lib/soroban.ts`; browser wallet signs, no API keys/private keys in frontend.
- Existing config globally applies `VITE_SR*` overrides in `getActiveSrContracts` to every selected series; eliminate cross-source override leakage. Add tests for source/network/series switching and address isolation.
- Browser-test tooling already includes Playwright. Local build supports explicit testnet mode; do not accidentally enable USTRY transactions in the mainnet build.

## Validation required before completion

1. Native accounting regression tests plus facade/allowance/auth tests, loss, stale prices, pause, maturity history and custody invariants.
2. Actual compiled-WASM integration, successful release builds, formatting/Clippy for new crates.
3. Frontend TypeScript/build, source isolation and browser tests for selectors, reload persistence, responsive layout, disconnected/error/stale states, and preventing stale selected-series writes.
4. Deploy a fresh genuine-USTRY app series on Stellar testnet (not the expired six-minute fixture), seed its sandbox NAV oracle and bind token contracts.
5. Small signed actual-asset deposit/split, token transfer/allowance, yield/recombine/payout tests; use a separate short-lived fixture for maturity and bad-price drills so the user-facing NAV remains genuine. Verify returned balances and public hashes. Preserve funds outside the bounded test.
6. Update this record and the USTRY README with deployments, exact runtime commands/keeper requirements, results and remaining limitations. Do not publish or push unless asked.

## Existing resources and safe execution

- Local signable registered sandbox wallet: `alice425`, public `GDXHBXYT23MUJWOKNZLTRBYJA2H6LDIL2DVHJCVITEFKQK5QUT2LPBJF`.
- Last balances after the GATAL route test: 3.3111519 USTRY, 0.6044581 GBBD-USDC, 132.9055385 GATAL-USDC, ample test XLM. Recheck before transactions. Additional simulated funding is authorized if needed.
- Genuine sandbox USTRY SAC: `CCUGMX7HX6CH6T4XNPALQ7HCVU37RLUNHAYNSAIALTPFHFQVIRIHALBC`, issuer `GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4`.
- Public source: `https://api.sand.etherfuse.com/lookup/tokens/cost/ustry`. Etherfuse v1 sandbox host is `https://api.sand.etherfuse.com`.
- `.env` contains only the designated API credential for this work; never dump it, source it or print secret keys. Existing scripts capture `stellar keys secret alice425` into memory only and hard-pin Stellar testnet endpoints/passphrase. Private journals live under `/tmp/spield_etherfuse_execution` mode 0600.
- Existing proven execution helpers and signing guards are under `contract/spield/scripts`; API funding/order state is in the private journal. Use fixed testnet network selection and bounded amounts; inspect provider instructions before signing.
- Automatic review previously rejected a Cloudflare callback tunnel. Do not retry/work around that egress rejection. The safe first-party Etherfuse WebSocket works (`SwapUpdate` with `data.swap`), and has already settled swaps in both directions.
- GATAL USDC is not the Circle-listed testnet asset. It works through an explicit SDEX path via GBBD-USDC, while the provider v1 quote API rejects it directly. Circle's published testnet issuer is GBBD. Both code and issuer are part of asset identity.

## Progress

- Repository inspected; branch and working tree clean at start.
- UI layout question sent once; useful work continues independently.
- Implementation design and cross-source failure cases recorded. Contract, relay and app code changes are next.
