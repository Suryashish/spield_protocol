/**
 * Share cards: the image a user posts after a deposit lands or a payout arrives.
 *
 * Drawn on a canvas rather than captured from the DOM. A DOM capture (html-to-image and friends)
 * depends on `foreignObject`, which drops web fonts and images on first paint in Safari, and
 * Safari on a phone is exactly where a card gets shared to Instagram. A canvas has no such gap: once
 * the fonts are loaded, what is drawn is what is exported.
 *
 * The card is always the dark stage, whatever theme the app is in. It is the same ground the
 * marketing site's hero and the Open Graph image stand on, and a picture that leaves the app has to
 * read as Spield in someone else's feed, not as whichever theme its author happened to be using.
 *
 * Colour follows the app's semantics: green is fixed and realised, ember is variable yield, USDC
 * blue is the deposit. The art is the hero's vault dial, engraved and too big for its frame.
 */
import logoOnstage from '@/assets/logo-onstage.png';
import { NETWORK } from '@/lib/config';
import { SITE_ORIGIN } from '@/lib/site';
import { fromBaseUnits } from '@/lib/soroban';

export type ShareTone = 'brand' | 'ember' | 'usdc';

export type ShareCard = {
  tone: ShareTone;
  /** What happened, as a caption above the figure. */
  eyebrow: string;
  /** The one number the card is about. */
  figure: string;
  /** Set small after the figure: the unit it is in… */
  unit?: string;
  /** …or one serif word, the way the site sets "locked". Give one or the other. */
  flourish?: string;
  /** One plain sentence under the figure. */
  line: string;
  /** Up to three facts along the foot. */
  stats: { label: string; value: string }[];
  /** Prefilled text for the post the image goes out with. */
  text: string;
};

export type ShareFormat = 'wide' | 'square' | 'story';

/** Logical size, and the density it is exported at. A story is already 1080 wide natively. */
export const SHARE_FORMATS: Record<
  ShareFormat,
  { w: number; h: number; scale: number; label: string; hint: string }
> = {
  wide: { w: 1200, h: 675, scale: 2, label: 'Landscape', hint: 'X, Telegram' },
  square: { w: 1080, h: 1080, scale: 2, label: 'Square', hint: 'Instagram feed' },
  story: { w: 1080, h: 1920, scale: 1.5, label: 'Story', hint: 'Instagram story' },
};

// ───────────────────────────────── the cards ─────────────────────────────────

const HANDLE = '@spield_';
const UNIT = 10_000_000n;
const YEAR_SECS = 365 * 24 * 60 * 60;

/**
 * An amount as a card prints it. Truncated, never rounded: a payout shown one stroop high is a
 * promise the contract did not make. Small figures keep enough places to show a non-zero digit,
 * because a week of yield on a few dollars is real money that two decimals would print as 0.00.
 */
const amt = (units: bigint): string => {
  const abs = units < 0n ? -units : units;
  const dp = abs >= 1000n * UNIT ? 2 : abs >= UNIT / 100n ? 4 : 7;
  const step = 10n ** BigInt(7 - dp);
  const cut = (abs / step) * step;
  return fromBaseUnits(units < 0n ? -cut : cut).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: dp,
  });
};

const pct = (bps: number): string => `${(bps / 100).toFixed(2)}%`;

