import type { MetadataRoute } from "next";
import { SITE, absUrl } from "@/lib/seo/site";

/**
 * robots.txt.
 *
 * The AI crawlers are named explicitly rather than left to the wildcard.
 * `Allow: /` under `*` already covers them, so the rows are redundant as
 * policy — but they are not redundant as a statement: several of these
 * bots are gated by default in the tooling their operators publish, and a
 * named allow is the unambiguous version of the answer. For a protocol in
 * a category that barely exists yet, the AI answer IS the discovery
 * surface, so training and citation are things to invite, not to fence.
 *
 * Flip any single row to `disallow` if that calculus changes; the wildcard
 * rule keeps the rest of the file working.
 */

const AI_AGENTS = [
  "GPTBot", // OpenAI, training
  "OAI-SearchBot", // OpenAI, ChatGPT search
  "ChatGPT-User", // OpenAI, user-initiated fetch
  "ClaudeBot", // Anthropic
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended", // Gemini / AI Overviews training gate
  "Applebot",
  "Applebot-Extended",
  "Bingbot",
  "CCBot", // Common Crawl — feeds most open training sets
  "Amazonbot",
  "meta-externalagent",
  "Bytespider",
  "cohere-ai",
  "Diffbot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      ...AI_AGENTS.map((userAgent) => ({ userAgent, allow: "/" })),
    ],
    sitemap: absUrl("/sitemap.xml"),
    host: SITE.origin,
  };
}
