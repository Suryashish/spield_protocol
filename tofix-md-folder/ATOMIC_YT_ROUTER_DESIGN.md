# Atomic YT Buy/Sell Through the PT/USDC AMM

> Status: **design proposal — not implemented**
>
> Purpose: provide Pendle-style Long Yield entry and exit through Spield's existing PT/USDC
> liquidity, without requiring a separate YT/USDC pool and without forcing users to temporarily
> provide the full principal notional.
>
> This proposal depends on the issuer-lockdown, balance-based PT, global-liability, maturity-
> settlement, and yield-accounting work described in `ISSUES_1_2_PT_YT_REDESIGN.md`.

---

## 1. Executive summary

The market continues to hold only:

```text
PT + USDC
```

It does not maintain a YT reserve.

Long Yield is traded atomically by using the relationship:

```text
PT + YT claim = underlying principal before maturity
```

Buying YT:

```text
User's net USDC + USDC supplied by the AMM
                      ↓
             mint PT + YT claim
                      ↓
             PT is retained by AMM
             YT claim goes to user
```

Selling YT:

```text
PT supplied atomically by the AMM + user's YT claim
                      ↓
              combine into underlying
                      ↓
       AMM keeps PT purchase value in USDC
       user receives the remaining USDC + accrued yield
```

The entire operation occurs in one transaction. The user pays only the net cost when buying and
receives only the net proceeds when selling.

---

## 2. Why the manual route is not acceptable UX

Without atomic routing, buying 100 units of YT exposure might look like this:

```text
User temporarily deposits: 100 USDC
PT sale returns:             94 USDC
Actual Long-Yield cost:       6 USDC
```

The user needs 100 USDC even though the position costs only 6 USDC.

Closing the same position might require:

```text
Temporary PT purchase cost: 90 USDC
Underlying + yield returned: 103 USDC
Actual exit proceeds:        13 USDC
```

The user needs 90 USDC merely to receive 13 USDC. That defeats the capital-efficiency expected from
a leveraged-yield product.

The atomic design removes both temporary-capital requirements:

```text
Buy YT:  user pays 6 USDC
Sell YT: user receives 13 USDC
```

---

## 3. Components and responsibilities

### Wrapper / Blend strategy

Holds the real underlying backing and is responsible for:

- depositing USDC into Blend;
- creating PT and the corresponding yield claim;
- maintaining global PT liability;
- tracking or tokenizing the user's yield entitlement;
- combining PT plus yield entitlement before maturity;
- claiming accrued yield;
- freezing yield at maturity settlement;
- enforcing solvency after every operation.

### PT/USDC market

Holds only:

```text
PT reserve
USDC reserve
```

It is responsible for:

- quoting the PT leg using the time-decay curve;
- supplying the gross USDC difference during an atomic YT buy;
- receiving newly minted PT during that buy;
- supplying PT during an atomic YT sell;
- receiving the correct USDC value for that PT;
- collecting swap fees;
- enforcing slippage and reserve invariants.

### Atomic router or market facade

Provides one-click user functions. It may be:

1. a separate router contract; or
2. tightly scoped entry points implemented by the Market contract.

The router must not retain funds after a successful transaction. Every temporary movement must end
with checked market, wrapper, and user balances.

### User

The user holds the economic YT claim. Depending on the final YT design, this may be:

- a checkpoint-aware fungible YT token; or
- a position-based yield entitlement with an active notional.

The atomic PT funding mechanism works with either model, but the claim's ownership and transfer
rules must be finalized before implementation.

---

## 4. Simplified pricing relationship

Before maturity, one complete PT + YT set can be combined back into the underlying principal.

In simplified terms:

```text
PT price + YT price ≈ 1 USDC
```

Therefore:

```text
Implied YT price ≈ 1 USDC - executable PT price
```

Examples before fees and slippage:

| Executable PT price | Implied YT price |
|---:|---:|
| 0.90 USDC | 0.10 USDC |
| 0.94 USDC | 0.06 USDC |
| 0.98 USDC | 0.02 USDC |
| 1.00 USDC | 0.00 USDC |

