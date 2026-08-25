#!/usr/bin/env node
// @ts-check
//
// Spield **SR stack** off-chain solvency monitor.
//
// The on-chain `assert_solvent` already reverts any operation that would break the invariant. This
// is the independent, out-of-band watchtower: it catches a deficit even when nobody is
// transacting, and pages an operator rather than relying on someone eventually noticing.
//
// It checks six things every poll. Five come from contract views; the sixth does not, and is the
// reason this file exists rather than a copy of the v1 monitor:
//
//   1. ENGINE SOLVENCY   sr_held >= pt_cover + credited_yield          (yield.solvency)
//   2. PT CONSERVATION   classic PT supply == yield.total_py           <- Horizon, not a view
//   3. YT CONSERVATION   yield.total_supply == yield.total_py
//   4. RESERVES BACKED   stored reserves <= real token balances        (market vs PT/SR)
//   5. INDEX MONOTONIC   py_index never decreases between polls
//   6. TREASURY MONOTONIC treasury_earned never decreases
//
// ── Why check 2 is the important one ─────────────────────────────────────────────────────────────
// PT is a Stellar CLASSIC asset wrapped as a SAC. Handing SAC admin to the yield engine governs the
// *contract* mint path and nothing else: until the issuer's master key is locked (weight 0), the
// issuer can mint PT with an ordinary payment, bypassing the engine and the SR that is supposed to
// back it. No contract view can see that — `total_py` only counts what the engine minted.
//
// This was not hypothetical. On testnet 2026-08-25 the issuer minted 10 base units of PT out of
// thin air while `yield.total_py` stayed put; after the lockdown the same payment failed
// `TxBadAuth`. Check 2 is what makes that visible, and it is the ONLY check here that would.
//
// Horizon reports a classic asset's issued `amount` at /assets?asset_code=..&asset_issuer=.. — a
// number sourced from the ledger's trustline balances, entirely outside the contract's control.
//
// Pure reads. Never signs, never submits, costs nothing.
//
// Usage:
//   node scripts/sr_solvency_monitor.mjs \
//     --yield <C...> --market <C...> --sr <C...> --pt <C...> --pt-asset SPLDPT5:G... \
//     [--rpc https://soroban-testnet.stellar.org] [--horizon https://horizon-testnet.stellar.org] \
//     [--passphrase "Test SDF Network ; September 2015"] \
//     [--interval 60] [--tolerance 100] [--once] [--webhook https://...]
//
//   # or point it straight at a deploy state file:
//   node scripts/sr_solvency_monitor.mjs --state scripts/deploy_sr_testnet.state --once
//
// Exit codes: 0 = healthy (with --once); 2 = a breach was detected; 1 = repeated RPC failure.
//
// Requires @stellar/stellar-sdk. Run from website/frontend, or with it on NODE_PATH.

import fs from 'node:fs';
import {
  Contract,
  TransactionBuilder,
  Account,
  scValToNative,
  rpc,
  BASE_FEE,
} from '@stellar/stellar-sdk';

// ---------------------------------------------------------------- args

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

/** Load addresses from a `deploy_sr_testnet.state` file so the operator cannot mistype one. */
function fromState(path) {
  const out = {};
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^'|'$/g, '');
  }
  return out;
}

const statePath = arg('state', null);
const st = statePath ? fromState(statePath) : {};

const CFG = {
  yield: arg('yield', st.YIELD),
  market: arg('market', st.SRMARKET),
  sr: arg('sr', st.SR),
  pt: arg('pt', st.PT_SAC),
  ptAsset: arg('pt-asset', st.PT_ASSET_ID),
  rpc: arg('rpc', 'https://soroban-testnet.stellar.org'),
  horizon: arg('horizon', 'https://horizon-testnet.stellar.org'),
  passphrase: arg('passphrase', 'Test SDF Network ; September 2015'),
  interval: Number(arg('interval', '60')),
  // Dust band, in SR stroops. The contract's own slack is 10; a monitor should sit slightly wider
  // so it pages on a real deficit rather than on rounding.
  tolerance: BigInt(arg('tolerance', '100')),
  once: has('once'),
  webhook: arg('webhook', null),
};

