import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import LandingPage from '@/pages/LandingPage';
import {
  ArticlePage,
  ComparisonPage,
  CompareIndexPage,
  GlossaryIndexPage,
  GlossaryTermPage,
  LearnIndexPage,
} from '@/pages/LearnPages';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import AppSplash from '@/components/AppSplash';

// The dApp (dashboard + wallet/protocol/reown/toast providers + Stellar SDK,
// ethers, Reown, Allbridge, charts) is code-split into its own chunk and loaded
// ONLY when a visitor navigates to /dashboard. This keeps the marketing landing
// page and the /learn hub — which use none of that — on a tiny, fast bundle, so
// they paint almost immediately instead of waiting on the full dApp to download.
const DashboardApp = lazy(() => import('@/pages/DashboardApp'));

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <Routes>
          <Route path="/" element={<LandingPage />} />

          {/* Learn hub — runtime (SPA) rendering of the same content model the
              prerenderer emits as static HTML. This makes the pages work in
              dev/preview AND as a client-side fallback, while crawlers get the
              prerendered static files in prod. No wallet/protocol context here. */}
          <Route path="/learn" element={<LearnIndexPage />} />
          <Route path="/learn/:slug" element={<ArticlePage />} />
          <Route path="/glossary" element={<GlossaryIndexPage />} />
          <Route path="/glossary/:slug" element={<GlossaryTermPage />} />
          <Route path="/compare" element={<CompareIndexPage />} />
          <Route path="/compare/:slug" element={<ComparisonPage />} />

          {/* The interactive dApp, lazy-loaded. Its providers and heavy SDKs live
              inside DashboardApp so they never touch the landing/learn bundle. */}
          <Route
            path="/dashboard/*"
            element={
              <Suspense fallback={<AppSplash />}>
                <DashboardApp />
              </Suspense>
            }
          />
        </Routes>
      </Router>
      <Analytics />
    </ErrorBoundary>
  );
}

export default App;
