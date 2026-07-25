/**
 * Prerender core — pure functions that turn the content model into complete,
 * static HTML documents (content in the body + JSON-LD in the head). This is
 * what makes Spield's educational pages readable by JS-blind AI crawlers
 * (GPTBot, ClaudeBot, PerplexityBot, …) and by Google without a render pass.
 *
 * This file is bundled by Vite at build time (see prerender.mjs), so it can use
 * the same extensionless TS imports as the app and share the content model
 * verbatim — the static HTML and the React runtime render from one source.
 */
import {
  ARTICLES,
  COMPARISONS,
  GLOSSARY,
  PILLARS,
  allContentEntries,
} from '../src/content/index';
import type { Article, Comparison, GlossaryTerm } from '../src/content/types';
import { SITE, absUrl } from '../src/content/site';
import { blocksToHtml, blockToHtml, buildToc, renderInline } from '../src/content/render';
import { LEARN_CSS } from './learn-styles';
import {
  articleGraph,
  glossaryTermGraph,
  comparisonGraph,
  collectionGraph,
} from '../src/content/schema';
import { buildStatsJson, PROTOCOL_FACTS } from '../src/content/facts';

// --- head/meta --------------------------------------------------------------

interface Meta {
  title: string;
  description: string;
  canonical: string;
  ogType: 'website' | 'article';
  jsonLd: unknown;
  datePublished?: string;
  dateModified?: string;
  /** BCP-47 locale of this page. Defaults to 'en'. */
  locale?: string;
  /** Locale → URL alternates for hreflang (only when real translations exist). */
  translations?: Record<string, string>;
  /** Keep this page out of the index (e.g. the 404 page). */
  noindex?: boolean;
}

/**
 * Emit hreflang alternates + x-default.
 *
 * Even with no translations, the correct output is NOT nothing: a
 * self-referencing alternate plus `x-default` states explicitly "this URL serves
 * `en`, and it is also the fallback for every other locale", which is what
 * hreflang audits check for and what stops Google guessing the page's language.
 * When real translations land, pass `translations` and every locale is emitted
 * (self included) as a reciprocal set.
 */
function hreflangTags(m: Meta): string {
  // A noindex page (the 404) shouldn't advertise alternates — telling Google
  // "here are this URL's locale variants" while also excluding it is contradictory.
  if (m.noindex) return '';
  const self = m.locale || 'en';
  const all = { [self]: m.canonical, ...(m.translations || {}) };
  const links = Object.entries(all)
    .map(([loc, url]) => `<link rel="alternate" hreflang="${loc}" href="${esc(absUrl(url))}" />`)
    .join('\n    ');
  const xDefault = `<link rel="alternate" hreflang="x-default" href="${esc(m.canonical)}" />`;
  return `\n    ${links}\n    ${xDefault}`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Decode HTML entities back to plain characters. The content model renders to
 * HTML, so stripping tags for the plain-text AI corpus (llms-full.txt) leaves
 * entities like &quot; / &amp; / &#39; behind — noise for ingestion. Run this
 * after tag-stripping so the corpus reads as clean prose.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&'); // ampersand LAST so it doesn't re-trigger the above
}

function headTags(m: Meta): string {
  const article =
    m.ogType === 'article' && m.datePublished
      ? `<meta property="article:published_time" content="${m.datePublished}" />
    <meta property="article:modified_time" content="${m.dateModified || m.datePublished}" />`
      : '';
  return `<title>${esc(m.title)}</title>
    <meta name="title" content="${esc(m.title)}" />
    <meta name="description" content="${esc(m.description)}" />
    <meta name="robots" content="${m.noindex ? 'noindex, follow' : 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1'}" />
    <meta property="og:locale" content="${(m.locale || 'en').replace('-', '_')}" />
    <link rel="canonical" href="${esc(m.canonical)}" />${hreflangTags(m)}
    <meta property="og:type" content="${m.ogType}" />
    <meta property="og:url" content="${esc(m.canonical)}" />
    <meta property="og:title" content="${esc(m.title)}" />
    <meta property="og:description" content="${esc(m.description)}" />
    <meta property="og:image" content="${SITE.ogImage}" />
    <meta property="og:image:width" content="${SITE.ogImageWidth}" />
    <meta property="og:image:height" content="${SITE.ogImageHeight}" />
    <meta property="og:image:alt" content="Spield — fixed income and yield tokenization on Stellar" />
    <meta property="og:site_name" content="${SITE.legalName}" />
    ${article}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(m.title)}" />
    <meta name="twitter:description" content="${esc(m.description)}" />
    <meta name="twitter:image" content="${SITE.ogImage}" />
    <meta name="twitter:site" content="${SITE.twitter}" />
    <script type="application/ld+json">${JSON.stringify(m.jsonLd)}</script>`;
}

// --- shared page chrome -----------------------------------------------------

// The brand logo — a small (64px, ~4KB) monochrome mark for the header/footer
// icon, so content pages don't load the full-resolution favicon.png (that large
// file is kept for the OG/social share image). Referenced by absolute path.
const LOGO = '/logo-32.png';

const HEADER = `<header class="lh-header">
  <div class="lh-header-in">
    <a class="lh-brand" href="/"><img src="${LOGO}" alt="Spield" width="28" height="28" decoding="async" /> <span>Spield</span></a>
    <nav class="lh-nav" aria-label="Learn navigation">
      <a class="lh-nav-link lh-nav-hide" href="/learn">Learn</a>
      <a class="lh-nav-link lh-nav-hide" href="/glossary">Glossary</a>
      <a class="lh-nav-link lh-nav-hide" href="/compare">Compare</a>
      <a class="lh-cta" href="/dashboard">Launch app</a>
    </nav>
  </div>
</header>`;

