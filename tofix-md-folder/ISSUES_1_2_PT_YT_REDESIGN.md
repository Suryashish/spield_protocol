# Issues 1 and 2 — Safe PT Redemption and Long-Yield Redesign

> Status: **design proposal — not implemented**
>
> Scope: fixes `tofix.md` issues 1 and 2 without making the current wrapper, vault, or AMM
> insolvent. It also explains how the existing **Long Yield** product can continue to work and what
> additional architecture is required if direct YT/USDC trading is introduced.
>
> This document does not authorize a mainnet change. Issuer lockdown must be rehearsed on testnet,
> and the accounting redesign must pass the acceptance tests in this document before deployment.

---

## 1. Problems being fixed

### Issue 1: a market buyer cannot redeem PT

A trader can buy PT from the PT/USDC AMM and hold a real PT token balance, but the wrapper currently
requires a position id owned by the redeemer. The buyer did not create the original position, so no
position id is available to them.

```text
Alice mints 100 PT and sells it through the AMM
                         ↓
Bob buys and holds 100 PT
                         ↓
Maturity arrives
                         ↓
Bob cannot redeem because Alice owns the original position
```

That contradicts the intended meaning of PT: whoever holds PT at maturity should own the principal
claim.

### Issue 2: the PT seller's position becomes unusable

After Alice sells her PT, her position still records that it contains the original PT amount. Calls
such as `transfer_position` then attempt to move PT Alice no longer owns and revert.

Alice should not be able to redeem principal after selling PT, but she must still be able to:

- claim the yield she retained;
- transfer her yield right;
- buy PT back and combine it with some or all of her yield right.

---

## 2. Target economic model

The redesigned system should use this mental model:

```text
PT token          = transferable claim on principal
Yield right       = claim on yield, tracked separately from PT
Wrapper           = shared Blend backing for the whole maturity series
Position          = yield-accounting record, not proof of PT ownership
```

PT ownership is determined only by the holder's PT balance. Moving PT between wallets must not
require updating an original deposit position.

The wrapper must maintain global liabilities because a PT holder may have no relationship with the
position that originally created their tokens.

---

## 3. Mandatory prerequisite: lock the classic issuer

The current PT and YT assets are classic Stellar assets represented through SACs. Giving SAC admin
rights to the wrapper stops the issuer from calling the SAC's `mint`, but it does not stop the
classic issuer account from creating supply through a classic payment.

Balance-based PT redemption would make every PT token a direct claim on wrapper backing. It must
therefore be introduced only after classic issuance has been permanently disabled.

Required deployment sequence:

```text
Deploy PT/YT assets and their SACs
                ↓
Set the wrapper as SAC administrator
                ↓
Verify wrapper mint and burn on testnet
                ↓
Inspect issuer flags, thresholds, and all additional signers
                ↓
Remove unsafe flags/signers as required
                ↓
Set the issuer master weight to zero
                ↓
Prove classic issuance fails but wrapper mint/burn still work
                ↓
Enable balance-based PT redemption
```

The issuer-lock transaction is irreversible. `master_weight = 0` is insufficient if another signer
can still meet the account's transaction threshold.

Issuer lockdown also does not remove the wrapper's SAC-admin power. The trust assumption becomes:
only the current wrapper code, and code installed through its upgrade governance, can mint or burn
PT/YT.

---

## 4. Global accounting

The wrapper needs global state for the maturity series. Conceptually:

```rust
struct SeriesAccounting {
    total_pt_liability: i128,
    maturity_settled: bool,
    maturity_rate: i128,
    remaining_yield_reserve: i128,
}
```

Meanings:

- `total_pt_liability`: PT issued by the wrapper and not yet burned.
- `maturity_settled`: whether the principal/yield split has been frozen.
- `maturity_rate`: final Blend rate used for all remaining yield calculations.
- `remaining_yield_reserve`: maximum USDC still available to final YT/yield claims.

The strategy's live `total_shares()` should remain the source of truth for actual Blend shares.
Storing another independently updated `total_blend_shares` counter is unnecessary unless it has a
specific invariant and reconciliation mechanism; otherwise, the duplicate counter can drift.

### Required global invariants

Before maturity settlement:

```text
live Blend backing + explicit rounding tolerance
    >= total PT liability + currently owed but unpaid yield
```

After maturity settlement:

```text
live Blend backing + explicit rounding tolerance
    >= total PT liability + remaining final yield reserve
```

