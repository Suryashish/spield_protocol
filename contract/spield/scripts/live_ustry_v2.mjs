// Live testnet lifecycle against a deployed v2 series. Phases are separate so maturity can be
// exercised for real on the 20-minute fixture:
//   node live_ustry_v2.mjs <deployment.json> before   # deposits, split, transfer, sync, claim
//   node live_ustry_v2.mjs <deployment.json> after    # post-expiry: finalize, PT-only exit
// Amounts are tiny (≤ 0.2 test USTRY). Signs with alice425; the stranger is a fresh key.
import fs from 'node:fs';
import { Keypair } from '@stellar/stellar-sdk';
import { address, client, i128, json, keypair, u32, u64 } from './ustry_v2.mjs';

const [file, phase] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
const c = client(d.network);
const alice = keypair('alice425');
const A = alice.publicKey();
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const bal = async () => BigInt(await c.view(d.asset, 'balance', [address(A)]));
const holding = () => c.view(d.series, 'balance', [address(A)]);
const invariant = async (label) => {
  const s = await c.view(d.series, 'state');
  const held = BigInt(await c.view(d.asset, 'balance', [address(d.series)]));
  ok(`custody covers obligations ${label}`, held >= BigInt(s.receipts) + BigInt(s.backing), `${held} ≥ ${BigInt(s.receipts) + BigInt(s.backing)}`);
  for (const [k, id] of [[0, d.receipt], [1, d.pt], [2, d.yt]])
    ok(`token ${k} supply == series supply ${label}`, BigInt(await c.view(id, 'total_supply')) === BigInt(await c.view(d.series, 'claim_supply', [u32(k)])));
};
const rejects = async (label, contract, method, args, code) => {
  try {
    await c.view(contract, method, args, A);
    ok(label, false, 'accepted');
  } catch (e) {
    const got = /Error\(Contract, #(\d+)\)/.exec(e.message)?.[1];
    ok(label, code === undefined || Number(got) === code, `error #${got}`);
  }
};

if (phase === 'before') {
  const start = await bal();
  fs.writeFileSync(`${file}.start`, String(start));
  const st = await c.view(d.series, 'status');
  ok('status: oracle ok, fresh, entry open', st.oracle_ok && st.fresh && st.entry_open);
  await c.send(alice, d.series, 'deposit', [address(A), i128(500_000)]);
  const face = (await c.send(alice, d.series, 'deposit_split', [address(A), i128(1_000_000), i128(1)])).value;
  const nav = BigInt(st.state.last_observation.price);
  ok('split face = amount × NAV (rounded down)', BigInt(face) <= (1_000_000n * nav) / 100_000_000n && BigInt(face) >= (1_000_000n * nav) / 100_000_000n - 1n, `${face}`);
  const h = await holding();
  ok('holding has receipt, PT and YT', BigInt(h.receipt) === 500_000n && BigInt(h.pt) === BigInt(face) && BigInt(h.yt) === BigInt(face));
  await rejects('slippage guard on split', d.series, 'deposit_split', [address(A), i128(1_000_000), i128(BigInt(face) + 1n)], 10);
  await rejects('cap refuses > cap deposit', d.series, 'deposit', [address(A), i128(BigInt(d.cap) + 1n)], 15);
  // Real token transfers to a fresh account, both directions settled by the series.
  const stranger = Keypair.random().publicKey();
  await c.send(alice, d.pt, 'transfer', [address(A), address(stranger), i128(10)]);
  await c.send(alice, d.yt, 'transfer', [address(A), address(stranger), i128(10)]);
  ok('PT/YT transfer credited the recipient', BigInt(await c.view(d.pt, 'balance', [address(stranger)])) === 10n && BigInt(await c.view(d.yt, 'balance', [address(stranger)])) === 10n);
  // Simulation records auth rather than enforcing it, so this must be a real signed submission.
  try {
    await c.send(alice, d.oracle, 'publish', [i128(nav), u64(await c.ledgerTime())]);
    ok('the admin cannot publish NAV', false, 'accepted');
  } catch (e) {
    ok('the admin cannot publish NAV', true, e.message.slice(0, 60));
  }
  await c.send(alice, d.series, 'sync', []);
  ok('claim on a fresh position pays 0', BigInt((await c.send(alice, d.series, 'claim_yield', [address(A)])).value) === 0n);
  await invariant('after entry');
  console.log(json({ face, expiry: d.expiry, secondsToExpiry: d.expiry - (await c.ledgerTime()) }));
} else if (phase === 'after') {
  const now = await c.ledgerTime();
  if (now < d.expiry) throw new Error(`Not expired yet: ${d.expiry - now}s to go`);
  await rejects('deposits closed after expiry', d.series, 'deposit', [address(A), i128(1)], 4);
  let st = await c.view(d.series, 'status');
  console.log(json({ boundary_seen: st.boundary_seen, finalizable: st.finalizable }));
  ok('finalizable on a post-expiry sample', st.boundary_seen && st.finalizable);
  const r = await c.send(alice, d.series, 'finalize', []);
  ok('finalized via boundary path', r.value.finalized === true, r.hash);
  st = await c.view(d.series, 'status');
  ok('post-expiry samples did not move high-water', BigInt(st.state.last_observation.timestamp) <= BigInt(d.expiry));
  const h = await holding();
  // PT alone redeems after finalization; YT stays and only claims.
  const paid = (await c.send(alice, d.series, 'redeem', [address(A), i128(h.pt), i128(0)])).value;
  const h2 = await holding();
  ok('PT-only redemption after finalization', BigInt(h2.pt) === 0n && BigInt(h2.yt) === BigInt(h.yt), `paid ${paid}`);
  await c.send(alice, d.series, 'claim_yield', [address(A)]);
  await c.send(alice, d.series, 'withdraw_receipts', [address(A), i128(h2.receipt)]);
  await invariant('after exit');
  const start = BigInt(fs.readFileSync(`${file}.start`, 'utf8'));
  const end = await bal();
  // Alice gave the stranger 10 face of PT+YT (≈ 9 token units); everything else returns.
  ok('alice recovered her USTRY minus the gift and rounding', start - end >= 0n && start - end <= 15n, `difference ${start - end} units`);
}
fs.writeFileSync(`${file}.${phase}.result.json`, json(results) + '\n');
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
