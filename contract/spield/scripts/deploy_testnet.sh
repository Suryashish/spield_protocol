#!/usr/bin/env bash
#
# Spield v2 — testnet deploy against the real Blend TestnetV2 pool.
#
# Prereqs:
#   * Run inside WSL with the Stellar CLI + Rust toolchain (see howtoaccesswsl.md).
#   * The deployer identity (default: alice) is funded with XLM AND holds some of the Blend
#     testnet USDC (USDC:GATALTGT...). See TESTNET.md for how to get USDC to alice.
#
# What it does: builds + optimizes the WASMs, deploys PT + YT SACs (admin handed to the wrapper),
# deploys + initializes the strategy/wrapper/vault/market, optionally seeds vault + market, then
# prints the addresses and the exact invoke commands to exercise mint/claim/redeem.
#
# RESUMABLE: every address/checkpoint is written to a STATE FILE the instant it's created
# (default: scripts/deploy_testnet.state). If the script stops midway (e.g. an RPC submission
# timeout), just re-run the same command — it reloads the state file and SKIPS every completed
# step, picking up where it left off. A tx that never landed costs nothing. Use FRESH=1 to start
# a brand-new deployment (wipes the state file).
#
# Usage:
#   bash scripts/deploy_testnet.sh                 # uses alice + spield_issuer_v2
#   SOURCE=bob bash scripts/deploy_testnet.sh      # different deployer identity
#   ISSUER=myissuer bash scripts/deploy_testnet.sh # different PT/YT issuer
#   FRESH=1 bash scripts/deploy_testnet.sh         # ignore + overwrite existing state (start over)
set -euo pipefail

SOURCE="${SOURCE:-alice}"
NETWORK="${NETWORK:-testnet}"
# A DEDICATED issuer for the PT/YT assets — must NOT be a user that will hold PT/YT, because a
# Stellar asset's issuer account can't receive its own asset ("operation invalid on issuer").
# This account only issues + immediately hands SAC admin to the wrapper; it then does nothing.
# NOTE: use a FRESH issuer for a fresh deployment. The PT/YT SAC address is deterministic from
# (asset code + issuer + network); reusing an old issuer would yield SACs whose admin is the OLD
# wrapper (not this issuer), so the set_admin step below would fail. spield_issuer_v2 is the v2
# (post-update) testnet issuer.
ISSUER="${ISSUER:-spield_issuer_v2}"

# Network args for the CLI. By DEFAULT we use the named network (`--network testnet`), which lets the
# CLI resolve BOTH the RPC and the passphrase from its built-in config. If you override RPC_URL to
# swap a flaky endpoint, the CLI then also requires an explicit passphrase, so we pass both together.
TESTNET_PASSPHRASE="Test SDF Network ; September 2015"
if [ -n "${RPC_URL:-}" ]; then
  NET_ARGS=(--rpc-url "$RPC_URL" --network-passphrase "${NETWORK_PASSPHRASE:-$TESTNET_PASSPHRASE}")
else
  NET_ARGS=(--network "$NETWORK")
fi

# --- Real Blend testnet addresses (verified from blend-utils/testnet.contracts.json) ---
BLEND_POOL="${BLEND_POOL:-CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF}"
USDC_SAC="${USDC_SAC:-CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU}"
USDC_ASSET="${USDC_ASSET:-USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56}"

# Rate sanity bound: max ANNUAL b_rate growth, in bps (the bound is pro-rated by elapsed time on
# each read, so read frequency no longer matters — calibrate ONLY against Blend's real max borrow
# APR). 30000 = 300% APR, generously above any real Blend supply rate; defence-in-depth.
MAX_APR_BPS="${MAX_APR_BPS:-30000}"
# Maturity: ~30 days from now (unix seconds). Pinned into the state file on the first run so all
# four contracts share one value across resumes.
MATURITY_DAYS="${MATURITY_DAYS:-30}"
MATURITY="${MATURITY:-$(( $(date +%s) + MATURITY_DAYS*24*60*60 ))}"

