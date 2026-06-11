import {
  AllbridgeCoreSdk,
  ChainSymbol,
  ChainType,
  Messenger,
  nodeRpcUrlsDefault,
  type ChainDetailsWithTokens,
  type RawEvmTransaction,
  type RawSorobanTransaction,
  type TokenWithChainDetails,
} from '@allbridge/bridge-core-sdk';
import { Connection, VersionedTransaction } from '@solana/web3.js';
import { BrowserProvider, Contract, formatUnits, type Eip1193Provider } from 'ethers';

import { BRIDGE_RPC, NETWORK } from './config';
import { signWithWallet } from './stellar';

/**
 * Allbridge Core bridge integration.
 *
 * Allbridge Core is a MAINNET-ONLY product — the SDK ships a single (mainnet)
 * config and there is no testnet (`BRIDGE_ENABLED` in `config.ts` reflects this).
 * We therefore always talk to mainnet liquidity here so quotes are real; the *UI*
 * decides whether to allow execution based on the app's target network.
 *
 * This module owns three things:
 *   1. The SDK instance (configured with custom RPCs where the SDK needs them).
 *   2. Read helpers used to populate the UI (chains, quote, fee, status).
 *   3. The EXECUTION layer — building, signing and submitting the bridge tx per
 *      source-chain family:
 *        • Stellar / Soroban (SRB) → signed by the app's existing Stellar wallet.
 *        • EVM (ETH/BSC/POL/…)     → approve + send, signed via a Reown/ethers signer.
 *        • Solana (SOL)            → a VersionedTransaction signed by a Solana wallet.
 */

/**
 * Build the SDK with our RPCs merged over the SDK's bundled defaults. The defaults
 * cover SOL/TRX/Stellar but NOT EVM chains, so we MUST supply EVM RPCs here or any
 * EVM-source operation throws "Node RPC URL not initialized" (see `BRIDGE_RPC` in
 * config for the public defaults + how to override them).
 */
const rpcUrls: Record<string, string> = { ...nodeRpcUrlsDefault };
if (BRIDGE_RPC.SOL) rpcUrls.SOL = BRIDGE_RPC.SOL;
if (BRIDGE_RPC.ETH) rpcUrls.ETH = BRIDGE_RPC.ETH;
if (BRIDGE_RPC.BSC) rpcUrls.BSC = BRIDGE_RPC.BSC;
if (BRIDGE_RPC.POL) rpcUrls.POL = BRIDGE_RPC.POL;
if (BRIDGE_RPC.ARB) rpcUrls.ARB = BRIDGE_RPC.ARB;
if (BRIDGE_RPC.TRX) rpcUrls.TRX = BRIDGE_RPC.TRX;

export const sdk = new AllbridgeCoreSdk(rpcUrls);

/** The messenger (routing protocol) we use for every transfer. */
export const MESSENGER = Messenger.ALLBRIDGE;

/** A token's `tokenAddress` is its unique key within a chain (symbol is ambiguous). */
export type BridgeToken = TokenWithChainDetails;

// ── Reads ───────────────────────────────────────────────────────────────────

/** Fetch the supported chains + their tokens (mainnet liquidity). */
export const getBridgeChains = async (): Promise<ChainDetailsWithTokens[]> => {
  const map = await sdk.chainDetailsMap();
  return Object.values(map);
};

/** Amount the recipient receives after the bridging fee (float string). */
export const getAmountToReceive = (amount: string, source: BridgeToken, dest: BridgeToken) =>
  sdk.getAmountToBeReceived(amount, source, dest);

/** Available gas-fee options for a route (native + stablecoin), in INT and FLOAT. */
export const getGasFee = (source: BridgeToken, dest: BridgeToken) =>
  sdk.getGasFeeOptions(source, dest, MESSENGER);

/**
 * Average time (in milliseconds) the bridge takes to deliver funds for this route,
 * via our messenger. This is the same estimate Allbridge's own UI shows. Returns
 * null when the SDK has no estimate for the chosen token pair / messenger.
 */
export const getAverageTransferTimeMs = (source: BridgeToken, dest: BridgeToken): number | null =>
  sdk.getAverageTransferTime(source, dest, MESSENGER);

