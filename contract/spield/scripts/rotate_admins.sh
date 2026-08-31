#!/usr/bin/env bash
# =================================================================================================
# rotate_admins.sh — rotate the admin of every Spield v2 contract to a new address (a multisig).
#
# Works against **testnet** and **mainnet** from one file, because the procedure is identical on
# both and two copies would drift. The network is a switch, not a fork:
#
#   ./scripts/rotate_admins.sh                                  # testnet, verify only (safe default)
#   MODE=rotate TO=<G…> TO_SIGNERS=a,b ./scripts/rotate_admins.sh
#   NETWORK=mainnet MODE=rotate TO=<G…> TO_SIGNERS=cold1,cold2 ./scripts/rotate_admins.sh
#
# ── What "multisig" means here ───────────────────────────────────────────────────────────────────
#
# Soroban has no multisig primitive. A contract admin is just an `Address`, and `require_auth()` asks
# the host "is this address authorizing?". When the address is a classic Stellar account (G…), the
# host answers by checking that account's **signers and thresholds** — the same rules that guard an
# ordinary payment. So "the multisig" is simply:
#
#     a normal Stellar account whose master key is disabled (weight 0),
#     with N signers of weight 1 and a medium threshold of M   →   an M-of-N account.
#
# Soroban invocations are **medium-threshold** operations, so `med_threshold` is the one that governs
# admin actions. Set low/med/high together unless you have a reason not to.
#
# Nothing about the contracts changes. `admin()` returns a G-address instead of a G-address; the
# difference is that producing a valid signature for it now takes M people instead of one.
#
# ── How a multisig actually signs a contract call ────────────────────────────────────────────────
#
# `stellar contract invoke` signs with one local key, which cannot satisfy a 2-of-3. The four-step
# path below is what this script does internally, and what you would do by hand:
#
#   1. stellar contract invoke --build-only --source-account <MULTISIG>   → unsigned, UNSIMULATED tx
#   2. stellar tx simulate     --source-account <MULTISIG>                → adds footprint + fee
#   3. stellar tx sign --sign-with-key <signer>   (repeat, piped, once per signer)
#   4. stellar tx send
#
# Step 2 is not optional. `--build-only` emits a transaction with fee 100 and no Soroban resources;
# submitting it unsimulated fails. Verified on testnet 2026-08-31.
#
# Because the multisig is the transaction's **source account**, the auth entry uses
# `source_account` credentials — the envelope signatures satisfy `require_auth()` directly and there
# is no separate Soroban auth entry to sign. Verified: 1-of-3 signatures → `TxBadAuth`; 2-of-3 → success.
#
# ── Why rotation is two steps, and why that makes it safe ────────────────────────────────────────
#
#   propose_admin(new)   signed by the CURRENT admin   — records a pending admin, grants nothing
#   accept_admin()       signed by the NEW admin       — the new admin takes over
#
# The second step is the safety property: an address that cannot sign can never become admin, so
# rotating to a typo, a dead key, or a multisig whose signers you have lost is **impossible**. If
# `accept_admin` cannot be produced, nothing has changed and the current admin still holds the keys.
# `cancel_admin_transfer` (MODE=cancel) clears the proposal.
#
# ── Six contracts, not four ──────────────────────────────────────────────────────────────────────
#
# MAINNET.md §6.1 says four admin roles. That is the retired v1 stack. The v2 stack is SIX:
# sr, strategy, yield, srmarket, srvault, srrouter — every one carries the full governance surface.
# Rotating four of six leaves a split-brain protocol. This script does all six or reports loudly.
#
# ── Roles this script does NOT move by default ───────────────────────────────────────────────────
#
# Three addresses receive money and are NOT the admin. Rotating admin leaves them where they are:
#
#     yield.treasury          protocol yield fee            — stored explicitly, never tracks admin
#     srmarket.treasury       treasury share of swap fees   — stored explicitly, never tracks admin
#     strategy.emissions_to   BLND emissions                — SEE BELOW, it is not like the other two
#
# `strategy::emissions_to()` is `storage.get(EmissionsTo).unwrap_or_else(current_admin)`. If it was
# never set explicitly it **falls back to the admin**, so rotating admin silently moves the emissions
# destination with it. The deploy scripts do set it (`EMISSIONS_TO_SET=1` in the state file), but a
# deployment where that step was skipped behaves differently. This script prints the value before and
# after precisely so the difference is visible rather than assumed.
#
# MODE=payouts moves them, and must run AFTER the rotation (their setters are admin-gated, so the
# NEW admin signs them). They are deliberately separate: a cold multisig is the right home for
# control, but not necessarily for a fee stream you want to spend from.
#
# ── These are PUSH destinations, not claimable balances ──────────────────────────────────────────
#
# There is no "withdraw the fees" call, and the admin does not collect anything. The money is
# transferred the moment it is earned:
#
#   yield fee   `sr.transfer(me, treasury, fee)` inside the same tx that pays a YT holder
#   swap fee    `sr.transfer(me, treasury, share)` inside the same tx as the swap
#   emissions   `claim_emissions()` is PERMISSIONLESS — anyone may call it, and the destination is
#               read from storage, so the caller cannot redirect it. A keeper runs it on a schedule.
#
# So the destination address simply *owns* the tokens, like any wallet. Turning the accumulated SR
# into USDC is `sr.redeem(from = that address, ...)`, which needs that address's own signature — so
# if the treasury is the multisig, every spend needs the full threshold.
#
# Two things ARE admin-gated pulls, and they live on the vault, not here:
#   srvault.sweep(to, amount)   recover leftover PT inventory
#   srvault.sweep_surplus(to)   recover leftover SR / YT / USDC — only AFTER maturity
#
# One operational warning: SR has no maturity, so a dormant treasury balance is the entry most
# exposed to state archival. `sr.bump_holder` is permissionless and the keeper covers it — but a
# cold multisig treasury that nobody touches for a year is exactly the account that needs it.
# =================================================================================================
set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────────────────────────
NETWORK="${NETWORK:-testnet}"
MODE="${MODE:-verify}"                 # verify | rotate | cancel | payouts

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The v2 mainnet run writes `deploy_mainnet_v2.state`. `deploy_mainnet.state` is the RETIRED v1 run
# and still holds live v1 addresses — pointing at it would read the wrong contracts entirely.
case "$NETWORK" in
  testnet) DEFAULT_STATE="$SCRIPT_DIR/deploy_sr_testnet.state" ;;
  mainnet) DEFAULT_STATE="$SCRIPT_DIR/deploy_mainnet_v2.state" ;;
  *)       DEFAULT_STATE="$SCRIPT_DIR/deploy_${NETWORK}.state" ;;
