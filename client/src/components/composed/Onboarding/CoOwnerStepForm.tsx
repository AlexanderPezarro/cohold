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
 * Invites a co-owner by email. The server creates the account and emails them a
 * link to choose their own password; if the email can't be sent, the link is
 * shown here instead so it can be passed on by hand.
 */
export const CoOwnerStepForm: React.FC<OnboardingStepFormProps> = ({ onCompleted }) => {
  const toast = useToast();
  const { user } = useAuth();
  const [existing, setExisting] = useState<UserListItem[]>([]);
  const [email, setEmail] = useState('');
  const [manualLink, setManualLink] = useState<string | null>(null);
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
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setManualLink(null);
    if (!validate()) return;

    try {
      setSubmitting(true);
      const invited = email.trim();
      const result = await usersService.inviteUser(invited, role);
      if (result.emailSent) {
        toast.success(`Invite sent to ${invited}`);
        setManualLink(null);
      } else {
        toast.info(`Couldn't email ${invited} — copy their invite link below`);
        setManualLink(result.inviteUrl ?? null);
      }
      setEmail('');
      await loadUsers();
      // Moving on would unmount the form and take the link with it, so only
      // advance once there's nothing left for the landlord to copy.
      if (result.emailSent) await onCompleted();
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
        submitLabel="Send invite"
        hint={
          manualLink && (
            <span className={styles.inviteLink}>
              <span>Invite link (valid for 7 days):</span>
              <code>{manualLink}</code>
            </span>
          )
        }
      >
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
