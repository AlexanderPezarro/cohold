import { TextEncoder, TextDecoder } from 'util';

if (typeof globalThis.TextEncoder === 'undefined') {
  // react-router-dom expects these Node globals, which jsdom does not provide.
  (globalThis as any).TextEncoder = TextEncoder;
  (globalThis as any).TextDecoder = TextDecoder;
}

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Onboarding } from '../Onboarding';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { useProperties } from '../../contexts/PropertiesContext';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { propertiesService } from '../../services/api/properties.service';
import { tenantsService } from '../../services/api/tenants.service';
import { usersService } from '../../services/api/users.service';
import { addressLookupService } from '../../services/api/addressLookup.service';
import type {
  OnboardingStatus,
  OnboardingStepId,
  OnboardingStepStatus,
  OnboardingStepView,
} from '../../../../shared/onboarding/steps';

jest.mock('../../contexts/OnboardingContext', () => ({
  useOnboarding: jest.fn(),
}));

jest.mock('../../contexts/PropertiesContext', () => ({
  useProperties: jest.fn(),
}));

jest.mock('../../contexts/ToastContext', () => ({
  useToast: jest.fn(),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../services/api/properties.service', () => ({
  propertiesService: { createProperty: jest.fn() },
}));

jest.mock('../../services/api/tenants.service', () => ({
  tenantsService: { createTenant: jest.fn(), getTenants: jest.fn() },
}));

jest.mock('../../services/api/leases.service', () => ({
  leasesService: { createLease: jest.fn() },
}));

jest.mock('../../services/api/users.service', () => ({
  usersService: { getUsers: jest.fn(), createUser: jest.fn(), inviteUser: jest.fn() },
}));

jest.mock('../../services/api/addressLookup.service', () => ({
  addressLookupService: { lookup: jest.fn() },
}));

const mockUseOnboarding = useOnboarding as jest.Mock;
const mockUseProperties = useProperties as jest.Mock;
const mockUseToast = useToast as jest.Mock;
const mockUseAuth = useAuth as jest.Mock;
const mockCreateProperty = propertiesService.createProperty as jest.Mock;
const mockGetTenants = tenantsService.getTenants as jest.Mock;
const mockGetUsers = usersService.getUsers as jest.Mock;
const mockInviteUser = usersService.inviteUser as jest.Mock;
const mockLookup = addressLookupService.lookup as jest.Mock;
let toast: { success: jest.Mock; error: jest.Mock; info: jest.Mock };

/**
 * Step definitions as the API sends them.
 *
 * Fixtures rather than the real registry on purpose: the page's job is to
 * render whatever the server describes, and the registry's own invariants are
 * covered by `shared/onboarding/__tests__/steps.test.ts`.
 */
interface StepSeed {
  id: OnboardingStepId;
  title: string;
  section: 'essentials' | 'enhancements';
  route: string;
  ctaLabel: string;
  optional?: boolean;
  skippable?: boolean;
  dependsOn?: OnboardingStepId[];
}

const SEEDS: StepSeed[] = [
  {
    id: 'co-owners',
    title: 'Invite your co-owners',
    section: 'essentials',
    route: '/users',
    ctaLabel: 'Invite a co-owner',
  },
  {
    id: 'property',
    title: 'Add your first property',
    section: 'essentials',
    skippable: false,
    route: '/properties',
    ctaLabel: 'Add a property',
  },
  {
    id: 'tenant',
    title: 'Add a tenant',
    section: 'essentials',
    route: '/tenants',
    ctaLabel: 'Add a tenant',
  },
  {
    id: 'lease',
    title: 'Create a lease',
    section: 'essentials',
    dependsOn: ['property', 'tenant'],
    route: '/leases',
    ctaLabel: 'Create a lease',
  },
  {
    id: 'event',
    title: 'Schedule a reminder',
    section: 'enhancements',
    optional: true,
    dependsOn: ['property'],
    route: '/events',
    ctaLabel: 'Add an event',
  },
];

const ESSENTIAL_COUNT = SEEDS.filter((seed) => !seed.optional).length;

