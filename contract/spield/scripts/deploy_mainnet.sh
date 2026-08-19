#!/usr/bin/env bash
#
# Spield v2 — MAINNET deploy against the real Blend FixedV2 pool + real Circle USDC.
#
# ⚠️  THIS SPENDS REAL MONEY. Read MAINNET.md in full before running. The script pauses for an
#     explicit "yes" confirmation before it does anything irreversible.
#
# It is a faithful mainnet twin of scripts/deploy_testnet.sh — SAME contract WASMs (the contracts
# are network-agnostic; nothing in the Rust changes for mainnet), only the addresses, the network
# passphrase, and the safety guards differ.
#
# Prereqs (see MAINNET.md §Accounts):
#   * Run inside WSL with the Stellar CLI 26.x + Rust toolchain.
#   * Two funded mainnet identities exist in the Stellar CLI:
#       - $SOURCE  (default: spield_deployer)        — deploys + inits + seeds; holds XLM AND USDC.
#       - $ISSUER  (default: spield_issuer_mainnet)  — DEDICATED PT/YT issuer; holds XLM only.
#     (A Stellar asset's issuer can't hold its own asset, so PT/YT MUST be issued by a separate
#      account from any account that will hold PT/YT — incl. the deployer.)
#
# RESUMABLE: every address/checkpoint is written to a STATE FILE the instant it's created
# (default: scripts/deploy_mainnet.state). If the script stops midway (e.g. the deployer runs out of
# XLM), just top up and RE-RUN the same command — it reloads the state file and SKIPS every step that
# already completed, picking up exactly where it left off instead of redeploying. A step that never
# landed on-chain costs nothing (failed txs aren't charged), so a stop is non-wasteful.
#
# Usage:
#   bash scripts/deploy_mainnet.sh                          # uses spield_deployer + spield_issuer_mainnet
#   SOURCE=mykey ISSUER=myissuer bash scripts/deploy_mainnet.sh
#   YES=1 bash scripts/deploy_mainnet.sh                    # skip the interactive confirmation (CI)
#   STATE_FILE=/path/to/run.state bash scripts/deploy_mainnet.sh   # custom checkpoint file
#   FRESH=1 bash scripts/deploy_mainnet.sh                  # ignore + overwrite any existing state (start over)
set -euo pipefail

SOURCE="${SOURCE:-spield_deployer}"
ISSUER="${ISSUER:-spield_issuer_mainnet}"
NETWORK="${NETWORK:-mainnet}"
# The Public network passphrase. The Stellar CLI also needs a mainnet RPC to simulate/submit.
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Public Global Stellar Network ; September 2015}"
RPC_URL="${RPC_URL:-https://mainnet.sorobanrpc.com}"

# How we point the CLI at mainnet. If you've run `stellar network add mainnet ...` you can instead
# export NETWORK=mainnet and the CLI uses the saved network; otherwise we pass passphrase + rpc.
NET_ARGS=(--network-passphrase "$NETWORK_PASSPHRASE" --rpc-url "$RPC_URL")

# ─── VERIFIED MAINNET ADDRESSES (see MAINNET.md; verified on-chain 2026-06-08) ──────────────────
# Blend FixedV2 lending pool — holds ONLY XLM/USDC/EURC (deep, blue-chip; no thin-asset oracle
# surface). NOT YieldBloxV2 (CCCCIQSD...) which was drained $10.8M in Feb 2026 via oracle
# manipulation on a thin asset. FixedV2 is the post-exploit-safe yield source. Status: active.
BLEND_POOL="${BLEND_POOL:-CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD}"
# Real Circle USDC as a Soroban contract (SAC). Derived deterministically from Circle's mainnet
# issuer + confirmed against Blend's mainnet.contracts.json; live decimals() == 7.
USDC_SAC="${USDC_SAC:-CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75}"
# Circle's USDC as a classic asset (for trustlines / sending USDC around).
USDC_ASSET="${USDC_ASSET:-USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN}"

