import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Check,
  Wallet,
  LayoutDashboard,
  Lock,
  Coins,
  TrendingUp,
  Sparkles,
  Droplets,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

import { useTutorial } from '@/context/TutorialContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

interface CardCoords {
  x: number;
  y: number;
}

const STEP_ICONS: Record<string, LucideIcon> = {
  wallet: Wallet,
  'overview-stats': LayoutDashboard,
  'vault-panel': Lock,
  'deposit-panel': Coins,
  'markets-panel': TrendingUp,
  'yield-panel': Sparkles,
  'liquidity-panel': Droplets,
  'solvency-panel': ShieldCheck,
};

const computeCardCoords = (
  target: TargetRect | null,
  winW: number,
  winH: number,
  isMobile: boolean,
): CardCoords => {
  const cardW = isMobile ? Math.min(360, winW - 24) : 360;
  const cardH = 175;
  const gap = 14;

  const minX = 14;
  const maxX = winW - cardW - 14;
  const minY = 68; // Below sticky header
  const maxY = winH - cardH - 16;

  if (!target) {
    return {
      x: isMobile ? (winW - cardW) / 2 : maxX,
      y: isMobile ? winH - cardH - 80 : maxY,
    };
  }

  if (isMobile) {
    // On mobile, if element is in the upper half of screen, place below it
    if (target.bottom + cardH + gap < winH - 60) {
      return {
        x: Math.max(minX, Math.min((winW - cardW) / 2, maxX)),
        y: target.bottom + gap,
      };
    }
    // Else place above it if room
    if (target.top - cardH - gap > minY) {
      return {
        x: Math.max(minX, Math.min((winW - cardW) / 2, maxX)),
        y: target.top - cardH - gap,
      };
    }
    // Fallback bottom
    return {
      x: Math.max(minX, Math.min((winW - cardW) / 2, maxX)),
      y: winH - cardH - 80,
    };
  }

  // Desktop intelligent positioning right beside the highlighted section:

  // 1. If target is in the top bar or a wide top banner (e.g. Wallet button, or Stats grid):
  if (target.top < 150 && target.bottom + cardH + gap < maxY) {
    let x = target.left;
    if (target.right > winW - cardW) {
      x = target.right - cardW;
    }
    return {
      x: Math.max(minX, Math.min(x, maxX)),
      y: target.bottom + gap,
    };
  }

  // 2. Can we place directly to the RIGHT of the target element?
  // (Ideal for Vault panel, Deposit panel, Liquidity panel)
  if (target.right + cardW + gap <= maxX + cardW) {
    const y = Math.max(minY, Math.min(target.top, maxY));
    return {
      x: Math.max(minX, Math.min(target.right + gap, maxX)),
      y,
    };
  }

  // 3. Can we place directly to the LEFT of the target element?
  // (Ideal for Markets trade panel on the right side of the screen)
  if (target.left - cardW - gap >= minX) {
    const y = Math.max(minY, Math.min(target.top, maxY));
    return {
      x: target.left - cardW - gap,
      y,
    };
  }

  // 4. Place BELOW the target if vertical space allows
  if (target.bottom + cardH + gap <= maxY) {
    let x = target.left;
    if (x + cardW > maxX) x = maxX;
    return {
      x: Math.max(minX, Math.min(x, maxX)),
      y: target.bottom + gap,
    };
  }

  // 5. Place ABOVE the target if vertical space allows
  if (target.top - cardH - gap >= minY) {
    let x = target.left;
    if (x + cardW > maxX) x = maxX;
    return {
      x: Math.max(minX, Math.min(x, maxX)),
      y: target.top - cardH - gap,
    };
  }

  // Fallback: clamp inside viewport
  return {
    x: Math.max(minX, Math.min(target.left, maxX)),
    y: Math.max(minY, Math.min(target.bottom + gap, maxY)),
  };
};

