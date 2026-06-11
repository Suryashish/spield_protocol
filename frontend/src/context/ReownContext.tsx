import type { ReactNode } from 'react';
import {
  useAppKit,
  useAppKitAccount,
  useAppKitProvider,
  useDisconnect,
  type Provider as EvmProvider,
} from '@reown/appkit/react';
import type { Provider as SolanaProvider } from '@reown/appkit-adapter-solana/react';
import type { Eip1193Provider } from 'ethers';

// Importing the config module for its side effect: it calls `createAppKit` once,
// which must happen before any AppKit hook below runs.
import { isReownConfigured } from '@/lib/reown';
import type { SolanaSigner } from '@/lib/allbridge';

/**
 * Thin wrapper exposing the Reown (EVM + Solana) wallet connection to the bridge UI.
 *
 * AppKit registers its own global state when `createAppKit` runs (in `lib/reown`),
 * so no React Context value is needed — this provider only renders children. The
 * `useBridgeWallets` hook is what the bridge panel consumes.
 */
export const ReownProvider = ({ children }: { children: ReactNode }) => <>{children}</>;

export type BridgeWallets = {
  /** Whether a Reown project id is configured (else EVM/Solana sources are disabled). */
  configured: boolean;
  /** Connected EVM address (eip155 namespace), or null. */
  evmAddress: string | null;
  /** Connected Solana address, or null. */
  solanaAddress: string | null;
  /** Open the wallet modal focused on the EVM namespace. */
  connectEvm: () => void;
  /** Open the wallet modal focused on the Solana namespace. */
  connectSolana: () => void;
  /** Disconnect the EVM namespace wallet. */
  disconnectEvm: () => Promise<void>;
  /** Disconnect the Solana namespace wallet. */
  disconnectSolana: () => Promise<void>;
  /** The raw EIP-1193 provider for the connected EVM wallet, or undefined. */
  evmProvider: Eip1193Provider | undefined;
  /** The connected Solana wallet signer, or undefined. */
  solanaSigner: SolanaSigner | undefined;
};

/**
 * Inert wallet state used when no Reown project id is configured.
 *
 * AppKit's hooks (`useAppKit` et al.) THROW if `createAppKit` was never called —
 * and `createAppKit` only runs when a project id is set (see `lib/reown`). So when
 * unconfigured we must NOT call those hooks at all, or the whole bridge panel
 * crashes with "Please call createAppKit before using useAppKit hook". This stub
 * lets the UI render in its degraded (EVM/Solana-disabled) state instead.
 */
const DISCONNECTED: BridgeWallets = {
  configured: false,
  evmAddress: null,
  solanaAddress: null,
  connectEvm: () => {},
  connectSolana: () => {},
  disconnectEvm: async () => {},
  disconnectSolana: async () => {},
  evmProvider: undefined,
  solanaSigner: undefined,
};

/** The real implementation — only safe to mount when AppKit has been created. */
const useConfiguredBridgeWallets = (): BridgeWallets => {
  const { open } = useAppKit();
  const { disconnect } = useDisconnect();
  const evm = useAppKitAccount({ namespace: 'eip155' });
  const sol = useAppKitAccount({ namespace: 'solana' });
  const { walletProvider: evmProvider } = useAppKitProvider<EvmProvider>('eip155');
  const { walletProvider: solanaProvider } = useAppKitProvider<SolanaProvider>('solana');

  return {
    configured: true,
    evmAddress: evm.isConnected ? evm.address ?? null : null,
    solanaAddress: sol.isConnected ? sol.address ?? null : null,
    connectEvm: () => open({ view: 'Connect', namespace: 'eip155' }),
    connectSolana: () => open({ view: 'Connect', namespace: 'solana' }),
    disconnectEvm: () => disconnect({ namespace: 'eip155' }),
    disconnectSolana: () => disconnect({ namespace: 'solana' }),
    evmProvider: evmProvider as Eip1193Provider | undefined,
    solanaSigner: solanaProvider as unknown as SolanaSigner | undefined,
  };
};

/**
 * Access the EVM + Solana bridge wallets (Reown AppKit).
 *
 * `isReownConfigured` is a module-level constant fixed at load time, so branching
 * on it here never changes between renders — the Rules of Hooks are satisfied even
 * though only ONE of the two paths ever calls AppKit's hooks. When unconfigured we
 * return an inert stub so the bridge UI degrades gracefully instead of crashing.
 */
export const useBridgeWallets: () => BridgeWallets = isReownConfigured
  ? useConfiguredBridgeWallets
  : () => DISCONNECTED;
