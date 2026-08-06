import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import SmoothScroll from "@/components/SmoothScroll";
import ClickWarp from "@/components/ClickWarp";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
  style: "italic",
});

export const metadata: Metadata = {
  title: "Spield — Tomorrow's yield, locked today.",
  description:
    "Deposit USDC. Redeem one exact number on one exact date. Fixed income on Stellar.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.png", sizes: "96x96", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Spield — Tomorrow's yield, locked today.",
    description:
      "Deposit USDC. Redeem one exact number on one exact date. Fixed income on Stellar.",
    type: "website",
  },
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
      className={`${geist.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: bootstrap }} />
        {/* Satoshi (display face) ships from Fontshare */}
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link
          rel="stylesheet"
          precedence="default"
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap"
        />
        <SmoothScroll />
        <ClickWarp />
        {children}
      </body>
    </html>
  );
}