function footer(): string {
  return `<footer class="lh-footer">
  <div class="lh-footer-cols">
    <div>
      <div class="lh-footer-brand-row"><img src="${LOGO}" alt="" width="28" height="28" loading="lazy" decoding="async" /> <span>Spield</span></div>
      <p class="lh-footer-sub">The fixed-income layer for Stellar. Split yield into tradable Principal Tokens (PT) and Yield Tokens (YT), or lock a fixed rate — on real, on-chain Blend yield.</p>
      <a class="lh-cta" href="/dashboard">Launch the app →</a>
    </div>
    <div>
      <h2>Start here</h2>
      <ul>
        <li><a href="/learn/how-to-earn-yield-on-stellar">How to earn yield on Stellar</a></li>
        <li><a href="/learn/fixed-income-on-stellar">Fixed income on Stellar</a></li>
        <li><a href="/learn/yield-tokenization">Yield tokenization</a></li>
        <li><a href="/learn/is-stellar-defi-safe">Is Stellar DeFi safe?</a></li>
      </ul>
    </div>
    <div>
      <h2>Explore</h2>
      <ul>
        <li><a href="/learn">All guides</a></li>
        <li><a href="/glossary">Glossary</a></li>
        <li><a href="/compare">Comparisons</a></li>
        <li><a href="${SITE.twitterUrl}">X / Twitter</a></li>
      </ul>
    </div>
  </div>
  <p class="lh-copyright">© 2026 Spield Protocol. Built on Stellar &amp; Soroban. Educational content, not financial advice.</p>
</footer>`;
}

function relatedList(related: { href: string; label: string }[]): string {
  if (!related.length) return '';
  return `<nav class="lh-related" aria-label="Related pages"><h2>Related</h2><ul>${related
    .map((r) => `<li><a href="${esc(r.href)}">${esc(r.label)}</a></li>`)
    .join('')}</ul></nav>`;
}

