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
 * Per-route document meta for the dApp: title, description, canonical, robots,
 * Open Graph, and Twitter tags.
 *
 * This host is not indexed (see index.html and public/robots.txt), so the job
 * here is not ranking — it's the browser tab and the link preview card when
 * someone pastes an app URL into a chat or a support thread. Routes pass
 * `noindex: true` to match the shell's own directive.
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
    setMeta('name', 'robots', noindex ? 'noindex, follow' : 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1');

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