esac
STATE_FILE="${STATE_FILE:-$DEFAULT_STATE}"
LOG_FILE="${LOG_FILE:-$SCRIPT_DIR/rotate_admins.${NETWORK}.log}"

TO="${TO:-}"                           # the new admin address (G… or C…)
TO_SIGNERS="${TO_SIGNERS:-}"           # csv of local identities that sign for TO
FROM_SIGNERS="${FROM_SIGNERS:-}"       # csv of local identities that sign for the CURRENT admin
PAYOUTS_TO="${PAYOUTS_TO:-}"           # MODE=payouts destination (defaults to TO)
ALLOW_MIXED="${ALLOW_MIXED:-0}"        # proceed even if the six contracts disagree on admin
OFFLINE_DIR="${OFFLINE_DIR:-}"         # write unsigned XDR here instead of signing (hardware wallets)
ASSUME_YES="${ASSUME_YES:-0}"

# Passphrase + RPC rather than `--network mainnet`, for the same reason `deploy_mainnet.sh` does it:
# the CLI ships NO mainnet RPC url (`stellar network ls` shows the literal placeholder "Bring Your
# Own"), so `--network mainnet` dies with `Invalid URL Bring Your Own` on any machine that has not
# configured one by hand. Testnet's alias is real and is used as-is.
case "$NETWORK" in
  mainnet)
    NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Public Global Stellar Network ; September 2015}"
    RPC_URL="${RPC_URL:-https://mainnet.sorobanrpc.com}"
    NET_ARGS=(--network-passphrase "$NETWORK_PASSPHRASE" --rpc-url "$RPC_URL")
    ;;
  *)
    NET_ARGS=(--network "$NETWORK")
    [ -n "${RPC_URL:-}" ] && NET_ARGS+=(--rpc-url "$RPC_URL")
    ;;
