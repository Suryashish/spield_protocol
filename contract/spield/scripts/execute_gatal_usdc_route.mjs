// A bounded, one-shot public Stellar testnet self-swap. No Etherfuse API/key.
// The Ramp API rejecting an issuer does not imply its SDEX route is unavailable.
// Requires --execute; both legs return their output to the same local wallet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { decimalToInteger, formatInteger } from './ustry_oracle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = '/tmp/spield_etherfuse_execution';
const wallet = 'GDXHBXYT23MUJWOKNZLTRBYJA2H6LDIL2DVHJCVITEFKQK5QUT2LPBJF';
const gatal = new Asset('USDC', 'GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56');
const circle = new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
const ustry = new Asset('USTRY', 'GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4');
const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
const identify = asset => asset.code + ':' + asset.issuer;
const units = amount => decimalToInteger(amount, 7);
const quantity = amount => formatInteger(amount, 7);
const journalFile = path.join(dir, 'gatal-route.json');
const output = path.join(root, 'research/ustry/gatal-usdc-execution-2026-10-27.json');
const state = fs.existsSync(journalFile) ? JSON.parse(fs.readFileSync(journalFile, 'utf8')) : {};
const report = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : {
  network: 'Stellar testnet', executionMode: 'SDEX path payment to self; not Etherfuse Ramp API',
  wallet, localIdentity: 'alice425', realMoneyMoved: false, maxInitialSpend: '1.0000000', sourceAsset: identify(gatal),
  destinationAsset: identify(ustry), slippageLimitBpsPerLeg: 100, transactions: [],
};
function save() {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(journalFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  report.updatedAtUtc = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}
async function balances() {
  const account = await horizon.loadAccount(wallet);
  return Object.fromEntries([gatal, circle, ustry].map(asset => {
    const b = account.balances.find(b => b.asset_code === asset.code && b.asset_issuer === asset.issuer);
    if (!b || !b.is_authorized) throw new Error('Expected authorized token trustline missing');
    return [identify(asset), b.balance];
  }));
}
function localSigner() {
  const secret = execFileSync('stellar', ['keys', 'secret', 'alice425'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const key = Keypair.fromSecret(secret);
  if (key.publicKey() !== wallet) throw new Error('Local signer mismatch');
  return key;
}
async function trade(name, sourceAsset, destinationAsset, sourceUnits, minimumAcceptable = 1n) {
  const sourceQuantity = quantity(sourceUnits);
  if (!state[name]) {
    const routes = await horizon.strictSendPaths(sourceAsset, sourceQuantity, [destinationAsset]).call();
    const matches = routes.records.filter(r => r.source_asset_code === sourceAsset.code && r.source_asset_issuer === sourceAsset.issuer &&
      r.destination_asset_code === destinationAsset.code && r.destination_asset_issuer === destinationAsset.issuer &&
      units(r.source_amount) === sourceUnits && r.path.length <= 1 &&
      r.path.every(p => p.asset_code === circle.code && p.asset_issuer === circle.issuer));
    matches.sort((a, b) => units(a.destination_amount) > units(b.destination_amount) ? -1 : units(a.destination_amount) < units(b.destination_amount) ? 1 : 0);
    const best = matches[0];
    if (!best) throw new Error('No executable route with the expected exact assets');
    const minOutput = units(best.destination_amount) * 9900n / 10_000n;
    if (minOutput < minimumAcceptable) throw new Error('Route is below the bounded test minimum');
    const account = await horizon.loadAccount(wallet);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.pathPaymentStrictSend({ source: wallet, destination: wallet, sendAsset: sourceAsset,
        sendAmount: sourceQuantity, destAsset: destinationAsset, destMin: quantity(minOutput),
        path: best.path.map(p => new Asset(p.asset_code, p.asset_issuer)) }))
      .setTimeout(90).build();
    if (tx.source !== wallet || tx.operations.length !== 1 || tx.operations[0].destination !== wallet) throw new Error('Self-swap construction mismatch');
    tx.sign(localSigner());
    state[name] = { hash: Buffer.from(tx.hash()).toString('hex'), sourceAsset: identify(sourceAsset), sourceAmount: sourceQuantity,
      destinationAsset: identify(destinationAsset), quotedOutput: best.destination_amount, minOutput: quantity(minOutput),
      path: best.path.map(p => p.asset_code + ':' + p.asset_issuer) };
    save(); // Preserve hash before submission; never blindly repeat an ambiguous send.
    const sent = await horizon.submitTransaction(tx);
    if (!sent.successful || sent.hash !== state[name].hash) throw new Error('Self-swap was not confirmed');
  }
  const tx = await horizon.transactions().transaction(state[name].hash).call();
  if (!tx.successful) throw new Error('Recorded self-swap failed; do not replay automatically');
  const ops = await horizon.operations().forTransaction(state[name].hash).call();
  const op = ops.records.find(o => o.type === 'path_payment_strict_send');
  if (!op || op.from !== wallet || op.to !== wallet || op.source_asset_issuer !== sourceAsset.issuer || op.asset_issuer !== destinationAsset.issuer ||
      op.source_asset_code !== sourceAsset.code || op.asset_code !== destinationAsset.code || units(op.source_amount) !== sourceUnits) {
    throw new Error('Settled operation differs from the expected self-swap');
  }
  const record = { stage: name, ...state[name], successful: true, actualOutput: op.amount, createdAt: tx.created_at, feeChargedStroops: tx.fee_charged };
  state[name].actualOutput = op.amount;
  report.transactions = report.transactions.filter(t => t.stage !== name).concat(record);
  save(); console.log(JSON.stringify(record, null, 2));
  return units(op.amount);
}
async function main() {
  if (!process.argv.includes('--execute')) throw new Error('Use --execute for the authorized 1-USDC testnet round trip');
  if (report.completed) { console.log('This recorded one-shot test already completed; no transaction repeated.'); return; }
  if (!state.initialBalances) {
    state.initialBalances = await balances();
    if (units(state.initialBalances[identify(gatal)]) < 10_000_000n) throw new Error('Alice lacks 1 GATAL-USDC');
    save();
  }
  const bought = await trade('buyUstry', gatal, ustry, 10_000_000n);
  if (bought <= 0n || bought > 20_000_000n) throw new Error('Unexpected acquired amount; inspect before the reverse test');
  const returned = await trade('sellBackToGatal', ustry, gatal, bought, 9_500_000n);
  const ending = await balances();
  if (units(ending[identify(ustry)]) !== units(state.initialBalances[identify(ustry)]) ||
      units(ending[identify(circle)]) !== units(state.initialBalances[identify(circle)]) ||
      units(ending[identify(gatal)]) !== units(state.initialBalances[identify(gatal)]) - 10_000_000n + returned) {
    throw new Error('Round-trip balances do not reconcile');
  }
  Object.assign(report, { completed: true, initialBalances: state.initialBalances, finalBalances: ending,
    initialGatalUsdcSpent: '1.0000000', ustryAcquiredAndResold: quantity(bought), gatalUsdcReturned: quantity(returned),
    gatalUsdcRoundTripDifference: quantity(10_000_000n - returned), intermediateCircleUsdcBalanceUnchanged: true,
    finalUstryBalanceUnchanged: true, noUserFundingNeeded: true });
  save(); console.log(JSON.stringify({ completed: true, ustryBoughtAndResold: quantity(bought), gatalUsdcReturned: quantity(returned), finalBalances: ending }, null, 2));
}
main().catch(error => { save(); console.error(error.message); process.exitCode = 1; });
