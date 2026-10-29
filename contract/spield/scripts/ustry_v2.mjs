// Shared plumbing for the USTRY v2 stack (spield-ustry-series + SEP-40 feed).
// Keys are never in code: a signer is either an S… secret in an environment variable or a named
// `stellar keys` identity on the operator machine.
import { execFileSync } from 'node:child_process';
import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

export const PROFILES = Object.freeze({
  testnet: {
    rpc: 'https://soroban-testnet.stellar.org',
    passphrase: Networks.TESTNET,
    reader: 'GDXHBXYT23MUJWOKNZLTRBYJA2H6LDIL2DVHJCVITEFKQK5QUT2LPBJF', // any funded account; simulation only
    // Etherfuse sandbox USTRY (issuer GC3CW7…) — no RedStone feed exists for it.
    asset: 'CCUGMX7HX6CH6T4XNPALQ7HCVU37RLUNHAYNSAIALTPFHFQVIRIHALBC',
    oracle: null, // deployed: spield-ustry-nav
    params: { max_age: 46_800, grace: 3 * 86_400, max_apr_bps: 2_000, cap: '10000000000', window: 16 },
    nav: { min_interval: 3_600, max_move_bps: 500 },
    term: 30 * 86_400,
  },
  mainnet: {
    rpc: 'https://mainnet.sorobanrpc.com',
    passphrase: Networks.PUBLIC,
    reader: 'GCXYXZHRDYGY56JTAQX4EKURGGJLIW2RSIMFADVS5BDK3AT6GZWPLUFY', // any funded account; simulation only
    // Genuine USTRY SAC and RedStone's SEP-40 wrapper, as verified in research/ustry/README.md.
    asset: 'CBLV4ATSIWU67CFSQU2NVRKINQIKUZ2ODSZBUJTJ43VJVRSBTZYOPNUR',
    oracle: 'CBMGLKUQZVSAIL5CPDDAWSUY7MAKXISHMOZEVLMBUWBMFGHRJSR4WYRF',
    params: { max_age: 46_800, grace: 7 * 86_400, max_apr_bps: 2_000, cap: '10000000000', window: 16 },
    nav: null,
    term: 30 * 86_400,
  },
});

export function profile(network) {
  const p = PROFILES[network];
  if (!p) throw new Error(`Unknown network "${network}" (testnet | mainnet)`);
  return p;
}

/** `env:NAME` reads an S… secret from the environment; anything else is a `stellar keys` name. */
export function keypair(spec) {
  if (!spec) throw new Error('No signer given');
  if (spec.startsWith('env:')) {
    const secret = process.env[spec.slice(4)];
    if (!secret) throw new Error(`Environment variable ${spec.slice(4)} is empty`);
    return Keypair.fromSecret(secret.trim());
  }
  const secret = execFileSync('stellar', ['keys', 'secret', spec], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return Keypair.fromSecret(secret);
}

export const address = (v) => new Address(v).toScVal();
export const i128 = (v) => nativeToScVal(BigInt(v), { type: 'i128' });
export const u64 = (v) => nativeToScVal(BigInt(v), { type: 'u64' });
export const u32 = (v) => nativeToScVal(Number(v), { type: 'u32' });
/** SEP-40 `Asset::Stellar(address)`. */
export const stellarAsset = (v) =>
  xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Stellar'), new Address(v).toScVal()]);
export const json = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function client(network) {
  const p = profile(network);
  const server = new rpc.Server(p.rpc);
  async function checkNetwork() {
    const n = await server.getNetwork();
    if (n.passphrase !== p.passphrase) throw new Error(`RPC ${p.rpc} is not ${network}`);
  }
  async function view(contract, method, args = [], source) {
    await checkNetwork();
    const tx = new TransactionBuilder(new Account(source ?? p.reader, '0'), {
      fee: '100',
      networkPassphrase: p.passphrase,
    })
      .addOperation(new Contract(contract).call(method, ...args))
      .setTimeout(60)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`${method}: ${sim.error.split('\n')[0]}`);
    return sim.result ? scValToNative(sim.result.retval) : undefined;
  }
  /** Simulate, sign, submit and wait. Returns { hash, value }. Never replays an uncertain send. */
  async function send(kp, contract, method, args = []) {
    await checkNetwork();
    const source = await server.getAccount(kp.publicKey());
    const tx = new TransactionBuilder(source, { fee: '1000', networkPassphrase: p.passphrase })
      .addOperation(new Contract(contract).call(method, ...args))
      .setTimeout(120)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`${method}: ${sim.error.split('\n')[0]}`);
    const ready = rpc.assembleTransaction(tx, sim).build();
    ready.sign(kp);
    const sent = await server.sendTransaction(ready);
    if (!['PENDING', 'DUPLICATE'].includes(sent.status))
      throw new Error(`${method}: not accepted (${sent.status})`);
    for (let n = 0; n < 40; n++) {
      const r = await server.getTransaction(sent.hash);
      if (r.status === 'SUCCESS')
        return { hash: sent.hash, value: r.returnValue ? scValToNative(r.returnValue) : null };
      if (r.status === 'FAILED') throw new Error(`${method}: transaction ${sent.hash} failed`);
      await sleep(1500);
    }
    throw new Error(`${method}: ${sent.hash} still unconfirmed — check it before retrying`);
  }
  async function ledgerTime() {
    const l = await server.getLatestLedger();
    const tx = await fetch(
      network === 'testnet'
        ? `https://horizon-testnet.stellar.org/ledgers/${l.sequence}`
        : `https://horizon.stellar.org/ledgers/${l.sequence}`,
    ).then((r) => r.json());
    return Math.floor(Date.parse(tx.closed_at) / 1000);
  }
  return { server, view, send, ledgerTime, profile: p };
}
