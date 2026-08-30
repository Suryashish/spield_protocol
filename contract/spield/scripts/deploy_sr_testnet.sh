#!/usr/bin/env bash
# =================================================================================================
# deploy_sr_testnet.sh — deploy the **SR stack** (sr + yield + srmarket) to Stellar testnet.
#
# This is the Pendle-shaped v2 stack from `srstack.md`. It is a SEPARATE deployment from
# `deploy_testnet.sh` (the v1 wrapper/vault/market) and writes its own state file, so both can
# coexist on testnet without clobbering each other.
#
#   USDC ──deposit──► SR ──mint_py──► PT (SAC) + YT (the yield contract itself)
#                      │                  │
#                      └──── PT/SR AMM ───┘
#
# ── What is different from the v1 script ─────────────────────────────────────────────────────────
#  * **Only PT is a SAC.** YT is a custom SEP-41 contract (the yield contract), because it needs a
#    transfer hook to settle interest — a SAC has none. So there is no YT asset, no YT trustline,
#    and no YT SAC admin hand-off. Half the classic-asset plumbing disappears.
#  * **The market discovers its own wiring.** `srmarket.initialize` takes only the yield contract
#    and reads pt/sr/expiry back from it, so the `tofix.md` #19 class of mismatch is not
#    expressible. There is nothing to cross-check by hand.
#  * **The order is inverted.** SR must exist before the strategy, because the strategy's
#    `initialize` binds the one contract allowed to call it — and that is SR, not a wrapper.
#
# ── Prerequisites ────────────────────────────────────────────────────────────────────────────────
#  * `stellar` CLI ≥ 22, `curl`, `python3`.
#  * A funded deployer identity (default `alice425`): `stellar keys generate alice425 --network testnet --fund`
#  * Test USDC on the deployer if you want to SEED. Deploy+initialize needs **zero** USDC.
#    Blend's testnet faucet: GET the pre-built XDR, sign it, submit it —
#      curl -s "https://ewqw4hx7oa.execute-api.us-east-1.amazonaws.com/getAssets?userId=$(stellar keys address alice425)" \
#        | tr -d '"' | stellar tx sign --sign-with-key alice425 --network testnet | stellar tx send --network testnet
#
# ── Usage ────────────────────────────────────────────────────────────────────────────────────────
#   ./scripts/deploy_sr_testnet.sh                 # deploy + initialize (resumable)
#   SEED=1 ./scripts/deploy_sr_testnet.sh          # ...and seed the pool (needs USDC)
#   FRESH=1 ./scripts/deploy_sr_testnet.sh         # brand-new deployment (new PT SAC ⇒ new ISSUER)
#   REDEPLOY=srmarket ./scripts/deploy_sr_testnet.sh   # replace only the market, keep everything else
#
# Every step is checkpointed to the state file, so a failed run resumes where it stopped.
# =================================================================================================
set -euo pipefail

# ─── Identities ──────────────────────────────────────────────────────────────────────────────────
SOURCE="${SOURCE:-alice425}"
NETWORK="${NETWORK:-testnet}"
# The PT issuer. A FRESH=1 run needs a NEW issuer if the old one was locked (see [7]).
ISSUER="${ISSUER:-spield_sr_issuer}"
# Where protocol revenue lands (yield fee + the treasury share of swap fees).
TREASURY_KEY="${TREASURY_KEY:-$SOURCE}"

TESTNET_PASSPHRASE="Test SDF Network ; September 2015"
RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
HORIZON_URL="${HORIZON_URL:-https://horizon-testnet.stellar.org}"
NET_ARGS=(--network "$NETWORK")

# ─── External dependencies (Blend testnet) ───────────────────────────────────────────────────────
BLEND_POOL="${BLEND_POOL:-CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF}"
USDC_SAC="${USDC_SAC:-CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU}"
USDC_ASSET="${USDC_ASSET:-USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56}"

# ─── Strategy parameters ─────────────────────────────────────────────────────────────────────────
# Defence-in-depth ceiling on b_rate growth (300% APR). Set generously above Blend's real max.
MAX_APR_BPS="${MAX_APR_BPS:-30000}"

# ─── Launch TVL cap (`tofix.md` #3) ──────────────────────────────────────────────────────────────
# #3 accepts a real residual — a deep Blend bad-debt event freezes every mutation, exits included —
# and mitigates it by bounding the worst case. The tracker specified that bound as an *operational*
# control; it is enforced on chain instead, because a cap that lives in a runbook is not a cap.
#
# 50 USDC = 500_000_000. Deliberately small for a guarded launch.
#
# This is a GLOBAL cap, not a vault cap: `sr::deposit` is the only path that mints SR, and every
# route in goes through it — vault depositors (`srvault::deposit` -> `acquire_py` -> `SrClient::
# deposit`), liquidity providers (LP needs PT+SR; PT is stripped from SR), and direct SR holders.
# So this one number bounds every USDC that can enter the protocol, LPs included.
#
# **It also counts the operator's own seeding.** `vault.seed` and the AMM seed both deposit through
# `sr::deposit`, so the working rule is:
#
#     cap = what you seed + what you will let users deposit
#
# `sr::deposit_headroom()` reports what is left. What it bounds is NOT operator loss: per
# V2_WORK.md §1 it is "the maximum depositor loss that can occur uncompensated, with recovery gated
# on your key" — a Blend bad-debt event freezes every mutation until an admin calls
# `strategy::reset_rate_floor`. At 50 USDC and a 20% planning haircut that is ~10 USDC.
#
# The cap gates DEPOSITS ONLY — verified on chain, a withdrawal still works when the cap sits below
# current TVL — so starting low can never trap anyone. Raising it is one `set_deposit_cap` call;
# LOWERING it below current TVL blocks all new deposits until TVL falls back under it.
SR_DEPOSIT_CAP="${SR_DEPOSIT_CAP:-500000000}"

# ─── Series parameters ───────────────────────────────────────────────────────────────────────────
# 30 days, not 90: a shorter series commits a smaller subsidy, runs a full lifecycle inside a month,
# and gives an earlier natural exit point. In Blend's worst rate state the vault drains ~0.212% of
# deposits per 30-day series vs ~0.635% at 90 days — a seed stretches 3x further. Fixed once
# deployed; it cannot be changed mid-series.
MATURITY_DAYS="${MATURITY_DAYS:-30}"
EXPIRY="${EXPIRY:-$(( $(date +%s) + MATURITY_DAYS*24*60*60 ))}"

