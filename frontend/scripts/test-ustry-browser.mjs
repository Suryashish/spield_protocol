// Deterministic browser integration tests. Wallet and RPC responses are fixtures;
// these do not sign transactions or stand in for the separate genuine-asset smoke test.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import {
  Address,
  Networks,
  SorobanDataBuilder,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import fs from 'node:fs';
const deployment = JSON.parse(fs.readFileSync('src/lib/ustry-deployment.json', 'utf8'));
process.env.VITE_NETWORK = 'testnet';
const server = await createServer({
  server: { host: '127.0.0.1', port: 4184, strictPort: true },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ headless: true });
const failures = [];
let mode = 'healthy';
const touched = [];
const wallet = 'GDXHBXYT23MUJWOKNZLTRBYJA2H6LDIL2DVHJCVITEFKQK5QUT2LPBJF';
const now = () => BigInt(Math.floor(Date.now() / 1000));
function fixture(id, method) {
  const observation = {
    price: 110000000n,
    timestamp: mode === 'stale' ? now() - 50000n : now() - 30n,
  };
  const state = {
    high_water: 110000000n,
    factor: 909090909090909091n,
    cursor: 1,
    last_observation: observation,
    finalized: false,
    receipts: 30000000n,
    face: 11000000n,
    backing: 10000000n,
    total_yt: 11000000n,
  };
  if (id === deployment.oracle && method === 'observations') return [observation];
  if (id === deployment.asset && method === 'balance') return 50000000n;
  if (id === deployment.series) {
    if (method === 'config')
      return {
        asset: deployment.asset,
        oracle: deployment.oracle,
        expiry: BigInt(deployment.expiry),
        max_age: 46800n,
        paused: false,
        tokens: [deployment.receipt, deployment.pt, deployment.yt],
      };
    if (method === 'balance')
      return {
        receipt: 30000000n,
        pt: 11000000n,
        yt: 11000000n,
        factor: 909090909090909091n,
        accrued: 0n,
      };
    if (method === 'state' || method === 'sync') return state;
  }
  return 0n;
}
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(() => localStorage.setItem('spield_app_tour_completed_v2', 'true'));
await context.route('**/src/context/WalletContext.tsx*', (route) =>
  route.fulfill({
    contentType: 'application/javascript',
    body: `export function WalletProvider({children}){return children}; export const useWallet=()=>({address:${JSON.stringify(wallet)},isConnected:true,onCorrectNetwork:true,connecting:false,error:null,openWalletPicker(){},disconnect(){}});`,
  }),
);
await context.route('https://soroban-testnet.stellar.org/**', async (route) => {
  const body = route.request().postDataJSON();
  if (body?.method !== 'simulateTransaction') {
    await route.abort();
    return;
  }
  if (mode === 'error') {
    await route.fulfill({ status: 503, body: 'test RPC unavailable' });
    return;
  }
  const tx = TransactionBuilder.fromXDR(body.params.transaction, Networks.TESTNET);
  const call = tx.operations[0].func.invokeContract();
  const id = Address.fromScAddress(call.contractAddress()).toString();
  const method = call.functionName().toString();
  touched.push({ id, method });
  const result =
    mode === 'stale' && id === deployment.series && method === 'sync'
      ? { error: 'HostError: Error(Contract, #9)', latestLedger: 1 }
      : {
          latestLedger: 1,
          minResourceFee: '100',
          transactionData: new SorobanDataBuilder().build().toXDR('base64'),
          events: [],
          results: [{ auth: [], xdr: nativeToScVal(fixture(id, method)).toXDR('base64') }],
        };
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result }),
  });
});
const page = await context.newPage();
page.on('pageerror', (e) => failures.push(e.message));
async function waitFor(fn, message) {
  for (let n = 0; n < 100; n++) {
    if (await fn()) return;
    await page.waitForTimeout(100);
  }
  throw new Error(message);
}
const labels = {
  overview: 'Overview',
  v2: 'Yield',
  srwrap: 'SR Wrapper',
  vault: 'Fixed Vault',
  deposit: 'Deposit',
  markets: 'Markets',
  liquidity: 'Liquidity',
  bridge: 'Bridge',
  solvency: 'Solvency',
  activity: 'Activity',
};
const titles = { ...labels, vault: 'Fixed-Rate Vault', bridge: 'Bridge Assets' };
async function go(id) {
  await page.locator('aside nav').getByRole('button', { name: labels[id], exact: true }).click();
  await page.getByRole('heading', { name: titles[id], level: 1, exact: true }).waitFor();
}
async function shellMetrics() {
  return page.evaluate(() => {
    const sidebar = document.querySelector('aside');
    const heading = document.querySelector('main h1');
    const tile = document.querySelector('.panel-hover');
    const scroll = document.querySelector('main > div.grow');
    const css = (element) =>
      element
        ? {
            font: getComputedStyle(element).fontFamily,
            size: getComputedStyle(element).fontSize,
            radius: getComputedStyle(element).borderRadius,
            padding: getComputedStyle(element).padding,
          }
        : null;
    return {
      sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
      heading: css(heading),
      tile: css(tile),
      gutter: css(scroll),
    };
  });
}
try {
  await page.goto('http://127.0.0.1:4184/overview');
  await page.getByRole('heading', { name: 'Overview', level: 1, exact: true }).waitFor();
  const blendNavigation = await page.locator('aside nav button').allTextContents();
  await waitFor(
    async () => Math.abs((await page.locator('aside').boundingBox()).width - 236) < 0.1,
    'Blend sidebar did not settle',
  );
  const blendShell = await shellMetrics();
  await page.screenshot({ path: '/tmp/spield-blend-overview-reference.png', fullPage: true });
  await page.getByLabel('Yield source', { exact: true }).selectOption('ustry');
  await waitFor(
    async () => (await page.getByText('$1.1 / USTRY', { exact: true }).count()) > 0,
    'USTRY NAV did not load',
  );
  assert.deepEqual(
    await page.locator('aside nav button').allTextContents(),
    blendNavigation,
    'Source navigation changed labels/order',
  );
  await waitFor(
    async () => Math.abs((await page.locator('aside').boundingBox()).width - 236) < 0.1,
    'USTRY sidebar did not settle',
  );
  assert.deepEqual(
    await shellMetrics(),
    blendShell,
    'USTRY shell typography, sidebar width or gutters differ from Blend',
  );
  assert.equal(await page.locator('[data-testid="ustry-stats"] > div').count(), 4);
  assert.ok(
    (await page.locator('main [data-slot="card"]').count()) >= 3,
    'Overview charts and backing cards missing',
  );
  await page.screenshot({ path: '/tmp/spield-ustry-overview-matched.png', fullPage: true });
  await page.getByTitle('Collapse sidebar', { exact: true }).click();
  await waitFor(
    async () => Math.abs((await page.locator('aside').boundingBox()).width - 72) < 1,
    'Sidebar did not collapse',
  );
  await page.getByTitle('Expand sidebar', { exact: true }).click();
  await waitFor(
    async () => Math.abs((await page.locator('aside').boundingBox()).width - 236) < 0.1,
    'Sidebar did not expand',
  );
  const options = await page
    .getByLabel('Series / maturity', { exact: true })
    .locator('option')
    .allTextContents();
  assert.equal(options.length, 1);
  assert.match(options[0], /USTRY/);
  await page.reload();
  await page.getByRole('heading', { name: 'Overview', level: 1, exact: true }).waitFor();
  assert.equal(await page.getByLabel('Yield source', { exact: true }).inputValue(), 'ustry');
  touched.length = 0;
  await go('deposit');
  await page.getByLabel('Deposit', { exact: true }).fill('0.1');
  await waitFor(
    async () => await page.getByRole('button', { name: 'Deposit & Mint', exact: true }).isEnabled(),
    'Healthy USTRY deposit disabled',
  );
  assert.equal(
    await page.getByText('0.1099999', { exact: true }).count(),
    2,
    'PT/YT previews use wrong face value',
  );
  assert.match(await page.locator('main').innerText(), /0.1099999 PT \+ 0.1099999 YT/);
  assert.ok(
    touched.every((t) => [deployment.series, deployment.oracle, deployment.asset].includes(t.id)),
    'USTRY read leaked into Blend contracts',
  );
  await page.waitForTimeout(350);
  await page.screenshot({ path: '/tmp/spield-ustry-deposit-matched.png', fullPage: true });
  await page.getByRole('button', { name: 'How it works', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.match(await page.getByRole('dialog').innerText(), /USTRY/);
  assert.doesNotMatch(
    await page.getByRole('dialog').innerText(),
    /lent into the Blend pool|1:1 at par/,
  );
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await page.getByLabel('Yield source', { exact: true }).selectOption('blend');
  await page.getByRole('heading', { name: 'Deposit', level: 1, exact: true }).waitFor();
  assert.deepEqual(await page.locator('aside nav button').allTextContents(), blendNavigation);
  await page.getByLabel('Series / maturity', { exact: true }).selectOption('testnet-series-1');
  await page.getByLabel('Yield source', { exact: true }).selectOption('ustry');
  await page.getByLabel('Deposit', { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('Deposit', { exact: true }).inputValue(),
    '',
    'Old amount survived source switch',
  );
  await page.getByLabel('Yield source', { exact: true }).selectOption('blend');
  await page.getByRole('heading', { name: 'Deposit', level: 1, exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('Series / maturity', { exact: true }).inputValue(),
    'testnet-series-1',
  );
  await page.getByLabel('Yield source', { exact: true }).selectOption('ustry');
  mode = 'stale';
  await page.reload();
  await page.getByLabel('Deposit', { exact: true }).fill('0.1');
  await waitFor(
    async () => /NAV is stale/.test(await page.locator('main').innerText()),
    'Stale NAV warning missing',
  );
  assert.ok(
    await page.getByRole('button', { name: 'Waiting for valid NAV', exact: true }).isDisabled(),
  );
  await go('srwrap');
  await page
    .getByRole('button', { name: 'Withdraw', exact: false })
    .filter({ hasText: 'sUSTRY' })
    .click();
  await page.getByLabel('Receipt amount', { exact: true }).fill('0.1');
  assert.ok(
    await page.getByRole('button', { name: 'Withdraw USTRY', exact: true }).isEnabled(),
    'Receipt exit blocked by stale NAV',
  );
  mode = 'error';
  await page.reload();
  await waitFor(
    async () => /USTRY reads failed/.test(await page.locator('main').innerText()),
    'RPC error hidden',
  );
  assert.ok(
    await page.getByRole('button', { name: 'Waiting for valid NAV', exact: true }).isDisabled(),
  );
  mode = 'healthy';
  await page.reload();
  for (const id of Object.keys(labels)) {
    await go(id);
    assert.ok(await page.getByRole('button', { name: 'How it works', exact: true }).isVisible());
    assert.ok(
      (await page.locator('main [data-slot="card"]').count()) > 0,
      `Missing cards on ${id}`,
    );
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `Desktop overflow on ${id}`,
    );
    assert.deepEqual(
      await page.locator('aside nav button').allTextContents(),
      blendNavigation,
      `Navigation drift on ${id}`,
    );
    if (['vault', 'liquidity', 'bridge'].includes(id)) {
      assert.match(await page.locator('main').innerText(), /Unavailable for USTRY/);
      assert.ok(await page.getByRole('button', { name: /unavailable$/ }).isDisabled());
    }
  }
  await go('markets');
  await page.getByLabel('Conversion USDC issuer').waitFor();
  assert.equal(await page.getByLabel('Conversion USDC issuer').locator('option').count(), 2);
  assert.ok(await page.getByRole('button', { name: 'Get quote', exact: true }).isDisabled());
  // Both sources use the identical mobile Primary/More navigation and geometry.
  await page.setViewportSize({ width: 375, height: 812 });
  const primary = page.getByRole('navigation', { name: 'Primary', exact: true });
  await primary.waitFor();
  const ustryMobileLabels = await primary.getByRole('button').allTextContents();
  for (const id of Object.keys(labels)) {
    const mainIds = ['overview', 'vault', 'deposit', 'markets'];
    if (mainIds.includes(id))
      await primary.getByRole('button', { name: labels[id], exact: true }).click();
    else {
      await primary.getByRole('button', { name: /^More/ }).click();
      const sheet = page.getByRole('dialog', { name: 'All sections', exact: true });
      await sheet.waitFor();
      await sheet.getByRole('button', { name: labels[id], exact: true }).click();
      await sheet.waitFor({ state: 'hidden' });
    }
    await page.getByRole('heading', { name: titles[id], level: 1, exact: true }).waitFor();
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `375px overflow on ${id}`,
    );
  }
  await page.screenshot({ path: '/tmp/spield-ustry-mobile-matched.png', fullPage: true });
  await primary.getByRole('button', { name: /^More/ }).click();
  await page.getByRole('button', { name: /App Tutorial & Interactive Guide/ }).click();
  await page.getByRole('dialog').waitFor();
  assert.match(await page.getByRole('dialog').innerText(), /USTRY/);
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  const lightCanvas = await page
    .locator('.app-shell')
    .first()
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to light theme', exact: true }).waitFor();
  const darkCanvas = await page
    .locator('.app-shell')
    .first()
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  assert.notEqual(darkCanvas, lightCanvas, 'USTRY theme did not change');
  await page.screenshot({ path: '/tmp/spield-ustry-mobile-dark-matched.png', fullPage: true });
  await page.getByLabel('Yield source', { exact: true }).selectOption('blend');
  await page.getByRole('heading', { name: 'Activity', level: 1, exact: true }).waitFor();
  assert.equal(
    await page
      .locator('.app-shell')
      .first()
      .evaluate((e) => getComputedStyle(e).backgroundColor),
    darkCanvas,
    'Source switch changed the shared dark palette',
  );

  assert.deepEqual(
    await primary.getByRole('button').allTextContents(),
    ustryMobileLabels,
    'Mobile navigation differs by source',
  );
  assert.deepEqual(failures, [], 'Uncaught browser errors');
  console.log(
    'PASS: identical Blend/USTRY sidebar, mobile navigation, page typography/gutters and card styles; all 10 USTRY routes on desktop/375px, shared light/dark themes; collapse/expand, contextual help, source/series persistence, exact previews, source isolation, stale priced-action rejection and oracle-free receipt exits.',
  );
} finally {
  await browser.close();
  await server.close();
}
