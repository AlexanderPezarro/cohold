import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { MailCheck } from 'lucide-react';
import { Card } from '../components/primitives/Card';
import { TextField } from '../components/primitives/TextField';
import { Button } from '../components/primitives/Button';
import { ForgotPasswordSchema, ForgotPassword as ForgotPasswordData } from '../../../shared/validation/auth.validation';
import { authService } from '../services/api/auth.service';
import styles from './ForgotPassword.module.scss';

export const ForgotPassword: React.FC = () => {
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordData>({
    resolver: zodResolver(ForgotPasswordSchema),
    mode: 'onSubmit',
    defaultValues: { email: '' },
  });

  const onSubmit = async (data: ForgotPasswordData) => {
    try {
      await authService.forgotPassword(data.email);
    } finally {
      // Always show the success state, whether or not the email exists,
      // so this endpoint can't be used to enumerate registered accounts.
      setSubmitted(true);
    }
  };

  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <h1 className={styles.brandName}>Cohold</h1>
        {submitted ? (
          <>
            <div className={styles.successIcon}>
              <MailCheck size={40} />
            </div>
            <h2 className={styles.subtitle}>Check your email</h2>
            <p className={styles.helperText}>
              If an account exists for that email address, we&apos;ve sent a link to
              reset your password. The link expires in 1 hour.
            </p>
            <Link to="/login" className={styles.backLink}>
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <h2 className={styles.subtitle}>Forgot your password?</h2>
            <p className={styles.helperText}>
              Enter your email address and we&apos;ll send you a link to reset your
              password.
            </p>
            <form className={styles.form} onSubmit={handleSubmit(onSubmit)}>
              <div className={styles.field}>
                <TextField
                  fullWidth
                  id="email"
                  label="Email Address"
                  autoComplete="email"
                  autoFocus
                  error={!!errors.email}
                  helperText={errors.email?.message}
                  disabled={isSubmitting}
                  {...register('email')}
                />
              </div>
              <Button
                type="submit"
                fullWidth
                variant="primary"
                className={styles.submitButton}
                disabled={isSubmitting}
                loading={isSubmitting}
              >
                {isSubmitting ? 'Sending...' : 'Send Reset Link'}
              </Button>
            </form>
            <Link to="/login" className={styles.backLink}>
              Back to sign in
            </Link>
          </>
        )}
      </Card>
    </div>
  );
};
