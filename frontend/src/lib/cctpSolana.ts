import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type SendOptions,
} from '@solana/web3.js';
import { StrKey } from '@stellar/stellar-sdk';

import {
  CCTP_DESTINATION_DOMAIN,
  buildStellarForwarderHookData,
  isValidStellarRecipient,
  type CctpConfig,
  type SolanaCctpSource,
} from './cctp';

export const SOLANA_TOKEN_MESSENGER_MINTER_V2 = new PublicKey(
  'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe',
);
export const SOLANA_MESSAGE_TRANSMITTER_V2 = new PublicKey(
  'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC',
);
export const SOLANA_TOKEN_PROGRAM = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);
export const SOLANA_ASSOCIATED_TOKEN_PROGRAM = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

export const SOLANA_DEPOSIT_FOR_BURN_WITH_HOOK_DISCRIMINATOR = Uint8Array.from([
  111, 245, 62, 131, 204, 108, 223, 155,
]);

export type SolanaWalletProvider = {
  /** Connector name exposed by Reown wallet-standard providers. */
  name?: string;
  publicKey?: PublicKey;
  sendTransaction: (
    transaction: Transaction,
    connection: Connection,
    options?: SendOptions,
  ) => Promise<string>;
};

type PhantomInjectedProvider = {
  isPhantom?: boolean;
  publicKey?: PublicKey;
  connect: () => Promise<{ publicKey: PublicKey }>;
  signTransaction: (transaction: Transaction) => Promise<Transaction>;
};

const getInjectedPhantomProvider = (): PhantomInjectedProvider | undefined => {
  if (typeof window === 'undefined') return undefined;
  const phantom = (window as Window & {
    phantom?: { solana?: PhantomInjectedProvider };
  }).phantom?.solana;
  return phantom?.isPhantom ? phantom : undefined;
};

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const u32le = (value: number): Uint8Array => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error('CCTP u32 value is out of range.');
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
};

const u64le = (value: bigint): Uint8Array => {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error('CCTP u64 value is out of range.');
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
};

const pda = (programId: PublicKey, ...seeds: Uint8Array[]): PublicKey =>
  PublicKey.findProgramAddressSync(seeds.map((seed) => seed as Buffer), programId)[0];

export const createSolanaConnection = (source: SolanaCctpSource): Connection =>
  new Connection(source.rpcUrl, 'confirmed');

const assertSolanaNetwork = async (
  connection: Connection,
  source: SolanaCctpSource,
): Promise<void> => {
  const genesisHash = await connection.getGenesisHash();
  if (genesisHash !== source.genesisHash) {
    throw new Error(`The Solana RPC is not connected to ${source.name}.`);
  }
};

export const getAssociatedUsdcAccount = (
  owner: PublicKey,
  usdcMint: PublicKey,
): PublicKey => pda(
  SOLANA_ASSOCIATED_TOKEN_PROGRAM,
  owner.toBytes(),
  SOLANA_TOKEN_PROGRAM.toBytes(),
  usdcMint.toBytes(),
);

export const getSolanaUsdcBalance = async (
  connection: Connection,
  ownerAddress: string,
  source: SolanaCctpSource,
): Promise<bigint> => {
  await assertSolanaNetwork(connection, source);
  const owner = new PublicKey(ownerAddress);
  const tokenAccount = getAssociatedUsdcAccount(owner, new PublicKey(source.usdc));
  if (!await connection.getAccountInfo(tokenAccount, 'confirmed')) return 0n;
  const balance = await connection.getTokenAccountBalance(tokenAccount, 'confirmed');
  if (balance.value.decimals !== 6) {
    throw new Error('The configured Solana USDC mint does not use six decimals.');
  }
  return BigInt(balance.value.amount);
};

