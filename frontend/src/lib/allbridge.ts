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
import { BrowserProvider, type Eip1193Provider } from 'ethers';

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
 * Build the SDK with any custom RPCs the user configured. The SDK only *requires*
 * an RPC for Solana; EVM chains fall back to the injected wallet provider, so we
 * only pass the EVM entries that are actually set.
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

/** Look up the cross-chain transfer status by the SOURCE chain + source tx id. */
export const getTransferStatus = (sourceChainSymbol: string, txId: string) =>
  sdk.getTransferStatus(sourceChainSymbol, txId);

/**
 * The connected account's balance of `token` (float string), read via the SDK's
 * configured/default RPC for that chain. EVM balance reads therefore need a
 * `VITE_BRIDGE_RPC_*` for the chain (Solana uses the configured Solana RPC; the
 * default mainnet endpoint works for the common chains). Returns the SDK's
 * float-formatted balance.
 */
export const getTokenBalance = (account: string, token: BridgeToken): Promise<string> =>
  sdk.getTokenBalance({ account, token });

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
