# Instaward — Deliverable Submission (draft content)

Draft text for each field of the deliverable completion form, written against what is
actually live on **2026-09-01**, and calibrated against the §4.1 scope we committed to.

Everything below is checked against the repo and the chain, not against status docs.
Sources: `MAINNETCONTRACTADDRESSES.md`, `MAINNET_LAUNCH.md`, `90MINUTEMARKET.md`, `notcovered.md`.

---

## Blanks to fill before you submit

| # | Blank | Where it appears |
|---|---|---|
| 1 | `<DEPOSIT_TX>` / `<REDEEM_TX>` — the 90-minute demo series lifecycle hashes | Deliverable 1, Evidence 1 |
| 2 | `<MULTISIG_DATE>` — the date you will run `rotate_admins.sh rotate` on mainnet | Deliverable 1, Next Steps |
| 3 | `<BRIDGE_BURN_TX>` / `<BRIDGE_MINT_TX>` + the recording link | Deliverable 2, Evidence 2 |
| 4 | `<DEMO_VIDEO_URL>` — the 2–3 min user walkthrough | Deliverable 3, Evidence 3 |
| 5 | `<SCREENSHOTS_LINK>` — where the before/after shots live | Evidence 3 |

If a hash genuinely does not exist by submission time, delete the sentence rather than
leaving a placeholder. An honest gap reads better than a broken link.

---

# 1. Deliverables Completed

## Deliverable 1 Completed *(required)*

**Delivered. Spield is live on Stellar mainnet.**

All six v2 contracts were deployed on 1 September 2026 against the real Blend FixedV2 pool
and real Circle USDC. After deploy, 24 of 24 wiring assertions passed, and every live WASM
was fetched back off-chain and confirmed byte-identical to the binary we built — so the code
running on mainnet is provably the code in the repo. The reproduction command is in
`MAINNETCONTRACTADDRESSES.md`.

Hardening completed before launch:

- Two-step upgrade timelock (`schedule_upgrade` → `apply_upgrade`) on every upgradeable
  contract, with tests proving an upgrade cannot be applied early, cannot be accelerated by
  shortening the delay, and can be cancelled.
- Governance and pause paths reviewed and covered by tests.
- Fixed rate calibrated against Blend's real live rate data, with an on-chain gate that
  refuses to set a rate the yield source cannot fund.
- 605 automated tests passing, 0 failing. 198 of those are AMM-specific, plus 68 adversarial
  and invariant end-to-end tests.
- All 8 emergency drills (pause, unpause, rotation, cancel, recovery) executed and timed on
  testnet before we touched mainnet.

Launch state on chain today:

- **Guarded Launch Cap live at 50 USDC** total TVL, changeable only by the admin. It stays in
  place until a professional audit clears.
- **Fixed-Rate Vault seeded** with 2 USDC of coupon capacity, funded from our own treasury,
  so public deposits succeed rather than bouncing on empty capacity.
- **PT issuer locked permanently** — no signer holds any weight, verified on Horizon. PT can
  only ever be minted by the yield engine.
- **Public solvency dashboard live** at https://app.spield.live/solvency, reading backing vs.
  principal straight from the contract, no wallet needed.
- Fixed rate 3.00%, series matures 30 September 2026, protocol not paused.

Full lifecycle proof: the live series has a 30-day maturity that is immutable by design, so a
redeem transaction on it cannot exist before 30 September. Rather than leave the lifecycle
unproven, we deployed a second, disposable 90-minute series on mainnet — same code, same day,
real USDC, cost 1.28 XLM and 0.60 USDC — and walked deposit → maturity → redeem on it.
Hashes: `<DEPOSIT_TX>`, `<REDEEM_TX>`. The live series' own redeem hash follows on
30 September and we will submit it then.

Two items from this deliverable are not closed, and we would rather say so than imply
otherwise:

- **Multisig rotation has not run on mainnet yet.** The 2-of-3 account and all three signers
  exist and are funded, and the rotation script has been round-tripped on testnet, 25 of 25
  checks in both directions. Admin is still the deployer key. Scheduled for `<MULTISIG_DATE>`.
- **The cap is global, not per-address.** We committed to both. Total exposure is capped,
  which was the point, but one address could take the whole headroom today.

## Deliverable 2 Completed

**Delivered, with one supplier change worth stating up front.**

