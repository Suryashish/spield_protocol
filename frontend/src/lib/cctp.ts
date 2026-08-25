import { Contract, Networks, StrKey, TransactionBuilder, rpc, xdr } from '@stellar/stellar-sdk';
import { decodeFunctionData, encodeFunctionData, formatUnits, parseUnits } from 'viem';

import { NETWORK_KEY, type NetworkKey } from './config';

export type Hex = `0x${string}`;
export type TransferMode = 'standard' | 'fast';
export type CctpStep =
  | 'idle'
  | 'approving'
  | 'burning'
  | 'attesting'
  | 'forwarding'
  | 'complete'
  | 'error';
export type QuoteStatus = 'idle' | 'loading' | 'ready' | 'error';

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

export type CctpSource = {
  name: string;
  short: string;
  chainId: number;
  domain: number;
  usdc: Hex;
  fast: boolean;
  explorer: string;
  rpcUrl: string;
  nativeSymbol: string;
  nativeDecimals: number;
};

export type CctpConfig = {
  environment: NetworkKey;
  sources: CctpSource[];
  messenger: Hex;
  forwarder: string;
  stellarRpc: string;
  stellarPassphrase: string;
  stellarNetwork: 'PUBLIC' | 'TESTNET';
  iris: string;
};

export type SourceGasQuote = {
  status: QuoteStatus;
  approvalRequired: boolean;
  approvalCost: bigint | null;
  burnCost: bigint | null;
  nativeBalance: bigint | null;
  error?: string;
};

export type CircleAttestation = {
  status: string;
  message: Hex;
  attestation: Hex;
};

const env = (key: string, fallback: string): string => {
  const value = import.meta.env[key as keyof ImportMetaEnv] as string | undefined;
  return value?.trim() || fallback;
};

