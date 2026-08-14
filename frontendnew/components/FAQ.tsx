"use client";

import { useState } from "react";
import { FAQ_ITEMS } from "@/lib/faq";
import { useInView } from "@/lib/useInView";
import { ArrowRight } from "@/components/icons";

/**
 * The questions, answered.
 *
 * Every answer is in the HTML whether or not its row is open — the
 * panel collapses by animating a grid track to 0fr, so nothing is
 * unmounted and nothing is display:none. That matters twice over: the
 * page is the protocol's main answer surface for search and for the
 * models that read it, and both want the prose in the markup rather
 * than behind a click. Closed rows are `inert`, so what a crawler can
 * read is still not something a keyboard can tab into by accident.
 *
 * Rows, not cards: the section is built from the same hairlines as the
 * three trades above it, so the two blocks read as one page.
 */
export default function FAQ() {
  const sectionRef = useInView<HTMLElement>(0.1);
  const statementRef = useInView<HTMLDivElement>(0.25, "seen");
  /* a set, not an index — this is a reference block, and comparing two
     answers should not mean losing the first one */
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set([0]));

  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(i)) next.add(i);
      return next;
    });

  const d = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

  return (
    <section
      ref={sectionRef}
      id="faq"
      className="relative z-2 mx-auto max-w-[1220px] px-[clamp(20px,4vw,48px)] pb-[clamp(80px,10vh,130px)]"
      aria-label="Frequently asked questions"
    >
      <div ref={statementRef} className="mx-auto max-w-[900px] text-center">
        <div className="blur-in" style={d(0)}>
          <span className="inline-flex items-center gap-[9px] rounded-full border border-line bg-surface/60 px-[15px] py-2 font-mono text-[11px] font-medium tracking-[0.14em] uppercase text-muted">
            <span className="pulse-dot" aria-hidden="true" /> Straight answers
          </span>
        </div>

        <h2
          className="blur-in mx-auto mt-[26px] max-w-[13em] text-balance font-display text-[clamp(34px,4.6vw,68px)] font-bold leading-[1.02] tracking-[-0.028em]"
          style={d(140)}
        >
          Everything you&rsquo;d ask{" "}
          <span className="font-serif italic font-normal text-[1.04em] text-accent-text">
            before
          </span>{" "}
          depositing.
        </h2>

        <p
          className="blur-in mx-auto mt-[18px] max-w-[40em] text-pretty text-[clamp(15.5px,1.3vw,18px)] leading-[1.6] text-muted"
          style={d(280)}
        >
          Including the ones with{" "}
          {/* &nbsp;: Next's minifier eats the leading space on a
              paragraph's final text child after an inline tag */}
          <strong className="font-medium text-ink">uncomfortable answers</strong>&nbsp;&mdash;
          where the protocol isn&rsquo;t there yet, it says so.
        </p>
      </div>

      <div className="faq-list">
        {FAQ_ITEMS.map((item, i) => {
          const isOpen = open.has(i);
          return (
            <div
              key={item.q}
              className="faq-item io"
              data-open={String(isOpen)}
              /* the cascade only runs over the first few rows — twelve
                 at 45ms each would still be arriving a second after the
                 block had settled */
              style={d(Math.min(i, 5) * 55)}
            >
              <h3 className="faq-h">
                <button
                  type="button"
                  className="faq-q"
                  id={`faq-q-${i}`}
                  aria-expanded={isOpen}
                  aria-controls={`faq-a-${i}`}
                  onClick={() => toggle(i)}
                >
                  <span>{item.q}</span>
                  <span className="faq-mark" aria-hidden="true" />
                </button>
              </h3>

              <div
                className="faq-a"
                id={`faq-a-${i}`}
                role="region"
                aria-labelledby={`faq-q-${i}`}
                inert={!isOpen}
              >
                <div className="faq-a-clip">
                  <div className="faq-a-inner">
                    <p className="faq-body">{item.a}</p>
                    {item.more && (
                      <a
                        className="faq-link"
                        href={item.more.href}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {item.more.label}
                        <ArrowRight size={13} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

    </section>
  );
}
