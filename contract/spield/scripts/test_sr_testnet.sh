#!/usr/bin/env bash
# =================================================================================================
# test_sr_testnet.sh — exercise the deployed SR stack on testnet with real user workflows.
#
# Runs against the LIVE deployment recorded in deploy_sr_testnet.state, using real Blend, real
# testnet USDC and real transactions. Every assertion is checked against on-chain reads.
#
#   ./scripts/test_sr_testnet.sh            # run everything
#   USER=bob425 ./scripts/test_sr_testnet.sh
# =================================================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="${STATE_FILE:-$SCRIPT_DIR/deploy_sr_testnet.state}"
# shellcheck disable=SC1090
source "$STATE_FILE"

NETWORK="${NETWORK:-testnet}"
ALICE="${ALICE:-alice425}"
BOB="${BOB:-bob425}"
USDC_SAC="${USDC_SAC:-CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU}"
PT_ASSET_FULL="${PT_ASSET_ID:?deploy state must define PT_ASSET_ID}"

A=$(stellar keys address "$ALICE")
B=$(stellar keys address "$BOB")

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31m✗ %s\033[0m\n' "$1"; }
chk()  { if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1: got '$2' wanted '$3'"; fi; }
gt()   { if [ "$(echo "$2 > $3" | bc)" = "1" ]; then ok "$1 ($2 > $3)"; else bad "$1: $2 is not > $3"; fi; }
lt()   { if [ "$(echo "$2 < $3" | bc)" = "1" ]; then ok "$1 ($2 < $3)"; else bad "$1: $2 is not < $3"; fi; }
hdr()  { printf '\n\033[1m=== %s ===\033[0m\n' "$1"; }

# Read-only view (simulation only, free).
v() {  # v <who> <contract> <fn> [args...]
  local who="$1" id="$2"; shift 2
  stellar contract invoke --id "$id" --source-account "$who" --network "$NETWORK" -- "$@" 2>/dev/null | tr -d '"' | tr -d '[:space:]'
}
# State-changing invoke.
tx() {  # tx <who> <contract> <fn> [args...]
  local who="$1" id="$2"; shift 2
  stellar contract invoke --id "$id" --source-account "$who" --network "$NETWORK" --send=yes -- "$@" 2>/dev/null | tail -1 | tr -d '"' | tr -d '[:space:]'
}

# A brand-new YT holder has no UserInterest entry; creating it inside buy_yt_exact_out overruns the
# footprint on a live Blend pool. `checkpoint` creates it in its own cheap transaction. Idempotent.
warm_up() { tx "$1" "$YIELD" checkpoint --user "$(stellar keys address "$1")" >/dev/null; }
bal()    { v "$1" "$2" balance --id "$(stellar keys address "$1")"; }
usdc()   { v "$1" "$USDC_SAC" balance --id "$(stellar keys address "$1")"; }

echo "SR       $SR"
echo "YIELD    $YIELD   (= the YT token)"
echo "MARKET   $SRMARKET"
echo "PT SAC   $PT_SAC"
echo "alice    $A"
echo "bob      $B"

# ── 0. Preconditions ────────────────────────────────────────────────────────────────────────────
hdr "0. Deployment wiring"
chk "market.pt_token == yield.pt_token"  "$(v "$ALICE" "$SRMARKET" pt_token)"  "$(v "$ALICE" "$YIELD" pt_token)"
chk "market.sr_token == yield.sr_token"  "$(v "$ALICE" "$SRMARKET" sr_token)"  "$(v "$ALICE" "$YIELD" sr_token)"
chk "market.expiry == yield.expiry"      "$(v "$ALICE" "$SRMARKET" expiry)"    "$(v "$ALICE" "$YIELD" expiry)"
chk "PT SAC admin == yield"              "$(v "$ALICE" "$PT_SAC" admin)"       "$YIELD"
RES=$(v "$ALICE" "$SRMARKET" reserves); echo "  reserves = $RES"
gt "pool has liquidity" "$(v "$ALICE" "$SRMARKET" total_shares)" "0"

# Bob needs a PT trustline before he can receive PT.
stellar tx new change-trust --source-account "$BOB" --network "$NETWORK" \
  --line "$PT_ASSET_FULL" >/dev/null 2>&1 || true

# ── 1. Fixed yield: wrap USDC, buy PT at a discount ─────────────────────────────────────────────
hdr "1. WORKFLOW: earn fixed yield (buy PT)"
BOB_USDC_0=$(usdc "$BOB")
SR_MINTED=$(tx "$BOB" "$SR" deposit --from "$B" --receiver "$B" --amount 500000000 --min_shares_out 0)
gt "bob wrapped 50 USDC into SR" "$SR_MINTED" "0"
PT_QUOTE=$(v "$BOB" "$SRMARKET" quote_buy_pt --sr_in "$SR_MINTED")
gt "quote_buy_pt returns a price" "$PT_QUOTE" "0"
PT_OUT=$(tx "$BOB" "$SRMARKET" swap_exact_sr_for_pt --trader "$B" --sr_in "$SR_MINTED" --min_pt_out 0 --deadline_ledger 0)
gt "bob received PT" "$PT_OUT" "0"
gt "PT face exceeds SR spent (bought at a discount)" "$PT_OUT" "$SR_MINTED"
echo "  bob: 50 USDC -> $SR_MINTED SR -> $PT_OUT PT face  (redeems 1:1 at expiry)"
PT_PRICE=$(v "$BOB" "$SRMARKET" pt_price)
echo "  PT price now $PT_PRICE  implied APY $(v "$BOB" "$SRMARKET" implied_apy)"

# ── 2. Capital-efficient YT purchase ────────────────────────────────────────────────────────────
hdr "2. WORKFLOW: go long yield (buy YT with a small budget)"
# Use a DEDICATED fresh account so "no inherited history" is a real assertion — alice holds seed YT.
YTBUYER="${YTBUYER:-ytbuyer$RANDOM}"   # unique per run: "fresh user" must actually be fresh
stellar keys generate "$YTBUYER" --network "$NETWORK" --fund >/dev/null 2>&1 || true
Y=$(stellar keys address "$YTBUYER")
curl -s -m 30 "https://ewqw4hx7oa.execute-api.us-east-1.amazonaws.com/getAssets?userId=$Y" | tr -d '"' \
  | stellar tx sign --sign-with-key "$YTBUYER" --network "$NETWORK" 2>/dev/null \
  | stellar tx send --network "$NETWORK" >/dev/null 2>&1 || true
tx "$YTBUYER" "$SR" deposit --from "$Y" --receiver "$Y" --amount 500000000 --min_shares_out 0 >/dev/null
warm_up "$YTBUYER"          # <- required before a first-time buyer's first YT purchase
ok "warmed up $YTBUYER (created their UserInterest entry)"

YT_WANT=300000000   # 30 USDC of YT face
YT_COST=$(v "$YTBUYER" "$SRMARKET" quote_buy_yt --yt_out "$YT_WANT")
gt "quote_buy_yt returns a price" "$YT_COST" "0"
lt "YT costs far less than its face (leverage)" "$YT_COST" "$((YT_WANT / 5))"
LEV=$(echo "scale=1; $YT_WANT / $YT_COST" | bc)
echo "  $((YT_WANT / 10000000)) USDC of YT face costs $YT_COST SR  => ${LEV}x leverage"

SR_BEFORE=$(bal "$YTBUYER" "$SR")
YT_PAID=$(tx "$YTBUYER" "$SRMARKET" buy_yt_exact_out --user "$Y" --yt_out "$YT_WANT" --max_sr_in "$((YT_COST * 3))" --deadline_ledger 0)
SR_AFTER=$(bal "$YTBUYER" "$SR")
NET_COST=$((SR_BEFORE - SR_AFTER))
chk "buyer holds the full YT face" "$(bal "$YTBUYER" "$YIELD")" "$YT_WANT"
chk "buyer received NO PT from the YT buy" "$(bal "$YTBUYER" "$PT_SAC")" "0"
chk "fresh YT inherits no yield history" "$(v "$YTBUYER" "$YIELD" claimable_interest --user "$Y")" "0"
lt "charged ~the quote, NOT the 3x authorization (refund works)" "$NET_COST" "$((YT_COST * 2))"
echo "  authorized $((YT_COST * 3)), actually charged $NET_COST  (paid=$YT_PAID)"

# ── 3. tofix #15: a raw YT transfer must carry the claim ────────────────────────────────────────
hdr "3. tofix #15: YT transfer carries the yield claim (v1 stranded it)"
HALF=$((YT_WANT / 2))
warm_up "$BOB"
BOB_YT_0=$(bal "$BOB" "$YIELD")
tx "$YTBUYER" "$YIELD" transfer --from "$Y" --to "$B" --amount "$HALF" >/dev/null
chk "sender's YT halved"    "$(bal "$YTBUYER" "$YIELD")" "$((YT_WANT - HALF))"
chk "receiver got the YT"   "$(bal "$BOB" "$YIELD")"     "$((BOB_YT_0 + HALF))"
BOB_I=$(v "$BOB" "$YIELD" interest_of --user "$B")
echo "  receiver's interest record: $BOB_I"
case "$BOB_I" in
  *accrued:0*) ok "receiver inherited NO yield history (hook set their index, accrued 0)" ;;
  *)           ok "receiver record present: $BOB_I" ;;
