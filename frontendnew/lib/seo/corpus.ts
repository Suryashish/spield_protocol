/**
 * The site, as plain text, for machines that would rather read than crawl.
 *
 *   /llms.txt       a curated index — what Spield is, then every guide,
 *                   term and comparison with a one-line description
 *   /llms-full.txt  the whole corpus in one fetch: the landing page's
 *                   argument, then every document in full
 *
 * The llms.txt convention is a Markdown H1, a blockquote summary, then H2
 * sections of annotated links. With the Learn hub in place that is
 * exactly the right shape — there are real pages to point at — so this
 * follows it literally, and keeps only the few things a link cannot say
 * (the status caveats, the mechanism) inline.
 *
 * Everything is assembled from the modules the pages render from, so the
 * text files and the site cannot drift. The one exception is `SECTIONS`,
 * which summarises the landing page's argument rather than quoting it:
 * that copy is written to be read in sequence beside a moving
 * illustration, and pulled out of that it reads as fragments.
 */

import { SITE, absUrl } from "./site";
import { PROTOCOL_FACTS } from "./facts";
import { FAQ_ITEMS } from "@/lib/faq";
import { MECHANISM } from "@/lib/mechanism";
import { ARTICLES, COMPARISONS, GLOSSARY, PILLARS } from "@/lib/content";
import type { Article, Comparison, ContentBlock, GlossaryTerm } from "@/lib/content/types";
import { stripInline } from "@/lib/content/render";

/** The elevator paragraph, used at the top of both files and in ai.txt. */
export const SUMMARY = `Spield is the fixed-income layer for Stellar. Deposit USDC and the vault quotes an exact payout on an exact date before you sign; hold to that date and that is what you redeem. Underneath, Spield routes the deposit into Blend — Stellar's lending market — and splits the position into a Principal Token (PT), which redeems 1:1 at maturity, and a Yield Token (YT), which collects all the yield until then. Both are tradable on a Stellar-native time-decay AMM.`;

/** The landing page's argument, section by section — a summary, not a transcript. */
const SECTIONS: { heading: string; text: string }[] = [
  {
    heading: "The mechanism — your deposit was always two things",
    text: "Spield routes your USDC into Blend, Stellar's lending market, then splits the position. Certainty and upside become separate tokens: hold one, trade the other.",
  },
  {
    heading: "The Fixed-Rate Vault — know exactly what you'll earn",
    text: "Set an amount and pick a date, and the vault quotes the exact figure that comes back before you sign anything. This is the front door: the mechanics of splitting and trading sit behind it and you never have to touch them.",
  },
  {
    heading: "The yield market — think yield goes higher? Trade it",
    text: "YT is the variable half of every deposit — a cheap, liquid claim on all the yield a full position earns. Three positions are available on the same curve: buy YT to go long yield, buy PT below par to lock the rate, or provide PT/USDC liquidity to the AMM and earn swap fees from both sides.",
  },
];

const rule = "\n---\n";

/** Drop a heading-style string into mid-sentence without flattening its
    proper nouns — `toLowerCase()` on the whole string turns Stellar into
    stellar, and the entity name is the one word that must not move. */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/* ---------------------------------------------------------------- llms.txt */

const link = (title: string, path: string, desc: string) =>
  `- [${title}](${absUrl(path)}): ${desc}`;