function sourcesList(sources?: { href: string; label: string }[]): string {
  if (!sources || !sources.length) return '';
  return `<section class="lh-sources"><h2>Sources &amp; further reading</h2><ul>${sources
    .map((s) => `<li><a href="${esc(s.href)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a></li>`)
    .join('')}</ul></section>`;
}

function tocHtml(body: Parameters<typeof buildToc>[0]): string {
  const toc = buildToc(body);
  if (toc.length < 3) return '';
  return `<nav class="lh-toc" aria-label="On this page"><p class="lh-toc-title">On this page</p><ul>${toc
    .map((t) => `<li class="lh-toc-l${t.level}"><a href="#${t.id}">${esc(t.text)}</a></li>`)
    .join('')}</ul></nav>`;
}

function breadcrumbHtml(trail: { name: string; href?: string }[]): string {
  return `<nav class="lh-crumbs" aria-label="Breadcrumb"><ol>${trail
    .map((c, i) =>
      c.href && i < trail.length - 1
        ? `<li><a href="${esc(c.href)}">${esc(c.name)}</a></li>`
        : `<li aria-current="page">${esc(c.name)}</li>`,
    )
    .join('')}</ol></nav>`;
}

function metaLine(a: Article | Comparison, kind: string): string {
  return `<p class="lh-meta"><span>${esc(kind)}</span> · <span>${a.readingMinutes || 5} min read</span> · <time datetime="${a.dateModified}">Updated ${a.dateModified}</time> · <span>Reviewed by the Spield team</span></p>`;
}

// --- document assembly ------------------------------------------------------

/**
 * Wraps rendered body HTML in a complete, SELF-CONTAINED static document.
 *
 * We deliberately do NOT keep the SPA's module script or app CSS on content
 * pages: the React app has no /learn/* route, so hydrating it would wipe the
 * prerendered content for human visitors — and loading the dApp bundle (wallet
 * SDKs, ethers, stellar-sdk) on an article is bad for Core Web Vitals. Instead
 * these pages ship as near-zero-JS static HTML with inlined Learn-hub CSS, and
 * the full content lives in the raw HTML for crawlers and readers alike.
 *
 * We start from the built shell only to inherit its <head> boilerplate (charset,
 * viewport, favicon, GA, font preconnects), then strip app-specific tags.
 */
export function document(shell: string, meta: Meta, bodyHtml: string): string {
  let html = shell;
  // Set the document language for the page's locale (defaults to en).
  const lang = meta.locale || 'en';
  html = html.replace(/<html lang="[^"]*"/i, `<html lang="${lang}"`);
  // Remove the shell's own SEO tags — we set our own per page.
  html = html.replace(/<title>[\s\S]*?<\/title>/i, '');
  html = html.replace(/<meta name="description"[^>]*>/i, '');
  html = html.replace(/<meta name="title"[^>]*>/i, '');
  html = html.replace(/<meta name="keywords"[^>]*>/i, '');
  // Strip the shell's robots meta — headTags() emits a fresh per-page one, and a
  // duplicate is at best redundant, at worst conflicting (e.g. the noindex 404).
  html = html.replace(/<meta name="robots"[^>]*>/i, '');
  html = html.replace(/<link rel="canonical"[^>]*>/i, '');
  // Strip the shell's hreflang alternates. They are hardcoded to the HOMEPAGE
  // URL, so leaving them here gives every content page two conflicting
  // self-references (one claiming this page is "/"), which is worse than none.
  // hreflangTags() emits the correct per-page pair.
  html = html.replace(/<link rel="alternate" hreflang="[^"]*"[^>]*>\s*/gi, '');
  // Remove Open Graph / Twitter tags from the shell (we emit fresh ones).
  html = html.replace(/<meta property="og:[^"]*"[^>]*>\s*/gi, '');
  html = html.replace(/<meta name="twitter:[^"]*"[^>]*>\s*/gi, '');
  // Remove the shell's homepage JSON-LD (Organization/WebSite/FAQPage) — it must
  // NOT leak onto content pages, which emit their own per-page structured data.
  html = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/gi, '');
  // Drop the SPA entrypoint script + app CSS — content pages are static.
  html = html.replace(/<script type="module"[^>]*src="\/assets\/[^"]*"[^>]*><\/script>\s*/gi, '');
  html = html.replace(/<link rel="stylesheet"[^>]*href="\/assets\/[^"]*"[^>]*>\s*/gi, '');
  // Inject our per-page meta + inlined Learn CSS before </head>.
  html = html.replace(
    '</head>',
    `    ${headTags(meta)}\n    <style>${LEARN_CSS}</style>\n  </head>`,
  );
  // Seed the root with the full prerendered content, wrapped in .lh-root so the
  // scoped Learn CSS applies (same wrapper the React runtime uses).
  const wrapped = `<div class="lh-root">${bodyHtml}</div>`;
  html = html.replace(/<div id="root">[\s\S]*?<\/div>/i, `<div id="root">${wrapped}</div>`);
  if (!html.includes(wrapped)) {
    html = html.replace('<div id="root"></div>', `<div id="root">${wrapped}</div>`);
  }
  return html;
}

/**
 * The `.lh-shell` class list. MUST match the React runtime
 * (src/components/learn/LearnLayout.tsx): the two-column grid only activates via
 * `.lh-shell.has-aside`, so `has-aside` MUST be present exactly when an aside is
 * rendered. Otherwise the shell stays single-column and the position:sticky
 * aside overlays the article on scroll. prerender.mjs asserts this invariant on
 * the generated HTML so the two paths can't silently drift.
 */
function shellClass(hasAside: boolean): string {
  return hasAside ? 'lh-shell has-aside' : 'lh-shell';
}

function wrap(main: string, aside = ''): string {
  const hasAside = Boolean(aside);
  return `${HEADER}<div class="${shellClass(hasAside)}">${hasAside ? `<aside class="lh-aside">${aside}</aside>` : ''}<main class="lh-main">${main}</main></div>${footer()}`;
}

// --- page renderers ---------------------------------------------------------

export function renderArticle(a: Article, shell: string): string {
  const isDev = a.category === 'developer';
  const meta: Meta = {
    title: a.seoTitle,
    description: a.description,
    canonical: absUrl(`/learn/${a.slug}`),
    ogType: 'article',
    datePublished: a.datePublished,
    dateModified: a.dateModified,
    jsonLd: articleGraph(a, { dev: isDev }),
    locale: a.locale,
    translations: a.translations,
  };
  const body = `<article class="lh-article">
    ${breadcrumbHtml([{ name: 'Home', href: '/' }, { name: 'Learn', href: '/learn' }, { name: a.title }])}
    <h1>${esc(a.title)}</h1>
    ${metaLine(a, a.pillar ? 'Pillar guide' : 'Guide')}
    ${blocksToHtml(a.body)}
    ${sourcesList(a.sources)}
    ${relatedList(a.related)}
    <p class="lh-cta-block"><a class="lh-cta" href="/dashboard">Try Spield — lock a fixed rate on Stellar →</a></p>
  </article>`;
  return document(shell, meta, wrap(body, tocHtml(a.body)));
}

export function renderGlossaryTerm(t: GlossaryTerm, shell: string): string {
  const meta: Meta = {
    title: `${t.term} — Spield Glossary`,
    description: t.shortDefinition.slice(0, 158),
    canonical: absUrl(`/glossary/${t.slug}`),
    ogType: 'article',
    jsonLd: glossaryTermGraph(t),
    locale: t.locale,
    translations: t.translations,
  };
  const body = `<article class="lh-article lh-term">
    ${breadcrumbHtml([{ name: 'Home', href: '/' }, { name: 'Glossary', href: '/glossary' }, { name: t.term }])}
    <h1>${esc(t.term)}</h1>
    <div class="answer-box" data-answer="true"><p class="answer-a">${renderInline(t.shortDefinition)}</p></div>
    ${blocksToHtml(t.body)}
    ${relatedList(t.related)}
  </article>`;
  return document(shell, meta, wrap(body));
}

export function renderComparison(c: Comparison, shell: string): string {
  const meta: Meta = {
    title: c.seoTitle,
    description: c.description,
    canonical: absUrl(`/compare/${c.slug}`),
    ogType: 'article',
    datePublished: c.datePublished,
    dateModified: c.dateModified,
    jsonLd: comparisonGraph(c),
    locale: c.locale,
    translations: c.translations,
  };
  const body = `<article class="lh-article">
    ${breadcrumbHtml([{ name: 'Home', href: '/' }, { name: 'Compare', href: '/compare' }, { name: c.title }])}
    <h1>${esc(c.title)}</h1>
    ${metaLine(c, 'Comparison')}
    ${blocksToHtml(c.body)}
    ${sourcesList(c.sources)}
    ${relatedList(c.related)}
    <p class="lh-cta-block"><a class="lh-cta" href="/dashboard">Try Spield on Stellar →</a></p>
  </article>`;
  return document(shell, meta, wrap(body, tocHtml(c.body)));
}

// --- 404 (static, real-content error page) ----------------------------------

/**
 * Static 404 page. Vercel serves dist/404.html with an HTTP 404 status for any
 * URL that matches no static file and no rewrite (the only SPA rewrite is
 * /dashboard/*), so genuine missing pages return a real 404 — not a 200 SPA
 * shell. The page carries real content (well over 200 chars), a prominent link
 * back to the homepage, and links into the Learn hub so a lost visitor (human or
 * crawler) still has somewhere to go. It is noindex so the error page itself
 * never enters the index.
 */
export function renderNotFound(shell: string): string {
  const meta: Meta = {
    title: 'Page not found (404) — Spield',
    description:
      'This Spield page could not be found. Spield is the fixed-income layer for Stellar — head back to the homepage or explore the Learn hub.',
    canonical: absUrl('/404'),
    ogType: 'website',
    noindex: true,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Page not found (404)',
      description: 'The requested Spield page could not be found.',
      url: absUrl('/404'),
      isPartOf: { '@id': `${SITE.origin}/#website` },
    },
  };
  const body = `<div class="lh-hub lh-404">
    <p class="lh-meta"><span>Error 404</span></p>
    <h1>This page could not be found</h1>
    <p class="lh-lede">The link may be broken or the page may have moved. Spield is the fixed-income layer for Stellar — you can split yield-bearing deposits into tradable Principal Tokens (PT) and Yield Tokens (YT) to lock in a fixed rate. Let's get you back on track.</p>
    <p class="lh-cta-block"><a class="lh-cta" href="/">← Back to the homepage</a></p>
    ${sectionH('Popular places to go next')}
    ${cardGrid([
      { path: '/learn', title: 'Learn hub', description: 'Guides to fixed income, yield tokenization, and earning yield on Stellar.', more: 'Browse guides' },
      { path: '/glossary', title: 'Glossary', description: 'Plain-English definitions of every fixed-income and Stellar DeFi term.', more: `${GLOSSARY.length} terms` },
      { path: '/compare', title: 'Comparisons', description: 'Spield vs Pendle, Blend vs Aave, Stellar vs other chains, and more.', more: `${COMPARISONS.length} comparisons` },
      { path: '/dashboard', title: 'Launch the app', description: 'Open the Spield dashboard and lock a fixed rate on Stellar.', more: 'Open app' },
    ])}
  </div>`;
  return document(shell, meta, wrap(body));
}