# --- Fixed-Rate Vault config ---
# The fixed APR the vault quotes to depositors, in basis points (500 = 5.00%).
VAULT_RATE_BPS="${VAULT_RATE_BPS:-500}"
# Hard ceiling on any future quoted rate (a guardrail; admin can never exceed it).
VAULT_MAX_RATE_BPS="${VAULT_MAX_RATE_BPS:-2000}"
# Initial PT inventory to seed (USDC base units, 7 decimals). This is the vault's coupon capacity
# at launch — it must hold enough PT to back the coupon on the first deposits. 0 = skip seeding
# (you can seed later via `vault.seed`). Default 5 USDC of capacity for the demo.
VAULT_SEED_AMOUNT="${VAULT_SEED_AMOUNT:-50000000}"

# --- Market (PT/USDC time-decay AMM) config ---
# Swap fee in basis points (30 = 0.30%) and the hard ceiling the admin may ever set.
MARKET_FEE_BPS="${MARKET_FEE_BPS:-30}"
MARKET_MAX_FEE_BPS="${MARKET_MAX_FEE_BPS:-100}"
# Curve params (SCALAR_12 = 1e12 fixed point). The anchor is PT's price at a balanced (50/50) pool;
# we anchor at PAR (1.0 = 1e12) so PT price converges to par at maturity. The scalar root sets curve
# steepness (rateScalar = scalarRoot / yearsToMaturity); 40·SCALAR_12 gives bounded price impact.
MARKET_SCALAR_ROOT="${MARKET_SCALAR_ROOT:-40000000000000}"  # 40 * 1e12
MARKET_RATE_ANCHOR="${MARKET_RATE_ANCHOR:-1000000000000}"   # 1.0 * 1e12 (par)
# Initial liquidity to seed the pool (USDC base units, 7 decimals), supplied to BOTH sides. The
# deployer mints this much PT via the wrapper, then adds (PT_in = USDC_in = this) as liquidity, so
# it needs ~2x this in USDC (one part minted into PT, one part as the pool's USDC). 0 = skip seeding
# (add liquidity later via market.add_liquidity). Default 5 USDC per side.
MARKET_SEED_AMOUNT="${MARKET_SEED_AMOUNT:-50000000}"

# ─── Checkpoint / resume state ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="${STATE_FILE:-$SCRIPT_DIR/deploy_testnet.state}"
[ "${FRESH:-0}" = "1" ] && rm -f "$STATE_FILE"

# Variables that may be restored from the state file (declare so `set -u` is happy when absent).
WRAPPER=""; STRATEGY=""; VAULT=""; MARKET=""; PT_SAC=""; YT_SAC=""
PT_ADMIN_SET=""; YT_ADMIN_SET=""; TRUSTLINES_SET=""
STRATEGY_INIT=""; WRAPPER_INIT=""; VAULT_INIT=""; MARKET_INIT=""
VAULT_SEEDED=""; MARKET_MINTED=""; MARKET_SEEDED=""; SAVED_MATURITY=""; DEPLOY_COMPLETE=""

if [ -f "$STATE_FILE" ]; then
  echo "==> Resuming from existing state file: $STATE_FILE"
  # shellcheck disable=SC1090
  source "$STATE_FILE"
  [ -n "$SAVED_MATURITY" ] && MATURITY="$SAVED_MATURITY"
fi

# Append a KEY=value checkpoint and set it live in this shell.
save_state() { printf '%s=%q\n' "$1" "$2" >> "$STATE_FILE"; printf -v "$1" '%s' "$2"; }

ADMIN_ADDR=$(stellar keys address "$SOURCE")
ISSUER_ADDR=$(stellar keys address "$ISSUER")
PT_ASSET="SPLDPT:$ISSUER_ADDR"
YT_ASSET="SPLDYT:$ISSUER_ADDR"

