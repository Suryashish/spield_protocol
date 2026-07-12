import { useEffect, useRef, useState } from 'react';
import {
  motion,
  useReducedMotion,
  useInView,
  useMotionValue,
  useSpring,
  animate,
  type HTMLMotionProps,
} from 'framer-motion';

/**
 * Shared landing-page motion primitives. Every one honors prefers-reduced-motion:
 * when the user asks their OS to reduce motion, these degrade to a calm, static
 * (or instantly-final) render. Kept small and dependency-free so any section can
 * reuse them for a consistent feel.
 */

const spring = { type: 'spring', stiffness: 320, damping: 26, mass: 0.6 } as const;

/* ---------------------------------------------------------------------------
   CountUp — animates a number from 0 → target once it scrolls into view.
   Falls back to the final value immediately under reduced-motion.
--------------------------------------------------------------------------- */
export function CountUp({
  value,
  decimals = 0,
  duration = 1.8,
  prefix = '',
  suffix = '',
  className = '',
}: {
  value: number;
  decimals?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setDisplay(value);
      return;
    }
    const controls = animate(0, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [inView, value, duration, reduce]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {display.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Magnetic — the child gently follows the cursor within `strength` px, then
   springs back on leave. Great for primary CTAs. Static under reduced-motion.
--------------------------------------------------------------------------- */
export function Magnetic({
  children,
  strength = 14,
  className = '',
}: {
  children: React.ReactNode;
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const x = useSpring(useMotionValue(0), spring);
  const y = useSpring(useMotionValue(0), spring);

  if (reduce) return <div className={className}>{children}</div>;

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const py = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    x.set(px * strength);
    y.set(py * strength);
  };
  const reset = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={{ x, y }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ---------------------------------------------------------------------------
   SpringCard — a hover-lift wrapper with a real spring (not a CSS ease) so the
   card feels tactile. Under reduced-motion it renders a plain div.
--------------------------------------------------------------------------- */
export function SpringCard({
  children,
  className = '',
  lift = 6,
  ...rest
}: { lift?: number; children?: React.ReactNode } & Omit<HTMLMotionProps<'div'>, 'children'>) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      whileHover={{ y: -lift }}
      transition={spring}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
