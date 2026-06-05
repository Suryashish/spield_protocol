import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

const ease = [0.16, 1, 0.3, 1] as const;

export const SectionHeading = ({
  eyebrow,
  title,
  subtitle,
  align = 'center',
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: string;
  align?: 'center' | 'left';
}) => (
  <div className={`max-w-2xl ${align === 'center' ? 'mx-auto text-center' : 'text-left'}`}>
    <motion.span
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.7, ease }}
      className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em] text-brand-primary/80"
    >
      <span className="h-1 w-1 rounded-full bg-brand-primary shadow-[0_0_8px_var(--color-brand-glow)]" />
      {eyebrow}
    </motion.span>
    <motion.h2
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.8, ease, delay: 0.05 }}
      className="mt-4 text-3xl md:text-5xl font-medium tracking-tight text-white leading-[1.1]"
    >
      {title}
    </motion.h2>
    {subtitle && (
      <motion.p
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.8, ease, delay: 0.1 }}
        className="mt-5 text-sm md:text-base font-light leading-relaxed text-white/45"
      >
        {subtitle}
      </motion.p>
    )}
  </div>
);

export const Reveal = ({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 24 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: '-60px' }}
    transition={{ duration: 0.7, ease, delay }}
    className={className}
  >
    {children}
  </motion.div>
);

/* Ambient light + minimal dot texture behind a section's content. Drop it as
   the first child of a relatively-positioned section/Section.
   NOTE: no overflow-hidden — the blurred glows must bleed past the section box
   so adjacent sections blend instead of showing a clipped seam at the edge. */
export const SectionGlow = ({
  position = 'top',
}: {
  position?: 'top' | 'center';
}) => (
  <div className="pointer-events-none absolute inset-0 -z-10">
    {/* minimal dot accent (self-masked to fade on all sides) */}
    <div
      className={`bg-dots absolute left-1/2 -translate-x-1/2 w-[80%] h-[55%] ${
        position === 'center' ? 'top-1/4' : 'top-1/4'
      }`}
    />
    {/* soft twin glows — extend beyond the section so they fade across borders */}
    <div
      className={`absolute left-1/4 -translate-x-1/2 w-[440px] h-[440px] rounded-full bg-brand-primary/[0.055] blur-[160px] ${
        position === 'center' ? 'top-1/3' : 'top-10'
      }`}
    />
    <div
      className={`absolute right-1/4 translate-x-1/2 w-[420px] h-[420px] rounded-full bg-brand-secondary/[0.045] blur-[160px] ${
        position === 'center' ? 'bottom-1/4' : 'bottom-10'
      }`}
    />
  </div>
);

export const Section = ({
  id,
  children,
  className = '',
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) => (
  <section id={id} className={`relative w-full px-5 sm:px-8 ${className}`}>
    <div className="mx-auto max-w-6xl">{children}</div>
  </section>
);
