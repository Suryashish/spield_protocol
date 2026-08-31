#!/usr/bin/env bash
# =================================================================================================
# test_vault_lifecycle.sh — the Fixed-Rate Vault, end to end, ON CHAIN.
#
# `test_sr_testnet.sh` runs 18 workflow phases against a live deployment and contains **zero**
# references to `SRVAULT`. Every product is covered on chain except the flagship one: deposit USDC,
# receive a receipt for an exact payout on an exact date, redeem it at maturity.
#
# The vault has 36 unit tests, and they pass — against a LOCAL Blend fixture that `budget.md` records
# as understating the deployed pool by at least 4x. That gap has already bitten this repo once: two
# router paths passed locally and were over budget on chain. `redeem` is the most on-chain-sensitive
# path in the protocol — it sizes its burn to the liquidity Blend can actually pay, can partially
# fill, and tracks a running `collected` total. A local fixture cannot predict that.
#
#   STATE_FILE=<deployment>.state ./scripts/test_vault_lifecycle.sh
#
# ── The maturity problem, and how this works around it ───────────────────────────────────────────
#
# `srvault::redeem` panics `VaultNotMatured` until `now >= receipt.maturity`, and a production series
# is 30 days. So a full lifecycle CANNOT be tested against a normal deployment on the day.
#
# Deploy a throwaway stack with a maturity minutes away instead:
#
#   EXPIRY=$(( $(date +%s) + 2400 )) VAULT_SEED_AMOUNT=50000000 FRESH=1 \
#     STATE_FILE=/tmp/C.state ISSUER=<a fresh issuer> ./scripts/deploy_sr_testnet.sh
#
# Everything else about the stack is real: real Blend, real testnet USDC, real transactions.
# =================================================================================================
set -uo pipefail

NETWORK="${NETWORK:-testnet}"
SOURCE="${SOURCE:-alice425}"
STATE_FILE="${STATE_FILE:-}"
DEPOSIT="${DEPOSIT:-10000000}"        # 1 USDC
NET_ARGS=(--network "$NETWORK")

[ -n "$STATE_FILE" ] && [ -f "$STATE_FILE" ] || { echo "ERROR: set STATE_FILE=<deployment>.state"; exit 1; }
# shellcheck disable=SC1090
source "$STATE_FILE"
ADDR=$(stellar keys address "$SOURCE")

