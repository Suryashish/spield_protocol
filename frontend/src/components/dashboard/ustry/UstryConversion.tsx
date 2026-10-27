import { useEffect, useRef, useState } from 'react';
import { ArrowDown, Loader2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import AmountField from '../sections/AmountField';
import { cn } from '@/lib/utils';
import { useSeries } from '@/context/SeriesContext';
import { useWallet } from '@/context/WalletContext';
import { useToast } from '@/context/ToastContext';
import {
  addConversionTrustlines,
  CIRCLE_ISSUER,
  conversionQuote,
  executeConversion,
  GATAL_ISSUER,
  swapAsset,
  USTRY_ISSUER,
  type ConversionQuote,
} from '@/lib/ustry-conversion';
import { quantity, units } from '@/lib/ustry';
export default function UstryConversion({
  busyParent,
  onConfirmed,
}: {
  busyParent: boolean;
  onConfirmed: (hash: string) => Promise<void>;
}) {
  const { activeSeries } = useSeries();
  const { address, onCorrectNetwork, openWalletPicker } = useWallet();
  const { push, update } = useToast();
  const [issuer, setIssuer] = useState(GATAL_ISSUER);
  const [reverse, setReverse] = useState(false);
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<ConversionQuote | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [requestingQuote, setRequestingQuote] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function invalidate() {
    generation.current++;
    setQuote(null);
    setError('');
  }
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const usdc = swapAsset('USDC', issuer);
  const ustry = swapAsset('USTRY', USTRY_ISSUER);
  const source = reverse ? ustry : usdc;
  const destination = reverse ? usdc : ustry;
  async function getQuote() {
    if (!address) return;
    const id = ++generation.current;
    setRequestingQuote(true);
    setBusy(true);
    setQuote(null);
    setError('');
    try {
      const q = await conversionQuote(
        address,
        activeSeries.id,
        source,
        destination,
        quantity(amount),
      );
      if (mounted.current && id === generation.current) setQuote(q);
    } catch (e) {
      if (mounted.current && id === generation.current)
        setError(e instanceof Error ? e.message : 'Quote failed.');
    } finally {
      if (mounted.current) {
        setBusy(false);
        setRequestingQuote(false);
      }
    }
  }
  async function run(label: string, fn: () => Promise<{ hash: string }>) {
    setBusy(true);
    setError('');
    const id = push({ kind: 'pending', title: label, message: 'Confirm in your wallet…' });
    try {
      const result = await fn();
      update(id, { kind: 'success', title: label + ' confirmed', hash: result.hash });
      if (mounted.current) {
        setQuote(null);
        await onConfirmed(result.hash);
      }
    } catch (e) {
      update(id, {
        kind: 'error',
        title: label + ' failed',
        message: e instanceof Error ? e.message : 'Transaction failed.',
      });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const disabled = busy || busyParent || !address || !onCorrectNetwork;
  let entered = 0n;
  try {
    entered = quantity(amount);
  } catch {
    /* Invalid values cannot be quoted. */
  }
  return (
    <Card className="rounded-xl">
      <CardHeader>
        <CardTitle>Trade</CardTitle>
        <CardDescription>Convert USDC and USTRY using a live exchange quote.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className="grid grid-cols-2 gap-1 rounded-lg bg-muted/50 p-1"
          aria-label="Conversion direction"
        >
          {[false, true].map((sell) => (
            <button
              key={String(sell)}
              type="button"
              aria-pressed={reverse === sell}
              disabled={busy}
              onClick={() => {
                invalidate();
                setReverse(sell);
              }}
              className={cn(
                'rounded-md px-3 py-2 text-[12px] font-medium transition-colors',
                reverse === sell
                  ? 'bg-card text-foreground shadow-float-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="block">{sell ? 'Sell' : 'Buy'}</span>
              <span className="block text-[10px] opacity-70">
                {sell ? 'USTRY → USDC' : 'USDC → USTRY'}
              </span>
            </button>
          ))}
        </div>
        <label className="block space-y-1.5">
          <span className="eyebrow">USDC asset</span>
          <select
            aria-label="Conversion USDC issuer"
            className="h-10 w-full min-w-0 rounded-lg border border-border bg-sunken px-3 text-sm"
            value={issuer}
            disabled={busy}
            onChange={(e) => {
              invalidate();
              setIssuer(e.target.value);
            }}
          >
            <option value={GATAL_ISSUER}>GATAL test USDC · Blend asset</option>
            <option value={CIRCLE_ISSUER}>GBBD test USDC · Circle testnet</option>
          </select>
        </label>
        <AmountField
          label="You pay"
          token={source.code}
          value={amount}
          onChange={(value) => {
            invalidate();
            setAmount(value);
          }}
          disabled={busy}
        />
        <div className="flex items-center gap-3 py-0.5">
          <span className="rule-soft flex-1" />
          <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-card text-subtle shadow-float-sm">
            <ArrowDown size={12} />
          </span>
          <span className="rule-soft flex-1" />
        </div>
        <AmountField
          label="You receive"
          token={destination.code}
          value={quote ? units(quote.output) : ''}
          hint="Live quote · subject to liquidity"
          hintTone="brand"
          loading={busy && !quote}
        />
        <div className="well space-y-2 rounded-lg p-3 text-[12.5px]">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Minimum received</span>
            <span className="num text-right">
              {quote ? `${units(quote.minimum)} ${quote.destination.code}` : '—'}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Slippage limit</span>
            <span>1%</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Quote</span>
            <span>
              {quote
                ? now >= quote.expires
                  ? 'Expired'
                  : `${Math.ceil((quote.expires - now) / 1000)}s remaining`
                : 'Not requested'}
            </span>
          </div>
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-danger/25 bg-danger/8 p-3 text-[12px] text-danger-text"
          >
            {error}
          </p>
        )}
        {!address ? (
          <Button className="w-full" onClick={openWalletPicker}>
            <Wallet className="mr-2 h-4 w-4" />
            Connect Wallet
          </Button>
        ) : (
          <Button
            className="w-full"
            disabled={disabled || entered <= 0n}
            onClick={() =>
              quote && now < quote.expires
                ? void run('Convert ' + quote.source.code, () => executeConversion(address, quote))
                : void getQuote()
            }
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {busy
              ? requestingQuote
                ? 'Getting quote…'
                : 'Confirming…'
              : !onCorrectNetwork
                ? 'Switch wallet network'
                : quote && now < quote.expires
                  ? 'Review conversion in wallet'
                  : 'Get quote'}
          </Button>
        )}
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          Output returns to your wallet. The test USDC issuers may trade at different prices.
          Conversion needs test XLM for fees.
        </p>
        <details className="border-t border-border pt-3">
          <summary className="cursor-pointer text-[12px] font-medium">
            Asset setup & route details
          </summary>
          <div className="mt-3 space-y-3">
            <p className="break-all font-mono text-[11px] text-muted-foreground">
              USDC issuer: {issuer}
              <br />
              USTRY issuer: {USTRY_ISSUER}
            </p>
            {quote && (
              <p className="text-xs text-muted-foreground">
                Route: {quote.source.code} →{' '}
                {quote.path.map((a) => `${a.code} (${a.issuer?.slice(0, 4)}…) → `)}
                {quote.destination.code}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={disabled}
              onClick={() =>
                address &&
                void run('Add asset trustlines', () =>
                  addConversionTrustlines(address, activeSeries.id, [usdc, ustry]),
                )
              }
            >
              Add required trustlines
            </Button>
          </div>
        </details>
        <p className="text-[11px] text-subtle">
          This market converts the underlying USTRY asset. A PT trading pool is not deployed for
          this series.
        </p>
      </CardContent>
    </Card>
  );
}
