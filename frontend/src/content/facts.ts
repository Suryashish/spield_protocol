/**
 * Spield protocol FACTS — the single source of truth for machine-readable data
 * about the protocol. This drives:
 *   - the generated /api/stats.json (AEO: an endpoint agents can pull exact
 *     facts from without scraping — the strongest generative-engine signal is
 *     original, structured data),
 *   - the Dataset JSON-LD on the facts/solvency page,
 *   - the "protocol facts" page content.
 *
 * IMPORTANT: only put values here that are TRUE and STABLE at build time. Live
 * numbers (current APY, TVL, solvency ratio) are intentionally left as
 * `null` + documented so a backend/cron can populate them later WITHOUT
 * publishing invented figures. Contract addresses, network, product config, and
 * design guarantees are stable and safe to publish statically.
 */


export interface ContractRef {
  name: string;
  role: string;
  address: string;
}

export interface LiveMetric {
  /** Human label. */
  label: string;
  /** null until a live data source populates it; never publish invented numbers. */
  value: number | null;
  unit: string;
  /** How this value is derived, for transparency. */
  method: string;
}

export interface ProtocolFacts {
  name: string;
  category: string;
  network: 'testnet' | 'mainnet';
  networkLabel: string;
  yieldSource: string;
  /** The design guarantees that are always true regardless of live state. */
  guarantees: string[];
  products: { name: string; description: string }[];
  config: { label: string; value: string }[];
  contracts: ContractRef[];
  assets: ContractRef[];
  dependencies: ContractRef[];
  explorer: string;
  /** Live metrics — null until populated by a data backend. */
  live: LiveMetric[];
  /** ISO timestamp of when the static facts were last edited (set at build). */
  factsUpdated: string;
}

/**
 * Testnet deployment (matches src/lib/config.ts). When mainnet is live, add a
 * mainnet block and select by the build's active network.
 */
export const PROTOCOL_FACTS: ProtocolFacts = {
  name: 'Spield',
  category: 'Fixed-income & yield-tokenization protocol on Stellar',
  network: 'testnet',
  networkLabel: 'Stellar testnet (Soroban)',
  yieldSource: 'Blend Capital (real on-chain lending yield via the rising bToken rate)',
  guarantees: [
    'Stellar-native only — no cross-chain bridge and no bridged assets.',
    'Yield is real on-chain Blend lending yield, never an invented index.',
    'A solvency invariant is enforced in the contracts: issued value can never exceed real backing.',
    'Principal Tokens (PT) redeem 1:1 for the underlying at maturity.',
    'Non-custodial — users hold their own keys.',
  ],
  products: [
    { name: 'Fixed-Rate Vault', description: 'Deposit USDC and lock a guaranteed fixed rate; redeem principal + coupon at maturity.' },
    { name: 'Wrapper (Tokenize)', description: 'Split a yield-bearing position into a tradable Principal Token (PT) and Yield Token (YT).' },
    { name: 'PT/USDC Market', description: 'A Pendle-style time-decay AMM to buy fixed yield at a discount or provide liquidity.' },
  ],
  config: [
    { label: 'Underlying asset', value: 'USDC (native on Stellar)' },
    { label: 'Yield source', value: 'Blend v2 lending pool' },
    { label: 'Vault fixed APR (testnet config)', value: '5%' },
    { label: 'Vault ceiling (testnet config)', value: '20%' },
    { label: 'Market swap fee', value: '0.30%' },
  ],
  contracts: [
    { name: 'Wrapper', role: 'Tokenization engine (mint/redeem PT+YT, solvency invariant)', address: 'CDH7ZGX7QJYIIAUW6Z6LORTLJ7VW7KR4B2INITTSUZL4O22QTMVSYIV4' },
    { name: 'Strategy', role: 'Blend yield-source adapter', address: 'CCTSIOSOVXPACHX2E4KXK4QH2CJKVFFWJHBBVLPB6X3XE3EQXKS3KYIT' },
    { name: 'Vault', role: 'Fixed-Rate Vault', address: 'CDEPQKWCBW4Z7XGKPDG2GHNBQ54MOCMCF6PXJFJ5EJM4VJPP6Y4A3ECN' },
    { name: 'Market', role: 'PT/USDC time-decay AMM', address: 'CBY7LGWONKPIRRFSK4BFHK2YLDFPYJ4SLMQJIDVKVXCQZFHYUKJXUFNU' },
  ],
  assets: [
    { name: 'PT', role: 'Principal Token (SAC)', address: 'CCT4VJ32RBT2Q6UH5UH5QCCCZIRYKXYJX44IDLXUMVFUTLZDXBPBJLUW' },
    { name: 'YT', role: 'Yield Token (SAC)', address: 'CA2QLQDSJUR6H5QNZSYURGGMZPGJI7D4WEYPXBSXWDLX7FCFZF7FD2OU' },
    { name: 'USDC', role: 'Underlying settlement asset (Blend testnet SAC)', address: 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU' },
  ],
  dependencies: [
    { name: 'Blend pool', role: 'Yield source (Blend v2 testnet lending pool)', address: 'CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF' },
  ],
  explorer: 'https://stellar.expert/explorer/testnet',
  live: [
    { label: 'Fixed APR available', value: null, unit: '%', method: 'Read from the vault contract config on-chain.' },
    { label: 'Total value locked', value: null, unit: 'USDC', method: 'Sum of USDC supplied through the wrapper into Blend.' },
    { label: 'Solvency ratio', value: null, unit: 'ratio', method: 'wrapper backing ÷ issued PT+YT value; the invariant keeps this ≥ 1.' },
  ],
  factsUpdated: '2026-07-06',
};

/** Build the /api/stats.json payload from the facts. */
export function buildStatsJson(): unknown {
  const f = PROTOCOL_FACTS;
  return {
    $schema: 'https://www.spield.live/api/stats.schema.json',
    protocol: f.name,
    description: f.category,
    network: f.network,
    networkLabel: f.networkLabel,
    yieldSource: f.yieldSource,
    guarantees: f.guarantees,
    products: f.products,
    config: Object.fromEntries(f.config.map((c) => [c.label, c.value])),
    contracts: f.contracts,
    assets: f.assets,
    dependencies: f.dependencies,
    explorer: f.explorer,
    live: Object.fromEntries(
      f.live.map((m) => [m.label, { value: m.value, unit: m.unit, method: m.method }]),
    ),
    liveDataAvailable: f.live.some((m) => m.value !== null),
    factsUpdated: f.factsUpdated,
    docs: 'https://www.spield.live/learn',
  };
}
