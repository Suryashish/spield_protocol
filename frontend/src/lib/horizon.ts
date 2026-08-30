import {
  Asset,
  BASE_FEE,
  Horizon,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

import { NETWORK, SR_CONTRACTS } from './config';
import { signWithWallet } from './stellar';

/**
 * Classic (non-Soroban) Stellar operations: trustline checks and `change_trust`.
 *
 * PT and YT are classic assets, so a holder needs a trustline to each before the
 * wrapper can mint them. Trustlines are a classic operation submitted through
 * Horizon, not the Soroban RPC.
 */

// Horizon endpoint for the active network (testnet vs mainnet), from config.
export const horizon = new Horizon.Server(NETWORK.horizonUrl);

/**
 * Trustline readiness for receiving protocol tokens.
 *
 * Produced by `v2adapters.getTrustlines`, which is the only implementation left: v2's YT is a
 * *contract* token with no classic asset, so it reports `yt: true` unconditionally and `ready`
 * simply means "this wallet can receive what it is about to be sent".
 */
export type TrustlineStatus = {
  /** True if the account trusts the PT classic asset. */
  pt: boolean;
  /** Always true on v2 — YT is a contract token, so there is nothing to trust. */
  yt: boolean;
  /** True when the wallet can receive what it is about to be sent. */
  ready: boolean;
};

/**
 * Establish the **v2 (SR stack) PT** trustline for `address`.
 *
 * Deliberately separate from {@link setupTrustlines}, which adds v1's PT *and* YT. The v2 stack
 * needs neither of those:
 *
 * * Its PT is a different classic asset (a different code AND a different issuer), so v1's
 *   trustline does not help.
 * * Its **YT is a contract, not a classic asset** — there is nothing to trust, and asking a user to
 *   trust a non-existent asset would simply fail.
 *
 * The asset is read from `SR_CONTRACTS.ptAsset` as a `CODE:ISSUER` pair recorded at deploy time.
 * Never rebuild it from parts: getting the issuer wrong produces a trustline to a *different* asset
 * that silently never receives anything.
 *
 * Returns `null` when the trustline already exists.
 */
export const setupSrPtTrustline = async (
  address: string,
): Promise<{ hash: string } | null> => {
  if (!SR_CONTRACTS) throw new Error('Spield v2 is not deployed on this network.');
  const [code, issuer] = SR_CONTRACTS.ptAsset.split(':');
  if (!code || !issuer) throw new Error(`Malformed PT asset: ${SR_CONTRACTS.ptAsset}`);

  const account = await horizon.loadAccount(address);
  const already = account.balances.some(
    (b) =>
      'asset_code' in b && b.asset_code === code && 'asset_issuer' in b && b.asset_issuer === issuer,
  );
  if (already) return null;

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.passphrase,
  })
    .addOperation(Operation.changeTrust({ asset: new Asset(code, issuer) }))
    .setTimeout(120)
    .build();

  const { signedTxXdr, error } = await signWithWallet(tx.toXDR(), {
    networkPassphrase: NETWORK.passphrase,
    address,
  });
  if (error) {
    throw new Error(error.message || 'Trustline setup was rejected in the wallet.');
  }

  const signed = TransactionBuilder.fromXDR(signedTxXdr, NETWORK.passphrase);
  const result = await horizon.submitTransaction(signed as Parameters<typeof horizon.submitTransaction>[0]);
  return { hash: result.hash };
};
