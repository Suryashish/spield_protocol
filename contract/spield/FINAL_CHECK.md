# Spield Protocol Contracts — Final Economic, Financial, and Logic Check

**Review date:** 2026-08-30  
**Reviewed commit:** `26f8fd8a84473f773193f01a7b36e023380993aa`  
**Primary scope:** current V2 stack — `strategy`, `sr`, `yield`, `srmarket`, `srvault`, and `srrouter`  
**Secondary scope:** retired V1 `wrapper`, `vault`, and `market`, deployment scripts/state, invariants, tests, and operational controls

## Final verdict

**No — the current tree cannot honestly be signed off as totally economically, financially, and logically correct. Do not deploy or seed V2 with real value yet.**

The V2 design is materially safer than V1 and most core accounting paths have strong conservation tests. I did not find an unrestricted admin-free path that directly drains `strategy`, `sr`, or `yield` principal under the intended assumptions. However, there is one newly confirmed high-severity V2 market defect:

> `srmarket` prices every value-moving trade with the stored SR index instead of synchronizing the live Blend-backed index. After yield accrues without another sync, a PT seller receives too many SR shares and can capture value that belongs to LPs.

There are also important conditional-solvency and deployment dependencies: Blend principal loss is socialized to users, exits freeze until an admin resets the rate floor, classic PT is safe only after its issuer is irreversibly locked, several durable claims need TTL keepers, and the repository currently labels the retired V1 mainnet addresses as V2.

The correct release decision is therefore **BLOCKED pending the P0 items below**.

## Severity summary

| ID | Severity | Status | Finding |
|---|---|---|---|
| V2-01 | **High / P0** | Confirmed | Market mutations use a stale SR index; accrued LP yield can be transferred to PT sellers and YT trades can create accounting residue |
| OPS-01 | **High / P0** | Confirmed | `MAINNETCONTRACTADDRESSES.md` calls the retired V1 deployment “V2”; no local `deploy_mainnet_v2.state` exists |
| OPS-02 | **High / P0** | Conditional | A live classic PT issuer can mint unbacked PT and redeem protocol backing; issuer lockdown is procedural |
| RISK-01 | **High residual risk** | By design | Blend loss or a falling `b_rate` freezes exits; after admin reset, loss is borne pro rata by users |
| V2-02 | **Medium** | Requires regression proof | `srvault` reserves two stroops per receipt, but repeated partial redemptions may round on every leg |
| OPS-03 | **Medium** | Confirmed | Long-lived holder/LP/receipt records depend on permissionless TTL keeper calls despite “claimable forever” language |
| CFG-01 | **Medium** | Confirmed | Launch-cap comments, value, and semantics disagree; configured default is 50 USDC, not 5 USDC |
| OPS-04 | **Medium** | Confirmed | A late first post-expiry sync includes post-expiry growth in the maturity index |
| V2-03 | Low | Confirmed | Direct token donations can grief router routes until admin sweep |
| ECO-01 | Low / design | Confirmed | Split trades receive better aggregate curve execution; normal MEV and route-splitting effects remain |
| ECO-02 | Informational | Confirmed | Blend BLND rewards are not claimed or distributed |

## P0 findings

### V2-01 — `srmarket` uses a stale SR index on value-moving trades

**Affected code**

- `contracts/srmarket/src/lib.rs:299`, `:344`, `:413`, and `:510` obtain the index through `Self::index()` for PT and YT mutations.
- `contracts/srmarket/src/lib.rs:855-856` implements that function by calling `yield.py_index()`.
- `contracts/yield/src/lib.rs:424-425` makes `py_index()` a pure view through `index_view()`.
- `contracts/yield/src/lib.rs:438-443` reads SR's stored exchange rate; it does not call `sr.sync_rate()`.
- `contracts/sr/src/lib.rs:339-341` confirms `exchange_rate()` is only the stored high-water value.
- In contrast, actual `yield.mint_py()` and `yield.redeem_py()` use the mutating current index at `contracts/yield/src/lib.rs:137` and `:176`.

The market comment calls `Self::index()` the “mutating-path version,” but it is not mutating. This creates two different prices inside some transactions: the market quote uses the old index, while the nested Yield action later synchronizes the live index.

**Confirmed economic effect**

A dedicated audit regression advanced time without explicitly syncing SR and then compared PT-sale quotes before and after sync:

```text
stored index:                 1,000,000,000,000
live index after accrual:     1,002,071,238,794
10,000 PT stale quote:           97,383,877,337 SR base units
10,000 PT synced quote:          97,182,640,892 SR base units
overpayment:                       201,236,445 SR base units
```

