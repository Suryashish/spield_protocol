import { motion } from 'framer-motion';
import { ShieldCheck, Layers, Activity, Zap, GitBranch, Repeat, Gauge } from 'lucide-react';

import { Reveal, Section, SectionHeading } from '@/components/ui/Section';

const ease = [0.16, 1, 0.3, 1] as const;

/* ============================ mini graphics ============================ */
/* Each graphic fills a fixed-height stage (h-44) and is centered, so every
   card lines up regardless of content. */

const Stage = ({ children }: { children: React.ReactNode }) => (
  <div className="relative h-44 w-full overflow-hidden rounded-xl border border-white/[0.06] bg-black/25">
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,rgba(0,255,204,0.07),transparent_60%)]" />
    <div className="relative grid h-full place-items-center p-4">{children}</div>
  </div>
);

// Solvency: two meter bars — backing clearly exceeds obligations, with surplus.
const SolvencyGraphic = () => {
  const rows = [
    { label: 'Backing', value: 1.0, display: '100%', tone: 'brand' as const },
    { label: 'Obligations', value: 0.82, display: '82%', tone: 'muted' as const },
  ];
  return (
    <div className="flex w-full max-w-115 flex-col gap-4">
      {rows.map((r, i) => (
        <div key={r.label}>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">
              {r.label}
            </span>
            <span
              className={`font-mono text-[11px] ${
                r.tone === 'brand' ? 'text-brand-primary' : 'text-white/45'
              }`}
            >
              {r.display}
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div
              initial={{ width: 0 }}
              whileInView={{ width: `${r.value * 100}%` }}
              viewport={{ once: true }}
              transition={{ duration: 1, delay: i * 0.15, ease }}
              className={`h-full rounded-full ${
                r.tone === 'brand'
                  ? 'bg-gradient-to-r from-brand-primary/50 to-brand-primary shadow-[0_0_12px_var(--color-brand-glow)]'
                  : 'bg-white/25'
              }`}
            />
          </div>
        </div>
      ))}
      <div className="flex items-center justify-center gap-2 pt-1">
        <span className="h-1 w-1 rounded-full bg-brand-primary shadow-[0_0_6px_var(--color-brand-glow)]" />
        <span className="text-[10px] tracking-wide text-white/50">
          <span className="font-semibold text-brand-primary">+18%</span> solvency surplus
        </span>
      </div>
    </div>
  );
};

// One position splitting into PT + YT. On hover the source nudges left and the
// two claims fan out, dramatising the "split".
const SplitGraphic = () => (
  <div className="flex items-center justify-center gap-3">
    <div className="grid place-items-center w-14 h-14 rounded-2xl border border-white/10 bg-white/[0.03] text-[10px] font-bold tracking-wider text-white/70 transition-transform duration-300 group-hover:-translate-x-0.5">
      USDC
    </div>
    <svg width="30" height="50" viewBox="0 0 30 50" fill="none" className="text-brand-primary/60 transition-colors duration-300 group-hover:text-brand-primary">
      <path d="M2 25h10M12 25l8-12M12 25l8 12M20 13h8M20 37h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
    <div className="flex flex-col gap-2">
      {['PT', 'YT'].map((t) => (
        <div
          key={t}
          className={`grid place-items-center w-12 h-9 rounded-xl text-[11px] font-bold transition-transform duration-300 ${
            t === 'YT'
              ? 'bg-brand-primary/15 text-brand-primary ring-1 ring-brand-primary/25 group-hover:translate-y-0.5'
              : 'bg-white/[0.05] text-white/80 ring-1 ring-white/10 group-hover:-translate-y-0.5'
          }`}
        >
          {t}
        </div>
      ))}
    </div>
  </div>
);

