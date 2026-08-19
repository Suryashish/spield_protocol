# Atomic YT Router — Risk Register and Required Mitigations

> Status: **security/design review — no implementation yet**
>
> Related design documents:
>
> - `ATOMIC_YT_ROUTER_DESIGN.md` — proposed Pendle-style atomic YT buy/sell flow.
> - `ISSUES_1_2_PT_YT_REDESIGN.md` — prerequisite PT, YT, maturity, vault, and migration redesign.
> - `tofix.md` — verified defects in the current contracts.
>
> Purpose: list the ways an atomic YT router could damage the wrapper, market, vault, LPs, or users,
> and define the mitigation and verification required before implementation or deployment.

---

## 1. Executive conclusion

The atomic YT mechanism has no unavoidable economic contradiction. A successful route is equivalent
to an ordinary PT trade:

```text
Atomic Buy YT  = AMM buys newly minted PT while the user retains YT
Atomic Sell YT = AMM sells PT which is combined with the user's YT
```

The mechanism is nevertheless an architecture-wide change. Implementing only `buy_yield` and
`sell_yield` on top of the current contracts would be unsafe.

The most important risks are:

1. counterfeit PT becoming globally redeemable;
2. stale per-position shares creating phantom YT claims;
3. AMM reserve loss during incomplete or incorrectly settled atomic routes;
4. split-recipient authorization allowing funds or claims to be redirected;
5. breaking the existing vault or stored positions during the wrapper upgrade;
6. exceeding Soroban mainnet transaction limits;
7. one-sided Long-Yield demand exhausting PT or USDC liquidity;
8. inconsistent PT/YT pricing or rounding creating a profitable extraction loop.

No mainnet seed or router deployment should occur until every **P0** item in this register has a
passing verification gate.

---

## 2. Severity and status definitions

### Severity

| Severity | Meaning |
|---|---|
| **P0** | Can drain backing/reserves, create unbacked liabilities, permanently break exits, or corrupt existing live state. Must be fixed before deployment. |
| **P1** | Can block trades/exits, create serious economic loss, make the product operationally unusable, or violate expected pricing. Must be fixed before meaningful TVL. |
| **P2** | UX, observability, documentation, or bounded edge-case problem. Should be fixed before public launch unless explicitly accepted. |

### Status

| Status | Meaning |
|---|---|
| **BLOCKER** | Router work must not proceed to deployment while unresolved. |
| **DESIGN** | Requires an explicit architecture/product decision. |
| **IMPLEMENT** | Solution is understood but not yet implemented. |
| **VERIFY** | Implementation exists only after code lands; testing/measurement remains required. |
| **ACCEPTED** | Residual risk has been explicitly accepted and documented. |

---

## 3. Summary table

