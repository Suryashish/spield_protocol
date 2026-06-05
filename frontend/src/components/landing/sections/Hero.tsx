import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowDown, ArrowRight, Check, Loader2 } from 'lucide-react';
import { BACKEND_URL } from '@/lib/config';

const ease = [0.16, 1, 0.3, 1] as const;

const Hero = () => {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || loading) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/waitlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to join waitlist');
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section id="top" className="relative flex flex-col items-center justify-center text-center px-4">
      {/* Background Ambience */}
      <div className="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl h-[500px] bg-brand-primary/5 rounded-full blur-[140px] -z-10" />

      {/* Main Title */}
      <motion.h1
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 1, ease }}
        className="text-5xl md:text-7xl lg:text-8xl font-normal mb-7 text-gradient tracking-tight font-display px-6 pb-2 leading-[1.05]"
      >
        The Fixed-Income
        <br className="hidden sm:block" />
        Layer for Stellar
      </motion.h1>

      {/* Subtitle */}
      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 1, ease }}
        className="max-w-2xl text-white/45 text-sm md:text-base font-light mb-10 leading-relaxed tracking-wide"
      >
        Split any Blend yield position into a fixed-rate{' '}
        <span className="text-white/75 font-medium">Principal Token</span> and a leveraged{' '}
        <span className="text-white/75 font-medium">Yield Token</span> — trade real, on-chain
        Stellar yield through a purpose-built time-decay AMM.
      </motion.p>

      {/* Waitlist */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7, duration: 1, ease }}
        className="w-full max-w-md"
      >
        <AnimatePresence mode="wait">
          {submitted ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center justify-center gap-3 liquid-glass rounded-xl px-6 py-4"
            >
              <span className="grid place-items-center w-6 h-6 rounded-full bg-brand-primary/20 text-brand-primary ring-1 ring-brand-primary/40">
                <Check size={13} strokeWidth={3} />
              </span>
              <span className="text-sm text-white/80">
                You’re on the list — we’ll be in touch.
              </span>
            </motion.div>
          ) : (
            <div className="space-y-3">
              <motion.form
                key="form"
                onSubmit={handleSubmit}
                initial={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="group flex items-center gap-1.5 liquid-glass rounded-xl p-1.5 focus-within:border-brand-primary/40 transition-colors"
              >
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  aria-label="Email address"
                  className="flex-1 bg-transparent px-4 py-2.5 text-sm text-white placeholder:text-white/35 outline-none"
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={!valid || loading}
                  className="flex shrink-0 items-center gap-2 rounded-lg bg-brand-primary px-5 py-2.5 text-[11px] font-bold tracking-[0.16em] text-[#021511] transition-all duration-300 enabled:hover:gap-2.5 disabled:opacity-40 disabled:cursor-not-allowed min-w-[140px] justify-center"
                >
                  {loading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <>
                      JOIN WAITLIST
                      <ArrowRight size={14} strokeWidth={2.5} />
                    </>
                  )}
                </button>
              </motion.form>
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xs text-red-400 font-medium"
                >
                  {error}
                </motion.p>
              )}
            </div>
          )}
        </AnimatePresence>

        {/* secondary link */}
        <div className="mt-4 flex items-center justify-center gap-4 text-[11px]">
          <span className="text-white/30">No spam. Early access at launch.</span>
          <a
            href="#how-it-works"
            className="font-semibold tracking-wide text-white/55 hover:text-white transition-colors"
          >
            How it works →
          </a>
        </div>
      </motion.div>

      {/* Scroll cue */}
      <motion.a
        href="#products"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4, duration: 1 }}
        className="absolute -bottom-28 sm:-bottom-36 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-white/30 hover:text-white/60 transition-colors"
      >
        <span className="text-[9px] tracking-[0.3em] uppercase">Scroll</span>
        <motion.span
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        >
          <ArrowDown size={14} />
        </motion.span>
      </motion.a>
    </section>
  );
};

export default Hero;