And on every PT mint/burn:

```text
wrapper-issued PT outstanding == total PT liability
```

The contract cannot rely only on `backing >= principal`; the redesign must also bound aggregate YT
claims after PT redemptions begin.

---

## 5. Minting before maturity

Minting must be impossible at or after maturity. This becomes a critical safety rule under global
PT redemption.

Example: Alice deposits 100 USDC.

```text
Wrapper deposits:       100 USDC into Blend
PT minted to Alice:     100 PT
Global PT liability:   +100 USDC
Yield record created:   Position #17
```

State after mint:

```text
Global wrapper
  Blend backing: approximately 100 USDC
  PT liability: 100 USDC

Alice
  PT balance: 100 PT
  Yield Position #17: yield generated by this deposit
```

The Yield Position may still store fields such as `shares`, `settled_rate`, and remaining yield
notional. It must not claim that Alice necessarily still owns the corresponding PT.

---

## 6. PT trading and balance-based redemption

Alice sells 100 PT to Bob through the AMM for 95 USDC.

```text
Alice
  PT: 0
  Yield Position #17: retained
  USDC received from sale: 95

Bob
  PT: 100
  Yield Position: none
```

Nothing changes in the yield record when PT moves. The global PT liability also remains 100 because
the tokens were transferred, not minted or burned.

At maturity, Bob calls a balance-based entry point:

```rust
redeem_pt_balance(holder: Address, amount: i128) -> i128
```

The explicit `holder` address is authenticated. The function:

1. requires `holder` authorization;
2. requires maturity settlement;
3. checks `amount > 0`;
4. checks `amount <= total_pt_liability`;
5. burns `amount` PT from `holder`;
6. withdraws `amount` USDC from Blend;
7. sends the USDC to `holder`;
8. decreases `total_pt_liability` by exactly `amount`;
9. checks the post-operation solvency invariant.

It does not load or change Alice's position.

### Example redemption

```text
Bob before
  100 PT
  0 USDC from redemption

Bob redeems 100 PT

Bob after
  0 PT
  100 USDC

Global PT liability
  before: 100
  after:    0
```

This fixes issue 1.

---

## 7. Maturity settlement: the critical missing step

Global PT redemption removes Blend shares without an original position to decrement. If individual
yield positions continue using their old share balances indefinitely, they can calculate yield from
shares that no longer exist.

Therefore, before the first global PT redemption, the wrapper must freeze the term:

```rust
settle_maturity()
```

This function should be permissionless and callable at or after maturity. The first PT redemption
may call it automatically if it has not already run.

Settlement performs the following conceptual steps:

1. read the current verified Blend rate;
2. record it as the series `maturity_rate`;
3. read total live Blend backing;
4. reserve `total_pt_liability` for PT holders;
5. record the remaining backed amount as the maximum final yield reserve;
6. permanently stop new minting and future YT accrual for this series.

Example:

```text
Blend backing at settlement: 106 USDC
Outstanding PT liability:    100 USDC

Principal reserve:           100 USDC
Final yield reserve:           6 USDC
```

After settlement:

- PT redemption decreases both backing and PT liability by the same amount;
- final yield claims decrease both backing and the yield reserve;
- no position can generate yield using a rate later than `maturity_rate`;
- claim order must not materially change payouts, except for explicitly bounded rounding dust.

If settlement is delayed past the nominal maturity timestamp, the product must document whether
yield continues until the first settlement transaction or whether an external keeper must settle at
the exact maturity ledger. The contract cannot reconstruct a historical Blend rate unless a trusted
historical source exists.

---

## 8. The seller's retained yield

Alice sold all her PT but retained Yield Position #17.

Before maturity she may continue claiming accrued yield:

```text
Alice has
  0 PT
  Yield Position #17

Alice calls claim_yield(17)
  → succeeds
```

Alice must not be able to redeem principal unless she acquires PT again. That is correct: she sold
the principal claim to Bob.

At maturity, suppose settlement finds 6 USDC of remaining yield for the series. Alice's final claim
is calculated with the fixed `maturity_rate`, paid from the yield reserve, and marked final.

```text
Alice receives final yield: 6 USDC
Yield Position #17: closed/finalized
Remaining yield reserve: reduced by 6 USDC
```

A matured yield position must not continue earning and must not make a second final claim.

---

## 9. Transferring the yield right

`transfer_position` must stop moving PT. PT is already transferable through its token contract.

For the position-based YT model, a renamed function makes the meaning clearer:

