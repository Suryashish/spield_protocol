import { Networks } from '@stellar/stellar-sdk';

/**
 * Map a network passphrase to the short name (`PUBLIC` / `TESTNET`) that several
 * wallet APIs expect, since they take a network name rather than a passphrase.
 */
export const networkNameFromPassphrase = (passphrase: string): string => {
  if (passphrase === Networks.PUBLIC) return 'PUBLIC';
  if (passphrase === Networks.TESTNET) return 'TESTNET';
  return passphrase;
};
