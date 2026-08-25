import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRightLeft,
  CheckCircle2,
  CircleGauge,
  ExternalLink,
  History,
  Loader2,
  ShieldCheck,
  Wallet,
  X,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useBridgeWallets } from '@/context/ReownContext';
import { useToast } from '@/context/ToastContext';
import { useWallet } from '@/context/WalletContext';
import { useBridgeHistory, type BridgeTransfer } from '@/lib/bridgeHistory';
import {
  FAST_FINALITY_THRESHOLD,
  MAX_BURN_UNITS,
  STANDARD_FINALITY_THRESHOLD,
  addFeeBuffer,
  buildApprovalCalldata,
  buildBurnCalldata,
  calculateProtocolFee,
  estimateSourceGas,
  fetchCircleFeeRate,
  formatTokenUnits,
  getActiveChainId,
  getAllowance,
  getAttestation,
  getCctpConfig,
  getStellarInclusionFee,
  getUsdcBalance,
  isValidStellarRecipient,
  mintAndForward,
  parseUsdcUnits,
  sendEvmTransaction,
  switchEvmNetwork,
  type CctpStep,
  type Eip1193Provider,
  type QuoteStatus,
  type SourceGasQuote,
  type TransferMode,
} from '@/lib/cctp';
import { NETWORK_KEY } from '@/lib/config';
import { activeWallet, shortenAddress, signWithWallet } from '@/lib/stellar';
import AmountField from './AmountField';
import { NetworkIcon } from './networkIcons';

const EMPTY_GAS_QUOTE: SourceGasQuote = {
  status: 'idle',
  approvalRequired: true,
  approvalCost: null,
  burnCost: null,
  nativeBalance: null,
};

const formatXlmStroops = (stroops: bigint | string): string =>
  formatTokenUnits(BigInt(stroops), 7, 7);

const stepLabel = (step: CctpStep): string => {
  switch (step) {
    case 'approving': return 'Approving USDC…';
    case 'burning': return 'Burning on source…';
    case 'attesting': return 'Waiting for Circle attestation…';
    case 'forwarding': return 'Minting on Stellar…';
    case 'complete': return 'Transfer complete';
    case 'error': return 'Verify details & try again';
    default: return 'Bridge USDC';
  }
};

type BridgeHistoryApi = ReturnType<typeof useBridgeHistory>;

