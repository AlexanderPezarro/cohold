import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '../../primitives/Button';
import styles from './Onboarding.module.scss';

interface StepFormProps {
  onSubmit: (event: React.FormEvent) => void;
  /** Error banner text, or null when there's nothing to report. */
  error?: string | null;
  submitting?: boolean;
  submitLabel: string;
  /** Shown under the fields, above the buttons. */
  hint?: React.ReactNode;
  /** Rendered next to the submit button, e.g. a skip action. */
  secondaryAction?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Shared chrome for the inline step forms: error banner, field grid and the
 * submit row. Keeps each step file down to just its own fields.
 */
export const StepForm: React.FC<StepFormProps> = ({
  onSubmit,
  error,
  submitting = false,
  submitLabel,
  hint,
  secondaryAction,
  children,
}) => (
  <form onSubmit={onSubmit} noValidate>
    {error && (
      <div className={styles.formError} role="alert">
        <AlertCircle size={16} />
        <span>{error}</span>
      </div>
    )}

    <div className={styles.fieldGrid}>{children}</div>

    {hint && <p className={styles.hint}>{hint}</p>}

    <div className={styles.formActions}>
      <Button type="submit" variant="primary" loading={submitting}>
        {submitLabel}
      </Button>
      {secondaryAction}
    </div>
  </form>
);
