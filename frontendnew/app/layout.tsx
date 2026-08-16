import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import localFont from "next/font/local";
import SmoothScroll from "@/components/SmoothScroll";
import ClickWarp from "@/components/ClickWarp";
import Analytics from "@/components/Analytics";
import { SITE } from "@/lib/seo/site";
import { siteGraph } from "@/lib/seo/schema";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  display: "swap",
});

/**
 * Satoshi — the display face — self-hosted.
 *
 * It used to come from Fontshare's CDN via a plain <link>, and that cost
 * two things. A third origin to resolve, connect and TLS-handshake before
 * the stylesheet even started (measured: 608ms to the CSS, against 215ms
 * for the three self-hosted faces). And, worse, a raw @font-face has no
 * fallback metrics, so when Satoshi finally landed every line set in it
 * reflowed — one 0.132 layout shift on /learn at 1066ms, over Google's
 * 0.1 CLS threshold, because that page has twenty-four rows of it.
 *
 * `next/font/local` fixes both: the files are served from our own origin
 * with the rest of the static assets, and `adjustFontFallback` synthesises
 * a metric-matched Arial so the pre-swap layout is the same size as the
 * post-swap one. The shift goes to zero rather than getting smaller.
 *
 * The three weights are the three the site actually sets — 400/500/700 —
 * at 24KB each. Licensed under the ITF Free Font License via Fontshare,
 * which permits self-hosting; the files are committed rather than fetched
 * at build so a Fontshare outage cannot fail a deploy.
 */
const satoshi = localFont({
  src: [
    { path: "./fonts/Satoshi-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Satoshi-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Satoshi-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-satoshi",
  display: "swap",
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  /* Every relative URL below — canonical, og:image, the alternates —
     resolves against this. Without it Next emits relative OG URLs, which
     most scrapers refuse to follow. */
  metadataBase: new URL(SITE.origin),

  title: {
    default: SITE.title,
    /* Any future page gets "<its title> — Spield" without repeating the
       brand in every file. */
    template: `%s — ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [...SITE.keywords],
  authors: [{ name: SITE.legalName, url: SITE.origin }],
  creator: SITE.legalName,
  publisher: SITE.legalName,
  category: "finance",

  alternates: {
    canonical: "/",
    /* English-only today, so a self-referencing `en` plus `x-default` is
       the complete and correct set: it states that this URL serves en and
       is also the fallback for every other locale. Real locale rows go
       here when translations exist, and not before. */
    languages: { en: "/", "x-default": "/" },
    types: {
      "text/plain": [
        { url: "/llms.txt", title: "Spield content index for AI (llms.txt)" },
        { url: "/llms-full.txt", title: "Spield full corpus for AI (llms-full.txt)" },
        { url: "/.well-known/ai.txt", title: "Spield AI usage policy (ai.txt)" },
      ],
      "application/json": [
        { url: "/api/stats.json", title: "Spield protocol facts (machine-readable)" },
      ],
    },
  },

  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      /* Let Google use the whole answer rather than a clipped one — for a
         category this new, the AI Overview IS the discovery surface, and
         a truncated snippet is a truncated citation. */
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },

  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE.legalName,
    locale: "en_US",
    /* Deliberately shorter than the <title>/description pair above — a
       link preview clips where a search snippet would not. See site.ts. */
    title: SITE.ogTitle,
    description: SITE.ogDescription,
  },

  twitter: {
    card: "summary_large_image",
    title: SITE.ogTitle,
    description: SITE.ogDescription,
    site: SITE.twitter,
    creator: SITE.twitter,
  },

  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.png", sizes: "96x96", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",

  other: {
    /* Not a Google signal, but several smaller engines and a few AI
       comprehension audits still read it. */
    "ai-content-declaration": "human-authored",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  /* The browser chrome follows the page rather than picking a side: the
     theme toggle can put a dark page under a light system preference and
     a mismatched status bar is the tell. */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: SITE.themeColorLight },
    { media: "(prefers-color-scheme: dark)", color: SITE.themeColorDark },
  ],
};

/**
 * Runs before paint: restores the saved theme (or system preference)
 * and flags JS availability so reveal states only apply when they can
 * resolve. Keeping it inline prevents any theme flash.
 */
const bootstrap = `(function(){try{document.documentElement.classList.add('js');var s=localStorage.getItem('spield-theme');var t=s||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geist.variable} ${geistMono.variable} ${instrumentSerif.variable} ${satoshi.variable}`}
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: bootstrap }} />
        {/* Who Spield is, emitted from the server so it is in the first
            byte of HTML — most AI crawlers do not run JS, and structured
            data that arrives after hydration arrives after they have left. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteGraph()) }}
        />
        <SmoothScroll />
        <ClickWarp />
        {children}
        {/* Last in the tree, and it renders nothing — the tags it injects are
            deferred to idle or first interaction, so nothing here competes
            with the page for the critical render. */}
        <Analytics />
      </body>
    </html>
  );
}
