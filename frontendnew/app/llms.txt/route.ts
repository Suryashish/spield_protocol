import { buildLlmsTxt } from "@/lib/seo/corpus";

/* Built once at compile time and served from the edge cache — the content
   is assembled from static modules, so there is nothing to recompute per
   request and a crawler should never wait on a lambda for it. */
export const dynamic = "force-static";

export function GET() {
  return new Response(buildLlmsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
