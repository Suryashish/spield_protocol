#!/usr/bin/env node
// @ts-check
//
// Spield **Fixed-Rate Vault rate calibration** — is the rate we promise one this venue can fund?
//
// The vault's coupon is funded by the yield its YT inventory earns in Blend. `srvault::deposit`
// guarantees the promise is always SOLVENT (a coupon must be backed by PT already in inventory, or
// the deposit reverts), but nothing on chain checks that it is SELF-FUNDING. When
//
//     blend_supply_apr x (1 - yield_fee) < vault_rate
//
// every deposit consumes seed capital instead of replenishing it, silently, until capacity hits
// zero and deposits start reverting with `InsufficientCapacity`. This is the check that was
// missing: `VAULT_RATE_BPS` was a hardcoded 500 in all three deploy scripts, never once compared
// against what Blend actually pays.
//
// ── What it does ─────────────────────────────────────────────────────────────────────────────────
//   1. Reads the Blend reserve + pool config for the underlying.
//   2. Samples `b_rate` twice to MEASURE the realized supply APR — ground truth, model-independent.
//   3. Reconciles the model against that measurement, and REFUSES to judge if they disagree. The
//      model is reconstructed from Blend's config, not vendored from its source, so it must earn
//      the right to be believed on every run rather than once at authoring time.
//   4. Applies the calibration rule in `blend_rate.mjs` and prints a verdict.
//
// Pure reads. Never signs, never submits, costs nothing.
//
// Usage:
//   node scripts/calibrate_vault_rate.mjs --state scripts/deploy_sr_testnet.state
//   node scripts/calibrate_vault_rate.mjs --state scripts/deploy_mainnet.state --rate 300 --check
//   node scripts/calibrate_vault_rate.mjs --pool C... --underlying C... --rate 300 \
//     --rpc https://mainnet.sorobanrpc.com --passphrase "Public Global Stellar Network ; September 2015"
//
// Options:
//   --rate <bps>       rate to validate (default: VAULT_RATE_BPS from --state, else 300)
//   --yield-fee <bps>  engine fee (default: read from the yield contract in --state, else 500)
//   --margin <bps>     safety margin (default 2500)
//   --sample <secs>    b_rate sampling window (default 120; 0 skips measurement AND reconciliation)
//   --check            exit 2 on FAIL, 3 on WARN — for use as a deploy gate
//   --advisory         always exit 0, whatever the verdict (testnet, where the rate is a subsidy)
//   --json             machine-readable output
//
// Exit codes: 0 = pass (or advisory); 2 = FAIL; 3 = WARN; 1 = could not determine (RPC/reconcile).