# Rate sanity bound: max ANNUAL b_rate growth, in bps, pro-rated by elapsed time on each read (so
# read frequency is irrelevant — calibrate ONLY against Blend's real max supply APR). FixedV2's USDC
# supply rate is single-digit %; 30000 = 300% APR is a generous defence-in-depth ceiling.
MAX_APR_BPS="${MAX_APR_BPS:-30000}"
# Maturity: default ~90 days from now (unix seconds). On mainnet a real bond term is longer than the
# 30d demo term used on testnet — override MATURITY_DAYS to taste.
MATURITY_DAYS="${MATURITY_DAYS:-90}"
MATURITY="${MATURITY:-$(( $(date +%s) + MATURITY_DAYS*24*60*60 ))}"

# ─── Fixed-Rate Vault config ────────────────────────────────────────────────────────────────────
VAULT_RATE_BPS="${VAULT_RATE_BPS:-500}"        # fixed APR the vault quotes (500 = 5.00%)
VAULT_MAX_RATE_BPS="${VAULT_MAX_RATE_BPS:-2000}"  # hard ceiling admin can ever set (20%)
# Initial PT inventory to seed = the vault's launch coupon capacity (USDC base units, 7 decimals).
# This is the ONLY vault step that spends USDC. Default 0 => NO USDC needed to deploy+init the whole
# protocol (deploy/init are pure config writes paid only in XLM). Seed later via vault.seed when you
# actually have USDC and have confirmed the wiring. Keep small for the first mainnet launch.
VAULT_SEED_AMOUNT="${VAULT_SEED_AMOUNT:-0}"

# ─── Market (PT/USDC time-decay AMM) config ─────────────────────────────────────────────────────
MARKET_FEE_BPS="${MARKET_FEE_BPS:-30}"          # 0.30% swap fee
MARKET_MAX_FEE_BPS="${MARKET_MAX_FEE_BPS:-100}" # ceiling admin can ever set (1%)
MARKET_SCALAR_ROOT="${MARKET_SCALAR_ROOT:-40000000000000}"  # 40 * 1e12 (curve steepness root)
MARKET_RATE_ANCHOR="${MARKET_RATE_ANCHOR:-1000000000000}"   # 1.0 * 1e12 (PT anchored at par)
# Initial liquidity per side (USDC base units). The ONLY market step that spends USDC; needs ~2x this
# in deployer USDC (one part minted into PT, one part as the pool's USDC). Default 0 => deploy+init
# need no USDC; add liquidity later via market.add_liquidity once funded.
MARKET_SEED_AMOUNT="${MARKET_SEED_AMOUNT:-0}"

# ─── Checkpoint / resume state ───────────────────────────────────────────────────────────────────
# The state file accumulates `KEY=value` lines (contract addresses + step-complete markers). It's
# sourced on startup so a re-run already knows everything the previous run accomplished. Each step is
# guarded so it only runs if its checkpoint is absent — making the whole script idempotent & resumable.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="${STATE_FILE:-$SCRIPT_DIR/deploy_mainnet.state}"

if [ "${FRESH:-0}" = "1" ]; then
  rm -f "$STATE_FILE"
fi

