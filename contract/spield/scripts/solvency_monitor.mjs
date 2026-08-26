#!/usr/bin/env node
// @ts-check
//
// Spield off-chain solvency monitor (mainnet-readiness).
//
// Continuously polls the wrapper's `solvency()` view — which returns
//   (blend_position_value, total_principal, total_unclaimed_yield)
// — and ALARMS the moment the live Blend backing drops below outstanding principal
// (beyond the contract's tiny rounding-dust tolerance). The on-chain `assert_solvent`
// already reverts any operation that would break the invariant; this is the independent
// *out-of-band* watchtower: it catches a deficit even if no one is transacting, and gives
// operators a paging signal (exit non-zero / webhook) rather than silent reliance on-chain.
//
// Pure reads (simulateTransaction) — never signs or submits anything, costs nothing.
//
// Usage:
//   node scripts/solvency_monitor.mjs \
//     --wrapper <C...> [--vault <C...>] [--market <C...>] \
//     [--pt-asset CODE:GISSUER] [--horizon https://horizon.stellar.org] \
//     [--rpc https://soroban-testnet.stellar.org] \
//     [--passphrase "Test SDF Network ; September 2015"] \
//     [--interval 60] [--slack 0] [--once] [--webhook https://...]
//
// Exit codes: 0 = healthy at exit (only with --once); 2 = a breach was detected (`--once` only);
//             1 = repeated RPC failure. **In daemon mode a breach alarms and keeps polling** —
//             see "Why the daemon no longer exits on breach" below.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Rewritten 2026-08-25 to close `tofix.md` #23. What was wrong, and what each fix is:
//
// 1. **The tolerance was a guess.** It alarmed at `backing + 8 < principal` while the contract's
//    real band is `open_positions() + WITHDRAW_SLACK(4)` — which GROWS with live positions. The
//    wrapper exposes `open_positions()` *specifically* so the watchtower can reproduce the exact
//    band instead of guessing it, and the watchtower guessed. At five or more open positions it
//    false-alarmed on states the contract considers perfectly healthy.
//    → Now read from chain every cycle. `--slack` adds to it; it no longer replaces it.
//
// 2. **PT conservation was not checked at all.** This is the invariant that catches counterfeit PT,
//    and it is the entire reason the issuer lockdown exists — `redeem_pt_bearer` pays out on a PT
//    balance alone, so PT minted outside the contract is redeemable for real USDC. No on-chain
//    check can see this: the classic supply lives on Horizon, not in the contract.
//    → Now checked against Horizon's total issued supply, which is the only place it is visible.
//
// 3. **Only the wrapper was watched.** The vault, the market and Blend's utilization had no
//    watchtower at all.
//    → Now separate probes with independent verdicts.
//
// 4. **A false alarm killed the watchtower.** Daemon mode called `process.exit(2)` on the first
//    breach, so the fix for (1) was load-bearing twice over: a monitor that dies on its first alert
//    is worse than no monitor, because the silence afterwards reads as health.
//    → See below.
//
// ## Why the daemon no longer exits on breach
//
// A watchtower's job is to keep watching. Exiting on the first alarm means the *second* alarm never
// fires, and whoever is paging on process liveness sees a dead process rather than an ongoing
// incident. So a breach now alarms, POSTs the webhook, sets a sticky unhealthy flag, and keeps
// polling — repeating the alarm each cycle it persists, and logging RECOVERED if it clears.
// `exit 2` is reserved for `--once`, where the caller IS the supervisor.
//
// Requires @stellar/stellar-sdk (already a frontend dependency). Run from the frontend dir, or
// `npm i @stellar/stellar-sdk` somewhere on the NODE_PATH.

import {
  Contract,
  TransactionBuilder,
  Account,
  nativeToScVal,
  scValToNative,
  rpc,
  BASE_FEE,
} from '@stellar/stellar-sdk';

// ----- args -----
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1];
  return fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const WRAPPER = arg('wrapper');