function buildStatus(
  statuses: Partial<Record<OnboardingStepId, OnboardingStepStatus>> = {},
  details: Partial<Record<OnboardingStepId, string>> = {}
): OnboardingStatus {
  const steps: OnboardingStepView[] = SEEDS.map((seed) => {
    const dependsOn = seed.dependsOn ?? [];
    const blockedBy = dependsOn.filter((id) => statuses[id] !== 'complete');
    const status = statuses[seed.id] ?? (blockedBy.length > 0 ? 'locked' : 'todo');

    return {
      id: seed.id,
      section: seed.section,
      title: seed.title,
      description: `Description for ${seed.title}`,
      icon: 'home',
      ctaLabel: seed.ctaLabel,
      route: seed.route,
      dependsOn,
      optional: seed.optional ?? false,
      skippable: seed.skippable ?? true,
      adminOnly: false,
      requiresWrite: true,
      manual: false,
      status,
      detail: details[seed.id],
      blockedBy: status === 'locked' ? blockedBy : [],
    };
  });

  const completedCount = steps.filter(
    (step) => !step.optional && (step.status === 'complete' || step.status === 'skipped')
  ).length;

  return {
    steps,
    sections: [
      { id: 'essentials', title: 'Core setup', description: 'The essentials.' },
      { id: 'enhancements', title: 'Optional extras', description: 'Nice to have.' },
    ],
    completedCount,
    totalCount: ESSENTIAL_COUNT,
    isComplete: completedCount === ESSENTIAL_COUNT,
    dismissed: false,
    nextStepId: steps.find((step) => step.status === 'todo')?.id ?? null,
    shouldRedirect: false,
  };
}

const actions = {
  refresh: jest.fn(),
  skipStep: jest.fn(),
  unskipStep: jest.fn(),
  completeStep: jest.fn(),
  dismiss: jest.fn(),
  restart: jest.fn(),
};

function setOnboarding(status: OnboardingStatus | null, loading = false) {
  mockUseOnboarding.mockReturnValue({
    status,
    steps: status?.steps ?? [],
    loading,
    ...actions,
  });
}

/** Exposes the router's current query string, which is how the page tracks
 *  the selected step. */
let currentSearch = '';
const LocationSpy = () => {
  currentSearch = useLocation().search;
  return null;
};
const mockGetSearch = () => currentSearch;

function renderPage(initialEntry = '/onboarding') {
  currentSearch = '';
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Onboarding />
      <LocationSpy />
    </MemoryRouter>
  );
}

