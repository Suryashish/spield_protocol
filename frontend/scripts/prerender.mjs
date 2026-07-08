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

  console.log('[prerender] done:');
  console.log(`  ${pages.map((p) => '/' + p.outPath.replace(/\/index\.html$/, '')).join('\n  ')}`);
  console.log('  /sitemap.xml  /robots.txt  /llms.txt  /llms-full.txt  /api/stats.json');
}

function pathToFileUrl(p) {
  const resolved = path.resolve(p);
  return `file://${resolved}`;
}

main().catch((err) => {
  console.error('[prerender] failed:', err);
  process.exit(1);
});
