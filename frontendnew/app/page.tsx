import SiteNav from "@/components/SiteNav";
import Hero from "@/components/hero/Hero";
import Partners from "@/components/Partners";
import SplitSection from "@/components/SplitSection";
import VaultSection from "@/components/VaultSection";
import TradersSection from "@/components/TradersSection";
import TrustSection from "@/components/TrustSection";
import FAQ from "@/components/FAQ";
import ClosingCTA from "@/components/ClosingCTA";
import SiteFooter from "@/components/SiteFooter";
import { homePageGraph } from "@/lib/seo/schema";

/**
 * The page, and its machine-readable twin.
 *
 * `homePageGraph()` carries the WebPage, the breadcrumb, the FAQ, the
 * mechanism as a HowTo, the vocabulary as DefinedTerms, and the protocol
 * facts as a Dataset — every one of them assembled from the same modules
 * the components below render from, so the graph cannot claim something
 * the page does not say. Emitted from a server component so it is in the
 * first byte of HTML rather than after hydration: most AI crawlers never
 * run the JS, and a page whose meaning only exists post-hydration reads
 * to them as an empty shell.
 */
export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homePageGraph()) }}
      />
      <SiteNav />
      <main>
        <Hero />
        {/* sections 2+ arrive as a sheet sliding over the receding vault.
            The mechanism explains what the protocol does; the vault is
            what it does for you, and the market is the other side of
            that trade. The FAQ answers what all three provoke, and the
            close after them takes the vault's black back, so the page
            ends where it began. */}
        <div className="sheet">
          {/* First inside the sheet, so the ecosystem it is built on is the
              first thing the page says once the vault recedes — credibility
              before the argument, which is the order the old site used too. */}
          <Partners />
          <SplitSection />
          <VaultSection />
          <TradersSection />
          {/* After the three arguments and before the questions: the page has
              now claimed a fixed rate, a split, and a market, and this is where
              it hands over the addresses and says check it yourself. Putting it
              after the FAQ would make the receipts a footnote to the
              objections rather than the answer to them. */}
          <TrustSection />
          <FAQ />
          <ClosingCTA />
          <SiteFooter />
        </div>
      </main>
    </>
  );
}
