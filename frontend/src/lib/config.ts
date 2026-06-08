import { Networks } from '@stellar/stellar-sdk';

/**
 * Spield v2 — on-chain configuration (env-driven, multi-network).
 *
 * The active network is chosen by the `VITE_NETWORK` build-time env var
 * (`testnet` | `mainnet`, default `testnet`). For each network we ship the known
 * deployed addresses as defaults, and every value can be overridden via `VITE_*`
 * env vars (see `.env.example`) — so the same build supports both testnet (staging)
 * and mainnet (production) just by changing the env.
 *
 * Everything below keeps the SAME export names/shapes the rest of the app already
 * imports (`NETWORK`, `CONTRACTS`, `ASSETS`, `DECIMALS`, `VAULT_DEPLOYED`,
 * `MARKET_DEPLOYED`, `explorerTx`, …) — only how the values are sourced changed.
 */

/** Supported networks. The string also drives explorer paths + wallet checks. */
export type NetworkKey = 'testnet' | 'mainnet';

type NetworkMeta = {
  /** Key used internally + for env selection. */
  key: NetworkKey;
  /**
   * Network name as the WALLET reports it (Freighter et al. return `PUBLIC` /
   * `TESTNET`). `WalletContext.onCorrectNetwork` compares against this exactly, so
   * it MUST match the wallet's value — mainnet is `PUBLIC`, not `MAINNET`.
   */
  name: 'PUBLIC' | 'TESTNET';
  /** Passphrase the wallet must be on to sign our transactions. */
  passphrase: string;
  /** Soroban RPC endpoint used to simulate reads and submit writes. */
  rpcUrl: string;
  /** Horizon endpoint used for classic ops (trustlines). */
  horizonUrl: string;
  /** Block explorer base for linking out to txs / contracts. */
  explorer: string;
};

type ContractSet = {
  wrapper: string;
  strategy: string;
  vault: string;
  market: string;
  pt: string;
  yt: string;
  usdc: string;
};

type NetworkProfile = NetworkMeta & {
  contracts: ContractSet;
  /** PT/YT classic-asset issuer (G-address) for this network's trustlines. */
  ptYtIssuer: string;
};

/** Read a `VITE_*` env var, falling back to a default when unset/empty. */
const env = (key: string, fallback: string): string => {
  const v = import.meta.env[key as keyof ImportMetaEnv] as string | undefined;
  return v && v.length > 0 ? v : fallback;
};

