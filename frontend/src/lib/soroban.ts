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
import { DECIMALS, NETWORK, RPC_URLS, RPC_WRITE_URLS } from './config';
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

/**
 * How long any single RPC call may hang before we give up on that endpoint.
 *
 * A timeout, not just an error handler: the failure mode that produced "Couldn't reach the network"
 * was usually a socket that never answered rather than one that refused. Without a deadline the
 * request sits open forever and no fallback is ever reached.
 */
const RPC_TIMEOUT_MS = 15_000;

/** After this long on a fallback, try the primary again — a blip should not demote it forever. */
const STICKY_MS = 5 * 60_000;

const readPool = RPC_URLS.map((url) => new rpc.Server(url, { allowHttp: false }));

/**
 * A separate pool for writes, ordered by {@link RPC_WRITE_URLS} — dedicated endpoint first.
 * Kept separate (rather than reusing the read pool's sticky index) so a read failing over does not
 * drag the write path onto a load-balanced endpoint, which is the one thing writes cannot tolerate.
 */
const writePool = RPC_WRITE_URLS.map((url) => new rpc.Server(url, { allowHttp: false }));

let activeIdx = 0;
let activeSince = 0;
let writeIdx = 0;
let writeSince = 0;

/**
 * Is this a transport failure (retry elsewhere) or a real answer (do not)?
 *
 * The distinction matters: a simulation that reverts, a malformed transaction, an account that does
 * not exist — those are *answers*. Asking a second endpoint the same question returns the same
 * answer, one timeout later. Only unreachability, rate limits and 5xx are worth failing over.
 */
const isTransportFailure = (e: unknown): boolean => {
  if (e == null) return false;
  const err = e as { response?: { status?: number }; status?: number; message?: string };
  const status = err.response?.status ?? err.status;
  if (typeof status === 'number') return status === 429 || status >= 500;
  const msg = String(err.message ?? e).toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('fetch failed') ||
    msg.includes('load failed') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('aborted') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound')
  );
};

const withTimeout = <T>(work: Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('RPC timed out')), RPC_TIMEOUT_MS);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });

/**
 * Run `op` against the healthiest endpoint, walking the pool on transport failures.
 *
 * Whichever endpoint answers becomes sticky, so a degraded primary costs one timeout rather than one
 * per call. Failing over a `sendTransaction` is safe on Stellar: the hash is deterministic from the
 * signed envelope, so a resubmission either lands the same transaction or is rejected as a
 * duplicate — it cannot produce two.
 */
