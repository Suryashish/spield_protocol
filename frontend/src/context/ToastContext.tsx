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

  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { ...t, id }]);
      // Auto-dismiss terminal toasts; pending ones stay until updated/dismissed.
      if (t.kind !== 'pending') {
        setTimeout(() => dismiss(id), 6000);
      }
      return id;
    },
    [dismiss],
  );

  const update = useCallback(
    (id: number, patch: Partial<Omit<Toast, 'id'>>) => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      if (patch.kind && patch.kind !== 'pending') {
        setTimeout(() => dismiss(id), 6000);
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
  success: <CheckCircle2 size={18} className="text-emerald-500" />,
  error: <XCircle size={18} className="text-red-500" />,
  pending: <Loader2 size={18} className="animate-spin text-primary" />,
};

const ToastCard = ({ toast, onClose }: { toast: Toast; onClose: () => void }) => (
  <div
    className={cn(
      'dark pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 text-card-foreground shadow-lg',
      'animate-in slide-in-from-right-4 fade-in duration-200',
    )}
  >
    <div className="mt-0.5 shrink-0">{ICONS[toast.kind]}</div>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold">{toast.title}</p>
      {toast.message && (
        <p className="mt-0.5 break-words text-xs text-muted-foreground">{toast.message}</p>
      )}
      {toast.hash && (
        <a
          href={explorerTx(toast.hash)}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          View transaction <ExternalLink size={11} />
        </a>
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

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>.');
  }
  return ctx;
};