# Protocol share of YT interest, in bps. Pendle takes 5%; the on-chain ceiling is 10%.
YIELD_FEE_BPS="${YIELD_FEE_BPS:-500}"

# ─── Market parameters ───────────────────────────────────────────────────────────────────────────
# Curve steepness — how hard a trade moves the quoted implied rate.
#
# 160, derived in V2_WORK.md §14 (measured, `srmarket/src/calibration_test.rs`). Sensitivity obeys
# `bps_move ~= 208 x trade_pct / scalar_root`, is SCALE-FREE (seed size does not enter) and
# TIME-INVARIANT (the years term cancels between price and APY), so one value serves every series
# and both networks. 160 keeps a 10%-of-pool trade inside the vault's own 12 bps calibration band
# (13.0 bps) and sits at the knee of the stability-vs-arbitrage trade-off: past it the `ln_fee_root`
# floor dominates round-trip cost, so extra flatness buys little.
#
# Was 40, where a 25% trade moved the quote 131 bps — a 3.00% headline to 1.69%, beside a vault
# quoting 3.00%.
MARKET_SCALAR_ROOT="${MARKET_SCALAR_ROOT:-160000000000000}"    # 160 * 1e12

# ANNUALIZED fee root, SCALAR_12: fee_rate = exp(ln_fee_root * years_to_expiry).
# 0.25%/yr, chosen from `calibrate_the_fee_root`: PT round trip 0.17%, YT round trip 13.3%
# (v1's flat 30 bps cost 0.60% / 40.5%). Contract ceiling is 5%/yr.
MARKET_LN_FEE_ROOT="${MARKET_LN_FEE_ROOT:-2500000000}"         # 0.0025 * 1e12

# ─── Fixed-Rate Vault ────────────────────────────────────────────────────────────────────────────
# The fixed APR the vault quotes. On TESTNET this is unavoidably a SUBSIDY: Blend's testnet USDC
# reserve pays ~0.2% (ir_mod sits near its 0.1 floor), so no honest fixed rate is fundable there and
# every coupon comes out of the seed. The number is kept aligned with mainnet's calibrated 300 bps
# so the demo shows the real product, and the calibration below runs in ADVISORY mode to say so out
# loud rather than pretending it passes. Never treat a testnet rate as evidence a rate is safe.
VAULT_RATE_BPS="${VAULT_RATE_BPS:-300}"                        # 3.00% fixed (demo; see note above)
VAULT_MAX_RATE_BPS="${VAULT_MAX_RATE_BPS:-2000}"               # 20% on-chain ceiling
VAULT_RATE_MARGIN_BPS="${VAULT_RATE_MARGIN_BPS:-2500}"         # calibration safety margin

# Opening implied APY as a SCALAR_12 fraction (3.00% = 0.03 * 1e12), derived from the vault rate
# above — the two headline numbers should not drift apart, and VAULT_RATE_BPS must therefore be
# defined BEFORE this line.
MARKET_APY_BPS="${MARKET_APY_BPS:-$VAULT_RATE_BPS}"
MARKET_INITIAL_APY="${MARKET_INITIAL_APY:-$(( MARKET_APY_BPS * 1000000000000 / 10000 ))}"

# Share of every swap fee routed to the treasury, in bps. 2000 = 20% protocol / 80% LP — the
# inverse of Pendle, which gives LPs only 20%. Contract ceiling is 5000 (50%).
MARKET_TREASURY_FEE_SHARE_BPS="${MARKET_TREASURY_FEE_SHARE_BPS:-2000}"

# ─── Seeding (only runs with SEED=1) ─────────────────────────────────────────────────────────────
# USDC (7 decimals) put into EACH side of the pool. The PT side is minted by stripping SR, so the
# deployer needs ≈ 2 x this much USDC in total.
SEED_PER_SIDE="${SEED_PER_SIDE:-50000000}"                     # 5 USDC per side by default

# ─── Fixed-Rate Vault ────────────────────────────────────────────────────────────────────────────
# USDC of PT coupon capacity to seed. The vault can only promise coupons out of SPARE inventory,
# so an unseeded vault quotes a rate but refuses every deposit.
VAULT_SEED_AMOUNT="${VAULT_SEED_AMOUNT:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="${STATE_FILE:-$SCRIPT_DIR/deploy_sr_testnet.state}"
[ "${FRESH:-0}" = "1" ] && rm -f "$STATE_FILE"

# ─── Selective redeploy ──────────────────────────────────────────────────────────────────────────
# srmarket is the only leaf that can be replaced alone. `yield` cannot: PT SAC admin was handed to
# the CURRENT yield contract and the issuer may be locked, so a replacement could never mint PT.
# `sr` cannot: the yield contract stores it in a one-shot initialize.
REDEPLOY="${REDEPLOY:-}"
if [ -n "$REDEPLOY" ]; then
  [ -f "$STATE_FILE" ] || { echo "ERROR: REDEPLOY needs an existing $STATE_FILE"; exit 1; }
  CLEAR_KEYS=""
  IFS=',' read -r -a PARTS <<< "$REDEPLOY"
  for p in "${PARTS[@]}"; do
    case "$p" in
      srmarket|market) CLEAR_KEYS="$CLEAR_KEYS SRMARKET SRMARKET_INIT POOL_SEEDED" ;;
      # The router is the one component that IS safely replaceable in isolation: it holds no funds,
      # has no privileges over anything, and derives its whole topology from the market at
      # `initialize`. Swapping it strands nothing.
      srrouter|router) CLEAR_KEYS="$CLEAR_KEYS SRROUTER SRROUTER_INIT" ;;
      srvault|vault) CLEAR_KEYS="$CLEAR_KEYS SRVAULT SRVAULT_INIT VAULT_SEEDED" ;;
      sr|yield) echo "ERROR: REDEPLOY=$p cannot work in isolation (see comment). Use FRESH=1."; exit 1 ;;
      *) echo "ERROR: unknown REDEPLOY component '$p'. Supported: srmarket, srrouter, srvault."; exit 1 ;;
    esac
  done
  CLEAR_KEYS="$CLEAR_KEYS DEPLOY_COMPLETE"
  cp "$STATE_FILE" "$STATE_FILE.bak.$(date +%Y%m%d-%H%M%S)"
  CLEAR_RE=$(echo $CLEAR_KEYS | tr ' ' '|')
  grep -Ev "^($CLEAR_RE)=" "$STATE_FILE" > "$STATE_FILE.tmp" || true
  mv "$STATE_FILE.tmp" "$STATE_FILE"
  echo "==> REDEPLOY=$REDEPLOY — cleared: $CLEAR_KEYS"
  echo "    ⚠ The old market stays live and KEEPS ITS RESERVES. Withdraw liquidity from it first."
  echo
