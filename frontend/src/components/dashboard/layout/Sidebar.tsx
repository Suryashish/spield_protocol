import { motion, AnimatePresence } from 'framer-motion';
import { ChevronsLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo.png';
import { NETWORK } from '@/lib/config';
import { SITE_ORIGIN } from '@/lib/site';

import { NAV_ITEMS, type NavItem } from '../data';

type SidebarItemProps = {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
};

const SidebarItem = ({ item, active, collapsed, onClick }: SidebarItemProps) => {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      className={cn(
        'group relative flex h-10 items-center rounded-lg text-sm font-medium transition-colors',
        collapsed ? 'w-10 justify-center' : 'w-full gap-3 px-3',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      )}
    >
      <Icon size={18} className="shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {active && (
        <motion.div
          layoutId="sidebar-active"
          className="absolute -left-2 h-5 w-1 rounded-r-full bg-primary"
        />
      )}
    </button>
  );
};

/** Compact icon-only nav button used by the always-visible mobile rail. */
const MobileNavItem = ({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) => {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      title={item.label}
      className={cn(
        'group relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      )}
    >
      <Icon size={16} className="shrink-0" />
      {active && (
        <span className="absolute -left-1.5 h-4 w-0.5 rounded-r-full bg-primary" />
      )}
    </button>
  );
};

/** The live "connected to Stellar <network>" badge shown in the sidebar footer. */
const NetworkBadge = ({ collapsed }: { collapsed: boolean }) => (
  <div
    title={`Connected to Stellar ${NETWORK.name}`}
    className={cn(
      'flex items-center rounded-lg bg-accent/40 text-xs font-medium text-muted-foreground',
      collapsed ? 'h-9 w-9 justify-center' : 'gap-2 px-3 py-2'
    )}
  >
    <span className="relative flex h-2 w-2 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
    {!collapsed && (
      <span className="truncate">
        Stellar <span className="font-semibold text-foreground">{NETWORK.name}</span>
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
      {/* Inline collapsible rail. Unchanged from the original layout. */}
      <motion.aside
        animate={{ width: collapsed ? 72 : 240 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="hidden shrink-0 flex-col border-r border-border bg-card lg:flex"
      >
        {/* Brand + collapse toggle */}
        <div
          className={cn(
            'flex h-16 items-center border-b border-border',
            collapsed ? 'justify-center px-2' : 'justify-between px-4'
          )}
        >
          {/* Brand → the marketing site, which is a different host now. A
              react-router <Link to="/"> would land on the app's own overview
              instead, so this is a plain cross-origin anchor. */}
          <a
            href={SITE_ORIGIN}
            title="Go to spield.live"
            className="flex items-center gap-2 overflow-hidden rounded-lg transition-opacity hover:opacity-80"
          >
            <img src={logo} alt="Logo" className="h-7 w-7 shrink-0 object-contain" />
            <AnimatePresence>
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="font-heading text-base font-semibold tracking-tight"
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
              className="text-muted-foreground hover:text-foreground"
            >
              <ChevronsLeft size={16} />
            </Button>
          )}
        </div>

        {/* Primary nav */}
        <nav className={cn('flex flex-1 flex-col gap-1 py-4', collapsed ? 'items-center px-2' : 'px-3')}>
          {collapsed && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onToggle(false)}
              className="mb-2 text-muted-foreground hover:text-foreground"
              title="Expand sidebar"
            >
              <ChevronsLeft size={16} className="rotate-180" />
            </Button>
          )}
          {NAV_ITEMS.map((item) => (
            <SidebarItem
              key={item.id}
              item={item}
              active={activeNav === item.id}
              collapsed={collapsed}
              onClick={() => onNavChange(item.id)}
            />
          ))}
        </nav>

        {/* Footer: live network badge */}
        <div
          className={cn(
            'flex flex-col gap-1 border-t border-border py-4',
            collapsed ? 'items-center px-2' : 'px-3'
          )}
        >
          <NetworkBadge collapsed={collapsed} />
        </div>
      </motion.aside>

      {/* -------------------------------------------------- mobile (< lg) */}
      {/* Same side rail as desktop, just smaller — always visible, icon-only so
          it takes minimal horizontal space on a phone. No drawer / hamburger. */}
      <aside className="flex w-14 shrink-0 flex-col border-r border-border bg-card lg:hidden">
        {/* Brand → the marketing site (cross-origin, as on desktop above) */}
        <div className="flex h-14 items-center justify-center border-b border-border px-2">
          <a href={SITE_ORIGIN} title="Go to spield.live" className="transition-opacity hover:opacity-80">
            <img src={logo} alt="Logo" className="h-6 w-6 shrink-0 object-contain" />
          </a>
        </div>

        {/* Primary nav */}
        <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto px-2 py-3">
          {NAV_ITEMS.map((item) => (
            <MobileNavItem
              key={item.id}
              item={item}
              active={activeNav === item.id}
              onClick={() => onNavChange(item.id)}
            />
          ))}
        </nav>

        {/* Footer: live network badge */}
        <div className="flex flex-col items-center gap-1 border-t border-border px-2 py-3">
          <NetworkBadge collapsed />
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