```rust
transfer_yield_position(position_id: u64, new_owner: Address)
```

Example:

```text
Alice transfers Yield Position #17 to Carol

Alice
  0 PT
  no Yield Position

Bob
  100 PT

Carol
  Yield Position #17
```

Bob's PT is untouched. This fixes the PT-related transfer failure in issue 2.

The contract must explicitly decide whether yield accrued before the transfer travels with the
position or is automatically claimed to the old owner before transfer. Both are possible, but the
chosen behavior must be consistent and covered by tests.

---

## 10. Combining PT and yield before maturity

Alice cannot combine after selling all her PT because combining requires both economic legs.

```text
Alice
  0 PT
  Yield Position notional: 100

combine 100
  → correctly rejected
```

Suppose Alice buys back 40 PT:

```text
Alice
  40 PT
  Yield Position notional: 100
```

She may call:

```rust
combine_and_redeem(position_id: 17, holder: Alice, amount: 40)
```

The wrapper:

1. authenticates Alice;
2. verifies Alice owns the yield right;
3. verifies Alice holds at least 40 PT;
4. settles or credits yield earned before the combine;
5. burns 40 PT;
6. reduces the yield position's active notional by 40;
7. decreases global PT liability by 40;
8. withdraws and pays 40 USDC;
9. subtracts the actual Blend shares burned from the position's pre-maturity share basis;
10. checks global solvency.

Afterwards:

```text
Alice
  PT: 0
  Yield Position notional: 60
  Principal returned: 40 USDC

Global PT liability
  reduced by 40
```

The PT Alice combines does not have to be the exact token originally minted with Position #17. All
PT in one maturity series is fungible.

---

## 11. Long Yield in the current one-pool AMM

The lowest-risk way to preserve the existing Phase 3 design is to keep one real **PT/USDC pool** and
derive Long Yield through wrapper + market routing. No directly traded YT token is required.

### Buy Long Yield

Bob spends 100 USDC to create PT and a yield position, then sells the PT leg:

```text
Bob supplies 100 USDC
          ↓
Wrapper mints 100 PT + Yield Position #42
          ↓
Router sells Bob's 100 PT into the PT/USDC AMM
          ↓
Bob keeps Yield Position #42 and receives USDC from the PT sale
```

Example:

```text
Initial deposit:          100 USDC
USDC recovered by PT sale: 94 USDC
Net Long-Yield cost:        6 USDC
```

If Bob's yield position pays 10 USDC by maturity:

```text
Cost:    6 USDC
Payout: 10 USDC
Profit:  4 USDC
```

If it pays only 2 USDC:

```text
Cost:    6 USDC
Payout:  2 USDC
Loss:    4 USDC
```

This route remains compatible with balance-based PT because the position is needed only for Bob's
yield. The PT he sells can later be redeemed by whichever account buys it.

### Exit Long Yield before maturity

To close some or all of the long-yield position:

```text
Router buys PT from the PT/USDC AMM
          ↓
Bob combines the purchased PT with his Yield Position
          ↓
Wrapper returns underlying USDC
```

This path requires no independently transferable YT token and preserves the existing one-pool market
design.

### Recommended launch choice

For the current protocol, this routed model is recommended because it:

- requires liquidity only in PT/USDC;
- avoids splitting liquidity across PT and YT pools;
- avoids transfer-checkpoint accounting for YT;
- keeps the market contract independent of Blend;
- fits the current Phase 3 product model.

---

## 12. Optional extension: direct YT/USDC trading

If the product requires users to buy and sell a fungible YT token directly, a normal classic SAC is
not sufficient. A direct SAC transfer does not notify the wrapper, so the wrapper cannot checkpoint
yield between the seller, buyer, and AMM.

Direct YT trading requires a custom, checkpoint-aware token or an equivalent wrapper-controlled
transfer mechanism.

Conceptual per-account accounting:

```rust
struct YieldAccount {
    yt_balance: i128,
    user_yield_index: i128,
    accrued_yield: i128,
}
```

Conceptual global accounting:

```text
global_yield_index
```

Before every YT mint, burn, or transfer:

```text
pending yield =
    YT balance × (global yield index - user's last yield index)
```

The pending amount is credited to the current holder, their checkpoint is updated, and only then is
the YT balance changed.

### Direct Long-Yield example

Alice deposits 100 USDC and receives 100 PT + 100 checkpoint-aware YT. She sells the YT to a
YT/USDC AMM for 6 USDC.

