# Lumen Bridge

A browser-only CCTP V2 bridge that routes native USDC from selected EVM mainnets to native Stellar USDC.

## What it does

1. Connects an injected EVM wallet (MetaMask, Rabby, and compatible wallets).
2. Connects a Stellar wallet through Freighter.
3. Approves USDC and calls `depositForBurnWithHook` on Circle's `TokenMessengerV2`.
4. Uses the Stellar `CctpForwarder` as both `mintRecipient` and `destinationCaller`; the connected Stellar address is encoded in CCTP hook data.
5. Polls Circle Iris for the attestation and asks Freighter to sign `mint_and_forward` on Stellar.

The bridge keeps both CCTP transfer modes visible. **Standard transfer** uses finalized confirmations and currently has no Circle protocol fee on the configured routes. **Fast transfer** uses faster attestation and a route-specific fee; it is disabled only when Circle does not support Fast from the selected source. The receive quote is not hard-coded as 1:1: the app reads Circle's live fee for the selected mode, calculates the USDC deducted at destination, and uses a 20% `maxFee` safety buffer. The quote refreshes every minute and again before approval, and the burn is stopped if the fee rises beyond the amount the user confirmed.

Network fees are shown separately because they are not deducted from received USDC. The source wallet pays any required ERC-20 approval plus the CCTP burn in the source chain's native gas token. Freighter pays the Stellar `mint_and_forward` Soroban fee in XLM. The Stellar transaction now uses live inclusion-fee statistics and `simulateTransaction`/`assembleTransaction` to calculate its resource fee instead of bidding a hard-coded 1 XLM inclusion fee.

Before any CCTP burn, the app re-reads the connected Freighter address, verifies its Stellar network and `strkey` checksum, and requires the user to confirm the exact recipient shown in the modal. It verifies the same address again after approval and before the irreversible burn.

The implementation follows Circle's Stellar CCTP requirements: never use a user Stellar account directly for `mintRecipient`. Doing so can permanently strand the transfer.

## Environments

The top-right switch changes the complete CCTP route—not just the UI label:

- **Mainnet:** selected EVM mainnets → Stellar Mainnet, production Iris, production Stellar Forwarder.
- **Testnet:** supported CCTP EVM testnets → Stellar Testnet, Circle Iris Sandbox, testnet Stellar Forwarder, and Testnet passphrase.

When Testnet is selected, the bridge offers every configured CCTP test network. Standard remains available across the list; Fast can be selected on supported sources. The wallet can add a missing test network automatically. Fund the selected EVM wallet with its native test gas and test USDC, fund the Stellar test wallet with XLM using [Friendbot](https://lab.stellar.org/), and establish a testnet USDC trustline before you receive funds.

## Supported mainnet source networks

Ethereum, Base, Arbitrum, OP Mainnet, Polygon PoS, and Avalanche C-Chain. The source-network metadata is deliberately local and explicit so new CCTP EVM networks can be added only after their official Circle USDC address, chain ID, domain, and Fast support are verified.

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
