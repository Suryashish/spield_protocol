import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Keypair, Networks, StrKey, rpc } from '@stellar/stellar-sdk';
import { build } from 'vite';
import { decodeFunctionData } from 'viem';

const outputDirectory = await mkdtemp(join(process.cwd(), '.cctp-test-'));

const expectedSources = {
  mainnet: [
    ['Ethereum', 1, 0, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', true],
    ['Base', 8453, 6, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', true],
    ['Arbitrum', 42161, 3, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', true],
    ['OP Mainnet', 10, 2, '0x0b2c639c533813f4aa9d7837caf62653d097ff85', true],
    ['Polygon', 137, 7, '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', false],
    ['Avalanche', 43114, 1, '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', false],
  ],
  testnet: [
    ['Ethereum Sepolia', 11155111, 0, '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', true],
    ['Avalanche Fuji', 43113, 1, '0x5425890298aed601595a70AB815c96711a31Bc65', false],
    ['OP Sepolia', 11155420, 2, '0x5fd84259d66Cd46123540766Be93DFE6D43130D7', true],
    ['Arbitrum Sepolia', 421614, 3, '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', true],
    ['Base Sepolia', 84532, 6, '0x036CbD53842c5426634e7929541eC2318f3dCF7e', true],
    ['Polygon Amoy', 80002, 7, '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582', false],
    ['Unichain Sepolia', 1301, 10, '0x31d0220469e10c4E71834a79b1f276d740d3768F', true],
    ['Linea Sepolia', 59141, 11, '0xFEce4462D57bD51A6A552365A011b95f0E16d9B7', true],
    ['Arc Testnet', 5042002, 26, '0x3600000000000000000000000000000000000000', false],
  ],
};

const burnAbi = [{
  type: 'function',
  name: 'depositForBurnWithHook',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'amount', type: 'uint256' },
    { name: 'destinationDomain', type: 'uint32' },
    { name: 'mintRecipient', type: 'bytes32' },
    { name: 'burnToken', type: 'address' },
    { name: 'destinationCaller', type: 'bytes32' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'minFinalityThreshold', type: 'uint32' },
    { name: 'hookData', type: 'bytes' },
  ],
  outputs: [],
}];

try {
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: 'src/lib/cctp.ts',
      outDir: outputDirectory,
      emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: 'cctp.mjs' } },
    },
  });
  const cctp = await import(`${pathToFileURL(join(outputDirectory, 'cctp.mjs')).href}?test=${Date.now()}`);
  const mainnet = cctp.getCctpConfig('mainnet');
  const testnet = cctp.getCctpConfig('testnet');

  assert.equal(mainnet.environment, 'mainnet');
  assert.equal(testnet.environment, 'testnet');
  assert.equal(mainnet.stellarNetwork, 'PUBLIC');
  assert.equal(testnet.stellarNetwork, 'TESTNET');
  assert.equal(mainnet.stellarPassphrase, Networks.PUBLIC);
  assert.equal(testnet.stellarPassphrase, Networks.TESTNET);
  assert.equal(mainnet.messenger.toLowerCase(), '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d');
  assert.equal(testnet.messenger.toLowerCase(), '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa');
  assert.ok(StrKey.isValidContract(mainnet.forwarder));
  assert.ok(StrKey.isValidContract(testnet.forwarder));

  for (const environment of ['mainnet', 'testnet']) {
    const config = cctp.getCctpConfig(environment);
    assert.deepEqual(
      config.sources.map(({ name, chainId, domain, usdc, fast }) =>
        [name, chainId, domain, usdc, fast]),
      expectedSources[environment],
    );
    assert.equal(new Set(config.sources.map(({ chainId }) => chainId)).size, config.sources.length);
    assert.equal(new Set(config.sources.map(({ domain }) => domain)).size, config.sources.length);
  }

  assert.equal(cctp.parseUsdcUnits('1.234567'), 1_234_567n);
  assert.equal(cctp.parseUsdcUnits('1.2345678'), 0n);
  assert.equal(cctp.calculateProtocolFee(1_000_000_000n, '1'), 100_000n);
  assert.equal(cctp.calculateProtocolFee(1_000_000_000n, '0.5'), 50_000n);
  assert.equal(cctp.addFeeBuffer(101n), 122n);
  assert.equal(cctp.CCTP_DESTINATION_DOMAIN, 27);

  const recipient = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(7)).publicKey();
  const source = testnet.sources[0];
  const calldata = cctp.buildBurnCalldata({
    config: testnet,
    source,
    amount: 1_500_000n,
    recipient,
    maxFee: 1_000n,
    finalityThreshold: cctp.FAST_FINALITY_THRESHOLD,
  });
  const decoded = decodeFunctionData({ abi: burnAbi, data: calldata });
  const args = decoded.args;
  const forwarderBytes = `0x${Buffer.from(StrKey.decodeContract(testnet.forwarder)).toString('hex')}`;
  assert.equal(args[0], 1_500_000n);
  assert.equal(args[1], 27);
  assert.equal(args[2], forwarderBytes);
  assert.equal(args[3].toLowerCase(), source.usdc.toLowerCase());
  assert.equal(args[4], forwarderBytes);
  assert.equal(args[5], 1_000n);
  assert.equal(args[6], cctp.FAST_FINALITY_THRESHOLD);
  const hook = Buffer.from(args[7].slice(2), 'hex');
  assert.equal(hook.readUInt32BE(24), 0);
  assert.equal(hook.readUInt32BE(28), Buffer.byteLength(recipient));
  assert.equal(hook.subarray(32).toString('utf8'), recipient);

  const switchCalls = [];
  let firstSwitch = true;
  await cctp.switchEvmNetwork({
    request: async ({ method, params }) => {
      switchCalls.push([method, params]);
      if (method === 'wallet_switchEthereumChain' && firstSwitch) {
        firstSwitch = false;
        throw Object.assign(new Error('unknown chain'), { code: 4902 });
      }
      return null;
    },
  }, testnet.sources[6]);
  assert.deepEqual(switchCalls.map(([method]) => method), [
    'wallet_switchEthereumChain',
    'wallet_addEthereumChain',
    'wallet_switchEthereumChain',
  ]);
  assert.equal(switchCalls[1][1][0].chainId, '0x515');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([
    { finalityThreshold: cctp.STANDARD_FINALITY_THRESHOLD, minimumFee: 0.25 },
  ]), { status: 200 });
  assert.equal(
    await cctp.fetchCircleFeeRate(testnet, 0, cctp.STANDARD_FINALITY_THRESHOLD),
    '0.25',
  );
  globalThis.fetch = async () => new Response(JSON.stringify({ messages: [{
    status: 'complete', message: '0x1234', attestation: '0xabcd',
  }] }), { status: 200 });
  assert.deepEqual(await cctp.getAttestation(testnet, source, '0xhash'), {
    status: 'complete', message: '0x1234', attestation: '0xabcd',
  });
  globalThis.fetch = originalFetch;

  if (process.argv.includes('--live')) {
    const rpcCall = async (url, method, params = []) => {
      let lastError;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            signal: AbortSignal.timeout(20_000),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const body = await response.json();
          if (body.error) throw new Error(body.error.message ?? JSON.stringify(body.error));
          return body.result;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 750));
        }
      }
      throw lastError;
    };

    for (const environment of ['mainnet', 'testnet']) {
      const config = cctp.getCctpConfig(environment);
      for (const sourceConfig of config.sources) {
        process.stdout.write(`LIVE ${environment.padEnd(7)} ${sourceConfig.name.padEnd(18)} `);
        try {
          const chainId = await rpcCall(sourceConfig.rpcUrl, 'eth_chainId');
          const messengerCode = await rpcCall(
            sourceConfig.rpcUrl,
            'eth_getCode',
            [config.messenger, 'latest'],
          );
          const usdcCode = await rpcCall(
            sourceConfig.rpcUrl,
            'eth_getCode',
            [sourceConfig.usdc, 'latest'],
          );
          const standardFee = await cctp.fetchCircleFeeRate(
            config,
            sourceConfig.domain,
            cctp.STANDARD_FINALITY_THRESHOLD,
          );
          const fastFee = sourceConfig.fast
            ? await cctp.fetchCircleFeeRate(
              config,
              sourceConfig.domain,
              cctp.FAST_FINALITY_THRESHOLD,
            )
            : null;
          assert.equal(Number.parseInt(chainId, 16), sourceConfig.chainId);
          assert.notEqual(messengerCode, '0x');
          assert.notEqual(usdcCode, '0x');
          assert.match(standardFee, /^\d+(\.\d+)?$/);
          if (sourceConfig.fast) assert.match(fastFee, /^\d+(\.\d+)?$/);
          console.log('chain/contracts/fees OK');
        } catch (error) {
          console.log(`FAILED (${error instanceof Error ? error.message : String(error)})`);
          throw error;
        }
      }

      const stellar = new rpc.Server(config.stellarRpc, { timeout: 20_000 });
      const [health, network, forwarder] = await Promise.all([
        stellar.getHealth(),
        stellar.getNetwork(),
        stellar.getContractInstance(config.forwarder),
      ]);
      assert.equal(health.status, 'healthy');
      assert.equal(network.passphrase, config.stellarPassphrase);
      assert.ok(forwarder.executable);
      console.log(`LIVE ${environment.padEnd(7)} Stellar RPC/network/forwarder OK`);
    }
  }

  console.log('CCTP tests passed: configuration, fees, calldata, hook encoding, network switching, and attestation.');
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}