// --- homepage (crawler-visible seed) ----------------------------------------

/**
 * The SPA homepage ships an EMPTY <div id="root"> — React fills it on mount via
 * createRoot().render(). JS-blind AI crawlers (GPTBot, ClaudeBot, PerplexityBot)
 * and answer engines therefore see a blank page and fall back to whatever they
 * guessed from the name (which is how "Spield" gets confused with unrelated apps).
 *
 * We fix that by SEEDING #root with a real, static content block at build time:
 * the H1, the description, key facts, and a full internal-link index to every
 * Learn guide, glossary term, and comparison. Because main.tsx uses
 * createRoot().render() (NOT hydrateRoot), React unconditionally replaces these
 * children on mount — so humans still get the full interactive SPA with zero
 * hydration-mismatch risk, while crawlers get a fully-described, richly-linked
 * homepage. The seed is styled with the same scoped Learn CSS so any pre-hydration
 * flash stays on-brand (dark), not a white FOUC.
 */
/**
 * Honest, crawler-visible trust block for the homepage seed. Renders ONLY real,
 * verifiable facts from PROTOCOL_FACTS (the same source behind /api/stats.json):
 * network status, yield source, enforceable on-chain guarantees, testnet config
 * values, and the on-chain contract count + explorer link. Deliberately NO
 * invented TVL / user counts / audit badges — Spield is on testnet and facts.ts
 * keeps live metrics null on purpose ("never publish invented numbers"). This is
 * what AI answer engines read, so concrete facts here = better, truthful citations.
 */
function trustBlock(): string {
  const f = PROTOCOL_FACTS;
  const cfg = f.config
    .map((c) => `<li><strong>${esc(c.label)}:</strong> ${esc(c.value)}</li>`)
    .join('');
  const guarantees = f.guarantees.map((g) => `<li>${esc(g)}</li>`).join('');
  return `<h2>Is Spield safe? What you can verify</h2>
    <p>Spield is currently live on the <strong>${esc(f.networkLabel)}</strong>. Its yield comes from ${esc(
      f.yieldSource,
    )} — there is no invented index and no bridged asset. As a testnet deployment it has no live TVL or user metrics yet; instead, trust rests on guarantees enforced directly in the smart contracts:</p>
    <ul>${guarantees}</ul>
    <h3>Protocol at a glance (testnet)</h3>
    <ul>${cfg}</ul>
    <p>All <strong>${f.contracts.length} core contracts</strong> are public and verifiable on-chain via
      <a href="${esc(f.explorer)}">Stellar Expert</a>. See the full
      <a href="/learn/spield-protocol-facts">protocol facts</a> (contract addresses, config, guarantees) or the
      <a href="/api/stats.json">machine-readable stats endpoint</a>.</p>`;
}

