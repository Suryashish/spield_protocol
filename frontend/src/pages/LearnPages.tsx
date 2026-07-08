import { useParams, Navigate } from 'react-router-dom';
import { LearnLayout } from '@/components/learn/LearnLayout';
import { Breadcrumbs, ContentBody, RelatedList, SourcesList, Toc } from '@/components/learn/ContentBody';
import { useSEO } from '@/hooks/useSEO';
import { renderInline } from '@/content/render';
import { SITE } from '@/content/site';
import {
  ARTICLES,
  COMPARISONS,
  GLOSSARY,
  PILLARS,
  getArticle,
  getComparison,
  getGlossaryTerm,
} from '@/content';

/** Small helper for rendering markdown-lite inline strings as React. */
function Inline({ text, className }: { text: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: renderInline(text) }} />;
}

function MetaLine({ kind, minutes, updated }: { kind: string; minutes: number; updated: string }) {
  return (
    <p className="lh-meta">
      <span>{kind}</span> · <span>{minutes || 5} min read</span> ·{' '}
      <time dateTime={updated}>Updated {updated}</time> · <span>Reviewed by the Spield team</span>
    </p>
  );
}

/* ------------------------------- Article ------------------------------- */
export function ArticlePage() {
  const { slug = '' } = useParams();
  const a = getArticle(slug);
  useSEO({
    title: a?.seoTitle ?? 'Learn — Spield',
    description: a?.description,
    canonical: a ? `${SITE.origin}/learn/${a.slug}` : `${SITE.origin}/learn`,
    ogType: 'article',
  });
  if (!a) return <Navigate to="/learn" replace />;
  return (
    <LearnLayout aside={<Toc blocks={a.body} />}>
      <article className="lh-article">
        <Breadcrumbs trail={[{ name: 'Home', href: '/' }, { name: 'Learn', href: '/learn' }, { name: a.title }]} />
        <h1>{a.title}</h1>
        <MetaLine kind={a.pillar ? 'Pillar guide' : 'Guide'} minutes={a.readingMinutes} updated={a.dateModified} />
        <ContentBody blocks={a.body} />
        <SourcesList sources={a.sources} />
        <RelatedList related={a.related} />
        <p className="lh-cta-block">
          <a className="lh-cta" href="/dashboard">
            Try Spield — lock a fixed rate on Stellar →
          </a>
        </p>
      </article>
    </LearnLayout>
  );
}

/* ---------------------------- Glossary term ---------------------------- */
export function GlossaryTermPage() {
  const { slug = '' } = useParams();
  const t = getGlossaryTerm(slug);
  useSEO({
    title: t ? `${t.term} — Spield Glossary` : 'Glossary — Spield',
    description: t?.shortDefinition.slice(0, 158),
    canonical: t ? `${SITE.origin}/glossary/${t.slug}` : `${SITE.origin}/glossary`,
    ogType: 'article',
  });
  if (!t) return <Navigate to="/glossary" replace />;
  return (
    <LearnLayout>
      <article className="lh-article lh-term">
        <Breadcrumbs trail={[{ name: 'Home', href: '/' }, { name: 'Glossary', href: '/glossary' }, { name: t.term }]} />
        <h1>{t.term}</h1>
        <div className="answer-box" data-answer="true">
          <p className="answer-a">
            <Inline text={t.shortDefinition} />
          </p>
        </div>
        <ContentBody blocks={t.body} />
        <RelatedList related={t.related} />
      </article>
    </LearnLayout>
  );
}

/* ----------------------------- Comparison ------------------------------ */
export function ComparisonPage() {
  const { slug = '' } = useParams();
  const c = getComparison(slug);
  useSEO({
    title: c?.seoTitle ?? 'Compare — Spield',
    description: c?.description,
    canonical: c ? `${SITE.origin}/compare/${c.slug}` : `${SITE.origin}/compare`,
    ogType: 'article',
  });
  if (!c) return <Navigate to="/compare" replace />;
  return (
    <LearnLayout aside={<Toc blocks={c.body} />}>
      <article className="lh-article">
        <Breadcrumbs trail={[{ name: 'Home', href: '/' }, { name: 'Compare', href: '/compare' }, { name: c.title }]} />
        <h1>{c.title}</h1>
        <MetaLine kind="Comparison" minutes={5} updated={c.dateModified} />
        <ContentBody blocks={c.body} />
        <SourcesList sources={c.sources} />
        <RelatedList related={c.related} />
        <p className="lh-cta-block">
          <a className="lh-cta" href="/dashboard">
            Try Spield on Stellar →
          </a>
        </p>
      </article>
    </LearnLayout>
  );
}

