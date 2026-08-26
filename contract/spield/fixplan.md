# fixplan.md — closed

**This document existed to answer one question: "does building v2 fix v1's issues, and which path do
we take?" The question is settled, so what follows is the closure record rather than the
deliberation.** The full deliberation is preserved in `fixplan.md.bak.20260827` if it is ever needed
for an audit trail; otherwise this file can be deleted.

Closed **2026-08-27**.

---

## The answer

**No — v2 could never fix v1.** The defects were in deployed bytecode on Stellar mainnet, and only
an upgrade or retirement changes that. Building better contracts elsewhere does not rewire a live
one.

**And it did not need to.** v1 was deployed 2026-06-08 unseeded and never used. Re-verified on chain
2026-08-27:

```
SPLDPT   holders=1  total_supply=0.0
SPLDYT   holders=1  total_supply=0.0
issuer transactions: 7, all on deploy day, none since
```

Both `market.add_liquidity` and `vault.seed` were permissionless, so this genuinely needed checking
rather than assuming. Nobody wandered in.

## The path taken

**Path A — mothball v1, ship v2 for the next term.** Not by decision so much as by arithmetic: the
live series matures **2026-09-06 19:28 UTC** with zero TVL, closing every v1-specific item at zero
cost and with no migration, because there is nobody to migrate.

The two alternatives were rejected on measurement, not preference. Fixing v1 in place would have
shipped an architecture already measured at **3× worse YT round-trip cost** (40.5% vs 13.3%) and
**~7× more LP capital** to open the same market — and would first have required reconciling source
against four deployed binaries that differed from it.

## What followed us into v2, and where it went

Six items were not v1-specific. All six are now closed; details in
[`V2_WORK.md`](./V2_WORK.md) and [`tofix.md`](./tofix.md).

| # | Followed because | Outcome |
|---|---|---|
| **3** | `contracts/strategy` is shared unchanged | Cap enforced on chain. **Its description was wrong twice and is now corrected** — a dip freezes exits, recovery is admin-gated, the loss is pro-rata. The number is the one thing still open. |
| **20** | Same Blend dependency | `Sr::redeem_partial` + resumable `srvault::redeem`; `available_liquidity` now computes the real utilization cap, with the residual measured at 0 bps |
| **22** | The vault product was ported | `sweep_surplus` recovers SR/YT/USDC, expiry-gated |
| **23** | The watchtower had a second stack to cover | Six probes, runs from its own package, all invariants holding |
| **26** | The AMM was ported | Both surviving LP defects fixed |
| **30** | The SDK had a new surface | TTL bumps, full `srvault` client, `pnpm run test:unit` working |

## The one v1 item that survives

**The old mainnet PT issuer is still unlocked** and can mint SPLDPT indefinitely — that capability
does not expire when the series does. It is **P2**, not P1: `redeem_pt_bearer` was never deployed to
mainnet, so counterfeit PT has no drain path into the pool. The residual is reputational — someone
could sell SPLDPT to a buyer who recognises the name.

One irreversible mainnet action closes it. Tracked as item 13 in `tofix.md`.

## What is still required before v2 carries money

Neither is a contract fix, and both were open before this work started:

1. **Rotate the admin keys to a multisig.** Every contract is still a single hot key. This is the
   largest untreated operational risk, and item 3 makes it sharper: clearing a rate-dip freeze is an
   admin action, so a lost key means nobody can exit.
2. **Get an audit.** `AUDITPREP.md` is preparation, not assurance.

## The lesson worth carrying

Three separate times this round, a **green test turned out not to test its own subject** — a mock
that skipped the call it was named for, a pool that never traded, a test pointed at the wrong
function. Each hid a live defect, and one propagated a false claim into the user-facing risk
disclosure.

The standing rule is recorded in `tofix.md` under *Testing standard*: a test that claims an item is
closed must reproduce that item's actual preconditions.
