// Read-only. Captures every mainnet ledger entry that RedStone's SEP-40 USTRY reads touch, plus
// the USTRY SAC, so `spield-ustry-series` can be tested against the provider's real code and
// state (`cargo test -p spield-ustry-series --features fork-tests`).
//
// Usage: node fetch_redstone_fork.mjs [out]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Account, Address, Keypair, Contract, Networks, TransactionBuilder, nativeToScVal, rpc, xdr } from '@stellar/stellar-sdk';
import { USTRY } from './ustry_oracle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? path.join(here, '../contracts/ustry-series/fixtures/redstone-mainnet.txt');
const server = new rpc.Server(process.env.MAINNET_RPC ?? 'https://mainnet.sorobanrpc.com');
const passphrase = Networks.PUBLIC;
const reader = 'GCXYXZHRDYGY56JTAQX4EKURGGJLIW2RSIMFADVS5BDK3AT6GZWPLUFY'; // RedStone owner; any funded account works

const net = await server.getNetwork();
if (net.passphrase !== passphrase) throw new Error('Not Stellar mainnet');
const asset = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Stellar'), new Address(USTRY.token).toScVal()]);
const calls = [
  [USTRY.sep40, 'base', []],
  [USTRY.sep40, 'decimals', []],
  [USTRY.sep40, 'lastprice', [asset]],
  [USTRY.sep40, 'prices', [asset, nativeToScVal(32, { type: 'u32' })]],
  [USTRY.token, 'decimals', []],
];
const keys = new Map();
for (const [id, method, args] of calls) {
  const tx = new TransactionBuilder(new Account(reader, '0'), { fee: '100', networkPassphrase: passphrase })
    .addOperation(new Contract(id).call(method, ...args))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${method}: ${sim.error}`);
  const data = sim.transactionData;
  for (const k of [...data.getReadOnly(), ...data.getReadWrite()]) keys.set(k.toXDR('base64'), k);
}
// The issuer account lets the test mint USTRY through the real SAC; no read above touches it.
const issuer = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(USTRY.issuer).xdrAccountId() }));
keys.set(issuer.toXDR('base64'), issuer);
const entries = [];
const list = [...keys.values()];
for (let i = 0; i < list.length; i += 50) {
  const r = await server.getLedgerEntries(...list.slice(i, i + 50));
  for (const e of r.entries) entries.push(e);
}
const latest = await server.getLatestLedger();
const lines = [
  `# RedStone USTRY mainnet fork fixture. ${entries.length} entries.`,
  `sequence ${latest.sequence}`,
  `protocol ${latest.protocolVersion}`,
  `timestamp ${Math.floor(Date.now() / 1000)}`,
  `token ${USTRY.token}`,
  `oracle ${USTRY.sep40}`,
  // `val` is LedgerEntryData; the test wraps it with lastModified into a LedgerEntry.
  ...entries.map((e) => `entry ${e.key.toXDR('base64')} ${e.val.toXDR('base64')} ${e.liveUntilLedgerSeq ?? 0} ${e.lastModifiedLedgerSeq ?? 0}`),
];
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`wrote ${entries.length} entries at ledger ${latest.sequence} to ${out}`);
