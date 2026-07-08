import type { ContentBlock, RelatedLink } from '@/content/types';
import { blocksToHtml, buildToc } from '@/content/render';

/**
 * Renders a content-block array to React by delegating to the SAME
 * blocksToHtml() the prerenderer uses, then dangerouslySetInnerHTML. Content is
 * fully trusted (authored in-repo, not user input), and using one renderer for
 * both the static HTML and the SPA guarantees they match exactly. Internal
 * links are plain <a href> and navigate via the router's routes.
 */
export function ContentBody({ blocks }: { blocks: ContentBlock[] }) {
  return <div dangerouslySetInnerHTML={{ __html: blocksToHtml(blocks) }} />;
}

export function Toc({ blocks }: { blocks: ContentBlock[] }) {
  const toc = buildToc(blocks);
  if (toc.length < 3) return null;
  return (
    <nav className="lh-toc" aria-label="On this page">
      <p className="lh-toc-title">On this page</p>
      <ul>
        {toc.map((t) => (
          <li key={t.id} className={`lh-toc-l${t.level}`}>
            <a href={`#${t.id}`}>{t.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Breadcrumbs({ trail }: { trail: { name: string; href?: string }[] }) {
  return (
    <nav className="lh-crumbs" aria-label="Breadcrumb">
      <ol>
        {trail.map((c, i) =>
          c.href && i < trail.length - 1 ? (
            <li key={c.name}>
              <a href={c.href}>{c.name}</a>
            </li>
          ) : (
            <li key={c.name} aria-current="page">
              {c.name}
            </li>
          ),
        )}
      </ol>
    </nav>
  );
}

export function RelatedList({ related }: { related: RelatedLink[] }) {
  if (!related.length) return null;
  return (
    <nav className="lh-related" aria-label="Related pages">
      <h2>Related</h2>
      <ul>
        {related.map((r) => (
          <li key={r.href}>
            <a href={r.href}>{r.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SourcesList({ sources }: { sources?: RelatedLink[] }) {
  if (!sources || !sources.length) return null;
  return (
    <section className="lh-sources">
      <h2>Sources &amp; further reading</h2>
      <ul>
        {sources.map((s) => (
          <li key={s.href}>
            <a href={s.href} target="_blank" rel="noopener noreferrer">
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