export const InteractiveAppTour: React.FC = () => {
  const {
    isTourActive,
    currentStepIndex,
    currentStep,
    nextStep,
    prevStep,
    goToStep,
    skipTour,
    completeTour,
    totalSteps,
  } = useTutorial();

  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });
  const retryRef = useRef<number | null>(null);

  const isLastStep = currentStepIndex === totalSteps - 1;
  const isFirstStep = currentStepIndex === 0;

  // Track window dimensions
  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Synchronously compute card coordinates based on target element and viewport
  const cardCoords = useMemo(() => {
    const isMobile = windowSize.width < 768;
    return computeCardCoords(targetRect, windowSize.width, windowSize.height, isMobile);
  }, [targetRect, windowSize]);

  // Measure target DOM element
  const updateRect = useCallback(() => {
    if (!isTourActive || !currentStep) {
      setTargetRect(null);
      return false;
    }

    const element = document.querySelector(currentStep.targetSelector) as HTMLElement | null;
    if (element) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setTargetRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          bottom: rect.bottom,
          right: rect.right,
        });
        return true;
      }
    }
    return false;
  }, [isTourActive, currentStep]);

  // When step changes, retry locating element until DOM mounts and scroll gently if out of view
  useEffect(() => {
    if (!isTourActive) return;

    let attempts = 0;
    const maxAttempts = 25;

    const findTarget = () => {
      const found = updateRect();
      if (!found && attempts < maxAttempts) {
        attempts++;
        retryRef.current = window.setTimeout(findTarget, 60);
      } else if (found) {
        const el = document.querySelector(currentStep.targetSelector) as HTMLElement | null;
        if (el) {
          const rect = el.getBoundingClientRect();
          // Only scroll if the element is not already comfortably visible to avoid jarring jumps
          const inView = rect.top >= 60 && rect.bottom <= window.innerHeight - 60;
          if (!inView) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(updateRect, 300);
          }
        }
      }
    };

    const timer = window.setTimeout(findTarget, 30);

    return () => {
      clearTimeout(timer);
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [isTourActive, currentStepIndex, currentStep, updateRect]);

  // Keep target rect synced during scroll and resize
  useEffect(() => {
    if (!isTourActive) return;

    const handleSync = () => {
      updateRect();
    };

    window.addEventListener('scroll', handleSync, true);
    window.addEventListener('resize', handleSync);
    return () => {
      window.removeEventListener('scroll', handleSync, true);
      window.removeEventListener('resize', handleSync);
    };
  }, [isTourActive, updateRect]);

  // Keyboard navigation
  useEffect(() => {
    if (!isTourActive) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        skipTour();
      } else if (e.key === 'ArrowRight') {
        if (!isLastStep) nextStep();
      } else if (e.key === 'ArrowLeft') {
        if (!isFirstStep) prevStep();
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isTourActive, isLastStep, isFirstStep, nextStep, prevStep, skipTour]);

  if (!isTourActive) return null;

  const paddingBox = 8;
  const isMobile = windowSize.width < 768;
  const cardWidth = isMobile ? Math.min(360, windowSize.width - 24) : 360;
  const IconComponent = STEP_ICONS[currentStep.id] || Sparkles;

  return createPortal(
    <div className="fixed inset-0 z-[75] pointer-events-auto">
      {/* 1. Fluid, smooth SVG spotlight mask with spring animation */}
      <svg
        className="fixed inset-0 h-full w-full pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <mask id="app-tour-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            <motion.rect
              initial={false}
              animate={{
                x: targetRect ? targetRect.left - paddingBox : windowSize.width / 2,
                y: targetRect ? targetRect.top - paddingBox : windowSize.height / 2,
                width: targetRect ? targetRect.width + paddingBox * 2 : 0,
                height: targetRect ? targetRect.height + paddingBox * 2 : 0,
                opacity: targetRect ? 1 : 0,
              }}
              transition={{
                type: 'spring',
                stiffness: 280,
                damping: 30,
                mass: 0.8,
              }}
              rx="16"
              ry="16"
              fill="black"
            />
          </mask>
        </defs>

        <rect
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.55)"
          mask="url(#app-tour-spotlight-mask)"
        />
      </svg>

      {/* 2. Fluid glowing highlight ring smoothly morphing and tracking the element */}
      <motion.div
        initial={false}
        animate={{
          x: targetRect ? targetRect.left - paddingBox : windowSize.width / 2,
          y: targetRect ? targetRect.top - paddingBox : windowSize.height / 2,
          width: targetRect ? targetRect.width + paddingBox * 2 : 0,
          height: targetRect ? targetRect.height + paddingBox * 2 : 0,
          opacity: targetRect ? 1 : 0,
        }}
        transition={{
          type: 'spring',
          stiffness: 280,
          damping: 30,
          mass: 0.8,
        }}
        className="pointer-events-none fixed top-0 left-0 z-[76] rounded-2xl border border-brand/50 shadow-[0_0_24px_rgba(34,197,94,0.25)]"
      />

      {/* 3. Redesigned, elevated glassmorphic tour card */}
      <motion.div
        initial={false}
        animate={{
          x: cardCoords.x,
          y: cardCoords.y,
          opacity: targetRect ? 1 : 0.6,
        }}
        transition={{
          type: 'spring',
          stiffness: 300,
          damping: 28,
          mass: 0.8,
        }}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: cardWidth,
          zIndex: 80,
        }}
      >
        <div className="panel relative overflow-hidden rounded-2xl border border-border/80 bg-card/95 p-4.5 shadow-lift backdrop-blur-2xl before:pointer-events-none before:absolute before:-right-12 before:-top-12 before:size-28 before:rounded-full before:bg-brand/10 before:blur-2xl after:pointer-events-none after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-brand/40 after:to-transparent">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 font-mono text-[10.5px] font-semibold text-brand-text">
                <span className="size-1.5 rounded-full bg-brand shadow-[0_0_6px_var(--brand)]" />
                {currentStep.stepNumber}
              </span>
              <span className="text-[12px] font-semibold tracking-wide text-foreground">
                {currentStep.sectionName}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={skipTour}
                className="rounded-full px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={skipTour}
                aria-label="Close tour"
                className="grid size-6 place-items-center rounded-full text-subtle transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Body: icon well + title + tag + description */}
          <div className="py-3">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                className="flex items-start gap-3"
              >
                {/* Visual Icon Well */}
                <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-brand/25 bg-brand/10 text-brand-text shadow-sm">
                  <IconComponent size={17} />
                </div>

                {/* Text Block */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <h4 className="font-display text-[15.5px] font-bold tracking-tight text-foreground">
                      {currentStep.title}
                    </h4>
                    <span className="inline-flex shrink-0 items-center rounded-full border border-border/70 bg-sunken/80 px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                      {currentStep.tag}
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                    {currentStep.text}
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Footer: Segmented Story Progress Bars + Action Buttons */}
          <div className="flex items-center justify-between border-t border-border/60 pt-3">
            {/* Segmented Progress Bars */}
            <div className="flex max-w-[120px] flex-1 items-center gap-1">
              {Array.from({ length: totalSteps }).map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => goToStep(idx)}
                  title={`Step ${idx + 1}`}
                  className={cn(
                    'h-1 flex-1 rounded-full transition-all duration-300',
                    idx === currentStepIndex
                      ? 'bg-brand shadow-[0_0_8px_var(--brand)]'
                      : idx < currentStepIndex
                        ? 'bg-brand/50 hover:bg-brand/70'
                        : 'bg-border/70 hover:bg-muted-foreground/40',
                  )}
                />
              ))}
            </div>

            {/* Navigation Buttons */}
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={prevStep}
                disabled={isFirstStep}
                className="h-7.5 gap-1 rounded-full border-border/80 bg-card/60 px-2.5 text-[11px] font-medium transition-all hover:bg-accent/60 disabled:opacity-30"
              >
                <ChevronLeft size={12} />
                <span>Back</span>
              </Button>

              {isLastStep ? (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={completeTour}
                  className="h-7.5 gap-1 rounded-full bg-brand px-3 text-[11px] font-semibold text-brand-contrast shadow-float transition-all hover:brightness-105 active:scale-95"
                >
                  <span>Finish</span>
                  <Check size={12} />
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={nextStep}
                  className="h-7.5 gap-1 rounded-full bg-brand px-3 text-[11px] font-semibold text-brand-contrast shadow-float transition-all hover:brightness-105 active:scale-95"
                >
                  <span>Next</span>
                  <ChevronRight size={12} />
                </Button>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
};

export default InteractiveAppTour;
