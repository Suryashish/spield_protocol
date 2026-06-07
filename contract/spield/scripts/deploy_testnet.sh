#!/usr/bin/env bash
#
# Spield v2 — testnet deploy against the real Blend TestnetV2 pool.
#
# Prereqs:
#   * Run inside WSL with the Stellar CLI + Rust toolchain (see howtoaccesswsl.md).
#   * The deployer identity (default: alice) is funded with XLM AND holds some of the Blend
#     testnet USDC (USDC:GATALTGT...). See TESTNET.md for how to get USDC to alice.
#
# What it does: builds WASMs, deploys PT + YT SACs (admin handed to the wrapper), deploys +
# initializes the Blend strategy adapter and the wrapper, then prints the addresses and the
# exact invoke commands to exercise mint/claim/redeem.
#
# Usage:
#   bash scripts/deploy_testnet.sh            # uses alice
#   SOURCE=bob bash scripts/deploy_testnet.sh # uses a different identity
set -euo pipefail

SOURCE="${SOURCE:-alice}"
NETWORK="${NETWORK:-testnet}"
# A DEDICATED issuer for the PT/YT assets — must NOT be a user that will hold PT/YT, because a
# Stellar asset's issuer account can't receive its own asset ("operation invalid on issuer").
# This account only issues + immediately hands SAC admin to the wrapper; it then does nothing.
ISSUER="${ISSUER:-spield_issuer}"

# --- Real Blend testnet addresses (verified from blend-utils/testnet.contracts.json) ---
BLEND_POOL="CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF"
USDC_SAC="CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU"
USDC_ASSET="USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56"

# Rate sanity bound: max ANNUAL b_rate growth, in bps (the bound is pro-rated by elapsed time on
# each read, so read frequency no longer matters — calibrate ONLY against Blend's real max borrow
# APR). 30000 = 300% APR, generously above any real Blend supply rate; defence-in-depth.
MAX_APR_BPS=30000
# Maturity: ~30 days from now (unix seconds).
MATURITY=$(( $(date +%s) + 30*24*60*60 ))

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

ADMIN_ADDR=$(stellar keys address "$SOURCE")
echo "==> Deployer ($SOURCE): $ADMIN_ADDR"
echo "==> Blend pool:  $BLEND_POOL"
echo "==> USDC SAC:    $USDC_SAC"
echo "==> Maturity:    $MATURITY ($(date -d @"$MATURITY" 2>/dev/null || echo "+30d"))"
echo

echo "==> [1/8] Building WASMs..."
stellar contract build >/dev/null
WASM_DIR="target/wasm32v1-none/release"
STRAT_WASM="$WASM_DIR/spield_strategy.wasm"
WRAP_WASM="$WASM_DIR/spield_wrapper.wasm"
VAULT_WASM="$WASM_DIR/spield_vault.wasm"
MARKET_WASM="$WASM_DIR/spield_market.wasm"

echo "==> [2/8] Deploying the wrapper contract (need its address to admin PT/YT)..."
WRAPPER=$(stellar contract deploy --wasm "$WRAP_WASM" --source-account "$SOURCE" --network "$NETWORK")
echo "    wrapper = $WRAPPER"

echo "==> [3/8] Creating PT and YT assets + SACs (issued by $ISSUER), handing admin to the wrapper..."
# PT/YT are classic assets issued by a DEDICATED issuer (not a user), wrapped as SACs; we then
# transfer SAC admin to the wrapper so only the wrapper mints/burns. Issuing from a separate
# account is required so that users (incl. the deployer) can actually hold PT/YT.
ISSUER_ADDR=$(stellar keys address "$ISSUER")
PT_ASSET="SPLDPT:$ISSUER_ADDR"
YT_ASSET="SPLDYT:$ISSUER_ADDR"

stellar contract asset deploy --asset "$PT_ASSET" --source-account "$ISSUER" --network "$NETWORK" >/dev/null 2>&1 || true
stellar contract asset deploy --asset "$YT_ASSET" --source-account "$ISSUER" --network "$NETWORK" >/dev/null 2>&1 || true
PT_SAC=$(stellar contract id asset --asset "$PT_ASSET" --network "$NETWORK")
YT_SAC=$(stellar contract id asset --asset "$YT_ASSET" --network "$NETWORK")
echo "    PT SAC = $PT_SAC"
echo "    YT SAC = $YT_SAC"

# Hand SAC admin to the wrapper so it (not the issuer) controls mint/burn.
stellar contract invoke --id "$PT_SAC" --source-account "$ISSUER" --network "$NETWORK" \
  -- set_admin --new_admin "$WRAPPER" >/dev/null
stellar contract invoke --id "$YT_SAC" --source-account "$ISSUER" --network "$NETWORK" \
  -- set_admin --new_admin "$WRAPPER" >/dev/null
echo "    PT/YT admin -> wrapper"

# The deployer (who will receive PT/YT) needs trustlines for these classic assets before the
# wrapper can mint to them. (Any other user must do the same before their first mint.)
echo "==> [3b] Adding PT/YT trustlines for $SOURCE..."
stellar tx new change-trust --source-account "$SOURCE" --network "$NETWORK" --line "$PT_ASSET" >/dev/null 2>&1 || true
stellar tx new change-trust --source-account "$SOURCE" --network "$NETWORK" --line "$YT_ASSET" >/dev/null 2>&1 || true
echo "    trustlines set"

