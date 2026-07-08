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
import { buildStatsJson } from '../src/content/facts';

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
}

/** Emit hreflang alternates (+ x-default) when a page has translations. */
function hreflangTags(m: Meta): string {
  if (!m.translations || !Object.keys(m.translations).length) return '';
  const self = m.locale || 'en';
  const all = { [self]: m.canonical, ...m.translations };
  const links = Object.entries(all)
    .map(([loc, url]) => `<link rel="alternate" hreflang="${loc}" href="${esc(absUrl(url))}" />`)
    .join('\n    ');
  const xDefault = `<link rel="alternate" hreflang="x-default" href="${esc(m.canonical)}" />`;
  return `\n    ${links}\n    ${xDefault}`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    <meta name="robots" content="index, follow, max-image-preview:large" />
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
    <a class="lh-brand" href="/"><img src="${LOGO}" alt="Spield" /> <span>Spield</span></a>
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
      <div class="lh-footer-brand-row"><img src="${LOGO}" alt="" /> <span>Spield</span></div>
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
  html = html.replace(/<link rel="canonical"[^>]*>/i, '');
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

function wrap(main: string, aside = ''): string {
  return `${HEADER}<div class="lh-shell">${aside ? `<aside class="lh-aside">${aside}</aside>` : ''}<main class="lh-main">${main}</main></div>${footer()}`;
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

// --- non-HTML artifacts (sitemap / robots / llms.txt) -----------------------

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
`;
}

/** Full plain-text of every educational page, for single-fetch AI ingestion. */
export function buildLlmsFullTxt(): string {
  const bodyText = (blocks: Parameters<typeof blockToHtml>[0][]) =>
    blocks
      .map((b) =>
        blockToHtml(b)
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
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
  ];
  return { pages, files };
}
