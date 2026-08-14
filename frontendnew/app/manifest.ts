import type { MetadataRoute } from "next";
import { SITE } from "@/lib/seo/site";

/**
 * The web app manifest. Installability is not an SEO signal in itself,
 * but the manifest is where an installed shortcut gets its name, icon
 * and chrome colour — and a site that offers a "Launch app" button and
 * then installs as an untitled white rectangle undercuts the claim.
 *
 * `background_color` is the light canvas: it paints the splash before
 * the app's own theme script has run, so matching paper avoids a white
 * flash on the way in.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Spield — Fixed Income on Stellar",
    short_name: "Spield",
    description: SITE.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: SITE.themeColorLight,
    theme_color: SITE.themeColorLight,
    categories: ["finance", "business"],
    icons: [
      { src: "/logo-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/logo-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/logo-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
