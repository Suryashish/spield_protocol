import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";
import { PILLARS } from "@/lib/content";
import { Doc } from "@/components/learn/DocShell";
import "./content.css";

/**
 * The page that isn't there.
 *
 * A default 404 is a dead end, and a dead end is where a link from
 * somebody else's site stops being worth anything. This one is a way
 * back in: the four pillar guides, the three hubs, and the front door.
 * Most arrivals here came from a stale link to something we do still
 * cover under a different slug, so the answer is usually one row down
 * the page.
 *
 * `noindex` — a soft 404 that Google indexes is worse than a hard one.
 * Next already serves this with a real 404 status; the meta tag is
 * belt-and-braces for anything that renders the body and ignores it.
 */
export const metadata: Metadata = {
  title: { absolute: "Page not found — Spield" },
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <>
      <SiteNav />
      <Doc wide>
        <header className="hub-head">
          <p className="doc-kicker">
            <span className="pulse-dot-ember" aria-hidden="true" />
            404
          </p>
          <h1 className="doc-title">
            That page isn&rsquo;t <em>here</em>.
          </h1>
          <p className="doc-standfirst">
            The link may be stale, or the page may have moved. Everything Spield publishes is
            below — start with a pillar guide, or go back to the front.
          </p>
        </header>

        <div className="hub-groups">
          <section className="hub-group" aria-labelledby="nf-start">
            <h2 className="hub-group-title" id="nf-start">
              Start here
            </h2>
            <ul className="hub-list">
              {PILLARS.map((a) => (
                <li key={a.slug}>
                  <Link className="hub-row" href={`/learn/${a.slug}`}>
                    <span className="hub-row-in">
                      <span className="hub-row-title">{a.title}</span>
                      <span className="hub-row-meta">{a.readingMinutes} min</span>
                      <span className="hub-row-desc">{a.description}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="hub-cta">
          <p className="hub-cta-text">
            Or take the whole thing: <strong>24 guides</strong>, 20 defined terms and two
            head-to-head comparisons.
          </p>
          <span style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <Link className="btn btn-primary" href="/">
              Home
            </Link>
            <Link className="btn btn-outline" href="/learn">
              Learn
            </Link>
            <Link className="btn btn-outline" href="/glossary">
              Glossary
            </Link>
          </span>
        </div>
      </Doc>
      <SiteFooter />
    </>
  );
}
