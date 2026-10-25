import test from 'node:test';
import assert from 'node:assert/strict';
import { USTRY, PROBE_POLICY, assessObservation, decimalToInteger } from './ustry_oracle.mjs';

function observation() {
  return {
    identity: { feedId: 'USTRY', mappedFeed: 'USTRY', token: USTRY.token, base: ['Other', 'USD'],
      directDecimals: '8', sep40Decimals: 8, assetListed: true },
    direct: { price: '107815400', package_timestamp: '1792930250000', write_timestamp: '1792930258000' },
    sep40: { price: '107815400', timestamp: '1792930250' },
    issuerCost: { token_symbol: 'USTRY', token_kind: 'bond', currency: 'USD', token_cost_in_usd: '1.078160' },
    referenceTimeSeconds: 1792935650,
    history: [{ price: '107810100', timestamp: '1792887040' }, { price: '107815400', timestamp: '1792930250' }],
  };
}

test('compares direct milliseconds to SEP-40 seconds and exact issuer decimals', () => {
  const result = assessObservation(observation());
  assert.equal(result.status, 'technical_checks_passed');
  assert.equal(result.priceUsd, '1.07815400');
  assert.equal(result.deviationBps, '0.055650');
  assert.equal(result.packageToWriteDelayMs, '8000');
  assert.equal(result.productionApproved, false);
});

for (const [name, change, expected] of [
  ['wrong asset mapping', o => { o.identity.mappedFeed = 'CETES'; }, 'maps to a different'],
  ['wrong token', o => { o.identity.token = USTRY.sep40; }, 'token identity'],
  ['wrong base', o => { o.identity.base = ['Other', 'MXN']; }, 'base is not USD'],
  ['decimals changed by admin', o => { o.identity.sep40Decimals = 12; }, 'decimals changed'],
  ['wrong issuer asset', o => { o.issuerCost.token_symbol = 'CETES'; }, 'wrong asset'],
  ['stale price', o => { o.referenceTimeSeconds += PROBE_POLICY.maxAgeSeconds; }, 'stale'],
  ['millisecond timestamp passed as seconds', o => { o.sep40.timestamp = o.direct.package_timestamp; }, 'seconds disagree'],
  ['future price', o => { o.referenceTimeSeconds -= 7200; }, 'future'],
  ['changed price between calls', o => { o.direct.price = '107815401'; }, 'price disagree'],
  ['large NAV divergence', o => { o.issuerCost.token_cost_in_usd = '1.15'; }, 'deviation exceeds'],
  ['zero price', o => { o.sep40.price = '0'; o.direct.price = '0'; }, 'Non-positive'],
  ['missing price', o => { o.sep40 = null; }, 'Missing'],
  ['history gap', o => { o.history[0].timestamp = '1792700000'; }, 'history'],
]) {
  test(`rejects ${name}`, () => {
    const o = observation(); change(o);
    const result = assessObservation(o);
    assert.equal(result.status, 'failed');
    assert.ok(result.failures.some(f => f.toLowerCase().includes(expected.toLowerCase())), JSON.stringify(result));
  });
}

test('history ordering does not change the latest observation', () => {
  const o = observation(); o.history.reverse();
  assert.equal(assessObservation(o).status, 'technical_checks_passed');
});

test('ordinary downward NAV observations remain valid; an oracle does not guarantee monotonic returns', () => {
  const o = observation(); o.history[0].price = '108000000';
  assert.equal(assessObservation(o).status, 'technical_checks_passed');
});

test('does not round unsupported issuer precision or accept exponent notation', () => {
  assert.equal(decimalToInteger('1.078160', 8), 107816000n);
  assert.throws(() => decimalToInteger('1.078160001', 8), /precision/);
  assert.throws(() => decimalToInteger('1e0', 8), /decimal/);
});