/** One spelling of a date for an image that will be read in every locale. */
const day = (unix: number): string =>
  new Date(unix * 1000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

/** Fixed-Rate Vault: a rate was locked. */
export const vaultLockCard = (r: {
  principal: bigint;
  payout: bigint;
  rateBps: number;
  maturity: number;
}): ShareCard => ({
  tone: 'brand',
  eyebrow: 'Fixed rate locked',
  figure: pct(r.rateBps),
  flourish: 'fixed',
  line: 'Out there, rates drift. In here, they don’t.',
  stats: [
    { label: 'Deposited', value: `${amt(r.principal)} USDC` },
    { label: 'Pays at maturity', value: `${amt(r.payout)} USDC` },
    { label: 'Matures', value: day(r.maturity) },
  ],
  text: `Locked ${pct(r.rateBps)} fixed on ${amt(r.principal)} USDC until ${day(r.maturity)} with ${HANDLE} on Stellar.`,
});

/** Fixed-Rate Vault: a matured receipt paid out in full. */
export const vaultRedeemCard = (r: {
  principal: bigint;
  payout: bigint;
  rateBps: number;
}): ShareCard => ({
  tone: 'brand',
  eyebrow: 'Fixed payout collected',
  figure: `+${amt(r.payout - r.principal)}`,
  unit: 'USDC',
  line: `Matured and paid in full at ${pct(r.rateBps)} fixed.`,
  stats: [
    { label: 'Deposited', value: `${amt(r.principal)} USDC` },
    { label: 'Paid out', value: `${amt(r.payout)} USDC` },
  ],
  text: `Collected ${amt(r.payout)} USDC from a ${pct(r.rateBps)} fixed-rate deposit with ${HANDLE} on Stellar. Paid in full at maturity.`,
});

/** Deposit: USDC split into PT + YT at par. */
export const mintCard = (r: { usdc: bigint; maturity: number | null }): ShareCard => ({
  tone: 'usdc',
  eyebrow: 'Deposit split',
  figure: amt(r.usdc),
  unit: 'USDC',
  line: 'One deposit, two instruments.',
  stats: [
    { label: 'Principal token', value: `${amt(r.usdc)} PT` },
    { label: 'Yield token', value: `${amt(r.usdc)} YT` },
    ...(r.maturity ? [{ label: 'Matures', value: day(r.maturity) }] : []),
  ],
  text: `Split ${amt(r.usdc)} USDC into a fixed-rate principal token and a yield token with ${HANDLE} on Stellar.`,
});

/**
 * Markets: PT bought below par. The discount, annualised, is the fixed rate of this fill.
 *
 * `at` is when the purchase happened, unix seconds. It defaults to now, which is right for a card
 * made the moment a trade confirms. The activity feed passes the real time: a rate annualised over
 * what is left of the term TODAY, for a trade made last week, would be a rate nobody was ever given.
 */
export const buyPtCard = (r: {
  paid: bigint;
  pt: bigint;
  expiry: number;
  at?: number;
}): ShareCard => {
  const secs = r.expiry - (r.at ?? Date.now() / 1000);
  const apr =
    r.paid > 0n && secs > 3600 ? (Number(r.pt) / Number(r.paid) - 1) * (YEAR_SECS / secs) * 100 : NaN;
  // Inside the last hour the annualisation is noise, so the card falls back to the size.
  const rate = Number.isFinite(apr) && apr > 0 && apr < 1000 ? `${apr.toFixed(2)}%` : null;
  return {
    tone: 'brand',
    eyebrow: 'Fixed yield bought',
    figure: rate ?? amt(r.pt),
    ...(rate ? { flourish: 'fixed' } : { unit: 'PT' }),
    line: 'Bought below par. Redeems 1:1 at maturity.',
    stats: [
      { label: 'Paid', value: `${amt(r.paid)} USDC` },
      { label: 'Redeems for', value: `${amt(r.pt)} USDC` },
      { label: 'Matures', value: day(r.expiry) },
    ],
    text: `Bought ${amt(r.pt)} PT for ${amt(r.paid)} USDC${rate ? `, ${rate} fixed` : ''} until ${day(r.expiry)} with ${HANDLE} on Stellar.`,
  };
};

/** Markets: YT bought. The face is the exposure; the price paid is a sliver of it. */
export const buyYtCard = (r: { paid: bigint; yt: bigint; expiry: number }): ShareCard => ({
  tone: 'ember',
  eyebrow: 'Long yield',
  figure: amt(r.yt),
  unit: 'YT',
  line: `Earning the variable yield on ${amt(r.yt)} USDC. No liquidations.`,
  stats: [
    { label: 'Paid', value: `${amt(r.paid)} USDC` },
    { label: 'Yield exposure', value: `${amt(r.yt)} USDC` },
    { label: 'Until', value: day(r.expiry) },
  ],
  text: `Long yield on Stellar: the variable rate on ${amt(r.yt)} USDC for ${amt(r.paid)} USDC, until ${day(r.expiry)}, with ${HANDLE}.`,
});

/**
 * Yield: accrued YT interest withdrawn. `unit` is SR only when the router is not deployed. `at` is
 * when it was claimed (unix seconds, default now); `yt` is 0 when the size it was earned on is not
 * known, as for a past claim, and that fact is then left off rather than guessed.
 */
export const claimYieldCard = (r: {
  amount: bigint;
  unit: 'USDC' | 'SR';
  yt: bigint;
  at?: number;
}): ShareCard => ({
  tone: 'ember',
  eyebrow: 'Yield claimed',
  figure: `+${amt(r.amount)}`,
  unit: r.unit,
  line: 'Variable yield from Blend lending, paid out on Stellar.',
  stats: [
    ...(r.yt > 0n ? [{ label: 'Earned on', value: `${amt(r.yt)} YT` }] : []),
    { label: 'Claimed', value: day(r.at ?? Date.now() / 1000) },
  ],
  text: `Claimed ${amt(r.amount)} ${r.unit} of yield with ${HANDLE} on Stellar.`,
});

/**
 * SR Wrapper: USDC supplied to the venue and left there to earn the variable rate.
 *
 * `sr` is the shares received, when that is known exactly. At the moment of the transaction only an
 * estimate exists, so the card says nothing about it; the activity feed has the real number.
 */
export const wrapCard = (r: { usdc: bigint; sr?: bigint; at?: number }): ShareCard => ({
  tone: 'usdc',
  eyebrow: 'Earning variable yield',
  figure: amt(r.usdc),
  unit: 'USDC',
  line: 'Supplied to Blend through Spield, earning the live rate.',
  stats: [
    ...(r.sr && r.sr > 0n ? [{ label: 'Received', value: `${amt(r.sr)} SR` }] : []),
    { label: 'Lent through', value: 'Blend' },
    { label: 'Since', value: day(r.at ?? Date.now() / 1000) },
  ],
  text: `Put ${amt(r.usdc)} USDC to work on Stellar with ${HANDLE}, earning Blend's variable yield.`,
});

/**
 * Liquidity: PT and USDC added to the PT market.
 *
 * The headline adds the two legs with PT at FACE, and the line says so. Face is the one PT value
 * that is a fact of the contract (it redeems 1:1 at maturity) rather than a reading of a price
 * that has since moved, and it is the same number whether the card is made now or next week.
 */
export const addLiquidityCard = (r: {
  pt: bigint;
  usdc: bigint;
  maturity: number | null;
}): ShareCard => ({
  tone: 'usdc',
  eyebrow: 'Liquidity provided',
  figure: amt(r.pt + r.usdc),
  unit: 'USDC',
  line: 'Making the market for fixed yield. PT counted at face.',
  stats: [
    { label: 'PT side', value: `${amt(r.pt)} PT` },
    { label: 'USDC side', value: `${amt(r.usdc)} USDC` },
    ...(r.maturity ? [{ label: 'Matures', value: day(r.maturity) }] : []),
  ],
  text: `Providing liquidity to the fixed-yield market on Stellar with ${HANDLE}: ${amt(r.pt)} PT and ${amt(r.usdc)} USDC.`,
});

/** Deposit page, after maturity: PT burned for its face value. */
export const redeemParCard = (r: { pt: bigint }): ShareCard => ({
  tone: 'brand',
  eyebrow: 'Redeemed at par',
  figure: amt(r.pt),
  unit: 'USDC',
  line: 'Principal tokens redeemed 1:1 at maturity.',
  stats: [
    { label: 'Redeemed', value: `${amt(r.pt)} PT` },
    { label: 'Rate', value: '1 PT = 1 USDC' },
  ],
  text: `Redeemed ${amt(r.pt)} PT at par with ${HANDLE} on Stellar. Fixed means fixed.`,
});

// ──────────────────────────────── the renderer ────────────────────────────────

type Rgb = [number, number, number];

type Tokens = {
  stage: Rgb;
  onstage: Rgb;
  tones: Record<ShareTone, [Rgb, Rgb]>;
  display: string;
  serif: string;
  mono: string;
  body: string;
};

const hex = (v: string, fallback: Rgb): Rgb => {
  const m = /^#([0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgba = (c: Rgb, a = 1): string => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/**
 * Read off the CSS tokens, so the card moves with the design system rather than beside it. Only
 * theme-invariant tokens are used: the card is always the stage, so nothing here may depend on
 * whether the app is currently on paper.
 */
const readTokens = (): Tokens => {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name);
  const onstage = hex(v('--onstage'), [250, 250, 248]);
  const ember = hex(v('--ember'), [255, 122, 47]);
  const usdc = hex(v('--usdc'), [74, 135, 242]);
  return {
    stage: hex(v('--stage'), [15, 15, 14]),
    onstage,
    tones: {
      brand: [hex(v('--brand'), [15, 190, 124]), hex(v('--brand-bright'), [43, 216, 148])],
      ember: [ember, mix(ember, onstage, 0.32)],
      usdc: [usdc, mix(usdc, onstage, 0.36)],
    },
    display: v('--ff-display').trim() || 'sans-serif',
    serif: v('--ff-serif').trim() || 'serif',
    mono: v('--ff-mono').trim() || 'monospace',
    body: v('--ff-body').trim() || 'sans-serif',
  };
};

/** A canvas draws with whatever is loaded at that instant, so ask for every face first. */
const loadFonts = async (t: Tokens): Promise<void> => {
  if (!document.fonts?.load) return;
  await Promise.allSettled([
    document.fonts.load(`500 96px ${t.display}`),
    document.fonts.load(`700 28px ${t.display}`),
    document.fonts.load(`italic 400 96px ${t.serif}`),
    document.fonts.load(`500 14px ${t.mono}`),
    document.fonts.load(`400 22px ${t.body}`),
  ]);
};

let logoPromise: Promise<HTMLImageElement | null> | null = null;
const loadLogo = (): Promise<HTMLImageElement | null> => {
  logoPromise ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    // A card without its mark is still a card; a rejected promise here would be no card at all.
    img.onerror = () => resolve(null);
    img.src = logoOnstage;
  });
  return logoPromise;
};

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