| ID | Risk | Severity | Current status | Primary mitigation |
|---|---|---:|---|---|
| R-01 | Counterfeit PT drains global backing | P0 | BLOCKER | Permanently lock and verify classic issuer before balance redemption |
| R-02 | Phantom YT from stale position shares | P0 | BLOCKER | Maturity settlement + aggregate yield reserve + finalized YT accounting |
| R-03 | AMM advances funds but receives insufficient PT/USDC | P0 | DESIGN | Atomic execution plus exact post-balance assertions |
| R-04 | Split-recipient authorization theft | P0 | DESIGN | Bind auth to payer, receivers, amounts, market, wrapper, and limits |
| R-05 | PT liability changed twice or not at all | P0 | DESIGN | One global liability mutation path and conservation assertions |
| R-06 | Same PT/YT claim consumed twice | P0 | DESIGN | Burn-before-settle semantics and post-state invariants |
| R-07 | Existing vault redemption breaks | P0 | BLOCKER | Versioned wrapper ABI and coordinated vault upgrade |
| R-08 | Persisted Position entries become undecodable | P0 | BLOCKER | Preserve old encoding or perform explicit versioned migration |
| R-09 | Wrapper/market maturity mismatch | P0 | IMPLEMENT | Market initialization must verify wrapper maturity and assets |
| R-10 | Post-maturity mint creates unbacked/phantom YT | P0 | BLOCKER | Strict mint-before-maturity gate |
| R-11 | Partial YT sale claims wrong amount of yield | P1 | DESIGN | Define proportional claim or explicit claim-all-before-sale behavior |
| R-12 | Soroban transaction exceeds mainnet limits | P0 | VERIFY | Real-Blend-WASM budget measurements before architecture approval |
| R-13 | `b_rate` decrease freezes router and exits | P0 | BLOCKER | Exit-safe rate-decrease recovery policy |
| R-14 | One-sided demand exhausts AMM USDC/PT | P1 | DESIGN | Reserve-aware curve bounds, maximum trade size, and honest UI |
| R-15 | Fee charged on principal makes YT uneconomic | P1 | DESIGN | Yield-relative fee calibration and execution-price simulations |
| R-16 | Quote/rounding mismatch enables arbitrage drain | P0 | VERIFY | One shared quote core and round-trip invariant/fuzz tests |
| R-17 | Front-running changes YT execution price | P1 | IMPLEMENT | Maximum input/minimum output, deadlines, and price-impact limits |
| R-18 | Plain USDC pool has different LP economics from Pendle SY | P1 | DESIGN | Spield-specific simulations and LP disclosures; do not copy parameters |
| R-19 | Pause policy either traps exits or permits unsafe trades | P1 | DESIGN | Separate inflow, trading, exit-only, and settlement modes |
| R-20 | Router retains funds or receives donations | P1 | IMPLEMENT | Zero-retained-balance invariant and explicit recovery policy |
| R-21 | Internal reserves diverge from real token balances | P0 | IMPLEMENT | Balance-delta checks and controlled donation/sync policy |
| R-22 | Arbitrary dependency/callback substitution | P0 | DESIGN | Fixed verified addresses; no user-selected callback contracts |
| R-23 | Yield transfer ownership remains ambiguous | P0 | BLOCKER | Choose checkpoint-aware YT or authoritative position model |
| R-24 | Delayed maturity settlement changes final yield | P1 | DESIGN | Explicit settlement-time policy and keeper/incentive strategy |
| R-25 | Rounding dust becomes order-dependent | P1 | VERIFY | Fixed reserve, conservative rounding, and claimant-order tests |
| R-26 | Blend loss causes a first-redeemer bank run | P0 | DESIGN | Define pro-rata loss policy before tolerating negative rate movement |
| R-27 | Market cannot guarantee an early YT exit | P2 | ACCEPTED/DOC | State that early exit depends on liquidity; maturity claim remains |
| R-28 | Monitoring cannot distinguish router/accounting failure | P1 | IMPLEMENT | Dedicated events, invariant telemetry, and circuit-breaker alerts |

---

## 4. Detailed risks and solutions

## R-01 — Counterfeit PT drains global backing

**Severity:** P0  
**Status:** BLOCKER

### Failure scenario

PT/YT are classic Stellar assets represented through SACs. Moving SAC administration to the wrapper
does not prevent the classic issuer from creating new supply through a classic payment.

Once PT redemption becomes balance-based:

```text
Compromised issuer creates PT without a deposit
                    ↓
Attacker redeems counterfeit PT
                    ↓
Wrapper withdraws real USDC from Blend
```

The same counterfeit PT can also drain the AMM's USDC reserve through direct or atomic trades.

### Potential solution

Before enabling balance-based redemption or atomic YT routing:

1. verify the live issuer account, flags, thresholds, and all additional signers;
2. verify PT/YT SAC admin is the wrapper;
3. rehearse the entire procedure on testnet;
4. prove wrapper mint and burn still work after issuer lock;
5. remove every signer capable of meeting a transaction threshold;
6. set issuer master weight to zero;
7. prove classic PT/YT issuance now fails;
8. record the verified final issuer state.

### Verification gate

- Testnet classic issuance fails after lockdown.
- Wrapper mint → claim → combine/redeem still succeeds.
- Live account inspection shows no effective signer path.
- No router deployment until the verification is recorded.

### Residual risk

The wrapper remains SAC admin. A malicious wrapper upgrade could mint PT/YT, so upgrade governance and
its timelock remain part of the trust model.

---

## R-02 — Phantom YT from stale position shares

**Severity:** P0  
**Status:** BLOCKER

### Failure scenario

The current wrapper treats each position's `shares` as its slice of the real Blend position. A global
PT redemption removes Blend shares without identifying an original position to decrement.

If a YT position continues using its previous shares:

```text
Bob globally redeems PT
        ↓
Real Blend shares decrease
        ↓
Alice's stored shares remain unchanged
        ↓
Alice calculates future yield from shares that no longer exist
```

This can cause failed final claims, redemption-order dependence, or phantom claims against other
users' backing.