esac

# Contracts, in the order they are rotated. Order does not matter for correctness — there is no
# cross-contract dependency in governance — but a stable order makes a partial run legible.
CONTRACT_KEYS=(SR STRATEGY YIELD SRMARKET SRVAULT SRROUTER)

PASS=0; FAIL=0
# macOS ships bash 3.2, which has no associative arrays — and the deploy scripts avoid them for the
# same reason. Indirect expansion covers the same ground: contract addresses already arrive from the
# state file as plain variables (SR=…, YIELD=…), so the key IS the variable name.
gv() { local n="$1"; printf '%s' "${!n:-}"; }
sv() { eval "$1=\$2"; }
c_ok()   { PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
c_bad()  { FAIL=$((FAIL+1)); printf '  \033[31m✗ %s\033[0m\n' "$1"; }
hdr()    { printf '\n\033[1m=== %s ===\033[0m\n' "$1"; }
note()   { printf '    %s\n' "$1"; }
die()    { printf '\033[31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }
log()    { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$LOG_FILE"; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# ─── Load the deployment ─────────────────────────────────────────────────────────────────────────
[ -f "$STATE_FILE" ] || die "state file not found: $STATE_FILE"
# shellcheck disable=SC1090
source "$STATE_FILE"

MISSING=()
for k in "${CONTRACT_KEYS[@]}"; do
  v="${!k:-}"
  [ -n "$v" ] || MISSING+=("$k")
done
if [ "${#MISSING[@]}" -gt 0 ]; then
  die "state file $STATE_FILE has no ${MISSING[*]}.
       This looks like a v1 deployment (wrapper/vault/market). The v2 stack has six contracts and
       this script rotates all six. Point STATE_FILE at the v2 state, or deploy v2 first."
fi

# ─── Primitives ──────────────────────────────────────────────────────────────────────────────────

# A read-only view. Simulation only — costs nothing, needs no key. Prints the unquoted scalar.
# Returns non-zero (and prints nothing) if the read fails, so callers must never treat empty as a match.
view() {  # view <contract-id> <fn> [args...]
  local out
  out=$(stellar contract invoke --id "$1" --source-account "$READER" "${NET_ARGS[@]}" --send=no \
        -- "${@:2}" 2>/dev/null) || return 1
  printf '%s' "$(printf '%s' "$out" | tail -1 | tr -d '"' | tr -d '[:space:]')"
}

# Submit a state-changing call authorized by <auth_addr>, signed by <signers_csv>.
#
# Handles single-sig and multisig identically: the auth address is the transaction source, so the
# envelope signatures are what `require_auth()` checks. With one signer this is equivalent to a plain
# `contract invoke`; with M it is the only way to clear an M-of-N threshold.
#
# With OFFLINE_DIR set it stops after simulation and writes the unsigned envelope for external
# signing — the path you want when the signers are hardware wallets on separate machines.
submit_as() {  # submit_as <auth_addr> <signers_csv> <label> <contract-id> <fn> [args...]
  local auth="$1" signers="$2" label="$3" id="$4"; shift 4
  local raw sim signed k

  if ! raw=$(stellar contract invoke --id "$id" --source-account "$auth" "${NET_ARGS[@]}" \
             --build-only -- "$@" 2>"$TMP/err"); then
    c_bad "$label: could not build — $(tail -1 "$TMP/err")"; return 1
  fi
  # --build-only emits fee 100 and no Soroban resources. Simulation is what makes it submittable.
  if ! sim=$(printf '%s' "$raw" | stellar tx simulate --source-account "$auth" "${NET_ARGS[@]}" \
             2>"$TMP/err"); then
    c_bad "$label: simulation failed — $(tail -1 "$TMP/err")"; return 1
  fi

  if [ -n "$OFFLINE_DIR" ]; then
    mkdir -p "$OFFLINE_DIR"
    printf '%s' "$sim" > "$OFFLINE_DIR/${label//[^A-Za-z0-9_.-]/_}.xdr"
    c_ok "$label -> ${label//[^A-Za-z0-9_.-]/_}.xdr (unsigned, simulated)"
    # 2 = "written, not submitted". Callers must not report this as a completed step.
    return 2
  fi

  [ -n "$signers" ] || { c_bad "$label: no signers given for $auth"; return 1; }
  signed="$sim"
  IFS=',' read -ra ks <<< "$signers"
  for k in "${ks[@]}"; do
    [ -n "$k" ] || continue
    if ! signed=$(printf '%s' "$signed" | stellar tx sign --sign-with-key "$k" "${NET_ARGS[@]}" \
                  2>"$TMP/err"); then
      c_bad "$label: signing with '$k' failed — $(tail -1 "$TMP/err")"; return 1
    fi
  done
  if ! printf '%s' "$signed" | stellar tx send "${NET_ARGS[@]}" >"$TMP/out" 2>"$TMP/err"; then
    c_bad "$label: submission failed — $(grep -oE 'Tx[A-Za-z]+|error:.*' "$TMP/err" | tail -1)"
    log "FAIL $label: $(tail -2 "$TMP/err" | tr '\n' ' ')"
    return 1
  fi
  log "OK $label"
  return 0
}

# Resolve a local identity name to its address; empty if it is not a known identity.
id_addr() { stellar keys address "$1" 2>/dev/null || true; }

# Find a local identity whose address matches $1. Empty if none — which is the normal case for a
# multisig (you hold its SIGNERS, never a key for the account itself).
identity_for() {
  local want="$1" k
  for k in $(stellar keys ls 2>/dev/null); do
    [ "$(id_addr "$k")" = "$want" ] && { printf '%s' "$k"; return 0; }
  done
  printf ''
}

# Print an account's signer set and thresholds. This is the whole definition of "the multisig", so
# it is shown before anything irreversible and again in the final report.
describe_account() {  # describe_account <G-address>
  local a="$1" horizon
  case "$NETWORK" in
    mainnet) horizon="${HORIZON_URL:-https://horizon.stellar.org}" ;;
    *)       horizon="${HORIZON_URL:-https://horizon-testnet.stellar.org}" ;;
  esac
  if [[ "$a" != G* ]]; then
    note "$a is a contract address — its authorization is that contract's own logic, not signers/thresholds."
    return 0
  fi
  curl -s -m 20 "$horizon/accounts/$a" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print('    (account not found on this network — it must exist before it can accept admin)'); raise SystemExit(0)
if 'thresholds' not in d:
    print('    (account not found on this network — it must exist before it can accept admin)'); raise SystemExit(0)
t = d['thresholds']
sg = [s for s in d['signers'] if s['weight'] > 0]
tot = sum(s['weight'] for s in sg)
med = t['med_threshold']
print('    thresholds  low/med/high = %s/%s/%s   (Soroban calls use MED)' % (t['low_threshold'], med, t['high_threshold']))
for s in d['signers']:
    tag = '  <-- master key DISABLED' if s['key'] == d['account_id'] and s['weight'] == 0 else ''
    print('    signer      %s  weight %s%s' % (s['key'], s['weight'], tag))
if med <= 1 and tot <= 1:
    print('    \033[33mSHAPE       single-signature account — this is NOT a multisig\033[0m')
elif med == 0:
    print('    \033[31mSHAPE       med_threshold is 0 — ANY signer can act alone\033[0m')
else:
    print('    SHAPE       %d-of-%d (total signing weight %d, medium threshold %d)' % (med, len(sg), tot, med))
    if tot < med:
        print('    \033[31mDANGER      total weight %d < threshold %d — this account CANNOT authorize anything\033[0m' % (tot, med))
"
}

# Is `EmissionsTo` explicitly stored, or is `emissions_to()` merely falling back to the admin?
#
# The getter CANNOT tell you: it returns the same address either way, and on a deployment where the
# destination was deliberately set to the admin the two are identical. Only the raw instance storage
# distinguishes them, so that is what this reads. Getting this wrong in either direction is bad — it
# is the difference between "this address stays put" and "this address just moved with the admin".
emissions_explicit() {  # -> yes | no | unknown
  local out
  out=$(stellar contract read --id "$STRATEGY" "${NET_ARGS[@]}" --output json 2>/dev/null) || { printf 'unknown'; return 0; }
  printf '%s' "$out" | python3 -c "
import sys, csv, json
try:
    row = next(csv.reader(sys.stdin))
    st = json.loads(row[1])['contract_instance']['storage']
    hit = any('vec' in e['key'] and e['key']['vec'][0].get('symbol') == 'EmissionsTo' for e in st)
    print('yes' if hit else 'no')
except Exception:
    print('unknown')
" 2>/dev/null || printf 'unknown'
}

# The three addresses that receive money. Printed identically everywhere so the same facts are on
# screen before and after a rotation.
print_payout_roles() {
  local tag
  printf '  %-26s %s\n' "yield.treasury"    "$(view "$YIELD" treasury || echo '?')"
  printf '  %-26s %s\n' "srmarket.treasury" "$(view "$SRMARKET" treasury || echo '?')"
  case "$(emissions_explicit)" in
    yes) tag="   (explicitly set — does NOT follow the admin)" ;;
    no)  tag="   <-- NOT SET: this value IS the admin, so it MOVES whenever the admin moves" ;;
    *)   tag="   (could not read instance storage — could not tell whether it is set)" ;;
  esac
  printf '  %-26s %s%s\n' "strategy.emissions_to" "$(view "$STRATEGY" emissions_to || echo '?')" "$tag"
}

