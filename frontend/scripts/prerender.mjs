/**
 * Prerender orchestrator. Runs after `vite build` (see package.json `build`).
 *
 * Pipeline:
 *   1. Bundle scripts/render-page.ts (which imports the TS content model) into a
 *      temporary ESM file using Vite's own build — so we need NO extra deps and
 *      the exact same TS/alias resolution as the app.
 *   2. Import that bundle, read the built dist/index.html shell.
 *   3. Write every prerendered page (dist/learn/**, dist/glossary/**,
 *      dist/compare/**) plus sitemap.xml, robots.txt, llms.txt, llms-full.txt.
 *
 * The result: educational URLs return complete static HTML (content + JSON-LD)
 * that JS-blind AI crawlers and search engines can read directly, while the
 * React SPA still serves the interactive dApp.
 */
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const tmpDir = path.join(root, 'node_modules', '.tmp-prerender');

async function bundleRenderer() {
  await build({
    root,
    logLevel: 'warn',
    configFile: false,
    resolve: { alias: { '@': path.join(root, 'src') } },
    build: {
      lib: {
        entry: path.join(root, 'scripts', 'render-page.ts'),
        formats: ['es'],
        fileName: () => 'render-page.mjs',
      },
      outDir: tmpDir,
      emptyOutDir: true,
      minify: false,
      // Keep it self-contained; no externals needed (pure logic, no runtime deps).
      rollupOptions: { external: [] },
      write: true,
      target: 'node20',
    },
  });
  return path.join(tmpDir, 'render-page.mjs');
}

