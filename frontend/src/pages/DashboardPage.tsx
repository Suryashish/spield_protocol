import { lazy, Suspense, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSeries } from '@/context/SeriesContext';
import { useWallet } from '@/context/WalletContext';
import type { YieldSource } from '@/lib/series';
import UstryDashboard from '@/components/dashboard/ustry/UstryDashboard';
const BlendDashboardPage = lazy(() => import('./BlendDashboardPage'));
export default function DashboardPage() {
  const { activeSeries, selectSource } = useSeries();
  const { address } = useWallet();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // There is one Fixed-Rate Vault: the Blend USDC vault. Its panels read the active series for
  // contracts, maturity and status, so it always runs on a Blend series rather than rendering
  // Blend contracts under a USTRY header and dates.
  const vaultFromUstry = activeSeries.source === 'ustry' && pathname === '/vault';
  const last = useRef<{ path: string; source: YieldSource } | null>(null);
  useEffect(() => {
    const prev = last.current;
    last.current = { path: pathname, source: activeSeries.source };
    if (!vaultFromUstry) return;
    // Arriving at the vault with USTRY selected: open it on Blend. Choosing USTRY while already
    // on the vault: leave for the USTRY overview, or the first rule would switch straight back.
    if (!prev || prev.path !== pathname) selectSource('blend');
    else if (prev.source !== 'ustry') navigate('/overview');
  }, [pathname, activeSeries.source, vaultFromUstry, selectSource, navigate]);
  // The bridge brings USDC to Stellar independently of the selected yield source or series.
  // Both sources use the existing bridge page, without USTRY product availability checks.
  return activeSeries.source === 'ustry' && pathname !== '/bridge' && !vaultFromUstry ? (
    <UstryDashboard key={`${activeSeries.id}:${address ?? 'disconnected'}`} />
  ) : (
    <Suspense
      fallback={
        <p className="p-6" role="status">
          Loading Blend…
        </p>
      }
    >
      {vaultFromUstry ? (
        <p className="p-6" role="status">
          Opening the Fixed-Rate Vault…
        </p>
      ) : (
        <BlendDashboardPage key={activeSeries.id} />
      )}
    </Suspense>
  );
}
