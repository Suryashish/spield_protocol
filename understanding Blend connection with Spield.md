# How Blend connects to Spield

> The repository and contracts use the name **Spield**. This note explains the current SR-based flow and the related fixed-rate products in simple terms.

## In one sentence

The user deposits USDC into a Spield contract; Spield's Blend strategy supplies that USDC to a Blend lending pool; Blend returns supply shares (bTokens) to Spield's strategy; and Spield's SR contract mints its own SR shares to the user. SR is a Spield receipt for a proportional claim on the strategy position. There is no conversion of a Blend token into SR: both are minted separately, and SR's value tracks the underlying Blend position.

## The pieces

- **Blend pool:** Lending market where supplied USDC earns variable interest. Its USDC reserve has a live `b_rate`, which determines how much USDC each Blend supply share represents.
- **Blend strategy (`spield-strategy`):** The adapter contract that knows Blend's API. It owns Spield's pooled Blend supply position and reads the live Blend rate.
- **SR token (`spield-sr`):** Spield's receipt/share token. It represents a proportional claim on USDC held in the strategy. SR is separate from Blend's bToken.
- **Yield and PT/YT contracts:** Optional product layers that use SR to make yield-bearing positions, principal tokens and yield tokens.
- **SR vault:** Optional fixed-rate product. It turns a USDC deposit into a maturity-dated receipt backed by PT inventory.

## What happens when a user deposits into SR

1. The user calls `SR.deposit` with USDC amount, receiver and minimum SR shares accepted.
2. SR checks the amount, pause state, minimum mintable amount and configured deposit cap. The user authorizes the USDC transfer.
3. SR transfers USDC from the user into the SR contract.
4. SR authorizes the strategy to pull that USDC and calls `strategy.deposit`.
5. The strategy pulls USDC from SR, then calls Blend's pool `submit` with a **Supply** request. Blend credits bToken/supply shares to the strategy contract.
6. Strategy returns the number of Blend shares it received. SR mints its own SR shares to the chosen receiver and records the user's principal.

These calls occur in one Soroban transaction. If a step fails, the transaction reverts rather than leaving a half-finished deposit.

```text
User USDC
   → SR contract
   → Blend strategy
   → Blend pool (USDC supplied; strategy receives Blend supply shares)

SR contract
   → mints SR shares to the user
```

The strategy owns the Blend position on behalf of the pooled SR holders. A user normally holds SR, not the Blend bTokens. The contract logic connects the two; it does not swap one token for the other.

## How SR reflects Blend yield

Blend's `b_rate` rises as borrowers pay interest (and can fall if the venue records a loss). The strategy reads this rate from Blend. SR's share value is based on the underlying value of the strategy's Blend position, rather than on a separately invented yield number.

In plain terms: if the Blend pool position can redeem for more USDC, each SR share can represent more USDC. The number of SR tokens in a holder's wallet does not automatically increase; the value represented by those shares changes. Exact amounts are subject to Blend share math, rounding, pool liquidity and venue performance.

## How a user exits SR

The user calls `SR.redeem` with SR shares and a minimum USDC output. SR burns the shares and asks the strategy to redeem the corresponding Blend supply shares. The strategy asks Blend to withdraw USDC and sends the amount actually received to the user. If Blend does not have enough immediately available liquidity, redemption may be limited or return less than a quoted value; the contracts are designed to report actual payout rather than promise a fixed amount regardless of Blend liquidity.

## Fixed-rate vault flow

The SR vault uses the same Blend connection indirectly, through SR:

1. The user deposits USDC into the vault and chooses the configured fixed-rate term.
2. The vault takes the USDC and calls `SR.deposit_checked` for itself. That mints SR to the vault, with the underlying USDC supplied into Blend through the strategy.
3. The vault sends its SR to the yield contract's `mint_py` function. The yield contract turns SR into equal face amounts of **PT** (principal token) and **YT** (yield token), held in the vault's inventory.
4. The vault records a receipt promising the user's principal plus the configured coupon at maturity, subject to the vault's capacity and solvency checks.
5. At maturity, the user redeems the receipt. The vault uses its PT inventory through the yield contract to recover SR, then redeems SR through the strategy to recover USDC from Blend, and pays the receipt holder.

```text
User USDC → SR Vault → SR deposit → Blend strategy → Blend Pool
                    ↘ SR → Yield contract → PT + YT inventory

At maturity: receipt → PT redemption → SR redemption → Blend withdrawal → USDC to user
```

The vault is therefore not a direct user-to-Blend deposit, and it does not give the user SR as their final position. The vault holds SR/PT/YT internally and gives the user a vault receipt representing the fixed-term claim.

## Other Spield products

