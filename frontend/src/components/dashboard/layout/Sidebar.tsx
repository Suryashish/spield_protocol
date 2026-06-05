import { motion, AnimatePresence } from 'framer-motion';
import { ChevronsLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo.png';

import { NAV_ITEMS, FOOTER_NAV_ITEMS, type NavItem } from '../data';

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

type SidebarProps = {
  collapsed: boolean;
  onToggle: (collapsed: boolean) => void;
  activeNav: string;
  onNavChange: (id: string) => void;
};

const Sidebar = ({ collapsed, onToggle, activeNav, onNavChange }: SidebarProps) => {
  return (
    <motion.aside
      animate={{ width: collapsed ? 72 : 240 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="flex shrink-0 flex-col border-r border-border bg-card"
    >
      {/* Brand + collapse toggle */}
      <div
        className={cn(
          'flex h-14 items-center border-b border-border',
          collapsed ? 'justify-center px-2' : 'justify-between px-4'
        )}
      >
        <div className="flex items-center gap-2 overflow-hidden">
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
        </div>
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

      {/* Footer nav */}
      <div
        className={cn(
          'flex flex-col gap-1 border-t border-border py-4',
          collapsed ? 'items-center px-2' : 'px-3'
        )}
      >
        {FOOTER_NAV_ITEMS.map((item) => (
          <SidebarItem
            key={item.id}
            item={item}
            active={activeNav === item.id}
            collapsed={collapsed}
            onClick={() => onNavChange(item.id)}
          />
        ))}
      </div>
    </motion.aside>
  );
};

export default Sidebar;
