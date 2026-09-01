const assert = require('node:assert/strict');
const { after, beforeEach, test } = require('node:test');

const app = require('./index');
const { activityHandler } = app;

const CONTRACT_A = `C${'A'.repeat(55)}`;
const CONTRACT_B = `C${'B'.repeat(55)}`;

const originalFetch = global.fetch;

const request = async (query) => {
  let status = 200;
  const headers = {};
  let body;
  const response = {
    status(code) {
      status = code;
      return this;
    },
    set(name, value) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };

  await activityHandler({ query }, response);
  return { status, headers, body };
};

beforeEach(() => {
  global.fetch = async () => {
    throw new Error('Unexpected upstream request');
  };
});

after(() => {
  global.fetch = originalFetch;
});

test('activity proxies a single contract', async () => {
  const upstreamUrls = [];
  global.fetch = async (url) => {
    upstreamUrls.push(url);
    return {
      ok: true,
      json: async () => ({
        _embedded: { records: [{ id: '1', ts: 10, contract: CONTRACT_A }] },
      }),
    };
  };

  const response = await request({ contract: CONTRACT_A, network: 'testnet', limit: '30' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.records.map((record) => record.id), ['1']);
  assert.equal(upstreamUrls.length, 1);
  assert.match(upstreamUrls[0], new RegExp(`/contract/${CONTRACT_A}/events`));
});

test('activity merges multiple contracts newest-first and applies a global limit', async () => {
  global.fetch = async (url) => {
    const contract = url.includes(CONTRACT_A) ? CONTRACT_A : CONTRACT_B;
    const records =
      contract === CONTRACT_A
        ? [
            { id: '1', ts: 10, contract },
            { id: '3', ts: 30, contract },
          ]
        : [
            { id: '2', ts: 20, contract },
            { id: '4', ts: 40, contract },
          ];
    return { ok: true, json: async () => ({ _embedded: { records } }) };
  };

  const response = await request({
    contract: `${CONTRACT_A},${CONTRACT_B}`,
    network: 'testnet',
    limit: '3',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.records.map((record) => record.id), ['4', '3', '2']);
  assert.equal(response.headers['cache-control'], 'public, max-age=15');
});

test('activity rejects malformed or excessive contract lists without proxying', async () => {
  let upstreamCalls = 0;
  global.fetch = async () => {
    upstreamCalls += 1;
    return { ok: true, json: async () => ({ _embedded: { records: [] } }) };
  };

  const malformed = await request({ contract: 'not-a-contract' });
  const suffixes = 'ABCDEFG2345';
  const excessive = await request({
    contract: Array.from(
      { length: 11 },
      (_, index) => `C${'A'.repeat(54)}${suffixes[index]}`,
    ).join(','),
  });

  assert.equal(malformed.status, 400);
  assert.equal(excessive.status, 400);
  assert.equal(upstreamCalls, 0);
});

test('activity preserves the explorer failure status in its gateway error', async () => {
  global.fetch = async () => ({ ok: false, status: 429 });

  const response = await request({ contract: CONTRACT_A });

  assert.equal(response.status, 502);
  assert.deepEqual(response.body, { error: 'Explorer returned 429', records: [] });
});