# ─── Selective redeploy: REDEPLOY=market[,vault] ────────────────────────────────────────────────
# Replace ONE already-deployed contract in place, keeping every other address. Use this — never
# FRESH=1 — when a contract's code or ABI changed after the stack was already deployed.
#
#   FRESH=1           deletes the state file  ⇒  redeploys wrapper + strategy + vault + market AND
#                     re-creates both PT/YT SACs, re-hands SAC admin, and recomputes the maturity.
#                     EVERY address changes. Correct only for a brand-new deployment.
#   REDEPLOY=market   keeps every existing address, the PT/YT SACs and the pinned SAVED_MATURITY,
#                     and re-runs only the market's deploy + initialize steps.
#
# Only leaf contracts are offered, because the rest genuinely cannot be replaced on their own:
#   * wrapper  — PT/YT SAC admin was handed to the CURRENT wrapper, and the issuer can no longer
#                call set_admin, so a fresh wrapper could never mint PT/YT. Needs new SACs ⇒ FRESH=1.
#   * strategy — the wrapper stores the strategy address in its one-shot initialize(), so nothing
#                can re-point it at a replacement. Needs a new wrapper ⇒ FRESH=1.
REDEPLOY="${REDEPLOY:-}"
if [ -n "$REDEPLOY" ]; then
  if [ ! -f "$STATE_FILE" ]; then
    echo "ERROR: REDEPLOY=$REDEPLOY needs an existing deployment to redeploy into, but there is no"
    echo "       state file at $STATE_FILE. For a first deploy, run with no REDEPLOY."
    exit 1
  fi
  CLEAR_KEYS=""
  IFS=',' read -r -a REDEPLOY_PARTS <<< "$REDEPLOY"
  for part in "${REDEPLOY_PARTS[@]}"; do
    case "$part" in
      market) CLEAR_KEYS="$CLEAR_KEYS MARKET MARKET_INIT MARKET_MINTED MARKET_SEEDED" ;;
      vault)  CLEAR_KEYS="$CLEAR_KEYS VAULT VAULT_INIT VAULT_SEEDED" ;;
      wrapper|strategy)
        echo "ERROR: REDEPLOY=$part is refused — it cannot work in isolation and would leave a"
        echo "       half-broken stack (see the comment above this check). Use FRESH=1 for a"
        echo "       brand-new deployment instead, and migrate any TVL off the old one first."
        exit 1 ;;
      *)
        echo "ERROR: unknown REDEPLOY component '$part'. Supported: market, vault."
        exit 1 ;;
    esac
  done
  # Clearing DEPLOY_COMPLETE is what re-opens the script; without it the run exits early below.
  CLEAR_KEYS="$CLEAR_KEYS DEPLOY_COMPLETE"

  STATE_BACKUP="$STATE_FILE.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$STATE_FILE" "$STATE_BACKUP"
  echo "==> REDEPLOY=$REDEPLOY — forgetting these checkpoints:"
  for k in $CLEAR_KEYS; do
    OLD_LINE=$(grep -E "^$k=" "$STATE_FILE" | tail -1 || true)
    if [ -n "$OLD_LINE" ]; then echo "      - $OLD_LINE"; fi
  done
  CLEAR_RE=$(echo $CLEAR_KEYS | tr ' ' '|')
  grep -Ev "^($CLEAR_RE)=" "$STATE_FILE" > "$STATE_FILE.tmp" || true
  mv "$STATE_FILE.tmp" "$STATE_FILE"
  echo "    previous state backed up to: $STATE_BACKUP"
  echo "    ⚠ The old contracts stay live on chain — nothing is destroyed, they simply stop being"
  echo "      the ones this deployment points at. WITHDRAW ANY LIQUIDITY / POSITIONS FROM THEM"
  echo "      FIRST: a replaced market keeps its reserves, and no one will be trading against it."
  echo
fi

# Variables that may be restored from the state file (declare so `set -u` is happy when absent).
WRAPPER=""; STRATEGY=""; VAULT=""; MARKET=""; PT_SAC=""; YT_SAC=""
PT_ADMIN_SET=""; YT_ADMIN_SET=""; TRUSTLINES_SET=""
STRATEGY_INIT=""; WRAPPER_INIT=""; VAULT_INIT=""; MARKET_INIT=""
VAULT_SEEDED=""; MARKET_MINTED=""; MARKET_SEEDED=""; SAVED_MATURITY=""; DEPLOY_COMPLETE=""

if [ -f "$STATE_FILE" ]; then
  echo "==> Resuming from existing state file: $STATE_FILE"
  # shellcheck disable=SC1090
  source "$STATE_FILE"
  # Maturity MUST be stable across resumes (strategy/wrapper/vault/market all share it). If a prior
  # run persisted it, reuse that value rather than recomputing a new "now + Nd" that would mismatch.
  if [ -n "$SAVED_MATURITY" ]; then MATURITY="$SAVED_MATURITY"; fi
fi

# If a previous run already finished everything, don't rebuild/redeploy — just reprint the addresses.
if [ -n "$DEPLOY_COMPLETE" ]; then
  echo "==> This deploy already completed (per $STATE_FILE). Nothing to do."
  echo "    wrapper=$WRAPPER  strategy=$STRATEGY  vault=$VAULT  market=$MARKET"
  echo "    PT=$PT_SAC  YT=$YT_SAC"
  echo "    (To start a brand-new deployment, run with FRESH=1 or delete the state file.)"
  exit 0
