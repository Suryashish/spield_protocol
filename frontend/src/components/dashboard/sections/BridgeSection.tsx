import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import {
  ArrowRightLeft,
  Loader2,
  Wallet,
  AlertTriangle,
  ShieldCheck,
  ArrowDown,
  Pencil,
  X,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  History,
} from 'lucide-react';
import { AmountFormat, type ChainDetailsWithTokens } from '@allbridge/bridge-core-sdk';
import { StrKey } from '@stellar/stellar-sdk';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWallet } from '@/context/WalletContext';
import { useBridgeWallets } from '@/context/ReownContext';
import { useToast } from '@/context/ToastContext';
import { shortenAddress } from '@/lib/stellar';
import { NetworkIcon } from './networkIcons';
import { BRIDGE_ENABLED, NETWORK_KEY, explorerTx } from '@/lib/config';
import { useBridgeHistory, type BridgeTransfer } from '@/lib/bridgeHistory';
import {
  bridgeFromEvm,
  bridgeFromSolana,
  findStellarUsdc,
  getAmountToReceive,
  getAverageTransferTimeMs,
  getBridgeChains,
  getGasFee,
  getTokenBalance,
  isSupportedSource,
  sourceFamily,
  type BridgeToken,
  type SourceFamily,
} from '@/lib/allbridge';

/** Destination is always Stellar — recipients are classic G-accounts (ed25519). */
const isValidStellarAddress = (address: string): boolean =>
  StrKey.isValidEd25519PublicKey(address.trim());

/** Callback the panel invokes to start tracking a submitted transfer. */
type BridgeHistoryTracker = ReturnType<typeof useBridgeHistory>['track'];

/**
 * Human-friendly duration for an ESTIMATE in ms (e.g. "2 min", "45 sec",
 * "1 hr 10 min"). Used for the bridge's expected time of arrival.
 */
