// Installs the global `Buffer` the Allbridge/Solana bridge SDKs need. It's a
// side-effect import at the top of this module, so it runs before any provider
// below (which may pull in the bridge SDK) initializes.
import '@/lib/polyfills';

import { Routes, Route, Navigate, useParams } from 'react-router-dom';

import DashboardPage from '@/pages/DashboardPage';
import { WalletProvider } from '@/context/WalletContext';
import { ProtocolProvider } from '@/context/ProtocolContext';
import { ToastProvider } from '@/context/ToastContext';
import { ReownProvider } from '@/context/ReownContext';

/**
 * Redirects the legacy `/dashboard/*` URLs to their new root-level equivalents.
 *
 * The app used to be mounted under `/dashboard` on the marketing domain, so
 * `/dashboard/vault` is what old bookmarks, shared links, and any wallet-saved
 * deep links still point at. Now that the dashboard IS the site root on
 * app.spield.live, those paths are rewritten by dropping the prefix — with a
 * bare `/dashboard` landing on the overview.
 */
function LegacyDashboardRedirect() {
  const { '*': rest } = useParams();
  return <Navigate to={`/${rest || 'overview'}`} replace />;
}

/**
 * The interactive dApp — the entire app.spield.live surface.
 *
 * Every section is a top-level route: `/overview`, `/vault`, `/deposit`, and so
 * on, with `/` redirecting to the overview. The wallet/protocol/toast/reown
 * providers wrap the whole tree.
 *
 * Provider order matters: Reown → Wallet → Toast → Protocol (Protocol depends
 * on Wallet).
 */
export default function DashboardApp() {
  return (
    <ReownProvider>
      <WalletProvider>
        <ToastProvider>
          <ProtocolProvider>
            <Routes>
              <Route path="/" element={<Navigate to="/overview" replace />} />
              <Route path="/overview" element={<DashboardPage />} />
              <Route path="/vault" element={<DashboardPage />} />
              <Route path="/deposit" element={<DashboardPage />} />
              <Route path="/markets" element={<DashboardPage />} />
              <Route path="/liquidity" element={<DashboardPage />} />
              <Route path="/bridge" element={<DashboardPage />} />
              <Route path="/solvency" element={<DashboardPage />} />
              <Route path="/activity" element={<DashboardPage />} />

              {/* Legacy links from when the app lived at spield.live/dashboard. */}
              <Route path="/dashboard/*" element={<LegacyDashboardRedirect />} />

              {/* Anything else (including the marketing paths this build no
                  longer serves) falls back to the overview rather than a blank
                  screen — the SPA rewrite means unknown URLs reach React. */}
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Routes>
          </ProtocolProvider>
        </ToastProvider>
      </WalletProvider>
    </ReownProvider>
  );
}