fi

# Append a KEY=value checkpoint and also set it live in this shell.
save_state() {  # save_state KEY VALUE
  local key="$1" val="$2"
  printf '%s=%q\n' "$key" "$val" >> "$STATE_FILE"
  printf -v "$key" '%s' "$val"
}

# ─── Resolve addresses ──────────────────────────────────────────────────────────────────────────
ADMIN_ADDR=$(stellar keys address "$SOURCE")
ISSUER_ADDR=$(stellar keys address "$ISSUER")

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  SPIELD v2 — MAINNET DEPLOY  (THIS SPENDS REAL XLM AND USDC)      ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo "  Network      : $NETWORK  ($NETWORK_PASSPHRASE)"
echo "  RPC          : $RPC_URL"
echo "  Deployer     : $SOURCE  = $ADMIN_ADDR"
echo "  PT/YT issuer : $ISSUER  = $ISSUER_ADDR"
echo "  Blend pool   : $BLEND_POOL   (FixedV2)"
echo "  USDC SAC     : $USDC_SAC"
echo "  Maturity     : $MATURITY  (+${MATURITY_DAYS}d)"
echo "  Vault seed   : $VAULT_SEED_AMOUNT base units   Market seed: $MARKET_SEED_AMOUNT base units"
echo "  Max APR bps  : $MAX_APR_BPS"
echo "  State file   : $STATE_FILE"
echo

# Hard guard: confirm before doing anything irreversible. (Skipped automatically when resuming a
# run that already created contracts — you already confirmed on the first pass.)
if [ "${YES:-0}" != "1" ] && [ -z "$WRAPPER" ]; then
  read -r -p "Type 'deploy mainnet' to proceed: " CONFIRM
  if [ "$CONFIRM" != "deploy mainnet" ]; then
    echo "Aborted (no confirmation)."; exit 1
  fi
fi

# Pin the maturity into the state on the very first run so every contract shares one value across
# resumes. (No-op on resume — it's already saved.)
if [ -z "$SAVED_MATURITY" ]; then save_state SAVED_MATURITY "$MATURITY"; fi

echo "==> [1/8] Building + optimizing WASMs (wasm-opt — shrinks the binary => lower mainnet"
echo "          install/rent fees; behaviour identical, but the code hash differs from testnet)..."
# --optimize runs wasm-opt over each release WASM after the (already opt-level=z, lto, strip) build.
stellar contract build --optimize >/dev/null
WASM_DIR="target/wasm32v1-none/release"
# `build --optimize` writes <name>.optimized.wasm next to the plain build output. Fall back to the
# unoptimized file if (on an older CLI) the optimized one isn't produced.
pick_wasm() { if [ -f "$1.optimized.wasm" ]; then echo "$1.optimized.wasm"; else echo "$1.wasm"; fi; }
STRAT_WASM=$(pick_wasm "$WASM_DIR/spield_strategy")
WRAP_WASM=$(pick_wasm "$WASM_DIR/spield_wrapper")
VAULT_WASM=$(pick_wasm "$WASM_DIR/spield_vault")
MARKET_WASM=$(pick_wasm "$WASM_DIR/spield_market")
echo "    using:"
for w in "$STRAT_WASM" "$WRAP_WASM" "$VAULT_WASM" "$MARKET_WASM"; do
  printf "      %8s  %s\n" "$(wc -c < "$w" 2>/dev/null || echo '?')" "$w"
done

# admin bound ATOMICALLY by __constructor at deploy (after `--`), so the deploy->initialize window
# can't be front-run: only this admin can complete initialize(). Rotate to a MULTISIG post-deploy.
# NOTE: admin = the deployer (a single hot key). That is functionally fine to KEEP — a single-key
# admin runs the protocol identically, and admin powers can't steal funds / mint unbacked tokens /
# bypass the upgrade timelock. Rotating to a multisig (§6 in MAINNET.md) is RECOMMENDED for real
# TVL (so one key compromise isn't fatal), not required to operate.
if [ -z "$WRAPPER" ]; then
  echo "==> [2/8] Deploying the wrapper contract (need its address to admin PT/YT)..."
  W=$(stellar contract deploy --wasm "$WRAP_WASM" --source-account "$SOURCE" "${NET_ARGS[@]}" \
    -- --admin "$ADMIN_ADDR")
  save_state WRAPPER "$W"
  echo "    wrapper = $WRAPPER"
