#!/usr/bin/env node
// @ts-check
//
// probe_budget.mjs — what each router path costs, and which ones the network refuses.
//
// Simulation only: no signing, no submission, no state change, no cost. Point it at a deployment
// and it tells you, per entry point, either the instruction count or the reason it will not run.
//
// This exists because the question "does this path fit?" cannot be answered locally. The local
// `BlendFixture` is dramatically lighter than the deployed pool — it reported `buy_yt_with_usdc` at
// 22% of memory for a path that does not execute at all. See `budget.md`.
//
// Usage:
//   cd website/frontend                       # needs @stellar/stellar-sdk on the path
//   node ../contract/spield/scripts/probe_budget.mjs \
//     --state ../contract/spield/scripts/deploy_sr_testnet.state \
//     [--user <G...>] [--rpc https://soroban-testnet.stellar.org]
//
// Exit codes: 0 = every path simulated; 3 = at least one path is over budget.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Load the Stellar SDK from wherever it actually lives.
 *
 * Node resolves imports relative to the **script's** directory, not the working directory — so a
 * script under `contract/spield/scripts/` cannot `import '@stellar/stellar-sdk'` no matter where you
 * run it from, because there is no `node_modules` beside it. Every other .mjs in this directory has
 * the same problem, and the workaround has been to copy the file into `frontend/` first.
 *
 * Instead: try the bare specifier (works if someone installs the SDK here), then fall back to
 * resolving it out of the frontend's `node_modules`, which is the one place in this repo it is
 * guaranteed to exist. A pnpm store makes the path unguessable, so let `require.resolve` find it.
 */
async function loadSdk() {
  try {
    return await import('@stellar/stellar-sdk');
  } catch {
    const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '../../../frontend');
    try {
      const req = createRequire(pathToFileURL(`${frontend}/package.json`).href);
      return await import(pathToFileURL(req.resolve('@stellar/stellar-sdk')).href);
    } catch {
      console.error(
        'Could not load @stellar/stellar-sdk.\n' +
          `Looked beside this script and in ${frontend}/node_modules.\n` +
          'Run `npm install` (or `pnpm install`) in website/frontend first.',
      );
      process.exit(1);
    }
  }
}

const { Contract, TransactionBuilder, Address, nativeToScVal, rpc, BASE_FEE, Networks, Account } =
  await loadSdk();

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : d;
};

const statePath = arg('state', null);
const st = statePath
  ? Object.fromEntries(
      readFileSync(statePath, 'utf8')
        .split('\n')
        .filter((l) => l.includes('='))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    )
  : {};

const ROUTER = arg('router', st.SRROUTER);
const RPC = arg('rpc', 'https://soroban-testnet.stellar.org');
const USER = arg('user', null);

if (!ROUTER) {
  console.error('missing --router (or a --state file defining SRROUTER)');
  process.exit(1);
}

const server = new rpc.Server(RPC);

// A funded account is needed only as a simulation source; nothing is signed or sent. Falls back to
// the all-zero account, which works for reads but not for paths that check a balance.
const source = USER ?? 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const account = USER ? await server.getAccount(USER) : new Account(source, '0');

const i128 = (v) => nativeToScVal(BigInt(v), { type: 'i128' });
const addr = (a) => new Address(a).toScVal();
const u32 = (v) => nativeToScVal(v, { type: 'u32' });

// Mainnet/testnet caps, for context. Read them from the chain if you need certainty —
// `ConfigSettingContractComputeV0` — rather than trusting these.
const TX_MAX_INSTRUCTIONS = 400_000_000;

const PATHS = [
  ['buy_pt_with_usdc',    [addr(source), i128(2_000_000), i128(0), u32(0)]],
  ['sell_pt_for_usdc',    [addr(source), i128(500_000), i128(0), u32(0)]],
  ['buy_yt_with_usdc',    [addr(source), i128(1_000_000), i128(50_000), u32(0)]],
  ['sell_yt_for_usdc',    [addr(source), i128(2_000_000), i128(0), u32(0)]],
  ['claim_yield_to_usdc', [addr(source), i128(0)]],
  ['redeem_py_for_usdc',  [addr(source), i128(500_000), i128(0)]],
];

console.log(`router ${ROUTER}\nsource ${source}\n`);

let overBudget = 0;
for (const [fn, args] of PATHS) {
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(ROUTER).call(fn, ...args))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(sim)) {
    const err = String(sim.error).split('\n')[0].replace('HostError: ', '');
    // Distinguish "will never fit" from "this particular call was rejected". Only the first is a
    // budget fact; the rest is usually a balance or a liquidity limit at the size probed.
    const budget = err.includes('ExceededLimit');
    if (budget) overBudget += 1;
    console.log(`  ${fn.padEnd(22)} ${budget ? 'OVER BUDGET' : 'n/a        '}  ${err}`);
    continue;
  }
  const r = sim.transactionData.build().resources();
  const insns = r.instructions();
  const entries = r.footprint().readOnly().length + r.footprint().readWrite().length;
  const pct = ((insns * 100) / TX_MAX_INSTRUCTIONS).toFixed(1);
  console.log(
    `  ${fn.padEnd(22)} OK           insns ${String(insns).padStart(9)} (${pct.padStart(4)}% of cpu)  entries ${entries}`,
  );
}

if (overBudget > 0) {
  console.log(
    `\n${overBudget} path(s) over budget. CPU is not the constraint — the 40MB *cumulative* memory` +
      ` budget is. See budget.md.`,
  );
  process.exit(3);
}