const SOURCES: Record<NetworkKey, CctpSource[]> = {
  mainnet: [
    {
      name: 'Ethereum', short: 'ETH', chainId: 1, domain: 0,
      usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', fast: true,
      explorer: 'https://etherscan.io/tx/', rpcUrl: 'https://ethereum-rpc.publicnode.com',
      nativeSymbol: 'ETH', nativeDecimals: 18,
    },
    {
      name: 'Base', short: 'BASE', chainId: 8453, domain: 6,
      usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', fast: true,
      explorer: 'https://basescan.org/tx/', rpcUrl: 'https://mainnet.base.org',
      nativeSymbol: 'ETH', nativeDecimals: 18,
    },
    {
      name: 'Arbitrum', short: 'ARB', chainId: 42161, domain: 3,
      usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', fast: true,
      explorer: 'https://arbiscan.io/tx/', rpcUrl: 'https://arb1.arbitrum.io/rpc',
      nativeSymbol: 'ETH', nativeDecimals: 18,
    },
    {
      name: 'OP Mainnet', short: 'OP', chainId: 10, domain: 2,
      usdc: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', fast: true,
      explorer: 'https://optimistic.etherscan.io/tx/', rpcUrl: 'https://mainnet.optimism.io',
      nativeSymbol: 'ETH', nativeDecimals: 18,
    },
    {
      name: 'Polygon', short: 'POL', chainId: 137, domain: 7,
      usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', fast: false,
      explorer: 'https://polygonscan.com/tx/', rpcUrl: 'https://polygon.drpc.org',
      nativeSymbol: 'POL', nativeDecimals: 18,
    },
    {
      name: 'Avalanche', short: 'AVAX', chainId: 43114, domain: 1,
      usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', fast: false,
      explorer: 'https://snowtrace.io/tx/', rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
      nativeSymbol: 'AVAX', nativeDecimals: 18,
    },
  ],
  testnet: [
    {
      name: 'Ethereum Sepolia', short: 'ETH', chainId: 11155111, domain: 0,
      usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', fast: true,
      explorer: 'https://sepolia.etherscan.io/tx/', rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
      nativeSymbol: 'ETH', nativeDecimals: 18,
    },
    {
      name: 'Avalanche Fuji', short: 'AVAX', chainId: 43113, domain: 1,
      usdc: '0x5425890298aed601595a70AB815c96711a31Bc65', fast: false,
      explorer: 'https://testnet.snowtrace.io/tx/', rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
      nativeSymbol: 'AVAX', nativeDecimals: 18,
    },
    {
      name: 'OP Sepolia', short: 'OP', chainId: 11155420, domain: 2,
      usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7', fast: true,
      explorer: 'https://sepolia-optimism.etherscan.io/tx/', rpcUrl: 'https://sepolia.optimism.io',
      nativeSymbol: 'ETH', nativeDecimals: 18,
    },
    {
      name: 'Arbitrum Sepolia', short: 'ARB', chainId: 421614, domain: 3,
      usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', fast: true,
      explorer: 'https://sepolia.arbiscan.io/tx/', rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
      nativeSymbol: 'ETH', nativeDecimals: 18,
    },
    {
      name: 'Base Sepolia', short: 'BASE', chainId: 84532, domain: 6,
      usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', fast: true,
      explorer: 'https://base-sepolia.blockscout.com/tx/', rpcUrl: 'https://sepolia.base.org',
      nativeSymbol: 'ETH', nativeDecimals: 18,
    },
    {
      name: 'Polygon Amoy', short: 'POL', chainId: 80002, domain: 7,
      usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582', fast: false,
      explorer: 'https://amoy.polygonscan.com/tx/', rpcUrl: 'https://polygon-amoy.drpc.org',
      nativeSymbol: 'POL', nativeDecimals: 18,
    },
    {
      name: 'Unichain Sepolia', short: 'UNI', chainId: 1301, domain: 10,
      usdc: '0x31d0220469e10c4E71834a79b1f276d740d3768F', fast: true,
      explorer: 'https://unichain-sepolia.blockscout.com/tx/', rpcUrl: 'https://sepolia.unichain.org',
      nativeSymbol: 'ETH', nativeDecimals: 18,
    },
    {
      name: 'Linea Sepolia', short: 'LINEA', chainId: 59141, domain: 11,
      usdc: '0xFEce4462D57bD51A6A552365A011b95f0E16d9B7', fast: true,
      explorer: 'https://sepolia.lineascan.build/tx/', rpcUrl: 'https://rpc.sepolia.linea.build',
      nativeSymbol: 'ETH', nativeDecimals: 18,
    },
    {
      name: 'Arc Testnet', short: 'ARC', chainId: 5042002, domain: 26,
      usdc: '0x3600000000000000000000000000000000000000', fast: false,
      explorer: 'https://testnet.arcscan.app/tx/', rpcUrl: 'https://rpc.testnet.arc.network',
      nativeSymbol: 'USDC', nativeDecimals: 6,
    },
  ],
};

const DEFAULTS: Record<NetworkKey, Pick<CctpConfig, 'messenger' | 'forwarder' | 'iris'>> = {
  mainnet: {
    messenger: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
    forwarder: 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T',
    iris: 'https://iris-api.circle.com/v2/messages',
  },
  testnet: {
    messenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    forwarder: 'CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ',
    iris: 'https://iris-api-sandbox.circle.com/v2/messages',
  },
};

/** CCTP is locked to the same build-time network as every other protocol module. */
export const DEFAULT_CCTP_ENVIRONMENT: NetworkKey = NETWORK_KEY;

const activeOverride = (
  environment: NetworkKey,
  suffix: string,
  fallback: string,
): string => {
  const scoped = env(`VITE_CCTP_${environment.toUpperCase()}_${suffix}`, fallback);
  return environment === DEFAULT_CCTP_ENVIRONMENT
    ? env(`VITE_CCTP_${suffix}`, scoped)
    : scoped;
};

