// The two Stellar network passphrases, inlined as literals rather than imported
// from `@stellar/stellar-sdk`. These are canonical, immutable constants (see
// .env.example / SEP-0002), and importing them from the SDK would pull the entire
// multi-hundred-KB Stellar SDK into every module that reads a config value —
// including modules that need none of it. Keeping them as strings lets
// `config.ts` stay dependency-free. If Stellar ever changes a passphrase (it
// won't), update here.
const STELLAR_NETWORKS = {
  PUBLIC: 'Public Global Stellar Network ; September 2015',
  TESTNET: 'Test SDF Network ; September 2015',
} as const;

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
  /**
   * Extra Soroban RPC endpoints, tried in order when the primary is unreachable.
   *
   * **Mainnet only.** The public `mainnet.sorobanrpc.com` rate-limits and times out under ordinary
   * dashboard load, which the UI surfaces as "Couldn't reach the network — showing the last data we
   * have". A second endpoint turns that from a visible failure into a retry nobody notices.
   *
   * Populated from `VITE_RPC_URL_FALLBACK` (comma-separated) rather than hardcoded, because a
   * provider URL usually carries an API key. See `.env.example`.
   */
  fallbackRpcUrls: string[];
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

/**
 * The **SR stack** — Spield v2's Pendle-shaped contracts (`srstack.md`).
 *
 * Deployed alongside v1, not replacing it, so both can be pointed at from one build. The shape
 * differs from `ContractSet` in ways the UI has to respect:
 *
 * * `sr` is a **share token** over the Blend strategy — users wrap USDC into SR first, and the
 *   PT/YT engine and the AMM speak only SR. It is NOT 1:1 with USDC.
 * * `yieldEngine` **is the YT token**. There is no YT SAC and no YT trustline. Its address is what
 *   you call for `balance`, `transfer`, `claimable_interest` and `redeem_due_interest`.
 * * `pt` is still a classic-asset SAC, so a holder **does** need a PT trustline before they can
 *   receive PT. `ptAsset` carries the exact `CODE:ISSUER` pair to trust — never reconstruct it.
 */
type SrContractSet = {
  /** SR token (Standardized Return) — the share token users wrap USDC into. */
  sr: string;
  /** Blend strategy adapter behind SR. */
  strategy: string;
  /** PT/YT engine. **This address is also the YT token.** */
  yieldEngine: string;
  /** PT/SR AMM. */
  market: string;
  /** Fixed-Rate Vault — deposit USDC, get a guaranteed payout at maturity, backed by PT. */
  vault: string;
  /**
   * SR Router — the one-transaction USDC front door. Every USDC↔PT/YT flow in the UI goes through
   * this; the SR hop still exists underneath and stays separately callable for users who want to
   * hold the wrapper itself. The router holds no funds and has no privileges over the contracts it
   * composes, so a UI that routed around it would still work — it would just cost three signatures.
   */
  router: string;
  /** PT Stellar Asset Contract. */
  pt: string;
  /** PT classic asset as `CODE:ISSUER` — required verbatim to open a trustline. */
  ptAsset: string;
  usdc: string;
};

