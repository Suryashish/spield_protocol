import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { useSeries } from '@/context/SeriesContext';
import { useWallet } from '@/context/WalletContext';
import UstryDashboard from '@/components/dashboard/ustry/UstryDashboard';
const BlendDashboardPage = lazy(() => import('./BlendDashboardPage'));
export default function DashboardPage() {
  const { activeSeries } = useSeries();
  const { address } = useWallet();
  const { pathname } = useLocation();
  // The bridge brings USDC to Stellar independently of the selected yield source or series.
  // Both sources use the existing bridge page, without USTRY product availability checks.
  return activeSeries.source === 'ustry' && pathname !== '/bridge' ? (
    <UstryDashboard key={`${activeSeries.id}:${address ?? 'disconnected'}`} />
  ) : (
    <Suspense
      fallback={
        <p className="p-6" role="status">
          Loading Blend…
        </p>
      }
    >
      <BlendDashboardPage key={activeSeries.id} />
    </Suspense>
  );
}