/** Look up the cross-chain transfer status by the SOURCE chain + source tx id. */
export const getTransferStatus = (sourceChainSymbol: string, txId: string) =>
  sdk.getTransferStatus(sourceChainSymbol, txId);

/**
 * A normalized, UI-friendly snapshot of a cross-chain transfer's progress.
 *
 * Allbridge transfers are async: the source tx confirms first (`send`), then the
 * messenger collects signatures, then the funds are claimed on the destination
 * (`receive`). We map that to three states the UI cares about, and surface the
 * DESTINATION block time as the completion timestamp — that's the moment the USDC
 * actually landed on Stellar, which is what "completion time" means to a user.
 */
export type BridgeProgress = {
  /** `pending` = source confirmed, awaiting delivery; `completed` = funds received. */
  state: 'pending' | 'completed';
  /** Validator signatures collected so far (progress within the pending phase). */
  signaturesCount: number;
  /** Signatures needed before the destination claim can happen. */
  signaturesNeeded: number;
  /** Unix ms the funds landed on Stellar, or null while still pending. */
  completedAt: number | null;
  /** Destination-chain tx hash once received, else null. */
  receiveHash: string | null;
};

/**
 * Poll a transfer's status and normalize it. Returns null when the SDK has no
 * record yet (very recently submitted, or indexer lag) so callers can keep polling
 * without treating "not found" as an error.
 *
 * `receive.blockTime` is reported in SECONDS (chain block time); we convert to ms
 * so it composes with the rest of the app's unix-ms timestamps.
 */
export const getBridgeProgress = async (
  sourceChainSymbol: string,
  txId: string,
): Promise<BridgeProgress | null> => {
  let status;
  try {
    status = await sdk.getTransferStatus(sourceChainSymbol, txId);
  } catch {
    // The core API 404s for an as-yet-unindexed tx — treat as "not known yet".
    return null;
  }
  if (!status) return null;

  const received = status.receive;
  return {
    state: received ? 'completed' : 'pending',
    signaturesCount: status.signaturesCount ?? 0,
    signaturesNeeded: status.signaturesNeeded ?? 0,
    completedAt: received?.blockTime ? received.blockTime * 1000 : null,
    receiveHash: received?.hash ?? null,
  };
};

/** Minimal ERC-20 ABI — just the reads we need for a balance. */
const ERC20_BALANCE_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

/**
 * The connected account's balance of `token` (float string).
 *
 * For EVM sources we read the balance through the CONNECTED WALLET's EIP-1193
 * provider via ethers, not the SDK. The SDK's balance read uses our public
 * `VITE_BRIDGE_RPC_*` endpoints (llamarpc et al.), which routinely rate-limit and
 * fail — so the balance came back blank ("—"). The wallet's own provider is
 * reliable and reads the exact chain the user is on. We pass the token's declared
 * `decimals` (Allbridge already gives us this) to format the raw integer balance.
 *
 * For Solana (no EIP-1193 provider) we fall back to the SDK, which uses the
 * configured Solana RPC.
 */
export const getTokenBalance = async (
  account: string,
  token: BridgeToken,
  evmProvider?: Eip1193Provider,
): Promise<string> => {
  if (token.chainType === ChainType.EVM && evmProvider) {
    try {
      const provider = new BrowserProvider(evmProvider);

      // The wallet reads from whatever chain it's CURRENTLY on. If that doesn't
      // match the token's chain (e.g. wallet on Ethereum, source picked = Polygon),
      // a balanceOf would query the wrong network — so only trust the wallet read
      // when the chains line up; otherwise fall through to the chain-specific RPC.
      if (token.chainId) {
        const net = await provider.getNetwork();
        const walletChainId = `0x${net.chainId.toString(16)}`;
        if (walletChainId.toLowerCase() !== token.chainId.toLowerCase()) {
          return sdk.getTokenBalance({ account, token });
        }
      }

      const erc20 = new Contract(token.tokenAddress, ERC20_BALANCE_ABI, provider);
      const raw: bigint = await erc20.balanceOf(account);
      return formatUnits(raw, token.decimals);
    } catch {
      // Wallet read failed for any reason — fall back to the SDK's RPC path.
      return sdk.getTokenBalance({ account, token });
    }
  }
  return sdk.getTokenBalance({ account, token });
};

