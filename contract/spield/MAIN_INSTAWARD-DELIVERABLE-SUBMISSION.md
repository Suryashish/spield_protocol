# Instaward — Deliverable Submission (draft content)

Draft text for each field of the deliverable completion form, written against what is
actually live today, and calibrated against the §4.1 scope we committed to.

Everything below is checked against the repo and the chain, not against status docs.

---

## Blanks to fill before you submit

None. Every field below is filled in with live links and on-chain transaction hashes.

---

# 1. Deliverables Completed

## Deliverable 1 Completed *(required)*

**Delivered. Spield is live on Stellar mainnet.**

All six v2 contracts are deployed on mainnet against the real Blend FixedV2 pool
and real Circle USDC. After deploy, 24 of 24 wiring assertions passed, and every live WASM
was fetched back off-chain and confirmed byte-identical to the binary we built — so the code
running on mainnet is provably the code in the repo. Anyone can reproduce that check:
fetch the live WASM for each contract and compare its sha256 against the built artifact.

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

**Full lifecycle proven on mainnet.** The live series has a 30-day maturity that is immutable
by design, so a redeem transaction on it cannot exist before 30 September. Rather than leave
the lifecycle unproven, we deployed a second, disposable 90-minute series on mainnet — same
code, same day, real USDC, cost 1.28 XLM and 0.60 USDC — and walked the complete cycle on it:
deposit into the Fixed Vault, redeem after maturity, and claim the yield.

- Deposit into the Fixed Vault — https://stellar.expert/explorer/public/tx/275816022291398656#275816022291398657
- Redeem from the Fixed Vault — https://stellar.expert/explorer/public/tx/275838884402204672#275838884402204673
- Claim yield — https://stellar.expert/explorer/public/tx/275838927352209408#275838927352209409

The live series' own redeem hash follows on 30 September 2026 and we will submit it then.

**Multisig custody is done.** The admin of all six live contracts has been moved off the
single deployer key and onto a 2-of-3 multisig account. The multisig was built
first — three signers of weight 1 added, the account's own master key disabled, and low,
medium and high thresholds all set to 2 — so no single key can act for it. Soroban calls are
medium-threshold operations, which is the one that governs admin actions.

The handover is two steps by design: the current admin proposes the new one, and the new one
has to accept. An address that cannot sign can never become admin, so rotating to a typo or a
key nobody holds is impossible.

Verified on chain after the rotation, not assumed:

- All six contracts report the multisig as admin, with no proposal left pending.
- The old deployer key, signing alone, is rejected by the network with `TxBadAuth`. It can no
  longer act as admin of anything.
- A single multisig signer, acting alone, is also rejected with `TxBadAuth` — the 2-of-3
  threshold genuinely holds.
- The multisig is functional, not just recorded: all six `accept_admin` calls were
  admin-gated actions authorized by two signatures.

One thing deliberately left where it was: the three addresses that receive money —
`yield.treasury`, `srmarket.treasury` and `strategy.emissions_to` — still point at the
operating account. Control and income are separate concerns, and a cold multisig is the right
home for control but an awkward one for a fee stream you spend from. Moving them is a
one-command step whenever we choose.

One item from this deliverable is not closed, and we would rather say so than imply otherwise:

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

Validated by a real bridge-in on mainnet, Base → Stellar, visible in the app's transfer
history:

- USDC burn on Base — https://basescan.org/tx/0xc03074fa4c140eccccce151aa8561a97942957b4ee572c0eab086c91651c2eda
- USDC mint on Stellar — https://stellar.expert/explorer/public/tx/275407794239995904#275407794239995905
- Screen recording of the on-ramp flow — https://drive.google.com/file/d/19bB6HPY84GRHNxCg_vJr5cSbO33ItYMj/view?usp=sharing

## Deliverable 3 Completed

**Delivered, both halves.**

**UI/UX overhaul.** The deposit → fixed-yield journey was rebuilt: one-click PT trustline
(YT needs none — it is a contract with a transfer hook, not a standard asset), fixed rate,
coupon and maturity written in plain language, six wallets supported (Freighter, xBull,
Rabet, Hana, LOBSTR, Albedo), and pending / success / error feedback on every transaction.
The risk disclosure shows the live deposit cap next to the risk it bounds, and says plainly
that the protocol is unaudited. Mobile pass covered all 10 app routes at 320, 375 and 414 px,
verified in a real browser, plus the marketing site. Before and after screenshots captured.

