// @ts-check
//
// Tests for the vault rate calibration (`blend_rate.mjs`).
//
// Run: node --test scripts/calibrate_vault_rate.test.mjs
//
// The two `REAL_*` fixtures are verbatim `get_reserve` / `get_config` payloads captured from the
// live pools on 2026-08-29, paired with the supply APR MEASURED on chain at the same moment by
// sampling b_rate over ~300s. They are the regression anchor: if the model ever stops reproducing
// a real pool's real rate, these fail here rather than in production.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  baseBorrowRate,
  calibrate,
  modelledSupplyApr,
  realizedSupplyApr,
  utilizationOf,
  IR_MOD_NEUTRAL,
  UTIL_SCALAR,
} from './blend_rate.mjs';

// ── Live fixtures ────────────────────────────────────────────────────────────────────────────────

/** mainnet FixedV2, USDC reserve. Measured supply APR at capture: 7.216%. */
const REAL_MAINNET = {
  config: { r_base: 300000, r_one: 400000, r_two: 1200000, r_three: 50000000, util: 8000000, max_util: 9000000 },
  data: {
    b_rate: '1142184973033', b_supply: '427162560415969',
    d_rate: '1226351302907', d_supply: '320725949543945',
    ir_mod: '14898806',
  },
  bstopRate: 2000000, // 20%
  measuredApr: 0.07216,
};

/** testnet TestnetV2, USDC reserve. Measured supply APR at capture: 0.214%. */
const REAL_TESTNET = {
  config: { r_base: 5000, r_one: 300000, r_two: 1000000, r_three: 10000000, util: 7000000, max_util: 9500000 },
  data: {
    b_rate: '1055957124297', b_supply: '1221838892618',
    d_rate: '1069384509171', d_supply: '848280948855',
    ir_mod: '1066935',
  },
  bstopRate: 1000000, // 10%
  measuredApr: 0.00214,
};

const spotOf = (f) => {
  const { util } = utilizationOf(f.data);
  return modelledSupplyApr(util, Number(f.data.ir_mod) / UTIL_SCALAR, f.config, f.bstopRate);
};

// ── The model reproduces reality ─────────────────────────────────────────────────────────────────

describe('the model reproduces the live pools', () => {
  test('mainnet FixedV2 modelled APR matches the measured APR', () => {
    const modelled = spotOf(REAL_MAINNET);
    assert.ok(
      Math.abs(modelled - REAL_MAINNET.measuredApr) < 0.0005,
      `modelled ${(modelled * 100).toFixed(4)}% vs measured ${(REAL_MAINNET.measuredApr * 100).toFixed(4)}%`,
    );
  });

  test('testnet TestnetV2 modelled APR matches the measured APR', () => {
    const modelled = spotOf(REAL_TESTNET);
    assert.ok(
      Math.abs(modelled - REAL_TESTNET.measuredApr) < 0.0005,
      `modelled ${(modelled * 100).toFixed(4)}% vs measured ${(REAL_TESTNET.measuredApr * 100).toFixed(4)}%`,
    );
  });

  test('utilization is derived from shares x rates, not raw share counts', () => {
    const { util } = utilizationOf(REAL_MAINNET.data);
    assert.ok(util > 0.80 && util < 0.81, `got ${util}`);
    // Dividing the raw share counts would give a materially different (wrong) answer.
    const naive = Number(REAL_MAINNET.data.d_supply) / Number(REAL_MAINNET.data.b_supply);
    assert.ok(Math.abs(naive - util) > 0.02, 'fixture must actually distinguish the two methods');
  });
});

// ── The rate curve ───────────────────────────────────────────────────────────────────────────────