### Potential solution

Implement all of the following as one accounting redesign:

- global `total_pt_liability`;
- permissionless maturity settlement;
- one stored `maturity_rate`;
- no YT accrual after the settlement rate;
- aggregate `remaining_yield_reserve`;
- final claim that decreases the reserve and cannot repeat;
- strict mint-before-maturity enforcement;
- a finalized position/token model for pre-maturity YT.

### Verification gate

For multiple positions with different entry and claim histories:

```text
PT then YT claims == YT then PT claims
```

within a documented fixed rounding bound. Aggregate final YT payouts must never exceed the frozen
yield reserve.

---

## R-03 — AMM advances funds but receives insufficient settlement

**Severity:** P0  
**Status:** DESIGN

### Failure scenario

On an atomic YT buy, the market may contribute 94 USDC expecting 100 PT. On an atomic YT sell, it may
release 100 PT expecting 90 USDC.

If an external call returns the wrong amount, redirects assets, or completes only part of the
intended path, LP reserves can be drained.

### Potential solution

- Keep the entire operation atomic.
- Use fixed wrapper, PT, and USDC addresses.
- Read real token balances before the route.
- Execute the wrapper interaction.
- Read balances after the route.
- Require exact expected deltas before updating reserves.
- Revert the entire transaction on any mismatch.
- Avoid an arbitrary user-selected callback.

Required buy-side postcondition:

```text
actual market PT increase == expected PT input
actual market USDC decrease == quoted USDC output
```

Required sell-side postcondition:

```text
actual market PT decrease == expected PT output
actual market USDC increase == quoted PT purchase value
```

### Verification gate

Fault-injection tests must force every nested call to fail or return a short amount and prove that all
user, market, wrapper, and strategy balances return to their exact pre-call values.

---

## R-04 — Split-recipient authorization theft

**Severity:** P0  
**Status:** DESIGN

### Failure scenario

Atomic buying requires one party to fund the deposit, PT to go to the market, and the yield claim to
go to the user. A loosely authorized API could let an attacker charge a victim and redirect both
claims.

### Potential solution

Bind authorization to the full intent:

```text
operation type
user/payer
market
wrapper
PT receiver
YT/yield receiver
amount/notional
maximum input or minimum output
position id for a sell
deadline/maturity
```

Do not expose a generic `mint_split` or `combine_to` that accepts arbitrary recipients without a
trusted caller gate and exact authorization tree.

### Verification gate

Adversarial tests substitute every address and amount independently. Every substitution must fail
without moving funds or changing liabilities.

---

## R-05 — Global PT liability changed twice or not at all

**Severity:** P0  
**Status:** DESIGN

### Failure scenario

The router introduces new code paths for minting and burning PT. If both a legacy position path and
the new global path mutate liability, it may be decremented twice. If neither path does, the wrapper
may hold an untracked obligation.

### Potential solution

- Create one internal liability mutation function for all mint/burn paths.
- Increase liability only after a backed mint succeeds.
- Decrease liability exactly once for every successful PT burn.
- Keep the legacy ABI only as an adapter into the same internal logic.
- Reject underflow and liability/balance inconsistencies.
- Emit liability-before/liability-after values in events or monitoring data.

### Verification gate

After arbitrary sequences of mint, transfer, AMM swap, atomic buy, atomic sell, combine, and mature
redemption:

```text
global PT liability == wrapper-issued PT minted - wrapper-burned PT
```

Transfers must never change liability.

---

## R-06 — Same PT or YT claim consumed twice

**Severity:** P0  
**Status:** DESIGN

### Failure scenario

A router could settle market reserves using a PT or YT claim while leaving state that permits the
same claim to be redeemed again.

### Potential solution

- Burn PT in the same atomic operation that releases principal.
- Reduce/burn the exact YT notional in the same operation.
- Use one monotonic position state transition.
- Mark final maturity claims before returning success.
- Ensure legacy and new entry points share the same burn and liability logic.
- Do not use balance observation alone as proof of a burn unless the delta is verified.

### Verification gate

Every successful consume operation is immediately followed in tests by attempts through all other
entry points. All second attempts must fail without state changes.

---

## R-07 — Existing vault redemption breaks

**Severity:** P0  
**Status:** BLOCKER

### Failure scenario

