"use client";

import { useState } from "react";
import { SERIES } from "@/lib/series";
import { IMPLIED } from "@/lib/payoff";
import { useInView } from "@/lib/useInView";
import { ArrowRight } from "@/components/icons";
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
  const [focus, setFocus] = useState<"yt" | "pt" | null>(null);

  const d = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

  return (
    <section
      ref={sectionRef}
      id="traders"
      className="relative z-2 mx-auto max-w-[1220px] px-[clamp(20px,4vw,48px)] pb-[clamp(96px,12vh,160px)]"
      aria-label="The yield market — for traders"
    >
      <div className="io" style={d(0)}>
        <span className="inline-flex items-center gap-[9px] rounded-full border border-line bg-surface/60 px-[15px] py-2 font-mono text-[11px] font-medium tracking-[0.14em] uppercase text-muted">
          <span className="pulse-dot-ember" aria-hidden="true" /> The yield market
        </span>
      </div>

      <h2
        className="io mt-[26px] max-w-[14em] font-display text-[clamp(34px,4.6vw,68px)] font-bold leading-[1.02] tracking-[-0.028em]"
        style={d(90)}
      >
        Think yield goes higher?{" "}
        <span className="font-serif italic font-normal text-[1.04em] text-ember-text">Trade</span>{" "}
        it.
      </h2>

      <p
        className="io mt-[18px] max-w-[38em] text-[clamp(15.5px,1.3vw,18px)] leading-[1.6] text-muted"
        style={d(180)}
      >
        <strong className="font-medium text-ink">YT</strong>&nbsp;is the variable half of every
        deposit &mdash; a cheap, liquid claim on all the yield a full position earns.
      </p>

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

      <p
        className="invariant io mx-auto mt-[clamp(30px,4.5vh,44px)] max-w-[880px] text-center font-mono text-[clamp(11px,1.05vw,13px)] leading-[1.5] tracking-[0.1em] uppercase text-subtle"
        style={d(560)}
      >
        Leverage without liquidation &mdash;{" "}
        <span className="text-ink">YT can decay to zero, but never be margin-called</span>
      </p>

      <div className="io mt-[clamp(36px,5vh,52px)] text-center" style={d(620)}>
        <a
          className="group inline-flex items-center gap-2 text-[15px] font-medium text-muted transition-colors duration-200 hover:text-ink"
          href="#"
        >
          Open the yield market
          <span className="transition-transform duration-200 group-hover:translate-x-[3px]">
            <ArrowRight size={15} />
          </span>
        </a>
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
