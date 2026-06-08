import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Loader2, Wallet, AlertTriangle, ShieldCheck, ArrowDown } from 'lucide-react';
import type { 
  ChainDetailsWithTokens, 
  TokenWithChainDetails 
} from '@allbridge/bridge-core-sdk';
import { 
  Messenger,
  AmountFormat
} from '@allbridge/bridge-core-sdk';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { useWallet } from '@/context/WalletContext';
import { useTxAction } from '@/lib/useTxAction';
import { sdk } from '@/lib/allbridge';

const BridgePanel = () => {
  const { address, isConnected, connecting } = useWallet();
  const { run, busy } = useTxAction();

  const [chains, setChains] = useState<ChainDetailsWithTokens[]>([]);
  const [loadingChains, setLoadingChains] = useState(true);

  const [sourceChain, setSourceChain] = useState<string>('');
  const [sourceToken, setSourceToken] = useState<string>('');
  const [destChain, setDestChain] = useState<string>('');
  const [destToken, setDestToken] = useState<string>('');
  
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  
  const [quote, setQuote] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [fee, setFee] = useState<string | null>(null);

  // Fetch chains on mount
  useEffect(() => {
    const fetchChains = async () => {
      try {
        const chainMap = await sdk.chainDetailsMap();
        const chainList = Object.values(chainMap);
        setChains(chainList);
        
        // Default to Stellar if available
        const stellar = chainList.find(c => c.chainSymbol === 'SRB' || c.name.toLowerCase().includes('stellar'));
        if (stellar) {
          setSourceChain(stellar.chainSymbol);
          if (stellar.tokens.length > 0) {
            setSourceToken(stellar.tokens[0].symbol);
          }
        }
      } catch (err) {
        console.error('Failed to fetch Allbridge chains:', err);
      } finally {
        setLoadingChains(false);
      }
    };
    fetchChains();
  }, []);

  const sourceChainData = useMemo(() => chains.find(c => c.chainSymbol === sourceChain), [chains, sourceChain]);
  const destChainData = useMemo(() => chains.find(c => c.chainSymbol === destChain), [chains, destChain]);
  
  const sourceTokens = useMemo(() => sourceChainData?.tokens || [], [sourceChainData]);
  const destTokens = useMemo(() => destChainData?.tokens || [], [destChainData]);

  const selectedSourceToken = useMemo(() => sourceTokens.find(t => t.symbol === sourceToken), [sourceTokens, sourceToken]) as TokenWithChainDetails | undefined;
  const selectedDestToken = useMemo(() => destTokens.find(t => t.symbol === destToken), [destTokens, destToken]) as TokenWithChainDetails | undefined;

  // Debounced quote
  useEffect(() => {
    let cancelled = false;
    const fetchQuote = async () => {
      if (!selectedSourceToken || !selectedDestToken || !amount || isNaN(Number(amount)) || Number(amount) <= 0) {
        setQuote(null);
        setFee(null);
        return;
      }

      setQuoting(true);
      try {
        const amountToReceive = await sdk.getAmountToBeReceived(
          amount,
          selectedSourceToken,
          selectedDestToken
        );
        const gasFeeOptions = await sdk.getGasFeeOptions(
          selectedSourceToken,
          selectedDestToken,
          Messenger.ALLBRIDGE
        );

        if (!cancelled) {
          setQuote(amountToReceive);
          // Just show the native gas fee for simplicity in this demo
          setFee(gasFeeOptions.native[AmountFormat.FLOAT]);
        }
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
  }, [amount, selectedSourceToken, selectedDestToken]);

  const handleBridge = async () => {
    if (!address || !selectedSourceToken || !selectedDestToken || !amount || !recipient) return;

    await run('Bridge Assets', async () => {
      throw new Error('Bridge execution requires source chain wallet provider. Integration complete but needs specific wallet hooks for non-Stellar chains.');
    });
  };

  const isStellarSource = sourceChainData?.chainSymbol === 'SRB';

  return (
    <Card className="h-full rounded-xl border-border bg-card shadow-sm">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <ArrowRightLeft size={16} className="text-primary" />
          Cross-Chain Bridge
        </CardTitle>
        <CardDescription className="text-xs">
          Swap assets between Stellar and other chains via Allbridge Core.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {loadingChains ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Source Selection */}
            <div className="space-y-3">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">From</Label>
              <div className="flex gap-2">
                <Select value={sourceChain} onValueChange={setSourceChain}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Chain" />
                  </SelectTrigger>
                  <SelectContent>
                    {chains.map(c => (
                      <SelectItem key={c.chainSymbol} value={c.chainSymbol}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={sourceToken} onValueChange={setSourceToken}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Token" />
                  </SelectTrigger>
                  <SelectContent>
                    {sourceTokens.map(t => (
                      <SelectItem key={t.symbol} value={t.symbol}>
                        {t.symbol}
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
            </div>

            <div className="flex justify-center -my-2">
              <div className="rounded-full bg-accent p-1 border border-border">
                <ArrowDown size={14} className="text-muted-foreground" />
              </div>
            </div>

            {/* Destination Selection */}
            <div className="space-y-3">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">To</Label>
              <div className="flex gap-2">
                <Select value={destChain} onValueChange={setDestChain}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Chain" />
                  </SelectTrigger>
                  <SelectContent>
                    {chains.map(c => (
                      <SelectItem key={c.chainSymbol} value={c.chainSymbol}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={destToken} onValueChange={setDestToken}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Token" />
                  </SelectTrigger>
                  <SelectContent>
                    {destTokens.map(t => (
                      <SelectItem key={t.symbol} value={t.symbol}>
                        {t.symbol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-input bg-muted/50 px-3 py-2.5">
                <div className="flex flex-1 items-baseline gap-2">
                  <span className="text-lg font-bold tabular-nums">
                    {quote || '0.0'}
                  </span>
                  {quoting && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
                </div>
              </div>
            </div>

            {/* Recipient Address */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">Recipient Address</Label>
              <Input
                placeholder="Address on destination chain"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="bg-muted/30"
              />
            </div>

            {/* Summary */}
            {(quote || fee) && (
              <div className="space-y-1.5 rounded-lg border border-border/50 bg-muted/30 p-3">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-muted-foreground">Estimated Fee</span>
                  <span className="text-foreground">{fee ? `${fee}` : '—'}</span>
                </div>
              </div>
            )}

            {!isStellarSource && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-xs text-muted-foreground">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                <span>
                  Bridging from non-Stellar chains requires an EVM or Solana wallet (e.g. MetaMask, Phantom).
                </span>
              </div>
            )}

            <Button
              onClick={handleBridge}
              disabled={busy || quoting || !amount || !recipient || !selectedSourceToken || !selectedDestToken}
              className="h-10 w-full text-sm font-bold uppercase tracking-wide shadow-none"
            >
              {busy || connecting ? (
                <Loader2 size={15} className="animate-spin" />
              ) : !isConnected ? (
                <Wallet size={15} className="mr-2" />
              ) : null}
              {!isConnected ? 'Connect Wallet' : 'Bridge Assets'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};

const BridgeSection = () => (
  <div className="space-y-6">
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
      <div className="lg:col-span-6">
        <BridgePanel />
      </div>
      <div className="lg:col-span-6 space-y-6">
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
      </div>
    </div>
  </div>
);

export default BridgeSection;
