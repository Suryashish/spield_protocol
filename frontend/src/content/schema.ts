/**
 * JSON-LD structured-data builders. Pure functions → plain objects; the caller
 * serializes with JSON.stringify into a <script type="application/ld+json">.
 *
 * The schema stack here is the one 2026 GEO research finds most citable:
 *   Article + FAQPage + BreadcrumbList + DefinedTerm(Set) + HowTo  (+ Organization)
 * which roughly doubles AI-citation rate vs. an unstructured page. DefinedTerm
 * in particular is under-published, so glossary pages land in a low-competition
 * citation pool. See seo-strategy/05-geo-aeo-strategy.md.
 */
import type { Article, Comparison, ContentBlock, GlossaryTerm } from './types';
import { SITE, absUrl } from './site';
import { blockToText } from './render';
import { PROTOCOL_FACTS } from './facts';

type Json = Record<string, unknown>;

/**
 * The real cost of using the protocol, in one sentence, derived from
 * PROTOCOL_FACTS so the structured data can never drift from the published fee
 * schedule. Used wherever we assert a price — see the note in protocolOffers().
 */
function feeDisclosure(): string {
  const swap = PROTOCOL_FACTS.config.find((c) => c.label === 'Market swap fee')?.value;
  const swapClause = swap ? `the ${swap} market swap fee and ` : '';
  return `No access, subscription, or deposit fee to use the app. On-chain activity still incurs ${swapClause}Stellar network fees.`;
}

/**
 * The reviewing author entity, attached to Article/Comparison as `reviewedBy`
 * and available as a standalone Person. Real E-E-A-T: a named, credentialed
 * reviewer beats a generic "the team" string for AI trust and Google's YMYL
 * (finance) quality signals. Swap in real author identities as they're assigned.
 */
export function reviewerPerson(): Json {
  return {
    '@type': 'Organization',
    '@id': `${SITE.origin}/#reviewer`,
    name: 'The Spield Protocol team',
    url: SITE.origin,
    description:
      'The team building Spield, the fixed-income and yield-tokenization layer for Stellar. Reviews all educational content for technical accuracy.',
    parentOrganization: { '@id': `${SITE.origin}/#organization` },
  };
}

/**
 * The three things Spield actually offers, as a schema.org OfferCatalog. This is
 * what `hasOfferCatalog` audits look for, and it gives answer engines an explicit,
 * structured list of the protocol's products instead of making them infer it from
 * prose. Every entry is a real, shipped surface of the app — no roadmap items.
 */
function protocolOffers(): Json[] {
  /**
   * NOTE ON PRICE: these offers deliberately carry NO `price`/`priceCurrency`.
   *
   * Spield charges no subscription or access fee, but "free" is not the same as
   * "costless": the market swap fee is 0.30% (see facts.ts) and every action pays
   * a Stellar network fee. Asserting `price: "0"` would be a machine-readable
   * claim that using these services costs nothing — contradicting our own
   * published fee schedule, and in a financial (YMYL) context that is exactly the
   * kind of inaccuracy answer engines repeat verbatim and users rely on.
   *
   * Omitting price is valid schema.org: `Offer` does not require it. Where a real
   * fee exists we state it as a `priceSpecification` instead, so the structured
   * data matches the contracts rather than flattering them.
   */
  const offer = (name: string, description: string, url: string, fee?: Json): Json => ({
    '@type': 'Offer',
    itemOffered: { '@type': 'Service', name, description, provider: { '@id': `${SITE.origin}/#organization` } },
    url: absUrl(url),
    category: 'Decentralized Finance',
    ...(fee ? { priceSpecification: fee } : {}),
  });
  return [
    offer(
      'Fixed-Rate Vault',
      'Deposit USDC and lock a guaranteed fixed yield rate until maturity, backed by real on-chain Blend Capital yield on Stellar.',
      '/dashboard/vault',
    ),
    offer(
      'Yield Tokenization (PT / YT)',
      'Split a yield-bearing deposit into a tradable Principal Token (PT), a zero-coupon bond redeeming 1:1 at maturity, and a Yield Token (YT), a claim on all yield until maturity.',
      '/dashboard',
    ),
    offer(
      'PT/YT Market',
      'Trade Principal Tokens and Yield Tokens on a Stellar-native time-decay AMM — no bridges and no wrapped assets.',
      '/dashboard/markets',
      {
        '@type': 'PriceSpecification',
        description: `Swap fee of ${
          PROTOCOL_FACTS.config.find((c) => c.label === 'Market swap fee')?.value ?? 'a published percentage'
        } per trade, plus the Stellar network fee. No protocol access or subscription fee.`,
      },
    ),
  ];
}

