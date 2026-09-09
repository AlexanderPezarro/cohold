import React, { useEffect, useState } from 'react';
import { TextField } from '../../primitives/TextField';
import { Select } from '../../primitives/Select';
import { DatePicker } from '../../primitives/DatePicker';
import { Spinner } from '../../primitives/Spinner';
import { StepForm } from './StepForm';
import { leasesService } from '../../../services/api/leases.service';
import { tenantsService } from '../../../services/api/tenants.service';
import { useProperties } from '../../../contexts/PropertiesContext';
import { useToast } from '../../../contexts/ToastContext';
import { ApiError } from '../../../types/api.types';
import type { Tenant } from '../../../types/api.types';
import type { OnboardingStepFormProps } from './types';
import styles from './Onboarding.module.scss';

export const LeaseStepForm: React.FC<OnboardingStepFormProps> = ({ onCompleted }) => {
  const toast = useToast();
  const { properties } = useProperties();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loadingTenants, setLoadingTenants] = useState(true);
  const [propertyId, setPropertyId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(new Date());
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [monthlyRent, setMonthlyRent] = useState('');
  const [deposit, setDeposit] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    tenantsService
      .getTenants()
      .then((fetched) => {
        if (cancelled) return;
        setTenants(fetched);
        // With a single tenant or property there is nothing to choose - preselect.
        if (fetched.length === 1) setTenantId(fetched[0].id);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Error loading tenants:', err);
          setError('Could not load your tenants');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTenants(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (properties.length === 1) setPropertyId(properties[0].id);
  }, [properties]);

  const validate = () => {
    const found: Record<string, string> = {};
    if (!propertyId) found.propertyId = 'Choose a property';
    if (!tenantId) found.tenantId = 'Choose a tenant';
    if (!startDate) found.startDate = 'Start date is required';
    if (startDate && endDate && endDate < startDate) {
      found.endDate = 'End date must be on or after the start date';
    }
    if (!monthlyRent || Number(monthlyRent) <= 0) found.monthlyRent = 'Enter the monthly rent';
    if (!deposit || Number(deposit) <= 0) found.deposit = 'Enter the deposit amount';
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!validate() || !startDate) return;

    try {
      setSubmitting(true);
      await leasesService.createLease({
        propertyId,
        tenantId,
        startDate: startDate.toISOString(),
        endDate: endDate ? endDate.toISOString() : null,
        monthlyRent: Number(monthlyRent),
        securityDepositAmount: Number(deposit),
      });
      toast.success('Lease created');
      await onCompleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the lease');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingTenants) {
    return (
      <div className={styles.formLoading}>
        <Spinner />
      </div>
    );
  }

  return (
    <StepForm
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      submitLabel="Create lease"
      hint="Leave the end date blank for a rolling tenancy."
    >
      <Select
        label="Property"
        options={properties.map((property) => ({ value: property.id, label: property.name }))}
        value={propertyId}
        onChange={setPropertyId}
        placeholder="Select a property"
        error={!!errors.propertyId}
        helperText={errors.propertyId}
        fullWidth
      />
      <Select
        label="Tenant"
        options={tenants.map((tenant) => ({
          value: tenant.id,
          label: `${tenant.firstName} ${tenant.lastName}`,
        }))}
        value={tenantId}
        onChange={setTenantId}
        placeholder="Select a tenant"
        error={!!errors.tenantId}
        helperText={errors.tenantId}
        fullWidth
      />
      <DatePicker
        label="Start date"
        value={startDate}
        onChange={setStartDate}
        error={!!errors.startDate}
        helperText={errors.startDate}
      />
      <DatePicker
        label="End date (optional)"
        value={endDate}
        onChange={setEndDate}
        error={!!errors.endDate}
        helperText={errors.endDate}
        minDate={startDate ?? undefined}
      />
      <TextField
        label="Monthly rent (£)"
        type="number"
        value={monthlyRent}
        onChange={(e) => setMonthlyRent(e.target.value)}
        error={!!errors.monthlyRent}
        helperText={errors.monthlyRent}
        fullWidth
      />
      <TextField
        label="Security deposit (£)"
        type="number"
        value={deposit}
        onChange={(e) => setDeposit(e.target.value)}
        error={!!errors.deposit}
        helperText={errors.deposit}
        fullWidth
      />
    </StepForm>
  );
};
