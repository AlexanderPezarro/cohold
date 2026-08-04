import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle } from 'lucide-react';
import { Card } from '../components/primitives/Card';
import { TextField } from '../components/primitives/TextField';
import { Button } from '../components/primitives/Button';
import { ResetPasswordSchema } from '../../../shared/validation/auth.validation';
import { authService } from '../services/api/auth.service';
import { toast } from '../contexts/ToastContext';
import { ApiError } from '../types/api.types';
import styles from './ResetPassword.module.scss';

const ResetPasswordFormSchema = ResetPasswordSchema.omit({ token: true })
  .extend({
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ResetPasswordFormData = z.infer<typeof ResetPasswordFormSchema>;

export const ResetPassword: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const token = searchParams.get('token') || '';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(ResetPasswordFormSchema),
    mode: 'onSubmit',
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const onSubmit = async (data: ResetPasswordFormData) => {
    setError(null);

    try {
      await authService.resetPassword(token, data.newPassword);
      toast.success('Password reset. Please sign in with your new password.');
      navigate('/login');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred');
      }
    }
  };

  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <h1 className={styles.brandName}>Cohold</h1>
        <h2 className={styles.subtitle}>Set a new password</h2>
        {!token && (
          <div className={`${styles.alert} ${styles.alertError}`}>
            <AlertCircle size={20} className={styles.alertIcon} />
            <span className={styles.alertText}>
              This reset link is missing its token. Please request a new one.
            </span>
          </div>
        )}
        {error && (
          <div className={`${styles.alert} ${styles.alertError}`}>
            <AlertCircle size={20} className={styles.alertIcon} />
            <span className={styles.alertText}>{error}</span>
          </div>
        )}
        <form className={styles.form} onSubmit={handleSubmit(onSubmit)}>
          <div className={styles.field}>
            <TextField
              fullWidth
              label="New Password"
              type="password"
              id="newPassword"
              autoComplete="new-password"
              autoFocus
              error={!!errors.newPassword}
              helperText={
                errors.newPassword?.message ||
                'Min 8 characters, 1 uppercase, 1 lowercase, 1 number'
              }
              disabled={isSubmitting}
              {...register('newPassword')}
            />
          </div>
          <div className={styles.field}>
            <TextField
              fullWidth
              label="Confirm New Password"
              type="password"
              id="confirmPassword"
              autoComplete="new-password"
              error={!!errors.confirmPassword}
              helperText={errors.confirmPassword?.message}
              disabled={isSubmitting}
              {...register('confirmPassword')}
            />
          </div>
          <Button
            type="submit"
            fullWidth
            variant="primary"
            className={styles.submitButton}
            disabled={isSubmitting || !token}
            loading={isSubmitting}
          >
            {isSubmitting ? 'Resetting...' : 'Reset Password'}
          </Button>
        </form>
        <Link to="/login" className={styles.backLink}>
          Back to sign in
        </Link>
      </Card>
    </div>
  );
};
