# resolution.md — the five things still open, and how to close them

Everything that was a **code** problem is fixed and tested. What is left is five items that code
cannot decide. Four of them need a **number or a rule from you**; one needs a **single transaction**.

This document explains each in plain language: what the problem is, why it matters, how to decide,
and exactly what to run.

Written 2026-08-27. Cross-references: [`tofix.md`](./tofix.md), [`V2_WORK.md`](./V2_WORK.md).

| # | What is left | Type | Effort |
|---|---|---|---|
| [1](#1-the-deposit-cap--how-much-money-do-we-let-in) | The deposit cap | A number | 1 transaction once decided |
| [2](#2-the-liquidity-alarm--when-should-the-monitor-shout) | The liquidity alarm | Two numbers | ~20 lines in a script |
| [3](#3-scalar_root--how-much-should-one-trade-move-our-advertised-rate) | `scalar_root` | A number | Set at deploy |
| [4](#4-the-old-v1-token-issuer--lock-it-and-forget-it) | Lock the old v1 issuer | An action | 1 transaction |
| [5](#5-two-app-rules--when-does-the-front-end-do-the-thing) | Two app rules | Two rules | Front-end work |

**Only #1 blocks launch.** The rest can be settled in parallel or shortly after.

---

## 1. The deposit cap — how much money do we let in?

### The problem, plainly

Users' money is supplied to Blend. If Blend loses money — a borrower defaults and the loss is shared
across everyone who supplied — then Spield's deposits are worth less than they were.

When that happens, three things follow, in this order:

1. **Everything freezes.** Nobody can deposit, and — this is the part that matters — **nobody can
   withdraw either.** Not even a small amount. We tested every withdrawal size; they all fail.
2. **Somebody on our side has to unfreeze it.** An admin calls one function
   (`strategy::reset_rate_floor`). **Until that happens, users' money is stuck.** How long they wait
   depends entirely on us noticing and acting.
3. **Then everyone takes the same loss.** If Blend lost 20%, every holder gets 20% less. Being first
   in the queue does not help — we tested two users exiting one after the other and they received
   exactly the same amount.

**There is no safety net.** No insurance fund, no company money set aside to cover losses. If it
happens, users absorb all of it.

### Why a cap helps

The cap is a ceiling on how much money is allowed into the protocol. It does not prevent a loss. It
limits **how big** the loss can be.

Right now the cap is `0`, which in this contract means **unlimited**.

### What you are actually deciding

Not "how much risk can I take" — you take none of this financially. The real question is:

> **How much money can users lose, with no compensation, before that is something we cannot stand
> behind?**

Pick that number. Then work backwards.

### How to pick it

Assume a bad-but-not-absurd loss. Blend's own reference config allows utilization up to 95%, and a
20% haircut is a reasonable planning figure for a serious bad-debt event.

| If you cap deposits at | A 20% loss costs users | A 50% loss costs users |
|---:|---:|---:|
| 25,000 USDC | 5,000 | 12,500 |
| 50,000 USDC | 10,000 | 25,000 |
| **100,000 USDC** | **20,000** | **50,000** |
| 250,000 USDC | 50,000 | 125,000 |
| 1,000,000 USDC | 200,000 | 500,000 |

**Suggestion: start low.** Two reasons this is nearly free:

* **Raising the cap later is one transaction.** You are not locked in.
* **The cap can never trap anyone.** It only blocks new deposits. Even if you set it *below* what is
  already deposited, withdrawals keep working — we have a test that does exactly that
  (`the_cap_can_never_trap_a_depositor`).

So the downside of starting too low is "we turn away deposits for a week". The downside of starting
too high is "users lose money we cannot make good".

### How to do it

```bash
# Set the cap on the live contract (amount in base units — 7 decimals, so 100,000 USDC = 1000000000000)
stellar contract invoke --id <SR_CONTRACT> --source-account <ADMIN> --network testnet \
  -- set_deposit_cap --cap 1000000000000
```

And put the same number in the deploy config so a future deployment does not silently go back to
unlimited:

```bash
# scripts/deploy_sr_testnet.sh
SR_DEPOSIT_CAP=1000000000000
```

### How to check it worked

```bash
stellar contract invoke --id <SR_CONTRACT> --source-account <ADMIN> --network testnet --send=no -- deposit_cap
stellar contract invoke --id <SR_CONTRACT> --source-account <ADMIN> --network testnet --send=no -- deposit_headroom
```

`deposit_cap` should be your number. `deposit_headroom` is how much more can still come in. A
deposit larger than the headroom should be rejected.

### One thing to fix alongside it

The freeze is cleared by **an admin key that is currently one hot key**. If that key is lost, the
freeze is permanent. Moving the admin keys to a multisig matters more because of this item than any
other.

---

## 2. The liquidity alarm — when should the monitor shout?

### The problem, plainly

Even when nothing is wrong with Spield, a withdrawal can fail — because Blend is a lending pool, and
if borrowers have taken most of the money out, there is not enough sitting there to pay us.

Our monitor currently warns when **Blend's utilization goes above 85%**.

That number does not tell you anything you can act on. Two readings from the same pool:

```
first run:  85.4%   -> alarm
later run:  70.35%  -> quiet
```

Neither told us whether *our* users could actually get their money out.

### The better question

Not "how busy is Blend?" but **"can Blend pay us out right now?"**

We can now compute that exactly. From the live testnet pool:

```
what Blend can actually pay out    33,456 USDC
what we have deposited there        3,433 USDC
                                   -------------
coverage                            9.7x
```

**9.7× cover** is a number you can act on. "70% utilization" is not.

### What you are deciding

Two levels for that coverage ratio:

* **Warn at** — "keep an eye on this"
* **Critical at** — "act now: stop new deposits, tell users"

### How to pick them

| Coverage | What it means | Suggested |
|---|---|---|
| Above 3× | Even a large withdrawal wave clears easily | healthy |
| **2×** | A rush of half our users could still exit | **warn** |
| **1×** | Only exactly our position is available — no margin | **critical** |
| Below 1× | Some users cannot exit today | already an incident |

**Suggestion: warn at 2×, critical at 1×.** The reason for 1× as critical rather than lower: below
1×, someone is definitely stuck, so it is no longer a warning about the future.

Adjust upward if you expect concentrated withdrawals (a few large holders rather than many small
ones), because then a single exit can consume the whole buffer.

### How to do it

In `scripts/sr_solvency_monitor.mjs`, the alarm currently reads utilization:

```js
utilWarn: Number(arg('util-warn', '85')),
...
if (utilPct >= CFG.utilWarn) { /* warn */ }
```

Replace it with a coverage ratio. The two inputs are already available on chain:

```js
// strategy.available_liquidity()  — what Blend can really pay (already accounts for its 95% ceiling)
// sr.total_assets()               — what we have deposited
const coverage = Number(available) / Number(totalAssets);
if (coverage < CFG.coverCritical)  { /* alarm */ }
else if (coverage < CFG.coverWarn) { /* warn  */ }
```

Keep printing the raw utilization too — it is useful context, just not a good trigger.

### How to check it worked

Run the monitor once and confirm it prints the coverage ratio, then temporarily set `--cover-warn`
to something above the current reading and confirm it warns:

```bash
cd website/contract/spield/scripts && npm run monitor:v2 -- --once --cover-warn 20
```

---

## 3. `scalar_root` — how much should one trade move our advertised rate?

### The problem, plainly

We advertise an interest rate. When someone buys or sells, that rate moves — that is normal and
correct, it is how a market works. `scalar_root` controls **how much** it moves.

* **Too twitchy** — one medium trade swings the advertised rate a lot, and it stops matching what we
  tell users.
* **Too sluggish** — the rate barely responds, so it stops reflecting real demand and you need far
  more capital to make the market work.

Right now it is **40**, which was never chosen on evidence.

*(This was unmeasurable until last week, because of a bug that made the reported rate never move at
all regardless of trading. That is fixed, which is why this is answerable now.)*

### The measurements

On a 500,000 / 500,000 pool, one year to maturity, starting from a 5.00% rate. The numbers are how
far one trade moves the advertised rate, in basis points (100 bps = 1%):

| `scalar_root` | 1% buy | 5% buy | 10% buy | 25% buy |
|---:|---:|---:|---:|---:|
| 10 | 22 bps | 111 bps | 219 bps | 499 bps |
| 20 | 11 bps | 56 bps | 111 bps | 277 bps |
| **40 (current)** | **5 bps** | **28 bps** | **56 bps** | **141 bps** |
| 80 | 2 bps | 14 bps | 28 bps | 71 bps |
| 160 | 1 bps | 7 bps | 14 bps | 36 bps |

**Simple rule: double `scalar_root`, halve the movement.** It is that clean.

### How to read it

At the current 40, someone trading 10% of the pool moves the advertised rate by **0.56%** — from
5.00% to about 4.44%. Ask yourself: *is that acceptable, or does it look broken to a user who saw
5.00% a minute ago?*

### How to pick it

Answer two questions:

1. **How big is a typical trade, as a share of the pool?** If most trades are 1–5%, you are choosing
   between the first two columns.
2. **How far may the market rate drift from the vault's headline rate before it looks wrong?**

Then read the table.

* If a 5% trade moving the rate 28 bps feels fine → **keep 40**.
* If you want a calmer, more stable-looking rate → **80**, which halves everything.
* If you think the market is too slow to react to real demand → **20**.

**Suggestion: keep 40 unless you expect large trades relative to the seed.** It sits in the middle of
the measured range and a 1% trade moving 5 bps is barely visible.

Note the interaction with **seed size**: a bigger seed makes every trade a smaller *share* of the
pool, which reduces impact for free. If you can seed more, that is a better lever than flattening
the curve.

### How to do it

`scalar_root` is set when the market is initialized, so it is a deploy-time choice:

```bash
# scripts/deploy_sr_testnet.sh — the srmarket initialize call
# value is in SCALAR_12 fixed point, so 40 -> 40000000000000
```

Changing it later means deploying a new market.

---

## 4. The old v1 token issuer — lock it and forget it

### The problem, plainly

The old v1 version of Spield created a token called **SPLDPT**. The account that creates that token
is still **unlocked**, which means whoever holds its key can create more SPLDPT out of nothing,
forever.

### How bad is it, honestly

**Not very — but not zero.**

The good news:

* Nobody holds any SPLDPT. Supply is zero. We checked on chain.
* v1 was never used at all, and its term ends **2026-09-06**.
* Fake SPLDPT **cannot be cashed in against the protocol.** The function that would have allowed
  that was never deployed to mainnet. Every real withdrawal path requires an internal record only
  the contract can create.

The bad news:

* **The ability to mint does not expire when the term does.** In a year, someone could create SPLDPT
  and sell it to a person who recognises the Spield name and assumes it is real.

So it is not a way to steal from the protocol. It is a way to scam a third party using our name.

### How to fix it

Lock the account so nothing can ever sign for it again — set its master key weight to zero.

```bash
stellar tx new set-options \
  --source-account <V1_ISSUER_KEY> --network public \
  --master-weight 0
```

**This is permanent.** Once done, that account can never issue anything again. That is the point —
but it also means if you ever wanted to reuse that identity, you cannot. You would not want to.

### How to check it worked

```bash
curl -s "https://horizon.stellar.org/accounts/GA4R5M7ZWOQZWIYCW246YC5WJ4QHT3H74CAUSTCEUUWIELCWI7IP3MKB" \
  | python3 -c "import json,sys; [print(s['key'][:12]+'…', 'weight', s['weight']) for s in json.load(sys.stdin)['signers']]"
```

Every signer should read **weight 0**.

### When to do it

Any time. It is not urgent and it does not block anything — but it never gets easier, and the risk
never goes away on its own.

---

## 5. Two app rules — when does the front end do the thing?

Both of these are cases where **the code is finished** and the only missing piece is deciding when
the app uses it. Nothing is broken; a feature is just not wired to a trigger.

### Rule A — telling a user their withdrawal is unfinished

**What happens now.** If Blend does not have enough money on hand, a withdrawal takes out what it
can, saves the progress safely, and leaves the rest for later. The user's money is never lost or
stuck — they just have to come back.

**What is missing.** Nothing in the app tells them that. From the user's side, they clicked
"withdraw" and less money arrived than expected, with no explanation.

**What to decide.** How the app notices and what it says.

**Suggested rule:**

1. After a withdrawal, call `vaultRedeemRemaining(receiptId)`.
2. If it returns anything above zero, show something like:
   > *"We could only withdraw X of your Y right now — the lending pool is short on cash. The rest is
   > safe and reserved for you. Try again later to collect it."*
3. Show that receipt as **"partially withdrawn"** in their portfolio, with the outstanding amount, so
   they can find it again without remembering.
4. Optionally, check on load and prompt them.

The reads you need are already in the SDK: `vaultRedeemRemaining`, and `collected` on the receipt.

### Rule B — keeping long-held positions alive

**What happens now.** Stellar deletes stored data that nobody touches for long enough. A user who
deposits and then does nothing for months could have their record archived. Four functions exist to
prevent this, and they are free to call and safe for anyone to call.

**What is missing.** Nothing calls them.

**What to decide.** When the app calls them.

**Suggested rule:** call `bumpAll(wallet)` when a user opens their portfolio, but no more than once
per session. That is one cheap transaction, it covers every position type they could hold, and
anyone who looks at their money every few months stays safe automatically.

For users who never log in at all, run a small scheduled job that calls the bumps for known holders —
the calls are permissionless, so it can be done on their behalf without their key.

The SDK exposes `bumpAll(wallet)`, plus `bumpSrHolder`, `bumpYieldHolder`, `bumpLpPosition` and
`bumpVaultReceipt` individually.

---

## Suggested order

1. **Decide the deposit cap (#1).** It is the only one blocking launch. Start low; raising it is one
   transaction.
2. **Set the liquidity alarm (#2)** — warn at 2× coverage, critical at 1×, unless you have a reason
   to differ.
3. **Confirm `scalar_root` (#3)** — most likely "keep 40", but now on evidence.
4. **Write the two app rules (#5)** while the contracts are being deployed.
5. **Lock the old v1 issuer (#4)** whenever convenient.

## And one thing that is not on this list but should be

**Move the admin keys to a multisig.** Everything above assumes an admin exists and can act. Item #1
in particular depends on it: if a rate dip freezes withdrawals and the admin key is lost, users'
money is stuck permanently. That is the largest remaining operational risk, and it is not a decision
so much as a chore.
