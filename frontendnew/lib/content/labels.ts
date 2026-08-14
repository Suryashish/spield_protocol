import type { Audience, ContentCategory } from "./types";

/**
 * How the model's enums read on the page. The content files carry slugs
 * — `fixed-income`, `defi-basics` — because those are stable keys; these
 * are the words a reader sees, kept in one place so a category renders
 * the same in the hub's grouping and in a guide's kicker.
 */

export const CATEGORY_LABEL: Record<ContentCategory, string> = {
  "fixed-income": "Fixed income",
  "yield-tokenization": "Yield tokenization",
  stellar: "Stellar",
  rwa: "Real-world assets",
  "defi-basics": "DeFi basics",
  institutional: "For institutions",
  developer: "For developers",
  comparisons: "Comparison",
};

/** The order the hub groups its sections in — broad first, narrow last. */
export const CATEGORY_ORDER: ContentCategory[] = [
  "fixed-income",
  "yield-tokenization",
  "stellar",
  "defi-basics",
  "rwa",
  "institutional",
  "developer",
  "comparisons",
];

export const AUDIENCE_LABEL: Record<Audience, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  developer: "Developer",
  institutional: "Institutional",
};

/** "2026-07-05" → "5 July 2026", without dragging in a date library. */
export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
