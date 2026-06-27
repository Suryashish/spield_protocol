import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowDown, Check, Loader2, FlaskConical, Rocket, Play, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BACKEND_URL } from '@/lib/config';

const ease = [0.16, 1, 0.3, 1] as const;

const Hero = () => {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openVideo, setOpenVideo] = useState(false);

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
      </motion.p>      {/* Status badges — testnet live vs mainnet coming */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.65, duration: 0.8, ease }}
        className="mb-8 flex flex-wrap items-center justify-center gap-2"
      >
        {/* Testnet: live now */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-primary/30 bg-brand-primary/10 px-3 py-1 text-[10px] font-semibold tracking-[0.14em] text-brand-primary">
          <FlaskConical size={11} />
          TESTNET — LIVE NOW
        </span>
        {/* Mainnet: waitlist */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold tracking-[0.14em] text-white/45">
          <Rocket size={11} />
          MAINNET — COMING SOON
        </span>
      </motion.div>

      {/* CTA block */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8, duration: 1, ease }}
        className="w-full max-w-md space-y-4"
      >
        {/* Buttons Row */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Primary: Try on testnet */}
          <Link to="/dashboard" className="flex-1">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-primary px-5 text-[11px] font-bold tracking-[0.2em] text-[#021511] shadow-[0_4px_16px_rgba(0,255,204,0.18)] hover:shadow-[0_6px_20px_rgba(0,255,204,0.28)] transition-shadow"
            >
              <FlaskConical size={13} />
              TRY TESTNET
            </motion.button>
          </Link>

          {/* Secondary: Play video walkthrough */}
          <motion.button
            onClick={() => setOpenVideo(true)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="flex-1 flex h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] px-5 text-[11px] font-bold tracking-[0.2em] text-white/80 hover:text-white transition-colors"
          >
            <Play size={13} className="text-brand-primary" />
            VIDEO GUIDE
          </motion.button>
        </div>

        {/* Divider with label */}
        <div className="flex items-center gap-3 text-[9px] text-white/20 uppercase tracking-widest">
          <div className="flex-1 h-px bg-white/[0.07]" />
          <span>Mainnet waitlist</span>
          <div className="flex-1 h-px bg-white/[0.07]" />
        </div>

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
                You're on the mainnet list — we'll notify you at launch.
              </span>
            </motion.div>
          ) : (
            <motion.form
              key="form"
              onSubmit={handleSubmit}
              initial={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="group flex flex-col items-stretch gap-1.5 liquid-glass rounded-xl p-1.5 transition-colors focus-within:border-brand-primary/40 sm:flex-row sm:items-center"
            >
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                aria-label="Email address for mainnet waitlist"
                className="w-full flex-1 bg-transparent px-3 py-2.5 text-sm text-white placeholder:text-white/50 outline-none"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={!valid || loading}
                className="flex w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-primary px-5 py-2.5 text-[11px] font-bold tracking-[0.16em] text-[#021511] transition-all duration-300 enabled:hover:bg-white/10 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
              >
                {loading ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <>
                    <Rocket size={11} />
                    NOTIFY ME
                  </>
                )}
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        {error && (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center text-xs text-red-400 font-medium"
          >
            {error}
          </motion.p>
        )}

        {/* Fine print */}
        <div className="mt-4 flex items-center justify-center gap-4 text-[10px] text-white/50">
          <span>Testnet uses test tokens — no real funds at risk.</span>
          <span>·</span>
          <a href="#how-it-works" className="hover:text-white/50 transition-colors">
            How it works →
          </a>
        </div>
      </motion.div>

      {/* Video Modal Overlay */}
      <AnimatePresence>
        {openVideo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
            onClick={() => setOpenVideo(false)}
          >
            {/* Modal Body */}
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="relative w-full max-w-4xl rounded-2xl border border-white/10 bg-zinc-950 p-2 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close Button */}
              <button
                onClick={() => setOpenVideo(false)}
                className="absolute -top-12 right-0 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-3.5 py-2 text-xs font-semibold text-white/70 hover:bg-black/60 hover:text-white transition-colors"
              >
                <X size={14} />
                Close
              </button>

              <div className="aspect-video w-full rounded-xl overflow-hidden bg-black">
                <iframe
                  width="100%"
                  height="100%"
                  src="https://www.youtube.com/embed/CPBsyChmcT4?autoplay=1"
                  title="Understanding Spield Protocol"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="w-full h-full"
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
