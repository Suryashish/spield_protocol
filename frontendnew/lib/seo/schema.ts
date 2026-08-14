/**
 * JSON-LD builders. Pure functions returning plain objects; the caller
 * serialises one `@graph` into a single <script type="application/ld+json">.
 *
 * The stack is the one that actually moves AI citation rate:
 *   Organization + WebSite + SoftwareApplication   (site identity)
 *   WebPage + BreadcrumbList + FAQPage + HowTo + DefinedTermSet  (this page)
 * FAQPage alone is the largest single lift, and DefinedTerm is thinly
 * published enough that a correct one competes against almost nothing.
 *
 * Two constraints run through every builder here:
 *
 * 1. Nothing is asserted that the page does not say. Every Q&A, every
 *    step, every definition is read from the same module the rendered
 *    markup reads. Schema that outruns the page is worse than no schema.
 *
 * 2. No figure from `lib/series.ts` appears anywhere. Those are worked
 *    examples the page marks as illustrative; putting one in structured
 *    data would strip the marker and hand an answer engine a rate to
 *    quote as though it were on offer.
 */

import { SITE, absUrl } from "./site";
import { PROTOCOL_FACTS } from "./facts";
import { TERMS, TERM_SET_NAME } from "./terms";
import { FAQ_ITEMS, FAQ_TITLE } from "@/lib/faq";
import { MECHANISM, MECHANISM_TITLE } from "@/lib/mechanism";
import type { Article, Comparison, GlossaryTerm } from "@/lib/content/types";
import { collectFaq, stripInline } from "@/lib/content/render";

type Json = Record<string, unknown>;

const ORG_ID = `${SITE.origin}/#organization`;
const SITE_ID = `${SITE.origin}/#website`;
const PAGE_ID = `${SITE.origin}/#webpage`;

/** The fee sentence, derived so it can never drift from the schedule. */
function feeDisclosure(): string {
  const swap = PROTOCOL_FACTS.config.find((c) => c.label === "Market swap fee")?.value;
  return `No access, subscription, or deposit fee to use the app. On-chain activity still incurs ${
    swap ? `the ${swap} market swap fee and ` : ""
  }Stellar network fees.`;
}

/**
 * The three products, as schema.org Offers.
 *
 * NOTE ON PRICE: these carry no `price`/`priceCurrency`. Spield charges
 * no subscription, but free-to-access is not costless — the market swap
 * fee is real and every action pays a network fee. Asserting `price: 0`
 * would be a machine-readable claim contradicting our own published
 * schedule, which in a financial context is exactly the sort of thing an
 * answer engine repeats and a reader relies on. Omitting price is valid;
 * where a fee exists it is stated as a `priceSpecification` instead.
 */
function protocolOffers(): Json[] {
  const swapFee = PROTOCOL_FACTS.config.find((c) => c.label === "Market swap fee")?.value;

  const offer = (name: string, description: string, fee?: Json): Json => ({
    "@type": "Offer",
    itemOffered: {
      "@type": "FinancialProduct",
      name,
      description,
      provider: { "@id": ORG_ID },
      feesAndCommissionsSpecification: feeDisclosure(),
    },
    url: SITE.origin,
    category: "Decentralized Finance",
    ...(fee ? { priceSpecification: fee } : {}),
  });

  const [vault, tokenization, market] = PROTOCOL_FACTS.products;
  return [
    offer(vault.name, vault.description),
    offer(tokenization.name, tokenization.description),
    offer(market.name, market.description, {
      "@type": "PriceSpecification",
      description: `Swap fee of ${
        swapFee ?? "a published percentage"
      } per trade, plus the Stellar network fee. No protocol access or subscription fee.`,
    }),
  ];
}

