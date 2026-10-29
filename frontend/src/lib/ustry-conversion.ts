import {
  Asset,
  BASE_FEE,
  Horizon,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { getActiveSeriesId, getActiveSeriesRevision, NETWORK, NETWORK_KEY } from './config';
import { signWithWallet } from './stellar';
import { quantity, units } from './ustry';
export const USTRY_ISSUER = 'GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4';
export const CIRCLE_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export const GATAL_ISSUER = 'GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
export const swapAsset = (code: 'USTRY' | 'USDC', issuer: string) => new Asset(code, issuer);
export type ConversionQuote = {
  source: Asset;
  destination: Asset;
  amount: bigint;
  output: bigint;
  minimum: bigint;
  path: Asset[];
  expires: number;
  seriesId: string;
  revision: number;
  wallet: string;
};
function testnet() {
  if (NETWORK_KEY !== 'testnet' || NETWORK.passphrase !== Networks.TESTNET)
    throw new Error('Sandbox conversion requires Stellar testnet.');
}
function allowed(a: Asset) {
  return (
    (a.code === 'USTRY' && a.issuer === USTRY_ISSUER) ||
    (a.code === 'USDC' && [CIRCLE_ISSUER, GATAL_ISSUER].includes(a.issuer ?? ''))
  );
}
export async function conversionQuote(
  wallet: string,
  seriesId: string,
  source: Asset,
  destination: Asset,
  amount: bigint,
): Promise<ConversionQuote> {
  testnet();
  const revision = getActiveSeriesRevision();
  if (
    !allowed(source) ||
    !allowed(destination) ||
    source.equals(destination) ||
    amount <= 0n ||
    amount > 10_000_000_000n
  )
    throw new Error('Select a supported asset pair and amount up to 1,000 units.');
  const response = await horizon.strictSendPaths(source, units(amount), [destination]).call();
  const routes = response.records.filter(
    (r) =>
      r.source_asset_code === source.code &&
      r.source_asset_issuer === source.issuer &&
      r.destination_asset_code === destination.code &&
      r.destination_asset_issuer === destination.issuer &&
      quantity(r.source_amount) === amount &&
      r.path.length <= 1 &&
      r.path.every((p) => p.asset_code === 'USDC' && p.asset_issuer === CIRCLE_ISSUER),
  );
  routes.sort((a, b) => (quantity(a.destination_amount) > quantity(b.destination_amount) ? -1 : 1));
  const best = routes[0];
  if (!best)
    throw new Error(
      'No executable sandbox liquidity for this pair and amount. Try a smaller amount or retry later.',
    );
  const output = quantity(best.destination_amount);
  const minimum = (output * 9900n) / 10000n;
  if (minimum <= 0n) throw new Error('Quoted output is too small.');
  if (getActiveSeriesId() !== seriesId || getActiveSeriesRevision() !== revision)
    throw new Error('Series changed while quoting.');
  return {
    source,
    destination,
    amount,
    output,
    minimum,
    path: best.path.map((p) => new Asset(p.asset_code!, p.asset_issuer!)),
    expires: Date.now() + 30_000,
    seriesId,
    revision,
    wallet,
  };
}
function checkQuote(q: ConversionQuote, wallet: string) {
  testnet();
  if (
    q.wallet !== wallet ||
    getActiveSeriesId() !== q.seriesId ||
    getActiveSeriesRevision() !== q.revision ||
    Date.now() > q.expires
  )
    throw new Error('Quote expired or selection changed. Get a new quote.');
}
export async function missingTrustlines(wallet: string, assets: Asset[]) {
  testnet();
  const account = await horizon.loadAccount(wallet);
  return assets.filter((a) => {
    const line = account.balances.find(
      (b) => 'asset_code' in b && b.asset_code === a.code && b.asset_issuer === a.issuer,
    );
    if (line && 'is_authorized' in line && !line.is_authorized)
      throw new Error(
        `${a.code} trustline needs issuer authorization. Contact the sandbox issuer.`,
      );
    return !line;
  });
}
export async function conversionBalance(wallet: string, asset: Asset): Promise<bigint> {
  testnet();
  const account = await horizon.loadAccount(wallet);
  const line = account.balances.find(
    (balance) =>
      'asset_code' in balance &&
      balance.asset_code === asset.code &&
      balance.asset_issuer === asset.issuer,
  );
  return line && !/^0(?:\.0+)?$/.test(line.balance) ? quantity(line.balance) : 0n;
}
async function signSubmit(
  wallet: string,
  tx: ReturnType<TransactionBuilder['build']>,
  guard: () => void,
) {
  guard();
  const { signedTxXdr, error } = await signWithWallet(tx.toXDR(), {
    networkPassphrase: Networks.TESTNET,
    address: wallet,
  });
  if (error) throw new Error(error.message || 'Wallet rejected transaction.');
  guard();
  const signed = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
  if (signed.hash().toString('hex') !== tx.hash().toString('hex'))
    throw new Error('Wallet changed the requested transaction.');
  const result = await horizon.submitTransaction(signed);
  if (!result.successful) throw new Error('Transaction did not succeed.');
  return { hash: result.hash };
}
export async function addConversionTrustlines(wallet: string, seriesId: string, assets: Asset[]) {
  const revision = getActiveSeriesRevision();
  testnet();
  const missing = await missingTrustlines(wallet, assets);
  if (!missing.length) throw new Error('Required trustlines already exist.');
  if (missing.some((a) => !allowed(a))) throw new Error('Unsupported trustline.');
  const account = await horizon.loadAccount(wallet);
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  });
  missing.forEach((asset) => builder.addOperation(Operation.changeTrust({ asset })));
  return signSubmit(wallet, builder.setTimeout(180).build(), () => {
    if (getActiveSeriesId() !== seriesId || getActiveSeriesRevision() !== revision)
      throw new Error('Series changed.');
  });
}
export async function executeConversion(wallet: string, q: ConversionQuote) {
  checkQuote(q, wallet);
  if ((await missingTrustlines(wallet, [q.source, q.destination])).length)
    throw new Error('Add the exact source and destination trustlines first.');
  const account = await horizon.loadAccount(wallet);
  const balance = account.balances.find(
    (b) =>
      'asset_code' in b && b.asset_code === q.source.code && b.asset_issuer === q.source.issuer,
  );
  if (!balance || /^0(?:\.0+)?$/.test(balance.balance) || quantity(balance.balance) < q.amount)
    throw new Error('Insufficient source asset balance.');
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(
      Operation.pathPaymentStrictSend({
        source: wallet,
        destination: wallet,
        sendAsset: q.source,
        sendAmount: units(q.amount),
        destAsset: q.destination,
        destMin: units(q.minimum),
        path: q.path,
      }),
    )
    .setTimeout(90)
    .build();
  return signSubmit(wallet, tx, () => checkQuote(q, wallet));
}
