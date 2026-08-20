# Spield v2 — Mainnet Deployment Guide

Everything needed to deploy the Spield contracts to **Stellar mainnet (Public network)** against the
**real Blend FixedV2 pool** and **real Circle USDC**. The contracts are network-agnostic — the same
WASMs that passed every test and ran on testnet are deployed here unchanged; only the addresses, the
network passphrase, and the safety guards differ.

> ⚠️ **This spends real XLM and real USDC.** Read this whole file before running
> [`scripts/deploy_mainnet.sh`](scripts/deploy_mainnet.sh). The script pauses for an explicit
> `deploy mainnet` confirmation before doing anything irreversible.

---

## 1. Verified mainnet addresses

All verified on-chain via the Stellar CLI (mainnet RPC) on 2026-06-08.

### The yield source — Blend

| What | Address | Notes |
| --- | --- | --- |
| **Blend FixedV2 pool** ✅ *(use this)* | `CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD` | Active. Reserves = **XLM / USDC / EURC only** (deep, blue-chip). USDC reserve enabled, 7 dec, `b_rate≈1.124`, ~43.5M USDC supplied, ~80% utilization. |
| ~~Blend YieldBloxV2 pool~~ ❌ *(do NOT use)* | `CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS` | **The pool drained ~$10.8M in Feb 2026** via oracle manipulation on a thin asset (USTRY $1.06→$107). Lists 8 reserves incl. a thin long tail. Avoid. |
| Blend Pool Factory v2 | `CDSYOAVXFY7SM5S64IZPPPYB4GVGGLMQVFREPSQQEZVIWXX5R23G4QSU` | For reference / verifying a pool with `is_pool`. |
| Blend Backstop v2 | `CAQQR5SWBXKIGZKPBZDH3KM5GQ5GUTPKB7JAFCINLZBC5WXPJKRG3IM7` | Reference. |
| BLND token (Soroban) | `CD25MNVTZDL4Y3XBCPCJXGXATV5WUHHOWMYFF4YBEGU5FCPGMYTVG5JY` | Reference. |

**Why FixedV2 and not YieldBloxV2:** after the Feb 2026 exploit, the only safe yield source is a pool
with no thin-liquidity assets to manipulate. FixedV2 carries only XLM/USDC/EURC with deep liquidity
and immutable parameters. Spield only *supplies* USDC (never borrows), so its direct oracle exposure
is low — but a drained host pool would still threaten backing, so pool choice is the #1 safety lever.

### The underlying — Circle USDC

| What | Address |
| --- | --- |
| **USDC SAC (Soroban contract id)** — what the contracts use | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` |
| USDC classic asset — for trustlines / sending USDC | `USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |
| Circle USDC issuer (G-address) | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |

The SAC was derived deterministically from Circle's official issuer with
`stellar contract id asset --asset USDC:GA5ZS… --network-passphrase "Public Global Stellar Network ; September 2015"`,
cross-checked against Blend's `mainnet.contracts.json`, and confirmed live: `decimals()` returns **7**
(your `initialize` asserts `EXPECTED_UNDERLYING_DECIMALS = 7` and would panic with `UnexpectedDecimals=11`
otherwise).

### Network

| | Value |
| --- | --- |
| Network passphrase | `Public Global Stellar Network ; September 2015` |
| Soroban RPC (used by the script) | `https://mainnet.sorobanrpc.com` |
| Horizon (balances) | `https://horizon.stellar.org` |
| Explorer | `https://stellar.expert/explorer/public` |

---

## 2. Accounts to use for the mainnet deployment

Mirroring the testnet split, mainnet uses **two dedicated identities** (already created in the WSL
Stellar CLI — their secret keys live only on this machine):

