import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, CheckCircle2, Circle, Lock, MinusCircle, PartyPopper } from 'lucide-react';
import { Container } from '../components/primitives/Container';
import { Button } from '../components/primitives/Button';
import { Chip } from '../components/primitives/Chip';
import { Spinner } from '../components/primitives/Spinner';
import { StepIcon } from '../components/composed/Onboarding/stepIcons';
import { getStepForm, hasInlineForm } from '../components/composed/Onboarding/stepComponents';
import { useOnboarding } from '../contexts/OnboardingContext';
import { useToast } from '../contexts/ToastContext';
import type { OnboardingStepView } from '../contexts/OnboardingContext';
import type { OnboardingStepId, OnboardingStepStatus } from '../../../shared/onboarding/steps';
import styles from './Onboarding.module.scss';

const STATUS_CHIPS: Record<string, { label: string; color: 'success' | 'default' | 'warning' }> = {
  complete: { label: 'Done', color: 'success' },
  skipped: { label: 'Skipped', color: 'default' },
  locked: { label: 'Locked', color: 'warning' },
};

/**
 * Where to go after finishing a step: the next outstanding one *below* it, so
 * the flow always moves forwards. Only when nothing is left below do we fall
 * back to whatever is still outstanding higher up.
 */
function pickNextStep(
  list: ReadonlyArray<{ id: OnboardingStepId; status: OnboardingStepStatus }>,
  currentId: OnboardingStepId
): OnboardingStepId | null {
  const index = list.findIndex((step) => step.id === currentId);
  const below = list.slice(index + 1).find((step) => step.status === 'todo');
  if (below) return below.id;
  return list.find((step) => step.status === 'todo' && step.id !== currentId)?.id ?? null;
}

const RailIcon: React.FC<{ step: OnboardingStepView }> = ({ step }) => {
  if (step.status === 'complete') {
    return (
      <span className={`${styles.railIcon} ${styles.railIconDone}`}>
        <CheckCircle2 size={18} />
      </span>
    );
  }
  if (step.status === 'skipped') {
    return (
      <span className={`${styles.railIcon} ${styles.railIconMuted}`}>
        <MinusCircle size={18} />
      </span>
    );
  }
  if (step.status === 'locked') {
    return (
      <span className={`${styles.railIcon} ${styles.railIconMuted}`}>
        <Lock size={18} />
      </span>
    );
  }
  return (
    <span className={styles.railIcon}>
      <Circle size={18} />
    </span>
  );
};

/**
 * The setup wizard.
 *
 * The step list, their order and their dependencies all come from
 * `shared/onboarding/steps.ts`; this page renders whatever is in there. A step
 * with an inline form (see `stepComponents.tsx`) is completed without leaving
 * the page, anything else links out to the feature's own page and gets ticked
 * off automatically once the data exists.
 */
