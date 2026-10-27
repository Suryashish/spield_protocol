// Runs the actual frontend client with its browser signer replaced only inside this
// temporary Node SSR harness. Keys are read into Node memory, never browser bundles.
// Read-only unless --execute is passed; maximum initial deposit is 0.05 test USTRY.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';
import { Address, Keypair, Networks, TransactionBuilder, Horizon } from '@stellar/stellar-sdk';
const execute = process.argv.includes('--execute');
const wallet = 'GDXHBXYT23MUJWOKNZLTRBYJA2H6LDIL2DVHJCVITEFKQK5QUT2LPBJF';
const folder = path.resolve('../contract/spield/research/ustry');
const journal = '/tmp/spield_etherfuse_execution/frontend-client.json';
const evidenceFile = path.join(folder, 'app-frontend-client-execution.json');
const state = fs.existsSync(journal) ? JSON.parse(fs.readFileSync(journal, 'utf8')) : {};
const evidence = {
  network: 'Stellar testnet',
  wallet,
  client: 'actual frontend USTRY client, SDK16; CLI signer in temporary Node SSR harness',
  transactions: [],
};
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2);
const temporary = await mkdtemp(path.join(process.cwd(), '.ustry-live-'));
const entry = path.join(temporary, 'entry.ts');
function save() {
  fs.writeFileSync(journal, json(state), { mode: 0o600 });
  fs.writeFileSync(evidenceFile, json(evidence) + '\n');
}
try {
  await writeFile(
    entry,
    `export * from '../src/lib/config';export * from '../src/lib/ustry';export * from '../src/lib/ustry-conversion';`,
  );
  await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'node-only-test-signer',
        load(id) {
          if (id.endsWith('/src/lib/stellar.ts'))
            return 'export const signWithWallet=(...args)=>globalThis.__ustryLiveSigner(...args);';
        },
      },
    ],
    resolve: { alias: { '@': path.resolve('src') } },
    define: {
      'import.meta.env.VITE_NETWORK': JSON.stringify('testnet'),
      'import.meta.env.VITE_RPC_URL_FALLBACK': JSON.stringify(''),
    },
    build: {
      ssr: true,
      outDir: path.join(temporary, 'out'),
      emptyOutDir: true,
      rollupOptions: { input: entry, output: { entryFileNames: 'entry.mjs' } },
    },
  });
  const app = await import(pathToFileURL(path.join(temporary, 'out/entry.mjs')));
  const series = app.getSeriesById('testnet-ustry-1');
  app.setActiveSeriesId(series.id);
  const before = await app.readUstry(series, wallet);
  assert.equal(before.syncError, null);
  assert.ok(before.navAvailable);
  assert.ok(!before.paused);
  if (!execute) {
    console.log(
      json({
        readOnly: true,
        series: series.ustry.series,
        nav: before.latest,
        walletTokens: before.wallet,
        holding: before.holding,
      }),
    );
  } else {
    if (state.started)
      throw new Error('Live client test already started; inspect the journal before any replay.');
    assert.ok(before.wallet >= 500000n);
    assert.equal(before.holding.pt, 0n);
    assert.equal(before.holding.yt, 0n);
    assert.equal(before.holding.receipt, 0n);
    state.started = true;
    save();
    evidence.series = series.ustry.series;
    evidence.before = before;
    save();
    globalThis.__ustryLiveSigner = async (envelope, options) => {
      assert.equal(options.address, wallet);
      assert.equal(options.networkPassphrase, Networks.TESTNET);
      const tx = TransactionBuilder.fromXDR(envelope, Networks.TESTNET);
      assert.equal(tx.source, wallet);
      assert.equal(tx.operations.length, 1);
      assert.ok(BigInt(tx.fee) < 200000000n);
      const op = tx.operations[0];
      if (op.type === 'invokeHostFunction') {
        const call = op.func.invokeContract();
        assert.equal(Address.fromScAddress(call.contractAddress()).toString(), series.ustry.series);
        assert.ok(
          ['deposit_split', 'claim_yield', 'redeem'].includes(call.functionName().toString()),
        );
      } else {
        assert.equal(op.type, 'pathPaymentStrictSend');
        assert.equal(op.source, wallet);
        assert.equal(op.destination, wallet);
        assert.ok(app.quantity(op.sendAmount) <= 2000000n);
        assert.ok(app.quantity(op.destMin) > 0n);
        assert.ok(
          [app.GATAL_ISSUER, app.CIRCLE_ISSUER, app.USTRY_ISSUER].includes(op.sendAsset.issuer),
        );
        assert.ok(
          [app.GATAL_ISSUER, app.CIRCLE_ISSUER, app.USTRY_ISSUER].includes(op.destAsset.issuer),
        );
        assert.ok(
          op.path.length <= 1 &&
            op.path.every((a) => a.code === 'USDC' && a.issuer === app.CIRCLE_ISSUER),
        );
      }
      const secret = execFileSync('stellar', ['keys', 'secret', 'alice425'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      const signer = Keypair.fromSecret(secret);
      assert.equal(signer.publicKey(), wallet);
      tx.sign(signer);
      state.pendingHash = Buffer.from(tx.hash()).toString('hex');
      save();
      return { signedTxXdr: tx.toXDR() };
    };
    async function write(method, amount, minimum) {
      const tx = await app.writeUstry(series, wallet, method, amount, minimum);
      assert.equal(tx.hash, state.pendingHash);
      delete state.pendingHash;
      evidence.transactions.push({ method, hash: tx.hash, successful: true });
      save();
    }
    const face = (500000n * app.FACTOR_SCALE) / before.state.factor;
    await write('deposit_split', 500000n, (face * 9950n) / 10000n);
    const split = await app.readUstry(series, wallet);
    assert.equal(split.holding.pt, face);
    assert.equal(split.holding.yt, face);
    await write('claim_yield');
    await write('redeem', face, 499990n);
    const after = await app.readUstry(series, wallet);
    assert.equal(after.holding.pt, 0n);
    assert.equal(after.holding.yt, 0n);
    assert.ok(before.wallet - after.wallet <= 1n);
    assert.ok(after.custody - before.custody <= 1n);
    const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
    const ustry = app.swapAsset('USTRY', app.USTRY_ISSUER);
    for (const [label, issuer] of [
      ['gatal', app.GATAL_ISSUER],
      ['gbbd', app.CIRCLE_ISSUER],
    ]) {
      const usdc = app.swapAsset('USDC', issuer);
      const getBalance = async () => {
        const a = await horizon.loadAccount(wallet);
        return a.balances.find((b) => b.asset_code === 'USDC' && b.asset_issuer === issuer).balance;
      };
      const initialUsdc = app.quantity(await getBalance());
      const tokenBefore = (await app.readUstry(series, wallet)).wallet;
      const buyQuote = await app.conversionQuote(wallet, series.id, usdc, ustry, 1000000n);
      const buy = await app.executeConversion(wallet, buyQuote);
      assert.equal(buy.hash, state.pendingHash);
      delete state.pendingHash;
      evidence.transactions.push({
        method: label + '_usdc_to_ustry',
        hash: buy.hash,
        successful: true,
      });
      save();
      const acquired = (await app.readUstry(series, wallet)).wallet - tokenBefore;
      assert.ok(acquired > 0n && acquired <= 2000000n);
      const sellQuote = await app.conversionQuote(wallet, series.id, ustry, usdc, acquired);
      assert.ok(sellQuote.minimum >= 950000n);
      const sell = await app.executeConversion(wallet, sellQuote);
      assert.equal(sell.hash, state.pendingHash);
      delete state.pendingHash;
      evidence.transactions.push({
        method: 'ustry_to_' + label + '_usdc',
        hash: sell.hash,
        successful: true,
      });
      save();
      assert.equal((await app.readUstry(series, wallet)).wallet, tokenBefore);
      const endingUsdc = app.quantity(await getBalance());
      assert.ok(initialUsdc - endingUsdc <= 50000n);
      evidence[label + 'RoundTrip'] = {
        sourceIssuer: issuer,
        sourceUnits: '1000000',
        ustryUnits: acquired,
        sourceRoundTripDifference: initialUsdc - endingUsdc,
        ustryBalanceRestored: true,
      };
      save();
    }
    state.completed = true;
    evidence.completed = true;
    evidence.after = after;
    evidence.roundingUnits = before.wallet - after.wallet;
    save();
    console.log(
      json({
        completed: true,
        series: series.ustry.series,
        depositUstry: '0.05',
        roundingUnits: evidence.roundingUnits,
        hashes: evidence.transactions.map((t) => t.hash),
      }),
    );
  }
} finally {
  delete globalThis.__ustryLiveSigner;
  await rm(temporary, { recursive: true, force: true });
}