fi

# Declared so `set -u` is happy before the state file is sourced.
SR=""; STRATEGY=""; YIELD=""; SRMARKET=""; SRVAULT=""; SRROUTER=""; PT_SAC=""
STRATEGY_INIT=""; SR_INIT=""; YIELD_INIT=""; SRMARKET_INIT=""; SRVAULT_INIT=""; VAULT_SEEDED=""
SRROUTER_INIT=""
PT_ADMIN_SET=""; PT_TRUSTLINE=""; POOL_SEEDED=""; ISSUER_LOCKED=""
SAVED_EXPIRY=""; DEPLOY_COMPLETE=""

if [ -f "$STATE_FILE" ]; then
  echo "==> Resuming from $STATE_FILE"
  # shellcheck disable=SC1090
  source "$STATE_FILE"
  [ -n "$SAVED_EXPIRY" ] && EXPIRY="$SAVED_EXPIRY"
fi

save_state() { printf '%s=%q\n' "$1" "$2" >> "$STATE_FILE"; printf -v "$1" '%s' "$2"; }

# Submit a state-changing invoke, retrying on the transient footprint failure.
#
# `strategy::current_rate` writes its RateBound only CONDITIONALLY (`if rate > last_rate || now >
# last_ts`) and also bumps its instance TTL. Whether a write happens therefore depends on how much
# time passed between simulation and execution, so a simulated footprint can record the entry
# read-only and then need it read-write at execution — the host rejects that with
# `storage: exceeded_limit / outside of the footprint`. Re-simulating fixes it.
# Observed repeatedly on testnet 2026-08-24.
invoke_retry() {  # invoke_retry <contract-id> <args...>
  local id="$1"; shift
  local n=0
  until stellar contract invoke --id "$id" --source-account "$SOURCE" "${NET_ARGS[@]}" --send=yes -- "$@" >/dev/null 2>&1; do
    n=$((n+1))
    if [ "$n" -ge 4 ]; then
      echo "ERROR: '$*' on $id failed after $n attempts." >&2
      return 1
    fi
    echo "    (retry $n after a transient footprint failure)" >&2
    sleep 3
  done
  return 0
}

# Read a no-arg view. Pure simulation, costs nothing. Empty on failure — callers must treat empty
# as "could not read", NEVER as a match.
read_view() {
  local out
  # Forward EVERY remaining argument, not just the function name. This used to pass only "$2", so
  # any view taking parameters was invoked bare — the CLI then failed on the missing argument, the
  # `|| return 0` swallowed it, and the caller saw empty output. `compat` reads empty as "the callee
  # is an older deployment", so a parameterised check reported a version skew that did not exist.
  # Only `router.quote_buy_pt_with_usdc` takes arguments today, which is why only it failed.
  out=$(stellar contract invoke --id "$1" --source-account "$SOURCE" "${NET_ARGS[@]}" -- "${@:2}" 2>/dev/null) || return 0
  printf '%s' "$out" | tr -d '"' | tr -d '[:space:]'
}

# Signers on the PT issuer that can still sign (weight > 0), as "KEY WEIGHT" lines.
# Prints the single token `UNKNOWN` if the account could not be inspected — callers MUST fail
# closed on that rather than assume a safe state.
issuer_live_signers() {
  local json n=0
  # Retry: the public Horizon intermittently returns nothing under load, and a dropped read is
  # indistinguishable from "cannot inspect". Since the caller FAILS CLOSED on UNKNOWN (correctly),
  # a transient blip would otherwise block a legitimate lockdown. Retry the read, never the guard.
  while [ "$n" -lt 5 ]; do
    json=$(curl -s --max-time 20 "$HORIZON_URL/accounts/$ISSUER_ADDR" 2>/dev/null) || true
    [ -n "$json" ] && break
    n=$((n+1)); sleep 3
  done
  if [ -z "$json" ] || ! command -v python3 >/dev/null 2>&1; then echo "UNKNOWN"; return 0; fi
  ISSUER_JSON="$json" python3 -c '
import json, os, sys
try:
    signers = json.loads(os.environ["ISSUER_JSON"])["signers"]
except Exception:
    print("UNKNOWN"); sys.exit(0)
for s in signers:
    if int(s.get("weight", 0)) > 0:
        print("%s %s" % (s.get("key", "?"), s.get("weight")))
' 2>/dev/null || echo "UNKNOWN"
}

# Fail loudly if a read-back does not match, instead of deploying on top of a broken wiring.
expect() {  # expect <label> <actual> <wanted>
  if [ "$2" != "$3" ]; then
    echo "ERROR: $1 mismatch"; echo "       got:    ${2:-<unreadable>}"; echo "       wanted: $3"; exit 1
  fi
  echo "    ✓ $1"
}

# Ensure the issuer identity exists and is funded (needed to issue PT).
if ! stellar keys address "$ISSUER" >/dev/null 2>&1; then
  echo "==> Creating + funding the PT issuer identity '$ISSUER'..."
  stellar keys generate "$ISSUER" --network "$NETWORK" --fund >/dev/null
fi

ADMIN_ADDR=$(stellar keys address "$SOURCE")
ISSUER_ADDR=$(stellar keys address "$ISSUER")
TREASURY_ADDR=$(stellar keys address "$TREASURY_KEY")
# Asset code is configurable: a FRESH redeploy needs a code/issuer pair whose SAC admin is not
# already bound to a previous yield contract.
PT_CODE="${PT_CODE:-SPLDPT2}"
PT_ASSET="$PT_CODE:$ISSUER_ADDR"

