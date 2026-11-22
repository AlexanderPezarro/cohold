/**
 * Onboarding status.
 *
 * The steps themselves (ids, titles, ordering, dependencies) live in
 * `shared/onboarding/steps.ts` so the client renders exactly what the server
 * evaluates. This module answers the only question the server owns: for a given
 * user, is each step done?
 *
 * Completion is derived from the data wherever possible — a step is done because
 * a property exists, not because someone clicked "next". That keeps the
 * checklist honest for users who set things up before finding the flow, and for
 * seeded or imported installs. `onboarding_step_overrides` records the two
 * decisions data can't express: skipping a step, and ticking off a step whose
 * completion isn't derivable (`manual` in the registry).
 *
 * To add a step: add it to the shared registry, then add its check to
 * `STEP_CHECKS` below. The `Record<OnboardingStepId, StepCheck>` type makes a
 * forgotten check a compile error.
 */
import prisma from '../db/client.js';
import {
  ONBOARDING_SECTIONS,
  ONBOARDING_STEPS,
  getOnboardingStep,
  type OnboardingStatus,
  type OnboardingStepDefinition,
  type OnboardingStepId,
  type OnboardingStepStatus,
  type OnboardingStepView,
} from '../../../shared/onboarding/steps.js';
import type { Role } from '../../../shared/types/user.types.js';
import { ValidationError } from './errors.js';

/** An explicit user decision stored against a step. */
export type OnboardingOverrideStatus = 'skipped' | 'completed';

/**
 * Row counts the checks run against.
 *
 * Properties, tenants and leases are counted install-wide rather than per user:
 * Cohold is a single household's install, and a co-owner invited after setup
 * should see the property step as done rather than be nudged into creating a
 * duplicate.
 */
export interface OnboardingCounts {
  users: number;
  properties: number;
  tenants: number;
  leases: number;
  bankAccounts: number;
  matchingRules: number;
  transactions: number;
  events: number;
  documents: number;
}

export interface OnboardingCheckContext {
  userId: string;
  role: Role;
  counts: OnboardingCounts;
}

interface StepCheckResult {
  complete: boolean;
  /** Short summary shown next to a completed step, e.g. "2 properties". */
  detail?: string;
}

type StepCheck = (ctx: OnboardingCheckContext) => StepCheckResult;

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Completion check per step. Add an entry here whenever a step is added. */
const STEP_CHECKS: Record<OnboardingStepId, StepCheck> = {
  // The account's own owner is always user #1, so co-owners means more than one.
  'co-owners': ({ counts }) => ({
    complete: counts.users > 1,
    detail: counts.users > 1 ? plural(counts.users - 1, 'co-owner') : undefined,
  }),
  property: ({ counts }) => ({
    complete: counts.properties > 0,
    detail: counts.properties > 0 ? plural(counts.properties, 'property', 'properties') : undefined,
  }),
  tenant: ({ counts }) => ({
    complete: counts.tenants > 0,
    detail: counts.tenants > 0 ? plural(counts.tenants, 'tenant') : undefined,
  }),
  lease: ({ counts }) => ({
    complete: counts.leases > 0,
    detail: counts.leases > 0 ? plural(counts.leases, 'lease') : undefined,
  }),
  'bank-account': ({ counts }) => ({
    complete: counts.bankAccounts > 0,
    detail: counts.bankAccounts > 0 ? plural(counts.bankAccounts, 'account') : undefined,
  }),
  'matching-rules': ({ counts }) => ({
    complete: counts.matchingRules > 0,
    detail: counts.matchingRules > 0 ? plural(counts.matchingRules, 'rule') : undefined,
  }),
  transaction: ({ counts }) => ({
    complete: counts.transactions > 0,
    detail: counts.transactions > 0 ? plural(counts.transactions, 'transaction') : undefined,
  }),
  event: ({ counts }) => ({
    complete: counts.events > 0,
    detail: counts.events > 0 ? plural(counts.events, 'event') : undefined,
  }),
  document: ({ counts }) => ({
    complete: counts.documents > 0,
    detail: counts.documents > 0 ? plural(counts.documents, 'document') : undefined,
  }),
};

async function loadCounts(): Promise<OnboardingCounts> {
  const [
    users,
    properties,
    tenants,
    leases,
    bankAccounts,
    matchingRules,
    transactions,
    events,
    documents,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.property.count(),
    prisma.tenant.count(),
    prisma.lease.count(),
    prisma.bankAccount.count(),
    prisma.matchingRule.count(),
    prisma.transaction.count(),
    prisma.event.count(),
    prisma.document.count(),
  ]);

  return {
    users,
    properties,
    tenants,
    leases,
    bankAccounts,
    matchingRules,
    transactions,
    events,
    documents,
  };
}

/**
 * Steps that apply to this user.
 *
 * Admin-only steps are hidden from everyone else, and steps needing write
 * access are hidden from VIEWERs - showing someone a checklist that ends in a
 * 403 helps nobody. A VIEWER therefore has an empty (and so already complete)
 * checklist, which keeps the card and the nav entry out of their way.
 */
