#!/usr/bin/env node
// Read-only mainnet discovery and evidence capture. No keys, signing, or transaction submission.
// node scripts/probe_ustry_oracle.mjs --out research/ustry/oracle-observation.json
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  Account, BASE_FEE, Contract, TransactionBuilder, rpc, scValToNative, nativeToScVal, xdr,
} from '@stellar/stellar-sdk';
import { USTRY, PROBE_POLICY, assessObservation } from './ustry_oracle.mjs';

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`Missing --${name} value`);
  return argv[index + 1];
}
const rpcUrl = arg('rpc', 'https://mainnet.sorobanrpc.com');
const outputPath = arg('out', null);
const stringify = (value) => JSON.stringify(value, (_, x) => typeof x === 'bigint' ? x.toString() : x, 2);
const normalize = (value) => JSON.parse(stringify(value));
const repository = 'redstone-finance/redstone-oracles-monorepo';
const deployment = 'packages/stellar-connector/deployments/stellarMultiFeed';
const server = new rpc.Server(rpcUrl);
// Public RPC endpoints can throttle bursts. All requests here are idempotent reads.
let activeRpc = 0;
const rpcQueue = [];
async function rpcRead(operation) {
  if (activeRpc >= 3) await new Promise(resolve => rpcQueue.push(resolve));
  activeRpc++;
  try {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await operation(); } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    throw lastError;
  } finally {
    activeRpc--;
    rpcQueue.shift()?.();
  }
}
const evidence = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  network: 'Public Global Stellar Network ; September 2015',
  rpcUrl,
  addresses: USTRY,
  policy: PROBE_POLICY,
  sources: [],
  calls: [],
  limitations: [
    'Separate simulations are not an atomic ledger snapshot.',
    'Issuer API response time and FX source timestamps do not establish an independently audited NAV effective time.',
    'Source commit and on-chain WASM hashes are recorded; reproducible bytecode/source matching is not established.',
    'Current observation and bounded history do not establish future liveness or a redemption guarantee.',
    'Exact upstream USTRY price methodology and issuer/PT-YT access require provider confirmation.',
  ],
};

async function getText(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Spield-readonly-USTRY-feasibility' },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      evidence.sources.push({ url, retrievedAt: new Date().toISOString(), sha256: createHash('sha256').update(body).digest('hex') });
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw new Error(`${url}: ${lastError.message} (${lastError.cause?.code ?? 'request error'})`);
}

async function read(contractId, method, args = []) {
  const tx = new TransactionBuilder(new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0'), {
    fee: BASE_FEE, networkPassphrase: evidence.network,
  }).addOperation(new Contract(contractId).call(method, ...args)).setTimeout(30).build();
  const result = await rpcRead(() => server.simulateTransaction(tx));
  if (rpc.Api.isSimulationError(result) || !result.result?.retval) throw new Error(`${method}: ${result.error ?? 'missing result'}`);
  const value = normalize(scValToNative(result.result.retval));
  evidence.calls.push({ contractId, method, argsXdr: args.map(a => a.toXDR('base64')), latestLedger: result.latestLedger,
    retrievedAt: new Date().toISOString(), resultXdr: result.result.retval.toXDR('base64'), value });
  return value;
}

async function instance(contractId) {
  const entry = await rpcRead(() => server.getContractData(contractId, xdr.ScVal.scvLedgerKeyContractInstance()));
  const data = entry.val.value.val.value;
  const executable = data.executable;
  return {
    contractId,
    wasmHash: executable.type === 'contractExecutableWasm' ? executable.wasmHash.toString('hex') : null,
    lastModifiedLedgerSeq: entry.lastModifiedLedgerSeq,
    liveUntilLedgerSeq: entry.liveUntilLedgerSeq,
    storage: data.storage?.map(item => ({ key: normalize(scValToNative(item.key)), value: normalize(scValToNative(item.val)) })),
    ledgerEntryXdr: entry.val.toXDR('base64'),
  };
}