echo "==> Deployer ($SOURCE): $ADMIN_ADDR"
echo "==> PT/YT issuer ($ISSUER): $ISSUER_ADDR"
echo "==> Blend pool:  $BLEND_POOL"
echo "==> USDC SAC:    $USDC_SAC"
echo "==> Maturity:    $MATURITY ($(date -d @"$MATURITY" 2>/dev/null || echo "+${MATURITY_DAYS}d"))"
echo "==> State file:  $STATE_FILE"
echo

# Already-finished run? Just reprint and exit.
if [ -n "$DEPLOY_COMPLETE" ]; then
  echo "==> This deploy already completed (per $STATE_FILE). Nothing to do."
  echo "    wrapper=$WRAPPER strategy=$STRATEGY vault=$VAULT market=$MARKET PT=$PT_SAC YT=$YT_SAC"
  echo "    (To start a brand-new deployment, run with FRESH=1.)"
  exit 0
fi

# Pin the maturity on the first run so every contract shares one value across resumes.
[ -z "$SAVED_MATURITY" ] && save_state SAVED_MATURITY "$MATURITY"

echo "==> [1/8] Building + optimizing WASMs (wasm-opt)..."
stellar contract build --optimize >/dev/null
WASM_DIR="target/wasm32v1-none/release"
pick_wasm() { if [ -f "$1.optimized.wasm" ]; then echo "$1.optimized.wasm"; else echo "$1.wasm"; fi; }
STRAT_WASM=$(pick_wasm "$WASM_DIR/spield_strategy")
WRAP_WASM=$(pick_wasm "$WASM_DIR/spield_wrapper")
VAULT_WASM=$(pick_wasm "$WASM_DIR/spield_vault")
MARKET_WASM=$(pick_wasm "$WASM_DIR/spield_market")

# The admin is bound ATOMICALLY by the contract's __constructor at deploy (passed after `--`), so
# the deploy→initialize window can't be front-run: only this admin can complete initialize().
if [ -z "$WRAPPER" ]; then
  echo "==> [2/8] Deploying the wrapper contract (need its address to admin PT/YT)..."
  save_state WRAPPER "$(stellar contract deploy --wasm "$WRAP_WASM" --source-account "$SOURCE" "${NET_ARGS[@]}" -- --admin "$ADMIN_ADDR")"
  echo "    wrapper = $WRAPPER"
else
  echo "==> [2/8] wrapper already deployed ($WRAPPER) — skipping."
fi

# PT/YT are classic assets issued by a DEDICATED issuer (not a user), wrapped as SACs; we then
# transfer SAC admin to the wrapper so only the wrapper mints/burns.
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

# Hand SAC admin to the wrapper so it (not the issuer) controls mint/burn (guarded per token).
if [ -z "$PT_ADMIN_SET" ]; then
  stellar contract invoke --id "$PT_SAC" --source-account "$ISSUER" "${NET_ARGS[@]}" -- set_admin --new_admin "$WRAPPER" >/dev/null
  save_state PT_ADMIN_SET 1; echo "    PT admin -> wrapper"
else echo "    PT admin already handed to wrapper — skipping."; fi
if [ -z "$YT_ADMIN_SET" ]; then
  stellar contract invoke --id "$YT_SAC" --source-account "$ISSUER" "${NET_ARGS[@]}" -- set_admin --new_admin "$WRAPPER" >/dev/null
  save_state YT_ADMIN_SET 1; echo "    YT admin -> wrapper"
else echo "    YT admin already handed to wrapper — skipping."; fi