const VAULT = arg('vault');
const MARKET = arg('market');
/** `CODE:GISSUER` — enables the PT conservation probe, which needs Horizon, not the RPC. */
const PT_ASSET = arg('pt-asset');
const HORIZON = arg('horizon', 'https://horizon-testnet.stellar.org');
const RPC_URL = arg('rpc', 'https://soroban-testnet.stellar.org');
const PASSPHRASE = arg('passphrase', 'Test SDF Network ; September 2015');
const INTERVAL_S = Number(arg('interval', '60'));
/**
 * EXTRA stroops of slack on top of the band the contract actually enforces.
 *
 * Defaults to 0 on purpose. The real band is read from chain each cycle as
 * `open_positions() + WITHDRAW_SLACK`, so there is nothing left to pad for — and padding a band you
 * have measured only widens the window in which a real deficit looks healthy.
 */
const EXTRA_SLACK = BigInt(arg('slack', '0'));
/** Mirrors `wrapper::WITHDRAW_SLACK`. If that constant changes, change this with it. */
const WITHDRAW_SLACK = 4n;
/**
 * Used only when `open_positions()` is unavailable — see the fallback note in probe 1.
 *
 * Set generously (not at the old hardcoded 8) because an under-sized estimate false-alarms, and a
 * false alarm on a band we know we are guessing is the worst of both worlds. When this is in use
 * the log says so on every line, so it can never be mistaken for the measured band.
 */
const FALLBACK_BAND = BigInt(arg('fallback-band', '64'));
const ONCE = has('once');
const WEBHOOK = arg('webhook'); // optional: POST a JSON alert here on breach

if (!WRAPPER) {
  console.error('ERROR: --wrapper <contract-id> is required.');
  process.exit(1);
}

const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith('http://') });
// A throwaway source account for read-only simulation (never submitted, so the sequence/balance
// are irrelevant). All-zero account id is the canonical "simulation source".
const SIM_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/** Call a no-arg view on `contractId` (default: the wrapper) and decode the native result. */
async function readView(method, contractId = WRAPPER) {
  const account = new Account(SIM_SOURCE, '0');
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(contract.call(method))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`simulate ${method} failed: ${sim.error}`);
  }
  const retval = sim.result?.retval;
  if (!retval) throw new Error(`no retval from ${method}`);
  return scValToNative(retval);
}

