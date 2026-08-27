# resolution.md — the five things still open, and how to close them

Everything that was a **code** problem is fixed and tested. What is left is five items that code
cannot decide. Four of them need a **number or a rule from you**; one needs a **single transaction**.

This document explains each in plain language: what the problem is, why it matters, how to decide,
and exactly what to run.

Written 2026-08-27. Cross-references: [`tofix.md`](./tofix.md), [`V2_WORK.md`](./V2_WORK.md).

| # | What is left | Decision | Status |
|---|---|---|---|
| [1](#1-the-deposit-cap--how-much-money-do-we-let-in) | The deposit cap | **100 USDC** | ✅ **applied on chain** |
| [2](#2-the-liquidity-alarm--when-should-the-monitor-shout) | The liquidity alarm | **warn 5×, critical 3×** | ✅ **shipped and verified** |
| [3](#3-scalar_root--how-much-should-one-trade-move-our-advertised-rate) | `scalar_root` | **keep 40** | ✅ **confirmed, no change** |
| [4](#4-the-old-v1-token-issuer--lock-it-and-forget-it) | Lock the old v1 issuer | lock it | ⛔ **blocked — key not on this machine** |
| [5](#5-two-app-rules--when-does-the-front-end-do-the-thing) | Two app rules | as suggested | ✅ **both shipped** |

**Decided and applied 2026-08-27.** What each decision was, and what it took to apply it, is recorded
under each item below. One item is blocked on something only you can supply — see #4.

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

### ✅ Decided and applied — 100 USDC

Set on the live testnet SR contract on 2026-08-27, and made the default in
`scripts/deploy_sr_testnet.sh` so a future deployment cannot silently go back to unlimited:

```
deposit_cap        1000000000     (= 100.0000000 USDC)
total_assets      34462732696     (= 3446.27 USDC, deposited before the cap existed)
deposit_headroom            0
```

**Note the consequence on testnet:** the cap is *below* what is already deposited there, so
`deposit_headroom` is 0 and the testnet stack accepts no further deposits. That is correct
behaviour, not a bug — but if you want to keep testing deposits, raise the testnet cap while
leaving the deploy default at 100 for mainnet:

```bash
stellar contract invoke --id CDL44OYHVIZQSQZOPC7P5YWCKPWYAI7LYT62RROKOSVIXFU43YOJ7IF2 \
  --source-account alice425 --network testnet -- set_deposit_cap --cap 0
```

### Verified on the live contract, not just in tests

The property that makes a low cap safe is that it can never trap anyone. Checked directly:

```
new deposit    -> Error(Contract, #107)  DepositCapExceeded      ✓ blocked
withdrawal     -> simulates fine, 343040346 SR -> 362232021 USDC ✓ unaffected
```

So the worst a low cap can do is turn away new money. Raising it later is one transaction.

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

### ✅ Decided and shipped — warn at 5×, critical at 3×

`scripts/sr_solvency_monitor.mjs` no longer triggers on raw utilization. It computes what Blend can
actually pay — `min(cash on hand, supplied − borrowed / max_util)` — and divides by what we have
deposited.

Two bugs were fixed in the same pass:

* The old code divided **share counts** (`d_supply / b_supply`) rather than underlying amounts. Those
  are only approximately the utilization, because the two rates differ.
* It used the pool's cash balance as the payout capacity, which ignores the utilization ceiling and
  overstated it by 12.8% on this pool.

The coverage now prints on every run, healthy or not, so the trend is visible before it crosses:

```
… treasury=2344495 | exit_coverage=9.70x (blend_util=70.3%)
  ✓ all six invariants hold
```

**Both thresholds were verified by moving them past the live reading:**

```
--cover-warn 15      ⚠ EXIT LIQUIDITY LOW: coverage 9.70x (Blend can pay 33456.99, we hold 3446.27) …
--cover-critical 12  ✗ EXIT LIQUIDITY CRITICAL: … Pause deposits and tell holders …
```

Defaults are `--cover-warn 5 --cover-critical 3`; both are overridable per-run.

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

### ✅ Decided — keep 40, unchanged

No code change. It sits mid-range: a 1% trade moves the headline 5 bps (invisible), a 5% trade
28 bps, and it takes a quarter of the pool to move it 1.4%. That is responsive without being
twitchy.

Recorded here rather than left implicit, because "we kept the default" and "we chose 40 after
measuring" look identical in the code and are very different claims to make to an auditor.

**Revisit if** the seed ends up much smaller than 500k a side, since every trade is then a larger
share of the pool and the same table shifts left. Seeding more is the better lever — it reduces
impact without flattening the curve.

`scalar_root` is set when the market is initialized (`scripts/deploy_sr_testnet.sh`, in SCALAR_12
fixed point, so 40 → `40000000000000`). Changing it later means deploying a new market.

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

### ⛔ Blocked — the key is not on this machine

The fix is to lock the account so nothing can ever sign for it again:

```bash
stellar tx new set-options \
  --source-account spield_issuer_mainnet --network public \
  --master-weight 0
```

**I could not run this.** `deploy_mainnet.sh` names the issuer key `spield_issuer_mainnet`, and that
identity is not in this machine's keystore — the only issuer keys present are
`spield_sr_issuer{,2,3,4}`, which are the **v2 testnet** ones. Every local identity was checked
against the on-chain address `GA4R5M7ZWOQZ…` and none matched.

**What you need to do:**

1. Find the `spield_issuer_mainnet` secret — another machine, a password manager, or wherever the
   June deployment was run from.
2. Confirm it is the right account before signing:
   `stellar keys public-key spield_issuer_mainnet` should print
   `GA4R5M7ZWOQZWIYCW246YC5WJ4QHT3H74CAUSTCEUUWIELCWI7IP3MKB`.
3. Run the command above.

**This is permanent.** Once done that account can never issue anything again — which is the point,
but it also means the identity is spent. You would not want to reuse it.

If the key is genuinely lost, the situation is unchanged from today: nobody can lock it, but nobody
else can mint with it either, so the practical risk drops to whoever might still hold a copy.

### How to check it worked

```bash
curl -s "https://horizon.stellar.org/accounts/GA4R5M7ZWOQZWIYCW246YC5WJ4QHT3H74CAUSTCEUUWIELCWI7IP3MKB" \
  | python3 -c "import json,sys; [print(s['key'][:12]+'…', 'weight', s['weight']) for s in json.load(sys.stdin)['signers']]"
```

Every signer should read **weight 0**.

### When to do it

Any time. It is not urgent and it does not block anything — but it never gets easier, and the risk
never goes away on its own.

## 5. Two app rules — when does the front end do the thing?

Both are cases where the code was finished and only the trigger was missing. **Both are now
shipped**, but Rule B is not implemented the way it was first proposed — the reason is below and
worth reading.

### ✅ Rule A — telling a user their withdrawal is unfinished

**Shipped.** A vault redemption can be partial: if the lending venue is short on cash it collects
what it can, banks the progress against the receipt, and returns *without paying out*. The
transaction succeeds and the money is safe — but less arrives than expected, and previously nothing
explained that.

What changed:

* `Receipt` carries `collected` end to end — contract → `v2adapters` → UI.
* New read `redeemRemaining(receiptId)`, and `ReceiptsPanel` calls it **after** every redeem rather
  than assuming success means completion.
* A fourth row state, `partial`, distinct from `redeemed`. The row keeps an amber ring, is labelled
  **"Partly withdrawn"**, the button becomes **"Collect rest"** and stays enabled, and the row shows:

  > **Partly withdrawn.** We could only collect $X of $Y right now — the lending pool is short on
  > available cash. The rest is safe and reserved for you. Redeem again later to collect the
  > remaining $Z.

* A receipt that arrives already part-collected **from a previous session** shows the same state, so
  a user who closes the tab and comes back still sees what happened.

### ✅ Rule B — keeping dormant positions alive

#### The problem

Stellar deletes stored data that nobody touches for long enough. It is called **archival**, and an
archived entry needs a special off-chain restore to get back — it is not lost forever, but a normal
user cannot recover from it and the app would simply fail to read their position.

Spield refreshes an entry's clock **every time it writes to it**. So an active user is never at
risk: every deposit, transfer, harvest or trade resets the timer on the entries it touches.

**The exposure is the user who deposits and then does nothing.** Nobody writes to their record, so
nothing refreshes it. Months later it can archive under them, having done nothing wrong.

Five kinds of entry are exposed. Four now have a function that can extend them without changing
anything, and all four are **permissionless** — anyone may call them for anyone, because they only
push the expiry date out and never touch balances or accounting:

| Entry | Bump function |
|---|---|
| SR balance | `sr::bump_holder(user)` |
| YT balance + interest record | `yield::bump_holder(user)` |
| LP shares | `srmarket::bump_lp(lp)` |
| Vault receipt | `srvault::bump_receipt(id)` |

PT needs nothing — it is an ordinary Stellar asset, so it lives in the classic ledger and is not
subject to archival at all.

#### Why the obvious fix does not work

The plan was `bumpAll(wallet)` when a user opens their portfolio. Building it surfaced two problems,
and the second is fatal:

**1. It would mean three wallet popups.** Soroban permits one contract call per transaction, so the
bumps cannot be combined. Three bumps = three transactions = **three signature prompts every time
someone opens their portfolio**. Users would learn to click through prompts without reading them,
which is worse than the problem being solved.

**2. It reaches the wrong people.** The users at risk are the ones who *never log in*. An on-login
bump helps exactly the users who were already safe, and does nothing for anyone else. It looks like
a fix and is not one.

#### What was built instead

**`scripts/ttl_keeper.mjs`** — a keeper that does the job from outside, on everyone's behalf.

Because the bumps are permissionless, one operator-funded account can refresh every holder's entries.
**The user signs nothing, pays nothing, and does not need to know it happened.** This covers the
dormant user *and* the active one, so it replaces the on-login idea rather than supplementing it.

It runs in four stages:

**1. Find the holders — from the chain, not from a list.**

The tempting shortcut is to have the front end record wallets it has seen. That reintroduces the
same flaw: a list built from visits only knows about people who visited.

So the keeper reads **contract events** instead, and pulls every account address out of them. Every
way an address can come to hold something — a transfer, a mint, a deposit, a liquidity add — emits
an event, so scanning them finds holders the front end has never seen. The scan is deliberately
broad: a false positive costs one call that does nothing, while a miss costs someone their position.

**2. Find the open receipts.** The vault has no owner index, so receipt ids are scanned in order and
the scan stops after five consecutive misses. Bounded by `--max-receipts` (default 256).

**3. Check what the deployed contracts can actually do.** Explained below — this was added after the
first real run.

**4. Submit the bumps, one at a time.** Each call is independent and a failure is logged and skipped
rather than aborting the run, since a bump cannot corrupt anything.

#### Two bugs found by running it, not by reading it

**The first version discovered zero holders.** The event scan started at an arbitrary point
(~100,000 ledgers back) and gave up on the first empty page. Both parts were wrong:

* The right starting point is **whatever the node still retains**, which `getHealth()` reports
  (`oldestLedger`). Starting earlier than that returns nothing, silently — no error.
* **An empty page is not the end of the results.** The RPC scans forward from the anchor and returns
  what it found within its own scan budget, so a page with no matching events *and a cursor* means
  "nothing yet, keep going". Stopping there is what produced the zero.

Fixed, the same scan finds 31 holders.

**The first real run then failed 62 of 96 calls**, all with `Error(WasmVm, MissingValue)`. Not a bug
in the keeper: `Sr::bump_holder` and `SrMarket::bump_lp` exist in source but **are not on the
deployed binaries yet**, because the v2 stack has not been redeployed since they were added.

The keeper now probes each function once at startup and reports it as one line:

```
  scanning events from ledger 4232879 to 4353838 (node retains 120959)
  discovered 31 holder address(es) and 3 open receipt(s)
  ⚠ not deployed on this network: sr, market — their bump entry points are missing from the
    live binaries. Redeploy to cover those entries; skipping them for now.
  34 call(s). Re-run without --dry-run to submit.
```

That is better than 62 identical errors in two ways: it says what to *do* about it, and a
partially-upgraded stack still gets everything it **can** have bumped instead of drowning the
working calls in noise.

#### Verified end to end

Run against live testnet:

* Discovery: **31 holder addresses, 3 open receipts** — 96 candidate calls.
* Real submission: **34 succeeded** — every `yield::bump_holder` and every `srvault::bump_receipt`,
  i.e. exactly the functions that exist on the deployed binaries.
* The other 62 are the two undeployed functions, now skipped with the warning above.

#### How to run it

```bash
cd website/contract/spield/scripts

npm run keeper:dry                      # preview — reads only, submits nothing
npm run keeper -- --source <KEY_NAME>   # submit, signing with a stellar CLI key
```

`--source` takes a CLI key name or an `S…` secret. Contract addresses default from
`deploy_sr_testnet.state`, and can be overridden with `--sr`, `--yield`, `--market`, `--vault`.
Other useful flags: `--rpc` / `--passphrase` for a different network, `--extra G…,G…` to add
addresses you know about from elsewhere, `--from-ledger N` to narrow the scan.

**Always dry-run first.** It shows exactly which calls would be made.

#### What actually runs it — and why not Vercel

A script nobody runs is not a fix. This was missing from the first version of this document.

**Vercel cannot run it**, for three separate reasons:

* The site is a **static Vite build**. After a deploy there is no process left alive — nothing exists
  to call a contract on a timer.
* `website/server/` is a **serverless function**. It only wakes when a request arrives and is killed
  when that request ends. It has no independent clock.
* Vercel Cron could poke a route in `server/`, but the **function timeout kills the job**. Vercel
  allows 60s by default and 300s at most; a full keeper pass is dozens of transactions, each waiting
  ~5s for confirmation — minutes, not seconds. It would time out partway through, every time, and
  silently do a fraction of the work.

**GitHub Actions runs it instead** — `.github/workflows/spield-keeper.yml`. A 6-hour job limit, a
real scheduler, and proper secret storage. The repo (`Suryashish/spield_protocol`) already exists,
so there is nothing new to host or pay for.

The workflow runs **weekly, Mondays at 04:15 UTC**, and can also be triggered by hand from the
Actions tab (with a `dry_run` box, ticked by default). It does two things in order:

1. **Solvency watchtower** — read-only, so the log always records what the chain looked like before
   anything was submitted. Marked `continue-on-error` on purpose: a solvency alarm must not stop the
   upkeep, since a frozen venue is exactly when keeping entries alive matters most. The run still
   goes red.
2. **TTL keeper** — the bumps.

A `concurrency` group prevents two runs overlapping, which would otherwise collide on the source
account's transaction sequence number.

**Setup is two entries**, under Settings → Secrets and variables → Actions:

| | Name | Value |
|---|---|---|
| Secret | `STELLAR_KEEPER_SECRET` | an `S…` seed for a funded account that pays the fees |
| Variable | `STELLAR_RPC`, `STELLAR_PASSPHRASE` | optional; both default to testnet |

**That key spends, so fund it with a little XLM and nothing else.** It never needs to hold or control
user funds — the bumps are permissionless, which is the whole reason a keeper can do this on
everyone's behalf.

Two related fixes went in while wiring this up:

* Both scripts now resolve `deploy_sr_testnet.state` **relative to the script file**, not the working
  directory. The monitor previously required `--state` explicitly, which worked by hand and failed in
  CI — caught by rehearsing the workflow's exact commands rather than assuming they would run.
* The keeper takes `--max-calls N` to cap submissions per run. Not needed on GitHub Actions, but it
  is what would make a chunked serverless approach possible if you ever wanted one.

**If you would rather keep everything on Vercel**, it is possible but it is real work: a cron route
in `server/` doing a bounded slice per invocation (`--max-calls`), plus progress stored somewhere —
you already have MongoDB there — so consecutive invocations resume rather than repeat. I have not
built that, because Actions solves it for free today.

#### How often, and what it costs

**Weekly is ample.** Entries are bumped to cover maturity plus a grace period, and the network's
maximum lifetime is months — the keeper is a safety net, not a heartbeat.

Each bump is one cheap transaction. Calls that find nothing do nothing — none of these can create an
entry — so running too often wastes a few fees and cannot cause harm. It is safe to run twice, safe
to run on a stack that is mid-upgrade, and safe to run when there is nothing to do.

#### What still needs doing

**Redeploy the v2 stack.** Until then the keeper covers YT balances, interest records and vault
receipts, but **not SR balances or LP shares** — and SR is the most exposed of all five, because it
has no maturity date bounding how long someone might sit dormant.

**If you also want a user-facing control**, the SDK exposes `bumpAll(wallet)` and each bump
individually. A manual "keep my position alive" button would be perfectly reasonable — the objection
was only ever to firing it automatically.

## Where this leaves things

**Four of five are done.** One is blocked on you.

| # | Outcome |
|---|---|
| 1 | Cap set to **100 USDC**, live on chain and defaulted in the deploy script. Verified that it blocks deposits and not withdrawals. |
| 2 | Alarm rewritten as a coverage ratio, **warn 5× / critical 3×**, both levels verified against the live pool. Two calculation bugs fixed in passing. |
| 3 | **`scalar_root` stays 40**, now on measured evidence rather than by default. |
| 4 | ⛔ **Blocked.** The `spield_issuer_mainnet` key is not on this machine. Find it and run one command. |
| 5 | Both rules shipped — partial-redemption UI, and a keeper that covers dormant holders without asking them to sign anything, **scheduled weekly via GitHub Actions** (Vercel cannot run it; see §5). |

### Still outstanding beyond this document

* **Redeploy the v2 stack.** Nothing from the last two rounds of contract work is on chain —
  including the two bump functions the keeper just reported missing. `strategy` must be upgraded in
  the same cycle as `sr` and `srvault`.
* **Move the admin keys to a multisig.** Item #1 assumes an admin can act: if a rate dip freezes
  withdrawals and that key is lost, users' money is stuck permanently. This remains the largest
  operational risk, and it is a chore rather than a decision.
* **Get an audit.**