The current vault calls position-based `redeem_pt(position_id, amount)`, scans tracked positions, and
reads `Position.pt_amount`. Replacing the wrapper ABI or making `pt_amount` non-authoritative can make
mature fixed-rate receipts unredeemable.

### Potential solution

- Add new versioned wrapper functions without immediately removing old exports.
- Make the legacy function an adapter into the global accounting path.
- Upgrade the vault to redeem from its actual PT balance in one call.
- Preserve receipt redemption throughout the staged upgrade.
- Test wrapper-old/vault-old, wrapper-new/vault-old, and wrapper-new/vault-new combinations that can
  exist during governance delays.

### Verification gate

Create receipts before the upgrade, execute the upgrade sequence, advance to maturity, and redeem
every receipt for the promised payout.

---

## R-08 — Persisted Position entries become undecodable

**Severity:** P0  
**Status:** BLOCKER

### Failure scenario

`Position` is stored persistently. Removing or renaming fields can change its contract encoding and
make every existing position unreadable after a WASM upgrade.

### Potential solution

Choose one:

1. preserve the existing `Position` type and store new state under additional keys;
2. introduce `PositionV2` with explicit version dispatch;
3. migrate every position with a resumable, idempotent migration;
4. if there is no meaningful TVL, deploy a new wrapper and maturity series instead of migrating.

Never assume a Rust struct edit is automatically storage-compatible.

### Verification gate

Load production-shaped old storage snapshots with the new WASM and prove every position can claim,
combine, transfer its yield right, and settle at maturity.

---

## R-09 — Wrapper/market maturity or asset mismatch

**Severity:** P0  
**Status:** IMPLEMENT

### Failure scenario

A market with a different maturity, PT, or underlying asset could quote or fund a route that the
wrapper handles under different rules.

### Potential solution

At market initialization, derive or verify:

```text
market.pt == wrapper.pt_token()
market.usdc == wrapper.underlying()
market.maturity == wrapper.maturity()
```

Store the wrapper as a fixed dependency and never accept it as a per-trade user argument.

### Verification gate

Initialization with any one mismatched field must fail. Runtime tests must show that no alternate
token or wrapper can enter a route.

---

## R-10 — Post-maturity mint creates phantom YT

**Severity:** P0  
**Status:** BLOCKER

### Failure scenario

If a user mints after maturity, immediately globally redeems PT, and retains a newly created YT
position, stale share accounting may generate claims without matching assets.

### Potential solution

Add a strict wrapper-level gate:

```text
now < maturity
```

to every path that creates PT/YT exposure, including router-only or split-recipient mint functions.

### Verification gate

At `timestamp == maturity` and every later timestamp, all direct and routed mint paths must fail
before moving USDC.

---

## R-11 — Partial YT sale settles the wrong yield amount

**Severity:** P1  
**Status:** DESIGN

### Failure scenario

The current combine path auto-claims all accrued yield before a partial combine. Selling 10 units
from a 100-unit position could unexpectedly claim yield for the remaining 90 units too.

This complicates quotes and may route a large unexpected payment through the market.

### Potential solutions

Choose one and specify it in the ABI:

**A. Proportional settlement — recommended for trading**

```text
yield paid = total position accrued yield × amount sold / active notional
```

Only the sold notional is settled. Remaining notional retains its appropriate checkpoint/basis.

**B. Claim-all before sale**

Claim all accrued yield directly to the user, then sell only the requested YT notional. The UI and
return values must separate `yield_claimed` from `YT sale proceeds`.

### Verification gate

Partial sells across multiple epochs must conserve total yield and produce the same final payout as
an equivalent sequence of explicit claims and combines, within bounded rounding.

---

## R-12 — Atomic route exceeds Soroban mainnet resource limits

**Severity:** P0  
**Status:** VERIFY

### Failure scenario

Atomic YT selling may combine:

- market pricing and reserve writes;
- several SAC transfers/burns;
- wrapper position reads/writes;
- a Blend yield withdrawal;
- a Blend principal withdrawal;
- global solvency checks;
- router settlement transfers.

A correct design that exceeds mainnet memory, ledger-entry, or instruction limits cannot deliver the
promised one-transaction UX.

### Potential solution

- Prototype the smallest direct market-orchestrated path.
- Avoid unnecessary duplicate rate/backing reads.
- Prefer fixed dependencies over dynamic callbacks.
- Consider claim-all in a separate transaction only if the UX/product trade-off is accepted.
- Measure with real Blend WASM and mainnet invocation limits, not native mocks alone.
- Reject the architecture if the worst valid atomic sell does not fit with safety margin.

