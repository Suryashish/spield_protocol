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
import EmptyState from './EmptyState';
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
  // `refreshing` flips true then false for one refresh, which used to run this
  // effect twice. A completed refresh has one new timestamp instead.
  const { lastUpdated } = useProtocol();
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
    if (!lastUpdated) return;
    // Legitimate data-fetch effect; loading state lives inside the async `load`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [lastUpdated, load]);

  const visible =
    mineOnly && isConnected && address ? items.filter((i) => i.user === address) : items;

  return (
    <Card className="overflow-hidden rounded-xl">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h3 className="font-display text-[15px] font-medium tracking-[-0.015em]">Activity</h3>
        <div className="flex items-center gap-1">
          {isConnected && (
            <div className="mr-1 flex items-center well rounded-lg p-0.5 text-[12px] font-medium">
              <button
                onClick={() => setMineOnly(true)}
                className={cn(
                  'rounded-md px-2.5 py-1 transition-all',
                  mineOnly ? 'border border-border bg-card text-foreground shadow-float-sm' : 'text-muted-foreground',
                )}
              >
                Mine
              </button>
              <button
                onClick={() => setMineOnly(false)}
                className={cn(
                  'rounded-md px-2.5 py-1 transition-all',
                  !mineOnly ? 'border border-border bg-card text-foreground shadow-float-sm' : 'text-muted-foreground',
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
            <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={History}
          title="No activity yet"
          body={
            mineOnly && isConnected
              ? 'Your deposits, claims and redemptions will appear here.'
              : 'Protocol activity will appear here as users transact.'
          }
        />
      ) : (
        <div className="divide-y divide-border">
          {visible.map((item) => {
            const meta = KIND_META[item.kind];
            const Icon = meta.icon;
            return (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-200 hover:bg-accent/60"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="well grid size-8 shrink-0 place-items-center rounded-lg text-subtle">
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
                        'num text-[13.5px] font-medium',
                        meta.positive ? 'text-brand-text' : 'text-foreground',
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