/**
 * Tracked type, set a glyph at a time. Canvas `letterSpacing` is missing from Safari 15, which this
 * build still targets, and a micro-caption without its tracking is not the same caption.
 */
const widthOf = (ctx: Ctx, text: string, track = 0): number => {
  if (track === 0) return ctx.measureText(text).width;
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + track;
  return w - track;
};
const put = (ctx: Ctx, text: string, x: number, y: number, track = 0): void => {
  if (track === 0) {
    ctx.fillText(text, x, y);
    return;
  }
  for (const ch of text) {
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + track;
  }
};

/** Greedy wrap to at most two lines; the copy is written to fit, this is the safety net. */
const wrap = (ctx: Ctx, text: string, maxW: number): string[] => {
  if (ctx.measureText(text).width <= maxW) return [text];
  const words = text.split(' ');
  let first = '';
  while (words.length && ctx.measureText(`${first} ${words[0]}`.trim()).width <= maxW) {
    first = `${first} ${words.shift()}`.trim();
  }
  return [first, words.join(' ')];
};

let grainTile: HTMLCanvasElement | null = null;
/** Print grain, the same finish the site wears. One small tile, repeated. */
const grain = (ctx: Ctx, w: number, h: number): void => {
  if (!grainTile) {
    grainTile = document.createElement('canvas');
    grainTile.width = grainTile.height = 128;
    const g = grainTile.getContext('2d');
    if (g) {
      const px = g.createImageData(128, 128);
      for (let i = 0; i < px.data.length; i += 4) {
        px.data[i] = px.data[i + 1] = px.data[i + 2] = 255;
        px.data[i + 3] = Math.random() * 13;
      }
      g.putImageData(px, 0, 0);
    }
  }
  const pattern = ctx.createPattern(grainTile, 'repeat');
  if (!pattern) return;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
};

