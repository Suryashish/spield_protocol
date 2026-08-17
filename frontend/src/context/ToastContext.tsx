import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, Loader2, XCircle, ExternalLink } from 'lucide-react';

import { explorerTx } from '@/lib/config';
import { cn } from '@/lib/utils';

type ToastKind = 'success' | 'error' | 'pending';

type Toast = {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  /** Optional tx hash → renders an explorer link. */
  hash?: string;
};

type ToastContextValue = {
  push: (t: Omit<Toast, 'id'>) => number;
  update: (id: number, patch: Partial<Omit<Toast, 'id'>>) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

let nextId = 1;

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // How long a terminal toast lingers before auto-dismissing. Success stays longer
  // so the confirmation is clearly seen and the explorer link is clickable; errors
  // clear sooner.
  const lifespan = (kind: ToastKind) => (kind === 'success' ? 9000 : 6000);

  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { ...t, id }]);
      // Auto-dismiss terminal toasts; pending ones stay until updated/dismissed.
      if (t.kind !== 'pending') {
        setTimeout(() => dismiss(id), lifespan(t.kind));
      }
      return id;
    },
    [dismiss],
  );

  const update = useCallback(
    (id: number, patch: Partial<Omit<Toast, 'id'>>) => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      if (patch.kind && patch.kind !== 'pending') {
        setTimeout(() => dismiss(id), lifespan(patch.kind));
      }
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push, update, dismiss }), [push, update, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

const ICONS: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 size={18} className="text-brand-text" />,
  error: <XCircle size={18} className="text-danger-text" />,
  pending: <Loader2 size={18} className="animate-spin text-brand-text" />,
};

/**
 * Prominent success card. A confirmed transaction is the moment that matters, so
 * it gets a larger, celebratory treatment — an animated check ring, a bold
 * "Transaction successful" headline, and a full-width "View transaction" button —
 * rather than the small inline notice used for pending/error states.
 */
const SuccessCard = ({ toast, onClose }: { toast: Toast; onClose: () => void }) => (
  <div
    className={cn(
      'panel pointer-events-auto relative overflow-hidden rounded-2xl border-brand/40 p-5 text-card-foreground shadow-lift',
      'animate-in slide-in-from-right-4 fade-in zoom-in-95 duration-300',
    )}
  >
    {/* Soft success glow */}
    <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-brand/15 to-transparent" />

    <button
      type="button"
      onClick={onClose}
      className="absolute right-3 top-3 text-muted-foreground transition-colors hover:text-foreground"
      aria-label="Dismiss"
    >
      <XCircle size={17} />
    </button>

    <div className="relative flex flex-col items-center text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand/15 ring-4 ring-brand/10">
        <CheckCircle2 size={30} className="animate-in zoom-in-50 duration-500 text-brand-text" />
      </div>
      <p className="font-display text-[16px] font-medium tracking-[-0.02em]">Transaction successful</p>
      <p className="mt-1 text-[13px] font-medium text-brand-text">{toast.title}</p>
      {toast.message && (
        <p className="mt-1 break-words text-xs text-muted-foreground">{toast.message}</p>
      )}
      {toast.hash && (
        <a
          href={explorerTx(toast.hash)}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-brand/30 bg-brand/10 px-4 py-2 text-[13.5px] font-medium text-brand-text transition-colors duration-200 hover:bg-brand/20"
        >
          View transaction <ExternalLink size={13} />
        </a>
      )}
    </div>
  </div>
);

const ToastCard = ({ toast, onClose }: { toast: Toast; onClose: () => void }) => {
  if (toast.kind === 'success') return <SuccessCard toast={toast} onClose={onClose} />;

  return (
    <div
      className={cn(
        'panel pointer-events-auto flex items-start gap-3 rounded-xl p-3.5 text-card-foreground shadow-lift',
        'animate-in slide-in-from-right-4 fade-in duration-200',
      )}
    >
      <div className="mt-0.5 shrink-0">{ICONS[toast.kind]}</div>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium">{toast.title}</p>
        {toast.message && (
          <p className="mt-0.5 break-words text-xs text-muted-foreground">{toast.message}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Dismiss"
      >
        <XCircle size={15} />
      </button>
    </div>
  );
};

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>.');
  }
  return ctx;
};
