import { Networks } from '@stellar/stellar-sdk';

/**
 * Spield v2 — on-chain configuration.
 *
 * These are the LIVE testnet deployments verified on 2026-06-05 against the real
 * Blend TestnetV2 pool (see `contract/spield/TESTNET.md`). The frontend reads
 * position/solvency state from the wrapper and submits mint/claim/redeem via
 * Freighter. Everything is testnet — no mainnet money is at risk.
 */

export const NETWORK = {
  /** Human-readable network name (matches what Freighter reports). */
  name: 'TESTNET',
  /** Passphrase the wallet must be on to sign our transactions. */
  passphrase: Networks.TESTNET,
  /** Soroban RPC endpoint used to simulate reads and submit writes. */
  rpcUrl: 'https://soroban-testnet.stellar.org',
  /** Block explorer for linking out to transactions / contracts. */
  explorer: 'https://stellar.expert/explorer/testnet',
} as const;

/** Deployed Spield contract + asset addresses (testnet). */
export const CONTRACTS = {
  /** The tokenization engine — the only contract the dashboard calls directly. */
  wrapper: 'CB32IGGJ4PKLUBMXJD2VSS3U55XX2U4AQCSKA6QPFGGWZDQBJXMIYZU5',
  /** Blend strategy adapter (read indirectly via the wrapper). */
  strategy: 'CBYFCJVZFGX7BIUQMWQ4WXOYC6HZYF7RLC3ZENY5GG6TL37QY5K5KMNA',
  /** Principal Token SAC — the fixed-rate bond leg. */
  pt: 'CAIC4Z6SUN4QGLIQ3CFS4447GMTBV3WJHWZLIDDAZFMUYWZXOIBPV4G2',
  /** Yield Token SAC — the variable yield leg. */
  yt: 'CDMEEJDXMKR7OH2JLX5OPXLRAGB3UBVEEH6NPTZOBYUPAINNH665V2H3',
  /** The underlying deposit asset: Blend testnet USDC (SAC). */
  usdc: 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU',
} as const;

/** USDC, PT and YT all use 7 decimals (Stellar standard / Blend testnet USDC). */
export const DECIMALS = 7;

/**
 * PT and YT are classic Stellar assets (wrapped as the SACs above). A holder must
 * establish a trustline to each before the wrapper can mint them — otherwise the
 * first `mint` fails. The dashboard offers a one-click trustline setup using these.
 */
export const PT_YT_ISSUER = 'GAG6EBUM6ERD5OIAJA53GEFRGS6UYUXHQBTPFTJDAY732Z5ERRRFNU24';

export const ASSETS = {
  pt: { code: 'SPLDPT', issuer: PT_YT_ISSUER },
  yt: { code: 'SPLDYT', issuer: PT_YT_ISSUER },
} as const;

/** Waitlist API URL */
export const BACKEND_URL = 'https://spield-protocol-waitlistbackend.vercel.app';

/** Token display metadata, keyed by contract address. */
export const TOKEN_META: Record<string, { symbol: string; label: string }> = {
  [CONTRACTS.usdc]: { symbol: 'USDC', label: 'USD Coin' },
  [CONTRACTS.pt]: { symbol: 'PT', label: 'Principal Token' },
  [CONTRACTS.yt]: { symbol: 'YT', label: 'Yield Token' },
};

/** Link to a contract on the testnet explorer. */
export const explorerContract = (id: string) => `${NETWORK.explorer}/contract/${id}`;

/** Link to a transaction on the testnet explorer. */
export const explorerTx = (hash: string) => `${NETWORK.explorer}/tx/${hash}`;
