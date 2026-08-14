import { buildSecurityTxt } from "@/lib/seo/corpus";

/* Canonically served at /.well-known/security.txt (RFC 9116); the root
   copy is a courtesy for scanners that still probe there first. */
export const dynamic = "force-static";

/**
 * RFC 9116 requires `Expires`, and requires it to be in the future — a
 * lapsed security.txt is treated as no security.txt. Stamping it a year
 * out from the build means every deploy renews it, and a site that has
 * not shipped in over a year is one whose disclosure contact genuinely
 * should be re-verified rather than silently trusted.
 */
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function GET() {
  const expires = new Date(Date.now() + ONE_YEAR_MS).toISOString();
  return new Response(buildSecurityTxt(expires), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=86400",
    },
  });
}
