import React, { useState } from 'react';
import { TextField } from '../../primitives/TextField';
import { Select } from '../../primitives/Select';
import { StepForm } from './StepForm';
import { propertiesService } from '../../../services/api/properties.service';
import { useProperties } from '../../../contexts/PropertiesContext';
import { useToast } from '../../../contexts/ToastContext';
import { ApiError } from '../../../types/api.types';
import type { CreatePropertyRequest } from '../../../types/api.types';
import type { OnboardingStepFormProps } from './types';
import styles from './Onboarding.module.scss';

const PROPERTY_TYPES: CreatePropertyRequest['propertyType'][] = [
  'House',
  'Flat',
  'Studio',
  'Bungalow',
  'Terraced',
  'Semi-Detached',
  'Detached',
  'Maisonette',
  'Commercial',
];

const TYPE_OPTIONS = PROPERTY_TYPES.map((type) => ({ value: type, label: type }));

const EMPTY = {
  name: '',
  street: '',
  city: '',
  county: '',
  postcode: '',
  propertyType: 'House' as CreatePropertyRequest['propertyType'],
};

/**
 * Asks only for what a property can't exist without. Purchase price, notes and
 * listing state are all editable later on the property page - during setup they
 * are just friction.
 */
export const PropertyStepForm: React.FC<OnboardingStepFormProps> = ({ onCompleted }) => {
  const toast = useToast();
  const { refetch } = useProperties();
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
    if (!form.name.trim()) found.name = 'Give the property a name you will recognise';
    if (!form.street.trim()) found.street = 'Street is required';
    if (!form.city.trim()) found.city = 'City is required';
    if (!form.county.trim()) found.county = 'County is required';
    if (!form.postcode.trim()) found.postcode = 'Postcode is required';
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!validate()) return;

    try {
      setSubmitting(true);
      const property = await propertiesService.createProperty({
        name: form.name.trim(),
        street: form.street.trim(),
        city: form.city.trim(),
        county: form.county.trim(),
        postcode: form.postcode.trim(),
        propertyType: form.propertyType,
      });
      // Keep the shared property list in step - the lease step reads from it.
      await refetch();
      toast.success(`${property.name} added`);
      setForm(EMPTY);
      await onCompleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the property');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <StepForm
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      submitLabel="Add property"
      hint="You can add purchase details, notes and ownership splits later."
    >
      <div className={styles.fullWidth}>
        <TextField
          label="Property name"
          value={form.name}
          onChange={(e) => setField('name', e.target.value)}
          error={!!errors.name}
          helperText={errors.name}
          placeholder="e.g. 42 Oak Avenue"
          fullWidth
        />
      </div>
      <div className={styles.fullWidth}>
        <TextField
          label="Street"
          value={form.street}
          onChange={(e) => setField('street', e.target.value)}
          error={!!errors.street}
          helperText={errors.street}
          fullWidth
        />
      </div>
      <TextField
        label="City"
        value={form.city}
        onChange={(e) => setField('city', e.target.value)}
        error={!!errors.city}
        helperText={errors.city}
        fullWidth
      />
      <TextField
        label="County"
        value={form.county}
        onChange={(e) => setField('county', e.target.value)}
        error={!!errors.county}
        helperText={errors.county}
        fullWidth
      />
      <TextField
        label="Postcode"
        value={form.postcode}
        onChange={(e) => setField('postcode', e.target.value)}
        error={!!errors.postcode}
        helperText={errors.postcode}
        fullWidth
      />
      <Select
        label="Property type"
        options={TYPE_OPTIONS}
        value={form.propertyType}
        onChange={(value) => setField('propertyType', value)}
        fullWidth
      />
    </StepForm>
  );
};