// ── Chain classification ──────────────────────────────────────────────────────

/** How a source chain must be signed — drives which wallet the UI asks for. */
export type SourceFamily = 'stellar' | 'evm' | 'solana' | 'unsupported';

/**
 * Classify a chain by how we execute a transfer FROM it. Note Allbridge exposes
 * BOTH `SRB` (Soroban — the smart-contract chain this app deploys to) and `STLR`
 * (classic Stellar); we treat Soroban as our local-wallet path. EVM covers every
 * `ChainType.EVM` network. Solana is its own family. Anything else (TRON, SUI,
 * Algorand, Stacks, classic Stellar) we don't yet sign for from this app.
 */
export const sourceFamily = (chain: ChainDetailsWithTokens | undefined): SourceFamily => {
  if (!chain) return 'unsupported';
  if (chain.chainSymbol === ChainSymbol.SRB) return 'stellar';
  if (chain.chainType === ChainType.EVM) return 'evm';
  if (chain.chainSymbol === ChainSymbol.SOL) return 'solana';
  return 'unsupported';
};

/** True when both endpoints are the same chain AND token (a no-op transfer). */
export const isSameToken = (a: BridgeToken | undefined, b: BridgeToken | undefined) =>
  Boolean(a && b && a.chainSymbol === b.chainSymbol && a.tokenAddress === b.tokenAddress);

/** True when a chain is one we can bridge FROM (has a wallet path we support). */
export const isSupportedSource = (chain: ChainDetailsWithTokens): boolean => {
  const f = sourceFamily(chain);
  return f === 'evm' || f === 'solana';
};

/**
 * The destination is fixed to Stellar (Soroban) USDC — this product bridges value
 * INTO Stellar. Find that token from the chain map. Matches a token symbol of
 * `USDC` on the Soroban chain.
 */
export const findStellarUsdc = (chains: ChainDetailsWithTokens[]): BridgeToken | undefined => {
  const soroban = chains.find((c) => sourceFamily(c) === 'stellar');
  if (!soroban) return undefined;
  return (
    soroban.tokens.find((t) => t.symbol.toUpperCase() === 'USDC') ?? soroban.tokens[0]
  );
};

// ── Execution ─────────────────────────────────────────────────────────────────

export type BridgeResult = {
  /** Source-chain tx hash/id — used to poll {@link getTransferStatus}. */
  hash: string;
};

type SendArgs = {
  amount: string;
  fromAddress: string;
  toAddress: string;
  sourceToken: BridgeToken;
  destinationToken: BridgeToken;
};

/**
 * Bridge FROM Stellar/Soroban using the app's connected Stellar wallet.
 *
 * `rawTxBuilder.send` returns a Soroban XDR string. Before signing we must (a)
 * ensure the recipient/source has the token trustline, and (b) restore any
 * archived ledger entries the tx touches (Soroban state expiry) — otherwise the
 * submit fails. We then sign with the existing wallet adapter and submit.
 */
export const bridgeFromStellar = async (args: SendArgs): Promise<BridgeResult> => {
  const { amount, fromAddress, toAddress, sourceToken, destinationToken } = args;

  // 1. Ensure a trustline to the source token exists (Soroban SAC balance line).
  const balanceLine = await sdk.utils.srb.getBalanceLine(fromAddress, sourceToken.tokenAddress);
  if (!balanceLine) {
    const trustXdr = await sdk.utils.srb.buildChangeTrustLineXdrTx({
      sender: fromAddress,
      tokenAddress: sourceToken.tokenAddress,
    });
    await signAndSendSoroban(trustXdr, fromAddress);
  }

  // 2. Build the transfer tx.
  const rawTx = (await sdk.bridge.rawTxBuilder.send({
    amount,
    fromAccountAddress: fromAddress,
    toAccountAddress: toAddress,
    sourceToken,
    destinationToken,
    messenger: MESSENGER,
  })) as RawSorobanTransaction;

  // 3. Restore archived entries first if the simulation says they're needed.
  const restoreXdr = await sdk.utils.srb.simulateAndCheckRestoreTxRequiredSoroban(rawTx, fromAddress);
  if (restoreXdr) {
    await signAndSendSoroban(restoreXdr, fromAddress);
  }

  // 4. Sign + submit the transfer.
  const hash = await signAndSendSoroban(rawTx, fromAddress);
  return { hash };
};

