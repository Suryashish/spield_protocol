import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDown,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Code2,
  Coins,
  Droplets,
  History,
  Layers,
  Loader2,
  Lock,
  Package,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wallet,
  Wallet2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { InfoTooltip } from '@/components/ui/tooltip';
import AmountField from '../sections/AmountField';
import EmptyState from '../sections/EmptyState';
import StatTile from '../sections/StatTile';
import { cn } from '@/lib/utils';
import { explorerContract, explorerTx } from '@/lib/config';
import { FACTOR_SCALE, quantity, units } from '@/lib/ustry';
import type { UstryDashboardModel } from './useUstryDashboard';
import UstryConversion from './UstryConversion';

type Props = { model: UstryDashboardModel };
type Mode = 'deposit_split' | 'redeem' | 'deposit' | 'withdraw_receipts' | 'split';
const date = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
const amountOf = (value: string) => {
  try {
    return quantity(value);
  } catch {
    return 0n;
  }
};
function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-[12.5px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="num text-right text-foreground">{children}</span>
    </div>
  );
}
function ArrowDivider() {
  return (
    <div className="flex items-center gap-3 py-0.5">
      <span className="rule-soft flex-1" />
      <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-card text-subtle shadow-float-sm">
        <ArrowDown size={12} />
      </span>
      <span className="rule-soft flex-1" />
    </div>
  );
}
export function UstryStats({
  model: m,
  kind = 'overview',
}: Props & { kind?: 'overview' | 'deposit' | 'liquidity' | 'vault' }) {
  const { data, address, loading, activeSeries, claimable } = m;
  const days = Math.max(0, Math.ceil((activeSeries.expiry - m.clock / 1000) / 86400));
  const shown = (value?: bigint) => (address && data && value !== undefined ? units(value) : '—');
  if (kind === 'liquidity' || kind === 'vault')
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="USTRY Balance"
          value={shown(data?.wallet)}
          sub={address ? 'Available in your wallet' : 'Connect your wallet'}
          icon={Wallet2}
          loading={loading && !data}
        />
        <StatTile
          label={kind === 'vault' ? 'Fixed APR' : 'Pool Liquidity'}
          value="—"
          sub="Not configured for this series"
          icon={kind === 'vault' ? Lock : Droplets}
        />
        <StatTile
          label={kind === 'vault' ? 'Vault Status' : 'LP Position'}
          value="Unavailable"
          sub="No deployment for USTRY"
          icon={Layers}
        />
        <StatTile
          label="Maturity"
          value={days ? `${days}d` : 'Matured'}
          sub={`Matures ${date(activeSeries.expiry)}`}
          icon={CalendarClock}
        />
      </div>
    );
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="ustry-stats">
      <StatTile
        label="USTRY Balance"
        value={shown(data?.wallet)}
        sub={address ? 'Available to deposit' : 'Connect your wallet'}
        icon={Wallet2}
        tone="usdc"
        loading={loading && !data}
        info="USTRY in your connected wallet. Deposits and payouts use these token units."
      />
      <StatTile
        label={kind === 'deposit' ? 'PT Balance' : 'Principal Face'}
        value={shown(data?.holding.pt)}
        sub="USD face · payout in USTRY"
        icon={Layers}
        loading={loading && !data}
        info="PT face is denominated in USD. It does not guarantee a dollar payout when USTRY NAV falls."
      />
      <StatTile
        label={kind === 'deposit' ? 'YT Balance' : 'Claimable Yield'}
        value={shown(kind === 'deposit' ? data?.holding.yt : claimable)}
        sub={kind === 'deposit' ? 'USD face · earns until maturity' : 'USTRY · ready to claim'}
        icon={TrendingUp}
        tone={claimable > 0n ? 'positive' : 'default'}
        loading={loading && !data}
      />
      <StatTile
        label="Maturity"
        value={days ? `${days}d` : 'Matured'}
        sub={`${m.matured ? 'On' : 'Matures'} ${date(activeSeries.expiry)}`}
        icon={CalendarClock}
        info="After the maturity observation is recorded, PT redeems for its frozen allocation of USTRY."
      />
    </div>
  );
}
export function UstryNavChart({ model: m }: Props) {
  const samples = (m.data?.history ?? [])
    .filter((p) => p.price > 0n && Number(p.timestamp) <= m.clock / 1000)
    .map((p) => ({ time: Number(p.timestamp), nav: Number(units(p.price, 8)) }));
  const prices = samples.map((p) => p.nav);
  const low = prices.length ? Math.min(...prices) : 0;
  const high = prices.length ? Math.max(...prices) : 1;
  const padding = Math.max((high - low) * 0.15, high * 0.0001);
  return (
    <Card className="overflow-hidden rounded-xl">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>USTRY NAV</CardTitle>
          <CardDescription>
            Issuer sandbox NAV per USTRY · recorded relay observations
          </CardDescription>
        </div>
        <div className="flex items-stretch gap-3">
          <div className="text-right">
            <div className="eyebrow flex items-center justify-end gap-1.5">
              <TrendingUp size={13} className="text-brand-text" />
              Asset NAV
            </div>
            <div className="num font-display text-[22px] font-medium tracking-[-0.02em] text-brand-text sm:text-[26px]">
              {m.data ? `$${units(m.data.latest.price, 8)}` : '—'}{' '}
              <span className="text-xs font-normal text-muted-foreground">/ USTRY</span>
            </div>
            <div className="eyebrow">Last observation</div>
          </div>
          <div className="w-px self-stretch bg-border" />
          <div className="text-right">
            <div className="eyebrow">Samples</div>
            <div className="num font-display text-[22px] font-medium tracking-[-0.02em] sm:text-[26px]">
              {samples.length}
            </div>
            <div className="eyebrow">Recorded</div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {m.loading && !m.data ? (
          <div className="h-64 animate-pulse rounded-xl bg-muted" />
        ) : samples.length < 2 ? (
          <EmptyState
            className="h-64"
            icon={TrendingUp}
            title={samples.length ? 'Building NAV history…' : 'NAV observations unavailable'}
            body={
              samples.length
                ? 'We have one recorded price observation. The curve fills in as the NAV relay records new updates.'
                : 'Refresh to load the series price history. No historical prices are estimated.'
            }
          />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={264}>
              <AreaChart data={samples} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="time"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  tickFormatter={(t) =>
                    new Date(Number(t) * 1000).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })
                  }
                />
                <YAxis
                  width={85}
                  domain={[Math.max(0, low - padding), high + padding]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  tickFormatter={(n) =>
                    `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 })}`
                  }
                />
                <Tooltip
                  labelFormatter={(t) => new Date(Number(t) * 1000).toLocaleString()}
                  formatter={(v) => [`$${Number(v).toFixed(8)}`, 'NAV / USTRY']}
                  contentStyle={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Area
                  type="linear"
                  dataKey="nav"
                  stroke="var(--brand)"
                  fill="var(--brand)"
                  fillOpacity={0.1}
                  dot={{ r: 3 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
            <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
              NAV can rise or fall. This chart shows the underlying asset price, not a fixed return
              or your portfolio performance.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
function UstryPortfolioChart({ model: m }: Props) {
  const d = m.data;
  const values = d
    ? [
        { name: 'Receipts', value: (d.holding.receipt * d.latest.price) / 100_000_000n },
        {
          name: 'PT allocation',
          value: (((d.holding.pt * d.state.factor) / FACTOR_SCALE) * d.latest.price) / 100_000_000n,
        },
        { name: 'Earned yield', value: (m.claimable * d.latest.price) / 100_000_000n },
      ]
    : [];
  const hasPosition = values.some((v) => v.value > 0n);
  return (
    <Card className="overflow-hidden rounded-xl">
      <CardHeader>
        <CardTitle>Portfolio Composition</CardTitle>
        <CardDescription>
          Estimated USD value of receipts, principal allocation and earned yield
        </CardDescription>
      </CardHeader>
      <CardContent>
        {m.loading && !d ? (
          <div className="h-64 animate-pulse rounded-xl bg-muted" />
        ) : !m.address || !hasPosition ? (
          <EmptyState
            className="h-64"
            icon={Layers}
            title={m.address ? 'No positions yet' : 'Connect your wallet'}
            body="Your principal and yield breakdown appears here once you deposit."
          />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={264}>
              <BarChart
                data={values.map((v) => ({ name: v.name, value: Number(units(v.value)) }))}
                margin={{ top: 8, right: 0, left: -16, bottom: 0 }}
              >
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  tickFormatter={(n) => `$${n}`}
                />
                <Tooltip
                  formatter={(v) => [`$${Number(v).toFixed(7)}`, 'Value at last NAV']}
                  contentStyle={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                  }}
                />
                <Bar
                  dataKey="value"
                  fill="var(--brand)"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
            <p className="mt-3 text-[12px] text-muted-foreground">
              Valued at the last available NAV. Future YT yield is not priced; nominal PT face and
              market value can differ.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
export function UstrySolvencyCard({ model: m }: Props) {
  const d = m.data;
  const owed = d ? d.state.receipts + d.state.backing : 0n;
  const covered = !!d && d.custody >= owed;
  const ratio = d ? (owed > 0n ? Number((d.custody * 10_000n) / owed) / 100 : 100) : null;
  const share = d && d.custody > 0n ? Math.min(100, Number((owed * 10_000n) / d.custody) / 100) : 0;
  const surplus = d && d.custody > owed ? d.custody - owed : 0n;
  const Icon = covered ? ShieldCheck : ShieldAlert;
  if (m.loading && !d)
    return (
      <Card className="rounded-xl">
        <CardContent>
          <div className="h-44 animate-pulse rounded-xl bg-muted" />
        </CardContent>
      </Card>
    );
  return (
    <Card
      className={cn(
        'overflow-hidden rounded-xl',
        d && (covered ? 'border-brand/30' : 'border-danger/40'),
      )}
    >
      <CardContent className="@container space-y-5">
        <div className="flex flex-col gap-4 @md:flex-row @md:items-center @md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={cn(
                'grid size-11 shrink-0 place-items-center rounded-xl @md:size-14 @md:rounded-2xl',
                covered ? 'bg-brand/10 text-brand-text' : 'well text-subtle',
              )}
            >
              <Icon className="size-6 @md:size-7" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-[19px] font-medium tracking-[-0.02em] @md:text-[21px]">
                  {d ? (covered ? 'Covered' : 'Under-backed') : 'Awaiting data'}
                </h3>
                <InfoTooltip
                  title="USTRY backing"
                  content="USTRY custody covers unsplit receipts and PT/YT token allocations. Token coverage does not guarantee dollar principal."
                />
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground @md:text-[13px]">
                Live USTRY custody vs. token obligations, read on-chain.
              </p>
            </div>
          </div>
          <div className="shrink-0 @md:text-right">
            <p className="eyebrow">Collateralization</p>
            <p
              className={cn(
                'num mt-1 font-display text-[26px] leading-none font-medium tracking-[-0.025em] @md:text-[32px]',
                covered ? 'text-brand-text' : 'text-subtle',
              )}
            >
              {ratio === null ? '—' : `${ratio.toFixed(2)}%`}
            </p>
          </div>
        </div>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full', covered ? 'bg-brand' : 'bg-danger')}
            style={{ width: `${share}%` }}
          />
          <div className="h-full bg-brand/30" style={{ width: d ? `${100 - share}%` : '0%' }} />
        </div>
        <div className="grid grid-cols-3 gap-2 max-[359px]:grid-cols-1 @md:gap-3">
          {[
            ['Backing', d ? units(d.custody) : '—', 'USTRY held by the series'],
            ['Obligations', d ? units(owed) : '—', 'Receipt plus PT/YT token allocations'],
            [
              'Surplus',
              d ? `+${units(surplus)}` : '—',
              'Unallocated USTRY, including rounding; not a promised yield payout',
            ],
          ].map(([label, value, info]) => (
            <div key={label} className="min-w-0 well rounded-lg p-2 @md:p-3">
              <div className="flex items-center justify-between gap-1">
                <p className="eyebrow min-w-0 truncate">{label}</p>
                <InfoTooltip content={info} size={10} />
              </div>
              <p
                className="num mt-1.5 truncate text-[13px] font-medium @md:text-base"
                title={value}
              >
                {value}
              </p>
              <p className="mt-1 text-[10px] text-subtle">USTRY</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Code2 size={13} />
            Read live from{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
              state() + balance()
            </code>
          </span>
          <a
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-text hover:underline"
            href={explorerContract(m.c.series)}
            target="_blank"
            rel="noreferrer"
          >
            View series contract
            <ArrowUpRight size={11} />
          </a>
        </div>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Coverage is measured in USTRY. Falling NAV can reduce the dollar value of principal.
        </p>
      </CardContent>
    </Card>
  );
}
export function UstryOverview({ model }: Props) {
  return (
    <div className="space-y-6">
      <div data-tour="overview-stats">
        <UstryStats model={model} />
      </div>
      <UstryNavChart model={model} />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <UstryPortfolioChart model={model} />
        </div>
        <div className="lg:col-span-4">
          <UstrySolvencyCard model={model} />
        </div>
      </div>
    </div>
  );
}
export function UstryActionPanel({ model: m, receipt = false }: Props & { receipt?: boolean }) {
  const [mode, setMode] = useState<Mode>(() =>
    receipt ? 'deposit' : m.matured ? 'redeem' : 'deposit_split',
  );
  const [amount, setAmount] = useState('');
  const entered = amountOf(amount);
  const invalidAmount = amount !== '' && entered === 0n;
  const d = m.data;
  const split = mode === 'deposit_split' || mode === 'split';
  const face = d ? (entered * FACTOR_SCALE) / d.state.factor : 0n;
  const payout = d ? (entered * d.state.factor) / FACTOR_SCALE : 0n;
  const available = d
    ? mode === 'redeem'
      ? m.matured
        ? d.holding.pt
        : d.holding.pt < d.holding.yt
          ? d.holding.pt
          : d.holding.yt
      : mode === 'withdraw_receipts' || mode === 'split'
        ? d.holding.receipt
        : d.wallet
    : 0n;
  const over = entered > available;
  const smallPayout = mode === 'redeem' && entered > 0n && payout === 0n;
  const entry = mode !== 'redeem' && mode !== 'withdraw_receipts';
  const capExceeded =
    !!d &&
    (mode === 'deposit' || mode === 'deposit_split') &&
    d.state.receipts + d.state.backing + entered > BigInt(m.c.capUstry) * 10_000_000n;
  const blocked = entry
    ? m.entryBlocked || capExceeded
    : mode === 'redeem'
      ? m.unsafe
      : !d || !!m.error;
  const disabled =
    m.busy ||
    m.connecting ||
    (!!m.address &&
      (!m.onCorrectNetwork || m.loading || blocked || entered <= 0n || over || smallPayout));
  const label = !m.address
    ? 'Connect Wallet'
    : !m.onCorrectNetwork
      ? 'Switch wallet network'
      : m.busy
        ? 'Confirming…'
        : entry && m.matured
          ? 'Series Matured (Minting Closed)'
          : entry && d?.paused
            ? 'Deposits Paused'
            : blocked
              ? capExceeded
                ? 'Deposit cap reached'
                : 'Waiting for valid NAV'
              : entered <= 0n
                ? 'Enter an amount'
                : over
                  ? `Insufficient ${mode === 'redeem' ? (m.matured ? 'PT' : 'PT + YT') : mode === 'split' || mode === 'withdraw_receipts' ? 'receipts' : 'USTRY'}`
                  : smallPayout
                    ? 'Amount too small'
                    : mode === 'deposit_split'
                      ? 'Deposit & Mint'
                      : mode === 'redeem'
                        ? m.matured
                          ? 'Redeem USTRY'
                          : 'Combine PT + YT'
                        : mode === 'withdraw_receipts'
                          ? 'Withdraw USTRY'
                          : mode === 'split'
                            ? 'Split into PT + YT'
                            : 'Deposit USTRY';
  const tabs: { mode: Mode; title: string; sub: string }[] = receipt
    ? [
        { mode: 'deposit', title: 'Deposit', sub: 'USTRY → sUSTRY' },
        { mode: 'withdraw_receipts', title: 'Withdraw', sub: 'sUSTRY → USTRY' },
        { mode: 'split', title: 'Split', sub: 'sUSTRY → PT + YT' },
      ]
    : [
        { mode: 'deposit_split', title: 'Deposit', sub: 'USTRY → PT + YT' },
        {
          mode: 'redeem',
          title: m.matured ? 'Redeem' : 'Combine',
          sub: m.matured ? 'PT → USTRY' : 'PT + YT → USTRY',
        },
      ];
  async function submit() {
    if (!m.address) {
      m.openWalletPicker();
      return;
    }
    if (disabled) return;
    const minimum = ((mode === 'redeem' ? payout : face) * 9950n) / 10000n || 1n;
    if (
      await m.transact(
        mode === 'deposit_split' ? 'Deposit and split USTRY' : mode.replaceAll('_', ' '),
        mode,
        entered,
        minimum,
      )
    )
      setAmount('');
  }
  return (
    <Card className="h-full rounded-xl">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>
            {receipt
              ? 'USTRY receipts'
              : mode === 'deposit_split'
                ? 'Deposit'
                : m.matured
                  ? 'Redeem'
                  : 'Combine'}
          </span>
          <InfoTooltip
            title="USTRY accounting"
            content="Deposit amounts use USTRY token units. PT and YT use USD face, valued using the current NAV. Payouts return USTRY, and dollar principal is not guaranteed."
          />
        </CardTitle>
        <CardDescription>
          {receipt
            ? 'Hold one receipt per USTRY, withdraw in kind or split into PT and YT.'
            : mode === 'deposit_split'
              ? 'Supply USTRY to mint principal tokens (PT) + yield tokens (YT)'
              : m.matured
                ? 'Burn PT for its frozen USTRY allocation'
                : 'Burn equal PT + YT to withdraw the principal allocation in USTRY'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={cn(
            'grid gap-1 rounded-lg bg-muted/50 p-1',
            receipt ? 'grid-cols-3' : 'grid-cols-2',
          )}
          aria-label={receipt ? 'Receipt actions' : 'Deposit actions'}
        >
          {tabs.map((t) => (
            <button
              key={t.mode}
              type="button"
              aria-pressed={mode === t.mode}
              onClick={() => {
                setMode(t.mode);
                setAmount('');
              }}
              className={cn(
                'rounded-md px-3 py-2 text-[12px] font-medium transition-colors',
                mode === t.mode
                  ? 'bg-card text-foreground shadow-float-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="block">{t.title}</span>
              <span className="block text-[10px] opacity-70">{t.sub}</span>
            </button>
          ))}
        </div>
        <AmountField
          label={
            mode === 'redeem'
              ? 'You burn (USD face)'
              : mode === 'withdraw_receipts' || mode === 'split'
                ? 'Receipt amount'
                : 'Deposit'
          }
          token={
            mode === 'redeem'
              ? m.matured
                ? 'PT'
                : 'PT + YT'
              : mode === 'withdraw_receipts' || mode === 'split'
                ? 'sUSTRY'
                : 'USTRY'
          }
          value={amount}
          onChange={setAmount}
          disabled={m.busy}
          balance={m.address && d ? units(available) : '—'}
          onMax={m.address && available > 0n ? () => setAmount(units(available)) : undefined}
          invalid={over || invalidAmount}
        />
        {invalidAmount && (
          <p className="text-xs text-danger-text" role="alert">
            Enter a positive amount with at most 7 decimal places.
          </p>
        )}
        <ArrowDivider />
        {split ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <AmountField
              label="You receive"
              token="PT"
              value={entered > 0n && d ? units(face) : ''}
              hint="USD face · payout in USTRY"
              hintTone="brand"
            />
            <AmountField
              label="You receive"
              token="YT"
              value={entered > 0n && d ? units(face) : ''}
              hint="Variable · earns until maturity"
              hintTone="ember"
            />
          </div>
        ) : (
          <AmountField
            label="You receive"
            token={mode === 'deposit' ? 'sUSTRY' : 'USTRY'}
            value={entered > 0n && d ? units(mode === 'redeem' ? payout : entered) : ''}
            hint={
              mode === 'deposit'
                ? 'One receipt per USTRY'
                : mode === 'withdraw_receipts'
                  ? 'In-kind exit · no price required'
                  : 'Token allocation · dollar value can vary'
            }
            hintTone="brand"
          />
        )}
        <div className="well space-y-1.5 rounded-lg p-3">
          <Pair label="Yield source">Etherfuse USTRY</Pair>
          <Pair label="You receive">
            {entered > 0n && d
              ? split
                ? `${units(face)} PT + ${units(face)} YT`
                : `${units(mode === 'redeem' ? payout : entered)} ${mode === 'deposit' ? 'sUSTRY' : 'USTRY'}`
              : '—'}
          </Pair>
          <Pair label="Sandbox NAV">{d ? `$${units(d.latest.price, 8)} / USTRY` : '—'}</Pair>
          <Pair label="Maturity">{date(m.activeSeries.expiry)}</Pair>
          {(split || mode === 'redeem') && <Pair label="Minimum output tolerance">0.5%</Pair>}
        </div>
        {entry && m.matured && (
          <p className="rounded-lg border border-ember/25 bg-ember/8 p-3 text-xs text-ember-text">
            This series has matured. Select Redeem to withdraw PT after settlement.
          </p>
        )}
        {entry && d && d.latest.price < d.state.high_water && (
          <p className="text-xs text-ember-text">
            New splits are unavailable while NAV is below its previous high.
          </p>
        )}
        <Button className="w-full" disabled={disabled} onClick={() => void submit()}>
          {m.busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : !m.address ? (
            <Wallet className="mr-2 h-4 w-4" />
          ) : (
            <Coins className="mr-2 h-4 w-4" />
          )}
          {label}
        </Button>
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          {receipt
            ? 'Unsplit receipts stay separate from PT/YT. Their USTRY quantity is fixed while the underlying NAV can change.'
            : 'PT and YT represent USD face; all payouts are in USTRY. NAV losses can reduce the dollar value of principal.'}
        </p>
      </CardContent>
    </Card>
  );
}
function UstryTransfer({ model: m }: Props) {
  const [token, setToken] = useState<'receipt' | 'pt' | 'yt'>('pt');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const entered = amountOf(amount);
  const available = m.data
    ? token === 'receipt'
      ? m.data.holding.receipt
      : token === 'pt'
        ? m.data.holding.pt
        : m.data.holding.yt
    : 0n;
  async function submit() {
    if (await m.transfer(token, recipient.trim(), entered)) {
      setRecipient('');
      setAmount('');
    }
  }
  return (
    <details className="border-t border-border pt-4">
      <summary className="cursor-pointer text-[13px] font-medium">
        Transfer receipt / PT / YT
      </summary>
      <div className="mt-4 space-y-3">
        <label className="block space-y-1.5">
          <span className="eyebrow">Token</span>
          <select
            aria-label="Transfer token"
            className="h-10 w-full rounded-lg border border-border bg-sunken px-3 text-sm"
            value={token}
            disabled={m.busy}
            onChange={(e) => setToken(e.target.value as typeof token)}
          >
            <option value="receipt">sUSTRY receipt</option>
            <option value="pt">PT-USTRY</option>
            <option value="yt">YT-USTRY</option>
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="eyebrow">Recipient Stellar address</span>
          <Input
            aria-label="Token recipient"
            value={recipient}
            disabled={m.busy}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="G… or C…"
          />
        </label>
        <AmountField
          label="Transfer amount"
          token={token === 'receipt' ? 'sUSTRY' : token.toUpperCase()}
          value={amount}
          onChange={setAmount}
          balance={units(available)}
          onMax={available > 0n ? () => setAmount(units(available)) : undefined}
          disabled={m.busy}
          invalid={entered > available}
        />
        <Button
          variant="outline"
          className="w-full"
          disabled={
            !m.address ||
            !m.onCorrectNetwork ||
            m.busy ||
            m.loading ||
            !!m.error ||
            entered <= 0n ||
            entered > available ||
            !recipient.trim() ||
            (token === 'yt' && m.unsafe)
          }
          onClick={() => void submit()}
        >
          Review transfer
        </Button>
      </div>
    </details>
  );
}
export function UstryPositions({ model: m, receipt = false }: Props & { receipt?: boolean }) {
  const d = m.data;
  const hasPosition =
    !!d && (d.holding.pt > 0n || d.holding.yt > 0n || d.holding.receipt > 0n || m.claimable > 0n);
  return (
    <Card className="h-full rounded-xl">
      <CardHeader>
        <CardTitle>{receipt ? 'Your receipt position' : 'Your positions'}</CardTitle>
        <CardDescription>
          {receipt
            ? 'Unsplit receipts and PT/YT balances for this series'
            : 'Principal tokens and yield tokens held by your wallet'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {m.loading && !d ? (
          <div className="h-56 animate-pulse rounded-xl bg-muted" />
        ) : !m.address || !hasPosition ? (
          <EmptyState
            className="min-h-56"
            icon={Layers}
            title={m.address ? 'No positions yet' : 'Connect your wallet'}
            body="Deposit USTRY to start a position. Your balances will appear here."
            action={
              !m.address ? (
                <Button size="sm" onClick={m.openWalletPicker}>
                  Connect Wallet
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {[
              ['PT', 'Principal · USD face', d!.holding.pt],
              ['YT', 'Yield entitlement · USD face', d!.holding.yt],
              ['sUSTRY', 'Unsplit receipts · USTRY units', d!.holding.receipt],
            ].map(([symbol, description, value]) => (
              <div
                key={String(symbol)}
                className="flex items-center justify-between gap-4 rounded-xl border border-border bg-sunken/40 p-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="well grid size-10 shrink-0 place-items-center rounded-lg text-brand-text">
                    <Layers size={16} />
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold">{String(symbol)}</p>
                    <p className="text-[11.5px] text-muted-foreground">{String(description)}</p>
                  </div>
                </div>
                <span className="num text-right font-display text-lg">
                  {units(value as bigint)}
                </span>
              </div>
            ))}
            <div className="well space-y-2 rounded-lg p-3">
              <Pair label="PT principal allocation">
                {units((d!.holding.pt * d!.state.factor) / FACTOR_SCALE)} USTRY
              </Pair>
              <Pair label="Claimable yield">{units(m.claimable)} USTRY</Pair>
            </div>
          </>
        )}
        <UstryTransfer model={m} />
      </CardContent>
    </Card>
  );
}
export function UstryDeposit({ model }: Props) {
  return (
    <div className="space-y-6">
      <UstryStats model={model} kind="deposit" />
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5" data-tour="deposit-panel">
          <UstryActionPanel model={model} />
        </div>
        <div className="lg:col-span-7">
          <UstryPositions model={model} />
        </div>
      </div>
    </div>
  );
}
export function UstryReceipts({ model }: Props) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12" data-tour="srwrap-panel">
      <div className="lg:col-span-5">
        <UstryActionPanel model={model} receipt />
      </div>
      <div className="lg:col-span-7">
        <UstryPositions model={model} receipt />
      </div>
    </div>
  );
}
export function UstryYield({ model: m }: Props) {
  const d = m.data;
  const rows = [
    [
      'Claimable now',
      m.address && d ? `${units(m.claimable)} USTRY` : '—',
      'Earned token units, paid without burning YT',
    ],
    [
      'YT face held',
      m.address && d ? `${units(d.holding.yt)} YT` : '—',
      'USD face earning variable yield',
    ],
    [
      'High-water NAV',
      d ? `$${units(d.state.high_water, 8)}` : '—',
      'New yield accrues above this level',
    ],
    [
      'Accruing until',
      m.matured ? 'Matured' : date(m.activeSeries.expiry),
      'Yield stops at this series maturity',
    ],
  ];
  return (
    <div data-tour="yield-panel">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Yield
            </span>
            <InfoTooltip
              title="Yield & claiming"
              content="USTRY paid by this claim leaves YT balances unchanged. A recovery below the previous NAV high earns no new yield."
            />
          </CardTitle>
          <CardDescription>
            What your YT has earned — claimable to USTRY without giving up the position.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
            {rows.map(([label, value, hint]) => (
              <div key={label} className="border-b border-border/60 py-3">
                <p className="text-[12px] text-muted-foreground">{label}</p>
                <p className="num mt-1 font-display text-lg font-medium">{value}</p>
                <p className="mt-1 text-[11.5px] text-subtle">{hint}</p>
              </div>
            ))}
          </div>
          <Button
            className="w-full"
            disabled={
              !!m.address &&
              (!m.onCorrectNetwork || m.busy || m.loading || m.unsafe || m.claimable <= 0n)
            }
            onClick={() =>
              !m.address
                ? m.openWalletPicker()
                : void m.transact('Claim USTRY yield', 'claim_yield')
            }
          >
            {m.busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Coins className="mr-2 h-4 w-4" />
            )}
            {!m.address
              ? 'Connect Wallet'
              : !m.onCorrectNetwork
                ? 'Switch wallet network'
                : m.claimable > 0n
                  ? `Claim ${units(m.claimable)} USTRY`
                  : 'Nothing to claim yet'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
export function UstryMarkets({ model }: Props) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <UstryNavChart model={model} />
        </div>
        <div className="lg:col-span-4" data-tour="markets-panel">
          <UstryConversion busyParent={model.busy} onConfirmed={model.onConverted} />
        </div>
      </div>
    </div>
  );
}
export function UstrySolvency({ model: m }: Props) {
  const d = m.data;
  const risks: [LucideIcon, string, string][] = [
    [
      ShieldAlert,
      'NAV can fall',
      'Token coverage does not guarantee USD principal. PT and yield payouts remain in USTRY.',
    ],
    [
      TrendingUp,
      'Prices depend on the NAV relay',
      'Priced actions stop when observations are stale. Missing maturity history can delay settlement.',
    ],
    [
      Lock,
      'Issuer controls apply',
      'USTRY issuer freezes or clawbacks can prevent token transfers and withdrawals.',
    ],
    [
      Coins,
      'Cash exits depend on liquidity',
      'USDC conversion uses executable exchange quotes. Fiat redemption is operated through Spield’s registered Etherfuse account.',
    ],
  ];
  return (
    <div className="space-y-6" data-tour="solvency-panel">
      <UstrySolvencyCard model={m} />
      <Card>
        <CardHeader>
          <CardTitle>Risk Disclosure</CardTitle>
          <CardDescription>
            What backs this series today, and what can interrupt an exit
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {risks.map(([Icon, title, body]) => (
              <div key={title} className="rounded-xl border border-border bg-sunken/40 p-4">
                <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
                  <Icon size={16} className="shrink-0 text-ember-text" />
                  {title}
                </div>
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Series configuration</CardTitle>
          <CardDescription>USTRY Series · Etherfuse sandbox · Stellar testnet</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Pair label="Deposit cap">{m.c.capUstry} USTRY</Pair>
            <Pair label="Maturity">{date(m.activeSeries.expiry)}</Pair>
            <Pair label="Settlement">
              {d?.settledOnChain
                ? 'Finalized on chain'
                : d?.state.finalized
                  ? 'Ready to finalize'
                  : m.matured
                    ? 'Pending boundary observation'
                    : 'Not yet matured'}
            </Pair>
            <Pair label="Last relay observation">
              {d ? new Date(Number(d.latest.timestamp) * 1000).toLocaleString() : '—'}
            </Pair>
            <Pair label="NAV freshness limit">13 hours</Pair>
            <Pair label="NAV relay heartbeat">12 hours / 0.1% change</Pair>
          </div>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            The relay records when it observed Etherfuse’s sandbox quote. That timestamp is not a
            verified underlying Treasury valuation time.
          </p>
          {m.matured && d?.state.finalized && !d.settledOnChain && (
            <Button
              disabled={!m.address || !m.onCorrectNetwork || m.busy || m.loading || !!m.error}
              onClick={() => void m.finalize()}
            >
              Finalize series
            </Button>
          )}
          <details className="border-t border-border pt-4">
            <summary className="flex cursor-pointer items-center gap-2 text-[13px] font-medium">
              <Code2 size={14} />
              Contract addresses
            </summary>
            <div className="mt-3 space-y-3">
              {Object.entries(m.c)
                .filter(([, v]) => typeof v === 'string')
                .map(([label, value]) => (
                  <div key={label}>
                    <p className="eyebrow mb-1">{label}</p>
                    <a
                      className="mono break-all text-xs text-brand-text"
                      href={explorerContract(String(value))}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {String(value)}
                      <ArrowUpRight className="ml-1 inline" size={12} />
                    </a>
                  </div>
                ))}
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
export function UstryActivity({ model: m }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>
          Confirmed actions for this wallet and series recorded on this device
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!m.address || !m.activity.length ? (
          <EmptyState
            icon={History}
            title={m.address ? 'No activity yet' : 'Connect your wallet'}
            body="Your confirmed deposits, claims, transfers and redemptions appear here. On-chain balances are read independently of this device history."
          />
        ) : (
          <div className="divide-y divide-border">
            {m.activity.map((a) => (
              <a
                key={a.hash}
                href={explorerTx(a.hash)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 py-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="well grid size-9 shrink-0 place-items-center rounded-lg text-brand-text">
                    <CheckCircle2 size={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{a.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(a.time).toLocaleString()}
                    </p>
                  </div>
                </div>
                <span className="mono flex shrink-0 items-center gap-1 text-xs text-brand-text">
                  {a.hash.slice(0, 6)}…{a.hash.slice(-4)}
                  <ArrowUpRight size={12} />
                </span>
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
export function UstryUnavailable({ model: m, section }: Props & { section: string }) {
  const navigate = useNavigate();
  const liquidity = section === 'liquidity';
  const bridge = section === 'bridge';
  const title = liquidity ? 'Provide Liquidity' : bridge ? 'Bridge Assets' : 'Fixed-Rate Vault';
  const description = liquidity
    ? 'No USTRY PT liquidity pool is deployed for this series.'
    : bridge
      ? 'USTRY does not currently have an enabled bridge route in Spield.'
      : 'No USTRY fixed-rate vault is deployed for this series.';
  return (
    <div className="space-y-6">
      {!bridge && <UstryStats model={m} kind={liquidity ? 'liquidity' : 'vault'} />}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <EmptyState
                icon={liquidity ? Droplets : bridge ? Wallet : Lock}
                title="Unavailable for USTRY"
                body={
                  liquidity
                    ? 'Existing USTRY can be converted to USDC on Markets. That conversion does not trade PT or create LP tokens.'
                    : bridge
                      ? 'Acquire supported test USDC on Stellar, then use Markets to convert to USTRY.'
                      : 'Use Deposit to split USTRY into PT/YT, or SR Wrapper to hold unsplit USTRY receipts.'
                }
              />
              <Button className="w-full" disabled>
                {title} unavailable
              </Button>
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-7">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>
                {liquidity
                  ? 'Your liquidity position'
                  : bridge
                    ? 'Available on Stellar'
                    : 'Your vault receipts'}
              </CardTitle>
              <CardDescription>Available actions for the selected USTRY series</CardDescription>
            </CardHeader>
            <CardContent>
              <EmptyState
                icon={Package}
                title={
                  liquidity
                    ? 'No USTRY LP deployment'
                    : bridge
                      ? 'Convert or deposit USTRY'
                      : 'No USTRY fixed-vault deployment'
                }
                body="Your USTRY receipt, PT and YT balances remain available on their respective pages."
                action={
                  <Button
                    variant="outline"
                    onClick={() => navigate(liquidity || bridge ? '/markets' : '/deposit')}
                  >
                    {liquidity || bridge ? 'Go to Markets' : 'Go to Deposit'}
                  </Button>
                }
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
