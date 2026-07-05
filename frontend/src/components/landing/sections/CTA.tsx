import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Reveal, Section, SectionGlow } from '@/components/ui/Section';

const CTA = () => {
  return (
    <Section className="py-20 md:py-28">
      <SectionGlow position="center" />
      <Reveal>
        <div className="relative overflow-hidden rounded-3xl liquid-glass px-6 py-16 md:py-20 text-center">
          {/* glows */}
          <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-brand-primary/12 blur-[140px] rounded-full" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-brand-primary/40 to-transparent" />

          <div className="relative">
            <motion.span
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="inline-flex items-center gap-2 rounded-full liquid-chip px-3 py-1 text-[10px] font-bold uppercase tracking-[0.25em] text-brand-primary"
            >
              Get started
            </motion.span>

            <h2 className="mt-6 text-3xl md:text-5xl font-medium tracking-tight text-white leading-[1.1]">
              Turn yield into
              <br className="hidden sm:block" />
              <span className="text-gradient-brand"> something you can trade</span>
            </h2>

            <p className="mt-5 max-w-xl mx-auto text-sm md:text-base font-light text-white/45">
              Fixed rates, leveraged yield, and IL-free liquidity, all on real,
              on-chain Stellar yield. No bridges, no invented index.
            </p>

            <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link to="/dashboard">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="group flex items-center gap-3.5 rounded-xl bg-brand-primary px-7 py-3.5 text-[11px] font-bold tracking-[0.24em] text-[#021511] shadow-[0_4px_16px_rgba(0,255,204,0.12)] transition-shadow hover:shadow-[0_6px_20px_rgba(0,255,204,0.2)]"
                >
                  LAUNCH APP
                  <ChevronRight size={15} strokeWidth={2.5} className="transition-transform group-hover:translate-x-1" />
                </motion.button>
              </Link>
              <motion.a
                href="#faq"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="rounded-xl border border-white/12 px-7 py-3.5 text-[11px] font-bold tracking-[0.24em] text-white/60 hover:text-white hover:border-white/25 transition-colors"
              >
                READ THE DOCS
              </motion.a>
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
};

export default CTA;
