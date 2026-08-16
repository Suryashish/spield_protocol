"use client";

import { SERIES, fmtUsd, fmtInt } from "@/lib/series";
import { ArrowDown, ArrowRight, DriftLock } from "@/components/icons";
import Illustrative from "@/components/Illustrative";
import { SITE } from "@/lib/seo/site";
import { useVaultScene } from "./useVaultScene";

/**
 * The vault hero. A machined dial — too big for its frame, so only its
 * flanks show — turns behind the type while the market rate drifts.
 * Scrolling scrubs "the lock": the scale parks 8.42 under the index,
 * the bolts throw home, the seal runs down both flanks, the rate turns
 * green, the swash draws, and the terms engrave onto the vault floor.
 */
export default function Hero() {
  const s = useVaultScene();

  return (
    /* Back up to 210vh on a phone. 160 was cut when nothing visible was
       happening through the scrub; now the crown climbs and the seal
       draws across it, the lock wants the room to be felt. */
    <div ref={s.scrubRef} className="scrub relative h-[240vh] max-[900px]:h-[210vh]">
      <div className="sticky-vault sticky top-0 h-svh pt-20 px-[clamp(12px,1.6vw,24px)] pb-[clamp(12px,1.6vw,24px)]">
        {/* the light the vault throws into the canvas around it as it
            shrinks away — it only exists during the hand-off */}
        <div ref={s.haloRef} className="vault-halo" aria-hidden="true" />
        <div ref={s.stageScaleRef} className="stage-scale h-full will-change-transform">
          <section
            ref={s.stageRef}
            className="stage relative h-full overflow-hidden rounded-[clamp(28px,3vw,44px)] bg-stage"
            aria-label="Spield — fixed income on Stellar"
          >
            {/* ambient footage, softened out of focus — it reads as moving
                light behind the dial without becoming a picture that
                competes with the type */}
            {/* The footage is blurred 3px, dimmed to 58% and run at 70%
                opacity, so almost none of its detail survives to the
                screen — it was still shipping as 3.8MB of 720p at 3Mbps,
                which is most of a page load spent on pixels nobody can
                resolve. Re-encoded at 480p/CRF32 it is 523KB and looks
                identical through the filter stack.

                The poster is the same frame as a 21KB JPEG: it paints on
                the first frame of the boot curtain lifting, so the stage
                is never a black hole waiting on a video decode. */}
            <video
              className="absolute inset-0 z-0 h-full w-full scale-[1.02] object-cover opacity-70 [filter:brightness(0.58)_saturate(0.95)_blur(3px)] motion-reduce:hidden"
              src="/spield%20motion%20video%20v3%20OG.mp4.mp4"
              poster="/hero-poster.jpg"
              autoPlay
              muted
              loop
              playsInline
              aria-hidden="true"
            />
            <div className="scrim" aria-hidden="true" />

            {/* The boot curtain sits over the footage but under the dial's
                canvas, so the instrument draws on plain black while
                everything else waits. It lifts once the dial is done. */}
            <div className="boot-curtain" aria-hidden="true" />

            <canvas ref={s.canvasRef} className="absolute inset-0 z-2 h-full w-full" aria-hidden="true" />

            <div
              /* centred on a phone: everything else in the frame is, and
                 a long tracked-out label pinned to one corner was the
                 widest thing on the screen before the headline */
              className="kicker absolute z-3 top-[clamp(24px,3.4vw,52px)] left-[clamp(28px,4.5vw,72px)] max-[900px]:left-0 max-[900px]:right-0 max-[900px]:justify-center inline-flex items-center gap-[11px] font-mono text-[11.5px] font-medium tracking-[0.18em] uppercase text-onstage-faint"
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
              Series &middot; Dec 2026 &middot; Illustrative
            </div>

            {/* Portrait reserves the bottom band for the dial, so the
                block is centred in what is left rather than in the whole
                stage. Centred in the stage it dumped all the slack above
                the headline — 154px of void at the top against 32px of
                clearance at the bottom, and on a 667-tall phone the
                buttons overlapped the dial outright.
                18vh rather than 21: the block is tighter now, so it can
                sit lower and give the headline more sky above it. */}
            <div className="absolute inset-0 z-3 flex flex-col items-center justify-center px-[clamp(20px,4vw,56px)] py-[clamp(24px,3.4vw,52px)] max-[900px]:pb-[18vh]">
              <div className="hero-center flex w-full max-w-[960px] flex-col items-center text-center">
                <h1 className="font-display font-medium text-onstage leading-[1.03] tracking-[-0.026em] [text-rendering:optimizeLegibility] text-[clamp(46px,6.6vw,96px)] max-[480px]:text-[clamp(38px,11.2vw,54px)]">
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

                <Readout driftNumRef={s.driftNumRef} driftValRef={s.driftValRef} />

                <div
                  className="mt-[clamp(20px,2.8vh,30px)] max-[900px]:mt-[clamp(11px,1.6vh,17px)] flex flex-wrap items-center justify-center gap-3"
                  data-reveal
                  style={{ "--d": "660ms" } as React.CSSProperties}
                >
                  {/* Straight into the Fixed Vault on the dApp — the section
                      that actually locks a rate — rather than the app's
                      overview, which would make the visitor navigate again to
                      do the thing the button just promised. */}
                  <a className="btn btn-primary" href={`${SITE.appOrigin}/vault`}>
                    Lock the rate
                    <ArrowRight />
                  </a>
                  <a className="btn btn-ghost" href="#split">
                    How it works
                  </a>
                </div>
              </div>
            </div>

            {/* scroll hint ↔ engraved terms — they trade places on lock */}
            <div
              ref={s.hintRef}
              className="hint absolute inset-x-0 bottom-7 z-3 flex items-center justify-center gap-2.5 font-mono text-[10.5px] font-medium tracking-[0.22em] max-[900px]:tracking-[0.16em] uppercase text-onstage-faint"
              data-reveal
              style={{ "--d": "820ms" } as React.CSSProperties}
              aria-hidden="true"
            >
              Scroll &mdash; lock your rate
              <ArrowDown />
            </div>

            <TermsPlate plateRef={s.plateRef} ledgerRef={s.ledgerRef} backingRef={s.backingRef} />

            {/* and this one sits over everything, so the dial draws in a
                pool of light with the frame falling away into dark — the
                vignette opens last, after the page is already up */}
            <div className="boot-vignette" aria-hidden="true" />

            <div ref={s.stageDimRef} className="stage-dim" aria-hidden="true" />
          </section>
        </div>
      </div>
    </div>
  );
}

