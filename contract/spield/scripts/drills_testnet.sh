#!/usr/bin/env bash
# =================================================================================================
# drills_testnet.sh — the operational rehearsals from `testcando.md` §17, executed and TIMED.
#
# §17 asks for procedures MAINNET.md documents but nobody has executed under pressure: "rehearse on
# testnet with a stopwatch, then write the timing into the runbook." This is the stopwatch.
#
#   STATE_FILE=<deployment>.state ./scripts/drills_testnet.sh            # all runnable drills
#   STATE_FILE=<…> DRILLS=1,5     ./scripts/drills_testnet.sh            # pick specific ones
#
# ── Run this against a THROWAWAY deployment ──────────────────────────────────────────────────────
#
# Drills 1 and 5 deliberately break the protocol — they pause every contract and freeze the rate
# oracle. Pointed at the live testnet stack they would take down the dApp and the SDK's CI. The
# script refuses to touch a deployment whose state file is the live one; override only if you mean it.
#
# ── The drills ───────────────────────────────────────────────────────────────────────────────────
#
#   1  emergency_pause_drill              pause everything; prove exits still work, inflows do not
#   2  multisig_rotation_dress_rehearsal  delegated to rotate_admins.sh (its own test suite)
#   3  upgrade_drill_with_live_positions  schedule -> apply early MUST fail -> wait -> apply
#   4  cancel_a_scheduled_upgrade         the abort path, timed
#   5  set_max_apr_bps_unstick_drill      freeze the rate oracle for real, then unstick it
#   6  deploy_script_fresh_run_repro      two FRESH=1 runs, identical code hashes and wiring
#   7  frontend_against_unseeded          every view answers on an EMPTY deployment (no panic/NaN)
#   8  ttl_upkeep_cron_rehearsal          the permissionless bump sweep, within budget
#
# Drill 3's timelock is the long pole: `MIN_TIMELOCK_SECS` is 3600, so a real wait-then-apply takes
# an hour. `UPGRADE_WAIT=0` (default) runs the half that matters for safety — schedule, observe,
# and prove `apply_upgrade` REFUSES before the eta — and skips the wait. `UPGRADE_WAIT=1` does the
# full hour.
# =================================================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NETWORK="${NETWORK:-testnet}"
SOURCE="${SOURCE:-alice425}"
STATE_FILE="${STATE_FILE:-}"
DRILLS="${DRILLS:-1,3,4,5,7,8}"
UPGRADE_WAIT="${UPGRADE_WAIT:-0}"
NET_ARGS=(--network "$NETWORK")

[ -n "$STATE_FILE" ] || { echo "ERROR: set STATE_FILE=<deployment>.state"; exit 1; }
[ -f "$STATE_FILE" ] || { echo "ERROR: no such state file: $STATE_FILE"; exit 1; }
if [ "$(cd "$(dirname "$STATE_FILE")" && pwd)/$(basename "$STATE_FILE")" = "$SCRIPT_DIR/deploy_sr_testnet.state" ] \
   && [ "${I_MEAN_IT:-0}" != "1" ]; then
  echo "ERROR: that is the LIVE testnet deployment. Drills 1 and 5 would break the dApp and SDK CI."
  echo "       Deploy a throwaway stack and point STATE_FILE at it. (I_MEAN_IT=1 overrides.)"
  exit 1
fi
# shellcheck disable=SC1090
source "$STATE_FILE"