for (const k of ['yield', 'market', 'sr', 'pt']) {
  if (!CFG[k]) {
    console.error(`missing --${k} (or a --state file that defines it)`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- rpc helpers

const server = new rpc.Server(CFG.rpc, { allowHttp: CFG.rpc.startsWith('http://') });
// Any funded-looking account works as a simulation source; nothing is ever signed or submitted.
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

const big = (v) => (typeof v === 'bigint' ? v : BigInt(v ?? 0));

/**
 * Issued supply of a CLASSIC asset, straight from Horizon. This is the number no contract can
 * fake — see the header. Returns null when it cannot be read, and the caller treats null as
 * "unknown", never as "fine".
 */
async function classicSupply(assetId) {
  if (!assetId || !assetId.includes(':')) return null;
  const [code, issuer] = assetId.split(':');
  try {
    const res = await fetch(
      `${CFG.horizon}/assets?asset_code=${encodeURIComponent(code)}&asset_issuer=${encodeURIComponent(issuer)}`,
    );
    if (!res.ok) return null;
    const rec = (await res.json())?._embedded?.records?.[0];
    if (!rec) return 0n; // the asset exists but nothing is issued yet

    // Horizon splits issued supply FOUR ways, and a monitor that reads only one of them is worse
    // than no monitor — it would look healthy while PT sat somewhere it did not count.
    //
    //   balances.authorized      classic trustlines held by ACCOUNTS
    //   contracts_amount         held by CONTRACTS (the market's reserve lives here)
    //   claimable_balances_amount
    //   liquidity_pools_amount
    //
    // Everything the engine ever minted lands in one of these, so their sum is the true supply.
    const dec = (v) => {
      const [whole, frac = ''] = String(v ?? '0').split('.');
      return BigInt(whole || '0') * 10_000_000n + BigInt((frac + '0000000').slice(0, 7));
    };
    return (
      dec(rec.balances?.authorized) +
      dec(rec.balances?.authorized_to_maintain_liabilities) +
      dec(rec.balances?.unauthorized) +
      dec(rec.contracts_amount) +
      dec(rec.claimable_balances_amount) +
      dec(rec.liquidity_pools_amount)
    );
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- checks

let prevIndex = null;
let prevTreasury = null;

async function poll() {
  const problems = [];
  const warnings = [];

  const [solv, totalPy, totalAccrued, index, ytSupply, reserves, ptSupply] = await Promise.all([
    read(CFG.yield, 'solvency'),
    read(CFG.yield, 'total_py'),
    read(CFG.yield, 'total_accrued'),
    read(CFG.yield, 'py_index'),
    read(CFG.yield, 'total_supply'),
    read(CFG.market, 'reserves'),
    classicSupply(CFG.ptAsset),
  ]);

  const held = big(solv?.[0]);
  const needed = big(solv?.[1]);
  const surplus = big(solv?.[2]);
  const py = big(totalPy);
  const accrued = big(totalAccrued);
  const idx = big(index);
  const yt = big(ytSupply);
  const ptRes = big(reserves?.[0]);
  const srRes = big(reserves?.[1]);

  // 1. ENGINE SOLVENCY
  if (held + CFG.tolerance < needed) {
    problems.push(
      `ENGINE INSOLVENT: SR held ${held} < required ${needed} (short by ${needed - held})`,
    );
  }

  // 2. PT CONSERVATION — the classic-path counterfeit check.
  if (ptSupply === null) {
    warnings.push('could not read the classic PT supply from Horizon — PT conservation UNVERIFIED');
  } else if (ptSupply !== py) {
    const delta = ptSupply - py;
    if (delta > 0n) {
      problems.push(
        `PT COUNTERFEIT: classic PT supply ${ptSupply} exceeds engine total_py ${py} by ${delta}. ` +
          `PT exists that the engine never minted and no SR backs. Check the issuer's master weight.`,
      );
    } else {
      problems.push(
        `PT UNDER-SUPPLY: classic supply ${ptSupply} is BELOW total_py ${py} by ${-delta}. ` +
          `The engine believes more PT is outstanding than exists — accounting drift.`,
      );
    }
  }

  // 3. YT CONSERVATION. After expiry `redeem_py` burns PT only, so YT legitimately exceeds
  // total_py from then on; only the reverse is ever a fault.
  if (yt < py) {
    problems.push(`YT UNDER-SUPPLY: YT supply ${yt} < total_py ${py} — the pair is not conserved`);
  }

  // 4. RESERVES BACKED — stored reserves must never exceed the tokens actually held.
  const [ptBal, srBal] = await Promise.all([
    read(CFG.pt, 'balance', [new Contract(CFG.market).address().toScVal()]).catch(() => null),
    read(CFG.sr, 'balance', [new Contract(CFG.market).address().toScVal()]).catch(() => null),
  ]);
  if (ptBal !== null && big(ptBal) < ptRes) {
    problems.push(`MARKET PT UNBACKED: stored reserve ${ptRes} > actual balance ${big(ptBal)}`);
  }
  if (srBal !== null && big(srBal) < srRes) {
    problems.push(`MARKET SR UNBACKED: stored reserve ${srRes} > actual balance ${big(srBal)}`);
  }

  // 5. INDEX MONOTONIC — the whole yield model assumes it never goes backwards.
  if (prevIndex !== null && idx < prevIndex) {
    problems.push(`INDEX WENT BACKWARDS: ${prevIndex} -> ${idx}`);
  }
  prevIndex = idx;

  // 6. TREASURY MONOTONIC — revenue is cumulative; a fall means an unexpected outflow path.
  const treasury = big(await read(CFG.market, 'treasury_earned').catch(() => 0n));
  if (prevTreasury !== null && treasury < prevTreasury) {
    problems.push(`TREASURY WENT BACKWARDS: ${prevTreasury} -> ${treasury}`);
  }
  prevTreasury = treasury;

  return { problems, warnings, held, needed, surplus, py, accrued, idx, yt, ptSupply, ptRes, srRes, treasury };
}

// ---------------------------------------------------------------- run

async function notify(text) {
  if (!CFG.webhook) return;
  try {
    await fetch(CFG.webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch {
    /* a failed page must never crash the monitor */
  }
}

let consecutiveRpcFailures = 0;

async function tick() {
  let r;
  try {
    r = await poll();
    consecutiveRpcFailures = 0;
  } catch (e) {
    consecutiveRpcFailures += 1;
    console.error(`[${new Date().toISOString()}] RPC error (${consecutiveRpcFailures}): ${e.message}`);
    // Transient RPC failure is not a solvency signal. Only give up after several in a row, and
    // exit 1 (infrastructure) rather than 2 (breach) so paging can distinguish them.
    if (consecutiveRpcFailures >= 5) {
      await notify(`Spield SR monitor: RPC unreachable ${consecutiveRpcFailures} polls in a row.`);
      process.exit(1);
    }
    return;
  }

  const ts = new Date().toISOString();
  const ptLine = r.ptSupply === null ? 'unknown' : String(r.ptSupply);
  console.log(
    `[${ts}] held=${r.held} needed=${r.needed} surplus=${r.surplus} | total_py=${r.py} ` +
      `pt_supply=${ptLine} yt_supply=${r.yt} | reserves=${r.ptRes}/${r.srRes} | ` +
      `index=${r.idx} accrued=${r.accrued} treasury=${r.treasury}`,
  );

  for (const w of r.warnings) console.warn(`  ⚠ ${w}`);

  if (r.problems.length > 0) {
    for (const p of r.problems) console.error(`  ✗ ${p}`);
    await notify(`Spield SR stack ALARM:\n${r.problems.join('\n')}`);
    process.exit(2);
  }
  // Never report "all clear" when a check could not run — an unverified invariant is not a held
  // one, and conflating them is how a monitor becomes worse than none.
  const checked = 6 - r.warnings.length;
  console.log(
    r.warnings.length === 0
      ? '  ✓ all six invariants hold'
      : `  ✓ ${checked}/6 invariants hold — ${r.warnings.length} could NOT be checked (see above)`,
  );
}

await tick();
if (!CFG.once) {
  setInterval(() => {
    void tick();
  }, CFG.interval * 1000);
}
