import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LandingPage from '@/pages/LandingPage';
import DashboardPage from '@/pages/DashboardPage';
import { WalletProvider } from '@/context/WalletContext';
import { ProtocolProvider } from '@/context/ProtocolContext';
import { ToastProvider } from '@/context/ToastContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary>
      <WalletProvider>
        <ToastProvider>
          <ProtocolProvider>
            <Router>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
              </Routes>
            </Router>
          </ProtocolProvider>
        </ToastProvider>
      </WalletProvider>
    </ErrorBoundary>
  );
}

export default App;