describe('the borrow rate curve', () => {
  const cfg = REAL_MAINNET.config;

  test('is r_base at zero utilization and r_base + r_one at target', () => {
    assert.equal(baseBorrowRate(0, cfg), cfg.r_base / UTIL_SCALAR);
    const atTarget = baseBorrowRate(cfg.util / UTIL_SCALAR, cfg);
    assert.ok(Math.abs(atTarget - (cfg.r_base + cfg.r_one) / UTIL_SCALAR) < 1e-12);
  });

  test('is monotonic across both kinks', () => {
    let prev = -Infinity;
    for (let u = 0; u <= 1.0001; u += 0.01) {
      const r = baseBorrowRate(Math.min(u, 1), cfg);
      assert.ok(r >= prev, `rate fell at util ${u}`);
      prev = r;
    }
  });

  test('ramps steeply above the 95% kink', () => {
    assert.ok(baseBorrowRate(0.99, cfg) > 10 * baseBorrowRate(0.94, cfg));
  });

  test('supply APR is zero when nothing is borrowed', () => {
    assert.equal(modelledSupplyApr(0, 1, cfg, REAL_MAINNET.bstopRate), 0);
  });

  test('the backstop take reduces what suppliers receive', () => {
    const withTake = modelledSupplyApr(0.8, 1, cfg, 2000000);
    const noTake = modelledSupplyApr(0.8, 1, cfg, 0);
    assert.ok(Math.abs(withTake - noTake * 0.8) < 1e-12);
  });
});

describe('realizedSupplyApr', () => {
  test('annualizes b_rate growth', () => {
    // 1% growth over exactly a year is a 1% APR.
    const b0 = 1_000_000_000_000n;
    const b1 = 1_010_000_000_000n;
    assert.ok(Math.abs(realizedSupplyApr(b0, b1, 365 * 24 * 3600) - 0.01) < 1e-9);
  });

  test('reproduces the mainnet sample that was actually taken', () => {
    // The real 301s window measured during the investigation.
    const apr = realizedSupplyApr(1142185114010n, 1142185900709n, 301);
    assert.ok(Math.abs(apr - 0.07216) < 0.0005, `got ${apr}`);
  });

  test('is NaN for a non-positive window rather than dividing by zero', () => {
    assert.ok(Number.isNaN(realizedSupplyApr(1n, 2n, 0)));
  });
});

// ── The calibration rule ─────────────────────────────────────────────────────────────────────────

const calibrateFixture = (f, proposedBps, marginBps = 2500, yieldFeeBps = 500) => {
  const { util } = utilizationOf(f.data);
  return calibrate({
    utilNow: util,
    irModNow: Number(f.data.ir_mod) / UTIL_SCALAR,
    reserveConfig: f.config,
    bstopRate: f.bstopRate,
    yieldFeeBps,
    marginBps,
    proposedBps,
  });
};

