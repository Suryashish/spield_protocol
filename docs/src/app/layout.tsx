import { RootProvider } from 'fumadocs-ui/provider/next';
// Dev-phase banner is currently hidden — re-enable the import together with the
// <Banner> usage below to bring back the "live on testnet" notice.
// import { Banner } from 'fumadocs-ui/components/banner';
import './global.css';
import { Inter, Space_Grotesk } from 'next/font/google';
import type { Metadata } from 'next';
import { appName, appTagline } from '@/lib/shared';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-heading',
});

/**
 * Base URL for resolving absolute OG/Twitter image URLs. Set `NEXT_PUBLIC_SITE_URL`
 * (or Vercel's `VERCEL_URL`) at deploy time; falls back to localhost in dev.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${appName} — ${appTagline}`,
    template: `%s · ${appName} Docs`,
  },
  description:
    'Spield is a fixed-income protocol on Stellar. Split real, on-chain yield into a fixed-rate Principal Token (PT) and a leveraged Yield Token (YT), lock a guaranteed return, and trade the time-decay AMM.',
  applicationName: `${appName} Documentation`,
  keywords: [
    'Spield',
    'Stellar',
    'Soroban',
    'fixed income',
    'yield stripping',
    'Principal Token',
    'Yield Token',
    'PT',
    'YT',
    'Blend',
    'DeFi',
    'USDC',
    'fixed rate',
  ],
  openGraph: {
    title: `${appName} — ${appTagline}`,
    description:
      'Fixed-rate bonds and tradable yield on Stellar, backed by real on-chain yield.',
    siteName: `${appName} Documentation`,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${appName} — ${appTagline}`,
    description:
      'Fixed-rate bonds and tradable yield on Stellar, backed by real on-chain yield.',
  },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${inter.className}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <RootProvider
          theme={{
            defaultTheme: 'dark',
          }}
        >
          {/* Dev-phase banner — hidden for now; uncomment to re-enable the
              "live on testnet, mainnet soon" notice site-wide.
          <Banner variant="rainbow" id="spield-dev-phase-2026-06">
            🚧 Spield is in active development — live on <strong>Stellar testnet</strong> today,
            with mainnet launching soon.
          </Banner>
          */}
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