else
  echo "==> [2/8] wrapper already deployed ($WRAPPER) — skipping."
fi

PT_ASSET="SPLDPT:$ISSUER_ADDR"
YT_ASSET="SPLDYT:$ISSUER_ADDR"

# SAC ids are DETERMINISTIC (asset code + issuer + network), so re-deriving them on a resume is free
# and always yields the same address — but the asset *deploy* is a state-changing tx, so only run it
# when we don't already have the SAC recorded. (Deploy is idempotent-tolerant via `|| true`, but
# skipping avoids a needless tx + fee on resume.)
if [ -z "$PT_SAC" ] || [ -z "$YT_SAC" ]; then
  echo "==> [3/8] Creating PT and YT assets + SACs (issued by $ISSUER)..."
  stellar contract asset deploy --asset "$PT_ASSET" --source-account "$ISSUER" "${NET_ARGS[@]}" >/dev/null 2>&1 || true
  stellar contract asset deploy --asset "$YT_ASSET" --source-account "$ISSUER" "${NET_ARGS[@]}" >/dev/null 2>&1 || true
  save_state PT_SAC "$(stellar contract id asset --asset "$PT_ASSET" "${NET_ARGS[@]}")"
  save_state YT_SAC "$(stellar contract id asset --asset "$YT_ASSET" "${NET_ARGS[@]}")"
  echo "    PT SAC = $PT_SAC"
  echo "    YT SAC = $YT_SAC"
else
  echo "==> [3/8] PT/YT SACs already created (PT=$PT_SAC, YT=$YT_SAC) — skipping."
fi

# Hand SAC admin to the wrapper so it (not the issuer) controls mint/burn. Guarded per-token: once
# admin is the wrapper, the issuer can no longer call set_admin, so a blind re-run would fail.
if [ -z "$PT_ADMIN_SET" ]; then
  stellar contract invoke --id "$PT_SAC" --source-account "$ISSUER" "${NET_ARGS[@]}" \
    -- set_admin --new_admin "$WRAPPER" >/dev/null
  save_state PT_ADMIN_SET 1
  echo "    PT admin -> wrapper"
else
  echo "    PT admin already handed to wrapper — skipping."
fi
if [ -z "$YT_ADMIN_SET" ]; then
  stellar contract invoke --id "$YT_SAC" --source-account "$ISSUER" "${NET_ARGS[@]}" \
    -- set_admin --new_admin "$WRAPPER" >/dev/null
  save_state YT_ADMIN_SET 1
  echo "    YT admin -> wrapper"
else
  echo "    YT admin already handed to wrapper — skipping."
fi

# The deployer (who will receive PT/YT when it seeds the market) needs trustlines for these classic
# assets before the wrapper can mint to them. (Any other user must do the same before their 1st mint.)
if [ -z "$TRUSTLINES_SET" ]; then
  echo "==> [3b] Adding PT/YT trustlines for $SOURCE..."
  stellar tx new change-trust --source-account "$SOURCE" "${NET_ARGS[@]}" --line "$PT_ASSET" >/dev/null 2>&1 || true
  stellar tx new change-trust --source-account "$SOURCE" "${NET_ARGS[@]}" --line "$YT_ASSET" >/dev/null 2>&1 || true
  save_state TRUSTLINES_SET 1
  echo "    trustlines set"
else
  echo "==> [3b] PT/YT trustlines already set — skipping."
fi

# Strategy: deploy and initialize are separate checkpoints (the run could die between them).
if [ -z "$STRATEGY" ]; then
  echo "==> [4/8] Deploying the Blend strategy adapter..."
  S=$(stellar contract deploy --wasm "$STRAT_WASM" --source-account "$SOURCE" "${NET_ARGS[@]}" \
    -- --admin "$ADMIN_ADDR")
  save_state STRATEGY "$S"
  echo "    strategy = $STRATEGY"
