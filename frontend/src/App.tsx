import { BrowserRouter as Router } from 'react-router-dom';
import { Analytics as VercelAnalytics } from '@vercel/analytics/react';
import DashboardApp from '@/pages/DashboardApp';
import GaPageviews from '@/components/Analytics';
import { ErrorBoundary } from '@/components/ErrorBoundary';

/**
 * The Spield dApp, served at app.spield.live.
 *
 * This build is the interactive application and nothing else. The marketing
 * landing page and the /learn|/glossary|/compare content hub used to live here
 * too, behind a lazy split that kept the heavy dApp chunk off the marketing
 * critical path; both now ship from the Next.js site at spield.live (see
 * ../frontendnew), so this bundle no longer has a lightweight route to protect.
 *
 * DashboardApp is therefore imported eagerly rather than lazily: with the app
 * as the only route, a lazy boundary at the root would just cost every visitor
 * an extra round trip before anything could render.
 */
function App() {
  return (
    <ErrorBoundary>
      <Router>
        <DashboardApp />
        {/* AFTER DashboardApp, and that ordering is load-bearing: sibling
            effects run in tree order, so this fires once DashboardPage's
            useSEO has already set document.title for the new route. Mounted
            first, every pageview would carry the PREVIOUS page's title. */}
        <GaPageviews />
      </Router>
      <VercelAnalytics />
    </ErrorBoundary>
  );
}

export default App;
