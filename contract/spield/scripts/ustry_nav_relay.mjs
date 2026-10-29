// Relays the Etherfuse sandbox USTRY NAV into a spield-ustry-nav oracle (testnet only — mainnet
// series read RedStone directly and need no relay).
//
//   node ustry_nav_relay.mjs --oracle C… [--key env:USTRY_PUBLISHER_SECRET | --key ustry-publisher]
//                            [--every 14400] [--sync C…[,C…]] [--loop]
//
// `--sync` folds each listed series after a publish. Series exits never read the feed, so this
// keeps their stored state current and a user's claim pays everything already published.
//
// One shot (default) is what a scheduler runs: exit 0 = published or not yet due, exit 1 = failed
// or the feed is close to stale, so the scheduler's failure alert is the staleness alarm.
// Running it more often than needed is harmless: the oracle rejects early or duplicate samples.
import { fetchNav } from './ustry_nav.mjs';
import { client, i128, keypair, stellarAsset, u32, u64 } from './ustry_v2.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const oracle = arg('oracle', process.env.USTRY_ORACLE);
const keySpec = arg('key', process.env.USTRY_PUBLISHER_SECRET ? 'env:USTRY_PUBLISHER_SECRET' : 'ustry-publisher');
const every = Number(arg('every', 4 * 3_600));
const warnAge = Number(arg('warn-age', 10 * 3_600));
const syncTargets = (arg('sync', process.env.USTRY_SERIES) ?? '').split(',').filter(Boolean);
if (!oracle) throw new Error('--oracle (or USTRY_ORACLE) is required');
const c = client('testnet');

async function once() {
  const kp = keypair(keySpec);
  const cfg = await c.view(oracle, 'config');
  if (cfg.publisher !== kp.publicKey())
    throw new Error(`Signer ${kp.publicKey()} is not the oracle publisher ${cfg.publisher}`);
  if (every < Number(cfg.min_interval)) throw new Error('--every is shorter than the oracle min_interval');
  const last = await c.view(oracle, 'lastprice', [stellarAsset(cfg.asset)]);
  const now = await c.ledgerTime();
  const age = now - Number(last.timestamp);
  const nav = await fetchNav();
  const moved = nav.price > last.price ? nav.price - last.price : last.price - nav.price;
  const deviated = moved * 1000n >= BigInt(last.price) && age >= 60;
  if (age < every && !deviated) {
    console.log(`healthy: last $${Number(last.price) / 1e8} ${(age / 3600).toFixed(2)}h ago; next due in ${((every - age) / 3600).toFixed(2)}h`);
    // Retry any sync a previous run missed; this only submits when a series lags the feed.
    await syncAll(kp);
    return;
  }
  const { hash } = await c.send(kp, oracle, 'publish', [i128(nav.price), u64(now)]);
  console.log(`published $${Number(nav.price) / 1e8} at ${now} (${hash}); previous was ${(age / 3600).toFixed(2)}h old`);
  await syncAll(kp);
}

async function syncAll(kp) {
  for (const series of syncTargets) {
    const st = await c.view(series, 'status');
    if (st.synced || st.state.finalized) continue;
    const { hash } = await c.send(kp, series, 'sync', []);
    console.log(`synced ${series.slice(0, 8)}… (${hash})`);
  }
}

async function health() {
  const cfg = await c.view(oracle, 'config');
  const last = await c.view(oracle, 'lastprice', [stellarAsset(cfg.asset)]);
  const age = (await c.ledgerTime()) - Number(last.timestamp);
  const count = (await c.view(oracle, 'prices', [stellarAsset(cfg.asset), u32(64)])).length;
  if (age > warnAge) throw new Error(`NAV is ${(age / 3600).toFixed(2)}h old (warn at ${warnAge / 3600}h)`);
  return { age, count };
}

if (process.argv.includes('--loop')) {
  for (;;) {
    try {
      await once();
      await health();
    } catch (e) {
      console.error(new Date().toISOString(), 'relay:', e.message);
    }
    await new Promise((r) => setTimeout(r, 60_000));
  }
} else {
  try {
    await once();
    const h = await health();
    console.log(`ok: ${h.count} samples retained, newest ${(h.age / 3600).toFixed(2)}h old`);
  } catch (e) {
    console.error('relay:', e.message);
    process.exitCode = 1;
  }
}