function applicableSteps(role: Role): OnboardingStepDefinition[] {
  return ONBOARDING_STEPS.filter(
    (step) => (!step.adminOnly || role === 'ADMIN') && (!step.requiresWrite || role !== 'VIEWER')
  );
}

async function loadOverrides(userId: string): Promise<Map<string, OnboardingOverrideStatus>> {
  const rows = await prisma.onboardingStepOverride.findMany({
    where: { userId },
    select: { stepId: true, status: true },
  });
  return new Map(rows.map((row) => [row.stepId, row.status as OnboardingOverrideStatus]));
}

export async function getOnboardingStatus(userId: string, role: Role): Promise<OnboardingStatus> {
  const [counts, overrides, user] = await Promise.all([
    loadCounts(),
    loadOverrides(userId),
    prisma.user.findUnique({
      where: { id: userId },
      select: { onboardingDismissedAt: true },
    }),
  ]);

  const ctx: OnboardingCheckContext = { userId, role, counts };
  const steps = applicableSteps(role);
  const applicableIds = new Set(steps.map((step) => step.id));

  // First pass: derived completion, which the dependency pass then reads.
  const results = new Map<OnboardingStepId, StepCheckResult>();
  for (const step of steps) {
    const override = overrides.get(step.id);
    const derived = STEP_CHECKS[step.id](ctx);
    results.set(step.id, {
      complete: derived.complete || override === 'completed',
      detail: derived.detail,
    });
  }

  const stepViews: OnboardingStepView[] = steps.map((step) => {
    const result = results.get(step.id)!;
    // A skipped dependency doesn't unblock anything: a lease still needs a real
    // property and tenant to exist.
    const blockedBy = step.dependsOn.filter(
      (dependency) => applicableIds.has(dependency) && !results.get(dependency)?.complete
    );

    let status: OnboardingStepStatus;
    if (result.complete) {
      // Data beats a skip - if they did it anyway, show it as done.
      status = 'complete';
    } else if (blockedBy.length > 0) {
      status = 'locked';
    } else if (overrides.get(step.id) === 'skipped') {
      status = 'skipped';
    } else {
      status = 'todo';
    }

    // The whole definition goes over the wire, not just the id and status, so
    // the client has no need for its own copy of the registry.
    return { ...step, status, detail: result.detail, blockedBy };
  });

  const viewById = new Map(stepViews.map((view) => [view.id, view]));
  const essentials = steps.filter((step) => !step.optional);
  const settled = (view: OnboardingStepView | undefined) =>
    view?.status === 'complete' || view?.status === 'skipped';

  const completedCount = essentials.filter((step) => settled(viewById.get(step.id))).length;
  const isComplete = completedCount === essentials.length;
  const nextStep = stepViews.find((view) => view.status === 'todo');

  const untouched =
    counts.properties === 0 && counts.tenants === 0 && counts.leases === 0 && counts.users <= 1;

  return {
    steps: stepViews,
    sections: ONBOARDING_SECTIONS.filter((section) =>
      stepViews.some((view) => view.section === section.id)
    ),
    completedCount,
    totalCount: essentials.length,
    isComplete,
    dismissed: user?.onboardingDismissedAt != null,
    nextStepId: nextStep?.id ?? null,
    // Only pull a genuinely empty install into the flow, and never after the
    // user has dismissed it.
    shouldRedirect: user?.onboardingDismissedAt == null && !isComplete && untouched,
  };
}

/**
 * Records a user's decision about a step.
 *
 * Skipping is refused for steps the registry marks unskippable, and manual
 * completion for steps whose completion is derived from data — otherwise a user
 * could tick off "add a property" without one existing.
 */
export async function setStepOverride(
  userId: string,
  stepId: OnboardingStepId,
  status: OnboardingOverrideStatus
): Promise<void> {
  const step = getOnboardingStep(stepId);

  if (status === 'skipped' && !step.skippable) {
    throw new ValidationError(`The "${step.title}" step can't be skipped`);
  }
  if (status === 'completed' && !step.manual) {
    throw new ValidationError(
      `The "${step.title}" step is completed by doing it, not by marking it done`
    );
  }

  await prisma.onboardingStepOverride.upsert({
    where: { userId_stepId: { userId, stepId } },
    create: { userId, stepId, status },
    update: { status },
  });
}

/** Undoes a skip (or a manual completion), returning the step to the checklist. */
export async function clearStepOverride(userId: string, stepId: OnboardingStepId): Promise<void> {
  await prisma.onboardingStepOverride.deleteMany({ where: { userId, stepId } });
}

/** Hides or re-shows the checklist for this user. */
export async function setDismissed(userId: string, dismissed: boolean): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { onboardingDismissedAt: dismissed ? new Date() : null },
  });
}

/** Clears every decision so the user starts the flow over. */
export async function restart(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.onboardingStepOverride.deleteMany({ where: { userId } }),
    prisma.user.update({ where: { id: userId }, data: { onboardingDismissedAt: null } }),
  ]);
}

export default {
  getOnboardingStatus,
  setStepOverride,
  clearStepOverride,
  setDismissed,
  restart,
};
