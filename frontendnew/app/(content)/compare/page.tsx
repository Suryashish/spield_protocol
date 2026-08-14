import type { Metadata } from "next";
import Link from "next/link";
import { COMPARISONS } from "@/lib/content";
import { Crumbs, Doc } from "@/components/learn/DocShell";
import { collectionGraph } from "@/lib/seo/schema";

const TITLE = "Compare — Stellar vs Ethereum DeFi, Head to Head";
const DESCRIPTION =
  "Side-by-side comparisons of the protocols and platforms Stellar DeFi is measured against: Blend vs Aave for lending, and Soroban vs the EVM for smart contracts.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/compare", languages: { en: "/compare", "x-default": "/compare" } },
  openGraph: {
    type: "website",
    url: "/compare",
    title: "Spield Comparisons",
    description: DESCRIPTION,
  },
};

export default function CompareHub() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            collectionGraph(
              "Compare",
              DESCRIPTION,
              "/compare",
              COMPARISONS.map((c) => ({ name: c.title, url: `/compare/${c.slug}` })),
            ),
          ),
        }}
      />
      <Doc wide>
        <Crumbs trail={[{ name: "Home", href: "/" }, { name: "Compare" }]} />

        <header className="hub-head">
          <p className="doc-kicker">
            <span className="pulse-dot" aria-hidden="true" />
            {COMPARISONS.length} comparisons
          </p>
          <h1 className="doc-title">
            Stellar, measured <em>against</em> the alternative.
          </h1>
          <p className="doc-standfirst">{DESCRIPTION}</p>
        </header>

        <section className="hub-group hub-groups">
          <h2 className="hub-group-title">Head to head</h2>
          <ul className="hub-list">
            {COMPARISONS.map((c) => (
              <li key={c.slug}>
                <Link className="hub-row" href={`/compare/${c.slug}`}>
                  <span className="hub-row-in">
                    <span className="hub-row-title">{c.title}</span>
                    <span className="hub-row-desc">{c.description}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <div className="hub-cta">
          <p className="hub-cta-text">
            The comparisons say how the platforms differ. The guides say{" "}
            <strong>what to do about it</strong>.
          </p>
          <Link className="btn btn-outline" href="/learn">
            Read the guides
          </Link>
        </div>
      </Doc>
    </>
  );
}
