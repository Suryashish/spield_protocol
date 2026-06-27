import { Link } from 'react-router-dom';

import logo from '@/assets/logo.png';

/** Footer link. `to` → react-router route, `href` → same-page anchor / external. */
type FooterLink = { label: string; to?: string; href?: string };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Protocol',
    links: [
      { label: 'Why Spield', href: '#features' },
      { label: 'How it works', href: '#how-it-works' },
      { label: 'Products', href: '#products' },
      { label: 'FAQ', href: '#faq' },
    ],
  },
  {
    title: 'App',
    links: [
      { label: 'Launch app', to: '/dashboard' },
      { label: 'Fixed Vault', to: '/dashboard?section=vault' },
      { label: 'Markets', to: '/dashboard?section=markets' },
      { label: 'Solvency', to: '/dashboard?section=solvency' },
    ],
  },
  {
    title: 'Community',
    links: [
      { label: 'Twitter / X', href: 'https://x.com/spield_' },
    ],
  },
];

const Footer = () => {
  return (
    <footer className="relative w-full px-5 sm:px-8 pt-16 pb-10">
      <div className="mx-auto max-w-6xl">
        <div className="hairline mb-12" />

        <div className="grid grid-cols-2 md:grid-cols-5 gap-10">
          {/* brand */}
          <div className="col-span-2">
            <div className="flex items-center gap-2.5">
              <img src={logo} alt="Spield" className="w-7 h-7 object-contain" />
              <span className="font-heading text-base font-semibold text-white">Spield</span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/40">
              The fixed-income layer for Stellar. Strip yield, lock rates, and trade time —
              all on real, on-chain backing.
            </p>
            <p className="mt-3 text-xs text-white/30">
              Questions?{' '}
              <a href="https://x.com/spield_" className="text-brand-primary/70 hover:text-brand-primary transition-colors">
                x.com/spield_
              </a>
            </p>
          </div>

          {/* link columns */}
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/70">
                {col.title}
              </div>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.to ? (
                      <Link
                        to={l.to}
                        className="text-sm text-white/40 hover:text-white transition-colors"
                      >
                        {l.label}
                      </Link>
                    ) : (
                      <a
                        href={l.href}
                        className="text-sm text-white/40 hover:text-white transition-colors"
                      >
                        {l.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="hairline my-10" />

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-white/30">© 2026 Spield Protocol. Built on Stellar &amp; Soroban.</p>
          <div className="flex items-center gap-5 text-xs text-white/30">
            <a href="#" className="hover:text-white/60 transition-colors">Terms</a>
            <a href="#" className="hover:text-white/60 transition-colors">Privacy</a>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-primary animate-pulse" />
              Testnet live
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
