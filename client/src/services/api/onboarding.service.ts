import { api } from '../api';
import type { OnboardingStatus, OnboardingStepId } from '../../../../shared/onboarding/steps';

interface OnboardingResponse {
  success: boolean;
  onboarding: OnboardingStatus;
}

/**
 * Every endpoint returns the full recomputed status, so callers can replace
 * their state with whatever comes back rather than re-fetching.
 */
export const onboardingService = {
  async getStatus(): Promise<OnboardingStatus> {
    const response = await api.get<OnboardingResponse>('/onboarding');
    return response.data.onboarding;
  },

  async skipStep(stepId: OnboardingStepId): Promise<OnboardingStatus> {
    const response = await api.post<OnboardingResponse>(`/onboarding/steps/${stepId}/skip`);
    return response.data.onboarding;
  },

  async unskipStep(stepId: OnboardingStepId): Promise<OnboardingStatus> {
    const response = await api.delete<OnboardingResponse>(`/onboarding/steps/${stepId}/skip`);
    return response.data.onboarding;
  },

  /** Only valid for steps the registry marks `manual`. */
  async completeStep(stepId: OnboardingStepId): Promise<OnboardingStatus> {
    const response = await api.post<OnboardingResponse>(`/onboarding/steps/${stepId}/complete`);
    return response.data.onboarding;
  },

  async dismiss(): Promise<OnboardingStatus> {
    const response = await api.post<OnboardingResponse>('/onboarding/dismiss');
    return response.data.onboarding;
  },

  async restart(): Promise<OnboardingStatus> {
    const response = await api.post<OnboardingResponse>('/onboarding/restart');
    return response.data.onboarding;
  },
};