**Builder SDK.** `@spield/sdk` version 0.4.2 is published on npm and pointed at testnet, as
the scope specified. Verified rather than assumed: a fresh install into an empty project
works, and the installed package reads live testnet data — health, exchange rate, total
assets, deposit previews, positions, receipts and solvency. A runnable example ships with it.

- Live app — https://app.spield.live
- Published SDK — https://www.npmjs.com/package/@spield/sdk

---

# 2. Evidence Collected

## Evidence 1 — Deliverable 1 (mainnet contracts and lifecycle)

The six live mainnet contracts, as explorer links:

- SR — https://stellar.expert/explorer/public/contract/CCOZ2JGQAPLUOG5RVU3TLPGSS7WA356BWCOEWFBJU44DKHDRZTQPABBS
- Strategy (Blend adapter) — https://stellar.expert/explorer/public/contract/CAJKHGY3J2XSZHI3TFDFMXJ2GDFFUPUPPTUOP6UOBHSY6FW66J6YYBP7
- Yield engine, which is also the YT token — https://stellar.expert/explorer/public/contract/CDILIYN4IXUL5H7PJ4TW3GLZ2U6LIZYX35SNN4BGYZWPIXFLJZEFMRLP
- SR Market (PT/SR AMM) — https://stellar.expert/explorer/public/contract/CDRQJ7EYKTJV3W4BE2U4HIAWSVZB675MHTCBDGCXMKVR5VCURMNSEZ7O
- SR Vault (Fixed-Rate Vault) — https://stellar.expert/explorer/public/contract/CDNRQ4YLW4RA4LB4J4M5S3X4SEXXR3Z6TR7336VKOG3FPX3PBFAMVZ6P
- SR Router — https://stellar.expert/explorer/public/contract/CB7O72TTK7OISNS53HXTLCZ2EAY2F5KKYBPGI7ADSIX5KMPGVVDXAALN
- PT token (SPLDPT) — https://stellar.expert/explorer/public/contract/CBGA2TFTSF236VYPI5TVYQ2Z53DKD6LQHIR5DCGKSNIUJ4NAPNBI6VJM
- PT issuer, locked forever — https://stellar.expert/explorer/public/account/GDNSUOHJIWYXX6HC6ZVDJNLSIBLZMLJYBG7NAN2CRUSXOG4FIDAOH5KN

Full lifecycle on mainnet. This 90-minute series exists to show the complete life cycle of
Spield's fixed income and redeem functions inside the submission window, because the live
series cannot be redeemed until 30 September. Same code, real USDC.

- Deposit into the Fixed Vault — https://stellar.expert/explorer/public/tx/275816022291398656#275816022291398657
- Redeem from the Fixed Vault — https://stellar.expert/explorer/public/tx/275838884402204672#275838884402204673
- Claim yield — https://stellar.expert/explorer/public/tx/275838927352209408#275838927352209409

Multisig custody. Admin of all six contracts moved to a 2-of-3 account. The account itself,
showing three signers of weight 1 and its own master key at weight 0:

- https://stellar.expert/explorer/public/account/GDJ66WMVVH6MWBL4KORY2HOXWLY4UGFCMP64RC474LUJPQCPQUC4RUFL

The transaction that made it a 2-of-3 (master key disabled, thresholds set to 2):

- https://stellar.expert/explorer/public/tx/f97011eb9394e19c802854a501e7b295cd029e1ba9e0710b048fb8610fb1a327

The six handover transactions, each an `accept_admin` signed by two of the three signers:

- SR — https://stellar.expert/explorer/public/tx/a1ea497c5342071a47bddc2ee95df10dea7fda7e12d8b5e5a0cc97ddf56fa409
- Strategy — https://stellar.expert/explorer/public/tx/bea64c8ce60d72a45d99f93b8aae6ee3d31dfdb1655c5efb4731bd2f3e4bd874
- Yield — https://stellar.expert/explorer/public/tx/68e0d0f5badacdc815305a5c4c2befd825e4bb0a6f296b3222e3527d948869bc
- SR Market — https://stellar.expert/explorer/public/tx/9fcd1487dbaddf949012edb56ca205f22bcc40b2c82f2994fcde3ec1dce32b56
- SR Vault — https://stellar.expert/explorer/public/tx/5ce278b6806cb9613212b2f5900d533a55a994e60fa7cae3ac860dcab54becd7
- SR Router — https://stellar.expert/explorer/public/tx/488dad505d88a3b74991543b2340eb035bb335923cd52969ce35a555b1feaeb3