const CCTP_CONFIGS: Record<NetworkKey, CctpConfig> = {
  mainnet: {
    environment: 'mainnet',
    sources: SOURCES.mainnet,
    messenger: activeOverride('mainnet', 'MESSENGER', DEFAULTS.mainnet.messenger) as Hex,
    forwarder: activeOverride('mainnet', 'FORWARDER', DEFAULTS.mainnet.forwarder),
    stellarRpc: activeOverride(
      'mainnet',
      'STELLAR_RPC',
      'https://mainnet.sorobanrpc.com',
    ),
    stellarPassphrase: Networks.PUBLIC,
    stellarNetwork: 'PUBLIC',
    iris: activeOverride('mainnet', 'IRIS_URL', DEFAULTS.mainnet.iris),
  },
  testnet: {
    environment: 'testnet',
    sources: SOURCES.testnet,
    messenger: activeOverride('testnet', 'MESSENGER', DEFAULTS.testnet.messenger) as Hex,
    forwarder: activeOverride('testnet', 'FORWARDER', DEFAULTS.testnet.forwarder),
    stellarRpc: activeOverride(
      'testnet',
      'STELLAR_RPC',
      'https://soroban-testnet.stellar.org',
    ),
    stellarPassphrase: Networks.TESTNET,
    stellarNetwork: 'TESTNET',
    iris: activeOverride('testnet', 'IRIS_URL', DEFAULTS.testnet.iris),
  },
};

export const getCctpConfig = (environment: NetworkKey): CctpConfig =>
  CCTP_CONFIGS[environment];

/** Backwards-compatible default; interactive bridge routes may select either config. */
export const CCTP_CONFIG = getCctpConfig(DEFAULT_CCTP_ENVIRONMENT);

const ERC20_ABI = [
  {
    type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function', name: 'allowance', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }],
  },
] as const;

const CCTP_ABI = [{
  type: 'function', name: 'depositForBurnWithHook', stateMutability: 'nonpayable',
  inputs: [
    { name: 'amount', type: 'uint256' },
    { name: 'destinationDomain', type: 'uint32' },
    { name: 'mintRecipient', type: 'bytes32' },
    { name: 'burnToken', type: 'address' },
    { name: 'destinationCaller', type: 'bytes32' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'minFinalityThreshold', type: 'uint32' },
    { name: 'hookData', type: 'bytes' },
  ],
  outputs: [],
}] as const;

export const CCTP_DESTINATION_DOMAIN = 27;
export const FAST_FINALITY_THRESHOLD = 1000;
export const STANDARD_FINALITY_THRESHOLD = 2000;
export const MAX_BURN_UNITS = 10_000_000n * 1_000_000n;

const sleep = (ms: number) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

