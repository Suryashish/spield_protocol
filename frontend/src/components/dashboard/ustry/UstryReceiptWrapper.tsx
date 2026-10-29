import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, Loader2, Package, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
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
import { FACTOR_SCALE, quantity, units } from '@/lib/ustry';
import AmountField from '../sections/AmountField';
import IssuerSelect from './IssuerSelect';
import type { UstryDashboardModel } from './useUstryDashboard';

type Mode = 'wrap' | 'unwrap';
type Product = 'receipt' | 'ptyt';
const amountOf = (value: string) => {
  try {
    return quantity(value);
  } catch {
    return 0n;
  }
};

export default function UstryReceiptWrapper({
  model: m,
  product = 'receipt',
}: {
  model: UstryDashboardModel;
  product?: Product;
}) {
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
  const factor = m.data?.state.factor ?? 0n;
  // Every quote is checked against this NAV before it can be shown or executed.
  const nav = m.data?.latest.price ?? 0n;
  const expectedPayout =
    product === 'ptyt' && factor > 0n ? (entered * factor) / FACTOR_SCALE : entered;
  const quoteInput = mode === 'wrap' ? entered : expectedPayout;
  const estimatedFace =
    quote && factor > 0n ? (quote.output * FACTOR_SCALE) / factor : 0n;
  const minimumFace =
    quote && factor > 0n ? (((quote.minimum * FACTOR_SCALE) / factor) * 9950n) / 10000n : 0n;
  const available =
    mode === 'wrap'
      ? usdcBalance
      : product === 'receipt'
        ? (m.data?.holding.receipt ?? null)
        : m.data
          ? m.matured
            ? m.data.holding.pt
            : m.data.holding.pt < m.data.holding.yt
              ? m.data.holding.pt
              : m.data.holding.yt
          : null;
  const overBalance = available !== null && entered > available;
  const capExceeded =
    mode === 'wrap' &&
    !!quote &&
    !!m.data &&
    m.data.state.receipts + m.data.state.backing + quote.output > m.data.cap;
  const faceTooSmall = product === 'ptyt' && mode === 'wrap' && !!quote && minimumFace <= 0n;
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
    let active = true;
    queueMicrotask(() => {
      if (active) void refreshBalance();
    });
    return () => {
      active = false;
    };
  }, [refreshBalance]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      generation.current++;
      setQuote(null);
      setError('');
      setQuoting(false);
    });
    return () => {
      active = false;
    };
  }, [m.address, m.activeSeries.id]);

  useEffect(() => {
    if (quoteInput <= 0n || busy) return;
    const generationRef = generation;
    const refresh = async () => {
      const request = ++generation.current;
      setQuoting(true);
      try {
        const result = await conversionQuote(
          m.address ?? '',
          m.activeSeries.id,
          mode === 'wrap' ? swapAsset('USDC', issuer) : swapAsset('USTRY', USTRY_ISSUER),
          mode === 'wrap' ? swapAsset('USTRY', USTRY_ISSUER) : swapAsset('USDC', issuer),
          quoteInput,
          nav,
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
    const timer = setTimeout(() => void refresh(), 400);
    const interval = setInterval(() => void refresh(), 10_000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      generationRef.current++;
    };
  }, [quoteInput, mode, issuer, m.address, m.activeSeries.id, busy, nav]);

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
    if (
      !m.address ||
      !quote ||
      quote.wallet !== m.address ||
      quote.seriesId !== m.activeSeries.id ||
      quote.amount !== quoteInput ||
      expired ||
      busy ||
      quoting ||
      overBalance ||
      capExceeded ||
      faceTooSmall ||
      (product === 'ptyt' && factor <= 0n)
    ) return;
    const address = m.address;
    setBusy(true);
    setActionError('');
    try {
      await ensureTrustlines();
      if (mode === 'wrap') {
        if (m.entryBlocked) throw new Error('USTRY deposits are currently unavailable.');
        const before = await conversionBalance(address, ustry);
        // A new quote accounts for time spent adding trustlines and signing in the wallet.
        const fresh = await conversionQuote(address, m.activeSeries.id, usdc, ustry, entered, nav);
        if (fresh.output < quote.minimum)
          throw new Error('The new sUSTRY estimate is below your reviewed minimum. Get a new quote before swapping.');
        const snapshot = m.data;
        if (
          !snapshot ||
          snapshot.state.receipts + snapshot.state.backing + fresh.output > snapshot.cap
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
        setPhase(product === 'ptyt' ? 'Mint PT + YT' : 'Deposit into sUSTRY');
        const minted =
          product === 'ptyt'
            ? await m.transact('Deposit USDC and mint PT + YT', 'deposit_split', received, minimumFace || 1n)
            : await m.transact('Deposit USTRY into sUSTRY', 'deposit', received);
        if (!minted)
          throw new Error(
            product === 'ptyt'
              ? 'The USDC swap succeeded, but PT + YT minting failed. Your USTRY remains in your wallet.'
              : 'The swap succeeded, but the sUSTRY deposit failed. Your USTRY remains in your wallet.',
          );
      } else {
        const before = await conversionBalance(address, ustry);
        setPhase(product === 'ptyt' ? 'Combine PT + YT' : 'Withdraw sUSTRY');
        const withdrawn =
          product === 'ptyt'
            ? await m.transact(
                m.matured ? 'Redeem PT for USDC' : 'Combine PT + YT for USDC',
                'redeem',
                entered,
                (expectedPayout * 9950n) / 10000n || 1n,
              )
            : await m.transact('Withdraw sUSTRY', 'withdraw_receipts', entered);
        if (!withdrawn)
          throw new Error(
            product === 'ptyt'
              ? 'The PT redemption failed. Your PT and YT remain in your wallet.'
              : 'The sUSTRY withdrawal failed. Your receipts remain in your wallet.',
          );
        // Horizon can lag the Soroban withdrawal, while the next payment needs
        // the newly returned USTRY in its account balance.
        let received = 0n;
        for (let attempt = 0; attempt < 5; attempt++) {
          const after = await conversionBalance(address, ustry);
          received = after > before ? after - before : 0n;
          if (received >= (product === 'ptyt' ? (expectedPayout * 9950n) / 10000n : entered)) break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (received <= 0n)
          throw new Error('The withdrawal succeeded, but USTRY is not visible in your wallet yet. It remains yours; use Markets after balances refresh.');
        const fresh = await conversionQuote(address, m.activeSeries.id, ustry, usdc, received, nav);
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
  // Deposit's primary action is DepositPanel's tall button; the wrapper keeps SrWrapPanel's default.
  const buttonClass = product === 'ptyt' ? 'h-11 w-full text-[14px] font-medium' : 'w-full';
  return (
    <Card className="h-full rounded-xl">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          {product === 'ptyt' ? (
            <span>{mode === 'wrap' ? 'Deposit' : m.matured ? 'Redeem' : 'Combine'}</span>
          ) : (
            <span className="flex items-center gap-2">
              <Package className="h-4 w-4" aria-hidden />
              sUSTRY Wrapper
            </span>
          )}
          <InfoTooltip
            title={product === 'ptyt' ? 'Deposit & Mint' : 'sUSTRY Receipt'}
            content={
              product === 'ptyt'
                ? 'USDC is converted to USTRY, then split into equal PT (USD face, principal) and YT (yield above the NAV high). Combining burns equal PT + YT and converts the USTRY back to USDC.'
                : 'sUSTRY is an unsplit USTRY receipt. It holds the USTRY itself, so exiting it never needs a live NAV observation.'
            }
          />
        </CardTitle>
        <CardDescription>
          {product === 'ptyt'
            ? mode === 'wrap'
              ? 'Supply USDC to mint a principal token (PT) + a yield token (YT)'
              : m.matured
                ? 'Burn PT for its USTRY allocation, paid out in USDC'
                : 'Burn PT + YT together to exit, paid out in USDC'
            : 'Enter with USDC and receive sUSTRY receipts, or withdraw to USDC.'}
        </CardDescription>
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
              className={cn(
                'rounded-md px-2 py-1.5 text-xs font-medium transition',
                mode === next
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="block">
                {product === 'ptyt'
                  ? next === 'wrap' ? 'Deposit' : m.matured ? 'Redeem' : 'Combine'
                  : next === 'wrap' ? 'Wrap' : 'Unwrap'}
              </span>
              <span className="block text-[10px] opacity-70">
                {product === 'ptyt'
                  ? next === 'wrap' ? 'USDC → PT + YT' : m.matured ? 'PT → USDC' : 'PT + YT → USDC'
                  : next === 'wrap' ? 'USDC → sUSTRY' : 'sUSTRY → USDC'}
              </span>
            </button>
          ))}
        </div>
        <IssuerSelect
          label="USDC issuer"
          value={issuer}
          disabled={busy}
          onChange={(value) => reset(undefined, value)}
        >
          <option value={GATAL_ISSUER}>GATAL test USDC</option>
          <option value={CIRCLE_ISSUER}>Circle testnet USDC</option>
        </IssuerSelect>
        <AmountField
          label="You pay"
          token={mode === 'wrap' ? 'USDC' : product === 'ptyt' ? m.matured ? 'PT' : 'PT + YT' : 'sUSTRY'}
          value={amount}
          onChange={(value) => reset(undefined, undefined, value)}
          disabled={busy}
          balance={available === null ? '—' : units(available)}
          onMax={available !== null && available > 0n ? () => reset(undefined, undefined, units(available)) : undefined}
          invalid={overBalance || (amount !== '' && entered === 0n)}
        />
        {product === 'ptyt' ? (
          <div className="flex items-center gap-3 py-0.5">
            <span className="rule-soft flex-1" aria-hidden="true" />
            <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-card text-subtle shadow-float-sm">
              <ArrowDown size={12} />
            </span>
            <span className="rule-soft flex-1" aria-hidden="true" />
          </div>
        ) : (
          <div className="flex justify-center">
            <ArrowDown className="h-4 w-4 text-muted-foreground" aria-hidden />
          </div>
        )}
        {product === 'ptyt' && mode === 'wrap' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <AmountField
              label="You receive"
              token="PT"
              value={quote && !expired && estimatedFace > 0n ? units(estimatedFace) : ''}
              hint="USD face; redemption value can vary"
              hintTone="brand"
              loading={quoting}
            />
            <AmountField
              label="You receive"
              token="YT"
              value={quote && !expired && estimatedFace > 0n ? units(estimatedFace) : ''}
              hint="Variable yield"
              hintTone="ember"
              loading={quoting}
            />
          </div>
        ) : (
          <AmountField
            label="You receive"
            token={mode === 'wrap' ? 'sUSTRY' : 'USDC'}
            value={quote && !expired ? units(quote.output) : ''}
            hint={quoting ? 'Updating live quote…' : 'Live exchange quote; output can change until confirmed'}
            hintTone="brand"
            loading={quoting}
          />
        )}
        <div className="well space-y-1.5 rounded-lg p-3 text-[12.5px]">
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Minimum estimated output</span>
            <span>
              {quote && !expired
                ? product === 'ptyt' && mode === 'wrap'
                  ? `${units(minimumFace)} PT + ${units(minimumFace)} YT`
                  : `${units(quote.minimum)} ${mode === 'wrap' ? 'sUSTRY' : 'USDC'}`
                : '—'}
            </span>
          </div>
          {product === 'ptyt' && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">USTRY NAV</span>
              <span>{m.data ? `$${units(m.data.latest.price, 8)} / USTRY` : '—'}</span>
            </div>
          )}
          <div className="flex justify-between gap-2"><span className="text-muted-foreground">Swap slippage limit</span><span>1%</span></div>
          <div className="flex justify-between gap-2"><span className="text-muted-foreground">Quote</span><span>{quoting ? 'Updating…' : quote ? expired ? 'Refreshing…' : `${Math.ceil((quote.expires - now) / 1000)}s remaining` : entered > 0n ? 'Waiting for live quote' : 'Enter an amount'}</span></div>
        </div>
        {capExceeded && <p className="text-xs text-danger-text">The quoted USTRY exceeds this series&apos; deposit cap.</p>}
        {faceTooSmall && <p className="text-xs text-danger-text">The estimated PT and YT output is too small. Increase the USDC amount.</p>}
        {overBalance && <p className="text-xs text-danger-text">Insufficient {mode === 'wrap' ? 'USDC' : product === 'ptyt' ? m.matured ? 'PT' : 'PT + YT' : 'sUSTRY'} balance.</p>}
        {error && <p role="alert" className="rounded-lg border border-danger/25 bg-danger/8 p-3 text-xs text-danger-text">{error}</p>}
        {actionError && <p role="alert" className="rounded-lg border border-danger/25 bg-danger/8 p-3 text-xs text-danger-text">{actionError}</p>}
        {!m.address ? (
          <Button className={buttonClass} onClick={m.openWalletPicker}><Wallet className="mr-2 h-4 w-4" aria-hidden />Connect Wallet</Button>
        ) : (
          <Button
            className={buttonClass}
            disabled={disabled || entered <= 0n || !quote || quote.wallet !== m.address || quote.seriesId !== m.activeSeries.id || quote.amount !== quoteInput || expired || overBalance || capExceeded || faceTooSmall || (mode === 'wrap' && m.entryBlocked) || (product === 'ptyt' && (factor <= 0n || (mode === 'unwrap' && m.unsafe)))}
            onClick={() => void submit()}
          >
            {(busy || quoting) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {busy ? phase : quoting ? 'Updating quote…' : !m.onCorrectNetwork ? 'Switch wallet network' : mode === 'wrap' && m.entryBlocked ? 'Deposits unavailable' : product === 'ptyt' && mode === 'unwrap' && m.unsafe ? 'Waiting for valid NAV' : !quote || expired ? 'Waiting for live quote' : product === 'ptyt' ? mode === 'wrap' ? 'Deposit USDC' : m.matured ? 'Redeem to USDC' : 'Combine to USDC' : mode === 'wrap' ? 'Wrap USDC' : 'Unwrap to USDC'}
          </Button>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {product === 'ptyt'
            ? 'USDC conversion and PT/YT minting or redemption require separate wallet confirmations. PT and YT use USD face; USDC received on exit depends on USTRY NAV and market liquidity.'
            : 'The swap and receipt action require separate wallet confirmations.'}{' '}
          If a later step fails, intermediate USTRY stays in your wallet. Use <Link to="/markets" className="underline">Markets</Link> to convert it back. Test XLM is needed for fees.
        </p>
      </CardContent>
    </Card>
  );
}
