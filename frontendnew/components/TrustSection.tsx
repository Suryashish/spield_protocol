"use client";

import Link from "next/link";

import { PROTOCOL_FACTS as F } from "@/lib/seo/facts";
import { useInView } from "@/lib/useInView";
import { ArrowRight } from "@/components/icons";

/**
 * Section 5 — the receipts, in one plate.
 *
 * Everything before this is an argument; this is why any of it should be
 * believed. On a finance page that section has to exist, but it does NOT have to
 * be exhaustive: the full ledger — all four contracts, the three assets, the
 * Blend dependency, the config table and the live metrics — is already rendered
 * at /learn/spield-protocol-facts, built from this same `facts.ts`. Reproducing
 * it here would put the same tables on two URLs and make the landing page carry
 * a reference document in the middle of a pitch.
 *
 * So the landing keeps only what a reader has to see to keep reading: the one
 * invariant the whole design rests on, and where the protocol honestly stands.
 * Everything else is one link away, and the link says exactly what is behind it.
 *
 * The status line is not a disclaimer in small print. `status.audited` is false
 * and it is the first thing that line says, at the same size as the rest — a
 * page that buries that is only trusted until someone checks.
 */

const ADDRESSES = F.contracts.length + F.assets.length + F.dependencies.length;

export default function TrustSection() {
  const sectionRef = useInView<HTMLElement>(0.08);
  /* `.blur-in` keys off `.seen`, not `.in` — the other statement blocks observe
     themselves under that class, and the default leaves them at opacity 0. */
  const statementRef = useInView<HTMLDivElement>(0.25, "seen");
  const plateRef = useInView<HTMLDivElement>(0.25);
  const d = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

  return (
    <section
      ref={sectionRef}
      id="trust"
      /* pb carries the ENTIRE gap down to the FAQ: that section sets
         `padding-top: 0` and takes its air from whatever precedes it. At the
         value this section shipped with, the join measured 100px against 260px
         either side of it — the tightest seam on the page, and the one place
         the eye reads two sections as one. 16vh puts it at 160px, which is
         exactly the FAQ's own gap down to the closing plate, so the block is
         bracketed evenly instead of crushed at the top. */
      className="relative z-2 mx-auto max-w-[1220px] px-[clamp(20px,4vw,48px)] pt-[clamp(96px,14vh,200px)] pb-[clamp(110px,16vh,220px)] max-[900px]:pt-[clamp(64px,9vh,110px)] max-[900px]:pb-[clamp(96px,16vh,150px)]"
      aria-label="Verifiable by design"
    >
      <div ref={statementRef} className="mx-auto max-w-[900px] text-center">
        <div className="blur-in" style={d(0)}>
          <span className="inline-flex items-center gap-[9px] rounded-full border border-line bg-surface/60 px-[15px] py-2 font-mono text-[11px] font-medium tracking-[0.14em] uppercase text-muted">
            <span className="pulse-dot" aria-hidden="true" /> Verifiable by design
          </span>
        </div>

        <h2
          className="blur-in mx-auto mt-[26px] max-w-[13em] text-balance font-display text-[clamp(34px,4.6vw,68px)] font-bold leading-[1.02] tracking-[-0.028em]"
          style={d(110)}
        >
          Don&rsquo;t trust it.{" "}
          <span className="font-serif italic font-normal text-[1.04em] text-accent-text">
            Check
          </span>{" "}
          it.
        </h2>

        <p
          className="blur-in mx-auto mt-[18px] max-w-[40em] text-pretty text-[clamp(15.5px,1.3vw,18px)] leading-[1.6] text-muted"
          style={d(220)}
        >
          One rule holds the design together, and it is enforced in the contracts rather than
          promised on a page.
        </p>
      </div>

      {/* ---- the invariant ---- */}
      <div
        ref={plateRef}
        className="io mx-auto mt-[clamp(40px,5.5vh,64px)] max-w-[720px] rounded-[20px] border border-line bg-surface/60 px-[clamp(22px,3.2vw,40px)] py-[clamp(26px,3.6vh,40px)]"
        style={d(0)}
      >
        <p className="text-center font-mono text-[10.5px] font-medium tracking-[0.18em] uppercase text-subtle">
          The solvency invariant
        </p>

        {/* Sides labelled underneath, not beside: no phone holds "real backing ≥
            issued value" plus both captions on one line, and a wrapped
            inequality reads as broken rather than as tight. */}
        <div className="mt-[clamp(16px,2.2vh,24px)] flex items-start justify-center gap-[clamp(14px,3vw,34px)] text-center">
          <div className="min-w-0">
            <p className="font-display text-[clamp(17px,2.1vw,28px)] font-bold leading-[1.15] tracking-[-0.02em] text-ink">
              Real backing
            </p>
            <p className="mt-[7px] font-mono text-[10px] tracking-[0.1em] uppercase text-subtle">
              USDC supplied to Blend
            </p>
          </div>

          <span
            aria-hidden="true"
            className="shrink-0 pt-[0.06em] font-display text-[clamp(23px,3vw,40px)] font-bold leading-[1.05] text-accent-text"
          >
            &ge;
          </span>

          <div className="min-w-0">
            <p className="font-display text-[clamp(17px,2.1vw,28px)] font-bold leading-[1.15] tracking-[-0.02em] text-ink">
              Issued value
            </p>
            <p className="mt-[7px] font-mono text-[10px] tracking-[0.1em] uppercase text-subtle">
              PT + YT outstanding
            </p>
          </div>
        </div>

        <p className="mx-auto mt-[clamp(16px,2.2vh,22px)] max-w-[46em] text-center text-pretty text-[14.5px] leading-[1.6] text-muted">
          Checked inside the wrapper on every mint and every redeem. A transaction that would put
          issued value above real backing does not fail quietly &mdash; it does not execute.
        </p>
      </div>

      {/* ---- where it honestly stands, then the door to the detail ---- */}
      <div className="io mx-auto mt-[clamp(26px,3.5vh,40px)] max-w-[760px] text-center" style={d(120)}>
        <p className="trust-status flex flex-wrap items-center justify-center gap-x-[14px] gap-y-[6px] font-mono text-[11px] tracking-[0.12em] uppercase text-subtle">
          <span className="text-ink">Not audited</span>
          <span aria-hidden="true">&middot;</span>
          <span>{F.networkLabel}</span>
          <span aria-hidden="true">&middot;</span>
          <span>Non-custodial</span>
          <span aria-hidden="true">&middot;</span>
          <span>No live figures published</span>
        </p>

        {/* NOT `.btn-ghost`: that variant is built for the dark stage — a
            near-white border over `--onstage` — which is why Hero and ClosingCTA
            use it and why it vanished here, on paper. This is the surface-button
            treatment the nav's theme toggle uses, so it reads as a real control
            in both themes. Deliberately not `.btn-primary` either: that is the
            ink-filled shape the vault CTAs own, and a secondary "go read the
            detail" link should not compete with "lock the rate". */}
        <div className="mt-[clamp(20px,2.8vh,30px)]">
          <Link
            className="group inline-flex items-center gap-[10px] rounded-full border border-line bg-surface px-[22px] py-[13px] text-[14.5px] font-medium text-ink shadow-float-sm transition-all duration-200 hover:-translate-y-px hover:border-muted"
            href="/learn/spield-protocol-facts"
          >
            <span className="max-[560px]:hidden">
              All {ADDRESSES} addresses, {F.guarantees.length} guarantees, every metric
            </span>
            <span className="hidden max-[560px]:inline">
              All {ADDRESSES} addresses &amp; {F.guarantees.length} guarantees
            </span>
            <span className="inline-block transition-transform duration-200 group-hover:translate-x-[3px]">
              <ArrowRight size={14} />
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}
