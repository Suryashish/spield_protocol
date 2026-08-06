"use client";

import { useInView } from "@/lib/useInView";
import { ArrowRight } from "@/components/icons";
import BrandMark from "@/components/BrandMark";

/**
 * The closing plate: the directory, then SPIELD cut into the floor at
 * monument scale — lit from above like the engraved terms on the hero,
 * and bleeding the full width of the window.
 *
 * It follows the theme rather than staying on the vault's black: a
 * deeper paper under the light page, the near-black stage under the
 * dark one. Every colour comes from a --footer-* token so the two
 * treatments stay in step.
 *
 * Everything arrives on one cascade: the address, then the directory
 * column by column and link by link, the hairlines drawing outward,
 * and the wordmark rising out of its own mask last — the same reveal
 * the hero headline uses, so the page ends the way it began.
 */

type Column = { title: string; links: Array<{ label: string; href: string }> };

const COLUMNS: Column[] = [
  {
    title: "Protocol",
    links: [
      { label: "Why Spield", href: "#split" },
      { label: "How it works", href: "#split" },
      { label: "Products", href: "#" },
      { label: "FAQ", href: "#" },
    ],
  },
  {
    title: "App",
    links: [
      { label: "Launch app", href: "#" },
      { label: "Fixed Vault", href: "#" },
      { label: "Markets", href: "#traders" },
      { label: "Solvency", href: "#" },
    ],
  },
  {
    title: "Learn",
    links: [
      { label: "Learn hub", href: "#" },
      { label: "Fixed income on Stellar", href: "#" },
      { label: "How to earn yield", href: "#" },
      { label: "Glossary", href: "#" },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "Twitter / X", href: "#" },
      { label: "Contact", href: "mailto:contact@spield.live" },
    ],
  },
];

export default function SiteFooter() {
  /* Two triggers, not one. The footer is over a thousand pixels tall, so
     a single observer on it would fire the whole cascade the moment its
     top edge appeared — and the monument would be long settled before it
     ever scrolled into view. Each block watches for itself. */
  const topRef = useInView<HTMLDivElement>(0.2);
  const closeRef = useInView<HTMLDivElement>(0.45);

  const d = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

  return (
    <footer className="footer" aria-label="Site footer">
      {/* the accent rising off the floor, as on the vault stage */}
      <span className="footer-glow" aria-hidden="true" />

      <div
        ref={topRef}
        className="relative z-1 mx-auto max-w-[1220px] px-[clamp(20px,4vw,48px)] pt-[clamp(56px,8vh,88px)] pb-[clamp(24px,3vh,36px)]"
      >
        {/* ---- the address, and the directory ---- */}
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-[clamp(36px,6vw,88px)] max-[1000px]:grid-cols-1 max-[1000px]:gap-10">
          <div className="flex flex-col">
            <a
              className="f-up inline-flex items-center gap-[10px] self-start font-display text-[21px] font-bold tracking-[-0.02em] text-ink"
              style={d(0)}
              href="#"
              aria-label="Spield home"
            >
              <BrandMark />
              Spield
            </a>

            <p
              className="f-up mt-[18px] max-w-[34em] text-pretty text-[14.5px] leading-[1.62] text-muted"
              style={d(70)}
            >
              The fixed-income layer for Stellar. Strip yield, lock rates, and trade time, all on
              real, <span className="text-ink">on-chain backing</span>.
            </p>

            {/* dropped to the foot of the directory, so the block reads
                as one column rather than trailing off */}
            <p className="f-up mt-auto pt-[26px] text-[14px] text-subtle" style={d(140)}>
              Questions?{" "}
              <a className="footer-mail" href="mailto:contact@spield.live">
                contact@spield.live
              </a>
            </p>
          </div>

          <nav
            className="grid grid-cols-4 gap-[clamp(16px,2.4vw,32px)] max-[720px]:grid-cols-2 max-[720px]:gap-y-9"
            aria-label="Footer"
          >
            {COLUMNS.map((col, ci) => (
              <div key={col.title}>
                <h2
                  className="f-up font-mono text-[10.5px] font-medium tracking-[0.18em] uppercase text-subtle"
                  style={d(150 + ci * 80)}
                >
                  {col.title}
                </h2>
                <ul className="mt-[15px] flex flex-col gap-[11px]">
                  {col.links.map((link, li) => (
                    /* the reveal rides the li — the anchor owns transform
                       for its own hover shift and the two would collide */
                    <li key={link.label} className="f-up" style={d(195 + ci * 80 + li * 45)}>
                      <a className="footer-link" href={link.href}>
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* ---- the monument ---- */}
        <div
          className="footer-rule f-wipe mt-[clamp(52px,8vh,84px)]"
          style={d(430)}
          aria-hidden="true"
        />
      </div>

      <div ref={closeRef}>
        <div className="bleed-row relative z-1">
          {/* padded well past the glyph overhang, so the mask never crops
              the ascenders or the descender on the p once it has landed */}
          <div className="footer-mark-mask">
            <h2 className="footer-mark" style={d(0)} aria-hidden="true">
              Spield
            </h2>
          </div>
        </div>

        {/* ---- the plate ---- */}
        <div className="relative z-1 mx-auto max-w-[1220px] px-[clamp(20px,4vw,48px)] pb-[clamp(26px,4vh,40px)]">
          <div className="footer-rule f-wipe" style={d(340)} aria-hidden="true" />
          <div className="mt-[18px] flex flex-wrap items-center justify-between gap-x-8 gap-y-3 font-mono text-[11.5px] tracking-[0.04em] text-subtle">
            <p className="f-up" style={d(420)}>
              &copy; 2026 Spield Protocol. Built on{" "}
              <span className="text-muted">Stellar &amp; Soroban</span>.
            </p>
            <p className="f-up flex items-center gap-5" style={d(480)}>
              <a className="footer-link footer-link-sm" href="#">
                Terms
              </a>
              <a className="footer-link footer-link-sm" href="#">
                Privacy
              </a>
              <a className="footer-top group" href="#">
                Back to top
                <span className="inline-block -rotate-90 transition-transform duration-200 group-hover:-translate-y-[2px]">
                  <ArrowRight size={12} />
                </span>
              </a>
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