/* ---------- the readout: the rate, machined into the dial face ---------- */

function Readout({
  driftNumRef,
  driftValRef,
}: {
  driftNumRef: React.RefObject<HTMLDivElement | null>;
  driftValRef: React.RefObject<HTMLSpanElement | null>;
}) {
  return (
    <div
      /* wider than before: it now follows the headline directly */
      className="readout mt-[clamp(30px,4.6vh,52px)] max-[900px]:mt-[clamp(22px,3.2vh,30px)]"
      data-reveal
      style={{ "--d": "540ms" } as React.CSSProperties}
    >
      {/* No frame. One quiet line of mono says which world the number is
          in and how long it runs; the number itself is the object. */}
      <div className="readout-win">
        <span className="readout-meta">
          <span className="readout-label rl-swap">
            <span className="rl-a">Market rate</span>
            <span className="rl-b">Fixed APY</span>
          </span>
          <span className="readout-dot" aria-hidden="true" />
          <span className="readout-label readout-term">{SERIES.days} days</span>
          {/* The truth about the number, on the one line that describes
              it. Desktop only — the phone carries it on the engraved
              plate instead, where there is room for it to be read. */}
          <span className="readout-dot readout-dot-illus" aria-hidden="true" />
          <Illustrative tone="stage" className="readout-illus" />
        </span>
        <div ref={driftNumRef} className="readout-num mono">
          <DriftLock />
          <span ref={driftValRef}>{SERIES.rate.toFixed(2)}</span>
          <span className="readout-pc">%</span>
        </div>
      </div>

      {/* nothing to say while the rate is still loose — the dial is
          already saying it. Only the lock gets a line. */}
      <div className="drift-status" aria-hidden="true">
        <span className="status-b">Locked &mdash; yours for {SERIES.days} days</span>
      </div>
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
      {/* the marker rides INSIDE the payout fact rather than standing as
          its own item: this is the one thing on the plate that survives
          to a phone, so the qualifier has to survive with it */}
      <span className="inline-flex items-center gap-2 whitespace-nowrap">
        <Illustrative tone="stage" label="Example" className="mr-0.5" />
        {fmtInt(SERIES.deposit)} <span className="text-[rgba(250,250,248,0.25)]">&rarr;</span>{" "}
        <span className="val">{fmtUsd(SERIES.payout)}</span> USDC
      </span>
      <span className="plate-sep" aria-hidden="true" />
      <span className="plate-item-secondary inline-flex items-center gap-2 whitespace-nowrap">
        matures {SERIES.maturity}
      </span>
      <span className="plate-sep" aria-hidden="true" />
      <span className="plate-item-optional plate-item-secondary inline-flex items-center gap-2 whitespace-nowrap">
        backing <span ref={backingRef} className="val">${fmtInt(SERIES.backingStart)}</span>
      </span>
      <span className="plate-sep" aria-hidden="true" />
      <span className="plate-item-secondary inline-flex items-center gap-2 whitespace-nowrap">
        <span className="pulse-dot" aria-hidden="true" /> ledger{" "}
        <span ref={ledgerRef} className="val">{fmtInt(SERIES.ledgerStart)}</span>
      </span>
    </div>
  );
}