ADDR=$(stellar keys address "$SOURCE")
PASS=0; FAIL=0; SKIP=0
declare_timing=""
hdr()  { printf '\n\033[1m═══ %s ═══\033[0m\n' "$1"; }
ok()   { PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31m✗ %s\033[0m\n' "$1"; }
skip() { SKIP=$((SKIP+1)); printf '  \033[33m—\033[0m %s\n' "$1"; }
note() { printf '    %s\n' "$1"; }
now()  { date +%s; }
record(){ declare_timing="${declare_timing}${1}|${2}\n"; }

# A read. Prints the scalar; returns non-zero if the call reverted or could not be reached.
v() { stellar contract invoke --id "$1" --source-account "$SOURCE" "${NET_ARGS[@]}" --send=no \
        -- "${@:2}" 2>/dev/null | tail -1 | tr -d '"' | tr -d '[:space:]'; }
# A read that is EXPECTED to revert. Returns 0 when it did revert.
v_reverts() { ! stellar contract invoke --id "$1" --source-account "$SOURCE" "${NET_ARGS[@]}" --send=no \
        -- "${@:2}" >/dev/null 2>&1; }
# A write. Returns 0 on success.
tx() { stellar contract invoke --id "$1" --source-account "$SOURCE" "${NET_ARGS[@]}" --send=yes \
        -- "${@:2}" >/dev/null 2>&1; }
# A write that is EXPECTED to fail.
tx_fails() { ! stellar contract invoke --id "$1" --source-account "$SOURCE" "${NET_ARGS[@]}" --send=yes \
        -- "${@:2}" >/dev/null 2>&1; }

want() { case ",$DRILLS," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

echo "Deployment : $STATE_FILE"
echo "Source     : $SOURCE ($ADDR)"
echo "Drills     : $DRILLS"

# ── 1. emergency_pause_drill ─────────────────────────────────────────────────────────────────────
if want 1; then
hdr "DRILL 1 — emergency_pause_drill"
PAUSABLE="SR:$SR YIELD:$YIELD SRMARKET:$SRMARKET SRVAULT:$SRVAULT SRROUTER:$SRROUTER"
t0=$(now)
for p in $PAUSABLE; do
  n="${p%%:*}"; c="${p##*:}"
  tx "$c" pause && ok "$n paused" || bad "$n: pause failed"
done
t_pause=$(( $(now) - t0 ))
note "time from first command to all five paused: ${t_pause}s"
record "1. pause all five contracts" "${t_pause}s"

note "-- inflows must be BLOCKED --"
tx_fails "$SR"      deposit --from "$ADDR" --receiver "$ADDR" --amount 1000000 --min_shares_out 0 \
  && ok "sr.deposit refused"        || bad "sr.deposit SUCCEEDED while paused"
tx_fails "$SRVAULT" deposit --user "$ADDR" --amount 1000000 \
  && ok "srvault.deposit refused"   || bad "srvault.deposit SUCCEEDED while paused"
tx_fails "$SRMARKET" add_liquidity --lp "$ADDR" --pt_in 100000 --sr_in 100000 --min_shares 0 \
  && ok "srmarket.add_liquidity refused" || bad "srmarket.add_liquidity SUCCEEDED while paused"

note "-- exits must still WORK --"
sr_bal=$(v "$SR" balance --id "$ADDR")
if [ -n "$sr_bal" ] && [ "$sr_bal" -gt 1000 ] 2>/dev/null; then
  tx "$SR" redeem --from "$ADDR" --receiver "$ADDR" --shares 1000 --min_underlying_out 0 \
    && ok "sr.redeem works while paused" || bad "sr.redeem BLOCKED while paused"
else
  skip "sr.redeem — no SR balance to exit with"
fi
tx "$YIELD" redeem_due_interest --user "$ADDR" \
  && ok "yield.redeem_due_interest works while paused" || bad "yield claim BLOCKED while paused"
# `lp_position(lp) -> (shares, pt, sr)`. There is no `lp_balance`/`lp_shares` — an earlier draft
# guessed those names, both reads failed, and the drill SKIPPED the exit it exists to prove.
lp=$(stellar contract invoke --id "$SRMARKET" --source-account "$SOURCE" "${NET_ARGS[@]}" --send=no \
      -- lp_position --lp "$ADDR" 2>/dev/null | tr -d '"[] \n' | cut -d, -f1)
if [ -n "$lp" ] && [ "$lp" -gt 1000 ] 2>/dev/null; then
  tx "$SRMARKET" remove_liquidity --lp "$ADDR" --shares 1000 --min_pt_out 0 --min_sr_out 0 \
    && ok "srmarket.remove_liquidity works while paused" || bad "remove_liquidity BLOCKED while paused"
else
  skip "remove_liquidity — no LP shares (read as '${lp:-unreadable}')"
fi

note "-- unpause and confirm full function returns --"
t1=$(now)
for p in $PAUSABLE; do
  n="${p%%:*}"; c="${p##*:}"
  tx "$c" unpause && ok "$n unpaused" || bad "$n: unpause failed"
done
t_unpause=$(( $(now) - t1 ))
record "1. unpause all five" "${t_unpause}s"
tx "$SR" deposit --from "$ADDR" --receiver "$ADDR" --amount 1000000 --min_shares_out 0 \
  && ok "sr.deposit works again after unpause" || bad "sr.deposit still refused after unpause"
fi

# ── 3 / 4. upgrade timelock ──────────────────────────────────────────────────────────────────────
if want 4; then
hdr "DRILL 4 — cancel_a_scheduled_upgrade_under_time_pressure"
HASH=$(v "$SR" code_hash)
t0=$(now)
if tx "$SR" schedule_upgrade --wasm_hash "$HASH"; then
  ok "upgrade scheduled (to its own current hash — a deliberate no-op)"
  p=$(v "$SR" pending_upgrade); [ -n "$p" ] && ok "pending_upgrade() is visible to users" || bad "pending_upgrade() empty"
  if tx "$SR" cancel_upgrade; then
    t_cancel=$(( $(now) - t0 ))
    ok "cancelled in ${t_cancel}s"
    record "4. schedule -> notice -> cancel" "${t_cancel}s"
    p=$(v "$SR" pending_upgrade)
    { [ -z "$p" ] || [ "$p" = "null" ]; } && ok "nothing pending after cancel" || bad "still pending: $p"
  else bad "cancel_upgrade failed"; fi
else bad "schedule_upgrade failed"; fi
fi

if want 3; then
hdr "DRILL 3 — upgrade_drill_with_live_positions"
before_sr=$(v "$SR" total_supply); before_ta=$(v "$SR" total_assets)
note "state before: total_supply=$before_sr total_assets=$before_ta"
tl=$(v "$SR" timelock); note "timelock is ${tl}s"
# The default 24h timelock makes a real wait-then-apply a day long. `MIN_TIMELOCK_SECS` is 3600, and
# lowering to it is itself part of the procedure being rehearsed (`set_timelock` is admin-gated and
# bounded). Only ever do this on a throwaway stack — on a live one it shortens users' exit window.
if [ "$UPGRADE_WAIT" = "1" ] && [ "$tl" -gt 3600 ] 2>/dev/null; then
  if tx "$SR" set_timelock --secs 3600; then
    tl=$(v "$SR" timelock); ok "timelock lowered to the ${tl}s floor for the drill"
  else bad "set_timelock to the floor failed"; fi
fi
HASH=$(v "$SR" code_hash)
if tx "$SR" schedule_upgrade --wasm_hash "$HASH"; then
  ok "upgrade scheduled with live positions in place"
  eta=$(v "$SR" pending_upgrade); note "pending: $eta"
  # THE security property: applying before the eta must be refused.
  tx_fails "$SR" apply_upgrade && ok "apply_upgrade REFUSED before the eta (the exit window holds)" \
                               || bad "apply_upgrade SUCCEEDED EARLY — the timelock does not hold"
  if [ "$UPGRADE_WAIT" = "1" ]; then
    note "waiting out the timelock (${tl}s)…"
    sleep "$((tl + 45))"
    t_apply=$(now)
    if tx "$SR" apply_upgrade; then
      ok "applied after the eta"
      record "3. apply once the eta passes" "$(( $(now) - t_apply ))s (after a ${tl}s wait)"
      h=$(v "$SR" code_hash); [ "$h" = "$HASH" ] && ok "code_hash is the scheduled hash ($h)" \
                                                 || bad "code_hash is $h, expected $HASH"
      p=$(v "$SR" pending_upgrade); { [ -z "$p" ] || [ "$p" = "null" ]; } \
        && ok "pending_upgrade cleared after apply" || bad "still pending: $p"
      # Read the surviving state BEFORE probing with a deposit. An earlier version checked after,
      # so its own deposit moved total_supply and the drill reported a false failure.
      mid_sr=$(v "$SR" total_supply)
      [ "$mid_sr" = "$before_sr" ] && ok "total_supply survived the upgrade EXACTLY ($mid_sr)" \
                                   || bad "total_supply changed across the upgrade: $before_sr -> $mid_sr"
      tx "$SR" deposit --from "$ADDR" --receiver "$ADDR" --amount 1000000 --min_shares_out 0 \
        && ok "deposits still work after the upgrade" || bad "deposits broken after the upgrade"
    else bad "apply_upgrade failed after the eta"; fi
    tx "$SR" set_timelock --secs 86400 >/dev/null 2>&1 && note "timelock restored to 86400s"
  else
    tx "$SR" cancel_upgrade >/dev/null 2>&1
    skip "wait-then-apply skipped (UPGRADE_WAIT=1 to run the full ${tl}s); proposal cancelled"
  fi
  after_sr=$(v "$SR" total_supply); after_ta=$(v "$SR" total_assets)
  # This drill deposits on purpose, so supply may legitimately have GROWN. What must never happen is
  # shares vanishing across an upgrade.
  [ -n "$after_sr" ] && [ "$after_sr" -ge "$before_sr" ] 2>/dev/null \
    && ok "no shares destroyed across the drill ($before_sr -> $after_sr)" \
    || bad "shares LOST: $before_sr -> $after_sr"
  [ -n "$after_ta" ] && ok "total_assets still readable ($after_ta)" || bad "total_assets unreadable"
else bad "schedule_upgrade failed"; fi
fi

# ── 5. set_max_apr_bps_unstick_drill ─────────────────────────────────────────────────────────────
if want 5; then
hdr "DRILL 5 — set_max_apr_bps_unstick_drill"
orig=$(v "$STRATEGY" rate_bound); note "rate_bound before: $orig"
r0=$(v "$STRATEGY" current_rate); note "current_rate: $r0"
if tx "$STRATEGY" set_max_apr_bps --max_apr_bps 0; then
  ok "max_apr_bps set to 0 — any rate rise beyond 16 stroops now trips the bound"
  note "letting Blend's b_rate move…"
  sleep 45
  t0=$(now)
  if v_reverts "$STRATEGY" current_rate; then
    ok "PROTOCOL FROZEN — strategy.current_rate reverts (RateOutOfBounds), as designed"
    v_reverts "$SR" exchange_rate && ok "sr.exchange_rate frozen too (the freeze propagates)" \
                                  || note "sr.exchange_rate still answers (it reads a stored high-water mark)"
    tx_fails "$SR" deposit --from "$ADDR" --receiver "$ADDR" --amount 1000000 --min_shares_out 0 \
      && ok "deposits refused during the freeze" || bad "deposit SUCCEEDED during the freeze"
    if tx "$STRATEGY" set_max_apr_bps --max_apr_bps 30000; then
      t_fix=$(( $(now) - t0 ))
      ok "unstuck with ONE admin call in ${t_fix}s"
      record "5. detect freeze -> set_max_apr_bps -> recovered" "${t_fix}s"
      r1=$(v "$STRATEGY" current_rate)
      [ -n "$r1" ] && ok "current_rate answers again ($r1)" || bad "still frozen after the fix"
      tx "$SR" deposit --from "$ADDR" --receiver "$ADDR" --amount 1000000 --min_shares_out 0 \
        && ok "deposits work again" || bad "deposits still refused"
    else bad "set_max_apr_bps recovery call failed"; fi
  else
    tx "$STRATEGY" set_max_apr_bps --max_apr_bps 30000 >/dev/null 2>&1
    skip "the bound did not trip in 45s (b_rate moved <16 stroops); restored max_apr_bps"
  fi
else bad "set_max_apr_bps failed"; fi
fi

# ── 7. every view answers on an unseeded deployment ──────────────────────────────────────────────
if want 7; then
hdr "DRILL 7 — views on an unseeded/empty deployment (the frontend's empty-state contract)"
for pair in "SR:$SR:total_assets" "SR:$SR:total_supply" "SR:$SR:exchange_rate" \
            "SR:$SR:deposit_headroom" "SR:$SR:deposit_cap" "SR:$SR:realizable_rate" \
            "YIELD:$YIELD:solvency" "YIELD:$YIELD:py_index" \
            "SRMARKET:$SRMARKET:implied_apy" "SRMARKET:$SRMARKET:reserves" \
            "SRVAULT:$SRVAULT:stats" "SRVAULT:$SRVAULT:rate_bps" \
            "STRATEGY:$STRATEGY:available_liquidity" "STRATEGY:$STRATEGY:position_value_unguarded"; do
  n="${pair%%:*}"; rest="${pair#*:}"; c="${rest%%:*}"; f="${rest##*:}"
  out=$(v "$c" "$f")
  if [ -n "$out" ]; then ok "$n.$f -> $out"; else bad "$n.$f returned NOTHING (a frontend would render NaN or spin)"; fi
done
fi

# ── 8. ttl_upkeep_cron_rehearsal ─────────────────────────────────────────────────────────────────
if want 8; then
hdr "DRILL 8 — ttl_upkeep_cron_rehearsal"
t0=$(now)
for pair in "sr.bump_holder:$SR:bump_holder:--user" "yield.bump_holder:$YIELD:bump_holder:--user"; do
  n="${pair%%:*}"; rest="${pair#*:}"; c="${rest%%:*}"; rest="${rest#*:}"; f="${rest%%:*}"; a="${rest##*:}"
  tx "$c" "$f" "$a" "$ADDR" && ok "$n is permissionless and within budget" || bad "$n failed"
done
tx "$SRMARKET" bump_lp --lp "$ADDR" && ok "srmarket.bump_lp within budget" || skip "srmarket.bump_lp (no LP position)"
t_ttl=$(( $(now) - t0 ))
record "8. TTL bump sweep (3 entries)" "${t_ttl}s"
fi

hdr "SUMMARY"
printf '  %s passed, %s failed, %s skipped\n\n' "$PASS" "$FAIL" "$SKIP"
printf '\033[1m  Timings for the runbook\033[0m\n'
printf "$declare_timing" | while IFS='|' read -r what how; do
  [ -n "$what" ] && printf '    %-46s %s\n' "$what" "$how"
done
exit $(( FAIL > 0 ))
