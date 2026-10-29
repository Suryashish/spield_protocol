import ustryDeployment from './ustry-deployment.json';
import ustrySeries2 from './ustry-v2-testnet-series-2.json';

/**
 * Spield Multi-Series Registry & Configuration.
 *
 * Spield supports running and viewing multiple series concurrently:
 * - Live Now series: active, open for deposits, AMM swaps, and LP.
 * - Ended series: matured, closed for new deposits/swaps, but open for
 *   historical inspection and 1:1 par redemption of PT and Vault receipts.
 */

export type SrContractSet = {
  sr: string;
  strategy: string;
  yieldEngine: string;
  market: string;
  vault: string;
  router: string;
  pt: string;
  ptAsset: string;
  usdc: string;
};

export type NetworkKey = 'testnet' | 'mainnet';

export type SeriesStatus = 'live' | 'ended';

export type YieldSource = 'blend' | 'ustry';
/**
 * A USTRY series deployment. `version` 1 is Series 1 (`spield-rwa`, custom history oracle, every
 * priced action needs a fresh NAV). `version` 2 is `spield-ustry-series` on a SEP-40 feed, where
 * only new deposits need a fresh NAV and maturity always finalizes.
 */
export type UstryContractSet = {
  version?: 1 | 2;
  network?: NetworkKey;
  series: string;
  oracle: string;
  receipt: string;
  pt: string;
  yt: string;
  asset: string;
  expiry: number;
  maxAge: number;
  /** v1 only: cap in whole USTRY. */
  capUstry?: number;
  /** v2 only: cap in token units (7 decimals), as a decimal string. */
  cap?: string;
  /** v2 only: seconds after expiry before finalization no longer needs a post-expiry sample. */
  grace?: number;
  /** v2 only: high-water growth bound, bps per year. */
  maxAprBps?: number;
};
export type SeriesConfig = {
  source: YieldSource;
  ustry?: UstryContractSet;
  /** Unique identifier, e.g. 'mainnet-series-2' */
  id: string;
  /** Primary name, e.g. 'Series 2' */
  name: string;
  /** Duration badge, e.g. '15 Days', '30 Days', '90 Mins' */
  durationLabel: string;
  /** Network this series lives on */
  network: NetworkKey;
  /** Maturity / expiry unix timestamp in seconds */
  expiry: number;
  /** Formatted maturity date string, e.g. 'Oct 26, 2026' */
  maturityDate: string;
  /** Quoted or configured fixed rate in percent, e.g. 3.0 */
  fixedAprPct: number;
  /** Launch TVL deposit cap in USDC, e.g. 160 */
  depositCapUsdc?: number;
  /** PT classic asset code, e.g. 'SPLDPT' */
  ptCode: string;
  /** Descriptive overview of the series */
  description: string;
  /** Full SR stack contract addresses */
  contracts?: SrContractSet;
};

/**
 * All known series across Mainnet and Testnet.
 */
