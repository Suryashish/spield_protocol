import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { DECIMALS, NETWORK } from './config';
import { signWithWallet } from './stellar';

/**
 * Low-level Soroban helpers shared by the contract clients.
 *
 * Reads are done by *simulating* a transaction (no signature, no fee) and decoding
 * the return value. Writes build a real transaction, simulate it to attach the
 * Soroban footprint/auth, hand it to the connected wallet to sign, then submit and
 * poll for the result. All amounts cross the boundary as `i128` in the underlying's
 * smallest unit (7 decimals).
 */

export const server = new rpc.Server(NETWORK.rpcUrl, { allowHttp: false });

const SCALE = 10n ** BigInt(DECIMALS);

/** Convert a human amount (e.g. "10.5") to a base-unit bigint (e.g. 105000000n). */
export const toBaseUnits = (amount: string | number): bigint => {
  const s = String(amount).trim();
  if (!s || Number.isNaN(Number(s))) return 0n;
  const neg = s.startsWith('-');
  const [whole, fracRaw = ''] = s.replace('-', '').split('.');
  const frac = (fracRaw + '0'.repeat(DECIMALS)).slice(0, DECIMALS);
  const value = BigInt(whole || '0') * SCALE + BigInt(frac || '0');
  return neg ? -value : value;
};

/** Convert a base-unit bigint to a human number for display/computation. */
export const fromBaseUnits = (units: bigint | number | string): number => {
  const v = BigInt(units);
  const sign = v < 0n ? -1 : 1;
  const abs = v < 0n ? -v : v;
  const whole = abs / SCALE;
  const frac = abs % SCALE;
  return sign * (Number(whole) + Number(frac) / Number(SCALE));
};

/** Format a base-unit amount as a `$1,234.56`-style USD string. */
export const formatUsd = (units: bigint | number | string, maxFrac = 2): string =>
  fromBaseUnits(units).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: maxFrac,
  });

/** Format a base-unit amount as a plain token quantity, e.g. `12.4200`. */
export const formatAmount = (units: bigint | number | string, frac = 4): string =>
  fromBaseUnits(units).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: frac,
  });

/** Build an i128 ScVal from a base-unit bigint. */
export const i128 = (v: bigint): xdr.ScVal => nativeToScVal(v, { type: 'i128' });

/** Build a u64 ScVal. */
export const u64 = (v: bigint | number): xdr.ScVal => nativeToScVal(BigInt(v), { type: 'u64' });

/** Build an address ScVal from a G… or C… string. */
export const addr = (a: string): xdr.ScVal => new Address(a).toScVal();

/**
 * Simulate a contract method and decode its return value to a native JS value.
 * Used for all read-only views (position_value, solvency, balance, …). Throws a
 * readable error if the simulation fails.
 */
export const readContract = async <T = unknown>(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
  /** Any funded account works as the simulation source; reads don't need the user. */
  source = 'GBNK7ZOQIZL3HM2LPY7WWJJL3C5YCOEUIJAF4UBSPIEWCEIC2HFSBVVI',
): Promise<T> => {
  const contract = new Contract(contractId);
  const account = new Account(source, '0');
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.passphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`${method} failed: ${sim.error}`);
  }
  const retval = sim.result?.retval;
  if (!retval) return undefined as T;
  return scValToNative(retval) as T;
};

export type WriteResult = {
  hash: string;
};

/**
 * Invoke a state-changing contract method: build → simulate (to attach footprint &
 * auth) → sign with the connected wallet → submit → poll until applied. Returns the
 * tx hash.
 *
 * `walletAddress` is the connected account; it both sources the tx and signs it. The
 * Soroban auth entries required by `user.require_auth()` are produced during
 * simulation and signed as part of the envelope by the wallet.
 */
export const writeContract = async (
  walletAddress: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<WriteResult> => {
  const contract = new Contract(contractId);
  const sourceAccount = await server.getAccount(walletAddress);

  const built = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.passphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();

  // Simulate to obtain the Soroban resource footprint + required auth, then bake
  // them into the transaction.
  const sim = await server.simulateTransaction(built);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(parseContractError(sim.error, method));
  }
  const prepared = rpc.assembleTransaction(built, sim).build();

  const { signedTxXdr, error } = await signWithWallet(prepared.toXDR(), {
    networkPassphrase: NETWORK.passphrase,
    address: walletAddress,
  });
  if (error) {
    throw new Error(error.message || 'Transaction was rejected in the wallet.');
  }

  const signed = TransactionBuilder.fromXDR(signedTxXdr, NETWORK.passphrase);
  const sent = await server.sendTransaction(signed);
  if (sent.status === 'ERROR') {
    throw new Error(`Submission failed: ${JSON.stringify(sent.errorResult)}`);
  }

  // Poll until the network applies (or rejects) the transaction.
  //
  // `getTransaction` can transiently throw (a 404 while the tx is still being
  // ingested) right after submission. If we let that propagate, the whole
  // tx lifecycle aborts *after* the user already signed — the success toast
  // never fires and the button stays stuck in its busy/spinner state ("nothing
  // happens"). So we swallow per-poll errors and keep polling; only a definitive
  // FAILED status or a real timeout ends the loop.
  const hash = sent.hash;
  for (let i = 0; i < 30; i++) {
    try {
      const result = await server.getTransaction(hash);
      if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return { hash };
      }
      if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`Transaction failed on-chain. See ${hash}`);
      }
      // NOT_FOUND → not yet ingested; fall through and retry.
    } catch (err) {
      // A definitive on-chain failure should surface; a transient lookup error
      // (not-yet-ingested) should not — keep polling in that case.
      if (err instanceof Error && err.message.startsWith('Transaction failed on-chain')) {
        throw err;
      }
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${hash} to confirm. Check the explorer for hash ${hash}.`);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Map raw simulation errors to friendlier messages for the most common cases. */
const parseContractError = (raw: string, method: string): string => {
  const text = raw || '';
  const lower = text.toLowerCase();

  if (text.includes('NotMatured')) {
    return 'PT can only be redeemed after maturity. Use “Combine & Redeem” to exit early.';
  }
  // Missing PT/YT trustline: minting a SAC to an account with no trustline panics
  // with the token contract's error #13 ("balance entry / trustline missing"). This
  // is the most common first-deposit failure, so map it to an actionable message.
  if (
    lower.includes('trustline') ||
    lower.includes('no trust') ||
    lower.includes('not authorized') ||
    /Error\(Contract, #1[13]\)/.test(text)
  ) {
    return 'Your wallet needs PT & YT trustlines first. Click “Enable PT & YT”, approve it, then deposit.';
  }
  // Underlying balance too low for the requested amount (SAC error #10).
  if (lower.includes('insufficient') || lower.includes('balance') || /Error\(Contract, #10\)/.test(text)) {
    return 'Insufficient USDC balance for this deposit.';
  }
  if (lower.includes('paused')) {
    return 'The protocol is currently paused.';
  }
  return `${method} simulation failed: ${text.slice(0, 200)}`;
};
