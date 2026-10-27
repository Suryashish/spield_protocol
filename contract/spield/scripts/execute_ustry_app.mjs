// Bounded genuine-USTRY app deployment and smoke test. TESTNET ONLY.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Address, BASE_FEE, Contract, Horizon, Keypair, Networks, TransactionBuilder, nativeToScVal, rpc, scValToNative } from '@stellar/stellar-sdk';
import { fetchNav, publicationDue } from './ustry_nav.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = '/tmp/spield_etherfuse_execution';
const journal = path.join(dir,'app-v1-final.json');
const evidenceFile = path.join(root,'research/ustry/app-v1-execution.json');
const wallet = 'GDXHBXYT23MUJWOKNZLTRBYJA2H6LDIL2DVHJCVITEFKQK5QUT2LPBJF';
const token = 'CCUGMX7HX6CH6T4XNPALQ7HCVU37RLUNHAYNSAIALTPFHFQVIRIHALBC';
const rpcUrl = 'https://soroban-testnet.stellar.org';
const server = new rpc.Server(rpcUrl);
const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
fs.mkdirSync(dir,{recursive:true,mode:0o700});
const state = fs.existsSync(journal) ? JSON.parse(fs.readFileSync(journal,'utf8')) : {};
const evidence = fs.existsSync(evidenceFile) ? JSON.parse(fs.readFileSync(evidenceFile,'utf8')) : { network:'Stellar testnet',wallet,token,stages:{},transactions:[],oracleMode:'issuer sandbox NAV, authenticated relay observations; not RedStone' };
const json = value => JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2);
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
    fs.writeFileSync(path.join(dir, 'app-error.json'), json(simulation), { mode: 0o600 });
    throw new Error(`${method}: simulation failed; diagnostic saved privately`);
  }
  if (expectedError !== undefined) throw new Error(`${method}: expected rejection did not occur`);
  if (view) return scValToNative(simulation.result.retval);
  const assembled = rpc.assembleTransaction(tx, simulation).build();
  assembled.sign(signer());
  const pendingHash = Buffer.from(assembled.hash()).toString('hex');
  state.pending = { contract, method, hash: pendingHash }; save();
  const sent = await server.sendTransaction(assembled);
  if (!['PENDING', 'DUPLICATE'].includes(sent.status)) throw new Error(`${method}: transaction not accepted (${sent.status})`);
  for (let n = 0; n < 30; n++) {
    const result = await server.getTransaction(sent.hash);
    if (result.status === 'SUCCESS') {
      const value = result.returnValue ? scValToNative(result.returnValue) : null;
      delete state.pending;
      evidence.transactions.push({ contract, method, hash: sent.hash, successful: true, returnValue: value });
      save(); return value;
    }
    if (result.status === 'FAILED') throw new Error(`${method}: submitted transaction failed`);
    await sleep(2000);
  }
  throw new Error(`${method}: submitted transaction confirmation pending; do not blindly replay`);
}
function deploy(wasm, constructorArgs) {
  const args = ['contract', 'deploy', '--wasm', path.join(root, 'target/wasm32v1-none/release', wasm),
    '--source-account', 'alice425', '--rpc-url', rpcUrl, '--network-passphrase', Networks.TESTNET, '--inclusion-fee', '100', '--', ...constructorArgs];
  const output = execFileSync('stellar', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 }).trim();
  const id = output.match(/C[A-Z2-7]{55}/)?.[0];
  if (!id) throw new Error('Deployment returned no contract ID');
  return id;
}

