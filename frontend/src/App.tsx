import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
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
                  <Route path="/dashboard" element={<DashboardPage />} />
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