export function organizationSchema(): Json {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE.legalName,
    alternateName: [SITE.name, "Spield Finance", "Spield DeFi", SITE.domain],
    url: SITE.origin,
    logo: {
      "@type": "ImageObject",
      url: absUrl("/logo-512.png"),
      width: 512,
      height: 512,
    },
    /* The disambiguation sentence is load-bearing. "Spield" collides with
       unrelated brands, and an answer engine that has merged the entities
       will happily attribute one's facts to the other. */
    description: `${PROTOCOL_FACTS.category}. Deposit USDC to lock an exact payout on an exact date, or split a yield-bearing position into tradable Principal Tokens (PT) and Yield Tokens (YT). Spield is a blockchain/DeFi protocol on Stellar — not a sports, media, or gaming company, and not affiliated with any similarly-named brand.`,
    slogan: `${SITE.tagline}.`,
    foundingDate: "2025",
    areaServed: "Worldwide",
    knowsAbout: [...SITE.knowsAbout],
    sameAs: [SITE.twitterUrl, SITE.github],
    // No postal address: Spield is a protocol with no public office, and an
    // invented one is a worse signal than an absent one.
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "technical support",
      email: SITE.email,
      url: SITE.twitterUrl,
      availableLanguage: "en",
    },
    makesOffer: protocolOffers(),
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      "@id": `${SITE.origin}/#offers`,
      name: "Spield products",
      itemListElement: protocolOffers(),
    },
  };
}

export function websiteSchema(): Json {
  return {
    "@type": "WebSite",
    "@id": SITE_ID,
    url: SITE.origin,
    name: SITE.name,
    description: SITE.description,
    inLanguage: "en",
    publisher: { "@id": ORG_ID },
  };
}

export function softwareApplicationSchema(): Json {
  return {
    "@type": "SoftwareApplication",
    "@id": `${SITE.origin}/#app`,
    name: SITE.name,
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web",
    url: SITE.origin,
    description: SITE.description,
    featureList: [
      "Lock an exact USDC payout on an exact date",
      "Split a yield-bearing position into Principal Tokens (PT) and Yield Tokens (YT)",
      "Trade PT and YT on a Stellar-native time-decay AMM",
      "Real on-chain Blend lending yield — no bridge and no wrapped assets",
      "Non-custodial — users hold their own keys",
    ],
    // `price: 0` is true of ACCESS to the app; the description says what
    // access being free does and does not cover. See protocolOffers().
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: feeDisclosure(),
    },
    publisher: { "@id": ORG_ID },
  };
}

export function breadcrumbSchema(trail: { name: string; url: string }[]): Json {
  return {
    "@type": "BreadcrumbList",
    "@id": `${SITE.origin}/#breadcrumb`,
    itemListElement: trail.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: absUrl(c.url),
    })),
  };
}

/** The landing page itself, bound to the entities it is about. */
export function webPageSchema(): Json {
  return {
    "@type": "WebPage",
    "@id": PAGE_ID,
    url: SITE.origin,
    name: SITE.title,
    description: SITE.description,
    inLanguage: "en",
    isPartOf: { "@id": SITE_ID },
    about: { "@id": ORG_ID },
    primaryImageOfPage: { "@type": "ImageObject", url: absUrl("/opengraph-image") },
    breadcrumb: { "@id": `${SITE.origin}/#breadcrumb` },
    /* dateModified is a real freshness signal — Perplexity in particular
       weights it — so it tracks the facts file rather than being typed. */
    dateModified: PROTOCOL_FACTS.factsUpdated,
    publisher: { "@id": ORG_ID },
    /* The disclaimer the footer carries, in machine-readable form. An
       agent reading the figures off this page must be able to learn that
       they are examples without parsing the marker beside each one. */
    disambiguatingDescription: PROTOCOL_FACTS.status.figuresNote,
  };
}

/**
 * The FAQ, read verbatim from the same array the accordion renders.
 * `more` links are deliberately excluded — they are not part of the
 * answer text on the page, so they are not part of it here either.
 */
