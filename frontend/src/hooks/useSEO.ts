import { useEffect } from 'react';

interface SEOProps {
  title: string;
  description?: string;
  canonical?: string;
}

export function useSEO({ title, description, canonical }: SEOProps) {
  useEffect(() => {
    // 1. Update Browser document title
    document.title = title;

    // Helper to update or create meta tags dynamically
    const updateMetaTag = (attribute: string, name: string, content: string) => {
      let element = document.querySelector(`meta[${attribute}="${name}"]`);
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attribute, name);
        document.head.appendChild(element);
      }
      element.setAttribute('content', content);
    };

    // 2. Update primary meta title & description
    updateMetaTag('name', 'title', title);
    if (description) {
      updateMetaTag('name', 'description', description);
    }

    // 3. Update Open Graph (Facebook/Discord/LinkedIn)
    updateMetaTag('property', 'og:title', title);
    if (description) {
      updateMetaTag('property', 'og:description', description);
    }

    // 4. Update Twitter Card (X/Twitter)
    updateMetaTag('name', 'twitter:title', title);
    if (description) {
      updateMetaTag('name', 'twitter:description', description);
    }

    // 5. Update Canonical link
    if (canonical) {
      let linkElement = document.querySelector('link[rel="canonical"]');
      if (!linkElement) {
        linkElement = document.createElement('link');
        linkElement.setAttribute('rel', 'canonical');
        document.head.appendChild(linkElement);
      }
      linkElement.setAttribute('href', canonical);
    }
  }, [title, description, canonical]);
}
