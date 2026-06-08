import { createAppKit } from '@reown/appkit/react';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { SolanaAdapter } from '@reown/appkit-adapter-solana/react';
import { mainnet, bsc, polygon, arbitrum, solana } from '@reown/appkit/networks';

import { REOWN_PROJECT_ID } from './config';

/**
 * Reown AppKit — the multi-chain (EVM + Solana) wallet connector used ONLY for the
 * cross-chain bridge, to sign transfers FROM non-Stellar source chains. The app's
 * own Stellar wallets (Freighter et al.) are untouched and remain the primary login.
 *
 * AppKit must be created exactly once, before any of its hooks run, so this module
 * is imported for its side effect from `ReownContext`. The EVM networks here match
 * the chains Allbridge Core supports that we sign for (see `sourceFamily`); add more
 * `@reown/appkit/networks` entries to widen coverage.
 *
 * `isReownConfigured` lets the UI degrade gracefully when no project id is set:
 * EVM/Solana sources are disabled with a hint, while Stellar-source bridging works.
 */
export const isReownConfigured = REOWN_PROJECT_ID.length > 0;

if (isReownConfigured) {
  createAppKit({
    adapters: [new EthersAdapter(), new SolanaAdapter()],
    networks: [mainnet, bsc, polygon, arbitrum, solana],
    projectId: REOWN_PROJECT_ID,
    metadata: {
      name: 'Spield',
      description: 'Spield cross-chain bridge',
      url: typeof window !== 'undefined' ? window.location.origin : 'https://spield.io',
      icons: ['https://spield.io/favicon.ico'],
    },
    features: {
      analytics: false,
      email: false,
      socials: false,
    },
  });
}
