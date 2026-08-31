import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MoreHorizontal, X, ArrowUpRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { NETWORK } from '@/lib/config';
import { SITE_ORIGIN } from '@/lib/site';

import { NAV_ITEMS, NAV_GROUPS, type NavItem } from '../data';

/**
 * Mobile navigation, as a bottom tab bar.
 *
 * This used to be a 56px icon rail down the left edge — the desktop sidebar,
 * shrunk. That is a desktop pattern wearing a phone's clothes: it eats width on
 * the axis a phone has least of, and it puts the primary controls at the top of
 * a one-handed reach. A bottom bar is where a thumb already is, and it costs
 * height, which a scrolling page has plenty of.
 *
 * **Four tabs and a More sheet, not ten tabs.** There are ten sections; a bar
 * that tried to show them all would give each ~37px on a 375px screen, which is
 * below the 44px touch target everyone agrees on. So the four that carry the
 * product's own front door — overview, the fixed vault, the deposit flow, the
 * market — sit on the bar, and the rest live one tap away in a sheet that can
 * afford to label and group them properly.
 */

/** The sections that earn a permanent slot. Everything else is in the sheet. */
const PRIMARY_IDS = ['overview', 'vault', 'deposit', 'markets'] as const;

const isPrimary = (id: string) => (PRIMARY_IDS as readonly string[]).includes(id);

type TabProps = {
  item: NavItem;
  active: boolean;
  onClick: () => void;
};

/**
 * One tab. The target is the full 56px-tall cell rather than the glyph, so the
 * thing you can hit matches the thing you can see.
 */
const Tab = ({ item, active, onClick }: TabProps) => {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2',
        'transition-colors duration-200',
        active ? 'text-foreground' : 'text-subtle active:text-foreground',
      )}
    >
      {active && (
        <motion.span
          layoutId="bottomnav-active"
          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
          className="nav-pill absolute inset-x-1 inset-y-0.5 rounded-xl"
        />
      )}
      <Icon
        size={19}
        className={cn('relative shrink-0 transition-colors duration-200', active && 'text-brand-text')}
      />
      {/* 10px is small, but a label at any size beats an unlabelled glyph —
          icon-only bars are the classic "what does that one do" failure. */}
      <span className="relative w-full truncate text-center text-[10px] leading-none font-medium tracking-[-0.01em]">
        {item.label}
      </span>
    </button>
  );
};

type BottomNavProps = {
  activeNav: string;
  onNavChange: (id: string) => void;
  /** Whether the More sheet is open — lifted so the shell can lock scroll. */
  moreOpen: boolean;
  onMoreOpenChange: (open: boolean) => void;
};