/* ------------------------------- Hubs ---------------------------------- */
interface Card {
  path: string;
  title: string;
  description: string;
  tag?: string;
  more?: string;
}
function CardGrid({ items, feature }: { items: Card[]; feature?: boolean }) {
  return (
    <div className={`lh-cards${feature ? ' lh-cards-feature' : ''}`}>
      {items.map((it) => (
        <a className="lh-card" href={it.path} key={it.path}>
          {it.tag ? <span className="lh-tag">{it.tag}</span> : null}
          <h2>{it.title}</h2>
          <p>{it.description}</p>
          {it.more ? <span className="lh-card-more">{it.more} →</span> : null}
        </a>
      ))}
    </div>
  );
}
function SectionH({ children }: { children: React.ReactNode }) {
  return <h2 className="lh-section-h">{children}</h2>;
}

export function LearnIndexPage() {
  useSEO({
    title: 'Learn — Fixed Income, Yield & Stellar DeFi | Spield',
    description:
      'The Spield Learn hub: guides to fixed income on Stellar, yield tokenization (PT/YT), earning yield on Stellar, DeFi safety, and tokenized real-world assets.',
    canonical: `${SITE.origin}/learn`,
  });
  const pillars = PILLARS.map((a) => ({ path: `/learn/${a.slug}`, title: a.title, description: a.description, tag: 'Pillar', more: 'Read guide' }));
  const rest = ARTICLES.filter((a) => !a.pillar).map((a) => ({ path: `/learn/${a.slug}`, title: a.title, description: a.description }));
  return (
    <LearnLayout>
      <div className="lh-hub">
        <Breadcrumbs trail={[{ name: 'Home', href: '/' }, { name: 'Learn' }]} />
        <h1>Learn: fixed income &amp; yield on Stellar</h1>
        <p className="lh-lede">
          Everything you need to understand on-chain fixed income, yield tokenization, and how to earn
          a fixed or variable yield on Stellar — explained clearly, from first principles.
        </p>
        <SectionH>Start with the pillars</SectionH>
        <CardGrid items={pillars} feature />
        <SectionH>All guides</SectionH>
        <CardGrid items={rest} />
        <SectionH>Keep exploring</SectionH>
        <CardGrid
          items={[
            { path: '/glossary', title: 'Glossary', description: 'Clear definitions of every fixed-income, yield, and Stellar DeFi term.', more: `${GLOSSARY.length} terms` },
            { path: '/compare', title: 'Comparisons', description: 'Blend vs Aave, Soroban vs EVM, and how the Stellar stack compares to the alternatives.', more: `${COMPARISONS.length} comparisons` },
          ]}
          feature
        />
      </div>
    </LearnLayout>
  );
}

export function GlossaryIndexPage() {
  useSEO({
    title: 'Glossary — Fixed Income & Stellar DeFi Terms | Spield',
    description:
      'A plain-English glossary of fixed-income, yield-tokenization, and Stellar DeFi terms: principal token, yield token, implied APY, Blend, Soroban, RWA, and more.',
    canonical: `${SITE.origin}/glossary`,
  });
  // Group terms by category for a cleaner, scannable structure.
  const GROUPS: { key: string; label: string }[] = [
    { key: 'yield-tokenization', label: 'Yield tokenization' },
    { key: 'fixed-income', label: 'Fixed income' },
    { key: 'stellar', label: 'Stellar & Blend' },
    { key: 'rwa', label: 'Real-world assets' },
    { key: 'defi-basics', label: 'DeFi basics' },
  ];
  return (
    <LearnLayout>
      <div className="lh-hub">
        <Breadcrumbs trail={[{ name: 'Home', href: '/' }, { name: 'Glossary' }]} />
        <h1>Glossary</h1>
        <p className="lh-lede">
          Clear, standalone definitions for every concept behind Spield — from Principal Tokens and
          implied APY to Blend, Soroban, and real-world assets.
        </p>
        {GROUPS.map((g) => {
          const items = GLOSSARY.filter((t) => t.category === g.key).map((t) => ({
            path: `/glossary/${t.slug}`,
            title: t.term,
            description: t.shortDefinition.split('. ')[0] + '.',
          }));
          if (!items.length) return null;
          return (
            <div key={g.key}>
              <SectionH>{g.label}</SectionH>
              <CardGrid items={items} />
            </div>
          );
        })}
      </div>
    </LearnLayout>
  );
}

export function CompareIndexPage() {
  useSEO({
    title: 'Comparisons — Blend vs Aave & More | Spield',
    description:
      'Side-by-side comparisons: Blend vs Aave, Soroban vs EVM, Stellar vs other chains for DeFi, fixed vs variable yield, and more.',
    canonical: `${SITE.origin}/compare`,
  });
  const items = COMPARISONS.map((c) => ({ path: `/compare/${c.slug}`, title: c.title, description: c.description, more: 'Compare' }));
  return (
    <LearnLayout>
      <div className="lh-hub">
        <Breadcrumbs trail={[{ name: 'Home', href: '/' }, { name: 'Compare' }]} />
        <h1>Comparisons</h1>
        <p className="lh-lede">
          How Spield and the Stellar fixed-income stack compare to the alternatives — honest,
          side-by-side.
        </p>
        <CardGrid items={items} feature />
      </div>
    </LearnLayout>
  );
}