The contract must use the curve's exact executable quote, including fees and rounding. It must not
calculate a trade from a displayed spot price.

---

## 5. Atomic Buy YT

### User intention

Bob wants 100 units of YT exposure. Selling 100 PT into the AMM would return 94 USDC, so the net
cost of creating and retaining the YT leg is 6 USDC.

```text
YT notional:                 100
USDC needed to mint set:     100
PT sale proceeds from AMM:    94
Net user input:                6 USDC
```

Bob should provide only 6 USDC.

### Atomic execution

Conceptually:

```text
Bob supplies:                 6 USDC
AMM supplies from reserve:   94 USDC
                              -------
Wrapper receives:           100 USDC
```

The wrapper deposits the 100 USDC into Blend and creates both legs:

```text
100 PT       → PT/USDC AMM
100 YT claim → Bob
```

The AMM's contribution is not an unsecured loan that remains outstanding. It is the USDC the AMM
would have paid for the 100 PT in a normal PT-for-USDC swap. The AMM receives those 100 PT in the
same atomic transaction.

### User result

```text
Bob before
  USDC: 6
  YT exposure: 0

Bob after
  USDC: 0
  YT exposure: 100
  PT: 0
```

Bob pays the true net Long-Yield cost rather than the full principal notional.

### AMM result

Assume simplified starting reserves:

```text
PT reserve:   1,000 PT
USDC reserve: 1,000 USDC
```

The executable curve quote says the AMM pays 94 USDC for 100 PT.

After the atomic YT buy:

```text
PT reserve:   1,100 PT   (+100 PT)
USDC reserve:   906 USDC (-94 USDC)
```

This is exactly the same reserve transition as an ordinary sale of 100 PT into the AMM.

### Wrapper result

```text
Blend deposit:             +100 USDC
Global PT liability:       +100 USDC
PT minted to AMM:          +100 PT
YT notional owned by Bob:  +100
```

The wrapper remains fully backed. The AMM is only financing the unwanted PT leg of Bob's mint.

### Suggested external API

An exact-YT-output form is easiest to explain:

```rust
buy_yield(
    user: Address,
    yt_out: i128,
    max_usdc_in: i128,
) -> (u64, i128)
```

Returns:

```text
(yield_position_id, actual_usdc_in)
```

Required behavior:

1. authenticate `user`;
2. require the market and wrapper to be active and pre-maturity;
3. quote the exact PT input corresponding to `yt_out`;
4. compute `actual_usdc_in = yt_out - quoted_pt_sale_proceeds`;
5. require `actual_usdc_in <= max_usdc_in`;
6. collect only `actual_usdc_in` from the user;
7. combine it with the quoted USDC amount from market reserves;
8. mint the fully backed PT + YT set through the wrapper;
9. send/mint PT directly to the market;
10. assign the YT claim to the user;
11. update reserves exactly as a PT-for-USDC swap;
12. verify actual balance deltas and all solvency invariants.

---

## 6. Atomic Sell YT

### User intention

Later, Bob wants to close the entire 100-unit YT position.

Assume:

```text
Cost to buy 100 PT from AMM:  90 USDC
Principal from combining:    100 USDC
Accrued yield owed to Bob:     3 USDC
Total wrapper output:         103 USDC
```

Without an atomic route, Bob would need to provide 90 USDC temporarily. With the atomic route, the
AMM supplies the PT and is repaid from the combine output.

### Atomic execution

The AMM supplies 100 PT from its reserve:

```text
AMM supplies:        100 PT
Bob supplies:        100 YT claim
```

The wrapper combines them:

```text
100 PT + 100 YT claim
            ↓
combine and settle accrued yield
            ↓
100 USDC principal + 3 USDC yield
```

The resulting 103 USDC is split atomically:

```text
90 USDC → AMM
13 USDC → Bob
```

The AMM receives exactly the curve-quoted USDC value for releasing 100 PT. Bob receives the
remaining value of his yield position plus its accrued yield.

### User result

```text
Bob before
  YT exposure: 100
  Temporary USDC available: 0

Bob after
  YT exposure: 0
  PT: 0
  USDC received: 13
```

