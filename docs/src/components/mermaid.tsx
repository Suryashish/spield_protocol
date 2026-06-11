'use client';

import { useEffect, useId, useState } from 'react';

/**
 * Client-side Mermaid renderer for diagrams in MDX.
 *
 * Usage in MDX:
 *
 * ```mermaid
 * flowchart LR
 *   A --> B
 * ```
 *
 * The `pre` MDX override (see `components/mdx.tsx`) detects `language-mermaid`
 * code blocks and renders them through this component. Mermaid is imported
 * dynamically so it never ships in the server bundle. The active theme is read
 * from the `dark` class Fumadocs sets on `<html>` (no `next-themes` dependency),
 * and the diagram re-renders when that class changes so it always matches.
 */
export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [svg, setSvg] = useState('');
  const [isDark, setIsDark] = useState(true);

  // Track the `dark` class on <html> (Fumadocs theme switch toggles it).
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setIsDark(root.classList.contains('dark'));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { default: mermaid } = await import('mermaid');

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        fontFamily: 'inherit',
        theme: isDark ? 'dark' : 'default',
        themeVariables: isDark
          ? {
              primaryColor: '#0a1a18',
              primaryBorderColor: '#00ffcc',
              primaryTextColor: '#e7ecea',
              lineColor: '#2dd4bf',
              secondaryColor: '#0c1116',
              tertiaryColor: '#0c1116',
              background: '#020609',
              fontSize: '14px',
            }
          : {
              primaryColor: '#e6fffa',
              primaryBorderColor: '#0b9e86',
              primaryTextColor: '#06302a',
              lineColor: '#0b9e86',
              fontSize: '14px',
            },
      });

      try {
        const { svg: rendered } = await mermaid.render(`mmd-${id}`, chart);
        if (!cancelled) setSvg(rendered);
      } catch {
        // Leave the raw text visible if a diagram fails to parse.
        if (!cancelled) setSvg('');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart, id, isDark]);

  return (
    <div
      className="my-6 flex min-h-24 items-center justify-center overflow-x-auto rounded-xl border border-fd-border bg-fd-card/40 p-4 [&_svg]:max-w-full"
      // mermaid output is generated from trusted, authored MDX
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    >
      {svg ? null : (
        <span className="animate-pulse text-xs text-fd-muted-foreground">
          Rendering diagram…
        </span>
      )}
    </div>
  );
}
