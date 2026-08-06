"use client";

import { SERIES, fmtUsd, fmtInt } from "@/lib/series";
import { ArrowDown, DriftLock } from "@/components/icons";
import { useVaultScene } from "./useVaultScene";

/**
 * The vault hero. Scrolling scrubs "the lock": the drifting market
 * rate converges to the fixed rate, turns green, the shackle closes,
 * the swash draws, and the terms engrave onto the vault floor.
 */
export default function Hero() {
  const s = useVaultScene();

  return (
    <div ref={s.scrubRef} className="scrub relative h-[240vh] max-[900px]:h-[200vh]">
      <div className="sticky-vault sticky top-0 h-svh pt-20 px-[clamp(12px,1.6vw,24px)] pb-[clamp(12px,1.6vw,24px)]">
        <div ref={s.stageScaleRef} className="stage-scale h-full will-change-transform">
          <section
            ref={s.stageRef}
            className="stage relative h-full overflow-hidden rounded-[clamp(28px,3vw,44px)] bg-stage"
            aria-label="Spield — fixed income on Stellar"
          >
            {/* ambient footage behind the vault, graded down into the dark;
                hidden for reduced-motion users */}
            <video
              className="absolute inset-0 z-0 h-full w-full object-cover opacity-60 [filter:brightness(0.55)_saturate(0.8)] motion-reduce:hidden"
              src="/spield%20motion%20video%20v3%20OG.mp4"
              autoPlay
              muted
              loop
              playsInline
              aria-hidden="true"
            />
            <div className="scrim" aria-hidden="true" />

            <canvas ref={s.canvasRef} className="absolute inset-0 z-2 h-full w-full" aria-hidden="true" />

            <div
              className="kicker absolute z-3 top-[clamp(24px,3.4vw,52px)] left-[clamp(28px,4.5vw,72px)] inline-flex items-center gap-[11px] font-mono text-[11.5px] font-medium tracking-[0.18em] uppercase text-onstage-faint"
              data-reveal
              style={{ "--d": "120ms" } as React.CSSProperties}
            >
              <span className="pulse-dot" aria-hidden="true" />
              Fixed income on Stellar
            </div>

            <div
              className="series absolute z-3 top-[clamp(24px,3.4vw,52px)] right-[clamp(28px,4.5vw,72px)] hidden min-[1081px]:block font-mono text-[11px] font-medium tracking-[0.16em] uppercase text-[rgba(250,250,248,0.24)]"
              data-reveal
              style={{ "--d": "200ms" } as React.CSSProperties}
              aria-hidden="true"
            >
              Series &middot; Dec 2026
            </div>

            <div className="absolute inset-0 z-3 flex flex-col items-center justify-center px-[clamp(20px,4vw,56px)] py-[clamp(24px,3.4vw,52px)] max-[900px]:pb-[84px]">
              <div className="hero-center flex max-w-[900px] flex-col items-center text-center">
                <h1 className="font-display font-medium text-onstage leading-[1.06] tracking-[-0.022em] [text-rendering:optimizeLegibility] text-[clamp(40px,5.4vw,82px)] max-[480px]:text-[clamp(34px,9.5vw,46px)]">
                  <span className="line">
                    <span className="line-inner" style={{ "--d": "200ms" } as React.CSSProperties}>
                      Tomorrow&rsquo;s yield,
                    </span>
                  </span>
                  <span className="line">
                    <span className="line-inner" style={{ "--d": "300ms" } as React.CSSProperties}>
                      <span className="serif-word">
                        locked
                        <svg className="swash" viewBox="0 0 230 14" preserveAspectRatio="none" aria-hidden="true">
                          <path d="M5 10 C 68 3.5, 162 3.5, 225 8" />
                        </svg>
                      </span>{" "}
                      today.
                    </span>
                  </span>
                </h1>

                <SplitTicket
                  driftNumRef={s.driftNumRef}
                  driftValRef={s.driftValRef}
                  sparkRef={s.sparkRef}
                />

                <div className="drift-status" data-reveal style={{ "--d": "560ms" } as React.CSSProperties} aria-hidden="true">
                  <span className="status-a">Drifts with the market, every ledger</span>
                  <span className="status-b">Locked &mdash; yours for {SERIES.days} days</span>
                </div>

                <a
                  className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] text-onstage-faint transition-colors duration-200 hover:text-onstage-dim"
                  href="#split"
                  data-reveal
                  style={{ "--d": "700ms" } as React.CSSProperties}
                >
                  How it works
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 4v16M6 14l6 6 6-6" />
                  </svg>
                </a>
              </div>
            </div>

            {/* scroll hint ↔ engraved terms — they trade places on lock */}
            <div
              ref={s.hintRef}
              className="hint absolute inset-x-0 bottom-7 z-3 flex items-center justify-center gap-2.5 font-mono text-[10.5px] font-medium tracking-[0.22em] max-[900px]:tracking-[0.16em] uppercase text-onstage-faint"
              data-reveal
              style={{ "--d": "700ms" } as React.CSSProperties}
              aria-hidden="true"
            >
              Scroll &mdash; lock your rate
              <ArrowDown />
            </div>

            <TermsPlate plateRef={s.plateRef} ledgerRef={s.ledgerRef} backingRef={s.backingRef} />

            <div ref={s.stageDimRef} className="stage-dim" aria-hidden="true" />
          </section>
        </div>
      </div>
    </div>
  );
}