describe('the calibration rule', () => {
  test('never assumes an input improves — ir_mod is capped at neutral, not raised to it', () => {
    const main = calibrateFixture(REAL_MAINNET, 300);
    const test_ = calibrateFixture(REAL_TESTNET, 300);
    // mainnet ir_mod 1.49 is pulled DOWN to 1.0...
    assert.equal(main.irModStress, IR_MOD_NEUTRAL);
    assert.ok(main.irModNow > IR_MOD_NEUTRAL);
    // ...but testnet's depressed 0.107 is NOT pulled up.
    assert.equal(test_.irModStress, test_.irModNow);
    assert.ok(test_.irModStress < IR_MOD_NEUTRAL);
  });

  test('utilization is likewise capped at target, never raised to it', () => {
    const main = calibrateFixture(REAL_MAINNET, 300);
    assert.equal(main.utilStress, main.utilTarget); // 80.63% -> 80%
    assert.ok(main.utilStress < main.utilNow);
  });

  test('the stressed rate is strictly below the spot rate on mainnet', () => {
    const r = calibrateFixture(REAL_MAINNET, 300);
    assert.ok(r.stressApr < r.spotApr, `${r.stressApr} !< ${r.spotApr}`);
  });

  test('300 bps PASSES on mainnet FixedV2 with real headroom', () => {
    const r = calibrateFixture(REAL_MAINNET, 300);
    assert.equal(r.verdict, 'PASS');
    assert.ok(r.maxSafeBps > 300, `max safe ${r.maxSafeBps} must exceed the proposal`);
    assert.ok(r.stressCoverage > 1, 'stress coverage must exceed 1x for a PASS');
  });

  test('the old hardcoded 500 bps does NOT pass on mainnet — the defect this check exists for', () => {
    const r = calibrateFixture(REAL_MAINNET, 500);
    assert.notEqual(r.verdict, 'PASS');
    // 500 bps exceeded even the zero-margin break-even under stress.
    assert.ok(r.breakEvenBps < 500, `break-even ${r.breakEvenBps} should be under 500`);
    assert.equal(r.verdict, 'FAIL');
  });

  test('300 bps FAILS on testnet, where Blend pays 0.2% — a subsidy, correctly flagged', () => {
    const r = calibrateFixture(REAL_TESTNET, 300);
    assert.equal(r.verdict, 'FAIL');
    assert.ok(r.stressCoverage < 0.1, `testnet coverage ${r.stressCoverage} should be far below 1x`);
  });

  test('WARN is the band between the margin ceiling and break-even', () => {
    const r = calibrateFixture(REAL_MAINNET, 300);
    const inBand = Math.floor((r.maxSafeBps + r.breakEvenBps) / 2);
    assert.ok(inBand > r.maxSafeBps && inBand <= r.breakEvenBps, 'fixture must produce a real band');
    assert.equal(calibrateFixture(REAL_MAINNET, inBand).verdict, 'WARN');
    assert.equal(calibrateFixture(REAL_MAINNET, r.maxSafeBps).verdict, 'PASS');
    assert.equal(calibrateFixture(REAL_MAINNET, r.breakEvenBps + 1).verdict, 'FAIL');
  });

  test('a bigger margin lowers the ceiling monotonically', () => {
    let prev = Infinity;
    for (const margin of [0, 1000, 2500, 4000, 6000]) {
      const r = calibrateFixture(REAL_MAINNET, 300, margin);
      assert.ok(r.maxSafeBps < prev, `margin ${margin} did not lower the ceiling`);
      prev = r.maxSafeBps;
    }
  });

  test('a bigger engine fee lowers the ceiling — the fee is charged before the vault sees yield', () => {
    const lo = calibrateFixture(REAL_MAINNET, 300, 2500, 0);
    const hi = calibrateFixture(REAL_MAINNET, 300, 2500, 1000);
    assert.ok(hi.maxSafeBps < lo.maxSafeBps);
  });

  test('the ceiling floors rather than rounds, so it never licences a rate the rule rejects', () => {
    const r = calibrateFixture(REAL_MAINNET, 300);
    assert.ok(r.maxSafeBps <= r.maxSafeApr * 10_000);
    assert.equal(r.maxSafeBps, Math.floor(r.maxSafeApr * 10_000));
    // The ceiling itself must pass; one bp above it must not.
    assert.equal(calibrateFixture(REAL_MAINNET, r.maxSafeBps).verdict, 'PASS');
    assert.notEqual(calibrateFixture(REAL_MAINNET, r.maxSafeBps + 1).verdict, 'PASS');
  });

  test('a 0 bps rate is trivially safe', () => {
    assert.equal(calibrateFixture(REAL_MAINNET, 0).verdict, 'PASS');
  });
});

// ── The property that actually matters ───────────────────────────────────────────────────────────

describe('self-funding property', () => {
  test('a PASS always means stressed net yield exceeds the promise', () => {
    for (const f of [REAL_MAINNET, REAL_TESTNET]) {
      for (const proposed of [0, 50, 100, 200, 300, 400, 500, 800, 1500]) {
        const r = calibrateFixture(f, proposed);
        if (r.verdict === 'PASS') {
          assert.ok(
            r.netStressApr * 10_000 >= proposed,
            `PASS at ${proposed} bps but stressed net is only ${r.netStressApr * 10_000} bps`,
          );
        }
        if (r.verdict === 'FAIL') {
          assert.ok(
            r.netStressApr * 10_000 < proposed,
            `FAIL at ${proposed} bps but stressed net ${r.netStressApr * 10_000} bps would fund it`,
          );
        }
      }
    }
  });
});
