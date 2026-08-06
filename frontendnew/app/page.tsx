import SiteNav from "@/components/SiteNav";
import Hero from "@/components/hero/Hero";
import SplitSection from "@/components/SplitSection";
import TradersSection from "@/components/TradersSection";
import SiteFooter from "@/components/SiteFooter";

export default function Home() {
  return (
    <>
      <SiteNav />
      <main>
        <Hero />
        {/* sections 2+ arrive as a sheet sliding over the receding vault */}
        <div className="sheet">
          <SplitSection />
          <TradersSection />
          <SiteFooter />
        </div>
      </main>
    </>
  );
}