### Verification gate

Both maximum-size buy and maximum-size sell must fit every mainnet resource ceiling with a documented
margin under real WASM execution.

---

## R-13 — `b_rate` decrease freezes router and exits

**Severity:** P0  
**Status:** BLOCKER

### Failure scenario

The current rate guard rejects any decrease below its stored high-water mark. Because atomic routes
read the live rate through wrapper/strategy operations, a Blend loss event can freeze YT buys, YT
sells, claims, combine, and maturity settlement.

### Potential solution

Implement the separate rate-decrease remediation before router launch:

- keep strict checks for new inflows;
- allow safe exit calculations under a bounded or governed reset;
- preserve a conservative loss/solvency policy;
- keep read-only health views operational during the event.

### Verification gate

Under a simulated rate decrease:

- new exposure follows the selected safety policy;
- PT/YT exits do not become permanently inaccessible;
- the router cannot pay more than actual backing permits;
- monitoring remains available.

---

## R-14 — One-sided YT demand exhausts PT or USDC reserves

**Severity:** P1  
**Status:** DESIGN

### Failure scenario

Every atomic YT buy makes the AMM hold more PT and less USDC. Every atomic YT sell makes it hold less
PT and more USDC.

```text
Repeated Buy YT  → USDC reserve approaches zero
Repeated Sell YT → PT reserve approaches zero
```

### Potential solution

- Use reserve-aware maximum trade sizes.
- Make the curve strongly worsen execution before a reserve reaches its safety floor.
- Enforce an absolute reserve floor.
- Expose remaining buy/sell capacity in quotes and the UI.
- Seed enough liquidity for target notional.
- Add LP incentives only after simulations quantify exposure.
- Never promise guaranteed early exit.

### Verification gate

Stress tests repeatedly trade in one direction until rejection. The final accepted trade must leave
both reserves above configured safety floors, with no negative or zero-price quote.

### Residual risk

Early exit remains liquidity-dependent. Users retain maturity settlement rights, but the AMM cannot
guarantee an early trade at every size.

---

## R-15 — Principal-based fees make YT uneconomic

**Severity:** P1  
**Status:** DESIGN

### Failure scenario

If 100 PT trades for 94 USDC while YT costs only 6 USDC, a fee charged on 94 USDC may be large
relative to the actual yield value.

```text
0.30% of 94 USDC = 0.282 USDC
0.282 / 6 = 4.7% of the Long-Yield entry cost
```

### Potential solution

- Simulate fees relative to YT net cost and time to maturity.
- Consider a yield-relative or implied-rate-relative fee model.
- Ensure direct PT and synthetic YT paths cannot choose whichever fee calculation is cheaper for the
  same economic reserve transition.
- Display the effective fee as a percentage of net YT value.

### Verification gate

Run fee simulations over rate, maturity, trade-size, and liquidity ranges. Product governance must
approve maximum effective YT entry/exit costs before launch.

---

## R-16 — Quote or rounding mismatch enables extraction

**Severity:** P0  
**Status:** VERIFY

### Failure scenario

If direct PT trades and synthetic YT routes use different rounding, fee, timestamp, or curve logic,
an attacker may loop through them and finish with more value.

### Potential solution

- Use one shared pure quote core for every PT reserve transition.
- Use explicit rounding direction favorable to pool solvency.
- Pass one timestamp/rate snapshot through the whole route.
- Apply fees once and in the correct direction.
- Assert that buy→sell without external price movement cannot generate profit.

### Verification gate

Property and fuzz tests across realistic and extreme reserve sizes:

```text
value_after_round_trip <= value_before - documented_fee + fixed_rounding_tolerance
```

No sequence mixing legacy swaps, atomic routes, partial positions, and maturity boundaries may
extract net value.

---

## R-17 — Front-running and execution-price movement

**Severity:** P1  
**Status:** IMPLEMENT

### Failure scenario

Another transaction can move PT reserves between quote generation and execution, increasing the YT
buy cost or reducing sell proceeds.

### Potential solution

Require:

- `max_usdc_in` for buys;
- `min_usdc_out` for sells;
- transaction deadline;
- maximum price impact;
- exact market/maturity selection;
- UI simulation immediately before signing.

### Verification gate

Tests move the market to both sides of the user's limit before execution. The route either stays
inside the limit or reverts without state changes.

