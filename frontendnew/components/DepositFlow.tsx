"use client";

import { useEffect, useRef } from "react";

/**
 * The stream — the opening beat of the mechanism section.
 *
 * A body of moving light comes over the sheet's lip in the deposit's own
 * blue, hits a node, and splits. What leaves is not two lines but two
 * streams that behave differently, and the behaviour IS the argument:
 *
 *   left, green    laminar. The particles decelerate into four dead
 *                  straight lanes, evenly spaced, constant speed, and
 *                  the band they run in never moves again.
 *   right, ember   turbulent. A third as many particles at two and a
 *                  half times the speed, wandering across the band,
 *                  hurrying and hanging back, and the band itself
 *                  ripples for as long as you are looking at it.
 *
 * That is the page's one rule at full size — variable things move, fixed
 * things never do — and it is why this is drawn rather than written: you
 * can read "certain" and "leveraged" off the motion before you reach the
 * headline underneath.
 *
 * Drawn on canvas rather than in SVG, like the hero's dial: the ember
 * band's outline is rebuilt every frame, and re-serialising a 400-point
 * ribbon into a path attribute sixty times a second is not something to
 * ask the DOM for.
 *
 * Structure per stream: a soft ribbon carrying the volume, a crisp
 * centreline carrying the precision, and the particles carrying the
 * life. The ribbon's width is what makes this read as substance instead
 * of wire.
 */

/* ---------- geometry, as shares of the drawing's box ----------
   The drawing is full-bleed: one stream over the sheet's lip, a fork,
   and then two flat runs that leave straight out of the left and right
   edges of the window. Nothing turns back down the page — the halves
   simply carry on past the frame, which is the point of them. */
const FORK_Y = 0.3;
const RAIL_Y = 0.62;
const SPREAD = 0.22;
const SPREAD_MAX = 210;
/** how far past the window edge each run is carried before it ends */
const EXIT_X = 0.05;
/** where the tags hang under their run, as a share of the width */
const TAG_X = 0.14;
/* Both halves leave the node straight DOWN — they were one thing a pixel
   earlier — but the handle holding them there is short, so they bend
   apart at once. Held longer they stay within a pixel of each other for
   a third of their run and the fork reads as a single spike. */
const OUT_HANDLE = 0.28;
const IN_HANDLE = 0.5;

/** samples per stream, spaced by arc length so speed is even along it */
const N = 200;

/* ---------- the two temperaments ---------- */
const PT_DOTS = 112;
const YT_DOTS = 66;
const STEM_DOTS = 112;
/** lanes the certain side settles into — the visible shape of "fixed" */
const LANES = [-0.62, -0.21, 0.21, 0.62];

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (v: number) => 1 - Math.pow(1 - v, 3);

type Poly = { xs: Float32Array; ys: Float32Array; nx: Float32Array; ny: Float32Array };
type Dot = { u: number; lane: number; sp: number; ph: number };

/** cubic bezier, one axis */
const bez = (a: number, b: number, c: number, d: number, t: number) => {
  const m = 1 - t;
  return m * m * m * a + 3 * m * m * t * b + 3 * m * t * t * c + t * t * t * d;
};

/** resample a dense point list to N points spaced evenly by arc length,
 *  and carry a unit normal at each — the ribbon is built off these */
function resample(px: number[], py: number[]): Poly {
  const n = px.length;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]);
  }
  const total = cum[n - 1] || 1;
  const xs = new Float32Array(N);
  const ys = new Float32Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    const want = (total * i) / (N - 1);
    while (j < n - 2 && cum[j + 1] < want) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const f = clamp01((want - cum[j]) / seg);
    xs[i] = px[j] + (px[j + 1] - px[j]) * f;
    ys[i] = py[j] + (py[j + 1] - py[j]) * f;
  }
  const nx = new Float32Array(N);
  const ny = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(N - 1, i + 1);
    const dx = xs[b] - xs[a];
    const dy = ys[b] - ys[a];
    const m = Math.hypot(dx, dy) || 1;
    nx[i] = -dy / m;
    ny[i] = dx / m;
  }
  return { xs, ys, nx, ny };
}