PASS=0; FAIL=0
hdr() { printf '\n\033[1m=== %s ===\033[0m\n' "$1"; }
ok()  { PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  \033[31m✗ %s\033[0m\n' "$1"; }
note(){ printf '    %s\n' "$1"; }

v()  { stellar contract invoke --id "$1" --source-account "$SOURCE" "${NET_ARGS[@]}" --send=no \
         -- "${@:2}" 2>/dev/null | tail -1 | tr -d '"' | tr -d '[:space:]'; }
vr() { stellar contract invoke --id "$1" --source-account "$SOURCE" "${NET_ARGS[@]}" --send=no \
         -- "${@:2}" 2>/dev/null | tail -1; }
tx() { stellar contract invoke --id "$1" --source-account "$SOURCE" "${NET_ARGS[@]}" --send=yes \
         -- "${@:2}" 2>/dev/null | tail -1 | tr -d '"' | tr -d '[:space:]'; }
tx_ok()    { stellar contract invoke --id "$1" --source-account "$SOURCE" "${NET_ARGS[@]}" --send=yes -- "${@:2}" >/dev/null 2>&1; }
tx_fails() { ! stellar contract invoke --id "$1" --source-account "$SOURCE" "${NET_ARGS[@]}" --send=yes -- "${@:2}" >/dev/null 2>&1; }

echo "Deployment : $STATE_FILE"
echo "Vault      : $SRVAULT"
echo "Depositor  : $SOURCE ($ADDR)"

# ── 16. quote and deposit ────────────────────────────────────────────────────────────────────────
hdr "16. WORKFLOW: deposit USDC, receive a fixed-payout receipt"
mat=$(v "$SRVAULT" maturity)
now=$(date +%s)
note "maturity $mat — $(( mat - now ))s away"
[ "$mat" -gt "$now" ] 2>/dev/null && ok "series is open" || { bad "series already matured — deploy a fresh stack"; exit 1; }

st0=$(vr "$SRVAULT" stats); note "stats before: $st0"
q=$(vr "$SRVAULT" quote --amount "$DEPOSIT")
note "quote($DEPOSIT) -> $q   (payout, coupon, rate_bps)"
payout=$(printf '%s' "$q" | tr -d '"[] ' | cut -d, -f1)
coupon=$(printf '%s' "$q" | tr -d '"[] ' | cut -d, -f2)
[ -n "$payout" ] && [ "$payout" -gt "$DEPOSIT" ] 2>/dev/null \
  && ok "quoted payout $payout > deposit $DEPOSIT (coupon $coupon)" \
  || bad "quote did not exceed the deposit: '$q'"

usdc0=$(v "$USDC_SAC" balance --id "$ADDR")
rid=$(tx_ok "$SRVAULT" deposit --user "$ADDR" --amount "$DEPOSIT" && v "$SRVAULT" stats)
if [ -n "$rid" ]; then
  ok "deposit accepted on chain"
else
  bad "deposit FAILED on chain"; fi
usdc1=$(v "$USDC_SAC" balance --id "$ADDR")
[ -n "$usdc0" ] && [ -n "$usdc1" ] && [ "$usdc1" -lt "$usdc0" ] 2>/dev/null \
  && ok "USDC actually left the wallet ($usdc0 -> $usdc1)" || bad "USDC did not move ($usdc0 -> $usdc1)"

# The receipt id is `open_receipts - 1` on a fresh stack; read it back to be sure.
RECEIPT_ID="${RECEIPT_ID:-0}"
r=$(vr "$SRVAULT" get_receipt --receipt_id "$RECEIPT_ID")
note "receipt #$RECEIPT_ID: $r"
printf '%s' "$r" | grep -q "$payout" && ok "receipt records the exact quoted payout" \
                                     || bad "receipt payout does not match the quote"
printf '%s' "$r" | grep -q '"open":true' && ok "receipt is open" || note "receipt open flag: $(printf '%s' "$r" | grep -o '"open":[a-z]*')"

st1=$(vr "$SRVAULT" stats); note "stats after: $st1"
lia=$(v "$SRVAULT" total_liability)
[ -n "$lia" ] && [ "$lia" -ge "$payout" ] 2>/dev/null \
  && ok "total_liability covers the promise ($lia >= $payout)" || bad "liability $lia < payout $payout"

# ── 17. the capacity refusal ─────────────────────────────────────────────────────────────────────
hdr "17. INVARIANT: the vault refuses a coupon it cannot already cover"
huge=$(( DEPOSIT * 100000 ))
tx_fails "$SRVAULT" deposit --user "$ADDR" --amount "$huge" \
  && ok "an oversized deposit is refused (InsufficientCapacity) — the vault cannot over-promise" \
  || bad "the vault ACCEPTED a deposit it has no PT inventory to cover"

# ── 18. redeem before maturity must fail; after maturity must pay ────────────────────────────────
hdr "18. WORKFLOW: redeem at maturity"
tx_fails "$SRVAULT" redeem --receipt_id "$RECEIPT_ID" \
  && ok "redeem REFUSED before maturity (VaultNotMatured)" \
  || bad "redeem SUCCEEDED before maturity — the term is not enforced"

now=$(date +%s); wait_s=$(( mat - now + 30 ))
if [ "$wait_s" -gt 0 ]; then note "waiting ${wait_s}s for maturity…"; sleep "$wait_s"; fi

tx_ok "$SRVAULT" harvest && ok "harvest works at maturity" || note "harvest returned non-zero (may be a no-op)"

usdc2=$(v "$USDC_SAC" balance --id "$ADDR")
if tx_ok "$SRVAULT" redeem --receipt_id "$RECEIPT_ID"; then
  ok "REDEEM SUCCEEDED ON CHAIN"
  usdc3=$(v "$USDC_SAC" balance --id "$ADDR")
  gained=$(( usdc3 - usdc2 ))
  note "USDC $usdc2 -> $usdc3   (+$gained, promised $payout)"
  [ "$gained" -gt 0 ] 2>/dev/null && ok "real USDC arrived" || bad "no USDC arrived"
  # The promise is exact. Allow only rounding dust downward.
  if [ "$gained" -ge "$(( payout - 10 ))" ] 2>/dev/null; then
    ok "paid the promised payout in full ($gained >= $payout - dust)"
  else
    rem=$(v "$SRVAULT" redeem_remaining --receipt_id "$RECEIPT_ID")
    bad "SHORT PAID: got $gained of $payout; redeem_remaining says $rem"
  fi
  rem=$(v "$SRVAULT" redeem_remaining --receipt_id "$RECEIPT_ID")
  [ "$rem" = "0" ] && ok "redeem_remaining is 0 — the receipt is fully settled" \
                   || bad "redeem_remaining is $rem — the exit is unfinished"
  r2=$(vr "$SRVAULT" get_receipt --receipt_id "$RECEIPT_ID")
  printf '%s' "$r2" | grep -q '"open":false' && ok "receipt closed" || note "receipt: $r2"
  st2=$(vr "$SRVAULT" stats); note "stats final: $st2"
  # `total_collected` is NOT a lifetime counter of redemptions. It is a GAUGE of money currently
  # banked against still-open PARTIAL receipts: the partial path adds to it, and the completion path
  # does `total_collected -= r.collected` and zeroes the receipt. So after a clean full redemption it
  # correctly returns to 0, and it reads 0 whether there have been no redemptions or a thousand.
  #
  # An earlier version of this script asserted the opposite and failed a perfectly good redemption.
  # What actually proves a redemption landed is the liability and the receipt count.
  lia2=$(v "$SRVAULT" total_liability)
  [ "$lia2" = "0" ] && ok "total_liability is back to 0 — the promise is discharged" \
                    || bad "total_liability still $lia2 after a full redemption"
  open2=$(printf '%s' "$st2" | grep -o '"open_receipts":[0-9]*' | cut -d: -f2)
  [ "$open2" = "0" ] && ok "open_receipts is back to 0" || bad "open_receipts is $open2"
  [ "$(printf '%s' "$st2" | grep -o '\"total_collected\":\"[0-9]*\"')" = '"total_collected":"0"' ] \
    && ok "total_collected back to 0 — correct for a COMPLETED receipt (it gauges partials only)" \
    || note "total_collected non-zero — some receipt is still part-paid"
else
  bad "REDEEM FAILED ON CHAIN — this is the path Deliverable 1 needs a mainnet tx hash for"
  note "redeem_remaining: $(v "$SRVAULT" redeem_remaining --receipt_id "$RECEIPT_ID")"
  note "stats: $(vr "$SRVAULT" stats)"
fi

hdr "SUMMARY"
printf '  %s passed, %s failed\n' "$PASS" "$FAIL"
exit $(( FAIL > 0 ))
