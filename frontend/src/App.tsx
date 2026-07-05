import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import LandingPage from '@/pages/LandingPage';
import DashboardPage from '@/pages/DashboardPage';
import { WalletProvider } from '@/context/WalletContext';
import { ProtocolProvider } from '@/context/ProtocolContext';
import { ToastProvider } from '@/context/ToastContext';
import { ReownProvider } from '@/context/ReownContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary>
      <ReownProvider>
        <WalletProvider>
          <ToastProvider>
            <ProtocolProvider>
              <Router>
                <Routes>
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/dashboard" element={<Navigate to="/dashboard/overview" replace />} />
                  <Route path="/dashboard/overview" element={<DashboardPage />} />
                  <Route path="/dashboard/vault" element={<DashboardPage />} />
                  <Route path="/dashboard/deposit" element={<DashboardPage />} />
                  <Route path="/dashboard/markets" element={<DashboardPage />} />
                  <Route path="/dashboard/liquidity" element={<DashboardPage />} />
                  <Route path="/dashboard/bridge" element={<DashboardPage />} />
                  <Route path="/dashboard/solvency" element={<DashboardPage />} />
                  <Route path="/dashboard/activity" element={<DashboardPage />} />
                </Routes>
              </Router>
              <Analytics />
            </ProtocolProvider>
          </ToastProvider>
        </WalletProvider>
      </ReownProvider>
    </ErrorBoundary>
  );
}

export default App;
