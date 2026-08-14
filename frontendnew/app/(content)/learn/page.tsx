import type { Metadata } from "next";
import Link from "next/link";
import { ARTICLES, PILLARS } from "@/lib/content";
import type { Article } from "@/lib/content/types";
import { Crumbs, Doc } from "@/components/learn/DocShell";
import { collectionGraph } from "@/lib/seo/schema";
import { CATEGORY_LABEL, CATEGORY_ORDER } from "@/lib/content/labels";

const TITLE = "Learn — Fixed Income, Yield Tokenization & Stellar DeFi";
const DESCRIPTION =
  "Guides to fixed income on Stellar: how yield tokenization works, what Principal and Yield Tokens are, where Blend's yield comes from, and how to earn a fixed rate on USDC.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/learn", languages: { en: "/learn", "x-default": "/learn" } },
  openGraph: { type: "website", url: "/learn", title: "Spield Learn", description: DESCRIPTION },
};

export default function LearnHub() {
  /* Pillars first, then everything else grouped by category. Twenty-four
     rows in publication order is a list you scroll past; the four pages
     that define the category, called out and set apart, is a list with a
     way in. Nothing is hidden — every guide is still one click away and
     in the HTML for a crawler that reads the whole page. */
  const rest = ARTICLES.filter((a) => !a.pillar);
  const groups = CATEGORY_ORDER.map((c) => ({
    category: c,
    items: rest.filter((a) => a.category === c),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            collectionGraph(
              "Learn",
              DESCRIPTION,
              "/learn",
              ARTICLES.map((a) => ({ name: a.title, url: `/learn/${a.slug}` })),
            ),
          ),
        }}
      />
      <Doc wide>
        <Crumbs trail={[{ name: "Home", href: "/" }, { name: "Learn" }]} />

        <header className="hub-head">
          <p className="doc-kicker">
            <span className="pulse-dot" aria-hidden="true" />
            {ARTICLES.length} guides
          </p>
          <h1 className="doc-title">
            Fixed income on Stellar, <em>explained</em>.
          </h1>
          <p className="doc-standfirst">{DESCRIPTION}</p>
        </header>

        <div className="hub-groups">
          <section className="hub-group" aria-labelledby="pillars-heading">
            <h2 className="hub-group-title" id="pillars-heading">
              Start here
            </h2>
            <ul className="hub-list">
              {PILLARS.map((a) => (
                <Row key={a.slug} article={a} />
              ))}
            </ul>
          </section>

          {groups.map((g) => (
            <section
              className="hub-group"
              key={g.category}
              aria-labelledby={`group-${g.category}`}
            >
              <h2 className="hub-group-title" id={`group-${g.category}`}>
                {CATEGORY_LABEL[g.category]}
              </h2>
              <ul className="hub-list">
                {g.items.map((a) => (
                  <Row key={a.slug} article={a} />
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="hub-cta">
          <p className="hub-cta-text">
            Every term these guides use, <strong>defined in one place</strong> — or take the two
            comparisons if you are weighing Stellar against an EVM chain.
          </p>
          <span style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <Link className="btn btn-outline" href="/glossary">
              Glossary
            </Link>
            <Link className="btn btn-outline" href="/compare">
              Comparisons
            </Link>
          </span>
        </div>
      </Doc>
    </>
  );
}

function Row({ article }: { article: Article }) {
  return (
    <li>
      <Link className="hub-row" href={`/learn/${article.slug}`} data-pillar={String(!!article.pillar)}>
        <span className="hub-row-in">
          <span className="hub-row-title">{article.title}</span>
          <span className="hub-row-meta">
            {article.pillar ? "Pillar · " : ""}
            {article.readingMinutes} min
          </span>
          <span className="hub-row-desc">{article.description}</span>
        </span>
      </Link>
    </li>
  );
}