async function writeFileEnsuring(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function main() {
  const shellPath = path.join(distDir, 'index.html');
  let shell;
  try {
    shell = await fs.readFile(shellPath, 'utf8');
  } catch {
    console.error(
      '[prerender] dist/index.html not found. Run `vite build` before prerender (the `build` script does this).',
    );
    process.exit(1);
  }

  console.log('[prerender] bundling content renderer…');
  const rendererPath = await bundleRenderer();
  const renderer = await import(pathToFileUrl(rendererPath));

  const { pages, files } = renderer.renderAll(shell);

  console.log(`[prerender] writing ${pages.length} pages + ${files.length} artifacts…`);
  for (const page of pages) {
    await writeFileEnsuring(path.join(distDir, page.outPath), page.html);
  }
  for (const file of files) {
    await writeFileEnsuring(path.join(distDir, file.path), file.content);
  }

  // Clean up the temp bundle.
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  // Lint internal links: every /learn|/glossary|/compare href must resolve to a
  // page we just generated. Catches related[]/inline links to unwritten pages.
  const existing = new Set(['/learn', '/glossary', '/compare', '/', '/dashboard']);
  for (const p of pages) existing.add('/' + p.outPath.replace(/\/index\.html$/, ''));
  const broken = new Map();
  for (const p of pages) {
    const body = p.html.split('<div id="root">')[1]?.split('</body>')[0] || '';
    for (const m of body.matchAll(/href="(\/(?:learn|glossary|compare)\/[a-z0-9-]+)"/g)) {
      if (!existing.has(m[1])) {
        if (!broken.has(m[1])) broken.set(m[1], new Set());
        broken.get(m[1]).add('/' + p.outPath.replace(/\/index\.html$/, ''));
      }
    }
  }
  if (broken.size) {
    console.warn(`[prerender] ⚠ ${broken.size} broken internal link target(s):`);
    for (const [t, srcs] of broken) console.warn(`  ${t}  <- ${[...srcs].join(', ')}`);
  } else {
    console.log('[prerender] ✓ internal link graph is complete (no broken links)');
  }

  // Validate every JSON-LD block: must parse, and each node must carry @type;
  // Article/Dataset nodes must carry their required fields. Fails the build
  // (STRICT) so invalid structured data never ships. Set STRICT=false to warn.
  const STRICT = process.env.SPIELD_SCHEMA_STRICT !== 'false';
  const schemaErrors = [];
  const requireFields = {
    Article: ['headline', 'datePublished', 'author', 'publisher'],
    TechArticle: ['headline', 'datePublished', 'author', 'publisher'],
    Dataset: ['name', 'description', 'creator'],
    FAQPage: ['mainEntity'],
    BreadcrumbList: ['itemListElement'],
    DefinedTerm: ['name', 'description'],
    HowTo: ['step'],
  };
  const checkNode = (node, where) => {
    if (!node || typeof node !== 'object') return;
    const type = node['@type'];
    if (!type) {
      schemaErrors.push(`${where}: node missing @type`);
      return;
    }
    const req = requireFields[type];
    if (req) {
      for (const f of req) {
        if (node[f] === undefined) schemaErrors.push(`${where}: ${type} missing "${f}"`);
      }
    }
  };
  let ldCount = 0;
  for (const p of pages) {
    for (const m of p.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      let parsed;
      try {
        parsed = JSON.parse(m[1]);
      } catch (e) {
        schemaErrors.push(`${p.outPath}: JSON-LD parse error — ${e.message.slice(0, 80)}`);
        continue;
      }
      ldCount++;
      if (!parsed['@context']) schemaErrors.push(`${p.outPath}: JSON-LD missing @context`);
      const nodes = parsed['@graph'] || [parsed];
      for (const n of nodes) checkNode(n, p.outPath);
    }
  }
  if (schemaErrors.length) {
    console.error(`[prerender] ✗ ${schemaErrors.length} JSON-LD schema issue(s):`);
    for (const e of schemaErrors.slice(0, 30)) console.error(`  ${e}`);
    if (STRICT) {
      console.error('[prerender] failing build (set SPIELD_SCHEMA_STRICT=false to downgrade to warnings)');
      process.exit(1);
    }
  } else {
    console.log(`[prerender] ✓ JSON-LD valid across ${ldCount} block(s)`);
  }

  // SEO length lint: titles should be ≤60 visible chars, descriptions ≤160, so
  // Google doesn't truncate them in the SERP. Warns (doesn't fail) — content
  // judgment sometimes wins, but this flags regressions.
  const seoWarn = [];
  const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  for (const p of pages) {
    const t = decode((p.html.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
    const d = decode((p.html.match(/name="description" content="([^"]*)"/) || [])[1] || '');
    if (t.length > 60) seoWarn.push(`title ${t.length}c: /${p.outPath.replace(/\/index\.html$/, '')}`);
    if (d.length > 160) seoWarn.push(`desc ${d.length}c: /${p.outPath.replace(/\/index\.html$/, '')}`);
  }
  if (seoWarn.length) {
    console.warn(`[prerender] ⚠ ${seoWarn.length} SEO length warning(s) (may truncate in SERP):`);
    for (const w of seoWarn) console.warn(`  ${w}`);
  } else {
    console.log('[prerender] ✓ all titles ≤60c and descriptions ≤160c');
  }

  // Structural consistency lint (STRICT): the static HTML here is authored
  // separately from the React runtime (src/components/learn/LearnLayout.tsx), so
  // the two can drift. These invariants catch the drift that has actually bitten:
  //   1. The two-column grid only activates via `.lh-shell.has-aside`, so an
  //      <aside> WITHOUT `has-aside` (or `has-aside` WITHOUT an <aside>) means a
  //      broken layout — the sticky ToC overlays the article.
  //   2. Content pages ship without the app CSS bundle, so LEARN_CSS must carry
  //      its own body reset — otherwise the browser default 8px margin shows as a
  //      white border around the dark page.
  const structErrors = [];
  for (const p of pages) {
    const hasAsideEl = /<aside class="lh-aside">/.test(p.html);
    const hasAsideShell = /class="lh-shell has-aside"/.test(p.html);
    if (hasAsideEl !== hasAsideShell) {
      structErrors.push(
        `/${p.outPath.replace(/\/index\.html$/, '')}: <aside> present=${hasAsideEl} but shell.has-aside=${hasAsideShell} (grid will break)`,
      );
    }
    if (!/body\{[^}]*margin:0/.test(p.html)) {
      structErrors.push(`/${p.outPath.replace(/\/index\.html$/, '')}: missing body{margin:0} reset (white border)`);
    }
  }
  if (structErrors.length) {
    console.error(`[prerender] ✗ ${structErrors.length} structural consistency issue(s):`);
    for (const e of structErrors.slice(0, 30)) console.error(`  ${e}`);
    console.error('[prerender] failing build — static pages would render inconsistently with the SPA');
    process.exit(1);
  } else {
    console.log('[prerender] ✓ static layout consistent with the SPA (aside/grid + body reset)');
  }

  // Homepage crawlability lint (STRICT): the homepage is the #1 page for brand /
  // entity ranking, and JS-blind AI crawlers only see its raw HTML. Assert that
  // the prerendered homepage actually carries crawler-visible content + the
  // entity signals that disambiguate Spield — regressing any of these silently
  // re-blanks the homepage for bots (the "resolves to some other app" failure).
  const homeErrors = [];
  const home = pages.find((p) => p.outPath === 'index.html');
  if (!home) {
    homeErrors.push('no prerendered index.html was produced (renderHomepage not wired in)');
  } else {
    const h = home.html;
    // 1. #root must be seeded (not empty) so bots see real content.
    if (/<div id="root">\s*<\/div>/.test(h)) homeErrors.push('homepage #root is EMPTY (crawlers see a blank page)');
    if (!/data-prerendered-home="true"/.test(h)) homeErrors.push('homepage seed block is missing');
    // 2. The seed must actually describe Spield + link into the content hub.
    if (!/fixed-income layer for Stellar/i.test(h)) homeErrors.push('homepage seed missing the H1/description');
    const seedLinks = (h.match(/href="\/(learn|glossary|compare)\/[a-z0-9-]+"/g) || []).length;
    if (seedLinks < 10) homeErrors.push(`homepage seed links to only ${seedLinks} content pages (expected many more)`);
    // 3. Entity disambiguation signals must be present in the head JSON-LD.
    const org = (h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [])
      .map((s) => { try { return JSON.parse(s.replace(/<\/?script[^>]*>/g, '')); } catch { return null; } })
      .filter(Boolean)
      .flatMap((j) => j['@graph'] || [j])
      .find((n) => n && n['@type'] === 'Organization');
    if (!org) homeErrors.push('homepage missing Organization JSON-LD');
    else {
      for (const f of ['name', 'description', 'sameAs', 'alternateName']) {
        if (org[f] === undefined) homeErrors.push(`Organization JSON-LD missing "${f}"`);
      }
    }
    // 4. AI content index must be discoverable from the head.
    if (!/href="\/llms\.txt"/.test(h)) homeErrors.push('homepage missing <link ... href="/llms.txt"> (AI content index)');
  }
  if (homeErrors.length) {
    console.error(`[prerender] ✗ ${homeErrors.length} homepage crawlability issue(s):`);
    for (const e of homeErrors) console.error(`  ${e}`);
    console.error('[prerender] failing build — the homepage would be invisible/ambiguous to AI crawlers');
    process.exit(1);
  } else {
    console.log('[prerender] ✓ homepage is crawler-visible (seeded root + entity data + llms.txt link)');
  }

  // .well-known lint (STRICT): security.txt is only spec-valid (RFC 9116) while
  // its `Expires` is in the FUTURE — an expired file is worse than none, and it
  // expires silently on a wall-clock date nobody is watching. Assert it here so
  // the build fails and someone bumps SECURITY_TXT_EXPIRES in render-page.ts.
  const wellKnownErrors = [];
  const fileByPath = new Map(files.map((f) => [f.path, f.content]));
  for (const p of ['.well-known/security.txt', '.well-known/ai.txt', 'security.txt', 'ai.txt']) {
    if (!fileByPath.has(p)) wellKnownErrors.push(`missing artifact: /${p}`);
  }
  const sec = fileByPath.get('.well-known/security.txt') || '';
  for (const field of ['Contact:', 'Expires:', 'Canonical:']) {
    if (!sec.includes(field)) wellKnownErrors.push(`security.txt missing required "${field}" field`);
  }
  const expiresMatch = sec.match(/^Expires:\s*(.+)$/m);
  if (!expiresMatch) {
    wellKnownErrors.push('security.txt has no parseable Expires value');
  } else {
    const expires = new Date(expiresMatch[1].trim());
    if (Number.isNaN(expires.getTime())) {
      wellKnownErrors.push(`security.txt Expires is not a valid date: "${expiresMatch[1].trim()}"`);
    } else if (expires <= new Date()) {
      wellKnownErrors.push(
        `security.txt Expires is in the PAST (${expires.toISOString()}) — bump SECURITY_TXT_EXPIRES in scripts/render-page.ts`,
      );
    }
  }
  if (wellKnownErrors.length) {
    console.error(`[prerender] ✗ ${wellKnownErrors.length} .well-known issue(s):`);
    for (const e of wellKnownErrors) console.error(`  ${e}`);
    console.error('[prerender] failing build — security.txt/ai.txt would ship invalid');
    process.exit(1);
  } else {
    console.log('[prerender] ✓ .well-known/{security,ai}.txt present and valid (Expires in the future)');
  }

  // hreflang lint (STRICT): every indexable page must carry EXACTLY ONE self
  // alternate + one x-default, both pointing at its OWN canonical. The shell's
  // hreflang tags are hardcoded to the homepage, so if document() ever stops
  // stripping them, content pages get a second pair claiming they are "/" —
  // conflicting self-references that are worse than having none at all.
  const hreflangErrors = [];
  for (const p of pages) {
    const url = '/' + p.outPath.replace(/\/index\.html$/, '');
    const noindex = /name="robots" content="noindex/.test(p.html);
    const selfCount = (p.html.match(/rel="alternate" hreflang="en"/g) || []).length;
    const defCount = (p.html.match(/rel="alternate" hreflang="x-default"/g) || []).length;
    if (noindex) {
      if (selfCount || defCount) hreflangErrors.push(`${url}: noindex page should not emit hreflang`);
      continue;
    }
    if (selfCount !== 1) hreflangErrors.push(`${url}: expected 1 hreflang="en", found ${selfCount}`);
    if (defCount !== 1) hreflangErrors.push(`${url}: expected 1 hreflang="x-default", found ${defCount}`);
    // Both must point at this page's own canonical, not the homepage.
    const canonical = (p.html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
    for (const m of p.html.matchAll(/rel="alternate" hreflang="(?:en|x-default)" href="([^"]*)"/g)) {
      if (canonical && m[1] !== canonical) {
        hreflangErrors.push(`${url}: hreflang href="${m[1]}" != canonical "${canonical}"`);
      }
    }
  }
  if (hreflangErrors.length) {
    console.error(`[prerender] ✗ ${hreflangErrors.length} hreflang issue(s):`);
    for (const e of hreflangErrors.slice(0, 20)) console.error(`  ${e}`);
    console.error('[prerender] failing build — conflicting hreflang self-references');
    process.exit(1);
  } else {
    console.log('[prerender] ✓ hreflang: exactly one en + x-default per indexable page, matching canonical');
  }

  console.log('[prerender] done:');
  console.log(`  ${pages.map((p) => '/' + p.outPath.replace(/\/index\.html$/, '')).join('\n  ')}`);
  console.log('  /sitemap.xml  /robots.txt  /llms.txt  /llms-full.txt  /api/stats.json');
  console.log('  /.well-known/security.txt  /.well-known/ai.txt  /security.txt  /ai.txt');
}

function pathToFileUrl(p) {
  const resolved = path.resolve(p);
  return `file://${resolved}`;
}

main().catch((err) => {
  console.error('[prerender] failed:', err);
  process.exit(1);
});
