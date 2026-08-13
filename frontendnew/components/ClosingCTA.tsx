"use client";

import { SERIES } from "@/lib/series";
import { ArrowRight } from "@/components/icons";
import { useInView } from "@/lib/useInView";

/**
 * The close — the vault, once more, at the end of the argument.
 *
 * The page opened on a dark stage and then spent two sections on
 * paper making its case; it should not simply stop at the bottom of
 * the last table. So the stage comes back, smaller, with the two doors
 * the page has been describing side by side: hold the certain half, or
 * take the other side of it.
 *
 * Behind the type, three engraved arcs — the flank of the hero's dial,
 * seen from further away. They draw themselves as the card arrives,
 * which is the last piece of motion on the page before the plate.
 */
export default function ClosingCTA() {
  const ref = useInView<HTMLDivElement>(0.3);
  const d = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

  return (
    <div ref={ref} className="close-wrap">
      <section className="close" aria-label="Open a position">
        <span className="close-glow" aria-hidden="true" />

        {/* The dial's flank, engraved — three rings drawn on arrival.
            pathLength 1 normalises every circumference, so one
            stroke-dasharray in the stylesheet draws all three radii. */}
        <svg className="close-rings" viewBox="0 0 400 400" aria-hidden="true">
          <circle className="close-ring" cx="200" cy="200" r="188" pathLength={1} style={d(120)} />
          <circle className="close-ring" cx="200" cy="200" r="150" pathLength={1} style={d(240)} />
          <circle
            className="close-ring close-ring-seal"
            cx="200"
            cy="200"
            r="112"
            pathLength={1}
            style={d(360)}
          />
        </svg>

        <div className="close-inner">
          <span className="close-kicker io" style={d(0)}>
            Two doors, one vault
          </span>

          <h2 className="close-title io" style={d(90)}>
            Take the rate, or take the{" "}
            <span className="close-em">other side</span>.
          </h2>

          {/* two sentences, not three: on a phone the third wrapped the
              paragraph to four lines and the card read as a wall */}
          <p className="close-sub io" style={d(170)}>
            Both halves come out of the same deposit. One redeems exactly 1.0000 at maturity; the
            other carries a full position&rsquo;s yield for&nbsp;{SERIES.ytPrice.toFixed(4)}.
          </p>

          <div className="close-actions io" style={d(250)}>
            {/* the full label is 23 characters and forces the pair to
                stack as two solid bars on a phone — narrow screens get
                the short one and the two doors stay side by side */}
            <a className="btn btn-primary" href="#">
              <span className="close-cta-full">
                Lock {SERIES.rate.toFixed(2)}% for {SERIES.days} days
              </span>
              <span className="close-cta-brief">Lock the rate</span>
              <ArrowRight />
            </a>
            <a className="btn btn-ghost" href="#traders">
              Trade the yield
            </a>
          </div>

          {/* the terms, engraved along the floor — the same mono chrome
              the hero's plate closes on. Tracked-out mono wraps badly:
              on a phone the lead and the last fact stand down so this
              stays one line rather than three. */}
          <ul className="close-terms io" style={d(330)}>
            <li>
              <span className="close-term-lead">Series &middot; </span>matures {SERIES.maturity}
            </li>
            <li className="close-term-sep" aria-hidden="true" />
            <li>Non-custodial</li>
            <li className="close-term-sep close-term-opt" aria-hidden="true" />
            <li className="close-term-opt">Backed 1:1 on-chain</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