else
  echo "==> [4/8] strategy already deployed ($STRATEGY) — skipping deploy."
fi
if [ -z "$STRATEGY_INIT" ]; then
  echo "    initializing strategy..."
  stellar contract invoke --id "$STRATEGY" --source-account "$SOURCE" "${NET_ARGS[@]}" \
    -- initialize \
       --wrapper "$WRAPPER" \
       --pool "$BLEND_POOL" \
       --underlying "$USDC_SAC" \
       --max_apr_bps "$MAX_APR_BPS" >/dev/null
  save_state STRATEGY_INIT 1
  echo "    strategy initialized (Blend FixedV2 + Circle USDC)"
else
  echo "    strategy already initialized — skipping (re-init would panic AlreadyInitialized)."
fi

if [ -z "$WRAPPER_INIT" ]; then
  echo "==> [5/8] Initializing the wrapper..."
  stellar contract invoke --id "$WRAPPER" --source-account "$SOURCE" "${NET_ARGS[@]}" \
    -- initialize \
       --strategy "$STRATEGY" \
       --pt_token "$PT_SAC" \
       --yt_token "$YT_SAC" \
       --maturity "$MATURITY" >/dev/null
  save_state WRAPPER_INIT 1
  echo "    wrapper initialized"
else
  echo "==> [5/8] wrapper already initialized — skipping."
fi

if [ -z "$VAULT" ]; then
  echo "==> [6/8] Deploying the Fixed-Rate Vault..."
  V=$(stellar contract deploy --wasm "$VAULT_WASM" --source-account "$SOURCE" "${NET_ARGS[@]}" \
    -- --admin "$ADMIN_ADDR")
  save_state VAULT "$V"
  echo "    vault = $VAULT"
else
  echo "==> [6/8] vault already deployed ($VAULT) — skipping deploy."
fi
if [ -z "$VAULT_INIT" ]; then
  echo "    initializing vault..."
  stellar contract invoke --id "$VAULT" --source-account "$SOURCE" "${NET_ARGS[@]}" \
    -- initialize \
       --wrapper "$WRAPPER" \
       --underlying "$USDC_SAC" \
       --rate_bps "$VAULT_RATE_BPS" \
       --max_rate_bps "$VAULT_MAX_RATE_BPS" >/dev/null
  save_state VAULT_INIT 1
  echo "    vault initialized (rate=${VAULT_RATE_BPS}bps, ceiling=${VAULT_MAX_RATE_BPS}bps)"
else
  echo "    vault already initialized — skipping."
fi

if [ "$VAULT_SEED_AMOUNT" -gt 0 ] && [ -z "$VAULT_SEEDED" ]; then
  echo "==> [6b] Seeding the vault with $VAULT_SEED_AMOUNT USDC base units of PT capacity (REAL USDC)..."
  stellar contract invoke --id "$VAULT" --source-account "$SOURCE" "${NET_ARGS[@]}" \
    -- seed --from "$ADMIN_ADDR" --amount "$VAULT_SEED_AMOUNT" >/dev/null
  save_state VAULT_SEEDED 1
  echo "    vault seeded"
elif [ -n "$VAULT_SEEDED" ]; then
  echo "==> [6b] vault already seeded — skipping."
else
  echo "==> [6b] Skipping vault seed (VAULT_SEED_AMOUNT=0). Seed later via vault.seed once verified."
fi

if [ -z "$MARKET" ]; then
  echo "==> [7/8] Deploying the Market (PT/USDC time-decay AMM)..."
  M=$(stellar contract deploy --wasm "$MARKET_WASM" --source-account "$SOURCE" "${NET_ARGS[@]}" \
    -- --admin "$ADMIN_ADDR")
  save_state MARKET "$M"
  echo "    market = $MARKET"
else
  echo "==> [7/8] market already deployed ($MARKET) — skipping deploy."