# ── Trust the RECORDED asset over the reconstructed one ──────────────────────────────────────────
#
# On a resumed run the deployment's real PT asset is whatever `PT_ASSET_ID` says, and that is not
# necessarily `$PT_CODE:$(stellar keys address $ISSUER)`. The lockdown **burns the issuer identity**,
# so `spield_sr_issuer` gets regenerated afterwards and the key name then resolves to a brand-new,
# unlocked account that never issued anything.
#
# Caught on 2026-08-25: a resume aborted with "the issuer is NOT locked" naming
# GDTM2UMJ… (weight 1) while the asset actually in use, SPLDPT5:GCCDH7PS…, was correctly locked
# (weight 0). The fail-closed behaviour was right; the account it was checking was not.
#
# This is the same defect class as `AUDITPREP.md` §4 item 3 — an asset identity reconstructed from
# parts instead of read from where it was recorded. Reconstruct only when there is nothing recorded.
if [ -n "${PT_ASSET_ID:-}" ]; then
  PT_ASSET="$PT_ASSET_ID"
  RECORDED_ISSUER="${PT_ASSET_ID#*:}"
  if [ "$RECORDED_ISSUER" != "$ISSUER_ADDR" ]; then
    echo "==> NOTE: using the RECORDED PT issuer $RECORDED_ISSUER"
    echo "          (the '$ISSUER' key now resolves to $ISSUER_ADDR — expected after a lockdown,"
    echo "           which burns the identity. The recorded asset is the one the contracts use.)"
    ISSUER_ADDR="$RECORDED_ISSUER"
  fi
  PT_CODE="${PT_ASSET_ID%%:*}"
fi

echo "==> Deployer ($SOURCE): $ADMIN_ADDR"
echo "==> PT issuer ($ISSUER): $ISSUER_ADDR"
echo "==> Treasury:            $TREASURY_ADDR"
echo "==> Blend pool:          $BLEND_POOL"
echo "==> USDC SAC:            $USDC_SAC"
echo "==> Expiry:              $EXPIRY (+${MATURITY_DAYS}d)"
echo "==> Fee root:            $MARKET_LN_FEE_ROOT (0.25%/yr)   Opening APY: ${MARKET_APY_BPS}bps"
echo "==> Yield fee:           ${YIELD_FEE_BPS}bps   Treasury swap share: ${MARKET_TREASURY_FEE_SHARE_BPS}bps"
echo "==> State file:          $STATE_FILE"
echo

if [ -n "$DEPLOY_COMPLETE" ]; then
  echo "==> Already completed. sr=$SR yield=$YIELD srmarket=$SRMARKET PT=$PT_SAC"
  echo "    (FRESH=1 for a brand-new deployment, REDEPLOY=srmarket to replace the market.)"
  exit 0
fi

[ -z "$SAVED_EXPIRY" ] && save_state SAVED_EXPIRY "$EXPIRY"
# Record the external dependencies too, so downstream tooling reads them from the deployment record
# rather than re-deriving them from its own defaults. The solvency monitor's Blend utilization probe
# (`tofix.md` #20) needs both, and a monitor pointed at the wrong pool is worse than no monitor.
save_state BLEND_POOL "$BLEND_POOL"
save_state USDC_SAC "$USDC_SAC"

# ─── [1/9] Build ─────────────────────────────────────────────────────────────────────────────────
echo "==> [1/9] Building + optimizing WASMs..."
stellar contract build --optimize >/dev/null
WASM_DIR="target/wasm32v1-none/release"
pick_wasm() { if [ -f "$1.optimized.wasm" ]; then echo "$1.optimized.wasm"; else echo "$1.wasm"; fi; }
SR_WASM=$(pick_wasm "$WASM_DIR/spield_sr")
STRAT_WASM=$(pick_wasm "$WASM_DIR/spield_strategy")
YIELD_WASM=$(pick_wasm "$WASM_DIR/spield_yield")
MARKET_WASM=$(pick_wasm "$WASM_DIR/spield_srmarket")
VAULT_WASM=$(pick_wasm "$WASM_DIR/spield_srvault")
ROUTER_WASM=$(pick_wasm "$WASM_DIR/spield_srrouter")
for f in "$SR_WASM" "$STRAT_WASM" "$YIELD_WASM" "$MARKET_WASM" "$VAULT_WASM"; do
  [ -f "$f" ] || { echo "ERROR: missing $f"; exit 1; }
done
echo "    sr=$(basename "$SR_WASM") strategy=$(basename "$STRAT_WASM") yield=$(basename "$YIELD_WASM") market=$(basename "$MARKET_WASM")"

# ─── [2/9] SR ────────────────────────────────────────────────────────────────────────────────────
# SR first: the strategy's initialize binds the one contract allowed to call it, and that is SR.
# The admin is bound ATOMICALLY by __constructor, so the deploy→initialize window cannot be
# front-run — only this admin can finish setup.
if [ -z "$SR" ]; then
  echo "==> [2/9] Deploying SR (Standardized Return)..."
  save_state SR "$(stellar contract deploy --wasm "$SR_WASM" --source-account "$SOURCE" "${NET_ARGS[@]}" -- --admin "$ADMIN_ADDR")"
  echo "    sr = $SR"
else echo "==> [2/9] SR already deployed ($SR) — skipping."; fi

# ─── [3/9] Strategy ──────────────────────────────────────────────────────────────────────────────
if [ -z "$STRATEGY" ]; then
  echo "==> [3/9] Deploying the Blend strategy adapter..."
  save_state STRATEGY "$(stellar contract deploy --wasm "$STRAT_WASM" --source-account "$SOURCE" "${NET_ARGS[@]}" -- --admin "$ADMIN_ADDR")"
  echo "    strategy = $STRATEGY"
else echo "==> [3/9] Strategy already deployed ($STRATEGY) — skipping."; fi

if [ -z "$STRATEGY_INIT" ]; then
  echo "    initializing strategy (caller=SR, pool=$BLEND_POOL)..."
  stellar contract invoke --id "$STRATEGY" --source-account "$SOURCE" "${NET_ARGS[@]}" --send=yes -- initialize \
    --wrapper "$SR" --pool "$BLEND_POOL" --underlying "$USDC_SAC" --max_apr_bps "$MAX_APR_BPS" >/dev/null
  save_state STRATEGY_INIT 1; echo "    ✓ strategy initialized"
else echo "    strategy already initialized — skipping."; fi