export function faqPageSchema(): Json {
  return {
    "@type": "FAQPage",
    "@id": `${SITE.origin}/#faq`,
    name: FAQ_TITLE,
    inLanguage: "en",
    isPartOf: { "@id": PAGE_ID },
    mainEntity: FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

/** The mechanism's three beats, as steps an answer engine can extract. */
export function howToSchema(): Json {
  return {
    "@type": "HowTo",
    "@id": `${SITE.origin}/#howto`,
    name: MECHANISM_TITLE,
    description:
      "Spield routes a USDC deposit into Blend, Stellar's lending market, then splits the position into a Principal Token and a Yield Token — the certain half and the variable half of the same deposit.",
    inLanguage: "en",
    isPartOf: { "@id": PAGE_ID },
    tool: {
      "@type": "HowToTool",
      name: "A Stellar wallet holding USDC — Freighter, for example",
    },
    step: MECHANISM.map((beat, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: beat.name,
      text: beat.text,
    })),
  };
}

/** The page's vocabulary, defined. */
export function definedTermSetSchema(): Json {
  const setId = `${SITE.origin}/#glossary`;
  return {
    "@type": "DefinedTermSet",
    "@id": setId,
    name: TERM_SET_NAME,
    url: SITE.origin,
    inLanguage: "en",
    publisher: { "@id": ORG_ID },
    hasDefinedTerm: TERMS.map((t) => ({
      "@type": "DefinedTerm",
      name: t.term,
      description: t.definition,
      ...(t.aliases?.length ? { alternateName: t.aliases } : {}),
      inDefinedTermSet: { "@id": setId },
    })),
  };
}

/**
 * The protocol facts as a citable Dataset, pointed at the JSON endpoint.
 * Original structured data is the strongest generative-engine signal
 * available to a small site: nobody else can publish Spield's contract
 * set, and an agent that can fetch it has no reason to guess.
 */
export function datasetSchema(): Json {
  return {
    "@type": "Dataset",
    "@id": `${SITE.origin}/#dataset`,
    name: "Spield protocol facts",
    description:
      "Machine-readable facts about the Spield protocol: network, deployed contract and asset addresses, product set, fee schedule, design guarantees, and the live metrics that are deliberately unpopulated while the protocol is on testnet.",
    url: SITE.origin,
    creator: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
    dateModified: PROTOCOL_FACTS.factsUpdated,
    isAccessibleForFree: true,
    license: "https://creativecommons.org/licenses/by/4.0/",
    keywords: SITE.keywords.join(", "),
    distribution: [
      {
        "@type": "DataDownload",
        encodingFormat: "application/json",
        contentUrl: absUrl("/api/stats.json"),
      },
    ],
  };
}

/** Site-wide identity — emitted once, from the root layout. */
export function siteGraph(): Json {
  return {
    "@context": "https://schema.org",
    "@graph": [organizationSchema(), websiteSchema(), softwareApplicationSchema()],
  };
}

/** Everything specific to the landing page. */
export function homePageGraph(): Json {
  return {
    "@context": "https://schema.org",
    "@graph": [
      webPageSchema(),
      breadcrumbSchema([{ name: "Home", url: "/" }]),
      faqPageSchema(),
      howToSchema(),
      definedTermSetSchema(),
      datasetSchema(),
    ],
  };
}

/* ==========================================================================
   The Learn hub, the glossary, the comparisons.

   The stack per page type is the one that measurably lifts citation rate:
   Article + FAQPage + BreadcrumbList + HowTo on a guide, DefinedTerm on a
   glossary entry, CollectionPage + ItemList on a hub. `reviewedBy` and a
   real `dateModified` carry the E-E-A-T half, which Google weights harder
   on finance pages than on anything else.
   ========================================================================== */

/**
 * The reviewing entity. A named reviewer beats an anonymous byline for
 * both AI trust and Google's YMYL quality signals — and naming the team
 * rather than inventing an individual keeps it true.
 */
export function reviewerSchema(): Json {
  return {
    "@type": "Organization",
    "@id": `${SITE.origin}/#reviewer`,
    name: "The Spield Protocol team",
    url: SITE.origin,
    description:
      "The team building Spield, the fixed-income and yield-tokenization layer for Stellar. Reviews all educational content for technical accuracy.",
    parentOrganization: { "@id": ORG_ID },
  };
}

/** FAQPage from an arbitrary set of Q&As — the in-article FAQ blocks. */
function faqFrom(faqs: { q: string; a: string }[], id: string): Json | null {
  if (!faqs.length) return null;
  return {
    "@type": "FAQPage",
    "@id": id,
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/** HowTo from a body's `steps` block, when it has one. */
function howToFrom(doc: Article | Comparison, url: string): Json | null {
  const steps = doc.body.find((b) => b.type === "steps");
  if (!steps || steps.type !== "steps") return null;
  return {
    "@type": "HowTo",
    "@id": `${absUrl(url)}#howto`,
    name: steps.name || doc.title,
    description: doc.description,
    step: steps.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.title,
      text: stripInline(s.text),
    })),
  };
}

