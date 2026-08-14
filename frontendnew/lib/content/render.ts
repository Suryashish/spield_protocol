/**
 * Framework-free projections of the content model: slugs, plain text,
 * reading time, table of contents.
 *
 * The old Vite site also carried a `blockToHtml` string serializer here,
 * because it had to render the same blocks twice — once through React for
 * the SPA and once through a prerender script for crawlers — and a single
 * string serializer was the only way to guarantee the two matched. Next
 * renders server-side, so there is exactly one render path and blocks go
 * straight to React elements (see `components/learn/Blocks.tsx`). What is
 * left here is what genuinely has no view attached: text projections that
 * feed reading time, meta descriptions, JSON-LD, and llms-full.txt.
 */
import type { ContentBlock } from "./types";

/** Turn a heading or term into a URL-safe anchor slug. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

/** Strip the markdown-lite inline syntax down to readable prose. */
export const stripInline = (t: string): string =>
  t.replace(/[*`_]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

/**
 * Plain-text projection of a block — reading time, meta fallbacks, the
 * answer text fed into schema, and the plain-text corpus at /llms-full.txt.
 */
export function blockToText(block: ContentBlock): string {
  switch (block.type) {
    case "paragraph":
    case "quote":
      return stripInline(block.text);
    case "heading":
      return block.text;
    case "list":
      return block.items.map(stripInline).join(" ");
    case "keyTakeaways":
      return block.items.map(stripInline).join(" ");
    case "answerBox":
      return `${block.question} ${stripInline(block.answer)}`;
    case "callout":
      return stripInline(block.text);
    case "steps":
      return block.steps.map((s) => `${s.title} ${stripInline(s.text)}`).join(" ");
    case "faq":
      return block.items.map((i) => `${i.q} ${stripInline(i.a)}`).join(" ");
    case "table":
      return [...block.headers, ...block.rows.flat()].map(stripInline).join(" ");
    case "code":
      return "";
  }
}

export function blocksToText(blocks: ContentBlock[]): string {
  return blocks.map(blockToText).filter(Boolean).join("\n\n");
}

export function readingMinutes(blocks: ContentBlock[]): number {
  const words = blocks.map(blockToText).join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/** H2/H3 headings, for the article's rail. */
export function buildToc(blocks: ContentBlock[]): { id: string; text: string; level: number }[] {
  return blocks
    .filter(
      (b): b is Extract<ContentBlock, { type: "heading" }> => b.type === "heading" && b.level <= 3,
    )
    .map((b) => ({ id: b.id || slugify(b.text), text: b.text, level: b.level }));
}

/** Every Q&A in a body, for FAQPage schema. */
export function collectFaq(blocks: ContentBlock[]): { q: string; a: string }[] {
  const out: { q: string; a: string }[] = [];
  for (const b of blocks) {
    if (b.type === "faq") for (const i of b.items) out.push({ q: i.q, a: stripInline(i.a) });
  }
  return out;
}

/** A plain-text excerpt, for meta fallbacks. */
export function bodyExcerpt(blocks: ContentBlock[], maxLen = 160): string {
  const text = blocks.map(blockToText).join(" ").replace(/\s+/g, " ").trim();
  return text.length > maxLen ? `${text.slice(0, maxLen - 1).trimEnd()}…` : text;
}
