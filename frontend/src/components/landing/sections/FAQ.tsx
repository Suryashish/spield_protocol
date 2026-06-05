import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus } from 'lucide-react';

import { Reveal, Section, SectionGlow, SectionHeading } from './ui/Section';

const QA = [
  {
    q: 'What exactly is a PT and a YT?',
    a: 'When you deposit, Spield mints equal amounts of a Principal Token (PT) and a Yield Token (YT). PT is a zero-coupon bond that redeems 1:1 for your principal at maturity. YT is a claim on all the yield that position generates until maturity. Together they always equal the value of the original position.',
  },
  {
    q: 'Where does the yield actually come from?',
    a: 'From Blend — a native Stellar lending market. Your USDC becomes a Blend supply position whose bToken exchange rate genuinely rises on-chain. There is no invented index and no bridged asset; the backing grows with the real rate.',
  },
  {
    q: 'How is this different from v1?',
    a: 'v1 used an off-chain index with nothing backing the rising value, plus a fake fixed-price orderbook and broken accounting. v2 sources yield from an asset that accrues on-chain, prices PT/YT through a real time-decay AMM, and uses per-position accounting that never loses or fabricates yield.',
  },
  {
    q: 'Is there any bridge or cross-chain risk?',
    a: 'No. Spield is Stellar-native only. Both the underlying and settlement (USDC) live on Stellar as SACs. There is no EVM bridge and no single-signer relayer — an entire class of v1 trust holes is deleted.',
  },
  {
    q: 'Can I lose money holding PT?',
    a: 'PT redeems 1:1 for principal at maturity, so held to maturity it returns your principal plus the locked discount as fixed yield. Before maturity its market price moves with rates, like any bond. YT carries more risk — it can decay to zero if realized yield underperforms the implied APY.',
  },
  {
    q: 'Do LPs suffer impermanent loss?',
    a: 'The fixed-maturity structure largely eliminates it: as maturity approaches, PT converges to par and YT decays to zero, so an LP who stays to maturity faces near-zero impermanent loss while still earning swap fees.',
  },
];

const FAQ = () => {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <Section id="faq" className="py-24 md:py-32">
      <SectionGlow />
      <SectionHeading
        eyebrow="FAQ"
        title={<>Questions, answered</>}
        subtitle="The mechanics in plain language. Still curious? The full protocol design is open."
      />

      <div className="mt-14 max-w-3xl mx-auto space-y-3">
        {QA.map((item, i) => {
          const isOpen = open === i;
          return (
            <Reveal key={item.q} delay={i * 0.04}>
              <div
                className={`rounded-2xl border transition-colors ${
                  isOpen
                    ? 'liquid-glass border-transparent'
                    : 'border-white/10 bg-white/[0.015] hover:border-white/20'
                }`}
              >
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left"
                >
                  <span className="text-sm md:text-base font-medium text-white">{item.q}</span>
                  <span
                    className={`grid place-items-center w-7 h-7 shrink-0 rounded-full bg-white/5 text-white/60 transition-transform duration-300 ${
                      isOpen ? 'rotate-45 text-brand-primary' : ''
                    }`}
                  >
                    <Plus size={15} />
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                      className="overflow-hidden"
                    >
                      <p className="px-6 pb-5 text-sm leading-relaxed text-white/45">{item.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
};

export default FAQ;