fi
if [ -z "$MARKET_INIT" ]; then
  echo "    initializing market..."
  stellar contract invoke --id "$MARKET" --source-account "$SOURCE" "${NET_ARGS[@]}" \
    -- initialize \
       --wrapper "$WRAPPER" \
       --pt "$PT_SAC" \
       --usdc "$USDC_SAC" \
       --maturity "$MATURITY" \
       --fee_bps "$MARKET_FEE_BPS" \
       --max_fee_bps "$MARKET_MAX_FEE_BPS" \
       --scalar_root "$MARKET_SCALAR_ROOT" \
       --rate_anchor "$MARKET_RATE_ANCHOR" >/dev/null
  save_state MARKET_INIT 1
  echo "    market initialized (fee=${MARKET_FEE_BPS}bps, anchor=par, root=${MARKET_SCALAR_ROOT})"
else
  echo "    market already initialized — skipping."
fi

# Verify the market ↔ wrapper binding by READING IT BACK from chain, on every run.
#
# `market::initialize` already refuses a mismatched pairing (MaturityMismatch = 86,
# PtTokenMismatch = 87), so a bad init could not have landed — but that only proves the arguments
# THIS script passed were consistent. Reading the views back also proves the state file is not
# stale: if MARKET points at an old contract deployed before the cross-check existed, or at a pool
# built against a different wrapper, this is what catches it. Pure simulation, costs nothing.
read_view() {  # read_view <contract-id> <no-arg view fn> -> value, or "" if unreadable
  local out
  out=$(stellar contract invoke --id "$1" --source-account "$SOURCE" "${NET_ARGS[@]}" -- "$2" 2>/dev/null) || return 0
  printf '%s' "$out" | tr -d '"' | tr -d '[:space:]'
}
echo "    verifying the market <-> wrapper binding on chain..."
MKT_WRAPPER=$(read_view "$MARKET" wrapper)
MKT_MATURITY=$(read_view "$MARKET" maturity)
MKT_PT=$(read_view "$MARKET" pt_token)
if [ -z "$MKT_WRAPPER$MKT_MATURITY$MKT_PT" ]; then
  echo "    ⚠ could not read the market's views (RPC issue, or a pre-cross-check build with no"
  echo "      wrapper() view). VERIFY MANUALLY before seeding — see MAINNET.md."
else
  BINDING_OK=1
  if [ "$MKT_WRAPPER" != "$WRAPPER" ]; then
    echo "    ✗ market.wrapper()  = ${MKT_WRAPPER:-<unreadable>}  expected $WRAPPER"; BINDING_OK=0
  fi
  if [ "$MKT_MATURITY" != "$MATURITY" ]; then
    echo "    ✗ market.maturity() = ${MKT_MATURITY:-<unreadable>}  expected $MATURITY"; BINDING_OK=0
  fi
  if [ "$MKT_PT" != "$PT_SAC" ]; then
    echo "    ✗ market.pt_token() = ${MKT_PT:-<unreadable>}  expected $PT_SAC"; BINDING_OK=0
  fi
  if [ "$BINDING_OK" = "1" ]; then
    echo "    ✓ market is bound to wrapper $WRAPPER — maturity and PT match on chain"
  else
    echo
    echo "ERROR: the live market is NOT the one this state file describes. Do NOT seed it."
    echo "       A market whose maturity differs from the wrapper's is a standing arbitrage against"
    echo "       the LPs (past the wrapper's maturity the curve keeps quoting PT at a discount while"
    echo "       every PT already redeems at par). Redeploy the market with:"
    echo "           REDEPLOY=market bash scripts/deploy_mainnet.sh"
    exit 1
  fi
fi