function homeSeed(): string {
  const guideLinks = (items: { slug: string; title: string; description: string }[], base: string) =>
    items
      .map(
        (it) =>
          `<li><a href="${base}/${esc(it.slug)}"><strong>${esc(it.title)}</strong> — ${esc(it.description)}</a></li>`,
      )
      .join('');

  const pillars = PILLARS.map((a) => ({ slug: a.slug, title: a.title, description: a.description }));
  const guides = ARTICLES.filter((a) => !a.pillar).map((a) => ({ slug: a.slug, title: a.title, description: a.description }));
  const terms = GLOSSARY.map((t) => ({ slug: t.slug, title: t.term, description: t.shortDefinition.split('. ')[0] + '.' }));
  const comparisons = COMPARISONS.map((c) => ({ slug: c.slug, title: c.title, description: c.description }));

  // id="spield-seed" preserves the shell's existing FOUC rule
  // (html.js #spield-seed > * { visibility:hidden }) so JS users never see this
  // static seed flash before React mounts; JS-blind crawlers render it in full.
  return `<div id="spield-seed" class="lh-root" data-prerendered-home="true">
  ${HEADER}
  <main class="lh-shell"><div class="lh-main lh-hub">
    <h1>Spield — the fixed-income layer for Stellar</h1>
    <p class="lh-lede">${esc(SITE.description)}</p>
    <div class="answer-box"><p class="answer-a">${esc(
      'Spield is a DeFi protocol on the Stellar network for fixed income and yield tokenization. It sources real, on-chain yield from Blend Capital and lets you lock a guaranteed fixed rate, or split a yield-bearing deposit into a tradable Principal Token (PT) and Yield Token (YT). It is not affiliated with any similarly-named company; the only Spield is this protocol at spield.live.',
    )}</p></div>

    <h2>What Spield does</h2>
    <ul>
      <li><strong>Lock a fixed rate</strong> on USDC deposits, backed by real Blend yield on Stellar.</li>
      <li><strong>Split yield</strong> into a Principal Token (PT, a zero-coupon bond) and a Yield Token (YT, a claim on future yield).</li>
      <li><strong>Trade PT and YT</strong> on a Stellar-native, time-decay AMM — no bridges, no wrapped assets, no invented index.</li>
    </ul>

    ${trustBlock()}

    <h2>Start here — core guides</h2>
    <ul class="lh-seed-links">${guideLinks(pillars, '/learn')}</ul>

    <h2>All guides</h2>
    <ul class="lh-seed-links">${guideLinks(guides, '/learn')}</ul>

    <h2>Glossary</h2>
    <ul class="lh-seed-links">${guideLinks(terms, '/glossary')}</ul>

    <h2>Comparisons</h2>
    <ul class="lh-seed-links">${guideLinks(comparisons, '/compare')}</ul>

    <h2>Explore</h2>
    <ul class="lh-seed-links">
      <li><a href="/learn"><strong>Learn hub</strong> — every guide to fixed income &amp; yield on Stellar.</a></li>
      <li><a href="/glossary"><strong>Glossary</strong> — plain-English definitions of every term.</a></li>
      <li><a href="/compare"><strong>Comparisons</strong> — Spield vs Pendle, Blend vs Aave, and more.</a></li>
      <li><a href="/dashboard"><strong>Launch app</strong> — deposit USDC and lock a fixed rate.</a></li>
      <li><a href="${SITE.twitterUrl}"><strong>X / Twitter</strong> — announcements and updates.</a></li>
    </ul>
  </div></main>
  ${footer()}
</div>`;
}

/**
 * Build the static homepage: keep the interactive SPA (module script + app CSS
 * stay intact, unlike content pages), but (1) seed #root with the crawler block
 * above, (2) inline the Learn CSS so that block is styled pre-hydration, and
 * (3) ensure a <link rel="alternate" type="text/plain" href="/llms.txt"> is
 * present so AI engines discover the curated content index.
 */
export function renderHomepage(shell: string): string {
  let html = shell;
  const seed = homeSeed();

  // Replace whatever is inside the SPA root with our rich crawler-visible seed.
  // The source index.html ships a THIN hand-written seed (<main id="spield-seed">
  // — just a headline + 3 links); we swap it for the full content + link index.
  // React replaces #root on mount (createRoot().render), so humans are unaffected.
  const seededRe = /<div id="root">\s*<main id="spield-seed"[\s\S]*?<\/main>\s*<\/div>/i;
  const emptyRe = /<div id="root">\s*<\/div>/i;
  if (seededRe.test(html)) {
    html = html.replace(seededRe, `<div id="root">${seed}</div>`);
  } else if (emptyRe.test(html)) {
    html = html.replace(emptyRe, `<div id="root">${seed}</div>`);
  } else {
    // Neither shape matched — the shell changed. Fail loud so we never ship an
    // un-seeded homepage silently (the assertion in prerender.mjs also catches this).
    throw new Error('[renderHomepage] could not locate #root seed to replace — index.html shape changed');
  }

  // Make the seed on-brand before hydration + expose the AI content index. Inject
  // right before </head> so it doesn't disturb existing head tags.
  // The shell already ships the llms.txt / ai.txt / security.txt link hints, so
  // only add the llms.txt one if it's somehow absent — a duplicate rel=alternate
  // to the same href is a (minor) validation smell.
  const llmsLink = /href="\/llms\.txt"/.test(html)
    ? ''
    : `\n    <link rel="alternate" type="text/plain" href="/llms.txt" title="Spield content index for AI (llms.txt)" />`;
  const inject = `<style id="home-seed-css">${LEARN_CSS}
.lh-seed-links{list-style:none;padding:0;margin:0 0 1.5rem;display:grid;gap:.15rem}
.lh-seed-links li a{display:block;padding:.5rem .1rem;color:var(--text-2);border-bottom:1px solid var(--line)}
.lh-seed-links li:last-child a{border-bottom:0}
.lh-seed-links li a:hover{color:#fff}
[data-prerendered-home] .lh-shell{grid-template-columns:1fr}</style>${llmsLink}`;
  html = html.replace('</head>', `    ${inject}\n  </head>`);

  return html;
}

