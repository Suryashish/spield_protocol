# Lumen Bridge

A browser-only CCTP V2 bridge that routes native USDC from selected EVM mainnets to native Stellar USDC.

## What it does

1. Connects an injected EVM wallet (MetaMask, Rabby, and compatible wallets).
2. Connects a Stellar wallet through Freighter.
3. Approves USDC and calls `depositForBurnWithHook` on Circle's `TokenMessengerV2`.
4. Uses the Stellar `CctpForwarder` as both `mintRecipient` and `destinationCaller`; the connected Stellar address is encoded in CCTP hook data.
5. Polls Circle Iris for the attestation and asks Freighter to sign `mint_and_forward` on Stellar.

Before any CCTP burn, the app re-reads the connected Freighter address, verifies its Stellar network and `strkey` checksum, and requires the user to confirm the exact recipient shown in the modal. It verifies the same address again after approval and before the irreversible burn.

The implementation follows Circle's Stellar CCTP requirements: never use a user Stellar account directly for `mintRecipient`. Doing so can permanently strand the transfer.

## Environments

The top-right switch changes the complete CCTP route—not just the UI label:

- **Mainnet:** selected EVM mainnets → Stellar Mainnet, production Iris, production Stellar Forwarder.
- **Testnet:** supported CCTP EVM testnets → Stellar Testnet, Circle Iris Sandbox, testnet Stellar Forwarder, and Testnet passphrase.

When Testnet is selected, the bridge lets you choose Ethereum Sepolia, Avalanche Fuji, OP Sepolia, Arbitrum Sepolia, Base Sepolia, Polygon Amoy, Unichain Sepolia, Linea Sepolia, or Arc Testnet. It will offer to add any of these networks to an EVM wallet if missing. Fund the selected EVM wallet with its native test gas and test USDC, fund the Stellar test wallet with XLM using [Friendbot](https://lab.stellar.org/), and establish a testnet USDC trustline before you receive funds.

## Supported mainnet source networks

Ethereum, Base, Arbitrum, OP Mainnet, Polygon PoS, and Avalanche C-Chain. The source-network metadata is deliberately local and explicit so new CCTP EVM networks can be added only after their official Circle USDC address, chain ID, and CCTP domain are verified.

## Development

```bash
pnpm install
pnpm dev
```

```bash
pnpm build
pnpm lint
```

The connected Stellar wallet must match the selected environment (`PUBLIC` for mainnet or `TESTNET` for testnet). Users need gas funds on both source and destination networks.

## References

- [Circle: Transfer USDC to and from Stellar](https://developers.circle.com/cctp/quickstarts/transfer-usdc-stellar-arc)
- [Circle: CCTP on Stellar](https://developers.circle.com/cctp/references/stellar)
- [Circle: CCTP contract addresses](https://developers.circle.com/cctp/references/contract-addresses)
