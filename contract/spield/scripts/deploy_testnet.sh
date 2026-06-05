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

# Rate sanity bound: max 100% b_rate jump per read (generous; defence-in-depth).
MAX_JUMP_BPS=10000
# Maturity: ~30 days from now (unix seconds).
MATURITY=$(( $(date +%s) + 30*24*60*60 ))

ADMIN_ADDR=$(stellar keys address "$SOURCE")
echo "==> Deployer ($SOURCE): $ADMIN_ADDR"
echo "==> Blend pool:  $BLEND_POOL"
echo "==> USDC SAC:    $USDC_SAC"
echo "==> Maturity:    $MATURITY ($(date -d @"$MATURITY" 2>/dev/null || echo "+30d"))"
echo

echo "==> [1/6] Building WASMs..."
stellar contract build >/dev/null
WASM_DIR="target/wasm32v1-none/release"
STRAT_WASM="$WASM_DIR/spield_strategy.wasm"
WRAP_WASM="$WASM_DIR/spield_wrapper.wasm"

echo "==> [2/6] Deploying the wrapper contract (need its address to admin PT/YT)..."
WRAPPER=$(stellar contract deploy --wasm "$WRAP_WASM" --source-account "$SOURCE" --network "$NETWORK")
echo "    wrapper = $WRAPPER"

echo "==> [3/6] Creating PT and YT assets + SACs (issued by $ISSUER), handing admin to the wrapper..."
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

echo "==> [4/6] Deploying + initializing the Blend strategy adapter..."
STRATEGY=$(stellar contract deploy --wasm "$STRAT_WASM" --source-account "$SOURCE" --network "$NETWORK")
echo "    strategy = $STRATEGY"
stellar contract invoke --id "$STRATEGY" --source-account "$SOURCE" --network "$NETWORK" \
  -- initialize \
     --admin "$ADMIN_ADDR" \
     --wrapper "$WRAPPER" \
     --pool "$BLEND_POOL" \
     --underlying "$USDC_SAC" \
     --max_jump_bps "$MAX_JUMP_BPS" >/dev/null
echo "    strategy initialized"

echo "==> [5/6] Initializing the wrapper..."
stellar contract invoke --id "$WRAPPER" --source-account "$SOURCE" --network "$NETWORK" \
  -- initialize \
     --admin "$ADMIN_ADDR" \
     --strategy "$STRATEGY" \
     --pt_token "$PT_SAC" \
     --yt_token "$YT_SAC" \
     --maturity "$MATURITY" >/dev/null
echo "    wrapper initialized"

echo "==> [6/6] Done. Summary:"
cat <<EOF

  ┌─ Spield v2 deployed on $NETWORK ────────────────────────────────
  │ wrapper   = $WRAPPER
  │ strategy  = $STRATEGY
  │ PT (SAC)  = $PT_SAC
  │ YT (SAC)  = $YT_SAC
  │ Blend pool= $BLEND_POOL
  │ USDC      = $USDC_SAC
  └─────────────────────────────────────────────────────────────────

Exercise it (USDC has 7 decimals; 10 USDC = 100000000):

# Deposit 10 USDC -> get 10 PT + 10 YT, returns a position id (likely 0):
stellar contract invoke --id $WRAPPER --source-account $SOURCE --network $NETWORK \\
  -- mint --user $ADMIN_ADDR --amount 100000000

# See the live position value (principal + claimable yield):
stellar contract invoke --id $WRAPPER --source-account $SOURCE --network $NETWORK \\
  -- position_value --position_id 0

# Claim accrued yield (YT is kept):
stellar contract invoke --id $WRAPPER --source-account $SOURCE --network $NETWORK \\
  -- claim_yield --position_id 0

# Protocol solvency (backing, principal, unclaimed):
stellar contract invoke --id $WRAPPER --source-account $SOURCE --network $NETWORK \\
  -- solvency

# After maturity ($MATURITY), redeem PT 1:1:
stellar contract invoke --id $WRAPPER --source-account $SOURCE --network $NETWORK \\
  -- redeem_pt --position_id 0 --amount 100000000
EOF