export const bytesToHex = (bytes: Uint8Array): Hex =>
  `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

export const hexToBytes = (hex: Hex): Uint8Array =>
  Uint8Array.from((hex.slice(2).match(/.{1,2}/g) ?? []).map((byte) => Number.parseInt(byte, 16)));

export const parseUsdcUnits = (amount: string): bigint => {
  if (!/^\d+(\.\d{0,6})?$/.test(amount)) return 0n;
  try {
    return parseUnits(amount, 6);
  } catch {
    return 0n;
  }
};

export const formatTokenUnits = (
  units: bigint,
  decimals: number,
  maximumFractionDigits = decimals,
): string => {
  const raw = formatUnits(units, decimals);
  const [whole, fraction = ''] = raw.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const clippedFraction = fraction.slice(0, maximumFractionDigits).replace(/0+$/, '');
  return clippedFraction ? `${grouped}.${clippedFraction}` : grouped;
};

export const isValidStellarRecipient = (address: string): boolean =>
  StrKey.isValidEd25519PublicKey(address.trim()) ||
  StrKey.isValidMed25519PublicKey(address.trim()) ||
  StrKey.isValidContract(address.trim());

export const calculateProtocolFee = (amount: bigint, bps: string): bigint => {
  if (!/^\d+(\.\d+)?$/.test(bps)) throw new Error('Circle returned an invalid fee rate.');
  const [whole, fraction = ''] = bps.split('.');
  const numerator = BigInt(`${whole}${fraction}`);
  const denominator = 10_000n * (10n ** BigInt(fraction.length));
  return amount * numerator / denominator;
};

export const addFeeBuffer = (fee: bigint): bigint =>
  fee === 0n ? 0n : (fee * 120n + 99n) / 100n;

export const fetchCircleFeeRate = async (
  config: CctpConfig,
  sourceDomain: number,
  finalityThreshold: number,
  signal?: AbortSignal,
): Promise<string> => {
  const irisBase = config.iris.replace(/\/v2\/messages\/?$/, '');
  const response = await fetch(
    `${irisBase}/v2/burn/USDC/fees/${sourceDomain}/${CCTP_DESTINATION_DOMAIN}`,
    { signal },
  );
  if (!response.ok) throw new Error(`Circle fee service returned ${response.status}.`);
  const fees = await response.json() as Array<{
    finalityThreshold: number;
    minimumFee: number | string;
  }>;
  const match = fees.find((item) => item.finalityThreshold === finalityThreshold);
  if (!match) throw new Error('Circle did not return a fee for the selected finality.');
  const bps = String(match.minimumFee);
  if (!/^\d+(\.\d+)?$/.test(bps)) throw new Error('Circle returned an invalid fee rate.');
  return bps;
};

const buildHookData = (recipient: string): Hex => {
  const recipientBytes = new TextEncoder().encode(recipient);
  const bytes = new Uint8Array(32 + recipientBytes.length);
  new DataView(bytes.buffer).setUint32(28, recipientBytes.length, false);
  bytes.set(recipientBytes, 32);
  return bytesToHex(bytes);
};

const decodeHookRecipient = (hookData: Hex): string => {
  const bytes = hexToBytes(hookData);
  if (bytes.length < 32) throw new Error('CCTP hook data is too short.');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint32(28, false);
  if (length !== bytes.length - 32) throw new Error('CCTP hook recipient length is invalid.');
  const recipient = new TextDecoder().decode(bytes.slice(32));
  if (!isValidStellarRecipient(recipient)) {
    throw new Error('CCTP hook contains an invalid Stellar recipient.');
  }
  return recipient;
};

const decodeRecipientFromBurnCalldata = (calldata: Hex): string => {
  const decoded = decodeFunctionData({ abi: CCTP_ABI, data: calldata });
  const hookData = (decoded.args as readonly unknown[] | undefined)?.[7];
  if (typeof hookData !== 'string' || !hookData.startsWith('0x')) {
    throw new Error('Could not read hook data from the CCTP burn calldata.');
  }
  return decodeHookRecipient(hookData as Hex);
};

export const buildBurnCalldata = ({
  config,
  source,
  amount,
  recipient,
  maxFee,
  finalityThreshold,
}: {
  config: CctpConfig;
  source: CctpSource;
  amount: bigint;
  recipient: string;
  maxFee: bigint;
  finalityThreshold: number;
}): Hex => {
  const trimmedRecipient = recipient.trim();
  if (!isValidStellarRecipient(trimmedRecipient)) {
    throw new Error('The Stellar recipient is invalid.');
  }
  const forwarder = bytesToHex(StrKey.decodeContract(config.forwarder));
  const hookData = buildHookData(trimmedRecipient);
  if (decodeHookRecipient(hookData) !== trimmedRecipient) {
    throw new Error('The Stellar recipient changed while preparing CCTP hook data.');
  }
  const calldata = encodeFunctionData({
    abi: CCTP_ABI,
    functionName: 'depositForBurnWithHook',
    args: [
      amount,
      CCTP_DESTINATION_DOMAIN,
      forwarder,
      source.usdc,
      forwarder,
      maxFee,
      finalityThreshold,
      hookData,
    ],
  });
  if (decodeRecipientFromBurnCalldata(calldata) !== trimmedRecipient) {
    throw new Error('The final CCTP burn calldata does not contain the confirmed recipient.');
  }
  return calldata;
};

export const getActiveChainId = async (provider: Eip1193Provider): Promise<number> =>
  Number.parseInt(await provider.request({ method: 'eth_chainId' }) as string, 16);

export const switchEvmNetwork = async (
  provider: Eip1193Provider,
  source: CctpSource,
): Promise<void> => {
  const chainId = `0x${source.chainId.toString(16)}`;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (error) {
    if ((error as { code?: number })?.code !== 4902) throw error;
    const explorerRoot = source.explorer.replace(/\/tx\/$/, '');
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId,
        chainName: source.name,
        nativeCurrency: {
          name: source.nativeSymbol,
          symbol: source.nativeSymbol,
          decimals: source.nativeDecimals,
        },
        rpcUrls: [source.rpcUrl],
        blockExplorerUrls: [explorerRoot],
      }],
    });
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  }
};

export const getUsdcBalance = async (
  provider: Eip1193Provider,
  address: string,
  source: CctpSource,
): Promise<bigint> => {
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address as Hex],
  });
  const result = await provider.request({
    method: 'eth_call',
    params: [{ to: source.usdc, data }, 'latest'],
  }) as Hex;
  return BigInt(result);
};

export const getAllowance = async (
  provider: Eip1193Provider,
  owner: string,
  token: Hex,
  messenger: Hex,
): Promise<bigint> => {
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner as Hex, messenger],
  });
  return BigInt(await provider.request({
    method: 'eth_call',
    params: [{ to: token, data }, 'latest'],
  }) as Hex);
};

export const buildApprovalCalldata = (messenger: Hex, amount: bigint): Hex =>
  encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [messenger, amount],
  });

export const estimateSourceGas = async ({
  provider,
  address,
  config,
  source,
  amount,
  recipient,
  maxFee,
  finalityThreshold,
}: {
  provider: Eip1193Provider;
  address: string;
  config: CctpConfig;
  source: CctpSource;
  amount: bigint;
  recipient: string;
  maxFee: bigint;
  finalityThreshold: number;
}): Promise<SourceGasQuote> => {
  if (await getActiveChainId(provider) !== source.chainId) {
    throw new Error(`Switch to ${source.name} for a gas quote.`);
  }
  const [allowance, gasPriceHex, nativeBalanceHex] = await Promise.all([
    getAllowance(provider, address, source.usdc, config.messenger),
    provider.request({ method: 'eth_gasPrice' }) as Promise<Hex>,
    provider.request({ method: 'eth_getBalance', params: [address, 'latest'] }) as Promise<Hex>,
  ]);
  const gasPrice = BigInt(gasPriceHex);
  const approvalRequired = allowance < amount;
  let approvalCost: bigint | null = null;
  let burnCost: bigint | null = null;

  if (approvalRequired) {
    const data = buildApprovalCalldata(config.messenger, amount);
    const gas = BigInt(await provider.request({
      method: 'eth_estimateGas',
      params: [{ from: address, to: source.usdc, data }],
    }) as Hex);
    approvalCost = gas * gasPrice;
  } else {
    const data = buildBurnCalldata({
      config, source, amount, recipient, maxFee, finalityThreshold,
    });
    const gas = BigInt(await provider.request({
      method: 'eth_estimateGas',
      params: [{ from: address, to: config.messenger, data }],
    }) as Hex);
    burnCost = gas * gasPrice;
  }

  return {
    status: 'ready',
    approvalRequired,
    approvalCost,
    burnCost,
    nativeBalance: BigInt(nativeBalanceHex),
  };
};

export const sendEvmTransaction = async (
  provider: Eip1193Provider,
  from: string,
  to: Hex,
  data: Hex,
): Promise<string> => {
  const hash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{ from, to, data }],
  }) as string;
  for (let tries = 0; tries < 120; tries += 1) {
    const receipt = await provider.request({
      method: 'eth_getTransactionReceipt',
      params: [hash],
    }) as { status?: Hex } | null;
    if (receipt) {
      if (receipt.status === '0x0') throw new Error('Transaction reverted.');
      return hash;
    }
    await sleep(1_500);
  }
  throw new Error('Transaction confirmation timed out. Check your wallet activity.');
};

export const getAttestation = async (
  config: CctpConfig,
  source: CctpSource,
  hash: string,
): Promise<CircleAttestation> => {
  // Standard-finality messages can take longer than 15 minutes on Ethereum.
  // Keep polling for up to one hour so a valid burn is not reported as failed.
  for (let tries = 0; tries < 720; tries += 1) {
    const response = await fetch(`${config.iris}/${source.domain}?transactionHash=${hash}`);
    if (response.ok) {
      const data = await response.json() as { messages?: CircleAttestation[] };
      const message = data.messages?.[0];
      if (message?.status === 'complete') return message;
    }
    await sleep(5_000);
  }
  throw new Error(
    'Attestation is still pending. Your burn is safe; keep the transaction hash to resume.',
  );
};

export const getStellarInclusionFee = async (config: CctpConfig): Promise<string> => {
  const stats = await new rpc.Server(config.stellarRpc).getFeeStats();
  return stats.sorobanInclusionFee.p95;
};

export const mintAndForward = async ({
  config,
  message,
  attestation,
  recipient,
  signTransaction,
  onPreparedFee,
}: {
  config: CctpConfig;
  message: Hex;
  attestation: Hex;
  recipient: string;
  signTransaction: (
    xdr: string,
    options: { networkPassphrase: string; address: string },
  ) => Promise<{ signedTxXdr: string; error?: { message: string } | null }>;
  onPreparedFee?: (fee: string) => void;
}): Promise<string> => {
  const server = new rpc.Server(config.stellarRpc);
  const account = await server.getAccount(recipient);
  let inclusionFee = 100n;
  try {
    const stats = await server.getFeeStats();
    inclusionFee = BigInt(stats.sorobanInclusionFee.p95);
    if (inclusionFee < 100n) inclusionFee = 100n;
  } catch {
    // The network minimum remains a safe fallback outside surge periods.
  }
  const transaction = new TransactionBuilder(account, {
    fee: inclusionFee.toString(),
    networkPassphrase: config.stellarPassphrase,
  })
    .addOperation(
      new Contract(config.forwarder).call(
        'mint_and_forward',
        xdr.ScVal.scvBytes(hexToBytes(message) as unknown as Buffer),
        xdr.ScVal.scvBytes(hexToBytes(attestation) as unknown as Buffer),
      ),
    )
    .setTimeout(120)
    .build();
  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error('Stellar transaction simulation failed.');
  }
  const prepared = rpc.assembleTransaction(transaction, simulation).build();
  onPreparedFee?.(prepared.fee);
  const signed = await signTransaction(prepared.toXDR(), {
    networkPassphrase: config.stellarPassphrase,
    address: recipient,
  });
  if (signed.error || !signed.signedTxXdr) {
    throw new Error(signed.error?.message || 'Stellar signature was rejected.');
  }
  const result = await server.sendTransaction(
    TransactionBuilder.fromXDR(signed.signedTxXdr, config.stellarPassphrase),
  );
  if (result.status !== 'PENDING' && result.status !== 'DUPLICATE') {
    throw new Error('Stellar transaction was rejected.');
  }
  for (let tries = 0; tries < 60; tries += 1) {
    const transactionResult = await server.getTransaction(result.hash);
    if (transactionResult.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return result.hash;
    }
    if (transactionResult.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error('Stellar mint-and-forward transaction failed.');
    }
    await sleep(1_000);
  }
  throw new Error(
    'Stellar mint-and-forward is still pending. Check the transaction hash before retrying.',
  );
};
