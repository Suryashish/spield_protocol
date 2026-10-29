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
  AlertTriangle,
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
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wallet,
  Wallet2,
  ExternalLink,
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
import UstryReceiptWrapper from './UstryReceiptWrapper';

type Props = { model: UstryDashboardModel };
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
export function UstryStats({
  model: m,
  kind = 'overview',
}: Props & { kind?: 'overview' | 'deposit' | 'liquidity' | 'vault' }) {
  const { data, address, loading, activeSeries, claimable } = m;
  const days = Math.max(0, Math.ceil((activeSeries.expiry - m.clock / 1000) / 86400));
  const shown = (value?: bigint) => (address && data && value !== undefined ? units(value) : '—');
  const walletBalances = m.usdcBalances.address === address ? m.usdcBalances : null;
  const usdcValue = address && walletBalances?.gatal !== null && walletBalances?.gatal !== undefined
    ? units(walletBalances.gatal)
    : '—';
  const usdcSub = !address
    ? 'Connect your wallet'
    : walletBalances?.circle !== null && walletBalances?.circle !== undefined
      ? `GATAL test USDC · Circle: ${units(walletBalances.circle)} USDC`
      : 'GATAL test USDC · Circle balance unavailable';
  if (kind === 'liquidity' || kind === 'vault')
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="USDC Balance"
          value={usdcValue}
          sub={usdcSub}
          icon={Wallet2}
          loading={loading && !!address && walletBalances?.gatal == null}
          info="GATAL and Circle test USDC are different Stellar assets. The main figure shows GATAL; the note shows Circle."
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
        label="USDC Balance"
        value={usdcValue}
        sub={usdcSub}
        icon={Wallet2}
        tone={kind === 'deposit' ? 'default' : 'usdc'}
        loading={loading && !!address && walletBalances?.gatal == null}
        info="GATAL and Circle test USDC are different Stellar assets. The main figure shows GATAL; the note shows Circle."
      />
      <StatTile
        label={kind === 'deposit' ? 'PT Held' : 'Principal Face'}
        value={shown(data?.holding.pt)}
        sub="USD face · payout in USTRY"
        icon={Layers}
        loading={loading && !data}
        info="PT face is denominated in USD. It does not guarantee a dollar payout when USTRY NAV falls."
      />
      <StatTile
        label={kind === 'deposit' ? 'YT Held' : 'Claimable Yield'}
        value={shown(kind === 'deposit' ? data?.holding.yt : claimable)}
        sub={kind === 'deposit' ? 'Earns the variable rate' : 'USTRY · ready to claim'}
        icon={kind === 'deposit' ? Sparkles : TrendingUp}
        tone={kind !== 'deposit' && claimable > 0n ? 'positive' : 'default'}
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
                Live USTRY custody vs. token obligations, read on-chain. Measured in USTRY, not
                dollars.
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
          {(
            [
              ['Backing', d ? units(d.custody) : '—', 'USTRY held by the series.', true, undefined],
              [
                'Obligations',
                d ? units(owed) : '—',
                'Unsplit receipts plus PT/YT token allocations, in USTRY.',
                false,
                covered ? 'bg-brand' : 'bg-danger',
              ],
              [
                'Surplus',
                d ? `+${units(surplus)}` : '—',
                'Unallocated USTRY, including rounding; not a promised yield payout.',
                true,
                'bg-brand/30',
              ],
            ] as const
          ).map(([label, value, info, positive, dot]) => (
            <div key={label} className="min-w-0 well rounded-lg p-2 @md:p-3">
              <div className="flex items-center justify-between gap-1">
                <p className="flex items-center gap-1 eyebrow @md:gap-1.5">
                  {dot && <span className={cn('h-2 w-2 shrink-0 rounded-sm', dot)} />}
                  <span className="truncate">{label}</span>
                </p>
                <InfoTooltip content={info} size={11} />
              </div>
              <p
                className={cn(
                  'num mt-1 truncate font-display text-[15px] leading-tight font-medium tracking-[-0.015em] sm:text-[17px]',
                  positive && 'text-brand-text',
                )}
                title={`${value} USTRY`}
              >
                {value}
              </p>
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
            View series contract <ExternalLink size={11} />
          </a>
        </div>
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
/** PositionsPanel's dashed frame for an empty slot. */
function EmptySlot(props: React.ComponentProps<typeof EmptyState>) {
  return (
    <div className="flex flex-1 flex-col justify-center rounded-xl border border-dashed border-border">
      <EmptyState {...props} />
    </div>
  );
}
/** Same shell as the Blend PositionsPanel: ruled header, refresh, scrollable body. */
export function UstryPositions({ model: m, receipt = false }: Props & { receipt?: boolean }) {
  const d = m.data;
  const hasPosition =
    !!d && (d.holding.pt > 0n || d.holding.yt > 0n || d.holding.receipt > 0n || m.claimable > 0n);
  return (
    <Card className="flex h-full flex-col gap-0 overflow-hidden rounded-xl py-0">
      <div className="flex items-start justify-between border-b border-border px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-[15px] font-medium tracking-[-0.015em]">
              {receipt ? 'Your Receipt Position' : 'Your Positions'}
            </h3>
            <InfoTooltip
              title={receipt ? 'sUSTRY receipts' : 'PT / YT positions'}
              content="PT and YT are measured in USD face; sUSTRY receipts are measured in USTRY units. Payouts are in USTRY, whose NAV can fall."
            />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {receipt
              ? 'Unsplit receipts and PT/YT balances for this series.'
              : 'Manage your tranches — claim yield, combine, or transfer.'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void m.refresh()}
          disabled={m.loading || m.busy}
          className="-mr-1 shrink-0 text-muted-foreground hover:text-foreground"
          title="Refresh"
        >
          <RefreshCw size={14} className={cn(m.loading && 'animate-spin')} />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto p-5 lg:max-h-128">
        {!m.address ? (
          <EmptySlot
            icon={Coins}
            title="Connect your wallet"
            body="Connect your wallet to view and manage your PT/YT and sUSTRY balances."
          />
        ) : m.loading && !d ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : !hasPosition ? (
          <EmptySlot
            icon={Layers}
            title="No open positions"
            body={
              receipt
                ? 'Wrap USDC to receive your first sUSTRY receipt.'
                : 'Deposit USDC to mint your first PT + YT position.'
            }
          />
        ) : (
          <div className="well rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="well grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground">
                <Layers size={16} />
              </div>
              <div>
                <p className="text-[13.5px] font-medium">Your {m.activeSeries.name} position</p>
                <p className="text-xs text-muted-foreground">Matures {date(m.activeSeries.expiry)}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              {(
                [
                  ['PT', 'text-brand-text', d!.holding.pt],
                  ['YT', 'text-ember-text', d!.holding.yt],
                  ['sUSTRY', 'text-brand-text', d!.holding.receipt],
                ] as const
              ).map(([symbol, tone, value]) => (
                <div key={symbol} className="rounded-lg border border-border bg-card py-2.5">
                  <p className={cn('text-xs font-semibold', tone)}>{symbol}</p>
                  <p className="num mt-1 text-[14px] font-medium">{units(value)}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              <Pair label="PT principal allocation">
                {units((d!.holding.pt * d!.state.factor) / FACTOR_SCALE)} USTRY
              </Pair>
              <Pair label="Claimable yield">{units(m.claimable)} USTRY</Pair>
            </div>
          </div>
        )}
        <UstryTransfer model={m} />
      </div>
    </Card>
  );
}
export function UstryDeposit({ model }: Props) {
  return (
    <div className="space-y-6">
      <UstryStats model={model} kind="deposit" />
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5" data-tour="deposit-panel">
          <UstryReceiptWrapper model={model} product="ptyt" />
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
        <UstryReceiptWrapper model={model} />
      </div>
      <div className="lg:col-span-7">
        <UstryPositions model={model} receipt />
      </div>
    </div>
  );
}
/** SrYieldPanel's row: label, tooltip and hint on the left, figure on the right. */
function YieldRow({ label, value, hint, info }: { label: string; value: string; hint: string; info: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-2 last:border-b-0">
      <div>
        <div className="flex items-center gap-1.5 text-sm">
          <span>{label}</span>
          <InfoTooltip content={info} size={12} />
        </div>
        <div className="text-[11px] text-muted-foreground">{hint}</div>
      </div>
      <div className="shrink-0 font-medium tabular-nums">{value}</div>
    </div>
  );
}
export function UstryYield({ model: m }: Props) {
  const d = m.data;
  const rows = [
    [
      'Claimable now',
      `${m.address && d ? units(m.claimable) : '0'} USTRY`,
      'paid without burning YT',
      'Earned USTRY claimable now. Claiming does not burn or reduce your YT tokens.',
    ],
    [
      'YT face held',
      `${m.address && d ? units(d.holding.yt) : '0'} YT`,
      'the notional earning yield for you',
      'USD face of YT earning USTRY yield for your wallet.',
    ],
    [
      'High-water NAV',
      d ? `$${units(d.state.high_water, 8)}` : '—',
      'new yield accrues above this level',
      'YT earns only when USTRY NAV rises above its previous high. A recovery below it earns nothing new.',
    ],
    [
      'Accruing until',
      m.matured ? 'matured' : `${Math.max(0, Math.ceil((m.activeSeries.expiry - m.clock / 1000) / 86400))} days`,
      m.matured ? 'this series has matured' : 'maturity',
      m.matured
        ? 'This series has matured. Accrued yield remains claimable with no deadline.'
        : 'Yield continues to accrue until the series reaches maturity.',
    ],
  ] as const;
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
            {rows.map(([label, value, hint, info]) => (
              <YieldRow key={label} label={label} value={value} hint={hint} info={info} />
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
            {!m.address ? (
              <Wallet className="mr-2 h-4 w-4" aria-hidden />
            ) : m.busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Coins className="mr-2 h-4 w-4" />
            )}
            {!m.address
              ? 'Connect wallet'
              : !m.onCorrectNetwork
                ? 'Switch your wallet network'
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
  const risks: [LucideIcon, string, string, 'high' | 'medium'][] = [
    [
      ShieldAlert,
      'NAV can fall',
      'Token coverage does not guarantee USD principal. PT and yield payouts remain in USTRY.',
      'high',
    ],
    [
      TrendingUp,
      'Prices depend on the NAV relay',
      'Priced actions stop when observations are stale. Missing maturity history can delay settlement.',
      'medium',
    ],
    [
      Lock,
      'Issuer controls apply',
      'USTRY issuer freezes or clawbacks can prevent token transfers and withdrawals.',
      'high',
    ],
    [
      Coins,
      'Cash exits depend on liquidity',
      'USDC conversion uses executable exchange quotes. Fiat redemption is operated through Spield’s registered Etherfuse account.',
      'medium',
    ],
  ];
  return (
    <div className="space-y-6" data-tour="solvency-panel">
      <UstrySolvencyCard model={m} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
            Risks you are taking
          </CardTitle>
          <CardDescription>
            The honest version. Read this before depositing — not after.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Lock className="h-3.5 w-3.5" aria-hidden />
              Deposit cap
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Cap</div>
                <div className="tabular-nums">{m.c.capUstry} USTRY</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Backing</div>
                <div className="tabular-nums">{d ? units(d.custody) : '—'} USTRY</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Matures</div>
                <div className="tabular-nums">{date(m.activeSeries.expiry)}</div>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              The cap is enforced on chain and gates deposits only — it can never block a withdrawal.
            </p>
          </div>
          <ul className="space-y-3">
            {risks.map(([Icon, title, body, severity]) => (
              <li key={title} className="flex gap-3">
                <Icon
                  className={
                    severity === 'high'
                      ? 'mt-0.5 h-4 w-4 shrink-0 text-destructive'
                      : 'mt-0.5 h-4 w-4 shrink-0 text-amber-500'
                  }
                  aria-hidden
                />
                <div>
                  <div className="text-sm font-medium">{title}</div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Series configuration</CardTitle>
          <CardDescription>USTRY Series · Etherfuse sandbox · Stellar testnet</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
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
    <Card className="gap-0 overflow-hidden rounded-xl py-0">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h3 className="font-display text-[15px] font-medium tracking-[-0.015em]">Activity</h3>
      </div>
      {!m.address || !m.activity.length ? (
        <EmptyState
          icon={History}
          title={m.address ? 'No activity yet' : 'Connect your wallet'}
          body="Your confirmed deposits, claims, transfers and redemptions on this device appear here."
        />
      ) : (
        <div className="divide-y divide-border">
          {m.activity.map((a) => (
            <div
              key={a.hash}
              className="flex items-center justify-between gap-3 px-5 py-3.5 transition-colors duration-200 hover:bg-accent/60"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="well grid size-8 shrink-0 place-items-center rounded-lg text-subtle">
                  <CheckCircle2 size={15} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {new Date(a.time).toLocaleString()}
                  </p>
                </div>
              </div>
              <a
                href={explorerTx(a.hash)}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground transition-colors hover:text-foreground"
                title="View on explorer"
              >
                <ExternalLink size={13} />
              </a>
            </div>
          ))}
        </div>
      )}
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
