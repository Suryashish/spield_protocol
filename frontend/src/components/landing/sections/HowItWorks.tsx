import { motion } from 'framer-motion';
import { ArrowDownToLine, Split, LineChart, Coins, Percent, Zap } from 'lucide-react';

import { Reveal, Section, SectionGlow, SectionHeading } from '@/components/ui/Section';

const ease = [0.16, 1, 0.3, 1] as const;

const STEPS = [
  {
    n: '01',
    icon: ArrowDownToLine,
    title: 'Deposit USDC',
    body: 'Supply Stellar-native USDC. Spield routes it into a Blend supply position that accrues real, on-chain yield behind a thin strategy adapter.',
    chip: 'Stellar-native',
  },
  {
    n: '02',
    icon: Split,
    title: 'Split into PT + YT',
    body: 'Minting produces equal amounts of Principal and Yield tokens. PT is your fixed-rate bond; YT is the leveraged claim on all yield to maturity.',
    chip: '1 : 1 mint',
  },
  {
    n: '03',
    icon: LineChart,
    title: 'Trade or hold',
    body: 'Lock a fixed APY by holding PT, lever up on the rate with YT, or LP the time-decay AMM, IL-free if you stay to maturity.',
    chip: 'Fixed · Lever · LP',
  },
];

const HowItWorks = () => {
  return (
    <Section id="how-it-works" className="py-24 md:py-32">
      <SectionGlow />
      <SectionHeading
        eyebrow="How it works"
        title={<>One position, two tradable tokens</>}
        subtitle="Take a yield-bearing position and strip it into a fixed claim and a variable claim. The invariant holds at every block."
      />

      {/* ===================== Split visualiser ===================== */}
      <Reveal delay={0.1} className="mt-16">
        <div className="relative liquid-glass rounded-3xl p-6 md:p-10 overflow-hidden">
          <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[480px] h-[480px] bg-brand-primary/10 blur-[120px] rounded-full" />

          <div className="relative grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_72px_minmax(0,1.5fr)] items-center gap-6 md:gap-0">
            {/* ---- Source ---- */}
            <div className="relative rounded-2xl border border-white/10 bg-white/[0.025] p-6">
              <div className="flex items-center gap-3">
                <div className="grid place-items-center w-11 h-11 rounded-xl bg-brand-primary/10 text-brand-primary ring-1 ring-brand-primary/20">
                  <Coins size={18} />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">Position</div>
                  <div className="text-lg font-semibold text-white leading-tight">Blend USDC</div>
                </div>
              </div>
              <div className="mt-5 flex items-center justify-between rounded-lg bg-black/20 px-3 py-2">
                <span className="text-[11px] text-white/45">bRate</span>
                <span className="font-mono text-[11px] text-brand-primary">1.0412 ↑</span>
              </div>
              <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-brand-primary/10 px-2.5 py-1 text-[10px] font-medium text-brand-primary ring-1 ring-brand-primary/20">
                <span className="h-1 w-1 rounded-full bg-brand-primary animate-pulse" />
                yield-bearing
              </span>
            </div>

            {/* ---- Split connector ---- */}
            <div className="relative hidden md:block h-full" aria-hidden="true">
              <svg viewBox="0 0 72 200" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
                {/* trunk from source center, branching up to PT and down to YT */}
                <motion.path
                  d="M0,100 H30 M30,100 C46,100 46,52 72,52 M30,100 C46,100 46,148 72,148"
                  fill="none" stroke="rgba(0,255,204,0.45)" strokeWidth="1.6" strokeLinecap="round"
                  initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }}
                  transition={{ duration: 1.4, ease }}
                />
                <circle cx="30" cy="100" r="3" fill="#00ffcc" />
              </svg>
            </div>

            {/* ---- PT + YT ---- */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:pl-2">
              {[
                {
                  tag: 'PT',
                  name: 'Principal Token',
                  desc: 'Redeems 1:1 at maturity. Trades at a discount today.',
                  stat: { icon: Percent, label: 'Fixed APY', value: '8.4%' },
                  featured: false,
                },
                {
                  tag: 'YT',
                  name: 'Yield Token',
                  desc: 'All yield to maturity. Cheap entry, leveraged on the rate.',
                  stat: { icon: Zap, label: 'Implied APY', value: '8.4%' },
                  featured: true,
                },
              ].map((t) => (
                <div
                  key={t.tag}
                  className={`group relative rounded-2xl border p-5 transition-transform duration-300 hover:-translate-y-1 ${
                    t.featured
                      ? 'border-brand-primary/25 bg-brand-primary/[0.06]'
                      : 'border-white/10 bg-white/[0.025]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`grid place-items-center w-9 h-9 rounded-xl text-xs font-bold transition-transform duration-300 group-hover:scale-110 ${
                        t.featured
                          ? 'bg-brand-primary/15 text-brand-primary ring-1 ring-brand-primary/30'
                          : 'bg-white/[0.06] text-white/80 ring-1 ring-white/10'
                      }`}
                    >
                      {t.tag}
                    </span>
                    <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
                      {t.name.split(' ')[0]}
                    </span>
                  </div>
                  <div className="mt-3 text-sm font-semibold text-white">{t.name}</div>
                  <p className="mt-1.5 text-xs leading-relaxed text-white/40">{t.desc}</p>
                  <div className="mt-4 flex items-center justify-between rounded-lg bg-black/20 px-3 py-2">
                    <span className="flex items-center gap-1.5 text-[10px] text-white/45">
                      <t.stat.icon size={11} className="text-brand-primary/70" />
                      {t.stat.label}
                    </span>
                    <span className="font-mono text-[11px] text-white">{t.stat.value}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* invariant line */}
          <div className="relative mt-7 flex items-center justify-center">
            <code className="relative rounded-full liquid-chip px-4 py-2 text-xs font-medium text-white/70">
              Value(position) <span className="text-brand-primary">=</span> Value(PT){' '}
              <span className="text-brand-primary">+</span> Value(YT)
            </code>
          </div>
        </div>
      </Reveal>

      {/* ===================== Steps ===================== */}
      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4">
        {STEPS.map((s, i) => (
          <Reveal key={s.n} delay={0.15 + i * 0.08}>
            <div className="group relative flex h-full flex-col overflow-hidden rounded-2xl liquid-glass p-6 transition-transform duration-300 hover:-translate-y-1">
              {/* corner glow that lights up on hover */}
              <div className="pointer-events-none absolute -right-16 -top-16 h-32 w-32 rounded-full bg-brand-primary/10 blur-3xl opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

              {/* step index + icon */}
              <div className="relative flex items-center gap-3">
                <span className="grid place-items-center w-8 h-8 rounded-full bg-brand-primary/10 text-[11px] font-bold tabular-nums text-brand-primary ring-1 ring-brand-primary/25">
                  {s.n}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
                  Step
                </span>
                <s.icon
                  size={18}
                  strokeWidth={2}
                  className="ml-auto text-white/30 transition-colors group-hover:text-brand-primary"
                />
              </div>

              <h3 className="relative mt-5 text-base font-semibold text-white">{s.title}</h3>
              <p className="relative mt-2 flex-1 text-sm leading-relaxed text-white/45">{s.body}</p>

              <div className="relative mt-5 flex items-center gap-2 border-t border-white/[0.06] pt-4">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-primary shadow-[0_0_6px_var(--color-brand-glow)]" />
                <span className="text-[11px] font-medium tracking-wide text-white/65">{s.chip}</span>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
};

export default HowItWorks;
