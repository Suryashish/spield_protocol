// Bounded genuine-USTRY app deployment and smoke test. TESTNET ONLY.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  Address,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';
import { fetchNav, publicationDue } from './ustry_nav.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = '/tmp/spield_etherfuse_execution';
const journal = path.join(dir, 'app-v1-sep41-final.json');
const evidenceFile = path.join(root, 'research/ustry/app-v1-execution.json');
const wallet = 'GDXHBXYT23MUJWOKNZLTRBYJA2H6LDIL2DVHJCVITEFKQK5QUT2LPBJF';
const token = 'CCUGMX7HX6CH6T4XNPALQ7HCVU37RLUNHAYNSAIALTPFHFQVIRIHALBC';
const rpcUrl = 'https://soroban-testnet.stellar.org';
const server = new rpc.Server(rpcUrl);
const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const state = fs.existsSync(journal) ? JSON.parse(fs.readFileSync(journal, 'utf8')) : {};
const evidence = fs.existsSync(evidenceFile)
  ? JSON.parse(fs.readFileSync(evidenceFile, 'utf8'))
  : {
      network: 'Stellar testnet',
      wallet,
      token,
      stages: {},
      transactions: [],
      oracleMode: 'issuer sandbox NAV, authenticated relay observations; not RedStone',
    };
const json = (value) =>
  JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function save() {
  fs.writeFileSync(journal, json(state), { mode: 0o600 });
  evidence.updatedAtUtc = new Date().toISOString();
  fs.writeFileSync(evidenceFile, json(evidence) + '\n');
}
function event(name, value) {
  evidence.stages[name] = value;
  save();
  console.log(json({ stage: name, ...value }));
}
const address = (value) => new Address(value).toScVal();
const i128 = (value) => nativeToScVal(BigInt(value), { type: 'i128' });
const u64 = (value) => nativeToScVal(BigInt(value), { type: 'u64' });
function signer() {
  const secret = execFileSync('stellar', ['keys', 'secret', 'alice425'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const kp = Keypair.fromSecret(secret);
  if (kp.publicKey() !== wallet) throw new Error('Unexpected local signer');
  return kp;
}
async function ledgerTime() {
  const result = await horizon.ledgers().order('desc').limit(1).call();
  return Math.floor(Date.parse(result.records[0].closed_at) / 1000);
}
async function call(contract, method, args = [], { view = false, expectedError } = {}) {
  const network = await server.getNetwork();
  if (network.passphrase !== Networks.TESTNET) throw new Error('RPC is not Stellar testnet');
  const source = await server.getAccount(wallet);
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(contract).call(method, ...args))
    .setTimeout(120)
    .build();
  const simulation = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation)) {
    const code = /Error\(Contract,\s*#?(\d+)\)/.exec(simulation.error)?.[1];
    if (expectedError !== undefined && Number(code) === expectedError)
      return { rejected: true, contractError: expectedError };
    fs.writeFileSync(path.join(dir, 'app-error.json'), json(simulation), { mode: 0o600 });
    throw new Error(`${method}: simulation failed; diagnostic saved privately`);
  }
  if (expectedError !== undefined) throw new Error(`${method}: expected rejection did not occur`);
  if (view) return scValToNative(simulation.result.retval);
  const assembled = rpc.assembleTransaction(tx, simulation).build();
  assembled.sign(signer());
  const pendingHash = Buffer.from(assembled.hash()).toString('hex');
  state.pending = { contract, method, hash: pendingHash };
  save();
  const sent = await server.sendTransaction(assembled);
  if (!['PENDING', 'DUPLICATE'].includes(sent.status))
    throw new Error(`${method}: transaction not accepted (${sent.status})`);
  for (let n = 0; n < 30; n++) {
    const result = await server.getTransaction(sent.hash);
    if (result.status === 'SUCCESS') {
      const value = result.returnValue ? scValToNative(result.returnValue) : null;
      delete state.pending;
      evidence.transactions.push({
        contract,
        method,
        hash: sent.hash,
        successful: true,
        returnValue: value,
      });
      save();
      return value;
    }
    if (result.status === 'FAILED') throw new Error(`${method}: submitted transaction failed`);
    await sleep(2000);
  }
  throw new Error(`${method}: submitted transaction confirmation pending; do not blindly replay`);
}
async function deploy(wasm, constructorArgs) {
  const args = [
    'contract',
    'deploy',
    '--wasm',
    path.join(root, 'target/wasm32v1-none/release', wasm),
    '--source-account',
    'alice425',
    '--rpc-url',
    rpcUrl,
    '--network-passphrase',
    Networks.TESTNET,
    '--inclusion-fee',
    '100',
    '--',
    ...constructorArgs,
  ];
  if (state.pendingDeployment) {
    const p = state.pendingDeployment;
    if (p.wasm !== wasm || JSON.stringify(p.constructorArgs) !== JSON.stringify(constructorArgs))
      throw new Error('Different deployment still pending: ' + p.hash);
    const result = await server.getTransaction(p.hash);
    if (result.status !== 'SUCCESS')
      throw new Error('Deployment ' + p.hash + ' is ' + result.status + '; inspect before replay');
    const recovered = scValToNative(result.returnValue);
    if (typeof recovered !== 'string' || !/^C[A-Z2-7]{55}$/.test(recovered))
      throw new Error('Unexpected deployment result');
    delete state.pendingDeployment;
    save();
    return recovered;
  }
  const result = spawnSync('stellar', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
  });
  const output = result.stdout ?? '';
  let id = output.match(/C[A-Z2-7]{55}/)?.[0];
  const hash = [...(result.stderr ?? '').matchAll(/Signing transaction: ([a-f0-9]{64})/g)].at(
    -1,
  )?.[1];
  if (!id && hash) {
    state.pendingDeployment = { wasm, constructorArgs, hash };
    save();
    for (let n = 0; n < 30; n++) {
      const receipt = await server.getTransaction(hash);
      if (receipt.status === 'SUCCESS') {
        id = scValToNative(receipt.returnValue);
        delete state.pendingDeployment;
        save();
        break;
      }
      if (receipt.status === 'FAILED') throw new Error('Deployment failed: ' + hash);
      await sleep(2000);
    }
  }
  if (!id || !/^C[A-Z2-7]{55}$/.test(id))
    throw new Error(
      'Deployment unresolved; inspect journal before retrying. ' +
        (hash ?? result.error?.message ?? result.stderr),
    );
  return id;
}

