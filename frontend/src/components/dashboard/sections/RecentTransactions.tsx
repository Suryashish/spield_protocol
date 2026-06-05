import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { transactions } from '../data';

const RecentTransactions = () => (
  <Card className="overflow-hidden rounded-xl border-border bg-card shadow-sm">
    <div className="flex items-center justify-between border-b border-border p-4">
      <h3 className="text-base font-semibold">Recent Transactions</h3>
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        View All
      </Button>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2.5 font-semibold">Hash</th>
            <th className="px-4 py-2.5 font-semibold">Type</th>
            <th className="px-4 py-2.5 font-semibold">Amount</th>
            <th className="px-4 py-2.5 font-semibold">Status</th>
            <th className="px-4 py-2.5 text-right font-semibold">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {transactions.map((row) => (
            <tr key={row.id} className="transition-colors hover:bg-muted/50">
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.id}</td>
              <td className="px-4 py-3 text-sm font-medium">{row.type}</td>
              <td
                className={cn(
                  'px-4 py-3 text-sm font-semibold',
                  row.positive ? 'text-emerald-500' : 'text-foreground'
                )}
              >
                {row.amount}
              </td>
              <td className="px-4 py-3">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                    row.status === 'Confirmed'
                      ? 'bg-emerald-500/10 text-emerald-500'
                      : 'bg-amber-500/10 text-amber-500'
                  )}
                >
                  {row.status}
                </span>
              </td>
              <td className="px-4 py-3 text-right text-sm text-muted-foreground">{row.time}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Card>
);

export default RecentTransactions;
