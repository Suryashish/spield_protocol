import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { COMPARISONS, getComparison } from "@/lib/content";
import { Blocks } from "@/components/learn/Blocks";
import { Crumbs, Doc, DocFoot, Disclosure, Rail } from "@/components/learn/DocShell";
import { comparisonGraph } from "@/lib/seo/schema";
import { SITE } from "@/lib/seo/site";
import { AUDIENCE_LABEL, formatDate } from "@/lib/content/labels";
import { readingMinutes } from "@/lib/content/render";

export const dynamicParams = false;

export function generateStaticParams() {
  return COMPARISONS.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const c = getComparison(slug);
  if (!c) return {};
  const url = `/compare/${c.slug}`;
  return {
    title: { absolute: c.seoTitle },
    description: c.description,
    keywords: c.keywords,
    alternates: { canonical: url, languages: { en: url, "x-default": url } },
    openGraph: {
      type: "article",
      url,
      title: c.title,
      description: c.description,
      publishedTime: c.datePublished,
      modifiedTime: c.dateModified,
      authors: [SITE.legalName],
      tags: c.keywords,
    },
    twitter: { card: "summary_large_image", title: c.title, description: c.description },
  };
}

export default async function ComparisonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = getComparison(slug);
  if (!c) notFound();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(comparisonGraph(c)) }}
      />
      <Doc rail={<Rail blocks={c.body} />}>
        <Crumbs
          trail={[
            { name: "Home", href: "/" },
            { name: "Compare", href: "/compare" },
            { name: c.title },
          ]}
        />

        <header>
          <p className="doc-kicker">
            <span className="pulse-dot" aria-hidden="true" />
            Comparison
          </p>
          <h1 className="doc-title">{c.title}</h1>
          <p className="doc-standfirst">{c.description}</p>
          <p className="doc-meta">
            <span>Updated {formatDate(c.dateModified)}</span>
            <span className="doc-meta-dot" aria-hidden="true" />
            {/* Comparisons carry no readingMinutes field in the model —
                the guides do — so it is computed from the body rather
                than left off and making this row read as an oversight. */}
            <span>{readingMinutes(c.body)} min read</span>
            <span className="doc-meta-dot" aria-hidden="true" />
            <span>{AUDIENCE_LABEL[c.audience]}</span>
            <span className="doc-meta-dot" aria-hidden="true" />
            <span>Reviewed by the Spield team</span>
          </p>
        </header>

        <div className="prose">
          <Blocks blocks={c.body} />
        </div>

        <DocFoot related={c.related} sources={c.sources} />
        <Disclosure />
      </Doc>
    </>
  );
}