- **Direct SR product:** User receives SR shares, which represent exposure to the pooled Blend position.
- **Tokenized yield product:** The wrapper's `mint` path supplies USDC through the Blend strategy and gives the user PT and YT. PT is the principal leg; YT is the variable-yield leg. This is a separate entry point from the newer SR deposit flow.
- **PT market:** Users can trade PT against USDC in the market. A market purchase of PT is a secondary-market trade; it is not the same as the buyer depositing USDC into Blend.
- **Fixed-rate vault:** User receives a vault receipt, while the vault manages SR, PT and YT inventory internally.

## What is the “Blend token” here?

The Blend pool credits **supply shares**, often described in code as bTokens. They are an accounting claim held by the strategy contract. They are not SR, BLND, or a token that Spield swaps into SR.

**BLND** is Blend's separate rewards/governance token. The strategy has a function to claim any BLND emissions earned by its supplier position and routes them to a configured destination (normally protocol treasury). The repository notes that USDC supplier emissions on the measured mainnet pool were zero at the time of that code comment; emissions settings can change. BLND rewards are not converted into SR and are not the principal/yield backing described above.

## Important practical limits

- Blend yield is variable; SR does not make the underlying lending yield fixed.
- Blend's pool liquidity and venue risks carry through to withdrawals and vault backing.
- The vault's quoted fixed coupon is a separate product promise with capacity checks and a maturity; do not confuse it with Blend's variable rate.
- Contract code and repository docs show more than one product path. `SR.deposit` is the direct SR flow; `srvault.deposit` is the fixed-rate receipt flow; `wrapper.mint` is the PT/YT tokenization flow.

## Adding Etherfuse USTRY as another yield source

Spield already has the right high-level idea for this: the shared `YieldStrategy` interface lets SR call a strategy without knowing the venue's details. Today, SR is initialized with **one** strategy address, and that strategy supplies USDC to Blend. So the interface is a useful starting point, but selecting Blend or USTRY is not a UI-only switch and the current SR deployment is not a multi-strategy pool.

### What an Etherfuse strategy would do

A new `ustry-strategy` adapter could implement the same core jobs as the Blend adapter:

1. Hold a configured USTRY token position on behalf of Spield users.
2. Accept deposits only from its configured Spield caller and account for exactly what arrived.
3. Report the position's current value using an approved source of truth for USTRY value.
4. Return USTRY (or an agreed settlement asset) on withdrawals and report the amount actually paid.
5. Expose available liquidity, and fail safely when the amount cannot be redeemed or transferred.

Unlike the Blend strategy, this adapter would not call a lending pool's `submit` or read Blend `b_rate`. Etherfuse USTRY is the asset position itself: its price/NAV can change as the treasury instrument accrues value. The adapter therefore needs a trusted, well-defined valuation and redemption method. It must not pretend that USTRY has the same rate semantics as Blend bTokens.

### The intended flow: user pays USDC and receives USTRY-backed SR

This can be done while keeping the familiar “deposit → receive SR” experience. The important addition is a **USDC-to-USTRY conversion step before the SR deposit**. The existing SR contract accepts only its configured underlying token, so an SR instance backed by USTRY must receive USTRY, not USDC.

```text
User USDC
   → Spield entry router
   → swap USDC for USTRY (with a minimum-output limit)
   → SR-USTRY deposits the received USTRY into the USTRY strategy
   → USTRY strategy holds USTRY
   → SR-USTRY mints SR shares to the user
```

The user can choose a USDC amount, but the number of SR shares should be calculated from the **USTRY actually received after the swap**. The quote should show the expected USTRY and SR output, and the signed transaction should enforce a `min_ustry_out` / `min_sr_out` so a price move or bad swap cannot silently give the user much less than quoted.

For the first version, keep Blend and USTRY as **separate SR products**:

- Existing `SR-USDC` remains backed by the Blend strategy and represents USDC-denominated exposure.
- New `SR-USTRY` is backed by the USTRY strategy and represents USTRY-denominated exposure.
- The entry router offers the USDC-to-USTRY path and deposits the purchased USTRY into SR-USTRY.

That keeps each SR token tied to one source and one underlying. Combining Blend and USTRY in one SR token would need a portfolio allocator and new share valuation/redemption rules; it is not required for the requested user flow.

### What the router and strategy each do

The **entry router** handles the asset conversion. It receives the user's authorized USDC, swaps through an approved Stellar market or issuer-supported purchase route, checks the minimum USTRY output, and sends USTRY into SR-USTRY for minting. The swap and SR deposit should be atomic when the selected venue supports it, so the user does not end up with only one leg completed.

The **USTRY strategy** handles custody and redemption. It receives USTRY from SR-USTRY, tracks the position and its value, and returns USTRY when SR shares are redeemed. The adapter does not itself need to convert the user's USDC if the router performs that job.