Bob never provides the temporary 90 USDC.

### AMM result

If its reserves immediately before the sell are:

```text
PT reserve:   1,100 PT
USDC reserve:   906 USDC
```

and the executable quote charges 90 USDC for 100 PT, then after the atomic YT sell:

```text
PT reserve:   1,000 PT   (-100 PT)
USDC reserve:   996 USDC (+90 USDC)
```

This is exactly the same reserve transition as an ordinary purchase of 100 PT from the AMM.

### Wrapper result

```text
PT burned:                   100 PT
Global PT liability:        -100 USDC
YT notional closed:         -100
Principal withdrawn:         100 USDC
Accrued yield withdrawn:       3 USDC
```

The exact Blend shares burned must be reflected in the wrapper's accounting, and the post-operation
solvency invariant must hold.

### Suggested external API

```rust
sell_yield(
    user: Address,
    position_id: u64,
    yt_in: i128,
    min_usdc_out: i128,
) -> i128
```

Returns the net USDC delivered to the user.

Required behavior:

1. authenticate `user`;
2. verify the user owns the selected yield claim;
3. require `yt_in > 0` and `yt_in` within the position/token balance;
4. quote the USDC required to take the matching PT amount from the AMM;
5. supply that PT atomically from the AMM reserve;
6. combine the PT with `yt_in` through the wrapper;
7. receive principal plus claimable accrued yield;
8. credit the AMM only the quoted PT purchase value;
9. transfer the remainder to the user;
10. require user output `>= min_usdc_out`;
11. update reserves exactly as a USDC-for-PT swap;
12. verify actual balance deltas and all solvency invariants.

---

## 7. Full profit-and-loss example

### Entry

Bob opens 100 units of Long Yield when PT sells for 0.94 USDC:

```text
Full principal notional: 100 USDC
PT proceeds:              94 USDC
Bob's net entry cost:      6 USDC
```

### Market movement

Yield expectations rise, so PT falls to approximately 0.90 USDC. The implied future-yield value
rises from approximately 0.06 to 0.10 USDC per unit.

Bob also accrues 3 USDC of realized yield while holding the position.

### Exit

```text
Underlying released by combine: 100 USDC
Accrued yield:                     3 USDC
Value paid to AMM for PT:        -90 USDC
Bob's net exit proceeds:          13 USDC
```

### Outcome

```text
Net exit proceeds: 13 USDC
Entry cost:         -6 USDC
Profit:              7 USDC
```

The profit contains:

```text
4 USDC from the change in implied future-yield value
3 USDC of yield accrued while Bob held the position
```

Fees, slippage, Blend rounding, and the exact curve quote will reduce the simplified amounts.

---

## 8. What the AMM actually holds

Even though the UI exposes Buy YT and Sell YT, the market reserve remains:

```text
PT/USDC AMM
  ✅ PT
  ✅ USDC
  ❌ YT reserve
  ❌ yield positions
```

During a successful YT buy, the user receives the YT claim and the market receives PT.

During a successful YT sell, the market releases PT and receives USDC. The YT claim is destroyed or
reduced by the wrapper, not deposited into the market.

Therefore LPs provide one shared pool of liquidity that serves:

- ordinary PT buys;
- ordinary PT sells;
- atomic YT buys;
- atomic YT sells.

This avoids splitting liquidity between PT/USDC and YT/USDC markets.

---

## 9. Required wrapper changes

The current wrapper interface cannot implement these flows safely without changes.

### 9.1 Split mint recipients

The YT-buy path needs the market to fund part of the deposit, receive the PT, and assign the yield
claim to the user.

Conceptual interface:

```rust
mint_split(
    payer: Address,
    pt_receiver: Address,
    yield_owner: Address,
    amount: i128,
) -> u64
```

It must:

- pull the full `amount` from the authenticated payer/router path;
- deposit it into Blend;
- mint PT to `pt_receiver`;
- mint/assign the corresponding YT claim to `yield_owner`;
- increase global PT liability once;
- create correct yield checkpoints;
- reject minting at or after maturity.

