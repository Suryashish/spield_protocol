import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ARTICLES, getArticle } from "@/lib/content";
import { Blocks } from "@/components/learn/Blocks";
import { Crumbs, Doc, DocFoot, Disclosure, Rail } from "@/components/learn/DocShell";
import { articleGraph } from "@/lib/seo/schema";
import { SITE } from "@/lib/seo/site";
import { AUDIENCE_LABEL, CATEGORY_LABEL, formatDate } from "@/lib/content/labels";

/**
 * A guide. Twenty-four of these, all statically generated at build, so
 * every one is a plain HTML document sitting on a CDN — which is what
 * the crawlers that never run JavaScript need, and what makes the page
 * fast enough that Core Web Vitals stop being a conversation.
 */

export const dynamicParams = false;

export function generateStaticParams() {
  return ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const a = getArticle(slug);
  if (!a) return {};
  const url = `/learn/${a.slug}`;
  return {
    /* seoTitle is written to stand alone at ≤60 chars, so it opts out of
       the layout's "%s — Spield" template rather than overflowing it. */
    title: { absolute: a.seoTitle },
    description: a.description,
    keywords: a.keywords,
    alternates: { canonical: url, languages: { en: url, "x-default": url } },
    openGraph: {
      type: "article",
      url,
      title: a.title,
      description: a.description,
      publishedTime: a.datePublished,
      modifiedTime: a.dateModified,
      authors: [SITE.legalName],
      tags: a.keywords,
    },
    twitter: { card: "summary_large_image", title: a.title, description: a.description },
  };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = getArticle(slug);
  if (!a) notFound();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleGraph(a)) }}
      />
      <Doc rail={<Rail blocks={a.body} />}>
        <Crumbs
          trail={[
            { name: "Home", href: "/" },
            { name: "Learn", href: "/learn" },
            { name: a.title },
          ]}
        />

        <header>
          <p className="doc-kicker">
            <span className="pulse-dot" aria-hidden="true" />
            {a.pillar ? "Pillar guide" : CATEGORY_LABEL[a.category]}
          </p>
          <h1 className="doc-title">{a.title}</h1>
          <p className="doc-standfirst">{a.description}</p>

          {/* The freshness and effort signals, in one mono row. A visible
              "updated" date is a real ranking input for Perplexity and a
              real trust input for a reader deciding whether a DeFi guide
              is describing this year's protocol. */}
          <p className="doc-meta">
            <span>Updated {formatDate(a.dateModified)}</span>
            <span className="doc-meta-dot" aria-hidden="true" />
            <span>{a.readingMinutes} min read</span>
            <span className="doc-meta-dot" aria-hidden="true" />
            <span>{AUDIENCE_LABEL[a.audience]}</span>
            <span className="doc-meta-dot" aria-hidden="true" />
            <span>Reviewed by the Spield team</span>
          </p>
        </header>

        <div className="prose">
          <Blocks blocks={a.body} />
        </div>

        <DocFoot related={a.related} sources={a.sources} />
        <Disclosure />
      </Doc>
    </>
  );
}