type Dial = {
  cx: number;
  cy: number;
  r: number;
  /** Where the seal sits on the rim, and how far it runs either side, in radians. */
  seal: number;
  sweep: number;
  /** Inner engraved rings, as distances in from the rim. */
  rings: number[];
};

type Layout = {
  pad: number;
  /** Centre line of the header row. */
  head: number;
  logo: number;
  dial: Dial;
  /** Right-hand limit of the type column. */
  textW: number;
  eyebrowY: number;
  figure: number;
  figureY: number;
  lineSize: number;
  lineY: number;
  /** `row`: three cells on a rule. `stack`: label left, value right, one fact per line. */
  stats: 'row' | 'stack';
  statsY: number;
  statsW: number;
  valueSize: number;
  /** The address pill rides in the header, except on a story, where the top belongs to the app chrome. */
  urlFoot: number | null;
};

/**
 * Three compositions, one drawing. Landscape puts the dial on the right and the facts on the left.
 * The two tall formats have no room beside the type, so the dial rises from below as a horizon and
 * the facts sit inside it. In every one the bright seal is kept clear of anything that is read.
 */
const LAYOUT: Record<ShareFormat, Layout> = {
  wide: {
    pad: 64,
    head: 84,
    logo: 40,
    dial: { cx: 1104, cy: 350, r: 372, seal: Math.PI, sweep: 0.6, rings: [124, 226] },
    textW: 624,
    eyebrowY: 246,
    figure: 128,
    figureY: 384,
    lineSize: 21,
    lineY: 436,
    stats: 'row',
    statsY: 528,
    statsW: 624,
    valueSize: 23,
    urlFoot: null,
  },
  square: {
    pad: 72,
    head: 96,
    logo: 44,
    dial: { cx: 540, cy: 2716, r: 2000, seal: -Math.PI / 2, sweep: 0.19, rings: [300] },
    textW: 936,
    eyebrowY: 300,
    figure: 176,
    figureY: 480,
    lineSize: 26,
    lineY: 548,
    stats: 'row',
    statsY: 872,
    statsW: 936,
    valueSize: 30,
    urlFoot: null,
  },
  story: {
    pad: 84,
    head: 276,
    logo: 52,
    dial: { cx: 540, cy: 3560, r: 2400, seal: -Math.PI / 2, sweep: 0.16, rings: [420] },
    textW: 912,
    eyebrowY: 640,
    figure: 196,
    figureY: 844,
    lineSize: 30,
    lineY: 924,
    stats: 'stack',
    statsY: 1296,
    statsW: 912,
    valueSize: 36,
    urlFoot: 1640,
  },
};

