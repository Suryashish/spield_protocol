import { motion, AnimatePresence } from 'framer-motion';
import { ChevronsLeft, ArrowUpRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { NETWORK } from '@/lib/config';
import { SITE_ORIGIN } from '@/lib/site';

import BrandMark from './BrandMark';
import { NAV_ITEMS, NAV_GROUPS, type NavItem } from '../data';

type SidebarItemProps = {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
};

/**
 * A nav row. The selected one wears a raised pill — surface, hairline and the
 * float shadow — rather than a flat grey fill, so it reads as the one item
 * standing off the rail. The pill itself is a shared-layout element, so
 * selecting another section slides it there instead of blinking.
 */
const SidebarItem = ({ item, active, collapsed, onClick }: SidebarItemProps) => {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-10 items-center rounded-lg text-[13.5px] font-medium transition-colors duration-200',
        collapsed ? 'w-10 justify-center' : 'w-full gap-3 px-3',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
          className="nav-pill absolute inset-0 rounded-lg"
        />
      )}
      {/* the wash for the rows you are only pointing at — under the pill, so
          the two never stack on the selected row */}
      {!active && (
        <span className="absolute inset-0 rounded-lg bg-accent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
      )}
      <Icon
        size={17}
        className={cn(
          'relative shrink-0 transition-colors duration-200',
          active ? 'text-brand-text' : 'text-subtle group-hover:text-muted-foreground',
        )}
      />
      {!collapsed && <span className="relative truncate">{item.label}</span>}
    </button>
  );
};

/** The live "connected to Stellar <network>" badge shown in the sidebar footer. */
const NetworkBadge = ({ collapsed }: { collapsed: boolean }) => (
  <div
    title={`Connected to Stellar ${NETWORK.name}`}
    className={cn(
      'flex items-center rounded-lg',
      collapsed ? 'h-9 w-9 justify-center' : 'gap-2.5 px-2.5 py-2',
    )}
  >
    <span className="pulse-dot" />
    {!collapsed && (
      <span className="eyebrow truncate text-muted-foreground">
        Stellar <span className="text-foreground">{NETWORK.name}</span>
      </span>
    )}
  </div>
);

type SidebarProps = {
  collapsed: boolean;
  onToggle: (collapsed: boolean) => void;
  activeNav: string;
  onNavChange: (id: string) => void;
};

const Sidebar = ({ collapsed, onToggle, activeNav, onNavChange }: SidebarProps) => {
  return (
    <>
      {/* ----------------------------------------------------- desktop (lg+) */}
      {/* Phones get `BottomNav` instead — see that file for why the old 56px
          left rail was the wrong shape for a phone. */}
      {/* Inline collapsible rail. It sits ON the canvas rather than on a card
          of its own — the page is one sheet with a hairline down it, which is
          the marketing site's grammar and one less box than before. */}
      <motion.aside
        animate={{ width: collapsed ? 72 : 236 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="hidden shrink-0 flex-col border-r border-border bg-canvas lg:flex"
      >
        {/* Brand + collapse toggle. The row is the header's height so the
            wordmark and the breadcrumb sit on one line across the seam. */}
        <div
          className={cn(
            'flex h-16 shrink-0 items-center',
            collapsed ? 'justify-center px-2' : 'justify-between pl-4 pr-3',
          )}
        >
          {/* Brand → the marketing site, which is a different host now. A
              react-router <Link to="/"> would land on the app's own overview
              instead, so this is a plain cross-origin anchor. */}
          <a
            href={SITE_ORIGIN}
            title="Go to spield.live"
            className="flex items-center gap-2.5 overflow-hidden rounded-lg transition-opacity duration-200 hover:opacity-70"
          >
            <BrandMark size={26} />
            <AnimatePresence>
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="font-display text-[19px] font-bold tracking-[-0.02em]"
                >
                  Spield
                </motion.span>
              )}
            </AnimatePresence>
          </a>
          {!collapsed && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onToggle(true)}
              title="Collapse sidebar"
              className="text-subtle hover:text-foreground"
            >
              <ChevronsLeft size={15} />
            </Button>
          )}
        </div>

        {/* Primary nav, in runs. Each run says what it is for; collapsed, the
            labels stand down and a hairline keeps the grouping. */}
        <nav
          className={cn(
            'flex flex-1 flex-col gap-0.5 overflow-y-auto pb-4',
            collapsed ? 'items-center px-2 pt-1' : 'px-3 pt-1',
          )}
        >
          {collapsed && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onToggle(false)}
              className="mb-2 text-subtle hover:text-foreground"
              title="Expand sidebar"
            >
              <ChevronsLeft size={15} className="rotate-180" />
            </Button>
          )}

          {NAV_GROUPS.map(({ id: groupId, label }) => {
            const items = NAV_ITEMS.filter((n) => n.group === groupId);
            if (!items.length) return null;
            return (
              <div key={groupId} className={cn('flex flex-col gap-0.5', collapsed && 'w-full items-center')}>
                {label &&
                  (collapsed ? (
                    <span className="my-2 h-px w-6 bg-border" aria-hidden="true" />
                  ) : (
                    <span className="eyebrow mt-5 mb-1.5 px-3">{label}</span>
                  ))}
                {items.map((item) => (
                  <SidebarItem
                    key={item.id}
                    item={item}
                    active={activeNav === item.id}
                    collapsed={collapsed}
                    onClick={() => onNavChange(item.id)}
                  />
                ))}
              </div>
            );
          })}
        </nav>

        {/* Footer: the live network badge, and the way back to the site */}
        <div
          className={cn(
            'flex shrink-0 flex-col gap-1 border-t border-border py-3',
            collapsed ? 'items-center px-2' : 'px-3',
          )}
        >
          <NetworkBadge collapsed={collapsed} />
          {!collapsed && (
            <a
              href={SITE_ORIGIN}
              className="group flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-subtle transition-colors duration-200 hover:text-foreground"
            >
              spield.live
              <ArrowUpRight
                size={12}
                className="transition-transform duration-200 group-hover:translate-x-px group-hover:-translate-y-px"
              />
            </a>
          )}
        </div>
      </motion.aside>

    </>
  );
};

export default Sidebar;