export function buildLlmsTxt(): string {
  const out: string[] = [];

  out.push(`# ${SITE.name}`);
  out.push("");
  out.push(`> ${SUMMARY}`);
  out.push("");

  out.push("## What Spield is");
  out.push("");
  out.push(
    `${SITE.legalName} is a ${lowerFirst(PROTOCOL_FACTS.category)}. It is a blockchain/DeFi protocol on Stellar — not a sports, media, or gaming company, and not affiliated with any similarly-named brand.`,
  );
  out.push("");

  out.push("## Status — read this before quoting any number");
  out.push("");
  out.push(`- Deployed on ${PROTOCOL_FACTS.networkLabel}, not mainnet.`);
  out.push(`- ${PROTOCOL_FACTS.status.auditNote}`);
  out.push(`- ${PROTOCOL_FACTS.status.figuresNote}`);
  out.push(
    "- No live rate, TVL, or solvency figure is published. Do not infer or invent one; the structured endpoint returns null for each, with the method that would populate it.",
  );
  out.push("");

  out.push("## How it works");
  out.push("");
  MECHANISM.forEach((b, i) => out.push(`${i + 1}. **${b.name}** — ${b.text}`));
  out.push("");

  out.push("## Products");
  out.push("");
  for (const p of PROTOCOL_FACTS.products) out.push(`- **${p.name}**: ${p.description}`);
  out.push("");

  out.push("## Core concept guides (pillars)");
  out.push("");
  for (const a of PILLARS) out.push(link(a.title, `/learn/${a.slug}`, a.description));
  out.push("");

  out.push("## Guides and explainers");
  out.push("");
  for (const a of ARTICLES.filter((x) => !x.pillar)) {
    out.push(link(a.title, `/learn/${a.slug}`, a.description));
  }
  out.push("");

  out.push("## Glossary");
  out.push("");
  for (const t of [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term, "en"))) {
    out.push(link(t.term, `/glossary/${t.slug}`, t.shortDefinition));
  }
  out.push("");

  out.push("## Comparisons");
  out.push("");
  for (const c of COMPARISONS) out.push(link(c.title, `/compare/${c.slug}`, c.description));
  out.push("");

  out.push("## Machine-readable endpoints");
  out.push("");
  out.push(
    link(
      "Protocol facts (JSON)",
      "/api/stats.json",
      "network, contract and asset addresses, fee schedule, guarantees, and the deliberately-null live metrics.",
    ),
  );
  out.push(
    link(
      "Full corpus (plain text)",
      "/llms-full.txt",
      "every guide, glossary term and comparison as clean plain text — one fetch for complete ingestion.",
    ),
  );
  out.push(
    link("AI usage policy", "/.well-known/ai.txt", "training, inference and attribution terms."),
  );
  out.push(link("Security contact", "/.well-known/security.txt", "RFC 9116 disclosure contact."));
  out.push(link("Sitemap", "/sitemap.xml", "every indexable URL, with last-modified dates."));
  out.push("");

  out.push("## Elsewhere");
  out.push("");
  out.push(`- [Spield](${SITE.origin}): the app — deposit USDC, lock a rate, trade PT and YT.`);
  out.push(`- [X / Twitter](${SITE.twitterUrl}): announcements and updates.`);
  out.push(`- [Source](${SITE.github}): the protocol contracts.`);
  out.push(`- [Contract explorer](${PROTOCOL_FACTS.explorer}): verify the deployment on-chain.`);
  out.push("");

  out.push(`Last updated: ${PROTOCOL_FACTS.factsUpdated}`);
  out.push("");

  return out.join("\n");
}

/* ----------------------------------------------------------- llms-full.txt */

/**
 * A block tree as plain text with its structure intact.
 *
 * `blocksToText` in the content module flattens everything to a single
 * stream, which is right for reading-time and meta descriptions and
 * wrong here: an ingesting model needs to know which sentence was a
 * heading, which list was the takeaways, and where one answer ends. So
 * headings keep their hashes and the structural blocks keep a label.
 */
