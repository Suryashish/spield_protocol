import { useSeries } from '@/context/SeriesContext';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { APP_TOUR_STEPS, type TourStep } from '@/components/dashboard/guide/tourSteps';

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
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

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

  const totalSteps = APP_TOUR_STEPS.length;
  const currentStep = APP_TOUR_STEPS[currentStepIndex] ?? APP_TOUR_STEPS[0];

  // Mandatory first-time user tour: trigger after initial page render
  useEffect(() => {
    if (!hasSeenTour && activeSeries.source === 'blend') {
      const timer = setTimeout(() => {
        setIsTourActive(true);
      }, 700);
      return () => clearTimeout(timer);
    }
  }, [hasSeenTour, activeSeries.source]);

  // When step changes, ensure the app navigates to the section route
  useEffect(() => {
    if (!isTourActive || activeSeries.source !== 'blend') return;
    const targetRoute = currentStep.route;
    const currentPath = location.pathname;
    if (currentPath !== targetRoute && !currentPath.startsWith(targetRoute)) {
      navigate(targetRoute);
    }
  }, [isTourActive, currentStep, location.pathname, navigate, activeSeries.source]);

  const startTour = useCallback(
    (stepIndex = 0) => {
      const validIndex = Math.max(0, Math.min(stepIndex, totalSteps - 1));
      setCurrentStepIndex(validIndex);
      const step = APP_TOUR_STEPS[validIndex];
      if (step && location.pathname !== step.route) {
        navigate(step.route);
      }
      setIsTourActive(true);
    },
    [totalSteps, location.pathname, navigate],
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
    setCurrentStepIndex(0);
    navigate(APP_TOUR_STEPS[0].route);
    setIsTourActive(true);
  }, [navigate]);

  const nextStep = useCallback(() => {
    setCurrentStepIndex((prev) => {
      if (prev < totalSteps - 1) {
        const nextIdx = prev + 1;
        const nextStepItem = APP_TOUR_STEPS[nextIdx];
        if (nextStepItem && location.pathname !== nextStepItem.route) {
          navigate(nextStepItem.route);
        }
        return nextIdx;
      }
      completeTour();
      return prev;
    });
  }, [totalSteps, location.pathname, navigate, completeTour]);

  const prevStep = useCallback(() => {
    setCurrentStepIndex((prev) => {
      if (prev > 0) {
        const prevIdx = prev - 1;
        const prevStepItem = APP_TOUR_STEPS[prevIdx];
        if (prevStepItem && location.pathname !== prevStepItem.route) {
          navigate(prevStepItem.route);
        }
        return prevIdx;
      }
      return prev;
    });
  }, [location.pathname, navigate]);

  const goToStep = useCallback(
    (index: number) => {
      if (index >= 0 && index < totalSteps) {
        setCurrentStepIndex(index);
        const step = APP_TOUR_STEPS[index];
        if (step && location.pathname !== step.route) {
          navigate(step.route);
        }
      }
    },
    [totalSteps, location.pathname, navigate],
  );

  return (
    <TutorialContext.Provider
      value={{
        isTourActive: isTourActive && activeSeries.source === 'blend',
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
        isOpen: isTourActive && activeSeries.source === 'blend',
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
