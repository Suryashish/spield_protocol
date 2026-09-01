import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { IS_MAINNET_DEMO, SR_CONTRACTS } from '@/lib/config';
import { useProtocol } from '@/context/ProtocolContext';

const fmt = (unix: number): string =>
  new Date(unix * 1000).toLocaleString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  });

/**
 * A permanent banner shown only when this build points at the throwaway demo series.
 *
 * A demo build is otherwise **indistinguishable** from the real app: same domain, same styling,
 * same real-mainnet USDC, real signatures, real fees. The only difference is which contracts it
 * talks to — and those expire 90 minutes after deployment, after which the series is abandoned.
 *
 * Somebody who wandered in and deposited would lose access to a normal product experience with no
 * warning, so the flag that swaps the addresses also has to say so on screen. Not a toast: a toast
 * is missed, dismissed, and gone on the next route.
 */
const DemoBanner = () => {
  const { maturity } = useProtocol();
  // `Date.now()` is impure, so it cannot be read during render. Ticking it into state also makes
  // the banner flip to "matured" on its own — on a 90-minute series that happens while someone is
  // still looking at the page.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  if (!IS_MAINNET_DEMO) return null;

  const expired = maturity != null && maturity * 1000 <= now;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-ember/30 bg-ember/10 px-4 py-2 text-[12.5px] text-ember-text sm:px-6 lg:px-8"
    >
      <AlertTriangle size={14} className="shrink-0" />
      <span className="font-semibold">Test series — not the live protocol.</span>
      <span className="text-muted-foreground">
        A throwaway 90-minute deployment on mainnet. It uses real USDC and the contracts are
        abandoned after maturity.{' '}
        {maturity != null &&
          (expired ? `Matured ${fmt(maturity)} — redeem only.` : `Matures ${fmt(maturity)}.`)}
      </span>
      {SR_CONTRACTS && (
        <code className="mono text-[11px] text-muted-foreground">
          vault {SR_CONTRACTS.vault.slice(0, 6)}…{SR_CONTRACTS.vault.slice(-4)}
        </code>
      )}
    </div>
  );
};

export default DemoBanner;