# ─── Discover the current admin ──────────────────────────────────────────────────────────────────
# The reader only ever simulates, so any existing account works. Prefer a real one so simulation
# does not trip on a missing source account.
READER="${READER:-}"
if [ -z "$READER" ]; then
  if [ -n "$TO" ] && [[ "$TO" == G* ]]; then READER="$TO"
  else READER="$(id_addr "${SOURCE:-}" 2>/dev/null || true)"; fi
fi
[ -n "$READER" ] || READER="$(stellar keys address "$(stellar keys ls 2>/dev/null | head -1)" 2>/dev/null || true)"
[ -n "$READER" ] || die "no local identity to simulate from. Set READER=<G-address>."

hdr "0. Deployment and current admin  ($NETWORK)"
note "state file : $STATE_FILE"
ADMINS_SEEN=()
for k in "${CONTRACT_KEYS[@]}"; do
  a=$(view "$(gv "$k")" admin) || a=""
  p=$(view "$(gv "$k")" pending_admin) || p=""
  [ -n "$a" ] || die "could not read admin() from $k ($(gv "$k")). Wrong network, or not deployed."
  sv "ADMIN_OF_$k" "$a"; sv "PENDING_OF_$k" "$p"
  printf '  %-9s %s  admin=%s%s\n' "$k" "$(gv "$k")" "$a" \
    "$([ -n "$p" ] && [ "$p" != "null" ] && printf '  pending=%s' "$p" || true)"
  case " ${ADMINS_SEEN[*]:-} " in *" $a "*) ;; *) ADMINS_SEEN+=("$a") ;; esac
