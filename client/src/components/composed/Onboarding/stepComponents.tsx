import React from 'react';
import type { OnboardingStepId } from '../../../../../shared/onboarding/steps';
import type { OnboardingStepFormProps } from './types';
import { CoOwnerStepForm } from './CoOwnerStepForm';
import { PropertyStepForm } from './PropertyStepForm';
import { TenantStepForm } from './TenantStepForm';
import { LeaseStepForm } from './LeaseStepForm';
import { LinkStepForm } from './LinkStepForm';

/**
 * Steps that can be completed without leaving the onboarding page.
 *
 * This map is deliberately partial: anything not listed falls back to
 * `LinkStepForm`, which points the user at the feature's own page. So adding a
 * step to `shared/onboarding/steps.ts` needs no change here unless you want to
 * pull its form inline.
 */
const STEP_FORMS: Partial<Record<OnboardingStepId, React.ComponentType<OnboardingStepFormProps>>> = {
  'co-owners': CoOwnerStepForm,
  property: PropertyStepForm,
  tenant: TenantStepForm,
  lease: LeaseStepForm,
};

export function getStepForm(id: OnboardingStepId): React.ComponentType<OnboardingStepFormProps> {
  return STEP_FORMS[id] ?? LinkStepForm;
}

/** True when the step is done inline rather than on another page. */
export function hasInlineForm(id: OnboardingStepId): boolean {
  return id in STEP_FORMS;
}
