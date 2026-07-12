/**
 * The Learn-hub stylesheet, as a string, so it can be shared by BOTH:
 *   - the prerenderer (scripts/render-page.ts inlines it into static HTML), and
 *   - the React runtime (src/components/learn/* injects it via a <style> tag),
 * guaranteeing the dev/preview/production SPA renders identically to the
 * prerendered pages that crawlers see.
 *
 * Design: MONOCHROMATIC. A refined grayscale system on Spield's near-black
 * background — white for emphasis, graded grays for hierarchy, and a single
 * hairline accent. No colour hues; contrast and typography carry the design.
 */
export const LEARN_CSS = `
/* ---- document reset ----
 * The prerendered static pages ship WITHOUT the app's CSS bundle (Tailwind
 * Preflight + index.css are stripped in scripts/render-page.ts), so nothing
 * else zeroes the UA defaults there. Without this, deployed content pages show
 * an 8px white body margin ("white border" around the dark page) and the
 * background canvas peeks through. On the SPA these rules are a harmless no-op
 * (the app reset already applies). Keep it here so BOTH render targets match. */
html{margin:0;padding:0}
body{margin:0;padding:0;min-height:100vh;background:#050708}
@media(prefers-color-scheme:light){body:has(.lh-root:not([data-theme="dark"])){background:#fafafa}}
:root{
  --bg:#050708; --bg-2:#0a0d0f; --panel:#0e1214; --panel-2:#131719; --panel-3:#171b1e;
  --text:#f2f4f5; --text-2:#c9ced2; --muted:#8b9297; --muted-2:#5b6266; --faint:#3a4044;
  --line:rgba(255,255,255,.07); --line-2:rgba(255,255,255,.11);
  --accent:#f2f4f5;                 /* monochrome accent = near-white */
  --accent-soft:rgba(255,255,255,.09);
  --radius:14px; --radius-lg:18px; --maxw:720px;
  --font:'Plus Jakarta Sans',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  --heading:'Space Grotesk','Plus Jakarta Sans',system-ui,sans-serif;
}
.lh-root{color:var(--text-2);font-family:var(--font);line-height:1.72;font-size:16.5px;min-height:100vh;
  background:var(--bg);
  background-image:radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.045),transparent 55%);
  -webkit-font-smoothing:antialiased}
.lh-root *{box-sizing:border-box}
.lh-root a{color:var(--text);text-decoration:none;transition:color .15s}
.lh-root a:hover{color:#fff}
.lh-root img{max-width:100%;height:auto}
.lh-root ::selection{background:rgba(255,255,255,.16)}

/* ---- header ---- */
.lh-header{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;
  gap:1rem;padding:.9rem 1.5rem;border-bottom:1px solid var(--line);
  background:rgba(5,7,8,.72);-webkit-backdrop-filter:blur(14px) saturate(1.2);backdrop-filter:blur(14px) saturate(1.2)}
.lh-header-in{width:100%;max-width:1120px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:1rem}
.lh-brand{display:flex;align-items:center;gap:.6rem;font-family:var(--heading);font-weight:600;color:#fff;font-size:1.02rem;letter-spacing:-.01em}
.lh-brand:hover{color:#fff}
.lh-brand img{width:26px;height:26px;object-fit:contain;opacity:.95}
.lh-nav{display:flex;align-items:center;gap:.35rem;font-size:.86rem}
.lh-nav-link{color:var(--muted);padding:.4rem .7rem;border-radius:8px}
.lh-nav-link:hover{color:#fff;background:var(--accent-soft)}
.lh-cta{display:inline-flex;align-items:center;gap:.4rem;background:#fff;color:#0a0d0f!important;font-weight:600;
  padding:.5rem .95rem;border-radius:999px;font-size:.84rem;letter-spacing:.005em;white-space:nowrap}
.lh-cta:hover{color:#0a0d0f!important;background:#e8ebec}
.lh-nav-hide{display:none}
@media(min-width:680px){.lh-nav-hide{display:inline-flex}}

/* ---- layout ---- */
.lh-shell{max-width:1120px;margin:0 auto;padding:3rem 1.5rem 1rem;display:grid;grid-template-columns:1fr;gap:3rem}
@media(min-width:1000px){.lh-shell.has-aside{grid-template-columns:220px minmax(0,1fr);gap:3.5rem}}
.lh-main{min-width:0;max-width:var(--maxw);width:100%;margin:0 auto}
.lh-aside{position:sticky;top:80px;align-self:start;height:max-content}
@media(max-width:999px){.lh-aside{display:none}}

/* ---- toc ---- */
.lh-toc{font-size:.83rem}
.lh-toc-title{text-transform:uppercase;letter-spacing:.16em;font-size:.66rem;color:var(--muted-2);font-weight:700;margin:0 0 .85rem;padding-left:.9rem}
.lh-toc ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.15rem;border-left:1px solid var(--line)}
.lh-toc li a{display:block;color:var(--muted);padding:.28rem 0 .28rem .9rem;margin-left:-1px;border-left:1px solid transparent}
.lh-toc li a:hover{color:#fff;border-left-color:var(--line-2)}
.lh-toc-l3 a{padding-left:1.6rem;font-size:.8rem}

/* ---- breadcrumbs ---- */
.lh-crumbs ol{list-style:none;display:flex;flex-wrap:wrap;gap:.45rem;padding:0;margin:0 0 1.5rem;font-size:.78rem;color:var(--muted-2)}
.lh-crumbs li:not(:last-child)::after{content:"/";margin-left:.45rem;color:var(--faint)}
.lh-crumbs a{color:var(--muted)}
.lh-crumbs a:hover{color:var(--text-2)}
.lh-crumbs li[aria-current]{color:var(--muted)}

/* ---- article typography ---- */
.lh-article h1{font-family:var(--heading);font-size:2.35rem;line-height:1.12;letter-spacing:-.025em;color:#fff;margin:.1rem 0 .6rem}
.lh-meta{color:var(--muted-2);font-size:.8rem;margin:0 0 2rem;display:flex;flex-wrap:wrap;gap:.4rem;align-items:center}
.lh-meta::before{content:"";display:none}
.lh-article h2{font-family:var(--heading);font-size:1.55rem;letter-spacing:-.015em;color:#fff;margin:2.75rem 0 1rem;scroll-margin-top:90px}
.lh-article h3{font-size:1.18rem;color:#fff;margin:1.9rem 0 .7rem;scroll-margin-top:90px;font-weight:650}
.lh-article h4{font-size:1.03rem;color:#fff;margin:1.5rem 0 .5rem}
.lh-article p{margin:0 0 1.15rem}
.lh-article ul,.lh-article ol{margin:0 0 1.25rem;padding-left:1.35rem}
.lh-article li{margin:.5rem 0;padding-left:.15rem}
.lh-article li::marker{color:var(--muted-2)}
.lh-article strong{color:#fff;font-weight:650}
.lh-article a{border-bottom:1px solid var(--line-2)}
.lh-article a:hover{border-bottom-color:rgba(255,255,255,.5)}
.lh-article code{background:var(--panel-2);border:1px solid var(--line);border-radius:6px;padding:.12em .42em;font-size:.85em;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--text)}
.anchor{opacity:0;margin-left:-1.15em;padding-right:.35em;color:var(--faint);border:0!important;font-weight:400}
.anchor:hover{color:var(--muted)}
h2:hover .anchor,h3:hover .anchor{opacity:1}

/* ---- answer box (the AI-liftable direct answer) ---- */
.answer-box{position:relative;background:var(--panel);border:1px solid var(--line-2);border-radius:var(--radius-lg);
  padding:1.4rem 1.5rem;margin:0 0 2rem}
.answer-box::before{content:"";position:absolute;left:0;top:1.4rem;bottom:1.4rem;width:2px;background:#fff;border-radius:2px}
.answer-box{padding-left:1.75rem}
.answer-q{font-weight:650;color:#fff;margin:0 0 .55rem;font-size:1.02rem}
.answer-a{margin:0;color:var(--text-2)}
.lh-term .answer-box{font-size:1.08rem}
.lh-term .answer-a{color:var(--text)}

/* ---- key takeaways ---- */
.key-takeaways{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-lg);padding:1.35rem 1.6rem 1.45rem;margin:0 0 2.25rem}
.key-takeaways h2{font-size:.68rem!important;text-transform:uppercase;letter-spacing:.18em;color:var(--muted);margin:0 0 .9rem!important;font-family:var(--font)!important;font-weight:700}
.key-takeaways ul{margin:0;padding-left:1.1rem;list-style:none}
.key-takeaways li{margin:.6rem 0;position:relative;padding-left:1.2rem;color:var(--text-2)}
.key-takeaways li::before{content:"";position:absolute;left:0;top:.62em;width:5px;height:5px;border-radius:50%;background:var(--muted)}

/* ---- callouts ---- */
.callout{border:1px solid var(--line);border-radius:var(--radius);padding:1.1rem 1.35rem;margin:1.75rem 0;background:var(--panel);border-left:2px solid var(--muted-2)}
.callout-title{font-weight:650;color:#fff;margin:0 0 .35rem;font-size:.95rem}
.callout p{margin:0;color:var(--text-2);font-size:.96rem}
.callout p+p{margin-top:.45rem}
.callout-warning{border-left-color:var(--text-2)}
.callout-success,.callout-tip,.callout-info{border-left-color:var(--muted-2)}

/* ---- tables ---- */
.table-wrap{overflow-x:auto;margin:1.75rem 0;border:1px solid var(--line);border-radius:var(--radius)}
.lh-root table{border-collapse:collapse;width:100%;font-size:.9rem;min-width:460px}
.lh-root caption{caption-side:top;text-align:left;color:var(--muted);font-size:.8rem;padding:.75rem .95rem;border-bottom:1px solid var(--line)}
.lh-root th,.lh-root td{text-align:left;padding:.75rem .95rem;border-bottom:1px solid var(--line);vertical-align:top}
.lh-root thead th{background:var(--panel-2);color:#fff;font-weight:600;font-size:.82rem;letter-spacing:.01em}
.lh-root tbody tr:last-child td{border-bottom:none}
.lh-root tbody tr:hover td{background:rgba(255,255,255,.015)}
.lh-root td:first-child{color:var(--text);font-weight:500}

/* ---- steps ---- */
.steps{counter-reset:step;list-style:none;padding:0;margin:1.75rem 0}
.steps>li{position:relative;padding-left:2.9rem;margin:0 0 1.5rem;min-height:1.9rem}
.steps>li::before{counter-increment:step;content:counter(step);position:absolute;left:0;top:-.1rem;width:1.9rem;height:1.9rem;
  display:grid;place-items:center;border-radius:999px;background:var(--panel-2);border:1px solid var(--line-2);
  color:#fff;font-weight:650;font-size:.88rem;font-family:var(--heading)}
.step-title{font-weight:650;color:#fff;margin:.2rem 0 .3rem}
.steps p{margin:0;color:var(--text-2)}

/* ---- faq ---- */
.faq-list{margin:1.75rem 0;border-top:1px solid var(--line)}
.faq-item{border-bottom:1px solid var(--line);padding:1.25rem 0}
.faq-item h3{margin:0 0 .5rem;font-size:1.05rem;color:#fff;font-weight:600}
.faq-item p{margin:0;color:var(--muted)}

/* ---- blockquote ---- */
.lh-root blockquote{border-left:2px solid var(--line-2);margin:1.75rem 0;padding:.3rem 0 .3rem 1.3rem;color:var(--muted);font-style:italic}
.lh-root blockquote cite{display:block;margin-top:.5rem;font-size:.85rem;color:var(--muted-2);font-style:normal}

/* ---- related / sources ---- */
.lh-related,.lh-sources{margin:3rem 0 0;padding-top:1.75rem;border-top:1px solid var(--line)}
.lh-related h2,.lh-sources h2{font-size:.7rem;text-transform:uppercase;letter-spacing:.16em;color:var(--muted-2);margin:0 0 1rem;font-weight:700}
.lh-related ul,.lh-sources ul{list-style:none;padding:0;margin:0;display:grid;gap:.15rem}
.lh-related li a,.lh-sources li a{display:flex;align-items:center;gap:.5rem;padding:.55rem .1rem;color:var(--text-2);border-bottom:1px solid var(--line)}
.lh-related li:last-child a,.lh-sources li:last-child a{border-bottom:0}
.lh-related li a::before{content:"→";color:var(--muted-2);font-size:.9em}
.lh-related li a:hover,.lh-sources li a:hover{color:#fff}
.lh-cta-block{margin:3rem 0 1rem;padding:1.75rem;text-align:center;border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--panel)}
.lh-cta-block .lh-cta{padding:.75rem 1.5rem;font-size:.92rem}

/* ---- hub / cards ---- */
.lh-hub{max-width:960px;margin:0 auto}
.lh-hub h1{font-family:var(--heading);font-size:2.6rem;letter-spacing:-.03em;color:#fff;margin:.1rem 0 .7rem;line-height:1.08}
.lh-hub .lh-section-h{font-family:var(--heading);font-size:.72rem;text-transform:uppercase;letter-spacing:.16em;color:var(--muted-2);font-weight:700;margin:3rem 0 1.15rem;padding-bottom:.7rem;border-bottom:1px solid var(--line)}
.lh-lede{font-size:1.2rem;line-height:1.6;color:var(--muted);max-width:640px;margin:0 0 .5rem}
.lh-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;margin:0}
.lh-card{position:relative;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:1.35rem 1.4rem;transition:border-color .18s,background .18s;overflow:hidden}
.lh-card:hover{border-color:var(--line-2);background:var(--panel-2)}
.lh-card h2{font-size:1.05rem;margin:.2rem 0 .45rem;color:#fff;font-weight:600;letter-spacing:-.01em}
.lh-card p{margin:0;color:var(--muted);font-size:.88rem;line-height:1.55}
.lh-card .lh-card-more{margin-top:.9rem;font-size:.78rem;color:var(--muted-2);display:inline-flex;align-items:center;gap:.35rem}
.lh-card:hover .lh-card-more{color:var(--text-2)}
.lh-tag{display:inline-flex;align-self:flex-start;font-size:.6rem;text-transform:uppercase;letter-spacing:.14em;font-weight:700;
  color:var(--text);background:var(--accent-soft);border:1px solid var(--line);padding:.22rem .55rem;border-radius:999px;margin-bottom:.7rem}
.lh-card-lg{grid-column:span 1}
@media(min-width:720px){.lh-cards-feature{grid-template-columns:repeat(2,1fr)}}

/* ---- footer ---- */
.lh-footer{border-top:1px solid var(--line);margin-top:5rem;padding:3rem 1.5rem 2.5rem;background:var(--bg-2)}
.lh-footer-cols{max-width:1120px;margin:0 auto;display:grid;grid-template-columns:1fr;gap:2.5rem}
@media(min-width:720px){.lh-footer-cols{grid-template-columns:2.2fr 1fr 1fr}}
.lh-footer-brand-row{display:flex;align-items:center;gap:.55rem;margin:0 0 .9rem}
.lh-footer-brand-row img{width:24px;height:24px;object-fit:contain;opacity:.9}
.lh-footer-brand-row span{font-family:var(--heading);font-weight:600;color:#fff;font-size:1rem}
.lh-footer-sub{color:var(--muted);font-size:.9rem;line-height:1.6;margin:0 0 1.25rem;max-width:40ch}
.lh-footer h2{font-size:.68rem;text-transform:uppercase;letter-spacing:.16em;color:var(--muted-2);margin:0 0 1rem;font-weight:700}
.lh-footer ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.6rem}
.lh-footer a{color:var(--muted);font-size:.9rem}
.lh-footer a:hover{color:#fff}
.lh-copyright{max-width:1120px;margin:2.5rem auto 0;color:var(--muted-2);font-size:.78rem;border-top:1px solid var(--line);padding-top:1.75rem}

/* ---- light theme (viewer preference) ---- */
@media(prefers-color-scheme:light){
  .lh-root:not([data-theme="dark"]){
    --bg:#fafafa;--bg-2:#fff;--panel:#fff;--panel-2:#f4f5f6;--panel-3:#eef0f1;
    --text:#0c0f11;--text-2:#2b3033;--muted:#5f676c;--muted-2:#9aa1a6;--faint:#c4cacd;
    --line:rgba(0,0,0,.08);--line-2:rgba(0,0,0,.13);--accent:#0c0f11;--accent-soft:rgba(0,0,0,.05)}
  .lh-root:not([data-theme="dark"]){background-image:radial-gradient(120% 60% at 50% -10%,rgba(0,0,0,.03),transparent 55%)}
  .lh-root:not([data-theme="dark"]) .lh-header{background:rgba(255,255,255,.8)}
  .lh-root:not([data-theme="dark"]) .lh-brand img,.lh-root:not([data-theme="dark"]) .lh-footer-brand-row img{filter:invert(1)}
  .lh-root:not([data-theme="dark"]) .answer-box::before{background:#0c0f11}
  .lh-root:not([data-theme="dark"]) .lh-cta{background:#0c0f11;color:#fff!important}
  .lh-root:not([data-theme="dark"]) .lh-cta:hover{background:#2b3033}
}
`;