if [ -z "$SR_INIT" ]; then
  # Warm up the strategy's rate bound FIRST. The very first `current_rate()` call CREATES the
  # RateBound ledger entry; doing that create from inside SR's `initialize` makes the simulated
  # footprint disagree with execution and the transaction traps. Calling it directly here does the
  # create in its own transaction, so SR's init only ever updates an entry that already exists.
  # (Observed on testnet 2026-08-24 — the deploy failed exactly once, here, until this was added.)
  echo "    warming up the strategy rate bound (first current_rate creates its ledger entry)..."
  invoke_retry "$STRATEGY" current_rate
  echo "    initializing SR (discovers its underlying from the strategy)..."
  invoke_retry "$SR" initialize --strategy "$STRATEGY"
  save_state SR_INIT 1; echo "    ✓ SR initialized"
else echo "    SR already initialized — skipping."; fi

# Apply the TVL cap on every run, not just the first: it is the one parameter an operator is most
# likely to want to change between runs, and re-reading it from the environment each time makes the
# script the single source of truth for it.
if [ "${SR_DEPOSIT_CAP}" != "0" ]; then
  echo "    setting the launch TVL cap to $SR_DEPOSIT_CAP underlying base units..."
  invoke_retry "$SR" set_deposit_cap --cap "$SR_DEPOSIT_CAP"
  echo "    ✓ cap set (headroom now $(read_view "$SR" deposit_headroom))"
else
  echo "    ⚠ SR_DEPOSIT_CAP=0 — the wrapper is UNCAPPED. tofix.md #3 requires a cap before mainnet."
fi

# ─── [4/9] Yield contract (PT/YT engine + the YT token) ──────────────────────────────────────────
if [ -z "$YIELD" ]; then
  echo "==> [4/9] Deploying the yield contract (PT/YT engine; IS the YT token)..."
  save_state YIELD "$(stellar contract deploy --wasm "$YIELD_WASM" --source-account "$SOURCE" "${NET_ARGS[@]}" -- --admin "$ADMIN_ADDR" --treasury "$TREASURY_ADDR")"
  echo "    yield = $YIELD   (this address IS the YT token)"
else echo "==> [4/9] Yield contract already deployed ($YIELD) — skipping."; fi

# ─── [5/9] PT asset + SAC ────────────────────────────────────────────────────────────────────────
# ONLY PT is a classic asset here. YT is the yield contract itself, because it needs a transfer
# hook to settle interest and a SAC has none.
if [ -z "$PT_SAC" ]; then
  echo "==> [5/9] Creating the PT asset + SAC (issued by $ISSUER)..."
  stellar contract asset deploy --asset "$PT_ASSET" --source-account "$ISSUER" "${NET_ARGS[@]}" >/dev/null 2>&1 || true
  save_state PT_SAC "$(stellar contract id asset --asset "$PT_ASSET" "${NET_ARGS[@]}")"
  # Record the classic asset too — every consumer (tests, frontend, wallets) needs the exact
  # code:issuer pair to open a trustline, and guessing it is how you end up trusting the wrong one.
  save_state PT_ASSET_ID "$PT_ASSET"
  echo "    PT SAC = $PT_SAC"
else echo "==> [5/9] PT SAC already created ($PT_SAC) — skipping."; fi

if [ -z "$PT_ADMIN_SET" ]; then
  echo "    handing PT SAC admin to the yield contract..."
  stellar contract invoke --id "$PT_SAC" --source-account "$ISSUER" "${NET_ARGS[@]}" --send=yes -- set_admin --new_admin "$YIELD" >/dev/null
  save_state PT_ADMIN_SET 1; echo "    ✓ PT admin -> yield contract"
else echo "    PT admin already handed over — skipping."; fi

if [ -z "$PT_TRUSTLINE" ]; then
  echo "    adding the deployer's PT trustline (needed before PT can be minted to them)..."
  stellar tx new change-trust --source-account "$SOURCE" "${NET_ARGS[@]}" --line "$PT_ASSET" >/dev/null 2>&1 || true
  save_state PT_TRUSTLINE 1; echo "    ✓ PT trustline set"
else echo "    PT trustline already set — skipping."; fi

# ─── [6/9] Initialize the yield contract ─────────────────────────────────────────────────────────
if [ -z "$YIELD_INIT" ]; then
  echo "==> [6/9] Initializing the yield contract (sr, pt, expiry, yield_fee)..."
  invoke_retry "$YIELD" initialize --sr "$SR" --pt "$PT_SAC" --expiry "$EXPIRY" --yield_fee_bps "$YIELD_FEE_BPS"
  save_state YIELD_INIT 1; echo "    ✓ yield initialized"
else echo "==> [6/9] Yield already initialized — skipping."; fi

# ─── [6b] LOCK THE PT ISSUER ─────────────────────────────────────────────────────────────────────
#
# Handing SAC admin to the yield contract governs the *contract* path to mint/burn PT. It does
# NOTHING about the *classic* path: the issuer account can still create PT with a plain Stellar
# payment, bypassing the engine and therefore bypassing the SR that is supposed to back it. Setting
# the master key weight to 0 ends that permanently — per Stellar's docs a master key at weight 0
# cannot sign at all, which holds only while no OTHER signer exists (pre-flight 2 enforces that).
#
# Only PT needs this. **YT is a contract, not a classic asset** — it has no issuer to lock, which
# removes half of v1's lockdown surface outright.
#
# NO auth flags are set. `--set-required` would make the issuer authorize every new trustline, which
# a locked issuer can never do — nobody could ever hold PT again. Clawback/revocable grant powers
# over holder balances we deliberately do not want. The engine only calls `mint`/`burn` as SAC
# admin, so none are needed.
#
# ⚠️  THIS BURNS THE ISSUER IDENTITY. A later FRESH=1 run needs a BRAND-NEW issuer (or asset code):
# the old one can no longer sign `asset deploy` or `set_admin`. Set LOCK_ISSUER=0 while iterating.
if [ -z "${ISSUER_LOCKED:-}" ] && [ "${LOCK_ISSUER:-0}" = "1" ]; then
  echo "==> [6b] Locking the PT issuer (irreversible — LOCK_ISSUER=0 to skip)..."

  # Pre-flight 1: SAC admin MUST already be the yield contract, or locking leaves PT permanently
  # unmintable and bricks the deployment with no way back.
  PT_ADMIN_NOW=$(read_view "$PT_SAC" admin)
  if [ "$PT_ADMIN_NOW" != "$YIELD" ]; then
    echo "ERROR: refusing to lock — PT SAC admin is not (yet) the yield contract."
    echo "       admin = ${PT_ADMIN_NOW:-<unreadable>}   expected = $YIELD"
    exit 1
  fi
  echo "    ✓ PT SAC admin is the yield contract — the contract mint path survives the lock"

  # Pre-flight 2: no OTHER signer, or master-weight-0 would not actually lock anything.
  SIGNERS_BEFORE=$(issuer_live_signers)
  if [ "$SIGNERS_BEFORE" = "UNKNOWN" ]; then
    echo "ERROR: could not read the issuer's signers from $HORIZON_URL. Refusing to lock blind."
    exit 1
  fi
  EXTRA=$(printf '%s\n' "$SIGNERS_BEFORE" | grep -v "^$ISSUER_ADDR " || true)
  if [ -n "$EXTRA" ]; then
    echo "ERROR: the issuer has additional signers, so master-weight-0 would NOT lock it:"
    printf '         %s\n' "$EXTRA"
    exit 1
  fi
  echo "    ✓ no extra signers — master-weight-0 will fully disable this account"

  stellar tx new set-options --source-account "$ISSUER" "${NET_ARGS[@]}" --master-weight 0 >/dev/null
  save_state ISSUER_LOCKED 1
  echo "    issuer master weight -> 0"
