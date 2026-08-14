import type { Metadata } from "next";
import Link from "next/link";
import { GLOSSARY } from "@/lib/content";
import { Crumbs, Doc } from "@/components/learn/DocShell";
import { collectionGraph } from "@/lib/seo/schema";

const TITLE = "Glossary — Fixed Income, Yield & Stellar DeFi Terms";
const DESCRIPTION =
  "Plain definitions of the terms fixed income and yield tokenization run on: Principal Token, Yield Token, implied APY, bToken, time-decay AMM, trustline, real yield and more.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/glossary", languages: { en: "/glossary", "x-default": "/glossary" } },
  openGraph: {
    type: "website",
    url: "/glossary",
    title: "Spield Glossary",
    description: DESCRIPTION,
  },
};

export default function GlossaryHub() {
  /* Alphabetical. A glossary sorted by category is a glossary you cannot
     look anything up in — the whole contract of the page is that you
     arrive knowing the word. */
  const terms = [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term, "en"));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            collectionGraph(
              "Glossary",
              DESCRIPTION,
              "/glossary",
              terms.map((t) => ({ name: t.term, url: `/glossary/${t.slug}` })),
            ),
          ),
        }}
      />
      <Doc wide>
        <Crumbs trail={[{ name: "Home", href: "/" }, { name: "Glossary" }]} />

        <header className="hub-head">
          <p className="doc-kicker">
            <span className="pulse-dot" aria-hidden="true" />
            {terms.length} terms
          </p>
          <h1 className="doc-title">
            The vocabulary, <em>defined</em>.
          </h1>
          <p className="doc-standfirst">{DESCRIPTION}</p>
        </header>

        <div className="glossary-grid hub-groups">
          {terms.map((t) => (
            <Link className="glossary-row" key={t.slug} href={`/glossary/${t.slug}`}>
              <span className="glossary-term">{t.term}</span>
              <span className="glossary-def">{t.shortDefinition}</span>
            </Link>
          ))}
        </div>

        <div className="hub-cta">
          <p className="hub-cta-text">
            A definition tells you what a thing is. The guides tell you{" "}
            <strong>when it matters</strong> and what it costs to get wrong.
          </p>
          <Link className="btn btn-outline" href="/learn">
            Read the guides
          </Link>
        </div>
      </Doc>
    </>
  );
}
