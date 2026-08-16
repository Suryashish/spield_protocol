# Spield dApp — `app.spield.live`

The interactive application: deposit, mint and trade PT/YT, provide liquidity,
bridge in. React + TypeScript + Vite, client-rendered, wallet-gated.

This used to be the whole site — landing page, `/learn` hub and dApp on one
origin. The marketing site and the content corpus now ship from the Next.js app
in [`../frontendnew`](../frontendnew) at `www.spield.live`, and this build is the
dApp and nothing else.

## Routing

The dashboard is the site root. Sections are top-level routes:

| path | |
| --- | --- |
| `/` | redirects to `/overview` |
| `/overview` `/vault` `/deposit` `/markets` `/liquidity` `/bridge` `/solvency` `/activity` | the sections |
| `/dashboard/*` | legacy redirect — drops the prefix (see `src/pages/DashboardApp.tsx`) |
| anything else | falls back to `/overview` |

`/dashboard/*` is handled in two places: here for anything landing on this host
with the old prefix, and as a 308 in `frontendnew/next.config.ts` for inbound
links still pointing at `spield.live/dashboard/…`.

## Not indexed, on purpose

Everything indexable lives on `www.spield.live`. This host is excluded three
ways, and all three are needed:

- `noindex, follow` meta in `index.html`
- `X-Robots-Tag: noindex, follow` response header in `vercel.json`
- `public/robots.txt` — which deliberately serves **`Allow: /`**

That last one looks backwards and is not. A crawler must be able to *fetch* a
URL to see a `noindex`. `Disallow: /` would block the fetch, so Google would
keep the URL as a bare, title-less listing discovered via the "Launch app" link
from the marketing site. Blocking the crawl is what keeps a page indexed;
allowing it is what removes it.

There is no `sitemap.xml` here by design. Do not add one, and do not submit this
host in Search Console.

## Deployment (Vercel)

| setting | value |
| --- | --- |
| Root Directory | `website/frontend` |
| Build Command | `tsc -b && vite build` (leave unset to inherit `package.json`) |
| Output Directory | `dist` |

The build command previously ended in `&& node scripts/prerender.mjs`, which
prerendered the `/learn` corpus to static HTML. That corpus and that script are
gone. **If a stale Build Command override in the Vercel dashboard still names
`scripts/prerender.mjs`, the deploy fails** — the file no longer exists.

### `vercel.json` takes no comments

It is validated against a strict schema that rejects unknown properties,
including underscore-prefixed ones — `should NOT have additional property` is a
hard build failure, not a warning. Notes about the config go here instead.

The one rule worth explaining is the SPA fallback:

```json
"rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
```

It looks like it would swallow every asset. It does not: Vercel checks the
filesystem *before* applying rewrites, so hashed assets, icons and the manifest
are served normally and only unmatched paths fall through to the shell for React
Router to resolve.

**Do not re-add `cleanUrls`.** It was here for the prerendered `/learn/*.html`
pages, which no longer exist, and it is actively incompatible with the rewrite
above: `cleanUrls` redirects `/index.html` to `/`, so a rewrite whose
destination *is* `/index.html` collides with it and every deep route 404s while
`/` keeps working — a failure that looks like a routing bug in the app rather
than a config one. If you ever want `cleanUrls` back, the destination has to
become `/` at the same time.

## Analytics

Google Analytics only — the tag is deferred to idle or first interaction, and
gated to `*.spield.live` so `vite dev` and preview deployments do not write into
the production property.

Pageviews are sent per route from `src/components/Analytics.tsx`, because gtag's
automatic pageview fires once per *document* load and would otherwise record the
arrival and nothing after it. `send_page_view` is off in `index.html` so the
first one is not counted twice.

**Microsoft Clarity is deliberately absent.** It runs on the marketing site only.
Clarity records sessions, and a session here is a wallet dashboard — addresses,
balances, position sizes — rendered as text nodes, which its default masking
(form inputs) does not cover.

## Local development

```bash
pnpm install
pnpm dev        # vite
pnpm build      # tsc -b && vite build
pnpm preview    # serve dist/
```

Network and contract addresses come from `VITE_*` env vars — see `.env.example`.
`VITE_NETWORK` selects `testnet` (default) or `mainnet`.