export const buildSolanaBurnInstruction = ({
  config,
  source,
  owner,
  eventAccount,
  amount,
  recipient,
  maxFee,
  finalityThreshold,
}: {
  config: CctpConfig;
  source: SolanaCctpSource;
  owner: PublicKey;
  eventAccount: PublicKey;
  amount: bigint;
  recipient: string;
  maxFee: bigint;
  finalityThreshold: number;
}): TransactionInstruction => {
  if (!StrKey.isValidContract(config.forwarder)) {
    throw new Error('The configured Stellar CCTP Forwarder is invalid.');
  }
  if (!isValidStellarRecipient(recipient)) {
    throw new Error('The Stellar recipient is invalid.');
  }
  const usdcMint = new PublicKey(source.usdc);
  const forwarder = StrKey.decodeContract(config.forwarder);
  const hookHex = buildStellarForwarderHookData(recipient);
  const hookData = Uint8Array.from(hookHex.slice(2).match(/.{2}/g)?.map((byte) =>
    Number.parseInt(byte, 16)) ?? []);

  const senderAuthority = pda(SOLANA_TOKEN_MESSENGER_MINTER_V2, text('sender_authority'));
  const denylistAccount = pda(
    SOLANA_TOKEN_MESSENGER_MINTER_V2,
    text('denylist_account'),
    owner.toBytes(),
  );
  const messageTransmitter = pda(SOLANA_MESSAGE_TRANSMITTER_V2, text('message_transmitter'));
  const tokenMessenger = pda(SOLANA_TOKEN_MESSENGER_MINTER_V2, text('token_messenger'));
  const remoteTokenMessenger = pda(
    SOLANA_TOKEN_MESSENGER_MINTER_V2,
    text('remote_token_messenger'),
    text(String(CCTP_DESTINATION_DOMAIN)),
  );
  const tokenMinter = pda(SOLANA_TOKEN_MESSENGER_MINTER_V2, text('token_minter'));
  const localToken = pda(
    SOLANA_TOKEN_MESSENGER_MINTER_V2,
    text('local_token'),
    usdcMint.toBytes(),
  );
  const tokenEventAuthority = pda(
    SOLANA_TOKEN_MESSENGER_MINTER_V2,
    text('__event_authority'),
  );
  const messageEventAuthority = pda(
    SOLANA_MESSAGE_TRANSMITTER_V2,
    text('__event_authority'),
  );
  const senderUsdcAccount = getAssociatedUsdcAccount(owner, usdcMint);

  const data = concatBytes(
    SOLANA_DEPOSIT_FOR_BURN_WITH_HOOK_DISCRIMINATOR,
    u64le(amount),
    u32le(CCTP_DESTINATION_DOMAIN),
    forwarder,
    forwarder,
    u64le(maxFee),
    u32le(finalityThreshold),
    u32le(hookData.length),
    hookData,
  );

  return new TransactionInstruction({
    programId: SOLANA_TOKEN_MESSENGER_MINTER_V2,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: senderAuthority, isSigner: false, isWritable: false },
      { pubkey: senderUsdcAccount, isSigner: false, isWritable: true },
      { pubkey: denylistAccount, isSigner: false, isWritable: false },
      { pubkey: messageTransmitter, isSigner: false, isWritable: true },
      { pubkey: tokenMessenger, isSigner: false, isWritable: false },
      { pubkey: remoteTokenMessenger, isSigner: false, isWritable: false },
      { pubkey: tokenMinter, isSigner: false, isWritable: false },
      { pubkey: localToken, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: true },
      { pubkey: eventAccount, isSigner: true, isWritable: true },
      { pubkey: SOLANA_MESSAGE_TRANSMITTER_V2, isSigner: false, isWritable: false },
      { pubkey: SOLANA_TOKEN_MESSENGER_MINTER_V2, isSigner: false, isWritable: false },
      { pubkey: SOLANA_TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenEventAuthority, isSigner: false, isWritable: false },
      { pubkey: SOLANA_TOKEN_MESSENGER_MINTER_V2, isSigner: false, isWritable: false },
      { pubkey: messageEventAuthority, isSigner: false, isWritable: false },
      { pubkey: SOLANA_MESSAGE_TRANSMITTER_V2, isSigner: false, isWritable: false },
    ],
    data: data as Buffer,
  });
};

