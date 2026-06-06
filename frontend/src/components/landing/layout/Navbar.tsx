import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Menu, X as Close } from 'lucide-react';
import { Link } from 'react-router-dom';

import logo from '@/assets/logo.png';

const NAV_ITEMS = [
  { label: 'Why Spield', href: '#features' },
  { label: 'Protocol', href: '#how-it-works' },
  { label: 'Products', href: '#products' },
  { label: 'FAQ', href: '#faq' },
];

const Navbar = () => {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState('#how-it-works');

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Scroll-spy: highlight the nav item whose section is in view.
  useEffect(() => {
    const sections = NAV_ITEMS.map((i) => document.querySelector(i.href)).filter(
      (el): el is Element => el !== null,
    );
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(`#${visible.target.id}`);
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: [0, 0.25, 0.5, 1] },
    );

    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 px-4 sm:px-6 flex justify-center pointer-events-none">
      <motion.nav
        initial={{ y: -24, opacity: 0 }}
        animate={{ y: scrolled ? 12 : 24, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className={`pointer-events-auto w-full transition-all duration-500 rounded-2xl liquid-glass ${
          scrolled ? 'max-w-4xl px-4 py-2.5' : 'max-w-5xl px-5 py-3'
        }`}
      >
        <div className="relative flex items-center justify-between gap-4">
          {/* Brand */}
          <a href="#top" className="group flex items-center gap-2.5 shrink-0">
            <div className="relative">
              <div className="absolute inset-0 bg-brand-primary blur-lg opacity-25 group-hover:opacity-50 transition-opacity" />
              <img src={logo} alt="Spield" className="relative w-7 h-7 object-contain" />
            </div>
            <span className="font-heading text-sm font-semibold tracking-tight text-white/90 hidden sm:block">
              Spield
            </span>
          </a>

          {/* Center links — each tab owns its own pill that cross-fades in/out
              (no position-sliding, so nothing "jumps" between tabs). */}
          <div className="hidden md:flex items-center gap-0.5 liquid-chip rounded-full px-1.5 py-1.5">
            {NAV_ITEMS.map((item) => {
              const isActive = active === item.href;
              return (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={() => setActive(item.href)}
                  className={`relative px-4 py-1.5 rounded-full text-[10px] tracking-[0.18em] font-semibold uppercase transition-colors duration-500 ${
                    isActive ? 'text-white' : 'text-white/45 hover:text-white/80'
                  }`}
                >
                  <span
                    className={`pointer-events-none absolute inset-0 rounded-full bg-white/[0.12] border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_2px_10px_rgba(0,255,204,0.18)] transition-opacity duration-500 ease-out ${
                      isActive ? 'opacity-100' : 'opacity-0'
                    }`}
                  >
                    {/* soft brand glow under the active pill */}
                    <span className="absolute -inset-1 rounded-full bg-brand-primary/20 blur-md -z-10" />
                  </span>
                  <span className="relative z-10">{item.label}</span>
                </a>
              );
            })}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2 shrink-0">
            <Link
              to="/dashboard"
              className="hidden sm:flex group items-center gap-2 liquid-chip rounded-full pl-4 pr-3 py-2 transition-all duration-300 hover:border-brand-primary/30"
            >
              <span className="text-[10px] font-bold tracking-[0.22em] text-white/90">LAUNCH APP</span>
              <ChevronRight
                size={13}
                strokeWidth={2.5}
                className="text-brand-primary transition-transform duration-300 group-hover:translate-x-0.5"
              />
            </Link>

            {/* Mobile toggle */}
            <button
              onClick={() => setOpen((v) => !v)}
              className="md:hidden grid place-items-center w-9 h-9 rounded-full liquid-chip text-white/80"
              aria-label="Toggle menu"
            >
              {open ? <Close size={16} /> : <Menu size={16} />}
            </button>
          </div>
        </div>

        {/* Mobile drawer */}
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="md:hidden overflow-hidden"
            >
              <div className="hairline my-3" />
              <div className="flex flex-col gap-1 pb-1">
                {NAV_ITEMS.map((item) => (
                  <a
                    key={item.label}
                    href={item.href}
                    onClick={() => {
                      setActive(item.href);
                      setOpen(false);
                    }}
                    className="px-3 py-2.5 rounded-xl text-xs tracking-[0.12em] uppercase font-semibold text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    {item.label}
                  </a>
                ))}
                <Link
                  to="/dashboard"
                  onClick={() => setOpen(false)}
                  className="mt-1 flex items-center justify-between px-3 py-2.5 rounded-xl liquid-chip text-xs font-bold tracking-[0.18em] text-white"
                >
                  LAUNCH APP
                  <ChevronRight size={14} className="text-brand-primary" />
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.nav>
    </header>
  );
};

export default Navbar;
