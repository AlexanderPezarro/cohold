import type { OnboardingStepView } from '../../../contexts/OnboardingContext';

/**
 * Props every onboarding step form receives.
 *
 * A form does the step's work inline (creating a property, inviting a
 * co-owner...) and calls `onCompleted` when it succeeds. The page owns what
 * happens next: refreshing status and moving to the next step.
 */
export interface OnboardingStepFormProps {
  step: OnboardingStepView;
  onCompleted: () => void | Promise<void>;
}