/** Per-network defaults (the verified live deployments). Overridable via env. */
const PROFILES: Record<NetworkKey, NetworkProfile> = {
  testnet: {
    key: 'testnet',
    name: 'TESTNET',
    passphrase: Networks.TESTNET,
    rpcUrl: 'https://soroban-testnet.stellar.org',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    explorer: 'https://stellar.expert/explorer/testnet',
    // v2 (post-update) PT/YT issuer — fresh assets for the redeployed contracts.
    ptYtIssuer: 'GD6OOYY52IZRHSAMA6MMAG24MCPD5UWK7HLKPTBG5X2I2L7H3FF2U6LL',
    // Live testnet deployment — REDEPLOYED 2026-06-09 with the updated contracts (optimized WASMs,
    // fresh issuer spield_issuer_v2) vs the real Blend TestnetV2 pool. Seeded: vault 5 USDC capacity,
    // market 5 PT / 5 USDC at par. See contract/spield/TESTNET.md "Updated contracts (v2 redeploy)".
    contracts: {
      wrapper: 'CDH7ZGX7QJYIIAUW6Z6LORTLJ7VW7KR4B2INITTSUZL4O22QTMVSYIV4',
      strategy: 'CCTSIOSOVXPACHX2E4KXK4QH2CJKVFFWJHBBVLPB6X3XE3EQXKS3KYIT',
      vault: 'CDEPQKWCBW4Z7XGKPDG2GHNBQ54MOCMCF6PXJFJ5EJM4VJPP6Y4A3ECN',
      market: 'CBY7LGWONKPIRRFSK4BFHK2YLDFPYJ4SLMQJIDVKVXCQZFHYUKJXUFNU',
      pt: 'CCT4VJ32RBT2Q6UH5UH5QCCCZIRYKXYJX44IDLXUMVFUTLZDXBPBJLUW',
      yt: 'CA2QLQDSJUR6H5QNZSYURGGMZPGJI7D4WEYPXBSXWDLX7FCFZF7FD2OU',
      usdc: 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU',
    },
  },
  mainnet: {
    key: 'mainnet',
    name: 'PUBLIC',
    passphrase: Networks.PUBLIC,
    rpcUrl: 'https://mainnet.sorobanrpc.com',
    horizonUrl: 'https://horizon.stellar.org',
    explorer: 'https://stellar.expert/explorer/public',
    ptYtIssuer: 'GA4R5M7ZWOQZWIYCW246YC5WJ4QHT3H74CAUSTCEUUWIELCWI7IP3MKB',
    // Live MAINNET deployment (2026-06-08 vs the real Blend FixedV2 pool + Circle USDC).
    // See contract/spield/MAINNETCONTRACTADDRESSES.md.
    contracts: {
      wrapper: 'CDLQY72EFRTNGNXT4PSINHGA4ET5CW3I6FHUSYUOL2HIWV6I55WW46WW',
      strategy: 'CCTRXF5U2P2IMANRH5B54UJGV53APU4IID2QTINFQBZZWOPB765QZVW4',
      vault: 'CDWNGJDYZ7VUYRG73WOU6PR6HCYPHO77UICJO642OWSP7LQGRRYPFLX6',
      market: 'CBTO72XLCM2HV2MW64GMGWQB57NQFDXO3BZJTW3Y5ENTXBAJQ7Z7G5FV',
      pt: 'CDDYIUGAZBSJNYAR2WYPRNHEGOFS25GPY22W7SHHQHIMTMKX5WQ25IXD',
      yt: 'CDGQLIJVMKRFTYUXOMQAG4YFUN22OKXMOT2K4JA33KDM6P2FCBZTV6CU',
      usdc: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
    },
  },
};

/** Which network this build targets — `VITE_NETWORK`, defaulting to testnet. */
export const NETWORK_KEY: NetworkKey =
  env('VITE_NETWORK', 'testnet').toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet';

const profile = PROFILES[NETWORK_KEY];

/** Active network metadata (passphrase, RPC, Horizon, explorer, wallet name). */
export const NETWORK = {
  name: profile.name,
  passphrase: env('VITE_NETWORK_PASSPHRASE', profile.passphrase),
  rpcUrl: env('VITE_RPC_URL', profile.rpcUrl),
  horizonUrl: env('VITE_HORIZON_URL', profile.horizonUrl),
  explorer: env('VITE_EXPLORER_URL', profile.explorer),
} as const;

/** Deployed Spield contract + asset addresses for the active network. */
export const CONTRACTS = {
  /** The tokenization engine — the wrapper the dashboard calls for raw PT/YT flows. */
  wrapper: env('VITE_WRAPPER', profile.contracts.wrapper),
  /** Blend strategy adapter (read indirectly via the wrapper). */
  strategy: env('VITE_STRATEGY', profile.contracts.strategy),
  /** Fixed-Rate Vault — the flagship "deposit USDC, lock a fixed %" product. */
  vault: env('VITE_VAULT', profile.contracts.vault),
  /** Market — the PT/USDC time-decay AMM (trading venue). */
  market: env('VITE_MARKET', profile.contracts.market),
  /** Principal Token SAC — the fixed-rate bond leg. */
  pt: env('VITE_PT', profile.contracts.pt),
  /** Yield Token SAC — the variable yield leg. */
  yt: env('VITE_YT', profile.contracts.yt),
  /** The underlying deposit asset: USDC (SAC). */
  usdc: env('VITE_USDC', profile.contracts.usdc),
} as const;

