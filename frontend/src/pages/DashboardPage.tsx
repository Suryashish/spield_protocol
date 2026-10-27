import { lazy, Suspense } from 'react';
import { useSeries } from '@/context/SeriesContext';
import { useWallet } from '@/context/WalletContext';
import UstryDashboard from '@/components/dashboard/ustry/UstryDashboard';
const BlendDashboardPage = lazy(() => import('./BlendDashboardPage'));
export default function DashboardPage() {
  const { activeSeries } = useSeries();
  const { address } = useWallet();
  return activeSeries.source === 'ustry' ? (
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