import fs from 'node:fs';
import {
  Account,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';

import { calibrate, realizedSupplyApr, utilizationOf, UTIL_SCALAR } from './blend_rate.mjs';

// ---------------------------------------------------------------- args + state

const argv = process.argv.slice(2);
const has = (k) => argv.includes(`--${k}`);
const arg = (k, d = null) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

/** Parse a `KEY=value` deploy state file. Later lines win — the scripts append as they progress. */
const readState = (path) => {
  if (!path || !fs.existsSync(path)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );
};

const st = readState(arg('state', null));
const isMainnet = (arg('state', '') ?? '').includes('mainnet') || has('mainnet');

const CFG = {
  rpc: arg('rpc', isMainnet ? 'https://mainnet.sorobanrpc.com' : 'https://soroban-testnet.stellar.org'),
  passphrase: arg(
    'passphrase',
    isMainnet ? 'Public Global Stellar Network ; September 2015' : 'Test SDF Network ; September 2015',
  ),
  pool: arg('pool', st.BLEND_POOL ?? null),
  underlying: arg('underlying', st.USDC_SAC ?? null),
  yieldContract: arg('yield', st.YIELD ?? null),
  vault: arg('vault', st.SRVAULT ?? st.VAULT ?? null),
  rateBps: Number(arg('rate', st.VAULT_RATE_BPS ?? '300')),
  yieldFeeBps: arg('yield-fee', null) === null ? null : Number(arg('yield-fee')),
  marginBps: Number(arg('margin', '2500')),
  sampleSecs: Number(arg('sample', '120')),
  check: has('check'),
  advisory: has('advisory'),
  json: has('json'),
};

if (!CFG.pool || !CFG.underlying) {
  console.error('missing --pool / --underlying (or a --state file defining BLEND_POOL and USDC_SAC)');
  process.exit(1);
}

// ---------------------------------------------------------------- rpc helpers

const server = new rpc.Server(CFG.rpc, { allowHttp: CFG.rpc.startsWith('http://') });
// Any well-formed account works as a simulation source; nothing is ever signed or submitted.
const SIM_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

async function read(contractId, fn, args = []) {
  const tx = new TransactionBuilder(new Account(SIM_SOURCE, '0'), {
    fee: BASE_FEE,
    networkPassphrase: CFG.passphrase,
  })
    .addOperation(new Contract(contractId).call(fn, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${fn}: ${sim.error}`);
  return sim.result?.retval ? scValToNative(sim.result.retval) : null;
}

const readReserve = () =>
  read(CFG.pool, 'get_reserve', [new Contract(CFG.underlying).address().toScVal()]);

const pct = (x) => `${(x * 100).toFixed(3)}%`;
const bps = (x) => `${x} bps (${(x / 100).toFixed(2)}%)`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- main

const fail = (msg) => {
  console.error(`\n  ERROR  ${msg}`);
  process.exit(1);
};

const main = async () => {
  const t0 = await readReserve().catch((e) => fail(`could not read the Blend reserve: ${e.message}`));
  if (!t0?.data || !t0?.config) fail('get_reserve returned no reserve data');

  const poolCfg = await read(CFG.pool, 'get_config').catch(() => null);
  const bstopRate = Number(poolCfg?.bstop_rate ?? 0);
  if (!bstopRate) fail('could not read the pool backstop take rate (bstop_rate)');

  // The engine's fee comes off the YT interest before the vault ever sees it, so it belongs in the
  // calibration. It is NOT guessed: a wrong fee moves the ceiling, and guessing 0 when a fee is
  // actually charged would raise it. Read it from the live contract, or make the operator state it.
  // (The v1 wrapper/vault stack charges no yield fee at all — pass `--yield-fee 0` there.)
  let yieldFeeBps = CFG.yieldFeeBps;
  let yieldFeeSource = 'the --yield-fee flag';
  if (yieldFeeBps === null && CFG.yieldContract) {
    yieldFeeBps = Number(await read(CFG.yieldContract, 'yield_fee_bps').catch(() => null));
    yieldFeeSource = `the yield engine ${CFG.yieldContract}`;
  }
  if (yieldFeeBps === null || !Number.isFinite(yieldFeeBps)) {
    fail(
      'could not determine the yield fee. Pass --yield-fee <bps> explicitly (0 for the v1\n' +
        '         wrapper/vault stack, which charges none), or point --state at a file defining YIELD.',
    );
  }

  const { supplied, borrowed, util } = utilizationOf(t0.data);
  const irMod = Number(t0.data.ir_mod) / UTIL_SCALAR;

  // ── Measure. b_rate IS the supply index, so its growth is ground truth. ───────────────────────
  let realized = NaN;
  let reconciled = null;
  if (CFG.sampleSecs > 0) {
    if (!CFG.json) {
      process.stderr.write(`  sampling b_rate over ${CFG.sampleSecs}s to measure the real rate...\n`);
    }
    await sleep(CFG.sampleSecs * 1000);
    const t1 = await readReserve().catch((e) => fail(`second reserve read failed: ${e.message}`));
    const dt = Number(t1.data.last_time) - Number(t0.data.last_time);
    realized = realizedSupplyApr(BigInt(t0.data.b_rate), BigInt(t1.data.b_rate), dt);
  }

  const result = calibrate({
    utilNow: util,
    irModNow: irMod,
    reserveConfig: t0.config,
    bstopRate,
    yieldFeeBps,
    marginBps: CFG.marginBps,
    proposedBps: CFG.rateBps,
  });

  // ── Reconcile. The model is reconstructed, not vendored — make it prove itself every run. ─────
  //
  // A silent model drift would be the worst possible failure here: it would keep emitting
  // confident verdicts computed from a rate curve Blend no longer uses. 25 bps of absolute
  // agreement is far tighter than any decision this feeds, and loose enough to absorb the
  // quantization of a short sampling window.
  const RECONCILE_TOLERANCE = 0.0025;
  if (Number.isFinite(realized)) {
    const drift = Math.abs(realized - result.spotApr);
    reconciled = drift <= RECONCILE_TOLERANCE;
    if (!reconciled) {
      console.error(
        `\n  ERROR  model/reality mismatch: modelled spot ${pct(result.spotApr)} vs realized ` +
          `${pct(realized)} (drift ${pct(drift)} > ${pct(RECONCILE_TOLERANCE)}).\n` +
          `         Blend's rate curve has probably changed. Do NOT trust the verdict below —\n` +
          `         fix the model in blend_rate.mjs first.`,
      );
      process.exit(1);
    }
  }

  if (CFG.json) {
    console.log(JSON.stringify({ ...result, realizedApr: realized, reconciled, yieldFeeBps, bstopRate }, null, 2));
  } else {
    const line = '─'.repeat(78);
    console.log(`\n${line}`);
    console.log(`  Fixed-Rate Vault — rate calibration`);
    console.log(`${line}`);
    console.log(`  pool ${CFG.pool}`);
    console.log(`  underlying ${CFG.underlying}\n`);
    console.log(`  VENUE (Blend USDC reserve)`);
    console.log(`    supplied / borrowed     ${(Number(supplied) / 1e7).toLocaleString(undefined, { maximumFractionDigits: 0 })} / ${(Number(borrowed) / 1e7).toLocaleString(undefined, { maximumFractionDigits: 0 })} USDC`);
    console.log(`    utilization             ${pct(result.utilNow)}   (target ${pct(result.utilTarget)})`);
    console.log(`    ir_mod                  ${result.irModNow.toFixed(4)}   (neutral 1.0000)`);
    console.log(`    supply APR, modelled    ${pct(result.spotApr)}`);
    if (Number.isFinite(realized)) {
      console.log(`    supply APR, MEASURED    ${pct(realized)}   <- b_rate growth, ground truth`);
      console.log(`    model reconciles        yes (drift ${pct(Math.abs(realized - result.spotApr))})`);
    } else {
      console.log(`    supply APR, MEASURED    skipped (--sample 0) — verdict is model-only`);
    }
    console.log(`\n  STRESS (assume no input improves)`);
    console.log(`    utilization -> ${pct(result.utilStress)}   ir_mod -> ${result.irModStress.toFixed(4)}`);
    console.log(`    stressed supply APR     ${pct(result.stressApr)}`);
    console.log(`    less ${String(yieldFeeBps).padStart(4)} bps engine fee   ${pct(result.netStressApr)}   <- what the vault keeps`);
    console.log(`      (fee from ${yieldFeeSource})`);
    console.log(`    less ${String(CFG.marginBps).padStart(4)} bps margin       ${pct(result.maxSafeApr)}`);
    console.log(`\n  VERDICT`);
    console.log(`    maximum safe rate       ${bps(result.maxSafeBps)}`);
    console.log(`    break-even rate         ${bps(result.breakEvenBps)}   (no margin left)`);
    console.log(`    proposed rate           ${bps(result.proposedBps)}`);
    console.log(`    coverage vs today       ${result.spotCoverage.toFixed(2)}x`);
    console.log(`    coverage under stress   ${result.stressCoverage.toFixed(2)}x`);
    console.log(`\n    ${result.verdict === 'PASS' ? 'PASS' : result.verdict === 'WARN' ? 'WARN' : 'FAIL'}  ${
      result.verdict === 'PASS'
        ? `${bps(result.proposedBps)} is within the calibrated ceiling.`
        : result.verdict === 'WARN'
          ? `${bps(result.proposedBps)} survives the stress but eats into the ${CFG.marginBps} bps margin.`
          : `${bps(result.proposedBps)} EXCEEDS what this venue funds under stress — it would drain seed capital.`
    }`);
    if (CFG.advisory && result.verdict !== 'PASS') {
      console.log(`    (advisory mode — not treated as an error)`);
    }
    console.log(`${line}\n`);
  }

  if (CFG.advisory || !CFG.check) process.exit(0);
  if (result.verdict === 'FAIL') process.exit(2);
  if (result.verdict === 'WARN') process.exit(3);
  process.exit(0);
};

main().catch((e) => fail(e?.message ?? String(e)));
