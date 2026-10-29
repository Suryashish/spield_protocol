import { Networks } from '@stellar/stellar-sdk';
import { getActiveSeriesId, NETWORK, NETWORK_KEY } from './config';
import type { SeriesConfig, UstryContractSet } from './series';
import { addr, i128, readContract, writeContract } from './soroban';

export const FACTOR_SCALE = 1_000_000_000_000_000_000n;
export type Observation = { price: bigint; timestamp: bigint };
export type UstryState = {
  high_water: bigint;
  factor: bigint;
  cursor: number;
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
};
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
  if (
    series.source !== 'ustry' ||
    series.network !== 'testnet' ||
    NETWORK_KEY !== 'testnet' ||
    NETWORK.passphrase !== Networks.TESTNET ||
    !series.ustry
  )
    throw new Error('USTRY is configured only for Stellar testnet.');
  return series.ustry;
}
export async function readUstry(
  series: SeriesConfig,
  address: string | null,
): Promise<UstrySnapshot> {
  const c = ustryContracts(series);
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
  if (
    cfg.asset !== c.asset ||
    cfg.oracle !== c.oracle ||
    Number(cfg.expiry) !== series.expiry ||
    Number(cfg.max_age) !== c.maxAge ||
    cfg.tokens.join() !== [c.receipt, c.pt, c.yt].join()
  )
    throw new Error('On-chain series identity differs from app configuration.');
  let state = stored;
  let syncError: string | null = null;
  try {
    if (!stored.finalized) state = await readContract<UstryState>(c.series, 'sync');
  } catch (error) {
    syncError = error instanceof Error ? error.message : 'NAV synchronization unavailable';
  }
  const navAvailable = !!history?.length;
  if (!navAvailable && !stored.finalized) syncError ??= 'NAV history unavailable.';
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
