import { SITE } from "@/lib/seo/site";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "@/lib/seo/og";

/* Same card as Open Graph. X will fall back to og:image on its own, but
   an explicit twitter:image is the difference between a large summary
   card and X guessing at one. */
export const alt = SITE.ogImageAlt;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage();
}
