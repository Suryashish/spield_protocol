import { Buffer } from 'buffer';

// Solana's browser SDK and some wallet adapters still expect Node's Buffer global.
globalThis.Buffer ??= Buffer;
