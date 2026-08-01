/** Canonical site-wide constants. Keep every absolute URL derived from here. */
export const SITE = {
  name: 'Spield',
  legalName: 'Spield Protocol',
  origin: 'https://www.spield.live',
  domain: 'www.spield.live',
  twitter: '@spield_',
  twitterUrl: 'https://x.com/spield_',
  github: 'https://github.com/Suryashish/spield_protocol',
  email: 'contact@spield.live',
  tagline: 'The fixed-income layer for Stellar',
  description:
    'Spield is the fixed-income and yield-tokenization layer for Stellar. Deposit USDC to lock a fixed rate, or split a yield-bearing position into tradable Principal Tokens (PT) and Yield Tokens (YT).',
  logo: 'https://www.spield.live/logo-512.png',
  /** Proper 1200×630 social-share card (matches the landing theme). */
  ogImage: 'https://www.spield.live/og-image.png',
  ogImageWidth: 1200,
  ogImageHeight: 630,
  themeColor: '#020609',
  /**
   * Open Graph title/description for the HOME page specifically.
   *
   * These are deliberately shorter than the <title>/<meta description> pair.
   * Search snippets reward the long form (~60c title, ~155c description), but
   * social cards and AI-comprehension audits target a much tighter band — ~25-35
   * chars for og:title and ~55-65 for og:description — because link previews clip
   * mid-word past that. So we keep the SEO-length tags for crawlers and use these
   * for OG/Twitter. Interior pages still derive OG from their own title/desc,
   * where the page-specific wording matters more than hitting the band.
   */
  ogTitle: 'Spield — Fixed Yield on Stellar', // 31 chars (target 25-35)
  ogDescription: 'Fixed-rate USDC yield and tradable PT/YT tokens on Stellar.', // 59 chars (target 55-65)
} as const;

export const absUrl = (path: string): string => {
  if (path.startsWith('http')) return path;
  return `${SITE.origin}${path.startsWith('/') ? '' : '/'}${path}`;
};
