import { motion } from 'framer-motion';
import { ArrowRight, TrendingUp, Wallet, Droplets } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Reveal, Section, SectionGlow, SectionHeading } from '@/components/ui/Section';

const ease = [0.16, 1, 0.3, 1] as const;

/* ----------------------------- per-card visuals ----------------------------- */

// Fixed: a discount price filling up to par (1.0) — locked the moment you buy.
const FixedVisual = () => (
  <div className="w-full">
    <div className="mb-1.5 flex items-center justify-between text-[10px] text-white/40">
      <span>PT today</span>
      <span>par 1.0</span>
    </div>
    <div className="relative h-2 w-full rounded-full bg-white/[0.06]">
      <motion.div
        initial={{ width: 0 }}
        whileInView={{ width: '93%' }}
        viewport={{ once: true }}
        transition={{ duration: 1, ease }}
        className="h-full rounded-full bg-gradient-to-r from-white/30 to-white/70"
      />
      <span className="absolute right-0 top-1/2 -translate-y-1/2 h-3 w-[2px] rounded bg-brand-primary" />
    </div>
  </div>
);

// Leverage: a multiplier readout with a small amplified bar.
const LeverageVisual = () => (
  <div className="flex items-end justify-between gap-3 w-full">
    <div className="flex items-end gap-1 h-9">
      {[30, 48, 70, 100].map((h, i) => (
        <motion.span
          key={i}
          initial={{ height: 4 }}
          whileInView={{ height: `${h}%` }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: i * 0.08, ease }}
          className="w-2 rounded-sm bg-gradient-to-t from-brand-primary/20 to-brand-primary/80"
        />
      ))}
    </div>
    <div className="text-right">
      <div className="font-display text-2xl leading-none text-gradient-brand">~9×</div>
      <div className="text-[9px] uppercase tracking-[0.16em] text-white/35">yield exposure</div>
    </div>
  </div>
);

// LP: a flowing fee line.
const LpVisual = () => (
  <div className="w-full">
    <svg viewBox="0 0 200 36" className="h-9 w-full" preserveAspectRatio="none">
      <motion.path
        d="M0,28 C30,28 36,12 60,12 C84,12 90,26 120,26 C150,26 156,8 200,8"
        fill="none" stroke="#00ffcc" strokeWidth="2" strokeLinecap="round"
        initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }}
        transition={{ duration: 1.1, ease }}
      />
    </svg>
    <div className="mt-1 flex items-center justify-between text-[10px]">
      <span className="text-white/40">swap fees</span>
      <span className="font-mono text-brand-primary">+3.2% APR</span>
    </div>
  </div>
);

/* ----------------------------- card config ----------------------------- */

const PRODUCTS = [
  {
    icon: Wallet,
    badge: 'Fixed',
    title: 'Earn fixed yield',
    body: 'Buy PT at a discount and redeem 1:1 at maturity. Your rate is locked the moment you buy.',
    metric: { value: '8.4%', label: 'Fixed APY', note: 'illustrative' },
    risk: 1,
    visual: <FixedVisual />,
    points: ['Predictable returns', 'No liquidation risk'],
    href: '/dashboard/vault',
  },
  {
    icon: TrendingUp,
    badge: 'Leverage',
    title: 'Lever up on yield',
    body: 'Buy YT cheap for amplified exposure. If yields beat the implied APY, YT captures the upside.',
    metric: { value: '~9×', label: 'Rate exposure', note: 'illustrative' },
    risk: 3,
    visual: <LeverageVisual />,
    points: ['Capital efficient', 'Claim yield anytime'],
    featured: true,
    href: '/dashboard/deposit',
  },
  {
    icon: Droplets,
    badge: 'LP',
    title: 'Provide liquidity',
    body: 'Supply the time-decay AMM and earn swap fees. Fixed maturity means near-zero IL if you hold.',
    metric: { value: '3.2%', label: 'Fee APR', note: 'illustrative' },
    risk: 2,
    visual: <LpVisual />,
    points: ['Earn trading fees', 'IL-free at maturity'],
    href: '/dashboard/liquidity',
  },
];

