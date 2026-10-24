import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Check,
  Sparkles,
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

  // When step changes, retry locating element until DOM mounts and scroll into view smoothly
  useEffect(() => {
    if (!isTourActive) return;

    let attempts = 0;
    const maxAttempts = 24;

    const findTarget = () => {
      const found = updateRect();
      if (!found && attempts < maxAttempts) {
        attempts++;
        retryRef.current = window.setTimeout(findTarget, 80);
      } else if (found) {
        const el = document.querySelector(currentStep.targetSelector) as HTMLElement | null;
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(updateRect, 300);
        }
      }
    };

    const timer = window.setTimeout(findTarget, 40);

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

  // Keyboard controls
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

  // Compute smart, minimal placement
  const getCardPosition = () => {
    const isMobile = windowSize.width < 768;

    if (isMobile || !targetRect) {
      return {
        position: 'fixed' as const,
        bottom: '4.5rem',
        left: '0.85rem',
        right: '0.85rem',
        zIndex: 80,
      };
    }

    const cardWidth = 370;
    const cardHeight = 260;
    const gap = 14;

    // Prefer below target
    if (targetRect.bottom + cardHeight + gap < windowSize.height) {
      const idealLeft = Math.max(
        16,
        Math.min(targetRect.left, windowSize.width - cardWidth - 16),
      );
      return {
        position: 'fixed' as const,
        top: targetRect.bottom + gap,
        left: idealLeft,
        width: cardWidth,
        zIndex: 80,
      };
    }

    // Place above target if bottom is constrained
    if (targetRect.top - cardHeight - gap > 60) {
      const idealLeft = Math.max(
        16,
        Math.min(targetRect.left, windowSize.width - cardWidth - 16),
      );
      return {
        position: 'fixed' as const,
        bottom: windowSize.height - targetRect.top + gap,
        left: idealLeft,
        width: cardWidth,
        zIndex: 80,
      };
    }

    // Place to the right
    if (targetRect.right + cardWidth + gap < windowSize.width) {
      return {
        position: 'fixed' as const,
        top: Math.max(70, Math.min(targetRect.top, windowSize.height - cardHeight - 16)),
        left: targetRect.right + gap,
        width: cardWidth,
        zIndex: 80,
      };
    }

    // Fallback bottom-right
    return {
      position: 'fixed' as const,
      bottom: '1.5rem',
      right: '1.5rem',
      width: cardWidth,
      zIndex: 80,
    };
  };

  const cardPosition = getCardPosition();
  const paddingBox = 8;

  return createPortal(
    <div className="fixed inset-0 z-[75] pointer-events-auto">
      {/* 1. Fluid, seamless SVG spotlight mask */}
      <svg
        className="fixed inset-0 h-full w-full pointer-events-none transition-all duration-300 ease-out"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <mask id="app-tour-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left - paddingBox}
                y={targetRect.top - paddingBox}
                width={targetRect.width + paddingBox * 2}
                height={targetRect.height + paddingBox * 2}
                rx="14"
                ry="14"
                fill="black"
              />
            )}
          </mask>
        </defs>

        <rect
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.55)"
          mask="url(#app-tour-spotlight-mask)"
        />
      </svg>

      {/* 2. Soft, minimal glowing highlight ring on the active element */}
      {targetRect && (
        <div
          style={{
            position: 'fixed',
            top: targetRect.top - paddingBox,
            left: targetRect.left - paddingBox,
            width: targetRect.width + paddingBox * 2,
            height: targetRect.height + paddingBox * 2,
          }}
          className="pointer-events-none z-[76] rounded-2xl border border-brand/50 shadow-[0_0_24px_rgba(34,197,94,0.25)] animate-pulse transition-all duration-200"
        />
      )}

      {/* 3. Minimal, uncluttered floating card */}
      <div style={cardPosition}>
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep.id}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="panel relative overflow-hidden rounded-2xl border border-border/80 bg-card/95 p-4 shadow-lift backdrop-blur-xl sm:p-4.5"
          >
            {/* Header: step tag, section label, and quick skip */}
            <div className="flex items-center justify-between gap-2 border-b border-border/70 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="mono rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10.5px] font-bold text-brand-text">
                  {currentStep.stepNumber}
                </span>
                <span className="text-[12px] font-medium text-muted-foreground">
                  {currentStep.sectionName}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={skipTour}
                  className="rounded px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={skipTour}
                  aria-label="Close tour"
                  className="grid size-6 place-items-center rounded-md text-subtle transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Content: crisp title, 1-sentence hook, and 2 minimal actions */}
            <div className="space-y-2.5 pt-2.5">
              <div>
                <h4 className="font-display text-[15px] font-bold tracking-tight text-foreground sm:text-[16px]">
                  {currentStep.title}
                </h4>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  {currentStep.summary}
                </p>
              </div>

              {/* Minimal 2-step action strip */}
              <div className="space-y-1.5 rounded-xl border border-border/70 bg-sunken/50 p-2.5">
                {currentStep.actions.map((act, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-[11.5px] leading-snug text-foreground">
                    <span className="grid size-4 shrink-0 place-items-center rounded-full bg-brand/15 text-[10px] font-bold text-brand-text">
                      {idx + 1}
                    </span>
                    <span>{act}</span>
                  </div>
                ))}
              </div>

              {/* Single micro-highlight takeaway */}
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-brand-text">
                <Sparkles size={12} className="shrink-0" />
                <span className="truncate">{currentStep.highlight}</span>
              </div>
            </div>

            {/* Footer controls: progress dots and Back/Next */}
            <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-2.5">
              {/* Step indicator dots */}
              <div className="flex items-center gap-1">
                {Array.from({ length: totalSteps }).map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => goToStep(idx)}
                    title={`Step ${idx + 1}`}
                    className={cn(
                      'size-1.5 rounded-full transition-all duration-200',
                      idx === currentStepIndex
                        ? 'w-3.5 bg-brand'
                        : idx < currentStepIndex
                          ? 'bg-brand/40 hover:bg-brand/70'
                          : 'bg-border hover:bg-muted-foreground',
                    )}
                  />
                ))}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={prevStep}
                  disabled={isFirstStep}
                  className="h-7 gap-1 px-2.5 text-[11.5px]"
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
                    className="h-7 gap-1 px-3 text-[11.5px] font-semibold"
                  >
                    <span>Done</span>
                    <Check size={12} />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={nextStep}
                    className="h-7 gap-1 px-3 text-[11.5px] font-semibold"
                  >
                    <span>Next</span>
                    <ChevronRight size={12} />
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>,
    document.body,
  );
};

export default InteractiveAppTour;