Allbridge discontinued their service while we were integrating. Rather than ship a dead
route, we rebuilt the on-ramp on Circle's own rail, CCTP V2. That is a better outcome than
the original plan: native 1:1 burn-and-mint USDC, no wrapped asset, no slippage, and no
third-party bridge risk.

Working in the app today:

- Six EVM mainnets → Stellar USDC: Ethereum, Base, Arbitrum, OP Mainnet, Polygon, Avalanche.
  Live fee quoting, both Fast and Standard modes.
- Solana → Stellar USDC.
- The real-world edge cases we promised to handle: USDC trustline creation, expired contract
  state restoration, route and quote selection, and recipient re-verification before the
  burn, which is irreversible.
- Transfer history in the app with live status for each transfer.

**Not delivered: Tron.** CCTP has no Tron domain, and Allbridge was the only route that had
one. There is no way to build this today with anything available to us. We will add it if a
rail appears.

Validation: a real bridge-in on mainnet, visible in the app's transfer history —
`<BRIDGE_BURN_TX>` (source burn) and `<BRIDGE_MINT_TX>` (Stellar mint).

## Deliverable 3 Completed

**Delivered, both halves.**

**UI/UX overhaul.** The deposit → fixed-yield journey was rebuilt: one-click PT trustline
(YT needs none — it is a contract with a transfer hook, not a standard asset), fixed rate,
coupon and maturity written in plain language, six wallets supported (Freighter, xBull,
Rabet, Hana, LOBSTR, Albedo), and pending / success / error feedback on every transaction.
The risk disclosure shows the live deposit cap next to the risk it bounds, and says plainly
that the protocol is unaudited. Mobile pass covered all 10 app routes at 320, 375 and 414 px,
verified in a real browser, plus the marketing site. Before/after screenshots captured.

**Builder SDK.** `@spield/sdk` version 0.4.2 is published on npm and pointed at testnet, as
the scope specified. Verified rather than assumed: a fresh install into an empty project
works, and the installed package reads live testnet data — health, exchange rate, total
assets, deposit previews, positions, receipts and solvency. A runnable example ships with it.

Live app: https://app.spield.live

---

# 2. Evidence Collected

## Evidence 1 — Deliverable 1 (mainnet contracts and lifecycle)

Mainnet contract addresses, all openable in a Stellar explorer:

- SR — `CCOZ2JGQAPLUOG5RVU3TLPGSS7WA356BWCOEWFBJU44DKHDRZTQPABBS`
- Strategy (Blend adapter) — `CAJKHGY3J2XSZHI3TFDFMXJ2GDFFUPUPPTUOP6UOBHSY6FW66J6YYBP7`
- Yield engine, which is also the YT token — `CDILIYN4IXUL5H7PJ4TW3GLZ2U6LIZYX35SNN4BGYZWPIXFLJZEFMRLP`
- SR Market (PT/SR AMM) — `CDRQJ7EYKTJV3W4BE2U4HIAWSVZB675MHTCBDGCXMKVR5VCURMNSEZ7O`
- SR Vault (Fixed-Rate Vault) — `CDNRQ4YLW4RA4LB4J4M5S3X4SEXXR3Z6TR7336VKOG3FPX3PBFAMVZ6P`
- SR Router — `CB7O72TTK7OISNS53HXTLCZ2EAY2F5KKYBPGI7ADSIX5KMPGVVDXAALN`
- PT asset — `SPLDPT:GDNSUOHJIWYXX6HC6ZVDJNLSIBLZMLJYBG7NAN2CRUSXOG4FIDAOH5KN` (issuer locked)

Explorer link format: `https://stellar.expert/explorer/public/contract/<address>`

Lifecycle transactions on mainnet (90-minute validation series, same code):

- Deposit — `<DEPOSIT_TX>`
- Redeem after maturity — `<REDEEM_TX>`
- The live series' redeem hash follows on 30 September 2026.

Also submitted:

- Public solvency dashboard — https://app.spield.live/solvency
- Code verification: each contract's `version()` string and sha256, with the command to fetch
  the live WASM and diff it against the built artifact — `MAINNETCONTRACTADDRESSES.md`.

## Evidence 2 — Deliverable 2 (cross-chain on-ramp)

- Source-chain USDC burn — `<BRIDGE_BURN_TX>`
- Stellar USDC mint — `<BRIDGE_MINT_TX>`
- Screen recording of the on-ramp flow, unedited: connect EVM wallet → connect Stellar wallet
  → confirm recipient → approve → burn → attestation → mint → the transfer appearing in
  history. Link: `<see Supporting Materials>`

