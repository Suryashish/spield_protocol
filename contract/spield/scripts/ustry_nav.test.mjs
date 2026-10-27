import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decimal8, publicationDue, validateNav } from './ustry_nav.mjs';
test('NAV decimal conversion floors precisely and rejects malformed/out-of-range prices', () => {
  assert.equal(decimal8('1.106722019'), 110672201n);
  assert.equal(decimal8('0.00000001'), 1n);
  for (const value of ['0', '-1', '1e3', 'NaN', '1.2.3', '1001', 1.1, null])
    assert.throws(() => decimal8(value));
});
test('relay checks the exact sandbox bond identity and USD denomination', () => {
  const good = {
    current_time: new Date().toISOString(),
    token_symbol: 'USTRY',
    token_kind: 'bond',
    currency: 'USD',
    token_mint: 'BoTpvjYEDn8esZDrBkipexoUMeSBQ9DDG6A5mtzsDGSt',
    token_cost_in_usd: '1.10',
  };
  assert.equal(validateNav(good), 110000000n);
  for (const [key, value] of [
    ['current_time', '2020-01-01T00:00:00Z'],
    ['current_time', 'invalid'],
    ['current_time', new Date(Date.now() + 120_000).toISOString()],
    ['token_symbol', 'USDY'],
    ['currency', 'MXN'],
    ['token_kind', 'principal'],
    ['token_mint', 'mainnet-mint'],
  ])
    assert.throws(() => validateNav({ ...good, [key]: value }));
});
test('cadence allows loss, heartbeat and maturity boundary without inventing yield', () => {
  const last = { price: '100000000', timestamp: 1000 };
  assert.equal(publicationDue(last, 100000001n, 1100, 2000), false);
  assert.equal(publicationDue(last, 99000000n, 1100, 2000), true);
  assert.equal(publicationDue(last, 100000000n, 44200, 50000), true);
  assert.equal(publicationDue(last, 100000000n, 2000, 2000), true);
  assert.equal(publicationDue(last, 120000000n, 999, 2000), false);
});