The stale quote overpaid about **20.12 SR** on that 10,000-PT test, matching the approximately 0.207% yield that had accrued but was absent from the stored index. The PT seller receives the excess; the SR reserve and its LPs bear it. Slippage limits do not protect LPs because the contract itself reports and executes the stale price.

For `buy_yt_exact_out`, the stale lower index calculates too many SR shares for the requested face. `yield.mint_py()` then synchronizes and mints more PT+YT than expected. All minted PT is added to the PT reserve, while only the requested YT is transferred; excess YT remains untracked in the market. The pair remains backed, so this is not the same as creating unbacked assets, but it distorts the trade/reserves and strands YT/yield.

**Required fix**

1. Add or expose a mutating Yield index method that synchronizes SR, or explicitly call `sr.sync_rate()` before market pricing.
2. Use the same synchronized index for all pricing, transfers, reserve changes, nested mint/redeem actions, and event values in one transaction.
3. Add regressions for every value-moving market route after time advances with no preceding sync:
   - PT → SR;
   - SR → PT;
   - buy exact YT;
   - sell exact YT.
4. Assert that implicit synchronization produces the same result as explicit pre-sync, within documented one-stroop rounding.
5. Assert the market has no untracked non-dust YT balance after a YT purchase.

### OPS-01 — the canonical mainnet address file identifies V1 as V2

`MAINNETCONTRACTADDRESSES.md:1` says “Spield v2,” but it lists only `Wrapper`, `Vault`, `Market`, classic PT/YT, and the old V1 state. `MAINNET.md:3-18` correctly states that this stack is retired and that V2 uses `sr`, `yield`, `srmarket`, `srvault`, and `srrouter`. `scripts/deploy_mainnet.sh:169` expects `deploy_mainnet_v2.state`, but only the old `scripts/deploy_mainnet.state` is present locally. `V2_WORK.md` also says V2 is not yet on chain.

The old deployment is documented as unseeded and empty, which limits present financial exposure. Nevertheless, mislabeling it as V2 creates a serious chance of a frontend, operator, or LP seeding contracts that the repository itself says must remain retired.

**Required action:** rename the file to an explicit V1-retired record or replace its heading with an unmistakable quarantine warning. Create a separate V2 address record only from the completed V2 deploy state and verified on-chain code hashes. **Never seed the listed V1 market or vault.**

### OPS-02 — PT solvency depends on irrevocably locking its classic issuer

Yield's on-chain accounting assumes every PT was minted through `yield.mint_py()`. A Stellar classic-asset issuer can bypass the contract and issue PT with a normal payment. Counterfeit PT can then consume real backing through post-expiry bearer redemption, up to the outstanding accounted principal before arithmetic/invariant checks stop later attempts.

The deployment script defaults to `LOCK_ISSUER=1` and performs signer checks at `scripts/deploy_mainnet.sh:499-545`; this is a good fail-closed control, but it is not a contract invariant. `LOCK_ISSUER=0` deliberately leaves the system unsafe.

**Required action:** before any V2 seed or user deposit, independently verify on Horizon that the exact recorded PT issuer has master weight zero and no signer with positive weight. Store that proof with the V2 deployment record. A skipped or failed lock is a hard launch blocker.

## Solvency and asset-depletion analysis

### Strategy and SR

The normal positive-yield path is coherent: the strategy holds Blend supply shares, SR represents those strategy shares, and SR's stored exchange rate only ratchets upward. Deposits mint the strategy-returned shares and redemptions burn SR before withdrawing.

This is **conditionally solvent, not principal-guaranteed**:

- `strategy.current_rate()` rejects a falling Blend rate (`contracts/strategy/src/lib.rs:211-228`).
- Any fall therefore freezes deposits, syncs, and redemptions at every size.
- Recovery requires the admin-only `strategy.reset_rate_floor()` (`contracts/strategy/src/lib.rs:357-408`).
- After reset, `sr.redeem()` returns what the strategy actually pays, so the loss is socialized pro rata among SR holders.
- SR's public high-water exchange rate remains nondecreasing, so a preview can show more underlying than the actual post-reset redemption pays.

This avoids first-withdrawer advantage in the tested loss case, but it is still a real user loss and an admin-dependent exit freeze. There is no insurance capital or junior tranche. Documentation and UI must not describe SR/PT/vault payouts as unconditionally guaranteed in USDC.

Blend utilization can also make otherwise solvent assets temporarily illiquid. `max_redeemable` and resumable vault redemption reduce this problem, but simulation-to-execution liquidity races can still revert a transaction.

### Yield / PT / YT

The main V2 accounting is well structured:

- PT and YT are minted equally against SR.
- Before expiry, recombination burns both legs; after expiry, PT alone redeems principal.
- YT transfers settle sender and receiver before balances change.
- Credited interest is included in required backing.
- Surplus sweep is intended to exclude PT backing and credited claims.