// Time-decay AMM: a properly-framed chart. Fixed plot box (L/R/T/B margins)
// keeps axes, gridlines, curves and labels aligned within one rectangle.
const CurveGraphic = () => {
  // viewBox 260 x 150; plot area inset by these margins
  const L = 34, R = 18, T = 14, B = 30;
  const x0 = L, x1 = 260 - R; // 34 → 242
  const yTop = T, yBot = 150 - B; // 14 → 120
  const yPar = yTop + 4; // 1.0 line just under top
  return (
    <div className="relative h-full w-full">
      <svg viewBox="0 0 260 150" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        {/* y axis + x axis */}
        <line x1={x0} y1={yTop} x2={x0} y2={yBot} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        <line x1={x0} y1={yBot} x2={x1} y2={yBot} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />

        {/* par (1.0) gridline */}
        <line x1={x0} y1={yPar} x2={x1} y2={yPar} stroke="rgba(255,255,255,0.12)" strokeDasharray="3 4" strokeWidth="1" />

        {/* y ticks */}
        <text x={x0 - 6} y={yPar + 3} textAnchor="end" fill="rgba(255,255,255,0.45)" fontSize="9" fontFamily="monospace">1.0</text>
        <text x={x0 - 6} y={yBot + 3} textAnchor="end" fill="rgba(255,255,255,0.45)" fontSize="9" fontFamily="monospace">0</text>

        {/* PT: discount → par (ends at top-right) */}
        <motion.path
          d={`M${x0},96 C110,92 175,55 ${x1},${yPar}`}
          fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2.2" strokeLinecap="round"
          initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }}
          transition={{ duration: 1.1, ease }}
        />
        {/* YT: value → 0 (ends at bottom-right) */}
        <motion.path
          d={`M${x0},42 C110,58 175,108 ${x1},${yBot}`}
          fill="none" stroke="#00ffcc" strokeWidth="2.2" strokeLinecap="round"
          initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }}
          transition={{ duration: 1.1, delay: 0.12, ease }}
        />

        {/* endpoint dots */}
        <circle cx={x1} cy={yPar} r="2.8" fill="#fff" />
        <circle cx={x1} cy={yBot} r="2.8" fill="#00ffcc" />

        {/* x ticks aligned to plot bottom */}
        <text x={x0} y={yBot + 16} textAnchor="start" fill="rgba(255,255,255,0.45)" fontSize="9">today</text>
        <text x={x1} y={yBot + 16} textAnchor="end" fill="rgba(255,255,255,0.45)" fontSize="9">maturity</text>
      </svg>

      {/* legend — top-left corner. PT starts low (y=96) and YT crosses down to
          the right, so the upper-left is the one region clear of both curves,
          the PT endpoint (top-right) and the "maturity" tick (bottom-right). */}
      <div className="absolute left-11 top-1 flex flex-col gap-1 text-[9px]">
        <span className="flex items-center gap-1.5 text-white/70"><span className="h-[2px] w-4 rounded bg-white/80" />PT price</span>
        <span className="flex items-center gap-1.5 text-brand-primary"><span className="h-[2px] w-4 rounded bg-brand-primary" />YT price</span>
      </div>
    </div>
  );
};

// Stellar-native: central node, orbit ring, zero bridges badge. On hover the
// whole orbit (rings + satellite dots) rotates and the core node pulses up.
const NativeGraphic = () => (
  <div className="relative grid h-full w-full place-items-center">
    {/* rings + dots share one wrapper so they rotate as a rigid system */}
    <div className="stage-orbit absolute inset-0 grid place-items-center">
      <div className="absolute h-28 w-28 rounded-full border border-white/[0.08]" />
      <div className="absolute h-20 w-20 rounded-full border border-white/[0.06]" />
      {[0, 120, 240].map((deg) => (
        <span
          key={deg}
          className="absolute h-2 w-2 rounded-full bg-brand-primary/70 shadow-[0_0_8px_var(--color-brand-glow)]"
          style={{ transform: `rotate(${deg}deg) translateX(56px)` }}
        />
      ))}
    </div>
    <div className="stage-node relative grid place-items-center h-12 w-12 rounded-full bg-brand-primary/15 ring-1 ring-brand-primary/30 text-brand-primary">
      <Zap size={18} />
    </div>
    <span className="absolute bottom-1 inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-2.5 py-1 text-[9px] font-semibold text-white/55 ring-1 ring-white/10">
      <GitBranch size={10} className="text-brand-primary/70" /> 0 bridges
    </span>
  </div>
);