This function must not become a way for an arbitrary caller to charge one account while assigning
claims to another. Authorization must cover the exact payer, recipients, amount, and nested calls.

### 9.2 Combine to a settlement recipient

The YT-sell path needs the combine output to pass through a checked settlement flow so the AMM is
paid and only the remainder reaches the user.

Conceptual interface:

```rust
combine_to(
    yield_owner: Address,
    position_id: u64,
    amount: i128,
    recipient: Address,
) -> (i128, i128)
```

Returns:

```text
(principal_returned, yield_claimed)
```

It must:

- authenticate the yield owner;
- burn the exact PT supplied through the atomic route;
- reduce the exact yield entitlement;
- decrease global PT liability once;
- transfer output only to the predetermined market/router settlement recipient;
- prevent recipient substitution attacks.

### 9.3 Global accounting and maturity controls

The wrapper must already have:

- issuer lockdown;
- global outstanding PT liability;
- strict mint-before-maturity enforcement;
- maturity settlement;
- final yield reserve accounting;
- balance-based PT redemption;
- a defined YT ownership model.

The atomic router must not be implemented on top of the current position-bound PT accounting.

---

## 10. Required market changes

The PT/USDC market needs narrowly scoped atomic settlement capabilities.

### Buy-side capability

The market must be able to:

- quote an exact PT input;
- contribute the quoted USDC output directly into a wrapper mint;
- receive the resulting PT;
- verify `actual PT received == expected PT`;
- update reserves as a normal PT-for-USDC swap.

### Sell-side capability

The market must be able to:

- quote an exact PT output;
- supply that PT into a wrapper combine;
- receive at least the quoted USDC payment;
- forward all excess principal/yield to the user;
- update reserves as a normal USDC-for-PT swap.

### Fixed dependencies

The market/router must use immutable or initialized-and-verified addresses for:

- wrapper;
- PT token;
- underlying USDC;
- maturity.

It must verify that market maturity equals wrapper maturity. Users must not be able to supply an
arbitrary wrapper, token, recipient callback, or settlement contract.

---

## 11. Atomicity and authorization

Every YT buy or sell must be all-or-nothing.

If any of these fail:

- user authentication;
- market quote/slippage bound;
- USDC transfer;
- wrapper mint/combine;
- PT/YT burn or mint;
- Blend deposit/withdrawal;
- reserve balance check;
- wrapper solvency check;

then the entire transaction must revert, including every temporary market transfer.

Authorization must bind the user's approval to:

```text
operation type
market address
wrapper address
position id, if any
exact or maximum input
minimum output
recipient
deadline/maturity
```

Broad reusable authorization for arbitrary nested transfers is not acceptable.

---

## 12. Slippage protection

### Buy YT

The user specifies:

```text
desired YT amount
maximum USDC they will pay
```

Example:

```text
Desired YT:       100
Displayed quote:    6.00 USDC
Maximum input:      6.20 USDC
```

If reserve movement changes the required input to 6.21 USDC, the transaction reverts.

### Sell YT

The user specifies:

```text
YT amount to close
minimum net USDC they will receive
```

Example:

```text
YT sold:          100
Displayed output:  13.00 USDC
Minimum output:    12.70 USDC
```

If the final net amount is below 12.70 USDC, the transaction reverts.

The quote and execution must use the same curve, fee logic, timestamp assumptions, and rounding
direction.

---

## 13. Fees

The AMM should charge the same economic swap fee whether the PT reserve transition comes from:

- a direct PT trade; or
- an atomic YT route.

Buying YT is economically a PT sale into the market, so it uses the PT-sale fee direction.

Selling YT is economically a PT purchase from the market, so it uses the PT-buy fee direction.

The UI should display:

```text
Gross YT notional
Net USDC input/output
PT execution price
Price impact
AMM fee
Current claimable yield
Minimum output or maximum input
```

---

## 14. Maturity behavior

Atomic YT trading must stop at maturity.

At or after maturity:

- `buy_yield` is rejected;
- `sell_yield` through the pre-maturity combine path is rejected or converted into the defined final
  settlement path;
