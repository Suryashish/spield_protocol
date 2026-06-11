// Browser polyfills for Node globals that bundled SDKs assume exist.
//
// The Allbridge Core SDK pulls in @solana/web3.js, Tron and other libraries that
// reference a global `Buffer` during initialization and when decoding chain data.
// Vite does NOT provide one in the browser, so without this the very first SDK
// call (`chainDetailsMap`) throws `Buffer is not defined` — which surfaced as the
// bridge panel's "Could not load bridge networks" error.
//
// `global`/`process` are already shimmed in index.html for @stellar/stellar-sdk;
// this adds the missing `Buffer`. Imported FIRST in main.tsx so it runs before any
// SDK module initializes.
import { Buffer } from 'buffer';

const g = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (!g.Buffer) {
  g.Buffer = Buffer;
}
