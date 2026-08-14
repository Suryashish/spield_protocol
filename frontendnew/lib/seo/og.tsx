import { ImageResponse } from "next/og";
import { SITE } from "./site";

/**
 * The share card, drawn rather than shipped as a PNG.
 *
 * Generating it means the card is cut from the same tokens as the page —
 * the stage black, the accent green, the serif italic that carries one
 * word of the headline — and that a copy change is one string rather than
 * a trip through a design file. It renders at build and is then a static
 * asset like any other.
 *
 * It says what the page says: the headline, and the promise under it.
 * No rate appears on it. Every figure on this site is a worked example
 * and a share card is the one surface that travels without its context —
 * a number on it would be quoted stripped of the marker that qualifies it.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const STAGE = "#0f0f0e";
const INK = "#fafaf8";
const ACCENT = "#2bd894";
const DIM = "rgba(250,250,248,0.56)";
const FAINT = "rgba(250,250,248,0.34)";

/**
 * Pull a real TTF out of Google Fonts.
 *
 * The `User-Agent` matters: sent as a modern browser, the CSS endpoint
 * returns woff2, which satori cannot parse. An ancient UA gets truetype
 * back instead. If the network is unavailable at build the whole thing
 * returns null and the card falls back to satori's default face — a
 * plainer card is a fine outcome; a failed build is not.
 */
async function loadFont(query: string): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${query}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_6_8) AppleWebKit/537.36" },
    }).then((r) => (r.ok ? r.text() : ""));
    const url = css.match(/src:\s*url\((https:\/\/[^)]+)\)\s*format\('(?:truetype|opentype)'\)/)?.[1];
    if (!url) return null;
    const res = await fetch(url);
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** A ring off the dial's flank — the hero's instrument, seen from further away. */
function Ring({ size, right, top }: { size: number; right: number; top: number }) {
  return (
    <div
      style={{
        position: "absolute",
        width: size,
        height: size,
        right,
        top,
        borderRadius: size,
        border: "1px solid rgba(250,250,248,0.07)",
      }}
    />
  );
}

export async function renderOgImage() {
  const [sans, serif] = await Promise.all([
    loadFont("Geist:wght@500"),
    loadFont("Instrument+Serif:ital@1"),
  ]);

  const fonts = [
    ...(sans ? [{ name: "Geist", data: sans, style: "normal" as const, weight: 500 as const }] : []),
    ...(serif
      ? [{ name: "Instrument", data: serif, style: "italic" as const, weight: 400 as const }]
      : []),
  ];

  const display = sans ? "Geist" : undefined;
  const accentFace = serif ? "Instrument" : display;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          position: "relative",
          background: STAGE,
          color: INK,
          fontFamily: display,
          padding: "60px 72px",
          overflow: "hidden",
        }}
      >
        {/* the dial, off the right edge */}
        <Ring size={980} right={-390} top={-175} />
        <Ring size={760} right={-280} top={-65} />
        <Ring size={540} right={-170} top={45} />
        {/* The accent rising off the floor, as on the vault stage. A
            gradient rather than a shape: satori has no blur, so a plain
            circle here renders as a solid green disc with a hard edge —
            which is a graphic, not a glow. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: OG_SIZE.width,
            height: OG_SIZE.height,
            backgroundImage:
              "radial-gradient(circle at 4% 112%, rgba(15,190,124,0.34) 0%, rgba(15,190,124,0.10) 34%, rgba(15,190,124,0) 62%)",
          }}
        />

        {/* ---- the kicker ---- */}
        <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
          <div
            style={{ width: 9, height: 9, borderRadius: 9, background: ACCENT, marginRight: 14 }}
          />
          <div style={{ fontSize: 21, letterSpacing: 3.4, textTransform: "uppercase", color: FAINT }}>
            Fixed income on Stellar
          </div>
        </div>

        {/* ---- the headline, and the promise under it ---- */}
        <div style={{ display: "flex", flexDirection: "column", position: "relative" }}>
          <div style={{ display: "flex", fontSize: 86, letterSpacing: -2.4, lineHeight: 1.05 }}>
            Tomorrow&rsquo;s yield,
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              fontSize: 86,
              letterSpacing: -2.4,
              lineHeight: 1.12,
            }}
          >
            <span style={{ fontFamily: accentFace, fontStyle: "italic", color: ACCENT }}>
              locked
            </span>
            <span style={{ marginLeft: 20 }}>today.</span>
          </div>
          <div style={{ display: "flex", marginTop: 30, fontSize: 27, color: DIM, lineHeight: 1.45 }}>
            Deposit USDC. Redeem one exact number on one exact date.
          </div>
        </div>

        {/* ---- the plate ---- */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            position: "relative",
            paddingTop: 26,
            borderTop: "1px solid rgba(250,250,248,0.12)",
          }}
        >
          <div style={{ display: "flex", fontSize: 26, letterSpacing: -0.5 }}>{SITE.name}</div>
          <div style={{ display: "flex", fontSize: 19, letterSpacing: 2.2, color: FAINT }}>
            {SITE.domain}
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: fonts.length ? fonts : undefined },
  );
}