The test suite covers hostile transfer ordering, repeated claims, slicing, abandoned YT, overflow-sized amounts, fees, and full-lifecycle solvency. I found no new double-claim, free-mint, or arbitrary-burn route in these core paths.

The guarantee remains denominated in **SR shares**, whose real USDC value inherits the Blend-loss condition above. It also depends absolutely on OPS-02, the PT issuer lock.

### SR market

The reserve invariant at `contracts/srmarket/src/lib.rs:989-1000` correctly requires actual PT/SR balances to cover stored reserves, and exact-output/input checks, fee ceilings, deadlines, min-outs, and maturity gates are present. That invariant proves token coverage, but it does not prove the conversion index is current; V2-01 is therefore able to transfer value without violating `assert_sane()`.

One-sided direct PT or SR donations are not credited to reserves and have no market sweep path. They cannot steal LP reserves, but donated assets can be permanently stranded. This should be documented rather than presented as recoverable liquidity.

### SR vault

The vault's principal model is sound in shape: every receipt payout is accepted only when fungible PT inventory covers aggregate liability plus a per-receipt dust reserve. During resumable redemption, burned PT becomes banked USDC and the invariant becomes:

```text
PT inventory + banked USDC >= total open receipt liability
```

The remaining issue is rounding coverage. `REDEEM_DUST` is fixed at two stroops per open receipt (`contracts/srvault/src/lib.rs:50`, `:187-188`), but a receipt may take an unbounded number of partial redemption transactions. Non-final legs burn `take` PT without the buffer (`:249-264`), even though PT → SR and SR → underlying can floor on each attempt. If a partial leg returns less USDC than PT face burned, that leg consumes the shared cushion; sufficiently fragmented attempts can use more than two stroops and make `assert_solvent()` revert.

This is a **plausible invariant gap, not yet a proven drain**. Add a targeted test that forces many minimal partial legs at non-integer rates with inventory exactly equal to liability plus the documented reserve. The contract must either complete, bound the number of legs, or reserve rounding per leg/use a conservative conversion formula.

Vault solvency also treats PT face as USDC par. Following an actual Blend principal loss, a PT burn may return less cash than face; the current invariant will correctly revert rather than record insolvency, but the receipt then cannot receive its nominal payout without recapitalization. This is another reason the fixed payout is conditional, not guaranteed.

### Router

The router is non-custodial after successful calls and asserts zero residual token balances. This sharply limits custody risk. However, exact-zero `assert_drained()` checks at `contracts/srrouter/src/lib.rs:581-589` mean anyone can donate one token stroop to the router and make routes revert until the admin calls `sweep()`. This is an availability/griefing issue, not a principal drain.

Pausing the router blocks some convenience sell routes as well as entries. Direct exit paths in SR/Yield remain callable, so assets are not trapped, but the comments/UI should distinguish “protocol exit available” from “every router exit available.”

## Other financial and operational gaps

### Deposit-cap inconsistency

`scripts/deploy_mainnet.sh:25` says the default cap is **5 USDC**, but `SR_DEPOSIT_CAP=500000000` at line 96 is **50 USDC** with seven decimals. Also, `sr.deposit()` computes cap use from `total_supply × current_rate`, so accrued yield consumes deposit headroom even though the source comment says yield growth is deliberately excluded.

This does not create insolvency, but an incorrectly understood cap defeats its purpose as the maximum accepted Blend loss. Pick one cap in base units, test it at the boundary, and make code, script output, docs, and monitoring agree on whether it caps deposited principal or current gross assets.

### TTL liveness is not “forever” without keepers

Maturity-aware persistent entries are extended to maturity plus a grace window, not literally forever. Holder interest, YT balances, LP balances, and vault receipts can archive if neither users nor keepers invoke `bump_holder`, `bump_lp`, or `bump_receipt`. Archived Stellar state may be restorable, but normal claims can fail until restoration.

Run `scripts/ttl_keeper.mjs` continuously, monitor failures, and avoid unconditional “claimable forever” wording unless restoration is part of the supported product flow.

### Late expiry stamping changes who receives yield

The expiry index is stamped on the first post-expiry interaction. If no keeper touches the series at maturity, that first interaction records the then-current index and includes yield earned after contractual expiry. The excess is backed by real strategy growth, so it does not create insolvency, but it changes the intended split between YT holders/protocol surplus. A maturity keeper should stamp promptly and be monitored.

### Governance and upgrade risk

All contracts are upgradeable after a configurable timelock. A compromised admin cannot instantly upgrade, but can schedule hostile code and can change operational parameters within hard ceilings. The same admin is needed to recover from a strategy rate decrease. Production requires multisig administration, independent watchers for scheduled upgrades/parameter changes, and a rehearsed rate-floor reset process.

