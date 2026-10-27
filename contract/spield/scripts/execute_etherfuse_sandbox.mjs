// Authorized sandbox execution only. No production host/network is configurable.
// Provider IDs and unsigned transactions stay in a mode-0600 temporary journal.
// Secrets are read in memory only and never included in the public evidence.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { inspectProviderTransaction } from './etherfuse_sandbox_tx.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE = '/tmp/spield_etherfuse_execution';
const JOURNAL = path.join(PRIVATE, 'state.json');
const EVIDENCE = path.join(ROOT, 'research/ustry/sandbox-execution-2026-10-27.json');
export const WALLET = 'GDXHBXYT23MUJWOKNZLTRBYJA2H6LDIL2DVHJCVITEFKQK5QUT2LPBJF';
export const USDC = 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export const USTRY = 'USTRY:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4';
const OTHER_USDC = 'USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
const HOST = 'https://api.sand.etherfuse.com';
const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
fs.mkdirSync(PRIVATE, { recursive: true, mode: 0o700 });
const state = fs.existsSync(JOURNAL) ? JSON.parse(fs.readFileSync(JOURNAL, 'utf8')) : {};
const evidence = fs.existsSync(EVIDENCE) ? JSON.parse(fs.readFileSync(EVIDENCE, 'utf8')) : {
  environment: 'Etherfuse sandbox / Stellar testnet', wallet: WALLET,
  localIdentity: 'alice425', realMoneyMoved: false, stages: {}, transactions: [],
};
function save() {
  fs.writeFileSync(JOURNAL, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.chmodSync(JOURNAL, 0o600);
  evidence.updatedAtUtc = new Date().toISOString();
  fs.writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
}
function event(stage, data) {
  evidence.stages[stage] = data;
  save();
  console.log(JSON.stringify({ stage, ...data }));
}
function key() {
  const line = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .find(s => /^\s*(?:export\s+)?etherfusekey\s*=/i.test(s));
  if (!line) throw new Error('Missing sandbox API credential');
  let value = line.slice(line.indexOf('=') + 1).trim();
  if (value.startsWith('"') || value.startsWith("'")) value = value.slice(1, value.indexOf(value[0], 1));
  else value = value.split(' #')[0].trim();
  if (!value) throw new Error('Empty sandbox API credential');
  return value;
}
const apiKey = key();
async function api(route, body, method) {
  if (!/^\/ramp\/(?:me|wallets?|assets|quote|order(?:s|\/[^?]+)?|bank-accounts|customer\/[0-9a-f-]+\/bank-account|ws-api-token|swap(?:\/[^?]+)?)(?:\?.*)?$/.test(route)) {
    throw new Error('Endpoint not allowed by sandbox executor');
  }
  const response = await fetch(HOST + route, {
    method: method ?? (body === undefined ? 'GET' : 'POST'), redirect: 'error',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25_000),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { nonJson: true, diagnostic: text }; }
  return { status: response.status, data };
}
function requireSuccess(response, label) {
  if (response.status < 200 || response.status >= 300) {
    fs.writeFileSync(path.join(PRIVATE, 'last-error.json'), JSON.stringify(response), { mode: 0o600 });
    throw new Error(`${label}: HTTP ${response.status}; diagnostic saved privately`);
  }
  return response.data;
}
function signer() {
  // Capture stdout; do not print or persist the secret returned by the CLI.
  const secret = execFileSync('stellar', ['keys', 'secret', 'alice425'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const pair = Keypair.fromSecret(secret);
  if (pair.publicKey() !== WALLET) throw new Error('Local signer/address mismatch');
  return pair;
}
const asset = identifier => new Asset(...identifier.split(':'));
async function balances() {
  const account = await horizon.loadAccount(WALLET);
  return account.balances.filter(b => b.asset_type === 'native' || ['USDC', 'USTRY'].includes(b.asset_code))
    .map(b => ({ asset: b.asset_type === 'native' ? 'XLM' : `${b.asset_code}:${b.asset_issuer}`, balance: b.balance, authorized: b.is_authorized ?? true }));
}
async function account() {
  const data = requireSuccess(await api('/ramp/me'), 'Read organization');
  if (!data.id || !data.approvedAt) throw new Error('Approved sandbox organization required');
  state.organizationId = data.id;
  save();
  return data;
}
async function quote(source, target, amount, type = 'swap') {
  return api('/ramp/quote', { quoteId: randomUUID(), customerId: state.organizationId, blockchain: 'stellar',
    quoteAssets: { type, sourceAsset: source, targetAsset: target }, sourceAmount: amount, walletAddress: WALLET });
}
function quoteSummary(q) {
  return Object.fromEntries(['sourceAmount', 'destinationAmount', 'exchangeRate', 'feeAmount', 'feeBps', 'requiresSwap'].filter(k => q[k] !== undefined).map(k => [k, q[k]]));
}
async function setup() {
  await account();
  const discovery = requireSuccess(await api('/ramp/assets?blockchain=stellar&currency=usd&wallet=' + WALLET), 'Discover assets');
  for (const id of [USDC, USTRY]) {
    if (!discovery.assets?.some(a => a.identifier === id)) throw new Error('Expected sandbox asset missing from discovery');
  }
  const unsupported = await quote(OTHER_USDC, USTRY, '1');
  event('existingUsdcCompatibility', { issuer: OTHER_USDC, quoteHttp: unsupported.status, accepted: unsupported.status === 200 });
  const wallet = requireSuccess(await api('/ramp/wallet', { publicKey: WALLET, blockchain: 'stellar', claimOwnership: true }), 'Register org-owned wallet');
  if (wallet.publicKey !== WALLET || wallet.claimedOwnership !== true || !wallet.walletId) throw new Error('Wallet ownership/registration not confirmed');
  state.walletId = wallet.walletId;
  event('walletRegistration', { registered: true, organizationOwnershipClaimed: true, publicAddress: WALLET });
  const before = await balances();
  const missing = [USDC, USTRY].filter(id => !before.some(b => b.asset === id));
  if (missing.length) {
    const source = await horizon.loadAccount(WALLET);
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET });
    for (const id of missing) tx.addOperation(Operation.changeTrust({ asset: asset(id), limit: '1000' }));
    const built = tx.setTimeout(180).build();
    built.sign(signer());
    const result = await horizon.submitTransaction(built);
    evidence.transactions.push({ stage: 'trustlines', hash: result.hash, successful: result.successful, assets: missing });
  }
  event('walletSetup', { before, after: await balances() });
}
async function bank() {
  await account();
  if (state.bankAccountId) { event('bankSetup', { alreadyPrepared: true }); return; }
  state.bankRegistrationId ??= randomUUID();
  state.bankAccountIdCandidate ??= randomUUID();
  save();
  const result = requireSuccess(await api(`/ramp/customer/${state.organizationId}/bank-account`, {
    bankAccountId: state.bankAccountIdCandidate, label: 'Spield sandbox integration fixture',
    account: { transactionId: state.bankRegistrationId, name: 'Spield Sandbox Test', incorporatedDate: '20200101',
      // Synthetic checksum-valid test CLABE. The docs' 646/STP example is
      // rejected by the live sandbox; the placeholder RFC skips real registration.
      countryIsoCode: 'MX', rfc: 'XEX010101000', clabe: '012180000000000002' },
  }), 'Register sandbox fixture bank');
  if (!result.bankAccountId) throw new Error('Fixture bank registration returned no ID');
  state.bankAccountId = result.bankAccountId;
  event('bankSetup', { sandboxPlaceholderUsed: true, compliant: result.compliant, status: result.status });
}
async function onramp() {
  await account();
  if (!state.walletId || !state.bankAccountId) throw new Error('Complete setup and bank steps first');
  if (!state.onrampOrderId) {
    const q = requireSuccess(await quote('MXN', USTRY, '100', 'onramp'), 'Onramp quote');
    state.onrampOrderId = randomUUID(); state.onrampQuoteId = q.quoteId; save();
    const order = requireSuccess(await api('/ramp/order', { orderId: state.onrampOrderId, bankAccountId: state.bankAccountId,
      cryptoWalletId: state.walletId, quoteId: q.quoteId }), 'Create sandbox onramp');
    state.onrampOrder = order; save();
    event('onrampCreated', { status: order.status, simulatedMxn: '100', quote: quoteSummary(q) });
  }
  const current = requireSuccess(await api('/ramp/order/' + state.onrampOrderId), 'Read onramp');
  if (current.status === 'created') {
    requireSuccess(await api('/ramp/order/fiat_received', { orderId: state.onrampOrderId }), 'Simulate fiat receipt');
    event('sandboxFundsRequested', { simulatedMxn: '100', realMoneySent: false });
  }
  await inspectOrder('onramp');
}
async function inspectOrder(kind) {
  const id = state[kind + 'OrderId'];
  if (!id) throw new Error('No order recorded');
  const order = requireSuccess(await api('/ramp/order/' + id), 'Read order');
  state[kind + 'Order'] = order; save();
  event(kind + 'Status', { status: order.status, amountInTokens: order.amountInTokens, amountInFiat: order.amountInFiat,
    transactionHash: order.confirmedTxSignature ?? null, claimRequired: Boolean(order.stellarClaimTransaction),
    burnTransactionReady: Boolean(order.burnTransaction), balances: await balances() });
}
async function swap(directStream = false) {
  await account();
  const reverse = process.argv[3] === 'usdc-to-ustry';
  const name = reverse ? 'usdcToUstry' : 'ustryToUsdc';
  const source = reverse ? USDC : USTRY;
  const target = reverse ? USTRY : USDC;
  const amount = reverse ? '0.5' : '1';
  if (!directStream) throw new Error('Authenticated first-party stream required before creating swaps');
  if (!state[name + 'SwapId']) {
    const q = requireSuccess(await quote(source, target, amount), 'Swap quote');
    const id = randomUUID();
    state[name + 'SwapId'] = id; state[name + 'Quote'] = q; save();
    requireSuccess(await api('/ramp/swap', { orderId: id, quoteId: q.quoteId, publicKey: WALLET, blockchain: 'stellar' }), 'Create swap');
    event(name + 'Created', { amount, quote: quoteSummary(q) });
  }
  const filename = path.join(PRIVATE, 'swap-events.jsonl');
  const events = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const latest = events.filter(e => e.orderId === state[name + 'SwapId']).at(-1);
  if (!latest) { event(name + 'Status', { status: 'waiting_for_first_party_stream' }); return; }
  if (latest.sendTransaction && latest.status === 'pending' && !state[name + 'SentHash']) {
    const preview = TransactionBuilder.fromXDR(latest.sendTransaction, Networks.TESTNET);
    if (preview.timeBounds && Number(preview.timeBounds.maxTime) > 0 && Number(preview.timeBounds.maxTime) <= Math.floor(Date.now() / 1000) + 10) {
      requireSuccess(await api('/ramp/swap/' + state[name + 'SwapId'] + '/regenerate_tx', {}), 'Refresh expired swap transaction');
      event(name + 'Status', { status: 'waiting_for_refreshed_transaction' });
      return;
    }
    const quoted = state[name + 'Quote'].destinationAmount;
    const [whole, fraction = ''] = quoted.split('.');
    const minReceive = whole + '.' + fraction.padEnd(7, '0').slice(0, 7);
    const verifiedAtomic = evidence.transactions.find(t => t.stage === 'ustryToUsdcSend' && t.operations?.some(op => op.counterpartyPreSigned));
    const settlementCounterparty = verifiedAtomic?.operations.find(op => op.type === 'payment')?.destination;
    const { tx, summary } = inspectProviderTransaction(latest.sendTransaction, { wallet: WALLET, spendAsset: source, maxAmount: amount, receiveAsset: target, minReceive, settlementCounterparty });
    tx.sign(signer());
    const sent = await horizon.submitTransaction(tx);
    state[name + 'SentHash'] = sent.hash; save();
    evidence.transactions.push({ stage: name + 'Send', hash: sent.hash, successful: sent.successful, operations: summary });
  }
  event(name + 'Status', { status: latest.status, sendTransactionHash: latest.sendTransactionHash ?? state[name + 'SentHash'] ?? null,
    receiveTransactionHash: latest.receiveTransactionHash ?? null, balances: await balances() });
}
async function swapStream() {
  const token = requireSuccess(await api('/ramp/ws-api-token', {}), 'Create first-party stream token').token;
  if (!token) throw new Error('No first-party status token returned');
  const socket = new WebSocket('wss://api.sand.etherfuse.com/ramp/ws?token=' + encodeURIComponent(token));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('First-party stream open timeout')), 15_000);
    socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('First-party stream connection failed')); }, { once: true });
  });
  const inbox = [];
  const existingStream = path.join(PRIVATE, 'direct-stream.jsonl');
  const eventFile = path.join(PRIVATE, 'swap-events.jsonl');
  if (!fs.existsSync(eventFile) && fs.existsSync(existingStream)) {
    for (const line of fs.readFileSync(existingStream, 'utf8').split('\n').filter(Boolean)) {
      const prior = JSON.parse(line);
      if (prior.type === 'SwapUpdate' && prior.data?.swap) {
        fs.appendFileSync(eventFile, JSON.stringify(prior.data.swap) + '\n', { mode: 0o600 });
      }
    }
  }
  socket.addEventListener('message', message => {
    try {
      const value = JSON.parse(message.data);
      fs.appendFileSync(path.join(PRIVATE, 'direct-stream.jsonl'), JSON.stringify(value) + '\n', { mode: 0o600 });
      console.log(JSON.stringify({ event: 'first_party_stream', fields: Object.keys(value) }));
      const swapUpdate = value.swap_updated ?? (value.type === 'SwapUpdate' ? value.data?.swap : undefined);
      if (swapUpdate) {
        fs.appendFileSync(path.join(PRIVATE, 'swap-events.jsonl'), JSON.stringify(swapUpdate) + '\n', { mode: 0o600 });
        inbox.push(swapUpdate);
      }
    } catch { /* Ignore heartbeat frames that are not JSON. */ }
  });
  try {
    await swap(true);
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1_000));
      if (inbox.length) {
        const current = inbox.splice(0).at(-1);
        await swap(true);
        if (['completed', 'failed'].includes(current.status)) break;
      }
    }
    event('directStreamSwapAttempt', { streamConnected: true, thirdPartyTunnelUsed: false });
  } finally { socket.close(); }
}
async function offramp() {
  await account();
  if (!state.offrampOrderId) {
    const q = requireSuccess(await quote(USTRY, 'MXN', '1', 'offramp'), 'Offramp quote');
    const id = randomUUID();
    state.offrampOrderId = id; state.offrampQuote = q; save();
    state.offrampOrder = requireSuccess(await api('/ramp/order', { orderId: id, quoteId: q.quoteId,
      bankAccountId: state.bankAccountId, cryptoWalletId: state.walletId }), 'Create sandbox offramp');
    event('offrampCreated', { amount: '1 USTRY', quote: quoteSummary(q) });
  }
  const order = requireSuccess(await api('/ramp/order/' + state.offrampOrderId), 'Read offramp');
  state.offrampOrder = order; save();
  if (order.burnTransaction && !state.offrampSentHash && order.status === 'created') {
    const { tx, summary } = inspectProviderTransaction(order.burnTransaction, { wallet: WALLET, spendAsset: USTRY, maxAmount: '1' });
    tx.sign(signer());
    const result = await horizon.submitTransaction(tx);
    state.offrampSentHash = result.hash; save();
    evidence.transactions.push({ stage: 'offrampBurn', hash: result.hash, successful: result.successful, operations: summary });
  }
  await inspectOrder('offramp');
}
async function verifyUsdc() {
  await account();
  const other = await quote(OTHER_USDC, USTRY, '1');
  const accepted = await quote(USDC, USTRY, '1');
  event('existingUsdcCompatibility', { issuer: OTHER_USDC, quoteHttp: other.status, accepted: other.status === 200,
    registeredWalletRetested: true, supportedIssuerControlHttp: accepted.status });
}
async function main() {
  const step = process.argv[2];
  if (step === 'setup') await setup();
  else if (step === 'bank') await bank();
  else if (step === 'onramp') await onramp();
  else if (step === 'onramp-status') await inspectOrder('onramp');
  else if (step === 'swap-stream') await swapStream();
  else if (step === 'verify-usdc') await verifyUsdc();
  else if (step === 'offramp') await offramp();
  else if (step === 'offramp-status') await inspectOrder('offramp');
  else throw new Error('Unknown sandbox execution step');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { save(); console.error(error.message); process.exitCode = 1; });
}