On exit there are two choices:

1. **Simplest:** burn SR-USTRY and return USTRY to the user.
2. **USDC round trip:** redeem SR-USTRY to USTRY, then swap USTRY back to USDC through a route with `min_usdc_out` protection.

If the product promises USDC on exit, that swap and its liquidity/slippage risk must be shown clearly. SR cannot promise a fixed USDC amount based only on a USTRY balance.

The SR units should be based on USTRY deposited, while the user's USDC-to-USTRY exchange determines how many units they receive. If USTRY's own token price/NAV increases over time, the USD value of the USTRY and SR position can increase without changing the user's SR token count. If Spield wants SR value to be reported in USDC, it needs a reliable, fresh USTRY/USDC valuation source; a thin market spot price should not be the sole solvency value.

For the fixed-rate vault or PT/YT path, the same layering can work only after the product's denomination is explicit. If SR-USTRY redeems in USTRY, then PT, YT, vault liabilities, coupon amounts and maturity payouts are naturally USTRY-denominated too. To keep those products USDC-denominated, Spield must price and convert USTRY to/from USDC and handle the associated price and liquidity risks. The current vault code assumes USDC settlement, so it cannot simply be pointed at a USTRY strategy unchanged.

### Code changes that would be needed

- Add a separate `ustry-strategy` contract implementing `YieldStrategy`, with USTRY as its underlying, caller authorization, deposit, withdrawal, position valuation and liquidity views.
- Add a USDC entry router (and optionally an exit router) that performs the USTRY swap, enforces minimum output, and deposits/redeems through the USTRY SR instance. Keep the actual swap venue replaceable/configurable.
- Rework shared names/comments and math that currently say `b_rate` or assume Blend share conversion. The interface types can stay similar only if “rate” has a precise, compatible meaning for USTRY.
- Deploy a new SR contract whose strategy and underlying are fixed to the USTRY adapter and USTRY asset. Existing SR should continue using its existing Blend strategy. The router must respect the SR contract's authorization model when depositing on behalf of the user.
- Add network configuration, SDK clients, UI labels, transaction building and indexer/monitoring for the new source.
- Decide how USTRY value is observed. Prefer an issuer-supported on-chain redemption quote or a robust oracle with freshness and failure checks. Do not use a thin AMM spot price as the sole solvency value.
- Test deposits, redemptions, transferability, rounding, stale or missing valuation, sudden price changes, liquidity shortage, and total loss behavior. Confirm token decimals and authorization requirements from the actual Stellar asset/contract before deployment.
- For USDC entry or exit, add explicit swaps and `min_out` protections; never promise a fixed USDC amount based only on an unprotected spot quote.

### Transferable does not mean yield-bearing or issuer-approved

The request's assumption is that USTRY is freely transferable and can be held by contracts without issuer allowlisting. The repository does not yet verify those token properties. Etherfuse's public USTRY page currently lists a Stellar asset and ecosystem entries for an Etherfuse Blend pool and a USTRY/USDC Stellar market, but those facts alone do not establish the exact transfer rules, redemption rights, or safe valuation source for Spield. Verify the actual issuer/asset identifier, Stellar flags, decimals, legal eligibility, contract custody support and exit mechanism before treating it as permissionlessly depositable.

### Suggested implementation sequence

1. Confirm USTRY's Stellar asset identifier, decimals, transfer restrictions, value-accrual behavior and redemption route; select an actual USDC/USTRY swap or issuer purchase route with enough liquidity.
2. Implement and test the USTRY strategy and separate SR-USTRY deployment.
3. Implement the USDC entry router with atomic swap/deposit behavior where possible and enforce minimum USTRY/SR output.
4. Add UI and operational monitoring; add protected USDC exit swaps only if the product requires USDC payouts.

Current public reference: [Etherfuse USTRY asset page](https://app.etherfuse.com/bonds/ustry) (shows USTRY's Stellar asset entry and the listed Stellar ecosystem integrations).

## Code trail

- `contract/spield/contracts/sr/src/lib.rs` — SR deposit and redemption; SR pulls user USDC, calls the strategy and mints/burns SR.
- `contract/spield/contracts/strategy/src/lib.rs` — Blend adapter; supplies and withdraws USDC, reads the Blend reserve rate, and handles BLND emissions.
- `contract/spield/contracts/srvault/src/lib.rs` — fixed-rate receipt deposit and its internal `USDC → SR → PT+YT` acquisition flow.
- `contract/spield/contracts/wrapper/src/lib.rs` — separate wrapper mint path that supplies through the strategy and mints PT+YT to the user.
- `README.md` — product overview and high-level Blend explanation.