## Evidence 3 — Deliverable 3 (app and SDK)

- Live app — https://app.spield.live
- Published SDK — https://www.npmjs.com/package/@spield/sdk (version 0.4.2, testnet)
- Before/after screenshots of the deposit → fixed-yield journey — `<SCREENSHOTS_LINK>`
- Demo video, a non-technical user doing connect → trustline → deposit → see fixed receipt —
  `<DEMO_VIDEO_URL>`

## Supporting Materials *(file upload)*

Upload, in this order:

1. Before/after UI screenshots (deposit → fixed-yield journey).
2. The on-ramp screen recording.
3. The user walkthrough demo video.
4. `MAINNETCONTRACTADDRESSES.md` as PDF — addresses, parameters, code hashes, and the
   verification command in one page.
5. Test run output: 605 passed, 0 failed.

---

# 3. Outcome and Feedback

## General Comments and Outcomes

The sprint did what it set out to do: Spield went from a tested testnet build to a live,
guarded mainnet protocol inside 30 days. Six contracts are on mainnet, the vault is seeded
and open, the cap is enforced on chain, the app is live, and the SDK is on npm.

Two things went differently from the plan, both handled rather than absorbed:

- Allbridge shut down mid-integration. We migrated the on-ramp to Circle CCTP V2 and ended up
  with a better rail than we promised, minus Tron, which no longer has any route.
- The live series' 30-day maturity is immutable, so its redeem hash cannot exist before
  30 September. We deployed a throwaway 90-minute mainnet series to prove the full lifecycle
  on real infrastructure instead of waiting.

The launch is deliberately small. A 50 USDC cap on an unaudited protocol is not a soft
number, it is the whole safety argument, and it stays until an audit clears. Everything we
shipped is built to be checked rather than trusted: the deployed code is byte-identical to
the repo, the solvency page reads from chain with no wallet required, and the UI states
plainly that the protocol is unaudited.

What is still open: the admin rotation to the multisig, AMM liquidity seeding, and the
30 September redeem hash. None are blocked on anyone else.

## Blockers or Lessons Learned

- **Suppliers disappear.** Allbridge discontinued their service mid-build. The lesson was to
  move to the asset issuer's own rail rather than another intermediary. CCTP is Circle's, and
  Circle issues the USDC.
- **Never extrapolate mainnet costs from testnet.** We estimated 3.4 XLM for the six WASM
  uploads from testnet measurements. Mainnet quoted 217 XLM — 64× — because large persistent
  entries carry rent. Read-only calls cost the same on both networks, which is what made the
  first estimate look reasonable. Simulate every write against mainnet before funding.
- **Immutable parameters need to be decided before deploy, not after.** Maturity is set once,
  in `initialize`, with no roll function. Choosing 30 days meant no redeem hash inside the
  submission window. The fix — a second, disposable series — cost 1.28 XLM because the code
  was already uploaded and only the instances were new. Worth knowing: redeploying published
  contracts is nearly free.
- **Seeding consumes the deposit cap.** Both the vault seed and any AMM liquidity go through
  the same deposit path users do, so the cap covers seed plus users combined. And the cap
  compares against current TVL, so lowering it below what is already deposited blocks all new
  deposits. We verified that on testnet before it could bite on mainnet.
- **A hot admin key over live funds is the risk that matters.** The rotation script was
  written and drilled early. Running it is the first thing on the list after launch.
- **Test breadth is not the same as test class.** 198 AMM tests are example-based. Property
  and fuzz tests over the time-decay curve are the class that finds curve bugs, and we have
  not added them yet. They are next.

---

# 4. Assessment & Next Steps

*(This section was cut off in the form screenshot — adjust to the actual field labels.)*

Immediate, this week:

1. Rotate all six contracts' admin and treasury to the 2-of-3 multisig (`<MULTISIG_DATE>`).
   Script is drilled both directions.
2. Seed the AMM from the dashboard as an ordinary LP, so the PT/SR market can fill.
3. Publish the live series' redeem transaction on 30 September 2026.

Next 30–60 days:

4. Professional third-party security audit via the SCF Build Award. The Guarded Launch Cap
   stays until it clears; once it does, raise the cap in stages and add per-address limits.
5. Add property and fuzz test layers over the AMM curve.
6. Point the SDK at mainnet, after the audit.
7. Deferred as planned and unchanged: DeFindex as a second yield source, MoneyGram fiat
   on/off-ramp, additional maturities.
