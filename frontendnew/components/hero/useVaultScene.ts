"use client";

import { useEffect, useRef } from "react";
import { SERIES, fmtInt } from "@/lib/series";

/* ---------- pure helpers ---------- */

const TAU = Math.PI * 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
/** quintic — zero velocity AND zero acceleration at both ends */
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

const EMBER: [number, number, number] = [255, 138, 74];
const GREEN: [number, number, number] = [43, 216, 148];

function lerpColor(a: number[], b: number[], t: number) {
  const c = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `rgb(${c(0)},${c(1)},${c(2)})`;
}
function rgba(c: number[], a: number) {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

/* ---------- the dial: a vault door too big for its frame ----------

   Only the flanks of the rim sit inside the stage, so every bright
   thing the dial does (ticks, the engraved market scale, the bolts,
   the closing sweep) happens well clear of the headline. The market
   scale turns while the rate drifts and parks 8.42 under the index
   the moment the lock completes.                                     */

/* The scale is a rate band, not an hour face. Twelve numerals evenly
   spaced round a ring is a watch, whatever the numbers say — so this is
   24 even graduations of 0.25, and only the ones inside the flank
   windows are ever lettered. Nothing sits at 12, 3, 6 or 9, which is
   what was reading as a clock. */
const DIAL_SLOTS = 24;
const DIAL_STEP = 0.25;
/** the graduation the rate parks under — the ring's zero */
const LOCK_SLOT = 12;
const DIAL_START = SERIES.rate - LOCK_SLOT * DIAL_STEP;
const SLOT = TAU / DIAL_SLOTS;
/** half-width of the lettered reading window, in radians — kept tight so
    no numeral climbs toward the top of the frame and the headline */
const FLANK = 0.66;
/* Seconds for the ring to close most of a gap to the live rate. Long,
   deliberately: at 2.2s the fast term of the wobble is damped to under a
   quarter and only the 11-second swell gets through, so the scale
   breathes rather than turns. The dial is meant to be the calm thing
   the scroll acts on, not something busy on its own. */
const DIAL_DAMP = 2.2;

/** where the ring must sit for a given rate to read under the index */
const angleForRate = (v: number, windowA: number) =>
  windowA - ((v - DIAL_START) / DIAL_STEP) * SLOT;

/* Where the dial sits — a different composition per orientation, because
   the two frames offer different space.
   Landscape has room BESIDE the type: the dial is huge and centred, the
   headline sits over its quiet core, and you read it off a flank.
   Portrait has no "beside". A circle centred behind centred type puts
   every concentric ring straight through it — measured on a 390: the
   type block runs y 200..523 and the plate walls crossed it at 205, 262,
   and 490. So on portrait the dial is pushed below the frame and only
   its crown shows: a wide, shallow terrace across the bottom, clear of
   the type, filling the 185px band that was empty. The reading window
   moves to the crown with it, so the one part on screen is the part
   that does the reading. */
function dialGeometry(W: number, H: number, lockT: number) {
  if (W >= 760) {
    return {
      R: Math.min(W * 0.4, 600), cx: W / 2, cy: H / 2,
      windowA: 0, flank: FLANK, ink: 1, seal: 1,
    };
  }
  /* On a phone the only part of the instrument on screen is its crown, so
     the lock has to be felt THERE. The terrace climbs toward the type and
     the dial swells as the bolts throw — a movement of the whole horizon
     rather than detail work inside a rim you cannot see. */
  const R = W * 0.71 * (1 + 0.055 * lockT);
  const rise = Math.min(30, H * 0.045) * lockT;
  return {
    R,
    cx: W / 2,
    // crown at 74.5% down the stage: below the buttons, above the hint
    cy: H * 0.745 - rise + R,
    windowA: -Math.PI / 2,
    /** the seal is the lock's signature and it draws across the crown —
        the one place a phone can see it, so it is drawn heavier there */
    seal: 1.7,
    /* A narrower reading window and lighter graduations. On the crown
       the scale sits dead centre under the type, where five numerals and
       a full-strength tick ring made the bottom third busier than the
       top third is empty. Three numerals read as a reading; five read as
       a gauge competing with the headline. */
    flank: 0.44,
    ink: 0.72,
  };
}
type DialGeo = ReturnType<typeof dialGeometry>;

/** how lit a bearing is — squared, so the highlight has a hot core */
function litAt(a: number, lightA: number) {
  const d = (Math.cos(a - lightA) + 1) / 2;
  return d * d;
}

/** shortest signed distance from an angle to zero */
function wrapPi(v: number) {
  return Math.atan2(Math.sin(v), Math.cos(v));
}

/* The arrival wipe. A single leading edge starts at the reading window
   and sweeps once round the dial, so the instrument draws itself into
   existence from the point it is read at rather than fading up whole.
   Returns how far past a given bearing the edge has travelled. */
function wipeAlpha(screen: number, from: number, t: number) {
  if (t >= 1) return 1;
  let d = (screen - from) % TAU;
  if (d < 0) d += TAU;
  // 0.16 of a turn of soft edge, so the front is a gradient not a knife
  return clamp01((t - d / TAU) / 0.16);
}

/* A ring drawn as arc segments whose alpha rides the angle to the light.
   One flat stroke is a circle; this is turned metal. */
function litRing(
  ctx: CanvasRenderingContext2D,
  r: number, base: number, gain: number,
  lightA: number, width: number, segs: number,
  wipeFrom = 0, wipeT = 1,
) {
  const step = TAU / segs;
  ctx.lineWidth = width;
  for (let i = 0; i < segs; i++) {
    const a0 = i * step;
    const mid = a0 + step / 2;
    const w = wipeAlpha(mid, wipeFrom, wipeT);
    if (w <= 0.01) continue;
    ctx.beginPath();
    // 1.06 overlaps each segment into the next so no seam shows
    ctx.arc(0, 0, r, a0, a0 + step * 1.06);
    ctx.strokeStyle = `rgba(250,250,248,${(base + gain * litAt(mid, lightA)) * w})`;
    ctx.stroke();
  }
}

/* A machined step between two plates. A bevel is only ever two things:
   a lip that catches the light on one side, and the shadow it throws on
   the other. Offsetting those two arcs a couple of pixels apart along
   the light axis is the whole trick — and because each segment's alpha
   also rides the bearing, the highlight dies out where the light no
   longer reaches instead of ringing the circle uniformly. */
function stepEdge(
  ctx: CanvasRenderingContext2D,
  r: number, lightA: number,
  hi: number, lo: number, width: number, segs: number,
) {
  const d = Math.max(1, r * 0.005);
  const dx = Math.cos(lightA) * d, dy = Math.sin(lightA) * d;
  const step = TAU / segs;
  ctx.lineWidth = width;
  for (let i = 0; i < segs; i++) {
    const a0 = i * step;
    const l = litAt(a0 + step / 2, lightA);
    ctx.beginPath();
    ctx.arc(dx, dy, r, a0, a0 + step * 1.06);
    ctx.strokeStyle = `rgba(255,255,252,${hi * l})`;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-dx, -dy, r, a0, a0 + step * 1.06);
    ctx.strokeStyle = `rgba(0,0,0,${lo * (1 - l)})`;
    ctx.stroke();
  }
}