describe('Onboarding page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    actions.refresh.mockResolvedValue(buildStatus());
    actions.skipStep.mockResolvedValue(undefined);
    actions.unskipStep.mockResolvedValue(undefined);
    actions.dismiss.mockResolvedValue(undefined);
    mockUseProperties.mockReturnValue({ properties: [], loading: false, refetch: jest.fn() });
    toast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
    mockUseToast.mockReturnValue(toast);
    mockUseAuth.mockReturnValue({ user: { id: 'me', email: 'me@example.com', role: 'ADMIN' } });
    mockGetTenants.mockResolvedValue([]);
    mockGetUsers.mockResolvedValue([]);
  });

  it('renders every step the server sent, grouped into its sections', () => {
    setOnboarding(buildStatus());
    renderPage();

    SEEDS.forEach((seed) => {
      expect(screen.getAllByText(seed.title).length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Core setup')).toBeInTheDocument();
    expect(screen.getByText('Optional extras')).toBeInTheDocument();
  });

  it('shows progress against the essential steps', () => {
    setOnboarding(buildStatus({ property: 'complete' }, { property: '1 property' }));
    renderPage();

    expect(screen.getByText(`1 of ${ESSENTIAL_COUNT} core steps done`)).toBeInTheDocument();
  });

  it('opens the first outstanding step and renders its inline form', () => {
    setOnboarding(buildStatus());
    renderPage();

    // co-owners comes first, so its form is what we land on.
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('invites a co-owner by email and moves on once the email has gone', async () => {
    const user = userEvent.setup();
    mockInviteUser.mockResolvedValue({ user: { id: 'u2' }, emailSent: true });
    setOnboarding(buildStatus());
    renderPage('/onboarding?step=co-owners');

    await user.type(screen.getByLabelText('Email'), 'co@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    await waitFor(() => expect(mockInviteUser).toHaveBeenCalledWith('co@example.com', 'LANDLORD'));
    expect(toast.success).toHaveBeenCalledWith('Invite sent to co@example.com');
    await waitFor(() => expect(actions.refresh).toHaveBeenCalled());
  });

  it('shows the invite link to copy when the email could not be sent', async () => {
    const user = userEvent.setup();
    mockInviteUser.mockResolvedValue({
      user: { id: 'u2' },
      emailSent: false,
      inviteUrl: 'http://localhost:5173/reset-password?token=abc&invite=1',
    });
    setOnboarding(buildStatus());
    renderPage('/onboarding?step=co-owners');

    await user.type(screen.getByLabelText('Email'), 'co@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(
      await screen.findByText('http://localhost:5173/reset-password?token=abc&invite=1')
    ).toBeInTheDocument();
    // Staying put keeps the link on screen.
    expect(actions.refresh).not.toHaveBeenCalled();
  });

  it('fills the address from a postcode lookup', async () => {
    const user = userEvent.setup();
    mockLookup.mockResolvedValue({
      postcode: 'GU1 1AA',
      city: 'Guildford',
      county: 'Surrey',
      addressesAvailable: true,
      addresses: [
        { label: '1 High Street, Guildford', street: '1 High Street', city: 'Guildford' },
        { label: '2 High Street, Guildford', street: '2 High Street', city: 'Guildford' },
      ],
    });
    setOnboarding(buildStatus());
    renderPage('/onboarding?step=property');

    await user.type(screen.getByLabelText('Postcode'), 'gu11aa');
    await user.click(screen.getByRole('button', { name: 'Find address' }));

    await waitFor(() => expect(mockLookup).toHaveBeenCalledWith('gu11aa'));
    expect(screen.getByLabelText('Postcode')).toHaveValue('GU1 1AA');
    expect(screen.getByLabelText('City')).toHaveValue('Guildford');
    expect(screen.getByLabelText('County')).toHaveValue('Surrey');

    await user.selectOptions(screen.getByLabelText('Address'), '2 High Street, Guildford');
    expect(screen.getByLabelText('Street')).toHaveValue('2 High Street');
    expect(screen.getByLabelText('Property name')).toHaveValue('2 High Street');
  });

  it('shows the lookup error against the postcode', async () => {
    const user = userEvent.setup();
    mockLookup.mockRejectedValue(new Error('network'));
    setOnboarding(buildStatus());
    renderPage('/onboarding?step=property');

    await user.type(screen.getByLabelText('Postcode'), 'GU1 1AA{Enter}');

    expect(
      await screen.findByText('Lookup failed — enter the address by hand')
    ).toBeInTheDocument();
    expect(mockCreateProperty).not.toHaveBeenCalled();
  });

  it('honours the step query parameter', () => {
    setOnboarding(buildStatus());
    renderPage('/onboarding?step=property');

    expect(screen.getByLabelText('Property name')).toBeInTheDocument();
  });

  it('creates a property from the inline form and refreshes status', async () => {
    const user = userEvent.setup();
    const refetch = jest.fn();
    mockUseProperties.mockReturnValue({ properties: [], loading: false, refetch });
    mockCreateProperty.mockResolvedValue({ id: 'p1', name: '42 Oak Avenue' });
    setOnboarding(buildStatus());
    renderPage('/onboarding?step=property');

    await user.type(screen.getByLabelText('Property name'), '42 Oak Avenue');
    await user.type(screen.getByLabelText('Street'), '42 Oak Avenue');
    await user.type(screen.getByLabelText('City'), 'Bristol');
    await user.type(screen.getByLabelText('County'), 'Avon');
    await user.type(screen.getByLabelText('Postcode'), 'BS1 1AA');
    await user.click(screen.getByRole('button', { name: 'Add property' }));

    await waitFor(() => expect(mockCreateProperty).toHaveBeenCalled());
    expect(mockCreateProperty).toHaveBeenCalledWith(
      expect.objectContaining({ name: '42 Oak Avenue', city: 'Bristol', propertyType: 'House' })
    );
    expect(refetch).toHaveBeenCalled();
    expect(actions.refresh).toHaveBeenCalled();
  });

  it('advances to the next outstanding step below the one just finished', async () => {
    const user = userEvent.setup();
    mockCreateProperty.mockResolvedValue({ id: 'p1', name: '42 Oak Avenue' });
    // co-owners is still outstanding *above* property; the flow should move on
    // to the tenant step rather than jumping back up the list.
    actions.refresh.mockResolvedValue(buildStatus({ property: 'complete' }));
    setOnboarding(buildStatus());
    renderPage('/onboarding?step=property');

    await user.type(screen.getByLabelText('Property name'), '42 Oak Avenue');
    await user.type(screen.getByLabelText('Street'), '42 Oak Avenue');
    await user.type(screen.getByLabelText('City'), 'Bristol');
    await user.type(screen.getByLabelText('County'), 'Avon');
    await user.type(screen.getByLabelText('Postcode'), 'BS1 1AA');
    await user.click(screen.getByRole('button', { name: 'Add property' }));

    await waitFor(() => expect(mockGetSearch()).toBe('?step=tenant'));
  });

  it('does not submit an incomplete property form', async () => {
    const user = userEvent.setup();
    setOnboarding(buildStatus());
    renderPage('/onboarding?step=property');

    await user.click(screen.getByRole('button', { name: 'Add property' }));

    expect(mockCreateProperty).not.toHaveBeenCalled();
    expect(screen.getByText('Street is required')).toBeInTheDocument();
  });

  it('explains what is blocking a locked step instead of showing a form', () => {
    setOnboarding(buildStatus());
    renderPage('/onboarding?step=lease');

    expect(screen.getByText(/this step needs them to exist/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create lease' })).not.toBeInTheDocument();
  });

  it('skips a step on request', async () => {
    const user = userEvent.setup();
    setOnboarding(buildStatus());
    renderPage('/onboarding?step=tenant');

    await user.click(screen.getByRole('button', { name: 'Skip this step' }));

    await waitFor(() => expect(actions.skipStep).toHaveBeenCalledWith('tenant'));
  });

  it('offers no skip for a step the server marks unskippable', () => {
    setOnboarding(buildStatus());
    renderPage('/onboarding?step=property');

    expect(screen.queryByRole('button', { name: 'Skip this step' })).not.toBeInTheDocument();
  });

  it('falls back to a link for steps with no inline form', () => {
    setOnboarding(buildStatus({ property: 'complete' }));
    renderPage('/onboarding?step=event');

    expect(screen.getByRole('button', { name: /Add an event/ })).toBeInTheDocument();
  });

  it('celebrates once every essential step is settled', () => {
    setOnboarding(
      buildStatus({
        'co-owners': 'skipped',
        property: 'complete',
        tenant: 'complete',
        lease: 'complete',
      })
    );
    renderPage();

    expect(screen.getByText('You’re ready to go')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to dashboard' })).toBeInTheDocument();
  });

  it('dismisses the flow when the user chooses to skip it', async () => {
    const user = userEvent.setup();
    setOnboarding(buildStatus());
    renderPage();

    // Dismissing resolves and *then* navigates, so let the whole sequence
    // settle inside act rather than tripping React's update warning.
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    });

    await waitFor(() => expect(actions.dismiss).toHaveBeenCalled());
    expect(toast.info).toHaveBeenCalledWith('Setup is still under Get started in the sidebar');
  });

  it('tells a read-only account there is nothing to do', () => {
    const status = buildStatus();
    setOnboarding({ ...status, steps: [], sections: [], totalCount: 0, completedCount: 0 });
    renderPage();

    expect(screen.getByText('Nothing to set up')).toBeInTheDocument();
  });
});
