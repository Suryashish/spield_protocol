import LightRays from '@/components/LightRays';
import CreaseBg2 from '@/components/ui/CreaseBg2';
import Navbar from '@/components/Navbar';
import Hero from '@/components/Hero';
import Partners from '@/components/Partners';
import Features from '@/components/Features';
import HowItWorks from '@/components/HowItWorks';
import Products from '@/components/Products';
import FAQ from '@/components/FAQ';
import CTA from '@/components/CTA';
import Footer from '@/components/Footer';

const LandingPage = () => {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-background">
      {/* Sleek film-grain noise over the entire page */}
      <div className="noise-overlay" aria-hidden="true" />

      <Navbar />

      {/* ============ HERO (full viewport, with pinned background art) ============ */}
      <section className="relative h-screen overflow-hidden">
        {/* Background Layer 1: Crease SVG */}
        <CreaseBg2
          style={{
            position: 'absolute',
            top: '25vh',
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: 0,
            height: '100vh',
            zIndex: 0,
            transform: 'scale(1.2)',
          }}
        />

        {/* Background Layer 2: Light Rays */}
        <div className="absolute inset-0 z-[1] pointer-events-none">
          <LightRays
            raysOrigin="top-center"
            raysColor="#00ffcc"
            raysSpeed={1.0}
            lightSpread={0.6}
            rayLength={1.5}
            followMouse={true}
            mouseInfluence={0.05}
            noiseAmount={0.05}
            distortion={0.03}
          />
        </div>

        {/* Hero content */}
        <div className="relative z-10 flex h-full flex-col justify-center">
          <Hero />
        </div>

        {/* fade into the dark page below */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 z-[5] bg-gradient-to-b from-transparent to-background" />
      </section>

      {/* ============ SCROLLING BODY ============ */}
      <div className="relative z-10">
        {/* layered ambient field — texture + structure + colour, blended */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* base tone: a soft top→bottom wash that ties into the hero's dark */}
          <div className="absolute inset-0 bg-gradient-to-b from-brand-primary/[0.03] via-transparent to-brand-secondary/[0.03]" />

          {/* technical grid + dot accents give the dark space structure */}
          <div className="bg-grid absolute inset-0" />
          <div className="bg-dots absolute top-[10%] left-1/2 -translate-x-1/2 w-[120%] h-[55%]" />

          {/* colour glows */}
          <div className="absolute top-[6%] -left-40 w-[420px] h-[420px] rounded-full bg-brand-primary/[0.07] blur-[130px]" />
          <div className="absolute top-[26%] -right-48 w-[460px] h-[460px] rounded-full bg-brand-secondary/[0.06] blur-[150px]" />
          <div className="absolute top-[50%] left-1/4 w-[440px] h-[440px] rounded-full bg-brand-primary/[0.045] blur-[150px]" />
          <div className="absolute top-[72%] -right-40 w-[420px] h-[420px] rounded-full bg-brand-secondary/[0.055] blur-[140px]" />
          <div className="absolute bottom-[4%] left-1/3 w-[460px] h-[460px] rounded-full bg-brand-primary/[0.05] blur-[150px]" />

          {/* faint vertical seam of light down the center */}
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-gradient-to-b from-transparent via-white/[0.05] to-transparent" />

          {/* vignette to pull focus inward and blend the texture into the edges */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_100%_80%_at_50%_40%,transparent_55%,var(--color-background)_100%)]" />
        </div>

        <div className="relative">
          <div className="py-8">
            <Partners />
          </div>

          <Features />
          <HowItWorks />
          <Products />
          <FAQ />
          <CTA />
          <Footer />
        </div>
      </div>
    </main>
  );
};

export default LandingPage;