/* ---------- the split ticket: pick your side of the same deposit ---------- */

function SplitTicket({
  driftNumRef,
  driftValRef,
  sparkRef,
}: {
  driftNumRef: React.RefObject<HTMLDivElement | null>;
  driftValRef: React.RefObject<HTMLSpanElement | null>;
  sparkRef: React.RefObject<SVGPathElement | null>;
}) {
  const tinyArrow = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );

  return (
    <div
      className="ticket mt-[clamp(26px,4vh,40px)] flex items-stretch rounded-full text-left max-[560px]:flex-col max-[560px]:rounded-[22px]"
      data-reveal
      style={{ "--d": "480ms" } as React.CSSProperties}
      aria-label="Choose your side"
    >
      {/* the fixed side — the vault */}
      <a
        className="tk-side flex items-center gap-3.5 rounded-l-full px-5 py-3 max-[560px]:justify-between max-[560px]:rounded-none max-[560px]:rounded-t-[22px]"
        href="#"
        aria-label="Lock the fixed rate"
      >
        <div
          ref={driftNumRef}
          className="drift-num mono inline-flex items-baseline gap-[0.06em] text-xl font-medium leading-none tracking-[-0.01em]"
        >
          <DriftLock />
          <span ref={driftValRef}>{SERIES.rate.toFixed(2)}</span>
          <span className="pc text-[0.72em] opacity-75">%</span>
        </div>
        <svg
          className="drift-bars block h-4.5 w-[132px] flex-none opacity-85 max-[560px]:w-auto max-[560px]:min-w-[70px] max-[560px]:flex-1"
          viewBox="0 0 150 20"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path ref={sparkRef} d="" />
        </svg>
        <span className="cs-act cs-act-fixed">
          Lock it in
          {tinyArrow}
        </span>
      </a>

      <span className="tk-perf" aria-hidden="true" />

      {/* the variable side — the market */}
      <a
        className="tk-side flex items-center gap-3.5 rounded-r-full px-5 py-3 max-[560px]:justify-between max-[560px]:rounded-none max-[560px]:rounded-b-[22px]"
        href="#traders"
        aria-label="Trade the yield"
      >
        <span className="mono text-base font-medium leading-none tracking-[-0.01em] text-[#FF9351]">
          &asymp;{SERIES.ytLeverage}&times;
        </span>
        <span className="cs-act cs-act-var">
          Trade it
          {tinyArrow}
        </span>
      </a>
    </div>
  );
}

/* ---------- the terms, engraved on the vault floor ---------- */

function TermsPlate({
  plateRef,
  ledgerRef,
  backingRef,
}: {
  plateRef: React.RefObject<HTMLDivElement | null>;
  ledgerRef: React.RefObject<HTMLSpanElement | null>;
  backingRef: React.RefObject<HTMLSpanElement | null>;
}) {
  return (
    <div
      ref={plateRef}
      className="plate absolute inset-x-0 bottom-7 z-3 flex flex-wrap items-center justify-center gap-y-2.25 px-6 font-mono text-[11px] tracking-widest uppercase text-onstage-faint"
      aria-hidden="true"
    >
      <span className="inline-flex items-center gap-2 whitespace-nowrap">
        {fmtInt(SERIES.deposit)} <span className="text-[rgba(250,250,248,0.25)]">&rarr;</span>{" "}
        <span className="val">{fmtUsd(SERIES.payout)}</span> USDC
      </span>
      <span className="plate-sep" aria-hidden="true" />
      <span className="inline-flex items-center gap-2 whitespace-nowrap">matures {SERIES.maturity}</span>
      <span className="plate-sep" aria-hidden="true" />
      <span className="plate-item-optional inline-flex items-center gap-2 whitespace-nowrap">
        backing <span ref={backingRef} className="val">${fmtInt(SERIES.backingStart)}</span>
      </span>
      <span className="plate-sep" aria-hidden="true" />
      <span className="inline-flex items-center gap-2 whitespace-nowrap">
        <span className="pulse-dot" aria-hidden="true" /> ledger{" "}
        <span ref={ledgerRef} className="val">{fmtInt(SERIES.ledgerStart)}</span>
      </span>
    </div>
  );
}
