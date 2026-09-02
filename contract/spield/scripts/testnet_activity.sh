#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────────────────────────
# testnet_activity.sh — exercise every v2 entry point from several accounts.
#
# SYNTHETIC TESTNET TRAFFIC. Real transactions against the real testnet deployment, but generated
# rather than organic: do not present the resulting counts as usage or traction.
#
# What it IS good for: every mutating path on all six contracts runs against live Blend from more
# than one account, including peer-to-peer PT and YT transfers, which is a genuine integration
# exercise — the same shape of run that surfaced the `lp_position` and stale-index bugs in the §17
# drills.
#
# Amounts are deliberately small: the AMM holds a couple of USDC per side and a swap above roughly
# half a reserve reverts. Operations alternate by round so the series is not a flat repeat, and
# every call is skipped rather than fatal when its precondition is not met (a zero-interest claim
# reverting, for instance, is correct behaviour and not worth aborting a run over).
# ─────────────────────────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.."
ST=scripts/deploy_sr_testnet.state
g(){ grep -m1 "^$1=" "$ST" | cut -d= -f2 | tr -d "'\""; }
SR=$(g SR); YIELD=$(g YIELD); MARKET=$(g SRMARKET); VAULT=$(g SRVAULT)
ROUTER=$(g SRROUTER); PT=$(g PT_SAC)
USERS=(spield_user_a spield_user_b spield_user_c)
ROUNDS="${ROUNDS:-7}"
PAUSE="${PAUSE:-1}"     # spacing between submissions; the public testnet RPC throttles bursts

OK=0; SKIP=0
inv(){
  local label="$1" cid="$2"; shift 2
  local out rc
  out=$(stellar contract invoke --id "$cid" --source-account "$WHO" --network testnet --send=yes -- "$@" 2>&1); rc=$?
  # One retry. Most non-zero exits here are the public testnet RPC throttling or timing out, not the
  # contract refusing — a contract error carries a `#code` and is not worth retrying.
  if [ $rc -ne 0 ] && ! printf '%s' "$out" | grep -qE '#[0-9]+'; then
    sleep 3
    out=$(stellar contract invoke --id "$cid" --source-account "$WHO" --network testnet --send=yes -- "$@" 2>&1); rc=$?
  fi
  if [ $rc -eq 0 ]; then
    OK=$((OK+1)); printf '    ✓ %-20s %s\n' "$label" "$(printf '%s' "$out" | tail -1 | cut -c1-30)"
  else
    SKIP=$((SKIP+1))
    printf '    · %-20s %s\n' "$label" "$(printf '%s' "$out" | grep -oE '#[0-9]+' | head -1)"
  fi
  sleep "$PAUSE"
}
rd(){ local v; v=$(stellar contract invoke --id "$1" --source-account "$WHO" --network testnet --send=no -- "${@:2}" 2>/dev/null | tail -1 | tr -d '"'); case "$v" in ''|*[!0-9-]*) echo 0;; *) echo "$v";; esac; }

for r in $(seq 1 "$ROUNDS"); do
  for i in "${!USERS[@]}"; do
    WHO="${USERS[$i]}"; ME=$(stellar keys address "$WHO")
    PEER="${USERS[$(( (i+1) % ${#USERS[@]} ))]}"; PEER_ADDR=$(stellar keys address "$PEER")
    echo "── round $r · $WHO"

    # Wrap USDC into SR. Sizes vary so the history is not a flat repeat.
    inv "sr.deposit" "$SR" deposit --from "$ME" --receiver "$ME" \
        --amount "$(( 2500000 + (RANDOM % 14) * 400000 ))" --min_shares_out 0

    # Split roughly half into PT + YT.
    HALF=$(( $(rd "$SR" balance --id "$ME") / 2 ))
    [ "$HALF" -gt 100000 ] && inv "yield.mint_py" "$YIELD" mint_py --from "$ME" --receiver "$ME" --sr_in "$HALF"

    # AMM, alternating direction by round so both sides of the book get used.
    if [ $(( r % 2 )) -eq 1 ]; then
      S=$(( $(rd "$SR" balance --id "$ME") / 4 )); [ "$S" -gt 1500000 ] && S=1500000
      [ "$S" -gt 100000 ] && inv "market.buy_pt" "$MARKET" swap_exact_sr_for_pt --trader "$ME" --sr_in "$S" --min_pt_out 0 --deadline_ledger 0
    else
      P=$(( $(rd "$PT" balance --id "$ME") / 5 )); [ "$P" -gt 1200000 ] && P=1200000
      [ "$P" -gt 100000 ] && inv "market.sell_pt" "$MARKET" swap_exact_pt_for_sr --trader "$ME" --pt_in "$P" --min_sr_out 0 --deadline_ledger 0
    fi

    # The router — the one-signature USDC front door, its own contract and its own path.
    inv "router.buy_pt" "$ROUTER" buy_pt_with_usdc --user "$ME" --usdc_in "$(( 800000 + (RANDOM % 8) * 150000 ))" --min_pt_out 0 --deadline_ledger 0
    P=$(( $(rd "$PT" balance --id "$ME") / 6 )); [ "$P" -gt 800000 ] && P=800000
    [ "$P" -gt 100000 ] && inv "router.sell_pt" "$ROUTER" sell_pt_for_usdc --user "$ME" --pt_in "$P" --min_usdc_out 0 --deadline_ledger 0

    # Fixed-rate vault. Redeem is time-locked to maturity, so deposit is the only path today.
    inv "vault.deposit" "$VAULT" deposit --user "$ME" --amount "$(( 500000 + (RANDOM % 6) * 250000 ))"

    # Claim only when there is something to claim — a zero claim reverting is correct, not a failure.
    if [ "$(rd "$YIELD" claimable_interest --user "$ME")" -gt 0 ]; then
      inv "yield.claim" "$YIELD" redeem_due_interest --user "$ME"
    else
      inv "yield.checkpoint" "$YIELD" checkpoint --user "$ME"
    fi

    # Peer-to-peer transfers. The YT hook settles interest on both sides, which is the path most
    # worth exercising from a second account rather than from the deployer.
    P=$(( $(rd "$PT" balance --id "$ME") / 8 ))
    [ "$P" -gt 100000 ] && inv "pt.transfer→peer" "$PT" transfer --from "$ME" --to "$PEER_ADDR" --amount "$P"
    Y=$(( $(rd "$YIELD" balance --id "$ME") / 8 ))
    [ "$Y" -gt 100000 ] && inv "yt.transfer→peer" "$YIELD" transfer --from "$ME" --to "$PEER_ADDR" --amount "$Y"

    # Recombine a slice of PT+YT back into SR, then unwrap some SR (which also returns cap headroom).
    PB=$(rd "$PT" balance --id "$ME"); YB=$(rd "$YIELD" balance --id "$ME")
    MIN=$PB; [ "$YB" -lt "$MIN" ] && MIN=$YB
    [ $(( MIN / 3 )) -gt 100000 ] && inv "yield.redeem_py" "$YIELD" redeem_py --from "$ME" --receiver "$ME" --py_amount "$(( MIN / 3 ))"
    O=$(( $(rd "$SR" balance --id "$ME") / 3 ))
    [ "$O" -gt 100000 ] && inv "sr.redeem" "$SR" redeem --from "$ME" --receiver "$ME" --shares "$O" --min_underlying_out 0
  done
done
echo; echo "submitted ok=$OK  skipped=$SKIP"