const RiskMeter = ({ level }: { level: number }) => (
  <div className="flex items-center gap-2">
    <span className="text-[9px] uppercase tracking-[0.16em] text-white/35">Risk</span>
    <div className="flex items-center gap-1">
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={`h-1.5 w-4 rounded-full ${
            n <= level ? 'bg-brand-primary/80' : 'bg-white/10'
          }`}
        />
      ))}
    </div>
  </div>
);

const Products = () => {
  return (
    <Section id="products" className="py-24 md:py-32">
      <SectionGlow />
      <SectionHeading
        eyebrow="Products"
        title={<>Choose your exposure to yield</>}
        subtitle="Certainty, leverage, or fees: Spield turns one yield stream into three distinct strategies."
      />

      <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-4">
        {PRODUCTS.map((p, i) => (
          <Reveal key={p.title} delay={i * 0.07} className={p.featured ? 'md:-mt-3 md:mb-3' : ''}>
            <div
              className={`group relative flex h-full flex-col overflow-hidden rounded-2xl p-7 transition-transform duration-300 hover:-translate-y-1.5 ${
                p.featured
                  ? 'liquid-glass'
                  : 'border border-white/10 bg-white/[0.015] hover:border-white/20'
              }`}
            >
              {/* animated soft glow on featured — oversized & blurred so only
                  its diffuse center shows; no hard rotating edge is visible */}
              {p.featured && (
                <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
                  <div className="absolute left-1/2 top-1/2 aspect-square w-[180%] -translate-x-1/2 -translate-y-1/2 rounded-full glow-ring opacity-50 blur-2xl" />
                </div>
              )}

              <div className="relative flex h-full flex-col">
                {/* header */}
                <div className="flex items-center justify-between">
                  <div
                    className={`grid place-items-center w-11 h-11 rounded-xl ring-1 ${
                      p.featured
                        ? 'bg-brand-primary/15 text-brand-primary ring-brand-primary/30'
                        : 'bg-white/5 text-white/70 ring-white/10'
                    }`}
                  >
                    <p.icon size={18} strokeWidth={2} />
                  </div>
                  <span className="rounded-full liquid-chip px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/70">
                    {p.badge}
                  </span>
                </div>

                <h3 className="mt-6 text-lg font-semibold text-white">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/45">{p.body}</p>

                {/* metric + visual panel */}
                <div className="mt-5 rounded-xl border border-white/[0.07] bg-black/20 p-4">
                  <div className="mb-3 flex items-end justify-between">
                    <div>
                      <div className="font-display text-2xl leading-none text-white tabular-nums">
                        {p.metric.value}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-white/35">
                        {p.metric.label}
                        <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[8px] normal-case tracking-normal text-white/25">
                          {p.metric.note}
                        </span>
                      </div>
                    </div>
                    <RiskMeter level={p.risk} />
                  </div>
                  {p.visual}
                </div>

                {/* points */}
                <ul className="mt-5 space-y-2">
                  {p.points.map((pt) => (
                    <li key={pt} className="flex items-center gap-2.5 text-xs text-white/55">
                      <span className="h-1 w-1 rounded-full bg-brand-primary shadow-[0_0_6px_var(--color-brand-glow)]" />
                      {pt}
                    </li>
                  ))}
                </ul>

                {/* CTA pinned to bottom */}
                <Link
                  to={p.href}
                  className={`mt-7 flex items-center justify-between gap-1.5 rounded-xl px-4 py-3 text-[11px] font-bold uppercase tracking-[0.18em] transition-colors ${
                    p.featured
                      ? 'bg-brand-primary text-[#021511] hover:bg-brand-primary/90'
                      : 'border border-white/10 text-white/70 hover:border-brand-primary/30 hover:text-white'
                  }`}
                >
                  Explore
                  <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
                </Link>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
};

export default Products;