const BottomNav = ({ activeNav, onNavChange, moreOpen, onMoreOpenChange }: BottomNavProps) => {
  const primary = PRIMARY_IDS.map((id) => NAV_ITEMS.find((n) => n.id === id)).filter(
    (n): n is NavItem => Boolean(n),
  );
  const overflow = NAV_ITEMS.filter((n) => !isPrimary(n.id));
  // The More button counts as selected whenever the section you are on lives
  // inside the sheet — otherwise the bar would show nothing selected and you
  // would have no idea where you are.
  const moreActive = !isPrimary(activeNav);
  const activeItem = NAV_ITEMS.find((n) => n.id === activeNav);

  // Escape closes the sheet, and the page behind it must not scroll while it is
  // open — a sheet you can scroll *past* reads as a broken modal.
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMoreOpenChange(false);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [moreOpen, onMoreOpenChange]);

  const go = (id: string) => {
    onNavChange(id);
    onMoreOpenChange(false);
  };

  return (
    <>
      {/* ------------------------------------------------------- More sheet */}
      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => onMoreOpenChange(false)}
              className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px] lg:hidden"
              aria-hidden="true"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="All sections"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              className={cn(
                'fixed inset-x-0 bottom-0 z-50 lg:hidden',
                'max-h-[82vh] overflow-y-auto rounded-t-2xl border-t border-border bg-canvas',
                'pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_40px_-12px_rgb(0_0_0_/_0.45)]',
              )}
            >
              {/* Grab handle — the affordance that says "this came up from the
                  bottom and goes back down", even though we close by tap. */}
              <div className="sticky top-0 z-10 flex flex-col bg-canvas">
                <div className="flex justify-center pt-2.5 pb-1">
                  <span className="h-1 w-9 rounded-full bg-border" aria-hidden="true" />
                </div>
                <div className="flex items-center justify-between px-4 pb-2">
                  <span className="font-display text-[15px] font-semibold tracking-[-0.02em]">
                    All sections
                  </span>
                  <button
                    type="button"
                    onClick={() => onMoreOpenChange(false)}
                    aria-label="Close"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-subtle transition-colors active:bg-accent active:text-foreground"
                  >
                    <X size={17} />
                  </button>
                </div>
              </div>

              <div className="px-4 pb-5">
                {NAV_GROUPS.map(({ id: groupId, label }) => {
                  const items = overflow.filter((n) => n.group === groupId);
                  if (!items.length) return null;
                  return (
                    <div key={groupId} className="mb-1">
                      {label && <span className="eyebrow mt-4 mb-1.5 block">{label}</span>}
                      <div className="grid grid-cols-2 gap-1.5">
                        {items.map((item) => {
                          const Icon = item.icon;
                          const active = activeNav === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => go(item.id)}
                              aria-current={active ? 'page' : undefined}
                              className={cn(
                                'flex min-h-[54px] items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors',
                                active
                                  ? 'border-border bg-surface text-foreground'
                                  : 'border-transparent bg-accent/40 text-muted-foreground active:bg-accent',
                              )}
                            >
                              <Icon
                                size={17}
                                className={cn('shrink-0', active ? 'text-brand-text' : 'text-subtle')}
                              />
                              <span className="truncate text-[13.5px] font-medium">{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* The rail's footer had to go somewhere: the live network and
                    the way back to the marketing site. */}
                <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
                  <span className="flex items-center gap-2">
                    <span className="pulse-dot" />
                    <span className="eyebrow text-muted-foreground">
                      Stellar <span className="text-foreground">{NETWORK.name}</span>
                    </span>
                  </span>
                  <a
                    href={SITE_ORIGIN}
                    className="flex items-center gap-1 text-xs font-medium text-subtle transition-colors active:text-foreground"
                  >
                    spield.live
                    <ArrowUpRight size={12} />
                  </a>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* --------------------------------------------------------- the bar */}
      {/* `fixed` rather than a flex row in the shell: the page scrolls under a
          bar that never moves, which is the whole point of the pattern. The
          shell pays for it with bottom padding on the scroll container. */}
      <nav
        aria-label="Primary"
        className={cn(
          'fixed inset-x-0 bottom-0 z-30 lg:hidden',
          'border-t border-border bg-canvas/90 backdrop-blur-xl',
          'pb-[env(safe-area-inset-bottom)]',
        )}
      >
        <div className="flex items-stretch gap-0.5 px-1.5 pt-1 pb-1">
          {primary.map((item) => (
            <Tab
              key={item.id}
              item={item}
              active={activeNav === item.id}
              onClick={() => go(item.id)}
            />
          ))}
          <button
            type="button"
            onClick={() => onMoreOpenChange(!moreOpen)}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            aria-current={moreActive ? 'page' : undefined}
            aria-label={moreActive && activeItem ? `More — ${activeItem.label}, current page` : 'More'}
            className={cn(
              'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2',
              'transition-colors duration-200',
              moreActive || moreOpen ? 'text-foreground' : 'text-subtle active:text-foreground',
            )}
          >
            {moreActive && !moreOpen && (
              <motion.span
                layoutId="bottomnav-active"
                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                className="nav-pill absolute inset-x-1 inset-y-0.5 rounded-xl"
              />
            )}
            <MoreHorizontal
              size={19}
              className={cn('relative shrink-0', (moreActive || moreOpen) && 'text-brand-text')}
            />
            <span className="relative w-full truncate text-center text-[10px] leading-none font-medium tracking-[-0.01em]">
              More
            </span>
          </button>
        </div>
      </nav>
    </>
  );
};

export default BottomNav;