```text
Alice
  100 PT
  0 YT
  6 USDC from YT sale

YT/USDC AMM
  100 YT
```

Halfway through the term, Bob buys 50 YT. Before the transfer, the YT contract:

1. checkpoints yield earned while the AMM held the 50 YT;
2. credits that accrued yield to the AMM/LP side;
3. transfers 50 YT to Bob;
4. starts Bob's future-yield accounting from the current global index.

Bob does not receive yield earned before his purchase. He receives yield generated from his
purchase checkpoint until maturity settlement.

If Bob pays 3 USDC and receives 7 USDC of yield:

```text
Cost:    3 USDC
Payout:  7 USDC
Profit:  4 USDC
```

If he receives only 1 USDC:

```text
Cost:    3 USDC
Payout:  1 USDC
Loss:    2 USDC
```

### Yield earned by the YT AMM

While the AMM holds YT inventory, the AMM is the economic YT holder. Yield earned during that time
belongs to LPs.

The market should expose a permissionless operation such as:

```rust
harvest_yield()
```

It should:

1. claim the AMM's accrued YT yield;
2. add the received USDC to the AMM's accounted USDC reserve;
3. synchronize reserve accounting;
4. increase LP-share value.

Example:

```text
YT held by AMM:       100 YT
Yield earned:           2 USDC
USDC added to reserve:  2 USDC
Economic owner:         LPs
```

### Market layout for direct YT

Use separate pools:

```text
PT / USDC market  → fixed-rate/principal trading
YT / USDC market  → long-yield trading
```

Do not mix PT and YT into one reserve model without a curve explicitly designed and tested for that
relationship.

### Relationship to the current Phase 3 design

The current `PHASE3_AMM_DESIGN.md` chooses routed Long Yield through a single PT/USDC pool. Adopting
direct YT/USDC trading would supersede that decision and requires a separate reviewed design for:

- the custom YT token;
- transfer checkpoints;
- the YT pricing curve;
- LP ownership of accrued yield;
- YT market maturity behavior;
- additional market liquidity requirements.

Direct YT trading should therefore be treated as a later phase unless it is a launch requirement.

---

## 13. Vault changes

The current vault redeems PT by walking stored wrapper position ids and reading each position's
`pt_amount`. That will no longer be authoritative.

The upgraded vault should redeem from its actual PT balance:

```text
Vault PT balance:       500 PT
Receipt payout owed:    120 USDC

Vault calls:
  redeem_pt_balance(vault, 120)

Result:
  120 PT burned
  120 USDC received
  120 USDC paid to receipt owner
```

This removes the position scan from the vault redemption path and makes redemption cost independent
of the vault's position history.

The wrapper and vault must be upgraded in a coordinated manner. Changing the wrapper ABI without a
vault compatibility path will break receipt redemption.

---

## 14. Upgrade and storage compatibility

The current `Position` structure is stored persistently. Removing fields or changing its encoding in
an in-place WASM upgrade may make existing entries undecodable.

Safe choices:

1. retain the old `Position` encoding and store new accounting in additional versioned keys;
2. introduce `PositionV2` and explicitly migrate every live position;
3. if there is no meaningful TVL, deploy a new wrapper and a new maturity series.

The public ABI also affects:

- the vault's generated wrapper client;
- frontend transaction builders;
- scripts and monitoring;
- event consumers;
- tests and snapshots.

Prefer adding `redeem_pt_balance` while temporarily retaining the old entry point as a compatibility
adapter. Do not silently change the arguments or meaning of the existing `redeem_pt` export while
dependent contracts still use it.

If the old entry point remains temporarily, it must route into the same global liability accounting
so PT cannot be redeemed twice through two different code paths.

---

## 15. Rounding and loss behavior

Blend credits and burns integer shares using floor/ceil rounding. The redesign must preserve an
explicit, tightly bounded rounding policy.

Tests must prove that changing claim order cannot cause a meaningful first-come-first-served
advantage. A final claimant may not lose more than the documented microscopic rounding bound.

If live Blend backing is ever below PT liability, simple 1:1 global redemption becomes a bank-run
mechanism: early redeemers receive par and later redeemers receive nothing. Before relaxing the
current monotonic-rate assumptions, the protocol must choose a loss policy, such as pro-rata
redemption. That policy belongs with the `b_rate`-decrease fix and must not be left implicit.

---

## 16. Required implementation order

