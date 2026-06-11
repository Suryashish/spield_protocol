import { Callout } from 'fumadocs-ui/components/callout';

/**
 * Canonical, single-source-of-truth addresses surfaced in the docs.
 * (Only the public USDC asset addresses + Spield's deployed contract set —
 * see `components/contract-tables.tsx` for the full per-network contract list.)
 */
export const USDC_ADDRESSES = {
  mainnet: {
    sac: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
    classic: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
  testnet: {
    sac: 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU',
  },
} as const;

/**
 * A short, reusable "where the protocol is" notice. Drop `<DevPhaseNote />`
 * into any page that talks about networks so the dev-phase / testnet-first
 * message stays consistent everywhere.
 */
export function DevPhaseNote() {
  return (
    <Callout type="info" title="Development phase — live on testnet">
      Spield is in active development and currently <strong>live on Stellar testnet</strong>,
      where you can try every feature with test funds. The <strong>mainnet</strong> launch is
      coming soon. Where these docs mention USDC addresses, both the mainnet asset and the
      testnet asset are listed so you can experiment today.
    </Callout>
  );
}