const walk = async <T>(
  servers: rpc.Server[],
  start: number,
  onStick: (idx: number) => void,
  op: (s: rpc.Server) => Promise<T>,
): Promise<T> => {
  let lastErr: unknown = new Error('No RPC endpoint configured');
  for (let i = 0; i < servers.length; i++) {
    const idx = (start + i) % servers.length;
    try {
      const out = await withTimeout(op(servers[idx]));
      if (idx !== start) onStick(idx);
      return out;
    } catch (e) {
      if (!isTransportFailure(e)) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
};

const failover = <T>(op: (s: rpc.Server) => Promise<T>): Promise<T> => {
  if (activeIdx !== 0 && Date.now() - activeSince > STICKY_MS) activeIdx = 0;
  return walk(readPool, activeIdx, (i) => {
    activeIdx = i;
    activeSince = Date.now();
  }, op);
};

/** Same, over the write pool. Used by {@link writeContract} for every call in a transaction flow. */
const failoverWrite = <T>(op: (s: rpc.Server) => Promise<T>): Promise<T> => {
  if (writeIdx !== 0 && Date.now() - writeSince > STICKY_MS) writeIdx = 0;
  return walk(writePool, writeIdx, (i) => {
    writeIdx = i;
    writeSince = Date.now();
  }, op);
};

/**
 * The Soroban RPC client, with automatic failover across {@link RPC_URLS}.
 *
 * Exposes exactly the methods the app uses. It is a plain object rather than an `rpc.Server`
 * subclass because nothing passes `server` around as a value — only its methods are called.
 */
export const server = {
  getAccount: (...a: Parameters<rpc.Server['getAccount']>) => failover((s) => s.getAccount(...a)),
  getEvents: (...a: Parameters<rpc.Server['getEvents']>) => failover((s) => s.getEvents(...a)),
  getFeeStats: (...a: Parameters<rpc.Server['getFeeStats']>) => failover((s) => s.getFeeStats(...a)),
  getLatestLedger: (...a: Parameters<rpc.Server['getLatestLedger']>) =>
    failover((s) => s.getLatestLedger(...a)),
  getTransaction: (...a: Parameters<rpc.Server['getTransaction']>) =>
    failover((s) => s.getTransaction(...a)),
  sendTransaction: (...a: Parameters<rpc.Server['sendTransaction']>) =>
    failover((s) => s.sendTransaction(...a)),
  simulateTransaction: (...a: Parameters<rpc.Server['simulateTransaction']>) =>
    failover((s) => s.simulateTransaction(...a)),
};

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

/** Build a u32 ScVal. */
export const u32 = (v: number): xdr.ScVal => nativeToScVal(v, { type: 'u32' });

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
/**
 * **Simulate a value-moving entry point and return what it would actually pay.**
 *
 * The `quote_*` views cannot synchronize SR — they are views, and a view cannot write. So they
 * price on SR's stored high-water rate, which lags whenever nothing has synced since the last
 * mutation. The real entry points *do* synchronize (`FINAL_CHECK.md` V2-01), which means a quote
 * can OVERSTATE a sale: size `min_out` from it and the trade reverts on its own slippage bound.
 *
 * Simulating the real function instead runs the same synchronized code path the submission will,
 * so the number it returns is the number that executes. Nothing is signed and nothing is sent —
 * `simulateTransaction` only evaluates.
 *
 * Returns `null` when the simulation cannot run (insufficient balance, a route the pool cannot
 * fill, an older deployment); callers fall back to the view rather than blocking the trade.
 */
export const simulateCall = async (
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  /** The real user — the amounts and balances the trade depends on are theirs. */
  invoker: string,
): Promise<bigint | null> => {
  try {
    const contract = new Contract(contractId);
    // The sequence number is irrelevant to simulation; the RPC never checks it.
    const tx = new TransactionBuilder(new Account(invoker, '0'), {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.passphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) return null;
    const retval = sim.result?.retval;
    if (!retval) return null;
    const native = scValToNative(retval);
    return typeof native === 'bigint' ? native : BigInt(String(native));
  } catch {
    return null;
  }
};

/**
 * The **inclusion fee** to bid, in stroops — what buys a slot in the ledger.
 *
 * A Soroban transaction's fee has two parts: the resource fee (computed by simulation, non-negotiable)
 * and the inclusion fee (a surge-priced auction). `assembleTransaction` fills in the first and leaves
 * the second at whatever the builder was given.
 *
 * That used to be `BASE_FEE` — **100 stroops**. Measured against live mainnet, the Soroban inclusion
 * fee over the last 50 ledgers ran `min 100, p50 200, p90 200, max 200`: every percentile above the
 * bid. Underbid transactions are simply not included; they sit until the transaction expires and the
 * app reports a timeout it cannot explain. That is the "deposit / liquidity / vault all time out on
 * mainnet, but other apps are fast" report — other apps bid the market rate.
 *
 * Testnet never showed it because there is nothing to outbid there.
 *
 * The floor is deliberately ~50x the observed market rate. At 0.001 XLM it is roughly 6% on top of a
 * typical resource fee, which is nothing next to a failed deposit, and Stellar's surge pricing
 * charges the clearing rate rather than the full bid.
 */
const INCLUSION_FEE_FLOOR = 10_000n;
/** Ceiling, so a bad stats response can never turn into a wildly overpriced transaction. */
const INCLUSION_FEE_CAP = 200_000n;

let feeCache: { at: number; fee: string } | null = null;

const inclusionFee = async (): Promise<string> => {
  if (feeCache && Date.now() - feeCache.at < 30_000) return feeCache.fee;
  let bid = INCLUSION_FEE_FLOOR;
  try {
    const stats = await failoverWrite((srv) => srv.getFeeStats());
    const p90 = BigInt(stats.sorobanInclusionFee?.p90 ?? '0');
    const surge = p90 * 5n;
    if (surge > bid) bid = surge;
  } catch {
    // Fee stats are an optimisation, not a dependency — the floor already clears the market.
  }
  if (bid > INCLUSION_FEE_CAP) bid = INCLUSION_FEE_CAP;
  const fee = bid.toString();
  feeCache = { at: Date.now(), fee };
  return fee;
};

/**
 * The account sequence each address last built a transaction on.
 *
 * Multi-step flows (`buildMintSteps`, `buildAddLiquiditySteps`) submit two transactions back to
 * back. Step 2 must not build until the ledger reflects step 1, or it reuses the same sequence and
 * is rejected — which is precisely the "first attempt fails, retrying works" report from the Deposit
 * and Liquidity pages, the only two panels that run more than one transaction.
 */
const lastUsedSeq = new Map<string, bigint>();

/**
 * Load the account, waiting until its sequence has actually moved past the last one we consumed.
 *
 * Confirming a transaction is not the same as the account reflecting it: `getTransaction` and
 * `getAccount` can be answered by different nodes behind one URL, and even a single node updates
 * its indexes a moment apart. Polling here is far better than letting the user sign a transaction
 * that is already invalid.
 */
const freshAccount = async (address: string): Promise<Account> => {
  const prev = lastUsedSeq.get(address);
  let acc = await failoverWrite((srv) => srv.getAccount(address));
  if (prev == null) return acc;
  for (let i = 0; i < 12 && BigInt(acc.sequenceNumber()) <= prev; i++) {
    await sleep(500);
    acc = await failoverWrite((srv) => srv.getAccount(address));
  }
  return acc;
};

export const writeContract = async (
  walletAddress: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<WriteResult> => {
  const contract = new Contract(contractId);
  const [sourceAccount, fee] = await Promise.all([freshAccount(walletAddress), inclusionFee()]);

  const built = new TransactionBuilder(sourceAccount, {
    fee,
    networkPassphrase: NETWORK.passphrase,
  })
    .addOperation(contract.call(method, ...args))
    // 180s, not 60. This is the window the SIGNED transaction stays valid, and the clock starts
    // before the wallet prompt opens. A first-time user reading a Freighter dialog can easily burn
    // 60s, after which the transaction expires and the submission fails for a reason that looks
    // nothing like "you took too long".
    .setTimeout(180)
    .build();

  // Remember the sequence this flow consumed, so the NEXT write waits for the ledger to reflect it
  // rather than racing ahead on a stale read. See `freshAccount`.
  lastUsedSeq.set(walletAddress, BigInt(sourceAccount.sequenceNumber()));

  // Simulate to obtain the Soroban resource footprint + required auth, then bake
  // them into the transaction.
  const sim = await failoverWrite((srv) => srv.simulateTransaction(built));
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
  const sent = await failoverWrite((srv) => srv.sendTransaction(signed));
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
      const result = await failoverWrite((srv) => srv.getTransaction(hash));
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
    return 'Your wallet needs a PT trustline first. Click “Enable PT”, approve it, then deposit. (YT needs no trustline — it is a contract, not a classic asset.)';
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