---

## R-18 — Plain USDC pool differs from Pendle PT/SY economics

**Severity:** P1  
**Status:** DESIGN

### Failure scenario

Pendle's second reserve is SY, a standardized yield-bearing asset. Spield's current second reserve is
plain USDC, which does not earn the Blend yield available to deposited USDC.

Blindly copying Pendle's curve or fee parameters can misprice LP opportunity cost and time decay.

### Potential solution

- Build a Spield-specific economic simulator.
- Model LP returns from PT appreciation, idle USDC, fees, reserve imbalance, and maturity.
- Calibrate the curve and fee range against Blend rate scenarios.
- Consider a yield-bearing USDC-side design only as a separate audited architecture decision.
- Document that the mechanism is Pendle-inspired, not economically identical.

### Verification gate

Approve parameters only after multi-scenario LP and trader simulations, including low yield, high
yield, sudden rate movement, one-sided order flow, and hold-to-maturity outcomes.

---

## R-19 — Pause policy traps exits or permits unsafe trades

**Severity:** P1  
**Status:** DESIGN

### Failure scenario

Blocking both buy and sell under one market pause may prevent early YT exits. Allowing both may
continue exposing reserves during a pricing/accounting incident.

### Potential solution

Define separate modes:

```text
NORMAL       → buys and sells allowed
NO_INFLOW    → new YT buys blocked; risk-reducing exits may continue
TRADING_HALT → AMM routes blocked; direct wrapper claims/exits remain
SETTLEMENT   → maturity-only PT/YT settlement
```

The wrapper's independent user-fund exits must not depend permanently on market availability.

### Verification gate

For every pause mode, tests enumerate every public entry point and prove the documented allow/deny
matrix. Mature PT redemption and final YT claim must remain available under safe conditions.

---

## R-20 — Router retains funds or donations distort settlement

**Severity:** P1  
**Status:** IMPLEMENT

### Failure scenario

Rounding, failed forwarding, or direct token donations may leave PT/USDC/YT in a router. Later users
could accidentally receive or consume those balances, making outcomes order-dependent.

### Potential solution

- Prefer direct market orchestration so a separate router never holds inventory.
- If a router is used, assert zero expected token balances at successful completion.
- Never use the router's total balance as the user's trade amount.
- Track exact per-call deltas.
- Define a governed or permissionless safe recovery method for unrelated donated tokens that cannot
  withdraw market/user funds.

### Verification gate

Donate each supported token to the router before a trade. The user's quote and output must remain
unchanged, and the donated balance must not be attributed to the user.

---

## R-21 — Internal reserves diverge from actual balances

**Severity:** P0  
**Status:** IMPLEMENT

### Failure scenario

The market stores explicit reserves while token balances can change through transfers, donations, or
nested route failures. If accounting and real balances diverge, quotes may sell assets that are not
present or ignore assets that should belong to LPs.

### Potential solution

- Check expected real balance deltas for every operation.
- Update reserve state only after successful external calls.
- Define whether donations are ignored, synchronized, or attributed to LPs.
- Never silently use `actual_balance` as reserve without a controlled sync rule.
- Emit reserve-sync events.

### Verification gate

After every direct swap, atomic route, liquidity operation, maturity settlement, and donation case:

```text
accounted reserves == balances owned for LP accounting
```

under the selected donation policy.

---

## R-22 — Arbitrary dependency or callback substitution

**Severity:** P0  
**Status:** DESIGN

### Failure scenario

A generic router that calls user-provided wrapper/token/callback addresses could send AMM reserves to
malicious contracts which return fake values or redirect assets.

### Potential solution

- Store one verified wrapper per market.
- Derive PT, USDC, and maturity from that wrapper.
- Do not accept arbitrary callbacks.
- If callback-like composition is unavoidable, whitelist one immutable implementation and verify
  final balance deltas rather than trusting return values.
- Keep the router permissionless for users but not configurable per trade.

### Verification gate

All attempts to substitute a token, wrapper, recipient, or callback fail before the market transfers
assets.

---

## R-23 — YT ownership remains ambiguous

**Severity:** P0  
**Status:** BLOCKER

### Failure scenario

The current system has a transferable YT SAC but yield claims are controlled by position ownership.
A direct YT transfer can separate the token balance from the account allowed to claim.

An atomic router cannot safely consume or assign YT until one source of truth is selected.

### Potential solutions

**A. Position-based YT for the first router release**

