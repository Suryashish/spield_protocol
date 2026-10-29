// Wallet isolation and source/series walkthrough regressions, using deterministic fixtures.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { nativeToScVal, SorobanDataBuilder } from '@stellar/stellar-sdk';

process.env.VITE_NETWORK = 'testnet';
const server = await createServer({
  server: { host: '127.0.0.1', port: 4185, strictPort: true },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ headless: true });
const walletA = 'GDXHBXYT23MUJWOKNZLTRBYJA2H6LDIL2DVHJCVITEFKQK5QUT2LPBJF';
const walletB = 'GBBRKYFRHSDUQ3YQRIFR42GZ4OKFMVKCZN7JYFPESVNSRU3WEE4JPI7Q';
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const errors = [];
let activityReads = 0;
const records = [
  ...Array.from({ length: 35 }, (_, i) => ({
    id: `${100 + i}-0`, ts: 2000 + i, topics: ['sr_redeem', 'stranger'],
  })),
  { id: '50-0', ts: 1000, topics: ['sr_deposit', walletA] },
  { id: '49-0', ts: 999, topics: ['interest_paid', walletB] },
].map((event) => ({
  ...event,
  bodyXdr: nativeToScVal({ underlying_in: 10000000n, shares_out: 10000000n }).toXDR('base64'),
}));
await context.addInitScript(({ walletA, walletB }) => {
  window.__testWallet = walletA;
  localStorage.setItem('spield_app_tour_completed_v2', 'true');
  localStorage.setItem('spield.activeSeries', 'testnet-series-2');
  for (const series of ['testnet-ustry-1', 'testnet-ustry-2']) {
    for (const [wallet, label] of [[walletA, `Alice ${series}`], [walletB, `Bob ${series}`]]) {
      localStorage.setItem(`spield.ustry.activity.${series}.${wallet}`, JSON.stringify([
        { hash: (wallet === walletA ? 'a' : 'b').repeat(64), label, time: Date.now() },
      ]));
    }
  }
}, { walletA, walletB });
await context.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/activity' && url.searchParams.has('contract')) {
    activityReads++;
    // Make wallet changes race a previous wallet's in-flight fetch.
    await new Promise((resolve) => setTimeout(resolve, 120));
    return route.fulfill({ json: { records } });
  }
  if (route.request().method() === 'POST') {
    const body = route.request().postDataJSON();
    if (body?.jsonrpc === '2.0') {
      const result = body.method === 'getEvents'
        ? { events: [], latestLedger: 100000 }
        : body.method === 'getLatestLedger'
          ? { id: '0'.repeat(64), protocolVersion: 23, sequence: 100000 }
          : body.method === 'getLedgerEntries'
            ? { entries: [], latestLedger: 100000 }
            : {
                latestLedger: 100000, minResourceFee: '100', events: [],
                transactionData: new SorobanDataBuilder().build().toXDR('base64'),
                results: [{ auth: [], xdr: nativeToScVal(0n).toXDR('base64') }],
              };
      return route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result } });
    }
  }
  if (url.origin !== 'http://127.0.0.1:4185') return route.abort();
  return route.continue();
});
await context.route('**/src/context/WalletContext.tsx*', async (route) => {
  const original = await (await route.fetch()).text();
  const reactUrl = original.match(/from ["']([^"']*\/react\.js[^"']*)["']/)?.[1];
  assert.ok(reactUrl, 'Could not find the app React module');
  return route.fulfill({
  contentType: 'application/javascript',
  body: `import React from '${reactUrl}';
    export function WalletProvider({children}){return children}
    export function useWallet(){
      const address=React.useSyncExternalStore(cb=>{window.addEventListener('test-wallet',cb);return()=>window.removeEventListener('test-wallet',cb)},()=>window.__testWallet);
      return {address,isConnected:!!address,onCorrectNetwork:true,connecting:false,error:null,openWalletPicker(){},disconnect(){window.__testWallet=null;window.dispatchEvent(new Event('test-wallet'))}};
    }`,
});
});
await context.route('**/src/context/ProtocolContext.tsx*', (route) => route.fulfill({
  contentType: 'application/javascript',
  body: `export function ProtocolProvider({children}){return children}
    export const useProtocol=()=>({positions:[],balances:{usdc:0n,pt:0n,yt:0n},trustlines:{pt:false,yt:false,ready:false},solvency:null,maturity:1900000000,paused:false,vaultStats:null,receipts:[],marketStats:null,lpPosition:null,loading:false,refreshing:false,error:null,lastUpdated:1,stale:false,refresh:async()=>{},totalPrincipal:0n,totalClaimable:0n});`,
}));
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(error.message));
const main = page.locator('main');
const source = page.getByLabel('Yield source', { exact: true });
const series = page.getByLabel('Series / maturity', { exact: true });
const tour = page.locator('body > div.fixed.inset-0.z-\\[75\\]');
async function changeWallet(address) {
  await page.evaluate((address) => {
    window.__testWallet = address;
    window.dispatchEvent(new Event('test-wallet'));
  }, address);
}
async function title(text) {
  await tour.getByRole('heading', { name: text, exact: true }).waitFor();
}
async function next() {
  await tour.getByRole('button', { name: 'Next', exact: true }).click();
}
async function assertTarget(selector) {
  await page.locator(selector).waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  const card = await tour.locator('.pointer-events-auto').boundingBox();
  assert.ok(card && card.y >= 0 && card.y + card.height <= page.viewportSize().height, 'Tour card clipped by viewport');
  const box = await page.locator(selector).boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, `Missing target: ${selector}`);
}
try {
  await page.goto('http://127.0.0.1:4185/activity');
  await main.getByText('Wrap USDC', { exact: true }).waitFor();
  assert.equal(await main.getByText('Unwrap to USDC', { exact: true }).count(), 0);
  assert.equal(await main.getByText('Claim Yield', { exact: true }).count(), 0);
  assert.equal(await main.getByRole('button', { name: 'All', exact: true }).count(), 0);
  assert.equal(await main.getByRole('button', { name: 'Mine', exact: true }).count(), 0);
  await changeWallet(walletB);
  assert.equal(await main.getByText('Wrap USDC', { exact: true }).count(), 0);
  await main.getByText('Claim Yield', { exact: true }).waitFor();
  await changeWallet(walletA);
  await changeWallet(null);
  await main.getByText('Connect your wallet', { exact: true }).waitFor();
  await page.waitForTimeout(200);
  assert.equal(await main.getByText('Wrap USDC', { exact: true }).count(), 0);
  assert.equal(await main.getByText('Claim Yield', { exact: true }).count(), 0);
  const reads = activityReads;
  await page.reload();
  await main.getByText('Wrap USDC', { exact: true }).waitFor();
  assert.ok(activityReads > reads);

  await source.selectOption('ustry');
  await series.selectOption('testnet-ustry-2');
  await main.getByText('Alice testnet-ustry-2', { exact: true }).waitFor();
  await changeWallet(walletB);
  await main.getByText('Bob testnet-ustry-2', { exact: true }).waitFor();
  assert.equal(await main.getByText('Alice testnet-ustry-2', { exact: true }).count(), 0);
  await series.selectOption('testnet-ustry-1');
  await main.getByText('Bob testnet-ustry-1', { exact: true }).waitFor();
  assert.equal(await main.getByText('Bob testnet-ustry-2', { exact: true }).count(), 0);
  await changeWallet(null);
  await main.getByText('Connect your wallet', { exact: true }).waitFor();
  assert.equal(await main.getByText('Bob testnet-ustry-1', { exact: true }).count(), 0);

  // Bridging is a common acquisition page: source and series selection must not change it.
  async function bridgeOptions() {
    await main.getByText('Bridge to Stellar', { exact: true }).waitFor();
    assert.equal(await main.getByText('Unavailable for USTRY', { exact: true }).count(), 0);
    await main.getByText('Powered by Circle CCTP V2', { exact: true }).waitFor();
    await main.getByRole('button', { name: /^Standard/ }).waitFor();
    await main.getByRole('button', { name: /^Fast/ }).waitFor();
    const picker = main.locator('[data-slot="select-trigger"]').first();
    await picker.click();
    await page.getByRole('listbox').waitFor();
    const options = await page.getByRole('option').evaluateAll((items) => items.map((item) => ({
      label: item.textContent, disabled: item.getAttribute('aria-disabled'),
    })));
    await page.keyboard.press('Escape');
    return options;
  }
  await page.locator('aside nav').getByRole('button', { name: 'Bridge', exact: true }).click();
  await source.selectOption('blend');
  const sharedBridgeOptions = await bridgeOptions();
  assert.ok(sharedBridgeOptions.some((option) => option.label.includes('Ethereum Sepolia')));
  assert.ok(sharedBridgeOptions.some((option) => option.label.includes('Solana Devnet')));
  await source.selectOption('ustry');
  assert.deepEqual(await bridgeOptions(), sharedBridgeOptions);
  await series.selectOption('testnet-ustry-2');
  assert.deepEqual(await bridgeOptions(), sharedBridgeOptions);

  // Open Guide on USTRY, then change source in both directions while it remains active.
  await page.getByRole('button', { name: 'Restart App Tutorial', exact: true }).click();
  await title('Connect Your Wallet');
  await next();
  await title('Switch Blend / USTRY');
  await assertTarget('[data-tour="yield-source"]');
  // Trial clicks ensure the spotlight does not intercept the actual controls.
  await source.click({ trial: true });
  await source.selectOption('blend');
  await title('Switch Blend / USTRY');
  await source.click({ trial: true });
  await source.selectOption('ustry');
  await title('Switch Blend / USTRY');
  await next();
  await title('Choose Your Series');
  await series.click({ trial: true });
  await series.selectOption('testnet-ustry-2');
  await title('Choose Your Series');
  await series.focus();
  await page.keyboard.press('ArrowRight');
  await title('Choose Your Series');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/spield-guide-series-desktop.png' });
  const ustryTargets = ['overview-stats', 'deposit-panel', 'markets-panel', 'yield-panel', 'srwrap-panel', 'solvency-panel'];
  for (const target of ustryTargets) {
    await next();
    await assertTarget(`[data-tour="${target}"]`);
  }
  await tour.getByRole('button', { name: 'Finish', exact: true }).click();
  await tour.waitFor({ state: 'hidden' });

  await source.selectOption('blend');
  await page.getByRole('button', { name: 'Restart App Tutorial', exact: true }).click();
  await title('Connect Your Wallet');
  for (const target of ['yield-source', 'series-maturity', 'overview-stats', 'vault-panel', 'deposit-panel', 'markets-panel', 'yield-panel', 'liquidity-panel', 'solvency-panel']) {
    await next();
    await assertTarget(`[data-tour="${target}"]`);
  }
  await tour.getByRole('button', { name: 'Finish', exact: true }).click();
  await tour.waitFor({ state: 'hidden' });

  await page.setViewportSize({ width: 375, height: 812 });
  await source.selectOption('ustry');
  await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('button', { name: /^More/ }).click();
  await page.getByRole('button', { name: /App Tutorial & Interactive Guide/ }).click();
  await title('Connect Your Wallet');
  await next();
  await title('Switch Blend / USTRY');
  await source.click({ trial: true });
  await source.selectOption('blend');
  await title('Switch Blend / USTRY');
  await next();
  await title('Choose Your Series');
  await series.click({ trial: true });
  await series.selectOption('testnet-series-1');
  await title('Choose Your Series');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await assertTarget('[data-tour="series-maturity"]');
  await page.screenshot({ path: '/tmp/spield-guide-series-mobile.png' });
  await tour.getByRole('button', { name: 'Skip', exact: true }).click();
  await source.selectOption('ustry');
  await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('button', { name: /^More/ }).click();
  await page.getByRole('dialog', { name: 'All sections', exact: true }).getByRole('button', { name: 'Bridge', exact: true }).click();
  assert.deepEqual(await bridgeOptions(), sharedBridgeOptions);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: '/tmp/spield-shared-bridge-mobile.png' });
  assert.deepEqual(errors, [], 'Uncaught browser errors');
  console.log('PASS: Blend filters before limiting, hides other wallets and disconnected history; USTRY isolates wallet/series activity; shared bridge options match across sources/series on desktop and mobile; both complete tours target real panels; source/series switches keep the tour active on desktop and mobile.');
} catch (error) {
  await page.screenshot({ path: '/tmp/spield-activity-guide-failure.png' });
  throw error;
} finally {
  await browser.close();
  await server.close();
}
