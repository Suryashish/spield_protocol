import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";
import "../content.css";

/**
 * Shared chrome for /learn, /glossary and /compare.
 *
 * A route group, so the URLs stay flat — `/learn/pt-vs-yt`, not
 * `/content/learn/pt-vs-yt`. The corpus is the site's topical authority
 * and its URLs should read like it.
 *
 * The nav and footer are the landing page's, unchanged. That is the
 * point: a Learn hub that arrives in its own chrome reads as a different
 * property, and the whole reason to host the guides on the protocol's
 * own domain is that the authority accrues to one entity.
 *
 * `content.css` is imported here rather than in the root layout so the
 * landing page never downloads it.
 */
export default function ContentLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      {children}
      <SiteFooter />
    </>
  );
}
