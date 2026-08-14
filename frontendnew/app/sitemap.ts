import type { MetadataRoute } from "next";
import { SITE, absUrl } from "@/lib/seo/site";
import { PROTOCOL_FACTS } from "@/lib/seo/facts";
import { allContentEntries } from "@/lib/content";

/**
 * Home, the three hubs, and every page of the corpus — generated from the
 * content registry, so a new guide appears here the moment it is
 * registered and never because someone remembered to add a row.
 *
 * Hash anchors are deliberately absent: a fragment is not a URL, Google
 * discards them, and a sitemap listing things that are not separately
 * addressable is one a crawler learns to distrust. The .txt and .json
 * endpoints are absent for the mirror-image reason — real URLs, but not
 * pages, and already advertised in robots.txt, ai.txt and the page's
 * <link rel="alternate"> tags.
 *
 * Priorities are relative and only meaningful against each other:
 * home 1.0, pillars 0.9, hubs 0.8, guides and comparisons 0.7, glossary
 * 0.6 — the shape of the site, stated.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const factsDate = new Date(PROTOCOL_FACTS.factsUpdated);

  const home: MetadataRoute.Sitemap = [
    { url: SITE.origin, lastModified: factsDate, changeFrequency: "weekly", priority: 1 },
  ];

  /* A hub's freshness is the freshness of the newest thing on it. */
  const entries = allContentEntries();
  const newest = (prefix: string) => {
    const dates = entries
      .filter((e) => e.path.startsWith(prefix))
      .map((e) => new Date(e.dateModified).getTime())
      .filter((n) => !Number.isNaN(n));
    return dates.length ? new Date(Math.max(...dates)) : factsDate;
  };

  const hubs: MetadataRoute.Sitemap = ["/learn", "/glossary", "/compare"].map((path) => ({
    url: absUrl(path),
    lastModified: newest(path),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  const pages: MetadataRoute.Sitemap = entries.map((e) => ({
    url: absUrl(e.path),
    lastModified: new Date(e.dateModified),
    changeFrequency: "monthly" as const,
    priority: e.pillar ? 0.9 : e.type === "glossary" ? 0.6 : 0.7,
  }));

  return [...home, ...hubs, ...pages];
}
