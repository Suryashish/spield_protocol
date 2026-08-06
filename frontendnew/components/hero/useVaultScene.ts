"use client";

import { useEffect, useRef } from "react";
import { SERIES, fmtInt } from "@/lib/series";

/* ---------- pure helpers ---------- */

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

/* ---------- the drifting dust of variable yields ---------- */

const DUST_YIELDS = ["5.9%", "7.2%", "9.4%", "6.1%", "8.9%", "4.8%", "10.2%", "7.7%", "6.6%", "9.1%"];
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
  const count = Math.round(Math.min(52, (W * H) / 34000));
  for (let i = 0; i < count; i++) {
    const roll = Math.random();
    const type = roll < 0.42 ? "yield" : roll < 0.7 ? "mark" : "dot";
    const depth = rnd(0.35, 1);
    glyphs.push({
      type,
      text: type === "yield" ? DUST_YIELDS[i % DUST_YIELDS.length] : DUST_MARKS[Math.floor(Math.random() * DUST_MARKS.length)],
      x: rnd(30, W - 30), y: rnd(30, H - 30),
      vx: (rnd(-6, 6) * depth) / 60,
      vy: (rnd(-4, 4) * depth) / 60,
      ix: 0, iy: 0,
      depth,
      size: type === "dot" ? rnd(1.6, 3.2) : rnd(12, 17) * depth,
      phase: Math.random() * 6.28,
      flicker: rnd(0.3, 0.9),
      color: Math.random() < 0.26 ? "ember" : Math.random() < 0.1 ? "blue" : "dim",
    });
  }
  return glyphs;
}

function glyphColor(g: Glyph, a: number) {
  if (g.color === "ember") return `rgba(255, 138, 74, ${a * 0.75})`;
  if (g.color === "blue") return `rgba(120, 160, 250, ${a * 0.7})`;
  return `rgba(250, 250, 248, ${a * 0.5})`;
}

/* ---------- exclusion zones: dust never dirties the content ---------- */

type Zone = { x1: number; y1: number; x2: number; y2: number };

const ZONE_SELECTORS: Array<[string, number]> = [
  [".hero-center", 60],
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
 * Drives the whole vault scene imperatively (canvas dust, the
 * scroll-to-lock scrub, the rate wobble + sparkline, live counters)
 * against refs the Hero component pins to its markup.
 */
export function useVaultScene() {
  const scrubRef = useRef<HTMLDivElement>(null);
  const stageScaleRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const driftNumRef = useRef<HTMLDivElement>(null);
  const driftValRef = useRef<HTMLSpanElement>(null);
  const sparkRef = useRef<SVGPathElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const stageDimRef = useRef<HTMLDivElement>(null);
  const ledgerRef = useRef<HTMLSpanElement>(null);
  const backingRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const scrub = scrubRef.current, stageScale = stageScaleRef.current,
      stage = stageRef.current, canvas = canvasRef.current,
      driftNum = driftNumRef.current, driftVal = driftValRef.current,
      spark = sparkRef.current, hint = hintRef.current, plate = plateRef.current,
      stageDim = stageDimRef.current,
      ledgerEl = ledgerRef.current, backingEl = backingRef.current;
    if (!scrub || !stageScale || !stage || !canvas || !driftNum || !driftVal || !spark || !hint || !plate || !stageDim || !ledgerEl || !backingEl) return;

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
      ctx.clearRect(0, 0, W, H);
      const t = performance.now() / 1000;
      for (const g of glyphs) {
        g.x += g.vx * (1 - calm) + g.ix;
        g.y += g.vy * (1 - calm) + g.iy;
        g.ix *= 0.9; g.iy *= 0.9;
        if (g.x < -40) g.x = W + 40; if (g.x > W + 40) g.x = -40;
        if (g.y < -40) g.y = H + 40; if (g.y > H + 40) g.y = -40;
        const px = g.x + (mouse.x - 0.5) * g.depth * -26 * (1 - calm);
        const py = g.y + (mouse.y - 0.5) * g.depth * -18 * (1 - calm);
        const a = (0.23 + 0.12 * Math.sin(t * g.flicker + g.phase) * (1 - calm))
          * globalA * zoneMul(zones, px, py) * (1 - calm * 0.72);
        if (a < 0.01) continue;
        if (g.type === "dot") {
          ctx.beginPath();
          ctx.arc(px, py, g.size, 0, 6.2832);
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

    /* ----- rate wobble + sparkline history ----- */
    const hist: number[] = new Array(46).fill(0);
    let sparkTick = 0;

    const drawSpark = (color: string) => {
      /* the barcode: bars dance with the drift, settle uniform on lock */
      let d = "";
      for (let i = 0; i < hist.length; i++) {
        const x = (2 + (146 * i) / (hist.length - 1)).toFixed(1);
        const wob = 5 + Math.abs(hist[i]) * 9;
        const h = wob * (1 - lockT) + 14 * lockT;
        d += `M${x} ${(10 - h / 2).toFixed(1)}V${(10 + h / 2).toFixed(1)}`;
      }
      spark.setAttribute("d", d);
      spark.style.stroke = color;
    };

    /* ----- the single animation loop ----- */
    const born = performance.now();
    let rafId = 0;
    const frame = () => {
      applyProgress();

      const t = performance.now() / 1000;
      const raw = Math.sin(t * 1.9) * 0.86 + Math.sin(t * 0.57 + 2.1) * 0.52;
      driftVal.textContent = (SERIES.rate + raw * (1 - lockT)).toFixed(2);
      const color = lerpColor(EMBER, GREEN, lockT);
      driftNum.style.color = color;

      if (++sparkTick % 3 === 0) { hist.push(raw); hist.shift(); }
      drawSpark(color);

      drawDust(clamp01((performance.now() - born - 700) / 1800), lockT);

      rafId = requestAnimationFrame(frame);
    };

    layout();

    if (reduced) {
      document.body.classList.add("locked");
      plate.style.opacity = "1";
      plate.style.transform = "none";
      driftVal.textContent = SERIES.rate.toFixed(2);
      driftNum.style.color = lerpColor(GREEN, GREEN, 1);
      drawSpark(lerpColor(GREEN, GREEN, 1));
      drawDust(1, 1);
    } else {
      addEventListener("scroll", onScroll, { passive: true });
      cleanups.push(() => removeEventListener("scroll", onScroll));
      onScroll();
      rafId = requestAnimationFrame(frame);
      cleanups.push(() => cancelAnimationFrame(rafId));
    }

    /* ----- parallax (dust only — never the rate) ----- */
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
    const relayout = () => { layout(); if (reduced) drawDust(1, 1); };
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
    driftNumRef, driftValRef, sparkRef,
    hintRef, plateRef, stageDimRef, ledgerRef, backingRef,
  };
}
