import { X } from 'lucide-react';

import logo from '../assets/logo.png';

const COLUMNS = [
  {
    title: 'Protocol',
    links: ['How it works', 'PT / YT tokens', 'Yield AMM', 'Implied APY'],
  },
  {
    title: 'Build',
    links: ['Documentation', 'Contracts', 'Strategy adapters', 'Audits'],
  },
  {
    title: 'Community',
    links: ['Discord', 'X / Twitter', 'GitHub', 'Governance'],
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
            <div className="mt-5 flex items-center gap-3">
              <a
                href="#"
                className="grid place-items-center w-9 h-9 rounded-full liquid-chip text-white/60 hover:text-white transition-colors"
                aria-label="GitHub"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.28 1.15-.28 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" /><path d="M9 18c-4.51 2-5-2-7-2" /></svg>
              </a>
              <a
                href="#"
                className="grid place-items-center w-9 h-9 rounded-full liquid-chip text-white/60 hover:text-white transition-colors"
                aria-label="X"
              >
                <X size={16} strokeWidth={2.5} />
              </a>
            </div>
          </div>

          {/* link columns */}
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/70">
                {col.title}
              </div>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l}>
                    <a href="#" className="text-sm text-white/40 hover:text-white transition-colors">
                      {l}
                    </a>
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
