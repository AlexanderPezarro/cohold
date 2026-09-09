import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, Lock, MinusCircle } from 'lucide-react';
import { Button } from '../../primitives/Button';
import { useOnboarding } from '../../../contexts/OnboardingContext';
import type { OnboardingStepView } from '../../../contexts/OnboardingContext';
import styles from './Onboarding.module.scss';

const StatusIcon: React.FC<{ step: OnboardingStepView }> = ({ step }) => {
  if (step.status === 'complete') {
    return (
      <span className={`${styles.checklistIcon} ${styles.checklistIconDone}`}>
        <CheckCircle2 size={18} />
      </span>
    );
  }
  if (step.status === 'skipped') {
    return (
      <span className={`${styles.checklistIcon} ${styles.checklistIconMuted}`}>
        <MinusCircle size={18} />
      </span>
    );
  }
  if (step.status === 'locked') {
    return (
      <span className={`${styles.checklistIcon} ${styles.checklistIconMuted}`}>
        <Lock size={18} />
      </span>
    );
  }
  return (
    <span className={styles.checklistIcon}>
      <Circle size={18} />
    </span>
  );
};

/**
 * Compact progress card for the dashboard.
 *
 * Renders nothing once the essentials are done or the user has dismissed the
 * flow — the full checklist stays reachable from the onboarding page.
 */
export const OnboardingChecklist: React.FC = () => {
  const navigate = useNavigate();
  const { status, steps, loading, dismiss } = useOnboarding();

  if (loading || !status || status.dismissed || status.isComplete) {
    return null;
  }

  const essentials = steps.filter((step) => !step.optional);
  const percent = status.totalCount === 0 ? 0 : (status.completedCount / status.totalCount) * 100;

  return (
    <section className={styles.checklistCard} aria-labelledby="onboarding-checklist-title">
      <div className={styles.checklistHeader}>
        <div>
          <h2 className={styles.checklistTitle} id="onboarding-checklist-title">
            Finish setting up Cohold
          </h2>
          <p className={styles.checklistSubtitle}>
            A few more steps and your portfolio is ready to track.
          </p>
        </div>
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
          {status.completedCount} of {status.totalCount} done
        </span>
      </div>

      <div className={styles.checklistItems}>
        {essentials.map((step) => {
          const locked = step.status === 'locked';
          const done = step.status === 'complete' || step.status === 'skipped';
          const classNames = [styles.checklistItem];
          if (done) classNames.push(styles.checklistItemDone);
          if (locked) classNames.push(styles.checklistItemLocked);

          return (
            <button
              key={step.id}
              type="button"
              className={classNames.join(' ')}
              disabled={locked}
              onClick={() => navigate(`/onboarding?step=${step.id}`)}
            >
              <StatusIcon step={step} />
              <span>{step.title}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.checklistActions}>
        <Button variant="primary" size="small" onClick={() => navigate('/onboarding')}>
          Continue setup
        </Button>
        <Button variant="text" size="small" onClick={() => dismiss()}>
          Hide this
        </Button>
      </div>
    </section>
  );
};
