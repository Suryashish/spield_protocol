import { motion } from 'framer-motion';
import {
  ShieldCheck,
  Link2,
  Lock,
  Layers,
  ExternalLink,
  KeyRound,
  FileCheck2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Reveal, Section, SectionGlow, SectionHeading } from '@/components/ui/Section';
import { PROTOCOL_FACTS } from '@/content/facts';

const ease = [0.16, 1, 0.3, 1] as const;

/**
 * Honest, visually-rich trust section. Every claim renders from PROTOCOL_FACTS
 * (the single source of truth also behind /api/stats.json and the protocol-facts
 * page). No invented TVL / user counts / audit badges — Spield is on testnet and
 * facts.ts keeps live metrics null on purpose ("never publish invented numbers").
 * We lead with what IS true and verifiable: the on-chain solvency invariant, the
 * enforceable guarantees, and links to inspect every contract on-chain.
 */

/* ---------------------------------------------------------------------------
   Centerpiece visual: the solvency invariant.
   Backing (real Blend position) is ALWAYS ≥ issued (PT + YT value). This is the
   literal "math" the section promises — animate the two bars converging to show
   backing covering issued with a safety margin, ratio ≥ 1.00.
--------------------------------------------------------------------------- */
const SolvencyVisual = () => (
  <div className="relative flex h-full flex-col justify-center overflow-hidden rounded-3xl liquid-glass p-7 md:p-9">
    {/* soft brand glow */}
    <div className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-brand-primary/10 blur-[120px]" />

    <div className="relative flex items-center justify-between gap-3">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-brand-primary/80">
          Solvency invariant
        </div>
        <div className="mt-1 text-sm text-white/50">Enforced on every mint &amp; redeem</div>
      </div>
      <div className="text-right">
        <div className="font-display text-4xl leading-none text-gradient-brand">≥ 1.00</div>
        <div className="text-[9px] uppercase tracking-[0.16em] text-white/35">backing ÷ issued</div>
      </div>
    </div>

    {/* two-bar comparison: backing vs issued */}
    <div className="relative mt-8 space-y-5">
      {/* backing bar (full + a touch more → the safety margin) */}
      <div>
        <div className="mb-2 flex items-center justify-between text-[11px]">
          <span className="text-white/70">Real backing</span>
          <span className="font-mono text-brand-primary">Blend position</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <motion.div
            initial={{ width: '0%' }}
            whileInView={{ width: '100%' }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 1.1, ease }}
            className="h-full rounded-full bg-gradient-to-r from-brand-primary/50 to-brand-primary"
          />
        </div>
      </div>

      {/* issued bar (slightly shorter → invariant keeps a margin) */}
      <div>
        <div className="mb-2 flex items-center justify-between text-[11px]">
          <span className="text-white/70">Issued value</span>
          <span className="font-mono text-white/50">PT + YT</span>
        </div>
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <motion.div
            initial={{ width: '0%' }}
            whileInView={{ width: '92%' }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 1.1, delay: 0.15, ease }}
            className="h-full rounded-full bg-gradient-to-r from-white/25 to-white/55"
          />
        </div>
      </div>

      {/* the guaranteed margin annotation */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 1, ease }}
        className="flex items-center justify-end gap-2 text-[10px] text-white/40"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-brand-primary" />
        Backing can never fall below issued — enforced in code, not by promise.
      </motion.div>
    </div>
  </div>
);

/* Per-guarantee mini-visual so each card carries a mark, not just a sentence. */
const GuaranteeMark = ({ kind }: { kind: 'no-bridge' | 'real-yield' | 'invariant' | 'redeem' | 'custody' }) => {
  switch (kind) {
    case 'no-bridge':
      // Stellar-only: a single closed loop, no external chain hop.
      return (
        <svg viewBox="0 0 60 24" className="h-6 w-16">
          <motion.circle
            cx="12" cy="12" r="6" fill="none" stroke="#00ffcc" strokeWidth="2"
            initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }}
            transition={{ duration: 0.8, ease }}
          />
          <motion.path
            d="M18 12 H42" stroke="rgba(255,255,255,.25)" strokeWidth="2" strokeDasharray="3 4"
            initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.3, ease }}
          />
          <line x1="46" y1="7" x2="54" y2="17" stroke="rgba(255,120,120,.7)" strokeWidth="2" strokeLinecap="round" />
          <line x1="54" y1="7" x2="46" y2="17" stroke="rgba(255,120,120,.7)" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'real-yield':
      // Rising bToken rate line — real accrual.
      return (
        <svg viewBox="0 0 60 24" className="h-6 w-16" preserveAspectRatio="none">
          <motion.path
            d="M2,20 C16,20 20,8 34,7 C46,6 52,4 58,3" fill="none" stroke="#00ffcc"
            strokeWidth="2" strokeLinecap="round"
            initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }}
            transition={{ duration: 1, ease }}
          />
        </svg>
      );
    case 'invariant':
      // ≥ symbol filling in.
      return <div className="font-display text-xl leading-none text-gradient-brand">≥ 1</div>;
    case 'redeem':
      // 1:1 par.
      return <div className="font-mono text-sm text-brand-primary">1 : 1</div>;
    case 'custody':
      // Key mark.
      return <KeyRound size={18} className="text-brand-primary" strokeWidth={2} />;
    default:
      return null;
  }
};