if [ "$MARKET_SEED_AMOUNT" -gt 0 ] && [ -z "$MARKET_SEEDED" ]; then
  echo "==> [7b] Seeding the market with $MARKET_SEED_AMOUNT USDC base units of liquidity per side (REAL USDC)..."
  # Two separate txs (mint PT, then add_liquidity) get two checkpoints so a stop between them doesn't
  # double-mint on resume. MARKET_MINTED guards the PT mint; MARKET_SEEDED guards the add_liquidity.
  if [ -z "${MARKET_MINTED:-}" ]; then
    stellar contract invoke --id "$WRAPPER" --source-account "$SOURCE" "${NET_ARGS[@]}" \
      -- mint --user "$ADMIN_ADDR" --amount "$MARKET_SEED_AMOUNT" >/dev/null
    save_state MARKET_MINTED 1
    echo "    minted $MARKET_SEED_AMOUNT PT for the seed"
  else
    echo "    PT for the seed already minted — skipping mint."
  fi
  stellar contract invoke --id "$MARKET" --source-account "$SOURCE" "${NET_ARGS[@]}" \
    -- add_liquidity --lp "$ADMIN_ADDR" --pt_in "$MARKET_SEED_AMOUNT" --usdc_in "$MARKET_SEED_AMOUNT" >/dev/null
  save_state MARKET_SEEDED 1
  echo "    market seeded (balanced PT/USDC pool opened at par)"
elif [ -n "$MARKET_SEEDED" ]; then
  echo "==> [7b] market already seeded — skipping."
else
  echo "==> [7b] Skipping market seed (MARKET_SEED_AMOUNT=0). Add liquidity later via market.add_liquidity."
fi

save_state DEPLOY_COMPLETE 1
echo "==> [8/8] Done. Summary:"
cat <<EOF

  ┌─ Spield v2 deployed on MAINNET ─────────────────────────────────
  │ wrapper   = $WRAPPER
  │ strategy  = $STRATEGY
  │ vault     = $VAULT
  │ market    = $MARKET
  │ PT (SAC)  = $PT_SAC
  │ YT (SAC)  = $YT_SAC
  │ PT/YT iss = $ISSUER_ADDR
  │ Blend pool= $BLEND_POOL  (FixedV2)
  │ USDC      = $USDC_SAC
  └──────────────────────────────────────────────────────────────────

NEXT STEPS (see MAINNET.md §6 — none are required to operate; do them as TVL grows):
  1) Verify the live code hashes match what you built (always worth doing):
       stellar contract invoke --id <each> ... -- code_hash
  2) Start the off-chain solvency monitor against the wrapper (free, pure reads):
       node scripts/solvency_monitor.mjs --wrapper $WRAPPER --rpc $RPC_URL --interval 60
  2b) SCHEDULE FOR MATURITY ($MATURITY): pin the YT yield ceiling, permissionless + idempotent.
      YT earns for the term and no longer; this records the b_rate at maturity, after which a
      matured YT generates nothing. Any post-maturity interaction pins it automatically, but a late
      pin over-pays a little post-maturity growth — so run this as close to maturity as possible:
       stellar contract invoke --id $WRAPPER --source-account $SOURCE ... -- stamp_maturity_rate
  3) RECOMMENDED for real TVL: rotate ALL FOUR admins to a MULTISIG (the deployer is a hot key):
       propose_admin --new_admin <MULTISIG>   then the multisig signs   accept_admin
     Until then, keep the deployer secret offline / hardware-backed.

Frontend: record these in your mainnet env (we'll wire env-driven config later):
  VITE_NETWORK=mainnet
  VITE_WRAPPER=$WRAPPER
  VITE_STRATEGY=$STRATEGY
  VITE_VAULT=$VAULT
  VITE_MARKET=$MARKET
  VITE_PT=$PT_SAC
  VITE_YT=$YT_SAC
  VITE_USDC=$USDC_SAC

──────────────────────────────────────────────────────────────────────
OFF-CHAIN FILES THAT PIN THESE ADDRESSES — update them now, or the app keeps talking to whatever
was deployed before. The env var alone is NOT enough: it falls back to a hardcoded profile value,
so changing only VITE_* leaves a stale default that ships whenever the env var is unset.

  1) MAINNETCONTRACTADDRESSES.md
       - the address table
       - the VITE_MARKET line at the bottom
  2) website/frontend/src/lib/config.ts
       - the mainnet profile's hardcoded ids (\`wrapper:\`/\`vault:\`/\`market:\` ~line 109)
       - the env overrides (~line 141) read VITE_* and DEFAULT to the profile above

Quick check that nothing stale is left (should print only the new ids):
  grep -rn "$MARKET" MAINNETCONTRACTADDRESSES.md ../../frontend/src/lib/config.ts
EOF