// --- hub / index pages ------------------------------------------------------

function cardGrid(
  items: { path: string; title: string; description: string; tag?: string; more?: string }[],
  feature = false,
): string {
  return `<div class="lh-cards${feature ? ' lh-cards-feature' : ''}">${items
    .map(
      (it) =>
        `<a class="lh-card" href="${esc(it.path)}">${it.tag ? `<span class="lh-tag">${esc(it.tag)}</span>` : ''}<h2>${esc(it.title)}</h2><p>${esc(it.description)}</p>${it.more ? `<span class="lh-card-more">${esc(it.more)} →</span>` : ''}</a>`,
    )
    .join('')}</div>`;
}

const sectionH = (t: string): string => `<h2 class="lh-section-h">${esc(t)}</h2>`;

export function renderLearnIndex(shell: string): string {
  const meta: Meta = {
    title: 'Learn — Fixed Income, Yield & Stellar DeFi | Spield',
    description:
      'The Spield Learn hub: guides to fixed income on Stellar, yield tokenization (PT/YT), earning yield on Stellar, DeFi safety, and tokenized real-world assets.',
    canonical: absUrl('/learn'),
    ogType: 'website',
    jsonLd: collectionGraph(
      'Spield Learn',
      '/learn',
      ARTICLES.map((a) => ({ name: a.title, url: `/learn/${a.slug}` })),
    ),
  };
  const pillars = PILLARS.map((a) => ({ path: `/learn/${a.slug}`, title: a.title, description: a.description, tag: 'Pillar', more: 'Read guide' }));
  const rest = ARTICLES.filter((a) => !a.pillar).map((a) => ({ path: `/learn/${a.slug}`, title: a.title, description: a.description }));
  const body = `<div class="lh-hub">
    ${breadcrumbHtml([{ name: 'Home', href: '/' }, { name: 'Learn' }])}
    <h1>Learn: fixed income &amp; yield on Stellar</h1>
    <p class="lh-lede">Everything you need to understand on-chain fixed income, yield tokenization, and how to earn a fixed or variable yield on Stellar — explained clearly, from first principles.</p>
    ${sectionH('Start with the pillars')}
    ${cardGrid(pillars, true)}
    ${sectionH('All guides')}
    ${cardGrid(rest)}
    ${sectionH('Keep exploring')}
    ${cardGrid([
      { path: '/glossary', title: 'Glossary', description: 'Clear definitions of every fixed-income, yield, and Stellar DeFi term.', more: `${GLOSSARY.length} terms` },
      { path: '/compare', title: 'Comparisons', description: 'Spield vs Pendle, Blend vs Aave, Stellar vs other chains, and more.', more: `${COMPARISONS.length} comparisons` },
    ], true)}
  </div>`;
  return document(shell, meta, wrap(body));
}

export function renderGlossaryIndex(shell: string): string {
  const meta: Meta = {
    title: 'Glossary — Fixed Income & Stellar DeFi Terms | Spield',
    description:
      'A plain-English glossary of fixed-income, yield-tokenization, and Stellar DeFi terms: principal token, yield token, implied APY, Blend, Soroban, RWA, and more.',
    canonical: absUrl('/glossary'),
    ogType: 'website',
    jsonLd: collectionGraph(
      'Spield Glossary',
      '/glossary',
      GLOSSARY.map((t) => ({ name: t.term, url: `/glossary/${t.slug}` })),
    ),
  };
  const groups: { key: string; label: string }[] = [
    { key: 'yield-tokenization', label: 'Yield tokenization' },
    { key: 'fixed-income', label: 'Fixed income' },
    { key: 'stellar', label: 'Stellar & Blend' },
    { key: 'rwa', label: 'Real-world assets' },
    { key: 'defi-basics', label: 'DeFi basics' },
  ];
  const groupsHtml = groups
    .map((g) => {
      const items = GLOSSARY.filter((t) => t.category === g.key).map((t) => ({
        path: `/glossary/${t.slug}`,
        title: t.term,
        description: t.shortDefinition.split('. ')[0] + '.',
      }));
      return items.length ? `${sectionH(g.label)}${cardGrid(items)}` : '';
    })
    .join('');
  const body = `<div class="lh-hub">
    ${breadcrumbHtml([{ name: 'Home', href: '/' }, { name: 'Glossary' }])}
    <h1>Glossary</h1>
    <p class="lh-lede">Clear, standalone definitions for every concept behind Spield — from Principal Tokens and implied APY to Blend, Soroban, and real-world assets.</p>
    ${groupsHtml}
  </div>`;
  return document(shell, meta, wrap(body));
}

