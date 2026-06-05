import { Search, ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const Header = () => {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-card/50 px-6 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="text-muted-foreground">Dashboard</span>
        <span className="text-muted-foreground">/</span>
        <span className="font-semibold">Portfolio</span>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative hidden w-64 sm:block">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search..."
            className="h-9 border-input bg-muted/50 pl-9 text-sm shadow-none focus-visible:ring-1"
          />
        </div>
        <div className="mx-1 h-5 w-px bg-border" />
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2 border-input bg-card px-3 text-sm font-semibold shadow-none transition-all hover:bg-accent"
        >
          <div className="h-2 w-2 rounded-full bg-emerald-500" />
          0x4F...3a92
          <ChevronDown size={14} className="text-muted-foreground" />
        </Button>
      </div>
    </header>
  );
};

export default Header;