| Identity | Mainnet address | Role | Holds |
| --- | --- | --- | --- |
| **`spield_deployer`** | `GCRBHHWXSJQHOG6A34MYPVQMQB3J5GOP572TR3YLKB4OBBQHFQG24SFS` | Deploys all 4 contracts; becomes the initial admin of each (rotate to multisig immediately after); seeds the vault/market. | **XLM + USDC** |
| **`spield_issuer_mainnet`** | `GA4R5M7ZWOQZWIYCW246YC5WJ4QHT3H74CAUSTCEUUWIELCWI7IP3MKB` | **Dedicated PT/YT asset issuer** — issues the SPLDPT/SPLDYT classic assets, then hands SAC admin to the wrapper and does nothing more. | **XLM only** |

> **Why two accounts (the testnet gotcha that bit us):** a Stellar asset's *issuer account can't hold
> its own asset* ("operation invalid on issuer"). So PT/YT must be issued by `spield_issuer_mainnet`,
> separate from `spield_deployer` (which holds PT when it seeds the market). Do **not** collapse them.

> **The initial admin is `spield_deployer` (a single hot key).** It's the admin of all four contracts
> at deploy time (bound atomically by each `__constructor`, so the deploy→init window can't be
> front-run).

### Can `spield_deployer` just stay the admin? Yes.

A single-key admin runs the protocol **identically** — rotation is a security-posture choice, not a
functional requirement, and **skipping it causes no operational issues**. What the admin can/can't do:

- **Can:** pause, set rate/fee within ceilings, schedule *timelocked* upgrades, widen the rate bound,
  rotate the admin.
- **Cannot:** steal user funds, mint unbacked PT/YT, drain reserves, or bypass the upgrade timelock —
  those paths don't exist (solvency is asserted by construction; upgrades give users a 24h exit window).

So the only thing rotation buys is **resilience to key compromise**: if the single hot key leaks, an
attacker gains those admin powers (worst case: schedule a malicious upgrade — still 24h-delayed).