const fmtEstimate = (ms: number): string => {
  const totalSec = Math.max(1, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec} sec`;
  const mins = Math.round(totalSec / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const remMin = mins % 60;
  return remMin ? `${hrs} hr ${remMin} min` : `${hrs} hr`;
};

/** Small monogram disc for a token symbol (USDC, USDT, …). */
const TokenDisc = ({ symbol, size = 20 }: { symbol: string; size?: number }) => (
  <span
    aria-hidden
    className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary"
    style={{ width: size, height: size, fontSize: Math.max(8, size * 0.36) }}
  >
    {symbol.slice(0, 2)}
  </span>
);

const BridgePanel = ({ onTracked }: { onTracked: BridgeHistoryTracker }) => {
  const { address: stellarAddress } = useWallet();
  const reown = useBridgeWallets();
  const { push, update } = useToast();

  const [chains, setChains] = useState<ChainDetailsWithTokens[]>([]);
  const [loadingChains, setLoadingChains] = useState(true);
  const [chainsError, setChainsError] = useState<string | null>(null);

  // Source is any supported non-Stellar chain; destination is fixed to Stellar USDC.
  const [sourceChain, setSourceChain] = useState<string>('');
  const [sourceTokenAddr, setSourceTokenAddr] = useState<string>('');

  const [amount, setAmount] = useState('');

  // Recipient defaults to the connected Stellar wallet; the modal lets users
  // override it with any Stellar address. `recipientOverride` is null until edited.
  const [recipientOverride, setRecipientOverride] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const [quote, setQuote] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [fee, setFee] = useState<{ amount: string; symbol: string } | null>(null);

  const [balance, setBalance] = useState<string | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  const [busy, setBusy] = useState(false);

  // Bumped to re-trigger the chain fetch (e.g. when the user clicks "Try again").
  const [reloadKey, setReloadKey] = useState(0);

  // Reset to the loading state and re-run the fetch. `loadingChains` already starts
  // true for the first mount, so this is only needed for user-triggered retries.
  const retryLoadChains = useCallback(() => {
    setChainsError(null);
    setLoadingChains(true);
    setReloadKey((k) => k + 1);
  }, []);

  // Fetch chains on mount (mainnet liquidity — Allbridge has no testnet).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await getBridgeChains();
        if (!active) return;
        setChains(list);

        // Default source to the first SUPPORTED non-Stellar chain so the quote can
        // run immediately. (Stellar is the destination, never the source here.)
        const src = list.find(isSupportedSource);
        if (src) {
          setSourceChain(src.chainSymbol);
          const usdc = src.tokens.find((t) => t.symbol.toUpperCase() === 'USDC') ?? src.tokens[0];
          if (usdc) setSourceTokenAddr(usdc.tokenAddress);
        }
      } catch (err) {
        console.error('Failed to fetch Allbridge chains:', err);
        if (active) {
          const detail = err instanceof Error ? err.message : '';
          setChainsError(
            detail
              ? `Could not load bridge networks: ${detail}`
              : 'Could not load bridge networks. Check your connection and retry.',
          );
        }
      } finally {
        if (active) setLoadingChains(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  // Only chains we can sign a transfer FROM appear in the source picker.
  const sourceChains = useMemo(() => chains.filter(isSupportedSource), [chains]);

  const sourceChainData = useMemo(
    () => chains.find((c) => c.chainSymbol === sourceChain),
    [chains, sourceChain],
  );
  const sourceTokens = useMemo(() => sourceChainData?.tokens ?? [], [sourceChainData]);

  const selectedSourceToken = useMemo<BridgeToken | undefined>(
    () => sourceTokens.find((t) => t.tokenAddress === sourceTokenAddr) ?? sourceTokens[0],
    [sourceTokens, sourceTokenAddr],
  );

  // The fixed destination: Stellar USDC.
  const destToken = useMemo(() => findStellarUsdc(chains), [chains]);

  // Average time this route takes to settle — the same estimate Allbridge shows.
  // Synchronous (no network), depends only on the chosen token pair.
  const transferTimeMs = useMemo(
    () =>
      selectedSourceToken && destToken
        ? getAverageTransferTimeMs(selectedSourceToken, destToken)
        : null,
    [selectedSourceToken, destToken],
  );

  const srcFamily = sourceFamily(sourceChainData);

  // Which sender address the chosen source needs, if its wallet is connected.
  const sourceAddress =
    srcFamily === 'evm' ? reown.evmAddress : srcFamily === 'solana' ? reown.solanaAddress : null;

  // Effective recipient: an explicit override, else the connected Stellar wallet.
  const recipient = recipientOverride ?? stellarAddress ?? '';
  const recipientValid = isValidStellarAddress(recipient);
  const recipientIsWallet = recipientOverride === null && Boolean(stellarAddress);

  // Debounced quote (source token → Stellar USDC).
  useEffect(() => {
    let cancelled = false;
    const fetchQuote = async () => {
      if (
        !selectedSourceToken ||
        !destToken ||
        !amount ||
        Number.isNaN(Number(amount)) ||
        Number(amount) <= 0
      ) {
        setQuote(null);
        setFee(null);
        return;
      }
      setQuoting(true);
      try {
        const [received, gas] = await Promise.all([
          getAmountToReceive(amount, selectedSourceToken, destToken),
          getGasFee(selectedSourceToken, destToken),
        ]);
        if (cancelled) return;
        setQuote(received);
        setFee({
          amount: gas.native[AmountFormat.FLOAT],
          symbol: sourceChainData?.chainSymbol ?? '',
        });
      } catch (err) {
        console.error('Failed to fetch quote:', err);
        if (!cancelled) {
          setQuote(null);
          setFee(null);
        }
      } finally {
        if (!cancelled) setQuoting(false);
      }
    };
    const t = setTimeout(fetchQuote, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [amount, selectedSourceToken, destToken, sourceChainData]);

  // Fetch the source wallet's balance of the selected token whenever either changes.
  // All state updates run inside async callbacks (guarded by `cancelled`) so the
  // effect never sets state synchronously during render.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!sourceAddress || !selectedSourceToken) {
        setBalance(null);
        return;
      }
      setLoadingBalance(true);
      try {
        // For EVM, read through the connected wallet's provider (reliable); the SDK
        // ignores the provider for Solana and uses its configured RPC.
        const b = await getTokenBalance(sourceAddress, selectedSourceToken, reown.evmProvider);
        if (!cancelled) setBalance(b);
      } catch (err) {
        console.error('Failed to fetch balance:', err);
        if (!cancelled) setBalance(null);
      } finally {
        if (!cancelled) setLoadingBalance(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [sourceAddress, selectedSourceToken, reown.evmProvider]);

  const connectSource = useCallback(() => {
    if (srcFamily === 'evm') reown.connectEvm();
    else if (srcFamily === 'solana') reown.connectSolana();
  }, [srcFamily, reown]);

  const disconnectSource = useCallback(() => {
    if (srcFamily === 'evm') void reown.disconnectEvm();
    else if (srcFamily === 'solana') void reown.disconnectSolana();
  }, [srcFamily, reown]);

  const handleBridge = async () => {
    if (!BRIDGE_ENABLED || !selectedSourceToken || !destToken) return;
    if (!sourceAddress) {
      connectSource();
      return;
    }
    if (!amount || Number(amount) <= 0 || !recipientValid) return;

    const args = {
      amount,
      fromAddress: sourceAddress,
      toAddress: recipient.trim(),
      sourceToken: selectedSourceToken,
      destinationToken: destToken,
    };

    setBusy(true);
    const id = push({
      kind: 'pending',
      title: 'Bridge Assets',
      message: `Confirm in your ${srcFamily === 'evm' ? 'EVM' : 'Solana'} wallet…`,
    });
    try {
      let hash: string;
      if (srcFamily === 'evm') {
        if (!reown.evmProvider) throw new Error('EVM wallet provider unavailable.');
        ({ hash } = await bridgeFromEvm(args, reown.evmProvider));
      } else if (srcFamily === 'solana') {
        if (!reown.solanaSigner) throw new Error('Solana wallet unavailable.');
        ({ hash } = await bridgeFromSolana(args, reown.solanaSigner));
      } else {
        throw new Error('Unsupported source chain.');
      }
      const eta = transferTimeMs !== null ? ` Expected arrival ~${fmtEstimate(transferTimeMs)}.` : '';
      update(id, {
        kind: 'success',
        title: 'Bridge initiated',
        message: `Transfer submitted on ${sourceChainData?.name}. USDC will arrive on Stellar shortly.${eta}`,
        hash,
      });
      // Start tracking this transfer so its completion time shows up below. We
      // record what the user sees (chain, token, amount, recipient) plus the
      // source-chain symbol the status poller needs and the ETA for the wait.
      if (sourceChainData) {
        onTracked({
          hash,
          sourceChainSymbol: sourceChainData.chainSymbol,
          sourceChainName: sourceChainData.name,
          sourceSymbol: selectedSourceToken.symbol,
          amount,
          recipient: recipient.trim(),
          startedAt: Date.now(),
          etaMs: transferTimeMs,
        });
      }
      setAmount('');
    } catch (err) {
      update(id, {
        kind: 'error',
        title: 'Bridge failed',
        message: err instanceof Error ? err.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
    }
  };

  const reownBlocked = srcFamily !== 'unsupported' && !reown.configured;

  // The bridge can run only on mainnet, with a connected source wallet, a valid
  // amount within balance, and a valid Stellar recipient.
  const overBalance = Boolean(balance) && Number(amount) > Number(balance);
  const canSubmit =
    BRIDGE_ENABLED &&
    !reownBlocked &&
    !busy &&
    !quoting &&
    Boolean(sourceAddress) &&
    Boolean(amount) &&
    Number(amount) > 0 &&
    !overBalance &&
    recipientValid &&
    Boolean(selectedSourceToken) &&
    Boolean(destToken);

  const ctaLabel = !BRIDGE_ENABLED
    ? 'Bridging disabled on testnet'
    : !sourceAddress
      ? 'Connect a source wallet to bridge'
      : 'Bridge Assets';

  return (
    <Card className="h-full rounded-xl border-border bg-card shadow-sm">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <ArrowRightLeft size={16} className="text-primary" />
          Bridge to Stellar
        </CardTitle>
        <CardDescription className="text-xs">
          Bring USDC from any chain into Stellar via Allbridge Core.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {loadingChains ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="animate-spin text-muted-foreground" />
          </div>
        ) : chainsError ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
            <AlertTriangle size={20} className="text-amber-500" />
            <span className="px-2">{chainsError}</span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-2 text-xs font-semibold"
              onClick={retryLoadChains}
            >
              Try again
            </Button>
          </div>
        ) : (
          <>
            {/* Testnet banner — quotes are live, execution is mainnet-only. */}
            {!BRIDGE_ENABLED && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-xs text-muted-foreground">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                <span>
                  Allbridge Core has no testnet. You can connect a wallet and preview live prices here,
                  but bridging is disabled on <strong>{NETWORK_KEY}</strong>. It unlocks on the mainnet
                  build.
                </span>
              </div>
            )}

            {/* Full-width source-wallet connector — multi-chain (EVM + Solana via
                Reown). Scoped to the selected source chain's namespace. */}
            <SourceWalletPanel
              family={srcFamily}
              chainName={sourceChainData?.name}
              address={sourceAddress}
              disabled={reownBlocked}
              onConnect={connectSource}
              onDisconnect={disconnectSource}
            />

            {/* Source Selection */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase text-muted-foreground">From</Label>
                {sourceAddress && (
                  <span className="text-xs text-muted-foreground">
                    Balance:{' '}
                    {loadingBalance ? (
                      <Loader2 size={11} className="inline animate-spin" />
                    ) : (
                      <button
                        type="button"
                        className="font-medium text-foreground hover:text-primary"
                        onClick={() => balance && setAmount(balance)}
                        title="Use max"
                      >
                        {balance ? `${Number(balance).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${selectedSourceToken?.symbol ?? ''}` : '—'}
                      </button>
                    )}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Select
                  value={sourceChain}
                  onValueChange={(v) => {
                    setSourceChain(v);
                    setSourceTokenAddr(''); // fall back to the new chain's first token
                  }}
                >
                  <SelectTrigger className="h-11 w-[150px]">
                    {sourceChainData ? (
                      <span className="flex items-center gap-2">
                        <NetworkIcon chainSymbol={sourceChainData.chainSymbol} size={20} />
                        <span className="truncate text-sm font-medium">{sourceChainData.name}</span>
                      </span>
                    ) : (
                      <SelectValue placeholder="Chain" />
                    )}
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={4}>
                    {sourceChains.map((c) => (
                      <SelectItem key={c.chainSymbol} value={c.chainSymbol} className="py-2">
                        <span className="flex items-center gap-2.5">
                          <NetworkIcon chainSymbol={c.chainSymbol} size={22} />
                          <span className="flex flex-col leading-tight">
                            <span className="text-sm font-medium">{c.name}</span>
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {c.chainSymbol}
                            </span>
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={selectedSourceToken?.tokenAddress ?? ''} onValueChange={setSourceTokenAddr}>
                  <SelectTrigger className="h-11 flex-1">
                    {selectedSourceToken ? (
                      <span className="flex items-center gap-2">
                        <TokenDisc symbol={selectedSourceToken.symbol} />
                        <span className="text-sm font-medium">{selectedSourceToken.symbol}</span>
                      </span>
                    ) : (
                      <SelectValue placeholder="Token" />
                    )}
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={4}>
                    {sourceTokens.map((t) => (
                      <SelectItem key={t.tokenAddress} value={t.tokenAddress} className="py-2">
                        <span className="flex items-center gap-2.5">
                          <TokenDisc symbol={t.symbol} />
                          <span className="flex flex-col leading-tight">
                            <span className="text-sm font-medium">{t.symbol}</span>
                            <span className="text-[10px] text-muted-foreground">{t.name}</span>
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-input bg-muted/50 px-3 py-2.5">
                <Input
                  type="number"
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-auto border-none bg-transparent p-0 text-lg font-bold shadow-none focus-visible:ring-0"
                />
              </div>
              {overBalance && (
                <p className="text-xs text-destructive">Amount exceeds your wallet balance.</p>
              )}
            </div>

            <div className="-my-2 flex justify-center">
              <div className="rounded-full border border-border bg-accent p-1">
                <ArrowDown size={14} className="text-muted-foreground" />
              </div>
            </div>

            {/* Destination — fixed to Stellar USDC. */}
            <div className="space-y-3">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">To</Label>
              <div className="flex h-11 items-center justify-between rounded-lg border border-input bg-muted/30 px-3">
                <div className="flex items-center gap-2.5">
                  <span className="relative inline-flex">
                    <TokenDisc symbol={destToken?.symbol ?? 'USDC'} size={26} />
                    <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-card">
                      <NetworkIcon chainSymbol="SRB" size={13} />
                    </span>
                  </span>
                  <div className="leading-tight">
                    <div className="text-sm font-semibold">{destToken?.symbol ?? 'USDC'} on Stellar</div>
                    <div className="text-[10px] text-muted-foreground">Destination is fixed to Stellar</div>
                  </div>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-lg font-bold tabular-nums">{quote ?? '0.0'}</span>
                  {quoting && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
                </div>
              </div>
            </div>

            {/* Recipient (Stellar) — defaults to connected wallet, editable via modal. */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">
                Recipient (Stellar)
              </Label>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-input bg-muted/30 px-3 py-2.5">
                {recipient ? (
                  <div className="min-w-0 leading-tight">
                    <div className="truncate font-mono text-sm">{shortenAddress(recipient, 6, 6)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {recipientIsWallet ? 'Your connected Stellar wallet' : 'Custom address'}
                      {recipient && !recipientValid && ' · invalid'}
                    </div>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">No recipient set</span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 gap-1 px-2 text-xs"
                  onClick={() => setEditorOpen(true)}
                >
                  <Pencil size={12} /> Edit
                </Button>
              </div>
              {!recipient && (
                <p className="text-xs text-muted-foreground">
                  Connect a Stellar wallet, or add a recipient address.
                </p>
              )}
            </div>

            {/* Summary */}
            {(quote || fee || transferTimeMs !== null) && (
              <div className="space-y-1.5 rounded-lg border border-border/50 bg-muted/30 p-3">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-muted-foreground">Estimated Network Fee</span>
                  <span className="text-foreground">{fee ? `${fee.amount} ${fee.symbol}` : '—'}</span>
                </div>
                {transferTimeMs !== null && (
                  <div className="flex justify-between text-xs font-medium">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Clock size={11} />
                      Estimated time of arrival
                    </span>
                    <span className="text-foreground">~{fmtEstimate(transferTimeMs)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Reown not configured */}
            {reownBlocked && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-xs text-muted-foreground">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                <span>
                  Connecting an EVM/Solana wallet needs a wallet-connect project id
                  (VITE_REOWN_PROJECT_ID).
                </span>
              </div>
            )}

            <Button
              onClick={handleBridge}
              disabled={!BRIDGE_ENABLED || !sourceAddress || !canSubmit || busy || reownBlocked}
              className="h-10 w-full text-sm font-bold uppercase tracking-wide shadow-none"
            >
              {busy && <Loader2 size={15} className="mr-2 animate-spin" />}
              {ctaLabel}
            </Button>
          </>
        )}
      </CardContent>

      <RecipientEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        walletAddress={stellarAddress}
        initial={recipientOverride ?? ''}
        onSave={(addr) => setRecipientOverride(addr)}
        onUseWallet={() => setRecipientOverride(null)}
      />
    </Card>
  );
};

/**
 * Full-width source-wallet connector. The source chain can be any supported
 * network, so the label is chain-agnostic ("Connect Source Wallet"); the Reown
 * modal it opens lists every wallet for that chain's namespace (MetaMask, Rabby,
 * Coinbase, WalletConnect… for EVM; Phantom, Solflare… for Solana). When connected
 * it shows the address with a disconnect affordance.
 */
const SourceWalletPanel = ({
  family,
  chainName,
  address,
  disabled,
  onConnect,
  onDisconnect,
}: {
  family: SourceFamily;
  chainName?: string;
  address: string | null;
  disabled: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) => {
  if (family === 'unsupported') return null;

  if (address) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate font-mono text-sm font-medium">
              {shortenAddress(address, 6, 6)}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {chainName ? `Connected · ${chainName}` : 'Source wallet connected'}
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={onDisconnect}
        >
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      className="h-11 w-full gap-2 text-sm font-semibold"
      onClick={onConnect}
      disabled={disabled}
    >
      <Wallet size={16} />
      Connect Source Wallet
    </Button>
  );
};

/** Modal to set a custom Stellar recipient, or revert to the connected wallet. */
const RecipientEditor = ({
  open,
  onOpenChange,
  walletAddress,
  initial,
  onSave,
  onUseWallet,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walletAddress: string | null;
  initial: string;
  onSave: (address: string) => void;
  onUseWallet: () => void;
}) => {
  const [value, setValue] = useState(initial);

  const trimmed = value.trim();
  const valid = isValidStellarAddress(trimmed);

  // Reset the field to the current override whenever the dialog opens — handled in
  // the open-change event (not an effect) so no state is set during render.
  const handleOpenChange = (next: boolean) => {
    if (next) setValue(initial);
    onOpenChange(next);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content className="app-shell fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold">
                Recipient address
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
                Where the bridged USDC lands on Stellar.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X size={16} />
            </DialogPrimitive.Close>
          </div>

          <div className="mt-4 space-y-3">
            {walletAddress && (
              <button
                type="button"
                onClick={() => {
                  onUseWallet();
                  onOpenChange(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-left text-sm hover:border-primary/40 hover:bg-muted"
              >
                <Wallet size={15} className="text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Use my connected wallet</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {walletAddress}
                  </span>
                </span>
                <Check size={15} className="text-emerald-500" />
              </button>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">
                Custom Stellar address
              </Label>
              <Input
                placeholder="G…"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="font-mono text-sm"
                autoFocus
              />
              {trimmed && !valid && (
                <p className="text-xs text-destructive">Not a valid Stellar (G…) address.</p>
              )}
            </div>

            <Button
              className="w-full"
              disabled={!valid}
              onClick={() => {
                onSave(trimmed);
                onOpenChange(false);
              }}
            >
              Save recipient
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

/** "in 4m 12s" / "in 45s" elapsed between two unix-ms instants. */
const fmtDuration = (fromMs: number, toMs: number): string => {
  const secs = Math.max(0, Math.round((toMs - fromMs) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
};

/** Absolute local time for a unix-ms instant (e.g. "14:32:05"). */
const fmtTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** One transfer row — shows live progress while pending, completion time when done. */
const TransferRow = ({ transfer }: { transfer: BridgeTransfer }) => {
  const done = transfer.completedAt !== null;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
      <div className="mt-0.5 shrink-0">
        {done ? (
          <CheckCircle2 size={16} className="text-emerald-500" />
        ) : (
          <Loader2 size={16} className="animate-spin text-primary" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <span className="tabular-nums">
            {Number(transfer.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}
          </span>
          <span>{transfer.sourceSymbol}</span>
          <span className="text-muted-foreground">·</span>
          <span className="truncate text-muted-foreground">{transfer.sourceChainName} → Stellar</span>
        </div>

        {done ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-emerald-500">
            <span className="inline-flex items-center gap-1">
              <Clock size={11} />
              Completed {fmtTime(transfer.completedAt!)}
            </span>
            <span className="text-muted-foreground">
              · in {fmtDuration(transfer.startedAt, transfer.completedAt!)}
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>
              {transfer.signaturesNeeded > 0
                ? `Awaiting delivery · ${transfer.signaturesCount}/${transfer.signaturesNeeded} signatures`
                : 'Awaiting delivery on Stellar…'}
            </span>
            {transfer.etaMs !== null && (
              <span className="inline-flex items-center gap-1">
                <Clock size={11} />
                ETA ~{fmtEstimate(transfer.etaMs)}
              </span>
            )}
          </div>
        )}
      </div>

      {done && transfer.receiveHash && (
        <a
          href={explorerTx(transfer.receiveHash)}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          title="View destination transaction"
        >
          <ExternalLink size={14} />
        </a>
      )}
    </div>
  );
};

/** Recent-transfers panel — surfaces each bridge's live status + completion time. */
const TransferHistory = ({
  transfers,
  onClear,
}: {
  transfers: BridgeTransfer[];
  onClear: () => void;
}) => {
  if (transfers.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <History size={17} className="text-primary" />
          Recent transfers
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={onClear}
        >
          Clear
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Bridges take a few minutes to settle on Stellar. We track each one and show when it lands.
      </p>
      <div className="mt-4 space-y-2">
        {transfers.map((t) => (
          <TransferRow key={t.hash} transfer={t} />
        ))}
      </div>
    </div>
  );
};

const BridgeSection = () => {
  const { transfers, track, clear } = useBridgeHistory();
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <BridgePanel onTracked={track} />
        </div>
        <div className="space-y-6 lg:col-span-6">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <ShieldCheck size={17} className="text-emerald-500" />
              Powered by Allbridge Core
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Allbridge Core provides a seamless way to bridge native stablecoins across different ecosystems.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <div className="h-1 w-1 rounded-full bg-primary" />
                Native-to-native swaps
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1 w-1 rounded-full bg-primary" />
                No wrapped assets
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1 w-1 rounded-full bg-primary" />
                Low slippage and fees
              </li>
            </ul>
          </div>

          <TransferHistory transfers={transfers} onClear={clear} />
        </div>
      </div>
    </div>
  );
};

export default BridgeSection;