const prepareSolanaBurn = async ({
  connection,
  ...params
}: Omit<Parameters<typeof buildSolanaBurnInstruction>[0], 'eventAccount'> & {
  connection: Connection;
}): Promise<{ transaction: Transaction; eventAccount: Keypair }> => {
  await assertSolanaNetwork(connection, params.source);
  const eventAccount = Keypair.generate();
  const instruction = buildSolanaBurnInstruction({ ...params, eventAccount: eventAccount.publicKey });
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({
    feePayer: params.owner,
    blockhash,
    lastValidBlockHeight,
  }).add(instruction);
  transaction.partialSign(eventAccount);
  return { transaction, eventAccount };
};

export const estimateSolanaBurnFee = async (
  params: Omit<Parameters<typeof buildSolanaBurnInstruction>[0], 'eventAccount'>,
): Promise<{ burnCost: bigint; nativeBalance: bigint }> => {
  const connection = createSolanaConnection(params.source);
  const { transaction } = await prepareSolanaBurn({ connection, ...params });
  const [estimatedFee, nativeBalance] = await Promise.all([
    transaction.getEstimatedFee(connection),
    connection.getBalance(params.owner, 'confirmed'),
  ]);
  if (estimatedFee === null) throw new Error('Solana could not estimate the burn fee.');
  return { burnCost: BigInt(estimatedFee), nativeBalance: BigInt(nativeBalance) };
};

export const sendSolanaBurn = async ({
  provider,
  config,
  source,
  ownerAddress,
  amount,
  recipient,
  maxFee,
  finalityThreshold,
}: {
  provider: SolanaWalletProvider;
  config: CctpConfig;
  source: SolanaCctpSource;
  ownerAddress: string;
  amount: bigint;
  recipient: string;
  maxFee: bigint;
  finalityThreshold: number;
}): Promise<string> => {
  const owner = new PublicKey(ownerAddress);
  if (provider.publicKey && !provider.publicKey.equals(owner)) {
    throw new Error('The connected Solana wallet account changed. Review the bridge again.');
  }
  const connection = createSolanaConnection(source);
  const { transaction } = await prepareSolanaBurn({
    connection,
    config,
    source,
    owner,
    amount,
    recipient,
    maxFee,
    finalityThreshold,
  });
  const sendOptions: SendOptions = { preflightCommitment: 'confirmed' };
  const isPhantomConnector = provider.name?.toLowerCase().includes('phantom') === true;
  const injectedPhantom = isPhantomConnector ? getInjectedPhantomProvider() : undefined;
  if (isPhantomConnector && !injectedPhantom) {
    throw new Error(
      'Phantom’s Solana provider is unavailable. Open this app over HTTPS, localhost, or 127.0.0.1 and reconnect Phantom.',
    );
  }
  const sendWithInjectedPhantom = async (
    phantom: PhantomInjectedProvider,
  ): Promise<string> => {
    // Reown 1.8.x's wallet-standard Phantom wrapper resolves the chain from
    // AppKit state and can throw "Invalid chain id" before Phantom is invoked.
    // Phantom's official injected API does not require that CAIP chain field.
    const { publicKey } = await phantom.connect();
    if (!publicKey.equals(owner)) {
      throw new Error('The connected Phantom account changed. Review the bridge again.');
    }
    const signedTransaction = await phantom.signTransaction(transaction);
    return connection.sendRawTransaction(signedTransaction.serialize(), sendOptions);
  };
  let signature: string;
  if (injectedPhantom) {
    signature = await sendWithInjectedPhantom(injectedPhantom);
  } else {
    try {
      signature = await provider.sendTransaction(transaction, connection, sendOptions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes('invalid chain id')) throw error;
      const fallbackPhantom = getInjectedPhantomProvider();
      if (!fallbackPhantom) {
        throw new Error(
          'Phantom’s Solana provider is unavailable. Open this app over HTTPS, localhost, or 127.0.0.1 and reconnect Phantom.',
          { cause: error },
        );
      }
      signature = await sendWithInjectedPhantom(fallbackPhantom);
    }
  }
  const confirmation = await connection.confirmTransaction({
    signature,
    blockhash: transaction.recentBlockhash!,
    lastValidBlockHeight: transaction.lastValidBlockHeight!,
  }, 'confirmed');
  if (confirmation.value.err) {
    throw new Error(`Solana CCTP burn failed: ${JSON.stringify(confirmation.value.err)}`);
  }
  return signature;
};
