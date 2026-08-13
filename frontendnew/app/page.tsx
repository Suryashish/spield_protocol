import SiteNav from "@/components/SiteNav";
import Hero from "@/components/hero/Hero";
import SplitSection from "@/components/SplitSection";
import TradersSection from "@/components/TradersSection";
import ClosingCTA from "@/components/ClosingCTA";
import SiteFooter from "@/components/SiteFooter";

export default function Home() {
  return (
    <>
      <SiteNav />
      <main>
        <Hero />
        {/* sections 2+ arrive as a sheet sliding over the receding vault.
            The two arguments are set on paper; the close after them takes
            the vault's black back, so the page ends where it began. */}
        <div className="sheet">
          <SplitSection />
          <TradersSection />
          <ClosingCTA />
          <SiteFooter />
        </div>
      </main>
    </>
  );
}