function articleBase(
  doc: Article | Comparison,
  url: string,
  type: "Article" | "TechArticle",
): Json {
  return {
    "@type": type,
    "@id": `${absUrl(url)}#article`,
    headline: doc.title,
    name: doc.title,
    description: doc.description,
    url: absUrl(url),
    mainEntityOfPage: { "@type": "WebPage", "@id": absUrl(url) },
    datePublished: doc.datePublished,
    dateModified: doc.dateModified,
    keywords: doc.keywords.join(", "),
    /* Recommended by Google's Article guidelines and lifted into AI
       Overviews, so an Article without one is quietly less citable than
       the same Article with one. Every guide shares the site card today;
       when the [slug] routes grow their own opengraph-image this should
       point at the page's own. */
    image: {
      "@type": "ImageObject",
      url: absUrl("/opengraph-image"),
      width: 1200,
      height: 630,
    },
    inLanguage: "en",
    isPartOf: { "@id": SITE_ID },
    author: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
    reviewedBy: { "@id": `${SITE.origin}/#reviewer` },
    isAccessibleForFree: true,
  };
}

/** The @graph for a /learn/<slug> page. */
export function articleGraph(a: Article): Json {
  const url = `/learn/${a.slug}`;
  const graph: Json[] = [
    reviewerSchema(),
    articleBase(a, url, a.category === "developer" ? "TechArticle" : "Article"),
    breadcrumbSchema([
      { name: "Home", url: "/" },
      { name: "Learn", url: "/learn" },
      { name: a.title, url },
    ]),
  ];
  const faq = faqFrom(collectFaq(a.body), `${absUrl(url)}#faq`);
  if (faq) graph.push(faq);
  const howto = howToFrom(a, url);
  if (howto) graph.push(howto);
  /* The facts page is the one that publishes original structured data,
     so it is the one that gets to claim a Dataset and point at the
     endpoint an agent can pull instead of scraping the table. */
  if (a.dataset) graph.push(datasetSchema());
  return { "@context": "https://schema.org", "@graph": graph };
}

/** The @graph for a /glossary/<slug> page. */
export function glossaryTermGraph(t: GlossaryTerm): Json {
  const url = `/glossary/${t.slug}`;
  const graph: Json[] = [
    {
      "@type": "DefinedTerm",
      "@id": `${absUrl(url)}#term`,
      name: t.term,
      description: t.shortDefinition,
      url: absUrl(url),
      inLanguage: "en",
      ...(t.aliases?.length ? { alternateName: t.aliases } : {}),
      inDefinedTermSet: {
        "@type": "DefinedTermSet",
        "@id": `${SITE.origin}/glossary#set`,
        name: "Spield Glossary — Fixed Income, Yield & Stellar DeFi",
        url: absUrl("/glossary"),
        publisher: { "@id": ORG_ID },
      },
    },
    breadcrumbSchema([
      { name: "Home", url: "/" },
      { name: "Glossary", url: "/glossary" },
      { name: t.term, url },
    ]),
  ];
  const faq = faqFrom(collectFaq(t.body), `${absUrl(url)}#faq`);
  if (faq) graph.push(faq);
  return { "@context": "https://schema.org", "@graph": graph };
}

/** The @graph for a /compare/<slug> page. */
export function comparisonGraph(c: Comparison): Json {
  const url = `/compare/${c.slug}`;
  const graph: Json[] = [
    reviewerSchema(),
    articleBase(c, url, "Article"),
    breadcrumbSchema([
      { name: "Home", url: "/" },
      { name: "Compare", url: "/compare" },
      { name: c.title, url },
    ]),
  ];
  const faq = faqFrom(collectFaq(c.body), `${absUrl(url)}#faq`);
  if (faq) graph.push(faq);
  return { "@context": "https://schema.org", "@graph": graph };
}

/** The @graph for a hub index — /learn, /glossary, /compare. */
export function collectionGraph(
  name: string,
  description: string,
  url: string,
  items: { name: string; url: string }[],
): Json {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${absUrl(url)}#collection`,
        name,
        description,
        url: absUrl(url),
        inLanguage: "en",
        isPartOf: { "@id": SITE_ID },
        publisher: { "@id": ORG_ID },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: items.length,
          itemListElement: items.map((it, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: it.name,
            url: absUrl(it.url),
          })),
        },
      },
      breadcrumbSchema([
        { name: "Home", url: "/" },
        { name, url },
      ]),
    ],
  };
}
