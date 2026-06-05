import LightRays from '@/components/LightRays';
import CreaseBg2 from '@/components/ui/CreaseBg2';
import Navbar from '@/components/Navbar';
import Hero from '@/components/Hero';
import Partners from '@/components/Partners';

const LandingPage = () => {
  return (
    <main className="relative h-screen overflow-hidden">
      {/* Background Layer 1: Softer Crease SVG Background */}
      <CreaseBg2 style={{ 
        position: 'fixed', 
        top: '25vh', 
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: 0, 
        height: '100vh',
        zIndex: 0,
        transform: 'scale(1.2)'
      }} />

      {/* Background Layer 2: Light Rays - Moved outside to ensure no clipping/z-index issues */}
      <div className="fixed inset-0 z-1 pointer-events-none">
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

      <div className="relative z-10 flex flex-col h-full">
        <Navbar />
        <div className="flex-grow flex flex-col justify-center pt-20">
          <Hero />
        </div>
        <Partners />
      </div>

      {/* Aesthetic Overlays - Removed deep shadow to keep top area clear */}
      <div className="fixed inset-0 pointer-events-none z-20" />
    </main>
  );
};

export default LandingPage;
