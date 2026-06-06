import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PieChart as PieIcon } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useProtocol } from '@/context/ProtocolContext';
import { useWallet } from '@/context/WalletContext';
import { fromBaseUnits, formatUsd } from '@/lib/soroban';

/**
 * Portfolio composition — a real breakdown of the connected wallet's principal
 * across positions, with claimable yield stacked on top. Replaces the old mock
 * "TVL over 30 days" line chart with on-chain data we actually have.
 */
const PortfolioChart = () => {
  const { isConnected } = useWallet();
  const { positions, loading } = useProtocol();

  const data = positions.map((p) => ({
    name: `#${p.positionId}`,
    principal: fromBaseUnits(p.principal),
    yield: fromBaseUnits(p.claimableYield),
  }));

  const hasData = isConnected && data.length > 0;

  return (
    <Card className="overflow-hidden rounded-xl border-border bg-card shadow-sm">
      <CardHeader className="p-4 pb-0 sm:p-5">
        <CardTitle className="text-base font-semibold">Portfolio Composition</CardTitle>
        <CardDescription className="text-sm">
          Principal and claimable yield per position
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-3 sm:p-5">
        {loading ? (
          <div className="h-64 animate-pulse rounded-lg bg-muted/40" />
        ) : !hasData ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/50 text-muted-foreground">
              <PieIcon size={20} />
            </div>
            <p className="text-sm font-semibold">
              {isConnected ? 'No positions yet' : 'Connect your wallet'}
            </p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Your principal and yield breakdown appears here once you deposit.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={264}>
            <BarChart data={data} margin={{ top: 8, right: 0, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                dy={6}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                width={48}
                tickFormatter={(v) => `$${v}`}
              />
              <Tooltip
                cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
                contentStyle={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value, name) => {
                  const n = typeof value === 'number' ? value : Number(value) || 0;
                  return [
                    formatUsd(BigInt(Math.round(n * 1e7))),
                    name === 'principal' ? 'Principal' : 'Claimable yield',
                  ];
                }}
              />
              <Bar dataKey="principal" stackId="a" radius={[0, 0, 4, 4]}>
                {data.map((_, i) => (
                  <Cell key={i} fill="var(--primary)" />
                ))}
              </Bar>
              <Bar dataKey="yield" stackId="a" radius={[4, 4, 0, 0]}>
                {data.map((_, i) => (
                  <Cell key={i} fill="#10b981" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}

        {hasData && (
          <div className="mt-4 flex items-center gap-5 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-primary" /> Principal (PT)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Claimable yield (YT)
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PortfolioChart;
