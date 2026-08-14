"use client";

import { useState } from "react";
import { SERIES } from "@/lib/series";
import { IMPLIED } from "@/lib/payoff";
import { useInView } from "@/lib/useInView";
import PayoffExplorer from "@/components/PayoffExplorer";

/**
 * Section 3 — "the yield market". The vault's counterparty, argued
 * with a payoff chart rather than a paragraph: PT is a flat line, YT
 * is a ray, and they cross at the rate the market has already priced.
 * Drag the realized rate and the two sides trade places.
 *
 * The three trades underneath are the positions you can take on that
 * same chart, so pointing at one singles out its line.
 */
export default function TradersSection() {
  const sectionRef = useInView<HTMLElement>(0.15);
  /* its own trigger: this section is thousands of pixels tall, so its
     own `.in` fires long before the statement is on screen */
  const statementRef = useInView<HTMLDivElement>(0.25, "seen");
  const [focus, setFocus] = useState<"yt" | "pt" | null>(null);

  const d = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

  return (
    <section
      ref={sectionRef}
      id="traders"
      /* pt: the vault section ends on a solid green CTA and this one
         opens on a small pill, and the vault's own tail alone left the
         two too close to read as separate arguments.
         pb: the tail ran to 102px of blank below the CTA on a phone */
      className="relative z-2 mx-auto max-w-[1220px] px-[clamp(20px,4vw,48px)] pt-[clamp(96px,14vh,200px)] pb-[clamp(96px,12vh,160px)] max-[900px]:pt-[clamp(64px,9vh,110px)] max-[900px]:pb-[clamp(48px,7vh,76px)]"
      aria-label="The yield market — for traders"
    >
      {/* centred, the same way the mechanism section opens — the two
          statements are the page's two theses and should sit alike */}
      <div ref={statementRef} className="mx-auto max-w-[900px] text-center">
        <div className="blur-in" style={d(0)}>
          <span className="inline-flex items-center gap-[9px] rounded-full border border-line bg-surface/60 px-[15px] py-2 font-mono text-[11px] font-medium tracking-[0.14em] uppercase text-muted">
            <span className="pulse-dot-ember" aria-hidden="true" /> The yield market
          </span>
        </div>

        <h2
          className="blur-in mx-auto mt-[26px] max-w-[13em] text-balance font-display text-[clamp(34px,4.6vw,68px)] font-bold leading-[1.02] tracking-[-0.028em]"
          style={d(140)}
        >
          Think yield goes higher?{" "}
          <span className="font-serif italic font-normal text-[1.04em] text-ember-text">Trade</span>{" "}
          it.
        </h2>

        <p
          className="blur-in mx-auto mt-[18px] max-w-[40em] text-pretty text-[clamp(15.5px,1.3vw,18px)] leading-[1.6] text-muted"
          style={d(280)}
        >
          <strong className="font-medium text-ink">YT</strong>&nbsp;is the variable half of every
          deposit &mdash; a cheap, liquid claim on all the yield a full position earns.
        </p>
      </div>

      <PayoffExplorer focus={focus} />

      {/* the three positions you can take on that chart */}
      <div className="trade-row">
        <TradeCard
          kind="yt"
          title="Long yield"
          stat={`BUY YT · ${SERIES.ytPrice.toFixed(4)}`}
          delay={340}
          onFocusLine={setFocus}
        >
          Wins above <strong className="font-medium text-ink">{IMPLIED.toFixed(2)}%</strong>. Decays
          toward zero below it &mdash; and that is the entire downside.
        </TradeCard>
        <TradeCard
          kind="pt"
          title="Lock the rate"
          stat={`BUY PT · ${SERIES.ptPrice.toFixed(4)}`}
          delay={420}
          onFocusLine={setFocus}
        >
          Buy the certain half at a discount, redeem{" "}
          <strong className="font-medium text-ink">exactly 1.0000</strong>&nbsp;at maturity.
        </TradeCard>
        <TradeCard kind="lp" title="Make the market" stat="LP · PT + USDC" delay={500}>
          Supply the AMM where every rate view trades. Earn{" "}
          <strong className="font-medium text-ink">swap fees</strong>&nbsp;from both sides.
        </TradeCard>
      </div>

    </section>
  );
}

/* ---------- one trade ---------- */

function TradeCard({
  kind,
  title,
  stat,
  delay,
  children,
  onFocusLine,
}: {
  kind: "yt" | "pt" | "lp";
  title: string;
  stat: string;
  delay: number;
  children: React.ReactNode;
  /** pointing at a trade singles out its line on the chart above */
  onFocusLine?: (k: "yt" | "pt" | null) => void;
}) {
  const line = kind === "lp" ? null : kind;
  const signal = () => onFocusLine?.(line);
  const clear = () => onFocusLine?.(null);

  return (
    <article
      className="trade-card io"
      data-kind={kind}
      style={{ "--d": `${delay}ms` } as React.CSSProperties}
      onPointerEnter={signal}
      onPointerLeave={clear}
      onFocus={signal}
      onBlur={clear}
      tabIndex={line ? 0 : undefined}
    >
      <Glyph kind={kind} />
      <h3 className="trade-title">
        {title}
        <span className="trade-stat">{stat}</span>
      </h3>
      <p className="trade-body">{children}</p>
    </article>
  );
}

/* the shape of the trade, drawn: a ray, a flat line, two crossing flows */
function Glyph({ kind }: { kind: "yt" | "pt" | "lp" }) {
  const d =
    kind === "yt"
      ? "M2 26 L46 4"
      : kind === "pt"
        ? "M2 15 L46 15"
        : "M2 5 C18 5 30 25 46 25 M2 25 C18 25 30 5 46 5";
  return (
    <svg className="trade-glyph" viewBox="0 0 48 30" fill="none" aria-hidden="true">
      <path d={d} vectorEffect="non-scaling-stroke" />
      {kind === "pt" && <circle cx="46" cy="15" r="2.6" />}
    </svg>
  );
}
