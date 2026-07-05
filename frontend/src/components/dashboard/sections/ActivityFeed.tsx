import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  Sparkles,
  Unlock,
  Combine,
  ArrowLeftRight,
  ExternalLink,
  History,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useWallet } from '@/context/WalletContext';
import { useProtocol } from '@/context/ProtocolContext';
import { getRecentActivity, type Activity, type ActivityKind } from '@/lib/events';
import { formatAmount } from '@/lib/soroban';
import { shortenAddress } from '@/lib/stellar';

const KIND_META: Record<
  ActivityKind,
  { label: string; icon: LucideIcon; positive: boolean }
> = {
  Mint: { label: 'Deposit', icon: ArrowDownToLine, positive: false },
  Claim: { label: 'Claim Yield', icon: Sparkles, positive: true },
  RedeemPt: { label: 'Redeem PT', icon: Unlock, positive: true },
  Combine: { label: 'Combine & Redeem', icon: Combine, positive: true },
  TransferPosition: { label: 'Transfer', icon: ArrowLeftRight, positive: false },
};

const ActivityFeed = () => {
  const { address, isConnected } = useWallet();
  // Re-fetch whenever the protocol refreshes (e.g. after a write).
  const { refreshing } = useProtocol();
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [mineOnly, setMineOnly] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getRecentActivity(30);
    setItems(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Legitimate data-fetch effect; loading state lives inside the async `load`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, refreshing]);

  const visible =
    mineOnly && isConnected && address ? items.filter((i) => i.user === address) : items;

  return (
    <Card className="overflow-hidden rounded-xl border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h3 className="text-base font-semibold">Activity</h3>
        <div className="flex items-center gap-1">
          {isConnected && (
            <div className="mr-1 flex items-center rounded-lg border border-border bg-muted/50 p-0.5 text-xs font-semibold">
              <button
                onClick={() => setMineOnly(true)}
                className={cn(
                  'rounded-md px-2.5 py-1 transition-all',
                  mineOnly ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
                )}
              >
                Mine
              </button>
              <button
                onClick={() => setMineOnly(false)}
                className={cn(
                  'rounded-md px-2.5 py-1 transition-all',
                  !mineOnly ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
                )}
              >
                All
              </button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 p-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/40" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/50 text-muted-foreground">
            <History size={20} />
          </div>
          <p className="text-sm font-semibold">No activity yet</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            {mineOnly && isConnected
              ? 'Your deposits, claims and redemptions will appear here.'
              : 'Protocol activity will appear here as users transact.'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {visible.map((item) => {
            const meta = KIND_META[item.kind];
            const Icon = meta.icon;
            return (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/50 text-muted-foreground">
                    <Icon size={15} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{meta.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      Position #{item.positionId} · {shortenAddress(item.user)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {item.amount > 0n && (
                    <span
                      className={cn(
                        'text-sm font-semibold tabular-nums',
                        meta.positive ? 'text-emerald-500' : 'text-foreground',
                      )}
                    >
                      {meta.positive ? '+' : ''}
                      {formatAmount(item.amount)} USDC
                    </span>
                  )}
                  <a
                    href={item.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    title="View on explorer"
                  >
                    <ExternalLink size={13} />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

export default ActivityFeed;