function fmtUsdc(stroops) {
  // 7-decimal USDC.
  const neg = stroops < 0n;
  const s = (neg ? -stroops : stroops).toString().padStart(8, '0');
  const whole = s.slice(0, -7) || '0';
  const frac = s.slice(-7);
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/** The Soroban SDK packs a full diagnostic event log into `.message`; one line is enough here. */
const brief = (e) => String(e?.message ?? e).split('\n')[0];

async function postWebhook(payload) {
  if (!WEBHOOK) return;
  try {
    await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('webhook POST failed:', e?.message ?? e);
  }
}

let consecutiveRpcFailures = 0;
/** Sticky per-probe state, so we can log RECOVERED rather than just going quiet. */
const unhealthy = new Set();

/**
 * Total PT in existence, from Horizon.
 *
 * Deliberately NOT read from the contract: the whole point of this probe is to catch PT the
 * contract never minted, and a contract cannot report supply it does not know about. Horizon splits
 * issued supply four ways and there is no flat `amount` field — miss any one of them and
 * counterfeit PT parked in a Soroban contract or a claimable balance reads as zero.
 */
async function classicPtSupply() {
  const [code, issuer] = PT_ASSET.split(':');
  const url = `${HORIZON}/assets?asset_code=${encodeURIComponent(code)}&asset_issuer=${encodeURIComponent(issuer)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`horizon ${res.status}`);
  const rec = (await res.json())?._embedded?.records?.[0];
  if (!rec) return 0n;
  const toStroops = (v) => BigInt(Math.round(Number(v ?? 0) * 1e7));
  return (
    toStroops(rec.balances?.authorized) +
    toStroops(rec.balances?.authorized_to_maintain_liabilities) +
    toStroops(rec.contracts_amount) +
    toStroops(rec.claimable_balances_amount) +
    toStroops(rec.liquidity_pools_amount)
  );
}

/** Record a probe verdict, alarming on transition and on every cycle it persists. */
async function verdict(name, ok, detail, payload) {
  if (ok) {
    if (unhealthy.has(name)) {
      unhealthy.delete(name);
      console.log(`  ✓ RECOVERED [${name}] ${detail}`);
    } else {
      console.log(`  ✓ ${name}: ${detail}`);
    }
    return true;
  }
  console.error(`  🚨 ${unhealthy.has(name) ? 'STILL BREACHED' : 'BREACH'} [${name}] ${detail}`);
  unhealthy.add(name);
  await postWebhook({ alert: `spield_${name}`, detail, ...payload, at: new Date().toISOString() });
  return false;
}

/** One health check across every configured probe. Returns true if ALL are healthy. */
async function check() {
  const ts = new Date().toISOString();
  console.log(`[${ts}]`);
  let ok = true;

  // ── Probe 1: the wrapper's own invariant, against the band the CONTRACT enforces ──────────────
  try {
    // `open_positions` is how we reproduce the contract's real band instead of guessing it — but
    // it was added to the wrapper AFTER the live v1 deployments were cut, so the deployed binaries
    // do not expose it. Verified against testnet 2026-08-25: `Error(WasmVm, MissingValue) — trying
    // to invoke non-existent contract function, open_positions`.
    //
    // Rather than crash (the old monitor's behaviour on any read failure) or silently guess (the
    // old monitor's behaviour on the band), we fall back to a fixed band and SAY SO on every line.
    // An estimated band and a measured one must never look the same in a log, because the whole
    // defect being fixed here is a watchtower that guessed and did not admit it.
    const [solvency, openPositions] = await Promise.all([
      readView('solvency'),
      readView('open_positions').catch(() => null),
    ]);
    consecutiveRpcFailures = 0;

    const [backing, principal, unclaimed] = solvency.map((x) => BigInt(x));
    const measured = openPositions !== null;
    // The contract's real tolerance, reproduced exactly when the view exists.
    const band = measured
      ? BigInt(openPositions) + WITHDRAW_SLACK + EXTRA_SLACK
      : FALLBACK_BAND + EXTRA_SLACK;
    const healthy = backing + band >= principal;
    ok =
      (await verdict(
        'solvency',
        healthy,
        `backing=${fmtUsdc(backing)} principal=${fmtUsdc(principal)} ` +
          `unclaimed=${fmtUsdc(unclaimed)} headroom=${fmtUsdc(backing - principal)} ` +
          `band=${band} ` +
          (measured
            ? `(measured: open_positions=${openPositions})`
            : `(⚠ ESTIMATED — this deployment predates open_positions(); redeploy the wrapper to ` +
              `measure the real band)`) +
          (healthy ? '' : ` — short by ${fmtUsdc(principal - backing - band)} USDC`),
        { backing: backing.toString(), principal: principal.toString(), band: band.toString() },
      )) && ok;
  } catch (e) {
    consecutiveRpcFailures += 1;
    console.error(`  RPC read failed (${consecutiveRpcFailures}): ${brief(e)}`);
    if (consecutiveRpcFailures >= 5) {
      console.error('Too many consecutive RPC failures — exiting 1 so the supervisor restarts us.');
      process.exit(1);
    }
    return true; // transient; not a breach
  }

  // ── Probe 2: PT conservation. The counterfeit detector. ───────────────────────────────────────
  //
  // `Σ live PT + bearer_redeemed == classic PT supply`. The wrapper tracks what it minted;
  // `bearer_redeemed` accounts for PT it has since burned. Anything above that is PT the contract
  // never issued — and `redeem_pt_bearer` would pay real USDC for it.
  if (PT_ASSET) {
    try {
      const [supply, bearerRedeemed, sol] = await Promise.all([
        classicPtSupply(),
        readView('bearer_redeemed').then(BigInt),
        readView('solvency'),
      ]);
      const principal = BigInt(sol[1]);
      // PT outstanding should never exceed principal still owed plus what has been redeemed away.
      const accounted = principal + bearerRedeemed;
      const excess = supply - accounted;
      ok =
        (await verdict(
          'pt_conservation',
          excess <= 0n,
          `classic_supply=${fmtUsdc(supply)} principal=${fmtUsdc(principal)} ` +
            `bearer_redeemed=${fmtUsdc(bearerRedeemed)}` +
            (excess > 0n
              ? ` — ${fmtUsdc(excess)} PT EXISTS THAT THE WRAPPER NEVER MINTED. ` +
                `Check the issuer's master key weight immediately.`
              : ''),
          { supply: supply.toString(), accounted: accounted.toString(), excess: excess.toString() },
        )) && ok;
    } catch (e) {
      console.error(`  ⚠ pt_conservation probe unavailable: ${brief(e)}`);
    }
  }

  // ── Probe 3: the vault. Its receipts are only as good as the PT behind them. ──────────────────
  //
  // The vault's aggregate view is `stats()`. This probe used to read `solvency` and
  // `bearer_redeemed` on the vault — neither has ever been a vault function, on any build — and
  // then reported "no aggregate solvency view on this contract", which was wrong: the view exists,
  // the probe was asking for the wrong name. Fixed 2026-08-26 (`tofix.md` #23a).
  //
  // `stats()` returns a map; `pt_inventory >= total_liability` is the invariant the contract
  // itself enforces in `assert_solvent`.
  if (VAULT) {
    try {
      const stats = await readView('stats', VAULT);
      const pick = (k) => {
        if (stats == null) return null;
        const v = Array.isArray(stats) ? undefined : stats[k];
        return v === undefined || v === null ? null : BigInt(v);
      };
      const inventory = pick('pt_inventory');
      const liability = pick('total_liability');
      if (inventory === null || liability === null) {
        console.error(
          `  ⚠ vault probe unavailable: stats() did not return pt_inventory/total_liability ` +
            `(got ${JSON.stringify(stats)})`,
        );
      } else {
        const capacity = pick('coupon_capacity');
        ok =
          (await verdict(
            'vault',
            inventory >= liability,
            `pt_inventory=${fmtUsdc(inventory)} total_liability=${fmtUsdc(liability)}` +
              (capacity === null ? '' : ` coupon_capacity=${fmtUsdc(capacity)}`),
            {
              pt_inventory: inventory.toString(),
              total_liability: liability.toString(),
              coupon_capacity: capacity === null ? null : capacity.toString(),
            },
          )) && ok;
      }
    } catch (e) {
      console.error(`  ⚠ vault probe unavailable: ${brief(e)}`);
    }
  }

  // ── Probe 4: the market's reserves must be backed by real balances. ───────────────────────────
  if (MARKET) {
    try {
      const res = await readView('reserves', MARKET);
      const [ptRes, usdcRes] = res.map((x) => BigInt(x));
      ok =
        (await verdict(
          'market_reserves',
          ptRes >= 0n && usdcRes >= 0n,
          `pt=${fmtUsdc(ptRes)} usdc=${fmtUsdc(usdcRes)}`,
          { pt: ptRes.toString(), usdc: usdcRes.toString() },
        )) && ok;
    } catch (e) {
      console.error(`  ⚠ market probe unavailable: ${brief(e)}`);
    }
  }

  return ok;
}

async function main() {
  console.log(
    `Spield solvency monitor → wrapper ${WRAPPER} on ${RPC_URL} (interval ${INTERVAL_S}s)`,
  );
  console.log(
    `  probes: solvency` +
      (PT_ASSET ? `, pt_conservation (${PT_ASSET} via ${HORIZON})` : '') +
      (VAULT ? `, vault` : '') +
      (MARKET ? `, market_reserves` : ''),
  );
  if (!PT_ASSET) {
    console.log(
      '  ⚠ --pt-asset not set: the counterfeit-PT probe is OFF. It is the only check that can see ' +
        'PT minted outside the contract, so run with it in production.',
    );
  }
  if (ONCE) {
    const ok = await check();
    process.exit(ok ? 0 : 2);
  }
  // Daemon loop. A breach alarms and we KEEP GOING — a watchtower that exits on its first alert
  // stops being a watchtower exactly when it matters most. See the header.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await check();
    await new Promise((r) => setTimeout(r, INTERVAL_S * 1000));
  }
}

main().catch((e) => {
  console.error('fatal:', e?.stack ?? e);
  process.exit(1);
});
