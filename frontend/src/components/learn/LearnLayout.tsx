import { useEffect } from 'react';
import { LEARN_CSS } from '@/content/learn-css';
// Small (64px, ~3.5KB) logo for the header/footer icon — keeps content pages
// light rather than loading the full-resolution brand logo.
import logo from '@/assets/logo-small.png';

/**
 * Shared chrome for every Learn-hub route. Injects the scoped Learn CSS once,
 * renders the header + footer, and wraps children in .lh-root so the styles
 * apply. This is the RUNTIME (SPA) counterpart to the prerendered static HTML —
 * both render from the same content model and share the same stylesheet, so
 * dev/preview/production look identical to what crawlers get.
 */

let injected = false;
function useLearnCss() {
  useEffect(() => {
    if (injected || document.getElementById('learn-hub-css')) {
      injected = true;
      return;
    }
    const style = document.createElement('style');
    style.id = 'learn-hub-css';
    style.textContent = LEARN_CSS;
    document.head.appendChild(style);
    injected = true;
  }, []);
}

function Header() {
  return (
    <header className="lh-header">
      <div className="lh-header-in">
        <a className="lh-brand" href="/">
          <img src={logo} alt="Spield" /> <span>Spield</span>
        </a>
        <nav className="lh-nav" aria-label="Learn navigation">
          <a className="lh-nav-link lh-nav-hide" href="/learn">
            Learn
          </a>
          <a className="lh-nav-link lh-nav-hide" href="/glossary">
            Glossary
          </a>
          <a className="lh-nav-link lh-nav-hide" href="/compare">
            Compare
          </a>
          <a className="lh-cta" href="/dashboard">
            Launch app
          </a>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="lh-footer">
      <div className="lh-footer-cols">
        <div>
          <div className="lh-footer-brand-row">
            <img src={logo} alt="" />
            <span>Spield</span>
          </div>
          <p className="lh-footer-sub">
            The fixed-income layer for Stellar. Split yield into tradable Principal Tokens (PT) and
            Yield Tokens (YT), or lock a fixed rate — on real, on-chain Blend yield.
          </p>
          <a className="lh-cta" href="/dashboard">
            Launch the app →
          </a>
        </div>
        <div>
          <h2>Start here</h2>
          <ul>
            <li><a href="/learn/how-to-earn-yield-on-stellar">How to earn yield on Stellar</a></li>
            <li><a href="/learn/fixed-income-on-stellar">Fixed income on Stellar</a></li>
            <li><a href="/learn/yield-tokenization">Yield tokenization</a></li>
            <li><a href="/learn/is-stellar-defi-safe">Is Stellar DeFi safe?</a></li>
          </ul>
        </div>
        <div>
          <h2>Explore</h2>
          <ul>
            <li><a href="/learn">All guides</a></li>
            <li><a href="/glossary">Glossary</a></li>
            <li><a href="/compare">Comparisons</a></li>
            <li><a href="https://x.com/spield_">X / Twitter</a></li>
            <li><a href="mailto:contact@spield.live">Contact</a></li>
          </ul>
        </div>
      </div>
      <p className="lh-copyright">
        © 2026 Spield Protocol. Built on Stellar &amp; Soroban. Educational content, not financial
        advice.
      </p>
    </footer>
  );
}

export function LearnLayout({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  useLearnCss();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  return (
    <div className="lh-root">
      <Header />
      {/* `has-aside` gates the two-column grid — the prerenderer (scripts/render-page.ts
          shellClass()) mirrors this exactly and prerender.mjs asserts they match. */}
      <div className={`lh-shell${aside ? ' has-aside' : ''}`}>
        {aside ? <aside className="lh-aside">{aside}</aside> : null}
        <main className="lh-main">{children}</main>
      </div>
      <Footer />
    </div>
  );
}