1. Rehearse issuer lockdown on testnet.
2. Verify issuer flags, thresholds, signers, and SAC administrators.
3. Permanently lock the production classic issuer.
4. Add a strict wrapper mint-before-maturity gate.
5. Add versioned global PT and maturity-settlement accounting.
6. Add `settle_maturity` and cap all yield at its stored rate.
7. Add balance-based PT redemption without removing the legacy ABI.
8. Change position transfer so it never moves PT.
9. Update combine accounting to use actual PT balance plus the selected yield right.
10. Upgrade the vault to redeem from its PT balance.
11. Update frontend, scripts, events, monitoring, and documentation.
12. Run the full acceptance and invariant suite.
13. Remove the legacy entry point only in a later explicitly breaking release.
14. Implement checkpoint-aware YT and a separate YT market only if direct YT trading is approved.

---

## 17. Acceptance tests

### Issuer and supply safety

- `locked_issuer_cannot_classic_issue_pt`
- `locked_issuer_cannot_classic_issue_yt`
- `wrapper_can_mint_and_burn_after_issuer_lock`
- `additional_issuer_signer_cannot_issue`
- `global_pt_liability_matches_wrapper_mints_minus_burns`
- `counterfeit_or_donated_pt_cannot_increase_protocol_liability`

### PT redemption

- `market_bought_pt_is_redeemable_by_buyer`
- `pt_redeemer_needs_no_position_id`
- `pt_cannot_redeem_before_maturity`
- `pt_cannot_redeem_more_than_holder_balance`
- `pt_cannot_redeem_more_than_global_liability`
- `partial_pt_redemptions_conserve_backing`
- `two_holders_redeem_in_either_order_with_same_result`
- `legacy_and_new_redemption_paths_cannot_double_redeem`

### Seller and yield position

- `seller_with_sold_pt_can_claim_yield`
- `seller_with_sold_pt_can_transfer_yield_position`
- `yield_position_transfer_does_not_move_pt`
- `seller_without_pt_cannot_combine`
- `seller_can_buy_pt_back_and_partially_combine`
- `combine_reduces_global_pt_liability_once`

### Maturity settlement

- `first_post_maturity_redemption_settles_once`
- `mint_at_or_after_maturity_is_rejected`
- `yield_does_not_grow_after_maturity_settlement`
- `final_yield_claim_cannot_repeat`
- `pt_then_yt_and_yt_then_pt_have_same_outcome`
- `aggregate_final_yield_never_exceeds_yield_reserve`
- `rounding_shortfall_is_within_fixed_bound`

### Vault compatibility

- `existing_receipt_redeems_after_wrapper_upgrade`
- `vault_redeems_from_pt_balance_without_position_scan`
- `vault_redemption_cost_does_not_grow_with_position_count`
- `vault_pt_inventory_still_covers_total_liability`

### Routed Long Yield

- `buy_long_yield_mints_then_sells_pt`
- `long_yield_holder_can_claim_without_holding_pt`
- `exit_long_yield_buys_pt_then_combines`
- `market_pt_buyer_can_redeem_the_sold_pt`
- `routed_long_yield_conserves_pt_and_global_liability`

### Direct YT extension, if implemented

- `yt_transfer_checkpoints_sender_and_receiver`
- `yt_buyer_cannot_claim_pre_purchase_yield`
- `yt_seller_keeps_pre_transfer_accrual`
- `yield_earned_while_in_market_belongs_to_lps`
- `yt_market_harvest_updates_usdc_reserve`
- `yt_swaps_stop_at_maturity`
- `all_yt_claims_fit_inside_final_yield_reserve`

### Migration

- `old_position_storage_decodes_after_upgrade`
- `migration_initializes_pt_liability_from_existing_state`
- `migration_cannot_run_twice`
- `old_and_new_positions_share_one_solvency_invariant`

---

## 18. Final recommendation

For the first safe release:

```text
Balance-based PT
        +
Global PT liability
        +
Maturity settlement
        +
Position-based yield rights
        +
Routed Long Yield through the PT/USDC market
```

This fixes issues 1 and 2 while preserving the current one-pool AMM strategy.

If direct YT trading later becomes a requirement, add:

```text
Checkpoint-aware custom YT
        +
Global yield index
        +
Separate YT/USDC market
        +
LP yield harvesting
```

Do not add balance-based PT redemption without issuer lockdown, maturity settlement, and coordinated
vault changes. Those are parts of one accounting migration, not independent optional improvements.
