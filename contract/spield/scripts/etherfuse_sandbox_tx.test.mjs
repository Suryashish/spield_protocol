import test from 'node:test';
import assert from 'node:assert/strict';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { inspectProviderTransaction } from './etherfuse_sandbox_tx.mjs';
const wallet = Keypair.random().publicKey();
const issuer = Keypair.random().publicKey();
const destination = Keypair.random().publicKey();
const token = new Asset('USTRY', issuer);
const policy = { wallet, spendAsset: `USTRY:${issuer}`, maxAmount: '1' };
const build = (ops, source = wallet, fee = '100') => {
  const b = new TransactionBuilder(new Account(source, '1'), { fee, networkPassphrase: Networks.TESTNET });
  for (const op of ops) b.addOperation(op);
  return b.setTimeout(120).build().toXDR();
};
const payment = amount => Operation.payment({ destination, asset: token, amount });
test('accepts a bounded payment of the expected sandbox asset', () => {
  assert.equal(inspectProviderTransaction(build([payment('1')]), policy).summary[0].maximumAmount, '1.0000000');
});
test('rejects a different transaction source', () => {
  assert.throws(() => inspectProviderTransaction(build([payment('1')], destination), policy), /source mismatch/);
});
test('rejects another token issuer even with the same symbol', () => {
  const op = Operation.payment({ destination, asset: new Asset('USTRY', destination), amount: '1' });
  assert.throws(() => inspectProviderTransaction(build([op]), policy), /wrong asset/);
});
test('rejects overspending, including multiple individually small payments', () => {
  assert.throws(() => inspectProviderTransaction(build([payment('0.6'), payment('0.6')]), policy), /exceeds authorized/);
});
test('rejects account-control changes', () => {
  assert.throws(() => inspectProviderTransaction(build([Operation.setOptions({ masterWeight: 0 })]), policy), /needs review/);
});
test('rejects an unexpectedly large fee', () => {
  assert.throws(() => inspectProviderTransaction(build([payment('1')], wallet, '2000000'), policy), /fee exceeds/);
});
test('accepts an atomic swap only with a pre-signed counterparty and quoted output', () => {
  const counterparty = Keypair.random();
  const usdc = new Asset('USDC', issuer);
  const make = (signed, output = '0.5') => {
    const builder = new TransactionBuilder(new Account(wallet, '1'), { fee: '100', networkPassphrase: Networks.TESTNET });
    builder.addOperation(Operation.payment({ destination: counterparty.publicKey(), asset: token, amount: '1' }));
    builder.addOperation(Operation.pathPaymentStrictReceive({ source: counterparty.publicKey(), sendAsset: token, sendMax: '1', destination: wallet, destAsset: usdc, destAmount: output, path: [] }));
    const tx = builder.setTimeout(120).build();
    if (signed) tx.sign(counterparty);
    return tx.toXDR();
  };
  const swapPolicy = { ...policy, receiveAsset: `USDC:${issuer}`, minReceive: '0.5' };
  assert.equal(inspectProviderTransaction(make(true), swapPolicy).summary[1].counterpartyPreSigned, true);
  assert.throws(() => inspectProviderTransaction(make(false), swapPolicy), /lacks its valid/);
  assert.throws(() => inspectProviderTransaction(make(true, '0.4'), swapPolicy), /below the accepted quote/);
});
test('provider-forwarded path must name the already verified counterparty and target asset', () => {
  const usdc = new Asset('USDC', issuer);
  const op = Operation.pathPaymentStrictSend({ sendAsset: token, sendAmount: '1', destination, destAsset: usdc, destMin: '0.5', path: [] });
  const p = { ...policy, receiveAsset: `USDC:${issuer}`, minReceive: '0.5', settlementCounterparty: destination };
  assert.equal(inspectProviderTransaction(build([op]), p).summary[0].settlement, 'provider_forwarded');
  assert.throws(() => inspectProviderTransaction(build([op]), { ...p, settlementCounterparty: issuer }), /Unexpected provider-directed/);
});