- Yield Position is authoritative.
- Atomic buy creates a position for the user.
- Atomic sell reduces that position.
- Direct YT SAC transfers are not represented as ownership and should be removed, disabled through a
  new token design, or clearly migrated away.

**B. Checkpoint-aware fungible YT**

- YT balance is authoritative.
- Every mint, burn, and transfer updates yield indexes.
- Accrued yield ownership is preserved across transfers.
- More complex, but supports direct YT composability.

### Verification gate

There must be no sequence where one account holds the claimable token while another account can
withdraw its yield. Supply, ownership, transfer, claim, and combine fuzzing must preserve one
authoritative model.

---

## R-24 — Delayed maturity settlement changes final yield

**Severity:** P1  
**Status:** DESIGN

### Failure scenario

If the final rate is read by the first transaction after maturity, a delayed settlement gives YT
holders extra post-maturity yield. If an exact historical rate is unavailable, the contract cannot
reconstruct the maturity-time value later.

### Potential solutions

Choose and document one:

1. yield accrues until the first permissionless settlement transaction;
2. incentivize a keeper to settle immediately at maturity;
3. use a trusted historical rate source if one is available and audited;
4. settle in a known pre-maturity window with a documented approximation.

Do not imply exact-to-the-second maturity yield unless the mechanism can prove it.

### Verification gate

Tests settle immediately and after long delays. Outputs must follow the documented policy, and no
later transaction may change the stored settlement rate.

---

## R-25 — Rounding dust becomes claimant-order dependent

**Severity:** P1  
**Status:** VERIFY

### Failure scenario

Blend floors supplied shares and ceils withdrawal shares. Multiple claims may consume slightly more
backing than their exact mathematical value, making the last claimant lose more than earlier ones.

### Potential solution

- Use conservative payout rounding.
- Reserve a fixed, explicitly bounded settlement dust amount.
- Avoid unbounded tolerance based on historical operation count.
- Handle the final claim through explicit remaining-liability logic.
- Test all claimant permutations.

### Verification gate

Across randomized positions and every claim order, the maximum payout difference is within one fixed
documented dust bound and never scales without limit with history.

---

## R-26 — Blend loss creates a first-redeemer bank run

**Severity:** P0  
**Status:** DESIGN

### Failure scenario

If Blend backing falls below outstanding PT liability and global redemption continues at par, early
redeemers receive full payment while later holders bear the entire loss.

### Potential solution

Before allowing exits under a negative-rate/loss event, define a loss policy. The safest general
policy is a settlement factor:

```text
redemption factor = available principal backing / outstanding PT liability
```

Each PT then receives the same pro-rata amount. The factor must be frozen or updated under carefully
specified rules so users cannot manipulate its denominator.

Alternatively, keep par redemption frozen until backing recovers, but that explicitly traps exits
and should not be presented as a safe default.

### Verification gate

Under simulated 1%, 10%, and severe backing losses, all redemption orders produce equal pro-rata
outcomes and total payouts never exceed backing.

---

## R-27 — Market cannot guarantee an early YT exit

**Severity:** P2  
**Status:** ACCEPTED/DOC

### Failure scenario

The atomic sell requires PT inventory in the AMM. If the market is depleted or out of range, the
trade cannot execute at the requested size.

### Potential solution

- Present early exit as liquidity-dependent.
- Show available exit capacity and price impact.
- Allow partial fills only if explicitly designed; otherwise revert atomically.
- Preserve direct yield claim at maturity independently of the AMM.
- Avoid language such as "guaranteed instant exit."

### Verification gate

The UI and documentation distinguish guaranteed contractual maturity claims from best-effort market
liquidity.

---

## R-28 — Monitoring cannot identify router/accounting failure

**Severity:** P1  
**Status:** IMPLEMENT

### Failure scenario

An accounting mismatch may remain unnoticed until LP withdrawal or maturity if events expose only a
user's net trade.

### Potential solution

Emit enough structured data to reconstruct every route:

```text
user
position/YT amount
net user input/output
PT reserve delta
USDC reserve delta
PT liability before/after
yield claimed
wrapper backing after
market reserves after
```

Add monitoring alerts for:

- actual balance versus reserve mismatch;
- backing versus liability shortfall;
- unexpected router balance;
- issuer-account change;
- abnormal one-sided reserve depletion;
- repeated failed settlement;
- rate-bound freeze.

### Verification gate