Anyone can confirm the result without trusting us: call `admin()` on any of the six contracts
and compare it to the account above.

Also submitted:

- Public solvency dashboard — https://app.spield.live/solvency
- Code verification: each contract's `version()` string and sha256, with the command to fetch
  the live WASM and diff it against the built artifact — supplied as a one-page attachment.

## Evidence 2 — Deliverable 2 (cross-chain on-ramp)

A real Base → Stellar USDC transfer on mainnet, end to end:

- USDC burn on Base — https://basescan.org/tx/0xc03074fa4c140eccccce151aa8561a97942957b4ee572c0eab086c91651c2eda
- USDC mint on Stellar — https://stellar.expert/explorer/public/tx/275407794239995904#275407794239995905
- Screen recording of the on-ramp flow, showing the transfer landing in the app's transfer
  history — https://drive.google.com/file/d/19bB6HPY84GRHNxCg_vJr5cSbO33ItYMj/view?usp=sharing

## Evidence 3 — Deliverable 3 (app and SDK)

- Live app — https://app.spield.live
- Published SDK — https://www.npmjs.com/package/@spield/sdk (version 0.4.2, testnet)
- Before and after screenshots of the deposit → fixed-yield journey — https://drive.google.com/drive/folders/1cpiEMAlggtkVrRb36BRZUeSeM9n1033o?usp=sharing
- Demo video, a non-technical user doing connect → trustline → deposit → see fixed receipt — https://drive.google.com/file/d/1Vrq5jr_CJpVCV47Gf-3hI5qYrxJMkwd2/view?usp=sharing
- Detailed product walkthrough (extra) — https://drive.google.com/file/d/1fnFtfJVUT1XrPF8QEx_r7vjESrVF6Ur1/view?usp=sharing

## Supporting Materials *(file upload)*

Every link above is already in the evidence fields, so this upload is a backup copy for the
reviewer. Attach:

1. Before and after UI screenshots (deposit → fixed-yield journey).
2. The on-ramp screen recording.
3. The non-technical user demo video, and the detailed walkthrough.
4. A one-page PDF of the mainnet contract addresses, parameters, code hashes, and the
   verification command.
5. Test run output: 605 passed, 0 failed.

---

# 3. Outcome and Feedback

## General Comments and Outcomes

The sprint did what it set out to do: Spield went from a tested testnet build to a live,
guarded mainnet protocol inside 30 days. Six contracts are on mainnet, the vault is seeded
and open, the cap is enforced on chain, the app is live, and the SDK is on npm. The complete
fixed-income cycle — deposit, redeem at maturity, claim yield — has been walked on mainnet
with real USDC, and a real Base → Stellar transfer has landed through the on-ramp.

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

Custody was the last piece of the hardening work and it is now done: all six contracts are
under a 2-of-3 multisig, and the single deployer key that held them at launch has been proven
powerless on chain.

What is still open: AMM liquidity seeding, and the 30 September redeem hash on the live
series. Neither is blocked on anyone else.

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

Done since launch:

- Admin of all six contracts rotated to the 2-of-3 multisig, verified on chain in both
  directions.

Immediate, this week:

1. Seed the AMM from the dashboard as an ordinary LP, so the PT/SR market can fill.
2. Decide whether the three payout addresses (`yield.treasury`, `srmarket.treasury`,
   `strategy.emissions_to`) move to the multisig as well, or stay on an operating account.
3. Publish the live series' redeem transaction on 30 September 2026.

Next 30–60 days:

4. Professional third-party security audit via the SCF Build Award. The Guarded Launch Cap
   stays until it clears; once it does, raise the cap in stages and add per-address limits.
5. Add property and fuzz test layers over the AMM curve.
6. Point the SDK at mainnet, after the audit.
7. Deferred as planned and unchanged: DeFindex as a second yield source, MoneyGram fiat
   on/off-ramp, additional maturities.
