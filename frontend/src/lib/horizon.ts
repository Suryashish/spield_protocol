import {
  Asset,
  BASE_FEE,
  Horizon,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { signTransaction } from '@stellar/freighter-api';

import { ASSETS, NETWORK } from './config';

/**
 * Classic (non-Soroban) Stellar operations: trustline checks and `change_trust`.
 *
 * PT and YT are classic assets, so a holder needs a trustline to each before the
 * wrapper can mint them. Trustlines are a classic operation submitted through
 * Horizon, not the Soroban RPC.
 */

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
export const horizon = new Horizon.Server(HORIZON_URL);

export type TrustlineStatus = {
  /** True if the account trusts SPLDPT. */
  pt: boolean;
  /** True if the account trusts SPLDYT. */
  yt: boolean;
  /** True only when both trustlines exist (ready to receive a mint). */
  ready: boolean;
};

/** Read whether `address` already trusts the PT and YT assets. */
export const getTrustlines = async (address: string): Promise<TrustlineStatus> => {
  try {
    const account = await horizon.loadAccount(address);
    const has = (code: string, issuer: string) =>
      account.balances.some(
        (b) =>
          'asset_code' in b &&
          b.asset_code === code &&
          'asset_issuer' in b &&
          b.asset_issuer === issuer,
      );
    const pt = has(ASSETS.pt.code, ASSETS.pt.issuer);
    const yt = has(ASSETS.yt.code, ASSETS.yt.issuer);
    return { pt, yt, ready: pt && yt };
  } catch {
    // Unfunded / unreadable account: treat as no trustlines.
    return { pt: false, yt: false, ready: false };
  }
};

/**
 * Establish the PT and YT trustlines for `address` in a single transaction.
 * Only adds the trustlines that are missing. Signs with Freighter and submits
 * via Horizon. Returns the tx hash. No-op (returns null) if both already exist.
 */
export const setupTrustlines = async (address: string): Promise<{ hash: string } | null> => {
  const status = await getTrustlines(address);
  if (status.ready) return null;

  const account = await horizon.loadAccount(address);
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.passphrase,
  });

  if (!status.pt) {
    builder.addOperation(
      Operation.changeTrust({ asset: new Asset(ASSETS.pt.code, ASSETS.pt.issuer) }),
    );
  }
  if (!status.yt) {
    builder.addOperation(
      Operation.changeTrust({ asset: new Asset(ASSETS.yt.code, ASSETS.yt.issuer) }),
    );
  }

  const tx = builder.setTimeout(120).build();

  const { signedTxXdr, error } = await signTransaction(tx.toXDR(), {
    networkPassphrase: NETWORK.passphrase,
    address,
  });
  if (error) {
    throw new Error(error.message || 'Trustline setup was rejected in the wallet.');
  }

  const signed = TransactionBuilder.fromXDR(signedTxXdr, NETWORK.passphrase);
  const result = await horizon.submitTransaction(
    signed as Parameters<typeof horizon.submitTransaction>[0],
  );
  return { hash: result.hash };
};
