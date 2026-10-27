import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';

export function inspectProviderTransaction(encoded, { wallet, spendAsset, maxAmount, receiveAsset, minReceive, settlementCounterparty }) {
  const tx = TransactionBuilder.fromXDR(encoded, Networks.TESTNET);
  if (tx.innerTransaction) throw new Error('Fee-bump envelope requires separate review');
  if (tx.source !== wallet) throw new Error('Provider transaction source mismatch');
  if (BigInt(tx.fee) > 1_000_000n) throw new Error('Provider transaction fee exceeds test limit');
  if (tx.operations.length < 1 || tx.operations.length > 10) throw new Error('Unexpected operation count');
  let spent = 0n;
  let received = 0n;
  const units = value => {
    if (!/^\d+(?:\.\d{1,7})?$/.test(value)) throw new Error('Invalid token amount');
    const [a, b = ''] = value.split('.');
    return BigInt(a) * 10_000_000n + BigInt(b.padEnd(7, '0'));
  };
  const summary = [];
  const identify = a => a.isNative() ? 'XLM' : `${a.code}:${a.issuer}`;
  const counterparties = new Set(tx.operations.filter(op => (op.source ?? tx.source) === wallet && op.type === 'payment').map(op => op.destination));
  for (const op of tx.operations) {
    if (!['payment', 'pathPaymentStrictSend', 'pathPaymentStrictReceive'].includes(op.type)) {
      throw new Error(`Operation needs review: ${op.type}`);
    }
    const source = op.source ?? tx.source;
    if (source !== wallet) {
      if (!receiveAsset || !minReceive || !counterparties.has(source) || op.destination !== wallet) throw new Error('Unexpected operation source');
      const publicKey = Keypair.fromPublicKey(source);
      if (!tx.signatures.some(sig => publicKey.verify(tx.hash(), typeof sig.signature === 'function' ? sig.signature() : sig.signature))) {
        throw new Error('Counterparty operation lacks its valid testnet signature');
      }
      const targetAsset = op.type === 'payment' ? op.asset : op.destAsset;
      if (identify(targetAsset) !== receiveAsset) throw new Error('Swap receives the wrong asset');
      const amount = op.type === 'payment' ? op.amount : op.type === 'pathPaymentStrictReceive' ? op.destAmount : op.destMin;
      received += units(amount);
      summary.push({ type: op.type, counterpartyPreSigned: true, receivedAsset: receiveAsset, minimumReceived: amount, destination: wallet });
      continue;
    }
    const sourceAsset = op.type === 'payment' ? op.asset : op.sendAsset;
    const identifier = sourceAsset.isNative() ? 'XLM' : `${sourceAsset.code}:${sourceAsset.issuer}`;
    if (identifier !== spendAsset) throw new Error('Provider transaction spends the wrong asset');
    const amount = op.type === 'payment' ? op.amount : op.type === 'pathPaymentStrictSend' ? op.sendAmount : op.sendMax;
    spent += units(amount);
    summary.push({ type: op.type, asset: identifier, maximumAmount: amount, destination: op.destination });
    // Etherfuse's reverse Stellar route can deliver the path-payment output to
    // its already verified settlement wallet, then forward tokens separately.
    // This is asynchronous provider settlement, not an atomic wallet payout.
    if (op.type === 'pathPaymentStrictSend' && receiveAsset) {
      if (!settlementCounterparty || op.destination !== settlementCounterparty || identify(op.destAsset) !== receiveAsset) {
        throw new Error('Unexpected provider-directed settlement route');
      }
      received += units(op.destMin);
      summary.at(-1).settlement = 'provider_forwarded';
      summary.at(-1).minimumRoutedOutput = op.destMin;
    }
  }
  if (spent > units(maxAmount)) throw new Error('Provider transaction exceeds authorized test amount');
  if (receiveAsset && received < units(minReceive)) throw new Error('Swap output is below the accepted quote');
  return { tx, summary };
}
