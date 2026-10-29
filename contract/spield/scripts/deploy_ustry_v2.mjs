// Deploys a USTRY v2 series: [spield-ustry-nav on testnet] + spield-ustry-series + 3 claim tokens.
//
//   node deploy_ustry_v2.mjs testnet --admin alice425 --publisher ustry-publisher --label series-2
//   node deploy_ustry_v2.mjs testnet --admin alice425 --publisher ustry-publisher --label fixture --fixture
//   node deploy_ustry_v2.mjs mainnet --admin <key> --label series-1 --confirm-mainnet
//
// Resumable: each step is journalled (privately, under ~/.spield) before the next starts, so a
// crash never deploys a second copy. The result is verified on chain, then written to
// frontend/src/lib/ustry-v2-<network>-<label>.json for the app.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fetchNav } from './ustry_nav.mjs';
import { address, client, json, keypair, stellarAsset, u32 } from './ustry_v2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const network = process.argv[2];
const arg = (n, f) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : f;
};
const flag = (n) => process.argv.includes(`--${n}`);
const adminKey = arg('admin');
const publisherKey = arg('publisher');
const label = arg('label');
const fixture = flag('fixture');
if (!adminKey || !label) throw new Error('--admin and --label are required');
if (network === 'mainnet' && !flag('confirm-mainnet'))
  throw new Error('Mainnet deploys spend real XLM: pass --confirm-mainnet once you have reviewed the plan');
if (network === 'mainnet' && fixture) throw new Error('Fixtures are testnet-only');
const c = client(network);
const p = c.profile;
const admin = keypair(adminKey);

const journalDir = path.join(os.homedir(), '.spield');
fs.mkdirSync(journalDir, { recursive: true, mode: 0o700 });
const journalFile = path.join(journalDir, `ustry-v2-${network}-${label}.json`);
const j = fs.existsSync(journalFile) ? JSON.parse(fs.readFileSync(journalFile, 'utf8')) : {};
const save = () => fs.writeFileSync(journalFile, json(j), { mode: 0o600 });

const wasm = (name) => path.join(root, 'target/wasm32v1-none/release', `${name}.wasm`);
const hash = (name) => createHash('sha256').update(fs.readFileSync(wasm(name))).digest('hex');
for (const n of ['spield_ustry_series', 'spield_rwa_token', ...(p.oracle ? [] : ['spield_ustry_nav'])])
  if (!fs.existsSync(wasm(n))) throw new Error(`Build ${n} first: stellar contract build`);

function deploy(step, name, ctor) {
  if (j[step]) return j[step];
  const out = execFileSync(
    'stellar',
    [
      'contract', 'deploy', '--wasm', wasm(name), '--source-account', adminKey,
      '--rpc-url', p.rpc, '--network-passphrase', p.passphrase, '--', ...ctor,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  ).trim().split('\n').at(-1);
  if (!/^C[A-Z2-7]{55}$/.test(out)) throw new Error(`${step}: unexpected deploy output ${out}`);
  j[step] = out;
  save();
  console.log(`${step}: ${out}`);
  return out;
}

const now = await c.ledgerTime();
j.expiry ??= fixture ? now + 20 * 60 : now + p.term;
save();
const params = fixture ? { ...p.params, max_age: 3_600, grace: 86_400 } : p.params;

let oracle = p.oracle;
if (!oracle) {
  if (!publisherKey) throw new Error('--publisher is required on testnet');
  const publisher = keypair(publisherKey).publicKey();
  if (publisher === admin.publicKey()) throw new Error('Publisher and admin must be different keys');
  const nav = await fetchNav();
  const t = await c.ledgerTime();
  oracle = deploy('oracle', 'spield_ustry_nav', [
    '--admin', admin.publicKey(), '--publisher', publisher, '--asset', p.asset,
    '--price', nav.price.toString(), '--timestamp', String(t),
    '--min_interval', String(fixture ? 60 : p.nav.min_interval), '--max_move_bps', String(p.nav.max_move_bps),
  ]);
}
const series = deploy('series', 'spield_ustry_series', [
  '--admin', admin.publicKey(), '--asset', p.asset, '--oracle', oracle,
  '--expiry', String(j.expiry), '--params', JSON.stringify(params),
]);
const names = [
  ['receipt', 'Spield sUSTRY receipt', 'sUSTRY'],
  ['pt', 'Spield PT-USTRY', 'PT-USTRY'],
  ['yt', 'Spield YT-USTRY', 'YT-USTRY'],
];
const tokens = names.map(([step, name, symbol], kind) =>
  deploy(step, 'spield_rwa_token', ['--series', series, '--kind', String(kind), '--name', name, '--symbol', symbol]),
);
if (!j.bound) {
  const cfg = await c.view(series, 'config');
  if (cfg.tokens.length === 0) {
    const r = await c.send(admin, series, 'bind_tokens', tokens.map(address));
    console.log(`bind_tokens: ${r.hash}`);
  }
  j.bound = true;
  save();
}

// ---------------------------------------------------------------- verify on chain
const cfg = await c.view(series, 'config');
const status = await c.view(series, 'status');
const checks = {
  admin: cfg.admin === admin.publicKey(),
  asset: cfg.asset === p.asset,
  oracle: cfg.oracle === oracle,
  expiry: Number(cfg.expiry) === j.expiry,
  params:
    Number(cfg.max_age) === params.max_age &&
    Number(cfg.grace) === params.grace &&
    Number(cfg.max_apr_bps) === params.max_apr_bps &&
    String(cfg.cap) === params.cap &&
    Number(cfg.window) === params.window,
  tokens: cfg.tokens.join() === tokens.join(),
  notPaused: cfg.paused === false,
  entryOpen: status.entry_open === true,
  feedLive: (await c.view(oracle, 'prices', [stellarAsset(p.asset), u32(4)]))?.length > 0,
};
for (const [kind, id] of tokens.entries()) {
  checks[`token${kind}`] =
    (await c.view(id, 'series')) === series && Number(await c.view(id, 'kind')) === kind;
}
console.log(json({ checks }));
if (!Object.values(checks).every(Boolean)) throw new Error('On-chain verification failed');

const out = {
  version: 2,
  network,
  label,
  series,
  oracle,
  receipt: tokens[0],
  pt: tokens[1],
  yt: tokens[2],
  asset: p.asset,
  expiry: j.expiry,
  maxAge: params.max_age,
  grace: params.grace,
  maxAprBps: params.max_apr_bps,
  cap: params.cap,
  window: params.window,
  wasm: {
    series: hash('spield_ustry_series'),
    token: hash('spield_rwa_token'),
    ...(p.oracle ? {} : { nav: hash('spield_ustry_nav') }),
  },
};
const dest = fixture
  ? path.join(root, `research/ustry/v2-fixture-${network}.json`)
  : path.join(root, `../../frontend/src/lib/ustry-v2-${network}-${label}.json`);
fs.writeFileSync(dest, json(out) + '\n');
console.log(`verified; wrote ${dest}`);