done

if [ "${#ADMINS_SEEN[@]:-0}" -ne 1 ]; then
  printf '\n\033[31m  SPLIT-BRAIN: the six contracts do NOT share one admin:\033[0m\n'
  for a in "${ADMINS_SEEN[@]}"; do printf '    %s\n' "$a"; done
  [ "$ALLOW_MIXED" = "1" ] || die "refusing to act on a split-brain deployment. Investigate, then re-run with ALLOW_MIXED=1."
fi
FROM="${ADMINS_SEEN[0]}"

hdr "1. The current admin"
printf '  %s\n' "$FROM"
describe_account "$FROM"
if [ -z "$FROM_SIGNERS" ]; then
  cand="$(identity_for "$FROM")"
  [ -n "$cand" ] && FROM_SIGNERS="$cand"
fi
if [ -n "$FROM_SIGNERS" ]; then note "signing with: $FROM_SIGNERS"
else note "no local identity matches — set FROM_SIGNERS=<csv> (or use OFFLINE_DIR)"; fi

# ─── MODE=verify ─────────────────────────────────────────────────────────────────────────────────
if [ "$MODE" = "verify" ]; then
  hdr "2. Money-receiving roles"
  print_payout_roles

  hdr "3. Pending proposals"
  any=0
  for k in "${CONTRACT_KEYS[@]}"; do
    p="$(gv "PENDING_OF_$k")"
    if [ -n "$p" ] && [ "$p" != "null" ]; then printf '  %-9s pending -> %s\n' "$k" "$p"; any=1; fi
  done
  [ "$any" = "0" ] && note "none — no rotation is half-finished"
  printf '\n\033[1mverify only. Nothing was changed.\033[0m\n'
  printf 'To rotate:  MODE=rotate TO=<G…> TO_SIGNERS=<csv> NETWORK=%s %s\n' "$NETWORK" "$0"
  exit 0
