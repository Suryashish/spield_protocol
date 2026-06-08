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
# Usage:
#   bash scripts/deploy_mainnet.sh                          # uses spield_deployer + spield_issuer_mainnet
#   SOURCE=mykey ISSUER=myissuer bash scripts/deploy_mainnet.sh
#   YES=1 bash scripts/deploy_mainnet.sh                    # skip the interactive confirmation (CI)
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
echo

# Hard guard: confirm before doing anything irreversible.
if [ "${YES:-0}" != "1" ]; then
  read -r -p "Type 'deploy mainnet' to proceed: " CONFIRM
  if [ "$CONFIRM" != "deploy mainnet" ]; then
    echo "Aborted (no confirmation)."; exit 1
  fi
fi

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

echo "==> [2/8] Deploying the wrapper contract (need its address to admin PT/YT)..."
# admin bound ATOMICALLY by __constructor at deploy (after `--`), so the deploy->initialize window
# can't be front-run: only this admin can complete initialize(). Rotate to a MULTISIG post-deploy.
# NOTE: admin = the deployer (a single hot key). That is functionally fine to KEEP — a single-key
# admin runs the protocol identically, and admin powers can't steal funds / mint unbacked tokens /
# bypass the upgrade timelock. Rotating to a multisig (§6 in MAINNET.md) is RECOMMENDED for real
# TVL (so one key compromise isn't fatal), not required to operate.
WRAPPER=$(stellar contract deploy --wasm "$WRAP_WASM" --source-account "$SOURCE" "${NET_ARGS[@]}" \
  -- --admin "$ADMIN_ADDR")
echo "    wrapper = $WRAPPER"

echo "==> [3/8] Creating PT and YT assets + SACs (issued by $ISSUER), handing admin to the wrapper..."
PT_ASSET="SPLDPT:$ISSUER_ADDR"
YT_ASSET="SPLDYT:$ISSUER_ADDR"

stellar contract asset deploy --asset "$PT_ASSET" --source-account "$ISSUER" "${NET_ARGS[@]}" >/dev/null 2>&1 || true
stellar contract asset deploy --asset "$YT_ASSET" --source-account "$ISSUER" "${NET_ARGS[@]}" >/dev/null 2>&1 || true
PT_SAC=$(stellar contract id asset --asset "$PT_ASSET" "${NET_ARGS[@]}")
YT_SAC=$(stellar contract id asset --asset "$YT_ASSET" "${NET_ARGS[@]}")
echo "    PT SAC = $PT_SAC"
echo "    YT SAC = $YT_SAC"

# Hand SAC admin to the wrapper so it (not the issuer) controls mint/burn.
stellar contract invoke --id "$PT_SAC" --source-account "$ISSUER" "${NET_ARGS[@]}" \
  -- set_admin --new_admin "$WRAPPER" >/dev/null
stellar contract invoke --id "$YT_SAC" --source-account "$ISSUER" "${NET_ARGS[@]}" \
  -- set_admin --new_admin "$WRAPPER" >/dev/null
echo "    PT/YT admin -> wrapper"

# The deployer (who will receive PT/YT when it seeds the market) needs trustlines for these classic
# assets before the wrapper can mint to them. (Any other user must do the same before their 1st mint.)
echo "==> [3b] Adding PT/YT trustlines for $SOURCE..."
stellar tx new change-trust --source-account "$SOURCE" "${NET_ARGS[@]}" --line "$PT_ASSET" >/dev/null 2>&1 || true
stellar tx new change-trust --source-account "$SOURCE" "${NET_ARGS[@]}" --line "$YT_ASSET" >/dev/null 2>&1 || true
echo "    trustlines set"

echo "==> [4/8] Deploying + initializing the Blend strategy adapter..."
STRATEGY=$(stellar contract deploy --wasm "$STRAT_WASM" --source-account "$SOURCE" "${NET_ARGS[@]}" \
  -- --admin "$ADMIN_ADDR")
echo "    strategy = $STRATEGY"
stellar contract invoke --id "$STRATEGY" --source-account "$SOURCE" "${NET_ARGS[@]}" \
  -- initialize \
     --wrapper "$WRAPPER" \
     --pool "$BLEND_POOL" \
     --underlying "$USDC_SAC" \
     --max_apr_bps "$MAX_APR_BPS" >/dev/null
