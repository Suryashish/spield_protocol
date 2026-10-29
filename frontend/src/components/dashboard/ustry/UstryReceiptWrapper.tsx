import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, Loader2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/context/ToastContext';
import {
  addConversionTrustlines,
  CIRCLE_ISSUER,
  conversionBalance,
  conversionQuote,
  executeConversion,
  GATAL_ISSUER,
  missingTrustlines,
  swapAsset,
  USTRY_ISSUER,
  type ConversionQuote,
} from '@/lib/ustry-conversion';
import { quantity, units } from '@/lib/ustry';
import AmountField from '../sections/AmountField';
import type { UstryDashboardModel } from './useUstryDashboard';

type Mode = 'wrap' | 'unwrap';
const amountOf = (value: string) => {
  try {
    return quantity(value);
  } catch {
    return 0n;
  }
};

export default function UstryReceiptWrapper({ model: m }: { model: UstryDashboardModel }) {
  const { push, update } = useToast();
  const [mode, setMode] = useState<Mode>('wrap');
  const [issuer, setIssuer] = useState(GATAL_ISSUER);
  const [amount, setAmount] = useState('');
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [quote, setQuote] = useState<ConversionQuote | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [phase, setPhase] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const generation = useRef(0);
  const usdc = swapAsset('USDC', issuer);
  const ustry = swapAsset('USTRY', USTRY_ISSUER);
  const entered = amountOf(amount);
  const available = mode === 'wrap' ? usdcBalance : (m.data?.holding.receipt ?? null);
  const overBalance = available !== null && entered > available;
  const capExceeded =
    mode === 'wrap' &&
    !!quote &&
    !!m.data &&
    m.data.state.receipts + m.data.state.backing + quote.output >
      BigInt(m.c.capUstry) * 10_000_000n;
  const expired = !!quote && now >= quote.expires;

  const refreshBalance = useCallback(async () => {
    if (!m.address) {
      setUsdcBalance(null);
      return;
    }
    try {
      setUsdcBalance(await conversionBalance(m.address, swapAsset('USDC', issuer)));
    } catch {
      setUsdcBalance(null);
    }
  }, [m.address, issuer]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    generation.current++;
    setQuote(null);
    setError('');
    setQuoting(false);
  }, [m.address, m.activeSeries.id]);

  useEffect(() => {
    if (entered <= 0n || busy) return;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const request = ++generation.current;
      setQuoting(true);
      try {
        const result = await conversionQuote(
          m.address ?? '',
          m.activeSeries.id,
          mode === 'wrap' ? swapAsset('USDC', issuer) : swapAsset('USTRY', USTRY_ISSUER),
          mode === 'wrap' ? swapAsset('USTRY', USTRY_ISSUER) : swapAsset('USDC', issuer),
          entered,
        );
        if (request === generation.current) {
          setQuote(result);
          setError('');
        }
      } catch (cause) {
        if (request === generation.current) {
          setQuote(null);
          setError(cause instanceof Error ? cause.message : 'Could not get a quote.');
        }
      } finally {
        if (request === generation.current) setQuoting(false);
      }
    };
    timer = setTimeout(() => void refresh(), 400);
    const interval = setInterval(() => void refresh(), 10_000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      generation.current++;
    };
  }, [entered, mode, issuer, m.address, m.activeSeries.id, busy]);

  function reset(nextMode?: Mode, nextIssuer?: string, nextAmount?: string) {
    generation.current++;
    setQuote(null);
    setError('');
    setActionError('');
    setQuoting(false);
    if (nextMode) setMode(nextMode);
    if (nextIssuer) setIssuer(nextIssuer);
    if (nextAmount !== undefined) setAmount(nextAmount);
  }

  async function ensureTrustlines() {
    if (!m.address) return;
    const missing = await missingTrustlines(m.address, [usdc, ustry]);
    if (!missing.length) return;
    setPhase('Add required asset trustlines');
    const toast = push({ kind: 'pending', title: 'Add asset trustlines', message: 'Confirm in your wallet…' });
    try {
      const result = await addConversionTrustlines(m.address, m.activeSeries.id, missing);
      update(toast, { kind: 'success', title: 'Trustlines added', hash: result.hash });
    } catch (cause) {
      update(toast, { kind: 'error', title: 'Trustline setup failed', message: String(cause) });
      throw cause;
    }
  }

  async function convert(q: ConversionQuote) {
    if (!m.address) throw new Error('Connect your wallet.');
    setPhase(`Swap ${q.source.code} for ${q.destination.code}`);
    const toast = push({ kind: 'pending', title: 'Swap assets', message: 'Confirm in your wallet…' });
    try {
      const result = await executeConversion(m.address, q);
      update(toast, { kind: 'success', title: 'Swap confirmed', hash: result.hash });
      await m.onConverted(result.hash);
    } catch (cause) {
      update(toast, { kind: 'error', title: 'Swap failed', message: String(cause) });
      throw cause;
    }
  }

  async function submit() {
    if (!m.address || !quote || expired || busy || quoting || overBalance || capExceeded) return;
    const address = m.address;
    setBusy(true);
    setActionError('');
    try {
      await ensureTrustlines();
      if (mode === 'wrap') {
        if (m.entryBlocked) throw new Error('USTRY deposits are currently unavailable.');
        const before = await conversionBalance(address, ustry);
        // A new quote accounts for time spent adding trustlines and signing in the wallet.
        const fresh = await conversionQuote(address, m.activeSeries.id, usdc, ustry, entered);
        if (fresh.output < quote.minimum)
          throw new Error('The new sUSTRY estimate is below your reviewed minimum. Get a new quote before swapping.');
        const snapshot = m.data;
        if (
          !snapshot ||
          snapshot.state.receipts + snapshot.state.backing + fresh.output >
            BigInt(m.c.capUstry) * 10_000_000n
        )
          throw new Error('The latest quote exceeds this series’ USTRY deposit cap.');
        await convert({
          ...fresh,
          minimum: fresh.minimum > quote.minimum ? fresh.minimum : quote.minimum,
        });
        let received = 0n;
        for (let attempt = 0; attempt < 5; attempt++) {
          const after = await conversionBalance(address, ustry);
          received = after > before ? after - before : 0n;
          if (received >= fresh.minimum) break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (received < fresh.minimum)
          throw new Error('The swap succeeded, but the received USTRY is not visible yet. It remains in your wallet; retry depositing after balances refresh.');
        setPhase('Deposit into sUSTRY');
        if (!(await m.transact('Deposit USTRY into sUSTRY', 'deposit', received)))
          throw new Error('The swap succeeded, but the sUSTRY deposit failed. Your USTRY remains in your wallet.');
      } else {
        setPhase('Withdraw sUSTRY');
        if (!(await m.transact('Withdraw sUSTRY', 'withdraw_receipts', entered)))
          throw new Error('The sUSTRY withdrawal failed. Your receipts remain in your wallet.');
        // Horizon can lag the Soroban withdrawal, while the next payment needs
        // the newly returned USTRY in its account balance.
        let balance = 0n;
        for (let attempt = 0; attempt < 5; attempt++) {
          balance = await conversionBalance(address, ustry);
          if (balance >= entered) break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (balance < entered)
          throw new Error('The withdrawal succeeded, but USTRY is not visible in your wallet yet. It remains yours; use Markets after balances refresh.');
        const fresh = await conversionQuote(address, m.activeSeries.id, ustry, usdc, entered);
        if (fresh.output < quote.minimum)
          throw new Error('The withdrawal succeeded, but the new USDC quote is below your reviewed minimum. Your USTRY remains in your wallet; review a new rate on Markets.');
        await convert({
          ...fresh,
          minimum: fresh.minimum > quote.minimum ? fresh.minimum : quote.minimum,
        });
      }
      setAmount('');
      setQuote(null);
      await refreshBalance();
    } catch (cause) {
      setQuote(null);
      setActionError(cause instanceof Error ? cause.message : 'The conversion could not finish.');
      await refreshBalance();
    } finally {
      setBusy(false);
      setPhase('');
    }
  }

  const disabled = busy || quoting || m.busy || !m.onCorrectNetwork || m.loading;
  return (
    <Card className="h-full rounded-xl">
      <CardHeader>
        <CardTitle>sUSTRY Wrapper</CardTitle>
        <CardDescription>Enter with USDC and receive sUSTRY receipts, or withdraw to USDC.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/50 p-1" aria-label="Wrapper direction">
          {(['wrap', 'unwrap'] as const).map((next) => (
            <button
              key={next}
              type="button"
              aria-pressed={mode === next}
              disabled={busy}
              onClick={() => reset(next, undefined, '')}
              className={`rounded-md px-2 py-2 text-xs font-medium ${mode === next ? 'bg-card text-foreground shadow-float-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <span className="block">{next === 'wrap' ? 'Wrap' : 'Unwrap'}</span>
              <span className="block text-[10px] opacity-70">{next === 'wrap' ? 'USDC → sUSTRY' : 'sUSTRY → USDC'}</span>
            </button>
          ))}
        </div>
        <label className="block space-y-1.5">
          <span className="eyebrow">USDC asset</span>
          <select
            className="h-10 w-full rounded-lg border border-border bg-sunken px-3 text-sm"
            aria-label="USDC issuer"
            value={issuer}
            disabled={busy}
            onChange={(event) => reset(undefined, event.target.value)}
          >
            <option value={GATAL_ISSUER}>GATAL test USDC</option>
            <option value={CIRCLE_ISSUER}>Circle testnet USDC</option>
          </select>
        </label>
        <AmountField
          label="You pay"
          token={mode === 'wrap' ? 'USDC' : 'sUSTRY'}
          value={amount}
          onChange={(value) => reset(undefined, undefined, value)}
          disabled={busy}
          balance={available === null ? '—' : units(available)}
          onMax={available !== null && available > 0n ? () => reset(undefined, undefined, units(available)) : undefined}
          invalid={overBalance || (amount !== '' && entered === 0n)}
        />
        <div className="flex justify-center text-muted-foreground"><ArrowDown size={16} /></div>
        <AmountField
          label="Estimated receive"
          token={mode === 'wrap' ? 'sUSTRY' : 'USDC'}
          value={quote && !expired ? units(quote.output) : ''}
          hint={quoting ? 'Updating live quote…' : 'Live exchange quote; sUSTRY is minted 1:1 from received USTRY'}
          hintTone="brand"
          loading={quoting}
        />
        <div className="well space-y-1.5 rounded-lg p-3 text-xs">
          <div className="flex justify-between gap-2"><span className="text-muted-foreground">Minimum estimated output</span><span>{quote && !expired ? `${units(quote.minimum)} ${mode === 'wrap' ? 'sUSTRY' : 'USDC'}` : '—'}</span></div>
          <div className="flex justify-between gap-2"><span className="text-muted-foreground">Swap slippage limit</span><span>1%</span></div>
          <div className="flex justify-between gap-2"><span className="text-muted-foreground">Quote</span><span>{quoting ? 'Updating…' : quote ? expired ? 'Refreshing…' : `${Math.ceil((quote.expires - now) / 1000)}s remaining` : entered > 0n ? 'Waiting for live quote' : 'Enter an amount'}</span></div>
        </div>
        {capExceeded && <p className="text-xs text-danger-text">The quoted USTRY exceeds this series&apos; deposit cap.</p>}
        {overBalance && <p className="text-xs text-danger-text">Insufficient {mode === 'wrap' ? 'USDC' : 'sUSTRY'} balance.</p>}
        {error && <p role="alert" className="rounded-lg border border-danger/25 bg-danger/8 p-3 text-xs text-danger-text">{error}</p>}
        {actionError && <p role="alert" className="rounded-lg border border-danger/25 bg-danger/8 p-3 text-xs text-danger-text">{actionError}</p>}
        {!m.address ? (
          <Button className="w-full" onClick={m.openWalletPicker}><Wallet className="mr-2 h-4 w-4" />Connect Wallet</Button>
        ) : (
          <Button
            className="w-full"
            disabled={disabled || entered <= 0n || !quote || expired || overBalance || capExceeded || (mode === 'wrap' && m.entryBlocked)}
            onClick={() => void submit()}
          >
            {(busy || quoting) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {busy ? phase : quoting ? 'Updating quote…' : !m.onCorrectNetwork ? 'Switch wallet network' : mode === 'wrap' && m.entryBlocked ? 'Deposits unavailable' : !quote || expired ? 'Waiting for live quote' : mode === 'wrap' ? 'Wrap USDC' : 'Unwrap to USDC'}
          </Button>
        )}
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          The swap and receipt action require separate wallet confirmations. If the second step fails, the intermediate USTRY stays in your wallet. Use <Link to="/markets" className="underline">Markets</Link> to convert it back. Test XLM is needed for fees.
        </p>
      </CardContent>
    </Card>
  );
}