elif [ -n "${ISSUER_LOCKED:-}" ]; then
  echo "==> [6b] issuer already locked — skipping."
else
  echo "==> [6b] ⚠️  SKIPPING the issuer lockdown (LOCK_ISSUER=0). The issuer remains a live signing"
  echo "         key and can mint PT that bypasses the engine. Fine for iteration, NEVER for mainnet."
fi

# Verify the lock ON CHAIN every run — only the ledger can answer "can any key still sign?".
if [ -n "${ISSUER_LOCKED:-}" ]; then
  SIGNERS_AFTER=$(issuer_live_signers)
  if [ "$SIGNERS_AFTER" = "UNKNOWN" ]; then
    echo "    ⚠ could not verify the lock from $HORIZON_URL — check by hand:"
    echo "      curl -s $HORIZON_URL/accounts/$ISSUER_ADDR | grep -A3 signers"
  elif [ -z "$SIGNERS_AFTER" ]; then
    echo "    ✓ VERIFIED on chain: no signer with weight > 0 — PT can only be minted by the engine"
  else
    echo "ERROR: the issuer is NOT locked — these signers can still sign:"
    printf '         %s\n' "$SIGNERS_AFTER"
    exit 1
  fi
fi

# ─── [7/9] Market ────────────────────────────────────────────────────────────────────────────────
if [ -z "$SRMARKET" ]; then
  echo "==> [7/9] Deploying the PT/SR market..."
  save_state SRMARKET "$(stellar contract deploy --wasm "$MARKET_WASM" --source-account "$SOURCE" "${NET_ARGS[@]}" -- --admin "$ADMIN_ADDR" --treasury "$TREASURY_ADDR")"
  echo "    srmarket = $SRMARKET"
else echo "==> [7/9] Market already deployed ($SRMARKET) — skipping."; fi

if [ -z "$SRMARKET_INIT" ]; then
  echo "    initializing market (it DISCOVERS pt/sr/expiry from the yield contract)..."
  stellar contract invoke --id "$SRMARKET" --source-account "$SOURCE" "${NET_ARGS[@]}" --send=yes -- initialize \
    --yield_contract "$YIELD" \
    --scalar_root "$MARKET_SCALAR_ROOT" \
    --ln_fee_root "$MARKET_LN_FEE_ROOT" \
    --initial_apy "$MARKET_INITIAL_APY" \
    --treasury_fee_share_bps "$MARKET_TREASURY_FEE_SHARE_BPS" >/dev/null
  save_state SRMARKET_INIT 1; echo "    ✓ market initialized"
else echo "    market already initialized — skipping."; fi

# ─── [7b] Fixed-Rate Vault ───────────────────────────────────────────────────────────────────────
# Sits on top of the engine and, like the market, DISCOVERS its own wiring: it takes only the
# engine's address and reads sr/pt/underlying/maturity back from it. `tofix.md` #24 is not
# expressible here.
if [ -z "$SRVAULT" ]; then
  echo "==> [7b] Deploying the Fixed-Rate Vault..."
  save_state SRVAULT "$(stellar contract deploy --wasm "$VAULT_WASM" --source-account "$SOURCE" "${NET_ARGS[@]}" -- --admin "$ADMIN_ADDR")"
  echo "    srvault = $SRVAULT"
else echo "==> [7b] Vault already deployed ($SRVAULT) — skipping."; fi

if [ -z "$SRVAULT_INIT" ]; then
  # ─── Rate calibration (ADVISORY on testnet) ────────────────────────────────────────────────────
  # Testnet Blend pays ~0.2%, so this WILL report FAIL — correctly. It is run anyway, and printed,
  # so the subsidy is visible at deploy time instead of being discovered when capacity runs out.
  # The same check is a hard gate in `deploy_mainnet.sh`.
  echo "    calibrating the rate against the live Blend pool (advisory on testnet; ~2 min)..."
  node "$SCRIPT_DIR/calibrate_vault_rate.mjs" --state "$STATE_FILE" \
    --pool "$BLEND_POOL" --underlying "$USDC_SAC" \
    --rate "$VAULT_RATE_BPS" --margin "$VAULT_RATE_MARGIN_BPS" --max-apr "$MAX_APR_BPS" --advisory || true
  echo "    initializing vault (rate=${VAULT_RATE_BPS}bps, ceiling=${VAULT_MAX_RATE_BPS}bps)..."
  invoke_retry "$SRVAULT" initialize --yield_contract "$YIELD" --rate_bps "$VAULT_RATE_BPS" --max_rate_bps "$VAULT_MAX_RATE_BPS"
  save_state SRVAULT_INIT 1; echo "    ✓ vault initialized"
else echo "    vault already initialized — skipping."; fi

