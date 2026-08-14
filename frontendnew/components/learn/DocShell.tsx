import Link from "next/link";
import type { ReactNode } from "react";
import type { ContentBlock, RelatedLink } from "@/lib/content/types";
import { buildToc } from "@/lib/content/render";
import { NETWORK } from "@/lib/series";

/**
 * The furniture every document page shares: the trail back up, the rail
 * beside the column, the links out at the foot, and the disclosure that
 * closes all of them.
 *
 * All server components. Nothing on a Learn page needs to be
 * interactive — the reveals that carry the landing page are motion in
 * service of an argument, and an argument is not what these pages are
 * doing. A guide should be readable the instant it paints, which also
 * happens to be what every crawler that never runs the JS sees.
 */

export function Crumbs({ trail }: { trail: { name: string; href?: string }[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <ol>
        {trail.map((c, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={c.name}>
              {c.href && !last ? (
                <Link href={c.href}>{c.name}</Link>
              ) : (
                <span aria-current="page">{c.name}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The table of contents. Below three headings there is nothing worth
 * navigating and the rail is just a second, worse copy of the page.
 */
export function Rail({ blocks }: { blocks: ContentBlock[] }) {
  const toc = buildToc(blocks);
  if (toc.length < 3) return null;
  return (
    <nav className="rail" aria-label="On this page">
      <p className="rail-title">On this page</p>
      <ul>
        {toc.map((t) => (
          <li key={t.id} className={`rail-l${t.level}`}>
            <a href={`#${t.id}`}>{t.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function DocFoot({
  related,
  sources,
}: {
  related?: RelatedLink[];
  sources?: RelatedLink[];
}) {
  const hasRelated = !!related?.length;
  const hasSources = !!sources?.length;
  if (!hasRelated && !hasSources) return null;

  return (
    <div className={`doc-foot${hasRelated && hasSources ? " two-up" : ""}`}>
      {hasRelated && (
        <nav aria-labelledby="related-heading">
          <h2 id="related-heading">Keep reading</h2>
          <ul>
            {related.map((r) => (
              <li key={r.href}>
                <Link href={r.href}>{r.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {hasSources && (
        <section aria-labelledby="sources-heading">
          <h2 id="sources-heading">Sources</h2>
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
      )}
    </div>
  );
}

/**
 * The line that closes every educational page. It says the same thing
 * the landing page's footer says, in the register these pages are in:
 * this is explanation, the protocol is on testnet, and nothing here is
 * a recommendation.
 */
export function Disclosure() {
  return (
    <p className="doc-disclosure">
      Educational content, not financial advice. Spield is deployed on {NETWORK} and has not been
      audited; any figure shown in these guides is a worked example chosen to explain a mechanism,
      never a quote or a live reading.
    </p>
  );
}

/**
 * The column, and the rail beside it.
 *
 * `wide` is for the hubs. A guide is prose and wants one measure; an
 * index is a list you scan, and holding it to 68ch leaves half a desktop
 * screen empty for no reading benefit at all.
 */
export function Doc({
  children,
  rail,
  wide,
}: {
  children: ReactNode;
  rail?: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="doc">
      <div className={`doc-grid${rail ? " has-rail" : ""}`}>
        <article className={`doc-body${wide ? " doc-body-wide" : ""}`}>{children}</article>
        {rail}
      </div>
    </main>
  );
}
