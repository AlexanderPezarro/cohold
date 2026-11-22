/**
 * Onboarding step registry.
 *
 * This file is the single source of truth for *which* steps exist, what they
 * are called and how they are ordered. It is shared by the client (which
 * renders them) and the server (which decides whether each one is done).
 *
 * To add a step when a new feature lands:
 *   1. Add its id to `OnboardingStepId` and an entry to `ONBOARDING_STEPS`.
 *   2. Add a completion check in `server/src/services/onboarding.service.ts`
 *      (the `Record<OnboardingStepId, ...>` there makes a missing one a
 *      compile error).
 *   3. Optionally register a bespoke form in
 *      `client/src/components/composed/Onboarding/stepComponents.tsx`.
 *      Without one the step renders as a link to `route`, which is enough for
 *      most steps.
 */

/** Groups steps into the sections rendered by the onboarding page. */
export type OnboardingSectionId = 'essentials' | 'enhancements';

export interface OnboardingSectionDefinition {
  id: OnboardingSectionId;
  title: string;
  description: string;
}

export const ONBOARDING_SECTIONS: readonly OnboardingSectionDefinition[] = [
  {
    id: 'essentials',
    title: 'Core setup',
    description: 'The handful of things Cohold needs before it can track anything for you.',
  },
  {
    id: 'enhancements',
    title: 'Optional extras',
    description: 'Turn these on whenever you like — nothing here blocks day-to-day use.',
  },
];

export type OnboardingStepId =
  | 'co-owners'
  | 'property'
  | 'tenant'
  | 'lease'
  | 'bank-account'
  | 'matching-rules'
  | 'transaction'
  | 'event'
  | 'document';

export interface OnboardingStepDefinition {
  id: OnboardingStepId;
  /** Section the step is rendered under. */
  section: OnboardingSectionId;
  title: string;
  /** One or two sentences shown under the title. */
  description: string;
  /**
   * Icon key. The client maps this to a lucide icon; an unknown key falls back
   * to a generic one, so adding a step never breaks the build.
   */
  icon: string;
  /** Label for the step's primary action. */
  ctaLabel: string;
  /** Page the feature lives on. Used by the "do this later" link and by steps with no bespoke form. */
  route: string;
  /**
   * Steps that must be complete first. Only list a genuine data dependency
   * (a lease needs a property and a tenant); plain ordering is expressed by
   * position in this array.
   */
  dependsOn: OnboardingStepId[];
  /** Optional steps never hold back overall completion. */
  optional: boolean;
  /** Whether the user can dismiss the step without doing it. */
  skippable: boolean;
  /** Steps only an ADMIN can action are hidden from everyone else. */
  adminOnly: boolean;
  /**
   * Whether doing this step needs write access. Steps that do are hidden from
   * VIEWERs, who would only meet a 403 at the end of them.
   */
  requiresWrite: boolean;
  /**
   * True when completion cannot be derived from the data, so the user ticks it
   * off themselves. Such steps accept the `complete` API action.
   */
  manual: boolean;
}

type StepDefaults =
  | 'dependsOn'
  | 'optional'
  | 'skippable'
  | 'adminOnly'
  | 'manual'
  | 'requiresWrite';
type StepSeed = Omit<OnboardingStepDefinition, StepDefaults> &
  Partial<Pick<OnboardingStepDefinition, StepDefaults>>;

/** Fills in the flags most steps leave at their default. */
function defineStep(seed: StepSeed): OnboardingStepDefinition {
  return {
    dependsOn: [],
    optional: seed.section === 'enhancements',
    skippable: true,
    adminOnly: false,
    manual: false,
    requiresWrite: true,
    ...seed,
  };
}

