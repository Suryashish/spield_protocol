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

# ─── Series parameters ───────────────────────────────────────────────────────────────────────────
MATURITY_DAYS="${MATURITY_DAYS:-90}"
EXPIRY="${EXPIRY:-$(( $(date +%s) + MATURITY_DAYS*24*60*60 ))}"

# Protocol share of YT interest, in bps. Pendle takes 5%; the on-chain ceiling is 10%.
YIELD_FEE_BPS="${YIELD_FEE_BPS:-500}"

# ─── Market parameters ───────────────────────────────────────────────────────────────────────────
# Curve steepness. With a DYNAMIC anchor this only controls price impact — it no longer drives the
# seed ratio, so any PT:SR ratio opens the pool at MARKET_APY_BPS.
MARKET_SCALAR_ROOT="${MARKET_SCALAR_ROOT:-40000000000000}"     # 40 * 1e12

# ANNUALIZED fee root, SCALAR_12: fee_rate = exp(ln_fee_root * years_to_expiry).
# 0.25%/yr, chosen from `calibrate_the_fee_root`: PT round trip 0.17%, YT round trip 13.3%
# (v1's flat 30 bps cost 0.60% / 40.5%). Contract ceiling is 5%/yr.
MARKET_LN_FEE_ROOT="${MARKET_LN_FEE_ROOT:-2500000000}"         # 0.0025 * 1e12

# Opening implied APY as a SCALAR_12 fraction. 5.00% = 0.05 * 1e12.
MARKET_APY_BPS="${MARKET_APY_BPS:-500}"
MARKET_INITIAL_APY="${MARKET_INITIAL_APY:-$(( MARKET_APY_BPS * 1000000000000 / 10000 ))}"

# Share of every swap fee routed to the treasury, in bps. 2000 = 20% protocol / 80% LP — the
# inverse of Pendle, which gives LPs only 20%. Contract ceiling is 5000 (50%).
MARKET_TREASURY_FEE_SHARE_BPS="${MARKET_TREASURY_FEE_SHARE_BPS:-2000}"

# ─── Seeding (only runs with SEED=1) ─────────────────────────────────────────────────────────────
# USDC (7 decimals) put into EACH side of the pool. The PT side is minted by stripping SR, so the
# deployer needs ≈ 2 x this much USDC in total.
SEED_PER_SIDE="${SEED_PER_SIDE:-50000000}"                     # 5 USDC per side by default

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
      sr|yield) echo "ERROR: REDEPLOY=$p cannot work in isolation (see comment). Use FRESH=1."; exit 1 ;;
      *) echo "ERROR: unknown REDEPLOY component '$p'. Supported: srmarket."; exit 1 ;;
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
SR=""; STRATEGY=""; YIELD=""; SRMARKET=""; PT_SAC=""
STRATEGY_INIT=""; SR_INIT=""; YIELD_INIT=""; SRMARKET_INIT=""
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
  out=$(stellar contract invoke --id "$1" --source-account "$SOURCE" "${NET_ARGS[@]}" -- "$2" 2>/dev/null) || return 0
  printf '%s' "$out" | tr -d '"' | tr -d '[:space:]'
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

# ─── [1/9] Build ─────────────────────────────────────────────────────────────────────────────────
echo "==> [1/9] Building + optimizing WASMs..."
stellar contract build --optimize >/dev/null
WASM_DIR="target/wasm32v1-none/release"
pick_wasm() { if [ -f "$1.optimized.wasm" ]; then echo "$1.optimized.wasm"; else echo "$1.wasm"; fi; }
SR_WASM=$(pick_wasm "$WASM_DIR/spield_sr")
STRAT_WASM=$(pick_wasm "$WASM_DIR/spield_strategy")
YIELD_WASM=$(pick_wasm "$WASM_DIR/spield_yield")
MARKET_WASM=$(pick_wasm "$WASM_DIR/spield_srmarket")
for f in "$SR_WASM" "$STRAT_WASM" "$YIELD_WASM" "$MARKET_WASM"; do
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
    --lp "$ADMIN_ADDR" --pt_in "$PT_BAL" --sr_in "$SR_LEFT" >/dev/null
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
    PT_SAC      = "$PT_SAC"
    USDC_SAC    = "$USDC_SAC"
═══════════════════════════════════════════════════════════════════════════════
EOF