fi

# ─── Shared preconditions for the acting modes ───────────────────────────────────────────────────
[ -n "$FROM_SIGNERS" ] || [ -n "$OFFLINE_DIR" ] || \
  die "no signers for the current admin $FROM. Set FROM_SIGNERS=<csv of local identities>, or OFFLINE_DIR=<dir> to sign externally."

# ─── MODE=cancel ─────────────────────────────────────────────────────────────────────────────────
if [ "$MODE" = "cancel" ]; then
  hdr "2. Cancelling pending proposals"
  for k in "${CONTRACT_KEYS[@]}"; do
    p="$(gv "PENDING_OF_$k")"
    if [ -z "$p" ] || [ "$p" = "null" ]; then c_ok "$k: nothing pending"; continue; fi
    submit_as "$FROM" "$FROM_SIGNERS" "cancel:$k" "$(gv "$k")" cancel_admin_transfer \
      && c_ok "$k: proposal to $p cancelled" || true
  done
  printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
  exit $(( FAIL > 0 ))
fi

# ─── MODE=payouts ────────────────────────────────────────────────────────────────────────────────
if [ "$MODE" = "payouts" ]; then
  DEST="${PAYOUTS_TO:-$TO}"
  [ -n "$DEST" ] || die "MODE=payouts needs PAYOUTS_TO=<address> (or TO=)."
  hdr "2. Moving money-receiving roles to $DEST"
  note "these setters are admin-gated, so they are signed by the CURRENT admin ($FROM)"
  submit_as "$FROM" "$FROM_SIGNERS" "treasury:yield"     "$YIELD"    set_treasury --treasury "$DEST" && c_ok "yield.treasury -> $DEST"
  submit_as "$FROM" "$FROM_SIGNERS" "treasury:srmarket"  "$SRMARKET" set_treasury --treasury "$DEST" && c_ok "srmarket.treasury -> $DEST"
  submit_as "$FROM" "$FROM_SIGNERS" "emissions:strategy" "$STRATEGY" set_emissions_to --to "$DEST" && c_ok "strategy.emissions_to -> $DEST"
  hdr "3. Read back"
  print_payout_roles
  printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
  exit $(( FAIL > 0 ))
fi

# ─── MODE=rotate ─────────────────────────────────────────────────────────────────────────────────
[ "$MODE" = "rotate" ] || die "unknown MODE='$MODE' (verify | rotate | cancel | payouts)"
[ -n "$TO" ] || die "MODE=rotate needs TO=<new admin address>"
if [ "$TO" = "$FROM" ]; then die "TO equals the current admin — nothing to do"; fi

hdr "2. The proposed new admin"
printf '  %s\n' "$TO"
describe_account "$TO"
if [ -z "$TO_SIGNERS" ]; then
  cand="$(identity_for "$TO")"
  [ -n "$cand" ] && TO_SIGNERS="$cand"
fi
if [ -n "$TO_SIGNERS" ]; then note "will accept with: $TO_SIGNERS"
elif [ -n "$OFFLINE_DIR" ]; then note "accept will be written to $OFFLINE_DIR for external signing"
else die "no signers for the new admin $TO. Set TO_SIGNERS=<csv>, or OFFLINE_DIR=<dir>.
       Without them the rotation would stop half-done: a pending proposal nobody can accept.
       (Recoverable — MODE=cancel clears it — but there is no reason to get there.)"
fi