type NetworkProfile = NetworkMeta & {
  contracts: ContractSet;
  /** The v2 SR stack. `null` where it is not deployed yet (mainnet). */
  sr: SrContractSet | null;
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
    passphrase: STELLAR_NETWORKS.TESTNET,
    rpcUrl: 'https://soroban-testnet.stellar.org',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    explorer: 'https://stellar.expert/explorer/testnet',
    // Testnet keeps a single endpoint on purpose — a flaky testnet read is not worth a second
    // provider, and failover would only mask problems worth seeing during development.
    fallbackRpcUrls: [],
    // v2 (post-update) PT/YT issuer — fresh assets for the redeployed contracts.
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
    // ── SR stack (v2). Redeployed 2026-08-30 against the real Blend TestnetV2 pool, seeded to the
    // planned MAINNET shape: 50 USDC deposit cap, 30-day series, 5 USDC per AMM side, 5 USDC of
    // vault coupon capacity. Opened at 3.0000% implied APY, PT price 0.997574.
    // Source of truth: contract/spield/scripts/deploy_sr_testnet.state — see TESTNET_SR.md.
    sr: {
      // Redeployed 2026-08-30. The previous deployment predates the whole `FINAL_CHECK.md` round:
      // V2-01 (the market prices on a SYNCHRONIZED index via `yield.py_index_current`), V2-03 (the
      // router compares against its entry snapshot, so a 1-stroop donation can no longer deny every
      // route), RISK-01 (`sr.realizable_rate`) and ECO-02 (`strategy.claim_emissions`). None can be
      // added in place. Old addresses: scripts/deploy_sr_testnet.state.bak.pre-eco02-20260830-210750.
      sr: 'CDYAM3NGY5I3SUGPCDQUS25MGCIWT2YOBDSWYT6SJNIPN6A6OOUSSCZY',
      strategy: 'CDPNSWSBVBRF52SED6UD7T2VQH6XODLEHXSCFTZHQP73SNYTKIHP5R2B',
      yieldEngine: 'CDS2Q6L3QCUK4KX633M7QH53GC76EVOUAK7WJ54T3AP3J6IGXIM3LURD',
      market: 'CBL7Z3BONITNSWO7NJLT67464HLVVQF5G3REI3XT6KUCK7YNHPICJX5A',
      vault: 'CDKV7Z7FF3DA57LSO2JA6GFKAIDDIDMZD5XWCMV7G5I3E4ZA3NN2NMH7',
      router: 'CDP3VUYH3GEGNOF4XUHKMP5GBTH3SBCL5R3GM5ZTVQAGV7FOAPAQJTGE',
      pt: 'CB3T6FOMAH77Z2FMSA2IEVLQEIYOQRRFP7JMJMJGMUCO6HGOOZJZJ7OC',
      ptAsset: 'SPLDPT7:GDTM2UMJEO6LV5HE2SI56IEWNX5OAF5HV2XNZMVZEDXMMPHZUWXSSLQU',
      usdc: 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU',
    },
  },
  mainnet: {
    key: 'mainnet',
    name: 'PUBLIC',
    passphrase: STELLAR_NETWORKS.PUBLIC,
    rpcUrl: 'https://mainnet.sorobanrpc.com',
    horizonUrl: 'https://horizon.stellar.org',
    explorer: 'https://stellar.expert/explorer/public',
    fallbackRpcUrls: [],
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
    // The SR stack went LIVE on mainnet 2026-09-01 — same six contracts as testnet, against the
    // real Blend FixedV2 pool and Circle USDC. See contract/spield/MAINNET_LAUNCH.md for the
    // deploy record, and scripts/deploy_mainnet_v2.state for the machine-readable source.
    //
    // Launch parameters, live on chain: 30-day series expiring 1790809749 (2026-09-30 23:09 UTC),
    // vault fixed rate 300bps, SR deposit cap 500000000 (50 USDC) — the cap is the mitigation for
    // shipping unaudited, so the risk panel must keep saying so.
    sr: {
      sr: 'CCOZ2JGQAPLUOG5RVU3TLPGSS7WA356BWCOEWFBJU44DKHDRZTQPABBS',
      strategy: 'CAJKHGY3J2XSZHI3TFDFMXJ2GDFFUPUPPTUOP6UOBHSY6FW66J6YYBP7',
      yieldEngine: 'CDILIYN4IXUL5H7PJ4TW3GLZ2U6LIZYX35SNN4BGYZWPIXFLJZEFMRLP',
      market: 'CDRQJ7EYKTJV3W4BE2U4HIAWSVZB675MHTCBDGCXMKVR5VCURMNSEZ7O',
      vault: 'CDNRQ4YLW4RA4LB4J4M5S3X4SEXXR3Z6TR7336VKOG3FPX3PBFAMVZ6P',
      router: 'CB7O72TTK7OISNS53HXTLCZ2EAY2F5KKYBPGI7ADSIX5KMPGVVDXAALN',
      pt: 'CBGA2TFTSF236VYPI5TVYQ2Z53DKD6LQHIR5DCGKSNIUJ4NAPNBI6VJM',
      ptAsset: 'SPLDPT:GDNSUOHJIWYXX6HC6ZVDJNLSIBLZMLJYBG7NAN2CRUSXOG4FIDAOH5KN',
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

/**
 * Every Soroban RPC endpoint for this network, primary first.
 *
 * `lib/soroban.ts` walks this list on transport failures. Fallbacks are **mainnet only** and come
 * from `VITE_RPC_URL_FALLBACK` (comma-separated), because provider URLs normally embed an API key
 * and the tracked `.env` deliberately holds only public values — put it in `.env.local`.
 *
 * A `VITE_*` value is inlined into the built bundle by Vite, so anyone loading the app can read it.
 * That is unavoidable for a browser-side RPC; restrict the key by domain at the provider instead of
 * expecting it to stay secret.
 */
export const RPC_URLS: readonly string[] = [
  ...new Set(
    [
      NETWORK.rpcUrl,
      ...(NETWORK_KEY === 'mainnet'
        ? env('VITE_RPC_URL_FALLBACK', '')
            .split(',')
            .map((u) => u.trim())
        : []),
      ...profile.fallbackRpcUrls,
    ].filter((u) => u.length > 0),
  ),
];

/**
 * The v2 **SR stack** addresses for the active network, or `null` where it is not deployed.
 * Live on testnet and, since 2026-09-01, on mainnet.
 *
 * Guard every use with {@link SR_DEPLOYED}. It is non-null on **both** networks as of the
 * 2026-09-01 mainnet launch, but keep the guard: a future network, or an env override that blanks
 * an address, brings the null branch back, and the SR client (`lib/srstack.ts`) turns every call
 * into a safe no-op so the UI renders an unavailable state instead of throwing.
 */
export const SR_CONTRACTS = profile.sr
  ? {
      sr: env('VITE_SR', profile.sr.sr),
      strategy: env('VITE_SR_STRATEGY', profile.sr.strategy),
      /** The PT/YT engine. **This same address is the YT token** — there is no separate YT SAC. */
      yieldEngine: env('VITE_SR_YIELD', profile.sr.yieldEngine),
      market: env('VITE_SR_MARKET', profile.sr.market),
      /** Fixed-Rate Vault. */
      vault: env('VITE_SR_VAULT', profile.sr.vault),
      /** SR Router — the one-transaction USDC front door for every PT/YT trade. */
      router: env('VITE_SR_ROUTER', profile.sr.router),
      pt: env('VITE_SR_PT', profile.sr.pt),
      /** `CODE:ISSUER` for the PT trustline. Use verbatim; do not rebuild it from parts. */
      ptAsset: env('VITE_SR_PT_ASSET', profile.sr.ptAsset),
      usdc: env('VITE_SR_USDC', profile.sr.usdc),
    }
  : null;

/** Whether the v2 SR stack is available on this network. */
export const SR_DEPLOYED: boolean = SR_CONTRACTS !== null;

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
 * Smallest deposit the wrapper will accept, in base units (stroops).
 *
 * Blend credits `floor(amount / b_rate)` bToken shares, so once the pool has accrued
 * (`b_rate > 1` — mainnet's is ≈1.124) a 1-stroop deposit floors to **0 shares** and is
 * rejected. `wrapper::mint` refuses anything below `ceil(b_rate)` stroops up front with
 * `InvalidAmount`, which makes the real minimum **2 stroops, not 1**.
 *
 * This mirrors that floor so the UI can say so before asking the user to sign. It is a
 * static 2 because `b_rate` would have to exceed 2.0 for the contract's floor to move to
 * 3 — a doubling of the Blend pool's cumulative index, far outside any near-term range.
 * If it ever does, the contract still refuses correctly; only this hint goes stale.
 */
export const MIN_MINT_BASE_UNITS = 2n;

/** Waitlist API URL (same for both networks unless overridden). */
export const BACKEND_URL = env('VITE_BACKEND_URL', 'http://api.spield.live');

/**
 * WalletConnect / Reown Cloud project id for the optional EVM wallet modal used by
 * the CCTP bridge. When unset, the bridge falls back to an injected EVM wallet
 * (MetaMask, Rabby, Coinbase Wallet, etc.).
 */
export const REOWN_PROJECT_ID = env('VITE_REOWN_PROJECT_ID', '');

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