// Map each guarantee sentence (from facts.ts, in order) to an icon + mark.
const GUARANTEE_META: { icon: LucideIcon; mark: Parameters<typeof GuaranteeMark>[0]['kind'] }[] = [
  { icon: Link2, mark: 'no-bridge' },
  { icon: Layers, mark: 'real-yield' },
  { icon: ShieldCheck, mark: 'invariant' },
  { icon: FileCheck2, mark: 'redeem' },
  { icon: Lock, mark: 'custody' },
];

const Trust = () => {
  const f = PROTOCOL_FACTS;
  const isTestnet = f.network === 'testnet';

  return (
    <Section id="trust" className="py-24 md:py-32">
      <SectionGlow position="center" />

      <SectionHeading
        eyebrow="Verifiable by design"
        title={
          <>
            Trust the math,
            <br className="hidden sm:block" /> not a promise
          </>
        }
        subtitle="No invented index, no bridged assets. Every guarantee below is enforced in the smart contracts and verifiable on-chain — read it yourself, don't take our word."
      />

      {/* status + ecosystem chips */}
      <Reveal className="mt-10 flex flex-wrap items-center justify-center gap-2.5" delay={0.05}>
        <span className="inline-flex items-center gap-2 rounded-full liquid-chip px-3.5 py-1.5 text-[11px] font-semibold text-white/80">
          <span className={`h-1.5 w-1.5 rounded-full ${isTestnet ? 'bg-amber-400' : 'bg-brand-primary'} animate-pulse`} />
          Live on {f.networkLabel}
        </span>
        {['Yield: Blend Capital', 'Non-custodial', 'No bridge'].map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-2 rounded-full liquid-chip px-3.5 py-1.5 text-[11px] font-semibold text-white/80"
          >
            {t}
          </span>
        ))}
      </Reveal>

      {/* main grid: centerpiece invariant visual (left, full height) +
          an even 2×2 grid of the four primary guarantees (right). The two
          columns are height-matched via items-stretch + h-full so the block
          reads as one organized unit with no ragged gaps. */}
      <div className="mt-14 grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        {/* centerpiece — the math (stretches to match the card grid height) */}
        <Reveal className="h-full" delay={0.05}>
          <SolvencyVisual />
        </Reveal>

        {/* four primary guarantees in a uniform 2×2 grid; every card is h-full
            so both rows align regardless of text length */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {f.guarantees.slice(0, 4).map((g, i) => {
            const meta = GUARANTEE_META[i] ?? GUARANTEE_META[2];
            const Icon = meta.icon;
            return (
              <motion.div
                key={g}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.55, ease, delay: 0.04 * i }}
                className="group relative flex h-full flex-col gap-5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.015] p-5 transition-colors hover:border-white/20"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-primary/10 text-brand-primary ring-1 ring-brand-primary/25">
                    <Icon size={16} strokeWidth={2} />
                  </span>
                  <div className="grid h-6 place-items-center">
                    <GuaranteeMark kind={meta.mark} />
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-white/70">{g}</p>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* bottom strip: the fifth guarantee (non-custodial) + the verify-on-chain
          CTA as an even 2-up, closing the block symmetrically */}
      <div className="mt-4 grid grid-cols-1 items-stretch gap-4 md:grid-cols-2">
        {f.guarantees.slice(4).map((g) => {
          const meta = GUARANTEE_META[4] ?? GUARANTEE_META[2];
          const Icon = meta.icon;
          return (
            <motion.div
              key={g}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.55, ease, delay: 0.04 }}
              className="group relative flex h-full items-center gap-4 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.015] p-5 transition-colors hover:border-white/20"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-primary/10 text-brand-primary ring-1 ring-brand-primary/25">
                <Icon size={17} strokeWidth={2} />
              </span>
              <p className="text-sm leading-relaxed text-white/70">{g}</p>
              <span className="ml-auto shrink-0">
                <GuaranteeMark kind={meta.mark} />
              </span>
            </motion.div>
          );
        })}

        {/* verify-on-chain CTA */}
        <motion.a
          href={f.explorer}
          target="_blank"
          rel="noopener noreferrer"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.55, ease, delay: 0.08 }}
          className="group relative flex h-full items-center gap-4 overflow-hidden rounded-2xl liquid-glass p-5 transition-transform hover:-translate-y-1"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-primary/15 text-brand-primary ring-1 ring-brand-primary/30">
            <ExternalLink size={17} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Inspect every contract</p>
            <p className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.16em] text-white/50 transition-colors group-hover:text-brand-primary">
              VERIFY ON-CHAIN
              <ExternalLink size={12} strokeWidth={2.5} className="transition-transform group-hover:translate-x-0.5" />
            </p>
          </div>
          <span className="ml-auto shrink-0 font-display text-3xl leading-none text-gradient-brand">
            {f.contracts.length}
          </span>
        </motion.a>
      </div>

      {/* footnote: honest links to the receipts */}
      <Reveal className="mt-6 text-center text-xs text-white/35" delay={0.1}>
        No live TVL yet — this is a testnet deployment. See the full{' '}
        <a href="/learn/spield-protocol-facts" className="text-brand-primary/70 underline-offset-2 hover:text-brand-primary hover:underline">
          protocol facts
        </a>{' '}
        or the{' '}
        <a href="/api/stats.json" className="text-brand-primary/70 underline-offset-2 hover:text-brand-primary hover:underline">
          machine-readable stats
        </a>.
      </Reveal>
    </Section>
  );
};

export default Trust;