// Per-position accounting: stacked position rows, each carrying its own index.
const PositionsGraphic = () => (
  <div className="flex w-full max-w-[180px] flex-col gap-2">
    {[
      { id: '#012', idx: '1.041' },
      { id: '#013', idx: '1.038' },
      { id: '#014', idx: '1.052' },
    ].map((p, i) => (
      <motion.div
        key={p.id}
        initial={{ opacity: 0, x: -12 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: i * 0.1, ease }}
      >
        <div
          className="stage-row flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
          style={{ transitionDelay: `${i * 40}ms` }}
        >
          <span className="text-[10px] font-bold tracking-wider text-white/70">{p.id}</span>
          <span className="font-mono text-[10px] text-brand-primary">idx {p.idx}</span>
        </div>
      </motion.div>
    ))}
  </div>
);

// Risk gauge: a ring filling to the reserve %.
const RiskGraphic = () => {
  const pct = 0.86;
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-full w-full place-items-center">
      <svg width="128" height="128" viewBox="0 0 120 120" className="-rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
        <motion.circle
          cx="60" cy="60" r={r} fill="none" stroke="#00ffcc" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }} whileInView={{ strokeDashoffset: c * (1 - pct) }}
          viewport={{ once: true }} transition={{ duration: 1.2, ease }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-2xl font-semibold text-white tabular-nums">86%</div>
        <div className="text-[9px] uppercase tracking-[0.16em] text-white/35">reserve</div>
      </div>
    </div>
  );
};

/* ============================ card config ============================ */

const CARDS = [
  // row 1 — wide(2) + square(1) + square(1)
  {
    icon: ShieldCheck,
    title: 'Solvent by construction',
    caption: 'Real backing grows above obligations, with no invented index.',
    graphic: <SolvencyGraphic />,
    span: 'lg:col-span-2',
  },
  {
    icon: Layers,
    title: 'PT / YT stripping',
    caption: 'One position splits into two tradable claims.',
    graphic: <SplitGraphic />,
  },
  {
    icon: Activity,
    title: 'Risk-first design',
    caption: 'A reserve buffer and circuit breaker, on-chain.',
    graphic: <RiskGraphic />,
  },
  // row 2 — square(1) + wide(2) + square(1)
  {
    icon: Repeat,
    title: 'Per-position accounting',
    caption: 'Every deposit keeps its own index, so no yield is lost.',
    graphic: <PositionsGraphic />,
  },
  {
    icon: Gauge,
    title: 'Time-decay AMM',
    caption: 'PT rises to par as YT decays to zero by maturity.',
    graphic: <CurveGraphic />,
    span: 'lg:col-span-2',
  },
  {
    icon: Zap,
    title: 'Stellar-native only',
    caption: 'No bridge, no relayer, settled on one chain.',
    graphic: <NativeGraphic />,
  },
];

const Card = ({ card, delay }: { card: (typeof CARDS)[number]; delay: number }) => (
  <Reveal delay={delay} className={`${card.span ?? ''} h-full`}>
    <div className="feature-card group relative flex h-full flex-col overflow-hidden rounded-2xl liquid-glass p-5">
      {/* cursor-tracking sheen — a soft brand highlight that fades in on hover */}
      <span className="feature-card__sheen pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      <Stage>{card.graphic}</Stage>
      <div className="relative mt-5 flex items-center gap-3">
        <div className="feature-chip grid place-items-center w-9 h-9 shrink-0 rounded-lg text-brand-primary">
          <card.icon size={16} strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white leading-tight transition-colors duration-300 group-hover:text-white">{card.title}</h3>
          <p className="mt-0.5 text-xs leading-snug text-white/55 transition-colors duration-300 group-hover:text-white/70">{card.caption}</p>
        </div>
      </div>
    </div>
  </Reveal>
);

const Features = () => {
  return (
    <Section id="features" className="py-24 md:py-32">
      <SectionHeading
        eyebrow="Why Spield"
        title={<>Fixed income, engineered right</>}
        subtitle="Every choice answers a real failure mode. Solvency, accounting, and trust: shown, not just stated."
      />

      {/* 2-row bento: row 1 = wide solvency + 2 squares · row 2 = 1 square + wide AMM */}
      <div className="mt-16 grid grid-cols-1 lg:grid-cols-4 auto-rows-fr gap-4">
        {CARDS.map((c, i) => (
          <Card key={c.title} card={c} delay={i * 0.06} />
        ))}
      </div>
    </Section>
  );
};

export default Features;