export default function DepositFlow() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = host?.querySelector("canvas");
    const ctx = canvas?.getContext("2d");
    if (!host || !canvas || !ctx) return;

    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ---------- palette, read off the tokens so themes just work ----------
       Two sets, because the two themes are two different mediums.

       On black the drawing is LIGHT: translucent colour stacked on a dark
       ground adds up, so a wide faint ribbon reads as a stream glowing
       through the page. On warm paper the same passes stack toward white
       instead and come out as a milky wash — a highlighter smear with a
       thin line down the middle of it, which is what this looked like.

       So the light theme draws in INK: the darker -text variants of each
       hue (which exist for exactly this reason — they are the tokens the
       page sets type in on paper), a much tighter ribbon that hugs its
       line rather than spilling, a centreline at nearly full strength,
       and the two big radial glows cut right back, since a low-alpha
       radial over #FBFAF7 is a stain rather than a light. */
    let usdc = "#4a87f2";
    let accent = "#0fbe7c";
    let ember = "#ff7a2f";
    /* the same three, in the weight the ground can carry: centrelines,
       particles and the node are drawn in these, the ribbons in the above */
    let usdcInk = usdc;
    let accentInk = accent;
    let emberInk = ember;
    /* true on the light theme — paper takes ink, not glow */
    let onPaper = false;

    /* Everything the ground changes, in one place, recomputed only when
       the theme does — this is read several times a frame. `swell` is how
       far the widest ribbon pass spreads past its band, `a0`/`a1` are the
       ends of its alpha ramp, `line` is the centreline's strength, and
       `bloom`/`pool` are the node's halo and the light it throws into the
       page. The dark numbers are the tuned originals. */
    const GLOW = { swell: 1.95, a0: 0.011, a1: 0.042, line: 0.72, dot: 1, bloom: 0.17, pool: 0.028 };
    /* Paper: the ribbon hugs its line instead of spilling (a wide faint
       pass over #FBFAF7 is a stain, not a light), the centreline comes up
       to near full strength because ink is all the page has, and the two
       big radials are cut to a quarter. */
    const INK = { swell: 1.4, a0: 0.006, a1: 0.052, line: 0.95, dot: 0.78, bloom: 0.06, pool: 0.008 };
    let P = GLOW;

    const readTokens = () => {
      const cs = getComputedStyle(document.documentElement);
      const tok = (n: string, fallback: string) => cs.getPropertyValue(n).trim() || fallback;
      usdc = tok("--usdc", usdc);
      accent = tok("--accent", accent);
      ember = tok("--ember", ember);
      onPaper = document.documentElement.getAttribute("data-theme") !== "dark";
      /* On dark the -text tokens are the BRIGHTER variants, which would
         hand the tuned dark drawing a different palette for nothing. It
         keeps the raw hues; only paper swaps to ink. */
      usdcInk = onPaper ? tok("--usdc-text", usdc) : usdc;
      accentInk = onPaper ? tok("--accent-text", accent) : accent;
      emberInk = onPaper ? tok("--ember-text", ember) : ember;
      P = onPaper ? INK : GLOW;
    };

    /* ---------- geometry ---------- */
    let w = 0;
    let h = 0;
    let cx = 0;
    let forkY = 0;
    let railY = 0;
    let spread = 0;
    let sx = 0; // where the ember rail begins
    let ex = 0; // and where it fades out
    let cycles = 2;
    let ampMax = 20;
    let unit = 1; // one scale for every width on the drawing
    /* The width all three bands share where they meet. Squeezed to zero
       there, the stem vanished a few pixels above the node and the two
       rails only became visible a few pixels below it — a hole at the
       exact point the whole drawing is about. They now butt together at
       one common width and the junction is continuous. */
    let throat = 4;
    let over = 0; // how far the surface reaches above the layout box

    let stem: Poly | null = null;
    let ptP: Poly | null = null;
    let ytP: Poly | null = null;

    /* ---------- state ---------- */
    let p = 0; // scroll progress through the split
    let amp = 0;
    let fired = false;
    let pulse = 0;
    let raf = 0;
    let sceneRaf = 0;
    let t0 = 0;
    let last = 0;

    /* ---------- the populations ---------- */
    /* Taking the lane straight off `i` made it a perfect function of
       `u`, so every unlaned population came out as one diagonal streak
       drawn across its band instead of a body filling it. A golden-angle
       scramble fixed the streak but is low-discrepancy by construction,
       which put the stem on a visible lattice instead — so: a hash, and
       a stratified jitter along the run. Even density, no pattern. */
    const hash = (i: number) => {
      const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    /* The certain side is spaced evenly WITHIN each lane — that is what
       "constant speed, for ever" looks like — but the lanes have to be
       offset from each other by something that is not a whole number of
       those spacings. Dealt off `i / n` with a 0.17 stagger the offset
       came out at very nearly four slots, so the four lanes re-formed
       into one repeating lattice and the run read as a row of ticks
       rather than as four lines of traffic. */
    const perLane = Math.max(1, Math.round(PT_DOTS / LANES.length));
    const mk = (n: number, laned: boolean): Dot[] =>
      Array.from({ length: n }, (_, i) => ({
        u: laned
          ? (Math.floor(i / LANES.length) / perLane + (i % LANES.length) * 0.137) % 1
          : (i + hash(i)) / n,
        /* the certain side gets four discrete lanes; the variable one
           gets a continuous spread it then wanders across */
        lane: laned ? LANES[i % LANES.length] : hash(i + 977) * 1.6 - 0.8,
        sp: 1,
        ph: hash(i + 4231) * TAU,
      }));
    const stemDots = mk(STEM_DOTS, false);
    const ptDots = mk(PT_DOTS, true);
    const ytDots = mk(YT_DOTS, false);

    /* The swing of the ember rail at t (0 → 1 along its flat run).

       Two harmonics, not one: a single sine is a machined shape and reads
       as a gentle bulge rather than as something moving. Adding a second
       at 1.7x with its own phase means the crests are never the same
       height twice and the curve wanders — which is what "variable"
       should look like next to a rail that is dead straight.

       The t^0.7 weighting still grows the swing along the run (the
       further the yield goes the harder it moves) but starts it sooner
       than t^1.05 did, so the first crest is not damped away. */
    const swing = (t: number, a: number, phase: number) =>
      (Math.sin(t * TAU * cycles + phase) * 0.74 +
        Math.sin(t * TAU * cycles * 1.7 + phase * 1.35 + 1.1) * 0.33) *
      a *
      Math.pow(t, 0.7);

    /* One half of the drawing, end to end: out of the node, across the
       flat run, then the fall away off the side. `dir` is -1 for the
       certain half and +1 for the variable one, and the only thing that
       differs between them is the swing — which is why the certain side
       is simply built with a = 0 and never rebuilt again. */
    const sidePath = (dir: -1 | 1, a: number, phase: number) => {
      const px: number[] = [];
      const py: number[] = [];
      const k1 = (railY - forkY) * OUT_HANDLE;
      const k2 = spread * IN_HANDLE;
      const bx = cx + dir * spread; // where the branch meets the flat run
      const exX = dir < 0 ? -w * EXIT_X : w * (1 + EXIT_X);

      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        px.push(bez(cx, cx, bx - dir * k2, bx, t));
        py.push(bez(forkY, forkY + k1, railY, railY, t));
      }
      /* and then straight out of the frame. Carried a little past the
         edge so the run is cut by the window rather than ending in it. */
      for (let i = 1; i <= 90; i++) {
        const t = i / 90;
        px.push(bx + (exX - bx) * t);
        py.push(railY - swing(t, a, phase));
      }
      return { px, py };
    };

    const buildYt = (a: number, phase: number) => {
      const s = sidePath(1, a, phase);
      ytP = resample(s.px, s.py);
    };

    const measure = () => {
      const r = host.getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      w = Math.round(r.width);
      h = Math.round(r.height);
      /* the surface is taller than the layout box by exactly the reach
         the stem takes over the sheet's lip; every y below is in canvas
         space and carries that offset, but the tags are hung off the
         host box and do not */
      over = Math.max(0, Math.round(c.height) - h);
      if (!w || !h) return;

      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round((h + over) * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      cx = w / 2;
      forkY = over + h * FORK_Y;
      railY = over + h * RAIL_Y;
      spread = Math.min(w * SPREAD, (railY - forkY) * 1.15, SPREAD_MAX);
      sx = cx + spread;
      ex = w * (1 + EXIT_X); // the ember run ends just past the frame
      const span = ex - sx;
      /* both the count of waves and their height come off the RAIL's
         length, not the drawing's: sized off the height, a phone's 150px
         rail carried a desktop's swing and came out as a spike */
      cycles = Math.max(1.3, Math.min(3, span / 230));
      /* a real ripple, not a bulge — the flat run is the one place on the
         page where "this one moves" has to be legible at a glance */
      ampMax = Math.min(h * 0.11, span * 0.09, 28);
      /* every band width on the drawing is a multiple of this, so the
         whole thing scales as one object rather than as parts */
      unit = Math.max(8, Math.min(h * 0.075, w * 0.03, 26));
      throat = unit * 0.34;

      /* the stream starts at the very top of the surface — which is
         already up inside the section's padding — and its gradient
         fades it in from nothing there */
      stem = resample([cx, cx], [0, forkY]);

      /* the certain half is built once and never touched again, which is
         the whole of what "fixed" means here */
      const pt0 = sidePath(-1, 0, 0);
      ptP = resample(pt0.px, pt0.py);
      buildYt(amp, 0);

      host.style.setProperty("--rail", `${railY - over}px`);
      /* The tags hang under their own run, inset from the frame — and
         clear of BOTH streams' envelopes. A fixed offset put the ember
         label inside the wave's troughs, which now swing a good deal
         further than the band is wide. */
      host.style.setProperty("--tag-l", `${w * TAG_X}px`);
      host.style.setProperty("--tag-r", `${w * TAG_X}px`);
      host.style.setProperty("--tag-drop", `${Math.round(ampMax + unit * 0.75 + 12)}px`);
    };

    /* ---------- painting ---------- */

    /* Width of a band at t along it — this is what gives the stream mass,
       and the shape of it is the whole junction.

       Everything PINCHES at the node. Carried at full width into it, the
       stem ended in a flat 34px face and the rails began at one, so the
       fork was three blunt shapes butted together. Squeezed to almost
       nothing there, the three meet at a point and the split reads as
       one body being divided rather than as a diagram of one.

       Off the node each rail swells and then tapers away again, so it
       leaves the drawing by thinning out rather than by being cut. */
    const widthAt = (kind: "stem" | "pt" | "yt", t: number) => {
      /* the stem arrives wide off the top of the surface — where its own
         gradient has already faded it to nothing, so the cut never shows
         — and narrows into the throat */
      if (kind === "stem") return throat + (unit * 0.95 - throat) * (1 - Math.pow(t, 1.4));
      /* the certain half is the body of the deposit and is drawn like it;
         the variable half is the sliver that makes up for it in speed.
         Each leaves the throat, swells, and then thins away to nothing
         rather than being cut off at the edge of the drawing. */
      const peak = unit * (kind === "pt" ? 1.3 : 0.72);
      const swell = throat + (peak - throat) * Math.sin(Math.PI * Math.pow(t, 0.72));
      return swell * Math.min(1, (1 - t) / 0.1);
    };

    /* The stream fades OUT along its run; the stem is the one that fades
       IN, because it is arriving from off the top of the drawing rather
       than leaving toward the edge of it. Run the same way round as the
       rails, the deposit was solid where it came from nowhere and thin
       where it reached the node. */
    const grad = (poly: Poly, k: number, color: string, into: boolean) => {
      const { xs, ys } = poly;
      const g = ctx.createLinearGradient(xs[0], ys[0], xs[k - 1], ys[k - 1]);
      if (into) {
        g.addColorStop(0, "transparent");
        g.addColorStop(0.55, color);
        g.addColorStop(1, color);
      } else {
        g.addColorStop(0, color);
        g.addColorStop(0.62, color);
        g.addColorStop(1, "transparent");
      }
      return g;
    };

    /* Two passes: a wide faint one for the light the stream throws, then
       the body. Done with width rather than ctx.filter — a canvas blur on
       three ribbons every frame is a real cost outside Chromium, and a
       swollen low-alpha copy reads the same. */
    /* The ember is a brighter hue than the green and spills further for
       the same alpha, so on the dark theme it read as the hotter of the
       two when they should sit level. It carries a little less weight —
       which is also on-message, it being the 0.0332 sliver. */
    const WEIGHT = { stem: 1, pt: 1, yt: 0.82 } as const;

    const ribbon = (
      poly: Poly,
      kind: "stem" | "pt" | "yt",
      k: number,
      color: string,
      into = false,
    ) => {
      if (k < 2) return;
      const { xs, ys, nx, ny } = poly;
      const g = grad(poly, k, color, into);
      const pass = (swell: number, alpha: number) => {
        ctx.beginPath();
        for (let i = 0; i < k; i++) {
          const hw = widthAt(kind, i / (N - 1)) * 0.5 * swell;
          const x = xs[i] + nx[i] * hw;
          const y = ys[i] + ny[i] * hw;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        for (let i = k - 1; i >= 0; i--) {
          const hw = widthAt(kind, i / (N - 1)) * 0.5 * swell;
          ctx.lineTo(xs[i] - nx[i] * hw, ys[i] - ny[i] * hw);
        }
        ctx.closePath();
        ctx.fillStyle = g;
        ctx.globalAlpha = alpha;
        ctx.fill();
      };
      /* Six passes, not three. Three left three visible edges stacked
         inside each other — a banded shape rather than a soft one. Six
         on a curved alpha ramp accumulate into a band that has no edge
         at all, which is what stops it reading as a printed ribbon.

         The alphas are about half what they were: the spill is what made
         this read as a neon tube on the dark theme rather than as
         something belonging to a page of hairlines. */
      for (let i = 0; i < 6; i++) {
        const f = i / 5;
        pass(P.swell - (P.swell - 1) * f, (P.a0 + P.a1 * Math.pow(f, 2.2)) * WEIGHT[kind]);
      }
      ctx.globalAlpha = 1;
    };

    const centreline = (
      poly: Poly,
      k: number,
      color: string,
      lw: number,
      into = false,
    ) => {
      if (k < 2) return;
      const { xs, ys } = poly;
      ctx.beginPath();
      ctx.moveTo(xs[0], ys[0]);
      for (let i = 1; i < k; i++) ctx.lineTo(xs[i], ys[i]);
      ctx.strokeStyle = grad(poly, k, color, into);
      ctx.lineWidth = lw;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = P.line;
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    const dots = (
      poly: Poly,
      kind: "stem" | "pt" | "yt",
      list: Dot[],
      color: string,
      k: number,
      time: number,
      r: number,
    ) => {
      const { xs, ys, nx, ny } = poly;
      const kt = (k - 1) / (N - 1);
      ctx.beginPath();
      for (const d of list) {
        // nothing exists past the front of the draw
        if (d.u > kt) continue;
        const i = Math.min(N - 1, Math.max(0, Math.round(d.u * (N - 1))));
        const hw = widthAt(kind, d.u) * 0.5;
        /* the variable side wanders across its band; the certain side
           holds the lane it was born in, for ever */
        const lane =
          kind === "yt" ? d.lane + Math.sin(time * 1.9 + d.ph) * 0.42 : d.lane;
        const off = lane * hw;
        const x = xs[i] + nx[i] * off;
        const y = ys[i] + ny[i] * off;
        /* fade at both ends of the run and at the front of the draw, so
           nothing ever pops into or out of existence */
        const a =
          Math.min(1, d.u / (kind === "stem" ? 0.3 : 0.08)) *
          Math.min(1, (1 - d.u) / (kind === "stem" ? 0.12 : 0.24)) *
          Math.min(1, (kt - d.u) / 0.06);
        if (a <= 0.02) continue;
        /* the traffic is drawn in ink on paper, where the same alpha
           carries far more than a spark of light does on black — so it
           stands down a little, or the certain rail reads as a dotted
           rule rather than as four lanes moving */
        ctx.globalAlpha = a * (kind === "yt" ? 0.55 : 0.44) * P.dot;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
        // batched per stream: one fill for the whole population
        ctx.fillStyle = color;
        ctx.fill();
        ctx.beginPath();
      }
      ctx.globalAlpha = 1;
    };

    const node = (lit: number, time: number) => {
      if (lit <= 0.01) return;
      ctx.globalAlpha = lit;
      const bloom = ctx.createRadialGradient(cx, forkY, 0, cx, forkY, unit * 2.6);
      bloom.addColorStop(0, usdcInk);
      bloom.addColorStop(1, "transparent");
      ctx.globalAlpha = lit * P.bloom;
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(cx, forkY, unit * 2.6, 0, TAU);
      ctx.fill();

      // the one ring, thrown as the split completes
      if (fired && pulse < 1) {
        const e = easeOut(pulse);
        ctx.globalAlpha = (1 - pulse) * (onPaper ? 0.3 : 0.17) * lit;
        ctx.strokeStyle = usdcInk;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, forkY, unit * 0.4 + e * unit * 1.7, 0, TAU);
        ctx.stroke();
      }

      ctx.globalAlpha = lit;
      ctx.fillStyle = usdcInk;
      ctx.beginPath();
      ctx.arc(cx, forkY, throat * 0.45 + 0.8, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      void time;
    };

    const draw = (time: number) => {
      if (!stem || !ptP || !ytP) return;
      ctx.clearRect(0, 0, w, h + over);

      const ps = easeOut(clamp01(p / 0.34));
      const pb = easeOut(clamp01((p - 0.26) / 0.52));
      const kStem = Math.round(ps * (N - 1)) + 1;
      const kRail = Math.round(pb * (N - 1)) + 1;

      // the pool of light the fork throws into the page around it
      if (p > 0.02) {
        const rad = Math.min(w * 0.3, 440);
        const pool = ctx.createRadialGradient(cx, forkY + unit, 0, cx, forkY + unit, rad);
        pool.addColorStop(0, usdcInk);
        pool.addColorStop(1, "transparent");
        ctx.globalAlpha = P.pool * clamp01(p * 1.4);
        ctx.fillStyle = pool;
        ctx.fillRect(0, 0, w, h + over);
        ctx.globalAlpha = 1;
      }

      ribbon(stem, "stem", kStem, usdc, true);
      ribbon(ptP, "pt", kRail, accent);
      ribbon(ytP, "yt", kRail, ember);

      /* the ribbons carry the hue, the lines and the traffic carry the
         ink — on paper those are two different colours */
      centreline(stem, kStem, usdcInk, 1.5, true);
      centreline(ptP, kRail, accentInk, 1.7);
      centreline(ytP, kRail, emberInk, 1.2);

      dots(stem, "stem", stemDots, usdcInk, kStem, time, 0.95);
      dots(ptP, "pt", ptDots, accentInk, kRail, time, 0.95);
      dots(ytP, "yt", ytDots, emberInk, kRail, time, 0.95);

      node(clamp01((p - 0.28) * 5), time);
    };

    /* ---------- the clocks ---------- */

    const readScroll = () => {
      const r = host.getBoundingClientRect();
      const vh = innerHeight;
      const c = r.top + r.height / 2;
      const from = vh * 0.98;
      const to = vh * 0.42;
      p = clamp01((from - c) / (from - to));
      host.dataset.on = p > 0.62 ? "true" : "false";
      if (still) draw(0);
    };

    const frame = (now: number) => {
      sceneRaf = 0;
      if (!t0) {
        t0 = now;
        last = now;
      }
      const time = (now - t0) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      /* The ripple used to be gated on the draw being COMPLETE. That was
         fine when this was a band 300px tall, but the stream now runs
         most of a screen, so p only reaches 1 once the section is
         halfway up the viewport — which left the ember rail sitting dead
         straight for most of the time it was actually on screen. It read
         as wiggling only sometimes.

         It now comes alive as the rail draws and stays alive for as long
         as the section is in view, which is what the rail is for: the
         variable half is turbulent from the moment it exists. */
      amp += (ampMax * easeOut(clamp01((p - 0.26) / 0.28)) - amp) * 0.055;
      buildYt(amp, time * 1.15);

      /* the node's one ring still waits for the split to be made, but at
         0.92 rather than 0.995 — on a stream this tall the last half a
         percent of the draw is a long way further down the page */
      const done = p >= 0.92;
      if (done && !fired) {
        fired = true;
        pulse = 0;
      }
      if (!done && p < 0.85) fired = false;
      if (fired && pulse < 1) pulse = Math.min(1, pulse + dt / 0.95);

      /* The two temperaments. The certain side runs at one speed and has
         never run at any other; the variable side is quick and is never
         quite doing the same thing twice. */
      for (const d of stemDots) d.u = (d.u + dt * 0.34) % 1;
      for (const d of ptDots) d.u = (d.u + dt * 0.13) % 1;
      for (const d of ytDots) {
        d.sp = 0.33 + Math.sin(time * 1.7 + d.ph) * 0.16;
        d.u = (d.u + dt * d.sp) % 1;
      }

      draw(time);
      sceneRaf = requestAnimationFrame(frame);
    };

    const onScroll = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          readScroll();
        });
    };

    readTokens();
    measure();
    readScroll();

    /* Reduced motion: the split is already made, the ember band carries a
       fixed ripple rather than a moving one, and nothing is ever redrawn. */
    if (still) {
      p = 1;
      host.dataset.on = "true";
      buildYt(ampMax * 0.75, 0);
      draw(0);
      const roStill = new ResizeObserver(() => {
        measure();
        buildYt(ampMax * 0.75, 0);
        draw(0);
      });
      roStill.observe(host);
      return () => roStill.disconnect();
    }

    const ro = new ResizeObserver(() => {
      measure();
      draw(0);
    });
    ro.observe(host);
    addEventListener("scroll", onScroll, { passive: true });

    /* the palette is read off the tokens, so a theme flip has to re-read */
    const themes = new MutationObserver(readTokens);
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    /* nothing runs while the drawing is off screen */
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !sceneRaf) {
          t0 = 0;
          sceneRaf = requestAnimationFrame(frame);
        } else if (!e.isIntersecting && sceneRaf) {
          cancelAnimationFrame(sceneRaf);
          sceneRaf = 0;
        }
      },
      { threshold: 0 },
    );
    io.observe(host);

    return () => {
      ro.disconnect();
      io.disconnect();
      themes.disconnect();
      removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      if (sceneRaf) cancelAnimationFrame(sceneRaf);
    };
  }, []);

  return (
    /* decorative: the statement directly underneath says all of this in
       words, and a screen reader should hear it once */
    <div ref={hostRef} className="flow" aria-hidden="true">
      <canvas className="flow-canvas" />
      <span className="flow-tag flow-tag-pt">
        <span className="flow-tag-dot" />
        PT&nbsp;&middot;&nbsp;<span className="flow-tag-long">fixed return</span>
        <span className="flow-tag-short">fixed</span>
      </span>
      <span className="flow-tag flow-tag-yt">
        <span className="flow-tag-dot" />
        YT&nbsp;&middot;&nbsp;<span className="flow-tag-long">leveraged yield</span>
        <span className="flow-tag-short">leveraged</span>
      </span>
    </div>
  );
}
