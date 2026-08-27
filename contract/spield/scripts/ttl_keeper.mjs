#!/usr/bin/env node
/**
 * # ttl_keeper.mjs — keep dormant holders' storage entries alive
 *
 * Soroban archives a persistent ledger entry whose TTL lapses, and an archived entry needs an
 * off-chain restore to recover. Every entry Spield writes is bumped **on write** — so an active
 * user is never at risk. The exposure is the user who deposits and then does nothing: nobody
 * writes to their entry, so nothing refreshes it.
 *
 * ## Why this is a script and not a front-end feature
 *
 * The obvious fix is "have the app bump on login". That does not work for the population that
 * actually needs it — someone who never logs in — and it is expensive for everyone else, because
 * each bump is a separate transaction and therefore a separate **wallet signature prompt**. Three
 * prompts every time you open your portfolio is not a feature.
 *
 * The bump entry points are **permissionless** precisely so this can be solved from the outside:
 * they only ever extend an entry's lifetime and never touch accounting, so a keeper can call them
 * on anyone's behalf. The user signs nothing and pays nothing.
 *
 * ## What it covers
 *
 * | Entry | Bump |
 * |---|---|
 * | SR balance | `sr::bump_holder(user)` |
 * | YT balance + interest record | `yield::bump_holder(user)` |
 * | LP shares | `srmarket::bump_lp(lp)` |
 * | Vault receipt | `srvault::bump_receipt(id)` |
 *
 * PT needs nothing — it is a classic Stellar asset, so its balances are trustlines in the classic
 * ledger and are not subject to archival.
 *
 * ## How holders are discovered
 *
 * From chain, not from a database the front end has to maintain — a list that only knows about
 * people who visited the site would miss exactly the dormant users this exists for.
 *
 * Holder addresses are read out of contract events (`transfer`, `deposit`, `mint_py`, `added`),
 * which is every way an address can come to hold something. Receipts are enumerated by id.
 * `--extra` adds addresses manually if you have them from elsewhere.
 *
 * ## Cost and safety
 *
 * A bump is one cheap transaction. Calls that find nothing simply do nothing — none of these can
 * create an entry — so over-calling wastes fees and nothing else. It is safe to run on a schedule,
 * and safe to run twice.
 *
 * ## Usage
 *
 *   node ttl_keeper.mjs --source <KEY_NAME_OR_SECRET> [--state ../scripts/deploy_sr_testnet.state]
 *                       [--sr C…] [--yield C…] [--market C…] [--vault C…]
 *                       [--from-ledger N] [--max-receipts 256] [--extra G…,G…]
 *                       [--dry-run]
 *
 * `--dry-run` lists what it would bump and submits nothing. Run that first.
 */

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  Contract,
  TransactionBuilder,
  Keypair,
  Address,
  nativeToScVal,
  scValToNative,
  rpc,
  BASE_FEE,
  StrKey,
} from '@stellar/stellar-sdk';

// ---------------------------------------------------------------- args

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const has = (n) => process.argv.includes(`--${n}`);

