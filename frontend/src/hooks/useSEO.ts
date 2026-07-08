import { useEffect } from 'react';

interface SEOProps {
  title: string;
  description?: string;
  canonical?: string;
  /** 'website' (default) or 'article' for content-type routes. */
  ogType?: 'website' | 'article';
  /** Override the social share image (absolute URL). */
  image?: string;
  /** Set to true to keep a route out of the index (e.g. transient app states). */
  noindex?: boolean;
}

const DEFAULT_IMAGE = 'https://www.spield.live/og-image.png';

/**
 * Client-side SEO for the SPA's own routes (landing, dashboard). The AUTHORITATIVE
 * meta for crawlers on educational pages lives in the prerendered static HTML
 * (see scripts/prerender.mjs) — this hook keeps the interactive React routes and
 * in-app share previews correct. Manages title, description, canonical, robots,
 * Open Graph, and Twitter tags.
 */
export function useSEO({
  title,
  description,
  canonical,
  ogType = 'website',
  image = DEFAULT_IMAGE,
  noindex = false,
}: SEOProps) {
  useEffect(() => {
    document.title = title;

    const setMeta = (attr: 'name' | 'property', key: string, content: string) => {
      let el = document.querySelector(`meta[${attr}="${key}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };

    const setLink = (rel: string, href: string) => {
      let el = document.querySelector(`link[rel="${rel}"]`);
      if (!el) {
        el = document.createElement('link');
        el.setAttribute('rel', rel);
        document.head.appendChild(el);
      }
      el.setAttribute('href', href);
    };

    // Primary
    setMeta('name', 'title', title);
    if (description) setMeta('name', 'description', description);
    setMeta('name', 'robots', noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large');

    // Open Graph
    setMeta('property', 'og:type', ogType);
    setMeta('property', 'og:title', title);
    if (description) setMeta('property', 'og:description', description);
    setMeta('property', 'og:image', image);
    if (canonical) setMeta('property', 'og:url', canonical);

    // Twitter
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', title);
    if (description) setMeta('name', 'twitter:description', description);
    setMeta('name', 'twitter:image', image);

    // Canonical
    if (canonical) setLink('canonical', canonical);
  }, [title, description, canonical, ogType, image, noindex]);
}
