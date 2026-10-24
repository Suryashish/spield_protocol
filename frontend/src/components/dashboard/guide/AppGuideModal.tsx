import React, { useEffect, useCallback } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Check,
  ExternalLink,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTutorial } from '@/context/TutorialContext';
import { GUIDE_SECTIONS } from './guideData';
import GuideSectionGraphic from './GuideSectionGraphic';
import BrandMark from '../layout/BrandMark';

export const AppGuideModal: React.FC = () => {
  const {
    isOpen,
    currentStepIndex,
    closeTutorial,
    skipTutorial,
    completeTutorial,
    nextStep,
    prevStep,
    goToStep,
    totalSteps,
  } = useTutorial();

  const navigate = useNavigate();
  const currentSection = GUIDE_SECTIONS[currentStepIndex] ?? GUIDE_SECTIONS[0];
  const isLastStep = currentStepIndex === totalSteps - 1;
  const isFirstStep = currentStepIndex === 0;

  // Keyboard navigation: ArrowLeft/ArrowRight to move between sections
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'ArrowRight') {
        if (!isLastStep) nextStep();
      } else if (e.key === 'ArrowLeft') {
        if (!isFirstStep) prevStep();
      }
    },
    [isOpen, isLastStep, isFirstStep, nextStep, prevStep],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleOpenSectionInApp = () => {
    navigate(currentSection.route);
    closeTutorial();
  };

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => (!open ? closeTutorial() : null)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />

        <DialogPrimitive.Content
          aria-describedby="app-guide-description"
          className="app-shell panel fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card p-0 shadow-lift duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {/* Top chrome / Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-border bg-canvas/60 px-5 py-3.5 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <BrandMark size={20} />
                <span className="font-display text-[15px] font-bold tracking-tight text-foreground sm:text-[16px]">
                  Spield Interactive Guide
                </span>
              </div>
              <span className="hidden rounded-full border border-brand/30 bg-brand/10 px-2.5 py-0.5 text-[11px] font-medium text-brand-text sm:inline-flex">
                Section {currentStepIndex + 1} of {totalSteps}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={skipTutorial}
                className="rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Skip tutorial
              </button>
              <DialogPrimitive.Close
                aria-label="Close guide"
                onClick={closeTutorial}
                className="grid size-8 place-items-center rounded-lg text-subtle transition-colors hover:bg-accent hover:text-foreground"
              >
                <X size={16} />
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Section tabs bar */}
          <div className="no-scrollbar flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-sunken/40 px-4 py-2 sm:px-6">
            {GUIDE_SECTIONS.map((sec, idx) => {
              const Icon = sec.icon;
              const isActive = idx === currentStepIndex;
              const isPast = idx < currentStepIndex;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => goToStep(idx)}
                  className={cn(
                    'group relative flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200',
                    isActive
                      ? 'border border-brand/40 bg-brand/15 text-brand-text shadow-sm'
                      : isPast
                        ? 'border border-border/80 bg-card/60 text-foreground hover:bg-accent'
                        : 'border border-transparent bg-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  {isPast ? (
                    <Check size={12} className="text-brand-text" />
                  ) : (
                    <Icon size={12} className={cn(isActive ? 'text-brand-text' : 'text-subtle')} />
                  )}
                  <span>{sec.shortLabel}</span>
                  {isActive && (
                    <motion.span
                      layoutId="active-guide-tab"
                      className="absolute inset-0 -z-10 rounded-full border border-brand/30"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Scrollable Main content area with Framer Motion slide */}
          <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentSection.id}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12"
              >
                {/* Column 1: Animated Graphic & Quick Highlights */}
                <div className="space-y-4 lg:col-span-6">
                  <GuideSectionGraphic type={currentSection.graphicType} />

                  {/* Highlights strip */}
                  <div className="grid grid-cols-3 gap-2">
                    {currentSection.highlights.map((h) => (
                      <div
                        key={h.label}
                        className="rounded-lg border border-border bg-card p-2 text-center shadow-sm"
                      >
                        <div className="text-[10px] text-muted-foreground">{h.label}</div>
                        <div className="mono mt-0.5 text-[11.5px] font-semibold text-foreground">
                          {h.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Column 2: Explanation & Step-by-Step Instructions */}
                <div className="space-y-4 lg:col-span-6">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-0.5 text-[11px] font-medium text-brand-text">
                        {currentSection.badge}
                      </span>
                    </div>
                    <h3 className="mt-2 font-display text-[22px] font-bold tracking-tight text-foreground sm:text-[24px]">
                      {currentSection.title}
                    </h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                      {currentSection.subtitle}
                    </p>
                  </div>

                  {/* What it does / Concept */}
                  <div className="rounded-xl border border-border/80 bg-sunken/40 p-3 text-[12.5px] leading-relaxed text-foreground">
                    <p id="app-guide-description">{currentSection.concept}</p>
                  </div>

                  {/* Step-by-Step Tutorial Guide */}
                  <div>
                    <div className="eyebrow mb-2 text-muted-foreground">How to use this section</div>
                    <div className="space-y-2">
                      {currentSection.steps.map((st) => (
                        <div
                          key={st.number}
                          className="flex items-start gap-3 rounded-lg border border-border bg-card p-2.5 text-left transition-colors hover:border-brand/30"
                        >
                          <div className="grid size-6 shrink-0 place-items-center rounded-full bg-brand/10 text-[11.5px] font-bold text-brand-text">
                            {st.number}
                          </div>
                          <div className="min-w-0">
                            <h5 className="font-display text-[13px] font-semibold text-foreground">
                              {st.title}
                            </h5>
                            <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                              {st.description}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Pro Tip */}
                  <div className="flex items-start gap-2.5 rounded-xl border border-brand/25 bg-brand/8 p-3 text-xs">
                    <Sparkles size={15} className="mt-0.5 shrink-0 text-brand-text" />
                    <div className="min-w-0">
                      <span className="font-semibold text-foreground">Pro Tip: </span>
                      <span className="leading-relaxed text-muted-foreground">
                        {currentSection.proTip}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Footer Controls */}
          <div className="flex shrink-0 items-center justify-between border-t border-border bg-canvas/60 px-5 py-3.5 backdrop-blur-md">
            {/* Quick jump to page */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpenSectionInApp}
              className="gap-1.5 text-xs font-medium"
            >
              <span>Explore {currentSection.shortLabel}</span>
              <ExternalLink size={12} className="text-muted-foreground" />
            </Button>

            {/* Pagination Controls */}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={prevStep}
                disabled={isFirstStep}
                className="gap-1 text-xs"
              >
                <ChevronLeft size={14} />
                <span>Previous</span>
              </Button>

              {isLastStep ? (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={completeTutorial}
                  className="gap-1.5 text-xs font-semibold"
                >
                  <span>Finish Tutorial</span>
                  <Check size={14} />
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={nextStep}
                  className="gap-1 text-xs font-semibold"
                >
                  <span>Next Section</span>
                  <ChevronRight size={14} />
                </Button>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default AppGuideModal;