function loadState(p) {
  const out = {};
  if (!p || !fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const st = loadState(arg('state', new URL('./deploy_sr_testnet.state', import.meta.url).pathname));

const CFG = {
  rpc: arg('rpc', 'https://soroban-testnet.stellar.org'),
  passphrase: arg('passphrase', 'Test SDF Network ; September 2015'),
  sr: arg('sr', st.SR ?? null),
  yieldC: arg('yield', st.YIELD ?? null),
  market: arg('market', st.SRMARKET ?? null),
  vault: arg('vault', st.SRVAULT ?? null),
  source: arg('source', null),
  fromLedger: Number(arg('from-ledger', '0')),
  maxReceipts: Number(arg('max-receipts', '256')),
  extra: (arg('extra', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
  // Stop after this many submissions. `0` = no limit.
  //
  // Each bump is its own transaction and each waits for confirmation, so a full pass is minutes
  // rather than seconds — too long for a serverless function's timeout. This exists so the work can
  // be split across bounded runs if it ever has to live somewhere with a hard time budget. On a
  // scheduler with no meaningful limit (GitHub Actions, cron on a box) leave it at 0.
  maxCalls: Number(arg('max-calls', '0')),
  dryRun: has('dry-run'),
};

if (!CFG.source && !CFG.dryRun) {
  console.error('missing --source (a stellar CLI key name, or an S… secret). Use --dry-run to preview.');
  process.exit(1);
}

const server = new rpc.Server(CFG.rpc, { allowHttp: CFG.rpc.startsWith('http://') });

/** Resolve `--source` to a Keypair: an S… secret directly, or a stellar CLI key name. */
function resolveSigner(nameOrSecret) {
  if (!nameOrSecret) return null;
  if (/^S[A-Z2-7]{55}$/.test(nameOrSecret)) return Keypair.fromSecret(nameOrSecret);
  const secret = execFileSync('stellar', ['keys', 'show', nameOrSecret], { encoding: 'utf8' }).trim();
  return Keypair.fromSecret(secret);
}

// ---------------------------------------------------------------- discovery

const SIM_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

async function simulate(contractId, fn, args = []) {
  const { Account } = await import('@stellar/stellar-sdk');
  const tx = new TransactionBuilder(new Account(SIM_SOURCE, '0'), {
    fee: BASE_FEE,
    networkPassphrase: CFG.passphrase,
  })
    .addOperation(new Contract(contractId).call(fn, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return scValToNative(sim.result.retval);
}

/**
 * Every address that appears in a contract's events.
 *
 * Event topics and values are scanned for anything that decodes as an account address. This is
 * deliberately broad: a holder can arrive via a transfer, a mint, a deposit or a liquidity add, and
 * missing one of those means missing exactly the dormant holder this script exists for. A false
 * positive costs one wasted no-op call.
 */
async function holdersFromEvents(contractIds, startLedger) {
  const found = new Set();
  const health = await server.getHealth();
  const latest = Number(health.latestLedger ?? (await server.getLatestLedger()).sequence);
  const oldest = Number(health.oldestLedger ?? Math.max(1, latest - 100_000));

  // Start at the oldest ledger the node still retains — an earlier start is silently useless, and
  // guessing a window is how the first version of this found nothing.
  let from = Math.max(oldest, startLedger || 0);
  console.log(`  scanning events from ledger ${from} to ${latest} (node retains ${latest - oldest})`);

  let cursor = null;
  let pages = 0;
  const MAX_PAGES = 400; // ~80k events; a backstop, not an expected limit

  for (; pages < MAX_PAGES; pages += 1) {
    let page;
    const filters = contractIds.map((id) => ({ type: 'contract', contractIds: [id] }));
    try {
      // startLedger and cursor are mutually exclusive: the first request anchors, the rest follow.
      page = cursor
        ? await server.getEvents({ cursor, filters, limit: 200 })
        : await server.getEvents({ startLedger: from, filters, limit: 200 });
    } catch (e) {
      const msg = String(e?.message ?? e).split('\n')[0];
      const m = msg.match(/must be within the ledger range: (\d+)/);
      if (m && Number(m[1]) > from && !cursor) { from = Number(m[1]); continue; }
      console.error(`  event scan stopped at ledger ${from}: ${msg}`);
      break;
    }

    for (const ev of page.events ?? []) {
      for (const raw of [...(ev.topic ?? []), ev.value]) {
        try {
          const v = scValToNative(raw);
          if (typeof v === 'string' && StrKey.isValidEd25519PublicKey(v)) found.add(v);
        } catch { /* not an address */ }
      }
    }

    // **An empty page is not the end.** The RPC scans forward from the anchor and returns whatever
    // it found within its own scan budget, so a page with zero matching events but a cursor simply
    // means "nothing yet, keep going". Treating that as the end is what made the first version of
    // this report 0 holders while events existed a few thousand ledgers later.
    if (!page.cursor) break;
    cursor = page.cursor;
  }
  if (pages >= MAX_PAGES) console.error(`  event scan hit the ${MAX_PAGES}-page cap; results may be partial`);
  return found;
}

/** Open receipt ids, by scanning. The vault has no owner index. */
async function openReceiptIds(vault, max) {
  const ids = [];
  let misses = 0;
  for (let id = 0; id < max && misses < 5; id += 1) {
    try {
      const r = await simulate(vault, 'get_receipt', [nativeToScVal(id, { type: 'u64' })]);
      misses = 0;
      if (r?.open) ids.push(id);
    } catch {
      misses += 1;
    }
  }
  return ids;
}

// ---------------------------------------------------------------- submit

async function invoke(kp, contractId, fn, args) {
  const account = await server.getAccount(kp.publicKey());
  const built = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: CFG.passphrase })
    .addOperation(new Contract(contractId).call(fn, ...args))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(built);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  const prepared = rpc.assembleTransaction(built, sim).build();
  prepared.sign(kp);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') throw new Error(JSON.stringify(sent.errorResult ?? sent));
  for (let i = 0; i < 30; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const got = await server.getTransaction(sent.hash);
    if (got.status === 'SUCCESS') return sent.hash;
    if (got.status === 'FAILED') throw new Error(`tx failed: ${sent.hash}`);
  }
  throw new Error(`tx not confirmed: ${sent.hash}`);
}

// ---------------------------------------------------------------- run

const contracts = [CFG.sr, CFG.yieldC, CFG.market].filter(Boolean);
if (!contracts.length) {
  console.error('nothing to do: pass --sr / --yield / --market, or a --state file that defines them.');
  process.exit(1);
}

console.log(`TTL keeper → ${CFG.rpc}${CFG.dryRun ? '  (DRY RUN — nothing will be submitted)' : ''}`);

const holders = await holdersFromEvents(contracts, CFG.fromLedger);
for (const e of CFG.extra) if (StrKey.isValidEd25519PublicKey(e)) holders.add(e);
const receiptIds = CFG.vault ? await openReceiptIds(CFG.vault, CFG.maxReceipts) : [];

console.log(`  discovered ${holders.size} holder address(es) and ${receiptIds.length} open receipt(s)`);

/**
 * Which bump functions the DEPLOYED binaries actually expose.
 *
 * Source and chain are not the same thing. `Sr::bump_holder` and `SrMarket::bump_lp` were added
 * after the current testnet deployment was cut, so calling them produces
 * `Error(WasmVm, MissingValue)` — 62 identical failures in a row on the first real run of this
 * script, which is noise rather than information.
 *
 * Probing once up front turns that into a single actionable line, and means a partially-upgraded
 * stack still gets everything it CAN have bumped rather than nothing.
 */
async function available(contractId, fn, probeArgs) {
  if (!contractId) return false;
  try {
    await simulate(contractId, fn, probeArgs);
    return true;
  } catch (e) {
    if (/MissingValue/.test(String(e?.message ?? e))) return false;
    return true; // a different error means the function exists but the probe args did not suit it
  }
}

const probeAddr = new Address(SIM_SOURCE).toScVal();
const caps = {
  sr: await available(CFG.sr, 'bump_holder', [probeAddr]),
  yieldC: await available(CFG.yieldC, 'bump_holder', [probeAddr]),
  market: await available(CFG.market, 'bump_lp', [probeAddr]),
  vault: CFG.vault ? await available(CFG.vault, 'bump_receipt', [nativeToScVal(0, { type: 'u64' })]) : false,
};
const missing = Object.entries(caps).filter(([k, v]) => !v && CFG[k === 'yieldC' ? 'yieldC' : k]).map(([k]) => k);
if (missing.length) {
  console.error(
    `  \u26a0 not deployed on this network: ${missing.join(', ')} \u2014 their bump entry points are ` +
    `missing from the live binaries. Redeploy to cover those entries; skipping them for now.`,
  );
}

const jobs = [];
for (const h of holders) {
  const a = new Address(h).toScVal();
  if (caps.sr) jobs.push([CFG.sr, 'bump_holder', [a], `sr::bump_holder(${h.slice(0, 8)}…)`]);
  if (caps.yieldC) jobs.push([CFG.yieldC, 'bump_holder', [a], `yield::bump_holder(${h.slice(0, 8)}…)`]);
  if (caps.market) jobs.push([CFG.market, 'bump_lp', [a], `market::bump_lp(${h.slice(0, 8)}…)`]);
}
if (caps.vault) {
  for (const id of receiptIds) {
    jobs.push([CFG.vault, 'bump_receipt', [nativeToScVal(id, { type: 'u64' })], `srvault::bump_receipt(${id})`]);
  }
}

const planned = jobs.length;
if (CFG.maxCalls > 0 && jobs.length > CFG.maxCalls) {
  jobs.length = CFG.maxCalls;
  console.log(`  --max-calls ${CFG.maxCalls}: submitting ${jobs.length} of ${planned} this run`);
}

if (CFG.dryRun) {
  for (const [, , , label] of jobs) console.log(`  would bump ${label}`);
  console.log(`  ${jobs.length} call(s)${planned !== jobs.length ? ` of ${planned}` : ''}. Re-run without --dry-run to submit.`);
  process.exit(0);
}

const kp = resolveSigner(CFG.source);
let ok = 0;
let failed = 0;
for (const [id, fn, args, label] of jobs) {
  try {
    await invoke(kp, id, fn, args);
    ok += 1;
    console.log(`  ✓ ${label}`);
  } catch (e) {
    failed += 1;
    // A bump can never corrupt state, so one failure is not a reason to abandon the rest.
    console.error(`  ✗ ${label}: ${String(e?.message ?? e).split('\n')[0]}`);
  }
}
console.log(`done: ${ok} bumped, ${failed} failed, ${jobs.length} total`);
process.exit(failed > 0 ? 1 : 0);
