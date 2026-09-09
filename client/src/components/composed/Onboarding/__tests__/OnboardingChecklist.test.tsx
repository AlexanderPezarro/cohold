import { TextEncoder, TextDecoder } from 'util';

if (typeof globalThis.TextEncoder === 'undefined') {
  // react-router-dom expects these Node globals, which jsdom does not provide.
  (globalThis as any).TextEncoder = TextEncoder;
  (globalThis as any).TextDecoder = TextDecoder;
}

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingChecklist } from '../OnboardingChecklist';
import { useOnboarding } from '../../../../contexts/OnboardingContext';
import type {
  OnboardingStatus,
  OnboardingStepId,
  OnboardingStepStatus,
  OnboardingStepView,
} from '../../../../../../shared/onboarding/steps';

jest.mock('../../../../contexts/OnboardingContext', () => ({
  useOnboarding: jest.fn(),
}));

const mockUseOnboarding = useOnboarding as jest.Mock;
const dismiss = jest.fn();

/** Fixtures shaped like the API payload; see the page test for why. */
function step(
  id: OnboardingStepId,
  title: string,
  extra: Partial<OnboardingStepView> = {}
): OnboardingStepView {
  return {
    id,
    section: 'essentials',
    title,
    description: `Description for ${title}`,
    icon: 'home',
    ctaLabel: title,
    route: `/${id}`,
    dependsOn: [],
    optional: false,
    skippable: true,
    adminOnly: false,
    requiresWrite: true,
    manual: false,
    status: 'todo' as OnboardingStepStatus,
    blockedBy: [],
    ...extra,
  };
}

const STEPS: OnboardingStepView[] = [
  step('property', 'Add your first property'),
  step('tenant', 'Add a tenant'),
  step('lease', 'Create a lease', {
    status: 'locked',
    dependsOn: ['property', 'tenant'],
    blockedBy: ['property', 'tenant'],
  }),
  step('event', 'Schedule a reminder', { section: 'enhancements', optional: true }),
];

const ESSENTIALS = STEPS.filter((s) => !s.optional);

function buildStatus(partial: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return {
    steps: STEPS,
    sections: [{ id: 'essentials', title: 'Core setup', description: 'The essentials.' }],
    completedCount: 0,
    totalCount: ESSENTIALS.length,
    isComplete: false,
    dismissed: false,
    nextStepId: 'property',
    shouldRedirect: false,
    ...partial,
  };
}

function setStatus(status: OnboardingStatus | null, loading = false) {
  mockUseOnboarding.mockReturnValue({
    status,
    steps: status?.steps ?? [],
    loading,
    refresh: jest.fn(),
    skipStep: jest.fn(),
    unskipStep: jest.fn(),
    completeStep: jest.fn(),
    dismiss,
    restart: jest.fn(),
  });
}

const renderChecklist = () =>
  render(
    <MemoryRouter>
      <OnboardingChecklist />
    </MemoryRouter>
  );

describe('OnboardingChecklist', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dismiss.mockResolvedValue(undefined);
  });

  it('lists the essential steps and leaves out the optional extras', () => {
    setStatus(buildStatus());
    renderChecklist();

    ESSENTIALS.forEach((s) => {
      expect(screen.getByText(s.title)).toBeInTheDocument();
    });
    expect(screen.queryByText('Schedule a reminder')).not.toBeInTheDocument();
  });

  it('reports progress', () => {
    setStatus(buildStatus({ completedCount: 2 }));
    renderChecklist();

    expect(screen.getByText(`2 of ${ESSENTIALS.length} done`)).toBeInTheDocument();
  });

  it('renders nothing while loading', () => {
    setStatus(null, true);
    const { container } = renderChecklist();

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing once setup is complete', () => {
    setStatus(buildStatus({ isComplete: true, completedCount: ESSENTIALS.length }));
    const { container } = renderChecklist();

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing once dismissed', () => {
    setStatus(buildStatus({ dismissed: true }));
    const { container } = renderChecklist();

    expect(container).toBeEmptyDOMElement();
  });

  it('hides itself on request', async () => {
    const user = userEvent.setup();
    setStatus(buildStatus());
    renderChecklist();

    await user.click(screen.getByRole('button', { name: 'Hide this' }));

    await waitFor(() => expect(dismiss).toHaveBeenCalled());
  });

  it('disables steps that are still blocked', () => {
    setStatus(buildStatus());
    renderChecklist();

    expect(screen.getByRole('button', { name: /Create a lease/ })).toBeDisabled();
  });
});