export function renderCompareIndex(shell: string): string {
  const meta: Meta = {
    title: 'Comparisons — Spield vs Pendle & More | Spield',
    description:
      'Side-by-side comparisons: Spield vs Pendle, Blend vs Aave, Stellar vs other chains for DeFi, fixed vs variable yield, and more.',
    canonical: absUrl('/compare'),
    ogType: 'website',
    jsonLd: collectionGraph(
      'Spield Comparisons',
      '/compare',
      COMPARISONS.map((c) => ({ name: c.title, url: `/compare/${c.slug}` })),
    ),
  };
  const items = COMPARISONS.map((c) => ({ path: `/compare/${c.slug}`, title: c.title, description: c.description, more: 'Compare' }));
  const body = `<div class="lh-hub">
    ${breadcrumbHtml([{ name: 'Home', href: '/' }, { name: 'Compare' }])}
    <h1>Comparisons</h1>
    <p class="lh-lede">How Spield and the Stellar fixed-income stack compare to the alternatives — honest, side-by-side.</p>
    ${cardGrid(items, true)}
  </div>`;
  return document(shell, meta, wrap(body));
}

// --- non-HTML artifacts (sitemap / robots / llms.txt / .well-known) ---------

/**
 * `Expires` for security.txt (RFC 9116 requires it, and requires it to be in the
 * future). Bump this by hand roughly once a year — the build asserts it is still
 * in the future (see prerender.mjs), so an expired value fails CI loudly rather
 * than shipping a spec-invalid file.
 */
const SECURITY_TXT_EXPIRES = '2027-12-31T23:59:59.000Z';