A replay test reconstructs all reserve and liability changes from emitted events and identifies an
injected mismatch immediately.

---

## 5. Cross-contract compatibility matrix

The following components must be reviewed together:

| Component | Required change | Compatibility requirement |
|---|---|---|
| Wrapper | Global PT liability, maturity settlement, split mint, combine settlement | Existing positions remain readable; legacy exits still work |
| Strategy | Exit-safe rate policy and efficient backing/rate reads | Wrapper remains sole authorized fund-moving caller |
| Market | Atomic YT buy/sell, exact reserve checks, wrapper cross-check | Direct PT swaps and LP shares remain economically unchanged |
| Vault | Balance-based PT redemption | Existing receipts redeem through staged upgrades |
| PT SAC | Balance-based bearer claim | Classic issuer permanently locked first |
| YT model | Position or checkpoint-aware token | Exactly one authoritative owner of yield |
| Frontend | Net-input/net-output quotes and slippage | Never expose gross-capital manual flow as the primary UX |
| Monitoring | Cross-contract invariant telemetry | Detect mismatch before later users interact |

---

## 6. Go/no-go gates

## Gate A — Before coding the atomic router

- YT ownership model decided.
- Issuer-lockdown rehearsal passes on testnet.
- Global PT/yield accounting design approved.
- Maturity and loss policies approved.
- Wrapper/vault migration strategy approved.

## Gate B — Before testnet deployment

- Issuer actually locked in the target test environment.
- Strict post-maturity mint gate implemented.
- Wrapper and market assets/maturity cross-checked.
- Versioned wrapper APIs implemented.
- Market balance-delta assertions implemented.
- No arbitrary dependency/callback inputs.
- Unit and property tests pass.

## Gate C — Before mainnet deployment

- Real-Blend-WASM atomic buy and sell fit mainnet resource limits.
- Old positions and vault receipts survive the full upgrade rehearsal.
- Round-trip and invariant fuzzing finds no extraction path.
- One-sided reserve stress tests pass.
- Fee and LP simulations are approved.
- Rate-decrease and backing-loss behavior is tested.
- Monitoring and emergency modes are operational.
- External security review covers wrapper, market, strategy, and vault together.

## Gate D — Before meaningful TVL

- Limited-size launch caps are active.
- On-chain reserves/liabilities match the launch manifest.
- Issuer state and SAC admins are live-verified.
- First real atomic buy/sell and maturity rehearsal are observed successfully.
- Incident response runbook and pause-mode matrix are published.

---

## 7. Recommended implementation sequence

1. Close issuer and token-supply integrity risks.
2. Fix the `b_rate` decrease/exit-freeze design.
3. Add the strict maturity gate to all mint paths.
4. Implement global PT liability and maturity yield reserve.
5. Finalize YT ownership and partial-settlement behavior.
6. Preserve/version existing Position storage.
7. Add wrapper APIs behind one internal accounting implementation.
8. Upgrade the vault to balance-based PT redemption.
9. Cross-check market wrapper/PT/USDC/maturity configuration.
10. Implement one shared quote core for direct PT and synthetic YT routes.
11. Implement atomic buy with exact balance-delta checks.
12. Implement atomic sell with exact balance-delta checks.
13. Add slippage, deadlines, reserve floors, and explicit pause modes.
14. Add invariant events and monitoring.
15. Run real-WASM budget tests, stateful fuzzing, and migration rehearsals.
16. Commission an architecture-wide security review.
17. Launch with conservative size caps and monitored TVL growth.

---

## 8. Final risk acceptance statement

The router should be approved only if all of these statements are demonstrably true:

```text
No unauthorized entity can create redeemable PT or YT.

Every PT is backed when minted and decreases global liability exactly once when burned.

Every YT claim has one authoritative owner and cannot claim beyond the global yield reserve.

The AMM never advances PT or USDC without receiving the exact curve-priced countervalue atomically.

Existing positions and fixed-vault receipts remain redeemable throughout the upgrade.

Direct PT trades and atomic YT routes use identical reserve-transition math and cannot be looped for
profit without external price movement.

Atomic buy and sell fit Soroban mainnet limits using the real Blend execution path.

Loss, pause, maturity, low-liquidity, and rate-decrease behavior are explicit rather than accidental.
```

Until those claims are supported by code, tests, measurements, and deployment-state verification,
the atomic YT router remains a promising design proposal rather than a safe production feature.
