import { useEffect, useRef, useState } from 'react';
import { Search, ChevronDown, Wallet, Copy, Check, LogOut, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWallet } from '@/context/WalletContext';
import { shortenAddress } from '@/lib/stellar';

const WalletMenu = () => {
  const { address, isConnected, connecting, error, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the dropdown when clicking outside of it.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable; ignore */
    }
  };

  const handleDisconnect = async () => {
    setOpen(false);
    await disconnect();
  };

  if (!isConnected) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={connect}
          disabled={connecting}
          className="h-9 gap-2 border-input bg-card px-3 text-sm font-semibold shadow-none transition-all hover:bg-accent disabled:opacity-70"
        >
          {connecting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Wallet size={14} className="text-muted-foreground" />
          )}
          {connecting ? 'Connecting…' : 'Connect Wallet'}
        </Button>
        {error && (
          <span className="max-w-[16rem] text-right text-xs text-destructive">{error}</span>
        )}
      </div>
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="h-9 gap-2 border-input bg-card px-3 text-sm font-semibold shadow-none transition-all hover:bg-accent"
      >
        <div className="h-2 w-2 rounded-full bg-emerald-500" />
        {shortenAddress(address ?? '')}
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </Button>

      {open && (
        <div className="absolute right-0 top-11 z-30 w-56 overflow-hidden rounded-lg border border-border bg-card p-1 shadow-lg">
          <div className="px-3 py-2">
            <p className="text-xs text-muted-foreground">Connected wallet</p>
            <p className="mt-0.5 break-all font-mono text-xs">{shortenAddress(address ?? '', 6, 6)}</p>
          </div>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            onClick={handleCopy}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
          >
            {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy address'}
          </button>
          <button
            type="button"
            onClick={handleDisconnect}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
          >
            <LogOut size={14} />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
};

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
        <WalletMenu />
      </div>
    </header>
  );
};

export default Header;
