// Exact, fail-closed checks for the read-only USTRY feasibility probe.
export const USTRY = Object.freeze({
  issuer: 'GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC',
  token: 'CBLV4ATSIWU67CFSQU2NVRKINQIKUZ2ODSZBUJTJ43VJVRSBTZYOPNUR',
  feed: 'CAEGYZFAJ3HLSDBUIVJ77SK5HLLS4MPE4LO5OB2W3L2TEDMAS6RCTMZ4',
  adapter: 'CA526Y2NQWGWVVQ7RFFPGAZMU66PSYJ3UC2MTVAV4ZU7OM5BOPHDXUSG',
  sep40: 'CBMGLKUQZVSAIL5CPDDAWSUY7MAKXISHMOZEVLMBUWBMFGHRJSR4WYRF',
});

export const PROBE_POLICY = Object.freeze({
  expectedDecimals: 8,
  maxAgeSeconds: 13 * 3600, // Published 12h heartbeat plus a 1h research tolerance, not an SLA.
  maxFutureSeconds: 60,
  maxNavDeviationBps: 10, // Research comparison tolerance; not an approved trading limit.
});

export function decimalToInteger(value, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error('Invalid decimals');
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid decimal string');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) {
    throw new Error('Price precision exceeds the declared decimals');
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.slice(0, decimals).padEnd(decimals, '0') || '0');
}

export function formatInteger(value, decimals) {
  const amount = BigInt(value);
  const sign = amount < 0n ? '-' : '';
  const digits = (amount < 0n ? -amount : amount).toString().padStart(decimals + 1, '0');
  return decimals ? `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : `${sign}${digits}`;
}

const integer = (value, name) => {
  if (!/^-?\d+$/.test(String(value))) throw new Error(`Invalid integer: ${name}`);
  return BigInt(value);
};

export function assessObservation(observation, policy = PROBE_POLICY) {
  const failures = [];
  const check = (ok, message) => { if (!ok) failures.push(message); };
  const { identity, direct, sep40, issuerCost, referenceTimeSeconds } = observation;
  check(identity.feedId === 'USTRY', 'Direct feed is not USTRY');
  check(identity.mappedFeed === 'USTRY', 'SEP-40 asset maps to a different feed');
  check(identity.token === USTRY.token, 'Unexpected USTRY token identity');
  check(identity.base?.[0] === 'Other' && identity.base?.[1] === 'USD', 'SEP-40 base is not USD');
  check(identity.assetListed === true, 'SEP-40 does not list the USTRY SAC');
  check(Number(identity.directDecimals) === policy.expectedDecimals, 'Direct feed decimals changed');
  check(Number(identity.sep40Decimals) === policy.expectedDecimals, 'SEP-40 decimals changed');
  check(issuerCost.token_symbol === 'USTRY' && issuerCost.token_kind === 'bond' && issuerCost.currency === 'USD',
    'Issuer price response has the wrong asset, kind or currency');
  if (!direct || !sep40) {
    failures.push('Missing direct or SEP-40 price');
    return { status: 'failed', failures };
  }

  const decimals = policy.expectedDecimals;
  const price = integer(sep40.price, 'SEP-40 price');
  const timestamp = integer(sep40.timestamp, 'SEP-40 timestamp');
  const directPrice = integer(direct.price, 'direct price');
  const packageMs = integer(direct.package_timestamp, 'package timestamp');
  const writeMs = integer(direct.write_timestamp, 'write timestamp');
  const now = integer(referenceTimeSeconds, 'reference time');
  const nav = decimalToInteger(issuerCost.token_cost_in_usd, decimals);
  check(price > 0n && directPrice > 0n && nav > 0n, 'Non-positive oracle or issuer price');
  check(price === directPrice, 'Direct feed and SEP-40 price disagree (or changed during sampling)');
  check(packageMs / 1000n === timestamp, 'Direct milliseconds and SEP-40 seconds disagree');
  check(writeMs >= packageMs, 'Write timestamp precedes the signed package');
  check(writeMs <= (now + BigInt(policy.maxFutureSeconds)) * 1000n, 'Write timestamp is in the future');
  check(timestamp <= now + BigInt(policy.maxFutureSeconds), 'Oracle timestamp is in the future');
  const age = now - timestamp;
  check(age <= BigInt(policy.maxAgeSeconds), 'Oracle observation is stale');
  const difference = price >= nav ? price - nav : nav - price;
  check(nav > 0n && difference * 10000n <= nav * BigInt(policy.maxNavDeviationBps), 'Oracle/issuer NAV deviation exceeds tolerance');

  // Provider history is chronological. Never assume the first entry is the latest.
  const history = [...(observation.history ?? [])].sort((a, b) => Number(BigInt(a.timestamp) - BigInt(b.timestamp)));
  check(history.length >= 2, 'Insufficient oracle history');
  let maxGap = 0n;
  for (let i = 0; i < history.length; i++) {
    const t = integer(history[i].timestamp, 'history timestamp');
    check(integer(history[i].price, 'history price') > 0n, 'Non-positive history price');
    check(t <= now + BigInt(policy.maxFutureSeconds), 'History contains a future timestamp');
    if (i) {
      const gap = t - BigInt(history[i - 1].timestamp);
      if (gap > maxGap) maxGap = gap;
    }
  }
  if (history.length) {
    const latest = history.at(-1);
    check(BigInt(latest.timestamp) === timestamp && BigInt(latest.price) === price,
      'History and latest price disagree (or changed during sampling)');
  }
  check(maxGap <= BigInt(policy.maxAgeSeconds), 'History contains a gap beyond the research freshness policy');
  return {
    status: failures.length ? 'failed' : 'technical_checks_passed',
    failures,
    priceUsd: formatInteger(price, decimals),
    issuerPriceUsd: formatInteger(nav, decimals),
    ageSeconds: age.toString(),
    packageToWriteDelayMs: (writeMs - packageMs).toString(),
    deviationBps: nav > 0n ? formatInteger(difference * 10000n * 1000000n / nav, 6) : null,
    historyRecords: history.length,
    maxHistoryGapSeconds: maxGap.toString(),
    // No result of this script establishes legal access, reserves, or guaranteed redemption.
    productionApproved: false,
  };
}
