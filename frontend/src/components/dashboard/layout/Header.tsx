import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Wallet, Copy, Check, LogOut, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useWallet } from '@/context/WalletContext';
import { shortenAddress } from '@/lib/stellar';
import { SITE_ORIGIN } from '@/lib/site';

import BrandMark from './BrandMark';
import ThemeToggle from './ThemeToggle';

/**
 * The wallet control. Both states are the same pill — hairline, surface, the
 * small float shadow — so connecting changes what the chrome SAYS rather than
 * rebuilding it, and the header never re-flows around it.
 */
const WalletMenu = () => {
  const { address, isConnected, connecting, error, disconnect, openWalletPicker } = useWallet();
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

  // Escape closes it too — a menu you can only dismiss with the mouse is a
  // menu a keyboard user is stuck inside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
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

  const pill =
    'inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-3.5 text-[13.5px] font-medium shadow-float-sm transition-all duration-200 ease-vault hover:-translate-y-px hover:border-line-strong disabled:pointer-events-none disabled:opacity-60';

  if (!isConnected) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button type="button" onClick={openWalletPicker} disabled={connecting} className={pill}>
          {connecting ? (
            <Loader2 size={14} className="animate-spin text-brand-text" />
          ) : (
            <Wallet size={14} className="text-subtle" />
          )}
          {connecting ? (
            'Connecting…'
          ) : (
            <span>
              Connect<span className="hidden min-[360px]:inline"> wallet</span>
            </span>
          )}
        </button>
        {error && (
          <span className="max-w-[16rem] text-right text-xs text-danger-text">{error}</span>
        )}
      </div>
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={pill}
      >
        <span className="pulse-dot" />
        <span className="mono text-[13px]">{shortenAddress(address ?? '')}</span>
        <ChevronDown
          size={13}
          className={cn('text-subtle transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="panel absolute right-0 top-11 z-30 w-60 origin-top-right overflow-hidden rounded-xl p-1.5 shadow-lift duration-150 animate-in fade-in-0 zoom-in-95"
        >
          <div className="px-2.5 py-2">
            <p className="eyebrow">Connected wallet</p>
            <p className="mono mt-1.5 text-xs break-all text-foreground">
              {shortenAddress(address ?? '', 8, 8)}
            </p>
          </div>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            onClick={handleCopy}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] transition-colors duration-150 hover:bg-accent"
          >
            {copied ? <Check size={14} className="text-brand-text" /> : <Copy size={14} className="text-subtle" />}
            {copied ? 'Copied' : 'Copy address'}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleDisconnect}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-danger-text transition-colors duration-150 hover:bg-danger/10"
          >
            <LogOut size={14} />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
};

type HeaderProps = {
  /** Current section label, shown in the breadcrumb (e.g. "Positions"). */
  section?: string;
};

const Header = ({ section = 'Overview' }: HeaderProps) => {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-canvas/85 px-4 backdrop-blur-xl lg:h-16 lg:px-6">
      {/* The trail is set in the app's micro-caption — mono, tracked, quiet —
          with only the leaf in ink. It says where you are without competing
          with the page heading two lines below it. */}
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2">
        {/* The brand used to live at the top of the mobile left rail. That rail
            is gone (phones navigate from the bottom now), so it moves here —
            otherwise a phone shows no mark and no way back to the site. */}
        <a
          href={SITE_ORIGIN}
          title="Go to spield.live"
          className="mr-1 flex shrink-0 items-center transition-opacity duration-200 active:opacity-70 lg:hidden"
        >
          <BrandMark size={22} />
        </a>
        <span className="eyebrow hidden sm:inline">Dashboard</span>
        <span className="hidden text-subtle sm:inline" aria-hidden="true">
          /
        </span>
        <span className="hidden truncate font-display text-sm font-medium tracking-[-0.01em] sm:inline">
          {section}
        </span>
      </nav>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <WalletMenu />
      </div>
    </header>
  );
};

export default Header;