export const ALL_SERIES: SeriesConfig[] = [
  {
    source: 'ustry', id: 'testnet-ustry-2', name: 'USTRY Series 2', durationLabel: '30 Days', network: 'testnet',
    expiry: ustrySeries2.expiry,
    maturityDate: new Date(ustrySeries2.expiry * 1000).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }),
    fixedAprPct: 0, ptCode: 'PT-USTRY',
    description: 'Tokenized Treasury sandbox series on a SEP-40 NAV feed. Only new deposits need a fresh NAV; exits and maturity never wait on the oracle. USD face is not a principal guarantee.',
    ustry: { ...ustrySeries2, version: 2, network: 'testnet' },
  },
  {
    source: 'ustry', id: 'testnet-ustry-1', name: 'USTRY Series 1', durationLabel: '14 Days', network: 'testnet',
    expiry: ustryDeployment.expiry,
    maturityDate: new Date(ustryDeployment.expiry * 1000).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }),
    fixedAprPct: 0, ptCode: 'PT-USTRY',
    description: 'Tokenized Treasury sandbox series. Deposits and payouts in USTRY; USD face is not a principal guarantee.',
    ustry: ustryDeployment,
  },
  // ── Mainnet Series ────────────────────────────────────────────────────────
  {
    source: 'blend',
    id: 'mainnet-series-2',
    name: 'Series 2',
    durationLabel: '15 Days',
    network: 'mainnet',
    expiry: 1793056349, // 2026-10-26 23:12:29 UTC
    maturityDate: 'Oct 26, 2026',
    fixedAprPct: 3.0,
    depositCapUsdc: 160,
    ptCode: 'SPLDPT',
    description: 'Current live 15-day series on Stellar mainnet backed by Blend FixedV2 and Circle USDC.',
    contracts: {
      sr: 'CDTAPBUE2JWXT4F3PTAFQRYTLC6IF4K736ISGIFNLJQBC7AWAHPU6HWM',
      strategy: 'CDD2HYLUHT2HWI2L2ZMYM4NYPFDZMYDDMYH2V6ZOE32G6KFZMQKKKA24',
      yieldEngine: 'CAALMLLE4COVQE33RTZOKKFJ3FYEAOONOAGKOUST26P23FE4HX5Q7XZB',
      market: 'CC7UQOKGYQLYZY4RALIAPBA4IH2TOMEJENQ6OWWIOSTTUDRZ5VYUERIW',
      vault: 'CA6TSYNLREIBJP37MD6LUPXKXHC6WB5ZK6YD3PTCQUDZ7XDJUD7AN66C',
      router: 'CASPAY3DKWQQSZORJVEF44576OK3DODYOZQ74R4NLZT2YTVBNTO7RQNW',
      pt: 'CALAMDCCXSBWPJWOKUH6CHVVQMBPLJBUU4GVPETHY2FLNZGXFI2FNYUB',
      ptAsset: 'SPLDPT:GBBRKYFRHSDUQ3YQRIFR42GZ4OKFMVKCZN7JYFPESVNSRU3WEE4JPI7Q',
      usdc: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
    },
  },
  {
    source: 'blend',
    id: 'mainnet-series-1',
    name: 'Series 1',
    durationLabel: '30 Days',
    network: 'mainnet',
    expiry: 1790809749, // 2026-09-30 23:09:09 UTC
    maturityDate: 'Sep 30, 2026',
    fixedAprPct: 3.0,
    depositCapUsdc: 50,
    ptCode: 'SPLDPT',
    description: 'Inaugural 30-day mainnet series. Matured on Sep 30, 2026. PT and Vault receipts redeemable 1:1 at par.',
    contracts: {
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
  {
    source: 'blend',
    id: 'mainnet-demo',
    name: 'Demo 90M',
    durationLabel: '90 Minutes',
    network: 'mainnet',
    expiry: 1788237872, // 2026-09-01 04:44:32 UTC
    maturityDate: 'Sep 01, 2026',
    fixedAprPct: 3.0,
    depositCapUsdc: 20,
    ptCode: 'SPLDPTD',
    description: 'Fast-lifecycle 90-minute demo series deployed on mainnet. Matured on Sep 01, 2026.',
    contracts: {
      sr: 'CAC5KUVAJENSRWLXH56JYKATIPLQPBYPABRGQERYQWZD4LNAHJZCRFQA',
      strategy: 'CDWLAKWQ3OEIBRHNUN3KHS2WS7SCJF7RY372ZLUQFKJKU4H7XTJKKWTI',
      yieldEngine: 'CDAQBKP2AAJJPHAHAUDDLNHIWIVTTWAE3VOKPAWLS3LJCIZHHH6D7P7P',
      market: 'CDBVFJ4JAF7EPA4Y54FZKBOEU2WJV5VRJGSZP7JMZHYDQV7S7IPGBSNQ',
      vault: 'CBBHJYH4I2IEJINCOAVUE3NRLVLMAXCYKKCCT3APV6D5KG32XJLG37WQ',
      router: 'CBZSOMWSXLNVGU6NXME6TLQUGGWHIE4SEWP2PMEJH5GVX7YN5U2VAOGZ',
      pt: 'CBYMGIRO4VTTMWRN7G44GLEFPC2QXRWIVVGLBYOX2QW5WLBD34UMMRUY',
      ptAsset: 'SPLDPTD:GBNXYAM46QXDKPWKHJLONJQFJJMYOAXCHOPL7G344OIKPGSTVD4FPP7P',
      usdc: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
    },
  },

  // ── Testnet Series ────────────────────────────────────────────────────────
  {
    source: 'blend',
    id: 'testnet-series-2',
    name: 'Testnet Series 2',
    durationLabel: '30 Days',
    network: 'testnet',
    expiry: 1795384166, // 2026-11-22 21:49:26 UTC
    maturityDate: 'Nov 22, 2026',
    fixedAprPct: 3.0,
    depositCapUsdc: 50,
    ptCode: 'SPLDPT5',
    description: 'Stellar Testnet Series 2 against Blend TestnetV2 pool.',
    contracts: {
      sr: 'CDL44OYHVIZQSQZOPC7P5YWCKPWYAI7LYT62RROKOSVIXFU43YOJ7IF2',
      strategy: 'CCC7C4RGNRHSIHCW4FI2FFEVA5BM5NCLKHM3TK3YA5WR4DDMLGRLJT4Q',
      yieldEngine: 'CDR4LNBYRPNCKXVMJEJ3XMSGEBRLABDSNBY5W327LT2E65MCCWFHS5ZB',
      market: 'CAFY2E5GSDNGL3UCYP7JZ2VZHVR2VHAVX5J3M7SBMA4KZUHRFHV4A74Z',
      vault: 'CAHWXX7DQKAJ733SL7U7IHDG5JHGKIW74JN23AY2WQDESQSV4BW2VBHV',
      router: 'CDHCUCFWF4C2UMWTTMSYBSS46KHDHJR64CAYKPYZJLXJDCRYOX64R4BK',
      pt: 'CCEJSM4TFAKQ4F5XCMRRRAFHT2DYAXXX5IZMK4MX4SH6M4VT5ZO75S3K',
      ptAsset: 'SPLDPT5:GCCDH7PSRAB6SKZPKBGTJYKKUCPSR3SNI3GCCFLTHR2Z6E6ASN5EEAYX',
      usdc: 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU',
    },
  },
  {
    source: 'blend',
    id: 'testnet-series-1',
    name: 'Testnet Series 1',
    durationLabel: '30 Days',
    network: 'testnet',
    expiry: 1790696291, // 2026-09-29 15:38:11 UTC
    maturityDate: 'Sep 29, 2026',
    fixedAprPct: 3.0,
    depositCapUsdc: 50,
    ptCode: 'SPLDPT7',
    description: 'Stellar Testnet Series 1. Matured on Sep 29, 2026. PT & Vault receipts redeemable at par.',
    contracts: {
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
];

/** Check if a series has reached its expiry timestamp */
export const isSeriesEnded = (
  series: SeriesConfig,
  nowSecs: number = Math.floor(Date.now() / 1000),
): boolean => {
  return nowSecs >= series.expiry;
};

/** Get the dynamic status of a series */
export const getSeriesStatus = (
  series: SeriesConfig,
  nowSecs: number = Math.floor(Date.now() / 1000),
): SeriesStatus => {
  return isSeriesEnded(series, nowSecs) ? 'ended' : 'live';
};

/** Filter series by network */
export const getSeriesForNetwork = (network: NetworkKey): SeriesConfig[] => {
  return ALL_SERIES.filter((s) => s.network === network);
};

/** Get a series by its ID */
export const getSeriesById = (id: string): SeriesConfig | undefined => {
  return ALL_SERIES.find((s) => s.id === id);
};

/**
 * Returns default series ID for the network:
 * Prefers the first live series for that network.
 */
export const getDefaultSeriesId = (network: NetworkKey, isDemo: boolean = false): string => {
  if (network === 'mainnet') {
    if (isDemo) return 'mainnet-demo';
    return 'mainnet-series-2';
  }
  return 'testnet-series-2';
};