export function offerCatalogSchema(): Json {
  return {
    '@type': 'OfferCatalog',
    '@id': `${SITE.origin}/#offers`,
    name: 'Spield products',
    itemListElement: protocolOffers(),
  };
}

/** The publisher/author entity, reused everywhere. */
export function organizationSchema(): Json {
  return {
    '@type': 'Organization',
    '@id': `${SITE.origin}/#organization`,
    name: SITE.legalName,
    alternateName: [SITE.name, 'Spield Finance', 'Spield DeFi', SITE.domain],
    url: SITE.origin,
    logo: {
      '@type': 'ImageObject',
      url: SITE.logo,
      width: 512,
      height: 512,
    },
    image: SITE.ogImage,
    description: SITE.description,
    slogan: `${SITE.tagline}.`,
    foundingDate: '2025',
    areaServed: 'Worldwide',
    // Protocol products, explicitly enumerated for answer engines.
    hasOfferCatalog: offerCatalogSchema(),
    makesOffer: protocolOffers(),
    sameAs: [SITE.twitterUrl, SITE.github],
    // No `address`: Spield is a protocol with no public office, and a fabricated
    // postal address is a worse signal than an absent one.
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'technical support',
      url: SITE.twitterUrl,
      availableLanguage: 'en',
    },
  };
}

export function websiteSchema(): Json {
  return {
    '@type': 'WebSite',
    '@id': `${SITE.origin}/#website`,
    url: SITE.origin,
    name: SITE.name,
    description: SITE.description,
    publisher: { '@id': `${SITE.origin}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE.origin}/learn?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function softwareApplicationSchema(): Json {
  return {
    '@type': 'SoftwareApplication',
    name: 'Spield',
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Web',
    url: SITE.origin,
    description: SITE.description,
    // `price: 0` is accurate for ACCESS to the app (no subscription/paywall), but
    // spell out that on-chain activity still costs — see the note in
    // protocolOffers() on why a bare "free" claim is unsafe in a financial context.
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      description: feeDisclosure(),
    },
    publisher: { '@id': `${SITE.origin}/#organization` },
  };
}

export function breadcrumbSchema(trail: { name: string; url: string }[]): Json {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: absUrl(c.url),
    })),
  };
}

/** Extract FAQ Q&A pairs from a body's `faq` blocks for FAQPage schema. */
function collectFaq(body: ContentBlock[]): { q: string; a: string }[] {
  const out: { q: string; a: string }[] = [];
  for (const b of body) {
    if (b.type === 'faq') {
      for (const item of b.items) out.push({ q: item.q, a: stripInline(item.a) });
    }
  }
  return out;
}