const BridgePanel = ({
  onTracked,
  onTransferUpdate,
}: {
  onTracked: BridgeHistoryApi['track'];
  onTransferUpdate: BridgeHistoryApi['update'];
}) => {
  const stellarWallet = useWallet();
  const reown = useBridgeWallets();
  const toast = useToast();

  const [injectedAddress, setInjectedAddress] = useState<string | null>(null);
  const [sourceChainId, setSourceChainId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [balance, setBalance] = useState<bigint | null>(null);
  const [balanceStatus, setBalanceStatus] = useState<QuoteStatus>('idle');
  const [balanceRefresh, setBalanceRefresh] = useState(0);
  const [mode, setMode] = useState<TransferMode>('standard');
  const [step, setStep] = useState<CctpStep>('idle');
  const [notice, setNotice] = useState('');
  const [burnHash, setBurnHash] = useState('');
  const [feeStatus, setFeeStatus] = useState<QuoteStatus>('idle');
  const [feeRateBps, setFeeRateBps] = useState<string | null>(null);
  const [feeFetchedAt, setFeeFetchedAt] = useState<number | null>(null);
  const [feeError, setFeeError] = useState('');
  const [confirmedRecipient, setConfirmedRecipient] = useState('');
  const [confirmedMaxFee, setConfirmedMaxFee] = useState<bigint | null>(null);
  const [sourceGas, setSourceGas] = useState<SourceGasQuote>(EMPTY_GAS_QUOTE);
  const [stellarInclusionFee, setStellarInclusionFee] = useState<string | null>(null);
  const [stellarPreparedFee, setStellarPreparedFee] = useState<string | null>(null);

  const injectedProvider = (
    typeof window !== 'undefined' ? window.ethereum : undefined
  ) as Eip1193Provider | undefined;
  const provider = reown.evmProvider ?? (!reown.configured ? injectedProvider : undefined);
  const sourceAddress = reown.evmAddress ?? injectedAddress;
  const recipient = stellarWallet.address?.trim() ?? '';
  const bridgeEnvironment = NETWORK_KEY;
  const config = getCctpConfig(bridgeEnvironment);
  const availableSources = useMemo(
    () => bridgeEnvironment === 'testnet'
      ? config.sources.filter((item) => item.fast)
      : config.sources,
    [bridgeEnvironment, config.sources],
  );
  const source = useMemo(
    () => availableSources.find((item) => item.chainId === sourceChainId) ??
      availableSources[bridgeEnvironment === 'mainnet' ? 1 : 0],
    [availableSources, bridgeEnvironment, sourceChainId],
  );

  const amountUnits = useMemo(() => parseUsdcUnits(amount), [amount]);
  const protocolFeeUnits = useMemo(
    () => feeRateBps === null ? 0n : calculateProtocolFee(amountUnits, feeRateBps),
    [amountUnits, feeRateBps],
  );
  const maxProtocolFeeUnits = useMemo(() => addFeeBuffer(protocolFeeUnits), [protocolFeeUnits]);
  const estimatedReceiveUnits = amountUnits > protocolFeeUnits ? amountUnits - protocolFeeUnits : 0n;
  const minimumReceiveUnits = amountUnits > maxProtocolFeeUnits
    ? amountUnits - maxProtocolFeeUnits
    : 0n;
  const standardDisabled = bridgeEnvironment === 'testnet';
  const activeMode: TransferMode = standardDisabled
    ? 'fast'
    : source.fast
      ? mode
      : 'standard';
  const finalityThreshold = activeMode === 'fast'
    ? FAST_FINALITY_THRESHOLD
    : STANDARD_FINALITY_THRESHOLD;
  const validRecipient = isValidStellarRecipient(recipient);
  const stellarNetworkMatches = !stellarWallet.network ||
    stellarWallet.network === config.stellarNetwork;
  const validAmount = amountUnits > 0n && amountUnits <= MAX_BURN_UNITS;
  const overBalance = balance !== null && amountUnits > balance;
  const exactKnownGasCost = (sourceGas.approvalCost ?? 0n) + (sourceGas.burnCost ?? 0n);
  const sourceGasInsufficient = sourceGas.status === 'ready' &&
    sourceGas.burnCost !== null &&
    sourceGas.nativeBalance !== null &&
    sourceGas.nativeBalance < exactKnownGasCost;
  const busy = ['approving', 'burning', 'attesting', 'forwarding'].includes(step);

  const verifyConnectedRecipient = useCallback(async (expected?: string): Promise<string> => {
    const wallet = activeWallet();
    if (!wallet) throw new Error('Connect a Stellar wallet before bridging.');
    // Extension wallets that support silent reads are re-queried before every
    // irreversible step. Stateless/popup wallets (Albedo, Rabet) cannot restore
    // without prompting, so their already-connected context address is locked and
    // then supplied explicitly to the signing request.
    const restoredAddress = await wallet.restore();
    const currentAddress = (restoredAddress ?? recipient).trim();
    if (!isValidStellarRecipient(currentAddress)) {
      throw new Error('The connected Stellar wallet returned an invalid recipient.');
    }
    const currentNetwork = await wallet.getNetwork();
    if (currentNetwork && currentNetwork !== config.stellarNetwork) {
      throw new Error('The Stellar wallet network changed. Review the refreshed bridge route.');
    }
    if (expected && currentAddress !== expected) {
      throw new Error('The Stellar account changed. Review the new recipient before burning.');
    }
    if (recipient && currentAddress !== recipient) {
      throw new Error('The connected Stellar account changed. Reconnect it before bridging.');
    }
    return currentAddress;
  }, [config.stellarNetwork, recipient]);

  // Restore an injected EVM session when Reown is intentionally not configured.
  useEffect(() => {
    if (reown.configured || !injectedProvider) return;
    let active = true;
    void injectedProvider.request({ method: 'eth_accounts' }).then((accounts) => {
      if (active) setInjectedAddress((accounts as string[])[0] ?? null);
    }).catch(() => undefined);
    const onAccountsChanged = (...args: unknown[]) => {
      setInjectedAddress(((args[0] as string[] | undefined) ?? [])[0] ?? null);
      setBalanceRefresh((current) => current + 1);
    };
    const onChainChanged = () => setBalanceRefresh((current) => current + 1);
    injectedProvider.on?.('accountsChanged', onAccountsChanged);
    injectedProvider.on?.('chainChanged', onChainChanged);
    return () => {
      active = false;
      injectedProvider.removeListener?.('accountsChanged', onAccountsChanged);
      injectedProvider.removeListener?.('chainChanged', onChainChanged);
    };
  }, [injectedProvider, reown.configured]);

  useEffect(() => {
    if (!provider || !sourceAddress) {
      queueMicrotask(() => {
        setBalance(null);
        setBalanceStatus('idle');
      });
      return;
    }
    let active = true;
    queueMicrotask(() => { if (active) setBalanceStatus('loading'); });
    void (async () => {
      try {
        if (await getActiveChainId(provider) !== source.chainId) {
          throw new Error(`Switch to ${source.name} to view its USDC balance.`);
        }
        const nextBalance = await getUsdcBalance(provider, sourceAddress, source);
        if (active) {
          setBalance(nextBalance);
          setBalanceStatus('ready');
        }
      } catch {
        if (active) {
          setBalance(null);
          setBalanceStatus('error');
        }
      }
    })();
    return () => { active = false; };
  }, [provider, sourceAddress, source, balanceRefresh]);

  useEffect(() => {
    let active = true;
    let controller = new AbortController();
    const loadFee = async () => {
      controller.abort();
      controller = new AbortController();
      setFeeStatus('loading');
      setFeeError('');
      try {
        const bps = await fetchCircleFeeRate(
          config,
          source.domain,
          finalityThreshold,
          controller.signal,
        );
        if (active) {
          setFeeRateBps(bps);
          setFeeFetchedAt(Date.now());
          setFeeStatus('ready');
        }
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === 'AbortError')) return;
        setFeeRateBps(null);
        setFeeStatus('error');
        setFeeError(error instanceof Error ? error.message : 'Circle fee quote is unavailable.');
      }
    };
    void loadFee();
    const refresh = window.setInterval(() => void loadFee(), 60_000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(refresh);
    };
  }, [config, source.domain, finalityThreshold]);

  useEffect(() => {
    let active = true;
    void getStellarInclusionFee(config)
      .then((fee) => { if (active) setStellarInclusionFee(fee); })
      .catch(() => { if (active) setStellarInclusionFee(null); });
    return () => { active = false; };
  }, [config]);

  useEffect(() => {
    if (
      !provider || !sourceAddress || !validAmount || overBalance ||
      !validRecipient || feeStatus !== 'ready'
    ) {
      queueMicrotask(() => setSourceGas(EMPTY_GAS_QUOTE));
      return;
    }
    let active = true;
    queueMicrotask(() => {
      if (active) setSourceGas({ ...EMPTY_GAS_QUOTE, status: 'loading' });
    });
    void estimateSourceGas({
      provider,
      address: sourceAddress,
      config,
      source,
      amount: amountUnits,
      recipient,
      maxFee: maxProtocolFeeUnits,
      finalityThreshold,
    }).then((quote) => {
      if (active) setSourceGas(quote);
    }).catch((error) => {
      if (active) {
        setSourceGas({
          ...EMPTY_GAS_QUOTE,
          status: 'error',
          error: error instanceof Error ? error.message : 'Source gas estimate unavailable.',
        });
      }
    });
    return () => { active = false; };
  }, [
    provider,
    sourceAddress,
    source,
    amountUnits,
    validAmount,
    overBalance,
    validRecipient,
    recipient,
    feeStatus,
    maxProtocolFeeUnits,
    finalityThreshold,
    config,
  ]);

  const connectSource = useCallback(async () => {
    if (reown.configured) {
      reown.connectEvm();
      return;
    }
    if (!injectedProvider) {
      setNotice('No EVM wallet was detected. Install or unlock MetaMask, Rabby, or Coinbase Wallet.');
      return;
    }
    try {
      const accounts = await injectedProvider.request({ method: 'eth_requestAccounts' }) as string[];
      await switchEvmNetwork(injectedProvider, source);
      setInjectedAddress(accounts[0] ?? null);
      setBalanceRefresh((current) => current + 1);
      setNotice('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'EVM wallet connection was cancelled.');
    }
  }, [injectedProvider, reown, source]);

  const disconnectSource = useCallback(() => {
    if (reown.configured) void reown.disconnectEvm();
    else setInjectedAddress(null);
  }, [reown]);

  const selectSource = useCallback(async (chainId: string) => {
    const next = config.sources.find((item) => String(item.chainId) === chainId);
    if (!next || (bridgeEnvironment === 'testnet' && !next.fast)) return;
    setSourceChainId(next.chainId);
    setBalance(null);
    setBalanceStatus('idle');
    setSourceGas(EMPTY_GAS_QUOTE);
    setNotice('');
    if (!next.fast) setMode('standard');
    if (!provider || !sourceAddress) return;
    try {
      await switchEvmNetwork(provider, next);
      setBalanceRefresh((current) => current + 1);
    } catch {
      setNotice(`The automatic network change to ${next.name} was cancelled.`);
    }
  }, [bridgeEnvironment, config.sources, provider, sourceAddress]);

  const prepareBridge = async () => {
    try {
      if (!sourceAddress) {
        await connectSource();
        return;
      }
      if (!stellarWallet.address) {
        stellarWallet.openWalletPicker();
        return;
      }
      if (!provider) throw new Error('The connected EVM wallet provider is unavailable.');
      if (await getActiveChainId(provider) !== source.chainId) {
        await switchEvmNetwork(provider, source);
        setBalanceRefresh((current) => current + 1);
      }
      if (!validAmount || overBalance) throw new Error('Enter a valid USDC amount before continuing.');
      const liveBalance = await getUsdcBalance(provider, sourceAddress, source);
      setBalance(liveBalance);
      setBalanceStatus('ready');
      if (amountUnits > liveBalance) throw new Error('The amount exceeds your source-wallet USDC balance.');
      const liveBps = await fetchCircleFeeRate(config, source.domain, finalityThreshold);
      const liveFee = calculateProtocolFee(amountUnits, liveBps);
      setFeeRateBps(liveBps);
      setFeeFetchedAt(Date.now());
      setFeeStatus('ready');
      setConfirmedMaxFee(addFeeBuffer(liveFee));
      const currentRecipient = await verifyConnectedRecipient();
      setConfirmedRecipient(currentRecipient);
      setNotice('Review the exact Stellar recipient before creating the irreversible CCTP burn.');
      if (step === 'error' || step === 'complete') setStep('idle');
    } catch (error) {
      setStep('error');
      setNotice(error instanceof Error ? error.message : 'Could not verify the bridge details.');
    }
  };

  const executeBridge = async (lockedRecipient: string) => {
    let submittedBurnHash = '';
    const toastId = toast.push({
      kind: 'pending',
      title: 'Bridge USDC',
      message: 'Verify the approval and CCTP burn in your EVM wallet.',
    });
    try {
      if (!provider || !sourceAddress) throw new Error('Connect an EVM wallet first.');
      if (confirmedMaxFee === null) {
        throw new Error('The Circle fee quote expired. Review a fresh quote before bridging.');
      }
      if (await getActiveChainId(provider) !== source.chainId) {
        await switchEvmNetwork(provider, source);
      }
      await verifyConnectedRecipient(lockedRecipient);
      const burnCalldata = buildBurnCalldata({
        config,
        source,
        amount: amountUnits,
        recipient: lockedRecipient,
        maxFee: confirmedMaxFee,
        finalityThreshold,
      });
      const allowance = await getAllowance(
        provider,
        sourceAddress,
        source.usdc,
        config.messenger,
      );
      if (allowance < amountUnits) {
        setStep('approving');
        setNotice('Approve the exact USDC transfer amount in your EVM wallet.');
        await sendEvmTransaction(
          provider,
          sourceAddress,
          source.usdc,
          buildApprovalCalldata(config.messenger, amountUnits),
        );
      }

      const latestBps = await fetchCircleFeeRate(config, source.domain, finalityThreshold);
      const latestFee = calculateProtocolFee(amountUnits, latestBps);
      if (latestFee > confirmedMaxFee) {
        throw new Error(
          'Circle’s fee increased beyond the amount you reviewed. No USDC was burned; review the new quote.',
        );
      }
      setFeeRateBps(latestBps);
      setFeeFetchedAt(Date.now());
      setFeeStatus('ready');
      await verifyConnectedRecipient(lockedRecipient);

      try {
        const [gasPriceHex, burnGasHex, nativeBalanceHex] = await Promise.all([
          provider.request({ method: 'eth_gasPrice' }) as Promise<`0x${string}`>,
          provider.request({
            method: 'eth_estimateGas',
            params: [{ from: sourceAddress, to: config.messenger, data: burnCalldata }],
          }) as Promise<`0x${string}`>,
          provider.request({
            method: 'eth_getBalance',
            params: [sourceAddress, 'latest'],
          }) as Promise<`0x${string}`>,
        ]);
        const burnCost = BigInt(gasPriceHex) * BigInt(burnGasHex);
        const nativeBalance = BigInt(nativeBalanceHex);
        setSourceGas({
          status: 'ready',
          approvalRequired: false,
          approvalCost: null,
          burnCost,
          nativeBalance,
        });
        if (nativeBalance < burnCost) {
          throw new Error(
            `Your EVM wallet needs more ${source.nativeSymbol} for the CCTP burn gas.`,
          );
        }
        setNotice(
          `Recipient and fee verified. Estimated burn gas: ${formatTokenUnits(burnCost, source.nativeDecimals, 8)} ${source.nativeSymbol}.`,
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes('needs more')) throw error;
        setNotice('Recipient and fee verified. Review the wallet’s live gas quote before confirming the burn.');
      }

      setStep('burning');
      submittedBurnHash = await sendEvmTransaction(
        provider,
        sourceAddress,
        config.messenger,
        burnCalldata,
      );
      setBurnHash(submittedBurnHash);
      setStep('attesting');
      setNotice('Circle is producing the CCTP attestation. This can take a few minutes.');
      onTracked({
        hash: submittedBurnHash,
        sourceChainShort: source.short,
        sourceChainName: source.name,
        amount,
        recipient: lockedRecipient,
        environment: bridgeEnvironment,
        mode: activeMode,
        startedAt: Date.now(),
        status: 'attesting',
      });

      const attestation = await getAttestation(config, source, submittedBurnHash);
      setStep('forwarding');
      setNotice('Circle attested the burn. Sign the Stellar mint-and-forward transaction.');
      onTransferUpdate(submittedBurnHash, { status: 'forwarding' });
      await verifyConnectedRecipient(lockedRecipient);
      const stellarHash = await mintAndForward({
        config,
        message: attestation.message,
        attestation: attestation.attestation,
        recipient: lockedRecipient,
        signTransaction: signWithWallet,
        onPreparedFee: (fee) => {
          setStellarPreparedFee(fee);
          setNotice(
            `Review the Stellar mint transaction. Maximum network fee: ${formatXlmStroops(fee)} XLM.`,
          );
        },
      });
      setStep('complete');
      setNotice('Native USDC has been minted and forwarded to your Stellar wallet.');
      onTransferUpdate(submittedBurnHash, {
        status: 'complete',
        stellarHash,
        error: null,
      });
      toast.update(toastId, {
        kind: 'success',
        title: 'CCTP transfer complete',
        message: 'Native USDC was minted on Stellar.',
        hash: stellarHash,
      });
      setBalanceRefresh((current) => current + 1);
      setAmount('');
      setConfirmedMaxFee(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bridge could not be completed.';
      setStep('error');
      setNotice(message);
      if (submittedBurnHash) {
        onTransferUpdate(submittedBurnHash, { status: 'error', error: message });
      }
      toast.update(toastId, { kind: 'error', title: 'Bridge failed', message });
    }
  };

  const canSubmit = Boolean(
    sourceAddress &&
    provider &&
    validRecipient &&
    stellarNetworkMatches &&
    validAmount &&
    !overBalance &&
    feeStatus === 'ready' &&
    !sourceGasInsufficient &&
    !busy,
  );

  const ctaLabel = !sourceAddress
    ? 'Connect a source wallet to bridge'
    : !stellarWallet.address
      ? 'Connect a Stellar wallet to bridge'
      : !stellarNetworkMatches
        ? `Stellar wallet must use ${config.stellarNetwork}`
        : amountUnits > MAX_BURN_UNITS
          ? 'Maximum transfer is 10,000,000 USDC'
          : sourceGasInsufficient
            ? `Add ${source.nativeSymbol} for gas`
            : feeStatus === 'loading'
              ? 'Loading live Circle fee…'
              : feeStatus === 'error'
                ? 'Circle fee quote unavailable'
                : stepLabel(step);

  const sourceGasLabel = sourceGas.status === 'loading'
    ? 'Calculating…'
    : sourceGas.status === 'error'
      ? 'Unavailable'
      : sourceGas.status === 'ready' && sourceGas.approvalRequired
        ? `${formatTokenUnits(sourceGas.approvalCost ?? 0n, source.nativeDecimals, 8)} ${source.nativeSymbol} + burn gas`
        : sourceGas.status === 'ready'
          ? `${formatTokenUnits(exactKnownGasCost, source.nativeDecimals, 8)} ${source.nativeSymbol}`
          : '—';
  const stellarFeeLabel = stellarPreparedFee
    ? `${formatXlmStroops(stellarPreparedFee)} XLM max`
    : stellarInclusionFee
      ? `from ${formatXlmStroops(stellarInclusionFee)} XLM + resources`
      : 'Simulated before mint';

  return (
    <Card className="h-full rounded-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowRightLeft size={16} className="text-brand-text" />
          Bridge to Stellar
        </CardTitle>
        <CardDescription>
          Bring native USDC from supported EVM networks via Circle CCTP V2.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-brand/20 bg-brand/5 px-3 py-2 text-xs">
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="size-1.5 rounded-full bg-brand" />
            Circle CCTP V2 · {bridgeEnvironment === 'testnet' ? 'Testnet' : 'Mainnet'}
          </span>
          <span className="font-medium text-brand-text">EVM → Stellar</span>
        </div>

        <SourceWalletPanel
          chainName={source.name}
          address={sourceAddress}
          onConnect={() => void connectSource()}
          onDisconnect={disconnectSource}
        />

        <div className="space-y-3">
          <Label className="eyebrow">From</Label>
          <div className="flex gap-2">
            <Select value={String(source.chainId)} onValueChange={(value) => void selectSource(value)}>
              <SelectTrigger className="h-11 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <NetworkIcon chainSymbol={source.short} size={20} />
                  <span className="truncate text-sm font-medium">{source.name}</span>
                </span>
              </SelectTrigger>
              <SelectContent position="popper" sideOffset={4}>
                {config.sources.map((item) => {
                  const unavailableOnTestnet = bridgeEnvironment === 'testnet' && !item.fast;
                  return (
                  <SelectItem
                    key={item.chainId}
                    value={String(item.chainId)}
                    disabled={unavailableOnTestnet}
                    className="py-2"
                  >
                    <span className="flex items-center gap-2.5">
                      <NetworkIcon chainSymbol={item.short} size={22} />
                      <span className="flex flex-col leading-tight">
                        <span className="text-sm font-medium">{item.name}</span>
                        <span className="eyebrow">
                          {unavailableOnTestnet
                            ? 'Standard unavailable on Testnet'
                            : bridgeEnvironment === 'testnet'
                              ? 'Fast only'
                              : item.fast
                                ? 'Standard + Fast'
                                : 'Standard'} · Domain {item.domain}
                        </span>
                      </span>
                    </span>
                  </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Select value="USDC" disabled>
              <SelectTrigger className="h-11 w-[118px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent><SelectItem value="USDC">USDC</SelectItem></SelectContent>
            </Select>
          </div>
          <AmountField
            label="Amount to bridge"
            token="USDC"
            value={amount}
            onChange={setAmount}
            loading={balanceStatus === 'loading'}
            balance={balance !== null
              ? `${formatTokenUnits(balance, 6, 6)} USDC`
              : undefined}
            onMax={balance !== null ? () => setAmount(formatTokenUnits(balance, 6, 6).replaceAll(',', '')) : undefined}
            invalid={overBalance || amountUnits > MAX_BURN_UNITS}
            hint={overBalance
              ? 'Amount exceeds your source-wallet balance.'
              : amountUnits > MAX_BURN_UNITS
                ? 'Circle limits a single burn to 10,000,000 USDC.'
                : balanceStatus === 'error' && sourceAddress
                  ? `${source.name} balance will load after the wallet changes network.`
                  : undefined}
            hintTone={overBalance || amountUnits > MAX_BURN_UNITS ? 'ember' : 'muted'}
          />
        </div>

        <div className="flex items-center gap-3 py-0.5">
          <span className="rule-soft flex-1" aria-hidden="true" />
          <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-card text-subtle shadow-float-sm">
            <ArrowDown size={12} />
          </span>
          <span className="rule-soft flex-1" aria-hidden="true" />
        </div>

        <div className="space-y-3">
          <Label className="eyebrow">To</Label>
          <AmountField
            label="You receive"
            token={(
              <>
                <span className="relative inline-flex">
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-brand/10 text-[8px] font-bold text-brand-text">US</span>
                  <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-card">
                    <NetworkIcon chainSymbol="SRB" size={11} />
                  </span>
                </span>
                USDC
              </>
            )}
            value={feeStatus === 'ready' && amountUnits > 0n
              ? formatTokenUnits(estimatedReceiveUnits, 6, 6)
              : ''}
            loading={feeStatus === 'loading'}
            hint={`Destination is fixed to Stellar ${bridgeEnvironment === 'testnet' ? 'Testnet' : 'Mainnet'}`}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="eyebrow">Recipient (Stellar)</Label>
          <div className="flex items-center justify-between gap-2 well rounded-xl px-4 py-3">
            {recipient ? (
              <div className="min-w-0 leading-tight">
                <div className="truncate font-mono text-sm">{shortenAddress(recipient, 6, 6)}</div>
                <div className="text-[10px] text-muted-foreground">
                  Connected wallet · {stellarWallet.network ?? config.stellarNetwork}
                </div>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">No Stellar wallet connected</span>
            )}
            {!recipient && (
              <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-xs" onClick={stellarWallet.openWalletPicker}>
                <Wallet size={12} /> Connect
              </Button>
            )}
          </div>
        </div>

        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="eyebrow mb-2">Transfer speed</legend>
          <button
            type="button"
            disabled={standardDisabled}
            aria-pressed={activeMode === 'standard'}
            onClick={() => !standardDisabled && setMode('standard')}
            className={`rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${activeMode === 'standard' ? 'border-brand/50 bg-brand/10' : 'border-border bg-muted/30 hover:bg-muted'}`}
          >
            <span className="flex items-center gap-1.5 text-xs font-semibold"><CircleGauge size={13} /> Standard</span>
            <span className="mt-1 block text-[10px] text-muted-foreground">
              {standardDisabled ? 'Unavailable on Testnet' : 'Finalized confirmations'}
            </span>
          </button>
          <button
            type="button"
            disabled={!source.fast}
            aria-pressed={activeMode === 'fast'}
            onClick={() => source.fast && setMode('fast')}
            className={`rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${activeMode === 'fast' ? 'border-brand/50 bg-brand/10' : 'border-border bg-muted/30 hover:bg-muted'}`}
          >
            <span className="flex items-center gap-1.5 text-xs font-semibold"><Zap size={13} /> Fast</span>
            <span className="mt-1 block text-[10px] text-muted-foreground">
              {source.fast ? 'Faster attestation' : `Unavailable on ${source.name}`}
            </span>
          </button>
        </fieldset>

        <div className="space-y-2 well rounded-lg p-3">
          <div className="flex justify-between gap-4 text-[12.5px]">
            <span className="text-muted-foreground">Circle {activeMode} fee</span>
            <span className="text-right text-foreground">
              {feeStatus === 'ready' ? `${formatTokenUnits(protocolFeeUnits, 6, 6)} USDC` : '—'}
            </span>
          </div>
          <div className="flex justify-between gap-4 text-[12.5px]">
            <span className="text-muted-foreground">{source.name} gas</span>
            <span className="text-right text-foreground">{sourceGasLabel}</span>
          </div>
          <div className="flex justify-between gap-4 text-[12.5px]">
            <span className="text-muted-foreground">Stellar execution</span>
            <span className="text-right text-foreground">{stellarFeeLabel}</span>
          </div>
          {feeStatus === 'ready' && maxProtocolFeeUnits > protocolFeeUnits && amountUnits > 0n && (
            <div className="border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
              Fee-protected minimum: <span className="font-medium text-foreground">{formatTokenUnits(minimumReceiveUnits, 6, 6)} USDC</span>
            </div>
          )}
          {feeFetchedAt && feeStatus === 'ready' && (
            <div className="text-[10px] text-muted-foreground">
              Live Circle quote refreshed {new Date(feeFetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          )}
        </div>

        {sourceGasInsufficient && (
          <InlineNotice tone="error">Your EVM wallet does not have enough {source.nativeSymbol} for the complete gas estimate.</InlineNotice>
        )}
        {feeStatus === 'error' && (
          <InlineNotice tone="error">{feeError} Transfers pause until a verified quote is available.</InlineNotice>
        )}
        {sourceGas.status === 'error' && sourceGas.error && (
          <InlineNotice tone="muted">{sourceGas.error}</InlineNotice>
        )}
        {notice && (
          <InlineNotice tone={step === 'error' ? 'error' : step === 'complete' ? 'success' : 'muted'}>
            {notice}
            {burnHash && (
              <a href={`${source.explorer}${burnHash}`} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-1 font-medium underline underline-offset-2">
                View burn <ExternalLink size={10} />
              </a>
            )}
          </InlineNotice>
        )}

        <Button
          onClick={() => void prepareBridge()}
          disabled={(Boolean(sourceAddress) && !canSubmit) || busy}
          className="h-11 w-full text-[14px] font-medium"
        >
          {busy && <Loader2 size={15} className="mr-2 animate-spin" />}
          {ctaLabel}
        </Button>
      </CardContent>

      <RecipientConfirmation
        recipient={confirmedRecipient}
        estimatedReceive={estimatedReceiveUnits}
        currentFee={protocolFeeUnits}
        maximumFee={confirmedMaxFee ?? maxProtocolFeeUnits}
        onCancel={() => {
          setConfirmedRecipient('');
          setConfirmedMaxFee(null);
        }}
        onConfirm={() => {
          const locked = confirmedRecipient;
          setConfirmedRecipient('');
          void executeBridge(locked);
        }}
      />
    </Card>
  );
};

const InlineNotice = ({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'error' | 'success' | 'muted';
}) => (
  <div className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${
    tone === 'error'
      ? 'border-ember/20 bg-ember/5 text-ember-text'
      : tone === 'success'
        ? 'border-brand/25 bg-brand/10 text-brand-text'
        : 'border-border bg-muted/30 text-muted-foreground'
  }`}>
    {tone === 'error'
      ? <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      : tone === 'success'
        ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
        : <ShieldCheck size={14} className="mt-0.5 shrink-0" />}
    <span>{children}</span>
  </div>
);

const SourceWalletPanel = ({
  chainName,
  address,
  onConnect,
  onDisconnect,
}: {
  chainName: string;
  address: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}) => address ? (
  <div className="flex items-center justify-between gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2.5">
    <div className="flex min-w-0 items-center gap-2">
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-brand" />
      </span>
      <div className="min-w-0 leading-tight">
        <div className="truncate font-mono text-sm font-medium">{shortenAddress(address, 6, 6)}</div>
        <div className="text-[10px] text-muted-foreground">Connected · {chainName}</div>
      </div>
    </div>
    <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={onDisconnect}>
      Disconnect
    </Button>
  </div>
) : (
  <Button variant="outline" className="h-11 w-full gap-2 text-sm font-semibold" onClick={onConnect}>
    <Wallet size={16} /> Connect Source Wallet
  </Button>
);

const RecipientConfirmation = ({
  recipient,
  estimatedReceive,
  currentFee,
  maximumFee,
  onCancel,
  onConfirm,
}: {
  recipient: string;
  estimatedReceive: bigint;
  currentFee: bigint;
  maximumFee: bigint;
  onCancel: () => void;
  onConfirm: () => void;
}) => (
  <DialogPrimitive.Root open={Boolean(recipient)} onOpenChange={(open) => { if (!open) onCancel(); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content className="app-shell fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
        <div className="flex items-start justify-between gap-3">
          <div>
            <DialogPrimitive.Title className="text-base font-semibold">Confirm final recipient</DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1 text-xs leading-relaxed text-muted-foreground">
              This address is permanently encoded in the CCTP burn. Confirm it before USDC leaves the source chain.
            </DialogPrimitive.Description>
          </div>
          <DialogPrimitive.Close className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X size={16} /></DialogPrimitive.Close>
        </div>
        <div className="mt-4 well rounded-lg p-3">
          <Label className="eyebrow">Connected Stellar address</Label>
          <code className="mt-2 block break-all text-xs leading-relaxed">{recipient}</code>
        </div>
        <div className="mt-3 space-y-2 well rounded-lg p-3 text-xs">
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Estimated receive</span><b>{formatTokenUnits(estimatedReceive, 6, 6)} USDC</b></div>
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Current Circle fee</span><b>{formatTokenUnits(currentFee, 6, 6)} USDC</b></div>
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Buffered maximum fee</span><b>{formatTokenUnits(maximumFee, 6, 6)} USDC</b></div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button className="flex-1" onClick={onConfirm}>Confirm & bridge</Button>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
);

const fmtTime = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const TransferRow = ({ transfer }: { transfer: BridgeTransfer }) => {
  const transferConfig = getCctpConfig(transfer.environment);
  const source = transferConfig.sources.find((item) => item.short === transfer.sourceChainShort);
  return (
    <div className="flex items-start gap-3 well rounded-lg p-3">
      <div className="mt-0.5 shrink-0">
        {transfer.status === 'complete'
          ? <CheckCircle2 size={16} className="text-brand-text" />
          : transfer.status === 'error'
            ? <AlertTriangle size={16} className="text-ember-text" />
            : <Loader2 size={16} className="animate-spin text-brand-text" />}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <span className="tabular-nums">{Number(transfer.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
          <span>USDC</span><span className="text-muted-foreground">·</span>
          <span className="truncate text-muted-foreground">{transfer.sourceChainName} → Stellar</span>
        </div>
        <div className={`flex flex-wrap items-center gap-x-2 text-xs ${transfer.status === 'error' ? 'text-ember-text' : transfer.status === 'complete' ? 'text-brand-text' : 'text-muted-foreground'}`}>
          {transfer.status === 'complete'
            ? <span>Completed {fmtTime(transfer.updatedAt)}</span>
            : transfer.status === 'forwarding'
              ? <span>Circle attested · awaiting Stellar signature</span>
              : transfer.status === 'attesting'
                ? <span>Burn confirmed · Circle attesting</span>
                : <span>{transfer.error ?? 'Transfer needs attention'}</span>}
          <span className="capitalize">· {transfer.mode}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {source && (
          <a href={`${source.explorer}${transfer.hash}`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="View CCTP burn"><ExternalLink size={14} /></a>
        )}
        {transfer.stellarHash && (
          <a href={`${transfer.environment === 'testnet' ? 'https://stellar.expert/explorer/testnet/tx/' : 'https://stellar.expert/explorer/public/tx/'}${transfer.stellarHash}`} target="_blank" rel="noreferrer" className="text-brand-text hover:text-foreground" title="View Stellar transaction"><CheckCircle2 size={14} /></a>
        )}
      </div>
    </div>
  );
};

const TransferHistory = ({ transfers, onClear }: { transfers: BridgeTransfer[]; onClear: () => void }) => {
  if (transfers.length === 0) return null;
  return (
    <div className="panel rounded-xl p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-display text-[15px] font-medium tracking-[-0.015em]">
          <History size={17} className="text-brand-text" /> Recent transfers
        </h3>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={onClear}>Clear</Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">CCTP burns are tracked through Circle attestation and the Stellar mint.</p>
      <div className="mt-4 space-y-2">{transfers.map((transfer) => <TransferRow key={transfer.hash} transfer={transfer} />)}</div>
    </div>
  );
};

const BridgeSection = () => {
  const { transfers, track, update, clear } = useBridgeHistory();
  const activeTransfers = transfers.filter((transfer) => transfer.environment === NETWORK_KEY);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        <div className="lg:col-span-6"><BridgePanel onTracked={track} onTransferUpdate={update} /></div>
        <div className="space-y-6 lg:col-span-6">
          <div className="panel rounded-xl p-5">
            <h3 className="flex items-center gap-2 font-display text-[15px] font-medium tracking-[-0.015em]">
              <ShieldCheck size={17} className="text-brand-text" /> Powered by Circle CCTP V2
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Native USDC is burned on the source EVM chain, attested by Circle, and minted through the protected Stellar Forwarder.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2"><div className="size-1 rounded-full bg-primary" /> Native USDC end to end</li>
              <li className="flex items-center gap-2"><div className="size-1 rounded-full bg-primary" /> Standard and Fast transfer modes</li>
              <li className="flex items-center gap-2"><div className="size-1 rounded-full bg-primary" /> Live Circle fee protection</li>
              <li className="flex items-center gap-2"><div className="size-1 rounded-full bg-primary" /> Recipient verified before the irreversible burn</li>
            </ul>
            <a href="https://developers.circle.com/cctp/references/stellar" target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand-text hover:underline">
              Circle CCTP on Stellar <ExternalLink size={11} />
            </a>
          </div>
          <TransferHistory
            transfers={activeTransfers}
            onClear={() => clear(NETWORK_KEY)}
          />
        </div>
      </div>
    </div>
  );
};

export default BridgeSection;
