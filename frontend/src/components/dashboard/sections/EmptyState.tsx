import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * "There is nothing here yet, and here is why."
 *
 * Seven panels grew their own version of this — same icon disc, same two lines,
 * seven different paddings and type sizes. One component now, so an empty
 * receipts list and an empty price chart are the same object.
 *
 * The copy is deliberately a cause, not an apology: on testnet most of these
 * read "the curve fills in as Blend's rate ticks up", which tells the user the
 * dashboard is working and what will change.
 */
const EmptyState = ({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) => (
  <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
    <div className="well grid size-11 place-items-center rounded-full text-subtle">
      <Icon size={18} />
    </div>
    <p className="mt-4 font-display text-[14px] font-medium tracking-[-0.01em]">{title}</p>
    {body && <p className="mt-1.5 max-w-[34ch] text-[12.5px] leading-relaxed text-muted-foreground">{body}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export default EmptyState;
