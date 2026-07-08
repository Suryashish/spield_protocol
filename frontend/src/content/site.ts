/** Canonical site-wide constants. Keep every absolute URL derived from here. */
export const SITE = {
  name: 'Spield',
  legalName: 'Spield Protocol',
  origin: 'https://www.spield.live',
  domain: 'www.spield.live',
  twitter: '@spield_',
  twitterUrl: 'https://x.com/spield_',
  github: 'https://github.com/Suryashish/spield_protocol',
  tagline: 'The fixed-income layer for Stellar',
  description:
    'Spield is the fixed-income and yield-tokenization layer for Stellar. Deposit USDC to lock a fixed rate, or split a yield-bearing position into tradable Principal Tokens (PT) and Yield Tokens (YT).',
  logo: 'https://www.spield.live/logo-512.png',
  /** Proper 1200×630 social-share card (matches the landing theme). */
  ogImage: 'https://www.spield.live/og-image.png',
  ogImageWidth: 1200,
  ogImageHeight: 630,
  themeColor: '#020609',
} as const;

export const absUrl = (path: string): string => {
  if (path.startsWith('http')) return path;
  return `${SITE.origin}${path.startsWith('/') ? '' : '/'}${path}`;
};