# The deployer (who will receive PT/YT) needs trustlines for these classic assets before the
# wrapper can mint to them. (Any other user must do the same before their first mint.)
if [ -z "$TRUSTLINES_SET" ]; then
  echo "==> [3b] Adding PT/YT trustlines for $SOURCE..."
  stellar tx new change-trust --source-account "$SOURCE" "${NET_ARGS[@]}" --line "$PT_ASSET" >/dev/null 2>&1 || true
  stellar tx new change-trust --source-account "$SOURCE" "${NET_ARGS[@]}" --line "$YT_ASSET" >/dev/null 2>&1 || true
  save_state TRUSTLINES_SET 1; echo "    trustlines set"
else echo "==> [3b] PT/YT trustlines already set — skipping."; fi

# Strategy: deploy + init are separate checkpoints.
if [ -z "$STRATEGY" ]; then
  echo "==> [4/8] Deploying the Blend strategy adapter..."
  save_state STRATEGY "$(stellar contract deploy --wasm "$STRAT_WASM" --source-account "$SOURCE" "${NET_ARGS[@]}" -- --admin "$ADMIN_ADDR")"
  echo "    strategy = $STRATEGY"
else echo "==> [4/8] strategy already deployed ($STRATEGY) — skipping deploy."; fi
if [ -z "$STRATEGY_INIT" ]; then
  stellar contract invoke --id "$STRATEGY" --source-account "$SOURCE" "${NET_ARGS[@]}" \
    -- initialize --wrapper "$WRAPPER" --pool "$BLEND_POOL" --underlying "$USDC_SAC" --max_apr_bps "$MAX_APR_BPS" >/dev/null
  save_state STRATEGY_INIT 1; echo "    strategy initialized"
else echo "    strategy already initialized — skipping."; fi

if [ -z "$WRAPPER_INIT" ]; then
  echo "==> [5/8] Initializing the wrapper..."
  stellar contract invoke --id "$WRAPPER" --source-account "$SOURCE" "${NET_ARGS[@]}" \
    -- initialize --strategy "$STRATEGY" --pt_token "$PT_SAC" --yt_token "$YT_SAC" --maturity "$MATURITY" >/dev/null
  save_state WRAPPER_INIT 1; echo "    wrapper initialized"
else echo "==> [5/8] wrapper already initialized — skipping."; fi

# The vault sits on top of the wrapper: it inherits PT/YT/maturity from it; we pass the wrapper +
# underlying + the fixed-rate config. admin bound atomically at deploy.
if [ -z "$VAULT" ]; then
  echo "==> [6/8] Deploying the Fixed-Rate Vault..."
  save_state VAULT "$(stellar contract deploy --wasm "$VAULT_WASM" --source-account "$SOURCE" "${NET_ARGS[@]}" -- --admin "$ADMIN_ADDR")"
  echo "    vault = $VAULT"
else echo "==> [6/8] vault already deployed ($VAULT) — skipping deploy."; fi
if [ -z "$VAULT_INIT" ]; then
  stellar contract invoke --id "$VAULT" --source-account "$SOURCE" "${NET_ARGS[@]}" \
    -- initialize --wrapper "$WRAPPER" --underlying "$USDC_SAC" --rate_bps "$VAULT_RATE_BPS" --max_rate_bps "$VAULT_MAX_RATE_BPS" >/dev/null
  save_state VAULT_INIT 1; echo "    vault initialized (rate=${VAULT_RATE_BPS}bps, ceiling=${VAULT_MAX_RATE_BPS}bps)"
else echo "    vault already initialized — skipping."; fi

# Seed the vault's PT inventory so it has coupon capacity. The seeder pulls USDC; the vault mints
# PT+YT into its own inventory (pure capacity, no liability).
if [ "$VAULT_SEED_AMOUNT" -gt 0 ] && [ -z "$VAULT_SEEDED" ]; then
  echo "==> [6b] Seeding the vault with $VAULT_SEED_AMOUNT USDC base units of PT capacity..."
  stellar contract invoke --id "$VAULT" --source-account "$SOURCE" "${NET_ARGS[@]}" -- seed --from "$ADMIN_ADDR" --amount "$VAULT_SEED_AMOUNT" >/dev/null
  save_state VAULT_SEEDED 1; echo "    vault seeded"
