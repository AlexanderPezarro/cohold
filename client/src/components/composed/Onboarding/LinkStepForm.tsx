import React, { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../primitives/Button';
import { useOnboarding } from '../../../contexts/OnboardingContext';
import type { OnboardingStepFormProps } from './types';
import styles from './Onboarding.module.scss';

/**
 * Fallback rendering for any step without a bespoke form: send the user to the
 * page that does the job. Most optional steps need nothing more than this, so a
 * new step can be added to the registry with no client code at all.
 */
export const LinkStepForm: React.FC<OnboardingStepFormProps> = ({ step }) => {
  const navigate = useNavigate();
  const { completeStep } = useOnboarding();
  const [marking, setMarking] = useState(false);

  const handleMarkDone = async () => {
    try {
      setMarking(true);
      await completeStep(step.id);
    } finally {
      setMarking(false);
    }
  };

  return (
    <div className={styles.linkStep}>
      <p className={styles.hint}>
        {step.manual
          ? 'Head over when you are ready, then mark this done.'
          : 'This one lives on its own page. Cohold ticks it off here as soon as it is done.'}
      </p>
      <div className={styles.formActions}>
        <Button variant="primary" endIcon={<ArrowUpRight size={16} />} onClick={() => navigate(step.route)}>
          {step.ctaLabel}
        </Button>
        {step.manual && (
          <Button variant="secondary" loading={marking} onClick={handleMarkDone}>
            Mark as done
          </Button>
        )}
      </div>
    </div>
  );
};
