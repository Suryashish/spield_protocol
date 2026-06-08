#!/usr/bin/env node
// @ts-check
//
// Spield off-chain solvency monitor (mainnet-readiness).
//
// Continuously polls the wrapper's `solvency()` view — which returns
//   (blend_position_value, total_principal, total_unclaimed_yield)
// — and ALARMS the moment the live Blend backing drops below outstanding principal
// (beyond the contract's tiny rounding-dust tolerance). The on-chain `assert_solvent`
// already reverts any operation that would break the invariant; this is the independent
// *out-of-band* watchtower: it catches a deficit even if no one is transacting, and gives
// operators a paging signal (exit non-zero / webhook) rather than silent reliance on-chain.
//
// Pure reads (simulateTransaction) — never signs or submits anything, costs nothing.
//
// Usage:
//   node scripts/solvency_monitor.mjs \
//     --wrapper <C...> [--rpc https://soroban-testnet.stellar.org] \
//     [--passphrase "Test SDF Network ; September 2015"] \
//     [--interval 60] [--tolerance 8] [--once] [--webhook https://...]
//
// Exit codes: 0 = healthy at exit (only with --once); 2 = solvency breach detected;
//             1 = repeated RPC failure. In daemon mode it runs until killed, exiting 2 on breach.
//
// Requires @stellar/stellar-sdk (already a frontend dependency). Run from the frontend dir, or
// `npm i @stellar/stellar-sdk` somewhere on the NODE_PATH.

import {
  Contract,
  TransactionBuilder,
  Account,
  nativeToScVal,
  scValToNative,
  rpc,
  BASE_FEE,
} from '@stellar/stellar-sdk';

// ----- args -----
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1];
  return fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const WRAPPER = arg('wrapper');
const RPC_URL = arg('rpc', 'https://soroban-testnet.stellar.org');
const PASSPHRASE = arg('passphrase', 'Test SDF Network ; September 2015');
const INTERVAL_S = Number(arg('interval', '60'));
// Stroops of allowed rounding dust before we treat backing<principal as a real breach. Match (or
// slightly exceed) the contract's own dust tolerance so we don't false-alarm on Blend's floor math.
const TOLERANCE = BigInt(arg('tolerance', '8'));
const ONCE = has('once');
const WEBHOOK = arg('webhook'); // optional: POST a JSON alert here on breach

if (!WRAPPER) {
  console.error('ERROR: --wrapper <contract-id> is required.');
  process.exit(1);
}

const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith('http://') });
// A throwaway source account for read-only simulation (never submitted, so the sequence/balance
// are irrelevant). All-zero account id is the canonical "simulation source".
const SIM_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF5';

/** Call a no-arg view on the wrapper and decode the native result. */
async function readView(method) {
  const account = new Account(SIM_SOURCE, '0');
  const contract = new Contract(WRAPPER);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(contract.call(method))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`simulate ${method} failed: ${sim.error}`);
  }
  const retval = sim.result?.retval;
  if (!retval) throw new Error(`no retval from ${method}`);
  return scValToNative(retval);
}

function fmtUsdc(stroops) {
  // 7-decimal USDC.
  const neg = stroops < 0n;
  const s = (neg ? -stroops : stroops).toString().padStart(8, '0');
  const whole = s.slice(0, -7) || '0';
  const frac = s.slice(-7);
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

async function postWebhook(payload) {
  if (!WEBHOOK) return;
  try {
    await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('webhook POST failed:', e?.message ?? e);
  }
}

let consecutiveRpcFailures = 0;

/** One health check. Returns true if healthy, false if a breach was detected. */
async function check() {
  const ts = new Date().toISOString();
  let solvency;
  try {
    // solvency() → (backing, principal, unclaimed)
    solvency = await readView('solvency');
    consecutiveRpcFailures = 0;
  } catch (e) {
    consecutiveRpcFailures += 1;
    console.error(`[${ts}] RPC read failed (${consecutiveRpcFailures}): ${e?.message ?? e}`);
    if (consecutiveRpcFailures >= 5) {
      console.error('Too many consecutive RPC failures — exiting 1 so the supervisor restarts us.');
      process.exit(1);
    }
    return true; // transient; don't treat as a breach
  }

  const [backing, principal, unclaimed] = solvency.map((x) => BigInt(x));
  const healthy = backing + TOLERANCE >= principal;
  const headroom = backing - principal;

  const line =
    `[${ts}] backing=${fmtUsdc(backing)} principal=${fmtUsdc(principal)} ` +
    `unclaimed=${fmtUsdc(unclaimed)} headroom=${fmtUsdc(headroom)} ` +
    `${healthy ? 'OK' : 'BREACH'}`;

  if (healthy) {
    console.log(line);
    return true;
  }

  console.error('🚨🚨🚨 SOLVENCY BREACH 🚨🚨🚨');
  console.error(line);
  console.error(
    `Backing is BELOW principal by ${fmtUsdc(principal - backing)} USDC ` +
      `(tolerance ${TOLERANCE} stroops). Investigate immediately.`,
  );
  await postWebhook({
    alert: 'spield_solvency_breach',
    wrapper: WRAPPER,
    backing: backing.toString(),
    principal: principal.toString(),
    deficit: (principal - backing).toString(),
    at: ts,
  });
  return false;
}

async function main() {
  console.log(
    `Spield solvency monitor → wrapper ${WRAPPER} on ${RPC_URL} ` +
      `(interval ${INTERVAL_S}s, tolerance ${TOLERANCE} stroops)`,
  );
  if (ONCE) {
    const ok = await check();
    process.exit(ok ? 0 : 2);
  }
  // Daemon loop. On a confirmed breach we exit 2 (page + let the supervisor decide), having alarmed.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ok = await check();
    if (!ok) process.exit(2);
    await new Promise((r) => setTimeout(r, INTERVAL_S * 1000));
  }
}

main().catch((e) => {
  console.error('fatal:', e?.stack ?? e);
  process.exit(1);
});
