"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { SITE } from "@/lib/seo/site";

/**
 * Google Analytics + Microsoft Clarity.
 *
 * Ported from the old Vite shell, which was the only place they lived — so
 * until now the tags ran on the dApp (noindexed, wallet-gated, low traffic)
 * and not on the site that actually gets visitors.
 *
 * Two things carried over deliberately, and one had to be added:
 *
 * DEFERRED LOADING (carried over). Neither tag is requested during the
 * critical render. They go in on `requestIdleCallback` after `load`, or on the
 * first real interaction, whichever comes first. This is stricter than
 * next/script's `lazyOnload`, which is why the injection is hand-rolled rather
 * than delegated: the interaction trigger is what stops a visitor who clicks
 * immediately from going unrecorded, and `lazyOnload` has no equivalent.
 *
 * THE STUBS (carried over). `window.gtag` and `window.clarity` are defined
 * synchronously, before anything is deferred, so calls made in the meantime
 * queue and flush when the real scripts arrive. Nothing is dropped.
 *
 * ROUTE-CHANGE PAGEVIEWS (new). The old site was one page, so one automatic
 * pageview covered it. This one is 62 static pages that navigate client-side,
 * and GA4's automatic `page_view` only fires on the initial document load — so
 * every click from a guide to a glossary term would be invisible, on a site
 * whose whole content strategy is internal linking. `send_page_view` is
 * therefore off in the config and every pageview, including the first, is sent
 * from the effect below. Off-and-send-manually rather than on-and-also-send,
 * so the initial load counts exactly once.
 */

const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? "G-Y902DS1JCN";
const CLARITY_ID = process.env.NEXT_PUBLIC_CLARITY_ID ?? "wjr8mkggic";

/** Clarity's own snippet shape: a callable that buffers onto `.q` until the tag loads. */
type ClarityFn = { (...args: unknown[]): void; q?: unknown[] };

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    clarity?: ClarityFn;
  }
}

/**
 * Only the real site reports.
 *
 * Vercel preview deployments run with NODE_ENV=production, so an env check
 * alone would have every preview and every branch build writing into the
 * production property. The host is the reliable discriminator: previews are
 * `*.vercel.app` and local work is `localhost`, and neither ends in the
 * production domain. Zero-config in prod, silent everywhere else.
 */
function reportingEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname.endsWith("spield.live");
}

/** Module-scoped: survives the remounts a root-layout child can see. */
let injected = false;

export default function Analytics() {
  const pathname = usePathname();

  /* --- the stubs, then the deferred injection. Runs once. --- */
  useEffect(() => {
    if (!reportingEnabled() || injected) return;
    injected = true;

    window.dataLayer = window.dataLayer ?? [];
    /* a real `function`, not an arrow: gtag's contract is that it forwards its
       own `arguments` object onto dataLayer verbatim */
    window.gtag = function () {
      window.dataLayer!.push(arguments);
    };
    window.gtag("js", new Date());
    window.gtag("config", GA_ID, { send_page_view: false });

    if (!window.clarity) {
      const stub: ClarityFn = function () {
        (stub.q = stub.q ?? []).push(arguments);
      };
      window.clarity = stub;
    }

    let loaded = false;
    let removeOver: (() => void) | undefined;
    const load = () => {
      if (loaded) return;
      loaded = true;
      removeOver?.();
      for (const src of [
        `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`,
        `https://www.clarity.ms/tag/${CLARITY_ID}`,
      ]) {
        const s = document.createElement("script");
        s.async = true;
        s.src = src;
        document.head.appendChild(s);
      }
    };

    const schedule = () =>
      "requestIdleCallback" in window
        ? requestIdleCallback(load, { timeout: 4000 })
        : setTimeout(load, 2000);

    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });

    for (const e of ["pointerdown", "keydown", "touchstart", "scroll"]) {
      window.addEventListener(e, load, { once: true, passive: true });
    }

    /* Hovering a link to the dApp starts the load early, and this is load-
       bearing for cross-domain measurement rather than a nicety.
       GA4 stitches the two hosts into one session by having gtag.js append a
       `_gl` linker param to outbound links at CLICK time — so gtag.js has to
       already be present when the click happens. `pointerdown` fires too late:
       it starts an async download that the navigation outruns. A visitor whose
       very first action is the CTA would therefore arrive on app.spield.live
       undecorated and be counted as a new, self-referred session — and that is
       precisely the highest-intent traffic, the people who read nothing and go
       straight to the app. `pointerover` fires on hover (and on touch, before
       the tap resolves), which buys the download enough time. */
    const onOver = (e: Event) => {
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (link?.href.startsWith(SITE.appOrigin)) load();
    };
    document.addEventListener("pointerover", onOver, { passive: true });
    removeOver = () => document.removeEventListener("pointerover", onOver);
  }, []);

  /* --- one pageview per route, including the first --- */
  useEffect(() => {
    if (!reportingEnabled()) return;
    window.gtag?.("event", "page_view", {
      page_path: pathname,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [pathname]);

  return null;
}