/* The surface of one plate: a flat wash graded along the light axis, so
   the disc reads as a face turned toward something rather than a hole. */
function plate(
  ctx: CanvasRenderingContext2D,
  rOut: number, rIn: number, lightA: number,
  top: number, bottom: number,
) {
  const g = ctx.createLinearGradient(
    Math.cos(lightA) * rOut, Math.sin(lightA) * rOut,
    -Math.cos(lightA) * rOut, -Math.sin(lightA) * rOut,
  );
  g.addColorStop(0, `rgba(250,250,248,${top})`);
  g.addColorStop(1, `rgba(250,250,248,${bottom})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rOut, 0, TAU);
  ctx.arc(0, 0, rIn, 0, TAU, true); // reverse winding punches the middle out
  ctx.fill();
}

/* The plates sit at real depths and are drawn through a real perspective
   divide, so a deeper plate is projected smaller. That is what turns
   four concentric bands into a stepped well receding into the frame —
   without it the stack is flat however carefully it is lit.
   Normalised on the bezel, so the outer silhouette never changes size. */
const FOCAL = 900;
/** resting depths; the lock compresses them, so the live values are
    derived per frame inside drawDial rather than read straight from here.
    Widened from 110/70/36/14 — the walls those produced were thin enough
    that the stack read as tone rather than as steps. */
const LAYER_Z = { bezel: 132, scale: 84, mid: 43, core: 16 };

/* Pointer travel, now barely there. The depth is carried by the
   projection and the walls, which are present whether or not there is a
   cursor on the page; this is only enough to confirm the stack is a
   stack. Anything more competes with the scroll for attention. */
const PAR_X = 6;
const PAR_Y = 4;
/** seconds for the pointer to catch up — long, so the stack drifts */
const POINT_DAMP = 0.45;
/** how much of the depth closes up as the lock seats — over half, so the
    well visibly presses flush rather than merely tightening */
const SEAT_CLOSE = 0.58;

/** plate boundaries, as fractions of the dial radius */
const R_BEZEL_IN = 0.955;
const R_SCALE_IN = 0.6;
const R_MID_IN = 0.34;

/* The wall of a step: the band between one plate's inner edge and the
   next plate's outer edge. Because the two circles have different
   centres and different projected radii, the band is naturally
   eccentric — wider on the far side — which is exactly what looking
   into a stepped well at a slight angle does. Nothing else on the dial
   changes shape as the pointer moves; this does. */
function wall(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number, oR: number,
  ix: number, iy: number, iR: number,
  lightA: number, hi: number, lo: number,
) {
  if (oR - iR < 0.4) return;
  ctx.beginPath();
  ctx.arc(ox, oy, oR, 0, TAU);
  ctx.arc(ix, iy, iR, 0, TAU, true);
  const g = ctx.createLinearGradient(
    ox + Math.cos(lightA) * oR, oy + Math.sin(lightA) * oR,
    ox - Math.cos(lightA) * oR, oy - Math.sin(lightA) * oR,
  );
  /* The shadow reaches for the stage's own black rather than a pure one.
     Against moving colour, a hard black band reads as something stuck on
     top of the picture; this reads as the picture being in shadow. */
  g.addColorStop(0, `rgba(255,255,252,${hi})`);
  g.addColorStop(0.46, "rgba(10,10,9,0.2)");
  g.addColorStop(1, `rgba(10,10,9,${lo})`);
  ctx.fillStyle = g;
  ctx.fill();
}

/* Ambient occlusion at the foot of a wall — the surface below a step is
   darkened where the step overhangs it. This is the cue that was
   missing: without it two plates read as two flat rings that merely
   differ in tone, however carefully the wall between them is graded.
   The gradient's centre is pushed toward the light, so the band is thin
   on the lit side and thick opposite, which is what an overhang does. */
function contact(
  ctx: CanvasRenderingContext2D,
  rOut: number, feather: number, lightA: number, strength: number,
) {
  const off = feather * 0.55;
  const ox = Math.cos(lightA) * off, oy = Math.sin(lightA) * off;
  const g = ctx.createRadialGradient(ox, oy, Math.max(0, rOut - feather), ox, oy, rOut);
  g.addColorStop(0, "rgba(6,6,5,0)");
  g.addColorStop(1, `rgba(6,6,5,${strength})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rOut, 0, TAU);
  ctx.arc(0, 0, Math.max(0, rOut - feather * 1.7), 0, TAU, true);
  ctx.fill();
}

