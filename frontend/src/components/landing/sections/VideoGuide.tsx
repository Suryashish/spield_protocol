import { Reveal, Section, SectionGlow, SectionHeading } from '@/components/ui/Section';

const VideoGuide = () => {
  return (
    <Section id="video-guide" className="py-24 md:py-32">
      <SectionGlow position="center" />
      <SectionHeading
        eyebrow="Video Guide"
        title={<>See Spield in action</>}
        subtitle="A short walkthrough of how splitting, trading, and providing liquidity works, end to end."
      />

      <Reveal className="mt-14 max-w-4xl mx-auto">
        <div className="relative rounded-2xl liquid-glass p-2 shadow-2xl">
          {/* subtle brand underline */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-brand-primary/40 to-transparent" />
          <div className="aspect-video w-full rounded-xl overflow-hidden bg-black">
            <iframe
              width="100%"
              height="100%"
              src="https://drive.google.com/file/d/1qbdGYqC91zDo-nQdYDWT2lJGanPNXNon/preview"
              title="Understanding Spield Protocol"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="w-full h-full"
            />
          </div>
        </div>
      </Reveal>
    </Section>
  );
};

export default VideoGuide;
