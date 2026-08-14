/**
 * Spield protocol FACTS — the single source of truth for machine-readable
 * claims about the protocol. It drives `/api/stats.json` (an endpoint an
 * agent can pull exact values from instead of scraping prose), the
 * Dataset JSON-LD, and the facts section of llms.txt.
 *
 * The rule this file lives by: only things that are TRUE and STABLE at
 * build time. Contract addresses, network, fee schedule and design
 * guarantees qualify. Live state — the rate on offer, TVL, the solvency
 * ratio — does not, so it is carried as `null` with the method that
 * would populate it written down beside it. A null an agent can see is a
 * fact; an invented number it repeats is a liability, and in a financial
 * context an answer engine will repeat it verbatim.
 *
 * The same rule is why `SERIES` in `lib/series.ts` does NOT appear here.
 * Those figures are worked examples the page marks as such, and lifting
 * one into structured data would quietly promote it to a quote.
 */

import { NETWORK } from "@/lib/series";

export interface ContractRef {
  name: string;
  role: string;
  address: string;
}

export interface LiveMetric {
  label: string;
  /** null until a live data source populates it; never publish invented numbers. */
  value: number | null;
  unit: string;
  /** how the value would be derived, so the null is transparent rather than lazy */
  method: string;
}

/**
 * The live testnet deployment (v2 redeploy, verified 2026-06-09 against the
 * real Blend TestnetV2 pool). Mirrors the addresses the dashboard points
 * at; see `contract/spield/TESTNET.md` for the deployment record.
 */
export const PROTOCOL_FACTS = {
  name: "Spield",
  legalName: "Spield Protocol",
  category: "Fixed-income and yield-tokenization protocol on Stellar",
  network: "testnet" as const,
  networkLabel: NETWORK,
  yieldSource: "Blend Capital — real on-chain lending yield, arriving as a rising bToken rate",

  /** Where the protocol honestly stands, stated rather than implied. */
  status: {
    stage: "testnet",
    audited: false,
    auditNote:
      "Spield has not been audited. Every contract is verifiable on-chain; treat it as unaudited software.",
    custody: "non-custodial — users hold their own keys",
    publishesLiveFigures: false,
    figuresNote:
      "Every rate, price, payout and balance shown on spield.live is an illustrative worked example chosen to explain the mechanism, not live protocol data and not a quote.",
  },

  /** True regardless of live state — these are properties of the design. */
  guarantees: [
    "Stellar-native end to end — no cross-chain bridge and no bridged assets in the protocol.",
    "Yield is real on-chain Blend lending yield, never an invented index and never token emissions.",
    "A solvency invariant is enforced in the contracts: issued value can never exceed real backing.",
    "Principal Tokens (PT) redeem 1:1 for the underlying at maturity.",
    "No leverage in the design, so a position can decay to zero but can never be margin-called.",
    "Nothing is locked up: positions can be sold at the market price before maturity.",
    "Redemption stays open after maturity — nothing is force-closed and nothing expires.",
    "Non-custodial — users hold their own keys.",
  ],

  products: [
    {
      name: "Fixed-Rate Vault",
      description:
        "Deposit USDC, get quoted an exact payout on an exact date before signing, and redeem that figure at maturity.",
    },
    {
      name: "Tokenization (PT / YT)",
      description:
        "Split a yield-bearing position into a tradable Principal Token (PT), which redeems 1:1 at maturity, and a Yield Token (YT), which collects all yield until maturity.",
    },
    {
      name: "PT/USDC market",
      description:
        "A Stellar-native time-decay AMM for buying fixed yield at a discount, taking the other side of it, or providing liquidity to both.",
    },
  ],

  config: [
    { label: "Underlying asset", value: "USDC (native on Stellar)" },
    { label: "Settlement asset", value: "USDC (native on Stellar)" },
    { label: "Yield source", value: "Blend v2 lending pool" },
    { label: "Market swap fee", value: "0.30%" },
    { label: "Vault deposit fee", value: "None — the quote is net of anything the protocol takes" },
    { label: "Minimum deposit", value: "None beyond the Stellar network fee" },
    { label: "Network fee", value: "Stellar base fee — a fraction of a cent per transaction" },
  ],

  contracts: [
    {
      name: "Wrapper",
      role: "Tokenization engine — mints and redeems PT+YT, enforces the solvency invariant",
      address: "CDH7ZGX7QJYIIAUW6Z6LORTLJ7VW7KR4B2INITTSUZL4O22QTMVSYIV4",
    },
    {
      name: "Strategy",
      role: "Blend yield-source adapter",
      address: "CCTSIOSOVXPACHX2E4KXK4QH2CJKVFFWJHBBVLPB6X3XE3EQXKS3KYIT",
    },
    {
      name: "Vault",
      role: "Fixed-Rate Vault",
      address: "CDEPQKWCBW4Z7XGKPDG2GHNBQ54MOCMCF6PXJFJ5EJM4VJPP6Y4A3ECN",
    },
    {
      name: "Market",
      role: "PT/USDC time-decay AMM",
      address: "CBY7LGWONKPIRRFSK4BFHK2YLDFPYJ4SLMQJIDVKVXCQZFHYUKJXUFNU",
    },
  ] satisfies ContractRef[],

  assets: [
    {
      name: "PT",
      role: "Principal Token (Stellar Asset Contract)",
      address: "CCT4VJ32RBT2Q6UH5UH5QCCCZIRYKXYJX44IDLXUMVFUTLZDXBPBJLUW",
    },
    {
      name: "YT",
      role: "Yield Token (Stellar Asset Contract)",
      address: "CA2QLQDSJUR6H5QNZSYURGGMZPGJI7D4WEYPXBSXWDLX7FCFZF7FD2OU",
    },
    {
      name: "USDC",
      role: "Underlying and settlement asset (Blend testnet SAC)",
      address: "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU",
    },
  ] satisfies ContractRef[],

  dependencies: [
    {
      name: "Blend pool",
      role: "Yield source — Blend v2 testnet lending pool",
      address: "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF",
    },
  ] satisfies ContractRef[],

  explorer: "https://stellar.expert/explorer/testnet",

  live: [
    {
      label: "Fixed rate available",
      value: null,
      unit: "%",
      method: "Read from the vault contract config on-chain at request time.",
    },
    {
      label: "Total value locked",
      value: null,
      unit: "USDC",
      method: "Sum of USDC supplied through the wrapper into Blend.",
    },
    {
      label: "Solvency ratio",
      value: null,
      unit: "ratio",
      method: "Wrapper backing ÷ issued PT+YT value; the contract invariant keeps this ≥ 1.",
    },
  ] satisfies LiveMetric[],

  /** When the static facts above were last edited. */
  factsUpdated: "2026-08-14",
} as const;

/** The payload served at /api/stats.json. */
export function buildStatsJson(): Record<string, unknown> {
  const f = PROTOCOL_FACTS;
  return {
    protocol: f.name,
    legalName: f.legalName,
    description: f.category,
    network: f.network,
    networkLabel: f.networkLabel,
    yieldSource: f.yieldSource,
    status: f.status,
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
  };
}
