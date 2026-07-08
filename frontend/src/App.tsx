import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import LandingPage from '@/pages/LandingPage';
import DashboardPage from '@/pages/DashboardPage';
import {
  ArticlePage,
  ComparisonPage,
  CompareIndexPage,
  GlossaryIndexPage,
  GlossaryTermPage,
  LearnIndexPage,
} from '@/pages/LearnPages';
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

                  {/* Learn hub — runtime (SPA) rendering of the same content
                      model the prerenderer emits as static HTML. This makes the
                      pages work in dev/preview AND as a client-side fallback,
                      while crawlers get the prerendered static files in prod. */}
                  <Route path="/learn" element={<LearnIndexPage />} />
                  <Route path="/learn/:slug" element={<ArticlePage />} />
                  <Route path="/glossary" element={<GlossaryIndexPage />} />
                  <Route path="/glossary/:slug" element={<GlossaryTermPage />} />
                  <Route path="/compare" element={<CompareIndexPage />} />
                  <Route path="/compare/:slug" element={<ComparisonPage />} />

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