function stripInline(t: string): string {
  return t.replace(/[*`]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

export function faqPageSchema(faqs: { q: string; a: string }[]): Json | null {
  if (!faqs.length) return null;
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

/** HowTo schema from a `steps` block, if present. */
export function howToSchema(article: Article | Comparison): Json | null {
  const stepsBlock = article.body.find((b) => b.type === 'steps');
  if (!stepsBlock || stepsBlock.type !== 'steps') return null;
  return {
    '@type': 'HowTo',
    name: stepsBlock.name || article.title,
    description: article.description,
    step: stepsBlock.steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.title,
      text: stripInline(s.text),
    })),
  };
}

function articleBase(a: Article | Comparison, url: string, type: 'Article' | 'TechArticle'): Json {
  return {
    '@type': type,
    '@id': `${absUrl(url)}#article`,
    headline: a.title,
    name: a.title,
    description: a.description,
    url: absUrl(url),
    mainEntityOfPage: { '@type': 'WebPage', '@id': absUrl(url) },
    datePublished: a.datePublished,
    dateModified: a.dateModified,
    keywords: a.keywords.join(', '),
    image: SITE.ogImage,
    inLanguage: 'en',
    author: { '@id': `${SITE.origin}/#organization` },
    publisher: { '@id': `${SITE.origin}/#organization` },
    reviewedBy: { '@id': `${SITE.origin}/#reviewer` },
    isAccessibleForFree: true,
  };
}

/** Full @graph for an article/guide page. */
export function articleGraph(a: Article, opts?: { dev?: boolean }): Json {
  const url = `/learn/${a.slug}`;
  const graph: Json[] = [
    organizationSchema(),
    reviewerPerson(),
    articleBase(a, url, opts?.dev ? 'TechArticle' : 'Article'),
    breadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'Learn', url: '/learn' },
      { name: a.title, url },
    ]),
  ];
  const faq = faqPageSchema(collectFaq(a.body));
  if (faq) graph.push(faq);
  const howto = howToSchema(a);
  if (howto) graph.push(howto);
  if (a.dataset) {
    graph.push({
      '@type': 'Dataset',
      '@id': `${absUrl(url)}#dataset`,
      name: a.title,
      description: a.description,
      url: absUrl(url),
      dateModified: a.dateModified,
      creator: { '@id': `${SITE.origin}/#organization` },
      publisher: { '@id': `${SITE.origin}/#organization` },
      isAccessibleForFree: true,
      license: 'https://creativecommons.org/licenses/by/4.0/',
      keywords: a.keywords.join(', '),
      distribution: [
        {
          '@type': 'DataDownload',
          encodingFormat: 'application/json',
          contentUrl: `${SITE.origin}/api/stats.json`,
        },
      ],
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

/** Full @graph for a glossary term page. */
export function glossaryTermGraph(t: GlossaryTerm): Json {
  const url = `/glossary/${t.slug}`;
  const graph: Json[] = [
    organizationSchema(),
    {
      '@type': 'DefinedTerm',
      '@id': `${absUrl(url)}#term`,
      name: t.term,
      description: t.shortDefinition,
      url: absUrl(url),
      ...(t.aliases && t.aliases.length ? { alternateName: t.aliases } : {}),
      inDefinedTermSet: {
        '@type': 'DefinedTermSet',
        '@id': `${SITE.origin}/glossary#set`,
        name: 'Spield Glossary — Fixed Income, Yield & Stellar DeFi',
        url: `${SITE.origin}/glossary`,
      },
    },
    breadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'Glossary', url: '/glossary' },
      { name: t.term, url },
    ]),
  ];
  const faq = faqPageSchema(collectFaq(t.body));
  if (faq) graph.push(faq);
  return { '@context': 'https://schema.org', '@graph': graph };
}

/** Full @graph for a comparison page. */
export function comparisonGraph(c: Comparison): Json {
  const url = `/compare/${c.slug}`;
  const graph: Json[] = [
    organizationSchema(),
    reviewerPerson(),
    articleBase(c, url, 'Article'),
    breadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'Compare', url: '/compare' },
      { name: c.title, url },
    ]),
  ];
  const faq = faqPageSchema(collectFaq(c.body));
  if (faq) graph.push(faq);
  return { '@context': 'https://schema.org', '@graph': graph };
}

/** Home page graph. */
export function homeGraph(): Json {
  return {
    '@context': 'https://schema.org',
    '@graph': [organizationSchema(), websiteSchema(), softwareApplicationSchema()],
  };
}

/** CollectionPage graph for hub indexes (/learn, /glossary, /compare). */
export function collectionGraph(
  name: string,
  url: string,
  items: { name: string; url: string }[],
): Json {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organizationSchema(),
      {
        '@type': 'CollectionPage',
        '@id': `${absUrl(url)}#collection`,
        name,
        url: absUrl(url),
        isPartOf: { '@id': `${SITE.origin}/#website` },
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: items.map((it, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: it.name,
            url: absUrl(it.url),
          })),
        },
      },
      breadcrumbSchema([
        { name: 'Home', url: '/' },
        { name, url },
      ]),
    ],
  };
}

/** Convenience: derive a plain-text summary of a body (for meta fallbacks). */
export function bodyExcerpt(body: ContentBlock[], maxLen = 160): string {
  const text = body.map(blockToText).join(' ').replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? `${text.slice(0, maxLen - 1).trimEnd()}…` : text;
}