/** Sign a Soroban XDR with the app wallet, submit via the SDK, return the hash. */
const signAndSendSoroban = async (xdr: string, address: string): Promise<string> => {
  const { signedTxXdr, error } = await signWithWallet(xdr, {
    networkPassphrase: NETWORK.passphrase,
    address,
  });
  if (error) {
    throw new Error(error.message || 'Transaction was rejected in the wallet.');
  }
  const res = await sdk.utils.srb.sendTransactionSoroban(signedTxXdr);
  if (res.status !== 'PENDING') {
    throw new Error(`Soroban submission failed (status: ${res.status}).`);
  }
  return res.hash;
};

/**
 * Bridge FROM an EVM chain using an injected EIP-1193 provider (via Reown/ethers).
 *
 * EVM is two steps: ensure the bridge contract is approved to spend the token,
 * then send. Both come back as `{ to, data, value }` and are dispatched through
 * the ethers signer obtained from the connected wallet.
 */
export const bridgeFromEvm = async (
  args: SendArgs,
  eip1193: Eip1193Provider,
): Promise<BridgeResult> => {
  const { amount, fromAddress, toAddress, sourceToken, destinationToken } = args;

  const provider = new BrowserProvider(eip1193);
  const signer = await provider.getSigner();

  // 1. Approve if the current allowance is insufficient.
  const approved = await sdk.bridge.checkAllowance({
    token: sourceToken,
    owner: fromAddress,
    amount,
  });
  if (!approved) {
    const approveTx = (await sdk.bridge.rawTxBuilder.approve({
      token: sourceToken,
      owner: fromAddress,
    })) as RawEvmTransaction;
    const sent = await signer.sendTransaction({
      to: approveTx.to,
      data: approveTx.data,
      value: approveTx.value ? BigInt(approveTx.value) : undefined,
    });
    await sent.wait();
  }

  // 2. Send the transfer.
  const sendTx = (await sdk.bridge.rawTxBuilder.send({
    amount,
    fromAccountAddress: fromAddress,
    toAccountAddress: toAddress,
    sourceToken,
    destinationToken,
    messenger: MESSENGER,
  })) as RawEvmTransaction;

  const tx = await signer.sendTransaction({
    to: sendTx.to,
    data: sendTx.data,
    value: sendTx.value ? BigInt(sendTx.value) : undefined,
  });
  const receipt = await tx.wait();
  return { hash: receipt?.hash ?? tx.hash };
};

/** Minimal shape of a Solana wallet that can sign + send a versioned tx. */
export type SolanaSigner = {
  publicKey: { toBase58(): string } | null;
  signTransaction<T extends VersionedTransaction>(tx: T): Promise<T>;
};

/**
 * Bridge FROM Solana. The SDK returns a `VersionedTransaction`; the connected
 * Solana wallet signs it and we broadcast over the configured Solana RPC. Solana
 * needs no separate approval step (token delegation is built into the tx).
 */
export const bridgeFromSolana = async (
  args: SendArgs,
  wallet: SolanaSigner,
): Promise<BridgeResult> => {
  const { amount, fromAddress, toAddress, sourceToken, destinationToken } = args;

  const rawTx = (await sdk.bridge.rawTxBuilder.send({
    amount,
    fromAccountAddress: fromAddress,
    toAccountAddress: toAddress,
    sourceToken,
    destinationToken,
    messenger: MESSENGER,
  })) as unknown as VersionedTransaction;

  const signed = await wallet.signTransaction(rawTx);

  // Broadcast via @solana/web3.js against the configured RPC.
  const connection = new Connection(BRIDGE_RPC.SOL, 'confirmed');
  const hash = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(hash, 'confirmed');
  return { hash };
};