# ─── Reconcile the live rate with VAULT_RATE_BPS ─────────────────────────────────────────────────
# `initialize` runs ONCE. On every later run the block above is skipped, so a changed
# VAULT_RATE_BPS would never reach an already-deployed vault — the script would report one rate
# while the contract quoted another, and the dashboard reads the contract. This runs on BOTH paths:
# after a fresh init it is a no-op assertion, and on a re-run it is what actually applies a change.
# Forward-only by construction: `set_rate` moves the quote for NEW deposits and cannot touch an
# open receipt, which stores its own payout and rate.
LIVE_RATE="$(stellar contract invoke --id "$SRVAULT" --source-account "$SOURCE" "${NET_ARGS[@]}" \
  --send=no -- rate_bps 2>/dev/null | tr -d '"[:space:]')"
if [ -z "$LIVE_RATE" ]; then
  echo "    !! could not read the vault's live rate — skipping reconciliation."
elif [ "$LIVE_RATE" = "$VAULT_RATE_BPS" ]; then
  echo "    ✓ vault rate on chain is ${LIVE_RATE}bps (matches VAULT_RATE_BPS)"
else
  echo "    vault rate on chain is ${LIVE_RATE}bps but VAULT_RATE_BPS=${VAULT_RATE_BPS} — reconciling..."
  # Advisory on testnet: Blend's testnet reserve pays ~0.2%, so any usable demo rate reports FAIL.
  node "$SCRIPT_DIR/calibrate_vault_rate.mjs" --state "$STATE_FILE" \
    --pool "$BLEND_POOL" --underlying "$USDC_SAC" \
    --rate "$VAULT_RATE_BPS" --margin "$VAULT_RATE_MARGIN_BPS" --max-apr "$MAX_APR_BPS" --advisory --sample 0 || true
  invoke_retry "$SRVAULT" set_rate --rate_bps "$VAULT_RATE_BPS"
  echo "    ✓ vault rate set to ${VAULT_RATE_BPS}bps"
fi

# Seed PT coupon capacity. Without it the vault quotes a rate but every deposit is refused, because
# a coupon can only be promised out of SPARE inventory.
if [ "${VAULT_SEED_AMOUNT:-0}" -gt 0 ] && [ -z "$VAULT_SEEDED" ]; then
  echo "    seeding $VAULT_SEED_AMOUNT USDC base units of coupon capacity..."
  invoke_retry "$SRVAULT" seed --from "$ADMIN_ADDR" --amount "$VAULT_SEED_AMOUNT"
  save_state VAULT_SEEDED 1; echo "    ✓ vault seeded"
elif [ -n "$VAULT_SEEDED" ]; then echo "    vault already seeded — skipping."
else echo "    (VAULT_SEED_AMOUNT=0 — vault deployed but has no coupon capacity yet)"; fi


# ─── [7c] SR Router — the one-transaction USDC front door ─────────────────────────────────────────
# Deployed LAST on purpose: it is the only contract here that is pure convenience. Everything below
# it works without it, so if this step fails the protocol is still fully usable — users just need
# three signatures instead of one. It holds no funds, has no privileges over any other contract,
# and like the market and vault it DISCOVERS its own wiring from a single address.
if [ -z "$SRROUTER" ]; then
  echo "==> [7c] Deploying the SR Router..."
  save_state SRROUTER "$(stellar contract deploy --wasm "$ROUTER_WASM" --source-account "$SOURCE" "${NET_ARGS[@]}" -- --admin "$ADMIN_ADDR")"
  echo "    srrouter = $SRROUTER"
else echo "==> [7c] Router already deployed ($SRROUTER) — skipping."; fi

if [ -z "$SRROUTER_INIT" ]; then
  echo "    initializing router against the market..."
  invoke_retry "$SRROUTER" initialize --market "$SRMARKET"
  save_state SRROUTER_INIT 1; echo "    ✓ router initialized"
else echo "    router already initialized — skipping."; fi

# ─── [8/9] On-chain verification ─────────────────────────────────────────────────────────────────
# Read every binding back FROM CHAIN. The contract makes a mismatch impossible to construct, but a
# stale state file pointing at the wrong deployment is still possible — this is what catches it.
echo "==> [8/9] Verifying the live wiring on chain..."
expect "sr.underlying == USDC"          "$(read_view "$SR" underlying)"     "$USDC_SAC"
expect "sr.strategy == strategy"        "$(read_view "$SR" strategy)"       "$STRATEGY"
expect "yield.sr_token == sr"           "$(read_view "$YIELD" sr_token)"    "$SR"
expect "yield.pt_token == PT SAC"       "$(read_view "$YIELD" pt_token)"    "$PT_SAC"
expect "yield.expiry == expiry"         "$(read_view "$YIELD" expiry)"      "$EXPIRY"
expect "yield.treasury == treasury"     "$(read_view "$YIELD" treasury)"    "$TREASURY_ADDR"
expect "market.yield_contract == yield" "$(read_view "$SRMARKET" yield_contract)" "$YIELD"
expect "market.pt_token == PT SAC"      "$(read_view "$SRMARKET" pt_token)" "$PT_SAC"
expect "market.sr_token == sr"          "$(read_view "$SRMARKET" sr_token)" "$SR"
expect "market.expiry == expiry"        "$(read_view "$SRMARKET" expiry)"   "$EXPIRY"
PT_ADMIN_NOW=$(read_view "$PT_SAC" admin)
expect "PT SAC admin == yield"          "$PT_ADMIN_NOW"                     "$YIELD"
expect "vault.yield_contract == yield"  "$(read_view "$SRVAULT" yield_contract)" "$YIELD"
expect "vault.pt_token == PT SAC"       "$(read_view "$SRVAULT" pt_token)"  "$PT_SAC"
expect "vault.underlying == USDC"       "$(read_view "$SRVAULT" underlying)" "$USDC_SAC"
expect "vault.maturity == expiry"       "$(read_view "$SRVAULT" maturity)"  "$EXPIRY"
expect "router.market == market"        "$(read_view "$SRROUTER" market)"        "$SRMARKET"
expect "router.yield_contract == yield" "$(read_view "$SRROUTER" yield_contract)" "$YIELD"
expect "router.sr_token == sr"          "$(read_view "$SRROUTER" sr_token)"      "$SR"
expect "router.pt_token == PT SAC"      "$(read_view "$SRROUTER" pt_token)"      "$PT_SAC"
expect "router.underlying == USDC"      "$(read_view "$SRROUTER" underlying)"    "$USDC_SAC"
expect "router.expiry == expiry"        "$(read_view "$SRROUTER" expiry)"        "$EXPIRY"