elif [ -n "$VAULT_SEEDED" ]; then echo "==> [6b] vault already seeded — skipping."
else echo "==> [6b] Skipping vault seed (VAULT_SEED_AMOUNT=0); seed later via vault.seed."; fi

# The market trades the wrapper's PT against USDC on the log curve. PT/USDC SAC + maturity must
# match the wrapper. admin bound atomically at deploy.
if [ -z "$MARKET" ]; then
  echo "==> [7/8] Deploying the Market (PT/USDC time-decay AMM)..."
  save_state MARKET "$(stellar contract deploy --wasm "$MARKET_WASM" --source-account "$SOURCE" "${NET_ARGS[@]}" -- --admin "$ADMIN_ADDR")"
  echo "    market = $MARKET"
else echo "==> [7/8] market already deployed ($MARKET) — skipping deploy."; fi
if [ -z "$MARKET_INIT" ]; then
  stellar contract invoke --id "$MARKET" --source-account "$SOURCE" "${NET_ARGS[@]}" \
    -- initialize --pt "$PT_SAC" --usdc "$USDC_SAC" --maturity "$MATURITY" --fee_bps "$MARKET_FEE_BPS" --max_fee_bps "$MARKET_MAX_FEE_BPS" --scalar_root "$MARKET_SCALAR_ROOT" --rate_anchor "$MARKET_RATE_ANCHOR" >/dev/null
  save_state MARKET_INIT 1; echo "    market initialized (fee=${MARKET_FEE_BPS}bps, anchor=par, root=${MARKET_SCALAR_ROOT})"
else echo "    market already initialized — skipping."; fi

# Seed initial liquidity: mint PT via the wrapper to the deployer (checkpoint), then add equal PT +
# USDC as the first liquidity (checkpoint). Opens the pool at proportion 0.5 (PT price = par).
if [ "$MARKET_SEED_AMOUNT" -gt 0 ] && [ -z "$MARKET_SEEDED" ]; then
  echo "==> [7b] Seeding the market with $MARKET_SEED_AMOUNT USDC base units of liquidity per side..."
  if [ -z "$MARKET_MINTED" ]; then
    stellar contract invoke --id "$WRAPPER" --source-account "$SOURCE" "${NET_ARGS[@]}" -- mint --user "$ADMIN_ADDR" --amount "$MARKET_SEED_AMOUNT" >/dev/null
    save_state MARKET_MINTED 1; echo "    minted $MARKET_SEED_AMOUNT PT for the seed"
  else echo "    PT for the seed already minted — skipping mint."; fi
  stellar contract invoke --id "$MARKET" --source-account "$SOURCE" "${NET_ARGS[@]}" -- add_liquidity --lp "$ADMIN_ADDR" --pt_in "$MARKET_SEED_AMOUNT" --usdc_in "$MARKET_SEED_AMOUNT" >/dev/null
  save_state MARKET_SEEDED 1; echo "    market seeded (balanced PT/USDC pool opened at par)"
elif [ -n "$MARKET_SEEDED" ]; then echo "==> [7b] market already seeded — skipping."
else echo "==> [7b] Skipping market seed (MARKET_SEED_AMOUNT=0); add liquidity later via market.add_liquidity."; fi

save_state DEPLOY_COMPLETE 1

echo "==> [8/8] Done. Summary:"
cat <<EOF

  ┌─ Spield v2 deployed on $NETWORK ────────────────────────────────
  │ wrapper   = $WRAPPER
  │ strategy  = $STRATEGY
  │ vault     = $VAULT
  │ market    = $MARKET
  │ PT (SAC)  = $PT_SAC
  │ YT (SAC)  = $YT_SAC
  │ Blend pool= $BLEND_POOL
  │ USDC      = $USDC_SAC
  └─────────────────────────────────────────────────────────────────

