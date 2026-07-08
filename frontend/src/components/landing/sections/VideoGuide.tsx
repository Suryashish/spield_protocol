import { useState } from 'react';
import { Play } from 'lucide-react';
import { Reveal, Section, SectionGlow, SectionHeading } from '@/components/ui/Section';

const VIDEO_SRC =
  'https://drive.google.com/file/d/1qbdGYqC91zDo-nQdYDWT2lJGanPNXNon/preview';

/**
 * Video guide, loaded with a click-to-play FAÇADE.
 *
 * The embedded Google Drive player pulls in ~2.7 MB of third-party JS/WASM (gstatic
 * fileview, the YouTube player, gapi) AND sets 9 third-party cookies — which on its
 * own tanked the Lighthouse Best-Practices score and added ~2.7 MB to the page
 * payload + hundreds of ms of main-thread blocking, all before anyone even watches
 * the video. It also broke bf-cache (the Drive iframe registers an unload handler).
 *
 * So we DON'T mount the iframe on load. We render a lightweight, static poster
 * (pure CSS/SVG — no network) with a play button. Only when the visitor actually
 * clicks does the real iframe get injected. Result: zero third-party cost for the
 * ~99% of visitors who never play the video, and the exact same experience for the
 * ones who do.
 */
const VideoGuide = () => {
  const [playing, setPlaying] = useState(false);

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
            {playing ? (
              <iframe
                width="100%"
                height="100%"
                src={`${VIDEO_SRC}?autoplay=1`}
                title="Understanding Spield Protocol"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="w-full h-full"
              />
            ) : (
              <button
                type="button"
                onClick={() => setPlaying(true)}
                aria-label="Play the Spield walkthrough video"
                className="group relative flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br from-[#04121a] via-[#020a10] to-black focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              >
                {/* ambient brand glow behind the play control */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute h-64 w-64 rounded-full bg-brand-primary/20 blur-[90px] transition-opacity duration-300 group-hover:opacity-80"
                />
                {/* play control */}
                <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-brand-primary text-black shadow-lg shadow-brand-primary/30 transition-transform duration-300 group-hover:scale-110">
                  <Play className="ml-1 h-8 w-8 fill-current" strokeWidth={0} />
                </span>
                <span className="absolute bottom-5 left-0 right-0 text-center text-sm font-medium text-white/70">
                  Watch the walkthrough
                </span>
              </button>
            )}
          </div>
        </div>
      </Reveal>
    </Section>
  );
};

export default VideoGuide;