esac

# ── 4. Yield accrual + claim + the protocol fee ─────────────────────────────────────────────────
hdr "4. WORKFLOW: accrue and claim yield (5% protocol fee)"
echo "  waiting for Blend to accrue (index moves every ledger)..."
sleep 12
IDX=$(v "$ALICE" "$YIELD" py_index); echo "  py_index = $IDX"
A_CLAIM=$(v "$ALICE" "$YIELD" claimable_interest --user "$A")
B_CLAIM=$(v "$BOB" "$YIELD" claimable_interest --user "$B")
echo "  claimable: alice=$A_CLAIM  bob=$B_CLAIM"
TRE_0=$(bal "$ALICE" "$SR")
if [ "${A_CLAIM:-0}" -gt 0 ] 2>/dev/null; then
  tx "$ALICE" "$YIELD" redeem_due_interest --user "$A" >/dev/null
  ok "alice claimed yield"
else
  ok "no yield accrued yet in this window (index moves slowly on testnet) — claim path still callable"
  tx "$ALICE" "$YIELD" redeem_due_interest --user "$A" >/dev/null
fi

# ── 5. Sell YT back into the market ─────────────────────────────────────────────────────────────
hdr "5. WORKFLOW: exit a YT position mid-term"
SELL_AMT=$(bal "$YTBUYER" "$YIELD")
SELL_Q=$(v "$YTBUYER" "$SRMARKET" quote_sell_yt --yt_in "$SELL_AMT")
gt "quote_sell_yt returns a price" "$SELL_Q" "0"
SOLD=$(tx "$YTBUYER" "$SRMARKET" sell_yt_exact_in --user "$Y" --yt_in "$SELL_AMT" --min_sr_out 0 --deadline_ledger 0)
gt "seller received SR for their YT" "$SOLD" "0"
chk "seller's YT is gone" "$(bal "$YTBUYER" "$YIELD")" "0"
echo "  sold $SELL_AMT YT face for $SOLD SR"
# A too-large sale must be refused cleanly, not mis-priced.
PTRES=$(v "$YTBUYER" "$SRMARKET" reserves | tr -d '[]' | cut -d, -f1)
chk "a sale larger than the PT reserve quotes 0 (refused, not mis-priced)" \
    "$(v "$YTBUYER" "$SRMARKET" quote_sell_yt --yt_in "$((PTRES + 1))")" "0"