- no new PT/YT sets can be minted;
- PT holders redeem through balance-based PT redemption;
- YT holders claim their frozen final yield;
- LPs remove liquidity or use the market's maturity settlement path.

The market and wrapper must agree on exactly the same maturity timestamp.

---

## 15. Pause behavior

Recommended policy:

```text
buy_yield  → blocked while paused because it creates new exposure
sell_yield → treated as an exit and kept available when it is safe to do so
```

If an incident specifically affects market pricing or reserve integrity, allowing `sell_yield` may
be unsafe. The final design must define separate pause domains rather than using one ambiguous flag:

- wrapper inflow pause;
- market trading pause;
- exit-only mode;
- maturity settlement mode.

Whatever policy is selected, users must retain a non-market path to claim accrued/final yield and
redeem PT when permitted by the underlying accounting.

---

## 16. Important differences from Pendle

This proposal follows Pendle's one-pool flash-swap idea, but Spield is not mechanically identical.

| Pendle V2 | Spield current design |
|---|---|
| PT/SY pool | PT/plain-USDC pool |
| Fungible YT integrated with Pendle accounting | Yield currently tied to wrapper positions |
| Router already supports flash YT swaps | No atomic YT router today |
| Tokenization and market designed together | Wrapper, market, and vault already have deployed interfaces |

Consequences:

- Spield needs explicit split-recipient minting.
- Spield needs a safe method to combine market-supplied PT with a user's yield entitlement.
- Position storage and vault ABI compatibility must be preserved or migrated.
- LP economics differ because plain USDC does not earn the underlying Blend yield the way Pendle SY
  represents a yield-bearing side.
- Transaction-budget measurements must be made against the real Blend WASM path.

The architecture should copy the economic mechanism, not blindly copy EVM contract code.

---

## 17. Security invariants

After every successful atomic YT buy:

```text
market PT balance increase == accounted PT reserve increase
market USDC balance decrease == accounted USDC reserve decrease
wrapper PT liability increase == PT minted
Blend backing increase covers the new PT liability and yield entitlement
user paid no more than max_usdc_in
```

After every successful atomic YT sell:

```text
market PT balance decrease == accounted PT reserve decrease
market USDC balance increase == quoted PT purchase value
wrapper PT liability decrease == PT burned
yield entitlement decrease == requested YT input
user received at least min_usdc_out
all excess wrapper output went to the user, not the market/router
```

Global invariants:

```text
market reserves match actual token balances
wrapper-issued PT outstanding matches global PT liability
wrapper backing covers PT liability plus bounded remaining yield claims
no PT or yield entitlement is created without a Blend-backed deposit
no PT or yield entitlement is consumed twice
router retains zero funds after successful settlement
```

---

## 18. Failure scenarios that must revert atomically

- User's maximum buy input is exceeded.
- User's minimum sell output is not met.
- AMM lacks enough USDC for the buy-side contribution.
- AMM lacks enough PT for the sell-side contribution.
- Wrapper is paused for inflows during a buy.
- Market is paused under the selected policy.
- Maturity has arrived.
- Position is not owned by the authenticated seller.
- Position/YT notional is smaller than the sell request.
- PT or YT burn fails.
- Blend credits zero shares.
- Blend withdrawal is short.
- Wrapper solvency check fails.
- Market's observed token balance delta differs from the quoted delta.
- Wrapper/market maturity, PT token, or USDC token does not match.
- The rate-sanity guard rejects the live Blend rate.
- Transaction resource limits are exceeded.

No failure may leave the market short of USDC/PT or the user with only one leg of an intended
operation.

---

## 19. Required tests

### Buy YT

- `atomic_buy_yt_charges_only_net_cost`
- `atomic_buy_yt_sends_pt_to_market_and_yield_to_user`
- `atomic_buy_yt_matches_direct_pt_sale_reserve_transition`
- `atomic_buy_yt_increases_wrapper_pt_liability_once`
- `atomic_buy_yt_reverts_above_max_usdc_in`
- `atomic_buy_yt_reverts_when_market_usdc_is_insufficient`
- `atomic_buy_yt_reverts_after_maturity`
- `atomic_buy_yt_reverts_under_inflow_pause`
- `failed_atomic_buy_restores_all_balances_and_reserves`

