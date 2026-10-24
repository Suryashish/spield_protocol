import * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export const TooltipPortal = TooltipPrimitive.Portal;

export const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-xs sm:max-w-sm rounded-xl border border-border/80 bg-card/95 px-3.5 py-2.5 text-xs text-foreground shadow-lift backdrop-blur-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 select-none pointer-events-none',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export const TooltipArrow = TooltipPrimitive.Arrow;

export interface InfoTooltipProps {
  /** The informational text or react node to show on hover */
  content: React.ReactNode;
  /** Optional title shown in bold above the content */
  title?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  className?: string;
  buttonClassName?: string;
  iconClassName?: string;
  size?: number;
  /** Accessible label for screen readers */
  ariaLabel?: string;
}

/**
 * InfoTooltip: An accessible (i) information icon that displays extra guidance
 * when hovered or focused, keeping the main interface clean and uncluttered.
 */
export const InfoTooltip = ({
  content,
  title,
  side = 'top',
  align = 'center',
  className,
  buttonClassName,
  iconClassName,
  size = 13,
  ariaLabel,
}: InfoTooltipProps) => {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'group inline-flex items-center justify-center rounded-full p-0.5 text-muted-foreground/75 transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-help',
              buttonClassName,
            )}
            aria-label={ariaLabel || (typeof content === 'string' ? content : 'More information')}
          >
            <Info
              size={size}
              className={cn(
                'shrink-0 text-muted-foreground/70 transition-colors duration-150 group-hover:text-foreground',
                iconClassName,
              )}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} align={align} className={className}>
          {title && (
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-foreground">
              <Info size={12} className="shrink-0 text-brand-text" />
              <span>{title}</span>
            </div>
          )}
          <div className="text-[12px] leading-relaxed text-muted-foreground">
            {content}
          </div>
          <TooltipPrimitive.Arrow className="fill-border/80" />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