/** Whether the Fixed-Rate Vault has been deployed + wired (gates the vault UI). */
export const VAULT_DEPLOYED = CONTRACTS.vault.length > 0;

/** Whether the Market (PT/USDC AMM) has been deployed + wired (gates the Markets/Trade/LP UI). */
export const MARKET_DEPLOYED = CONTRACTS.market.length > 0;

/** USDC, PT and YT all use 7 decimals (Stellar standard / Circle USDC / Blend USDC). */
export const DECIMALS = 7;

/**
 * PT and YT are classic Stellar assets (wrapped as the SACs above). A holder must
 * establish a trustline to each before the wrapper can mint them — otherwise the
 * first `mint` fails. The dashboard offers a one-click trustline setup using these.
 */
export const PT_YT_ISSUER = env('VITE_PT_YT_ISSUER', profile.ptYtIssuer);

export const ASSETS = {
  pt: { code: 'SPLDPT', issuer: PT_YT_ISSUER },
  yt: { code: 'SPLDYT', issuer: PT_YT_ISSUER },
} as const;

/** Waitlist API URL (same for both networks unless overridden). */
export const BACKEND_URL = env('VITE_BACKEND_URL', 'https://spield-protocol-waitlistbackend.vercel.app');

/**
 * Cross-chain bridge (Allbridge Core) configuration.
 *
 * IMPORTANT: Allbridge Core has NO testnet — the SDK ships only a mainnet config
 * (see `@allbridge/bridge-core-sdk/dist/src/configs` → only `mainnet`). So we let
 * the bridge UI *quote* against real mainnet liquidity on every build, but only
 * permit actual execution when this app is itself targeting mainnet. On testnet
 * builds the UI shows prices and disables the bridge with a "mainnet only" note.
 */
export const BRIDGE_ENABLED = NETWORK_KEY === 'mainnet';

/**
 * WalletConnect / Reown Cloud project id, required to initialise the EVM + Solana
 * wallet modal used to sign bridge transfers FROM non-Stellar chains. Get a free
 * id at https://cloud.reown.com. When unset, Stellar-source bridging still works
 * (it uses the app's existing Stellar wallet); only EVM/Solana sources are gated.
 */
export const REOWN_PROJECT_ID = env('VITE_REOWN_PROJECT_ID', '');

/**
 * RPC endpoints the Allbridge SDK uses to read/build txs on each non-Stellar chain
 * it can bridge from. EVM chains work without a custom RPC (the SDK falls back to
 * the injected wallet provider), but Solana REQUIRES one. All overridable via env.
 */
export const BRIDGE_RPC = {
  SOL: env('VITE_BRIDGE_RPC_SOL', 'https://api.mainnet-beta.solana.com'),
  ETH: env('VITE_BRIDGE_RPC_ETH', ''),
  BSC: env('VITE_BRIDGE_RPC_BSC', ''),
  POL: env('VITE_BRIDGE_RPC_POL', ''),
  ARB: env('VITE_BRIDGE_RPC_ARB', ''),
  TRX: env('VITE_BRIDGE_RPC_TRX', ''),
} as const;

/** Token display metadata, keyed by contract address. */
export const TOKEN_META: Record<string, { symbol: string; label: string }> = {
  [CONTRACTS.usdc]: { symbol: 'USDC', label: 'USD Coin' },
  [CONTRACTS.pt]: { symbol: 'PT', label: 'Principal Token' },
  [CONTRACTS.yt]: { symbol: 'YT', label: 'Yield Token' },
};

/** Link to a contract on the active network's explorer. */
export const explorerContract = (id: string) => `${NETWORK.explorer}/contract/${id}`;

/** Link to a transaction on the active network's explorer. */
export const explorerTx = (hash: string) => `${NETWORK.explorer}/tx/${hash}`;
