import { useSeries } from '@/context/SeriesContext';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getTourSteps, type TourStep } from '@/components/dashboard/guide/tourSteps';

const STORAGE_KEY = 'spield_app_tour_completed_v2';

export interface TutorialContextValue {
  isTourActive: boolean;
  currentStepIndex: number;
  currentStep: TourStep;
  hasSeenTour: boolean;
  startTour: (stepIndex?: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (index: number) => void;
  skipTour: () => void;
  completeTour: () => void;
  restartTour: () => void;
  closeTour: () => void;
  totalSteps: number;
  // Aliases for header/modal compatibility
  isOpen: boolean;
  restartTutorial: () => void;
  openTutorial: (stepIndex?: number) => void;
  closeTutorial: () => void;
  skipTutorial: () => void;
  completeTutorial: () => void;
}

const TutorialContext = createContext<TutorialContextValue | undefined>(undefined);

export const TutorialProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeSeries } = useSeries();
  const navigate = useNavigate();
  const location = useLocation();

  const [isTourActive, setIsTourActive] = useState(false);
  const [currentStepId, setCurrentStepId] = useState('wallet');

  // Synchronous read of localStorage in state initializer
  const [hasSeenTour, setHasSeenTour] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined') {
        return localStorage.getItem(STORAGE_KEY) === 'true';
      }
    } catch {
      /* ignore storage error */
    }
    return true;
  });

  const steps = getTourSteps(activeSeries.source);
  const totalSteps = steps.length;
  // Keep the same highlighted control when the user switches source during the tour.
  const currentStepIndex = Math.max(0, steps.findIndex((step) => step.id === currentStepId));
  const currentStep = steps[currentStepIndex];

  // Mandatory first-time user tour: trigger after initial page render
  useEffect(() => {
    if (!hasSeenTour) {
      const timer = setTimeout(() => {
        setIsTourActive(true);
      }, 700);
      return () => clearTimeout(timer);
    }
  }, [hasSeenTour]);

  // When step changes, ensure the app navigates to the section route
  useEffect(() => {
    if (!isTourActive) return;
    const targetRoute = currentStep.route;
    const currentPath = location.pathname;
    if (currentPath !== targetRoute) {
      navigate(targetRoute);
    }
  }, [isTourActive, currentStep, location.pathname, navigate]);

  const startTour = useCallback(
    (stepIndex = 0) => {
      const validIndex = Math.max(0, Math.min(stepIndex, totalSteps - 1));
      setCurrentStepId(steps[validIndex].id);
      setIsTourActive(true);
    },
    [totalSteps, steps],
  );

  const closeTour = useCallback(() => {
    setIsTourActive(false);
  }, []);

  const skipTour = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      /* ignore */
    }
    setHasSeenTour(true);
    setIsTourActive(false);
  }, []);

  const completeTour = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      /* ignore */
    }
    setHasSeenTour(true);
    setIsTourActive(false);
  }, []);

  const restartTour = useCallback(() => {
    setCurrentStepId('wallet');
    setIsTourActive(true);
  }, []);

  const nextStep = useCallback(() => {
    if (currentStepIndex < totalSteps - 1) {
      setCurrentStepId(steps[currentStepIndex + 1].id);
    } else {
      completeTour();
    }
  }, [currentStepIndex, totalSteps, steps, completeTour]);

  const prevStep = useCallback(() => {
    if (currentStepIndex > 0) setCurrentStepId(steps[currentStepIndex - 1].id);
  }, [currentStepIndex, steps]);

  const goToStep = useCallback((index: number) => {
    if (index >= 0 && index < totalSteps) setCurrentStepId(steps[index].id);
  }, [totalSteps, steps]);

  return (
    <TutorialContext.Provider
      value={{
        isTourActive,
        currentStepIndex,
        currentStep,
        hasSeenTour,
        startTour,
        nextStep,
        prevStep,
        goToStep,
        skipTour,
        completeTour,
        restartTour,
        closeTour,
        totalSteps,
        // Compatibility aliases:
        isOpen: isTourActive,
        restartTutorial: restartTour,
        openTutorial: startTour,
        closeTutorial: closeTour,
        skipTutorial: skipTour,
        completeTutorial: completeTour,
      }}
    >
      {children}
    </TutorialContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useTutorial = (): TutorialContextValue => {
  const ctx = useContext(TutorialContext);
  if (!ctx) {
    throw new Error('useTutorial must be used within a <TutorialProvider>.');
  }
  return ctx;
};
