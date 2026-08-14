import { buildAiTxt } from "@/lib/seo/corpus";

/* Canonically served at /.well-known/ai.txt; next.config.ts rewrites that
   path here. The bare /ai.txt is kept live because a good share of the
   crawlers that read the file at all still look for it at the root. */
export const dynamic = "force-static";

export function GET() {
  return new Response(buildAiTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=86400",
    },
  });
}
