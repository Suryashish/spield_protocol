import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

/**
 * The app's theme lives in exactly one place — the `data-theme` attribute on
 * <html> — and is remembered under `spield-theme`. Both are the marketing
 * site's contract (see frontendnew/app/layout.tsx), so a user who prefers the
 * dark paper gets the same product on both hosts.
 *
 * The attribute is set BEFORE first paint by the inline bootstrap in
 * index.html; this hook only reads it back and writes changes, so there is no
 * flash and no server/client mismatch to reconcile.
 */
const STORAGE_KEY = 'spield-theme';

const read = (): Theme => {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
};

export const useTheme = () => {
  const [theme, setTheme] = useState<Theme>(read);

  // Follow the system preference for as long as the user hasn't expressed one.
  // Once they touch the toggle we've written to storage, and this stands down —
  // otherwise turning the OS to dark at sunset would silently undo their choice.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem(STORAGE_KEY)) return;
      } catch {
        /* storage unavailable — treat as "no stored preference" */
      }
      const next: Theme = e.matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      setTheme(next);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* private mode — the theme still applies for this session */
      }
      return next;
    });
  }, []);

  return { theme, toggle };
};
