// Independent, read-only public ledger audit of both new deployments.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Horizon, rpc, xdr } from '@stellar/stellar-sdk';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.join(root, 'research/ustry');
const app = JSON.parse(fs.readFileSync(path.join(folder, 'app-v1-execution.json'), 'utf8'));
const fixture = JSON.parse(
  fs.readFileSync(path.join(folder, 'app-final-adversarial-execution.json'), 'utf8'),
);
const frontend = JSON.parse(
  fs.readFileSync(path.join(folder, 'app-frontend-client-execution.json'), 'utf8'),
);
if (!frontend.completed) throw new Error('Actual frontend client round trips have not completed.');
const server = new rpc.Server('https://soroban-testnet.stellar.org');
const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
if (!fixture.stages.maturityAndRedemption?.tokensConserved)
  throw new Error('Adversarial fixture has not returned its tokens.');
if (BigInt(app.stages.genuineAssetRoundTrip.roundingUnits) > 1n)
  throw new Error('Unexpected app round-trip loss.');
async function retry(fn) {
  let last;
  for (let n = 0; n < 3; n++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
const hashes = [
  ...new Set(
    [...app.transactions, ...fixture.transactions, ...frontend.transactions].map((t) => t.hash),
  ),
];
const transactions = [];
for (const hash of hashes) {
  const t = await retry(() => horizon.transactions().transaction(hash).call());
  if (!t.successful) throw new Error('Failed transaction ' + hash);
  transactions.push({ hash, successful: true, ledger: t.ledger, feeChargedStroops: t.fee_charged });
}
const contracts = [];
const latest = await server.getLatestLedger();
for (const [key, wasm] of [
  ['series', 'spield_rwa.wasm'],
  ['oracle', 'spield_ustry_oracle.wasm'],
  ['receipt', 'spield_rwa_token.wasm'],
  ['pt', 'spield_rwa_token.wasm'],
  ['yt', 'spield_rwa_token.wasm'],
]) {
  const id = app.deployment[key];
  const entry = await retry(() =>
    server.getContractData(id, xdr.ScVal.scvLedgerKeyContractInstance()),
  );
  const executable = entry.val.value.val.value.executable;
  const onChainHash = Buffer.from(executable.wasmHash.toBytes()).toString('hex');
  const localHash = createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'target/wasm32v1-none/release', wasm)))
    .digest('hex');
  if (onChainHash !== localHash)
    throw new Error('Deployed WASM differs from release artifact: ' + key);
  const liveLedgers = entry.liveUntilLedgerSeq - latest.sequence;
  if (liveLedgers < Math.ceil((app.deployment.expiry - Date.now() / 1000) / 5))
    throw new Error('Contract lifetime does not cover maturity: ' + key);
  contracts.push({
    role: key,
    address: id,
    wasm,
    onChainHash,
    localHash,
    liveUntilLedgerSeq: entry.liveUntilLedgerSeq,
    remainingLedgers: liveLedgers,
    releaseArtifactMatches: true,
  });
}
const wallet = await retry(() => horizon.loadAccount(app.wallet));
const balances = wallet.balances
  .filter((b) => b.asset_type === 'native' || ['USTRY', 'USDC'].includes(b.asset_code))
  .map((b) => ({
    asset: b.asset_type === 'native' ? 'XLM' : b.asset_code + ':' + b.asset_issuer,
    balance: b.balance,
  }));
const result = {
  network: 'Stellar testnet',
  checkedAtUtc: new Date().toISOString(),
  transactionCount: transactions.length,
  transactions,
  contracts,
  balances,
  appRoundingUnits: app.stages.genuineAssetRoundTrip.roundingUnits,
  adversarialFixtureReturnedAllTokens: true,
  actualFrontendClientRoundTripsCompleted: true,
};
fs.writeFileSync(path.join(folder, 'app-v1-audit.json'), JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      transactionCount: transactions.length,
      allSuccessful: true,
      matchingReleaseArtifacts: contracts.length,
      allContractsLivePastMaturity: true,
      balances,
    },
    null,
    2,
  ),
);
