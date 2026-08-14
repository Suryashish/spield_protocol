import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GLOSSARY, getGlossaryTerm } from "@/lib/content";
import { Blocks } from "@/components/learn/Blocks";
import { Crumbs, Doc, DocFoot, Disclosure } from "@/components/learn/DocShell";
import { glossaryTermGraph } from "@/lib/seo/schema";
import { CATEGORY_LABEL } from "@/lib/content/labels";

/**
 * One term.
 *
 * Short pages, and worth every one of them: `DefinedTerm` is thinly
 * published across the whole web, so a correct definition bound to a
 * real entity competes in a pool almost nobody is in. The definition
 * itself is set at display size because on this page it is the content,
 * not the summary of it.
 */

export const dynamicParams = false;

export function generateStaticParams() {
  return GLOSSARY.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const t = getGlossaryTerm(slug);
  if (!t) return {};
  const url = `/glossary/${t.slug}`;
  const title = `${t.term} — Definition | Spield Glossary`;
  return {
    title: { absolute: title },
    description: t.shortDefinition,
    keywords: [t.term, ...(t.aliases ?? [])],
    alternates: { canonical: url, languages: { en: url, "x-default": url } },
    openGraph: { type: "article", url, title: t.term, description: t.shortDefinition },
    twitter: { card: "summary_large_image", title: t.term, description: t.shortDefinition },
  };
}

export default async function GlossaryTermPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = getGlossaryTerm(slug);
  if (!t) notFound();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(glossaryTermGraph(t)) }}
      />
      <Doc>
        <Crumbs
          trail={[
            { name: "Home", href: "/" },
            { name: "Glossary", href: "/glossary" },
            { name: t.term },
          ]}
        />

        <header>
          <p className="doc-kicker">
            <span className="pulse-dot" aria-hidden="true" />
            {CATEGORY_LABEL[t.category]}
          </p>
          <h1 className="doc-title">{t.term}</h1>
          {/* The lifted sentence. data-answer marks it as such for the
              same reason the guides mark their answer box. */}
          <p className="term-def" data-answer="true">
            {t.shortDefinition}
          </p>
          {!!t.aliases?.length && <p className="term-aliases">Also: {t.aliases.join(" · ")}</p>}
        </header>

        <div className="prose">
          <Blocks blocks={t.body} />
        </div>

        <DocFoot related={t.related} />
        <Disclosure />
      </Doc>
    </>
  );
}
