import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { TextField } from '../../primitives/TextField';
import { Select } from '../../primitives/Select';
import { Chip } from '../../primitives/Chip';
import { StepForm } from './StepForm';
import { usersService, type UserListItem } from '../../../services/api/users.service';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { ApiError } from '../../../types/api.types';
import type { OnboardingStepFormProps } from './types';
import styles from './Onboarding.module.scss';

const ROLE_OPTIONS = [
  { value: 'LANDLORD', label: 'Landlord — can add and edit everything' },
  { value: 'VIEWER', label: 'Viewer — read-only access' },
  { value: 'ADMIN', label: 'Admin — full access, including users and banking' },
];

type Role = 'ADMIN' | 'LANDLORD' | 'VIEWER';

/**
 * Creates the co-owner's account outright, the same way the Users page does.
 * There is no email invite in Cohold yet, so the landlord sets a starting
 * password and passes it on; the co-owner changes it from Settings.
 */
export const CoOwnerStepForm: React.FC<OnboardingStepFormProps> = ({ onCompleted }) => {
  const toast = useToast();
  const { user } = useAuth();
  const [existing, setExisting] = useState<UserListItem[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('LANDLORD');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadUsers = async () => {
    try {
      setExisting(await usersService.getUsers());
    } catch (err) {
      console.error('Error loading users:', err);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const validate = () => {
    const found: Record<string, string> = {};
    if (!email.trim()) {
      found.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      found.email = 'Enter a valid email address';
    }
    if (password.length < 8) {
      found.password = 'At least 8 characters';
    } else if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      found.password = 'Needs an uppercase letter, a lowercase letter and a number';
    }
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!validate()) return;

    try {
      setSubmitting(true);
      await usersService.createUser(email.trim(), password, role);
      toast.success(`${email.trim()} can now sign in`);
      setEmail('');
      setPassword('');
      await loadUsers();
      await onCompleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the account');
    } finally {
      setSubmitting(false);
    }
  };

  const coOwners = existing.filter((account) => account.id !== user?.id);

  return (
    <>
      {coOwners.length > 0 && (
        <div className={styles.existingList}>
          <span className={styles.existingLabel}>
            <Check size={14} /> Already added
          </span>
          <div className={styles.chipRow}>
            {coOwners.map((account) => (
              <Chip key={account.id} label={account.email} color="success" size="small" />
            ))}
          </div>
        </div>
      )}

      <StepForm
        onSubmit={handleSubmit}
        error={error}
        submitting={submitting}
        submitLabel="Add co-owner"
        hint="Share the password with them — they can change it from Settings once they sign in. Ownership percentages are set per property, so you can split them however you like later."
      >
        <div className={styles.fullWidth}>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErrors((current) => ({ ...current, email: '' }));
            }}
            error={!!errors.email}
            helperText={errors.email}
            fullWidth
          />
        </div>
        <TextField
          label="Starting password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setErrors((current) => ({ ...current, password: '' }));
          }}
          error={!!errors.password}
          helperText={errors.password || '8+ characters, with upper, lower and a number'}
          fullWidth
        />
        <Select
          label="Access level"
          options={ROLE_OPTIONS}
          value={role}
          onChange={(value) => setRole(value as Role)}
          fullWidth
        />
      </StepForm>
    </>
  );
};
