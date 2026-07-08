/**
 * Content model for the Spield Learn hub.
 *
 * This is the SINGLE SOURCE OF TRUTH for every educational page. The same
 * objects are consumed by:
 *   1. The React runtime (src/components/learn/*) — what a human sees in the SPA.
 *   2. The prerender step (scripts/prerender.mjs) — emits real static HTML +
 *      JSON-LD so search engines and JS-blind AI crawlers (GPTBot, ClaudeBot,
 *      PerplexityBot, Google-Extended, …) get the full content, not an empty
 *      <div id="root">.
 *
 * Content is authored as a typed block tree rather than raw markdown so the
 * prerenderer can emit clean, GEO/AEO-friendly semantic HTML (answer-first
 * paragraphs, question-shaped headings, tables, definition blocks) AND derive
 * FAQPage / Article / DefinedTerm structured data from the same source.
 */

export type BlockType =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'table'
  | 'callout'
  | 'keyTakeaways'
  | 'answerBox'
  | 'quote'
  | 'steps'
  | 'faq'
  | 'code';

/** Minimal inline markup — kept deliberately small so it renders identically
 *  in React and in the prerenderer's HTML serializer. Use markdown-lite:
 *  **bold**, *italic*, `code`, and [text](href) links. */
export type RichText = string;

export interface ParagraphBlock {
  type: 'paragraph';
  text: RichText;
  /** Marks the first, direct-answer paragraph under a heading. The prerenderer
   *  tags it with a data-answer attribute and it feeds AI-overview extraction. */
  lead?: boolean;
}

export interface HeadingBlock {
  type: 'heading';
  level: 2 | 3 | 4;
  /** Phrase headings as questions where natural — best for AI citation. */
  text: string;
  /** Stable slug for the anchor + table of contents. Auto-derived if omitted. */
  id?: string;
}

export interface ListBlock {
  type: 'list';
  ordered?: boolean;
  items: RichText[];
}

export interface TableBlock {
  type: 'table';
  caption?: string;
  headers: string[];
  rows: RichText[][];
}

export interface CalloutBlock {
  type: 'callout';
  variant: 'info' | 'warning' | 'success' | 'tip';
  title?: string;
  text: RichText;
}

export interface KeyTakeawaysBlock {
  type: 'keyTakeaways';
  items: RichText[];
}

/** A short, self-contained direct answer rendered at the very top of a page.
 *  This is the single most important block for GEO/AEO — it is what AI engines
 *  lift verbatim. Keep it 40–60 words, definitional, no fluff. */
export interface AnswerBoxBlock {
  type: 'answerBox';
  /** The question this box answers (usually the page's core query). */
  question: string;
  /** The direct answer. First sentence must fully answer the question. */
  answer: RichText;
}

export interface QuoteBlock {
  type: 'quote';
  text: RichText;
  cite?: string;
}

export interface StepsBlock {
  type: 'steps';
  /** Renders as an ordered HowTo — the prerenderer emits HowTo schema. */
  name?: string;
  steps: { title: string; text: RichText }[];
}

export interface FaqBlock {
  type: 'faq';
  items: { q: string; a: RichText }[];
}

export interface CodeBlock {
  type: 'code';
  language?: string;
  code: string;
}

export type ContentBlock =
  | ParagraphBlock
  | HeadingBlock
  | ListBlock
  | TableBlock
  | CalloutBlock
  | KeyTakeawaysBlock
  | AnswerBoxBlock
  | QuoteBlock
  | StepsBlock
  | FaqBlock
  | CodeBlock;

export type ContentCategory =
  | 'fixed-income'
  | 'yield-tokenization'
  | 'stellar'
  | 'rwa'
  | 'defi-basics'
  | 'institutional'
  | 'developer'
  | 'comparisons';

export type SearchIntent =
  | 'informational'
  | 'commercial'
  | 'transactional'
  | 'navigational'
  | 'developer';

export type Audience = 'beginner' | 'intermediate' | 'advanced' | 'developer' | 'institutional';

/** A related-link, used to build the internal-linking graph. `slug` points at
 *  another article/glossary term; the linking strategy lives in the content,
 *  not scattered across components. */
export interface RelatedLink {
  /** e.g. "/learn/what-is-yield-tokenization" or "/glossary/principal-token" */
  href: string;
  label: string;
}

/**
 * i18n scaffolding. Content is English-only today (translations are deferred
 * until English topical authority is established — see the strategy). These
 * optional fields make the system translation-ready WITHOUT shipping any
 * half-baked translated pages: when a `translations` map is present, the
 * renderer emits `hreflang` alternates. Locales use BCP-47 tags (e.g. "es",
 * "pt-BR"). Default locale is "en".
 */
export type Locale = 'en' | 'es' | 'pt-BR' | 'fr' | 'tr' | 'id';

export interface I18n {
  /** BCP-47 locale of this document. Defaults to 'en'. */
  locale?: Locale;
  /** Map of locale → absolute-or-relative URL of the equivalent page.
   *  Only populate once a real translation exists. */
  translations?: Partial<Record<Locale, string>>;
}

export interface Article extends I18n {
  slug: string;
  /** URL is /learn/<slug>. */
  title: string;
  /** <title> tag — include the primary keyword near the front, ≤60 chars. */
  seoTitle: string;
  /** Meta description, 140–160 chars, benefit + keyword. */
  description: string;
  category: ContentCategory;
  intent: SearchIntent;
  audience: Audience;
  /** Primary target keyword for this page. */
  primaryKeyword: string;
  /** Secondary/semantic keywords covered. */
  keywords: string[];
  /** ISO date. */
  datePublished: string;
  dateModified: string;
  /** Reading time in minutes (auto-computed at build if 0). */
  readingMinutes: number;
  /** Is this a cornerstone/pillar page? Pillars get priority in sitemap + nav. */
  pillar?: boolean;
  /** Marks a data/facts page — additionally emits Dataset JSON-LD (AEO signal). */
  dataset?: boolean;
  /** The content body. */
  body: ContentBlock[];
  /** Hand-authored internal links — the topical cluster graph. */
  related: RelatedLink[];
  /** External authority references (primary sources) for E-E-A-T + AI trust. */
  sources?: RelatedLink[];
}

export interface GlossaryTerm extends I18n {
  slug: string;
  /** URL is /glossary/<slug>. */
  term: string;
  /** Other spellings / abbreviations that should resolve here. */
  aliases?: string[];
  /** One-sentence definition — the DefinedTerm.description + AI-liftable answer.
   *  Must stand completely alone (no "it"/"this" referring elsewhere). */
  shortDefinition: string;
  /** Longer explanation blocks. */
  body: ContentBlock[];
  category: ContentCategory;
  related: RelatedLink[];
}

export interface Comparison extends I18n {
  slug: string;
  /** URL is /compare/<slug>. */
  title: string;
  seoTitle: string;
  description: string;
  primaryKeyword: string;
  keywords: string[];
  datePublished: string;
  dateModified: string;
  intent: SearchIntent;
  audience: Audience;
  body: ContentBlock[];
  related: RelatedLink[];
  sources?: RelatedLink[];
}
