"use client";

import { useRef } from "react";
import { SunIcon, MoonIcon } from "@/components/icons";
import BrandMark from "@/components/BrandMark";

const LINKS: Array<{ label: string; href: string }> = [
  { label: "Vault", href: "#" },
  { label: "Market", href: "#traders" },
  { label: "Liquidity", href: "#" },
  { label: "Solvency", href: "#" },
  { label: "Docs", href: "#" },
];

export default function SiteNav() {
  const navRef = useRef<HTMLElement>(null);
  const gliderRef = useRef<HTMLSpanElement>(null);
  const visibleRef = useRef(false);

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
    <header className="fixed inset-x-0 top-0 z-30 flex h-20 items-center justify-between px-[clamp(20px,4vw,48px)]">
      <a
        className="flex items-center gap-[10px] font-display text-[21px] font-bold tracking-[-0.02em]"
        href="#"
        aria-label="Spield home"
      >
        <BrandMark />
        Spield
      </a>

      <nav
        ref={navRef}
        className="absolute left-1/2 hidden -translate-x-1/2 gap-[2px] rounded-full border border-line bg-surface/90 p-[5px] shadow-float backdrop-blur-[10px] min-[901px]:flex"
        aria-label="Primary"
        onPointerLeave={hide}
        onBlurCapture={onBlurCapture}
      >
        <span ref={gliderRef} className="nav-glider" aria-hidden="true" />
        {LINKS.map(({ label, href }) => (
          <a
            key={label}
            href={href}
            onPointerEnter={show}
            onFocus={show}
            className="relative z-1 rounded-full px-[15px] py-2 text-[14.5px] font-medium text-muted transition-colors duration-250 hover:text-ink"
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="flex items-center gap-[10px]">
        <button
          type="button"
          onClick={toggleTheme}
          className="grid size-10 place-items-center rounded-full border border-line bg-surface/90 text-muted shadow-float-sm transition-all duration-200 hover:-translate-y-px hover:border-muted hover:text-ink"
          aria-label="Toggle theme"
        >
          <SunIcon />
          <MoonIcon />
        </button>
        <a
          className="rounded-full bg-ink px-5 py-[11px] text-[14.5px] font-medium text-canvas shadow-cta transition-all duration-200 hover:-translate-y-0.5 hover:opacity-[0.92] hover:shadow-cta-hover active:scale-[0.97]"
          href="#"
        >
          Launch App
        </a>
      </div>
    </header>
  );
}
