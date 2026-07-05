import { useEffect, useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { ExternalLink, Loader2, Wallet, X } from 'lucide-react';

import { useWallet } from '@/context/WalletContext';
import { WALLETS, probeInstalled, type WalletId } from '@/lib/wallets';

/**
 * Wallet picker modal — lists every supported wallet and lets the user choose one.
 *
 * Installed extensions are connectable directly; missing ones link out to their
 * install page. Web wallets (Albedo) are always connectable. Selecting a wallet
 * delegates to `WalletContext.connect(id)`; the modal closes on success.
 */
const WalletPicker = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { connect, connecting, error, walletId } = useWallet();
  const [installed, setInstalled] = useState<Record<WalletId, boolean> | null>(null);
  // Which wallet the user just clicked, so only its row shows a spinner.
  const [pending, setPending] = useState<WalletId | null>(null);

  // Re-probe each time the modal opens — a user may have installed a wallet since.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setInstalled(null);
    probeInstalled().then((map) => active && setInstalled(map));
    return () => {
      active = false;
    };
  }, [open]);

  const handlePick = async (id: WalletId) => {
    setPending(id);
    await connect(id);
    setPending(null);
  };

  // Close the modal once a connection lands (address set ⇒ walletId set).
  useEffect(() => {
    if (open && walletId && !connecting) onOpenChange(false);
  }, [open, walletId, connecting, onOpenChange]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content className="app-shell fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold">
                Connect a wallet
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
                Choose a Stellar wallet to connect to Spield.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <X size={16} />
            </DialogPrimitive.Close>
          </div>

          <div className="mt-4 space-y-1.5">
            {WALLETS.map((w) => {
              const isInstalled = installed?.[w.id];
              const probing = installed === null;
              const busyHere = pending === w.id && connecting;
              // Extensions that aren't installed link out instead of connecting.
              const canConnect = w.webBased || isInstalled !== false;

              if (!canConnect) {
                return (
                  <a
                    key={w.id}
                    href={w.installUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm transition-colors hover:bg-accent"
                  >
                    <span className="flex items-center gap-2.5">
                      <Wallet size={16} className="text-muted-foreground" />
                      <span className="font-medium">{w.name}</span>
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      Install <ExternalLink size={12} />
                    </span>
                  </a>
                );
              }

              return (
                <button
                  key={w.id}
                  type="button"
                  disabled={connecting || probing}
                  onClick={() => handlePick(w.id)}
                  className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="flex items-center gap-2.5">
                    <Wallet size={16} className="text-primary" />
                    <span className="font-medium">{w.name}</span>
                  </span>
                  {busyHere ? (
                    <Loader2 size={14} className="animate-spin text-muted-foreground" />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {w.webBased ? 'Web' : 'Installed'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {error && (
            <p className="mt-3 text-xs text-destructive">{error}</p>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default WalletPicker;
