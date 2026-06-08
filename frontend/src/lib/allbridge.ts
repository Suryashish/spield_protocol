import { AllbridgeCoreSdk, nodeRpcUrlsDefault } from '@allbridge/bridge-core-sdk';

export const sdk = new AllbridgeCoreSdk(nodeRpcUrlsDefault);

/**
 * Allbridge Core SDK instance.
 * We can use this to fetch chains, tokens, and perform bridge transactions.
 */
export const getAllbridgeChains = async () => {
  return await sdk.chainDetailsMap();
};
