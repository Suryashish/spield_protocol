"use client";

import { SERIES } from "@/lib/series";
import { useInView } from "@/lib/useInView";
import { ArrowRight } from "@/components/icons";

/**
 * Section 3 — "the yield market". The vault's counterparty: YT as
 * leveraged yield exposure, PT as the trader's fixed income, LP as
 * the market between them. The leverage bar fills as you arrive.
 */
export default function TradersSection() {
  const sectionRef = useInView<HTMLElement>(0.15);

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
        The vault&rsquo;s calm has a counterparty.{" "}
        <strong className="font-medium text-ink">YT</strong>&nbsp;is the variable half of every
        deposit &mdash; a cheap, liquid claim on all the yield a full position earns.
      </p>

      {/* the leverage bar: you pay the sliver, you earn the bar */}
      <div className="io mt-[clamp(40px,6vh,64px)] max-w-[760px]" style={d(280)} aria-label="Leverage">
        <div className="flex justify-between gap-3 font-mono text-[11px] tracking-[0.1em] uppercase">
          <span className="text-ember-text">You pay &middot; {SERIES.ytPrice.toFixed(4)}</span>
          <span className="text-accent-text">You earn the yield of &middot; 1.0000</span>
        </div>
        <div className="lev-track relative mt-[10px] h-3.5 overflow-hidden rounded-full">
          <span className="lev-fill absolute inset-y-0 left-0 rounded-full" aria-hidden="true" />
        </div>
        <p className="mt-3 font-mono text-[12.5px] text-muted">
          <strong className="font-medium text-ink">&asymp;{SERIES.ytLeverage}&times;</strong>&nbsp;yield
          exposure per dollar &middot; no margin account, no liquidation price
        </p>
      </div>

      {/* the three trades */}
      <div className="mt-[clamp(36px,5vh,56px)] grid grid-cols-3 gap-[clamp(14px,2vw,24px)] max-[900px]:mx-auto max-[900px]:max-w-[420px] max-[900px]:grid-cols-1">
        <TradeCard
          rule="bg-ember"
          title="Long yield"
          stat={`BUY YT · ${SERIES.ytPrice.toFixed(4)}`}
          delay={340}
        >
          Wins if realized yield beats the implied{" "}
          <strong className="font-medium text-ink">{SERIES.rate.toFixed(2)}%</strong>. Decays toward
          zero if it doesn&rsquo;t &mdash; and that is the entire downside.
        </TradeCard>
        <TradeCard
          rule="bg-accent"
          title="Lock the rate"
          stat={`BUY PT · ${SERIES.ptPrice.toFixed(4)}`}
          delay={420}
        >
          The trader&rsquo;s fixed income: buy the certain half at a discount, redeem{" "}
          <strong className="font-medium text-ink">exactly 1.0000</strong>&nbsp;at maturity, whatever
          happens.
        </TradeCard>
        <TradeCard rule="bg-ink/25" title="Make the market" stat="LP · PT + USDC" delay={500}>
          Supply the time-decay AMM where every rate view trades, and earn{" "}
          <strong className="font-medium text-ink">swap fees</strong>&nbsp;from both sides of the
          argument.
        </TradeCard>
      </div>

      <div
        className="invariant io mx-auto mt-[clamp(30px,4.5vh,44px)] flex max-w-[880px] items-center justify-center gap-[18px] text-center font-mono text-[clamp(11px,1.05vw,13px)] tracking-[0.1em] uppercase text-subtle"
        style={d(560)}
      >
        <span>
          Leverage without liquidation &mdash;{" "}
          <span className="text-ink">YT can decay to zero</span>,{" "}
          <span className="text-accent-text">but it can never be margin-called</span>
        </span>
      </div>

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
  rule,
  title,
  stat,
  delay,
  children,
}: {
  rule: string;
  title: string;
  stat: string;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="io relative overflow-hidden rounded-[20px] border border-line bg-surface px-6 py-[22px] shadow-soft transition-all duration-300 ease-vault hover:-translate-y-[3px] hover:shadow-[0_18px_44px_rgba(18,18,18,0.1)]"
      style={{ "--d": `${delay}ms` } as React.CSSProperties}
    >
      <span className={`absolute inset-x-0 top-0 h-[3px] ${rule}`} aria-hidden="true" />
      <h3 className="flex items-center justify-between gap-2 text-[15px] font-semibold tracking-[-0.01em]">
        {title}
        <span className="flex-none font-mono text-[10px] font-medium tracking-[0.08em] text-subtle">
          {stat}
        </span>
      </h3>
      <p className="mt-[10px] text-[13.5px] leading-[1.55] text-muted">{children}</p>
    </div>
  );
}
