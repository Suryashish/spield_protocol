import { Address, Networks, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { getActiveSeriesId, NETWORK, NETWORK_KEY } from './config';
import type { SeriesConfig, UstryContractSet } from './series';
import { addr, i128, readContract, writeContract } from './soroban';
const u32 = (n: number) => nativeToScVal(n, { type: 'u32' });

export const FACTOR_SCALE = 1_000_000_000_000_000_000n;
export type Observation = { price: bigint; timestamp: bigint };
export type UstryState = {
  high_water: bigint;
  factor: bigint;
  /** v1 only. v2 folds by timestamp and has no cursor. */
  cursor?: number;
  last_observation: Observation;
  finalized: boolean;
  receipts: bigint;
  face: bigint;
  backing: bigint;
  total_yt: bigint;
};
export type Holding = { receipt: bigint; pt: bigint; yt: bigint; factor: bigint; accrued: bigint };
export type UstrySnapshot = {
  state: UstryState;
  holding: Holding;
  custody: bigint;
  paused: boolean;
  latest: Observation;
  history: Observation[];
  navAvailable: boolean;
  settledOnChain: boolean;
  syncError: string | null;
  readAt: number;
  version: 1 | 2;
  /** Whether a split would be accepted right now (v2: the contract's own answer). */
  entryOpen: boolean;
  /** Whether the newest folded NAV is inside the series' freshness limit. */
  fresh: boolean;
  /** Whether `finalize` would succeed now. */
  finalizable: boolean;
  /** Whether exits (combine, claim, YT transfer) need a fresh NAV. True only for Series 1. */
  exitsNeedNav: boolean;
  /** Deposit ceiling on receipts + backing, token units. */
  cap: bigint;
};
type V2Status = {
  state: UstryState;
  oracle_ok: boolean;
  fresh: boolean;
  entry_open: boolean;
  boundary_seen: boolean;
  finalizable: boolean;
};
/** SEP-40 `Asset::Stellar(address)`, the key both RedStone and spield-ustry-nav use. */
const sep40Asset = (contract: string) =>
  xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Stellar'), new Address(contract).toScVal()]);
export function capUnits(c: UstryContractSet): bigint {
  if (c.version === 2) return BigInt(c.cap ?? '0');
  return BigInt(c.capUstry ?? 0) * 10_000_000n;
}
export function quantity(value: string): bigint {
  if (!/^\d+(\.\d{1,7})?$/.test(value))
    throw new Error('Enter a positive amount with at most 7 decimals.');
  const [whole, fraction = ''] = value.split('.');
  const n = BigInt(whole) * 10_000_000n + BigInt((fraction + '0000000').slice(0, 7));
  if (n <= 0n || n > (1n << 127n) - 1n) throw new Error('Amount outside supported range.');
  return n;
}
export function units(value: bigint, decimals = 7): string {
  const sign = value < 0n ? '-' : '';
  const n = value < 0n ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const fraction = (n % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return sign + (n / scale).toString() + (fraction ? '.' + fraction : '');
}
export function ustryContracts(series: SeriesConfig): UstryContractSet {
  const passphrase = series.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
  if (
    series.source !== 'ustry' ||
    !series.ustry ||
    series.network !== NETWORK_KEY ||
    NETWORK.passphrase !== passphrase ||
    // Series 1 predates the SEP-40 design and only ever existed on testnet.
    (series.ustry.version !== 2 && series.network !== 'testnet')
  )
    throw new Error(`This USTRY series is not available on ${NETWORK.name}.`);
  return series.ustry;
}
const EMPTY_HOLDING: Holding = { receipt: 0n, pt: 0n, yt: 0n, factor: 0n, accrued: 0n };
type ChainConfig = {
  asset: string;
  oracle: string;
  expiry: bigint;
  max_age: bigint;
  paused: boolean;
  tokens: string[];
  cap?: bigint;
};
function assertIdentity(cfg: ChainConfig, c: UstryContractSet, series: SeriesConfig) {
  if (
    cfg.asset !== c.asset ||
    cfg.oracle !== c.oracle ||
    Number(cfg.expiry) !== series.expiry ||
    Number(cfg.max_age) !== c.maxAge ||
    cfg.tokens.join() !== [c.receipt, c.pt, c.yt].join()
  )
    throw new Error('On-chain series identity differs from app configuration.');
}
/** v2: one `status()` simulation says what the next call would see — fold, freshness, entry,
 *  finalizability — so the app never re-derives contract rules it could get wrong. */
async function readUstryV2(
  series: SeriesConfig,
  c: UstryContractSet,
  address: string | null,
): Promise<UstrySnapshot> {
  const [cfg, status, records, custody, holding] = await Promise.all([
    readContract<ChainConfig>(c.series, 'config'),
    readContract<V2Status>(c.series, 'status'),
    readContract<Observation[] | null>(c.oracle, 'prices', [sep40Asset(c.asset), u32(64)]).catch(
      () => null,
    ),
    readContract<bigint>(c.asset, 'balance', [addr(c.series)]),
    address
      ? readContract<Holding>(c.series, 'balance', [addr(address)])
      : Promise.resolve(EMPTY_HOLDING),
  ]);
  assertIdentity(cfg, c, series);
  const history = [...(records ?? [])].sort((a, b) => Number(a.timestamp - b.timestamp));
  return {
    state: status.state,
    holding,
    custody,
    paused: cfg.paused,
    latest: history.at(-1) ?? status.state.last_observation,
    history: history.length ? history : [status.state.last_observation],
    navAvailable: status.oracle_ok,
    settledOnChain: status.state.finalized,
    syncError: status.oracle_ok || status.state.finalized ? null : 'NAV feed unavailable.',
    readAt: Date.now(),
    version: 2,
    entryOpen: status.entry_open,
    fresh: status.fresh,
    finalizable: status.finalizable,
    exitsNeedNav: false,
    cap: BigInt(cfg.cap ?? capUnits(c)),
  };
}
export async function readUstry(
  series: SeriesConfig,
  address: string | null,
): Promise<UstrySnapshot> {
  const c = ustryContracts(series);
  if (c.version === 2) return readUstryV2(series, c, address);
  const [cfg, stored, history, custody, holding] = await Promise.all([
    readContract<{
      asset: string;
      oracle: string;
      expiry: bigint;
      max_age: bigint;
      paused: boolean;
      tokens: string[];
    }>(c.series, 'config'),
    readContract<UstryState>(c.series, 'state'),
    readContract<Observation[]>(c.oracle, 'observations').catch(() => null),
    readContract<bigint>(c.asset, 'balance', [addr(c.series)]),
    address
      ? readContract<Holding>(c.series, 'balance', [addr(address)])
      : Promise.resolve({ receipt: 0n, pt: 0n, yt: 0n, factor: 0n, accrued: 0n }),
  ]);
  assertIdentity(cfg, c, series);
  let state = stored;
  let syncError: string | null = null;
  try {
    if (!stored.finalized) state = await readContract<UstryState>(c.series, 'sync');
  } catch (error) {
    syncError = error instanceof Error ? error.message : 'NAV synchronization unavailable';
  }
  const navAvailable = !!history?.length;
  if (!navAvailable && !stored.finalized) syncError ??= 'NAV history unavailable.';
  const latest = history?.at(-1) ?? stored.last_observation;
  const now = Date.now() / 1000;
  const fresh = Number(latest.timestamp) <= now + 30 && now - Number(latest.timestamp) <= c.maxAge;
  return {
    state,
    holding,
    custody,
    paused: cfg.paused,
    latest: history?.at(-1) ?? stored.last_observation,
    history: history ?? [stored.last_observation],
    navAvailable,
    settledOnChain: stored.finalized,
    syncError,
    readAt: Date.now(),
    version: 1,
    entryOpen:
      !syncError && fresh && !cfg.paused && now < series.expiry && latest.price >= state.high_water,
    fresh,
    finalizable: state.finalized && !stored.finalized,
    exitsNeedNav: true,
    cap: capUnits(c),
  };
}
export async function writeUstry(
  series: SeriesConfig,
  wallet: string,
  method: string,
  amount?: bigint,
  minimum = 0n,
) {
  const c = ustryContracts(series);
  if (getActiveSeriesId() !== series.id) throw new Error('Series changed. Review your selection.');
  const args = [addr(wallet)];
  if (amount !== undefined) args.push(i128(amount));
  if (['deposit_split', 'split', 'redeem'].includes(method)) args.push(i128(minimum));
  if (
    !['deposit', 'deposit_split', 'split', 'redeem', 'withdraw_receipts', 'claim_yield'].includes(
      method,
    )
  )
    throw new Error('Unsupported USTRY action.');
  return writeContract(wallet, c.series, method, args, formatUstrySimulationError);
}
export function entitlement(h: Holding, state: UstryState): bigint {
  return (
    h.accrued + (h.factor > state.factor ? (h.yt * (h.factor - state.factor)) / FACTOR_SCALE : 0n)
  );
}

// RWA engine error codes overlap with both Blend and SAC error codes. Preserve
// the original code without incorrectly instructing users to add a Blend PT line.
export function formatUstrySimulationError(raw: string, method: string): string {
  return `USTRY ${method.replaceAll('_', ' ')} was rejected. Refresh the series and check balances, NAV, minimum output and the USTRY trustline. ${raw.slice(0, 160)}`;
}