**Recommendation:** keeping `spield_deployer` as admin is fine for an early / low-TVL launch **if you
keep its secret offline / hardware-backed**. Rotate to a multisig (§6.1) before meaningful TVL. It's a
"do it as you grow," never a blocker. (We can set up the multisig together when you're ready.)

---

## 3. How much XLM to fund each account

Stellar mainnet costs come from three places: the **base reserve** (0.5 XLM locked per ledger entry —
the account itself = 1 XLM minimum, each trustline = +0.5 XLM, each extra signer = +0.5 XLM), the
**per-transaction base fee** (negligible, ~0.00001 XLM), and **Soroban resource fees** for contract
*installs/deploys/invokes* (the real cost — install of a WASM and a contract deploy each run on the
order of a few XLM in resource + rent fees on mainnet).

Recommended funding (comfortable headroom; you will not spend most of it — reserves are *locked*, not
burned, and unused XLM stays in the account):

| Account | Fund with | What it covers |
| --- | --- | --- |
| **`spield_deployer`** | **≈ 120 XLM** | 4 WASM installs + 4 contract deploys + ~10 init/admin invokes (Soroban resource + rent fees, the dominant cost), 2 PT/YT trustlines (1 XLM locked), account base reserve, and headroom for the post-deploy admin-rotation + code_hash invokes. |
| **`spield_issuer_mainnet`** | **≈ 15 XLM** | Account base reserve, 2 classic-asset issuances (change-trust + SAC deploy), 2 `set_admin` invokes. It does very little — but keep a buffer for the SAC deploys. |

Rules of thumb:
- These figures are **deliberately generous** (≈3–4× a likely actual spend) so a fee spike or a
  re-run never strands you mid-deploy. A bare-minimum run is closer to ~30 XLM deployer / ~5 XLM issuer.
- **Reserves are locked, not spent** — if you later merge/retire an account you reclaim them.
- Add **more XLM separately if you set `MARKET_SEED_AMOUNT` > 0**: seeding the market mints PT and
  adds liquidity (extra invokes ≈ a few XLM), and the AMM also wants XLM headroom for the PT
  trustline already counted above.

### USDC funding (separate from XLM) — and you can deploy with ZERO USDC

**You do not need any USDC to deploy + initialize the whole protocol.** Deploy and all four
`initialize` calls are pure config writes paid only in **XLM**. The *only* steps that touch USDC are
the optional seeds (`vault.seed`, `market.add_liquidity`), and the script **defaults both to 0** — so
a first run stands up all 4 live contracts spending no USDC at all. The vault just launches with 0
coupon capacity and the AMM pool empty; you seed them later when funded. **XLM is never used for
seeding** — it only ever pays deploy/init/admin transaction + resource fees.

When you *do* want to seed, that's **USDC**, and only on `spield_deployer`:

- **Vault seed** (`VAULT_SEED_AMOUNT`): real USDC the vault supplies to Blend as launch coupon
  capacity. Default in the script is **0** (seed manually after verifying the wiring).
- **Market seed** (`MARKET_SEED_AMOUNT`): needs **~2×** the per-side amount in USDC (one part minted
  into PT, one part as the pool's USDC). Default **0**.
- Send USDC to `spield_deployer` using the classic asset
  `USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`. `spield_deployer` needs a **USDC
  trustline** first (add it before sending, or the payment bounces).

> Decide your launch liquidity, then fund USDC accordingly — e.g. for a 100 USDC vault seed + a
> 100-USDC-per-side market, fund `spield_deployer` with ~300 USDC (100 vault + 200 market) plus a
> buffer. Start small on the first mainnet launch.

---

## 4. Funding the accounts (commands)

All commands run through WSL (Stellar CLI 26.x). Fund the two G-addresses from your exchange / an
existing mainnet account, then add `spield_deployer`'s USDC trustline:

```bash
# (From whatever account holds your XLM/USDC — or send from an exchange to these addresses.)
# 1) Send XLM:  ~120 XLM -> GCRBHHWX...  (deployer)   |   ~15 XLM -> GA4R5M7Z...  (issuer)
# 2) Add a USDC trustline on the deployer so it can receive + spend USDC:
wsl -e bash -lic "stellar tx new change-trust \
  --source-account spield_deployer \
  --network-passphrase 'Public Global Stellar Network ; September 2015' \
  --rpc-url https://mainnet.sorobanrpc.com \
  --line USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
# 3) Send the USDC you want to seed with -> GCRBHHWX... (deployer).
```

Check balances any time:
```bash
curl -s 'https://horizon.stellar.org/accounts/GCRBHHWXSJQHOG6A34MYPVQMQB3J5GOP572TR3YLKB4OBBQHFQG24SFS' \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);[print(b.get("asset_code","XLM"),"=",b["balance"]) for b in d["balances"]]'
```

---

## 5. Deploy

```bash
wsl -e bash -lic "cd '/mnt/f/Projects Tech/My own thoughts/spield_revamped/v1/contract/spield' && bash scripts/deploy_mainnet.sh"
```

The script (faithful mainnet twin of `deploy_testnet.sh`):
1. Builds + **optimizes** the WASMs (`stellar contract build --optimize` → runs `wasm-opt`, on top of
   the already-aggressive release profile: `opt-level="z"`, `lto`, `strip`, `panic="abort"`). Smaller
   binaries ⇒ lower mainnet install/rent fees. Behaviour is identical, but the optimized **code hash
   differs from the testnet deployment** (which used a plain build) — expected, mainnet is a fresh deploy.
2. Deploys the **wrapper** (admin = `spield_deployer`, bound atomically at deploy).
3. Issues **PT/YT** classic assets via `spield_issuer_mainnet`, wraps them as SACs, hands SAC admin
   to the wrapper; adds the deployer's PT/YT trustlines.
4. Deploys + initializes the **Blend strategy** (→ FixedV2 pool + Circle USDC, `max_apr_bps=30000`).
5. Initializes the **wrapper** (strategy + PT + YT + maturity, default +90d).
6. Deploys + initializes the **Fixed-Rate Vault** (5% APR, 20% ceiling); seeds only if
   `VAULT_SEED_AMOUNT>0` (default 0).
7. Deploys + initializes the **Market** (0.30% fee, par anchor); seeds only if
   `MARKET_SEED_AMOUNT>0` (default 0).
8. Prints all contract IDs + the frontend env block.

Tunable env vars (all optional): `SOURCE`, `ISSUER`, `MATURITY_DAYS`, `MAX_APR_BPS`, `VAULT_RATE_BPS`,
`VAULT_MAX_RATE_BPS`, `VAULT_SEED_AMOUNT`, `MARKET_*`, `RPC_URL`, `YES=1` (skip the confirmation),
`STATE_FILE=<path>` (custom checkpoint file), `FRESH=1` (ignore + overwrite existing state, start over),
`REDEPLOY=market[,vault]` (replace one contract in place — see below).

### The issuer lockdown (step 3c) — read before your first mainnet run

Handing SAC admin to the wrapper governs the **contract** path to mint/burn. It does nothing to the
**classic** path: the PT/YT issuer account could still create PT with an ordinary Stellar payment,
bypassing the wrapper and the deposit that is supposed to back it. Step **[3c]** closes that by
setting the issuer's master key weight to 0 — after which, per Stellar's docs, it *"cannot be used
to sign transactions, even for operations with a threshold value of 0."*

This matters more now than it used to: `redeem_pt_bearer` redeems PT **by token balance**, so
counterfeit PT would be paid out in real USDC. The lockdown is the only thing preventing that.

The script will not lock blind. It refuses unless:

* `pt.admin()` and `yt.admin()` both read back as the wrapper — locking while the issuer is still
  admin would make PT/YT **permanently unmintable** and brick the deployment; and
* the issuer has **no other signer** (read from Horizon) — one would leave it able to sign anyway.
  If Horizon cannot be reached, it refuses rather than assuming a safe state.

Afterwards, and on every later run, it re-reads the account and aborts the deploy if any signer has
weight > 0. Look for the line:

```
    ✓ VERIFIED on chain: the issuer has no signer with weight > 0 — it can never sign
```

**No auth flags are set, and that is deliberate.** `--set-required` would make the issuer authorize
every new trustline — impossible once locked, so nobody could ever hold PT/YT again.
`--set-clawback-enabled` / `--set-revocable` grant powers over holder balances Spield does not want.
`--set-immutable` is redundant: a key that cannot sign cannot change its own flags.

⚠️ **Irreversible, and it burns the issuer identity.** A future `FRESH=1` deployment needs a
brand-new issuer account: the old one can no longer sign `asset deploy` or `set_admin`, and its SAC
addresses are deterministic and permanently admined by the old wrapper. Rehearse on testnet first
(`LOCK_ISSUER=0` skips it while iterating; never use that on mainnet).

### Replacing ONE contract after a code/ABI change

**Do not reach for `FRESH=1` for this.** `FRESH=1` deletes the state file, so it redeploys the
wrapper, strategy, vault *and* market, re-creates both PT/YT SACs, re-hands SAC admin and recomputes
the maturity — every address changes. That is only correct for a brand-new deployment.

```bash
REDEPLOY=market bash scripts/deploy_mainnet.sh
```

This keeps every existing address, the PT/YT SACs and the pinned `SAVED_MATURITY`, forgets just that
component's checkpoints (backing the state file up first), and re-runs only its deploy + initialize.
Only leaf contracts are accepted — `REDEPLOY=wrapper` and `REDEPLOY=strategy` are **refused**,
because SAC admin already belongs to the current wrapper and the wrapper's one-shot `initialize()`
pins the strategy, so neither can be swapped in isolation.

The old contract stays live on chain; it just stops being the one this deployment points at.
**Withdraw any liquidity or positions from it first.**

After the market is (re)deployed the script **reads its views back from chain** and asserts
`market.wrapper()`, `market.maturity()` and `market.pt_token()` match the wrapper — on every run, not
only on a redeploy. A stale or mis-paired market fails the deploy with the exact remediation command
rather than being seeded by mistake.

### Resumable — what happens if it stops midway (e.g. out of XLM)

The script is **checkpointed and safe to re-run**:

- Every contract address + step-complete marker is written to a **state file** the instant it's created
  (`scripts/deploy_mainnet.state` by default).
- **A stop wastes nothing.** Stellar charges only for transactions that *land on-chain*; a tx that
  fails for insufficient balance is rejected at submission and costs **zero**. So a mid-way stop only
  "spent" the (tiny) fees on the steps that actually succeeded — never a large wasted fee.
- **To recover: top up XLM and run the exact same command again.** It reloads the state file, **skips
  every completed step** (deploys, SAC creation, admin handoffs, trustlines, inits, seeds — each
  guarded individually), and continues from the first incomplete step. It will **not** redeploy or
  re-`initialize` anything already done (a second `initialize` would panic `AlreadyInitialized`, so
  skipping is essential — the script handles this for you).
- The shared **maturity** is pinned in the state on the first run and reused on every resume, so all
  four contracts always agree on it.
- When everything is done it records `DEPLOY_COMPLETE`; a further re-run just reprints the addresses
  and exits without touching the chain.
- To start a **brand-new** deployment, run with `FRESH=1` (or delete the state file). Keep the state
  file after a successful deploy — it's your record of the deployed addresses. To replace a *single*
  contract without disturbing the rest, use `REDEPLOY=…` (above), never `FRESH=1`.

> ✅ This resume logic was tested end-to-end with a simulated mid-run XLM exhaustion: the state file
> captured exactly the completed steps, and a re-run skipped them and finished the rest cleanly.

---

## 6. After deploy — hardening (recommended; none are required to operate)

1. **Rotate every admin to a multisig** — *recommended for real TVL, optional otherwise* (see "Can
   `spield_deployer` just stay the admin?" above). Two-step; the new key must accept. Repeat for **all
   four** contracts — wrapper, strategy, vault, market:
   ```bash
   # current admin (spield_deployer) proposes:
   stellar contract invoke --id <CONTRACT> --source-account spield_deployer \
     --network-passphrase "Public Global Stellar Network ; September 2015" --rpc-url https://mainnet.sorobanrpc.com \
     -- propose_admin --new_admin <MULTISIG_ADDR>
   # the NEW admin (multisig) signs accept_admin:
   stellar contract invoke --id <CONTRACT> --source-account <MULTISIG_SIGNER> \
     --network-passphrase "Public Global Stellar Network ; September 2015" --rpc-url https://mainnet.sorobanrpc.com \
     -- accept_admin
   ```
2. **Verify the live code hashes** match what you built (compare to `stellar contract install --wasm <f>`):
   ```bash
   stellar contract invoke --id <each> ... -- code_hash
   ```
3. **Start the off-chain solvency monitor** (pages if backing < principal; pure reads, costs nothing):
   ```bash
   node scripts/solvency_monitor.mjs --wrapper <WRAPPER> --rpc https://mainnet.sorobanrpc.com --interval 60
   ```
4. Upgrades are **timelocked** (default 24h, bounded 1h–30d): `schedule_upgrade` → wait the eta →
   `apply_upgrade` (or `cancel_upgrade`). Tune the exit window with `set_timelock`.
5. If Blend's real supply rate ever outpaces `max_apr_bps` and `current_rate` starts panicking, widen
   it with `set_max_apr_bps` (immediate, no redeploy — it only widens tolerance on a trusted rate).

---

## 7. Outstanding before a real public launch

- [ ] **Security audit** (hardening item #4 — still open; strongly advised given a $10.8M exploit hit
      the sibling Blend pool in Feb 2026).
- [ ] **Multisig** created and **all four admins rotated** to it (§6.1) — *recommended* for real TVL;
      the deployer can remain admin for an early launch if its key is kept offline. Capability built.
- [ ] Frontend made **env-driven** (testnet default + mainnet build target) — planned next.
- [ ] Sanity-check `max_apr_bps=30000` vs Blend FixedV2's real USDC supply APR (single-digit %; the
      default is a wide, safe ceiling).
- [ ] Decide real **maturity** (`MATURITY_DAYS`) and **launch liquidity** (vault + market seeds).
