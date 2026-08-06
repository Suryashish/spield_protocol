"use client";

import { useEffect, useRef } from "react";

/**
 * Can this engine actually render an SVG filter as a backdrop-filter?
 *
 * Only Chromium can. WebKit and Gecko both *parse* `backdrop-filter:
 * url(#id)` as valid — so CSS.supports() alone says yes and then nothing
 * renders — and there is no CSS feature query that separates them. The
 * one honest signal is `navigator.userAgentData`, which only Chromium
 * ships; anything else takes the blurred-glass path, which is a complete
 * effect in its own right rather than a degraded one.
 */
function canRenderLens() {
  const nav = navigator as Navigator & { userAgentData?: { brands?: unknown[] } };
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("backdrop-filter", "url(#lensWarp)") &&
    Array.isArray(nav.userAgentData?.brands)
  );
}

/**
 * The liquid-glass warp — a small refractive lens at every click.
 * In Chromium a runtime-generated displacement map (R = x-bend, G = y-bend,
 * neutral at centre, strongest at the rim) drives an SVG feDisplacementMap
 * via backdrop-filter: url(#lensWarp), so the pixels beneath genuinely bend
 * like glass. Everywhere else the lens is blurred, saturated glass with a
 * bright refracted rim — same shape, same timing, same specular glint.
 */
export default function ClickWarp() {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const layer = layerRef.current;
    if (!layer) return;

    /* ----- engines without SVG backdrop filters skip the map entirely ----- */
    if (!canRenderLens()) {
      const onDownPlain = (e: PointerEvent) => stamp(e, layer);
      addEventListener("pointerdown", onDownPlain);
      return () => removeEventListener("pointerdown", onDownPlain);
    }
    layer.classList.add("has-lens");

    /* ----- build the lens displacement map once ----- */
    const s = 160;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = s;
    const cx = canvas.getContext("2d")!;
    const img = cx.createImageData(s, s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const nx = (x / (s - 1)) * 2 - 1;
        const ny = (y / (s - 1)) * 2 - 1;
        const d = Math.sqrt(nx * nx + ny * ny);
        let str = 0;
        if (d < 1) {
          const rim = Math.pow(d, 3.2); /* grows toward the rim */
          const edge = 1 - Math.max(0, Math.min(1, (d - 0.88) / 0.12)); /* soft outer lip */
          str = rim * edge;
        }
        const i = (y * s + x) * 4;
        img.data[i] = 128 - nx * str * 127; /* sample toward centre → bulge */
        img.data[i + 1] = 128 - ny * str * 127;
        img.data[i + 2] = 128;
        img.data[i + 3] = 255;
      }
    }
    cx.putImageData(img, 0, 0);

    const holder = document.createElement("div");
    holder.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;";
    holder.innerHTML =
      '<svg width="0" height="0"><filter id="lensWarp" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">' +
      `<feImage href="${canvas.toDataURL()}" preserveAspectRatio="none" result="m"/>` +
      '<feDisplacementMap in="SourceGraphic" in2="m" scale="52" xChannelSelector="R" yChannelSelector="G"/>' +
      "</filter></svg>";
    document.body.appendChild(holder);

    /* ----- stamp a lens at every click ----- */
    const onDown = (e: PointerEvent) => stamp(e, layer);

    addEventListener("pointerdown", onDown);
    return () => {
      removeEventListener("pointerdown", onDown);
      holder.remove();
    };
  }, []);

  return <div ref={layerRef} className="warp-layer" aria-hidden="true" />;
}

/** one lens, dropped on the click and cleaned up after it fades */
function stamp(e: PointerEvent, layer: HTMLDivElement) {
  if (e.button !== 0) return;
  const el = document.createElement("span");
  el.className = "warp";
  el.style.left = `${e.clientX}px`;
  el.style.top = `${e.clientY}px`;
  el.innerHTML =
    '<span class="warp-wave"></span><span class="warp-rim"></span><span class="warp-glint"></span>';
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}
