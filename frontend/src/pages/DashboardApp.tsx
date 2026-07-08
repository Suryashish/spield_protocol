import { Routes, Route, Navigate } from 'react-router-dom';

import DashboardPage from '@/pages/DashboardPage';
import { WalletProvider } from '@/context/WalletContext';
import { ProtocolProvider } from '@/context/ProtocolContext';
import { ToastProvider } from '@/context/ToastContext';
import { ReownProvider } from '@/context/ReownContext';

/**
 * The interactive dApp, bundled as ONE lazy chunk.
 *
 * This is where all the heavy dependencies live — the Stellar SDK, ethers, the
 * Reown multi-chain wallet connector, Allbridge, and the charting stack. By
 * putting the wallet/protocol/toast/reown providers AND the dashboard routes
 * here (instead of at the app root), none of that code loads until a visitor
 * actually navigates to /dashboard. The marketing landing page and the /learn
 * hub therefore ship a tiny bundle and paint almost immediately — see App.tsx,
 * which React.lazy()-loads this module.
 *
 * The provider order matches the previous App.tsx tree exactly:
 * Reown → Wallet → Toast → Protocol (Protocol depends on Wallet).
 */
export default function DashboardApp() {
  return (
    <ReownProvider>
      <WalletProvider>
        <ToastProvider>
          <ProtocolProvider>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard/overview" replace />} />
              <Route path="/overview" element={<DashboardPage />} />
              <Route path="/vault" element={<DashboardPage />} />
              <Route path="/deposit" element={<DashboardPage />} />
              <Route path="/markets" element={<DashboardPage />} />
              <Route path="/liquidity" element={<DashboardPage />} />
              <Route path="/bridge" element={<DashboardPage />} />
              <Route path="/solvency" element={<DashboardPage />} />
              <Route path="/activity" element={<DashboardPage />} />
            </Routes>
          </ProtocolProvider>
        </ToastProvider>
      </WalletProvider>
    </ReownProvider>
  );
}