echo "    strategy initialized (Blend FixedV2 + Circle USDC)"

echo "==> [5/8] Initializing the wrapper..."
stellar contract invoke --id "$WRAPPER" --source-account "$SOURCE" "${NET_ARGS[@]}" \
  -- initialize \
     --strategy "$STRATEGY" \
     --pt_token "$PT_SAC" \
     --yt_token "$YT_SAC" \
     --maturity "$MATURITY" >/dev/null
echo "    wrapper initialized"

echo "==> [6/8] Deploying + initializing the Fixed-Rate Vault..."
VAULT=$(stellar contract deploy --wasm "$VAULT_WASM" --source-account "$SOURCE" "${NET_ARGS[@]}" \
  -- --admin "$ADMIN_ADDR")
echo "    vault = $VAULT"
stellar contract invoke --id "$VAULT" --source-account "$SOURCE" "${NET_ARGS[@]}" \
  -- initialize \
     --wrapper "$WRAPPER" \
     --underlying "$USDC_SAC" \
     --rate_bps "$VAULT_RATE_BPS" \
     --max_rate_bps "$VAULT_MAX_RATE_BPS" >/dev/null
echo "    vault initialized (rate=${VAULT_RATE_BPS}bps, ceiling=${VAULT_MAX_RATE_BPS}bps)"

if [ "$VAULT_SEED_AMOUNT" -gt 0 ]; then
  echo "==> [6b] Seeding the vault with $VAULT_SEED_AMOUNT USDC base units of PT capacity (REAL USDC)..."
  stellar contract invoke --id "$VAULT" --source-account "$SOURCE" "${NET_ARGS[@]}" \
    -- seed --from "$ADMIN_ADDR" --amount "$VAULT_SEED_AMOUNT" >/dev/null
  echo "    vault seeded"
else
  echo "==> [6b] Skipping vault seed (VAULT_SEED_AMOUNT=0). Seed later via vault.seed once verified."
fi

echo "==> [7/8] Deploying + initializing the Market (PT/USDC time-decay AMM)..."
MARKET=$(stellar contract deploy --wasm "$MARKET_WASM" --source-account "$SOURCE" "${NET_ARGS[@]}" \
  -- --admin "$ADMIN_ADDR")
echo "    market = $MARKET"
stellar contract invoke --id "$MARKET" --source-account "$SOURCE" "${NET_ARGS[@]}" \
  -- initialize \
     --pt "$PT_SAC" \
     --usdc "$USDC_SAC" \
     --maturity "$MATURITY" \
     --fee_bps "$MARKET_FEE_BPS" \
     --max_fee_bps "$MARKET_MAX_FEE_BPS" \
     --scalar_root "$MARKET_SCALAR_ROOT" \
     --rate_anchor "$MARKET_RATE_ANCHOR" >/dev/null
echo "    market initialized (fee=${MARKET_FEE_BPS}bps, anchor=par, root=${MARKET_SCALAR_ROOT})"

if [ "$MARKET_SEED_AMOUNT" -gt 0 ]; then
  echo "==> [7b] Seeding the market with $MARKET_SEED_AMOUNT USDC base units of liquidity per side (REAL USDC)..."
  stellar contract invoke --id "$WRAPPER" --source-account "$SOURCE" "${NET_ARGS[@]}" \
    -- mint --user "$ADMIN_ADDR" --amount "$MARKET_SEED_AMOUNT" >/dev/null
  stellar contract invoke --id "$MARKET" --source-account "$SOURCE" "${NET_ARGS[@]}" \
    -- add_liquidity --lp "$ADMIN_ADDR" --pt_in "$MARKET_SEED_AMOUNT" --usdc_in "$MARKET_SEED_AMOUNT" >/dev/null
  echo "    market seeded (balanced PT/USDC pool opened at par)"
else
  echo "==> [7b] Skipping market seed (MARKET_SEED_AMOUNT=0). Add liquidity later via market.add_liquidity."
fi

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
EOF