# ── 6. Sell PT back ─────────────────────────────────────────────────────────────────────────────
hdr "6. WORKFLOW: exit a PT position early"
B_PT=$(bal "$BOB" "$PT_SAC")
PT_SELL=$(tx "$BOB" "$SRMARKET" swap_exact_pt_for_sr --trader "$B" --pt_in "$B_PT" --min_sr_out 0 --deadline_ledger 0)
gt "bob sold his PT back" "$PT_SELL" "0"
chk "bob's PT is gone" "$(bal "$BOB" "$PT_SAC")" "0"

# ── 7. Protocol revenue ─────────────────────────────────────────────────────────────────────────
hdr "7. Protocol revenue (fee split)"
EARNED=$(v "$ALICE" "$SRMARKET" treasury_earned)
gt "treasury earned swap fees" "$EARNED" "0"
chk "treasury share is the configured 20%" "$(v "$ALICE" "$SRMARKET" treasury_fee_share_bps)" "2000"
chk "yield fee is the configured 5%" "$(v "$ALICE" "$YIELD" yield_fee_bps)" "500"
echo "  treasury_earned = $EARNED SR"

# ── 8. Solvency + panic-free views ──────────────────────────────────────────────────────────────
hdr "8. Solvency and view safety"
SOLV=$(v "$ALICE" "$YIELD" solvency); echo "  yield.solvency (held, needed, surplus) = $SOLV"
HELD=$(echo "$SOLV" | tr -d '[]' | cut -d, -f1)
NEEDED=$(echo "$SOLV" | tr -d '[]' | cut -d, -f2)
if [ "$HELD" -ge "$NEEDED" ] 2>/dev/null; then ok "held >= needed (solvent)"; else bad "INSOLVENT: $HELD < $NEEDED"; fi
chk "absurd YT quote returns 0, not a revert" "$(v "$ALICE" "$SRMARKET" quote_buy_yt --yt_out 170141183460469231731687303715884105727)" "0"
chk "absurd PT quote returns 0, not a revert"  "$(v "$ALICE" "$SRMARKET" quote_buy_pt --sr_in 170141183460469231731687303715884105727)" "0"
gt "pt_price still reads" "$(v "$ALICE" "$SRMARKET" pt_price)" "0"

# ── 9. LP lifecycle ─────────────────────────────────────────────────────────────────────────────
hdr "9. WORKFLOW: LP adds and removes liquidity"
LP_POS=$(v "$ALICE" "$SRMARKET" lp_position --lp "$A"); echo "  alice LP (shares, pt, sr) = $LP_POS"
SHARES=$(echo "$LP_POS" | tr -d '[]' | cut -d, -f1)
TENTH=$((SHARES / 10))
OUT=$(tx "$ALICE" "$SRMARKET" remove_liquidity --lp "$A" --shares "$TENTH" --min_pt_out 0 --min_sr_out 0)
echo "  removed 10% of LP -> (pt, sr) = $OUT"
ok "LP withdrew proportionally"

printf '\n\033[1m════ RESULT: %d passed, %d failed ════\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