async function setup() {
  if (state.pending) throw new Error('Unresolved transaction '+state.pending.hash+'; inspect before replay');
  if (!state.expiry) { state.expiry = await ledgerTime()+14*86400; save(); }
  if (!state.oracle) {
    const nav = await fetchNav(); const timestamp = await ledgerTime();
    state.oracle = deploy('spield_ustry_oracle.wasm',['--admin',wallet,'--asset',token,'--price',String(nav.price),'--timestamp',String(timestamp),'--expiry',String(state.expiry)]);
    evidence.initialNav = nav; save();
  }
  if (!state.series) {
    state.series = deploy('spield_rwa.wasm',['--admin',wallet,'--asset',token,'--oracle',state.oracle,'--expiry',String(state.expiry),'--max_age','46800']); save();
  }
  for (const [kind,key,symbol] of [[0,'receipt','sUSTRY'],[1,'pt','PT-USTRY'],[2,'yt','YT-USTRY']]) {
    if (!state[key]) { state[key] = deploy('spield_rwa_token.wasm',['--series',state.series,'--kind',String(kind),'--name','Spield sandbox '+symbol,'--symbol',symbol]); save(); }
  }
  if (!state.bound) {
    const cfg = await call(state.series,'config',[],{view:true});
    if (!cfg.tokens.length) await call(state.series,'bind_tokens',[address(state.receipt),address(state.pt),address(state.yt)]);
    state.bound = true; save();
  }
  const deployment = {network:'testnet',series:state.series,oracle:state.oracle,receipt:state.receipt,pt:state.pt,yt:state.yt,asset:token,expiry:state.expiry,maxAge:46800,capUstry:1000};
  evidence.deployment=deployment; save();
  fs.writeFileSync(path.join(root,'../../frontend/src/lib/ustry-deployment.json'),json(deployment)+'\n');
  event('deployed',deployment);
}
async function smoke() {
  if (!state.bound || state.pending || state.smokeStarted) throw new Error('Not ready or smoke already started; inspect journal');
  state.smokeStarted=true; state.initialTokens=String(await call(token,'balance',[address(wallet)],{view:true})); save();
  await call(state.series,'deposit',[address(wallet),i128(1_000_000)]);
  await call(state.series,'withdraw_receipts',[address(wallet),i128(1_000_000)]);
  const face = await call(state.series,'deposit_split',[address(wallet),i128(1_000_000),i128(1)]);
  if (BigInt(await call(state.pt,'balance',[address(wallet)],{view:true})) !== BigInt(face)) throw new Error('Facade balance mismatch');
  // Self transfer exercises genuine facades without moving ownership to an unregistered wallet.
  await call(state.pt,'transfer',[address(wallet),address(wallet),i128(face)]);
  await call(state.yt,'transfer',[address(wallet),address(wallet),i128(face)]);
  const claim = await call(state.series,'claim_yield',[address(wallet)]);
  const paid = await call(state.series,'redeem',[address(wallet),i128(face),i128(999_990)]);
  const ending = await call(token,'balance',[address(wallet)],{view:true});
  const custody = await call(token,'balance',[address(state.series)],{view:true});
  // Conservative integer division can leave one unit (0.0000001 USTRY) in escrow.
  if (BigInt(state.initialTokens)-BigInt(ending)>1n || BigInt(custody)>1n) throw new Error('Custody did not reconcile');
  state.smokeDone=true; save();
  event('genuineAssetRoundTrip',{face,claim,paid,initialTokens:state.initialTokens,endingTokens:ending,custody,roundingUnits:BigInt(state.initialTokens)-BigInt(ending)});
}
async function relay() {
  if (!state.bound || state.pending) throw new Error('Missing deployment or pending transaction');
  const history = await call(state.oracle,'observations',[],{view:true});
  const last=history.at(-1); const now=await ledgerTime();
  if (Number(last.timestamp)>=state.expiry) { console.log('Series boundary already observed; relay retired.'); return; }
  const nav = await fetchNav();
  if (!publicationDue(last,nav.price,now,state.expiry)) { console.log('NAV healthy; next publication not yet due.'); return; }
  await call(state.oracle,'publish',[i128(nav.price),u64(now)]);
  evidence.lastNav=nav;save(); event('navPublished',{price:nav.price,timestamp:now});
}
const action=process.argv[2];
try {
  if(action==='setup') await setup();
  else if(action==='smoke') await smoke();
  else if(action==='relay') await relay();
  else throw new Error('Usage: node execute_ustry_app.mjs setup|smoke|relay');
} catch(error) { console.error(error.message);process.exitCode=1; }