echo "==> [4/8] Deploying + initializing the Blend strategy adapter..."
STRATEGY=$(stellar contract deploy --wasm "$STRAT_WASM" --source-account "$SOURCE" --network "$NETWORK")
echo "    strategy = $STRATEGY"
stellar contract invoke --id "$STRATEGY" --source-account "$SOURCE" --network "$NETWORK" \
  -- initialize \
     --admin "$ADMIN_ADDR" \
     --wrapper "$WRAPPER" \
     --pool "$BLEND_POOL" \
     --underlying "$USDC_SAC" \
     --max_apr_bps "$MAX_APR_BPS" >/dev/null
echo "    strategy initialized"

echo "==> [5/8] Initializing the wrapper..."
stellar contract invoke --id "$WRAPPER" --source-account "$SOURCE" --network "$NETWORK" \
  -- initialize \
     --admin "$ADMIN_ADDR" \
     --strategy "$STRATEGY" \
     --pt_token "$PT_SAC" \
     --yt_token "$YT_SAC" \
     --maturity "$MATURITY" >/dev/null
echo "    wrapper initialized"

echo "==> [6/8] Deploying + initializing the Fixed-Rate Vault..."
# The vault sits on top of the wrapper: it inherits PT/YT/underlying/maturity from it on init,
# so we only pass the wrapper address + the fixed-rate config.
VAULT=$(stellar contract deploy --wasm "$VAULT_WASM" --source-account "$SOURCE" --network "$NETWORK")
echo "    vault = $VAULT"
stellar contract invoke --id "$VAULT" --source-account "$SOURCE" --network "$NETWORK" \
  -- initialize \
     --admin "$ADMIN_ADDR" \
     --wrapper "$WRAPPER" \
     --underlying "$USDC_SAC" \
     --rate_bps "$VAULT_RATE_BPS" \
     --max_rate_bps "$VAULT_MAX_RATE_BPS" >/dev/null
echo "    vault initialized (rate=${VAULT_RATE_BPS}bps, ceiling=${VAULT_MAX_RATE_BPS}bps)"

# Seed the vault's PT inventory so it has coupon capacity for the first deposits. The seeder pulls
# USDC; the vault mints PT+YT into its own inventory (no receipt/liability — pure capacity). The
# vault is a contract holder of the PT/YT SACs and needs no classic trustline (SAC contract
# balances live in contract storage, not as classic trustlines).
if [ "$VAULT_SEED_AMOUNT" -gt 0 ]; then
  echo "==> [6b] Seeding the vault with $VAULT_SEED_AMOUNT USDC base units of PT capacity..."
  stellar contract invoke --id "$VAULT" --source-account "$SOURCE" --network "$NETWORK" \
    -- seed --from "$ADMIN_ADDR" --amount "$VAULT_SEED_AMOUNT" >/dev/null
  echo "    vault seeded"
else
  echo "==> [6b] Skipping vault seed (VAULT_SEED_AMOUNT=0); seed later via vault.seed."
fi

echo "==> [7/8] Deploying + initializing the Market (PT/USDC time-decay AMM)..."
# The market trades the wrapper's PT against USDC on the Pendle-style log curve. It's told the PT
# SAC, USDC SAC and maturity explicitly (they must match the wrapper market it sits on), plus the
# fee + curve params. Like the vault, it's a contract holder of the PT/USDC SACs (no trustline).
MARKET=$(stellar contract deploy --wasm "$MARKET_WASM" --source-account "$SOURCE" --network "$NETWORK")
echo "    market = $MARKET"
stellar contract invoke --id "$MARKET" --source-account "$SOURCE" --network "$NETWORK" \
  -- initialize \
     --admin "$ADMIN_ADDR" \
     --pt "$PT_SAC" \
     --usdc "$USDC_SAC" \
     --maturity "$MATURITY" \
     --fee_bps "$MARKET_FEE_BPS" \
     --max_fee_bps "$MARKET_MAX_FEE_BPS" \
     --scalar_root "$MARKET_SCALAR_ROOT" \
     --rate_anchor "$MARKET_RATE_ANCHOR" >/dev/null
echo "    market initialized (fee=${MARKET_FEE_BPS}bps, anchor=par, root=${MARKET_SCALAR_ROOT})"

# Seed initial liquidity: mint MARKET_SEED_AMOUNT PT via the wrapper to the deployer, then add it
# (PT side) together with an equal USDC amount (the other side) as the first liquidity. This opens
# the pool at proportion 0.5 (PT price = anchor = par). Needs ~2x the seed in deployer USDC.
if [ "$MARKET_SEED_AMOUNT" -gt 0 ]; then
  echo "==> [7b] Seeding the market with $MARKET_SEED_AMOUNT USDC base units of liquidity per side..."
  # 1) Mint PT (+YT) to the deployer so they hold the PT to add. (Deployer already has PT/YT
  #    trustlines from step [3b].)
  stellar contract invoke --id "$WRAPPER" --source-account "$SOURCE" --network "$NETWORK" \
    -- mint --user "$ADMIN_ADDR" --amount "$MARKET_SEED_AMOUNT" >/dev/null
  # 2) Add liquidity: equal PT + USDC at the par anchor → opens a balanced pool.
  stellar contract invoke --id "$MARKET" --source-account "$SOURCE" --network "$NETWORK" \
    -- add_liquidity --lp "$ADMIN_ADDR" --pt_in "$MARKET_SEED_AMOUNT" --usdc_in "$MARKET_SEED_AMOUNT" >/dev/null
  echo "    market seeded (balanced PT/USDC pool opened at par)"
else
  echo "==> [7b] Skipping market seed (MARKET_SEED_AMOUNT=0); add liquidity later via market.add_liquidity."
fi

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
EOF