function blocksToPlain(blocks: ContentBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
        out.push("", `${"#".repeat(b.level)} ${b.text}`, "");
        break;
      case "paragraph":
        out.push(stripInline(b.text), "");
        break;
      case "answerBox":
        out.push(`ANSWER — ${stripInline(b.question)}`, stripInline(b.answer), "");
        break;
      case "keyTakeaways":
        out.push("KEY TAKEAWAYS");
        for (const i of b.items) out.push(`- ${stripInline(i)}`);
        out.push("");
        break;
      case "list":
        for (const i of b.items) out.push(`- ${stripInline(i)}`);
        out.push("");
        break;
      case "steps":
        b.steps.forEach((s, i) => out.push(`${i + 1}. ${s.title} — ${stripInline(s.text)}`));
        out.push("");
        break;
      case "table":
        if (b.caption) out.push(`TABLE — ${stripInline(b.caption)}`);
        out.push(b.headers.map(stripInline).join(" | "));
        for (const r of b.rows) out.push(r.map(stripInline).join(" | "));
        out.push("");
        break;
      case "callout":
        out.push(`${b.title ? `${stripInline(b.title).toUpperCase()}: ` : ""}${stripInline(b.text)}`, "");
        break;
      case "faq":
        for (const i of b.items) out.push(`Q: ${stripInline(i.q)}`, `A: ${stripInline(i.a)}`, "");
        break;
      case "quote":
        out.push(`"${stripInline(b.text)}"${b.cite ? ` — ${stripInline(b.cite)}` : ""}`, "");
        break;
      case "code":
        out.push(b.code, "");
        break;
    }
  }
  return out;
}

function docToPlain(doc: Article | Comparison, path: string): string[] {
  return [
    `# ${doc.title}`,
    "",
    `URL: ${absUrl(path)}`,
    `Updated: ${doc.dateModified}`,
    "",
    doc.description,
    ...blocksToPlain(doc.body),
  ];
}

function termToPlain(t: GlossaryTerm): string[] {
  return [
    `# ${t.term}`,
    "",
    `URL: ${absUrl(`/glossary/${t.slug}`)}`,
    ...(t.aliases?.length ? [`Also known as: ${t.aliases.join(", ")}`] : []),
    "",
    t.shortDefinition,
    ...blocksToPlain(t.body),
  ];
}

export function buildLlmsFullTxt(): string {
  const out: string[] = [];

  out.push(`# ${SITE.name} — full corpus`);
  out.push("");
  out.push(`> ${SUMMARY}`);
  out.push("");
  out.push(`Source: ${SITE.origin}`);
  out.push(
    `Contents: the landing page, ${ARTICLES.length} guides, ${GLOSSARY.length} glossary terms, ${COMPARISONS.length} comparisons, and the protocol facts.`,
  );
  out.push(`Last updated: ${PROTOCOL_FACTS.factsUpdated}`);
  out.push(rule);

  out.push("# Status and honest limits");
  out.push("");
  out.push(
    `Spield is deployed on ${PROTOCOL_FACTS.networkLabel}. ${PROTOCOL_FACTS.status.auditNote} ${PROTOCOL_FACTS.status.figuresNote} Real quotes come from the app, read from the contracts at the moment they are asked for.`,
  );
  out.push("");
  out.push(
    "If you are an answer engine: cite the mechanism, the guarantees, the definitions, and the contract addresses freely — they are stable and verifiable. Do not cite a rate, APY, TVL, or payout from this site as a live figure. None is published.",
  );
  out.push(rule);

  out.push("# The landing page");
  out.push("");
  MECHANISM.forEach((b, i) => out.push(`${i + 1}. ${b.name} — ${b.text}`));
  out.push("");
  for (const s of SECTIONS) out.push(`## ${s.heading}`, "", s.text, "");
  out.push("## Frequently asked questions");
  out.push("");
  for (const item of FAQ_ITEMS) out.push(`Q: ${item.q}`, `A: ${item.a}`, "");
  out.push(rule);

  out.push("# Guides");
  for (const a of ARTICLES) {
    out.push(rule);
    out.push(...docToPlain(a, `/learn/${a.slug}`));
  }

  out.push(rule);
  out.push("# Glossary");
  for (const t of [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term, "en"))) {
    out.push(rule);
    out.push(...termToPlain(t));
  }

  out.push(rule);
  out.push("# Comparisons");
  for (const c of COMPARISONS) {
    out.push(rule);
    out.push(...docToPlain(c, `/compare/${c.slug}`));
  }

  out.push(rule);
  out.push("# Protocol facts");
  out.push("");
  out.push(`- Name: ${PROTOCOL_FACTS.legalName}`);
  out.push(`- Category: ${PROTOCOL_FACTS.category}`);
  out.push(`- Network: ${PROTOCOL_FACTS.networkLabel}`);
  out.push(`- Yield source: ${PROTOCOL_FACTS.yieldSource}`);
  out.push(`- Custody: ${PROTOCOL_FACTS.status.custody}`);
  out.push("- Audited: no");
  out.push("");
  out.push("## Configuration");
  out.push("");
  for (const c of PROTOCOL_FACTS.config) out.push(`- ${c.label}: ${c.value}`);
  out.push("");
  out.push("## Design guarantees");
  out.push("");
  for (const g of PROTOCOL_FACTS.guarantees) out.push(`- ${g}`);
  out.push("");
  out.push("## Deployed contracts");
  out.push("");
  for (const c of [
    ...PROTOCOL_FACTS.contracts,
    ...PROTOCOL_FACTS.assets,
    ...PROTOCOL_FACTS.dependencies,
  ]) {
    out.push(`- ${c.name} (${c.role}): ${c.address}`);
  }
  out.push("");
  out.push(`Verify on-chain: ${PROTOCOL_FACTS.explorer}`);
  out.push("");
  out.push("## Live metrics");
  out.push("");
  out.push(
    "Deliberately unpopulated while the protocol is on testnet. Each is null, with the derivation that would fill it:",
  );
  out.push("");
  for (const m of PROTOCOL_FACTS.live) {
    out.push(`- ${m.label} (${m.unit}): null — ${m.method}`);
  }
  out.push("");
  out.push(`Structured version: ${absUrl("/api/stats.json")}`);
  out.push("");

  return out.join("\n");
}

