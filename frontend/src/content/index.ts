/**
 * Content registry — the single import surface for ALL educational content.
 * Both the React runtime and the prerender script import from here, so adding
 * a new article/term/comparison is a one-line change and everything (routes,
 * sitemap, llms.txt, schema, hub pages) picks it up automatically.
 *
 * To add content: create the module under articles/ | comparisons/ (glossary
 * lives in glossary/index.ts) and register it in the arrays below.
 */
import type { Article, Comparison } from './types';
import { GLOSSARY } from './glossary/index';
import { readingMinutes } from './render';

// --- Articles ---------------------------------------------------------------
import { article as howToEarnYield } from './articles/how-to-earn-yield-on-stellar';
import { article as fixedIncomeStellar } from './articles/fixed-income-on-stellar';
import { article as yieldTokenization } from './articles/yield-tokenization';
import { article as whatIsBlend } from './articles/what-is-blend-capital';
import { article as isStellarDefiSafe } from './articles/is-stellar-defi-safe';
import { article as ptVsYt } from './articles/pt-vs-yt';
import { article as fixedVsVariable } from './articles/fixed-vs-variable-yield';
import { article as impliedVsUnderlying } from './articles/implied-vs-underlying-apy';
import { article as whatIsPt } from './articles/what-is-a-principal-token';
import { article as tokenizedTreasuries } from './articles/tokenized-treasuries-explained';
import { article as rwaOnStellar } from './articles/rwa-on-stellar';
import { article as protocolFacts } from './articles/spield-protocol-facts';

// --- Comparisons ------------------------------------------------------------
import { comparison as blendVsAave } from './comparisons/blend-vs-aave';
import { comparison as sorobanVsEvm } from './comparisons/soroban-vs-evm';

const rawArticles: Article[] = [
  howToEarnYield,
  fixedIncomeStellar,
  yieldTokenization,
  whatIsBlend,
  isStellarDefiSafe,
  ptVsYt,
  fixedVsVariable,
  impliedVsUnderlying,
  whatIsPt,
  tokenizedTreasuries,
  rwaOnStellar,
  protocolFacts,
];

const rawComparisons: Comparison[] = [blendVsAave, sorobanVsEvm];

/** Fill computed fields (reading time) once, centrally. */
export const ARTICLES: Article[] = rawArticles.map((a) => ({
  ...a,
  readingMinutes: a.readingMinutes || readingMinutes(a.body),
}));

export const COMPARISONS: Comparison[] = rawComparisons;

export { GLOSSARY };

// --- Lookups ----------------------------------------------------------------
export const getArticle = (slug: string): Article | undefined =>
  ARTICLES.find((a) => a.slug === slug);

export const getGlossaryTerm = (slug: string) => GLOSSARY.find((t) => t.slug === slug);

export const getComparison = (slug: string): Comparison | undefined =>
  COMPARISONS.find((c) => c.slug === slug);

export const PILLARS: Article[] = ARTICLES.filter((a) => a.pillar);

/** Everything, as a flat list of routable content entries (for sitemap/llms). */
export interface ContentEntry {
  type: 'article' | 'glossary' | 'comparison';
  slug: string;
  path: string;
  title: string;
  description: string;
  dateModified: string;
  pillar?: boolean;
}

export function allContentEntries(): ContentEntry[] {
  return [
    ...ARTICLES.map((a) => ({
      type: 'article' as const,
      slug: a.slug,
      path: `/learn/${a.slug}`,
      title: a.title,
      description: a.description,
      dateModified: a.dateModified,
      pillar: a.pillar,
    })),
    ...GLOSSARY.map((t) => ({
      type: 'glossary' as const,
      slug: t.slug,
      path: `/glossary/${t.slug}`,
      title: t.term,
      description: t.shortDefinition,
      dateModified: '2026-07-05',
    })),
    ...COMPARISONS.map((c) => ({
      type: 'comparison' as const,
      slug: c.slug,
      path: `/compare/${c.slug}`,
      title: c.title,
      description: c.description,
      dateModified: c.dateModified,
    })),
  ];
}