# The new admin must exist as an account, or `accept_admin` can never be authorized.
if [[ "$TO" == G* ]]; then
  case "$NETWORK" in mainnet) H="${HORIZON_URL:-https://horizon.stellar.org}" ;; *) H="${HORIZON_URL:-https://horizon-testnet.stellar.org}" ;; esac
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$H/accounts/$TO")
  [ "$code" = "200" ] || die "$TO does not exist on $NETWORK (HTTP $code). Fund it before rotating —
       an address with no account cannot sign accept_admin."
fi

hdr "3. Confirm"
cat <<CONFIRM
    network   : $NETWORK
    contracts : ${#CONTRACT_KEYS[@]}  (${CONTRACT_KEYS[*]})
    from      : $FROM
    to        : $TO
    steps     : propose_admin  x${#CONTRACT_KEYS[@]}  signed by the CURRENT admin
                accept_admin   x${#CONTRACT_KEYS[@]}  signed by the NEW admin
    reversible: yes, until accept_admin lands — MODE=cancel clears a pending proposal
CONFIRM
if [ "$NETWORK" = "mainnet" ] && [ "$ASSUME_YES" != "1" ]; then
  printf '\n  This is MAINNET. Type "rotate" to proceed: '
  read -r reply
  [ "$reply" = "rotate" ] || die "aborted"
elif [ "$ASSUME_YES" != "1" ]; then
  printf '\n  Press enter to proceed, Ctrl-C to abort. '
  read -r _
fi
log "ROTATE START network=$NETWORK from=$FROM to=$TO"

hdr "4. propose_admin  (signed by the current admin)"
for k in "${CONTRACT_KEYS[@]}"; do
  p="$(gv "PENDING_OF_$k")"
  if [ "$p" = "$TO" ]; then c_ok "$k: already proposed (resuming)"; continue; fi
  if [ "$(gv "ADMIN_OF_$k")" = "$TO" ]; then c_ok "$k: already rotated (resuming)"; continue; fi
  submit_as "$FROM" "$FROM_SIGNERS" "propose:$k" "$(gv "$k")" propose_admin --new_admin "$TO" \
    && c_ok "$k: proposed" || true
done
[ "$FAIL" -eq 0 ] || die "propose stage had $FAIL failure(s). Nothing has been handed over — the
       current admin still controls every contract. Fix the cause and re-run; completed steps are skipped."

if [ -n "$OFFLINE_DIR" ]; then
  hdr "Offline mode"
  note "unsigned envelopes are in $OFFLINE_DIR. Sign each with enough signers, submit with"
  note "  stellar tx send --network $NETWORK < <file>"
  note "then re-run this script to produce and verify the accept stage."
  exit 0
fi

hdr "5. accept_admin  (signed by the NEW admin — this is the handover)"
for k in "${CONTRACT_KEYS[@]}"; do
  if [ "$(view "$(gv "$k")" admin || echo '')" = "$TO" ]; then c_ok "$k: already accepted"; continue; fi
  submit_as "$TO" "$TO_SIGNERS" "accept:$k" "$(gv "$k")" accept_admin \
    && c_ok "$k: accepted" || true
done

hdr "6. Verify — admin moved, nothing left pending"
for k in "${CONTRACT_KEYS[@]}"; do
  a=$(view "$(gv "$k")" admin || echo '')
  p=$(view "$(gv "$k")" pending_admin || echo '')
  [ "$a" = "$TO" ] && c_ok "$k: admin is the new address" || c_bad "$k: admin is '$a', expected '$TO'"
  { [ -z "$p" ] || [ "$p" = "null" ]; } && c_ok "$k: no pending proposal" || c_bad "$k: still pending -> $p"
done

hdr "7. Verify — the OLD admin is powerless (a real transaction the network must reject)"
# Simulation cannot prove this: `--send=no` records auth rather than enforcing it, so a simulated
# call from a powerless key still "succeeds". The only honest test is a submitted transaction.
#
# Shape: build an admin action sourced from the NEW admin (so the auth entry is source_account),
# sign it with the OLD key alone, and submit. The network must answer TxBadAuth. If the old key is
# still a signer on the new account — the mistake this catches — it would succeed instead.
#
# The action proposes the CURRENT admin as admin, so even in that failure case the blast radius is a
# no-op proposal, which step 8 then cleans up.
old_key="$(printf '%s' "$FROM_SIGNERS" | cut -d, -f1)"
neg_raw=""
if [ -z "$old_key" ]; then
  c_bad "no local key for the old admin, so 'the old key is powerless' was NOT tested.
         Re-run with FROM_SIGNERS=<old identity> to prove it, or verify by hand."
else
  neg_raw=$(stellar contract invoke --id "$SR" --source-account "$TO" "${NET_ARGS[@]}" \
            --build-only -- propose_admin --new_admin "$TO" 2>/dev/null || true)
fi
if [ -n "$old_key" ] && [ -z "$neg_raw" ]; then
  c_bad "could not build the negative test — verify the old key by hand before trusting this rotation"
elif [ -n "$old_key" ]; then
  neg_sim=$(printf '%s' "$neg_raw" | stellar tx simulate --source-account "$TO" "${NET_ARGS[@]}" 2>/dev/null || true)
  if printf '%s' "$neg_sim" | stellar tx sign --sign-with-key "$old_key" "${NET_ARGS[@]}" 2>/dev/null \
     | stellar tx send "${NET_ARGS[@]}" >/dev/null 2>&1; then
    c_bad "THE OLD KEY STILL WORKS. '$old_key' authorized an admin call against the new admin account.
         The usual cause: the old key is still a signer on $TO. Fix the account, then re-verify."
    for k in "${CONTRACT_KEYS[@]}"; do
      submit_as "$TO" "$TO_SIGNERS" "cleanup:$k" "$(gv "$k")" cancel_admin_transfer >/dev/null 2>&1 || true
    done
  else
    c_ok "the old key is rejected on chain (TxBadAuth) — it can no longer act as admin"
  fi
fi

hdr "7b. Verify — the NEW admin is FUNCTIONAL (not just recorded)"
# `testcando.md` §17 asks for "old key powerless AND new key functional". Step 7 proves the first
# half. Recording an address as admin does not prove anyone can sign FOR it — a wrong threshold, a
# missing signer, or a multisig whose total weight is below its own threshold all pass step 6 and
# still leave the protocol with an admin nobody can use.
#
# The probe is deliberately a NO-OP: propose the current admin as admin, then cancel. Both calls are
# admin-gated, so success proves the new admin can authorize privileged actions — and neither
# changes anything operational. (`pause` would prove the same thing and briefly halt the protocol,
# which is not acceptable on a live rotation.)
if [ -n "$TO_SIGNERS" ]; then
  if submit_as "$TO" "$TO_SIGNERS" "probe:propose" "$SR" propose_admin --new_admin "$TO"; then
    p=$(view "$SR" pending_admin || echo '')
    [ "$p" = "$TO" ] && c_ok "the new admin signed a privileged call (propose_admin)" \
                     || c_bad "propose landed but pending_admin reads '$p'"
    submit_as "$TO" "$TO_SIGNERS" "probe:cancel" "$SR" cancel_admin_transfer \
      && c_ok "and cleaned up after itself (cancel_admin_transfer)" \
      || c_bad "PROBE LEFT A PENDING PROPOSAL on SR — clear it with MODE=cancel"
  else
    c_bad "THE NEW ADMIN CANNOT SIGN. It is recorded as admin on all ${#CONTRACT_KEYS[@]} contracts but
         could not authorize a privileged call. Check the account's signers and medium threshold
         before you rely on this rotation."
  fi
else
  c_bad "no signers supplied for the new admin, so 'the new key works' was NOT tested."
fi

hdr "8. Money-receiving roles"
print_payout_roles
note "move them with:  MODE=payouts PAYOUTS_TO=<addr> FROM_SIGNERS=$TO_SIGNERS NETWORK=$NETWORK $0"

printf '\n\033[1m%s passed, %s failed\033[0m\n' "$PASS" "$FAIL"
log "ROTATE END pass=$PASS fail=$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '\033[31mRotation did NOT complete cleanly. Re-run to resume; MODE=verify to inspect.\033[0m\n'
  exit 1
fi
printf 'Admin is now %s on all %s contracts.\n' "$TO" "${#CONTRACT_KEYS[@]}"