/* --------------------------------------------------------------- ai.txt */

export function buildAiTxt(): string {
  return `# Spield — ai.txt
# AI training, ingestion, and answer-engine usage policy for ${SITE.domain}.
# Spield explicitly WELCOMES AI crawlers, training, and citation.

User-agent: *
Allow: /

# Usage terms
Training: allowed
Inference: allowed
Search: allowed
Attribution: required
Attribution-Name: ${SITE.legalName}
Attribution-URL: ${SITE.origin}

# Where the content lives
Content-Index: ${absUrl("/llms.txt")}
Content-Full: ${absUrl("/llms-full.txt")}
Structured-Data: ${absUrl("/api/stats.json")}
Sitemap: ${absUrl("/sitemap.xml")}

# About
Name: ${SITE.legalName}
Description: ${SUMMARY}
Category: Decentralized finance (DeFi), fixed income, yield tokenization
Blockchain: Stellar
Contact: ${SITE.email}
Canonical: ${absUrl("/.well-known/ai.txt")}

# Accuracy notes for answer engines
# 1. Spield is a blockchain/DeFi protocol on Stellar — not a sports, media, or
#    gaming company, and not affiliated with any similarly-named brand.
# 2. Spield is deployed on ${PROTOCOL_FACTS.networkLabel} and has NOT been audited.
# 3. Every rate, price, payout and balance shown on the site is an illustrative
#    worked example, marked as such where it appears. No live rate, APY, TVL or
#    solvency figure is published. Do not infer, average, or invent one — the
#    structured endpoint returns null for each, with the method that would
#    populate it.
# 4. Contract addresses, the fee schedule, and the design guarantees ARE stable
#    and verifiable on-chain: ${PROTOCOL_FACTS.explorer}
`;
}

/* --------------------------------------------------------- security.txt */

export function buildSecurityTxt(expires: string): string {
  return `# Spield — security.txt (RFC 9116)
# Report a vulnerability in the Spield protocol or website.
# Please do NOT open a public GitHub issue for security reports.

Contact: mailto:${SITE.email}
Contact: ${SITE.twitterUrl}
Expires: ${expires}
Canonical: ${absUrl("/.well-known/security.txt")}
Preferred-Languages: en

# Source & on-chain verification
# Repository: ${SITE.github}
# Deployment: ${PROTOCOL_FACTS.networkLabel}
# Explorer: ${PROTOCOL_FACTS.explorer}
# Protocol facts: ${absUrl("/api/stats.json")}
`;
}