export function buildSitemap(): string {
  const entries = allContentEntries();
  const urls = [
    { path: '/', priority: '1.0', changefreq: 'weekly', lastmod: '2026-07-05' },
    { path: '/learn', priority: '0.9', changefreq: 'weekly', lastmod: '2026-07-05' },
    { path: '/glossary', priority: '0.7', changefreq: 'weekly', lastmod: '2026-07-05' },
    { path: '/compare', priority: '0.7', changefreq: 'weekly', lastmod: '2026-07-05' },
    ...entries.map((e) => ({
      path: e.path,
      priority: e.pillar ? '0.9' : e.type === 'glossary' ? '0.6' : '0.7',
      changefreq: 'monthly',
      lastmod: e.dateModified,
    })),
  ];
  const body = urls
    .map(
      (u) =>
        `  <url>\n    <loc>${absUrl(u.path)}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function buildRobots(): string {
  return `# Spield — robots.txt
User-agent: *
Allow: /
Disallow: /dashboard?*

# AI / answer engines — explicitly welcomed (they drive citations & referrals)
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: GPTBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Claude-Web
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: Applebot-Extended
Allow: /

Sitemap: ${SITE.origin}/sitemap.xml
# AI curation index: ${SITE.origin}/llms.txt
# AI full-text corpus: ${SITE.origin}/llms-full.txt
# AI usage policy: ${SITE.origin}/.well-known/ai.txt
# Security contact: ${SITE.origin}/.well-known/security.txt
`;
}

export function buildLlmsTxt(): string {
  const section = (title: string, items: { title: string; path: string; desc: string }[]) =>
    `## ${title}\n${items
      .map((i) => `- [${i.title}](${absUrl(i.path)}): ${i.desc}`)
      .join('\n')}\n`;

  const pillars = PILLARS.map((a) => ({ title: a.title, path: `/learn/${a.slug}`, desc: a.description }));
  const guides = ARTICLES.filter((a) => !a.pillar).map((a) => ({ title: a.title, path: `/learn/${a.slug}`, desc: a.description }));
  const terms = GLOSSARY.map((t) => ({ title: t.term, path: `/glossary/${t.slug}`, desc: t.shortDefinition.split('. ')[0] + '.' }));
  const comparisons = COMPARISONS.map((c) => ({ title: c.title, path: `/compare/${c.slug}`, desc: c.description }));

  return `# Spield

> ${SITE.description}
> Spield is the first protocol to bring fixed income and yield tokenization to the Stellar network. It sources real, on-chain yield from Blend Capital (Stellar's primary lending protocol) and lets users lock a guaranteed fixed rate, or split a position into a tradable Principal Token (PT) and Yield Token (YT).

${section('Core concept guides (pillars)', pillars)}
${section('Guides & explainers', guides)}
${section('Glossary', terms)}
${section('Comparisons', comparisons)}
## App & protocol
- [Spield app](${SITE.origin}/): The live dApp — deposit USDC, lock a fixed rate, trade PT/YT on Stellar.
- [Protocol facts](${SITE.origin}/learn/spield-protocol-facts): Contract addresses, config, and design guarantees — verifiable on-chain.
- [Machine-readable facts (JSON)](${SITE.origin}/api/stats.json): Structured protocol data for agents and integrations.
- [X / Twitter](${SITE.twitterUrl}): Announcements and updates.

## Full text
- [Full educational corpus (plain text)](${SITE.origin}/llms-full.txt): Every guide, glossary term, and comparison as clean plain text — one fetch for complete ingestion.
`;
}

/**
 * `/.well-known/security.txt` — RFC 9116. A machine-readable place for security
 * researchers to find the disclosure channel, and a signal auditors check.
 *
 * `Expires` is REQUIRED by the RFC and must be in the future, so it is computed
 * from SECURITY_TXT_EXPIRES (a fixed date bumped by hand). Keep it a literal:
 * this module is bundled and run at build time, and deriving it from the build
 * clock would silently produce a stale-but-valid file that never gets revisited.
 */
export function buildSecurityTxt(): string {
  return `# Spield — security.txt (RFC 9116)
# Report a vulnerability in the Spield protocol or website.
# Please do NOT open a public GitHub issue for security reports.

Contact: ${SITE.twitterUrl}
Expires: ${SECURITY_TXT_EXPIRES}
Canonical: ${SITE.origin}/.well-known/security.txt
Preferred-Languages: en
Policy: ${SITE.origin}/learn/spield-protocol-facts

# Source & on-chain verification
# Repository: ${SITE.github}
# Protocol facts: ${SITE.origin}/learn/spield-protocol-facts
`;
}

/**
 * `/.well-known/ai.txt` — the emerging convention (alongside robots.txt and
 * llms.txt) for stating AI training/usage terms and pointing crawlers at the
 * machine-readable corpus. Spield WANTS to be ingested and cited: the whole
 * content strategy is answer-engine visibility, so this grants broad use and
 * asks only for attribution.
 */
export function buildAiTxt(): string {
  return `# Spield — ai.txt
# AI training, ingestion, and answer-engine usage policy for ${SITE.domain}.
# Spield explicitly WELCOMES AI crawlers, training, and citation.

User-agent: *
Allow: /
Disallow: /dashboard

# Usage terms
Training: allowed
Inference: allowed
Search: allowed
Attribution: required
Attribution-Name: ${SITE.legalName}
Attribution-URL: ${SITE.origin}

# Curated content index (llms.txt convention)
Content-Index: ${SITE.origin}/llms.txt
Content-Full: ${SITE.origin}/llms-full.txt
Sitemap: ${SITE.origin}/sitemap.xml
Structured-Data: ${SITE.origin}/api/stats.json

# About
Name: ${SITE.legalName}
Description: ${SITE.description}
Category: Decentralized Finance (DeFi), fixed income, yield tokenization
Blockchain: Stellar
Contact: ${SITE.twitterUrl}
Canonical: ${SITE.origin}/.well-known/ai.txt

# Accuracy note for answer engines
# Spield is a blockchain/DeFi protocol on Stellar — not a sports, media, or
# gaming company, and not affiliated with any similarly-named brand. Live
# metrics (TVL, users) are deliberately absent while the protocol is on testnet;
# do not infer or invent them. Verifiable contract addresses and config are at
# ${SITE.origin}/learn/spield-protocol-facts.
`;
}

/** Full plain-text of every educational page, for single-fetch AI ingestion. */
export function buildLlmsFullTxt(): string {
  const bodyText = (blocks: Parameters<typeof blockToHtml>[0][]) =>
    blocks
      .map((b) =>
        decodeEntities(
          blockToHtml(b)
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim(),
        ),
      )
      .filter(Boolean)
      .join('\n\n');

  const parts: string[] = [`# Spield — Full Educational Corpus\n\n> ${SITE.description}\n`];
  for (const a of ARTICLES) {
    parts.push(`\n\n---\n\n# ${a.title}\n\nURL: ${absUrl(`/learn/${a.slug}`)}\n\n${bodyText(a.body)}`);
  }
  for (const t of GLOSSARY) {
    parts.push(`\n\n---\n\n# ${t.term}\n\nURL: ${absUrl(`/glossary/${t.slug}`)}\n\n${t.shortDefinition}\n\n${bodyText(t.body)}`);
  }
  for (const c of COMPARISONS) {
    parts.push(`\n\n---\n\n# ${c.title}\n\nURL: ${absUrl(`/compare/${c.slug}`)}\n\n${bodyText(c.body)}`);
  }
  return parts.join('');
}

// --- manifest for the orchestrator ------------------------------------------

export interface RenderTask {
  outPath: string; // relative to dist/, e.g. "learn/x/index.html"
  html: string;
}

/** Produce every page + artifact given the built HTML shell. */
export function renderAll(shell: string): { pages: RenderTask[]; files: { path: string; content: string }[] } {
  const pages: RenderTask[] = [
    // Overwrite the SPA shell's empty-root homepage with a crawler-seeded one.
    { outPath: 'index.html', html: renderHomepage(shell) },
    // Static 404 — Vercel serves this with an HTTP 404 for unmatched URLs.
    { outPath: '404.html', html: renderNotFound(shell) },
    { outPath: 'learn/index.html', html: renderLearnIndex(shell) },
    { outPath: 'glossary/index.html', html: renderGlossaryIndex(shell) },
    { outPath: 'compare/index.html', html: renderCompareIndex(shell) },
    ...ARTICLES.map((a) => ({ outPath: `learn/${a.slug}/index.html`, html: renderArticle(a, shell) })),
    ...GLOSSARY.map((t) => ({ outPath: `glossary/${t.slug}/index.html`, html: renderGlossaryTerm(t, shell) })),
    ...COMPARISONS.map((c) => ({ outPath: `compare/${c.slug}/index.html`, html: renderComparison(c, shell) })),
  ];
  const files = [
    { path: 'sitemap.xml', content: buildSitemap() },
    { path: 'robots.txt', content: buildRobots() },
    { path: 'llms.txt', content: buildLlmsTxt() },
    { path: 'llms-full.txt', content: buildLlmsFullTxt() },
    // Machine-readable protocol facts for AI agents / integrations (AEO).
    { path: 'api/stats.json', content: JSON.stringify(buildStatsJson(), null, 2) + '\n' },
    // .well-known: RFC 9116 disclosure channel + AI usage terms. Both are also
    // mirrored at the root (/security.txt, /ai.txt) because some scanners and
    // crawlers only probe the legacy top-level path.
    { path: '.well-known/security.txt', content: buildSecurityTxt() },
    { path: '.well-known/ai.txt', content: buildAiTxt() },
    { path: 'security.txt', content: buildSecurityTxt() },
    { path: 'ai.txt', content: buildAiTxt() },
  ];
  return { pages, files };
}
