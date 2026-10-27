// Independent public-Horizon verification after the one-shot sandbox execution.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Horizon } from '@stellar/stellar-sdk';
const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../research/ustry');
const file = path.join(folder, 'sandbox-execution-2026-10-27.json');
const prototypeFile = path.join(folder, 'testnet-prototype-execution-2026-10-27.json');
const execution = JSON.parse(fs.readFileSync(file, 'utf8'));
const prototype = JSON.parse(fs.readFileSync(prototypeFile, 'utf8'));
const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
for (const name of ['onrampStatus', 'offrampStatus', 'ustryToUsdcStatus', 'usdcToUstryStatus']) {
  if (execution.stages[name]?.status !== 'completed') throw new Error(name + ' not completed');
}
if (!prototype.stages.maturityAndRedemption?.tokensConserved) throw new Error('Prototype maturity not completed');
if (execution.stages.existingUsdcCompatibility.accepted || execution.stages.existingUsdcCompatibility.supportedIssuerControlHttp !== 200) {
  throw new Error('Issuer compatibility evidence inconsistent');
}
const hashes = new Set([...execution.transactions, ...prototype.transactions].map(t => t.hash));
hashes.add(execution.stages.onrampDelivery.hash);
for (const stage of Object.values(execution.stages)) {
  for (const key of ['sendTransactionHash', 'receiveTransactionHash']) if (/^[a-f0-9]{64}$/.test(stage[key] ?? '')) hashes.add(stage[key]);
}
const verified = [];
for (const hash of hashes) {
  const t = await horizon.transactions().transaction(hash).call();
  if (!t.successful) throw new Error('Unsuccessful transaction: ' + hash);
  verified.push({ hash, successful: true, ledger: t.ledger, createdAt: t.created_at, feeChargedStroops: t.fee_charged });
}
const account = await horizon.loadAccount(execution.wallet);
execution.finalBalances = account.balances.filter(b => b.asset_type === 'native' || ['USDC', 'USTRY'].includes(b.asset_code))
  .map(b => ({ asset: b.asset_type === 'native' ? 'XLM' : b.asset_code + ':' + b.asset_issuer, balance: b.balance }));
execution.horizonTransactionVerification = verified;
execution.validation = { allFourProviderFlowsCompleted: true, prototypeTokensConserved: true,
  independentlyVerifiedTransactionCount: verified.length, checkedAtUtc: new Date().toISOString() };
fs.writeFileSync(file, JSON.stringify(execution, null, 2) + '\n');
console.log(JSON.stringify({ ...execution.validation, finalBalances: execution.finalBalances }, null, 2));
