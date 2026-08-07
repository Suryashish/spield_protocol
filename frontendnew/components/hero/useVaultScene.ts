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

const DIAL_LABELS = ["4.10", "5.25", "6.00", "6.80", "7.15", "7.90", "8.42", "9.10", "9.60", "10.20", "11.05", "12.30"];
/** where 8.42 sits on the ring — the ring parks so this lands at 0° */
const LOCK_SLOT = DIAL_LABELS.indexOf("8.42");
const SLOT = TAU / DIAL_LABELS.length;

function dialRadius(W: number) {
  return W < 760 ? W * 0.78 : Math.min(W * 0.4, 600);
}

function drawDial(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  lockT: number, rot: number,
  mx: number, my: number,
  monoFont: string,
) {
  const R = dialRadius(W);
  const par = 1 - lockT * 0.5;
  ctx.save();
  ctx.translate(W / 2 + mx * 18 * par, H / 2 + my * 12 * par);

  /* the machined face — barely there, just enough to seat the type */
  const face = ctx.createRadialGradient(0, -R * 0.25, R * 0.05, 0, 0, R);
  face.addColorStop(0, "rgba(250,250,248,0.032)");
  face.addColorStop(0.55, "rgba(250,250,248,0.013)");
  face.addColorStop(1, "rgba(250,250,248,0)");
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();

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
  ring(R * 0.42, 0.045);
  ring(R * 0.62, 0.05, [2, 9]);
  ring(R * 0.86, 0.06);
  ring(R, 0.085);

  /* ---- the turning scale ---- */
  ctx.save();
  ctx.rotate(rot);

  const TICKS = 96;
  for (let i = 0; i < TICKS; i++) {
    const a = (i / TICKS) * TAU;
    const major = i % 8 === 0;
    const len = major ? R * 0.038 : R * 0.018;
    const cos = Math.cos(a), sin = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(cos * R, sin * R);
    ctx.lineTo(cos * (R - len), sin * (R - len));
    ctx.strokeStyle = `rgba(250,250,248,${major ? 0.2 : 0.085})`;
    ctx.lineWidth = major ? 1.6 : 1;
    ctx.stroke();
  }

  /* engraved market scale — the slot that will be parked under the
     index brightens and greens as the lock closes. Narrow frames skip
     it: there, the ring is close enough that numerals would land on
     the headline */
  ctx.font = `500 ${Math.max(10, R * 0.024)}px ${monoFont}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; W >= 760 && i < DIAL_LABELS.length; i++) {
    const a = i * SLOT;
    const rr = R * 0.925;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    const isLock = i === LOCK_SLOT;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-rot); // labels stay upright while the ring turns
    ctx.fillStyle = isLock
      ? rgba(GREEN, 0.16 + 0.72 * lockT)
      : `rgba(250,250,248,${0.16 * (1 - lockT * 0.45)})`;
    ctx.fillText(DIAL_LABELS[i], 0, 0);
    ctx.restore();
  }
  ctx.restore();

  /* ---- the index marks: hairline notches fixed on both flanks,
         with the scale running underneath them ---- */
  for (const a of [0, Math.PI]) {
    /* only the right-hand index is the one doing the reading — it is the
       one 8.42 parks under, so it is the only one that greens */
    const reading = a === 0;
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
  }

  /* ---- the seal: two arcs run down the flanks and meet at the bottom ---- */
  if (lockT > 0.001) {
    ctx.save();
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.strokeStyle = rgba(GREEN, 0.22 + 0.16 * lockT);
    ctx.shadowColor = rgba(GREEN, 0.35);
    ctx.shadowBlur = 12;
    const sweep = lockT * Math.PI;
    ctx.beginPath();
    ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + sweep);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, R, -Math.PI / 2 - sweep, -Math.PI / 2);
    ctx.stroke();
    ctx.restore();
  }

  /* ---- four bolts, riding their tracks and thrown home as it locks ---- */
  const seat = smooth(lockT);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * (Math.PI / 2);
    const cos = Math.cos(a), sin = Math.sin(a);
    const from = R * 0.86, to = R * 0.735;
    const rr = from + (to - from) * seat;

    /* the track the bolt travels down */
    ctx.beginPath();
    ctx.moveTo(cos * from, sin * from);
    ctx.lineTo(cos * to, sin * to);
    ctx.strokeStyle = "rgba(250,250,248,0.05)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    ctx.translate(cos * rr, sin * rr);
    ctx.rotate(a);
    const w = R * 0.045, h = R * 0.013;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
    ctx.fillStyle = seat > 0.02 ? lerpColor([250, 250, 248], GREEN, seat) : "rgba(250,250,248,1)";
    ctx.globalAlpha = 0.2 + 0.45 * seat;
    if (seat > 0.5) {
      ctx.shadowColor = rgba(GREEN, 0.55);
      ctx.shadowBlur = 12 * (seat - 0.5) * 2;
    }
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
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
  const ledgerRef = useRef<HTMLSpanElement>(null);
  const backingRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const scrub = scrubRef.current, stageScale = stageScaleRef.current,
      stage = stageRef.current, canvas = canvasRef.current,
      driftNum = driftNumRef.current, driftVal = driftValRef.current,
      hint = hintRef.current, plate = plateRef.current,
      stageDim = stageDimRef.current,
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
    let glyphs: Glyph[] = [];
    let zones: Zone[] = [];
    const mouse = { x: 0.5, y: 0.5 };
    let monoFont = '"Geist Mono", monospace';
    let progress = 0;
    let lockT = reduced ? 1 : 0;
    let isLocked = reduced;
    /* free rotation of the market scale, accumulated while it drifts */
    let spin = 0;
    let lastT = performance.now();

    const layout = () => {
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
        const px = g.x + (mouse.x - 0.5) * g.depth * -26 * (1 - calm);
        const py = g.y + (mouse.y - 0.5) * g.depth * -18 * (1 - calm);
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

    /** the scale turns while the rate drifts, then parks 8.42 on the index */
    const dialAngle = () => -spin * (1 - lockT) - LOCK_SLOT * SLOT * lockT;

    const paint = (dustA: number) => {
      ctx.clearRect(0, 0, W, H);
      drawDial(ctx, W, H, lockT, dialAngle(), mouse.x - 0.5, mouse.y - 0.5, monoFont);
      drawDust(dustA, lockT);
    };

    /* ----- scroll scrub: the lock ----- */
    let scrollTravel = 1;
    const onScroll = () => {
      scrollTravel = Math.max(1, scrub.offsetHeight - innerHeight);
      progress = clamp01(-scrub.getBoundingClientRect().top / scrollTravel);
    };

    const applyProgress = () => {
      lockT = smooth(clamp01((progress - 0.06) / 0.36));
      const wasLocked = isLocked;
      isLocked = lockT >= 0.999;
      if (isLocked !== wasLocked) document.body.classList.toggle("locked", isLocked);

      /* hint fades out as scrolling starts; terms engrave as the lock lands */
      hint.style.opacity = String(Math.max(0, 1 - progress / 0.05));
      const plateT = clamp01((progress - 0.3) / 0.14);
      plate.style.opacity = String(plateT);
      plate.style.transform = `translateY(${10 * (1 - plateT)}px)`;

      /* the vault recedes — tips back in 3D, shrinks, lifts, and dims
         over the whole second half of the scrub, as the sheet rides over it */
      const tail = smoother(clamp01((progress - 0.42) / 0.58));

      /* velocity-matched exit: a quadratic upward drift calibrated so the
         vault is moving at exactly scroll speed the moment the sticky
         releases — no seam at the end of the scrub */
      const u = clamp01((progress - 0.85) / 0.15);
      const exitLift = scrollTravel * 0.075 * u * u;

      stageScale.style.transform = tail > 0
        ? `perspective(1100px) translateY(${-(tail * 0.02 * innerHeight + exitLift)}px) rotateX(${tail * 8.5}deg) scale(${1 - tail * 0.16})`
        : "";

      /* the dim trails the motion by a beat — shadow follows movement */
      stageDim.style.opacity = (smoother(clamp01((progress - 0.5) / 0.5)) * 0.6).toFixed(3);

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

      /* the scale keeps turning for as long as the rate is still loose */
      spin += dt * 0.085 * (1 - lockT);

      const raw = Math.sin(t * 1.9) * 0.86 + Math.sin(t * 0.57 + 2.1) * 0.52;
      driftVal.textContent = (SERIES.rate + raw * (1 - lockT)).toFixed(2);
      driftNum.style.color = lerpColor(EMBER, GREEN, lockT);

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
    hintRef, plateRef, stageDimRef, ledgerRef, backingRef,
  };
}