Frontend: paste these into frontend/src/lib/config.ts (CONTRACTS):
  wrapper: '$WRAPPER',
  strategy: '$STRATEGY',
  vault: '$VAULT',
  market: '$MARKET',
  pt: '$PT_SAC',
  yt: '$YT_SAC',
  usdc: '$USDC_SAC',

Exercise the raw wrapper (USDC has 7 decimals; 10 USDC = 100000000):

# Deposit 10 USDC -> get 10 PT + 10 YT, returns a position id (likely 0):
stellar contract invoke --id $WRAPPER --source-account $SOURCE --network $NETWORK \\
  -- mint --user $ADMIN_ADDR --amount 100000000

# See the live position value (principal + claimable yield):
stellar contract invoke --id $WRAPPER --source-account $SOURCE --network $NETWORK \\
  -- position_value --position_id 0

# Protocol solvency (backing, principal, unclaimed):
stellar contract invoke --id $WRAPPER --source-account $SOURCE --network $NETWORK \\
  -- solvency

Exercise the Fixed-Rate Vault (the flagship "lock X% fixed" product):

# Quote the payout a 10 USDC deposit would lock in right now (payout, coupon, rate_bps):
stellar contract invoke --id $VAULT --source-account $SOURCE --network $NETWORK \\
  -- quote --amount 100000000

# Vault health (pt_inventory, yt_inventory, total_liability, coupon_capacity, rate_bps, maturity):
stellar contract invoke --id $VAULT --source-account $SOURCE --network $NETWORK \\
  -- stats

# Deposit 10 USDC at the fixed rate -> returns a receipt id (needs coupon capacity from the seed):
stellar contract invoke --id $VAULT --source-account $SOURCE --network $NETWORK \\
  -- deposit --user $ADMIN_ADDR --amount 100000000

# Harvest the vault's accrued YT yield into fresh PT capacity (permissionless, PAGINATED — pass how
# many positions to sweep this call; repeat to sweep the whole list a chunk at a time):
stellar contract invoke --id $VAULT --source-account $SOURCE --network $NETWORK \\
  -- harvest --max_positions 50

# Keep a long-dated position/receipt alive (permissionless TTL bump — anyone can call so a
# held-to-maturity bond never archives before maturity):
stellar contract invoke --id $WRAPPER --source-account $SOURCE --network $NETWORK \\
  -- bump_position --position_id 0
stellar contract invoke --id $VAULT --source-account $SOURCE --network $NETWORK \\
  -- bump_receipt --receipt_id 0

# After maturity ($MATURITY), redeem the receipt for principal + the fixed coupon:
stellar contract invoke --id $VAULT --source-account $SOURCE --network $NETWORK \\
  -- redeem --receipt_id 0

Exercise the Market (PT/USDC time-decay AMM):

# Pool reserves (pt, usdc) and the current PT price + implied APY (the headline number):
stellar contract invoke --id $MARKET --source-account $SOURCE --network $NETWORK \\
  -- reserves
stellar contract invoke --id $MARKET --source-account $SOURCE --network $NETWORK \\
  -- pt_price
stellar contract invoke --id $MARKET --source-account $SOURCE --network $NETWORK \\
  -- implied_apy

# Quote buying PT with 1 USDC (the "Earn Fixed" flow) / selling 1 PT for USDC:
stellar contract invoke --id $MARKET --source-account $SOURCE --network $NETWORK \\
  -- quote_usdc_for_pt --usdc_in 10000000
stellar contract invoke --id $MARKET --source-account $SOURCE --network $NETWORK \\
  -- quote_pt_for_usdc --pt_in 10000000

# Buy PT with 1 USDC (min_pt_out=0 to skip slippage guard in the demo):
stellar contract invoke --id $MARKET --source-account $SOURCE --network $NETWORK \\
  -- swap_exact_usdc_for_pt --trader $ADMIN_ADDR --usdc_in 10000000 --min_pt_out 0

