import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  OnboardingStatus,
  OnboardingStepId,
  OnboardingStepView,
} from '../../../shared/onboarding/steps';
import { onboardingService } from '../services/api/onboarding.service';
import { useAuth } from './AuthContext';

/**
 * Note the type-only imports from `shared/`: the step registry never becomes a
 * runtime dependency of the client. The server sends whole step definitions in
 * the status payload, so the UI renders the registry it is talking to.
 */
export type { OnboardingStepView };

interface OnboardingContextValue {
  status: OnboardingStatus | null;
  /** Steps in registry order, already filtered to those that apply to this user. */
  steps: OnboardingStepView[];
  loading: boolean;
  /** Re-reads status from the server and returns it. Call after creating data elsewhere. */
  refresh: () => Promise<OnboardingStatus | null>;
  skipStep: (id: OnboardingStepId) => Promise<void>;
  unskipStep: (id: OnboardingStepId) => Promise<void>;
  completeStep: (id: OnboardingStepId) => Promise<void>;
  dismiss: () => Promise<void>;
  restart: () => Promise<void>;
}

const OnboardingContext = createContext<OnboardingContextValue | undefined>(undefined);

export const useOnboarding = () => {
  const context = useContext(OnboardingContext);
  if (context === undefined) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
};

interface OnboardingProviderProps {
  children: React.ReactNode;
}

export const OnboardingProvider: React.FC<OnboardingProviderProps> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<OnboardingStatus | null> => {
    if (!isAuthenticated) {
      setStatus(null);
      setLoading(false);
      return null;
    }
    try {
      const next = await onboardingService.getStatus();
      setStatus(next);
      return next;
    } catch (error) {
      // The checklist is an aid, not a blocker - a failure here shouldn't stop
      // the user reaching the app, so log it and carry on without one.
      console.error('Error loading onboarding status:', error);
      setStatus(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Each mutation returns the recomputed status, so we just swap it in. */
  const runAction = useCallback(async (action: () => Promise<OnboardingStatus>) => {
    const next = await action();
    setStatus(next);
  }, []);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      status,
      steps: status?.steps ?? [],
      loading,
      refresh,
      skipStep: (id) => runAction(() => onboardingService.skipStep(id)),
      unskipStep: (id) => runAction(() => onboardingService.unskipStep(id)),
      completeStep: (id) => runAction(() => onboardingService.completeStep(id)),
      dismiss: () => runAction(() => onboardingService.dismiss()),
      restart: () => runAction(() => onboardingService.restart()),
    }),
    [status, loading, refresh, runAction]
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
};
