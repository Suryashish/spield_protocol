/**
 * Where the two halves of Spield live.
 *
 * The protocol is split across two deployments: the marketing site and the
 * /learn content hub are a Next.js app at `spield.live` (../frontendnew), and
 * THIS build — the interactive dApp — is served at `app.spield.live`. Anything
 * that needs to name either host reads it from here rather than hard-coding a
 * URL, so a domain change or a preview deployment is one env var.
 *
 * `VITE_APP_ORIGIN` matters for previews in particular: a Vercel preview that
 * emits the production canonical is pointing share cards at the wrong build.
 */

const stripTrailingSlash = (url: string) => url.replace(/\/+$/, '');

/** This deployment — the dApp. */
export const APP_ORIGIN = stripTrailingSlash(
  import.meta.env.VITE_APP_ORIGIN ?? 'https://app.spield.live',
);

/** The marketing site + content hub, for "back to the website" style links. */
export const SITE_ORIGIN = stripTrailingSlash(
  import.meta.env.VITE_SITE_ORIGIN ?? 'https://www.spield.live',
);
