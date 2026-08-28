import { useEffect, useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { ExternalLink, Loader2, Wallet, X } from 'lucide-react';

import { useWallet } from '@/context/WalletContext';
import { WALLETS, probeWallets, type InstallMap, type WalletId } from '@/lib/wallets';

/**
 * Wallet picker modal — lists every supported wallet and lets the user choose one.
 *
 * Each row has three states: still being probed, installed (connectable), or missing
 * (links to its install page). Rows resolve independently as their probe lands, so a
 * slow wallet never holds up the rest. Web wallets (Albedo) are always connectable.
 * Selecting a wallet delegates to `WalletContext.connect(id)`; the modal closes on
 * success.
 */
const WalletPicker = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { connect, connecting, error, walletId } = useWallet();
  // Keys absent from the map are still being probed — never assume either way.
  const [installed, setInstalled] = useState<InstallMap>({});
  // Which wallet the user just clicked, so only its row shows a spinner.
  const [pending, setPending] = useState<WalletId | null>(null);

  // Re-probe each time the modal opens — a user may have installed a wallet since.
  // `probeWallets` replays what the warm probe already found before re-checking, so
  // known wallets are correct on the opening frame instead of resolving after the
  // modal is up.
  useEffect(() => {
    if (!open) return;
    return probeWallets((id, isInstalled) =>
      setInstalled((prev) => (prev[id] === isInstalled ? prev : { ...prev, [id]: isInstalled })),
    );
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
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-stage/55 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content className="app-shell panel fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5 shadow-lift data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between">
            <div>
              <DialogPrimitive.Title className="font-display text-[16px] font-medium tracking-[-0.02em]">
                Connect a wallet
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[12.5px] text-muted-foreground">
                Choose a Stellar wallet to connect to Spield.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="-mr-1 -mt-1 grid size-7 place-items-center rounded-full text-subtle transition-colors duration-200 hover:bg-accent hover:text-foreground">
              <X size={16} />
            </DialogPrimitive.Close>
          </div>

          <div className="mt-4 space-y-1.5">
            {WALLETS.map((w) => {
              const state = installed[w.id];
              // Undetermined until this wallet's own probe reports back.
              const checking = !w.webBased && state === undefined;
              const busyHere = pending === w.id && connecting;
              // Extensions that aren't installed link out instead of connecting.
              const canConnect = w.webBased || state === true;

              if (!checking && !canConnect) {
                return (
                  <a
                    key={w.id}
                    href={w.installUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center justify-between well rounded-lg px-3 py-2.5 text-[13.5px] transition-colors duration-200 hover:border-line-strong"
                  >
                    <span className="flex items-center gap-2.5">
                      <Wallet size={16} className="text-subtle" />
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
                  disabled={connecting || checking}
                  onClick={() => handlePick(w.id)}
                  className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5 text-left text-[13.5px] shadow-float-sm transition-all duration-200 ease-vault hover:-translate-y-px hover:border-brand/40 disabled:pointer-events-none disabled:opacity-60"
                >
                  <span className="flex items-center gap-2.5">
                    <Wallet size={16} className={checking ? 'text-subtle' : 'text-brand-text'} />
                    <span className="font-medium">{w.name}</span>
                  </span>
                  {busyHere || checking ? (
                    <span className="flex items-center gap-1.5">
                      {checking && <span className="eyebrow">Checking</span>}
                      <Loader2 size={14} className="animate-spin text-muted-foreground" />
                    </span>
                  ) : (
                    <span className="eyebrow">{w.webBased ? 'Web' : 'Installed'}</span>
                  )}
                </button>
              );
            })}
          </div>

          {error && (
            <p className="mt-3 text-[12.5px] text-danger-text">{error}</p>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default WalletPicker;
