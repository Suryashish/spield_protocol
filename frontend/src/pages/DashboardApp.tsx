// Installs the global `Buffer` the Allbridge/Solana bridge SDKs need. It's a
// side-effect import at the top of this module, so it runs before any provider
// below (which may pull in the bridge SDK) initializes.
import '@/lib/polyfills';

import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';

import DashboardPage from '@/pages/DashboardPage';
import { WalletProvider } from '@/context/WalletContext';
import { ProtocolProvider } from '@/context/ProtocolContext';
import { ToastProvider } from '@/context/ToastContext';
import { ReownProvider } from '@/context/ReownContext';

/**
 * `<Navigate>` that carries the query string across.
 *
 * A bare `<Navigate to="/overview">` DROPS `location.search`, and that quietly
 * breaks GA4 cross-domain measurement. The marketing site appends a `_gl`
 * linker param to its "Launch app" links, and gtag.js on this host has to read
 * that param off the URL to stitch the arrival onto the same session. Our tag
 * is deferred to idle-or-first-interaction, so it always loads AFTER this
 * redirect has already run — if the redirect drops the param, the linker is
 * gone before anything can consume it, and the visit is recorded as a fresh
 * session self-referred from spield.live. Which is the exact problem
 * cross-domain measurement is configured to solve.
 *
 * Campaign params (`utm_*`) ride along for the same reason.
 */
function RedirectPreservingQuery({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={{ pathname: to, search }} replace />;
}

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
  return <RedirectPreservingQuery to={`/${rest || 'overview'}`} />;
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
              <Route path="/" element={<RedirectPreservingQuery to="/overview" />} />
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
              <Route path="*" element={<RedirectPreservingQuery to="/overview" />} />
            </Routes>
          </ProtocolProvider>
        </ToastProvider>
      </WalletProvider>
    </ReownProvider>
  );
}
