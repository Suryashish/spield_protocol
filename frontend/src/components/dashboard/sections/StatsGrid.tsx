import { TrendingUp, TrendingDown, type LucideIcon } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { STATS } from '../data';

type StatCardProps = {
  label: string;
  value: string;
  change?: string;
  isPositive?: boolean;
  icon: LucideIcon;
};

const StatCard = ({ label, value, change, isPositive = true, icon: Icon }: StatCardProps) => (
  <Card className="rounded-xl border-border bg-card shadow-sm">
    <CardContent className="p-4">
      <div className="flex items-start justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/50 text-muted-foreground">
          <Icon size={15} />
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-bold tracking-tight">{value}</span>
        {change && (
          <span
            className={cn(
              'flex items-center gap-0.5 text-xs font-semibold',
              isPositive ? 'text-emerald-500' : 'text-red-500'
            )}
          >
            {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {change}
          </span>
        )}
      </div>
    </CardContent>
  </Card>
);

const StatsGrid = () => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
    {STATS.map((stat) => (
      <StatCard key={stat.label} {...stat} />
    ))}
  </div>
);

export default StatsGrid;
