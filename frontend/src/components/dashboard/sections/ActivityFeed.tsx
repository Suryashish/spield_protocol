import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  Sparkles,
  Unlock,
  Combine,
  ArrowLeftRight,
  ExternalLink,
  History,
  Share2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Card } from '@/components/ui/card';
import EmptyState from './EmptyState';
import { cn } from '@/lib/utils';
import { useWallet } from '@/context/WalletContext';
import { useProtocol } from '@/context/ProtocolContext';
import { useShareCard } from '@/context/ShareCardContext';
import { useToast } from '@/context/ToastContext';
import { getRecentActivity, type Activity, type ActivityKind } from '@/lib/events';
import {
  addLiquidityCard,
  buyPtCard,
  buyYtCard,
  claimYieldCard,
  mintCard,
  redeemParCard,
  vaultLockCard,
  vaultRedeemCard,
  wrapCard,
  type ShareCard,
} from '@/lib/shareCard';
import { formatAmount } from '@/lib/soroban';
import { getVaultReceipt } from '@/lib/srstack';
import { shortenAddress } from '@/lib/stellar';

const KIND_META: Record<
  ActivityKind,
  { label: string; icon: LucideIcon; positive: boolean }
> = {
  // `positive` means "value came back to the user", which is what drives the row's colour. Money in
  // is not negative in any moral sense — it is just the other direction.
  Wrap: { label: 'Wrap USDC', icon: ArrowDownToLine, positive: false },
  Unwrap: { label: 'Unwrap to USDC', icon: Unlock, positive: true },
  Mint: { label: 'Split into PT + YT', icon: Combine, positive: false },
  RedeemPt: { label: 'Redeem at par', icon: Unlock, positive: true },
  Claim: { label: 'Claim Yield', icon: Sparkles, positive: true },
  Swap: { label: 'Trade PT', icon: ArrowLeftRight, positive: false },
  YtTrade: { label: 'Trade YT', icon: Sparkles, positive: false },
  AddLiquidity: { label: 'Add Liquidity', icon: ArrowDownToLine, positive: false },
  RemoveLiquidity: { label: 'Remove Liquidity', icon: Unlock, positive: true },
  VaultDeposit: { label: 'Fixed-Rate Deposit', icon: ArrowDownToLine, positive: false },
  VaultRedeem: { label: 'Fixed-Rate Payout', icon: Sparkles, positive: true },
};

/**
 * Rebuild the share card for a transaction that has already happened.
 *
 * The event recorded what was done. What it did not record — when the series matures, what a
 * since-closed receipt was opened with — is read here, when someone asks for the card, rather than
 * for every row on every refresh. `null` means that read did not come back, so there is nothing
 * the card could truthfully say.
 */
const cardFor = async (item: Activity, maturity: number | null): Promise<ShareCard | null> => {
  const s = item.share;
  if (!s) return null;
  // `0` is "the source did not say", and must fall back to the builders' own default.
  const at = item.at || undefined;
  switch (s.type) {
    case 'vaultLock':
      return maturity
        ? vaultLockCard({ principal: s.principal, payout: s.payout, rateBps: s.rateBps, maturity })
        : null;
    case 'vaultRedeem': {
      // The payout event carries the receipt's number and nothing else about it. A closed receipt
      // stays readable, so the principal and the rate it earned come from there.
      // Asked twice before giving up: it is a single call, and a public RPC drops the odd request.
      const receipt =
        (await getVaultReceipt(s.receiptId)) ?? (await getVaultReceipt(s.receiptId));
      return receipt ? vaultRedeemCard(receipt) : null;
    }
    case 'mint':
      return mintCard({ usdc: s.usdc, maturity });
    case 'buyPt':
      return maturity ? buyPtCard({ paid: s.paid, pt: s.pt, expiry: maturity, at }) : null;
    case 'buyYt':
      return maturity ? buyYtCard({ paid: s.paid, yt: s.yt, expiry: maturity }) : null;
    case 'claim':
      return claimYieldCard({ amount: s.amount, unit: s.unit, yt: 0n, at });
    case 'redeemPar':
      return redeemParCard({ pt: s.pt });
    case 'wrap':
      return wrapCard({ usdc: s.usdc, sr: s.sr, at });
    case 'addLiquidity':
      return addLiquidityCard({ pt: s.pt, usdc: s.usdc, maturity });
  }
};

const ActivityFeed = () => {
  const { address, isConnected } = useWallet();
  // `refreshing` flips true then false for one refresh, which used to run this
  // effect twice. A completed refresh has one new timestamp instead.
  const { lastUpdated, maturity } = useProtocol();
  const { share } = useShareCard();
  const { push } = useToast();
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

  const onShare = async (item: Activity) => {
    const card = await cardFor(item, maturity);
    if (card) {
      share(card);
      return;
    }
    push({
      kind: 'error',
      title: 'Could not build that card',
      message: 'Its details could not be read from the chain just now. Try again in a moment.',
    });
  };

  return (
    <Card className="gap-0 overflow-hidden rounded-xl py-0">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
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
        <div className="space-y-2 p-5">
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
                className="flex items-center justify-between gap-3 px-5 py-3.5 transition-colors duration-200 hover:bg-accent/60"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="well grid size-8 shrink-0 place-items-center rounded-lg text-subtle">
                    <Icon size={15} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{meta.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {shortenAddress(item.user)}
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
                  {/* Only on your own rows. The "All" view lists everyone, and a card is a
                      first-person statement: nobody should be handed one for a stranger's trade.
                      The slot is there on every row, filled or not, so the amounts stay in one
                      column instead of stepping sideways wherever a row has nothing to share. */}
                  <span className="grid size-[13px] place-items-center">
                    {item.share && item.user === address && (
                      <button
                        type="button"
                        onClick={() => void onShare(item)}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        title="Share this"
                        aria-label="Share this"
                      >
                        <Share2 size={13} />
                      </button>
                    )}
                  </span>
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
