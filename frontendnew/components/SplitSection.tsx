"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "@/lib/useInView";

/**
 * Section 2 — "the mechanism". A centred statement, then the three
 * beats of the mechanism as full-bleed video cards — the footage
 * carries the whole story, so the cards hold no chrome of their own.
 *
 * The cards are scroll-linked and deal themselves as you scroll: the
 * middle one rises on its own, then the outer two come out from behind
 * it and fan to the sides.
 *
 * Below 900px the deal turns on its side. Three portrait cards in a
 * column is a very long scroll past near-identical frames, so the same
 * three beats become a full-bleed deck you swipe through — the cards
 * still travel sideways, you just drive them. One card is live at a
 * time, the neighbours sit back, and a three-bar rail says where you
 * are and lets you jump.
 *
 * Drop a file at the `video` path below (inside /public) and it plays
 * in view automatically. Until then the card falls back to a lit
 * placeholder, so nothing reads as broken.
 */

type Step = {
  index: string;
  /** for screen readers — the cards carry no visible text */
  alt: string;
  /** the card's colour: glow, edge, ghost numeral */
  tone: string;
  /** which beat of the deal it lands on — 0 leads, 1 follows it out */
  seq: 0 | 1;
  video: string;
  poster?: string;
};

/**
 * Set to a path to force one stand-in reel into all three cards; null
 * lets each card play its own file.
 */
const PREVIEW_REEL: string | null = null;

const STEPS: Step[] = [
  {
    index: "01",
    alt: "Step one — Deposit. Your USDC routes into Blend, Stellar's lending market, and earns the floating rate from the first ledger.",
    tone: "var(--usdc)",
    seq: 1,
    video: "/videos/1.mp4",
  },
  {
    index: "02",
    alt: "Step two — Split. Spield separates the position into PT, the principal that comes back, and YT, every unit of yield it earns before maturity.",
    tone: "var(--accent)",
    seq: 0,
    video: "/videos/2.mp4",
  },
  {
    index: "03",
    alt: "Step three — Choose. Hold PT and redeem exactly 1.0000 at maturity, or hold YT and carry a full position's yield for a sliver of the capital.",
    tone: "var(--ember)",
    seq: 1,
    /* 582x776 — 3:4 like the other two, so object-cover has nothing to
       trim and the whole frame is what the card shows */
    video: "/videos/4.mp4",
  },
];

/** the card that leads the deal, and the one that plays when nothing is hovered */
const LEAD = 1;

