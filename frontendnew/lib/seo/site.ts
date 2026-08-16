/**
 * Canonical site constants. Every absolute URL the site emits — canonical
 * tags, JSON-LD `@id`s, the sitemap, llms.txt, ai.txt — is derived from
 * `SITE.origin`, so moving domains is one edit rather than a grep.
 *
 * `NEXT_PUBLIC_SITE_ORIGIN` overrides it, which is what preview
 * deployments want: a Vercel preview that advertises the production
 * canonical is asking Google to index the wrong host.
 */

const ORIGIN = (process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "https://www.spield.live").replace(
  /\/+$/,
  "",
);

/**
 * The dApp is a SEPARATE deployment on its own subdomain (the Vite app in
 * ../frontend). This site is the marketing and content surface; every
 * "Launch app" CTA is a cross-origin hop to that host, so it lives here as
 * a constant rather than a hard-coded href in each component.
 *
 * `NEXT_PUBLIC_APP_ORIGIN` lets a preview point at a preview of the app.
 */
const APP_ORIGIN = (process.env.NEXT_PUBLIC_APP_ORIGIN ?? "https://app.spield.live").replace(
  /\/+$/,
  "",
);

export const SITE = {
  name: "Spield",
  legalName: "Spield Protocol",
  origin: ORIGIN,
  domain: ORIGIN.replace(/^https?:\/\//, ""),
  appOrigin: APP_ORIGIN,
  twitter: "@spield_",
  twitterUrl: "https://x.com/spield_",
  github: "https://github.com/Suryashish/spield_protocol",
  email: "contact@spield.live",
  tagline: "The fixed-income layer for Stellar",

  /**
   * The <title> and <meta description> pair, written for a search
   * snippet: keyword front-loaded, title under 60 characters, description
   * in the 140–160 band where Google stops truncating.
   */
  title: "Spield — Fixed Income on Stellar | Lock a Fixed USDC Rate",
  description:
    "Deposit USDC on Stellar and lock an exact payout on an exact date. Spield splits real Blend lending yield into tradable Principal (PT) and Yield (YT) tokens.",

  /**
   * Open Graph and Twitter run SHORTER than the pair above, on purpose.
   * Search rewards the long form; a link preview card clips mid-word past
   * roughly 35 characters of title and 65 of description, and a card that
   * ends in an ellipsis reads as broken rather than as truncated.
   */
  ogTitle: "Spield — Fixed Yield on Stellar", // 31 chars (target 25–35)
  ogDescription: "Lock an exact USDC payout on an exact date, on Stellar.", // 55 chars (target 55–65)
  ogImageAlt: "Spield — fixed income and yield tokenization on Stellar",

  /** The two canvases, so the browser chrome matches whichever theme wins. */
  themeColorLight: "#f6f3ec",
  themeColorDark: "#171716",

  /**
   * Search keywords. Google has ignored the keywords meta since 2009, but
   * the string is still read by a handful of smaller engines and, more to
   * the point, it is the list `Article.keywords` and llms.txt are cut
   * from — so it earns its place as data even where it does not as a tag.
   */
  keywords: [
    "fixed income on Stellar",
    "fixed rate yield",
    "USDC yield",
    "yield tokenization",
    "principal token",
    "PT",
    "yield token",
    "YT",
    "Blend Capital",
    "Soroban",
    "Stellar DeFi",
    "zero-coupon bond",
    "time-decay AMM",
    "fixed-rate vault",
    "real yield",
  ],

  /** What the entity knows about — the topical fingerprint, for answer engines. */
  knowsAbout: [
    "Fixed income",
    "Yield tokenization",
    "Principal tokens",
    "Yield tokens",
    "Stellar",
    "Soroban smart contracts",
    "Blend Capital",
    "Decentralized finance",
    "Zero-coupon bonds",
    "Fixed-rate lending",
    "Automated market makers",
  ],
} as const;

/** Resolve a site-relative path against the canonical origin. */
export const absUrl = (path: string): string =>
  path.startsWith("http") ? path : `${SITE.origin}${path.startsWith("/") ? "" : "/"}${path}`;

/**
 * The paths that exist as real, fetchable URLs today. The site is one
 * page plus its machine-readable endpoints — there is no Learn hub here
 * yet — and a sitemap that lists routes which 404 is worse than a short
 * one, so this list stays honest and grows when the routes do.
 */
export const ROUTES = {
  home: "/",
  llms: "/llms.txt",
  llmsFull: "/llms-full.txt",
  aiTxt: "/.well-known/ai.txt",
  securityTxt: "/.well-known/security.txt",
  stats: "/api/stats.json",
  sitemap: "/sitemap.xml",
} as const;