### Sell YT

- `atomic_sell_yt_requires_no_upfront_usdc`
- `atomic_sell_yt_matches_direct_pt_buy_reserve_transition`
- `atomic_sell_yt_pays_market_only_quoted_pt_value`
- `atomic_sell_yt_sends_principal_excess_and_yield_to_user`
- `atomic_sell_yt_reduces_pt_liability_once`
- `atomic_sell_yt_supports_partial_position_close`
- `atomic_sell_yt_reverts_below_min_usdc_out`
- `atomic_sell_yt_reverts_when_market_pt_is_insufficient`
- `atomic_sell_yt_reverts_for_non_owner`
- `failed_atomic_sell_restores_all_balances_and_reserves`

### Pricing and equivalence

- `yt_buy_price_equals_notional_minus_executable_pt_sale`
- `yt_sell_price_equals_combine_output_minus_executable_pt_buy`
- `atomic_and_manual_routes_have_same_economic_result`
- `direct_pt_and_synthetic_yt_trades_charge_consistent_fees`
- `buy_then_sell_without_price_change_loses_only_documented_fees_and_rounding`
- `price_moves_against_repeated_one_direction_yt_flow`

### Security and accounting

- `router_cannot_substitute_wrapper_or_token_addresses`
- `router_cannot_redirect_user_output`
- `router_holds_zero_balance_after_success`
- `market_actual_balances_equal_accounted_reserves`
- `wrapper_backing_covers_pt_and_remaining_yield_liabilities`
- `same_pt_cannot_settle_market_and_redeem_again`
- `same_yield_claim_cannot_be_sold_twice`
- `issuer_lock_remains_required_and_verified`

### Integration and budgets

- `atomic_buy_yt_fits_mainnet_resource_limits_with_real_blend_wasm`
- `atomic_sell_yt_fits_mainnet_resource_limits_with_real_blend_wasm`
- `vault_operations_still_work_after_wrapper_interface_extension`
- `legacy_positions_decode_and_exit_after_upgrade`
- `market_and_wrapper_maturity_mismatch_is_rejected`

---

## 20. Recommended implementation order

1. Complete and test classic issuer lockdown.
2. Implement the issues 1/2 global PT and maturity-settlement redesign.
3. Add the strict wrapper mint-before-maturity gate.
4. Finalize whether YT is a fungible checkpoint-aware token or a position-based entitlement.
5. Add versioned split-recipient minting.
6. Add versioned combine-to-settlement-recipient support.
7. Add pure/read-only atomic YT quote functions.
8. Implement atomic YT buy with strict balance-delta checks.
9. Implement atomic YT sell with strict balance-delta checks.
10. Add slippage, pause, and maturity guards.
11. Update market, wrapper, vault, frontend, events, and monitoring together.
12. Run all invariant, adversarial, migration, and real-WASM resource tests.
13. Rehearse the full lifecycle on testnet before any mainnet seed transaction.

---

## 21. Final proposed user experience

### Buy Long Yield

The UI displays:

```text
Long-Yield notional: 100 USDC
You pay:               6 USDC
Maximum payment:       6.20 USDC
```

The user approves one transaction and receives the 100-unit yield claim. They never provide the
full 100-USDC notional.

### Sell Long Yield

The UI displays:

```text
Yield notional closed: 100 USDC
Accrued yield included:  3 USDC
You receive:             13 USDC
Minimum received:        12.70 USDC
```

The user approves one transaction and receives the net USDC. They never provide the temporary
90 USDC needed to purchase the matching PT.

### Final architecture

```text
Wrapper / Blend
  holds underlying backing
  creates and combines PT + YT claims

PT/USDC AMM
  holds PT + USDC only
  prices both direct PT trades and synthetic YT routes

Atomic router
  turns one PT/USDC pool into one-click Buy YT and Sell YT
  retains no funds after settlement
```

This delivers Pendle-style capital efficiency without requiring a separate YT/USDC liquidity pool,
while keeping the underlying accounting explicit and testable for Spield's Soroban architecture.
