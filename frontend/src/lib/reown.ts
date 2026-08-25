import { createAppKit } from '@reown/appkit/react';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import {
  arbitrum,
  arbitrumSepolia,
  avalanche,
  base,
  baseSepolia,
  lineaSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  sepolia,
  unichainSepolia,
} from '@reown/appkit/networks';

import { NETWORK_KEY, REOWN_PROJECT_ID } from './config';

/**
 * Reown AppKit — the EVM wallet connector used only for the CCTP bridge. The app's
 * own Stellar wallets (Freighter et al.) are untouched and remain the primary login.
 *
 * AppKit must be created exactly once, before any of its hooks run, so this module
 * is imported for its side effect from `ReownContext`. The EVM networks here match
 * `isReownConfigured` lets the UI degrade gracefully when no project id is set:
 * the bridge can still fall back to an injected EIP-1193 wallet.
 */
export const isReownConfigured = REOWN_PROJECT_ID.length > 0;

if (isReownConfigured) {
  createAppKit({
    adapters: [new EthersAdapter()],
    // Never expose chains from the opposite environment in the wallet modal.
    // Testnet contains only Fast-capable routes because Standard is disabled there.
    networks: NETWORK_KEY === 'mainnet'
      ? [mainnet, base, arbitrum, optimism, polygon, avalanche]
      : [sepolia, optimismSepolia, arbitrumSepolia, baseSepolia, unichainSepolia, lineaSepolia],
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
