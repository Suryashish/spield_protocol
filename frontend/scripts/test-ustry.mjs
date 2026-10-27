import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import {
  Account,
  TransactionBuilder,
  Address,
  Horizon,
  Networks,
  SorobanDataBuilder,
  StrKey,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';
const temporary = await mkdtemp(join(process.cwd(), '.ustry-test-'));
const wallet = 'GDXHBXYT23MUJWOKNZLTRBYJA2H6LDIL2DVHJCVITEFKQK5QUT2LPBJF';
const entry = join(temporary, 'entry.ts');
await writeFile(
  entry,
  `export * from '../src/lib/config';export * from '../src/lib/ustry';export * from '../src/lib/ustry-conversion';export {server,writeContract} from '../src/lib/soroban';`,
);
try {
  for (const network of ['testnet', 'mainnet']) {
    const out = join(temporary, network);
    await build({
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@': join(process.cwd(), 'src') } },
      plugins: [
        {
          name: 'test-wallet',
          load(id) {
            if (id.endsWith('/src/lib/stellar.ts'))
              return `export const signWithWallet=(...args)=>globalThis.__ustrySigner(...args);`;
          },
        },
      ],
      define: {
        'import.meta.env.VITE_NETWORK': JSON.stringify(network),
        'import.meta.env.VITE_SR': JSON.stringify('__test_override__'),
        'import.meta.env.VITE_RPC_URL_FALLBACK': JSON.stringify(''),
      },
      build: {
        ssr: true,
        outDir: out,
        emptyOutDir: true,
        rollupOptions: { input: entry, output: { entryFileNames: 'entry.mjs' } },
      },
    });
    const app = await import(pathToFileURL(join(out, 'entry.mjs')));
    const ustry = app.getSeriesById('testnet-ustry-1');
    assert.ok(ustry);
    assert.equal(ustry.source, 'ustry');
    assert.equal(ustry.contracts, undefined);
    for (const id of ['series', 'oracle', 'receipt', 'pt', 'yt', 'asset'])
      assert.ok(StrKey.isValidContract(ustry.ustry[id]));
    assert.equal(
      new Set(['series', 'oracle', 'receipt', 'pt', 'yt', 'asset'].map((k) => ustry.ustry[k])).size,
      6,
    );
    if (network === 'mainnet') {
      assert.ok(app.getSeriesForNetwork('mainnet').every((s) => s.source === 'blend'));
      const initial = app.getActiveSeriesId();
      app.setActiveSeriesId(ustry.id);
      assert.equal(app.getActiveSeriesId(), initial);
      assert.throws(() => app.ustryContracts(ustry), /only for Stellar testnet/);
      continue;
    }
    assert.equal(app.quantity('1.0000001'), 10000001n);
    assert.equal(app.quantity('12345678901234567.1234567'), 123456789012345671234567n);
    for (const invalid of ['0', '-1', '1e3', '1.00000001', '.1', '1.', 'NaN', ''])
      assert.throws(() => app.quantity(invalid));
    assert.equal(app.units(10000001n), '1.0000001');
    assert.equal(app.units(-1n), '-0.0000001');
    assert.equal(app.getActiveSrContracts().sr, '__test_override__');
    app.setActiveSeriesId('testnet-series-1');
    assert.equal(app.getActiveSrContracts().sr, app.getSeriesById('testnet-series-1').contracts.sr);
    app.setActiveSeriesId(ustry.id);
    assert.throws(() => app.getActiveSrContracts(), /unavailable for this source/);
    const revision = app.getActiveSeriesRevision();
    app.setActiveSeriesId('testnet-series-2');
    app.setActiveSeriesId(ustry.id);
    assert.ok(app.getActiveSeriesRevision() > revision);
    const c = ustry.ustry;
    const observation = { price: 110000000n, timestamp: BigInt(Math.floor(Date.now() / 1000)) };
    const state = {
      high_water: 110000000n,
      factor: 909090909090909091n,
      cursor: 1,
      last_observation: observation,
      finalized: false,
      receipts: 0n,
      face: 0n,
      backing: 0n,
      total_yt: 0n,
    };
    let wrongIdentity = false;
    let brokenSync = false;
    let offlineOracle = false;
    app.server.simulateTransaction = async (tx) => {
      const call = tx.operations[0].func.invokeContract();
      const method = call.functionName().toString();
      if ((method === 'observations' && offlineOracle) || (method === 'sync' && brokenSync))
        return { error: 'HostError: Error(Contract, #9)' };
      const values = {
        config: {
          asset: wrongIdentity ? c.pt : c.asset,
          oracle: c.oracle,
          expiry: BigInt(ustry.expiry),
          max_age: 46800n,
          paused: false,
          tokens: [c.receipt, c.pt, c.yt],
        },
        state,
        sync: state,
        observations: [observation],
        balance: 0n,
      };
      return { result: { retval: nativeToScVal(values[method]) } };
    };
    const snapshot = await app.readUstry(ustry, null);
    assert.equal(snapshot.latest.price, 110000000n);
    assert.equal(snapshot.syncError, null);
    brokenSync = true;
    assert.match((await app.readUstry(ustry, null)).syncError, /#9/);
    offlineOracle = true;
    state.finalized = true;
    const settled = await app.readUstry(ustry, null);
    assert.equal(settled.navAvailable, false);
    assert.equal(settled.syncError, null);
    assert.equal(settled.settledOnChain, true);
    state.finalized = false;
    offlineOracle = false;
    wrongIdentity = true;
    await assert.rejects(app.readUstry(ustry, null), /identity differs/);
    assert.equal(
      app.entitlement({ factor: 1000000000000000000n, yt: 10000000n, accrued: 2n }, state),
      909092n,
    );
    const source = app.swapAsset('USDC', app.GATAL_ISSUER),
      destination = app.swapAsset('USTRY', app.USTRY_ISSUER);
    Horizon.Server.prototype.strictSendPaths = () => ({
      call: async () => ({
        records: [
          {
            source_asset_code: 'USDC',
            source_asset_issuer: app.GATAL_ISSUER,
            destination_asset_code: 'USTRY',
            destination_asset_issuer: app.USTRY_ISSUER,
            source_amount: '1.0000000',
            destination_amount: '1.5000000',
            path: [{ asset_code: 'USDC', asset_issuer: app.CIRCLE_ISSUER }],
          },
        ],
      }),
    });
    const quote = await app.conversionQuote(wallet, ustry.id, source, destination, 10000000n);
    assert.equal(quote.minimum, 14850000n);
    assert.equal(quote.path[0].issuer, app.CIRCLE_ISSUER);
    app.setActiveSeriesId('testnet-series-2');
    app.setActiveSeriesId(ustry.id);
    await assert.rejects(app.executeConversion(wallet, quote), /expired or selection changed/);
    const fresh = await app.conversionQuote(wallet, ustry.id, source, destination, 10000000n);
    fresh.expires = Date.now() - 1;
    await assert.rejects(app.executeConversion(wallet, fresh), /expired/);
    Horizon.Server.prototype.strictSendPaths = () => ({ call: async () => ({ records: [] }) });
    await assert.rejects(
      app.conversionQuote(wallet, ustry.id, source, destination, 10000000n),
      /No executable/,
    );
    await assert.rejects(app.writeUstry(ustry, wallet, 'unknown'), /Unsupported/);
    // Actual writeContract pipeline, with RPC and signer fixture: changing away and back
    // during the wallet prompt must still prevent submission.
    let sends = 0;
    let sequence = 100;
    rpc.Server.prototype.getAccount = async () => new Account(wallet, String(sequence++));
    rpc.Server.prototype.getFeeStats = async () => ({ sorobanInclusionFee: { p90: '100' } });
    rpc.Server.prototype.simulateTransaction = async () => ({
      _parsed: true,
      id: '1',
      latestLedger: 1,
      minResourceFee: '100',
      transactionData: new SorobanDataBuilder(),
      result: { auth: [], retval: nativeToScVal(null) },
      events: [],
    });
    rpc.Server.prototype.sendTransaction = async () => {
      sends++;
      throw new Error('Submission must not happen');
    };
    globalThis.__ustrySigner = async (xdr) => {
      app.setActiveSeriesId('testnet-series-2');
      app.setActiveSeriesId(ustry.id);
      return { signedTxXdr: xdr };
    };
    await assert.rejects(
      app.writeContract(wallet, c.series, 'claim_yield', [new Address(wallet).toScVal()]),
      /Series changed while signing/,
    );
    assert.equal(sends, 0);
    globalThis.__ustrySigner = async (envelope) => {
      const tx = TransactionBuilder.fromXDR(envelope, Networks.TESTNET);
      const changed = TransactionBuilder.cloneFrom(tx, { fee: '999999' }).build();
      return { signedTxXdr: changed.toXDR() };
    };
    await assert.rejects(
      app.writeContract(wallet, c.series, 'claim_yield', [new Address(wallet).toScVal()]),
      /Wallet changed the requested transaction/,
    );
    assert.equal(sends, 0);
  }
  console.log(
    'PASS: exact amounts, contract identity, Blend override isolation, network gating, source revision guards, stale sync handling, issuer-specific paths, slippage minimums, expired quotes and pre-broadcast cancellation.',
  );
} finally {
  delete globalThis.__ustrySigner;
  await rm(temporary, { recursive: true, force: true });
}
