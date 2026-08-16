import type { NextConfig } from "next";

/**
 * Two jobs here, both of them SEO-adjacent rather than cosmetic.
 *
 * The rewrites put ai.txt and security.txt at their canonical
 * `/.well-known/` paths. Next ignores dot-directories under app/ and
 * public/, so the routes are defined at the root and mapped here — which
 * also leaves the bare /ai.txt and /security.txt live, since a fair
 * number of scanners still probe the root first.
 *
 * The headers are the security posture Lighthouse and Search Console
 * both grade, and HSTS in particular is a ranking-adjacent signal in the
 * sense that a browser interstitial is worth rather less than a ranking.
 */
/** Kept in step with `SITE.appOrigin` in lib/seo/site.ts, which the CTAs read.
 *  Inlined rather than imported because next.config runs before the TS path
 *  aliases that `@/lib/...` depends on are in play. */
const APP_ORIGIN = (process.env.NEXT_PUBLIC_APP_ORIGIN ?? "https://app.spield.live").replace(
  /\/+$/,
  "",
);

const nextConfig: NextConfig = {
  poweredByHeader: false,

  async rewrites() {
    return [
      { source: "/.well-known/ai.txt", destination: "/ai.txt" },
      { source: "/.well-known/security.txt", destination: "/security.txt" },
    ];
  },

  /**
   * The dApp used to be mounted at `spield.live/dashboard/*` on the old Vite
   * build; it now has its own host. Those URLs are in bookmarks, in wallet
   * histories, and in the JSON-LD `Offer.url`s the old shell published — so
   * they are forwarded rather than left to 404 against this site's not-found.
   *
   * Permanent (308), because the move is: a temporary redirect would keep
   * Google holding the old apex URLs and never pass the signal along.
   */
  async redirects() {
    return [
      {
        source: "/dashboard",
        destination: APP_ORIGIN,
        permanent: true,
      },
      {
        source: "/dashboard/:path*",
        destination: `${APP_ORIGIN}/:path*`,
        permanent: true,
      },
    ];
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          /* Framing is refused outright rather than same-origin'd: nothing
             on this site is meant to be embedded, and a fixed-income page
             wrapped in someone else's chrome is a clickjacking surface. */
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        /* Next's font/CSS/JS bundles are content-hashed, and the hero's
           video and the icons are versioned by name. */
        source: "/:path*.(woff2|png|svg|jpg|jpeg|webp|avif|ico|mp4)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