export const Onboarding: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { status, steps, loading, refresh, skipStep, unskipStep, dismiss } = useOnboarding();
  const [busy, setBusy] = useState(false);
  const [showFormAgain, setShowFormAgain] = useState(false);

  const selectStep = useCallback(
    (id: OnboardingStepId) => {
      setShowFormAgain(false);
      setSearchParams({ step: id }, { replace: true });
    },
    [setSearchParams]
  );

  // Steps arrive from the server complete with their definitions, so titles for
  // dependencies come from the same payload rather than a client-side copy.
  const stepsById = useMemo(() => new Map(steps.map((step) => [step.id, step])), [steps]);
  const titleOf = useCallback(
    (id: OnboardingStepId) => stepsById.get(id)?.title ?? id,
    [stepsById]
  );

  const requestedId = searchParams.get('step');
  const activeStep = useMemo(() => {
    if (steps.length === 0) return null;
    if (requestedId) {
      const requested = steps.find((step) => step.id === requestedId);
      if (requested) return requested;
    }
    // Default to whatever is next, falling back to the first step so the panel
    // is never empty once everything is done.
    const next = steps.find((step) => step.status === 'todo');
    return next ?? steps[0];
  }, [steps, requestedId]);

  /** After a step's work succeeds: re-read status and move to the next thing. */
  const handleCompleted = useCallback(async () => {
    const next = await refresh();
    setShowFormAgain(false);
    if (!next || !activeStep) return;
    const nextId = pickNextStep(next.steps, activeStep.id);
    if (nextId) {
      setSearchParams({ step: nextId }, { replace: true });
    }
  }, [refresh, setSearchParams, activeStep]);

  const runStepAction = async (action: () => Promise<void>) => {
    try {
      setBusy(true);
      await action();
    } finally {
      setBusy(false);
    }
  };

  const handleSkip = async (step: OnboardingStepView) => {
    await runStepAction(() => skipStep(step.id));
    const nextId = pickNextStep(steps, step.id);
    if (nextId) selectStep(nextId);
  };

  const handleDismiss = async () => {
    const wasComplete = status?.isComplete;
    await runStepAction(() => dismiss());
    if (!wasComplete) toast.info('Setup is still under Get started in the sidebar');
    navigate('/dashboard');
  };

  if (loading) {
    return (
      <Container>
        <div className={styles.loading}>
          <Spinner />
        </div>
      </Container>
    );
  }

  if (!status) {
    return (
      <Container>
        <div className={styles.page}>
          <h1 className={styles.title}>Setup</h1>
          <p className={styles.subtitle}>
            We couldn&apos;t load your setup checklist. Refresh the page to try again.
          </p>
        </div>
      </Container>
    );
  }

  // Read-only accounts have no steps they could action, so there is nothing to
  // walk them through.
  if (!activeStep) {
    return (
      <Container>
        <div className={styles.page}>
          <h1 className={styles.title}>Nothing to set up</h1>
          <p className={styles.subtitle}>
            Your account has read-only access, so there are no setup steps to work through. Ask an
            admin if you need to add properties, tenants or leases.
          </p>
        </div>
      </Container>
    );
  }

  const percent = status.totalCount === 0 ? 100 : (status.completedCount / status.totalCount) * 100;
  const StepFormComponent = getStepForm(activeStep.id);
  const showForm =
    activeStep.status === 'todo' ||
    activeStep.status === 'skipped' ||
    (activeStep.status === 'complete' && showFormAgain);

  return (
    <Container>
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerRow}>
            <div>
              <h1 className={styles.title}>
                {status.isComplete ? 'Your setup' : 'Let’s get you set up'}
              </h1>
            </div>
            <Button variant="text" onClick={handleDismiss} disabled={busy}>
              {status.isComplete ? 'Back to dashboard' : 'Skip for now'}
            </Button>
          </div>

          <div className={styles.progress}>
            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-valuenow={status.completedCount}
              aria-valuemin={0}
              aria-valuemax={status.totalCount}
              aria-label="Setup progress"
            >
              <div className={styles.progressFill} style={{ width: `${percent}%` }} />
            </div>
            <span className={styles.progressLabel}>
              {status.completedCount} of {status.totalCount} core steps done
            </span>
          </div>
        </header>

        {status.isComplete && (
          <div className={styles.doneBanner}>
            <span className={styles.doneBannerIcon}>
              <PartyPopper size={24} />
            </span>
            <div className={styles.doneBannerText}>
              <h2>You’re ready to go</h2>
              <p>Your dashboard will start filling out as rent comes in and events fall due.</p>
            </div>
            <Button variant="primary" onClick={() => navigate('/dashboard')}>
              Go to dashboard
            </Button>
          </div>
        )}

        <div className={styles.layout}>
          <nav className={styles.rail} aria-label="Setup steps">
            {status.sections.map((section) => {
              const sectionSteps = steps.filter((step) => step.section === section.id);
              if (sectionSteps.length === 0) return null;

              return (
                <div className={styles.section} key={section.id}>
                  <h2 className={styles.sectionTitle}>{section.title}</h2>
                  {sectionSteps.map((step) => {
                    const classNames = [styles.railItem];
                    if (step.id === activeStep.id) classNames.push(styles.railItemActive);

                    return (
                      <button
                        key={step.id}
                        type="button"
                        className={classNames.join(' ')}
                        aria-current={step.id === activeStep.id ? 'step' : undefined}
                        onClick={() => selectStep(step.id)}
                      >
                        <RailIcon step={step} />
                        <span className={styles.railText}>
                          <span className={styles.railTitle}>{step.title}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          <section className={styles.panel} aria-labelledby="onboarding-step-title">
            <div className={styles.panelHeader}>
              <span className={styles.panelIcon}>
                <StepIcon icon={activeStep.icon} size={22} />
              </span>
              <div className={styles.panelHeading}>
                <div className={styles.panelTitleRow}>
                  <h2 className={styles.panelTitle} id="onboarding-step-title">
                    {activeStep.title}
                  </h2>
                  {STATUS_CHIPS[activeStep.status] && (
                    <Chip
                      label={STATUS_CHIPS[activeStep.status].label}
                      color={STATUS_CHIPS[activeStep.status].color}
                      size="small"
                    />
                  )}
                  {activeStep.optional && activeStep.status === 'todo' && (
                    <Chip label="Optional" color="default" size="small" />
                  )}
                </div>
                <p className={styles.panelDescription}>{activeStep.description}</p>
              </div>
            </div>

            {activeStep.status === 'locked' ? (
              <div className={styles.lockedState}>
                Finish{' '}
                {activeStep.blockedBy.map((id, index) => (
                  <React.Fragment key={id}>
                    {index > 0 && ' and '}
                    <Button variant="text" size="small" onClick={() => selectStep(id)}>
                      {titleOf(id).toLowerCase()}
                    </Button>
                  </React.Fragment>
                ))}{' '}
                first — this step needs them to exist.
              </div>
            ) : activeStep.status === 'complete' && !showFormAgain ? (
              <div className={styles.completeState}>
                <span className={styles.completeIcon}>
                  <CheckCircle2 size={20} />
                </span>
                <span>{activeStep.detail ? `${activeStep.detail} so far.` : 'All done.'}</span>
              </div>
            ) : null}

            {showForm && <StepFormComponent step={activeStep} onCompleted={handleCompleted} />}

            <div className={styles.panelActions}>
              {activeStep.status === 'complete' &&
                !showFormAgain &&
                hasInlineForm(activeStep.id) && (
                  <Button variant="secondary" onClick={() => setShowFormAgain(true)}>
                    Add another
                  </Button>
                )}
              {activeStep.status === 'skipped' && (
                <Button
                  variant="text"
                  disabled={busy}
                  onClick={() => runStepAction(() => unskipStep(activeStep.id))}
                >
                  Un-skip this step
                </Button>
              )}
              {activeStep.skippable && activeStep.status === 'todo' && (
                <Button variant="text" disabled={busy} onClick={() => handleSkip(activeStep)}>
                  Skip this step
                </Button>
              )}
              <span className={styles.spacer} />
              {hasInlineForm(activeStep.id) && (
                <Button
                  variant="text"
                  endIcon={<ArrowUpRight size={16} />}
                  onClick={() => navigate(activeStep.route)}
                >
                  Open the full page
                </Button>
              )}
            </div>
          </section>
        </div>
      </div>
    </Container>
  );
};
