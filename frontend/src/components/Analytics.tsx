import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { NAV_ITEMS } from '@/components/dashboard/data';

/**
 * Per-route pageviews for the dApp.
 *
 * The gtag stub and the deferred loader live in index.html; this only sends the
 * events. `send_page_view` is off in that config, so every pageview — the first
 * one included — comes from here. Without it GA would record the arrival and
 * nothing after: the app is one document, and gtag's automatic pageview fires
 * once per document load, not once per client-side route.
 *
 * TRANSIENT PATHS ARE SKIPPED. `/` redirects to `/overview` and `/dashboard/*`
 * redirects to its unprefixed twin (see DashboardApp), so a naive
 * pathname-change handler would log a pageview for the URL the visitor was
 * never actually on, immediately followed by the real one — doubling arrivals
 * and inventing a `/` page that has no content. Only paths whose FIRST segment
 * is a real section count. First segment, not last: `/dashboard/vault` ends in
 * a valid section id and would otherwise slip through as a real pageview.
 */
export default function Analytics() {
  const { pathname } = useLocation();

  useEffect(() => {
    const section = pathname.split('/').filter(Boolean)[0];
    if (!NAV_ITEMS.some((n) => n.id === section)) return;

    window.gtag?.('event', 'page_view', {
      page_path: pathname,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [pathname]);

  return null;
}