export default function SplitSection() {
  const sectionRef = useInView<HTMLElement>(0.15);

  /* Playback follows the deal. While the cards are still arriving only
     the middle one runs; once they have all landed, hovering picks the
     one that plays and the rest coast to a stop. With no pointer on the
     row the middle takes it back, so the section is never dead. */
  const [dealt, setDealt] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [onScreen, setOnScreen] = useState(false);
  const hoverable = useHoverable();

  /* On the deck it is the snapped card that is live — swiping is the
     hover. Off it, the middle card holds playback until everything has
     landed, then the pointer decides. */
  const deck = useMedia(DECK_MQ);
  const [snapped, setSnapped] = useState(0);
  const deckRef = useSnap<HTMLDivElement>(deck, setSnapped);

  const driven = deck || hoverable;
  const liveIndex = deck ? snapped : dealt ? (hovered ?? LEAD) : LEAD;

  const stepsRef = useScrollRise<HTMLDivElement>(setDealt);
  const rowRef = useOnScreen<HTMLDivElement>(setOnScreen);

  /** jump the deck to a beat — the rail's bars, and the keyboard route in */
  const goTo = (i: number) => {
    const card = deckRef.current?.children[i] as HTMLElement | undefined;
    // block: nearest so centring the card horizontally cannot yank the page
    card?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  };

  const d = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

  return (
    <section
      ref={sectionRef}
      id="split"
      className="relative z-2 mx-auto max-w-[1220px] px-[clamp(20px,4vw,48px)] pt-[clamp(52px,8vh,104px)] pb-[clamp(90px,12vh,150px)]"
      aria-label="How Spield works"
    >
      {/* The thread the section hangs from. The sheet used to arrive over
          130px of bare canvas before the first word; this gives the eye
          something to follow across the seam. */}
      <span className="seam io" aria-hidden="true" />

      {/* ---- the statement, centred ---- */}
      <div className="mx-auto max-w-[900px] text-center">
        <div className="io" style={d(0)}>
          <span className="inline-flex items-center gap-[9px] rounded-full border border-line bg-surface/60 px-[15px] py-2 font-mono text-[11px] font-medium tracking-[0.14em] uppercase text-muted">
            <span className="pulse-dot" aria-hidden="true" /> The mechanism
          </span>
        </div>

        <h2
          className="io mx-auto mt-[26px] max-w-[13em] text-balance font-display text-[clamp(34px,4.6vw,68px)] font-bold leading-[1.02] tracking-[-0.028em]"
          style={d(90)}
        >
          Your deposit was{" "}
          <span className="font-serif italic font-normal text-[1.04em] text-accent-text">always</span>{" "}
          two things.
        </h2>

        <p
          className="io mx-auto mt-[18px] max-w-[40em] text-pretty text-[clamp(15.5px,1.3vw,18px)] leading-[1.6] text-muted"
          style={d(180)}
        >
          Spield routes your USDC into Blend, Stellar&rsquo;s lending market, then splits the
          position. <strong className="font-medium text-ink">Certainty</strong> and{" "}
          <strong className="font-medium text-ink">upside</strong>&nbsp;become separate tokens
          &mdash; hold one, trade the other.
        </p>
      </div>

      {/* ---- the three beats, standing up with the scroll.
              the row breaks the page gutter and runs the full width ---- */}
      <div className="bleed-row deck-bleed mt-[clamp(52px,8vh,88px)]">
        {/* the row pins here and the deal plays out against the scroll,
            so the page cannot leave the section mid-deal */}
        <div ref={stepsRef} className="cards-scrub">
          <div ref={rowRef} className="cards-pin">
            <div
              ref={deckRef}
              className="step-grid"
              role="group"
              aria-label="The three beats of the mechanism"
            >
              {STEPS.map((step, i) => (
                <StepCard
                  key={step.index}
                  step={step}
                  /* null hands playback back to the card's own observer —
                     the fallback for anything that neither swipes nor hovers */
                  active={driven ? onScreen && i === liveIndex : null}
                  warm={onScreen}
                  onHover={(on) => setHovered(on ? i : null)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* deck only — CSS hides it three-up, so it costs no hydration
            guess about which layout we are in */}
        <div className="deck-dots">
          {STEPS.map((step, i) => (
            <button
              key={step.index}
              type="button"
              className="deck-dot"
              style={{ "--tone": step.tone } as React.CSSProperties}
              aria-current={i === snapped}
              aria-label={`Show beat ${i + 1} of ${STEPS.length}`}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- one beat: the footage, and nothing else ---------- */

function StepCard({
  step,
  active,
  warm,
  onHover,
}: {
  step: Step;
  /** true plays, false coasts to a stop, null = self-manage on visibility */
  active: boolean | null;
  /** the row is in view — buffer the whole clip before it is wanted */
  warm: boolean;
  onHover: (on: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playable, setPlayable] = useState(true);

  // no hover pointer: fall back to playing whenever the card is on screen
  useEffect(() => {
    const el = videoRef.current;
    if (!el || active !== null) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void el.play().catch(() => {});
        else el.pause();
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [playable, active]);

  /* Hover plays, leaving stops — at full speed, both ways. The card
     keeps its own position in the clip, so a stop is only a pause and
     the next hover carries straight on from it. */
  useEffect(() => {
    const el = videoRef.current;
    if (!el || active === null) return;
    el.playbackRate = 1;
    if (active) void el.play().catch(() => {});
    else el.pause();
  }, [active, playable]);

  /* Buffer the clip once the row is in view. preload="metadata" leaves a
     card holding a couple of seconds, so the first hover spends its
     opening moment fetching instead of playing — invisible on localhost,
     very visible on a real connection. */
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !warm || el.preload === "auto") return;
    /* Raising preload is enough — calling load() alongside it resets
       currentTime and aborts playback, which stopped the middle card
       dead the moment the row came into view. */
    el.preload = "auto";
  }, [warm, playable]);

  return (
    <div
      className="rise"
      data-seq={step.seq}
      /* the deck recesses everything that is not live. false only ever
         means "explicitly stood down", so the undriven case stays lit. */
      data-live={String(active !== false)}
      style={{ "--tone": step.tone } as React.CSSProperties}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <article className="step-card">
        {/* what stands in until the file lands */}
        <span className="step-ph" aria-hidden="true">
          <span className="step-ph-num">{step.index}</span>
        </span>

        {playable && (
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden"
            src={PREVIEW_REEL ?? step.video}
            poster={step.poster}
            muted
            loop
            playsInline
            preload="metadata"
            onError={() => setPlayable(false)}
            aria-hidden="true"
          />
        )}

        <span className="sr-only">{step.alt}</span>
      </article>
    </div>
  );
}

/* ---------- the scroll link ----------
   Every card reads its own distance into the viewport, eases it, and
   publishes it as `--e` (0 → 1). The card's rise is a plain multiple of
   that, so it tracks the wheel rather than playing back on a timer.
   The per-card offset is what spaces the three arrivals apart. */

/* Deck only: viewport share the row takes to rise, and how far behind
   the one to its left each card starts. The row is short and horizontal,
   so it wants a tighter window than a pinned column would. */
const DECK_WINDOW = 0.5;
const DECK_LAG = 0.1;
/* How far behind the middle card the outer two start. 0.4 is what puts
   the middle at ~97% done by the time they have travelled far enough to
   clear its edge — so they are genuinely appearing from behind a card
   that has already landed, not racing it. */
const OFFSET = 0.4;
/* Share of the timeline the deal occupies. The rest is a held beat on
   the finished row before the page is allowed to move on. */
const FINISH = 0.85;
/* Viewport share of lead-in before the row pins, so the deal is already
   under way as the section scrolls in rather than starting from nothing
   the instant it locks. */
const PREROLL = 0.55;
/* How far through the pin the hand-off begins. The deal is long done by
   then; this is purely the exit that keeps the release from jolting. */
const EXIT_AT = 0.7;

/** live media query. Starts false on both sides of hydration, then settles. */
function useMedia(query: string) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = matchMedia(query);
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return on;
}

/** true once a hover pointer exists — otherwise playback stays visibility-driven */
function useHoverable() {
  return useMedia("(hover: hover) and (pointer: fine)");
}

/* 899.98 not 900 — the CSS breakpoint is exclusive of 900, and at exactly
   900 a rounded-down query would disagree with the layout on screen */
const DECK_MQ = "(max-width: 899.98px)";

/** which card the deck has settled on: the one nearest the rail's centre */
function useSnap<T extends HTMLElement>(deck: boolean, report: (i: number) => void) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const rail = ref.current;
    if (!rail || !deck) return;
    let rafId = 0;

    const read = () => {
      rafId = 0;
      const box = rail.getBoundingClientRect();
      const mid = box.left + box.width / 2;
      let best = 0;
      let bestGap = Infinity;
      // rects, not offsetLeft: the cards carry an entry transform and are
      // not the rail's offset parent, so laid-out coordinates would lie
      [...rail.children].forEach((child, i) => {
        const r = child.getBoundingClientRect();
        const gap = Math.abs(r.left + r.width / 2 - mid);
        if (gap < bestGap) {
          bestGap = gap;
          best = i;
        }
      });
      report(best);
    };

    const onScroll = () => {
      if (!rafId) rafId = requestAnimationFrame(read);
    };

    read();
    rail.addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      rail.removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [deck, report]);

  return ref;
}

/** whether the row is on screen at all — nothing plays when it is not */
function useOnScreen<T extends HTMLElement>(report: (v: boolean) => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => report(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [report]);
  return ref;
}

function useScrollRise<T extends HTMLElement>(onDealt: (v: boolean) => void) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const scrub = ref.current;
    if (!scrub) return;

    const cards = [...scrub.querySelectorAll<HTMLElement>(".rise")];
    const grid = scrub.querySelector<HTMLElement>(".step-grid");
    if (!cards.length || !grid) return;

    // reduced motion: everything sits at rest, nothing tracks the scroll
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const c of cards) c.style.setProperty("--e", "1");
      onDealt(true);
      return;
    }

    // matches the breakpoint the pin and the fan are switched off at
    const isDeck = matchMedia(DECK_MQ);
    let rafId = 0;

    /* smootherstep — zero velocity at both ends, so a card eases off the
       bottom and settles without a seam at either edge */
    const ease = (raw: number) => {
      const p = raw < 0 ? 0 : raw > 1 ? 1 : raw;
      return p * p * p * (p * (p * 6 - 15) + 10);
    };
    let landed = 0; // cards at rest this frame, for the playback hand-over
    const set = (card: HTMLElement, raw: number) => {
      const e = ease(raw);
      if (e > 0.985) landed += 1;
      card.style.setProperty("--e", String(e));
    };
    let dealt = false;
    /* Hand playback over only when every card is at rest, and only on a
       change — this runs every frame and must not churn React state. */
    const report = () => {
      const now = landed === cards.length;
      if (now !== dealt) {
        dealt = now;
        onDealt(now);
      }
    };

    const frame = () => {
      rafId = 0;
      const vh = innerHeight;
      landed = 0;

      if (isDeck.matches) {
        /* The deck. Nothing pins, so the row simply rises as it arrives —
           but all three cards now share a top, so left to themselves they
           would land on the same frame. DECK_LAG fans them in instead.
           Measured off the rail, which is never transformed: reading a
           card's own rect would feed this animation back into itself. */
        const raw = (vh - grid.getBoundingClientRect().top) / (vh * DECK_WINDOW);
        cards.forEach((card, i) => set(card, raw - i * DECK_LAG));
        grid.style.setProperty("--exit", "0"); // nothing pins, nothing to hand off
        report();
        return;
      }

      /* Pinned: the scrub's travel IS the timeline, so the page cannot
         move on mid-deal. PREROLL starts the clock while the row is
         still scrolling in — without it the cards sit at --e 0 until the
         pin engages and the section arrives as a header over a void. */
      const r = scrub.getBoundingClientRect();
      const pinTravel = r.height - vh;
      const preroll = vh * PREROLL;
      const total = preroll + pinTravel * FINISH;
      const t = total > 0 ? (preroll - r.top) / total : 1;
      const tc = t < 0 ? 0 : t > 1 ? 1 : t;
      for (const card of cards) {
        const seq = Number(card.dataset.seq ?? 0);
        // FINISH < 1 leaves a beat of held scroll after the last card lands
        set(card, (tc / FINISH) * (1 + OFFSET) - seq * OFFSET);
      }

      /* The hand-off, measured against the pin itself rather than the
         deal. Ease-IN, not smootherstep: this ramp has to *end* at the
         speed the page is about to move at, and smootherstep ends at
         zero — which put the row back to a standstill one frame before
         release, exactly the jolt it was meant to remove.
         p² over EXIT_LEN of travel, times the drift distance, lands the
         row at ~1px per px of scroll: the same speed as the page. */
      const held = pinTravel > 0 ? -r.top / pinTravel : 1;
      const rp = (held - EXIT_AT) / (1 - EXIT_AT);
      const p = rp < 0 ? 0 : rp > 1 ? 1 : rp;
      grid.style.setProperty("--exit", String(p * p));
      report();
    };

    const onScroll = () => {
      if (!rafId) rafId = requestAnimationFrame(frame);
    };

    frame();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return ref;
}