export const ONBOARDING_STEPS: readonly OnboardingStepDefinition[] = [
  defineStep({
    id: 'co-owners',
    section: 'essentials',
    title: 'Invite your co-owners',
    description:
      'Add anyone who shares ownership of your properties. Cohold splits income, expenses and settlements between them.',
    icon: 'users',
    ctaLabel: 'Invite a co-owner',
    route: '/users',
    adminOnly: true,
  }),
  defineStep({
    id: 'property',
    section: 'essentials',
    title: 'Add your first property',
    description:
      'Everything else in Cohold hangs off a property — leases, transactions, documents and events.',
    icon: 'home',
    ctaLabel: 'Add a property',
    route: '/properties',
    skippable: false,
  }),
  defineStep({
    id: 'tenant',
    section: 'essentials',
    title: 'Add a tenant',
    description: 'Record who is renting from you, along with their contact and emergency details.',
    icon: 'user-plus',
    ctaLabel: 'Add a tenant',
    route: '/tenants',
  }),
  defineStep({
    id: 'lease',
    section: 'essentials',
    title: 'Create a lease',
    description:
      'A lease ties a tenant to a property and sets the rent and deposit that Cohold tracks against it.',
    icon: 'file-text',
    ctaLabel: 'Create a lease',
    route: '/leases',
    dependsOn: ['property', 'tenant'],
  }),
  defineStep({
    id: 'bank-account',
    section: 'enhancements',
    title: 'Connect a bank account',
    description: 'Link Monzo to import transactions automatically instead of entering them by hand.',
    icon: 'landmark',
    ctaLabel: 'Connect a bank',
    route: '/admin/bank-accounts',
    adminOnly: true,
  }),
  defineStep({
    id: 'matching-rules',
    section: 'enhancements',
    title: 'Set up matching rules',
    description:
      'Rules file imported bank transactions against the right property and category before you ever see them.',
    icon: 'wand',
    ctaLabel: 'Add a rule',
    route: '/admin/bank-accounts',
    dependsOn: ['bank-account'],
    adminOnly: true,
  }),
  defineStep({
    id: 'transaction',
    section: 'enhancements',
    title: 'Record a transaction',
    description:
      'Log a rent payment or an expense to see how income and costs are split between owners.',
    icon: 'pound',
    ctaLabel: 'Record a transaction',
    route: '/transactions',
    dependsOn: ['property'],
  }),
  defineStep({
    id: 'event',
    section: 'enhancements',
    title: 'Schedule a reminder',
    description: 'Gas safety checks, inspections and renewals — put the next one in the calendar.',
    icon: 'calendar',
    ctaLabel: 'Add an event',
    route: '/events',
    dependsOn: ['property'],
  }),
  defineStep({
    id: 'document',
    section: 'enhancements',
    title: 'Upload a document',
    description:
      'Keep certificates, signed leases and inventories attached to the property they belong to.',
    icon: 'folder',
    ctaLabel: 'Upload a document',
    route: '/documents',
    dependsOn: ['property'],
  }),
];

export const ONBOARDING_STEP_IDS: readonly OnboardingStepId[] = ONBOARDING_STEPS.map(
  (step) => step.id
);

const STEPS_BY_ID = new Map<string, OnboardingStepDefinition>(
  ONBOARDING_STEPS.map((step) => [step.id, step])
);

export function isOnboardingStepId(value: string): value is OnboardingStepId {
  return STEPS_BY_ID.has(value);
}

export function getOnboardingStep(id: OnboardingStepId): OnboardingStepDefinition {
  const step = STEPS_BY_ID.get(id);
  if (!step) {
    throw new Error(`Unknown onboarding step: ${id}`);
  }
  return step;
}

/** The state of a single step for a single user. */
export type OnboardingStepStatus =
  /** Done — either the data exists or the user ticked off a manual step. */
  | 'complete'
  /** Deliberately passed over. Counts as settled, but is shown differently. */
  | 'skipped'
  /** A dependency is still outstanding. */
  | 'locked'
  /** Ready to be done. */
  | 'todo';

export interface OnboardingStepState {
  id: OnboardingStepId;
  status: OnboardingStepStatus;
  /** Short human-readable summary of what was found, e.g. "2 properties". */
  detail?: string;
  /** Ids of the incomplete dependencies, when `status` is 'locked'. */
  blockedBy: OnboardingStepId[];
}

/**
 * A step's definition merged with one user's progress on it - what the API
 * hands back.
 *
 * The server sends whole definitions rather than just ids and statuses so the
 * client renders the registry it is talking to, not the one it was built
 * against. It also keeps this file off the client's runtime import graph: only
 * its types cross over, and those are erased at compile time.
 */
export type OnboardingStepView = OnboardingStepDefinition & Omit<OnboardingStepState, 'id'>;

export interface OnboardingStatus {
  steps: OnboardingStepView[];
  /** Sections that actually contain steps for this user, in display order. */
  sections: OnboardingSectionDefinition[];
  /** Essential steps that are settled, over the number that apply to this user. */
  completedCount: number;
  totalCount: number;
  /** Every applicable essential step is complete or skipped. */
  isComplete: boolean;
  /** The user has hidden the checklist. */
  dismissed: boolean;
  /** Next actionable step, or null when there is nothing left to do. */
  nextStepId: OnboardingStepId | null;
  /** True for a brand new account: nothing set up yet and never dismissed. */
  shouldRedirect: boolean;
}
