import { useCallback, useState } from 'react';

import { useProtocol } from '@/context/ProtocolContext';
import { useToast } from '@/context/ToastContext';
import type { ShareCard } from '@/lib/shareCard';
import type { WriteResult } from '@/lib/soroban';

/**
 * A card to offer once the write has landed. Pass the card itself when it is known up front, or a
 * function when it depends on the outcome (a redemption that may only part-fill has nothing to
 * post until it is known to have paid in full). Returning `null` offers nothing.
 */
export type ShareOffer = ShareCard | (() => ShareCard | null | Promise<ShareCard | null>);

/** Never lets a card stand between a confirmed transaction and its confirmation. */
const resolveShare = async (offer?: ShareOffer): Promise<ShareCard | undefined> => {
  if (!offer) return undefined;
  try {
    return (typeof offer === 'function' ? await offer() : offer) ?? undefined;
  } catch {
    return undefined;
  }
};

/** One leg of a multi-step transaction flow (e.g. the YT route's mint → sell PT). */
export type TxStep = {
  /** Short label for this leg, shown while it's pending (e.g. "Mint PT + YT"). */
  label: string;
  /** The contract write for this leg. */
  fn: () => Promise<WriteResult>;
};

/**
 * Run a contract write with the full UX lifecycle:
 *   pending toast → submit → success/error toast → refresh on-chain state.
 *
 * Returns `{ run, runSteps, busy }`. `run(label, fn)` shows "Confirm in wallet…", awaits
 * the write, then either reports the tx hash and refreshes the dashboard, or surfaces the
 * error. `runSteps` chains several writes under ONE toast (for routed flows that need >1 tx,
 * like buying YT = mint then sell the PT). Multiple panels share this so the behaviour is
 * identical everywhere.
 *
 * Both take an optional `share`: the card the success toast offers to post. Only deposits and
 * payouts pass one. An exit, a trustline or a harvest is not something anyone shares.
 */
export const useTxAction = () => {
  const { push, update } = useToast();
  const { refresh } = useProtocol();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (label: string, fn: () => Promise<WriteResult>, share?: ShareOffer): Promise<boolean> => {
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
          share: await resolveShare(share),
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

  /**
   * Run an ordered sequence of writes under a single toast. Each step prompts its own wallet
   * signature; the toast shows "Step k/n · <label>" while pending. Stops at the first failure
   * (a routed flow can leave intermediate state — e.g. minted PT not yet sold — so the error
   * message names which leg failed so the user can finish manually). Refreshes once at the end.
   */
  const runSteps = useCallback(
    async (title: string, steps: TxStep[], share?: ShareOffer): Promise<boolean> => {
      setBusy(true);
      const id = push({
        kind: 'pending',
        title,
        message: `Step 1/${steps.length} · ${steps[0]?.label ?? ''} — confirm in Freighter…`,
      });
      let lastHash = '';
      try {
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          update(id, {
            kind: 'pending',
            title,
            message: `Step ${i + 1}/${steps.length} · ${step.label} — confirm in Freighter…`,
          });
          const { hash } = await step.fn();
          lastHash = hash;
        }
        update(id, {
          kind: 'success',
          title: `${title} confirmed`,
          message: 'All steps are on-chain.',
          hash: lastHash,
          share: await resolveShare(share),
        });
        await refresh();
        return true;
      } catch (err) {
        update(id, {
          kind: 'error',
          title: `${title} failed`,
          message: err instanceof Error ? err.message : 'A step failed; see your wallet.',
        });
        // Refresh anyway — an earlier step may have landed (e.g. the mint), so the UI should
        // reflect the partial state rather than look unchanged.
        await refresh().catch(() => {});
        return false;
      } finally {
        setBusy(false);
      }
    },
    [push, update, refresh],
  );

  return { run, runSteps, busy };
};
