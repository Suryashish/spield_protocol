import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';

const Hero = () => {
  return (
    <div className="relative flex flex-col items-center justify-center text-center px-4">
      {/* Background Ambience */}
      <div className="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl h-[500px] bg-brand-primary/5 rounded-full blur-[140px] -z-10" />
      
      {/* Main Title */}
      <motion.h1 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 1, ease: [0.16, 1, 0.3, 1] }}
        className="text-5xl md:text-8xl lg:text-9xl font-normal mb-8 text-gradient tracking-tight font-display  px-12 pb-4 leading-[1.1]"
      >
        Spield Protocol
      </motion.h1>

      {/* Subtitle */}
      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 1, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-2xl text-white/40 text-sm md:text-lg font-light mb-10 leading-relaxed tracking-wide"
      >
        Your Gateway To Next-Gen Governance — Build And Steer DAOs With Powerful, Community-Driven Infrastructure.
      </motion.p>

      {/* CTA Button */}
      <motion.button
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7, duration: 1, ease: [0.16, 1, 0.3, 1] }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="group relative glass px-8 py-4 rounded-xl flex items-center gap-4 transition-all duration-500 hover:border-brand-primary/30 hover:bg-brand-primary/5 shadow-2xl"
      >
        <span className="text-[10px] font-bold tracking-[0.3em] text-white/90">LAUNCH APP</span>
        <div className="w-px h-4 bg-white/10 group-hover:bg-brand-primary/30 transition-colors" />
        <ChevronRight size={16} strokeWidth={2.5} className="text-white/40 group-hover:text-brand-primary transition-all duration-300 group-hover:translate-x-1" />
      </motion.button>
    </div>
  );
};

export default Hero;
