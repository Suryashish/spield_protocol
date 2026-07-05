import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus } from 'lucide-react';

import { Reveal, Section, SectionGlow, SectionHeading } from '@/components/ui/Section';

const QA = [
  {
    q: 'How do I set up a wallet and get started?',
    a: (
      <span className="block space-y-2">
        <span>Getting started with Spield is simple and takes less than a minute:</span>
        <span className="block pl-4 border-l border-brand-primary/30 space-y-1">
          <span className="block">
            1. Install the official Stellar wallet extension,{' '}
            <a
              href="https://www.freighter.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-primary hover:underline font-medium"
            >
              Freighter
            </a>.
          </span>
          <span className="block">
            2. Open the Freighter extension, switch the network to <strong>Testnet</strong>, and copy your public address.
          </span>
          <span className="block">
            3. Visit the{' '}
            <a
              href="https://friendbot.stellar.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-primary hover:underline font-medium"
            >
              Stellar Friendbot
            </a>, paste your address, and fund your wallet with free test XLM.
          </span>
          <span className="block">
            4. Go to the Spield Dashboard, click <strong>Connect Wallet</strong>, and start depositing or trading!
          </span>
        </span>
      </span>
    ),
  },
  {
    q: 'What exactly is a PT and a YT?',
    a: 'When you deposit, Spield mints equal amounts of a Principal Token (PT) and a Yield Token (YT). PT is a zero-coupon bond, like a government savings bond, that redeems 1:1 for your principal at maturity. YT is a claim on all the yield that position generates until maturity. Together they always equal the value of the original position.',
  },
  {
    q: 'Where does the yield actually come from?',
    a: 'From Blend, a native Stellar lending market. Your USDC becomes a Blend supply position whose bToken exchange rate genuinely rises on-chain. There is no invented index and no bridged asset; the backing grows with the real rate.',
  },
  {
    q: 'Is there any bridge or cross-chain risk?',
    a: 'No. Spield is Stellar-native only. Both the underlying asset and settlement currency (USDC) live on Stellar. There is no EVM bridge and no single-signer relayer, so you are not exposed to cross-chain security risks.',
  },
  {
    q: 'What is the minimum and maximum deposit?',
    a: 'There is no enforced minimum: you can deposit any positive USDC amount. The practical floor is whatever covers Stellar transaction fees (a fraction of a cent). On the upper end, the vault has a configurable capacity limit set by the protocol admin; the current capacity is displayed on the Deposit page. Deposits revert if the cap is reached, so check the available capacity before depositing a large amount.',
  },
  {
    q: 'Can I lose money holding PT?',
    a: 'PT redeems 1:1 for principal at maturity, so held to maturity it returns your principal plus the locked discount as fixed yield. Before maturity its market price moves with rates, like any bond. YT carries more risk: it can decay to zero if realized yield underperforms the implied APY.',
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
                      <div className="px-6 pb-5 text-sm leading-relaxed text-white/45">{item.a}</div>
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