# Add more liquidity (needs PT in your wallet first; mint via the wrapper):
stellar contract invoke --id $MARKET --source-account $SOURCE --network $NETWORK \\
  -- add_liquidity --lp $ADMIN_ADDR --pt_in 10000000 --usdc_in 10000000

──────────────────────────────────────────────────────────────────────
GOVERNANCE (mainnet-readiness items #1/#2/#3) — same surface on all four
contracts: wrapper, strategy, vault, market.

# 1) Rotate the admin to a MULTISIG (two-step; the new key must accept).
#    Step A — current admin proposes the new admin (e.g. a multisig G-address):
stellar contract invoke --id $WRAPPER --source-account $SOURCE --network $NETWORK \\
  -- propose_admin --new_admin <MULTISIG_ADDR>
#    Step B — the NEW admin signs accept_admin (proves it controls the key):
stellar contract invoke --id $WRAPPER --source-account <MULTISIG_SIGNER> --network $NETWORK \\
  -- accept_admin
#    (Repeat for strategy, vault, market. Before launch, ALL FOUR admins
#     should be a multisig, not a single hot key.)

# 2) Upgrade path is timelocked (default 24h; bounded 1h..30d). Schedule, wait, apply:
HASH=\$(stellar contract install --source-account $SOURCE --network $NETWORK --wasm <new.wasm>)
stellar contract invoke --id $WRAPPER --source-account $SOURCE --network $NETWORK \\
  -- schedule_upgrade --wasm_hash \$HASH      # returns the eta (now + timelock)
#    ...users have the timelock window to exit; then after eta:
stellar contract invoke --id $WRAPPER --source-account $SOURCE --network $NETWORK \\
  -- apply_upgrade
#    Abort a pending upgrade any time before apply:
stellar contract invoke --id $WRAPPER --source-account $SOURCE --network $NETWORK \\
  -- cancel_upgrade
#    Tune the exit window (seconds, 3600..2592000):
stellar contract invoke --id $WRAPPER --source-account $SOURCE --network $NETWORK \\
  -- set_timelock --secs 259200

# 3) Strategy soft-brick safety valve. The b_rate sanity bound is TIME-AWARE: it allows up to
#    max_apr_bps of annual growth, pro-rated by elapsed time since the last read — so a long-
#    untouched position never false-trips. If Blend's real rate ever outpaces the annual cap and
#    current_rate starts panicking, widen the cap (no redeploy):
stellar contract invoke --id $STRATEGY --source-account $SOURCE --network $NETWORK \\
  -- rate_bound                               # (last_rate, last_ts, max_apr_bps)
stellar contract invoke --id $STRATEGY --source-account $SOURCE --network $NETWORK \\
  -- set_max_apr_bps --max_apr_bps 50000

──────────────────────────────────────────────────────────────────────
VERIFY THE DEPLOYED CODE (mainnet-readiness):
# Each contract exposes the LIVE wasm hash so you can confirm what's actually running
# (and that an apply_upgrade landed). Compare against \`stellar contract install --wasm <f>\` output.
stellar contract invoke --id $WRAPPER --source-account $SOURCE --network $NETWORK -- code_hash
stellar contract invoke --id $VAULT   --source-account $SOURCE --network $NETWORK -- code_hash
stellar contract invoke --id $MARKET  --source-account $SOURCE --network $NETWORK -- code_hash
stellar contract invoke --id $STRATEGY --source-account $SOURCE --network $NETWORK -- code_hash

OFF-CHAIN SOLVENCY MONITOR (the out-of-band watchtower):
# Polls the wrapper's solvency() and pages if backing < principal. Pure reads, costs nothing.
node scripts/solvency_monitor.mjs --wrapper $WRAPPER --rpc https://soroban-testnet.stellar.org --interval 60
#   (one-shot for CI/cron:)   node scripts/solvency_monitor.mjs --wrapper $WRAPPER --once
EOF
