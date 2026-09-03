"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SunIcon, MoonIcon } from "@/components/icons";
import BrandMark from "@/components/BrandMark";
import WaitlistDialog from "@/components/WaitlistDialog";
import { SITE } from "@/lib/seo/site";

/**
 * Rooted paths, not bare fragments. The nav is on every page now, and
 * `#vault` from inside a guide points at an anchor that page does not
 * have; `/#vault` goes home and lands on it. From the landing page it is
 * still a same-document fragment jump, so nothing about that page's
 * behaviour changes.
 *
 * Liquidity / Solvency / Docs were placeholders pointing at `#`. The
 * three routes that replace them are real pages with real content, which
 * also gives the corpus an internal link from every page on the site —
 * the thing a Learn hub most needs and least often gets.
 */
const LINKS: Array<{ label: string; href: string }> = [
  { label: "Vault", href: "/#vault" },
  { label: "Market", href: "/#traders" },
  { label: "Learn", href: "/learn" },
  { label: "Glossary", href: "/glossary" },
  { label: "Compare", href: "/compare" },
];

export default function SiteNav() {
  const navRef = useRef<HTMLElement>(null);
  const gliderRef = useRef<HTMLSpanElement>(null);
  const visibleRef = useRef(false);
  /* The header is `fixed` with no background, so once the page scrolls, section
     content passes UNDER the logo and the buttons and collides with them — on a
     phone the vault section's "YOU DEPOSIT 10,000 USDC" was rendered unreadable
     by the wordmark sitting on top of it. A backdrop fixes that, but applying it
     always would put a bar across the hero, which is the one screen designed to
     be uninterrupted. So: transparent at the top, frosted once you leave it. */
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Escape closes the menu, and the page behind it must not scroll.
     Skipped while the waitlist dialog is up: it opens FROM this menu on a
     phone, and both effects restore `body.overflow` on cleanup — whichever
     unmounts second would win and unlock the page under the open dialog. */
  useEffect(() => {
    if (!menuOpen || waitlistOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [menuOpen, waitlistOpen]);

  /* --- the glider: appears where you enter, glides between links --- */
  const place = (link: HTMLElement) => {
    const g = gliderRef.current;
    if (!g) return;
    g.style.width = `${link.offsetWidth}px`;
    g.style.transform = `translateX(${link.offsetLeft}px)`;
  };

  const show = (e: React.SyntheticEvent<HTMLAnchorElement>) => {
    const g = gliderRef.current;
    if (!g) return;
    const link = e.currentTarget;
    if (!visibleRef.current) {
      /* snap silently to the entry link, then fade in — no fly-in from afar */
      g.style.transition = "none";
      place(link);
      void g.offsetWidth; /* commit the snap */
      g.style.transition = "";
    } else {
      place(link);
    }
    g.style.opacity = "1";
    visibleRef.current = true;
  };

  const hide = () => {
    const g = gliderRef.current;
    if (!g) return;
    g.style.opacity = "0";
    visibleRef.current = false;
  };

  const onBlurCapture = (e: React.FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hide();
  };

  const toggleTheme = () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("spield-theme", next);
    } catch {}
  };

  return (
    <header
      data-scrolled={scrolled || menuOpen ? "" : undefined}
      className="site-nav fixed inset-x-0 top-0 z-30 flex h-20 items-center justify-between px-[clamp(20px,4vw,48px)]"
    >
      <Link
        className="flex items-center gap-[10px] font-display text-[21px] font-bold tracking-[-0.02em]"
        href="/"
        aria-label="Spield home"
      >
        <BrandMark />
        Spield
      </Link>

      <nav
        ref={navRef}
        className="absolute left-1/2 hidden -translate-x-1/2 gap-[2px] rounded-full border border-line bg-surface/90 p-[5px] shadow-float backdrop-blur-[10px] min-[901px]:flex"
        aria-label="Primary"
        onPointerLeave={hide}
        onBlurCapture={onBlurCapture}
      >
        <span ref={gliderRef} className="nav-glider" aria-hidden="true" />
        {LINKS.map(({ label, href }) => (
          <Link
            key={label}
            href={href}
            onPointerEnter={show}
            onFocus={show}
            className="relative z-1 rounded-full px-[15px] py-2 text-[14.5px] font-medium text-muted transition-colors duration-250 hover:text-ink"
          >
            {label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-[10px]">
        {/* Below 901px the links pill above is `hidden`, which left Vault,
            Market, Learn, Glossary and Compare with no entry point at all on a
            phone. This is that entry point. */}
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-controls="site-menu"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          className="grid size-10 place-items-center rounded-full border border-line bg-surface/90 text-muted shadow-float-sm transition-all duration-200 hover:border-muted hover:text-ink min-[901px]:hidden"
        >
          <span className="menu-icon" data-open={menuOpen ? "" : undefined} aria-hidden="true">
            <span />
            <span />
          </span>
        </button>
        {/* Left of the theme toggle, as the quiet sibling of "Launch App".
            Desktop only — see `.wl-nav-btn`; below 901px it would push the
            two icon buttons and the CTA off a 390px screen, so the phone
            gets the row in the menu panel instead. */}
        <button
          type="button"
          onClick={() => setWaitlistOpen(true)}
          className="wl-nav-btn"
        >
          <span className="wl-nav-dot" aria-hidden="true" />
          Join waitlist
        </button>
        <button
          type="button"
          onClick={toggleTheme}
          className="grid size-10 place-items-center rounded-full border border-line bg-surface/90 text-muted shadow-float-sm transition-all duration-200 hover:-translate-y-px hover:border-muted hover:text-ink"
          aria-label="Toggle theme"
        >
          <SunIcon />
          <MoonIcon />
        </button>
        {/* The dApp is a different deployment on a different host, so this is
            a plain <a>, not next/link: there is no client route to prefetch
            and Link would only add a wasted prefetch attempt. */}
        <a
          className="rounded-full bg-ink px-5 py-[11px] text-[14.5px] font-medium text-canvas shadow-cta transition-all duration-200 hover:-translate-y-0.5 hover:opacity-[0.92] hover:shadow-cta-hover active:scale-[0.97]"
          href={SITE.appOrigin}
        >
          Launch App
        </a>
      </div>

      {/* Menu scrim + panel. Rendered inside the fixed header so it inherits its
          stacking context and can never end up behind a section. */}
      <button
        type="button"
        tabIndex={menuOpen ? 0 : -1}
        aria-label="Close menu"
        aria-hidden={!menuOpen}
        onClick={() => setMenuOpen(false)}
        data-open={menuOpen ? "" : undefined}
        className="site-menu-scrim fixed inset-0 top-20 z-0 cursor-default min-[901px]:hidden"
      />
      <div
        id="site-menu"
        data-open={menuOpen ? "" : undefined}
        aria-hidden={!menuOpen}
        className="site-menu absolute inset-x-[clamp(20px,4vw,48px)] top-[70px] z-10 overflow-hidden rounded-2xl border border-line p-2 shadow-float min-[901px]:hidden"
      >
        {LINKS.map(({ label, href }) => (
          <Link
            key={label}
            href={href}
            tabIndex={menuOpen ? 0 : -1}
            onClick={() => setMenuOpen(false)}
            className="flex min-h-[46px] items-center rounded-xl px-4 text-[15px] font-medium text-ink transition-colors duration-200 hover:bg-canvas active:bg-canvas"
          >
            {label}
          </Link>
        ))}
        <button
          type="button"
          tabIndex={menuOpen ? 0 : -1}
          onClick={() => {
            setMenuOpen(false);
            setWaitlistOpen(true);
          }}
          /* No dot here, unlike the desktop button: the five links above set a
             left edge, and a marker would push this label 16px off it. */
          className="flex min-h-[46px] w-full items-center rounded-xl px-4 text-left text-[15px] font-medium text-ink transition-colors duration-200 hover:bg-canvas active:bg-canvas"
        >
          Join waitlist
        </button>
      </div>

      <WaitlistDialog open={waitlistOpen} onClose={() => setWaitlistOpen(false)} />
    </header>
  );
}