const drawDial = (ctx: Ctx, d: Dial, ink: (a: number) => string, tone: Rgb, toneHi: Rgb): void => {
  const { cx, cy, r } = d;
  ctx.save();

  // The light it sits in. On the stage translucent colour adds, so this reads as a glow.
  const sx = cx + Math.cos(d.seal) * r;
  const sy = cy + Math.sin(d.seal) * r;
  const spread = Math.min(r, 620);
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, spread);
  glow.addColorStop(0, rgba(tone, 0.26));
  glow.addColorStop(0.45, rgba(tone, 0.08));
  glow.addColorStop(1, rgba(tone, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(sx - spread, sy - spread, spread * 2, spread * 2);

  // The machined face: a shade off the stage, so the dial is an object and not an outline.
  ctx.fillStyle = ink(0.022);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();

  ctx.lineWidth = 1;
  ctx.strokeStyle = ink(0.16);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.stroke();
  for (const inset of d.rings) {
    ctx.strokeStyle = ink(0.07);
    ctx.beginPath();
    ctx.arc(cx, cy, r - inset, 0, TAU);
    ctx.stroke();
  }

  // The scale. Spaced by arc length, so a horizon-sized dial carries the same engraving as a small one.
  const count = Math.round((TAU * r) / 24 / 8) * 8;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU;
    const major = i % 8 === 0;
    const r0 = r - 30;
    const r1 = r - (major ? 58 : 44);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    ctx.strokeStyle = ink(major ? 0.34 : 0.14);
    ctx.lineWidth = major ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + cos * r0, cy + sin * r0);
    ctx.lineTo(cx + cos * r1, cy + sin * r1);
    ctx.stroke();
  }
  ctx.strokeStyle = ink(0.09);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 30, 0, TAU);
  ctx.stroke();

  // The seal: the arc that closes when a rate locks. The one bright thing in the picture.
  ctx.lineCap = 'round';
  ctx.shadowColor = rgba(tone, 0.85);
  ctx.shadowBlur = 26;
  ctx.strokeStyle = rgba(toneHi);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, d.seal - d.sweep, d.seal + d.sweep);
  ctx.stroke();
  // and the index mark it parks under
  ctx.shadowBlur = 14;
  ctx.fillStyle = rgba(toneHi);
  ctx.beginPath();
  ctx.arc(cx + Math.cos(d.seal) * (r - 16), cy + Math.sin(d.seal) * (r - 16), 3.5, 0, TAU);
  ctx.fill();

  ctx.restore();
};

