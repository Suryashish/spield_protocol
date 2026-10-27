// Genuine sandbox USTRY, isolated series, deliberately controlled test prices.
// Deploys only to Stellar testnet; never reads or submits to a mainnet endpoint.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Address, BASE_FEE, Contract, Horizon, Keypair, Networks, TransactionBuilder, nativeToScVal, rpc, scValToNative } from '@stellar/stellar-sdk';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = '/tmp/spield_etherfuse_execution';
const journal = path.join(dir, 'prototype.json');
const evidenceFile = path.join(root, 'research/ustry/testnet-prototype-execution-2026-10-27.json');
const wallet = 'GDXHBXYT23MUJWOKNZLTRBYJA2H6LDIL2DVHJCVITEFKQK5QUT2LPBJF';
const token = 'CCUGMX7HX6CH6T4XNPALQ7HCVU37RLUNHAYNSAIALTPFHFQVIRIHALBC';
const rpcUrl = 'https://soroban-testnet.stellar.org';
const server = new rpc.Server(rpcUrl);
const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
const ENTRY = 125_000_000n, UP = 156_250_000n;
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const state = fs.existsSync(journal) ? JSON.parse(fs.readFileSync(journal, 'utf8')) : {};
const evidence = fs.existsSync(evidenceFile) ? JSON.parse(fs.readFileSync(evidenceFile, 'utf8')) : {
  network: 'Stellar testnet', wallet, token, asset: 'USTRY:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4',
  oracleMode: 'controlled test prices; not actual USTRY NAV or realized yield', ptYtMode: 'internal balances, not standalone SEP-41 tokens',
  stages: {}, transactions: [],
};
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function save() {
  fs.writeFileSync(journal, json(state), { mode: 0o600 });
  evidence.updatedAtUtc = new Date().toISOString();
  fs.writeFileSync(evidenceFile, json(evidence) + '\n');
}
function event(name, value) { evidence.stages[name] = value; save(); console.log(json({ stage: name, ...value })); }
const address = value => new Address(value).toScVal();
const i128 = value => nativeToScVal(BigInt(value), { type: 'i128' });
const u64 = value => nativeToScVal(BigInt(value), { type: 'u64' });
function signer() {
  const secret = execFileSync('stellar', ['keys', 'secret', 'alice425'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
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
    .addOperation(new Contract(contract).call(method, ...args)).setTimeout(120).build();
  const simulation = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation)) {
    const code = /Error\(Contract,\s*#?(\d+)\)/.exec(simulation.error)?.[1];
    if (expectedError !== undefined && Number(code) === expectedError) return { rejected: true, contractError: expectedError };
    fs.writeFileSync(path.join(dir, 'prototype-error.json'), json(simulation), { mode: 0o600 });
    throw new Error(`${method}: simulation failed; diagnostic saved privately`);
  }
  if (expectedError !== undefined) throw new Error(`${method}: expected rejection did not occur`);
  if (view) return scValToNative(simulation.result.retval);
  const assembled = rpc.assembleTransaction(tx, simulation).build();
  assembled.sign(signer());
  const sent = await server.sendTransaction(assembled);
  if (!['PENDING', 'DUPLICATE'].includes(sent.status)) throw new Error(`${method}: transaction not accepted (${sent.status})`);
  for (let n = 0; n < 30; n++) {
    const result = await server.getTransaction(sent.hash);
    if (result.status === 'SUCCESS') {
      const value = result.returnValue ? scValToNative(result.returnValue) : null;
      evidence.transactions.push({ contract, method, hash: sent.hash, successful: true, returnValue: value });
      save(); return value;
    }
    if (result.status === 'FAILED') throw new Error(`${method}: submitted transaction failed`);
    await sleep(2000);
  }
  throw new Error(`${method}: submitted transaction confirmation pending; do not blindly replay`);
}
async function publish(price) {
  let timestamp = await ledgerTime();
  while (timestamp <= (state.lastOracleTimestamp ?? 0)) { await sleep(1000); timestamp = await ledgerTime(); }
  await call(state.oracle, 'publish', [i128(price), u64(timestamp)]);
  state.lastOracleTimestamp = timestamp; save();
}
function deploy(wasm, constructorArgs) {
  const args = ['contract', 'deploy', '--wasm', path.join(root, 'target/wasm32v1-none/release', wasm),
    '--source-account', 'alice425', '--rpc-url', rpcUrl, '--network-passphrase', Networks.TESTNET, '--inclusion-fee', '100', '--', ...constructorArgs];
  const output = execFileSync('stellar', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 }).trim();
  const id = output.match(/C[A-Z2-7]{55}/)?.[0];
  if (!id) throw new Error('Deployment returned no contract ID');
  return id;
}
async function tokenBalance(owner) { return call(token, 'balance', [address(owner)], { view: true }); }
async function setup() {
  if (!state.oracle) {
    state.oracle = deploy('spield_rwa_mock_oracle.wasm', ['--admin', wallet, '--asset', token, '--base', 'USD', '--decimals', '8']);
    save();
  }
  if (!state.series) {
    await publish(ENTRY);
    state.expiry = (await ledgerTime()) + 360;
    state.maxAge = 90;
    state.series = deploy('spield_rwa_prototype.wasm', ['--asset', token, '--oracle', state.oracle, '--expiry', String(state.expiry), '--max_age', String(state.maxAge)]);
    save();
  }
  evidence.oracle = state.oracle; evidence.series = state.series; evidence.expiry = state.expiry; evidence.maxAge = state.maxAge;
  evidence.wasmHashes = Object.fromEntries(['spield_rwa_mock_oracle.wasm', 'spield_rwa_prototype.wasm'].map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(root, 'target/wasm32v1-none/release', name))).digest('hex')]));
  event('deployment', { oracle: state.oracle, series: state.series, expiry: state.expiry, maxAge: state.maxAge, walletUstry: await tokenBalance(wallet) });
}
async function depositSplit() {
  if (state.depositSplitDone) throw new Error('Deposit/split already completed for this fixture');
  state.initialWalletTokens = (await tokenBalance(wallet)).toString(); save();
  if (BigInt(state.initialWalletTokens) < 12_500_000n) throw new Error('Insufficient test USTRY');
  await publish(ENTRY);
  await call(state.series, 'deposit', [address(wallet), i128(12_500_000)]);
  const face = await call(state.series, 'split', [address(wallet), i128(10_000_000), i128(12_500_000)]);
  if (BigInt(face) !== 12_500_000n) throw new Error('Incorrect dollar face');
  state.face = face.toString(); state.depositSplitDone = true; save();
  event('depositSplit', { depositedUstryUnits: '12500000', splitUstryUnits: '10000000', usdFaceUnits: face,
    holding: await call(state.series, 'balance', [address(wallet)], { view: true }), custodyUstryUnits: await tokenBalance(state.series) });
}
async function fall() {
  await publish(100_000_000n);
  const earned = await call(state.series, 'claim_yield', [address(wallet)]);
  if (BigInt(earned) !== 0n) throw new Error('Drawdown created phantom yield');
  event('fallingNav', { controlledUsdPrice: '1.00', yieldTokensPaid: earned,
    oneTokenUsdUnits: await call(state.series, 'value_usd', [i128(10_000_000)], { view: true }),
    nominalPtFaceUnits: state.face, highWater: (await call(state.series, 'state', [], { view: true })).high_water });
}
async function stale() {
  const deadline = state.lastOracleTimestamp + state.maxAge + 1;
  while (await ledgerTime() < deadline) {
    console.log(json({ stage: 'waitingForStaleObservation', secondsRemaining: deadline - await ledgerTime() }));
    await sleep(15_000);
  }
  const before = await call(state.series, 'balance', [address(wallet)], { view: true });
  const rejected = await call(state.series, 'redeem', [address(wallet), i128(1_250_000), i128(0)], { expectedError: 9 });
  const after = await call(state.series, 'balance', [address(wallet)], { view: true });
  if (json(before) !== json(after)) throw new Error('Rejected redemption changed claims');
  await call(state.series, 'withdraw_receipts', [address(wallet), i128(2_500_000)]);
  event('staleOracle', { ...rejected, claimsUnchanged: true, oracleFreeReceiptPayoutUnits: '2500000' });
}
async function recoverClaim() {
  await publish(ENTRY);
  const recovery = await call(state.series, 'claim_yield', [address(wallet)]);
  if (BigInt(recovery) !== 0n) throw new Error('Recovery to the old peak created yield');
  await publish(UP);
  const paid = await call(state.series, 'claim_yield', [address(wallet)]);
  if (BigInt(paid) !== 2_000_000n) throw new Error('Incorrect yield token allocation');
  event('recoveryAndYield', { recoveryYieldUnits: recovery, newHighWaterYieldPayoutUnits: paid, custodyUstryUnits: await tokenBalance(state.series) });
}
async function mature() {
  while (await ledgerTime() < state.expiry) {
    const now = await ledgerTime();
    if (now - state.lastOracleTimestamp > 40 && state.expiry - now > 10) await publish(UP);
    console.log(json({ stage: 'waitingForMaturity', secondsRemaining: state.expiry - await ledgerTime() }));
    await sleep(15_000);
  }
  await publish(250_000_000n); // Post-expiry rise must not accrue to YT.
  const frozen = await call(state.series, 'finalize');
  if (!frozen.finalized || BigInt(frozen.high_water) !== UP) throw new Error('Maturity allocation is incorrect');
  const paid = await call(state.series, 'redeem', [address(wallet), i128(state.face), i128(8_000_000)]);
  const residue = await call(state.series, 'claim_yield', [address(wallet)]);
  const endingWallet = await tokenBalance(wallet), custody = await tokenBalance(state.series);
  if (BigInt(paid) !== 8_000_000n || BigInt(residue) !== 0n || BigInt(custody) !== 0n || BigInt(endingWallet) !== BigInt(state.initialWalletTokens)) {
    throw new Error('Maturity payouts do not reconcile');
  }
  event('maturityAndRedemption', { finalized: true, frozenHighWater: frozen.high_water, postExpiryTestPrice: '2.50',
    principalPayoutUnits: paid, extraYieldUnits: residue, custodyUstryUnits: custody, initialWalletUstryUnits: state.initialWalletTokens, finalWalletUstryUnits: endingWallet, tokensConserved: true });
}
async function main() {
  const action = process.argv[2];
  if (action === 'setup') await setup();
  else if (action === 'deposit-split') await depositSplit();
  else if (action === 'fall') await fall();
  else if (action === 'stale') await stale();
  else if (action === 'recover-claim') await recoverClaim();
  else if (action === 'mature') await mature();
  else if (action === 'exercise') {
    await depositSplit();
    await fall();
    await stale();
    await recoverClaim();
    await mature();
  }
  else throw new Error('Unknown prototype execution step');
}
main().catch(error => { save(); console.error(error.message); process.exitCode = 1; });
