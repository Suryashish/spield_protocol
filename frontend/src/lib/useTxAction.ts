import { useCallback, useState } from 'react';

import { useProtocol } from '@/context/ProtocolContext';
import { useToast } from '@/context/ToastContext';
import type { WriteResult } from '@/lib/soroban';

/**
 * Run a contract write with the full UX lifecycle:
 *   pending toast → submit → success/error toast → refresh on-chain state.
 *
 * Returns `{ run, busy }`. `run(label, fn)` shows "Confirm in wallet…", awaits the
 * write, then either reports the tx hash and refreshes the dashboard, or surfaces
 * the error. Multiple panels share this so the behaviour is identical everywhere.
 */
export const useTxAction = () => {
  const { push, update } = useToast();
  const { refresh } = useProtocol();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (label: string, fn: () => Promise<WriteResult>): Promise<boolean> => {
      setBusy(true);
      const id = push({
        kind: 'pending',
        title: label,
        message: 'Confirm the transaction in Freighter…',
      });
      try {
        const { hash } = await fn();
        update(id, {
          kind: 'success',
          title: `${label} confirmed`,
          message: 'Your transaction is on-chain.',
          hash,
        });
        await refresh();
        return true;
      } catch (err) {
        update(id, {
          kind: 'error',
          title: `${label} failed`,
          message: err instanceof Error ? err.message : 'Something went wrong.',
        });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [push, update, refresh],
  );

  return { run, busy };
};