try {
  const network = await rpcRead(() => server.getNetwork());
  if (network.passphrase !== evidence.network) throw new Error('RPC is not Stellar public mainnet');
  evidence.networkConfiguration = network;
  const commit = JSON.parse(await getText(`https://api.github.com/repos/${repository}/commits/main`)).sha;
  evidence.providerSourceCommit = commit;
  const raw = `https://raw.githubusercontent.com/${repository}/${commit}/`;
  const files = [
    `${deployment}/redstone_price_feed-USTRY-id.mainnet`,
    `${deployment}/redstone_adapter-id.mainnet`,
    `${deployment}/redstone_sep_40-id.mainnet`,
    'packages/relayer-remote-config/main/relayer-manifests-non-evm/stellarMultiFeed.json',
    'packages/relayer-remote-config/main/relayer-manifests-non-evm/stellarSep40.json',
  ];
  const providerFiles = await Promise.all(files.map(file => getText(raw + file)));
  for (const [index, expected] of [USTRY.feed, USTRY.adapter, USTRY.sep40].entries()) {
    if (providerFiles[index].trim() !== expected) throw new Error(`Provider deployment changed: ${files[index]}`);
  }
  const manifest = JSON.parse(providerFiles[3]);
  const sepManifest = JSON.parse(providerFiles[4]);
  if (manifest.chain?.name !== 'stellar-mainnet' || manifest.adapterContract !== USTRY.adapter ||
      manifest.priceFeeds?.USTRY?.priceFeedAddress !== USTRY.feed || sepManifest.adapterContract !== USTRY.sep40 ||
      sepManifest.priceFeeds?.USTRY?.priceFeedAddress !== USTRY.sep40) throw new Error('Provider manifest identity mismatch');
  evidence.providerConfiguration = {
    direct: manifest.priceFeeds.USTRY, sep40: sepManifest.priceFeeds.USTRY,
    dataServiceId: manifest.dataServiceId,
    note: 'Published relayer configuration is evidence of intended updates, not a contractual service guarantee.',
  };
  const asset = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Stellar'), new Contract(USTRY.token).address().toScVal()]);
  const settled = await Promise.allSettled([
    read(USTRY.feed, 'feed_id'), read(USTRY.feed, 'decimals'), read(USTRY.feed, 'read_price_data'),
    read(USTRY.sep40, 'base'), read(USTRY.sep40, 'decimals'), read(USTRY.sep40, 'resolution'),
    read(USTRY.sep40, 'assets'), read(USTRY.sep40, 'lastprice', [asset]),
    read(USTRY.sep40, 'prices', [asset, nativeToScVal(20, { type: 'u32' })]),
    Promise.all([USTRY.feed, USTRY.adapter, USTRY.sep40].map(instance)),
    rpcRead(() => server.getContractData(USTRY.sep40, xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('AssetToFeed'), asset]))),
  ]);
  const errors = settled.filter(r => r.status === 'rejected').map(r => r.reason?.message ?? String(r.reason));
  if (errors.length) throw new Error(errors.join('; '));
  const [feedId, directDecimals, direct, base, sep40Decimals, resolution, assets, latest, history,
    instances, mapping] = settled.map(r => r.value);
  const issuerCostBody = await getText('https://api.etherfuse.com/lookup/tokens/cost/ustry');
  const issuerAccountBody = await getText(`https://horizon.stellar.org/accounts/${USTRY.issuer}`);
  const assetBody = await getText(`https://horizon.stellar.org/assets?asset_code=USTRY&asset_issuer=${USTRY.issuer}`);
  const maxLedger = Math.max(...evidence.calls.map(call => call.latestLedger));
  const ledger = JSON.parse(await getText(`https://horizon.stellar.org/ledgers/${maxLedger}`));
  const mappedFeed = scValToNative(mapping.val.value.val);
  const identity = { feedId, directDecimals, sep40Decimals, base, resolution, token: USTRY.token, mappedFeed,
    assetListed: assets.some(a => a[0] === 'Stellar' && a[1] === USTRY.token) };
  const issuerCost = JSON.parse(issuerCostBody);
  evidence.issuerAccount = JSON.parse(issuerAccountBody);
  evidence.assetRecord = JSON.parse(assetBody)._embedded.records;
  if (evidence.assetRecord.length !== 1 || evidence.assetRecord[0].contract_id !== USTRY.token) throw new Error('Horizon token identity mismatch');
  if (evidence.issuerAccount.home_domain !== 'etherfuse.com') throw new Error('Issuer home domain mismatch');
  evidence.contractInstances = instances;
  evidence.ledger = { sequence: ledger.sequence, closedAt: ledger.closed_at, hash: ledger.hash };
  // Verify the historical lookup used to discuss maturity, without assuming interpolation.
  evidence.historicalLookup = latest ? await read(USTRY.sep40, 'price', [asset, nativeToScVal(latest.timestamp, { type: 'u64' })]) : null;
  if (latest && (evidence.historicalLookup?.price !== latest.price || evidence.historicalLookup?.timestamp !== latest.timestamp)) {
    throw new Error('Exact historical lookup does not reproduce the sampled observation');
  }
  evidence.observation = { identity, direct, sep40: latest, history, issuerCost,
    referenceTimeSeconds: Math.floor(Date.now() / 1000) };
  evidence.assessment = assessObservation(evidence.observation);
  evidence.completedAt = new Date().toISOString();
} catch (error) {
  evidence.assessment = { status: 'failed', failures: [error.message], productionApproved: false };
  evidence.completedAt = new Date().toISOString();
}
if (outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, stringify(evidence) + '\n');
}
console.log(stringify({ ...evidence.assessment, outputPath, addresses: USTRY, ledger: evidence.ledger }));
if (evidence.assessment.status === 'failed') process.exitCode = 2;