function drawDial(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  lockT: number, rot: number,
  mx: number, my: number,
  monoFont: string,
  t: number,
  /** what the index is reading — the numerals are lettered off it */
  rate: number,
  geo: DialGeo,
  /** 0 → 1 as the instrument arrives on load */
  birth: number,
) {
  const { R, cx, cy, windowA } = geo;
  /* the pointer's say all but disappears once locked — from there the
     scroll owns everything the dial does */
  const par = 1 - lockT * 0.8;
  const wide = W >= 760;

  /* One light, high and to the left. It breathes on a ~90s cycle, which
     is slow enough to read as ambient rather than as animation, and the
     scroll rakes it a further 50° across the face as the lock closes —
     so the biggest change in how this thing is lit is something you do,
     not something it does. */
  /* ...and during the arrival it rakes ~90 degrees into place, so the
     highlight travels round the rim as the instrument resolves. */
  const lightA =
    -TAU * 0.3 + Math.sin(t * 0.07) * 0.26 + mx * 0.07 + lockT * 0.9 + (1 - birth) * 1.6;

  /* The stack seats as it locks: the gaps between the plates close by a
     third, the walls narrow, and the well presses flush the way a door
     does when the bolts throw. Depth is therefore something the scroll
     works on rather than a fixed decoration. */
  const seat = 1 - SEAT_CLOSE * lockT;
  const Z = {
    bezel: LAYER_Z.bezel * seat,
    scale: LAYER_Z.scale * seat,
    mid: LAYER_Z.mid * seat,
    core: LAYER_Z.core * seat,
  };
  /* re-normalised on the seated bezel, so the outer silhouette holds
     still while everything inside it closes up */
  const sz = (z: number) => (FOCAL - Z.bezel) / (FOCAL - z);

  /* Four plates at four depths, drawn back to front. Each is projected
     for its depth and slides its own share of the pointer travel. */
  const px = (z: number) => cx + mx * PAR_X * (z / Z.bezel) * par;
  const py = (z: number) => cy + my * PAR_Y * (z / Z.bezel) * par;
  /** a radius on plate z, in canvas space */
  const rz = (z: number, frac: number) => R * frac * sz(z);

  /* The instrument assembles rather than appearing. The bezel resolves
     first and each plate under it follows a beat later, so the stack
     builds outward-in — the same order it would be machined in — while
     the whole thing settles out of a slight over-scale. */
  const born = (d: number) => smooth(clamp01((birth - d) / (1 - d)));

  const at = (z: number, fn: () => void, delay = 0) => {
    ctx.save();
    ctx.globalAlpha *= born(delay);
    ctx.translate(px(z), py(z));
    ctx.scale(sz(z), sz(z));
    fn();
    ctx.restore();
  };

  /** the wall dropping from plate `from` down to plate `to` */
  const step = (fromZ: number, fromFrac: number, toZ: number, toFrac: number, hi: number, lo: number) =>
    wall(
      ctx,
      px(fromZ), py(fromZ), rz(fromZ, fromFrac),
      px(toZ), py(toZ), rz(toZ, toFrac),
      lightA, hi, lo,
    );

  const ring = (r: number, a: number, dash?: number[]) => {
    ctx.save();
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.strokeStyle = `rgba(250,250,248,${a})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  };

  const STEP_SEGS = wide ? 48 : 28;

  ctx.save();
  if (birth < 1) {
    ctx.globalAlpha = birth;
    const s = 1.055 - 0.055 * birth;
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.translate(-cx, -cy);
  }

  /* ---------- plate 4: the core, deepest and dimmest ---------- */
  at(Z.core, () => {
    // no ring inside the core: it sat under the headline and only ever
    // added one more circle to count
    plate(ctx, R * R_MID_IN, 0, lightA, 0.02, 0.004);
    contact(ctx, R * R_MID_IN, R * 0.05, lightA, 0.4);
  }, 0.34);

  /* ---------- the wall down from the mid plate ---------- */
  step(Z.mid, R_MID_IN, Z.core, R_MID_IN, 0.05, 0.34);

  /* ---------- plate 3: the mid plate ---------- */
  at(Z.mid, () => {
    plate(ctx, R * R_SCALE_IN, R * R_MID_IN, lightA, 0.026, 0.005);
    contact(ctx, R * R_SCALE_IN, R * 0.06, lightA, 0.44);
    stepEdge(ctx, R * R_MID_IN, lightA, 0.045, 0.22, 1, STEP_SEGS);
    /* an inner ring running the other way: differential motion is what
       machinery looks like, and it costs one dashed circle */
    ctx.save();
    ctx.rotate(-rot * 0.45);
    ring(R * 0.5, 0.045, [2, 9]);
    ctx.restore();
  }, 0.22);

  step(Z.scale, R_SCALE_IN, Z.mid, R_SCALE_IN, 0.06, 0.4);

  /* ---------- plate 2: the scale, where the numbers live ---------- */
  at(Z.scale, () => {
    plate(ctx, R * R_BEZEL_IN, R * R_SCALE_IN, lightA, 0.032, 0.007);
    /* the deepest occlusion on the dial: the bezel is the tallest thing
       overhanging anything, so it darkens the most of what is under it */
    contact(ctx, R * R_BEZEL_IN, R * 0.075, lightA, 0.5);
    stepEdge(ctx, R * R_SCALE_IN, lightA, 0.055, 0.26, 1.2, STEP_SEGS);
    /* the ring that used to sit at 0.86R is gone: the ticks are already
       drawing a circle a few pixels outside it, and two concentric lines
       that close together read as clutter rather than as machining */
    drawScale(ctx, R, rot, lockT, lightA, rate, monoFont, windowA, geo.flank, geo.ink, birth);
    drawBolts(ctx, R, lockT, lightA);
  }, 0.11);

  /* the deepest drop on the dial, and the one that does most of the
     work — it is the widest wall and it rims the whole reading face */
  step(Z.bezel, R_BEZEL_IN, Z.scale, R_BEZEL_IN, 0.075, 0.36);

  /* ---------- plate 1: the bezel, nearest the viewer ---------- */
  at(Z.bezel, () => {
    plate(ctx, R, R * R_BEZEL_IN, lightA, 0.052, 0.01);

    /* The fill's outer edge dissolves instead of ending on a hard circle,
       so the dial sits in the frame rather than on top of it. Only the
       fill is feathered — the milling, the rim and the index are all
       drawn after this and stay crisp. */
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    const feather = ctx.createRadialGradient(0, 0, R * 0.968, 0, 0, R * 1.004);
    feather.addColorStop(0, "rgba(0,0,0,0)");
    feather.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = feather;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.01, 0, TAU);
    ctx.fill();
    ctx.restore();

    /* Knurling: the band of fine milling round the rim. Dense and short,
       so it reads as a milled surface rather than as graduations — which
       is why it is the one thing narrow screens keep. It drags at a
       third of the scale's rate so the two surfaces stay separate. */
    const KNURL = 144;
    ctx.lineWidth = 1;
    for (let i = 0; i < KNURL; i++) {
      const a = (i / KNURL) * TAU + rot * 0.34;
      const cos = Math.cos(a), sin = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(cos * R * 0.998, sin * R * 0.998);
      ctx.lineTo(cos * R * R_BEZEL_IN, sin * R * R_BEZEL_IN);
      ctx.strokeStyle = `rgba(250,250,248,${0.012 + 0.075 * litAt(a, lightA)})`;
      ctx.stroke();
    }

    /* the rim carries the most gain of anything here: it is the furthest
       element from the type, so it can be the brightest without competing */
    litRing(ctx, R, 0.028, 0.155, lightA, 1.2, 72, windowA, birth);
    /* the deep step from bezel down to the scale — the strongest shadow
       on the dial, because it is the biggest drop */
    stepEdge(ctx, R * R_BEZEL_IN, lightA, 0.075, 0.34, 1.4, STEP_SEGS);

    /* one specular streak where the light actually strikes the rim */
    ctx.save();
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,255,252,0.13)";
    ctx.shadowColor = "rgba(255,255,252,0.32)";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.9775, lightA - 0.16, lightA + 0.16);
    ctx.stroke();
    ctx.restore();

    drawIndex(ctx, R, lockT, windowA);
    drawSeal(ctx, R, lockT, geo.seal);
  });

  ctx.restore();
}

/* the turning scale: ticks, then numerals in the reading window */
function drawScale(
  ctx: CanvasRenderingContext2D,
  R: number, rot: number, lockT: number, lightA: number,
  rate: number, monoFont: string, windowA: number,
  flank: number, ink: number, birth: number,
) {
  ctx.save();
  ctx.rotate(rot);

  /* Graduations run in both compositions now. They were switched off on
     narrow frames because a ring of ticks with no index and no numerals
     is just a clock — but the crown window puts an index and its
     numerals right where the arc shows, so they read as a scale. */
  const TICKS = DIAL_SLOTS * 5;
  for (let i = 0; i < TICKS; i++) {
    const a = (i / TICKS) * TAU;
    const major = i % 5 === 0;
    const len = major ? R * 0.042 : R * 0.015;
    const cos = Math.cos(a), sin = Math.sin(a);
    const out = R * 0.945;
    // lit in screen space, not ring space — the light does not turn with it
    const l = litAt(a + rot, lightA);
    ctx.beginPath();
    ctx.moveTo(cos * out, sin * out);
    ctx.lineTo(cos * (out - len), sin * (out - len));
    const w = wipeAlpha(a + rot, windowA, birth);
    if (w <= 0.01) continue;
    ctx.strokeStyle = `rgba(250,250,248,${((major ? 0.14 : 0.05) + (major ? 0.16 : 0.06) * l) * ink * w})`;
    ctx.lineWidth = major ? 1.5 : 1;
    ctx.stroke();
  }

  /* Numerals only in the reading window on the right flank.
     Two things follow from that. The scale reads as one instrument
     being read at one place, instead of numbers ringing a face. And a
     wrapping scale has to put its seam somewhere: labelling off the
     shortest angle to the index leaves the 5.42/11.17 jump at exactly
     180°, the left flank, which is never lettered — so the seam simply
     does not exist on screen. */
  ctx.font = `500 ${Math.max(10, R * 0.027)}px ${monoFont}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < DIAL_SLOTS; i++) {
    const a = i * SLOT;
    // bearing measured from the reading window, wherever that sits
    const screen = wrapPi(a + rot - windowA);
    const off = Math.abs(screen);
    if (off > flank) continue;
    // fade at the window edge so numerals arrive rather than pop
    const fade =
      (1 - smooth(clamp01((off - flank * 0.55) / (flank * 0.45)))) *
      smooth(clamp01((birth - 0.55) / 0.45));
    if (fade <= 0.01) continue;
    /* the value this graduation carries, taken off its bearing from the
       index — algebraically the slot's own value, but on the branch
       nearest the reading */
    const v = rate + (screen * DIAL_STEP) / SLOT;
    const isLock = Math.abs(v - SERIES.rate) < DIAL_STEP * 0.4;
    ctx.save();
    /* 0.862, not 0.918: the graduations run from 0.945R inward to 0.903R
       for a major, so a numeral centred at 0.918R sat inside that band
       and every tick struck through it. This clears the majors' inner
       ends with room for the cap height. */
    ctx.translate(Math.cos(a) * R * 0.862, Math.sin(a) * R * 0.862);
    ctx.rotate(-rot); // numerals stay upright while the ring turns
    ctx.fillStyle = isLock
      ? rgba(GREEN, (0.3 + 0.6 * lockT) * fade)
      : `rgba(250,250,248,${0.3 * fade * ink * (1 - lockT * 0.5)})`;
    ctx.fillText(v.toFixed(2), 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/* the index marks: hairline notches fixed on both flanks, with the
   scale running underneath them */
function drawIndex(ctx: CanvasRenderingContext2D, R: number, lockT: number, windowA: number) {
  for (const a of [windowA, windowA + Math.PI]) {
    /* only the right-hand index is the one doing the reading — it is the
       one 8.42 parks under, so it is the only one that greens */
    const reading = a === windowA;
    const cos = Math.cos(a), sin = Math.sin(a);
    const tip = R * 0.95, back = R * 1.035, w = R * 0.0045;
    ctx.beginPath();
    ctx.moveTo(cos * tip, sin * tip);
    ctx.lineTo(cos * back - sin * w, sin * back + cos * w);
    ctx.lineTo(cos * back + sin * w, sin * back - cos * w);
    ctx.closePath();
    ctx.fillStyle = reading && lockT > 0.02
      ? rgba(GREEN, 0.3 + 0.45 * lockT)
      : "rgba(250,250,248,0.3)";
    ctx.fill();

    /* the reading window: two short arcs bracketing the index, so the
       flank looks like somewhere a value is taken rather than a notch */
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = reading
      ? rgba(GREEN, 0.1 + 0.3 * lockT)
      : "rgba(250,250,248,0.075)";
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.995, a + dir * 0.055, a + dir * 0.2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* the seal: two arcs run down the flanks and meet at the bottom */
function drawSeal(ctx: CanvasRenderingContext2D, R: number, lockT: number, boost: number) {
  if (lockT > 0.001) {
    ctx.save();
    ctx.lineWidth = (1.4 + 1.4 * lockT) * boost;
    ctx.lineCap = "round";
    ctx.strokeStyle = rgba(GREEN, Math.min(0.85, (0.24 + 0.34 * lockT) * boost));
    ctx.shadowColor = rgba(GREEN, 0.5);
    ctx.shadowBlur = (10 + 18 * lockT) * boost;
    const sweep = lockT * Math.PI;
    ctx.beginPath();
    ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + sweep);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, R, -Math.PI / 2 - sweep, -Math.PI / 2);
    ctx.stroke();
    ctx.restore();
  }
}

/* four bolts, riding their tracks and thrown home as it locks. They sit
   in a milled recess, so each one gets the pocket drawn under it — a
   bolt lying on a flat face is a lozenge; a bolt in a hole is hardware */
function drawBolts(ctx: CanvasRenderingContext2D, R: number, lockT: number, lightA: number) {
  const seat = smooth(lockT);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * (Math.PI / 2);
    const cos = Math.cos(a), sin = Math.sin(a);
    const from = R * 0.86, to = R * 0.735;
    const rr = from + (to - from) * seat;
    const w = R * 0.05, h = R * 0.016;

    /* the milled channel the bolt travels down, sunk into the plate */
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = h * 1.5;
    ctx.strokeStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath();
    ctx.moveTo(cos * from, sin * from);
    ctx.lineTo(cos * to, sin * to);
    ctx.stroke();
    // the lip of the channel, catching light on the near side
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(255,255,252,${0.03 + 0.07 * litAt(a, lightA)})`;
    ctx.beginPath();
    ctx.moveTo(cos * from, sin * from);
    ctx.lineTo(cos * to, sin * to);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(cos * rr, sin * rr);
    ctx.rotate(a);
    // the shadow the bolt casts into its own pocket
    ctx.beginPath();
    ctx.roundRect(-w / 2 + 1, -h / 2 + 1.5, w, h, h / 2);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fill();

    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
    const face = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    const body = seat > 0.02 ? lerpColor([250, 250, 248], GREEN, seat) : "rgb(250,250,248)";
    face.addColorStop(0, "rgba(255,255,252,0.95)");
    face.addColorStop(0.45, body);
    face.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = face;
    ctx.globalAlpha = 0.24 + 0.5 * seat;
    if (seat > 0.5) {
      ctx.shadowColor = rgba(GREEN, 0.55);
      ctx.shadowBlur = 12 * (seat - 0.5) * 2;
    }
    ctx.fill();
    ctx.restore();
  }
}

/* ---------- the drifting dust of variable yields ---------- */

const DUST_YIELDS = ["5.9%", "7.2%", "9.4%", "6.1%", "8.9%", "4.8%", "10.2%", "7.7%"];
const DUST_MARKS = ["✳", "+", "×"];

type Glyph = {
  type: "yield" | "mark" | "dot";
  text: string;
  x: number; y: number;
  vx: number; vy: number;
  /** click-shove impulse, decays each frame */
  ix: number; iy: number;
  depth: number;
  size: number;
  phase: number;
  flicker: number;
  color: "ember" | "blue" | "dim";
};

function makeGlyphs(W: number, H: number): Glyph[] {
  const glyphs: Glyph[] = [];
  const count = Math.round(Math.min(26, (W * H) / 62000));
  for (let i = 0; i < count; i++) {
    const roll = Math.random();
    const type = roll < 0.34 ? "yield" : roll < 0.6 ? "mark" : "dot";
    const depth = rnd(0.35, 1);
    glyphs.push({
      type,
      text: type === "yield" ? DUST_YIELDS[i % DUST_YIELDS.length] : DUST_MARKS[Math.floor(Math.random() * DUST_MARKS.length)],
      x: rnd(30, W - 30), y: rnd(30, H - 30),
      vx: (rnd(-6, 6) * depth) / 60,
      vy: (rnd(-4, 4) * depth) / 60,
      ix: 0, iy: 0,
      depth,
      size: type === "dot" ? rnd(1.4, 2.6) : rnd(11, 15) * depth,
      phase: Math.random() * 6.28,
      flicker: rnd(0.3, 0.9),
      color: Math.random() < 0.26 ? "ember" : Math.random() < 0.1 ? "blue" : "dim",
    });
  }
  return glyphs;
}

function glyphColor(g: Glyph, a: number) {
  if (g.color === "ember") return `rgba(255, 138, 74, ${a * 0.7})`;
  if (g.color === "blue") return `rgba(120, 160, 250, ${a * 0.65})`;
  return `rgba(250, 250, 248, ${a * 0.45})`;
}

/* ---------- exclusion zones: dust never dirties the content ---------- */

type Zone = { x1: number; y1: number; x2: number; y2: number };

const ZONE_SELECTORS: Array<[string, number]> = [
  [".hero-center", 56],
  [".plate", 30],
  [".hint", 26],
  [".kicker", 26],
  [".series", 26],
];

function measureZones(stage: HTMLElement): Zone[] {
  const sr = stage.getBoundingClientRect();
  const sx = sr.width / stage.offsetWidth || 1; // undo scroll-scale
  const zones: Zone[] = [];
  for (const [sel, pad] of ZONE_SELECTORS) {
    const el = stage.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    zones.push({
      x1: (r.left - sr.left) / sx - pad,
      y1: (r.top - sr.top) / sx - pad,
      x2: (r.right - sr.left) / sx + pad,
      y2: (r.bottom - sr.top) / sx + pad,
    });
  }
  return zones;
}

function zoneMul(zones: Zone[], px: number, py: number) {
  let m = 1;
  for (const r of zones) {
    const dx = Math.max(r.x1 - px, px - r.x2, 0);
    const dy = Math.max(r.y1 - py, py - r.y2, 0);
    const d = dx === 0 && dy === 0 ? 0 : Math.hypot(dx, dy);
    m = Math.min(m, 0.05 + 0.95 * Math.min(d / 110, 1));
  }
  return m;
}

/* ---------- the hook ---------- */

/**
 * Drives the whole vault scene imperatively (the engraved dial, the
 * drifting dust, the scroll-to-lock scrub, the rate wobble and the
 * live counters) against refs the Hero component pins to its markup.
 */
export function useVaultScene() {
  const scrubRef = useRef<HTMLDivElement>(null);
  const stageScaleRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const driftNumRef = useRef<HTMLDivElement>(null);
  const driftValRef = useRef<HTMLSpanElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const stageDimRef = useRef<HTMLDivElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);
  const ledgerRef = useRef<HTMLSpanElement>(null);
  const backingRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const scrub = scrubRef.current, stageScale = stageScaleRef.current,
      stage = stageRef.current, canvas = canvasRef.current,
      driftNum = driftNumRef.current, driftVal = driftValRef.current,
      hint = hintRef.current, plate = plateRef.current,
      stageDim = stageDimRef.current, halo = haloRef.current,
      ledgerEl = ledgerRef.current, backingEl = backingRef.current;
    if (!scrub || !stageScale || !stage || !canvas || !driftNum || !driftVal || !hint || !plate || !stageDim || !ledgerEl || !backingEl) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finePointer = matchMedia("(pointer: fine)").matches;
    const cleanups: Array<() => void> = [];

    /* the sheet lives outside this component (page layout), so reach for it */
    const sheet = document.querySelector<HTMLElement>(".sheet");

    /* ----- load choreography ----- */
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.body.classList.add("loaded");
        const t = setTimeout(() => document.body.classList.add("settled"), 1500);
        cleanups.push(() => clearTimeout(t));
      });
    });
    cleanups.push(() => {
      cancelAnimationFrame(raf1);
      document.body.classList.remove("loaded", "settled", "locked");
    });

    /* ----- scene state ----- */
    let W = 0, H = 0;
    /* The scrub is sized in vh, which on a phone means the LARGE viewport
       and never changes. innerHeight, read live, shrinks by 60-100px the
       moment the URL bar collapses — so progress would jump ~10% and the
       vault would visibly shift without the page having moved. Cache it,
       and only take a new one on a real resize: a width change, or a
       height change far bigger than any browser chrome. */
    let viewW = innerWidth;
    let viewH = innerHeight;
    /* below the breakpoint where the pin and the fan are switched off */
    let narrow = innerWidth < 900;
    let glyphs: Glyph[] = [];
    let zones: Zone[] = [];
    const mouse = { x: 0.5, y: 0.5 };
    /* what the scene actually uses — the raw pointer eased toward, so the
       stack drifts after the cursor instead of snapping to every jitter */
    const eased = { x: 0.5, y: 0.5 };
    let monoFont = '"Geist Mono", monospace';
    let progress = 0;
    let lockT = reduced ? 1 : 0;
    let isLocked = reduced;
    /* What the scale is currently showing. Not a free spin any more: the
       ring turns to put the live rate under the index, so the dial is
       the instrument the number is read off rather than decoration
       turning beside it. */
    let dialRate = SERIES.rate;
    /* what BOTH the ring and the readout display. They used to differ:
       the ring was damped and the number was not, so the scale sat up to
       a whole point away from the figure it is supposed to be reading.
       Invisible on desktop, where the numerals are small and off to one
       side; obvious on a phone, where the crown puts them under the
       type. One damped value now drives both. */
    let shownRate = SERIES.rate;
    let lastT = performance.now();

    const layout = () => {
      if (innerWidth !== viewW || Math.abs(innerHeight - viewH) > viewH * 0.3) {
        viewW = innerWidth;
        viewH = innerHeight;
      }
      narrow = innerWidth < 900;
      W = stage.offsetWidth;
      H = stage.offsetHeight;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      monoFont = getComputedStyle(document.documentElement).getPropertyValue("--ff-mono").trim() || monoFont;
      zones = measureZones(stage);
      glyphs = makeGlyphs(W, H);
    };

    const drawDust = (globalA: number, calm: number) => {
      const t = performance.now() / 1000;
      for (const g of glyphs) {
        g.x += g.vx * (1 - calm) + g.ix;
        g.y += g.vy * (1 - calm) + g.iy;
        g.ix *= 0.9; g.iy *= 0.9;
        if (g.x < -40) g.x = W + 40; if (g.x > W + 40) g.x = -40;
        if (g.y < -40) g.y = H + 40; if (g.y > H + 40) g.y = -40;
        // the dust follows the pointer as lightly as the dial now does
        const px = g.x + (eased.x - 0.5) * g.depth * -12 * (1 - calm);
        const py = g.y + (eased.y - 0.5) * g.depth * -8 * (1 - calm);
        const a = (0.2 + 0.1 * Math.sin(t * g.flicker + g.phase) * (1 - calm))
          * globalA * zoneMul(zones, px, py) * (1 - calm * 0.75);
        if (a < 0.01) continue;
        if (g.type === "dot") {
          ctx.beginPath();
          ctx.arc(px, py, g.size, 0, TAU);
          ctx.fillStyle = glyphColor(g, a * 2.4);
          ctx.fill();
        } else {
          ctx.font = `500 ${g.size}px ${monoFont}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = glyphColor(g, g.type === "mark" ? a * 1.5 : a * 1.9);
          ctx.fillText(g.text, px, py);
        }
      }
    };

    const paint = (dustA: number) => {
      ctx.clearRect(0, 0, W, H);
      const geo = dialGeometry(W, H, lockT);
      /* held back a beat behind the type, then a shade over a second */
      const birth = reduced ? 1 : smoother(clamp01((performance.now() - born - 240) / 1180));
      drawDial(
        ctx, W, H, lockT, angleForRate(shownRate, geo.windowA) + (1 - birth) * 0.42,
        eased.x - 0.5, eased.y - 0.5, monoFont, performance.now() / 1000, shownRate, geo, birth,
      );
      drawDust(dustA, lockT);
    };

    /* ----- scroll scrub: the lock ----- */
    let scrollTravel = 1;
    const onScroll = () => {
      scrollTravel = Math.max(1, scrub.offsetHeight - viewH);
      progress = clamp01(-scrub.getBoundingClientRect().top / scrollTravel);
    };

    const applyProgress = () => {
      /* Starts almost immediately, and finishes sooner on a phone. There
         the whole scrub is one viewport of thumb travel, so the lock has
         to be done in the first third — otherwise the biggest visible
         move, the recede, never begins while the reader is still
         watching, and the hero reads as inert. */
      lockT = smooth(clamp01((progress - 0.015) / (narrow ? 0.28 : 0.365)));
      const wasLocked = isLocked;
      isLocked = lockT >= 0.999;
      if (isLocked !== wasLocked) document.body.classList.toggle("locked", isLocked);

      /* hint fades out as scrolling starts; terms engrave as the lock lands */
      hint.style.opacity = String(Math.max(0, 1 - progress / 0.05));
      const plateT = clamp01((progress - 0.26) / 0.13);
      plate.style.opacity = String(plateT);
      plate.style.transform = `translateY(${10 * (1 - plateT)}px)`;

      /* the vault recedes — tips back in 3D, shrinks, lifts, and dims
         as the sheet rides over it. Starts before the lock has finished
         so the two overlap: at 0.42 there was a seam where one effect
         had ended and the next had not begun. */
      const tailAt = narrow ? 0.26 : 0.36;
      const tail = smoother(clamp01((progress - tailAt) / (1 - tailAt)));

      /* velocity-matched exit: a quadratic upward drift calibrated so the
         vault is moving at exactly scroll speed the moment the sticky
         releases — no seam at the end of the scrub */
      const u = clamp01((progress - 0.85) / 0.15);
      const exitLift = scrollTravel * 0.075 * u * u;

      /* Before it pulls away, the door comes toward you. The whole first
         40% of the scrub used to be motionless — the vault sat still
         while a number settled — which is what made scrolling feel
         inert however much was happening inside the dial. */
      /* Phones do not get it. A 3% zoom is a real gesture on a wide
         stage; on a narrow one it is a barely-visible creep that mostly
         reads as the page failing to settle. The lock choreography and
         an early recede carry the mobile scroll instead. */
      const push = narrow ? 0 : smooth(clamp01(progress / tailAt)) * 0.03 * (1 - tail);
      /* A portrait stage shrunk by 17% stops reading as a vault receding
         and starts reading as a small card stranded in a wide field of
         canvas — the proportion that works on a landscape stage does not
         survive a tall narrow one. On a phone the sheet riding over it
         does the work instead, and the vault barely shrinks at all. */
      const scale = (1 + push) * (1 - tail * (narrow ? 0.05 : 0.17));

      /* left untransformed at the very top: a 3D transform switches text
         to grayscale antialiasing, and the headline should not shift the
         instant you touch the wheel */
      stageScale.style.transform = push > 0.0004 || tail > 0
        ? `perspective(1100px) translateY(${-(tail * 0.02 * viewH + exitLift)}px) rotateX(${tail * (narrow ? 4 : 8.5)}deg) scale(${scale})`
        : "";

      /* the dim trails the motion by a beat — shadow follows movement */
      stageDim.style.opacity = (smoother(clamp01((progress - 0.5) / 0.5)) * 0.6).toFixed(3);

      /* The halo rises with the recede and fades again as the sheet
         covers it — it exists only for the hand-off, which is the one
         stretch where the vault is small enough to leave the canvas
         around it bare. */
      if (halo) {
        /* rises with the recede and stays up: it is at the end of the
           scrub, with the vault at its smallest, that the canvas beside
           it is barest — fading out there was backwards */
        halo.style.opacity = smooth(clamp01((progress - 0.32) / 0.3)).toFixed(3);
      }

      /* the sheet eases into place instead of riding raw scroll: it starts
         9vh shy and settles on the same curve, reaching zero offset (and
         zero relative velocity) exactly at the handoff */
      if (sheet) {
        const sVis = smoother(clamp01((progress - 0.52) / 0.48));
        sheet.style.transform = `translateY(${(1 - sVis) * 9}vh)`;
      }
    };

    /* ----- the single animation loop ----- */
    const born = performance.now();
    let rafId = 0;
    const frame = () => {
      applyProgress();

      const now = performance.now();
      const dt = Math.min((now - lastT) / 1000, 0.05);
      lastT = now;
      const t = now / 1000;

      const raw = Math.sin(t * 1.9) * 0.86 + Math.sin(t * 0.57 + 2.1) * 0.52;
      const live = SERIES.rate + raw * (1 - lockT);
      driftNum.style.color = lerpColor(EMBER, GREEN, lockT);

      /* The ring is a damped movement chasing that number: the readout
         jitters, the scale glides. Following it raw would fling the ring
         a hundred degrees a second; a real instrument has inertia, and
         the lag between the two is what makes the pair look mechanical.
         Frame-rate independent, so it settles identically at 30 or 120. */
      dialRate += (live - dialRate) * (1 - Math.exp(-dt / DIAL_DAMP));
      /* lockT forces the last of it, so the park lands exactly on the
         graduation rather than wherever the damping had got to */
      shownRate = dialRate * (1 - lockT) + SERIES.rate * lockT;
      driftVal.textContent = shownRate.toFixed(2);

      const pk = 1 - Math.exp(-dt / POINT_DAMP);
      eased.x += (mouse.x - eased.x) * pk;
      eased.y += (mouse.y - eased.y) * pk;

      paint(clamp01((now - born - 700) / 1800));

      rafId = requestAnimationFrame(frame);
    };

    layout();

    if (reduced) {
      document.body.classList.add("locked");
      plate.style.opacity = "1";
      plate.style.transform = "none";
      driftVal.textContent = SERIES.rate.toFixed(2);
      driftNum.style.color = lerpColor(GREEN, GREEN, 1);
      paint(1);
    } else {
      addEventListener("scroll", onScroll, { passive: true });
      cleanups.push(() => removeEventListener("scroll", onScroll));
      onScroll();
      rafId = requestAnimationFrame(frame);
      cleanups.push(() => cancelAnimationFrame(rafId));
    }

    /* ----- parallax (dust and dial only — never the rate) ----- */
    if (finePointer && !reduced) {
      const onMove = (e: PointerEvent) => {
        const r = stage.getBoundingClientRect();
        mouse.x = (e.clientX - r.left) / r.width;
        mouse.y = (e.clientY - r.top) / r.height;
      };
      const onLeave = () => {
        mouse.x = 0.5;
        mouse.y = 0.5;
      };
      stage.addEventListener("pointermove", onMove, { passive: true });
      stage.addEventListener("pointerleave", onLeave);
      cleanups.push(() => {
        stage.removeEventListener("pointermove", onMove);
        stage.removeEventListener("pointerleave", onLeave);
      });
    }

    /* ----- clicks inside the vault shove the dust away ----- */
    if (!reduced) {
      const onShove = (e: PointerEvent) => {
        if (e.button !== 0) return;
        const r = stage.getBoundingClientRect();
        const sx = stage.offsetWidth / r.width;
        const px = (e.clientX - r.left) * sx;
        const py = (e.clientY - r.top) * sx;
        for (const g of glyphs) {
          const dx = g.x - px, dy = g.y - py;
          const d = Math.hypot(dx, dy) || 1;
          if (d < 220) {
            const f = (1 - d / 220) * 9;
            g.ix += (dx / d) * f;
            g.iy += (dy / d) * f;
          }
        }
      };
      stage.addEventListener("pointerdown", onShove);
      cleanups.push(() => stage.removeEventListener("pointerdown", onShove));
    }

    /* ----- re-layout on fonts / load / resize ----- */
    const relayout = () => { layout(); if (reduced) paint(1); };
    document.fonts?.ready.then(relayout).catch(() => {});
    addEventListener("load", relayout);
    cleanups.push(() => removeEventListener("load", relayout));
    const zoneTimer = setTimeout(() => { zones = measureZones(stage); }, 2200);
    cleanups.push(() => clearTimeout(zoneTimer));
    let resizeTimer: ReturnType<typeof setTimeout>;
    const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(relayout, 120); };
    addEventListener("resize", onResize);
    cleanups.push(() => { removeEventListener("resize", onResize); clearTimeout(resizeTimer); });

    /* ----- live proof: ledger every ~5s (Stellar's close time), backing drips ----- */
    let ledger = SERIES.ledgerStart;
    let backing = SERIES.backingStart;
    const flash = (el: HTMLElement) => {
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 500);
    };
    const ledgerInt = setInterval(() => {
      ledger += 1;
      ledgerEl.textContent = fmtInt(ledger);
      flash(ledgerEl);
    }, 5000);
    const backingInt = setInterval(() => {
      backing += Math.floor(Math.random() * 900) + 60;
      backingEl.textContent = `$${fmtInt(backing)}`;
      flash(backingEl);
    }, 9000);
    cleanups.push(() => { clearInterval(ledgerInt); clearInterval(backingInt); });

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return {
    scrubRef, stageScaleRef, stageRef, canvasRef,
    driftNumRef, driftValRef,
    hintRef, plateRef, stageDimRef, haloRef, ledgerRef, backingRef,
  };
}