async function setup() {
  if (state.pending)
    throw new Error('Unresolved transaction ' + state.pending.hash + '; inspect before replay');
  if (
    !state.series &&
    fs.existsSync(path.join(root, '../../frontend/src/lib/ustry-deployment.json'))
  ) {
    const previous = JSON.parse(
      fs.readFileSync(path.join(root, '../../frontend/src/lib/ustry-deployment.json'), 'utf8'),
    );
    const cfg = await call(previous.series, 'config', [], { view: true });
    const claims = await call(previous.series, 'state', [], { view: true });
    if (
      !cfg.paused ||
      BigInt(claims.receipts) !== 0n ||
      BigInt(claims.face) !== 0n ||
      BigInt(claims.total_yt) !== 0n
    )
      throw new Error(
        'Existing app deployment is active or has claims. Keep its registry entry; do not replace it.',
      );
  }
  if (!state.expiry) {
    state.expiry = (await ledgerTime()) + 14 * 86400;
    save();
  }
  if (!state.oracle) {
    const nav = await fetchNav();
    const timestamp = await ledgerTime();
    state.oracle = await deploy('spield_ustry_oracle.wasm', [
      '--admin',
      wallet,
      '--asset',
      token,
      '--price',
      String(nav.price),
      '--timestamp',
      String(timestamp),
      '--expiry',
      String(state.expiry),
    ]);
    evidence.initialNav = nav;
    save();
  }
  if (!state.series) {
    state.series = await deploy('spield_rwa.wasm', [
      '--admin',
      wallet,
      '--asset',
      token,
      '--oracle',
      state.oracle,
      '--expiry',
      String(state.expiry),
      '--max_age',
      '46800',
    ]);
    save();
  }
  for (const [kind, key, symbol] of [
    [0, 'receipt', 'sUSTRY'],
    [1, 'pt', 'PT-USTRY'],
    [2, 'yt', 'YT-USTRY'],
  ]) {
    if (!state[key]) {
      state[key] = await deploy('spield_rwa_token.wasm', [
        '--series',
        state.series,
        '--kind',
        String(kind),
        '--name',
        'Spield sandbox ' + symbol,
        '--symbol',
        symbol,
      ]);
      save();
    }
  }
  if (!state.bound) {
    const cfg = await call(state.series, 'config', [], { view: true });
    if (!cfg.tokens.length)
      await call(state.series, 'bind_tokens', [
        address(state.receipt),
        address(state.pt),
        address(state.yt),
      ]);
    state.bound = true;
    save();
  }
  const deployment = {
    network: 'testnet',
    series: state.series,
    oracle: state.oracle,
    receipt: state.receipt,
    pt: state.pt,
    yt: state.yt,
    asset: token,
    expiry: state.expiry,
    maxAge: 46800,
    capUstry: 1000,
  };
  evidence.deployment = deployment;
  save();
  fs.writeFileSync(
    path.join(root, '../../frontend/src/lib/ustry-deployment.json'),
    json(deployment) + '\n',
  );
  event('deployed', deployment);
}
async function smoke() {
  if (!state.bound || state.pending || state.smokeStarted)
    throw new Error('Not ready or smoke already started; inspect journal');
  state.smokeStarted = true;
  state.initialTokens = String(await call(token, 'balance', [address(wallet)], { view: true }));
  save();
  await call(state.series, 'deposit', [address(wallet), i128(1_000_000)]);
  await call(state.series, 'withdraw_receipts', [address(wallet), i128(1_000_000)]);
  const face = await call(state.series, 'deposit_split', [
    address(wallet),
    i128(1_000_000),
    i128(1),
  ]);
  if (BigInt(await call(state.pt, 'balance', [address(wallet)], { view: true })) !== BigInt(face))
    throw new Error('Facade balance mismatch');
  // Self transfer exercises genuine facades without moving ownership to an unregistered wallet.
  await call(state.pt, 'transfer', [address(wallet), address(wallet), i128(face)]);
  await call(state.yt, 'transfer', [address(wallet), address(wallet), i128(face)]);
  const claim = await call(state.series, 'claim_yield', [address(wallet)]);
  const paid = await call(state.series, 'redeem', [address(wallet), i128(face), i128(999_990)]);
  const ending = await call(token, 'balance', [address(wallet)], { view: true });
  const custody = await call(token, 'balance', [address(state.series)], { view: true });
  // Conservative integer division can leave one unit (0.0000001 USTRY) in escrow.
  if (BigInt(state.initialTokens) - BigInt(ending) > 1n || BigInt(custody) > 1n)
    throw new Error('Custody did not reconcile');
  state.smokeDone = true;
  save();
  event('genuineAssetRoundTrip', {
    face,
    claim,
    paid,
    initialTokens: state.initialTokens,
    endingTokens: ending,
    custody,
    roundingUnits: BigInt(state.initialTokens) - BigInt(ending),
  });
}
async function retireDevelopmentDeployments() {
  for (const name of [
    'app-v1-superseded-unfunded.json',
    'app-v1-superseded-threshold.json',
    'app-v1-superseded-token-interface.json',
  ]) {
    const old = JSON.parse(
      fs.readFileSync(path.join(root, 'research/ustry', name), 'utf8'),
    ).deployment;
    const cfg = await call(old.series, 'config', [], { view: true });
    if (cfg.admin !== wallet || cfg.asset !== token)
      throw new Error('Unexpected development series owner or asset');
    if (!cfg.paused) await call(old.series, 'set_paused', [nativeToScVal(true)]);
    const liabilities = await call(old.series, 'state', [], { view: true });
    if (
      BigInt(liabilities.receipts) !== 0n ||
      BigInt(liabilities.face) !== 0n ||
      BigInt(liabilities.total_yt) !== 0n
    )
      throw new Error('Retired series has claims; retain it in the app registry before switching');
    event('retired-' + old.series, {
      series: old.series,
      newExposurePaused: true,
      receipts: liabilities.receipts,
      pt: liabilities.face,
      yt: liabilities.total_yt,
      roundingBacking: liabilities.backing,
    });
  }
}
async function relay() {
  if (!state.bound) {
    // A reboot may clear /tmp. Public relay configuration is recoverable without
    // replaying deployment, funding or smoke actions.
    const deployment = JSON.parse(
      fs.readFileSync(path.join(root, '../../frontend/src/lib/ustry-deployment.json'), 'utf8'),
    );
    if (deployment.network !== 'testnet' || deployment.asset !== token)
      throw new Error('Wrong relay deployment identity');
    const cfg = await call(deployment.series, 'config', [], { view: true });
    if (
      cfg.admin !== wallet ||
      cfg.asset !== token ||
      cfg.oracle !== deployment.oracle ||
      Number(cfg.expiry) !== deployment.expiry ||
      cfg.tokens.join() !== [deployment.receipt, deployment.pt, deployment.yt].join()
    )
      throw new Error('Relay configuration differs from chain');
    Object.assign(state, deployment, { bound: true });
    save();
  }
  if (state.pending)
    throw new Error(
      'Pending transaction ' + state.pending.hash + '; inspect before further publication',
    );
  const history = await call(state.oracle, 'observations', [], { view: true });
  const last = history.at(-1);
  const now = await ledgerTime();
  if (Number(last.timestamp) >= state.expiry) {
    console.log('Series boundary already observed; relay retired.');
    return true;
  }
  const nav = await fetchNav();
  if (!publicationDue(last, nav.price, now, state.expiry)) {
    console.log('NAV healthy; next publication not yet due.');
    return;
  }
  await call(state.oracle, 'publish', [i128(nav.price), u64(now)]);
  evidence.lastNav = nav;
  save();
  event('navPublished', { price: nav.price, timestamp: now });
}
const action = process.argv[2];
try {
  if (action === 'retire-dev') await retireDevelopmentDeployments();
  else if (action === 'setup') await setup();
  else if (action === 'smoke') await smoke();
  else if (action === 'relay') await relay();
  else if (action === 'keeper') {
    while (true) {
      try {
        if (await relay()) break;
      } catch (error) {
        console.error(new Date().toISOString() + ' relay failed: ' + error.message);
      }
      await sleep(60_000);
    }
  } else throw new Error('Usage: node execute_ustry_app.mjs setup|smoke|relay|keeper');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
