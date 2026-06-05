import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

import { chartData, chartConfig } from '../data';

const RANGES = ['7D', '30D', 'ALL'];

const PerformanceChart = () => (
  <Card className="overflow-hidden rounded-xl border-border bg-card shadow-sm">
    <CardHeader className="p-5 pb-0">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold">Portfolio Performance</CardTitle>
          <CardDescription className="text-sm">TVL growth over the last 30 days</CardDescription>
        </div>
        <div className="flex items-center rounded-lg border border-border bg-muted/50 p-0.5">
          {RANGES.map((p, i) => (
            <button
              key={p}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-semibold transition-all',
                i === 1
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </CardHeader>
    <CardContent className="p-5 pt-3">
      <ChartContainer config={chartConfig} className="h-70 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorTvl" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.15} />
                <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              dy={10}
            />
            <YAxis hide />
            <Tooltip content={<ChartTooltipContent indicator="line" />} />
            <Area
              type="monotone"
              dataKey="tvl"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorTvl)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartContainer>
    </CardContent>
  </Card>
);

export default PerformanceChart;
