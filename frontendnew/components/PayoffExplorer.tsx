"use client";

import { useEffect, useRef, useState } from "react";
import { SERIES } from "@/lib/series";
import {
  IMPLIED,
  MULT_MAX,
  PT_MULTIPLE,
  PT_RETURN,
  RATE_MAX,
  YT_COST,
  pct,
  ytMultiple,
  ytRedeem,
  ytReturn,
} from "@/lib/payoff";
import Illustrative from "@/components/Illustrative";

/**
 * The payoff explorer. Two instruments, one number between them: drag
 * the realized rate and watch PT stay exactly where it is while YT
 * sweeps past it. They cross at the implied rate, which is the whole
 * argument — above it you wanted the variable half, below it you
 * wanted the certain one.
 *
 * The slider is a real range input, so keyboard, touch and screen
 * readers all come free; the chart is a second, optional way to drive
 * the same value.
 */

/** which line the pointer is asking us to single out */
type Focus = "yt" | "pt" | null;

export default function PayoffExplorer({ focus }: { focus: Focus }) {
  const [rate, setRate] = useState(IMPLIED);
  const [touched, setTouched] = useState(false);
  const plotRef = useRef<HTMLDivElement>(null);
  const hostRef = useDemoSweep(touched, setRate);

  const take = (v: number) => {
    setTouched(true);
    setRate(Math.min(RATE_MAX, Math.max(0, v)));
  };

  /* drag anywhere on the plot — the same value the slider owns, just
     reachable where the eye already is */
  const fromPointer = (clientX: number) => {
    const box = plotRef.current?.getBoundingClientRect();
    if (!box) return;
    take(((clientX - box.left) / box.width) * RATE_MAX);
  };

  const x = (rate / RATE_MAX) * 100;
  const ytY = 100 - (ytMultiple(rate) / MULT_MAX) * 100;
  const ptY = 100 - (PT_MULTIPLE / MULT_MAX) * 100;
  const impliedX = (IMPLIED / RATE_MAX) * 100;
  // YT is linear in the rate, so the whole line is its two ends
  const ytEndY = 100 - (ytMultiple(RATE_MAX) / MULT_MAX) * 100;

  /* Three states, not two: at the implied rate the two pay exactly the
     same, which is the whole point of the crossing and also where the
     explorer sits at rest. Calling that "YT is ahead" would undercut it. */
  const lead =
    rate > IMPLIED + 0.01 ? "yt" : rate < IMPLIED - 0.01 ? "pt" : "even";
  /* The old second line explained which side wins above and below the
     implied rate — which the tick on the axis and the chart already say
     twice over. Three words is the whole verdict. */
  const VERDICT = {
    yt: "YT wins",
    pt: "PT wins",
    even: "Exactly even",
  } as const;

  return (
    <div
      ref={hostRef}
      className="pay io"
      style={{ "--d": "260ms" } as React.CSSProperties}
    >
      {/* ---- the control: the number you set, and who it favours ---- */}
      <div className="pay-head">
        <span className="pay-label">Realized yield at maturity</span>
        <output className="pay-rate" htmlFor="rate">
          {rate.toFixed(2)}
          <span className="pay-rate-unit">%</span>
        </output>
        <p className="pay-verdict" data-lead={lead}>
          {VERDICT[lead]}
        </p>
        {/* every price this instrument is struck on is a worked example —
            said once, here, under the number they all hang off */}
        <Illustrative className="pay-illus" />
      </div>

      {/* Level with the control rather than beside the chart. These are
          what the number you just set is worth, so they belong next to
          the number — and moving them out of the chart's row is what
          lets the chart run the full width. */}
      <div className="pay-outs">
        <Readout
          kind="yt"
          name="YT · variable"
          paid={SERIES.ytPrice.toFixed(4)}
          worth={ytRedeem(rate).toFixed(4)}
          ret={ytReturn(rate)}
          tag={`${SERIES.ytLeverage}× exposure`}
          dim={focus === "pt"}
        />
        <Readout
          kind="pt"
          name="PT · certain"
          paid={SERIES.ptPrice.toFixed(4)}
          worth="1.0000"
          ret={PT_RETURN}
          tag="fixed at purchase"
          dim={focus === "yt"}
        />
      </div>

      <div
        className="pay-slider"
        style={{ "--v": `${x}%` } as React.CSSProperties}
      >
        <input
          id="rate"
          className="pay-range"
          type="range"
          min={0}
          max={RATE_MAX}
          /* 0.02 divides the implied rate exactly, so the one point on this
             axis that means anything is actually reachable by dragging */
          step={0.02}
          value={rate}
          onChange={(e) => take(+e.target.value)}
          aria-label="Realized yield at maturity, annualised percent"
          aria-valuetext={`${rate.toFixed(2)} percent`}
        />
        <div className="pay-ticks" aria-hidden="true">
          <span>0%</span>
          {/* the crossing, one click away — a detent on the slider itself
              would trap the keyboard at exactly the value worth reaching */}
          <button
            type="button"
            className="pay-tick-implied"
            style={{ left: `${impliedX}%` }}
            onClick={() => take(IMPLIED)}
          >
            implied {IMPLIED}%
          </button>
          <span>{RATE_MAX}%</span>
        </div>
      </div>

      {/* ---- the chart, now running the full width ---- */}
      <div className="pay-chart">
          <p className="pay-axis-y">value at maturity, per 1.0000 invested</p>
          <div
            className="pay-plot"
            data-focus={focus ?? "none"}
            data-hint={touched ? "off" : "on"}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              fromPointer(e.clientX);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                fromPointer(e.clientX);
            }}
          >
            {[1, 2, 3].map((m) => (
              <span
                key={m}
                className="pay-gridlabel"
                style={{ top: `${100 - (m / MULT_MAX) * 100}%` }}
                aria-hidden="true"
              >
                {m}.0&times;
              </span>
            ))}

            {/* the plot proper, inset past the axis labels so no line runs
            underneath one — the drag maps against this box, not the gutter */}
            <div ref={plotRef} className="pay-field">
              {/* preserveAspectRatio none lets the coordinates be plain percentages;
            non-scaling-stroke keeps the lines an even weight through it */}
              <svg
                className="pay-svg"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  {/* Not a flat tint fading out. The band is brightest
                      just under the ray and falls away beneath it, so the
                      area reads as a lit surface catching light along its
                      leading edge rather than as a shape filled in. */}
                  <linearGradient id="ytWash" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--ember)" stopOpacity="0.34" />
                    <stop offset="26%" stopColor="var(--ember)" stopOpacity="0.19" />
                    <stop offset="62%" stopColor="var(--ember)" stopOpacity="0.07" />
                    <stop offset="100%" stopColor="var(--ember)" stopOpacity="0.01" />
                  </linearGradient>
                </defs>

                {[1, 2, 3].map((m) => {
                  const gy = 100 - (m / MULT_MAX) * 100;
                  return (
                    <line
                      key={m}
                      className="pay-grid"
                      x1="0"
                      x2="100"
                      y1={gy}
                      y2={gy}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}

                {/* where the market has already priced the rate */}
                <line
                  className="pay-implied"
                  x1={impliedX}
                  x2={impliedX}
                  y1="0"
                  y2="100"
                  vectorEffect="non-scaling-stroke"
                />

                <path
                  className="pay-wash"
                  d={`M0,100 L100,${ytEndY} L100,100 Z`}
                />
                <path
                  className="pay-line pay-line-yt"
                  d={`M0,100 L100,${ytEndY}`}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  className="pay-line pay-line-pt"
                  d={`M0,${ptY} L100,${ptY}`}
                  vectorEffect="non-scaling-stroke"
                />

                {/* where you are now */}
                <line
                  className="pay-cursor"
                  x1={x}
                  x2={x}
                  y1="0"
                  y2="100"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>

              {/* dots live in HTML so they stay round through the stretched viewBox */}
              <span
                className="pay-dot pay-dot-pt"
                style={{ left: `${x}%`, top: `${ptY}%` }}
              />
              <span
                className="pay-dot pay-dot-yt"
                style={{ left: `${x}%`, top: `${ytY}%` }}
              />
            </div>

            <span className="pay-hint" aria-hidden="true">
              drag
            </span>
          </div>
      </div>
    </div>
  );
}

function Readout({
  kind,
  name,
  paid,
  worth,
  ret,
  tag,
  dim,
}: {
  kind: "yt" | "pt";
  name: string;
  paid: string;
  worth: string;
  ret: number;
  /** three words at most — anything longer belongs in the trades below */
  tag: string;
  dim: boolean;
}) {
  return (
    <div className="pay-out" data-kind={kind} data-dim={dim}>
      <span className="pay-out-name">
        <span className="pay-out-dot" aria-hidden="true" />
        {name}
      </span>
      <span className="pay-out-ret">{pct(ret)}</span>
      <span className="pay-out-flow">
        <span>{paid}</span>
        <span aria-hidden="true">&rarr;</span>
        <span className="pay-out-worth">{worth}</span>
      </span>
      <span className="pay-out-tag">{tag}</span>
    </div>
  );
}

/* ---------- the one-shot demo ----------
   A slider that has never moved reads as a label. On first sight the
   rate runs up past the implied and settles back, which says "this
   moves" without a word of instruction. It happens once, it yields
   the instant the reader touches anything, and reduced motion skips
   it entirely. */

const SWEEP_TO = IMPLIED * 1.9;
const SWEEP_MS = 2200;
/** the plot's own draw-in runs 420ms → 1570ms; this follows it */
const SWEEP_WAIT = 1650;

function useDemoSweep(touched: boolean, set: (v: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || done.current || touched) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || done.current) return;
        done.current = true;
        io.disconnect();

        /* after the chart has finished plotting itself, not on top of it —
           two things moving at once reads as one thing glitching */
        const t0 = performance.now() + SWEEP_WAIT;
        raf = requestAnimationFrame(function step(now) {
          // clamped low as well as high: t0 is in the future during the
          // wait, and a negative k would swing the rate the wrong way
          const k = Math.max(0, Math.min(1, (now - t0) / SWEEP_MS));
          // out and back, eased at both ends so it never snaps
          const swing = Math.sin(k * Math.PI);
          const e = swing * swing * (3 - 2 * swing);
          set(IMPLIED + (SWEEP_TO - IMPLIED) * e);
          if (k < 1) raf = requestAnimationFrame(step);
          else set(IMPLIED);
        });
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [touched, set]);

  return ref;
}