const paint = (
  ctx: Ctx,
  card: ShareCard,
  format: ShareFormat,
  t: Tokens,
  logo: HTMLImageElement | null,
): void => {
  const { w, h } = SHARE_FORMATS[format];
  const L = LAYOUT[format];
  const [tone, toneHi] = t.tones[card.tone];
  const ink = (a: number) => rgba(t.onstage, a);
  const x0 = L.pad;

  ctx.fillStyle = rgba(t.stage);
  ctx.fillRect(0, 0, w, h);
  drawDial(ctx, L.dial, ink, tone, toneHi);
  grain(ctx, w, h);

  ctx.textAlign = 'left';

  // ── header: mark, wordmark, and where to find it ──
  if (logo) ctx.drawImage(logo, x0, L.head - L.logo / 2, L.logo, L.logo);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink(1);
  ctx.font = `700 ${Math.round(L.logo * 0.7)}px ${t.display}`;
  put(ctx, 'Spield', x0 + (logo ? L.logo + 12 : 0), L.head + 1, -0.4);

  const pillSize = format === 'wide' ? 13 : format === 'square' ? 14 : 17;
  const pillTrack = pillSize * 0.06;
  const pillH = Math.round(pillSize * 2.6);
  const pillW = (text: string): number => {
    ctx.font = `500 ${pillSize}px ${t.mono}`;
    return widthOf(ctx, text, pillTrack) + pillSize * 2.4;
  };
  const pill = (text: string, left: number, cy: number, colour: string): void => {
    const pw = pillW(text);
    const rad = pillH / 2;
    // Two arcs rather than `roundRect`, which Safari 15 does not have.
    ctx.beginPath();
    ctx.arc(left + rad, cy, rad, Math.PI / 2, -Math.PI / 2);
    ctx.arc(left + pw - rad, cy, rad, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = rgba(t.stage, 0.55);
    ctx.fill();
    ctx.strokeStyle = ink(0.17);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = colour;
    ctx.textBaseline = 'middle';
    put(ctx, text, left + pillSize * 1.2, cy + 1, pillTrack);
  };
  const host = new URL(SITE_ORIGIN).host.replace(/^www\./, '');
  const inHeader = L.urlFoot === null;
  const urlLeft = inHeader ? w - x0 - pillW(host) : (w - pillW(host)) / 2;
  pill(host, urlLeft, L.urlFoot ?? L.head, ink(0.74));
  // A testnet card must never be passable as real money.
  if (NETWORK.name === 'TESTNET') {
    const right = inHeader ? urlLeft - 10 : w - x0;
    pill('TESTNET', right - pillW('TESTNET'), L.head, rgba(t.tones.ember[1]));
  }

  // ── what happened ──
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.shadowColor = rgba(tone, 0.9);
  ctx.shadowBlur = 10;
  ctx.fillStyle = rgba(toneHi);
  ctx.beginPath();
  ctx.arc(x0 + 4, L.eyebrowY, 4, 0, TAU);
  ctx.fill();
  ctx.restore();
  const eyebrowSize = Math.round(L.lineSize * 0.64);
  ctx.font = `500 ${eyebrowSize}px ${t.mono}`;
  ctx.fillStyle = ink(0.68);
  put(ctx, card.eyebrow.toUpperCase(), x0 + 20, L.eyebrowY + 1, eyebrowSize * 0.16);

  // ── the figure, with its unit or its one serif word ──
  ctx.textBaseline = 'alphabetic';
  const extra = card.flourish ?? card.unit ?? '';
  const figureFont = (s: number) => `500 ${s}px ${t.display}`;
  const extraFont = (s: number) =>
    card.flourish
      ? `italic 400 ${Math.round(s * 0.98)}px ${t.serif}`
      : `500 ${Math.round(s * 0.3)}px ${t.display}`;
  const gapOf = (s: number) => (extra ? s * (card.flourish ? 0.17 : 0.11) : 0);
  const measure = (s: number) => {
    ctx.font = figureFont(s);
    const fw = widthOf(ctx, card.figure, -s * 0.035);
    ctx.font = extraFont(s);
    return { fw, ew: extra ? ctx.measureText(extra).width : 0 };
  };
  let size = L.figure;
  let m = measure(size);
  while (size > 56 && m.fw + gapOf(size) + m.ew > L.textW) {
    size -= 4;
    m = measure(size);
  }
  ctx.font = figureFont(size);
  ctx.fillStyle = ink(1);
  put(ctx, card.figure, x0, L.figureY, -size * 0.035);
  if (extra) {
    const ex = x0 + m.fw + gapOf(size);
    ctx.font = extraFont(size);
    if (card.flourish) {
      const g = ctx.createLinearGradient(ex, 0, ex + m.ew, 0);
      g.addColorStop(0, rgba(tone));
      g.addColorStop(1, rgba(toneHi));
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = ink(0.5);
    }
    ctx.fillText(extra, ex, L.figureY);
  }

  // ── one sentence ──
  ctx.font = `400 ${L.lineSize}px ${t.body}`;
  ctx.fillStyle = ink(0.64);
  wrap(ctx, card.line, L.textW).forEach((row, i) => {
    ctx.fillText(row, x0, L.lineY + i * Math.round(L.lineSize * 1.42));
  });

  // ── the facts ──
  const stats = card.stats.slice(0, 3);
  const labelSize = Math.round(L.valueSize * 0.47);
  const labelFont = `500 ${labelSize}px ${t.mono}`;
  const labelTrack = labelSize * 0.14;
  if (L.stats === 'row') {
    const cellW = L.statsW / 3;
    const inset = (i: number) => (i === 0 ? 0 : 22);
    // One size for the whole row, taken down together if the longest value would not fit its cell.
    let vs = L.valueSize;
    const fits = (s: number) => {
      ctx.font = `500 ${s}px ${t.display}`;
      return stats.every((st, i) => ctx.measureText(st.value).width <= cellW - inset(i) - 10);
    };
    while (vs > 15 && !fits(vs)) vs -= 1;

    const rule = ctx.createLinearGradient(x0, 0, x0 + L.statsW, 0);
    rule.addColorStop(0, ink(0.2));
    rule.addColorStop(1, ink(0.05));
    ctx.fillStyle = rule;
    ctx.fillRect(x0, L.statsY, L.statsW, 1);

    stats.forEach((st, i) => {
      const cx = x0 + i * cellW;
      if (i > 0) {
        ctx.fillStyle = ink(0.12);
        ctx.fillRect(cx, L.statsY + 20, 1, L.valueSize * 2.3);
      }
      ctx.font = labelFont;
      ctx.fillStyle = ink(0.46);
      put(ctx, st.label.toUpperCase(), cx + inset(i), L.statsY + 20 + labelSize, labelTrack);
      ctx.font = `500 ${vs}px ${t.display}`;
      ctx.fillStyle = ink(0.96);
      ctx.fillText(st.value, cx + inset(i), L.statsY + 20 + labelSize + L.valueSize * 1.62);
    });
  } else {
    const rowH = Math.round(L.valueSize * 2.6);
    stats.forEach((st, i) => {
      const y = L.statsY + i * rowH;
      ctx.fillStyle = ink(i === 0 ? 0.2 : 0.1);
      ctx.fillRect(x0, y, L.statsW, 1);
      ctx.textBaseline = 'middle';
      ctx.font = labelFont;
      ctx.fillStyle = ink(0.5);
      put(ctx, st.label.toUpperCase(), x0, y + rowH / 2 + 1, labelTrack);
      ctx.font = `500 ${L.valueSize}px ${t.display}`;
      ctx.fillStyle = ink(0.96);
      ctx.textAlign = 'right';
      ctx.fillText(st.value, x0 + L.statsW, y + rowH / 2 + 1);
      ctx.textAlign = 'left';
    });
  }
};

/**
 * The same picture, twice. `file` is what gets posted or saved; `clip` is what gets pasted.
 *
 * The grain and the dithered glow are noise by design, and noise is what PNG cannot compress: the
 * lossless card measured 3.9 MB in landscape and 6.4 MB square, past X's 5 MB ceiling and a long
 * upload from a phone. At this density a 0.93 JPEG is indistinguishable at 1:1 and a tenth the
 * size, and every platform re-encodes to JPEG on arrival anyway. The clipboard is the exception:
 * browsers accept only PNG there, and nothing is uploaded, so its size costs nothing.
 */
export type ShareImage = { file: Blob; clip: Blob };

const encode = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('This browser could not encode the card.'))),
      type,
      quality,
    );
  });

/** Draw `card` in `format`. */
export const renderShareCard = async (card: ShareCard, format: ShareFormat): Promise<ShareImage> => {
  const { w, h, scale } = SHARE_FORMATS[format];
  const tokens = readTokens();
  const [logo] = await Promise.all([loadLogo(), loadFonts(tokens)]);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not draw the card.');
  ctx.scale(scale, scale);
  paint(ctx, card, format, tokens, logo);

  const [file, clip] = await Promise.all([
    encode(canvas, 'image/jpeg', 0.93),
    encode(canvas, 'image/png'),
  ]);
  return { file, clip };
};

export const shareFileName = (card: ShareCard): string =>
  `spield-${card.eyebrow.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`;

/** X's compose window, prefilled. It cannot take an image by URL, so the caller copies the card first. */
export const xIntentUrl = (card: ShareCard): string =>
  `https://x.com/intent/post?text=${encodeURIComponent(card.text)}&url=${encodeURIComponent(SITE_ORIGIN)}`;
