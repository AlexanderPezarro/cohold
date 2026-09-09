import React, { useState } from 'react';
import { TextField } from '../../primitives/TextField';
import { StepForm } from './StepForm';
import { tenantsService } from '../../../services/api/tenants.service';
import { useToast } from '../../../contexts/ToastContext';
import { ApiError } from '../../../types/api.types';
import type { OnboardingStepFormProps } from './types';
import styles from './Onboarding.module.scss';

const EMPTY = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
};

/** UK numbers, matching the server's tenant schema. */
const UK_PHONE = /^(\+44\s?|0)?(\d\s?){9,10}$/;

export const TenantStepForm: React.FC<OnboardingStepFormProps> = ({ onCompleted }) => {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const setField = (field: keyof typeof EMPTY, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: '' }));
  };

  const validate = () => {
    const found: Record<string, string> = {};
    if (!form.firstName.trim()) found.firstName = 'First name is required';
    if (!form.lastName.trim()) found.lastName = 'Last name is required';
    if (!form.email.trim()) {
      found.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      found.email = 'Enter a valid email address';
    }
    if (!form.phone.trim()) {
      found.phone = 'Phone number is required';
    } else if (!UK_PHONE.test(form.phone.trim())) {
      found.phone = 'Enter a valid UK phone number';
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
      const tenant = await tenantsService.createTenant({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
      });
      toast.success(`${tenant.firstName} ${tenant.lastName} added`);
      setForm(EMPTY);
      await onCompleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the tenant');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <StepForm
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      submitLabel="Add tenant"
      hint="Emergency contacts and notes can be filled in later from the tenant's page."
    >
      <TextField
        label="First name"
        value={form.firstName}
        onChange={(e) => setField('firstName', e.target.value)}
        error={!!errors.firstName}
        helperText={errors.firstName}
        fullWidth
      />
      <TextField
        label="Last name"
        value={form.lastName}
        onChange={(e) => setField('lastName', e.target.value)}
        error={!!errors.lastName}
        helperText={errors.lastName}
        fullWidth
      />
      <div className={styles.fullWidth}>
        <TextField
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => setField('email', e.target.value)}
          error={!!errors.email}
          helperText={errors.email}
          fullWidth
        />
      </div>
      <TextField
        label="Phone"
        value={form.phone}
        onChange={(e) => setField('phone', e.target.value)}
        error={!!errors.phone}
        helperText={errors.phone}
        placeholder="07700 900000"
        fullWidth
      />
    </StepForm>
  );
};
