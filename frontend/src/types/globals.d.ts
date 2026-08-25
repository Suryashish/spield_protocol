import type { Eip1193Provider } from '@/lib/cctp';

/** Globals installed by the inline analytics bootstrap in index.html. */
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    ethereum?: Eip1193Provider;
  }
}

export {};