### Market microstructure

Existing economic tests show that slicing a large swap can improve aggregate execution versus one large transaction (reported in the repository at up to roughly 0.53% for a 50k case). Immediate round trips remain loss-making and LP value rises, so this is not a demonstrated pool drain. It is normal path-dependence/MEV that should be included in router design, quote UX, and economic calibration.

### Unclaimed BLND rewards

The strategy does not expose or distribute Blend's secondary BLND emissions. Depending on Blend's reward mechanics, rewards may be forgone or accumulate outside protocol accounting. This does not deplete USDC principal, but advertised APY and protocol revenue will be incomplete until reward policy and recovery are implemented.

## Retired V1 must remain retired

The repository's V1 tests intentionally demonstrate severe defects. A green test result does not mean those defects are fixed; several tests pass because they reproduce them.

Confirmed V1 issues include:

- a market can be initialized with a foreign settlement asset, letting a trader buy redeemable PT with the foreign token and extract real USDC (`contracts/market/src/test.rs:1372-1421`);
- liquidity can be added after maturity (`contracts/market/src/test.rs:1431`);
- dust liquidity additions can transfer assets while minting zero LP shares (`contracts/market/src/test.rs:1470`);
- lack of caller-controlled minimum shares permits LP-add front-running/DoS (`contracts/market/src/test.rs:1602`);
- fragmented vault positions make redemption exceed transaction-memory limits and allow attacker-created position bloat;
- wrapper views mutate strategy rate-bound state;
- wrapper exits account for requested rather than actual strategy withdrawal amounts;
- YT-only holders have no pre-maturity principal exit;
- the wrapper's dust tolerance can remain permanently widened after ordinary PT redemption;
- late maturity stamping, liquidity freezes, stranded yield, and surplus recovery gaps remain.

The deployed V1 addresses in `scripts/deploy_mainnet.state` are documented as zero-TVL and unseeded. Preserve that state: do not seed, advertise, or reuse them. The old classic PT/YT issuer being live is still an operational concern, even if the inert V1 bearer-redemption surface currently limits practical extraction.

## Verification performed

| Check | Result |
|---|---|
| Manual contract/accounting review | Completed for all six V2 contracts, shared math/governance/TTL, and material V1 paths |
| `cargo test --workspace` | **Passed:** 531 executed tests, 0 failures (530 repository tests plus one temporary stale-index audit probe) |
| Dedicated stale-index probe | **Confirmed V2-01** with the numerical overpayment shown above; temporary test and snapshots removed afterward |
| `cargo build --workspace --release` | **Passed** |
| `cargo fmt --all -- --check` | **Failed** because the existing tree has widespread formatting drift; no files were reformatted during this review |
| Working-tree cleanup | Generated Soroban snapshot changes restored; only this report is intentionally added |
| Live-chain verification | Not performed in this pass; local state/docs were reviewed. Absence of a local V2 state file is not proof that no external deployment exists |

Test success is useful evidence, but it is not a financial-security proof. The suite includes mocks, does not model all Stellar authorization/footprint races, and several V1 tests deliberately encode known failures. The stale-index defect also passed the original suite, showing why invariant and adversarial economic tests are still needed.

## Required pre-launch checklist

- [ ] Fix V2-01 and add stale-index regressions for every PT/YT market mutation.
- [ ] Prove there is no non-dust YT or other untracked balance after every market route.
- [ ] Quarantine the V1 address record; generate and independently verify a V2-only deployment record.
- [ ] Irreversibly lock the exact V2 PT issuer and retain signer evidence.
- [ ] Select the deposit cap, correct its unit/comment/semantics, and boundary-test it.
- [ ] Add the adversarial many-partial-redemptions vault rounding test and fix if it fails.
- [ ] State explicitly that Blend principal loss is borne by users and can require an admin action to unfreeze exits.
- [ ] Rotate every admin to multisig and monitor upgrades, parameters, rate decreases, utilization, and solvency.
- [ ] Run and monitor TTL and maturity-stamping keepers.
- [ ] Re-run the complete Rust suite, release/WASM build, budget simulations, and live-network smoke tests on the exact release commit.
- [ ] Obtain an independent third-party audit and resolve every high/critical finding before meaningful TVL.

## Final sign-off status

**NOT APPROVED FOR REAL-VALUE V2 LAUNCH OR SEEDING.**

After V2-01, OPS-01, OPS-02, and the vault rounding proof are resolved, this assessment should be repeated against the exact deployment commit and on-chain configuration. Under a no-loss, liquid Blend venue; a locked PT issuer; current TTL state; correct wiring; and honest admin operation, the remaining V2 core accounting appears internally coherent. Those are material assumptions, not unconditional guarantees.
