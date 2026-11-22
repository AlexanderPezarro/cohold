import {
  ONBOARDING_SECTIONS,
  ONBOARDING_STEPS,
  ONBOARDING_STEP_IDS,
  getOnboardingStep,
  isOnboardingStepId,
} from '../steps.js';

/**
 * Invariants the wizard relies on. These guard the registry against the kinds
 * of mistake that are easy to make when adding a step months from now.
 */
describe('onboarding step registry', () => {
  it('has unique ids', () => {
    expect(new Set(ONBOARDING_STEP_IDS).size).toBe(ONBOARDING_STEPS.length);
  });

  it('only depends on steps that exist', () => {
    for (const step of ONBOARDING_STEPS) {
      for (const dependency of step.dependsOn) {
        expect(ONBOARDING_STEP_IDS).toContain(dependency);
      }
    }
  });

  it('lists every dependency before the step that needs it', () => {
    const seen = new Set<string>();
    for (const step of ONBOARDING_STEPS) {
      for (const dependency of step.dependsOn) {
        // Ordering matters: a step should never appear above something it needs,
        // which also rules out dependency cycles.
        expect(seen.has(dependency)).toBe(true);
      }
      seen.add(step.id);
    }
  });

  it('puts every step in a known section', () => {
    const sectionIds = ONBOARDING_SECTIONS.map((section) => section.id);
    for (const step of ONBOARDING_STEPS) {
      expect(sectionIds).toContain(step.section);
    }
  });

  it('never depends on an optional step from an essential one', () => {
    const optional = new Set(
      ONBOARDING_STEPS.filter((step) => step.optional).map((step) => step.id)
    );
    for (const step of ONBOARDING_STEPS.filter((s) => !s.optional)) {
      for (const dependency of step.dependsOn) {
        // Otherwise a core step could be permanently locked behind something
        // the user is told they never have to do.
        expect(optional.has(dependency)).toBe(false);
      }
    }
  });

  it('does not depend on an admin-only step from one everybody sees', () => {
    const adminOnly = new Set(
      ONBOARDING_STEPS.filter((step) => step.adminOnly).map((step) => step.id)
    );
    for (const step of ONBOARDING_STEPS.filter((s) => !s.adminOnly)) {
      for (const dependency of step.dependsOn) {
        expect(adminOnly.has(dependency)).toBe(false);
      }
    }
  });

  it('gives every step a route, a CTA and a description', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(step.route.startsWith('/')).toBe(true);
      expect(step.ctaLabel.length).toBeGreaterThan(0);
      expect(step.description.length).toBeGreaterThan(0);
    }
  });

  it('has at least one essential step and one optional extra', () => {
    expect(ONBOARDING_STEPS.some((step) => !step.optional)).toBe(true);
    expect(ONBOARDING_STEPS.some((step) => step.optional)).toBe(true);
  });

  it('recognises its own ids and rejects others', () => {
    expect(isOnboardingStepId('property')).toBe(true);
    expect(isOnboardingStepId('not-a-step')).toBe(false);
    expect(getOnboardingStep('property').title).toContain('property');
    expect(() => getOnboardingStep('nope' as never)).toThrow(/Unknown onboarding step/);
  });
});