# ── Cross-contract COMPATIBILITY, not just wiring ────────────────────────────────────────────────
#
# The checks above prove the contracts point at each other. They do not prove they can still TALK to
# each other, and those are different failures. Caught on 2026-08-25: `Sr::max_redeemable` was
# upgraded to call `strategy::available_liquidity`, the strategy was never redeployed, and every
# wiring check above still passed while the feature was dead on chain.
#
# So: actually invoke the calls that cross a contract boundary. A view that cannot complete is a
# version skew between two deployments, and it is invisible to an address comparison.
echo "    checking cross-contract compatibility..."
COMPAT_FAIL=0
compat() {  # compat <label> <contract> <fn> [args...]
  if read_view "$2" "${@:3}" >/dev/null 2>&1 && [ -n "$(read_view "$2" "${@:3}")" ]; then
    echo "    ✓ $1"
  else
    echo "    ✗ $1 — FAILED. The callee is likely an older deployment missing this entry point."
    COMPAT_FAIL=1
  fi
}
compat "sr.max_redeemable -> strategy.available_liquidity" "$SR" max_redeemable
compat "sr.total_assets"                                   "$SR" total_assets
compat "sr.deposit_cap"                                    "$SR" deposit_cap
compat "strategy.available_liquidity"                      "$STRATEGY" available_liquidity
compat "market.asset_reserve -> sr.exchange_rate"          "$SRMARKET" asset_reserve
compat "router.quote_buy_pt_with_usdc -> sr + market"      "$SRROUTER" quote_buy_pt_with_usdc --usdc_in 1000000
if [ "$COMPAT_FAIL" = "1" ]; then
  echo
  echo "ERROR: a cross-contract call failed. One of these deployments is out of date relative to the"
  echo "       others. Upgrade the callee before relying on the feature that needs it."
  exit 1
fi

SR_RATE=$(read_view "$SR" exchange_rate)
echo "    ✓ sr.exchange_rate = $SR_RATE (live Blend b_rate)"
echo "    ✓ yield.py_index   = $(read_view "$YIELD" py_index)"
echo "    ✓ market.reserves  = $(read_view "$SRMARKET" reserves)"

# ─── [9/9] Optional seed ─────────────────────────────────────────────────────────────────────────
if [ "${SEED:-0}" = "1" ] && [ -z "$POOL_SEEDED" ]; then
  echo "==> [9/9] Seeding the pool ($SEED_PER_SIDE per side, in USDC base units)..."
  TOTAL=$(( SEED_PER_SIDE * 2 ))
  echo "    wrapping $TOTAL USDC into SR..."
  stellar contract invoke --id "$SR" --source-account "$SOURCE" "${NET_ARGS[@]}" --send=yes -- deposit \
    --from "$ADMIN_ADDR" --receiver "$ADMIN_ADDR" --amount "$TOTAL" --min_shares_out 0 >/dev/null
  SR_BAL=$(read_view "$SR" total_supply)
  echo "    SR minted (total supply now $SR_BAL)"

  echo "    stripping half into PT+YT..."
  HALF_SR=$(stellar contract invoke --id "$SR" --source-account "$SOURCE" "${NET_ARGS[@]}" -- preview_deposit --amount "$SEED_PER_SIDE" 2>/dev/null | tr -d '"')
  stellar contract invoke --id "$YIELD" --source-account "$SOURCE" "${NET_ARGS[@]}" --send=yes -- mint_py \
    --from "$ADMIN_ADDR" --receiver "$ADMIN_ADDR" --sr_in "$HALF_SR" >/dev/null
  PT_BAL=$(stellar contract invoke --id "$PT_SAC" --source-account "$SOURCE" "${NET_ARGS[@]}" -- balance --id "$ADMIN_ADDR" 2>/dev/null | tr -d '"')
  SR_LEFT=$(stellar contract invoke --id "$SR" --source-account "$SOURCE" "${NET_ARGS[@]}" -- balance --id "$ADMIN_ADDR" 2>/dev/null | tr -d '"')
  echo "    PT = $PT_BAL   SR left = $SR_LEFT"

  echo "    adding liquidity (any ratio opens at ${MARKET_APY_BPS}bps — the anchor is dynamic)..."
  stellar contract invoke --id "$SRMARKET" --source-account "$SOURCE" "${NET_ARGS[@]}" --send=yes -- add_liquidity \
    --lp "$ADMIN_ADDR" --pt_in "$PT_BAL" --sr_in "$SR_LEFT" --min_shares 0 >/dev/null
  save_state POOL_SEEDED 1
  echo "    ✓ seeded. reserves = $(read_view "$SRMARKET" reserves)"
  echo "    ✓ implied APY = $(read_view "$SRMARKET" implied_apy)  PT price = $(read_view "$SRMARKET" pt_price)"
elif [ -n "$POOL_SEEDED" ]; then
  echo "==> [9/9] Pool already seeded — skipping."
else
  echo "==> [9/9] Skipping seed (SEED=1 to seed; needs ~$(( SEED_PER_SIDE * 2 )) USDC on $SOURCE)."
fi

save_state DEPLOY_COMPLETE 1

cat <<EOF

═══════════════════════════════════════════════════════════════════════════════
 SR STACK DEPLOYED — $NETWORK
═══════════════════════════════════════════════════════════════════════════════
  SR (Standardized Return)   $SR
  Strategy (Blend adapter)   $STRATEGY
  Yield engine  ( = YT )     $YIELD
  PT/SR Market               $SRMARKET
  Fixed-Rate Vault           $SRVAULT
  SR Router (USDC frontdoor) $SRROUTER
  PT SAC                     $PT_SAC
  PT classic asset           $PT_ASSET
  USDC SAC                   $USDC_SAC
  Blend pool                 $BLEND_POOL
  Treasury                   $TREASURY_ADDR
  Expiry                     $EXPIRY

  NOTE: YT has no SAC and no classic asset — the yield contract IS the YT token.
        Users need a PT trustline before receiving PT; none is needed for YT.

  Frontend config (website/frontend/src/lib/config.ts):
    SR_ID       = "$SR"
    YIELD_ID    = "$YIELD"
    SRMARKET_ID = "$SRMARKET"
    SRVAULT_ID  = "$SRVAULT"
    SRROUTER_ID = "$SRROUTER"
    PT_SAC      = "$PT_SAC"
    USDC_SAC    = "$USDC_SAC"
═══════════════════════════════════════════════════════════════════════════════
EOF
