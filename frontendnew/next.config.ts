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
const nextConfig: NextConfig = {
  poweredByHeader: false,

  async rewrites() {
    return [
      { source: "/.well-known/ai.txt", destination: "/ai.txt" },
      { source: "/.well-known/security.txt", destination: "/security.txt" },
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
